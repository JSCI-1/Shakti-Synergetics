-- ─────────────────────────────────────────────────────────────────────────────
-- 054_email_queue.sql
--
-- Email retry queue for the dryer log email notification system.
-- When the Edge Function send-dryer-email fails, the payload is written here
-- and a pg_cron job retries it every 5 minutes up to 3 times.
--
-- Safe to re-run — all statements use if not exists / drop if exists.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── email_queue table ────────────────────────────────────────────────────────
create table if not exists public.email_queue (
  id            bigserial     primary key,
  created_at    timestamptz   not null default now(),
  last_tried_at timestamptz,
  next_retry_at timestamptz   not null default now(),
  retry_count   int           not null default 0,
  status        text          not null default 'pending'
                              check (status in ('pending', 'sent', 'failed')),
  error         text,
  subject       text,
  payload       jsonb         not null
);

-- Only the service role (Edge Functions) can read/write this table.
alter table public.email_queue enable row level security;

-- Drop first so re-runs never fail on duplicate policy name.
drop policy if exists "service role full access" on public.email_queue;
create policy "service role full access"
  on public.email_queue
  for all
  to service_role
  using (true)
  with check (true);

-- Index for the cron job — only scans pending rows due for retry.
create index if not exists email_queue_pending_idx
  on public.email_queue (next_retry_at)
  where status = 'pending';

-- ── pg_cron job — retries pending emails every 5 minutes ────────────────────
-- Drop first so re-runs never fail on duplicate job name.
select cron.unschedule('retry-dryer-email-queue');

select cron.schedule(
  'retry-dryer-email-queue',
  '*/5 * * * *',
  $$
    select net.http_post(
      url     := 'https://ueslbvlmzulsoofyucac.supabase.co/functions/v1/send-dryer-email',
      body    := '{"_retry":true}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer sb_publishable_hm2crhObn-03oDNKnUjWSg_lBagzdFL'
      )
    );
  $$
);
