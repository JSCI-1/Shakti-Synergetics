-- ════════════════════════════════════════════════════════════
-- MIGRATION 011 — Auth: app_users + otp_codes
-- Run in: Supabase Dashboard → SQL Editor → New query
-- ════════════════════════════════════════════════════════════

-- ── TABLE: app_users ─────────────────────────────────────────
-- Phone stored in E.164 format: +91XXXXXXXXXX (no space)
drop table if exists app_users cascade;

create table app_users (
  id           uuid default gen_random_uuid() primary key,
  created_at   timestamptz default now(),

  -- Phone in E.164 format, e.g. +919876543210
  phone        text unique not null,

  name         text not null,

  -- 'admin' sees all sections
  -- 'operator' sees only sections listed in sections[]
  role         text default 'operator',

  -- JSON array of tab names this user can access.
  -- Use ["all"] for admin/test users.
  -- Example: ["Thermopack Operator","Dryer Operator"]
  sections     jsonb default '[]'::jsonb,

  is_active    boolean default true
);

alter table app_users enable row level security;

-- Allow anon to read (needed for login lookup after OTP verify)
create policy "public_read_app_users"
  on app_users for select to anon using (true);


-- ── TABLE: otp_codes (optional — only needed if you bypass Supabase Auth) ──
-- If you use supabase.auth.signInWithOtp() you do NOT need this table.
-- Keep it for reference / fallback.
drop table if exists otp_codes cascade;

create table otp_codes (
  id         uuid default gen_random_uuid() primary key,
  phone      text not null,
  code       text not null,
  created_at timestamptz default now(),
  expires_at timestamptz default (now() + interval '10 minutes'),
  used       boolean default false
);

alter table otp_codes enable row level security;
create policy "anon_all_otp" on otp_codes for all to anon using (true) with check (true);


-- ════════════════════════════════════════════════════════════
-- SEED: Add users
-- Replace +919999999999 with your actual WhatsApp number.
-- ════════════════════════════════════════════════════════════

-- Admin user — sees ALL sections
insert into app_users (phone, name, role, sections) values
  ('+919999999999', 'Admin', 'admin', '["all"]'::jsonb);

-- ── To add more users, run this in SQL Editor: ──────────────
--
-- insert into app_users (phone, name, role, sections) values
--   ('+91XXXXXXXXXX', 'Employee Name', 'operator',
--    '["Thermopack Operator","Dryer Operator"]'::jsonb);
--
-- Available section values (must match exactly):
--   "Production"
--   "Quality Control"
--   "Batch Operator"
--   "Slurry Operator"
--   "Thermopack Operator"
--   "Dryer Operator"
--   "Store"
--   "all"   ← gives access to everything
-- ════════════════════════════════════════════════════════════
