-- ════════════════════════════════════════════════════════════
-- MIGRATION 067 — Dryer hourly → Google Sheet: send the out-of-limit flags
-- Run in: Supabase Dashboard → SQL Editor → New query
-- APPLY ORDER: after 061 (this re-creates the same function, tg_dryer_v2_hourly).
--
-- WHY: when an operator proceeds past a range warning, the website stores
--   values.__cautions = { <field>: 'high' | 'low' } on the hour. The sheet
--   script already knows how to mark those cells, but the trigger never sent
--   __cautions (it only copies the listed fields), so nothing reached the sheet.
--
-- WHAT: 061's function VERBATIM plus:
--   • payload.cautions = the hour's __cautions object ({} when none), and
--   • the fingerprint includes __cautions ONLY when present, so hours without
--     out-of-limit values keep their exact event_id (no re-sync of history).
-- Edit history (payload.hist) is unchanged — already sent since 047/061.
--
-- Additive, idempotent, re-runnable. No table / RLS change. Existing hours are
-- NOT re-sent automatically; see the optional backfill at the end.
-- ════════════════════════════════════════════════════════════
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
    'bag_size_wt','bags_per_hr_50','bag_size_wt_50','kg_per_hr','colour','id_frequency',
    'remarks','operator_name','maintenance'
  ];
  v_k        text;
  v_vals     jsonb := '{}'::jsonb;
  v_ts       jsonb := '{}'::jsonb;
  v_hst      jsonb := '{}'::jsonb;
  v_fp       text := '';
  v_src_pk   text;
  v_any      boolean := false;
  v_tsobj    jsonb;
  v_hist     jsonb;
  v_has_hist boolean;
  v_mhist    jsonb;
  v_mhas     boolean;
  v_caut     jsonb := case when jsonb_typeof(NEW.values->'__cautions') = 'object'
                             and NEW.values->'__cautions' <> '{}'::jsonb
                           then NEW.values->'__cautions' else null end;
  v_events   jsonb := case when jsonb_typeof(NEW.values->'__events') = 'array'
                           then NEW.values->'__events' else null end;
begin
  begin
    v_tsobj := case when jsonb_typeof(NEW.values->'__ts') = 'object'
                    then NEW.values->'__ts' else '{}'::jsonb end;

    foreach v_k in array v_keys loop
      if v_k = 'maintenance' then
        v_mhist := NEW.values->'__hist'->'maintenance';
        v_mhas  := (jsonb_typeof(v_mhist) = 'array' and jsonb_array_length(v_mhist) > 0);
        if (jsonb_typeof(NEW.values->'maintenance') = 'object'
            and (coalesce(NEW.values->'maintenance'->>'shifter_screen','') <> ''
                 or coalesce(NEW.values->'maintenance'->>'atomizer_water','') <> ''))
           or v_mhas then
          v_vals := v_vals || jsonb_build_object('maintenance', NEW.values->'maintenance');
          v_fp   := v_fp || 'maintenance=' || (NEW.values->'maintenance')::text;
          if v_mhas then
            v_fp := v_fp || '#' || jsonb_array_length(v_mhist)::text;
            v_hst := v_hst || jsonb_build_object('maintenance', v_mhist);
          end if;
          v_fp   := v_fp || ';';
          v_any  := true;
        end if;
        continue;
      end if;
      v_hist     := NEW.values->'__hist'->v_k;
      v_has_hist := (jsonb_typeof(v_hist) = 'array' and jsonb_array_length(v_hist) > 0);
      if nullif(trim(coalesce(NEW.values->>v_k, '')), '') is not null or v_has_hist then
        v_vals := v_vals || jsonb_build_object(v_k, NEW.values->>v_k);
        v_ts   := v_ts   || jsonb_build_object(v_k, coalesce(v_tsobj->>v_k, ''));
        v_fp   := v_fp || v_k || '=' || coalesce(NEW.values->>v_k, '') || '@' || coalesce(v_tsobj->>v_k, '');
        if v_has_hist then
          v_fp  := v_fp || '#' || jsonb_array_length(v_hist)::text;
          v_hst := v_hst || jsonb_build_object(v_k, v_hist);
        end if;
        v_fp   := v_fp || ';';
        v_any  := true;
      end if;
    end loop;

    if not v_any then return NEW; end if;

    if v_events is not null then
      v_fp := v_fp || '__events=' || jsonb_array_length(v_events)::text
                   || '@' || coalesce(v_events->-1->>'ts', '') || ';';
    end if;

    -- Out-of-limit flags: fold in ONLY when present, so a row without them keeps
    -- 061's exact fingerprint (no spurious re-sync).
    if v_caut is not null then
      v_fp := v_fp || '__cautions=' || v_caut::text || ';';
    end if;

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
        'ts',         v_ts,
        'hist',       v_hst,
        'cautions',   coalesce(v_caut, '{}'::jsonb)
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

-- ── OPTIONAL BACKFILL (run separately, once) ─────────────────────────────────
-- Re-sends hours that already have out-of-limit values or edit history, so the
-- sheet shows the underline / previous values for EARLIER data too. It only
-- re-fires this trigger (values are written back unchanged); the sheet updates
-- those hourly rows in place — no duplicates.
--
--   update dryer_hourly_draft
--      set values = values
--    where values ? '__cautions' or values ? '__hist';