-- ════════════════════════════════════════════════════════════
-- MIGRATION 066 — Dryer: save the bag-count totals of the hourly table
-- Run in: Supabase Dashboard → SQL Editor → New query
-- APPLY ORDER: after 064 (this re-creates tg_dryer_v2_logs from 064's body).
-- RUN THIS BEFORE deploying the matching website change, otherwise
-- "Save Log Sheet" fails (unknown columns bags_*_total).
--
-- WHAT: the hourly table's footer now totals, over all 24 hours,
--   bags_per_hr_total     — "Total No. of Bags(25)"       (No. of Bag Per Hours(25))
--   bags_per_hr_50_total  — "Total No. of Bags"           (No. of Bag Per Hours(50/1000) column, all hours)
--   bags_50_wt_total      — "Total No. of Bags(50)"       (hours whose Bag Size By Wt(50/1000) = 50)
--   bags_1000_wt_total    — "Total No. of Bags(1000)"     (hours whose Bag Size By Wt(50/1000) = 1000)
-- (an hour with no size counts only in bags_per_hr_50_total). Saved with
-- "Save Log Sheet" and sent to the "New Dryer – Form" / "Old Dryer – Form" tabs.
--
--   1. dryer_logs gets the 4 numeric columns above.
--   2. tg_dryer_v2_logs() — 064's function VERBATIM plus 4 lines in the field
--      list, so the totals reach the Google Sheet.
--
-- Additive, idempotent, re-runnable. No data touched. Older records have no
-- stored totals (the records view recomputes them from the hourly rows).
-- ════════════════════════════════════════════════════════════

alter table dryer_logs add column if not exists bags_per_hr_total    numeric;
alter table dryer_logs add column if not exists bags_per_hr_50_total numeric;
alter table dryer_logs add column if not exists bags_50_wt_total     numeric;
alter table dryer_logs add column if not exists bags_1000_wt_total   numeric;
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
        ('fine_powder_bags',       NEW.fine_powder_bags::text),
        ('fine_powder_qty',        NEW.fine_powder_qty::text),
        ('fine_powder',            NEW.fine_powder::text),
        ('crust_papadi_bags',      NEW.crust_papadi_bags::text),
        ('crust_papadi_qty',       NEW.crust_papadi_qty::text),
        ('crust_papadi',           NEW.crust_papadi::text),
        ('startup_bags',           NEW.startup_bags::text),
        ('startup_qty',            NEW.startup_qty::text),
        ('startup',                NEW.startup::text),
        ('packed_production_bags', NEW.packed_production_bags::text),
        ('packed_production_qty',  NEW.packed_production_qty::text),
        ('packed_production',      NEW.packed_production::text),
        ('kg_per_hr_total',   NEW.kg_per_hr_total::text),
        ('bags_per_hr_total',    NEW.bags_per_hr_total::text),
        ('bags_per_hr_50_total', NEW.bags_per_hr_50_total::text),
        ('bags_50_wt_total',     NEW.bags_50_wt_total::text),
        ('bags_1000_wt_total',   NEW.bags_1000_wt_total::text),
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
