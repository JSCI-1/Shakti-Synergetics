-- ════════════════════════════════════════════════════════════
-- MIGRATION 048 — COA (Certificate of Analysis) MODULE
-- Run in: Supabase Dashboard → SQL Editor → New query
-- APPLY ORDER: run AFTER 006 (quality_control_records), 007 (app_users),
--              014 (JWT phone policy) and 040 (fg_shared_draft → provides the
--              public.is_qc_user() helper this migration REUSES).
--
-- GOAL: back the editable, multi-batch COA module. An operator picks a party,
-- adds one or more saved QC/FG batches, edits the whole certificate, saves a
-- draft (cross-device, with optimistic concurrency), then finalizes an
-- IMMUTABLE issued snapshot and prints/downloads a PDF.
--
-- DESIGN (mirrors fg_shared_draft / 040 deliberately so the proven concurrency,
-- finalize-lock and RLS patterns carry over 1:1):
--   • coa_draft        — one editable certificate in progress. The ACTIVE report
--                        is rendered exclusively from this row after load, so an
--                        edited value REPLACES the previous value everywhere
--                        (active report, preview, reopened draft, other device,
--                        PDF). `revision` gives optimistic concurrency; a stale
--                        write can never clobber a newer one. `finalized` locks
--                        the draft once issued.
--   • coa_batch_entry  — one row per batch added to a COA (one PDF column each).
--                        `loaded_values` is an IMMUTABLE snapshot of the
--                        authoritative source row at add time; per-batch EDITS
--                        live in coa_draft.edited_values keyed by entry id, so
--                        adding/removing a batch never disturbs another batch's
--                        edits. A unique constraint prevents duplicate columns.
--   • coa_issued       — immutable issued snapshot written at finalize. A unique
--                        certificate_no makes finalize idempotent (repeated
--                        clicks never create a second record). `supersedes`
--                        chains a correction to a NEW superseding certificate;
--                        an already-issued row is never silently changed.
--
-- SOURCE-OF-TRUTH SAFETY: COA READS quality_control_records as its source and
-- NEVER writes it on ordinary edits (there is no FK cascade back into it and no
-- trigger that mutates it). An authorized source correction is a separate
-- workflow, out of scope here.
--
-- SAFETY — ADDITIVE ONLY. Creates three new tables + their RLS + one active
-- view. Does NOT touch quality_control_records, fg_shared_draft, qc_activity_draft,
-- the sieve/moisture tables, the Sheets outbox/triggers, Code.gs or Edge
-- Functions. No COA table has a Sheets outbox trigger, so COA data never reaches
-- Google Sheets. Re-runnable (drop-if-exists / if-not-exists guards). No
-- existing row is modified.
--
-- ROLLBACK:
--   drop view  if exists coa_draft_active;
--   drop table if exists coa_issued;
--   drop table if exists coa_batch_entry;
--   drop table if exists coa_draft;
-- (public.is_qc_user() is owned by migration 040 and is left in place.)
-- ════════════════════════════════════════════════════════════


-- ── TABLE: coa_draft ─────────────────────────────────────────────────────────
-- One editable certificate in progress = the single source of truth for the
-- ACTIVE report after load.
create table if not exists coa_draft (
  id               uuid default gen_random_uuid() primary key,

  party_key        text not null,                      -- 'lohiya','export','adama','farmalinx',…
  template_version integer not null default 1,         -- pins the party template layout version
  product          text,                               -- FG product id (optional filter / display)

  -- Editable certificate-level fields: header / dispatch / dates / vehicle no /
  -- quantity / packing / remarks / conformity / signatures. Free-form JSON keyed
  -- by field id so the per-party template decides which keys exist.
  header           jsonb not null default '{}'::jsonb,

  -- Per-batch editable OVERRIDES, keyed by coa_batch_entry.id → { fieldId: value }.
  -- The renderer reads edited_values[entryId][fieldId] with FALLBACK to the
  -- batch entry's immutable loaded_values[fieldId]. Writing an edit REPLACES the
  -- key in place (object assignment) — it never appends a row or a second value,
  -- so the previous value is not shown anywhere in the active report.
  edited_values    jsonb not null default '{}'::jsonb,

  -- Spec text/units captured from the party template at creation, so an issued
  -- certificate's specifications are reproducible even if the template changes.
  spec_snapshot    jsonb not null default '{}'::jsonb,

  -- Ordered list of coa_batch_entry ids → column order in the report.
  batch_order      jsonb not null default '[]'::jsonb,

  -- Optimistic-concurrency counter. Every successful save increments it; a
  -- version-checked UPDATE (.eq('revision', baseRev)) means a stale device can
  -- never silently overwrite newer work. Identical semantics to 040.
  revision         integer not null default 0,

  status           text not null default 'draft',      -- 'draft' | 'finalized'
  finalized        boolean not null default false,      -- locks the draft after issue

  created_by       text,                                -- app_users.name of first author
  updated_by       text,                                -- app_users.name of last writer
  created_at       timestamptz default now(),
  updated_at       timestamptz default now(),
  last_saved_at    timestamptz default now()            -- active-view expiry basis
);


-- ── TABLE: coa_batch_entry ─────────────────────────────────────────────────────
-- One batch added to a COA = one report/PDF column.
create table if not exists coa_batch_entry (
  id               uuid default gen_random_uuid() primary key,
  coa_draft_id     uuid not null references coa_draft(id) on delete cascade,

  -- The authoritative QC/FG row this batch loaded from (nullable: lets the
  -- source row be archived without destroying the COA column).
  source_record_id uuid references quality_control_records(id),

  -- Resolved batch identity (the disambiguation result — never "first match").
  batch_no         text not null,
  log_date         date,
  product          text,
  grade            text,
  dryer            text,

  -- IMMUTABLE snapshot of the authoritative source values at add time. Edits do
  -- NOT change this; they live in coa_draft.edited_values keyed by this id.
  loaded_values    jsonb not null default '{}'::jsonb,

  position         integer not null default 0,          -- column order
  created_at       timestamptz default now(),

  -- Never duplicate a batch column: one entry per (draft, five-part identity).
  unique (coa_draft_id, batch_no, log_date, grade, dryer)
);

create index if not exists coa_batch_entry_draft_idx
  on coa_batch_entry (coa_draft_id);


-- ── TABLE: coa_issued ──────────────────────────────────────────────────────────
-- Immutable issued snapshot written at finalize.
create table if not exists coa_issued (
  id               uuid default gen_random_uuid() primary key,
  coa_draft_id     uuid references coa_draft(id),       -- provenance (not a cascade)

  certificate_no   text not null,                       -- unique → idempotent finalize
  party_key        text not null,
  template_version integer not null,

  -- Full rendered certificate state at issue time (header + every batch column +
  -- specs). Immutable: an issued certificate is never silently edited; a
  -- correction creates a NEW row with `supersedes` set.
  snapshot         jsonb not null,

  supersedes       uuid references coa_issued(id),      -- correction chain

  issued_by        text,
  issued_at        timestamptz default now(),

  unique (certificate_no)
);

create index if not exists coa_issued_party_idx
  on coa_issued (party_key, issued_at desc);


-- ── RLS — authenticated QC users ONLY (no anon), mirroring the 040 posture ─────
-- public.is_qc_user() is defined by migration 040 (SECURITY DEFINER, pinned
-- search_path, JWT-phone match against app_users with role 'admin' or sections
-- containing 'quality'/'all'). COA drafts hold in-progress certificate data, so
-- they use the same strict gate: authenticated-only, no anon, no delete policy.

-- coa_draft
alter table coa_draft enable row level security;

drop policy if exists "qc_select_coa_draft" on coa_draft;
create policy "qc_select_coa_draft"
  on coa_draft for select to authenticated
  using (public.is_qc_user());

drop policy if exists "qc_insert_coa_draft" on coa_draft;
create policy "qc_insert_coa_draft"
  on coa_draft for insert to authenticated
  with check (public.is_qc_user());

drop policy if exists "qc_update_coa_draft" on coa_draft;
create policy "qc_update_coa_draft"
  on coa_draft for update to authenticated
  using (public.is_qc_user())
  with check (public.is_qc_user());

-- coa_batch_entry
alter table coa_batch_entry enable row level security;

drop policy if exists "qc_select_coa_batch_entry" on coa_batch_entry;
create policy "qc_select_coa_batch_entry"
  on coa_batch_entry for select to authenticated
  using (public.is_qc_user());

drop policy if exists "qc_insert_coa_batch_entry" on coa_batch_entry;
create policy "qc_insert_coa_batch_entry"
  on coa_batch_entry for insert to authenticated
  with check (public.is_qc_user());

drop policy if exists "qc_update_coa_batch_entry" on coa_batch_entry;
create policy "qc_update_coa_batch_entry"
  on coa_batch_entry for update to authenticated
  using (public.is_qc_user())
  with check (public.is_qc_user());

-- Batch entries for an UNfinalized draft may be removed (Remove Batch). Once the
-- parent draft is finalized the issued snapshot is the record of truth, so the
-- draft (and its entries) are no longer edited by the app. We allow delete to
-- authenticated QC users but scope it to entries whose parent draft is not
-- finalized, so a finalized certificate's columns cannot be deleted out from
-- under it.
drop policy if exists "qc_delete_coa_batch_entry" on coa_batch_entry;
create policy "qc_delete_coa_batch_entry"
  on coa_batch_entry for delete to authenticated
  using (
    public.is_qc_user()
    and exists (
      select 1 from coa_draft d
      where d.id = coa_batch_entry.coa_draft_id
        and d.finalized = false
    )
  );

-- coa_issued — insert + select only. No update / delete policy: an issued
-- certificate is immutable; corrections insert a NEW superseding row.
alter table coa_issued enable row level security;

drop policy if exists "qc_select_coa_issued" on coa_issued;
create policy "qc_select_coa_issued"
  on coa_issued for select to authenticated
  using (public.is_qc_user());

drop policy if exists "qc_insert_coa_issued" on coa_issued;
create policy "qc_insert_coa_issued"
  on coa_issued for insert to authenticated
  with check (public.is_qc_user());


-- ── Realtime (optional; the app also polls as the primary sync path) ───────────
alter table coa_draft replica identity full;
do $$
begin
  alter publication supabase_realtime add table coa_draft;
exception
  when duplicate_object then null;
  when undefined_object then null;
end
$$;


-- ── 36-hour active view (hide finalized / stale drafts; never delete) ──────────
-- Mirrors fg_shared_draft_active. security_invoker so the view respects the
-- caller's RLS (PG15+).
drop view if exists coa_draft_active;
create view coa_draft_active
  with (security_invoker = true) as
  select *
  from coa_draft
  where finalized = false
    and last_saved_at > now() - interval '36 hours';
