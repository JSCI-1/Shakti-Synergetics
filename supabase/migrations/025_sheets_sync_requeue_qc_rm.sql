-- ════════════════════════════════════════════════════════════
-- MIGRATION 025 — Re-queue Raw Material events ONLY
-- Run in: Supabase Dashboard → SQL Editor → New query
--
-- WHY: The Raw Material → Sheets column layout changed (one value column
-- per field, a single shared "Timestamp" column, correct Material label,
-- correct Supplier/Invoice mapping, no "(Updated)" columns). The RM outbox
-- events that would populate the corrected tab are already status='done',
-- so the pull Edge Function will not serve them again. This function flips
-- the RAW MATERIAL events (record_kind='qc_rm') back to 'pending' so the
-- unchanged sync worker re-writes them into the rebuilt "Raw Material" tab.
--
-- SCOPE / SAFETY:
--   • record_kind = 'qc_rm' ONLY. In-Process (qc_ip) and Finished Goods
--     (qc_fg) events are NEVER touched — this task is Raw Material only.
--   • Idempotent: re-running just re-queues the same RM rows; the Apps
--     Script upsert-by-source_pk makes a re-write an overwrite, not a dup.
--   • Clears locked_at / last_error / retry_count; synced_at reset to null.
--   • SECURITY DEFINER, pinned search_path — same posture as the other
--     sheets_sync_* functions. Browser cannot call it (outbox has no
--     browser RLS policy); only the SQL editor (owner) / service role can.
-- ════════════════════════════════════════════════════════════

create or replace function sheets_sync_requeue_qc_rm()
  returns integer
  language sql
  security definer
  set search_path = public, pg_temp
as $$
  with requeued as (
    update sheets_sync_outbox
       set status      = 'pending',
           locked_at   = null,
           synced_at   = null,
           last_error  = null,
           retry_count = 0
     where record_kind = 'qc_rm'
       and status in ('done', 'failed', 'in_progress')
    returning 1
  )
  select coalesce(count(*), 0)::int from requeued;
$$;

-- ── HOW TO RUN (once, AFTER running rebuildRawMaterialTab() in Apps Script) ──
--
--   select sheets_sync_requeue_qc_rm();
--
-- Returns the number of RM events re-queued. Within ~1 minute the existing
-- syncTick trigger re-writes them into the rebuilt "Raw Material" tab.
-- Safe to run again. Does NOT affect In-Process or Finished Goods.
--
-- ════════════════════════════════════════════════════════════
-- FORMATTING + TIMESTAMP TASK — NO FURTHER SQL REQUIRED
-- ════════════════════════════════════════════════════════════
-- The column auto-fit / wrapping / row-height formatting and the
-- "Timestamp" header rename + time-only (hh:mm:ss AM/PM, IST) format
-- are ENTIRELY Apps-Script changes (Code.gs). They need NO database
-- change, because the correct WEBSITE field-entry time is ALREADY
-- stored on each field_change event as `field_entry_ts` (set by the
-- quality_control_records trigger at the moment the website inserts the
-- record — NOT the sheet upload time). The Apps Script simply renders
-- field_entry_ts into the per-field "Timestamp" cell and never calls
-- new Date() for a field timestamp.
--
-- So for this task: run NOTHING new here. Only re-run
-- `select sheets_sync_requeue_qc_rm();` if you want EXISTING RM rows
-- re-written with the new formatting/timestamp layout. New submissions
-- pick it up automatically on the next syncTick.


-- ════════════════════════════════════════════════════════════
-- PER-FIELD ENTRY-TIME FIX (real per-field timestamps)
-- ════════════════════════════════════════════════════════════
-- PROBLEM: every Timestamp cell showed the SAME time. Root cause: the RM/IP/FG
-- form only writes to the DB ONCE (on Print/Download), so the trigger stamped
-- every field with the same now(). The true per-field entry time did not exist
-- in the data.
--
-- FIX (two parts):
--   • Website (QualityCheck.jsx): records the real clock time each field FIRST
--     becomes non-empty as the user types, and sends them on save inside
--     values.__ts  = { "<valueKey>": "<ISO timestamp>", ... }.
--   • This migration: redefines the QC trigger so field_entry_ts uses the
--     client-supplied values.__ts.<key> when present, falling back to now().
--
-- Re-running this block is safe (create or replace). It supersedes the copy in
-- migration 022 (identical function). Fields entered in the SAME save still
-- share a time only if they were genuinely entered together; fields typed at
-- different times now carry different times. Older rows (saved before the
-- website change) have no __ts and correctly keep their original now() stamp —
-- not fabricated.

create or replace function tg_sheets_sync_quality_control_records()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_allow_fg text[] := array[
    'fg_sulphur','fg_susp','fg_moisture','fg_bulk','fg_wetSieve','fg_drySieve',
    'fg_ph','fg_wettability','fg_foam_start','fg_foam_1min',
    'upl_exp_ps_10','upl_exp_ps_6','upl_exp_ps_1','upl_exp_ws_160','upl_exp_ws_25',
    'upl_exp_df_0','upl_exp_df_1','upl_exp_df_2','upl_exp_df_5','upl_exp_wps',
    'upl_exp_alk','upl_exp_disp',
    'upl_omri_ps_10','upl_omri_ps_6','upl_omri_ps_1','upl_omri_ds_500','upl_omri_ds_106',
    'upl_omri_disp_self','upl_omri_disp_1h','upl_omri_disp_24h','upl_omri_ws_160',
    'upl_omri_ws_25'
  ];
  v_allow_rm text[] := array[
    'sulphurPowder_purity','sulphurPowder_meshSize',
    'sulphurPowder_purity__M1','sulphurPowder_purity__M',
    'sulphurPowder_meshSize__m','sulphurPowder_meshSize__M',
    'ligno_ph','ligno_solubility',
    'ligno_moisture','clay_ph','clay_sed10','clay_sed30','clay_moisture',
    'dn_ph','dn_solubility','dn_moisture','dn_solid','coal_moisture',
    'mm_density','mm_diameter','mm_finish'
  ];
  v_allow_ip text[] := array[
    'ip_moisture_calc','ip_sulphur_calc','ip_susp_calc','ip_wetsieve_calc','ip_mill_rows'
  ];
  v_allow      text[];
  v_record_kind text;
  v_prev       quality_control_records%rowtype;
  v_has_prev   boolean := false;
  v_key        text;
  v_new        text;
  v_old        text;
  v_class      text;
  v_entry_ts   timestamptz;
  v_update_ts  timestamptz;
  v_field_entry_ts timestamptz;
  v_client_entry_ts timestamptz;
  v_field_path text;
  v_source_pk  text;
  v_record_ts  timestamptz;
  v_payload    jsonb;
begin
  begin
    v_source_pk := NEW.id::text;
    v_record_ts := NEW.created_at;

    if NEW.tab = 'fg' then
      v_record_kind := 'qc_fg'; v_allow := v_allow_fg;
    elsif NEW.tab = 'rm' then
      v_record_kind := 'qc_rm'; v_allow := v_allow_rm;
    elsif NEW.tab = 'ip' then
      v_record_kind := 'qc_ip'; v_allow := v_allow_ip;
    else
      return NEW;
    end if;

    select *
      into v_prev
      from quality_control_records q
     where q.tab = NEW.tab
       and q.id <> NEW.id
       and coalesce(q.values->>'dryer',    '') = coalesce(NEW.values->>'dryer',    '')
       and coalesce(q.values->>'batch_no', '') = coalesce(NEW.values->>'batch_no', '')
       and coalesce(q.values->>'date', q.date::text, '')
         = coalesce(NEW.values->>'date', NEW.date::text, '')
     order by q.created_at desc
     limit 1;
    v_has_prev := found;

    foreach v_key in array v_allow loop
      v_new := nullif(trim(NEW.values->>v_key), '');
      if v_has_prev then
        v_old := nullif(trim(coalesce(v_prev.values->>v_key, '')), '');
      else
        v_old := null;
      end if;

      v_class := null;
      if v_old is null and v_new is not null then
        v_class := 'entry';
      elsif v_old is not null and v_new is not null and v_new <> v_old then
        v_class := 'update';
      end if;

      if v_class is null then
        continue;
      end if;

      v_field_path := 'values.' || v_key;

      -- Client-supplied per-field entry time (real typing time from the website).
      v_client_entry_ts := null;
      begin
        if (NEW.values ? '__ts') and (NEW.values->'__ts' ? v_key) then
          v_client_entry_ts := (NEW.values->'__ts'->>v_key)::timestamptz;
        end if;
      exception when others then
        v_client_entry_ts := null;
      end;

      if v_class = 'entry' then
        v_entry_ts  := coalesce(v_client_entry_ts, now());
        v_update_ts := null;
      else
        v_update_ts := now();
        select o.field_entry_ts
          into v_field_entry_ts
          from sheets_sync_outbox o
         where o.source_table = TG_TABLE_NAME
           and o.source_pk    = v_source_pk
           and o.field_path   = v_field_path
           and o.change_class = 'entry'
         order by o.id
         limit 1;
        v_field_entry_ts := coalesce(v_field_entry_ts, v_client_entry_ts);
        v_entry_ts := v_field_entry_ts;
      end if;

      insert into sheets_sync_outbox (
        event_id, source_table, source_pk, record_kind, event_type,
        field_path, old_value, new_value, change_class,
        field_entry_ts, field_update_ts, record_ts, routing_label, status
      ) values (
        md5(TG_TABLE_NAME || '|' || v_source_pk || '|' || v_field_path || '|'
            || v_class || '|' || coalesce(v_old, '∅') || '|'
            || coalesce(v_new, '∅') || '|'
            || extract(epoch from v_record_ts)::text),
        TG_TABLE_NAME, v_source_pk, v_record_kind, 'field_change',
        v_field_path, v_old, v_new, v_class,
        v_entry_ts, v_update_ts, v_record_ts,
        'Quality Control Records / ' || v_record_kind || ' / Field Change History',
        'pending'
      )
      on conflict (event_id) do nothing;
    end loop;

    v_payload := jsonb_build_object(
      'values',               coalesce(NEW.values, '{}'::jsonb),
      'tab',                  NEW.tab,
      'date',                 coalesce(NEW.values->>'date', NEW.date::text),
      'tested_by',            NEW.tested_by,
      'final_submission_ts',  NEW.created_at
    );

    insert into sheets_sync_outbox (
      event_id, source_table, source_pk, record_kind, event_type,
      record_ts, payload, routing_label, status
    ) values (
      md5(TG_TABLE_NAME || '|' || v_source_pk || '|' || 'snapshot'),
      TG_TABLE_NAME, v_source_pk, v_record_kind, 'current_snapshot',
      NEW.created_at, v_payload,
      'Quality Control Records / ' || v_record_kind || ' / Current Records',
      'pending'
    )
    on conflict (event_id) do nothing;

  exception when others then
    raise warning 'sheets_sync trigger %: %', TG_TABLE_NAME, sqlerrm;
  end;

  return NEW;
end;
$$;

drop trigger if exists trg_sheets_sync_quality_control_records on quality_control_records;
create trigger trg_sheets_sync_quality_control_records
  after insert on quality_control_records
  for each row execute function tg_sheets_sync_quality_control_records();
