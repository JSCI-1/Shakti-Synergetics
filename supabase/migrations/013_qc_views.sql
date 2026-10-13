-- ════════════════════════════════════════════════════════════
-- MIGRATION 013 — Quality Control Views
-- Run in: Supabase Dashboard → SQL Editor → New query
--
-- These are READ-ONLY views that unpack the values JSONB column
-- into named columns for easy reporting.
-- Safe to run on a live database — no table changes, no data loss.
-- ════════════════════════════════════════════════════════════


-- ────────────────────────────────────────────────────────────
-- DROP existing views first.
--
-- Why: PostgreSQL's `CREATE OR REPLACE VIEW` can only ADD new
-- columns at the END of the column list — it cannot insert,
-- reorder, or rename existing columns. The earlier version of
-- qc_finished_goods / qc_all placed the new fg_dryer, fg_shift,
-- … columns BEFORE the existing numeric columns, so Postgres
-- read it as "rename column 5 (sulphur_content_pct) → fg_dryer"
-- and raised:
--   ERROR 42P16: cannot change name of view column ...
--
-- Dropping first lets the views be rebuilt from scratch with any
-- column order. These are plain reporting views over
-- quality_control_records — nothing persistent depends on them,
-- so dropping and recreating is safe and loses no table data.
-- IF EXISTS keeps the script re-runnable on a fresh database.
-- ────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS qc_all;
DROP VIEW IF EXISTS qc_finished_goods;
DROP VIEW IF EXISTS qc_in_process_mills;
DROP VIEW IF EXISTS qc_in_process;
DROP VIEW IF EXISTS qc_raw_materials;


-- ────────────────────────────────────────────────────────────
-- VIEW 1: qc_raw_materials
-- One row per RM quality check record.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW qc_raw_materials AS
SELECT
  id,
  created_at,
  date,
  tested_by,

  -- Sulphur Powder
  (values->>'sulphurPowder_purity')::numeric    AS sp_purity_pct,
  (values->>'sulphurPowder_meshSize')::numeric  AS sp_mesh_size_pct,

  -- Ligno (Sodium Ligno Sulphonate)
  (values->>'ligno_ph')::numeric                AS ligno_ph,
  values->>'ligno_solubility'                   AS ligno_solubility,
  (values->>'ligno_moisture')::numeric          AS ligno_moisture_pct,

  -- China Clay
  (values->>'clay_ph')::numeric                 AS clay_ph,
  (values->>'clay_sed10')::numeric              AS clay_sedimentation_10min_ml,
  (values->>'clay_sed30')::numeric              AS clay_sedimentation_30min_ml,
  (values->>'clay_moisture')::numeric           AS clay_moisture_pct,

  -- DN Powder / Liquid (Gujmol)
  (values->>'dn_ph')::numeric                   AS dn_ph,
  values->>'dn_solubility'                      AS dn_solubility,
  (values->>'dn_moisture')::numeric             AS dn_moisture_pct,
  (values->>'dn_solid')::numeric                AS dn_solid_content_pct,

  -- Coal
  (values->>'coal_moisture')::numeric           AS coal_moisture_pct,

  -- Micro Media
  (values->>'mm_density')::numeric              AS mm_density_gcc,
  (values->>'mm_diameter')::numeric             AS mm_diameter_mm,
  values->>'mm_finish'                          AS mm_finish

FROM quality_control_records
WHERE tab = 'rm'
ORDER BY date DESC, created_at DESC;


-- ────────────────────────────────────────────────────────────
-- VIEW 2: qc_in_process
-- One row per In-Process quality check record.
-- Mill-wise rows are kept as JSONB (use qc_in_process_mills
-- below for per-mill reporting).
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW qc_in_process AS
SELECT
  id,
  created_at,
  date,
  tested_by,

  -- Solid Content (Moisture formula)
  (values->>'ip_moisture_calc')::numeric        AS solid_content_pct,

  -- Sulphur Content
  (values->>'ip_sulphur_calc')::numeric         AS sulphur_content_pct,

  -- Suspensibility
  (values->>'ip_susp_calc')::numeric            AS suspensibility_pct,

  -- Wet Sieve
  (values->>'ip_wetsieve_calc')::numeric        AS wet_sieve_pct,

  -- Mill-wise Suspensibility (raw JSONB array)
  -- Shape: [{ mill, br, flowRate, pass }, ...]
  values->'ip_mill_rows'                        AS mill_rows_json

FROM quality_control_records
WHERE tab = 'ip'
ORDER BY date DESC, created_at DESC;


-- ────────────────────────────────────────────────────────────
-- VIEW 3: qc_in_process_mills
-- Mill-wise suspensibility unnested — one row per mill per record.
-- Useful for per-mill trend reports.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW qc_in_process_mills AS
SELECT
  q.id,
  q.created_at,
  q.date,
  q.tested_by,
  (q.values->>'ip_sulphur_calc')::numeric       AS sulphur_content_pct,
  (q.values->>'ip_susp_calc')::numeric          AS suspensibility_pct,
  mill->>'mill'                                 AS mill,
  (mill->>'br')::numeric                        AS burette_reading_ml,
  (mill->>'flowRate')::numeric                  AS flow_rate_lph,
  mill->>'pass'                                 AS pass_status
FROM quality_control_records q,
     jsonb_array_elements(
       CASE
         WHEN jsonb_typeof(q.values->'ip_mill_rows') = 'array'
         THEN q.values->'ip_mill_rows'
         ELSE '[]'::jsonb
       END
     ) AS mill
WHERE q.tab = 'ip'
ORDER BY q.date DESC, mill->>'mill';


-- ────────────────────────────────────────────────────────────
-- VIEW 4: qc_finished_goods
-- One row per Finished Goods quality check record.
-- Covers core WDG tests + UPL Export + UPL OMRI parameters.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW qc_finished_goods AS
SELECT
  id,
  created_at,
  date,
  tested_by,

  -- Finished Goods report meta (newly persisted in values jsonb)
  values->>'dryer'                              AS fg_dryer,        -- ND1 | ND2
  values->>'shift'                              AS fg_shift,        -- null until an FG shift input exists
  values->>'batch_no'                           AS fg_batch_no,
  values->>'time'                               AS fg_time,
  values->>'brand'                              AS fg_brand,
  values->>'product'                            AS fg_product,
  values->>'grade'                              AS fg_grade,

  -- Core tests
  (values->>'fg_sulphur')::numeric              AS sulphur_content_pct,
  (values->>'fg_susp')::numeric                 AS suspensibility_pct,
  -- Moisture is now a direct % value (single input), not a formula result.
  -- Storage key 'fg_moisture' is unchanged so this mapping still holds.
  (values->>'fg_moisture')::numeric             AS moisture_pct,
  (values->>'fg_bulk')::numeric                 AS bulk_density_gcc,
  (values->>'fg_wetSieve')::numeric             AS wet_sieve_pct,
  (values->>'fg_drySieve')::numeric             AS dry_sieve_pct,
  (values->>'fg_ph')::numeric                   AS ph,
  (values->>'fg_wettability')::numeric          AS wettability_sec,
  (values->>'fg_foam_start')::numeric           AS foam_start_ml,
  (values->>'fg_foam_1min')::numeric            AS foam_1min_ml,

  -- UPL Export Grade
  (values->>'upl_exp_ps_10')::numeric           AS upl_exp_particle_gt10um_pct,
  (values->>'upl_exp_ps_6')::numeric            AS upl_exp_particle_gt6um_pct,
  (values->>'upl_exp_ps_1')::numeric            AS upl_exp_particle_gt1um_pct,
  (values->>'upl_exp_ws_160')::numeric          AS upl_exp_wet_sieve_160um_pct,
  (values->>'upl_exp_ws_25')::numeric           AS upl_exp_wet_sieve_25um_pct,
  (values->>'upl_exp_df_0')::numeric            AS upl_exp_foam_0min_ml,
  (values->>'upl_exp_df_1')::numeric            AS upl_exp_foam_1min_ml,
  (values->>'upl_exp_df_2')::numeric            AS upl_exp_foam_2min_ml,
  (values->>'upl_exp_df_5')::numeric            AS upl_exp_foam_5min_ml,
  (values->>'upl_exp_wps')::numeric             AS upl_exp_wet_particle_um,
  (values->>'upl_exp_alk')::numeric             AS upl_exp_alkalinity_pct,
  values->>'upl_exp_disp'                       AS upl_exp_dispersibility,

  -- UPL OMRI Grade
  (values->>'upl_omri_ps_10')::numeric          AS upl_omri_particle_gt10um_pct,
  (values->>'upl_omri_ps_6')::numeric           AS upl_omri_particle_gt6um_pct,
  (values->>'upl_omri_ps_1')::numeric           AS upl_omri_particle_gt1um_pct,
  (values->>'upl_omri_ds_500')::numeric         AS upl_omri_dry_sieve_500um_pct,
  (values->>'upl_omri_ds_106')::numeric         AS upl_omri_dry_sieve_106um_pct,
  values->>'upl_omri_disp_self'                 AS upl_omri_disp_self,
  values->>'upl_omri_disp_1h'                   AS upl_omri_disp_1h,
  values->>'upl_omri_disp_24h'                  AS upl_omri_disp_24h,
  (values->>'upl_omri_ws_160')::numeric         AS upl_omri_wet_sieve_160um_pct,
  (values->>'upl_omri_ws_25')::numeric          AS upl_omri_wet_sieve_25um_pct

FROM quality_control_records
WHERE tab = 'fg'
ORDER BY date DESC, created_at DESC;


-- ────────────────────────────────────────────────────────────
-- VIEW 5: qc_all
-- Combined view — all three tabs in one result set.
-- tab column = 'rm' | 'ip' | 'fg'
-- Columns not relevant to a tab will be NULL.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW qc_all AS
SELECT
  id,
  created_at,
  tab,
  date,
  tested_by,

  -- ── RAW MATERIALS ──
  (values->>'sulphurPowder_purity')::numeric    AS rm_sp_purity_pct,
  (values->>'sulphurPowder_meshSize')::numeric  AS rm_sp_mesh_size_pct,
  (values->>'ligno_ph')::numeric                AS rm_ligno_ph,
  values->>'ligno_solubility'                   AS rm_ligno_solubility,
  (values->>'ligno_moisture')::numeric          AS rm_ligno_moisture_pct,
  (values->>'clay_ph')::numeric                 AS rm_clay_ph,
  (values->>'clay_sed10')::numeric              AS rm_clay_sed10_ml,
  (values->>'clay_sed30')::numeric              AS rm_clay_sed30_ml,
  (values->>'clay_moisture')::numeric           AS rm_clay_moisture_pct,
  (values->>'dn_ph')::numeric                   AS rm_dn_ph,
  values->>'dn_solubility'                      AS rm_dn_solubility,
  (values->>'dn_moisture')::numeric             AS rm_dn_moisture_pct,
  (values->>'dn_solid')::numeric                AS rm_dn_solid_content_pct,
  (values->>'coal_moisture')::numeric           AS rm_coal_moisture_pct,
  (values->>'mm_density')::numeric              AS rm_mm_density_gcc,
  (values->>'mm_diameter')::numeric             AS rm_mm_diameter_mm,
  values->>'mm_finish'                          AS rm_mm_finish,

  -- ── IN-PROCESS ──
  (values->>'ip_moisture_calc')::numeric        AS ip_solid_content_pct,
  (values->>'ip_sulphur_calc')::numeric         AS ip_sulphur_content_pct,
  (values->>'ip_susp_calc')::numeric            AS ip_suspensibility_pct,
  (values->>'ip_wetsieve_calc')::numeric        AS ip_wet_sieve_pct,
  values->'ip_mill_rows'                        AS ip_mill_rows_json,

  -- ── FINISHED GOODS ──
  -- Report meta (newly persisted in values jsonb)
  values->>'dryer'                              AS fg_dryer,        -- ND1 | ND2
  values->>'shift'                              AS fg_shift,        -- null until an FG shift input exists
  values->>'batch_no'                           AS fg_batch_no,
  values->>'time'                               AS fg_time,
  values->>'brand'                              AS fg_brand,
  values->>'product'                            AS fg_product,
  values->>'grade'                              AS fg_grade,

  (values->>'fg_sulphur')::numeric              AS fg_sulphur_content_pct,
  (values->>'fg_susp')::numeric                 AS fg_suspensibility_pct,
  -- Moisture is now a direct % value (single input), not a formula result.
  (values->>'fg_moisture')::numeric             AS fg_moisture_pct,
  (values->>'fg_bulk')::numeric                 AS fg_bulk_density_gcc,
  (values->>'fg_wetSieve')::numeric             AS fg_wet_sieve_pct,
  (values->>'fg_drySieve')::numeric             AS fg_dry_sieve_pct,
  (values->>'fg_ph')::numeric                   AS fg_ph,
  (values->>'fg_wettability')::numeric          AS fg_wettability_sec,
  (values->>'fg_foam_start')::numeric           AS fg_foam_start_ml,
  (values->>'fg_foam_1min')::numeric            AS fg_foam_1min_ml,
  (values->>'upl_exp_ps_10')::numeric           AS fg_upl_exp_particle_gt10um_pct,
  (values->>'upl_exp_ps_6')::numeric            AS fg_upl_exp_particle_gt6um_pct,
  (values->>'upl_exp_ps_1')::numeric            AS fg_upl_exp_particle_gt1um_pct,
  (values->>'upl_exp_ws_160')::numeric          AS fg_upl_exp_wet_sieve_160um_pct,
  (values->>'upl_exp_ws_25')::numeric           AS fg_upl_exp_wet_sieve_25um_pct,
  (values->>'upl_exp_df_0')::numeric            AS fg_upl_exp_foam_0min_ml,
  (values->>'upl_exp_df_1')::numeric            AS fg_upl_exp_foam_1min_ml,
  (values->>'upl_exp_df_2')::numeric            AS fg_upl_exp_foam_2min_ml,
  (values->>'upl_exp_df_5')::numeric            AS fg_upl_exp_foam_5min_ml,
  (values->>'upl_exp_wps')::numeric             AS fg_upl_exp_wet_particle_um,
  (values->>'upl_exp_alk')::numeric             AS fg_upl_exp_alkalinity_pct,
  values->>'upl_exp_disp'                       AS fg_upl_exp_dispersibility,
  (values->>'upl_omri_ps_10')::numeric          AS fg_upl_omri_particle_gt10um_pct,
  (values->>'upl_omri_ps_6')::numeric           AS fg_upl_omri_particle_gt6um_pct,
  (values->>'upl_omri_ps_1')::numeric           AS fg_upl_omri_particle_gt1um_pct,
  (values->>'upl_omri_ds_500')::numeric         AS fg_upl_omri_dry_sieve_500um_pct,
  (values->>'upl_omri_ds_106')::numeric         AS fg_upl_omri_dry_sieve_106um_pct,
  values->>'upl_omri_disp_self'                 AS fg_upl_omri_disp_self,
  values->>'upl_omri_disp_1h'                   AS fg_upl_omri_disp_1h,
  values->>'upl_omri_disp_24h'                  AS fg_upl_omri_disp_24h,
  (values->>'upl_omri_ws_160')::numeric         AS fg_upl_omri_wet_sieve_160um_pct,
  (values->>'upl_omri_ws_25')::numeric          AS fg_upl_omri_wet_sieve_25um_pct

FROM quality_control_records
ORDER BY date DESC, created_at DESC;


-- ════════════════════════════════════════════════════════════
-- RLS FIX — allow logged-in (authenticated) users to save QC reports
--
-- Why: migration 006 created only an `anon` insert policy on
-- quality_control_records:
--     create policy "anon_insert_qc" ... for insert to anon ...
-- Once a user signs in via Supabase Auth, their requests run as
-- the `authenticated` role, which had NO insert policy — so the
-- save-before-print insert was rejected with:
--     new row violates row-level security policy for table
--     "quality_control_records"
--
-- Fix: ADD matching policies for the `authenticated` role. The
-- existing `anon` policies are left untouched, so nothing that
-- currently works breaks. Safe to run on a live DB — no data
-- change, only policy additions. DROP ... IF EXISTS first keeps
-- this block re-runnable.
-- ════════════════════════════════════════════════════════════

drop policy if exists "authenticated_insert_qc" on quality_control_records;
create policy "authenticated_insert_qc"
  on quality_control_records
  for insert
  to authenticated
  with check (true);

drop policy if exists "authenticated_select_qc" on quality_control_records;
create policy "authenticated_select_qc"
  on quality_control_records
  for select
  to authenticated
  using (true);
