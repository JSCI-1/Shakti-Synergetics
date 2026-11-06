-- Migration 055: add Suspensibility Sample Time + Bag No. to qc_activity_draft
-- Run in: Supabase Dashboard → SQL Editor → New query
-- APPLY ORDER: run AFTER 020 (qc_activity_draft must exist).
--
-- GOAL (Finished Goods live feed): the QC chemist now records a Sample Time
-- and a Bag No. for the Suspensibility reading (alongside Moisture / Wet Sieve
-- / Dry Sieve, which carry per-reading sampleTime/bagNo inside their JSON
-- logs). Suspensibility is a single formula-card result, so its sample time and
-- bag no. are stored as two plain text columns on the live row and surfaced on
-- the Production → Activity QC card.
--
-- SAFETY: additive and idempotent. Only touches qc_activity_draft (the FG live
-- feed). Does NOT affect dryer_hourly_draft, quality_control_records, the
-- Google Sheets sync, or any other table/trigger. Existing rows get NULL for
-- both new columns.
-- ════════════════════════════════════════════════════════════

alter table qc_activity_draft
  add column if not exists susp_sample_time text;

alter table qc_activity_draft
  add column if not exists susp_bag_no text;
