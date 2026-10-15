-- ════════════════════════════════════════════════════════════
-- MIGRATION 021 — Sheets Sync Outbox
-- Run in: Supabase Dashboard → SQL Editor → New query
-- APPLY ORDER: run 021 BEFORE 022 (022's trigger functions
--              `insert into sheets_sync_outbox`, so this table
--              must exist first). See design §9.
--
-- Durable, field-level change-history OUTBOX for the one-way
-- Supabase → Google Sheets sync. AFTER triggers on the four
-- in-scope data tables (added in 022) enqueue one row here per
-- field change (`field_change`) or per finalized record
-- (`current_snapshot`). A Google Apps Script Web App PULLS these
-- rows through two Edge Functions, writes them to Sheets, and
-- ACKs them. Supabase stays authoritative; the sync never blocks
-- or fails a Supabase save, and every failed sync is retriable.
--
-- NO-DROP RULE (deliberate): unlike 018/020, this file uses
--   `create table if not exists` / `create index if not exists`
-- and NEVER `drop … cascade`. The outbox accumulates REAL pending
-- sync work; dropping it on a re-run would lose unsynced events.
-- Re-running this file is therefore a safe no-op.
--
-- RLS: enabled with NO anon/authenticated policy (deny-by-default
-- to the browser). The trigger functions are SECURITY DEFINER and
-- the Edge Functions use the service-role key, so neither needs a
-- browser-facing policy. The browser must never read/write this
-- table.
--
-- This file also defines `sheets_sync_claim_batch(int)` — the single
-- atomic `update … returning` the pull Edge Function uses to serve a
-- FIFO batch without double-serving concurrent polls (design §6.2).
-- ════════════════════════════════════════════════════════════

create table if not exists sheets_sync_outbox (
  -- FIFO ordering / batch cursor.
  id               bigint generated always as identity primary key,

  -- Stable, deterministic dedup key (design §4). Field-change =
  -- md5(source_table|source_pk|field_path|change_class|old|new|epoch(record_ts));
  -- snapshot = md5(source_table|source_pk|'snapshot'). No now() in either.
  event_id         text not null,

  -- Which base table emitted this event.
  --   'dryer_logs' | 'dryer_hourly_draft' | 'quality_control_records'
  --   | 'qc_activity_draft' (dormant in v1)
  source_table     text not null,

  -- The base row's id, ALWAYS written/compared as NEW.id::text
  -- (base PKs are uuid, this column is text). dryer_hourly_draft and
  -- dryer_logs live in different id spaces disambiguated by source_table.
  source_pk        text not null,

  -- Routing discriminator (design §5): 'dryer' | 'qc_rm' | 'qc_ip' | 'qc_fg'.
  record_kind      text not null,

  -- 'field_change' (append-only history) | 'current_snapshot' (current records).
  event_type       text not null,

  -- For field_change: logical field key, grammar `values.<key>`
  --   e.g. 'values.temp_inlet' / 'values.fg_moisture'. NULL for snapshots.
  field_path       text,

  -- For dryer_hourly_draft field changes: the draft row's `hour`
  -- (TIME_SLOT label, e.g. '08:00'), so Field Change History attributes
  -- the hour without encoding it in field_path. NULL otherwise.
  hour             text,

  -- Prior value (NULL on first entry).
  old_value        text,

  -- New value (text; never type-coerced).
  new_value        text,

  -- 'entry' (first non-empty persist) | 'update' (later change).
  change_class     text,

  -- Server time of first entry of this field.
  field_entry_ts   timestamptz,

  -- Server time of this change if an update; NULL on entry.
  field_update_ts  timestamptz,

  -- The base row's own created_at / updated_at / last_saved_at.
  record_ts        timestamptz,

  -- For current_snapshot: full current-state column set for the tab
  -- (design §5.3), including the payload.final_submission_ts key.
  payload          jsonb,

  -- Human-readable label ONLY; never read by code. Apps Script derives
  -- routing solely from record_kind + event_type (design §5.1).
  routing_label    text,

  -- 'pending' → 'in_progress' → 'done' | 'failed'.
  status           text not null default 'pending',

  -- Incremented on each failed attempt (retry cap = 5, design §6.4).
  retry_count      int not null default 0,

  -- Last failure message (truncated to 1000 chars by the ack function).
  last_error       text,

  -- Set when a batch is served; stale locks (>10 min) are reclaimed.
  locked_at        timestamptz,

  -- Enqueue time (timezone-aware, server-side).
  created_at       timestamptz not null default now(),

  -- Set on successful ack (the Sheets-sync timestamp).
  synced_at        timestamptz
);


-- ── Indexes ──────────────────────────────────────────────────
-- Unique dedup key: a replayed trigger is a no-op via
-- `on conflict (event_id) do nothing`.
create unique index if not exists sheets_sync_outbox_event_id_key
  on sheets_sync_outbox (event_id);

-- FIFO pending scan for the pull Edge Function.
create index if not exists sheets_sync_outbox_status_id_idx
  on sheets_sync_outbox (status, id);

-- field_entry_ts carry-forward lookup on an update (design §3.2):
--   where source_table/source_pk/field_path and change_class='entry'.
create index if not exists sheets_sync_outbox_entry_lookup
  on sheets_sync_outbox (source_table, source_pk, field_path, change_class);


-- ── RLS: deny-by-default to the browser ──────────────────────
-- Enable RLS and create NO anon/authenticated policy. Under
-- RLS-with-no-policy all anon/authenticated access is denied. The
-- SECURITY DEFINER trigger functions run as the table owner, and
-- the Edge Functions use the service-role key (bypasses RLS), so
-- the sync path works while the browser is fully fenced out.
alter table sheets_sync_outbox enable row level security;


-- ── Atomic batch claim for the pull Edge Function ────────────
-- The pull Edge Function serves a FIFO batch in a SINGLE statement
-- so concurrent polls never double-serve (design §6.2). PostgREST
-- cannot express "update the N oldest claimable rows, ordered,
-- returning them" in one call, so that single `update … returning`
-- lives here as a function the Edge Function invokes via rpc().
--
-- Claimable = status 'pending', OR status 'in_progress' whose
-- locked_at is older than 10 minutes (a crashed mid-batch poll is
-- reclaimed). Claimed rows are flipped to 'in_progress' with a fresh
-- locked_at and returned. SECURITY DEFINER with a pinned search_path
-- (same posture as the trigger functions); only the service-role
-- Edge Function can reach it (RLS denies the browser, and this
-- function is not exposed to anon/authenticated meaningfully because
-- the outbox has no browser policy).
create or replace function sheets_sync_claim_batch(p_limit int)
  returns setof sheets_sync_outbox
  language sql
  security definer
  set search_path = public, pg_temp
as $$
  update sheets_sync_outbox o
     set status    = 'in_progress',
         locked_at = now()
   where o.id in (
     select c.id
       from sheets_sync_outbox c
      where c.status = 'pending'
         or (c.status = 'in_progress'
             and c.locked_at < now() - interval '10 minutes')
      order by c.id
      limit greatest(1, least(500, coalesce(p_limit, 100)))
      for update skip locked
   )
  returning o.*;
$$;
