// thermopack-sheets-sync-pull — serve a FIFO batch of pending THERMOPACK
// outbox rows. DEDICATED Thermopack endpoint (Option C, full isolation):
// it claims ONLY from thermopack_sheets_sync_outbox via
// thermopack_sheets_sync_claim_batch, so it can never claim or acknowledge a
// Dryer/QC (sheets_sync_outbox) row. Same structure/auth as the shared
// sheets-sync-pull; the only difference is the table/RPC it targets.
//
// Auth: header `x-sheets-sync-secret` constant-time compared to the
// THERMOPACK_SHEETS_SYNC_SECRET Edge Function secret (a DEDICATED secret,
// separate from the Dryer/QC SHEETS_SYNC_SECRET); mismatch → 401.

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

Deno.serve(async (req) => {
  const supabaseUrl = env("SUPABASE_URL");
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
  const sharedSecret = env("THERMOPACK_SHEETS_SYNC_SECRET");

  if (!supabaseUrl || !serviceRoleKey || !sharedSecret) {
    console.error("[thermopack-sheets-sync-pull] Missing configuration:", {
      hasUrl: !!supabaseUrl,
      hasServiceRoleKey: !!serviceRoleKey,
      hasSharedSecret: !!sharedSecret,
    });
    return json(500, { error: "Function is not configured." });
  }

  const presented = (req.headers.get("x-sheets-sync-secret") ?? "").trim();
  if (!presented || !timingSafeEqual(presented, sharedSecret)) {
    console.error("[thermopack-sheets-sync-pull] Rejected request: bad or missing secret.");
    return json(401, { error: "Unauthorized" });
  }

  let limit = 100;
  try {
    const raw = new URL(req.url).searchParams.get("limit");
    if (raw !== null) {
      const n = parseInt(raw, 10);
      if (Number.isFinite(n)) {
        limit = Math.min(500, Math.max(1, n));
      }
    }
  } catch {
    limit = 100;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    const { data, error } = await supabase.rpc(
      "thermopack_sheets_sync_claim_batch",
      { p_limit: limit },
    );

    if (error) {
      console.error("[thermopack-sheets-sync-pull] Claim batch failed:", error.message);
      return json(500, { error: "Failed to serve batch." });
    }

    return json(200, { rows: data ?? [] });
  } catch (e) {
    console.error(
      "[thermopack-sheets-sync-pull] Unexpected error:",
      e instanceof Error ? e.message : "Unknown error",
    );
    return json(500, { error: "Internal error." });
  }
});
