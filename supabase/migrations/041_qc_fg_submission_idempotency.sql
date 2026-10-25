-- ════════════════════════════════════════════════════════════
-- MIGRATION 041 — FG duplicate-submission safeguard (idempotency)
-- Run in: Supabase Dashboard → SQL Editor → New query
-- APPLY ORDER: run AFTER 006 (quality_control_records) and 040
--              (fg_shared_draft). STEP 1/2 below are applied ONLY after the
--              read-only STEP 0 pre-check (run separately) returns ZERO rows.
--
-- GOAL: a durable, cross-device guard so the SAME logical Finished Goods
-- submission can never create more than one authoritative record — even if two
-- chemists submit from different devices/browsers, or a finalize retry happens.
-- This closes the F-1 cross-device duplicate gap (frontend lastSavedSig only
-- guards a single browser session).
--
-- BUSINESS IDENTITY (five-part):
--   date | batch_no | product | grade | dryer
-- Different GRADES of the same batch are DISTINCT legitimate records (they
-- produce different keys and are each allowed).
--
-- EMPTY / NULL BATCH NUMBER:
-- The existing FG form LEGITIMATELY permits a final submission with no batch
-- number (handlePrint only requires a date OR one value; batch_no is required
-- only by the optional Production → Activity live feed, never by Save). So
-- batch-less FG rows are DELIBERATELY left OUTSIDE the unique index — the guard
-- must never block a submission the current workflow allows. If a batch-less
-- uniqueness rule is ever wanted, tighten the index predicate; do not weaken it
-- here.
--
-- SAFETY — ADDITIVE ONLY:
--   • Adds ONE nullable generated column + ONE partial unique index.
--   • Does NOT alter or drop any existing column or constraint.
--   • Does NOT delete, merge, or modify any existing row.
--   • Does NOT touch the Sheets trigger (022), Google Sheets routing,
--     Production Activity (qc_activity_draft), the sieve/moisture tables
--     (028/038), Edge Functions, or Code.gs.
--   • RM/IP rows get a NULL key (CASE guard) and are NEVER constrained.
--   • A rejected duplicate insert never creates a row, so it never fires the
--     Sheets trigger → no duplicate sheet event.
-- Re-runnable (if-not-exists guards).
--
-- ROLLBACK:
--   drop index if exists quality_control_records_fg_submission_key_uq;
--   alter table quality_control_records drop column if exists fg_submission_key;
-- (No data loss — the column is derived; existing rows and sync are unaffected.)
-- ════════════════════════════════════════════════════════════


-- ── STEP 0 — READ-ONLY PRE-CHECK (run this SELECT FIRST, on its own) ─────────
-- If this returns ANY rows, STOP. There are pre-existing FG records that share
-- a five-part identity (with a non-empty batch_no), which would make STEP 2's
-- unique index fail. Do NOT delete, merge, or alter them automatically — review
-- them with the owner first, then re-run the pre-check until it is empty.
--
--   select
--     coalesce(values->>'date','')     as date,
--     coalesce(values->>'batch_no','') as batch_no,
--     coalesce(values->>'product','')  as product,
--     coalesce(values->>'grade','')    as grade,
--     coalesce(values->>'dryer','')    as dryer,
--     count(*)                          as n,
--     array_agg(id order by created_at) as ids
--   from quality_control_records
--   where tab = 'fg'
--     and coalesce(values->>'batch_no','') <> ''
--   group by 1,2,3,4,5
--   having count(*) > 1;
--
-- Proceed to STEP 1 / STEP 2 ONLY when the pre-check returns zero rows.


-- ── STEP 1 — generated identity column (nullable; computed only for FG) ──────
-- RM/IP rows → NULL (the CASE guard), so they can never be constrained. The key
-- is computed for batch-less FG rows too (useful for diagnostics) but the index
-- in STEP 2 excludes them.
alter table quality_control_records
  add column if not exists fg_submission_key text
  generated always as (
    case when tab = 'fg' then
      coalesce(values->>'date','')     || '|' ||
      coalesce(values->>'batch_no','') || '|' ||
      coalesce(values->>'product','')  || '|' ||
      coalesce(values->>'grade','')    || '|' ||
      coalesce(values->>'dryer','')
    else null end
  ) stored;


-- ── STEP 2 — partial unique index: FG ONLY, non-empty batch_no ONLY ──────────
-- Enforces one authoritative FG record per five-part identity. RM/IP (NULL key)
-- and batch-less FG rows are intentionally OUTSIDE this index.
create unique index if not exists quality_control_records_fg_submission_key_uq
  on quality_control_records (fg_submission_key)
  where tab = 'fg'
    and fg_submission_key is not null
    and coalesce(values->>'batch_no','') <> '';
