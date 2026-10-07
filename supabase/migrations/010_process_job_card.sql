-- ════════════════════════════════════════════════════════════
-- MIGRATION 010 — Process Job Card (replaces slurry_job_cards)
-- Run in: Supabase Dashboard → SQL Editor → New query
-- ════════════════════════════════════════════════════════════

-- ── TABLE: process_job_cards ─────────────────────────────────
-- One record per "Save Job Card" click in the Batch Operator
-- → Process Job Card tab.

drop table if exists process_job_cards cascade;

create table process_job_cards (
  id               uuid default gen_random_uuid() primary key,
  created_at       timestamptz default now(),

  date             date,
  shift1_operator  text,
  shift2_operator  text,

  -- ── Batch cards (stacked card design) ──
  -- Array of batch card objects, one per batch:
  -- {
  --   id          : string (uid),
  --   batchNo     : string,
  --   tankType    : string  ('Attrition-1st-1.6MT' | 'Attrition-2nd-1.2MT'
  --                         | 'HST-1st-8MT' | 'HST-2nd-6MT'),
  --   completed   : boolean,
  --   locked      : boolean,
  --   completedAt : string  (12-hr time, e.g. "02:30 PM"),
  --   firstStamp  : string,
  --   lastStamp   : string,
  --   expanded    : boolean,
  --   rows        : [{ id, inputName, origin, qty, timestamp }]
  -- }
  batches          jsonb,

  -- ── Flat input rows (one per ingredient per batch) ──
  -- Denormalized for easy querying; mirrors batches[].rows
  -- Each element:
  -- {
  --   batch_id   : string  (matches batches[].id),
  --   batch_no   : string,
  --   tank_type  : string,
  --   input_name : string,
  --   origin     : string,
  --   qty_kg     : numeric,
  --   timestamp  : string  (first-entry time, never overwritten)
  -- }
  input_rows       jsonb,

  -- ── Sand Milling — 10 mills V1 to V10 ──
  -- Each element:
  -- {
  --   mill         : string  ('V1' … 'V10'),
  --   flow_rates   : [{ value: string, timestamp: string }],
  --   current_amp  : string,
  --   zirconia_beads: string,
  --   remarks      : string
  -- }
  mills            jsonb,

  operator         text,
  supervisor       text,
  manager          text
);

alter table process_job_cards enable row level security;

create policy "anon_insert_process_job_cards"
  on process_job_cards for insert to anon with check (true);

create policy "anon_select_process_job_cards"
  on process_job_cards for select to anon using (true);


-- ── TABLE: process_input_saves ───────────────────────────────
-- Auto-save per input row while the user is typing.
-- Keyed by (session_id, row_id, batch_index).
-- Preserves first_stamp forever; updated_at tracks last edit.
-- This replaces slurry_input_saves (same schema, renamed for clarity).

drop table if exists process_input_saves cascade;

create table process_input_saves (
  id           bigint generated always as identity primary key,
  session_id   text   not null,   -- 'slurry-YYYY-MM-DD'
  row_id       text   not null,   -- uid from emptyBatchRow()
  batch_index  int    not null,   -- index of the batch card (0-based)
  input_name   text,
  origin       text,
  qty_kg       numeric,
  first_stamp  text,              -- 12-hr time, set once and never changed
  updated_at   timestamptz default now(),

  unique (session_id, row_id, batch_index)
);

alter table process_input_saves enable row level security;

create policy "anon_all_process_input_saves"
  on process_input_saves for all to anon using (true) with check (true);


-- ── TABLE: process_motor_amp ─────────────────────────────────
-- Running Motor Amp Status accordion inside Process Job Card.
-- 12 motors: Vertical Mill 01-10, Attrition Mill 01-02.

drop table if exists process_motor_amp cascade;

create table process_motor_amp (
  id           uuid default gen_random_uuid() primary key,
  created_at   timestamptz default now(),
  running_date date not null,
  checked_by   text,
  remark       text,
  -- Array of 12 motor objects: { amp, stop, timestamp, saved }
  motor_data   jsonb
);

alter table process_motor_amp enable row level security;

create policy "anon_insert_process_motor_amp"
  on process_motor_amp for insert to anon with check (true);

create policy "anon_select_process_motor_amp"
  on process_motor_amp for select to anon using (true);
