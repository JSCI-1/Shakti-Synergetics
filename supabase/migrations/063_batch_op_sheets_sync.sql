-- ════════════════════════════════════════════════════════════
-- MIGRATION 063 — Batch Operator → Sheets Sync
--
-- Enqueues Batch Operator records into the EXISTING
-- thermopack_sheets_sync_outbox table (same queue, same Edge
-- Functions, same Apps Script worker — exactly like Slurry
-- Operator in migration 050). No new table or endpoint is needed;
-- three new record_kinds are added:
--
--   batch_op_jobcard       ← INSERT on process_job_cards
--   batch_op_traceability  ← INSERT on batch_traceability
--   batch_op_consumption   ← INSERT on slurry_consumption
--
-- APPLY ORDER: after 034 (outbox), 010/011/012 (source tables) and
-- 060 (process_job_cards.shift / operator_name).
--
-- All triggers follow the EXACT pattern of 034/050: security definer,
-- unconditional return NEW, inner exception block so a sync error can
-- NEVER roll back the operator's save.
--
-- IDEMPOTENCY: event_id = md5(table|pk|'snapshot'). Re-insert of the same
-- source row is a no-op (on conflict do nothing).
-- Records saved BEFORE this migration are not synced (triggers are INSERT-only).
-- ════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════
-- (a) process_job_cards — AFTER INSERT
--     `batches` carries every batch card with its rows (incl. the
--     per-input Batch No. beside Origin/RM); `input_rows` carries the
--     resolved per-row timestamps.
-- ═══════════════════════════════════════════════════════════════
create or replace function tg_batch_op_sync_jobcard()
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
      'job_card_id',   NEW.id,
      'date',          NEW.date,
      'shift',         NEW.shift,
      'operator_name', NEW.operator_name,
      'batches',       coalesce(NEW.batches, '[]'::jsonb),
      'input_rows',    coalesce(NEW.input_rows, '[]'::jsonb),
      'supervisor',    NEW.supervisor,
      'manager',       NEW.manager
    );

    insert into thermopack_sheets_sync_outbox (
      event_id, source_table, source_pk, record_kind, event_type,
      record_ts, payload, status
    ) values (
      md5(TG_TABLE_NAME || '|' || v_source_pk || '|' || 'snapshot'),
      TG_TABLE_NAME, v_source_pk, 'batch_op_jobcard', 'current_snapshot',
      NEW.created_at, v_payload, 'pending'
    )
    on conflict (event_id) do nothing;

  exception when others then
    raise warning 'batch_op_sync trigger %: %', TG_TABLE_NAME, sqlerrm;
  end;

  return NEW;
end;
$$;

drop trigger if exists trg_batch_op_sync_jobcard on process_job_cards;
create trigger trg_batch_op_sync_jobcard
  after insert on process_job_cards
  for each row execute function tg_batch_op_sync_jobcard();


-- ═══════════════════════════════════════════════════════════════
-- (b) batch_traceability — AFTER INSERT
-- ═══════════════════════════════════════════════════════════════
create or replace function tg_batch_op_sync_traceability()
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
      'record_id',   NEW.id,
      'date',        NEW.date,
      'rows',        coalesce(NEW.rows, '[]'::jsonb),
      'total_hs1',   NEW.total_hs1,
      'total_hs2',   NEW.total_hs2,
      'total_hs3',   NEW.total_hs3,
      'total_nm',    NEW.total_nm,
      'checked_by',  NEW.checked_by,
      'approved_by', NEW.approved_by
    );

    insert into thermopack_sheets_sync_outbox (
      event_id, source_table, source_pk, record_kind, event_type,
      record_ts, payload, status
    ) values (
      md5(TG_TABLE_NAME || '|' || v_source_pk || '|' || 'snapshot'),
      TG_TABLE_NAME, v_source_pk, 'batch_op_traceability', 'current_snapshot',
      NEW.created_at, v_payload, 'pending'
    )
    on conflict (event_id) do nothing;

  exception when others then
    raise warning 'batch_op_sync trigger %: %', TG_TABLE_NAME, sqlerrm;
  end;

  return NEW;
end;
$$;

drop trigger if exists trg_batch_op_sync_traceability on batch_traceability;
create trigger trg_batch_op_sync_traceability
  after insert on batch_traceability
  for each row execute function tg_batch_op_sync_traceability();


-- ═══════════════════════════════════════════════════════════════
-- (c) slurry_consumption — AFTER INSERT
--     `rows` is a single-element array holding the day's entry.
-- ═══════════════════════════════════════════════════════════════
create or replace function tg_batch_op_sync_consumption()
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
      'record_id', NEW.id,
      'rows',      coalesce(NEW.rows, '[]'::jsonb)
    );

    insert into thermopack_sheets_sync_outbox (
      event_id, source_table, source_pk, record_kind, event_type,
      record_ts, payload, status
    ) values (
      md5(TG_TABLE_NAME || '|' || v_source_pk || '|' || 'snapshot'),
      TG_TABLE_NAME, v_source_pk, 'batch_op_consumption', 'current_snapshot',
      NEW.created_at, v_payload, 'pending'
    )
    on conflict (event_id) do nothing;

  exception when others then
    raise warning 'batch_op_sync trigger %: %', TG_TABLE_NAME, sqlerrm;
  end;

  return NEW;
end;
$$;

drop trigger if exists trg_batch_op_sync_consumption on slurry_consumption;
create trigger trg_batch_op_sync_consumption
  after insert on slurry_consumption
  for each row execute function tg_batch_op_sync_consumption();
