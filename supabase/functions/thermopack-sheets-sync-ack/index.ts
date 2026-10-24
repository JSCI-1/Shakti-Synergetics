// thermopack-sheets-sync-ack — mark served THERMOPACK outbox rows done or
// failed. DEDICATED Thermopack endpoint (Option C, full isolation): it only
// ever updates thermopack_sheets_sync_outbox, so it can never acknowledge a
// Dryer/QC (sheets_sync_outbox) row. Same structure/auth as the shared
// sheets-sync-ack; the only difference is the table it targets and the
// DEDICATED THERMOPACK_SHEETS_SYNC_SECRET it checks.
//
// Body: POST JSON { done: [event_id…], failed: [{ event_id, error }…] }.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const env = (k: string) => {
  let v = (Deno.env.get(k) ?? "")
    .trim()
    .replace(/^["']|["']$/g, "");
  v = v.replace(/^(Basic|Bearer)\s+/i, "").trim();
  return v;
};

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) {
    let diff = 1;
    const len = Math.max(ab.length, bb.length, 1);
    for (let i = 0; i < len; i++) {
      diff |= (ab[i % (ab.length || 1)] ?? 0) ^ (bb[i % (bb.length || 1)] ?? 0);
    }
    return diff === 0 && ab.length === bb.length;
  }
  let diff = 0;
  for (let i = 0; i < ab.length; i++) {
    diff |= ab[i] ^ bb[i];
  }
  return diff === 0;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const MAX_RETRY = 5;
const ERROR_MAX_LEN = 1000;

Deno.serve(async (req) => {
  const supabaseUrl = env("SUPABASE_URL");
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
  const sharedSecret = env("THERMOPACK_SHEETS_SYNC_SECRET");

  if (!supabaseUrl || !serviceRoleKey || !sharedSecret) {
    console.error("[thermopack-sheets-sync-ack] Missing configuration:", {
      hasUrl: !!supabaseUrl,
      hasServiceRoleKey: !!serviceRoleKey,
      hasSharedSecret: !!sharedSecret,
    });
    return json(500, { error: "Function is not configured." });
  }

  const presented = (req.headers.get("x-sheets-sync-secret") ?? "").trim();
  if (!presented || !timingSafeEqual(presented, sharedSecret)) {
    console.error("[thermopack-sheets-sync-ack] Rejected request: bad or missing secret.");
    return json(401, { error: "Unauthorized" });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }

  const doneRaw = (body as { done?: unknown })?.done;
  const failedRaw = (body as { failed?: unknown })?.failed;

  const doneIds: string[] = Array.isArray(doneRaw)
    ? doneRaw.filter((x): x is string => typeof x === "string" && x.trim() !== "")
    : [];

  const failed: { event_id: string; error: string }[] = Array.isArray(failedRaw)
    ? failedRaw
        .filter(
          (x): x is { event_id: string; error?: unknown } =>
            !!x &&
            typeof (x as { event_id?: unknown }).event_id === "string" &&
            (x as { event_id: string }).event_id.trim() !== "",
        )
        .map((x) => ({
          event_id: (x as { event_id: string }).event_id,
          error: String((x as { error?: unknown }).error ?? "").slice(0, ERROR_MAX_LEN),
        }))
    : [];

  if (
    (doneRaw !== undefined && !Array.isArray(doneRaw)) ||
    (failedRaw !== undefined && !Array.isArray(failedRaw))
  ) {
    return json(400, { error: "`done` and `failed` must be arrays." });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    if (doneIds.length > 0) {
      const { error } = await supabase
        .from("thermopack_sheets_sync_outbox")
        .update({ status: "done", synced_at: new Date().toISOString() })
        .in("event_id", doneIds);
      if (error) {
        console.error("[thermopack-sheets-sync-ack] done update failed:", error.message);
        return json(500, { error: "Failed to record done." });
      }
    }

    for (const f of failed) {
      const { data: rows, error: readErr } = await supabase
        .from("thermopack_sheets_sync_outbox")
        .select("retry_count")
        .eq("event_id", f.event_id)
        .limit(1);

      if (readErr) {
        console.error("[thermopack-sheets-sync-ack] failed lookup error:", readErr.message);
        return json(500, { error: "Failed to record failure." });
      }
      if (!rows || rows.length === 0) {
        continue;
      }

      const nextRetry = (rows[0].retry_count ?? 0) + 1;
      const nextStatus = nextRetry < MAX_RETRY ? "pending" : "failed";

      const { error: updErr } = await supabase
        .from("thermopack_sheets_sync_outbox")
        .update({
          retry_count: nextRetry,
          last_error: f.error,
          status: nextStatus,
        })
        .eq("event_id", f.event_id);

      if (updErr) {
        console.error("[thermopack-sheets-sync-ack] failed update error:", updErr.message);
        return json(500, { error: "Failed to record failure." });
      }
    }

    return json(200, {
      done: doneIds.length,
      failed: failed.length,
    });
  } catch (e) {
    console.error(
      "[thermopack-sheets-sync-ack] Unexpected error:",
      e instanceof Error ? e.message : "Unknown error",
    );
    return json(500, { error: "Internal error." });
  }
});
