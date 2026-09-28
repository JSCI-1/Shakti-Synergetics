-- ════════════════════════════════════════════════════════════
-- MIGRATION 003 — Dryer Section
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ════════════════════════════════════════════════════════════

drop table if exists dryer_logs cascade;


-- ── TABLE: dryer_logs ────────────────────────────────────────
-- Shared by New Dryer and Old Dryer (dryer_type distinguishes)
create table dryer_logs (
  id               uuid default gen_random_uuid() primary key,
  created_at       timestamptz default now(),

  dryer_type       text not null,   -- 'new' or 'old'
  date             date,
  shift            text,            -- 'Day' or 'Night'

  -- Blower readings (after log table, before footer)
  id_blower_dp     text,
  id_blower_mr     text,
  fd_blower_dp     text,
  fd_blower_mr     text,
  chamber_dp       text,            -- IFBD
  chamber_mr       text,            -- IFBD
  fbd_pct_dp       text,
  fbd_pct_mr       text,

  -- Footer
  batch_no         text,
  calibration_due  date,

  -- Calibration sensor table — 5 sensors x temperature + sensor value
  -- { inlet: {temp, sensor}, outlet: {temp, sensor}, ifbd: {temp, sensor},
  --   fbd: {temp, sensor}, chamber: {temp, sensor} }
  calibration_sensors jsonb,

  total_production numeric,   -- kg
  incharge         text,
  operator         text,

  -- 24 hourly log rows (08:00 – 07:00)
  -- Each: { temp_inlet, temp_outlet, temp_actual,
  --   temp_fbd1, temp_fbd2, temp_chamber,
  --   atomizer_freq, feed_fc, pressure, pt_temp,
  --   batch_no, bags_per_hr, bag_size_wt, kg_per_hr,
  --   colour, id_frequency, remarks,
  --   timestamp, saved }
  log_rows         jsonb
);

alter table dryer_logs enable row level security;

create policy "anon_insert_dryer"
  on dryer_logs for insert to anon with check (true);

create policy "anon_select_dryer"
  on dryer_logs for select to anon using (true);
