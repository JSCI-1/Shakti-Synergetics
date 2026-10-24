-- ════════════════════════════════════════════════════════════
-- MIGRATION 038 — Finished Goods live MOISTURE readings → Sheets
-- Run in: Supabase Dashboard → SQL Editor → New query
-- APPLY ORDER: run AFTER 021 (needs sheets_sync_outbox) and 028.
--
-- GOAL: Moisture Content on the Finished Goods tab is now measured SEVERAL
-- times per batch — exactly like Wet/Dry Sieve (migration 028). Each recorded
-- Moisture reading must sync to the Finished Goods Google Sheet AUTOMATICALLY
-- (on the website's "Record" click), WITHOUT the operator pressing
-- Print/Download, while:
--   • keeping ONE logical sheet row per batch/grade/product/dryer,
--   • stacking every reading (# / result / time) on separate lines in the
--     existing single "Moisture Content" cell,
--   • never duplicating a reading on retries/replays,
--   • using the website-recorded measurement time (never the upload time),
--   • staying fully SEPARATE from Production → Activity (qc_activity_draft)
--     and from the permanent quality_control_records save.
--
-- This is a direct parallel of migration 028 (qc_fg_sieve_readings) for the
-- Moisture test, which has no micron/status and feeds no UPL parameter — so the
-- readings array is just { reading_no, result, iso_time }.
--
-- SAFETY: additive only. Does NOT touch quality_control_records,
-- qc_activity_draft, qc_fg_sieve_readings, Raw Material, In-Process, Dryer, or
-- their triggers. The trigger is SECURITY DEFINER with a pinned search_path and
-- an inner exception wrapper that degrades any sync-side error to a WARNING and
-- still returns NEW, so the website write is never rolled back. Re-runnable
-- (drop-if-exists guards).
-- ════════════════════════════════════════════════════════════

create table if not exists qc_fg_moisture_readings (
  id          uuid default gen_random_uuid() primary key,

  log_date    date not null,                 -- FG Manufactured Date
  batch_no    text,                           -- batch number (nullable, coalesced in key)
  product     text,                           -- FG product id (e.g. 'sulphur80wdg')
  grade       text not null,                  -- 'normal' | 'export' | 'omri' | 'colour'
  dryer       text not null,                  -- 'ND1' | 'ND2'

  -- CURRENT full ordered list of this batch's moisture readings. Each element:
  --   { reading_no, result, iso_time }
  -- iso_time is the website-recorded measurement moment (ISO 8601), NEVER the
  -- sheet upload time. The website writes the WHOLE current list on every change
  -- (add OR delete), so this always reflects the live state.
  readings    jsonb not null default '[]'::jsonb,

  tested_by   text,
  updated_at  timestamptz default now(),

  -- One row per (date, batch, product, grade, dryer): the website UPSERTs onto
  -- this key. NOTE: unlike the sieve table there is NO `test` column — Moisture
  -- is a single test, so each batch/grade/dryer has exactly one moisture list.
  constraint qc_fg_moisture_readings_key
    unique (log_date, batch_no, product, grade, dryer)
);

-- RLS: the browser (anon + authenticated) may upsert/select its own live rows,
-- mirroring qc_fg_sieve_readings. The sync path (trigger = SECURITY DEFINER;
-- Edge Functions = service role) bypasses RLS.
alter table qc_fg_moisture_readings enable row level security;

drop policy if exists "authenticated_insert_fg_moisture" on qc_fg_moisture_readings;
create policy "authenticated_insert_fg_moisture"
  on qc_fg_moisture_readings for insert to authenticated with check (true);

drop policy if exists "authenticated_update_fg_moisture" on qc_fg_moisture_readings;
create policy "authenticated_update_fg_moisture"
  on qc_fg_moisture_readings for update to authenticated using (true) with check (true);

drop policy if exists "authenticated_select_fg_moisture" on qc_fg_moisture_readings;
create policy "authenticated_select_fg_moisture"
  on qc_fg_moisture_readings for select to authenticated using (true);

drop policy if exists "anon_insert_fg_moisture" on qc_fg_moisture_readings;
create policy "anon_insert_fg_moisture"
  on qc_fg_moisture_readings for insert to anon with check (true);

drop policy if exists "anon_update_fg_moisture" on qc_fg_moisture_readings;
create policy "anon_update_fg_moisture"
  on qc_fg_moisture_readings for update to anon using (true) with check (true);

drop policy if exists "anon_select_fg_moisture" on qc_fg_moisture_readings;
create policy "anon_select_fg_moisture"
  on qc_fg_moisture_readings for select to anon using (true);


-- ── Trigger: enqueue a 'moisture_readings' outbox event on each change ───────
create or replace function tg_sheets_sync_qc_fg_moisture_readings()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_source_pk   text;
  v_payload     jsonb;
  v_fingerprint text;
  v_count       int;
  v_results     text;
  v_last_time   text;
begin
  begin
    -- source_pk is the business identity (NOT the row id), so retries / separate
    -- UPSERTs for the same batch collapse onto the same sheet cell. The Apps
    -- Script also matches the FG row by this same business key. Note the trailing
    -- '|' with no test segment keeps the shape distinct from the sieve source_pk.
    v_source_pk :=
         coalesce(NEW.log_date::text, '') || '|' ||
         coalesce(NEW.batch_no, '')       || '|' ||
         coalesce(NEW.product, '')        || '|' ||
         coalesce(NEW.grade, '')          || '|' ||
         coalesce(NEW.dryer, '')          || '|moisture';

    -- Content fingerprint of the CURRENT readings so the event_id changes only
    -- when the reading-set genuinely changes (add/edit/delete), and an identical
    -- re-sync dedups via `on conflict (event_id) do nothing`. No now() used.
    select count(*),
           string_agg(coalesce(r->>'result', ''),  ',' order by (r->>'reading_no')::int),
           max(coalesce(r->>'iso_time', ''))
      into v_count, v_results, v_last_time
      from jsonb_array_elements(
             case when jsonb_typeof(NEW.readings) = 'array'
                  then NEW.readings else '[]'::jsonb end
           ) as r;

    v_fingerprint := coalesce(v_count::text, '0') || '|' ||
                     coalesce(v_results, '')      || '|' ||
                     coalesce(v_last_time, '');

    v_payload := jsonb_build_object(
      'biz', jsonb_build_object(
        'date',     NEW.log_date::text,
        'batch_no', NEW.batch_no,
        'product',  NEW.product,
        'grade',    NEW.grade,
        'dryer',    NEW.dryer
      ),
      'readings', case when jsonb_typeof(NEW.readings) = 'array'
                       then NEW.readings else '[]'::jsonb end
    );

    insert into sheets_sync_outbox (
      event_id, source_table, source_pk, record_kind, event_type,
      record_ts, payload, routing_label, status
    ) values (
      md5('qc_fg_moisture_readings|' || v_source_pk || '|' || v_fingerprint),
      'qc_fg_moisture_readings', v_source_pk, 'qc_fg', 'moisture_readings',
      NEW.updated_at, v_payload,
      'Quality Control Records / qc_fg / Live Moisture Readings', 'pending'
    )
    on conflict (event_id) do nothing;

  exception when others then
    raise warning 'sheets_sync trigger %: %', TG_TABLE_NAME, sqlerrm;
  end;

  return NEW;
end;
$$;

drop trigger if exists trg_sheets_sync_qc_fg_moisture_readings on qc_fg_moisture_readings;
create trigger trg_sheets_sync_qc_fg_moisture_readings
  after insert or update on qc_fg_moisture_readings
  for each row execute function tg_sheets_sync_qc_fg_moisture_readings();
