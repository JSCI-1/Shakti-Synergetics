-- ════════════════════════════════════════════════════════════
-- MIGRATION 028 — Finished Goods live Wet/Dry Sieve readings → Sheets
-- Run in: Supabase Dashboard → SQL Editor → New query
-- APPLY ORDER: run AFTER 021 (needs sheets_sync_outbox) and 027.
--
-- GOAL: make each recorded Wet/Dry Sieve reading sync to the Finished Goods
-- Google Sheet AUTOMATICALLY (on the website's "Record" click), WITHOUT the
-- operator pressing Print/Download, while:
--   • keeping ONE logical sheet row per batch/grade/product/dryer,
--   • showing every reading (# / micron / result / status / time) stacked on
--     separate lines in the existing Wet Sieve / Dry Sieve cells,
--   • never duplicating a reading on retries/replays,
--   • using the website-recorded measurement time (never the upload time),
--   • staying fully SEPARATE from Production → Activity (qc_activity_draft)
--     and from the permanent quality_control_records save.
--
-- DESIGN: a dedicated, business-key-addressed snapshot table. The website
-- UPSERTs ONE row per (log_date, batch_no, product, grade, dryer, test) holding
-- the CURRENT full ordered list of that test's readings as a JSONB array. An
-- AFTER INSERT OR UPDATE trigger enqueues ONE sheets_sync_outbox event of a new
-- event_type 'sieve_readings' (record_kind 'qc_fg') whose payload carries the
-- business key + the readings array. The Apps Script matches the existing
-- Finished Goods row BY BUSINESS KEY and rebuilds that test's stacked cell from
-- the array (deterministic → idempotent → no duplicates).
--
-- WHY A SEPARATE TABLE (not qc_activity_draft, not quality_control_records):
--   • qc_activity_draft drives Production → Activity; writing sieve sync there
--     would resurface the data in that UI. This table is Sheets-only.
--   • quality_control_records is INSERT-per-save (new id each time) → it is the
--     wrong key for an upsert-by-batch live feed and is the ROOT CAUSE of the
--     duplicate-readings bug (each save = new source_pk = new sheet row that
--     re-renders the whole accumulated log). This table is keyed by business
--     identity and upserted, so a batch maps to exactly one sheet row/cell.
--
-- IDEMPOTENCY: the outbox event_id embeds a content fingerprint of the current
-- readings (count + last reading's time + concatenated results). An identical
-- re-sync produces the SAME event_id → `on conflict do nothing` dedups it; a
-- genuinely new/changed reading-set produces a NEW event_id → a fresh event.
-- No now() in the hash. Deleted readings are handled because the website writes
-- the FULL current list every time, so the rebuilt cell reflects deletions.
--
-- SAFETY: additive only. Does NOT touch quality_control_records, qc_activity_draft,
-- Raw Material, In-Process, Dryer, or their triggers. The trigger is
-- SECURITY DEFINER with a pinned search_path and an inner exception wrapper that
-- degrades any sync-side error to a WARNING and still returns NEW, so the
-- website write is never rolled back. Re-runnable (drop-if-exists guards).
-- ════════════════════════════════════════════════════════════

create table if not exists qc_fg_sieve_readings (
  id          uuid default gen_random_uuid() primary key,

  log_date    date not null,                 -- FG Manufactured Date
  batch_no    text,                           -- batch number (nullable, coalesced in key)
  product     text,                           -- FG product id (e.g. 'sulphur80wdg')
  grade       text not null,                  -- 'normal' | 'export' | 'omri' | 'colour'
  dryer       text not null,                  -- 'ND1' | 'ND2'
  test        text not null,                  -- 'fg_wetSieve' | 'fg_drySieve'

  -- CURRENT full ordered list of this test's readings. Each element:
  --   { reading_no, result, micron, status, iso_time }
  -- iso_time is the website-recorded measurement moment (ISO 8601), NEVER the
  -- sheet upload time. The website writes the WHOLE current list on every change
  -- (add OR delete), so this always reflects the live state.
  readings    jsonb not null default '[]'::jsonb,

  tested_by   text,
  updated_at  timestamptz default now(),

  -- One row per (date, batch, product, grade, dryer, test): the website UPSERTs
  -- onto this key. batch_no is coalesced to '' in the constraint via a unique
  -- index below (a NULL batch would otherwise break uniqueness).
  constraint qc_fg_sieve_readings_key
    unique (log_date, batch_no, product, grade, dryer, test)
);

-- RLS: the browser (anon + authenticated) may upsert/select its own live rows,
-- mirroring qc_activity_draft's posture. The sync path (trigger = SECURITY
-- DEFINER; Edge Functions = service role) bypasses RLS.
alter table qc_fg_sieve_readings enable row level security;

drop policy if exists "authenticated_insert_fg_sieve" on qc_fg_sieve_readings;
create policy "authenticated_insert_fg_sieve"
  on qc_fg_sieve_readings for insert to authenticated with check (true);

drop policy if exists "authenticated_update_fg_sieve" on qc_fg_sieve_readings;
create policy "authenticated_update_fg_sieve"
  on qc_fg_sieve_readings for update to authenticated using (true) with check (true);

drop policy if exists "authenticated_select_fg_sieve" on qc_fg_sieve_readings;
create policy "authenticated_select_fg_sieve"
  on qc_fg_sieve_readings for select to authenticated using (true);

drop policy if exists "anon_insert_fg_sieve" on qc_fg_sieve_readings;
create policy "anon_insert_fg_sieve"
  on qc_fg_sieve_readings for insert to anon with check (true);

drop policy if exists "anon_update_fg_sieve" on qc_fg_sieve_readings;
create policy "anon_update_fg_sieve"
  on qc_fg_sieve_readings for update to anon using (true) with check (true);

drop policy if exists "anon_select_fg_sieve" on qc_fg_sieve_readings;
create policy "anon_select_fg_sieve"
  on qc_fg_sieve_readings for select to anon using (true);


-- ── Trigger: enqueue a 'sieve_readings' outbox event on each change ──────────
create or replace function tg_sheets_sync_qc_fg_sieve_readings()
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
    -- UPSERTs for the same batch/test collapse onto the same sheet cell. The
    -- Apps Script also matches the FG row by this same business key.
    v_source_pk :=
         coalesce(NEW.log_date::text, '') || '|' ||
         coalesce(NEW.batch_no, '')       || '|' ||
         coalesce(NEW.product, '')        || '|' ||
         coalesce(NEW.grade, '')          || '|' ||
         coalesce(NEW.dryer, '')          || '|' ||
         coalesce(NEW.test, '');

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
      'test',     NEW.test,
      'readings', case when jsonb_typeof(NEW.readings) = 'array'
                       then NEW.readings else '[]'::jsonb end
    );

    insert into sheets_sync_outbox (
      event_id, source_table, source_pk, record_kind, event_type,
      record_ts, payload, routing_label, status
    ) values (
      md5('qc_fg_sieve_readings|' || v_source_pk || '|' || v_fingerprint),
      'qc_fg_sieve_readings', v_source_pk, 'qc_fg', 'sieve_readings',
      NEW.updated_at, v_payload,
      'Quality Control Records / qc_fg / Live Sieve Readings', 'pending'
    )
    on conflict (event_id) do nothing;

  exception when others then
    raise warning 'sheets_sync trigger %: %', TG_TABLE_NAME, sqlerrm;
  end;

  return NEW;
end;
$$;

drop trigger if exists trg_sheets_sync_qc_fg_sieve_readings on qc_fg_sieve_readings;
create trigger trg_sheets_sync_qc_fg_sieve_readings
  after insert or update on qc_fg_sieve_readings
  for each row execute function tg_sheets_sync_qc_fg_sieve_readings();
