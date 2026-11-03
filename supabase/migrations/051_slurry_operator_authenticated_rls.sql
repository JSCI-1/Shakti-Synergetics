-- ════════════════════════════════════════════════════════════
-- MIGRATION 051 — Fix RLS for slurry_operator tables
--
-- The existing policies only cover the 'anon' role. Logged-in
-- users (OTP auth) use the 'authenticated' role and were blocked.
-- This adds INSERT + SELECT policies for 'authenticated' on both
-- slurry_operator_job_cards and slurry_operator_motor_amp.
-- ════════════════════════════════════════════════════════════

-- ── slurry_operator_job_cards ────────────────────────────────

create policy "authenticated_insert_slurry_operator_jc"
on slurry_operator_job_cards
for insert
to authenticated
with check (true);

create policy "authenticated_select_slurry_operator_jc"
on slurry_operator_job_cards
for select
to authenticated
using (true);

-- ── slurry_operator_motor_amp ────────────────────────────────

create policy "authenticated_insert_slurry_operator_motor"
on slurry_operator_motor_amp
for insert
to authenticated
with check (true);

create policy "authenticated_select_slurry_operator_motor"
on slurry_operator_motor_amp
for select
to authenticated
using (true);
