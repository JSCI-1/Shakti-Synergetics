-- ════════════════════════════════════════════════════════════
-- MIGRATION 044 — Thermopack Job Card HEADER draft (shift handover)
-- Run in: Supabase Dashboard → SQL Editor → New query
-- APPLY ORDER: after 001 / 033 / 043.
--
-- WHY: shift handover. Operator 1 fills the job card header (operator,
-- helpers, time in/out, stock, fuel, summary, remarks) and some hourly rows,
-- but his shift ends BEFORE he clicks "Save Job Card". Operator 2 (next shift)
-- then selects the SAME date + variant and must see everything operator 1
-- already entered — including the header, which until now lived only in
-- operator 1's browser (localStorage) and so was never shared.
--
-- WHAT: a small SHARED draft table keyed by (log_date, variant) that holds the
-- header fields as a JSONB blob. The website auto-UPSERTS it as operator 1
-- works (e.g. on each hourly-row Save), and operator 2's form prefills from it.
-- This is a WORKING DRAFT, not the permanent record — the permanent job card is
-- still thermopack_job_cards, written by "Save Job Card".
--
-- THERMOPACK-ONLY and additive. Does NOT touch dryer/QC or any shared object.
--
-- Re-runnable: drop-if-exists guard on this Thermopack table only.
-- ════════════════════════════════════════════════════════════

drop table if exists thermopack_jobcard_draft cascade;

create table thermopack_jobcard_draft (
  id          uuid default gen_random_uuid() primary key,

  log_date    date not null,          -- the job card date (form.date)
  variant     text not null,          -- '10L' | '6L'

  -- The header fields as the operator typed them. Shape mirrors the website
  -- form header (operator, helper1..3, shift, time_in, time_out, coal_*,
  -- bugass_*, coal_charged, bugass_charged, diesel_charged, summary_10l,
  -- summary_6l, remarks, field_ts). Stored as one blob so new header fields
  -- never need a schema change.
  header      jsonb not null default '{}'::jsonb,

  updated_at  timestamptz default now(),
  created_at  timestamptz default now(),

  -- One shared draft per (date, variant): the auto-save UPSERTS onto this key,
  -- so all operators on the same date+variant converge on one header draft.
  unique (log_date, variant)
);


-- ── RLS ──────────────────────────────────────────────────────
-- Website uses the anon key; logged-in users run as authenticated. Both need
-- INSERT/UPDATE (UPSERT) + SELECT.
alter table thermopack_jobcard_draft enable row level security;

drop policy if exists "anon_insert_tp_jc_draft" on thermopack_jobcard_draft;
create policy "anon_insert_tp_jc_draft"
  on thermopack_jobcard_draft for insert to anon with check (true);

drop policy if exists "anon_update_tp_jc_draft" on thermopack_jobcard_draft;
create policy "anon_update_tp_jc_draft"
  on thermopack_jobcard_draft for update to anon using (true) with check (true);

drop policy if exists "anon_select_tp_jc_draft" on thermopack_jobcard_draft;
create policy "anon_select_tp_jc_draft"
  on thermopack_jobcard_draft for select to anon using (true);

drop policy if exists "auth_insert_tp_jc_draft" on thermopack_jobcard_draft;
create policy "auth_insert_tp_jc_draft"
  on thermopack_jobcard_draft for insert to authenticated with check (true);

drop policy if exists "auth_update_tp_jc_draft" on thermopack_jobcard_draft;
create policy "auth_update_tp_jc_draft"
  on thermopack_jobcard_draft for update to authenticated using (true) with check (true);

drop policy if exists "auth_select_tp_jc_draft" on thermopack_jobcard_draft;
create policy "auth_select_tp_jc_draft"
  on thermopack_jobcard_draft for select to authenticated using (true);

-- NOTE: NO sync trigger on this table. It is a working draft only; it is NOT
-- exported to Google Sheets. The sheet is still fed by thermopack_job_cards
-- (Save Job Card) and thermopack_hourly_draft (per-row Save).
