-- ════════════════════════════════════════════════════════════
-- MIGRATION 011 — Batch Traceability Records
-- Run in: Supabase Dashboard → SQL Editor → New query
-- ════════════════════════════════════════════════════════════

-- ── TABLE: batch_traceability ────────────────────────────────
-- One record per "Save" click in the Batch Operator
-- → Batch Traceability Records tab.

drop table if exists batch_traceability cascade;

create table batch_traceability (
  id           uuid default gen_random_uuid() primary key,
  created_at   timestamptz default now(),

  date         date,

  -- One row per batch (populated from the Process Job Card batch cards).
  -- Each element:
  -- {
  --   id           : number   (Date.now() + Math.random()),
  --   batch_no     : string,
  --   charge_tank  : string   (tank_type from Process Job Card),
  --   charge_start : string   (HH:MM, time input),
  --   charge_stop  : string,
  --   hs_tank      : string,
  --   hs_start     : string,
  --   hs_stop      : string,
  --   lst_tank     : string,
  --   lst_start    : string,
  --   lst_stop     : string,
  --   s1_start     : string,
  --   s1_stop      : string,
  --   s2_start     : string,
  --   s2_stop      : string,
  --   finish_tank  : string,
  --   finish_start : string,
  --   finish_stop  : string
  -- }
  rows         jsonb,

  -- Tank totals (free-text, user-entered)
  total_hs1    text,   -- HS-1 (6000 Lt.)
  total_hs2    text,   -- HS-2 (4000 Lt.)
  total_hs3    text,   -- HS-3 (6000 Lt.)
  total_nm     text,   -- NM   (2000 Lt.)

  checked_by   text,
  approved_by  text
);

alter table batch_traceability enable row level security;

create policy "anon_insert_batch_traceability"
  on batch_traceability for insert to anon with check (true);

create policy "anon_select_batch_traceability"
  on batch_traceability for select to anon using (true);
