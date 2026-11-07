-- ─────────────────────────────────────────────────────────────────────────────
-- 056_email_queue_dedup.sql
--
-- Idea 4 — prevent duplicate dryer-log emails for the SAME entry.
-- Adds a unique dedup_key (dryer_type|date) to email_queue so the same entry
-- can never be queued/sent twice, even if the cron retries a row that already
-- went out. The database unique constraint makes this race-proof.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- Add the dedup key column (nullable so old rows are unaffected).
alter table public.email_queue
  add column if not exists dedup_key text;

-- Unique index — only enforced on non-null keys, so pre-existing rows
-- (which have NULL) are never blocked.
create unique index if not exists email_queue_dedup_key_uniq
  on public.email_queue (dedup_key)
  where dedup_key is not null;
