-- ════════════════════════════════════════════════════════════
-- MIGRATION 064 — Dryer: production breakdown = No. of Bags × Quantity
-- Run in: Supabase Dashboard → SQL Editor → New query
-- APPLY ORDER: after 062 (this re-creates tg_dryer_v2_logs from 062's body).
-- RUN THIS BEFORE deploying the matching website change, otherwise
-- "Save Log Sheet" fails (unknown columns *_bags / *_qty).
--
-- WHAT:
--   For each of fine powder, crust (papadi), startup and packed production
--   the Save Log Sheet form now enters "No. of Bags" and "Quantity" (kg/bag);
--   the part's Total (kg) = bags × quantity.
--   1. dryer_logs gets 8 numeric columns:
--        fine_powder_bags / fine_powder_qty,  crust_papadi_bags / crust_papadi_qty,
--        startup_bags / startup_qty,  packed_production_bags / packed_production_qty
--      The existing fine_powder / crust_papadi / startup / packed_production
--      columns now hold each part's TOTAL (bags × qty), and total_production
--      remains their sum — so existing records, emails and sheet columns
--      keep working unchanged.
--   2. tg_dryer_v2_logs() — 062's function VERBATIM plus 8 lines in the field
--      list, so bags/qty reach the "New Dryer – Form" / "Old Dryer – Form"
--      Google Sheet tabs.
--
-- Additive, idempotent, re-runnable. No data touched. Older records show blank
-- bags/qty (they were saved as a single total).
-- ════════════════════════════════════════════════════════════

alter table dryer_logs add column if not exists fine_powder_bags       numeric;
alter table dryer_logs add column if not exists fine_powder_qty        numeric;
alter table dryer_logs add column if not exists crust_papadi_bags      numeric;
alter table dryer_logs add column if not exists crust_papadi_qty       numeric;
alter table dryer_logs add column if not exists startup_bags           numeric;
alter table dryer_logs add column if not exists startup_qty            numeric;
alter table dryer_logs add column if not exists packed_production_bags numeric;
alter table dryer_logs add column if not exists packed_production_qty  numeric;
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
