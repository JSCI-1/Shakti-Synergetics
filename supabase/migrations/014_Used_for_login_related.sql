-- Phones must be like +919930660536 (no spaces)
update public.app_users set phone = replace(phone, ' ', '');

-- Logged-in user can read only their own row
drop policy if exists "read own user" on public.app_users;
create policy "read own user" on public.app_users
  for select to authenticated
  using (
    regexp_replace(phone, '\D', '', 'g')
    = regexp_replace(coalesce(auth.jwt() ->> 'phone', ''), '\D', '', 'g')
  );

-- OTP delivery log
create table if not exists public.otp_notification_log (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),
  phone_masked    text,
  success         boolean,
  provider_status int,
  provider_msg    text,
  provider        text
);
alter table public.otp_notification_log enable row level security;