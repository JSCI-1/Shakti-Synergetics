-- ════════════════════════════════════════════════════════════
-- MIGRATION 012 — Slurry Consumption Report
-- Run in: Supabase Dashboard → SQL Editor → New query
-- ════════════════════════════════════════════════════════════

-- ── TABLE: slurry_consumption ────────────────────────────────
-- One record per day entry in the Batch Operator
-- → Slurry Consumption Report tab.

drop table if exists slurry_consumption cascade;

create table slurry_consumption (
  id           uuid default gen_random_uuid() primary key,
  created_at   timestamptz default now(),

  -- The entire day's entry is stored as a single-element array
  -- (legacy shape kept for backward compat with history viewer).
  -- Each element:
  -- {
  --   date            : string  (YYYY-MM-DD),
  --   opening_bal     : numeric | null,
  --   total_batches   : numeric | null,
  --   closing_bal     : numeric | null,
  --   slurry_consumed : numeric | null,
  --   production      : numeric | null,
  --   diff            : numeric | null,    -- consumed − production
  --   cumulative_diff : numeric | null,    -- running total since first entry
  --   prepared_by     : string,
  --   qc_lab          : string,
  --   store_dept      : string,
  --   sanction_by     : string,
  --   approved_by     : string,
  --   timestamp       : string             -- 12-hr time of save
  -- }
  rows         jsonb
);

alter table slurry_consumption enable row level security;

create policy "anon_insert_slurry_consumption"
  on slurry_consumption for insert to anon with check (true);

create policy "anon_select_slurry_consumption"
  on slurry_consumption for select to anon using (true);
