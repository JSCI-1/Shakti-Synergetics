-- ════════════════════════════════════════════════════════════
-- MIGRATION 065 — let logged-in (authenticated) users SAVE and READ the
-- Batch Operator and Slurry Operator permanent tables.
-- Run in: Supabase Dashboard → SQL Editor → New query
--
-- SYMPTOM: saving fails with
--   "new row violates row-level security policy for table
--    process_job_cards / batch_traceability / slurry_consumption / …"
--
-- WHY: these tables were created with policies for the `anon` role only.
-- Logged-in users (OTP auth) run as `authenticated` and are blocked.
--   • process_job_cards (010), batch_traceability (011): 059 added SELECT for
--     `authenticated` but never INSERT.
--   • slurry_consumption (012): neither INSERT nor SELECT, so Save and the
--     history / previous-balance reads fail.
--   • slurry_operator_job_cards, slurry_operator_motor_amp (004): 051 added
--     INSERT + SELECT, but it is not re-runnable (no drop-if-exists) and may
--     never have been applied, so they are repeated here safely.
--
-- Adds INSERT + SELECT for `authenticated` on all five tables. The `anon`
-- policies are NOT touched. Additive and re-runnable (drop-if-exists + create),
-- so it is safe whether or not 051 / 059 were already applied.
-- ════════════════════════════════════════════════════════════

-- ── process_job_cards (Batch Operator → Process Job Card) ───
drop policy if exists "authenticated_insert_process_job_cards" on process_job_cards;
create policy "authenticated_insert_process_job_cards"
  on process_job_cards for insert to authenticated with check (true);

drop policy if exists "authenticated_select_process_job_cards" on process_job_cards;
create policy "authenticated_select_process_job_cards"
  on process_job_cards for select to authenticated using (true);

-- ── batch_traceability (Batch Operator → Batch Traceability Records) ──
drop policy if exists "authenticated_insert_batch_traceability" on batch_traceability;
create policy "authenticated_insert_batch_traceability"
  on batch_traceability for insert to authenticated with check (true);

drop policy if exists "authenticated_select_batch_traceability" on batch_traceability;
create policy "authenticated_select_batch_traceability"
  on batch_traceability for select to authenticated using (true);

-- ── slurry_consumption (Batch Operator → Slurry Consumption Report) ──
drop policy if exists "authenticated_insert_slurry_consumption" on slurry_consumption;
create policy "authenticated_insert_slurry_consumption"
  on slurry_consumption for insert to authenticated with check (true);

drop policy if exists "authenticated_select_slurry_consumption" on slurry_consumption;
create policy "authenticated_select_slurry_consumption"
  on slurry_consumption for select to authenticated using (true);

-- ── slurry_operator_job_cards (Slurry Operator → Sand Milling job card) ──
-- (same policy names as 051, so re-running replaces rather than duplicates)
drop policy if exists "authenticated_insert_slurry_operator_jc" on slurry_operator_job_cards;
create policy "authenticated_insert_slurry_operator_jc"
  on slurry_operator_job_cards for insert to authenticated with check (true);

drop policy if exists "authenticated_select_slurry_operator_jc" on slurry_operator_job_cards;
create policy "authenticated_select_slurry_operator_jc"
  on slurry_operator_job_cards for select to authenticated using (true);

-- ── slurry_operator_motor_amp (Slurry Operator → Running Motor Amp Status) ──
drop policy if exists "authenticated_insert_slurry_operator_motor" on slurry_operator_motor_amp;
create policy "authenticated_insert_slurry_operator_motor"
  on slurry_operator_motor_amp for insert to authenticated with check (true);

drop policy if exists "authenticated_select_slurry_operator_motor" on slurry_operator_motor_amp;
create policy "authenticated_select_slurry_operator_motor"
  on slurry_operator_motor_amp for select to authenticated using (true);
