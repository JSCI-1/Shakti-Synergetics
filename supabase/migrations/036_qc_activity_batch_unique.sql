-- ════════════════════════════════════════════════════════════
-- MIGRATION 036 — QC Activity Draft: add batch_no to unique key + date fix
-- Run in: Supabase Dashboard → SQL Editor → New query
-- APPLY ORDER: run AFTER 020 (qc_activity_draft must exist).
--
-- GOAL: Fix two issues in the Finished Goods → Production Activity live feed:
--
--   1. UNIQUE CONSTRAINT FIX: The old unique (dryer, log_date, grade) allowed
--      only ONE live activity per dryer+date+grade. When two different batch
--      numbers were entered for the same (dryer, date, grade), the second
--      overwrote the first. Adding batch_no to the constraint ensures each
--      batch gets its own live row. This is a necessary, minimal schema
--      change — the app already requires batch_no for the readiness gate,
--      so it is never NULL in practice.
--
--   2. DATE CORRECTION: A specific qc_activity_draft row has log_date =
--      2026-10-19 but was last updated on 2026-10-22 (the operator's draft
--      persisted across logout with the old date, and the live push fired on
--      mount with the stale date). Correct only this row's log_date to
--      2026-10-22, preserving every other field (batch_no, moisture, sieve
--      logs, tested_by, went_live_at, etc.).
--
-- SAFETY: Only touches qc_activity_draft (the FG live feed). Does NOT affect
-- quality_control_records, dryer_hourly_draft, Google Sheets sync, or any
-- other table/trigger. The date correction targets a SINGLE row by id.
-- ════════════════════════════════════════════════════════════

-- ── 1. Widen the unique constraint to include batch_no ───────────
-- Drop the old constraint and add the new one. Existing rows with duplicate
-- (dryer, log_date, grade) but different batch_no are fine (they were
-- previously merged; now they'll be separate). If any exact duplicates
-- exist (same dryer+date+grade+batch_no), they must be deduplicated first.

-- Remove the old constraint (name depends on how it was created; try both).
alter table qc_activity_draft
  drop constraint if exists qc_activity_draft_dryer_log_date_grade_key;
alter table qc_activity_draft
  drop constraint if exists qc_activity_draft_dryer_log_date_grade_batch_no_key;

-- Add the new constraint.
alter table qc_activity_draft
  add constraint qc_activity_draft_dryer_log_date_grade_batch_no_key
  unique (dryer, log_date, grade, batch_no);

-- ── 2. Correct the specific row's log_date ──────────────────────
-- Row id = c7b05ab3-707c-40f2-b712-d53e32319110
-- Current: dryer=ND1, log_date=2026-10-19, grade=omri, batch_no=O-ND2-260669
-- Target:  dryer=ND1, log_date=2026-10-22, grade=omri, batch_no=O-ND2-260669
-- Only the date changes; all other columns (moisture, sieve logs, tested_by,
-- went_live_at, last_saved_at) are preserved.
update qc_activity_draft
   set log_date = '2026-10-22'
 where id = 'c7b05ab3-707c-40f2-b712-d53e32319110'
   and log_date = '2026-10-19'
   and batch_no = 'O-ND2-260669';

-- ── 3. Cleanup test row (safe, idempotent) ──────────────────────
-- Remove a leftover constraint-test row inserted during validation.
-- It has an expired last_saved_at and never appears in Production Activity,
-- but should not remain in the table.
delete from qc_activity_draft where batch_no = 'CONSTRAINT_TEST';
