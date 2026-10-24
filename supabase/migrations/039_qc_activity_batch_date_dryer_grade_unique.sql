-- ════════════════════════════════════════════════════════════
-- MIGRATION 039 — QC Activity Draft: ONE live row per
--                 (Dryer, Date, Grade, Batch No.)
-- Run in: Supabase Dashboard → SQL Editor → New query
-- APPLY ORDER: run AFTER 020 (qc_activity_draft) and 036.
--
-- GOAL (per request, Option A/A2): in Production → Activity a physical batch run
-- is identified by Batch No. QUALIFIED by Date + Dryer + Grade — NOT by batch
-- number alone, because batch numbers are NOT always unique (the same number
-- recurs on other days / dryers). So:
--   • the same (dryer, date, grade, batch_no) → ONE live card; every later
--     Moisture / Wet Sieve / Dry Sieve reading updates that one entry;
--   • the same batch number on a DIFFERENT day, dryer, or grade → its OWN
--     separate live card.
--
-- This restores the 4-column key (identical in intent to migration 036). If an
-- earlier batch_no-only index was ever created on this table, step 1 drops it so
-- this migration is safe to run from any prior state.
--
-- SAFETY: only touches qc_activity_draft (the FG live feed). Does NOT affect
-- quality_control_records, qc_fg_sieve_readings, qc_fg_moisture_readings,
-- dryer_hourly_draft, the Google Sheets sync, or any other table/trigger.
-- Re-runnable (drop-if-exists guards). Deduplicates first so the unique key can
-- be (re)created without error.
-- ════════════════════════════════════════════════════════════

-- ── 1. Drop any prior batch_no-only partial unique index ─────────────────────
drop index if exists qc_activity_draft_batch_no_key;

-- ── 2. Deduplicate rows that share (dryer, log_date, grade, batch_no) ────────
-- Keep the MOST RECENTLY saved row per combination (the current live truth) and
-- delete older duplicates, so step 3's unique constraint can be added.
delete from qc_activity_draft a
using qc_activity_draft b
where a.id <> b.id
  and coalesce(a.dryer, '')      = coalesce(b.dryer, '')
  and a.log_date                 = b.log_date
  and coalesce(a.grade, '')      = coalesce(b.grade, '')
  and coalesce(a.batch_no, '')   = coalesce(b.batch_no, '')
  and (
        coalesce(a.last_saved_at, a.updated_at) < coalesce(b.last_saved_at, b.updated_at)
     or (
          coalesce(a.last_saved_at, a.updated_at) = coalesce(b.last_saved_at, b.updated_at)
          and a.id < b.id
        )
      );

-- ── 3. Restore the (dryer, log_date, grade, batch_no) unique constraint ──────
-- Drop any prior forms first (names from 020 / 036), then add the 4-column key.
alter table qc_activity_draft
  drop constraint if exists qc_activity_draft_dryer_log_date_grade_key;
alter table qc_activity_draft
  drop constraint if exists qc_activity_draft_dryer_log_date_grade_batch_no_key;

alter table qc_activity_draft
  add constraint qc_activity_draft_dryer_log_date_grade_batch_no_key
  unique (dryer, log_date, grade, batch_no);
