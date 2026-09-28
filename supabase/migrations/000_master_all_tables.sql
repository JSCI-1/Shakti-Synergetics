-- ════════════════════════════════════════════════════════════
-- MASTER SQL — ALL TABLES for Shakti Synergetics
-- Paste this entire file into Supabase SQL Editor and Run
-- This drops and recreates all tables safely
-- ════════════════════════════════════════════════════════════


-- ══════════════════════════════════════
-- 1. THERMOPACK OPERATOR
-- ══════════════════════════════════════

drop table if exists thermopack_job_cards cascade;
drop table if exists motor_amp_status      cascade;

create table thermopack_job_cards (
  id                           uuid default gen_random_uuid() primary key,
  created_at                   timestamptz default now(),

  -- Section 1
  date                         date,
  shift                        text,
  operator                     text,
  helper1                      text,
  helper2                      text,
  helper3                      text,
  time_in                      text,
  time_out                     text,

  -- Section 2: Stock Received
  coal_date                    date,
  coal_qty                     numeric,
  bugass_date                  date,
  bugass_qty                   numeric,

  -- Section 3: Common Entries
  coal_charged                 numeric,
  bugass_charged               numeric,
  diesel_charged               numeric,

  -- Section 4: Hourly Log (separate per thermopack type)
  log_variant                  text,
  log_rows_10l                 jsonb,
  log_rows_6l                  jsonb,

  -- Section 5: Summary (separate per thermopack type)
  summary_10l                  jsonb,
  summary_6l                   jsonb,

  -- Auto-calculated
  total_clinker_wt             numeric,

  remarks                      text
);

alter table thermopack_job_cards enable row level security;
create policy "anon_insert_thermopack" on thermopack_job_cards for insert to anon with check (true);
create policy "anon_select_thermopack" on thermopack_job_cards for select to anon using (true);


create table motor_amp_status (
  id              uuid default gen_random_uuid() primary key,
  created_at      timestamptz default now(),
  running_date    date,
  checked_by      text,
  remark          text,
  motor_variant   text,
  motor_data_10l  jsonb,
  motor_data_6l   jsonb
);

alter table motor_amp_status enable row level security;
create policy "anon_insert_motor" on motor_amp_status for insert to anon with check (true);
create policy "anon_select_motor" on motor_amp_status for select to anon using (true);


-- ══════════════════════════════════════
-- 2. SLURRY SECTION
-- ══════════════════════════════════════

drop table if exists slurry_job_cards   cascade;
drop table if exists batch_traceability  cascade;
drop table if exists slurry_motor_amp    cascade;
drop table if exists slurry_consumption  cascade;

create table slurry_job_cards (
  id               uuid default gen_random_uuid() primary key,
  created_at       timestamptz default now(),
  date             date,
  shift1_operator  text,
  shift2_operator  text,
  batches          jsonb,
  input_rows       jsonb,
  mills            jsonb,
  operator         text,
  supervisor       text,
  manager          text
);

alter table slurry_job_cards enable row level security;
create policy "anon_insert_slurry" on slurry_job_cards for insert to anon with check (true);
create policy "anon_select_slurry" on slurry_job_cards for select to anon using (true);


create table batch_traceability (
  id           uuid default gen_random_uuid() primary key,
  created_at   timestamptz default now(),
  date         date,
  rows         jsonb,
  total_hs1    text,
  total_hs2    text,
  total_hs3    text,
  total_nm     text,
  checked_by   text,
  approved_by  text
);

alter table batch_traceability enable row level security;
create policy "anon_insert_batch" on batch_traceability for insert to anon with check (true);
create policy "anon_select_batch" on batch_traceability for select to anon using (true);


create table slurry_motor_amp (
  id           uuid default gen_random_uuid() primary key,
  created_at   timestamptz default now(),
  running_date date not null,
  checked_by   text,
  remark       text,
  motor_data   jsonb
);

alter table slurry_motor_amp enable row level security;
create policy "anon_insert_slurry_motor" on slurry_motor_amp for insert to anon with check (true);
create policy "anon_select_slurry_motor" on slurry_motor_amp for select to anon using (true);


create table slurry_consumption (
  id         uuid default gen_random_uuid() primary key,
  created_at timestamptz default now(),
  rows       jsonb
);

alter table slurry_consumption enable row level security;
create policy "anon_insert_consumption" on slurry_consumption for insert to anon with check (true);
create policy "anon_select_consumption" on slurry_consumption for select to anon using (true);


-- ══════════════════════════════════════
-- 3. DRYER SECTION
-- ══════════════════════════════════════

drop table if exists dryer_logs cascade;

create table dryer_logs (
  id                  uuid default gen_random_uuid() primary key,
  created_at          timestamptz default now(),
  dryer_type          text not null,
  date                date,
  shift               text,
  id_blower_dp        text,
  id_blower_mr        text,
  fd_blower_dp        text,
  fd_blower_mr        text,
  chamber_dp          text,
  chamber_mr          text,
  fbd_pct_dp          text,
  fbd_pct_mr          text,
  batch_no            text,
  calibration_due     date,
  calibration_sensors jsonb,
  total_production    numeric,
  incharge            text,
  operator            text,
  log_rows            jsonb
);

alter table dryer_logs enable row level security;
create policy "anon_insert_dryer" on dryer_logs for insert to anon with check (true);
create policy "anon_select_dryer" on dryer_logs for select to anon using (true);
