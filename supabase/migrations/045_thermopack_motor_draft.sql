-- ════════════════════════════════════════════════════════════
-- MIGRATION 045 — Thermopack Running Motor Amp Status SHARED draft
-- Run in: Supabase Dashboard → SQL Editor → New query
-- APPLY ORDER: after 001.
--
-- WHY: same shift-handover / reload / cross-device sharing as the job card.
-- Operator 1 fills the Running Motor Amp Status (checked_by, remark, the motor
-- amp/status rows) but may not click "Save Motor Status" before his shift
-- ends. Operator 2 selects the SAME date + variant and must see what operator 1
-- entered, and operator 1 must get his values back after a reload / re-login.
--
-- WHAT: a small SHARED working-draft table keyed by (running_date, variant)
-- holding the motor form as a JSONB blob. The website auto-UPSERTS it as the
-- operator fills the form, and prefills from it on date/variant selection.
-- This is a WORKING DRAFT, not the permanent record — the permanent motor
-- check is still motor_amp_status, written by "Save Motor Status", and is the
-- only thing exported to Google Sheets.
--
-- THERMOPACK-ONLY and additive. Does NOT touch dryer/QC or any shared object.
-- NO sync trigger (draft is never exported to the sheet).
-- Re-runnable: drop-if-exists guard on this Thermopack table only.
-- ════════════════════════════════════════════════════════════

drop table if exists thermopack_motor_draft cascade;

create table thermopack_motor_draft (
  id            uuid default gen_random_uuid() primary key,

  running_date  date not null,          -- the selected motor "Running Date"
  variant       text not null,          -- '10L' | '6L'

  -- The motor form as the operator typed it: { checked_by, remark,
  -- motors_10l: [...], motors_6l: [...] }. One blob so new fields never need a
  -- schema change.
  form          jsonb not null default '{}'::jsonb,

  updated_at    timestamptz default now(),
  created_at    timestamptz default now(),

  -- One shared draft per (date, variant): auto-save UPSERTS onto this key.
  unique (running_date, variant)
);


-- ── RLS ──────────────────────────────────────────────────────
alter table thermopack_motor_draft enable row level security;

drop policy if exists "anon_insert_tp_motor_draft" on thermopack_motor_draft;
create policy "anon_insert_tp_motor_draft"
  on thermopack_motor_draft for insert to anon with check (true);

drop policy if exists "anon_update_tp_motor_draft" on thermopack_motor_draft;
create policy "anon_update_tp_motor_draft"
  on thermopack_motor_draft for update to anon using (true) with check (true);

drop policy if exists "anon_select_tp_motor_draft" on thermopack_motor_draft;
create policy "anon_select_tp_motor_draft"
  on thermopack_motor_draft for select to anon using (true);

drop policy if exists "auth_insert_tp_motor_draft" on thermopack_motor_draft;
create policy "auth_insert_tp_motor_draft"
  on thermopack_motor_draft for insert to authenticated with check (true);

drop policy if exists "auth_update_tp_motor_draft" on thermopack_motor_draft;
create policy "auth_update_tp_motor_draft"
  on thermopack_motor_draft for update to authenticated using (true) with check (true);

drop policy if exists "auth_select_tp_motor_draft" on thermopack_motor_draft;
create policy "auth_select_tp_motor_draft"
  on thermopack_motor_draft for select to authenticated using (true);
