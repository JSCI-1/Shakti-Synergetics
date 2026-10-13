-- ════════════════════════════════════════════════════════════
-- MIGRATION 020 — QC Activity Draft (live Finished Goods → Production)
-- Run in: Supabase Dashboard → SQL Editor → New query
--
-- A SHARED, TEMPORARY, cross-device LIVE feed of Quality Control →
-- Finished Goods values, surfaced read-only under Production →
-- Activity. QC writes to this table as the chemist works (on each
-- sieve "Record" click, and on Batch No. / Moisture / Suspensibility
-- change), and Activity subscribes via Supabase Realtime.
--
-- This is SEPARATE from:
--   * dryer_hourly_draft (018) — the Dryer Operator hourly feed
--   * quality_control_records (006) — the PERMANENT QC report saved
--     on Print/Download. This live draft never replaces that; it is
--     an additive, transient view.
--
-- 24h hide-not-delete expiry (based on last_saved_at), authenticated
-- + anon RLS, and Realtime, mirroring migration 018.
-- Re-runnable: drop-if-exists guards throughout.
-- ════════════════════════════════════════════════════════════

drop table if exists qc_activity_draft cascade;

create table qc_activity_draft (
  id             uuid default gen_random_uuid() primary key,

  dryer          text not null,              -- 'ND1' | 'ND2'
  log_date       date not null,              -- FG report date
  grade          text not null,              -- 'normal' | 'export' | 'omri' | 'colour'

  product        text,                       -- FG product label
  batch_no       text,
  moisture_pct   numeric,                    -- final moisture %
  suspensibility_pct numeric,                -- computed suspensibility result

  -- Timestamped sieve records (OMRI). Each element:
  --   { result, status, time, targetLabel }
  wet_sieve_log  jsonb default '[]'::jsonb,
  dry_sieve_log  jsonb default '[]'::jsonb,

  tested_by      text,

  updated_at     timestamptz default now(),
  last_saved_at  timestamptz default now(),  -- expiry basis

  -- One live row per (dryer, date, grade): QC UPSERTS onto this key.
  unique (dryer, log_date, grade)
);


-- ── RLS ──────────────────────────────────────────────────────
-- Logged-in chemists run as `authenticated`; UPDATE is required
-- because the live push uses UPSERT (update on conflict). Without an
-- authenticated INSERT/UPDATE policy the push fails with
--   "new row violates row-level security policy".
alter table qc_activity_draft enable row level security;

drop policy if exists "authenticated_insert_qc_activity" on qc_activity_draft;
create policy "authenticated_insert_qc_activity"
  on qc_activity_draft for insert to authenticated with check (true);

drop policy if exists "authenticated_update_qc_activity" on qc_activity_draft;
create policy "authenticated_update_qc_activity"
  on qc_activity_draft for update to authenticated using (true) with check (true);

drop policy if exists "authenticated_select_qc_activity" on qc_activity_draft;
create policy "authenticated_select_qc_activity"
  on qc_activity_draft for select to authenticated using (true);

drop policy if exists "anon_insert_qc_activity" on qc_activity_draft;
create policy "anon_insert_qc_activity"
  on qc_activity_draft for insert to anon with check (true);

drop policy if exists "anon_update_qc_activity" on qc_activity_draft;
create policy "anon_update_qc_activity"
  on qc_activity_draft for update to anon using (true) with check (true);

drop policy if exists "anon_select_qc_activity" on qc_activity_draft;
create policy "anon_select_qc_activity"
  on qc_activity_draft for select to anon using (true);


-- ── Realtime ─────────────────────────────────────────────────
alter table qc_activity_draft replica identity full;

do $$
begin
  alter publication supabase_realtime add table qc_activity_draft;
exception
  when duplicate_object then null;   -- already in the publication
  when undefined_object then null;   -- publication absent → enable Realtime in dashboard
end
$$;


-- ── 24-hour expiry (hide, never delete) ──────────────────────
-- RLS-respecting convenience view (Supabase is PG15+).
drop view if exists qc_activity_draft_active;
create view qc_activity_draft_active
  with (security_invoker = true) as
  select *
  from qc_activity_draft
  where last_saved_at > now() - interval '24 hours';
