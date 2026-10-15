// sheets-sync-pull — serve a FIFO batch of pending outbox rows.
//
// Called by the Google Apps Script sync worker on a time-driven trigger.
// Reuses the sms-hook STRUCTURE (env() trimming helper, Deno.serve,
// service-role createClient reading SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)
// but returns CONVENTIONAL HTTP status codes (200/401/500), NOT the Auth-hook
// 200-wrapped error body.
//
// Auth: header `x-sheets-sync-secret` is constant-time compared to the
// SHEETS_SYNC_SECRET Edge Function secret; mismatch → 401.
// Batch: select up to ?limit= (clamped 1..500, default 100) rows where
// status='pending' OR (status='in_progress' AND locked_at older than 10 min),
// ordered by id (FIFO), and mark them in_progress + locked_at=now() in a single
// `update … returning` so concurrent polls never double-serve and a crashed
// mid-batch poll is reclaimed after the lock expires.
//
// The service-role key never appears in a log line.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Read environment variables safely (same trimming as sms-hook).
const env = (k: string) => {
  let v = (Deno.env.get(k) ?? "")
    .trim()
    .replace(/^["']|["']$/g, "");
  v = v.replace(/^(Basic|Bearer)\s+/i, "").trim();
  return v;
};

// Constant-time string comparison (avoids leaking length-independent timing).
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  // Compare against a fixed-length digest so length differences don't short-circuit.
  if (ab.length !== bb.length) {
    // Still run a dummy compare to keep timing roughly constant.
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
  const sharedSecret = env("SHEETS_SYNC_SECRET");

  // Fail-closed if required configuration is missing.
  if (!supabaseUrl || !serviceRoleKey || !sharedSecret) {
    console.error("[sheets-sync-pull] Missing configuration:", {
      hasUrl: !!supabaseUrl,
      hasServiceRoleKey: !!serviceRoleKey,
      hasSharedSecret: !!sharedSecret,
    });
    return json(500, { error: "Function is not configured." });
  }

  // Auth: shared-secret header, constant-time compared.
  const presented = (req.headers.get("x-sheets-sync-secret") ?? "").trim();
  if (!presented || !timingSafeEqual(presented, sharedSecret)) {
    console.error("[sheets-sync-pull] Rejected request: bad or missing secret.");
    return json(401, { error: "Unauthorized" });
  }

  // Parse ?limit= → int clamped 1..500, default 100 (invalid → default).
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

  // Single locking update: select the FIFO batch of claimable ids, then mark
  // them in_progress + locked_at=now() and return the updated rows. A SQL
  // function keeps the select + update atomic so concurrent polls can't
  // double-serve; stale in_progress locks (>10 min) are reclaimed.
  try {
    const { data, error } = await supabase.rpc("sheets_sync_claim_batch", {
      p_limit: limit,
    });

    if (error) {
      console.error("[sheets-sync-pull] Claim batch failed:", error.message);
      return json(500, { error: "Failed to serve batch." });
    }

    return json(200, { rows: data ?? [] });
  } catch (e) {
    console.error(
      "[sheets-sync-pull] Unexpected error:",
      e instanceof Error ? e.message : "Unknown error",
    );
    return json(500, { error: "Internal error." });
  }
});
