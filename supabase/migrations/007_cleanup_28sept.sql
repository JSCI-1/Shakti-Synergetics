-- ════════════════════════════════════════════════════════════
-- MIGRATION 007 — Remove 28/09/2026 test data
-- Run in: Supabase Dashboard → SQL Editor → New query
-- ════════════════════════════════════════════════════════════

-- Remove only the records that contain date 2026-09-28
-- (leaves all other dates intact, including 29/09/2026)

delete from slurry_consumption
where rows @> '[{"date": "2026-09-28"}]'::jsonb;

-- Verify what remains:
-- select id, created_at, rows->0->>'date' as date from slurry_consumption order by created_at;
