-- Daily production tracking: one row per date
create table if not exists daily_production (
  id            bigint generated always as identity primary key,
  production_date date unique not null,
  total_kg      numeric not null default 0,
  fg_used_kg    numeric not null default 5,
  remaining_kg  numeric generated always as (total_kg - fg_used_kg) stored,
  entered_by    text,
  updated_at    timestamptz default now()
);

-- RLS
alter table daily_production enable row level security;

-- Admin: full access
create policy "admin_all" on daily_production
  for all using (
    exists (
      select 1 from auth_users
      where id = auth.uid()::text
        and role = 'admin'
    )
  );

-- Dryer Operator: insert + update own rows
create policy "dryer_insert" on daily_production
  for insert with check (
    exists (
      select 1 from auth_users
      where id = auth.uid()::text
        and (sections @> '["all"]' or sections @> '["Dryer Operator"]')
    )
  );

create policy "dryer_update" on daily_production
  for update using (
    exists (
      select 1 from auth_users
      where id = auth.uid()::text
        and (sections @> '["all"]' or sections @> '["Dryer Operator"]')
    )
  );

-- Quality Control: read all + update fg_used_kg
create policy "qc_select" on daily_production
  for select using (
    exists (
      select 1 from auth_users
      where id = auth.uid()::text
        and (sections @> '["all"]' or sections @> '["Quality Control"]' or sections @> '["Dryer Operator"]')
    )
  );

create policy "qc_update_fg" on daily_production
  for update using (
    exists (
      select 1 from auth_users
      where id = auth.uid()::text
        and (sections @> '["all"]' or sections @> '["Quality Control"]')
    )
  );
