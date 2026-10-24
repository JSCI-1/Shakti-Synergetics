-- ════════════════════════════════════════════════════════════
-- MIGRATION 034 — Thermopack Sheets Sync (fully separate queue)
-- Run in: Supabase Dashboard → SQL Editor → New query
-- APPLY ORDER: run AFTER 033 (triggers reference thermopack_hourly_draft)
--              and after 001 (thermopack_job_cards, motor_amp_status).
--
-- OPTION C — COMPLETE ISOLATION. This creates a DEDICATED Thermopack sync
-- queue (thermopack_sheets_sync_outbox) and a DEDICATED claim function
-- (thermopack_sheets_sync_claim_batch). It NEVER touches the shared
-- sheets_sync_outbox or sheets_sync_claim_batch used by Dryer/QC, so a
-- Thermopack worker can never claim or acknowledge a Dryer/QC record and
-- vice-versa. The Dryer/QC path is left 100% untouched.
--
-- Three AFTER triggers enqueue onto the Thermopack queue ONLY:
--   thermopack_job_cards     INSERT/UPDATE → thermo_jobcard (current_snapshot)
--   thermopack_hourly_draft  INSERT/UPDATE → thermo_hourly  (current_snapshot)
--                             (ONLY when job_card_id is set — orphans skipped)
--   motor_amp_status         INSERT        → thermo_motor   (current_snapshot)
--
-- CRITICAL INVARIANT (same as the shared triggers): every trigger function
-- is language plpgsql / security definer / set search_path = public, pg_temp
-- with an inner begin…exception…end wrapper and an UNCONDITIONAL return NEW,
-- so a sync-side error can NEVER roll back the operator's base write.
--
-- IDEMPOTENCY: snapshot event_id = md5(source_table|source_pk|'snapshot').
-- Re-running a trigger is a no-op via on conflict (event_id) do nothing.
-- Snapshots are rebuilt deterministically on every sync, so an UPDATE to a
-- job card re-emits the SAME event_id and the Apps Script UPSERTs the same
-- row (no duplicate job card row).
--
-- NO-DROP on the outbox (it holds real pending work): create-if-not-exists.
-- ════════════════════════════════════════════════════════════

create table if not exists thermopack_sheets_sync_outbox (
  id               bigint generated always as identity primary key,
  event_id         text not null,
  source_table     text not null,   -- 'thermopack_job_cards' | 'thermopack_hourly_draft' | 'motor_amp_status'
  source_pk        text not null,   -- NEW.id::text
  record_kind      text not null,   -- 'thermo_jobcard' | 'thermo_hourly' | 'thermo_motor'
  event_type       text not null,   -- 'current_snapshot'
  payload          jsonb,
  record_ts        timestamptz,
  status           text not null default 'pending',   -- pending → in_progress → done | failed
  retry_count      int  not null default 0,
  last_error       text,
  locked_at        timestamptz,
  created_at       timestamptz not null default now(),
  synced_at        timestamptz
);

create unique index if not exists thermopack_sheets_sync_outbox_event_id_key
  on thermopack_sheets_sync_outbox (event_id);

create index if not exists thermopack_sheets_sync_outbox_status_id_idx
  on thermopack_sheets_sync_outbox (status, id);

-- Deny-by-default to the browser (RLS on, no anon/authenticated policy).
-- SECURITY DEFINER triggers own the writes; the dedicated Edge Functions
-- use the service-role key (bypasses RLS). The browser never touches it.
alter table thermopack_sheets_sync_outbox enable row level security;


-- ── Dedicated atomic batch claim (Thermopack queue ONLY) ─────
-- A 1:1 copy of the shared claim's shape, but it reads/writes ONLY
-- thermopack_sheets_sync_outbox. The shared sheets_sync_claim_batch is left
-- untouched, guaranteeing neither worker can ever claim the other's rows.
create or replace function thermopack_sheets_sync_claim_batch(p_limit int)
  returns setof thermopack_sheets_sync_outbox
  language sql
  security definer
  set search_path = public, pg_temp
as $$
  update thermopack_sheets_sync_outbox o
     set status    = 'in_progress',
         locked_at = now()
   where o.id in (
     select c.id
       from thermopack_sheets_sync_outbox c
      where c.status = 'pending'
         or (c.status = 'in_progress'
             and c.locked_at < now() - interval '10 minutes')
      order by c.id
      limit greatest(1, least(500, coalesce(p_limit, 100)))
      for update skip locked
   )
  returning o.*;
$$;


-- ═══════════════════════════════════════════════════════════════
-- (a) thermopack_job_cards — AFTER INSERT OR UPDATE
--     One current_snapshot per job card. UPDATE re-emits the SAME
--     event_id so an edit UPSERTS the same Sheets row (no duplicate).
--     final_submission_ts = created_at (its own payload key).
-- ═══════════════════════════════════════════════════════════════
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
      'log_variant',       NEW.log_variant,
      'summary_10l',       NEW.summary_10l,
      'summary_6l',        NEW.summary_6l,
      'total_clinker_wt',  NEW.total_clinker_wt,
      'remarks',           NEW.remarks,
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

drop trigger if exists trg_thermo_sync_job_cards on thermopack_job_cards;
create trigger trg_thermo_sync_job_cards
  after insert or update on thermopack_job_cards
  for each row execute function tg_thermo_sync_job_cards();


-- ═══════════════════════════════════════════════════════════════
-- (b) thermopack_hourly_draft — AFTER INSERT OR UPDATE
--     One current_snapshot per saved hourly row, keyed by its own id.
--     ONLY enqueues once job_card_id is set, so orphaned / unsubmitted
--     hourly rows are NEVER exported. The association call (migration
--     033) sets job_card_id, which fires this UPDATE and enqueues them.
-- ═══════════════════════════════════════════════════════════════
create or replace function tg_thermo_sync_hourly()
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
    -- Gate: never export an hourly row that is not yet tied to a job card.
    if NEW.job_card_id is null then
      return NEW;
    end if;

    v_source_pk := NEW.id::text;

    v_payload := jsonb_build_object(
      'job_card_id', NEW.job_card_id,
      'variant',     NEW.variant,
      'hour',        NEW.hour,
      'operator',    NEW.operator,
      'values',      coalesce(NEW.values, '{}'::jsonb),
      'saved_at',    NEW.saved_at
    );

    insert into thermopack_sheets_sync_outbox (
      event_id, source_table, source_pk, record_kind, event_type,
      record_ts, payload, status
    ) values (
      md5(TG_TABLE_NAME || '|' || v_source_pk || '|' || 'snapshot'),
      TG_TABLE_NAME, v_source_pk, 'thermo_hourly', 'current_snapshot',
      NEW.saved_at, v_payload, 'pending'
    )
    on conflict (event_id) do nothing;

  exception when others then
    raise warning 'thermopack_sync trigger %: %', TG_TABLE_NAME, sqlerrm;
  end;

  return NEW;
end;
$$;

drop trigger if exists trg_thermo_sync_hourly on thermopack_hourly_draft;
create trigger trg_thermo_sync_hourly
  after insert or update on thermopack_hourly_draft
  for each row execute function tg_thermo_sync_hourly();


-- ═══════════════════════════════════════════════════════════════
-- (c) motor_amp_status — AFTER INSERT (global Save Motor Status)
--     One current_snapshot per submission. The payload carries BOTH
--     variant arrays; the Apps Script expands one row per motor reading.
--     final_submission_ts = created_at. INSERT-only: a new check is a
--     new row (history preserved); the same submission never re-emits.
-- ═══════════════════════════════════════════════════════════════
create or replace function tg_thermo_sync_motor()
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
      'motor_id',       NEW.id,
      'running_date',   NEW.running_date,
      'checked_by',     NEW.checked_by,
      'remark',         NEW.remark,
      'motor_variant',  NEW.motor_variant,
      'motor_data_10l', NEW.motor_data_10l,
      'motor_data_6l',  NEW.motor_data_6l,
      'final_submission_ts', NEW.created_at
    );

    insert into thermopack_sheets_sync_outbox (
      event_id, source_table, source_pk, record_kind, event_type,
      record_ts, payload, status
    ) values (
      md5(TG_TABLE_NAME || '|' || v_source_pk || '|' || 'snapshot'),
      TG_TABLE_NAME, v_source_pk, 'thermo_motor', 'current_snapshot',
      NEW.created_at, v_payload, 'pending'
    )
    on conflict (event_id) do nothing;

  exception when others then
    raise warning 'thermopack_sync trigger %: %', TG_TABLE_NAME, sqlerrm;
  end;

  return NEW;
end;
$$;

drop trigger if exists trg_thermo_sync_motor on motor_amp_status;
create trigger trg_thermo_sync_motor
  after insert on motor_amp_status
  for each row execute function tg_thermo_sync_motor();
