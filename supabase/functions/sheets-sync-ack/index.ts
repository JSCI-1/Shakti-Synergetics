// sheets-sync-ack — mark served outbox rows done or failed.
//
// Called by the Google Apps Script sync worker after it writes a batch.
// Same STRUCTURE and auth as sheets-sync-pull (env() helper, Deno.serve,
// service-role createClient, constant-time x-sheets-sync-secret → 401,
// conventional 200/401/500 — never the Auth-hook 200-wrapped error body).
//
// Body: POST JSON { done: [event_id…], failed: [{ event_id, error }…] }.
//   done   → status='done',  synced_at=now()
//   failed → retry_count+1, last_error=error (truncated to 1000 chars),
//            status back to 'pending' if retry_count < 5 else 'failed'
// Unknown event_ids are ignored (double-ack is harmless). The secret is
// never written to a log line.

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
  const sharedSecret = env("SHEETS_SYNC_SECRET");

  if (!supabaseUrl || !serviceRoleKey || !sharedSecret) {
    console.error("[sheets-sync-ack] Missing configuration:", {
      hasUrl: !!supabaseUrl,
      hasServiceRoleKey: !!serviceRoleKey,
      hasSharedSecret: !!sharedSecret,
    });
    return json(500, { error: "Function is not configured." });
  }

  const presented = (req.headers.get("x-sheets-sync-secret") ?? "").trim();
  if (!presented || !timingSafeEqual(presented, sharedSecret)) {
    console.error("[sheets-sync-ack] Rejected request: bad or missing secret.");
    return json(401, { error: "Unauthorized" });
  }

  // Parse + validate the body (design §10.1).
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }

  const doneRaw = (body as { done?: unknown })?.done;
  const failedRaw = (body as { failed?: unknown })?.failed;

  // done: array of non-empty strings.
  const doneIds: string[] = Array.isArray(doneRaw)
    ? doneRaw.filter((x): x is string => typeof x === "string" && x.trim() !== "")
    : [];

  // failed: array of { event_id: non-empty string, error: string }.
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
    // done → status='done', synced_at=now(). Unknown ids simply match nothing.
    if (doneIds.length > 0) {
      const { error } = await supabase
        .from("sheets_sync_outbox")
        .update({ status: "done", synced_at: new Date().toISOString() })
        .in("event_id", doneIds);
      if (error) {
        console.error("[sheets-sync-ack] done update failed:", error.message);
        return json(500, { error: "Failed to record done." });
      }
    }

    // failed → bump retry_count, store last_error, and set status based on the
    // NEW retry_count (< 5 → pending so it re-serves, else failed). Each row is
    // read-then-written individually so the retry transition is exact; a double-
    // ack of an unknown id is a harmless no-op.
    for (const f of failed) {
      const { data: rows, error: readErr } = await supabase
        .from("sheets_sync_outbox")
        .select("retry_count")
        .eq("event_id", f.event_id)
        .limit(1);

      if (readErr) {
        console.error("[sheets-sync-ack] failed lookup error:", readErr.message);
        return json(500, { error: "Failed to record failure." });
      }
      if (!rows || rows.length === 0) {
        continue; // unknown event_id → ignore (double-ack harmless)
      }

      const nextRetry = (rows[0].retry_count ?? 0) + 1;
      const nextStatus = nextRetry < MAX_RETRY ? "pending" : "failed";

      const { error: updErr } = await supabase
        .from("sheets_sync_outbox")
        .update({
          retry_count: nextRetry,
          last_error: f.error,
          status: nextStatus,
        })
        .eq("event_id", f.event_id);

      if (updErr) {
        console.error("[sheets-sync-ack] failed update error:", updErr.message);
        return json(500, { error: "Failed to record failure." });
      }
    }

    return json(200, {
      done: doneIds.length,
      failed: failed.length,
    });
  } catch (e) {
    console.error(
      "[sheets-sync-ack] Unexpected error:",
      e instanceof Error ? e.message : "Unknown error",
    );
    return json(500, { error: "Internal error." });
  }
});
