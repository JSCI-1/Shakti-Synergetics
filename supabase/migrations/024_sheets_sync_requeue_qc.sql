-- ════════════════════════════════════════════════════════════
-- MIGRATION 024 — Re-queue already-synced Quality Control events
-- Run in: Supabase Dashboard → SQL Editor → New query
--
-- WHY: The QC → Sheets layout changed from 6 tabs
-- (…– Current Records / …– Field Change History) to 3 tabs
-- (Raw Material / In-Process / Finished Goods). The outbox events
-- that would populate the new tabs were ALREADY processed by the
-- old Apps Script and are now status='done', so the pull Edge
-- Function will never serve them again. This function flips the
-- Quality-Control events back to 'pending' so the (unchanged) sync
-- worker re-writes them into the new tabs.
--
-- SAFETY:
--   • Scoped to record_kind in ('qc_rm','qc_ip','qc_fg') ONLY.
--     Dryer events are NEVER touched.
--   • Idempotent: re-running it just re-queues the same rows; the
--     Apps Script dedup + the sheet upsert-by-source_pk make a
--     re-write a harmless overwrite, not a duplicate row.
--   • Clears locked_at / last_error / retry_count so re-queued rows
--     start clean. synced_at is cleared so they look un-synced.
--   • SECURITY DEFINER, pinned search_path — same posture as the
--     other sheets_sync_* functions. Only the service-role Edge
--     path and SQL-editor (owner) can call it; the browser cannot.
--
-- This file creates a FUNCTION; it does not itself change any data
-- until the function is invoked (see "HOW TO RUN" below).
-- ════════════════════════════════════════════════════════════

create or replace function sheets_sync_requeue_qc()
  returns integer
  language sql
  security definer
  set search_path = public, pg_temp
as $$
  with requeued as (
    update sheets_sync_outbox
       set status      = 'pending',
           locked_at   = null,
           synced_at   = null,
           last_error  = null,
           retry_count = 0
     where record_kind in ('qc_rm', 'qc_ip', 'qc_fg')
       and status in ('done', 'failed', 'in_progress')
    returning 1
  )
  select coalesce(count(*), 0)::int from requeued;
$$;

-- ── HOW TO RUN (once) ────────────────────────────────────────
-- After the function exists, execute it once to re-queue QC events:
--
--   select sheets_sync_requeue_qc();
--
-- It returns the number of QC events flipped back to 'pending'.
-- Within ~1 minute the existing syncTick trigger pulls and re-writes
-- them into the Raw Material / In-Process / Finished Goods tabs.
-- Safe to run again if needed.
