-- ════════════════════════════════════════════════════════════
-- MIGRATION 060 — process_job_cards: Shift + Operator Name
-- Run in: Supabase Dashboard → SQL Editor → New query
-- RUN THIS BEFORE deploying the matching website change, otherwise
-- "Save Job Card" in Batch Operator fails (unknown column).
--
-- The Batch Operator Process Job Card no longer has "Shift 1 Operator" /
-- "Shift 2 Operator". It now saves:
--   shift          text  ('Day' | 'Night')
--   operator_name  text  (auto-filled from the logged-in user)
--
-- The old shift1_operator / shift2_operator columns are KEPT so existing
-- saved job cards keep their data. Additive and re-runnable.
-- ════════════════════════════════════════════════════════════

alter table process_job_cards
  add column if not exists shift         text,
  add column if not exists operator_name text;

