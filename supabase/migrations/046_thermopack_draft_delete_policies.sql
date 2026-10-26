-- ════════════════════════════════════════════════════════════
-- MIGRATION 046 — DELETE policies for Thermopack working-draft tables
-- Run in: Supabase Dashboard → SQL Editor → New query
-- APPLY ORDER: after 033 / 043 / 044 / 045.
--
-- WHY: after clicking "Save Job Card" / "Save Motor Status", the website
-- deletes the SHARED working-draft rows so the submitted data is no longer
-- re-prefilled into the form (it then lives only in thermopack_job_cards /
-- motor_amp_status + the Google Sheet). But migrations 033/043/044/045 created
-- only INSERT/UPDATE/SELECT policies — NOT delete. Under RLS, a missing policy
-- means the delete is DENIED, so the draft rows survived and the just-saved
-- data kept reappearing (even in other browsers). This adds the missing DELETE
-- policies so the cleanup actually works.
--
-- THERMOPACK-ONLY and additive. Does NOT touch dryer/QC or any shared object.
-- Re-runnable: drop-if-exists before each create.
-- ════════════════════════════════════════════════════════════

-- thermopack_jobcard_draft
drop policy if exists "anon_delete_tp_jc_draft" on thermopack_jobcard_draft;
create policy "anon_delete_tp_jc_draft"
  on thermopack_jobcard_draft for delete to anon using (true);

drop policy if exists "auth_delete_tp_jc_draft" on thermopack_jobcard_draft;
create policy "auth_delete_tp_jc_draft"
  on thermopack_jobcard_draft for delete to authenticated using (true);

-- thermopack_motor_draft
drop policy if exists "anon_delete_tp_motor_draft" on thermopack_motor_draft;
create policy "anon_delete_tp_motor_draft"
  on thermopack_motor_draft for delete to anon using (true);

drop policy if exists "auth_delete_tp_motor_draft" on thermopack_motor_draft;
create policy "auth_delete_tp_motor_draft"
  on thermopack_motor_draft for delete to authenticated using (true);

-- thermopack_hourly_draft
drop policy if exists "anon_delete_thermo_hourly" on thermopack_hourly_draft;
create policy "anon_delete_thermo_hourly"
  on thermopack_hourly_draft for delete to anon using (true);

drop policy if exists "auth_delete_thermo_hourly" on thermopack_hourly_draft;
create policy "auth_delete_thermo_hourly"
  on thermopack_hourly_draft for delete to authenticated using (true);
