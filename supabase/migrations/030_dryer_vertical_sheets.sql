-- ════════════════════════════════════════════════════════════
-- MIGRATION 030 — Dryer → Google Sheets horizontal layout (New/Old Dryer)
-- Run in: Supabase Dashboard → SQL Editor → New query
-- APPLY ORDER: run AFTER 003 (dryer_logs), 018 (dryer_hourly_draft),
--              021 (sheets_sync_outbox), 022 (existing triggers).
--
-- GOAL: feed the two Google Sheet tabs — "New Dryer" and "Old Dryer" — with a
-- HORIZONTAL, website-matching layout:
--   • Hourly log table: ONE ROW PER HOUR, a column per field (exact website
--     labels), each cell holding the value with its own timestamp on the next
--     line (so no separate timestamp columns).
--   • Bottom form + calibration: a HORIZONTAL block below, one header row of the
--     field labels + one data row, same value+timestamp-in-cell style.
-- Each field keeps its OWN entry/change timestamp (IST), exactly like QC.
--
-- ROW-LEVEL EVENTS (performance + completeness): to avoid hundreds of slow
-- per-cell Sheets writes (which were slow and dropped some fields), each SAVE
-- emits ONE outbox event carrying the WHOLE row's fields + each field's time:
--   • dryer_hourly_draft save → one 'dryer_hour' event  (all hourly fields+ts)
--   • dryer_logs "Save Log Sheet" → one 'dryer_form' event (all bottom+cal+ts)
-- The Apps Script writes each row in a SINGLE setValues() call → fast, atomic,
-- nothing dropped.
--
-- IDEMPOTENCY: event_id embeds a content fingerprint of the whole row (values +
-- times), so an identical re-sync dedups via `on conflict (event_id) do
-- nothing`; any genuine change makes a fresh event. Row identity in the sheet
-- is (dryer_type, date, shift, hour) for hourly and (dryer_type, date, shift)
-- for the bottom form → re-saving UPDATES the row, never a duplicate.
--
-- SAFETY: additive. Adds dryer_logs.field_ts (jsonb). Drops ONLY the old Dryer
-- triggers from 022; the QC trigger is untouched. Every function is SECURITY
-- DEFINER + pinned search_path + inner exception wrapper + unconditional
-- return NEW, so a sync error never rolls back an operator's save. Re-runnable.
-- ════════════════════════════════════════════════════════════

alter table dryer_logs
  add column if not exists field_ts jsonb;

-- Stop the OLD wide-tab Dryer events (QC trigger in 022 is left intact). Also
-- drop any field-level dryer_v2 triggers from an earlier version of this file.
drop trigger if exists trg_sheets_sync_dryer_hourly_draft on dryer_hourly_draft;
drop trigger if exists trg_sheets_sync_dryer_logs on dryer_logs;
drop trigger if exists trg_dryer_v2_hourly on dryer_hourly_draft;
drop trigger if exists trg_dryer_v2_logs on dryer_logs;


-- ── (a) dryer_hourly_draft → ONE 'dryer_hour' event per saved hour ────────────
create or replace function tg_dryer_v2_hourly()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_keys text[] := array[
    'temp_inlet','temp_outlet','temp_actual','temp_fbd1','temp_fbd2','temp_chamber',
    'atomizer_freq','feed_fc','c_pressure','pressure','pt_temp','batch_no','bags_per_hr',
    'bag_size_wt','kg_per_hr','colour','id_frequency','remarks','operator_name','maintenance'
  ];
  v_k        text;
  v_vals     jsonb := '{}'::jsonb;
  v_ts       jsonb := '{}'::jsonb;
  v_fp       text := '';
  v_src_pk   text;
  v_any      boolean := false;
  v_tsobj    jsonb;
begin
  begin
    v_tsobj := case when jsonb_typeof(NEW.values->'__ts') = 'object'
                    then NEW.values->'__ts' else '{}'::jsonb end;

    foreach v_k in array v_keys loop
      -- 'maintenance' is a JSONB OBJECT ({shifter_screen, atomizer_water}), not
      -- a scalar. Carry the whole object through (when any option is selected)
      -- so the Apps Script can render the selected options + their own times.
      if v_k = 'maintenance' then
        if jsonb_typeof(NEW.values->'maintenance') = 'object'
           and (coalesce(NEW.values->'maintenance'->>'shifter_screen','') <> ''
                or coalesce(NEW.values->'maintenance'->>'atomizer_water','') <> '') then
          v_vals := v_vals || jsonb_build_object('maintenance', NEW.values->'maintenance');
          v_fp   := v_fp || 'maintenance=' || (NEW.values->'maintenance')::text || ';';
          v_any  := true;
        end if;
        continue;
      end if;
      if nullif(trim(coalesce(NEW.values->>v_k, '')), '') is not null then
        v_vals := v_vals || jsonb_build_object(v_k, NEW.values->>v_k);
        v_ts   := v_ts   || jsonb_build_object(v_k, coalesce(v_tsobj->>v_k, ''));
        v_fp   := v_fp || v_k || '=' || (NEW.values->>v_k) || '@' || coalesce(v_tsobj->>v_k, '') || ';';
        v_any  := true;
      end if;
    end loop;

    if not v_any then return NEW; end if;   -- nothing to sync for this hour

    v_src_pk := NEW.dryer_type || '|' || NEW.log_date::text || '|'
             || coalesce(NEW.shift, '') || '|' || NEW.hour;

    insert into sheets_sync_outbox (
      event_id, source_table, source_pk, record_kind, event_type,
      record_ts, payload, routing_label, status
    ) values (
      md5('dryer_hour|' || v_src_pk || '|' || md5(v_fp)),
      'dryer_hourly_draft', v_src_pk, 'dryer_v2', 'dryer_hour',
      NEW.last_saved_at,
      jsonb_build_object(
        'dryer_type', NEW.dryer_type,
        'date',       NEW.log_date::text,
        'shift',      NEW.shift,
        'hour',       NEW.hour,
        'values',     v_vals,
        'ts',         v_ts
      ),
      'Dryer / ' || NEW.dryer_type || ' / Hourly', 'pending'
    )
    on conflict (event_id) do nothing;
  exception when others then
    raise warning 'dryer_v2 hourly trigger: %', sqlerrm;
  end;
  return NEW;
end;
$$;

drop trigger if exists trg_dryer_v2_hourly on dryer_hourly_draft;
create trigger trg_dryer_v2_hourly
  after insert or update on dryer_hourly_draft
  for each row execute function tg_dryer_v2_hourly();


-- ── (b) dryer_logs → ONE 'dryer_form' event per "Save Log Sheet" ──────────────
create or replace function tg_dryer_v2_logs()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_vals     jsonb := '{}'::jsonb;
  v_ts       jsonb := '{}'::jsonb;
  v_fp       text := '';
  v_src_pk   text;
  v_fts      jsonb;
  v_cal      jsonb;
  v_sensors  text[] := array['inlet','outlet','ifbd','fbd','chamber'];
  v_s        text;
  v_sub      text;
  v_subs     text[] := array['temp','sensor'];
  v_val      text;
  v_key      text;
begin
  begin
    v_fts := case when jsonb_typeof(NEW.field_ts) = 'object' then NEW.field_ts else '{}'::jsonb end;
    v_cal := coalesce(NEW.calibration_sensors, '{}'::jsonb);

    -- Scalar bottom-form fields: key → value (read from the typed columns).
    -- Keys mirror the website field keys so the Apps Script can label them.
    -- (chamber_* hold the website's IFBD DP/MR.)
    -- Build (vals, ts, fp) for each non-empty field.
    -- id_blower / fd_blower / ifbd(=chamber) / fbd_pct DP+MR, batch, cal due,
    -- total production, incharge, operator.
    -- Inline add:
    --   value from the column, time from field_ts.<key>
    -- We expand manually (plpgsql has no closures).
    -- id_blower_dp
    for v_key, v_val in
      select * from (values
        ('id_blower_dp',    NEW.id_blower_dp),
        ('id_blower_mr',    NEW.id_blower_mr),
        ('fd_blower_dp',    NEW.fd_blower_dp),
        ('fd_blower_mr',    NEW.fd_blower_mr),
        ('chamber_dp',      NEW.chamber_dp),
        ('chamber_mr',      NEW.chamber_mr),
        ('fbd_pct_dp',      NEW.fbd_pct_dp),
        ('fbd_pct_mr',      NEW.fbd_pct_mr),
        ('batch_no',        NEW.batch_no),
        ('calibration_due', NEW.calibration_due::text),
        ('total_production',NEW.total_production::text),
        ('incharge',        NEW.incharge),
        ('operator',        NEW.operator)
      ) as t(k, v)
    loop
      if nullif(trim(coalesce(v_val, '')), '') is not null then
        v_vals := v_vals || jsonb_build_object(v_key, v_val);
        v_ts   := v_ts   || jsonb_build_object(v_key, coalesce(v_fts->>v_key, ''));
        v_fp   := v_fp || v_key || '=' || v_val || '@' || coalesce(v_fts->>v_key, '') || ';';
      end if;
    end loop;

    -- Calibration cells: cal_<sensor>_<temp|sensor>.
    foreach v_s in array v_sensors loop
      foreach v_sub in array v_subs loop
        v_val := nullif(trim(coalesce(v_cal->v_s->>v_sub, '')), '');
        if v_val is not null then
          v_key := 'cal_' || v_s || '_' || v_sub;
          v_vals := v_vals || jsonb_build_object(v_key, v_val);
          v_ts   := v_ts   || jsonb_build_object(v_key, coalesce(v_fts->>v_key, ''));
          v_fp   := v_fp || v_key || '=' || v_val || '@' || coalesce(v_fts->>v_key, '') || ';';
        end if;
      end loop;
    end loop;

    if v_vals = '{}'::jsonb then return NEW; end if;

    v_src_pk := NEW.dryer_type || '|' || coalesce(NEW.date::text, '') || '|'
             || coalesce(NEW.shift, '') || '|form';

    insert into sheets_sync_outbox (
      event_id, source_table, source_pk, record_kind, event_type,
      record_ts, payload, routing_label, status
    ) values (
      md5('dryer_form|' || v_src_pk || '|' || md5(v_fp)),
      'dryer_logs', v_src_pk, 'dryer_v2', 'dryer_form',
      NEW.created_at,
      jsonb_build_object(
        'dryer_type', NEW.dryer_type,
        'date',       NEW.date::text,
        'shift',      NEW.shift,
        'values',     v_vals,
        'ts',         v_ts
      ),
      'Dryer / ' || NEW.dryer_type || ' / Form', 'pending'
    )
    on conflict (event_id) do nothing;
  exception when others then
    raise warning 'dryer_v2 logs trigger: %', sqlerrm;
  end;
  return NEW;
end;
$$;

drop trigger if exists trg_dryer_v2_logs on dryer_logs;
create trigger trg_dryer_v2_logs
  after insert on dryer_logs
  for each row execute function tg_dryer_v2_logs();


-- ── Re-queue helper (optional replay into the new tabs) ───────────────────────
create or replace function sheets_sync_requeue_dryer_v2()
  returns integer
  language sql
  security definer
  set search_path = public, pg_temp
as $$
  with requeued as (
    update sheets_sync_outbox
       set status = 'pending', locked_at = null, synced_at = null,
           last_error = null, retry_count = 0
     where record_kind = 'dryer_v2'
       and status in ('done','failed','in_progress')
    returning 1
  )
  select coalesce(count(*),0)::int from requeued;
$$;
