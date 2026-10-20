-- ════════════════════════════════════════════════════════════
-- MIGRATION 032 — Dryer production breakdown (Save Log Sheet bottom form)
-- Run in: Supabase Dashboard → SQL Editor → New query
-- APPLY ORDER: run AFTER 003 (dryer_logs) and 030. After this, RE-RUN 030 so
--              the bottom-form trigger emits the new fields (030's VALUES list
--              already references them).
--
-- GOAL: the "Save Log Sheet" bottom form now breaks Total Production of the Day
-- into four entered parts, and Total Production becomes their SUM (computed on
-- the website). Add four numeric columns to dryer_logs so the parts persist and
-- flow to the "New Dryer – Form" / "Old Dryer – Form" sheet tabs:
--   fine_powder, crust_papadi, startup, packed_production (all kg)
-- total_production already exists and now stores the computed sum.
--
-- SAFETY: additive (add column if not exists). No data touched, no trigger/RLS
-- change here. Re-runnable.
-- ════════════════════════════════════════════════════════════

alter table dryer_logs add column if not exists fine_powder       numeric;
alter table dryer_logs add column if not exists crust_papadi      numeric;
alter table dryer_logs add column if not exists startup           numeric;
alter table dryer_logs add column if not exists packed_production numeric;

-- After running this, RE-RUN migration 030 (it redefines the bottom-form
-- trigger whose VALUES list now includes fine_powder / crust_papadi / startup /
-- packed_production), so new "Save Log Sheet" submissions sync these parts.
