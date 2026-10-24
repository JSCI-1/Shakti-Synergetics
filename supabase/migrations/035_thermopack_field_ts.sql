-- ════════════════════════════════════════════════════════════
-- MIGRATION 035 — Thermopack Job Card: per-field timestamps +
--                 Total fuel Consumption column
-- Run in: Supabase Dashboard → SQL Editor → New query
-- APPLY ORDER: after 001 and 034.
--
-- THERMOPACK-ONLY and ADDITIVE. It:
--   1. Adds two columns to thermopack_job_cards:
--        field_ts                jsonb   — { '<fieldKey>': '<iso entry/update time>' }
--        total_fuel_consumption  numeric — the "Total fuel Consumption" value
--      (both nullable; existing rows keep their data, nothing is dropped).
--   2. Replaces ONLY the Thermopack job-card trigger function
--      (tg_thermo_sync_job_cards) so the snapshot payload now carries
--      field_ts + total_fuel_consumption, and so an EDIT carries forward the
--      unchanged fields' original timestamps (only changed fields get a new
--      time — the website supplies that logic; the DB just preserves what it
--      is given and never fabricates a time).
--
-- It does NOT touch dryer/QC triggers, the shared sheets_sync_outbox, or any
-- other table. The hourly/motor triggers are unchanged.
-- ════════════════════════════════════════════════════════════

-- 1. Additive columns (idempotent).
alter table thermopack_job_cards
  add column if not exists field_ts jsonb;

alter table thermopack_job_cards
  add column if not exists total_fuel_consumption numeric;


-- 2. Replace the job-card trigger function to include the new keys.
--    (create or replace keeps the existing trigger binding from migration 034.)
create or replace function tg_thermo_sync_job_cards()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_source_pk text;
  v_payload   jsonb;
begin
  begin
    v_source_pk := NEW.id::text;

    v_payload := jsonb_build_object(
      'job_card_id',       NEW.id,
      'date',              NEW.date,
      'shift',             NEW.shift,
      'operator',          NEW.operator,
      'helper1',           NEW.helper1,
      'helper2',           NEW.helper2,
      'helper3',           NEW.helper3,
      'time_in',           NEW.time_in,
      'time_out',          NEW.time_out,
      'coal_date',         NEW.coal_date,
      'coal_qty',          NEW.coal_qty,
      'bugass_date',       NEW.bugass_date,
      'bugass_qty',        NEW.bugass_qty,
      'coal_charged',      NEW.coal_charged,
      'bugass_charged',    NEW.bugass_charged,
      'diesel_charged',    NEW.diesel_charged,
      'total_fuel_consumption', NEW.total_fuel_consumption,
      'log_variant',       NEW.log_variant,
      'summary_10l',       NEW.summary_10l,
      'summary_6l',        NEW.summary_6l,
      'total_clinker_wt',  NEW.total_clinker_wt,
      'remarks',           NEW.remarks,
      -- Per-field entry/update timestamps captured on the website. The Apps
      -- Script renders each field's own time from this map; a missing key is
      -- shown blank (never the upload time).
      'field_ts',          coalesce(NEW.field_ts, '{}'::jsonb),
      'final_submission_ts', NEW.created_at
    );

    insert into thermopack_sheets_sync_outbox (
      event_id, source_table, source_pk, record_kind, event_type,
      record_ts, payload, status
    ) values (
      md5(TG_TABLE_NAME || '|' || v_source_pk || '|' || 'snapshot'),
      TG_TABLE_NAME, v_source_pk, 'thermo_jobcard', 'current_snapshot',
      NEW.created_at, v_payload, 'pending'
    )
    on conflict (event_id) do nothing;

  exception when others then
    raise warning 'thermopack_sync trigger %: %', TG_TABLE_NAME, sqlerrm;
  end;

  return NEW;
end;
$$;
