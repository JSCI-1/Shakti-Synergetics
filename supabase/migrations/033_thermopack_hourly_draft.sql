-- ════════════════════════════════════════════════════════════
-- MIGRATION 033 — Thermopack Hourly Draft (row-level hourly saving)
-- Run in: Supabase Dashboard → SQL Editor → New query
--
-- THERMOPACK-ONLY. Mirrors the Dryer pattern (migration 018) but is a
-- completely separate table. Each time a Thermopack operator clicks the
-- per-row Save button on an hourly row, that single hour is UPSERTED here
-- and its save moment is stamped server-side in `saved_at`. The full job
-- card (thermopack_job_cards) is still written by "Save Job Card"; when
-- that happens the previously-saved hourly rows are associated with the
-- new job card id (job_card_id) so the sync can group them.
--
-- NOTHING here alters dryer_hourly_draft, dryer_logs,
-- quality_control_records, motor_amp_status, thermopack_job_cards, or any
-- shared sync object. This is additive only.
--
-- Re-runnable: drop-if-exists guard on the Thermopack table only.
-- ════════════════════════════════════════════════════════════

drop table if exists thermopack_hourly_draft cascade;

create table thermopack_hourly_draft (
  id             uuid default gen_random_uuid() primary key,

  -- Set to the thermopack_job_cards.id once the job card is submitted.
  -- NULL while the row is a standalone saved hourly entry (not yet
  -- associated with a finalized job card). Orphaned (NULL) rows are NOT
  -- exported to Sheets (the trigger only enqueues rows with a job_card_id
  -- — see migration 034).
  job_card_id    uuid,

  variant        text not null,              -- '10L' | '6L'
  hour           text not null,              -- TIME_SLOT label, e.g. '7:30'

  -- Draft grouping key BEFORE a job card exists. The website writes a
  -- client-generated draft session id (stable for the life of one job
  -- card being filled) so per-row saves across the same card group
  -- together and can all be stamped with job_card_id at submit time.
  draft_key      text not null,

  -- All hourly field values for this hour, keyed exactly like a
  -- ThermpackJobCard row (emptyRow()):
  --   temp_in, temp_out, oil_press_in, oil_press_out, oil_press_level,
  --   temp_exhaust, feed_freq, bed_clean_start, bed_clean_stop,
  --   ash_clinker_wt, coil_clean_time
  -- NOTE: values->>'timestamp' is a DISPLAY-ONLY localized (en-IN)
  -- 12-hour hh:mm:ss string. The authoritative save moment is saved_at.
  values         jsonb,

  operator       text,

  -- Authoritative server-side save moment (captured at the website save,
  -- NOT at Sheets-sync time). Preserved across retries/replays.
  saved_at       timestamptz default now(),

  created_at     timestamptz default now(),
  updated_at     timestamptz default now(),

  -- One row per (draft_key, variant, hour): the per-row Save UPSERTS onto
  -- this key, so different hours never collide and re-saving the same hour
  -- is a single-row update (last write wins for that hour).
  unique (draft_key, variant, hour)
);


-- ── RLS ──────────────────────────────────────────────────────
-- The website uses the anon key (see src/supabaseClient.js), so anon
-- INSERT/UPDATE/SELECT are required. UPDATE is needed because the per-row
-- Save uses UPSERT (UPDATE on conflict). authenticated policies added for
-- parity with the rest of the schema.
alter table thermopack_hourly_draft enable row level security;

drop policy if exists "anon_insert_thermo_hourly" on thermopack_hourly_draft;
create policy "anon_insert_thermo_hourly"
  on thermopack_hourly_draft for insert to anon with check (true);

drop policy if exists "anon_update_thermo_hourly" on thermopack_hourly_draft;
create policy "anon_update_thermo_hourly"
  on thermopack_hourly_draft for update to anon using (true) with check (true);

drop policy if exists "anon_select_thermo_hourly" on thermopack_hourly_draft;
create policy "anon_select_thermo_hourly"
  on thermopack_hourly_draft for select to anon using (true);

drop policy if exists "authenticated_insert_thermo_hourly" on thermopack_hourly_draft;
create policy "authenticated_insert_thermo_hourly"
  on thermopack_hourly_draft for insert to authenticated with check (true);

drop policy if exists "authenticated_update_thermo_hourly" on thermopack_hourly_draft;
create policy "authenticated_update_thermo_hourly"
  on thermopack_hourly_draft for update to authenticated using (true) with check (true);

drop policy if exists "authenticated_select_thermo_hourly" on thermopack_hourly_draft;
create policy "authenticated_select_thermo_hourly"
  on thermopack_hourly_draft for select to authenticated using (true);


-- ── Associate saved hourly rows with a job card at submit time ──
-- Called by the website immediately after it inserts the job card. Stamps
-- job_card_id onto every saved hourly row for this draft_key that is not
-- yet associated, which makes them eligible for sync (migration 034) and
-- groups them under the correct job card. SECURITY DEFINER so the anon
-- role can run it without a direct UPDATE-by-filter grant beyond its RLS.
create or replace function thermopack_associate_hourly(
  p_draft_key   text,
  p_job_card_id uuid
) returns void
  language sql
  security definer
  set search_path = public, pg_temp
as $$
  update thermopack_hourly_draft
     set job_card_id = p_job_card_id,
         updated_at  = now()
   where draft_key = p_draft_key
     and job_card_id is null;
$$;
