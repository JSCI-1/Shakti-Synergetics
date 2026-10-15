-- ════════════════════════════════════════════════════════════
-- MIGRATION 023 — dryer_logs authenticated RLS fix
-- Run in: Supabase Dashboard → SQL Editor → New query
--
-- WHY THIS EXISTS
-- ---------------
-- Migration 003 created dryer_logs with ONLY `anon` policies:
--     create policy "anon_insert_dryer" ... for insert to anon ...
--     create policy "anon_select_dryer" ... for select to anon ...
-- Once an operator signs in via Supabase Auth, their requests run as
-- the `authenticated` role, which had NO insert policy. The final
-- "Save Log Sheet" button inserts into dryer_logs, so a logged-in
-- user's save was rejected with:
--     new row violates row-level security policy for table "dryer_logs"
--
-- This is the SAME class of gap already fixed for:
--   • quality_control_records  → migration 013 (authenticated_* policies)
--   • dryer_hourly_draft        → migration 018 (authenticated_* policies)
-- dryer_logs was the one table left with anon-only policies.
--
-- THE FIX
-- -------
-- ADD matching `authenticated` INSERT + SELECT policies. The existing
-- `anon` policies from 003 are left UNTOUCHED, so nothing that
-- currently works breaks.
--
-- SAFETY
-- ------
--   • NO table change, NO data change — only policy additions.
--   • Does NOT drop or recreate dryer_logs (003 does a destructive
--     `drop table ... cascade`; this file must be used INSTEAD of
--     re-running 003, which would delete every existing dryer log).
--   • `drop policy if exists` first → safely re-runnable.
--   • UPDATE is intentionally NOT granted: the "Save Log Sheet" flow
--     only INSERTs a new permanent log row (append-only), it never
--     updates an existing dryer_logs row. Grant it later only if an
--     edit-existing-log workflow is added.
-- ════════════════════════════════════════════════════════════

-- Insert: allow logged-in operators to save a completed log sheet.
drop policy if exists "authenticated_insert_dryer" on dryer_logs;
create policy "authenticated_insert_dryer"
  on dryer_logs for insert to authenticated with check (true);

-- Select: allow logged-in users (e.g. Production → Activity, reports)
-- to read saved log sheets.
drop policy if exists "authenticated_select_dryer" on dryer_logs;
create policy "authenticated_select_dryer"
  on dryer_logs for select to authenticated using (true);


-- ── Verification (optional) ──────────────────────────────────
-- After running, this should list 4 policies on dryer_logs:
--   anon_insert_dryer, anon_select_dryer,
--   authenticated_insert_dryer, authenticated_select_dryer
--
--   select policyname, roles, cmd
--   from pg_policies
--   where tablename = 'dryer_logs'
--   order by policyname;
