-- ════════════════════════════════════════════════════════════
-- MIGRATION 037 — Dryer Hourly Draft: add shift to the unique key
-- Run in: Supabase Dashboard → SQL Editor → New query
-- APPLY ORDER: run AFTER 018 (dryer_hourly_draft must exist).
--
-- ROOT CAUSE THIS FIXES
-- ---------------------
-- The per-hour Save upserts dryer_hourly_draft with onConflict
-- (dryer_type, log_date, hour) — the table's UNIQUE key from migration 018
-- does NOT include `shift`. But the Google Sheet row identity written by the
-- Apps Script (writeDryerHourRow_) IS keyed on (dryer_type, date, shift, hour)
-- → `H|date|shift|hour`. This mismatch means:
--
--   • In Supabase, a Day-shift hour and a Night-shift hour for the SAME
--     (dryer, date, hour) collapse into ONE row — the second save overwrites
--     the first (last-write-wins), silently losing one shift's data.
--   • In the Sheet, the same two saves produce TWO rows (different shift in the
--     key), so the Sheet and Supabase disagree, and values can appear under the
--     wrong shift/hour.
--
-- FIX: widen the UNIQUE key to (dryer_type, log_date, hour, shift) so Day and
-- Night are always distinct records, exactly matching the Sheet's row identity.
-- This is the minimal change that makes website → Supabase → Sheets agree on
-- (dryer, date, shift, hour).
--
-- DATA SAFETY
-- -----------
-- • NO data is deleted or moved. Existing rows are preserved exactly.
-- • `shift` can be NULL on legacy rows; a UNIQUE constraint treats NULLs as
--   distinct, which is fine (legacy NULL-shift rows never collide).
-- • If any EXACT duplicate (dryer_type, log_date, hour, shift) already exists
--   (it cannot under the old key, which was stricter on those three columns),
--   the ADD CONSTRAINT would fail; the old key guaranteed uniqueness on the
--   first three columns, so adding a fourth can never create a conflict.
-- • The app's upsert onConflict is updated in the same change to target the new
--   key (src/components/DryerSection.jsx).
--
-- SCOPE: touches ONLY dryer_hourly_draft. Does NOT affect dryer_logs,
-- quality_control_records, qc_activity_draft, the Google Sheets sync triggers
-- (030), or any QC/Thermopack object.
-- ════════════════════════════════════════════════════════════

-- Drop the old 3-column unique key (name from migration 018's inline `unique`).
alter table dryer_hourly_draft
  drop constraint if exists dryer_hourly_draft_dryer_type_log_date_hour_key;

-- Add the new 4-column unique key including shift.
alter table dryer_hourly_draft
  add constraint dryer_hourly_draft_dryer_type_log_date_hour_shift_key
  unique (dryer_type, log_date, hour, shift);
