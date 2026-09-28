-- ════════════════════════════════════════════════════════════
-- MIGRATION 001 — Thermopack Operator
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ════════════════════════════════════════════════════════════

drop table if exists thermopack_job_cards cascade;
drop table if exists motor_amp_status      cascade;


-- ── TABLE: thermopack_job_cards ──────────────────────────────
create table thermopack_job_cards (
  id                           uuid default gen_random_uuid() primary key,
  created_at                   timestamptz default now(),

  -- Section 1: Date / Shift / Operator / Helpers
  date                         date,
  shift                        text,          -- 'Day' or 'Night'
  operator                     text,
  helper1                      text,
  helper2                      text,
  helper3                      text,
  time_in                      text,          -- HH:MM
  time_out                     text,          -- HH:MM

  -- Section 2: Stock Received
  coal_date                    date,
  coal_qty                     numeric,       -- MT
  bugass_date                  date,
  bugass_qty                   numeric,       -- MT

  -- Section 3: Common Entries — Fuel Charged
  coal_charged                 numeric,       -- MT
  bugass_charged               numeric,       -- MT
  diesel_charged               numeric,       -- Litres

  -- Section 4: Hourly Log
  -- Two separate 24-row arrays — one per thermopack type
  -- Each row: { temp_in, temp_out, oil_press_in, oil_press_out,
  --   oil_press_level, temp_exhaust, feed_freq,
  --   bed_clean_start, bed_clean_stop, ash_clinker_wt,
  --   coil_clean_time, timestamp, saved }
  log_variant                  text,          -- '10L' or '6L' (active when saved)
  log_rows_10l                 jsonb,         -- 24 rows for 10 L kCal
  log_rows_6l                  jsonb,         -- 24 rows for 6 L kCal

  -- Section 5: Summary — separate per variant
  -- Each: { outlet_set_temp, expansion_tank_level, type_of_fuel,
  --   qty_fuel_used, date_of_last_boiler_cleaning,
  --   total_running_hrs, consumption_per_hr, total_consumption,
  --   dryer_in_use }
  summary_10l                  jsonb,
  summary_6l                   jsonb,

  -- Auto-calculated
  total_clinker_wt             numeric,       -- sum of ash_clinker_wt from both log variants

  -- Section 6: Remarks
  remarks                      text
);

alter table thermopack_job_cards enable row level security;

create policy "anon_insert_thermopack"
  on thermopack_job_cards for insert to anon with check (true);

create policy "anon_select_thermopack"
  on thermopack_job_cards for select to anon using (true);


-- ── TABLE: motor_amp_status ──────────────────────────────────
-- Running Motor Amp Status accordion — supports 10L and 6L variants
-- 6 motors: ID Blower, FD Blower, Circ Pump (Old), Compressor,
--           Jockey Pump, Circ Pump (New)
create table motor_amp_status (
  id              uuid default gen_random_uuid() primary key,
  created_at      timestamptz default now(),
  running_date    date,
  checked_by      text,
  remark          text,
  -- Which variant was active when saved
  motor_variant   text,    -- '10L' or '6L'
  -- Each array: 6 objects { val, stop, timestamp, saved }
  motor_data_10l  jsonb,
  motor_data_6l   jsonb
);

alter table motor_amp_status enable row level security;

create policy "anon_insert_motor"
  on motor_amp_status for insert to anon with check (true);

create policy "anon_select_motor"
  on motor_amp_status for select to anon using (true);
