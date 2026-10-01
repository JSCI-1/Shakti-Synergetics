-- ════════════════════════════════════════════════════════════
-- MIGRATION 010 — Quality Control Records
-- Run in: Supabase Dashboard → SQL Editor → New query
-- ════════════════════════════════════════════════════════════

drop table if exists quality_control_records cascade;

create table quality_control_records (
  id         uuid default gen_random_uuid() primary key,
  created_at timestamptz default now(),

  tab        text,        -- 'rm' | 'ip' | 'fg'
  date       date,
  tested_by  text,

  -- All observation values keyed by parameter id
  -- e.g. { "clay_ph": "7.2", "clay_moisture": "3.5", ... }
  values     jsonb
);

alter table quality_control_records enable row level security;

create policy "anon_insert_qc" on quality_control_records for insert to anon with check (true);
create policy "anon_select_qc" on quality_control_records for select to anon using (true);
