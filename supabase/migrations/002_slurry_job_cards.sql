-- ════════════════════════════════════════════════════════════
-- MIGRATION 002 — Slurry Section
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ════════════════════════════════════════════════════════════

drop table if exists slurry_job_cards  cascade;
drop table if exists batch_traceability cascade;
drop table if exists slurry_motor_amp  cascade;
drop table if exists slurry_consumption cascade;


-- ── TABLE: slurry_job_cards ──────────────────────────────────
-- Process Job Card
create table slurry_job_cards (
  id               uuid default gen_random_uuid() primary key,
  created_at       timestamptz default now(),

  date             date,
  shift1_operator  text,
  shift2_operator  text,

  -- Shared batch list (written by Process Job Card, read by Batch Traceability)
  -- Each: { id, batch_no, tank_type }
  -- tank_type: 'Attrition-1st-1.6MT' | 'Attrition-2nd-1.2MT'
  --           | 'HST-1st-8MT' | 'HST-2nd-6MT'
  batches          jsonb,

  -- Input rows — one per ingredient
  -- Each: { id, input_name, origins: [string per batch],
  --         batches: [kg per batch], timestamp, saved }
  input_rows       jsonb,

  -- Sand milling — 8 mills (V1-V7, H1)
  -- Each: { mill, flow_rates: [{value, timestamp}],
  --         current_amp, zirconia_beads, remarks }
  mills            jsonb,

  operator         text,
  supervisor       text,
  manager          text
);

alter table slurry_job_cards enable row level security;

create policy "anon_insert_slurry"
  on slurry_job_cards for insert to anon with check (true);

create policy "anon_select_slurry"
  on slurry_job_cards for select to anon using (true);


-- ── TABLE: batch_traceability ────────────────────────────────
-- Batch Traceability Records tab
create table batch_traceability (
  id           uuid default gen_random_uuid() primary key,
  created_at   timestamptz default now(),

  date         date,

  -- One row per batch (auto-populated from Process Job Card batches)
  -- Each: { id, batch_no, charge_tank, charge_start, charge_stop,
  --         hs_tank, hs_start, hs_stop,
  --         lst_start, lst_stop,
  --         s1_start, s1_stop,
  --         s2_start, s2_stop,
  --         finish_tank, finish_start, finish_stop }
  rows         jsonb,

  total_hs1    text,   -- HS-1 (6000 Lt.)
  total_hs2    text,   -- HS-2 (4000 Lt.)
  total_hs3    text,   -- HS-3 (6000 Lt.)
  total_nm     text,   -- NM   (2000 Lt.)

  checked_by   text,
  approved_by  text
);

alter table batch_traceability enable row level security;

create policy "anon_insert_batch"
  on batch_traceability for insert to anon with check (true);

create policy "anon_select_batch"
  on batch_traceability for select to anon using (true);


-- ── TABLE: slurry_motor_amp ──────────────────────────────────
-- Running Motor Amp Status accordion in Process Job Card
-- 12 motors: Vertical Mill 01-10, Attrition Mill 01-02
create table slurry_motor_amp (
  id           uuid default gen_random_uuid() primary key,
  created_at   timestamptz default now(),
  running_date date not null,   -- today only, enforced in UI
  checked_by   text,
  remark       text,
  -- Array of 12 objects: { amp, stop, timestamp, saved }
  motor_data   jsonb
);

alter table slurry_motor_amp enable row level security;

create policy "anon_insert_slurry_motor"
  on slurry_motor_amp for insert to anon with check (true);

create policy "anon_select_slurry_motor"
  on slurry_motor_amp for select to anon using (true);


-- ── TABLE: slurry_consumption ────────────────────────────────
-- Slurry Consumption Report tab — one row per day entry
create table slurry_consumption (
  id         uuid default gen_random_uuid() primary key,
  created_at timestamptz default now(),
  -- Single daily record stored as array of one row object:
  -- { date, opening_bal, total_batches, closing_bal(user-entered),
  --   slurry_consumed, production,
  --   diff (consumed - production, auto-calculated),
  --   prepared_by, qc_lab, store_dept, sanction_by, approved_by,
  --   timestamp }
  rows       jsonb
);

alter table slurry_consumption enable row level security;

create policy "anon_insert_consumption"
  on slurry_consumption for insert to anon with check (true);

create policy "anon_select_consumption"
  on slurry_consumption for select to anon using (true);
