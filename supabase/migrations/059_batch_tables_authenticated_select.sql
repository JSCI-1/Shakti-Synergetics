-- ════════════════════════════════════════════════════════════
-- MIGRATION 059 — let logged-in (authenticated) users READ the Batch Operator
-- permanent tables.
-- Run in: Supabase Dashboard → SQL Editor → New query
--
-- WHY: process_job_cards (010) and batch_traceability (011) only had an ANON
-- select policy. Logged-in users (OTP auth) run as `authenticated` and could
-- not read them (same gap fixed for slurry_operator_* in 051). The admin
-- "pick a date → see what the operators saved" view reads these tables.
--
-- SELECT only. Additive and re-runnable. Insert policies are NOT touched.
-- ════════════════════════════════════════════════════════════

drop policy if exists "authenticated_select_process_job_cards" on process_job_cards;
create policy "authenticated_select_process_job_cards"
  on process_job_cards for select to authenticated using (true);

drop policy if exists "authenticated_select_batch_traceability" on batch_traceability;
create policy "authenticated_select_batch_traceability"
  on batch_traceability for select to authenticated using (true);
