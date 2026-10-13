-- ════════════════════════════════════════════════════════════
-- MIGRATION 018 — Dryer Hourly Draft (shared 24h)
-- Run in: Supabase Dashboard → SQL Editor → New query
--
-- A SHARED, TEMPORARY, cross-device draft of the Dryer Operator
-- hourly log. Shift 1 and Shift 2 run on different devices, so the
-- shared source of truth lives here (not in localStorage): each
-- time an operator clicks the per-hour Save button, that single
-- hour is UPSERTED into this table. Production → Activity reads
-- this table live via Supabase Realtime (read-only).
--
-- This is SEPARATE from dryer_logs (migration 003), which stays
-- the permanent full-log-sheet record written by "Save Log Sheet".
-- Nothing here alters dryer_logs or any other existing table.
--
-- Re-runnable: drop-if-exists guards throughout.
-- ════════════════════════════════════════════════════════════

drop table if exists dryer_hourly_draft cascade;

create table dryer_hourly_draft (
  id             uuid default gen_random_uuid() primary key,

  dryer_type     text not null,              -- 'new' | 'old'
  log_date       date not null,              -- the production date (form.date)
  hour           text not null,              -- TIME_SLOT label, e.g. '08:00' … '07:00'

  shift          text,                       -- 'Day' | 'Night' | null

  -- All hourly field values for this hour, keyed exactly like a
  -- DryerSection row (emptyRow()):
  --   temp_inlet, temp_outlet, temp_actual, temp_fbd1, temp_fbd2,
  --   temp_chamber, atomizer_freq, feed_fc, pressure, pt_temp,
  --   batch_no, bags_per_hr, bag_size_wt, kg_per_hr, colour,
  --   id_frequency, remarks, timestamp
  -- NOTE: values->>'timestamp' is a DISPLAY-ONLY localized (en-IN)
  -- 12-hour string. It is never used for ordering or expiry.
  values         jsonb,

  operator       text,                       -- may be null

  updated_at     timestamptz default now(),
  -- Authoritative "latest successful hourly save" time — expiry basis.
  last_saved_at  timestamptz default now(),

  -- One row per (dryer, date, hour): the per-hour Save UPSERTS onto
  -- this key, so different hours never collide (safe concurrent edits
  -- from different devices) and re-saving the same hour is a single-row
  -- update → LAST WRITE WINS for that hour.
  unique (dryer_type, log_date, hour)
);


-- ── RLS ──────────────────────────────────────────────────────
-- Logged-in operators run as the `authenticated` role. UPDATE is
-- required (not just INSERT) because the per-hour Save uses UPSERT,
-- which performs an UPDATE on conflict. Without an authenticated
-- INSERT/UPDATE policy the save fails with
--   "new row violates row-level security policy"
-- (the exact failure that hit quality_control_records in 006/013).
-- anon policies are added for parity with the rest of the schema.
alter table dryer_hourly_draft enable row level security;

drop policy if exists "authenticated_insert_hourly_draft" on dryer_hourly_draft;
create policy "authenticated_insert_hourly_draft"
  on dryer_hourly_draft for insert to authenticated with check (true);

drop policy if exists "authenticated_update_hourly_draft" on dryer_hourly_draft;
create policy "authenticated_update_hourly_draft"
  on dryer_hourly_draft for update to authenticated using (true) with check (true);

drop policy if exists "authenticated_select_hourly_draft" on dryer_hourly_draft;
create policy "authenticated_select_hourly_draft"
  on dryer_hourly_draft for select to authenticated using (true);

drop policy if exists "anon_insert_hourly_draft" on dryer_hourly_draft;
create policy "anon_insert_hourly_draft"
  on dryer_hourly_draft for insert to anon with check (true);

drop policy if exists "anon_update_hourly_draft" on dryer_hourly_draft;
create policy "anon_update_hourly_draft"
  on dryer_hourly_draft for update to anon using (true) with check (true);

drop policy if exists "anon_select_hourly_draft" on dryer_hourly_draft;
create policy "anon_select_hourly_draft"
  on dryer_hourly_draft for select to anon using (true);


-- ── Realtime ─────────────────────────────────────────────────
-- Production → Activity subscribes to this table. Full replica
-- identity so UPDATE/DELETE payloads carry all columns.
alter table dryer_hourly_draft replica identity full;

-- Add the table to the realtime publication. Tolerate BOTH the
-- "already added" case (re-run) and the "publication missing" case
-- (some projects): if supabase_realtime does not exist, Realtime is
-- disabled for the project and must be enabled in the Supabase
-- dashboard (Database → Replication / Realtime) — the migration then
-- still succeeds and the app's periodic refetch acts as a fallback.
do $$
begin
  alter publication supabase_realtime add table dryer_hourly_draft;
exception
  when duplicate_object then null;   -- already in the publication
  when undefined_object then null;   -- publication absent → enable Realtime in dashboard
end
$$;


-- ── 24-hour expiry (hide, never delete) ──────────────────────
-- Entries older than 24h since their last successful save are HIDDEN
-- from the temporary/Activity view but NOT deleted — permanent history
-- lives in dryer_logs and is untouched. The app also applies this
-- filter in its queries; this view is a convenience that RESPECTS RLS
-- (security_invoker) so it never exposes rows a caller couldn't select
-- directly. (Supabase is PostgreSQL 15+, so security_invoker exists.)
drop view if exists dryer_hourly_draft_active;
create view dryer_hourly_draft_active
  with (security_invoker = true) as
  select *
  from dryer_hourly_draft
  where last_saved_at > now() - interval '24 hours';
