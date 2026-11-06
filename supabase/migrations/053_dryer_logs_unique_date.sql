-- Migration 053: enforce one log sheet per dryer per day
-- ════════════════════════════════════════════════════════════
--
-- PROBLEM
-- -------
-- dryer_logs had no uniqueness constraint on (dryer_type, date).
-- Multiple operators could each press "Save Log Sheet" for the same
-- dryer on the same date, creating duplicate rows.
--
-- FIX — two steps in one migration:
--
--   Step 1  Remove existing duplicates, keeping the earliest save
--           (lowest created_at) for each (dryer_type, date) pair.
--
--   Step 2  Add a UNIQUE constraint on (dryer_type, date) so the
--           database itself rejects any future duplicate, regardless
--           of what the frontend does.
--
-- MANUAL STEPS
-- ------------
-- 1. Open the Supabase Dashboard for your project.
-- 2. Go to SQL Editor → click "New query".
-- 3. Paste the entire contents of this file into the editor.
-- 4. Click "Run" (or press Ctrl+Enter / Cmd+Enter).
-- 5. Confirm you see "Success. No rows returned" (or a row count
--    showing how many duplicates were deleted).
-- 6. Verify the constraint exists:
--      SELECT conname FROM pg_constraint
--      WHERE conrelid = 'dryer_logs'::regclass
--        AND contype = 'u';
--    You should see "dryer_logs_dryer_type_date_key" in the results.
-- ════════════════════════════════════════════════════════════


-- ── Step 1: Delete duplicate rows ────────────────────────────
-- For every (dryer_type, date) group that has more than one row,
-- keep the row with the smallest created_at (the original save)
-- and delete all later ones.

DELETE FROM dryer_logs
WHERE id IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY dryer_type, date
        ORDER BY created_at ASC   -- ASC = earliest first → rn=1 is kept
      ) AS rn
    FROM dryer_logs
  ) ranked
  WHERE rn > 1   -- everything after the first is a duplicate
);


-- ── Step 2: Add unique constraint ────────────────────────────
-- Only one log sheet is allowed per (dryer_type, date).
-- Uses IF NOT EXISTS guard so re-running the migration is safe.

ALTER TABLE dryer_logs
  ADD CONSTRAINT dryer_logs_dryer_type_date_key
  UNIQUE (dryer_type, date);
