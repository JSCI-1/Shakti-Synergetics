-- ════════════════════════════════════════════════════════════
-- MIGRATION 006 — Clean + Seed Slurry Consumption data
-- Run in: Supabase Dashboard → SQL Editor → New query
-- ════════════════════════════════════════════════════════════

-- Step 1: Remove all existing test/dummy data
delete from slurry_consumption;

-- Step 2: Seed date 29/09/2026
-- Opening Bal: 18531 | Total Batches: 18621 | Closing Bal: 17000
-- Slurry Consumed: 20152 | Production: 20084
-- Diff (Consumed − Production): +68 | Cumulative Diff: +1085

insert into slurry_consumption (rows) values (
  '[{
    "date":            "2026-09-29",
    "opening_bal":     18531,
    "total_batches":   18621,
    "closing_bal":     17000,
    "slurry_consumed": 20152,
    "production":      20084,
    "diff":            68,
    "cumulative_diff": 1085,
    "prepared_by":     "",
    "qc_lab":          "",
    "store_dept":      "",
    "sanction_by":     "",
    "approved_by":     "",
    "timestamp":       ""
  }]'::jsonb
);

-- ── To add more historical dates, copy this block ─────────────
-- insert into slurry_consumption (rows) values (
--   '[{
--     "date":            "2026-09-28",
--     "opening_bal":     17000,
--     "total_batches":   38788,
--     "closing_bal":     10500,
--     "slurry_consumed": 45288,
--     "production":      45400,
--     "diff":            -112,
--     "cumulative_diff": 973,
--     "prepared_by":     "",
--     "qc_lab":          "",
--     "store_dept":      "",
--     "sanction_by":     "",
--     "approved_by":     "",
--     "timestamp":       ""
--   }]'::jsonb
-- );
