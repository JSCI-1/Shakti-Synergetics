-- ════════════════════════════════════════════════════════════
-- MIGRATION 001 — Thermopack Job Cards
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ════════════════════════════════════════════════════════════

-- Drop old tables if they exist (safe — no real data yet)
drop table if exists thermopack_job_cards cascade;
drop table if exists motor_amp_status cascade;


-- ── TABLE: thermopack_job_cards ──────────────────────────────
create table thermopack_job_cards (
  id                           uuid default gen_random_uuid() primary key,
  created_at                   timestamptz default now(),

  -- ── Section 1: Operator ──────────────────────────────────
  date                         date,
  shift                        text,          -- 'Day' or 'Night'
  operator                     text,
  helper1                      text,
  helper2                      text,
  helper3                      text,
  time_in                      text,          -- HH:MM
  time_out                     text,          -- HH:MM

  -- ── Section 2: Stock Received ────────────────────────────
  coal_date                    date,
  coal_qty                     numeric,       -- MT
  bugass_date                  date,
  bugass_qty                   numeric,       -- MT

  -- ── Section 3: Common Entries (Fuel Charged) ─────────────
  coal_charged                 numeric,       -- MT
  bugass_charged               numeric,       -- MT
  diesel_charged               numeric,       -- Litres

  -- ── Section 5: Summary (after hourly log) ────────────────
  outlet_set_temp              numeric,       -- °C
  expansion_tank_level         text,
  type_of_fuel                 text,
  qty_fuel_used                text,
  date_of_last_boiler_cleaning date,
  total_running_hrs            numeric,       -- hours
  consumption_per_hr           numeric,       -- kg/hr
  total_consumption            numeric,       -- kg
  total_clinker_wt             numeric,       -- kg
  dryer_in_use                 text,          -- 'Old' or 'New'

  -- ── Section 4: Hourly Log ─────────────────────────────────
  -- Stored separately for each thermopack type (10L and 6L)
  -- Each is an array of 24 objects — one per time slot
  -- Each object: { temp_in, temp_out, oil_press_in, oil_press_out,
  --   oil_press_level, temp_exhaust, feed_freq,
  --   bed_clean_start, bed_clean_stop, ash_clinker_wt,
  --   coil_clean_time, timestamp, saved }
  log_variant                  text,          -- '10L' or '6L' (which was active)
  log_rows_10l                 jsonb,         -- 24 hourly rows for 10 L kCal
  log_rows_6l                  jsonb,         -- 24 hourly rows for 6 L kCal

  -- ── Remarks ──────────────────────────────────────────────
  remarks                      text
);

-- Row Level Security (allows anon key from .env to read & write)
alter table thermopack_job_cards enable row level security;

create policy "anon_insert_thermopack"
  on thermopack_job_cards for insert to anon with check (true);

create policy "anon_select_thermopack"
  on thermopack_job_cards for select to anon using (true);


-- ── TABLE: motor_amp_status ──────────────────────────────────
-- Stores the Running Motor Amp Status (collapsible section)
create table motor_amp_status (
  id           uuid default gen_random_uuid() primary key,
  created_at   timestamptz default now(),
  running_date date,
  checked_by   text,
  remark       text,
  -- Array of 6 motor objects: [{ val: "amp_reading", stop: "OK|STOP|" }, ...]
  -- Motors in order: ID Blower, FD Blower, Circ Pump (Old),
  --                  Compressor, Jockey Pump, Circ Pump (New)
  motor_data   jsonb
);

alter table motor_amp_status enable row level security;

create policy "anon_insert_motor"
  on motor_amp_status for insert to anon with check (true);

create policy "anon_select_motor"
  on motor_amp_status for select to anon using (true);
