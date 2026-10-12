import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Read environment variables safely.
const env = (k: string) => {
  let v = (Deno.env.get(k) ?? "")
    .trim()
    .replace(/^["']|["']$/g, "");

  // Remove an accidentally included authorization prefix.
  v = v.replace(/^(Basic|Bearer)\s+/i, "").trim();

  return v;
};

// Return a structured error response for the Supabase Auth hook.
const hookError = (code: number, message: string) =>
  new Response(
    JSON.stringify({
      error: {
        http_code: code,
        message,
      },
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );

Deno.serve(async (req) => {
  const rawSecret = env("SMS_HOOK_SECRET_key");
  const apiKey = env("INTERAKT_API_KEY");

  // Use the template code name from Interakt.
  // The environment variable takes priority.
  const template =
    env("INTERAKT_WHATSAPP_TEMPLATE_NAME") || "jsci_login_otp";

  const supabaseUrl = env("SUPABASE_URL");
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");

  // 1. Check required configuration.
  if (
    !rawSecret ||
    !apiKey ||
    !supabaseUrl ||
    !serviceRoleKey
  ) {
    console.error("[sms-hook] Missing environment variables:", {
      hasSecret: !!rawSecret,
      hasKey: !!apiKey,
      hasTemplate: !!template,
      hasSupabaseUrl: !!supabaseUrl,
      hasServiceRoleKey: !!serviceRoleKey,
    });

    return hookError(500, "SMS hook is not configured.");
  }

  // 2. Verify the request came from the Supabase Auth hook.
  const rawBody = await req.text();

  let payload: any;

  try {
    const secret = rawSecret.replace(/^v1,whsec_/, "");

    payload = await new Webhook(secret).verify(
      rawBody,
      Object.fromEntries(req.headers),
    );
  } catch (e) {
    console.error(
      "[sms-hook] Webhook signature verification failed:",
      e instanceof Error ? e.message : "Unknown error",
    );

    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // 3. Extract phone number and OTP.
  const phone10 = String(payload?.user?.phone ?? "")
    .replace(/\D/g, "")
    .slice(-10);

  const otp = payload?.sms?.otp;

  if (phone10.length !== 10 || !otp) {
    console.error("[sms-hook] Invalid payload:", {
      validPhone: phone10.length === 10,
      otpPresent: !!otp,
    });

    return hookError(400, "Invalid hook payload.");
  }

  // 4. Create Supabase client.
  const supabase = createClient(
    supabaseUrl,
    serviceRoleKey,
  );

  // 5. Allow only registered and active users.
  const { data: staff, error: staffError } = await supabase
    .from("app_users")
    .select("phone")
    .eq("phone", "+91" + phone10)
    .eq("is_active", true)
    .maybeSingle();

  if (staffError) {
    console.error(
      "[sms-hook] User lookup failed:",
      staffError.message,
    );

    return hookError(500, "Unable to verify user access.");
  }

  if (!staff) {
    console.warn(
      "[sms-hook] Number not registered:",
      "******" + phone10.slice(-4),
    );

    return hookError(403, "This number is not registered.");
  }

  // 6. Send the OTP through Interakt.
  const authHeader = `Basic ${apiKey}`;

  console.log("[sms-hook] Sending OTP:", {
    phone: "******" + phone10.slice(-4),
    template,
    languageCode: "en",
    // Never log the API key or OTP.
  });

  let status: number | null = null;
  let msg = "";
  let success = false;

  try {
    const resp = await fetch(
      "https://api.interakt.ai/v1/public/message/",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": authHeader,
        },
        body: JSON.stringify({
          countryCode: "+91",
          phoneNumber: phone10,
          type: "Template",
          template: {
            name: template,
            languageCode: "en",
            bodyValues: [String(otp)],
            buttonValues: {
              "0": [String(otp)],
            },
          },
        }),
      },
    );

    status = resp.status;

    // Limit the response saved in logs.
    msg = (await resp.text().catch(() => "")).slice(0, 512);

    console.log("[sms-hook] Interakt HTTP status:", status);
    console.log("[sms-hook] Interakt response:", msg);

    let json: any = {};

    try {
      json = JSON.parse(msg);
    } catch {
      // Handle non-JSON responses safely.
    }

    success = resp.ok && json.result === true;
  } catch (e) {
    msg = e instanceof Error
      ? e.message
      : "Unknown network error";

    console.error("[sms-hook] Interakt request failed:", msg);
  }

  // 7. Record the notification attempt.
  try {
    const { error: logError } = await supabase
      .from("otp_notification_log")
      .insert({
        phone_masked: "******" + phone10.slice(-4),
        success,
        provider_status: status,
        provider_msg: msg,
        provider: "whatsapp_interakt",
      });

    if (logError) {
      console.error(
        "[sms-hook] Notification log insert failed:",
        logError.message,
      );
    }
  } catch (e) {
    console.error(
      "[sms-hook] Notification logging failed:",
      e instanceof Error ? e.message : "Unknown error",
    );
  }

  // 8. Return the result to Supabase Auth.
  if (success) {
    return new Response("{}", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  return hookError(
    status ?? 503,
    "Failed to deliver OTP via WhatsApp.",
  );
});
