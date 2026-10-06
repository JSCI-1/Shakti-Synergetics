-- ════════════════════════════════════════════════════════════
-- MIGRATION 009 — Slurry Input Row Auto-Save
-- Run in: Supabase Dashboard → SQL Editor → New query
-- ════════════════════════════════════════════════════════════

create table if not exists slurry_input_saves (
  id           bigint generated always as identity primary key,
  session_id   text not null,
  row_id       text not null,
  batch_index  int  not null,
  input_name   text,
  origin       text,
  qty_kg       numeric,
  first_stamp  text,
  updated_at   timestamptz default now(),
  unique (session_id, row_id, batch_index)
);

alter table slurry_input_saves enable row level security;

create policy "anon_insert_slurry_input_saves"
  on slurry_input_saves for insert to anon with check (true);

create policy "anon_select_slurry_input_saves"
  on slurry_input_saves for select to anon using (true);

create policy "anon_update_slurry_input_saves"
  on slurry_input_saves for update to anon using (true);
