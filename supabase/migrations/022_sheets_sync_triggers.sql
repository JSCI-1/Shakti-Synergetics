-- ════════════════════════════════════════════════════════════
-- MIGRATION 022 — Sheets Sync Triggers (SECURITY DEFINER, observe-only)
-- Run in: Supabase Dashboard → SQL Editor → New query
-- APPLY ORDER: run 022 strictly AFTER 021. The trigger functions
--              `insert into sheets_sync_outbox` (created in 021).
--              If 021 is missing, each function's `exception when
--              others` handler degrades the error to a WARNING and
--              still `return NEW;`, so an operator's save is NEVER
--              rolled back — but the correct order is 021 → 022.
--
-- AFTER triggers that OBSERVE the four in-scope data tables and
-- enqueue sheets_sync_outbox rows. They never modify the base row,
-- never touch any "finalized" flag, and never block/fail a save.
--
-- CRITICAL INVARIANT (design §10): every function is
--   language plpgsql  /  security definer
--   set search_path = public, pg_temp   (pinned — no privilege-escalation footgun)
-- with an inner `begin … exception when others then raise warning … end`
-- wrapper and an UNCONDITIONAL `return NEW;` reached on BOTH the normal
-- and the exception path. A sync-side error can therefore NEVER roll
-- back the operator's base write.
--
-- IDEMPOTENCY (design §4): every outbox insert uses
--   `on conflict (event_id) do nothing`.
--   field_change event_id = md5(source_table|source_pk|field_path|
--                               change_class|old|new|epoch(record_ts))
--   snapshot    event_id = md5(source_table|source_pk|'snapshot')
--   No now(), no field_entry_ts/field_update_ts in either hash.
--
-- source_pk is ALWAYS NEW.id::text.
--
-- Guards: `create or replace function` + `drop trigger if exists …;
-- create trigger …`. This file NEVER alters the four data tables'
-- schema or RLS. No trigger is created on qc_activity_draft (not
-- synced in v1, design §3.2/§12.D).
--
-- V1 SCOPE: live data paths are Dryer (dryer_hourly_draft +
-- dryer_logs) and QC Finished Goods (quality_control_records
-- tab='fg'). The quality_control_records trigger ALSO routes
-- tab='rm'/'ip' correctly, but RM/IP never write server-side today,
-- so that path is BUILT but DORMANT until an upstream RM/IP finalize
-- path exists (design §12.A). Nothing here adds that path.
-- ════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════
-- (a) dryer_hourly_draft — AFTER INSERT OR UPDATE
--     Primary source of Dryer field-entry / field-update history.
--     Diffs NEW.values (and OLD.values on UPDATE) over the Dryer
--     measurement allow-list; one field_change per changed key.
-- ═══════════════════════════════════════════════════════════════
create or replace function tg_sheets_sync_dryer_hourly_draft()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  -- Dryer measurement allow-list (design §3.2.0, inspection §1.2).
  -- EXCLUDES the display-only `timestamp` and the client-only `saved`.
  v_allow      text[] := array[
    'temp_inlet','temp_outlet','temp_actual','temp_fbd1','temp_fbd2',
    'temp_chamber','atomizer_freq','feed_fc','pressure','pt_temp',
    'batch_no','bags_per_hr','bag_size_wt','kg_per_hr','colour',
    'id_frequency','remarks'
  ];
  v_key        text;
  v_new        text;
  v_old        text;
  v_class      text;
  v_entry_ts   timestamptz;
  v_update_ts  timestamptz;
  v_field_entry_ts timestamptz;
  v_field_path text;
  v_record_ts  timestamptz;
  v_source_pk  text;
begin
  begin
    v_source_pk := NEW.id::text;
    v_record_ts := NEW.updated_at;

    foreach v_key in array v_allow loop
      v_new := nullif(trim(NEW.values->>v_key), '');

      if TG_OP = 'INSERT' then
        v_old := null;
      else
        v_old := nullif(trim(OLD.values->>v_key), '');
      end if;

      -- Classify entry vs update vs no-event.
      v_class := null;
      if v_old is null and v_new is not null then
        v_class := 'entry';
      elsif v_old is not null and v_new is not null and v_new <> v_old then
        v_class := 'update';
      end if;

      if v_class is null then
        continue;   -- no change → no event
      end if;

      v_field_path := 'values.' || v_key;

      if v_class = 'entry' then
        v_entry_ts  := now();
        v_update_ts := null;
      else
        v_update_ts := now();
        -- Carry forward the original entry ts from the prior entry row.
        select o.field_entry_ts
          into v_field_entry_ts
          from sheets_sync_outbox o
         where o.source_table = TG_TABLE_NAME
           and o.source_pk    = v_source_pk
           and o.field_path   = v_field_path
           and o.change_class = 'entry'
         order by o.id
         limit 1;
        v_entry_ts := v_field_entry_ts;   -- NULL when no prior entry (never fabricated)
      end if;

      insert into sheets_sync_outbox (
        event_id, source_table, source_pk, record_kind, event_type,
        field_path, hour, old_value, new_value, change_class,
        field_entry_ts, field_update_ts, record_ts, routing_label, status
      ) values (
        md5(TG_TABLE_NAME || '|' || v_source_pk || '|' || v_field_path || '|'
            || v_class || '|' || coalesce(v_old, '∅') || '|'
            || coalesce(v_new, '∅') || '|'
            || extract(epoch from v_record_ts)::text),
        TG_TABLE_NAME, v_source_pk, 'dryer', 'field_change',
        v_field_path, NEW.hour, v_old, v_new, v_class,
        v_entry_ts, v_update_ts, v_record_ts,
        'Dryer Operator Records / Field Change History', 'pending'
      )
      on conflict (event_id) do nothing;
    end loop;

  exception when others then
    raise warning 'sheets_sync trigger %: %', TG_TABLE_NAME, sqlerrm;
  end;

  return NEW;   -- AFTER trigger: always return NEW (normal + exception paths)
end;
$$;

drop trigger if exists trg_sheets_sync_dryer_hourly_draft on dryer_hourly_draft;
create trigger trg_sheets_sync_dryer_hourly_draft
  after insert or update on dryer_hourly_draft
  for each row execute function tg_sheets_sync_dryer_hourly_draft();


-- ═══════════════════════════════════════════════════════════════
-- (b) dryer_logs — AFTER INSERT (final "Save Log Sheet")
--     Emits exactly ONE current_snapshot (meta + 24 hourly rows).
--     No per-field re-emit (history comes from dryer_hourly_draft).
--     final_submission_ts = created_at (its own payload key).
-- ═══════════════════════════════════════════════════════════════
create or replace function tg_sheets_sync_dryer_logs()
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
      'meta', jsonb_build_object(
        'date',                 NEW.date,
        'shift',                NEW.shift,
        'dryer_type',           NEW.dryer_type,
        'id_blower_dp',         NEW.id_blower_dp,
        'id_blower_mr',         NEW.id_blower_mr,
        'fd_blower_dp',         NEW.fd_blower_dp,
        'fd_blower_mr',         NEW.fd_blower_mr,
        -- chamber_dp/mr hold the UI's IFBD DP/MR values (inspection §1.1).
        'chamber_dp',           NEW.chamber_dp,
        'chamber_mr',           NEW.chamber_mr,
        'fbd_pct_dp',           NEW.fbd_pct_dp,
        'fbd_pct_mr',           NEW.fbd_pct_mr,
        'batch_no',             NEW.batch_no,
        'calibration_due',      NEW.calibration_due,
        'calibration_sensors',  NEW.calibration_sensors,
        'total_production',     NEW.total_production,
        'incharge',             NEW.incharge,
        'operator',             NEW.operator,
        -- Final-submission ts: its OWN key, never reusing record_ts.
        'final_submission_ts',  NEW.created_at
      ),
      -- 24 hourly rows, each keyed per inspection §1.2.
      'hours', coalesce(NEW.log_rows, '[]'::jsonb)
    );

    insert into sheets_sync_outbox (
      event_id, source_table, source_pk, record_kind, event_type,
      record_ts, payload, routing_label, status
    ) values (
      md5(TG_TABLE_NAME || '|' || v_source_pk || '|' || 'snapshot'),
      TG_TABLE_NAME, v_source_pk, 'dryer', 'current_snapshot',
      NEW.created_at, v_payload,
      'Dryer Operator Records / Current Records', 'pending'
    )
    on conflict (event_id) do nothing;

  exception when others then
    raise warning 'sheets_sync trigger %: %', TG_TABLE_NAME, sqlerrm;
  end;

  return NEW;
end;
$$;

drop trigger if exists trg_sheets_sync_dryer_logs on dryer_logs;
create trigger trg_sheets_sync_dryer_logs
  after insert on dryer_logs
  for each row execute function tg_sheets_sync_dryer_logs();


-- ═══════════════════════════════════════════════════════════════
-- (c) quality_control_records — AFTER INSERT (QC finalize)
--     record_kind from NEW.tab ('rm'→qc_rm, 'ip'→qc_ip, 'fg'→qc_fg).
--     Diffs the allow-list for NEW.tab against the previous same-
--     identity row (NULL-safe), emits field_change events + exactly
--     one current_snapshot. Live in v1 for tab='fg'; the rm/ip
--     branches are built but dormant (design §12).
-- ═══════════════════════════════════════════════════════════════
create or replace function tg_sheets_sync_quality_control_records()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  -- Per-record-kind measurement allow-lists (design §3.2.0).
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
    -- Sulphur Powder formula INPUTS (captured by collectReportValues so each
    -- input is its own field_change with its own entry timestamp).
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

    -- Map tab → record_kind + allow-list.
    if NEW.tab = 'fg' then
      v_record_kind := 'qc_fg'; v_allow := v_allow_fg;
    elsif NEW.tab = 'rm' then
      v_record_kind := 'qc_rm'; v_allow := v_allow_rm;
    elsif NEW.tab = 'ip' then
      v_record_kind := 'qc_ip'; v_allow := v_allow_ip;
    else
      return NEW;   -- unknown tab: nothing to sync
    end if;

    -- Previous same-identity row (NULL-safe coalesce tuple, excludes NEW).
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

    -- Field-change diff over the allow-list only (meta/identity never iterated).
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

      -- Prefer the CLIENT-SUPPLIED per-field entry time (values.__ts.<key>),
      -- which is the real moment the operator first typed the value on the
      -- website. Fall back to now() when the client did not supply one
      -- (older clients / server-only paths). This is what makes each field
      -- show its own entry time instead of one shared save-moment time.
      v_client_entry_ts := null;
      begin
        if (NEW.values ? '__ts') and (NEW.values->'__ts' ? v_key) then
          v_client_entry_ts := (NEW.values->'__ts'->>v_key)::timestamptz;
        end if;
      exception when others then
        v_client_entry_ts := null;   -- malformed value → ignore, use now()
      end;

      if v_class = 'entry' then
        v_entry_ts  := coalesce(v_client_entry_ts, now());
        v_update_ts := null;
      else
        v_update_ts := now();
        -- Carry-forward keyed on this row's source_pk; QC INSERTs each have a
        -- new id, so this is expected to be NULL (design §17 NIT#4) — correct,
        -- the original entry stays in the append-only history.
        select o.field_entry_ts
          into v_field_entry_ts
          from sheets_sync_outbox o
         where o.source_table = TG_TABLE_NAME
           and o.source_pk    = v_source_pk
           and o.field_path   = v_field_path
           and o.change_class = 'entry'
         order by o.id
         limit 1;
        -- If no prior entry row, use the client's supplied entry time.
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

    -- Exactly one current_snapshot: ALL values keys + meta/identity +
    -- final_submission_ts (its own key).
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
