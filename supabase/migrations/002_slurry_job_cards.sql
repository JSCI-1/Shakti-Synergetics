-- ════════════════════════════════════════════════════════════
-- MIGRATION 002 — Slurry Section Tables
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ════════════════════════════════════════════════════════════

drop table if exists slurry_job_cards cascade;
drop table if exists batch_traceability cascade;


-- ── TABLE: slurry_job_cards ──────────────────────────────────
create table slurry_job_cards (
  id               uuid default gen_random_uuid() primary key,
  created_at       timestamptz default now(),

  date             date,
  shift1_operator  text,
  shift2_operator  text,

  -- Array of batch column headers
  -- Each: { id, label, tank_type }
  -- tank_type values: 'Attrition-1st-1.6MT', 'Attrition-2nd-1.2MT',
  --                   'HST-1st-8MT', 'HST-2nd-6MT'
  batches          jsonb,

  -- Array of input rows
  -- Each: { id, input_name, origin_rm_batch, batches: [kg per batch col] }
  -- Default inputs: SULPHUR, LIGNO-A, LIGNO-B, FBPP, DN Powder,
  --                 FZ 1, DEFOMER, CHINA CLAY, WATER
  input_rows       jsonb,

  -- Array of 8 mill entries (V1-V7, H1)
  -- Each: { mill, flow_rate, rated_time, current_amp, zirconia_beads }
  mills            jsonb,

  suspension1      text,
  suspension2      text,
  remark           text,
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
create table batch_traceability (
  id           uuid default gen_random_uuid() primary key,
  created_at   timestamptz default now(),

  date         date,

  -- Array of batch rows
  -- Each: { id, batch_no, charge_tank, charge_start, charge_stop,
  --         hs_tank, hs_start, hs_stop, lst_start, lst_stop,
  --         s1_start, s1_stop, s2_start, s2_stop,
  --         finish_tank, finish_start, finish_stop }
  rows         jsonb,

  -- Total running hours per tank
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


-- ── TABLE: slurry_motor_amp ─────────────────────────────────
-- Running Motor Amp Status for Slurry Section (accordion at bottom of Process Job Card)
drop table if exists slurry_motor_amp cascade;

create table slurry_motor_amp (
  id           uuid default gen_random_uuid() primary key,
  created_at   timestamptz default now(),
  running_date date not null,    -- today only — enforced in UI, stored here
  checked_by   text,
  remark       text,
  -- Array of 12 motor objects (Vertical Mill 01-10, Attrition Mill 01-02)
  -- Each: { amp: "reading", stop: "OK|STOP|" }
  motor_data   jsonb
);

alter table slurry_motor_amp enable row level security;

create policy "anon_insert_slurry_motor"
  on slurry_motor_amp for insert to anon with check (true);

create policy "anon_select_slurry_motor"
  on slurry_motor_amp for select to anon using (true);
