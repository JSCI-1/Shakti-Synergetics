-- ════════════════════════════════════════════════════════════
-- MIGRATION 049: slurry_operator_job_cards
-- Replace shift1_operator / shift2_operator with:
--   shift          text  ('Day' | 'Night')
--   operator_name  text  (auto-filled from logged-in user)
-- ════════════════════════════════════════════════════════════

alter table slurry_operator_job_cards
  drop column if exists shift1_operator,
  drop column if exists shift2_operator,
  add column if not exists shift         text,
  add column if not exists operator_name text;
