-- ════════════════════════════════════════════════════════════
-- MIGRATION 043 — Thermopack Hourly Draft: SHARED across operators
-- Run in: Supabase Dashboard → SQL Editor → New query
-- APPLY ORDER: after 033.
--
-- WHY: there is more than one Thermopack operator, and they must see the
-- hourly rows each other has saved (like the Dryer hourly draft, which is
-- shared on (dryer_type, log_date, hour)). Previously the Thermopack hourly
-- draft was keyed by a per-fill-session `draft_key`, so each operator had a
-- separate set of rows and never saw the others'.
--
-- WHAT: switch the sharing key to (log_date, variant, hour). Add a `log_date`
-- column, backfill it from saved_at, and replace the unique constraint so a
-- per-hour Save UPSERTS onto the SHARED (date, variant, hour) row. Any operator
-- reading the same (date, variant) now sees every saved hour.
--
-- THERMOPACK-ONLY and additive where possible. It does NOT touch
-- dryer_hourly_draft, QC, or any shared sync object. The sync trigger
-- (tg_thermo_sync_hourly) is unchanged — it still fires per row.
--
-- NOTE: draft_key is kept (nullable) for backward compatibility but is no
-- longer part of the uniqueness key.
-- ════════════════════════════════════════════════════════════

-- 1. Add the shared date column.
alter table thermopack_hourly_draft
  add column if not exists log_date date;

-- 2. Backfill log_date for existing rows from saved_at (IST date).
update thermopack_hourly_draft
   set log_date = (saved_at at time zone 'Asia/Kolkata')::date
 where log_date is null;

-- 3. draft_key is no longer required to be present (kept for history).
alter table thermopack_hourly_draft
  alter column draft_key drop not null;

-- 4. Replace the uniqueness key: drop the old (draft_key, variant, hour) and
--    add (log_date, variant, hour) so all operators converge on one row per
--    (date, variant, hour). If duplicate (date,variant,hour) rows exist from
--    the old model, keep the most-recently-saved and delete the rest first so
--    the new unique index can be created.
delete from thermopack_hourly_draft a
 using thermopack_hourly_draft b
 where a.log_date = b.log_date
   and a.variant  = b.variant
   and a.hour     = b.hour
   and a.saved_at < b.saved_at;

alter table thermopack_hourly_draft
  drop constraint if exists thermopack_hourly_draft_draft_key_variant_hour_key;

-- Some Postgres versions auto-name the constraint differently; drop by the
-- known auto-name above, then ensure the new one exists.
create unique index if not exists thermopack_hourly_draft_date_variant_hour_key
  on thermopack_hourly_draft (log_date, variant, hour);
