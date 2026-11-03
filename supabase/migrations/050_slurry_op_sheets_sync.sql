-- ════════════════════════════════════════════════════════════
-- MIGRATION 050 — Slurry Operator → Sheets Sync
--
-- Enqueues Slurry Operator records into the EXISTING
-- thermopack_sheets_sync_outbox table (same queue, same Edge
-- Functions, same Apps Script worker). No new table or endpoint
-- is needed — two new record_kinds are added:
--
--   slurry_op_jobcard  ← INSERT on slurry_operator_job_cards
--   slurry_op_motor    ← INSERT on slurry_operator_motor_amp
--
-- Both triggers follow the EXACT same pattern as the Thermopack
-- triggers (migration 034): security definer, unconditional
-- return NEW, inner exception block so a sync error can NEVER
-- roll back the operator's save.
--
-- IDEMPOTENCY: event_id = md5(table|pk|'snapshot').
-- Re-insert of the same source row is a no-op (on conflict do nothing).
-- ════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════
-- (a) slurry_operator_job_cards — AFTER INSERT
--     One current_snapshot per saved job card.
--     Payload mirrors the SlurryOperator.jsx insert shape exactly.
-- ═══════════════════════════════════════════════════════════════
create or replace function tg_slurry_op_sync_jobcard()
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
      'date',          NEW.date,
      'shift',         NEW.shift,
      'operator_name', NEW.operator_name,
      'mills',         coalesce(NEW.mills, '[]'::jsonb),
      'supervisor',    NEW.supervisor,
      'manager',       NEW.manager
    );

    insert into thermopack_sheets_sync_outbox (
      event_id, source_table, source_pk, record_kind, event_type,
      record_ts, payload, status
    ) values (
      md5(TG_TABLE_NAME || '|' || v_source_pk || '|' || 'snapshot'),
      TG_TABLE_NAME,
      v_source_pk,
      'slurry_op_jobcard',
      'current_snapshot',
      NEW.created_at,
      v_payload,
      'pending'
    )
    on conflict (event_id) do nothing;

  exception when others then
    raise warning 'slurry_op_sync trigger %: %', TG_TABLE_NAME, sqlerrm;
  end;

  return NEW;
end;
$$;

drop trigger if exists trg_slurry_op_sync_jobcard on slurry_operator_job_cards;
create trigger trg_slurry_op_sync_jobcard
  after insert on slurry_operator_job_cards
  for each row execute function tg_slurry_op_sync_jobcard();


-- ═══════════════════════════════════════════════════════════════
-- (b) slurry_operator_motor_amp — AFTER INSERT
--     One current_snapshot per motor amp submission.
--     Payload mirrors the SlurryOperator.jsx motor insert shape.
-- ═══════════════════════════════════════════════════════════════
create or replace function tg_slurry_op_sync_motor()
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
      'submission_id', NEW.id,
      'running_date',  NEW.running_date,
      'checked_by',    NEW.checked_by,
      'remark',        NEW.remark,
      'motor_data',    coalesce(NEW.motor_data, '[]'::jsonb)
    );

    insert into thermopack_sheets_sync_outbox (
      event_id, source_table, source_pk, record_kind, event_type,
      record_ts, payload, status
    ) values (
      md5(TG_TABLE_NAME || '|' || v_source_pk || '|' || 'snapshot'),
      TG_TABLE_NAME,
      v_source_pk,
      'slurry_op_motor',
      'current_snapshot',
      NEW.created_at,
      v_payload,
      'pending'
    )
    on conflict (event_id) do nothing;

  exception when others then
    raise warning 'slurry_op_sync trigger %: %', TG_TABLE_NAME, sqlerrm;
  end;

  return NEW;
end;
$$;

drop trigger if exists trg_slurry_op_sync_motor on slurry_operator_motor_amp;
create trigger trg_slurry_op_sync_motor
  after insert on slurry_operator_motor_amp
  for each row execute function tg_slurry_op_sync_motor();
