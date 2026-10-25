-- ════════════════════════════════════════════════════════════
-- MIGRATION 040 — Finished Goods SHARED DRAFT (cross-chemist, server-backed)
-- Run in: Supabase Dashboard → SQL Editor → New query
-- APPLY ORDER: run AFTER 007 (app_users), 014 (auth.jwt phone policy),
--              and 038 (QC FG tables already exist).
--
-- GOAL: let up to three chemists collaborate on the SAME Finished Goods form
-- for the SAME batch, across different logins / browsers / computers. When one
-- chemist stops, the next opens the same batch and sees every successfully
-- server-saved field (and the sieve / moisture reading logs), then continues.
--
-- This is the FG parallel of dryer_hourly_draft (migration 018): a SHARED,
-- TEMPORARY, cross-device draft that is the source of truth WHILE the form is
-- being filled. It is SEPARATE from — and never replaces:
--   • quality_control_records (006) — the PERMANENT report saved on "Save".
--   • qc_activity_draft (020/039) — the Production → Activity live feed.
--   • qc_fg_sieve_readings (028) / qc_fg_moisture_readings (038) — the live
--     Google-Sheets reading feeds.
--
-- CRITICAL DIFFERENCES FROM THE OLDER DRAFT TABLES (deliberate):
--   1. NO `anon` access. QC drafts may contain in-progress lab data, so access
--      is restricted to AUTHENTICATED users who are authorized for Quality
--      Control (sections contains 'quality' or 'all', or role 'admin').
--   2. NO sheets_sync_outbox trigger. This table must NEVER reach Google Sheets
--      (only the existing permanent/record and sieve/moisture paths do).
--   3. A `revision` integer for optimistic concurrency + a visible conflict
--      mechanism in the UI (the payload itself carries unresolved conflicts;
--      the DB only guarantees that a stale writer cannot silently clobber a
--      newer revision — the app does a version-checked update).
--   4. A `finalized` flag so a submitted batch cannot silently reopen as an
--      editable active draft.
--
-- SAFETY: additive only. Creates ONE new table + one helper function + RLS.
-- Does NOT touch quality_control_records, qc_activity_draft, qc_fg_sieve_readings,
-- qc_fg_moisture_readings, dryer_hourly_draft, app_users, the outbox, Code.gs,
-- Edge Functions, or any existing trigger / constraint. Re-runnable
-- (drop-if-exists / if-not-exists guards). No production data is modified.
-- ════════════════════════════════════════════════════════════


-- ── Authorization helper: is the current JWT a Quality-Control user? ─────────
-- SECURITY DEFINER so it can read app_users regardless of that table's own RLS,
-- with a pinned search_path. Matches the caller's JWT phone (digits only) to an
-- active app_users row that has QC access. Mirrors the phone-normalization in
-- migration 014's "read own user" policy.
create or replace function public.is_qc_user()
  returns boolean
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.app_users u
    where u.is_active
      and regexp_replace(u.phone, '\D', '', 'g')
          = regexp_replace(coalesce(auth.jwt() ->> 'phone', ''), '\D', '', 'g')
      and (
            u.role = 'admin'
         or u.sections ?| array['quality', 'all']
          )
  );
$$;

revoke all on function public.is_qc_user() from public, anon;
grant execute on function public.is_qc_user() to authenticated;


-- ── TABLE: fg_shared_draft ───────────────────────────────────────────────────
create table if not exists fg_shared_draft (
  id            uuid default gen_random_uuid() primary key,

  -- Business identity of ONE Finished Goods batch form.
  log_date      date not null,                 -- FG Manufactured Date (fgDraft.date)
  batch_no      text,                           -- nullable; coalesced in the unique index
  product       text not null,                  -- FG product id (fgDraft.selected)
  grade         text not null,                  -- 'normal' | 'export' | 'omri' | 'colour'
  dryer         text not null,                  -- 'ND1' | 'ND2'

  -- The FULL fgDraft object for this identity (all scalars + the per-(dryer,
  -- grade) buckets + sieve/moisture logs + __ts). Source inputs are stored;
  -- derived/calculated values are recomputed by the UI on restore.
  payload       jsonb not null default '{}'::jsonb,

  -- Optimistic-concurrency counter. Every successful save increments it. A
  -- writer sends the revision it based its edit on; the UPDATE only applies
  -- when the stored revision still matches (see the app's version-checked
  -- update), so a stale device cannot silently overwrite newer work.
  revision      integer not null default 0,

  -- Once the batch is finally submitted to quality_control_records, this is set
  -- true so the draft cannot silently reopen as an editable active draft.
  finalized     boolean not null default false,

  -- Audit — do NOT overwrite the original chemist's identity on resume.
  created_by    text,                           -- app_users.name of the first chemist
  updated_by    text,                           -- app_users.name of the last writer

  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  last_saved_at timestamptz default now()       -- expiry basis (active view)
);

-- One shared draft per (date, batch, product, grade, dryer). batch_no is
-- coalesced to '' so an EMPTY batch number is a single, well-defined key and
-- NULLs do not defeat uniqueness (Postgres treats NULLs as distinct in a plain
-- UNIQUE constraint — a unique INDEX on coalesce() fixes that). This both
-- prevents duplicate drafts for one batch AND stops unrelated incomplete forms
-- from ever sharing a single row.
create unique index if not exists fg_shared_draft_identity_key
  on fg_shared_draft (log_date, coalesce(batch_no, ''), product, grade, dryer);


-- ── RLS — authenticated QC users ONLY (no anon) ──────────────────────────────
alter table fg_shared_draft enable row level security;

drop policy if exists "qc_select_fg_shared_draft" on fg_shared_draft;
create policy "qc_select_fg_shared_draft"
  on fg_shared_draft for select to authenticated
  using (public.is_qc_user());

drop policy if exists "qc_insert_fg_shared_draft" on fg_shared_draft;
create policy "qc_insert_fg_shared_draft"
  on fg_shared_draft for insert to authenticated
  with check (public.is_qc_user());

drop policy if exists "qc_update_fg_shared_draft" on fg_shared_draft;
create policy "qc_update_fg_shared_draft"
  on fg_shared_draft for update to authenticated
  using (public.is_qc_user())
  with check (public.is_qc_user());

-- NOTE: intentionally NO delete policy and NO anon policies. Drafts are hidden
-- by the 36h active view below, never deleted by the client.


-- ── Realtime (optional; the app also polls every 15s as the primary path) ────
-- Full replica identity so UPDATE payloads carry all columns for any future
-- Realtime subscriber. The app's 15s poll is the primary sync path and works
-- even if Realtime is disabled for the project.
alter table fg_shared_draft replica identity full;

do $$
begin
  alter publication supabase_realtime add table fg_shared_draft;
exception
  when duplicate_object then null;   -- already in the publication
  when undefined_object then null;   -- publication absent → poll fallback still works
end
$$;


-- ── 36-hour active view (hide, never delete) ─────────────────────────────────
-- Mirrors the dryer / activity windows. An unfinalized draft stays visible for
-- 36h after its last save (covers a day→night→next-day handover). Finalized
-- drafts are excluded so a submitted batch never reappears as resumable.
-- security_invoker so the view respects the caller's RLS (PG15+).
drop view if exists fg_shared_draft_active;
create view fg_shared_draft_active
  with (security_invoker = true) as
  select *
  from fg_shared_draft
  where finalized = false
    and last_saved_at > now() - interval '36 hours';
