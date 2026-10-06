-- ════════════════════════════════════════════════════════════
-- MIGRATION 008 — Daily Production Tracking
-- Run in: Supabase Dashboard → SQL Editor → New query
-- ════════════════════════════════════════════════════════════

drop table if exists daily_production cascade;

create table daily_production (
  id               bigint generated always as identity primary key,
  production_date  date unique not null,
  total_kg         numeric not null default 0,
  fg_used_kg       numeric not null default 5,
  remaining_kg     numeric generated always as (total_kg - fg_used_kg) stored,
  entered_by       text,
  updated_at       timestamptz default now()
);

alter table daily_production enable row level security;

-- Allow anon (your app uses anon key) to read, insert, and update
create policy "anon_select_daily_production"
  on daily_production for select to anon using (true);

create policy "anon_insert_daily_production"
  on daily_production for insert to anon with check (true);

create policy "anon_update_daily_production"
  on daily_production for update to anon using (true);
