-- ════════════════════════════════════════════════════════════
-- MIGRATION 029 — Finished Goods "went live" time for Production → Activity
-- Run in: Supabase Dashboard → SQL Editor → New query
-- APPLY ORDER: run AFTER 020 (qc_activity_draft must exist).
--
-- GOAL (Finished Goods live feed ONLY): record the FIRST moment an FG row
-- became live in Production → Activity, so the Activity card can show "Went
-- live at <time>" alongside the existing 24-hour "Remaining" countdown.
--
-- The website UPSERTs qc_activity_draft on every change, which would overwrite
-- a plain column each time. So we:
--   • add went_live_at (defaults to now() on first INSERT), and
--   • a BEFORE UPDATE trigger that PRESERVES the original went_live_at on every
--     later upsert (ignores any incoming value), so it always reflects the
--     first-live moment, never a later update or the sheet upload time.
--
-- SAFETY: additive and idempotent. Only touches qc_activity_draft (the FG live
-- feed). Does NOT affect dryer_hourly_draft, quality_control_records, the
-- Google Sheets sync, or any other table/trigger. Existing rows get
-- went_live_at backfilled from their current last_saved_at (best available
-- approximation of when they went live) — never fabricated beyond that.
-- ════════════════════════════════════════════════════════════

alter table qc_activity_draft
  add column if not exists went_live_at timestamptz;

-- Default for NEW rows: the insert moment is the go-live moment.
alter table qc_activity_draft
  alter column went_live_at set default now();

-- Backfill existing rows: use last_saved_at (or updated_at) as the best known
-- go-live time. Only fills rows where it is still NULL (idempotent).
update qc_activity_draft
   set went_live_at = coalesce(last_saved_at, updated_at, now())
 where went_live_at is null;

-- Preserve went_live_at across UPSERT updates: on UPDATE, keep the OLD value
-- regardless of what the client sends (the client does not send it anyway).
create or replace function tg_qc_activity_preserve_went_live()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  -- Keep the first-live moment stable. If somehow NULL (pre-backfill row),
  -- seed it from the row's existing last_saved_at so it is never left blank.
  NEW.went_live_at := coalesce(OLD.went_live_at, NEW.went_live_at, OLD.last_saved_at, now());
  return NEW;
end;
$$;

drop trigger if exists trg_qc_activity_preserve_went_live on qc_activity_draft;
create trigger trg_qc_activity_preserve_went_live
  before update on qc_activity_draft
  for each row execute function tg_qc_activity_preserve_went_live();

-- NOTE: Realtime already streams this table (migration 020). The new column is
-- included automatically in change payloads (replica identity full). No change
-- to publication or RLS is required.
