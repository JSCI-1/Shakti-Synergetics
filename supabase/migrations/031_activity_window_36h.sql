-- ════════════════════════════════════════════════════════════
-- MIGRATION 031 — Production → Activity live window: 24h → 36h
-- Run in: Supabase Dashboard → SQL Editor → New query
-- APPLY ORDER: run AFTER 018 (dryer_hourly_draft) and 020 (qc_activity_draft).
--
-- GOAL: keep Production → Activity entries live for 36 HOURS (was 24h), PER
-- ENTRY. Each row carries its own last_saved_at, and the hourly draft stores
-- ONE ROW PER (dryer, date, hour) — so every hour (08:00, 09:00, …) and every
-- QC row independently stays visible for 36h from the moment it was last saved.
-- No per-hour special logic is needed: widening the window from 24h to 36h on
-- the per-row last_saved_at gives exactly that behaviour.
--
-- This redefines ONLY the two convenience expiry VIEWS to 36h. The app already
-- filters by the same 36h cutoff in its own queries (ProductionActivity.jsx /
-- DryerSection.jsx). Non-destructive: create or replace view only; no table,
-- data, trigger, RLS, or Realtime change. Rows are still HIDDEN by the window,
-- never deleted — permanent history (dryer_logs / quality_control_records) is
-- untouched. Safe to re-run.
-- ════════════════════════════════════════════════════════════

-- Dryer hourly live feed — 36h window (per-hour, via each row's last_saved_at).
drop view if exists dryer_hourly_draft_active;
create view dryer_hourly_draft_active
  with (security_invoker = true) as
  select *
  from dryer_hourly_draft
  where last_saved_at > now() - interval '36 hours';

-- QC (Finished Goods) live feed — 36h window.
drop view if exists qc_activity_draft_active;
create view qc_activity_draft_active
  with (security_invoker = true) as
  select *
  from qc_activity_draft
  where last_saved_at > now() - interval '36 hours';
