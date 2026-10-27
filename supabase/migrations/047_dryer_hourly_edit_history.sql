-- ════════════════════════════════════════════════════════════
-- MIGRATION 047 — Dryer hourly edit-history-aware sync trigger
-- Run in: Supabase Dashboard → SQL Editor → New query
-- APPLY ORDER: run AFTER 030 (dryer_v2 horizontal layout).
--
-- SCOPE: re-creates ONLY the function tg_dryer_v2_hourly() and re-creates ONLY
--   its trigger trg_dryer_v2_hourly on dryer_hourly_draft. Does NOT touch
--   tg_dryer_v2_logs / trg_dryer_v2_logs, the QC triggers, dryer_logs,
--   the unique constraint, RLS, realtime, or the dryer_hourly_draft_active view.
--
-- NATURE: additive, idempotent, re-runnable (create-or-replace function +
--   drop-if-exists / create trigger). No schema/RLS/realtime/view/unique change.
--
-- GOAL (design §2.3): copied VERBATIM from migration 030's tg_dryer_v2_hourly()
--   with ONLY the §2.3 fingerprint + payload edits applied:
--     • a genuine edit mints a NEW event_id (new sync event), while a no-op
--       re-save and a replay produce the SAME event_id (on conflict dedups);
--     • the outbox payload now carries the full per-field history (hist[])
--       so the Apps Script (FEAT-003) can rebuild the edited cells.
--   Every other attribute — language, security definer, the full
--   `set search_path = public, pg_temp`, the inner exception wrapper, and the
--   unconditional `return NEW` — is BYTE-IDENTICAL to 030 (N4: a sync error
--   never rolls back an operator's save). A pre-feature row (no __hist/__events)
--   reproduces 030's EXACT v_fp, so its event_id is unchanged — no backfill,
--   no spurious re-sync of historical rows on deploy.
--
-- NOTE on identifiers (do not transpose — design §4 / current-review Finding 3):
--   source_pk is built from the COLUMN as NEW.log_date::text
--     (v_src_pk := NEW.dryer_type || '|' || NEW.log_date::text || '|'
--                  || coalesce(NEW.shift,'') || '|' || NEW.hour),
--   while the OUTBOX PAYLOAD key is 'date' (jsonb_build_object('date', ...)).
--   Both are correct in 030; copied verbatim here — the column is log_date,
--   the payload key is date.
-- ════════════════════════════════════════════════════════════


-- ── dryer_hourly_draft → ONE 'dryer_hour' event per saved hour (history-aware) ─
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
  v_hst      jsonb := '{}'::jsonb;
  v_fp       text := '';
  v_src_pk   text;
  v_any      boolean := false;
  v_tsobj    jsonb;
  v_hist     jsonb;
  v_has_hist boolean;
  v_mhist    jsonb;
  v_mhas     boolean;
  v_events   jsonb := case when jsonb_typeof(NEW.values->'__events') = 'array'
                           then NEW.values->'__events' else null end;
begin
  begin
    v_tsobj := case when jsonb_typeof(NEW.values->'__ts') = 'object'
                    then NEW.values->'__ts' else '{}'::jsonb end;

    foreach v_k in array v_keys loop
      -- 'maintenance' is a JSONB OBJECT ({shifter_screen, atomizer_water}), not
      -- a scalar. Carry the whole object through (when any option is selected
      -- OR it has been edited) so the Apps Script can render the selected
      -- options + their own times, and so a deselect-all edit clears the cell.
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

    if not v_any then return NEW; end if;   -- nothing to sync for this hour

    -- Row-level edit trail: fold in ONLY when present (null-safe), so a
    -- pre-feature row contributes nothing and keeps 030's exact fingerprint.
    if v_events is not null then
      v_fp := v_fp || '__events=' || jsonb_array_length(v_events)::text
                   || '@' || coalesce(v_events->-1->>'ts', '') || ';';
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
        'hist',       v_hst
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

-- Re-create the TRIGGER by its REAL name (trg_, not tg_). Dropping by the
-- wrong name would leave the old trigger in place AND add a second one that
-- fires twice per save — so the name must be exactly trg_dryer_v2_hourly.
drop trigger if exists trg_dryer_v2_hourly on dryer_hourly_draft;
create trigger trg_dryer_v2_hourly
  after insert or update on dryer_hourly_draft
  for each row execute function tg_dryer_v2_hourly();
