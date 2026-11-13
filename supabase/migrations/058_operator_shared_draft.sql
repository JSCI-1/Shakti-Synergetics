-- ════════════════════════════════════════════════════════════
-- MIGRATION 058 — Shared working drafts for Batch Operator & Slurry Operator
-- Run in: Supabase Dashboard → SQL Editor → New query
-- APPLY ORDER: after 057 (independent of every other table).
--
-- WHY: Batch Operator (Process Job Card) and Slurry Operator (Sand Milling job
-- card + Running Motor Amp Status) used to keep their in-progress values only
-- in the browser (localStorage), so a second operator never saw what the
-- first operator had already entered. Dryer / Thermopack / QC already share
-- their working drafts through Supabase; this brings the same behaviour here.
--
-- WHAT: one small table holding a JSONB blob per (section, log_date).
--   section = 'batch_job_card' | 'batch_traceability' | 'slurry_consumption'
--           | 'slurry_mills' | 'slurry_motor'
--   log_date = the card/record date (Running Date for the motor form,
--              today's date for the Slurry Consumption report)
-- The website merges operators' edits into this blob (3-way merge on the
-- client), and DELETES the row when the permanent record is saved
-- ("Save Job Card" / "Save Motor Status").
--
-- WORKING DRAFT ONLY. The permanent records stay in process_job_cards,
-- slurry_operator_job_cards and slurry_operator_motor_amp. NO sheets-sync
-- trigger on this table. Additive; touches no existing object.
-- Re-runnable: drop-if-exists guard on this table only.
-- ════════════════════════════════════════════════════════════

drop table if exists operator_shared_draft cascade;

create table operator_shared_draft (
  id          uuid default gen_random_uuid() primary key,
  section     text not null,
  log_date    date not null,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz default now(),
  created_at  timestamptz default now(),
  unique (section, log_date)
);

alter table operator_shared_draft enable row level security;

drop policy if exists "anon_select_op_shared_draft" on operator_shared_draft;
create policy "anon_select_op_shared_draft"
  on operator_shared_draft for select to anon using (true);
drop policy if exists "anon_insert_op_shared_draft" on operator_shared_draft;
create policy "anon_insert_op_shared_draft"
  on operator_shared_draft for insert to anon with check (true);
drop policy if exists "anon_update_op_shared_draft" on operator_shared_draft;
create policy "anon_update_op_shared_draft"
  on operator_shared_draft for update to anon using (true) with check (true);
drop policy if exists "anon_delete_op_shared_draft" on operator_shared_draft;
create policy "anon_delete_op_shared_draft"
  on operator_shared_draft for delete to anon using (true);

drop policy if exists "auth_select_op_shared_draft" on operator_shared_draft;
create policy "auth_select_op_shared_draft"
  on operator_shared_draft for select to authenticated using (true);
drop policy if exists "auth_insert_op_shared_draft" on operator_shared_draft;
create policy "auth_insert_op_shared_draft"
  on operator_shared_draft for insert to authenticated with check (true);
drop policy if exists "auth_update_op_shared_draft" on operator_shared_draft;
create policy "auth_update_op_shared_draft"
  on operator_shared_draft for update to authenticated using (true) with check (true);
drop policy if exists "auth_delete_op_shared_draft" on operator_shared_draft;
create policy "auth_delete_op_shared_draft"
  on operator_shared_draft for delete to authenticated using (true);
