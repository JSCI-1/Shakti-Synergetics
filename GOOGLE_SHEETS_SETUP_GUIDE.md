# Google Sheets Sync — Complete Setup Guide

This guide walks you, step by step, through turning on the one-way sync that
copies **Dryer Operator** and **Quality Control (Finished Goods)** records from
Supabase into Google Sheets. No prior Google Sheets, Apps Script, or Supabase
experience is assumed — every click is spelled out.

**What this sync does:** whenever an operator saves in the app, Supabase keeps
being the single source of truth exactly as today, and a copy of the saved
values (plus a per-field change history with timestamps) flows into two Google
spreadsheets. The sync is one-way (Supabase → Sheets). It can never block,
delay, or undo a save, and if Google is briefly unavailable the records wait
safely and are retried.

> **No app/website changes.** This feature adds **no** frontend changes in v1.
> No new timestamp badges, columns, or icons appear in the website. The app
> saves exactly as before. All timestamps live in Google Sheets only.

---

## 0. What Kiro did automatically vs what you must do manually

**Kiro did automatically (already done):**

- Inspected the Dryer + QC modules and the Supabase schema.
- Created all the files for this feature (two SQL migrations, two Edge
  Functions, the Apps Script worker + manifest, this guide, and the deploy
  README).
- Ran the local frontend build to confirm nothing in the website changed.

**You must do manually (nothing below has been performed yet):**

1. Create the two Google spreadsheets and all their tabs.
2. Copy the two spreadsheet IDs from their URLs.
3. Generate a shared secret.
4. Run SQL `021` then `022` in the Supabase SQL Editor.
5. Deploy the two Edge Functions and set their secrets.
6. Paste + authorize + deploy the Apps Script Web App and set its Script
   Properties.
7. Install the time-driven trigger (the poller).
8. Verify end-to-end in production.

> This guide does **not** claim any of these manual steps were done. They are
> yours to perform.

> Project rule for this work: **no git push, no pull request, no commit, no
> branch.** All the files are local, uncommitted changes.

---

## 1. Create the two spreadsheets and their tabs

Create **two** Google spreadsheets (Google Drive → New → Google Sheets).

### Spreadsheet 1 — name it `Dryer Operator Records`

Create exactly these three tabs (rename `Sheet1`, then add two more with the +
button at the bottom-left). Tab names must match **exactly**, including spaces:

- `Current Records`
- `Hourly Readings`
- `Field Change History`

### Spreadsheet 2 — name it `Quality Control Records`

Create exactly these six tabs (names must match exactly — note the en-dash `–`,
not a hyphen `-`; copy them from here to be safe):

- `Raw Material – Current Records`
- `Raw Material – Field Change History`
- `In-Process – Current Records`
- `In-Process – Field Change History`
- `Finished Goods – Current Records`
- `Finished Goods – Field Change History`

> You do **not** need to type headers into the tabs. The sync writes a header
> row automatically the first time it adds data. A hidden `_SyncState` tab is
> also created automatically in the Dryer spreadsheet (it is the duplicate
> guard — leave it alone).

> **In v1, only Finished Goods receives data.** Raw Material and In-Process tabs
> are created now and stay empty until a future change lets the app save RM/IP
> records to Supabase. This is expected, not a fault.

## 2. Copy each spreadsheet ID from its URL

Open a spreadsheet. Its URL looks like:

```
https://docs.google.com/spreadsheets/d/THIS_LONG_ID_HERE/edit#gid=0
```

The part between `/d/` and `/edit` is the **spreadsheet ID**. Copy it. Do this
for both spreadsheets — you will paste them as `SPREADSHEET_ID_DRYER` and
`SPREADSHEET_ID_QC` later.

## 3. Generate a shared secret

The Apps Script and the Supabase Edge Functions prove they trust each other with
a shared secret string. Generate a long random value (e.g. run
`openssl rand -hex 32`, or use any password generator). Keep it somewhere safe;
you will paste the **same** value into both Supabase and Apps Script. This value
is `SHEETS_SYNC_SECRET`.

## 4. Run the SQL migrations (Supabase SQL Editor — in order)

These create the outbox table and the observe-only triggers. **Run 021 before
022.** This is hand-run SQL in the SQL Editor — do **not** use the CLI for these
(the CLI is only for the Edge Functions in step 5; never apply the same object
both ways).

1. Supabase Dashboard → **SQL Editor** → **New query**.
2. Open `supabase/migrations/021_sheets_sync_outbox.sql`, copy all of it, paste,
   click **Run**. Then verify (new query):
   ```sql
   select count(*) from sheets_sync_outbox;        -- expect 0; the table exists
   ```
3. **New query.** Open `supabase/migrations/022_sheets_sync_triggers.sql`, copy
   all of it, paste, **Run**. Then verify:
   ```sql
   select tgname, tgrelid::regclass
     from pg_trigger
    where tgname like 'trg_sheets_sync_%';          -- expect 3 rows:
   -- trg_sheets_sync_dryer_hourly_draft      → dryer_hourly_draft
   -- trg_sheets_sync_dryer_logs              → dryer_logs
   -- trg_sheets_sync_quality_control_records → quality_control_records
   ```

Both files are safe to re-run. 021 never drops the outbox or its pending work.

## 5. Deploy the Edge Functions and set their secrets (CLI only)

From a terminal in the project, with the Supabase CLI logged in and linked to
your project:

```sh
supabase functions deploy sheets-sync-pull
supabase functions deploy sheets-sync-ack

supabase secrets set SHEETS_SYNC_SECRET="<the secret from step 3>"
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are normally provided to deployed
functions by the platform. If your project requires them explicitly, also run:

```sh
supabase secrets set SUPABASE_URL="https://<project-ref>.supabase.co"
supabase secrets set SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
```

After deploy, note the two function URLs (shown by the CLI, or in Dashboard →
Edge Functions):

```
https://<project-ref>.supabase.co/functions/v1/sheets-sync-pull
https://<project-ref>.supabase.co/functions/v1/sheets-sync-ack
```

These become `PULL_URL` and `ACK_URL` in Apps Script.

> The service-role key stays only inside the Edge Function secrets. It never
> goes into the browser, the website, or the spreadsheet.

## 6. Set up and deploy the Apps Script Web App

1. Open the **Dryer Operator Records** spreadsheet → menu **Extensions → Apps
   Script**. A new Apps Script project opens.
2. In the editor, replace the contents of `Code.gs` with the contents of
   `supabase/google_sheets/apps-script/Code.gs` from this repo.
3. Show the manifest: gear icon **Project Settings** → tick **Show
   "appsscript.json" manifest file in editor**. Then open `appsscript.json` and
   replace it with `supabase/google_sheets/apps-script/appsscript.json`.
4. **Set Script Properties:** Project Settings → **Script properties** → **Add
   script property**, once per row:

   | Property | Value |
   |---|---|
   | `SHEETS_SYNC_SECRET` | the secret from step 3 (identical to Supabase) |
   | `PULL_URL` | the `…/sheets-sync-pull` URL from step 5 |
   | `ACK_URL` | the `…/sheets-sync-ack` URL from step 5 |
   | `SPREADSHEET_ID_DRYER` | the Dryer spreadsheet ID from step 2 |
   | `SPREADSHEET_ID_QC` | the QC spreadsheet ID from step 2 |

5. **Authorize scopes:** in the editor's function dropdown pick `installTrigger`
   and click **Run**. Google asks you to authorize — choose your account,
   click **Advanced → Go to (project) (unsafe)** if shown (it is your own
   script), and **Allow** the spreadsheet + external-request permissions.
6. Running `installTrigger` once both authorizes the script **and** installs the
   time-driven trigger (`syncTick` every 5 minutes) — this is the "webhook"
   poller. You can confirm it under the clock icon **Triggers** on the left.
7. **Deploy as a Web App (versioned):** **Deploy → New deployment** → gear →
   **Web app**. Set **Execute as: Me** (so it can read the spreadsheets and call
   the functions) and **Who has access: Only myself**. Click **Deploy**. (The
   Web App URL is not strictly needed for the time-driven poller, but a
   versioned deployment is good practice; redeploy a **new version** whenever you
   paste updated `Code.gs`.)
8. **Reading execution logs:** left sidebar **Executions** shows each `syncTick`
   run, its status, and `Logger.log` output — your first stop for
   troubleshooting.

## 7. The time-driven trigger is the poller — why polling?

Instead of Supabase pushing changes to Google (a Database Webhook), Apps Script
**pulls** every few minutes by calling `sheets-sync-pull`. Polling was chosen
deliberately (design §2): it needs no extra Postgres extension (`pg_net`/`http`)
turned on; the durable outbox table means records wait safely if Apps Script is
ever down; and retrying a failed sync is automatic (unacknowledged rows are
simply served again on the next tick).

## 8. Frontend / backend change note

There are **no frontend changes** in v1 — the website and app behave exactly as
before. The only backend additions are the outbox table + observe-only triggers
(SQL) and the two Edge Functions. The four data tables' schema, RLS, roles,
save/finalize/draft semantics, and all calculations are unchanged.

---

## 9. Field-mapping reference (what lands where)

Values are synced **as stored** in Supabase. Browser-calculated results (QC
formulas, UPL Pass/Fail, UPL OMRI dry-sieve status) are stored by the app as
their already-computed value or raw measurement; **Apps Script never recomputes
anything** — it only copies what Supabase already holds. UPL Pass/Fail and UPL
OMRI dry-sieve **status** are not stored, so only the raw measured values sync.

Content below is condensed from `.agents/tasks/gsheets-inspection-mapping.md`.

### 9.1 Dryer Operator → spreadsheet `Dryer Operator Records`

Meta / blower / footer fields land on **Current Records** (one row per
`date` + `dryer_type`). The 24 hourly rows land on **Hourly Readings** (one row
per `date` + `dryer_type` + `hour`). Per-field edits land on **Field Change
History**.

| UI section | UI field | Supabase table | Supabase column | Destination tab |
|---|---|---|---|---|
| Dryer meta | Date | `dryer_logs` | `date` | Current Records |
| Dryer meta | Shift | `dryer_logs` | `shift` | Current Records |
| Dryer meta | Dryer (New/Old) | `dryer_logs` | `dryer_type` | Current Records |
| Blower bar | ID Blower DP | `dryer_logs` | `id_blower_dp` | Current Records |
| Blower bar | ID Blower MR | `dryer_logs` | `id_blower_mr` | Current Records |
| Blower bar | FD Blower DP | `dryer_logs` | `fd_blower_dp` | Current Records |
| Blower bar | FD Blower MR | `dryer_logs` | `fd_blower_mr` | Current Records |
| Blower bar | IFBD DP | `dryer_logs` | `chamber_dp` (UI `ifbd_dp`) | Current Records |
| Blower bar | IFBD MR | `dryer_logs` | `chamber_mr` (UI `ifbd_mr`) | Current Records |
| Blower bar | FBD % DP | `dryer_logs` | `fbd_pct_dp` | Current Records |
| Blower bar | FBD % MR | `dryer_logs` | `fbd_pct_mr` | Current Records |
| Footer | Batch No. | `dryer_logs` | `batch_no` | Current Records |
| Footer | Calibration Due Date | `dryer_logs` | `calibration_due` | Current Records |
| Footer | Calibration sensors (5× temp+sensor) | `dryer_logs` | `calibration_sensors` (jsonb) | Current Records |
| Footer | Total Production (kg) | `dryer_logs` | `total_production` | Current Records |
| Footer | Incharge | `dryer_logs` | `incharge` | Current Records |
| Footer | Operator | `dryer_logs` | `operator` | Current Records |
| Hourly row | Time slot | `dryer_hourly_draft` / `dryer_logs.log_rows[]` | `hour` | Hourly Readings |
| Hourly row | Temp Inlet | hourly | `temp_inlet` | Hourly Readings |
| Hourly row | Temp Outlet | hourly | `temp_outlet` | Hourly Readings |
| Hourly row | Temp Actual | hourly | `temp_actual` | Hourly Readings |
| Hourly row | Temp IFBD | hourly | `temp_fbd1` | Hourly Readings |
| Hourly row | Temp FBD | hourly | `temp_fbd2` | Hourly Readings |
| Hourly row | Temp Chamber | hourly | `temp_chamber` | Hourly Readings |
| Hourly row | Atomizer Freq. | hourly | `atomizer_freq` | Hourly Readings |
| Hourly row | Feed F.C. | hourly | `feed_fc` | Hourly Readings |
| Hourly row | Feed Pressure | hourly | `pressure` | Hourly Readings |
| Hourly row | Pt. Temp | hourly | `pt_temp` | Hourly Readings |
| Hourly row | Batch No. | hourly | `batch_no` | Hourly Readings |
| Hourly row | No. of Bag Per Hours | hourly | `bags_per_hr` | Hourly Readings |
| Hourly row | Bag Size By Wt. | hourly | `bag_size_wt` | Hourly Readings |
| Hourly row | Kg./Hour Production | hourly | `kg_per_hr` | Hourly Readings |
| Hourly row | Colour/Normal/OMRI | hourly | `colour` | Hourly Readings |
| Hourly row | I.D. Frequency | hourly | `id_frequency` | Hourly Readings |
| Hourly row | Remarks | hourly | `remarks` | Hourly Readings |
| Hourly row | Timestamp (display) | `dryer_hourly_draft.values` | `timestamp` (display-only) | Hourly Readings |

> Per-field edit history for Dryer comes from the per-hour 💾 Save
> (`dryer_hourly_draft`). A log saved directly with "Save Log Sheet" and no
> per-hour saves produces a Current Records row but no field-change history —
> expected v1 behavior.

### 9.2 QC Raw Material (`tab='rm'`) → `Quality Control Records` (DORMANT in v1)

Supabase column = key inside `quality_control_records.values`. All values are
stored as entered / browser-calculated; none recomputed in Sheets.

| UI section | UI field | Supabase table | Supabase column (jsonb key) | Destination tab |
|---|---|---|---|---|
| RM meta | Date | `quality_control_records` | `date` | Raw Material – Current Records |
| RM meta | Tested By | `quality_control_records` | `tested_by` | Raw Material – Current Records |
| Sulphur Powder | Purity % (calc) | `quality_control_records` | `sulphurPowder_purity` | Raw Material – Current Records / Field Change History |
| Sulphur Powder | Mesh Size % (calc) | `quality_control_records` | `sulphurPowder_meshSize` | Raw Material – … |
| Ligno | pH | `quality_control_records` | `ligno_ph` | Raw Material – … |
| Ligno | Solubility | `quality_control_records` | `ligno_solubility` | Raw Material – … |
| Ligno | Moisture % | `quality_control_records` | `ligno_moisture` | Raw Material – … |
| China Clay | pH | `quality_control_records` | `clay_ph` | Raw Material – … |
| China Clay | Sedimentation 10 min (ml) | `quality_control_records` | `clay_sed10` | Raw Material – … |
| China Clay | Sedimentation 30 min (ml) | `quality_control_records` | `clay_sed30` | Raw Material – … |
| China Clay | Moisture % | `quality_control_records` | `clay_moisture` | Raw Material – … |
| DN/Gujmol | pH | `quality_control_records` | `dn_ph` | Raw Material – … |
| DN/Gujmol | Solubility | `quality_control_records` | `dn_solubility` | Raw Material – … |
| DN/Gujmol | Moisture % | `quality_control_records` | `dn_moisture` | Raw Material – … |
| DN/Gujmol | Solid Content % | `quality_control_records` | `dn_solid` | Raw Material – … |
| Coal | Moisture % | `quality_control_records` | `coal_moisture` | Raw Material – … |
| Micro Media | Density g/cc | `quality_control_records` | `mm_density` | Raw Material – … |
| Micro Media | Diameter mm | `quality_control_records` | `mm_diameter` | Raw Material – … |
| Micro Media | Finish | `quality_control_records` | `mm_finish` | Raw Material – … |

> RM header meta (Brand/Type, Supplier, Invoice No) is not persisted today
> (localStorage only), so it does not sync.

### 9.3 QC In-Process (`tab='ip'`) → `Quality Control Records` (DORMANT in v1)

| UI section | UI field | Supabase table | Supabase column (jsonb key) | Destination tab |
|---|---|---|---|---|
| IP meta | Date | `quality_control_records` | `date` | In-Process – Current Records |
| IP meta | Tested By | `quality_control_records` | `tested_by` | In-Process – Current Records |
| Solid Content | Result % (calc) | `quality_control_records` | `ip_moisture_calc` | In-Process – … |
| Sulphur Content | Result % (calc) | `quality_control_records` | `ip_sulphur_calc` | In-Process – … |
| Suspensibility | Result % (calc) | `quality_control_records` | `ip_susp_calc` | In-Process – … |
| Wet Sieve | Result % (calc) | `quality_control_records` | `ip_wetsieve_calc` | In-Process – … |
| Mill-wise Suspensibility | Rows `[{mill, br, flowRate, pass}]` | `quality_control_records` | `ip_mill_rows` (jsonb, whole value) | In-Process – … |

### 9.4 QC Finished Goods (`tab='fg'`) → `Quality Control Records` (LIVE in v1)

| UI section | UI field | Supabase table | Supabase column (jsonb key) | Destination tab |
|---|---|---|---|---|
| FG meta | Date | `quality_control_records` | `date` / `values.date` | Finished Goods – Current Records |
| FG meta | Tested By | `quality_control_records` | `tested_by` | Finished Goods – Current Records |
| FG meta | Dryer (ND1/ND2) | `quality_control_records` | `dryer` | Finished Goods – Current Records |
| FG meta | Shift | `quality_control_records` | `shift` (always null today) | Finished Goods – Current Records |
| FG meta | Batch No. | `quality_control_records` | `batch_no` | Finished Goods – Current Records |
| FG meta | Time | `quality_control_records` | `time` | Finished Goods – Current Records |
| FG meta | Brand/Type | `quality_control_records` | `brand` | Finished Goods – Current Records |
| FG meta | Product | `quality_control_records` | `product` | Finished Goods – Current Records |
| FG meta | Grade | `quality_control_records` | `grade` | Finished Goods – Current Records |
| Core WDG | Sulphur Content % (calc) | `quality_control_records` | `fg_sulphur` | Finished Goods – … |
| Core WDG | Suspensibility % (calc) | `quality_control_records` | `fg_susp` | Finished Goods – … |
| Core WDG | Moisture % (direct input) | `quality_control_records` | `fg_moisture` | Finished Goods – … |
| Core WDG | Bulk Density g/cc (calc) | `quality_control_records` | `fg_bulk` | Finished Goods – … |
| Core WDG | Wet Sieve % (calc) | `quality_control_records` | `fg_wetSieve` | Finished Goods – … |
| Core WDG | Dry Sieve % (calc) | `quality_control_records` | `fg_drySieve` | Finished Goods – … |
| Core WDG | pH | `quality_control_records` | `fg_ph` | Finished Goods – … |
| Core WDG | Wettability (sec) | `quality_control_records` | `fg_wettability` | Finished Goods – … |
| Core WDG | Persistent Foam at start (ml) | `quality_control_records` | `fg_foam_start` | Finished Goods – … |
| Core WDG | Persistent Foam 1 min (ml) | `quality_control_records` | `fg_foam_1min` | Finished Goods – … |
| UPL Export | Particle >10µm % | `quality_control_records` | `upl_exp_ps_10` | Finished Goods – … |
| UPL Export | Particle >6µm % | `quality_control_records` | `upl_exp_ps_6` | Finished Goods – … |
| UPL Export | Particle >1µm % | `quality_control_records` | `upl_exp_ps_1` | Finished Goods – … |
| UPL Export | Wet Sieve 160µm % | `quality_control_records` | `upl_exp_ws_160` | Finished Goods – … |
| UPL Export | Wet Sieve 25µm % | `quality_control_records` | `upl_exp_ws_25` | Finished Goods – … |
| UPL Export | Dynamic Foam 0 min (ml) | `quality_control_records` | `upl_exp_df_0` | Finished Goods – … |
| UPL Export | Dynamic Foam 1 min (ml) | `quality_control_records` | `upl_exp_df_1` | Finished Goods – … |
| UPL Export | Dynamic Foam 2 min (ml) | `quality_control_records` | `upl_exp_df_2` | Finished Goods – … |
| UPL Export | Dynamic Foam 5 min (ml) | `quality_control_records` | `upl_exp_df_5` | Finished Goods – … |
| UPL Export | Wet Particle median (µm) | `quality_control_records` | `upl_exp_wps` | Finished Goods – … |
| UPL Export | Alkalinity % | `quality_control_records` | `upl_exp_alk` | Finished Goods – … |
| UPL Export | Dispersibility | `quality_control_records` | `upl_exp_disp` | Finished Goods – … |
| UPL OMRI | Particle >10µm % | `quality_control_records` | `upl_omri_ps_10` | Finished Goods – … |
| UPL OMRI | Particle >6µm % | `quality_control_records` | `upl_omri_ps_6` | Finished Goods – … |
| UPL OMRI | Particle >1µm % | `quality_control_records` | `upl_omri_ps_1` | Finished Goods – … |
| UPL OMRI | Dry Sieve 500µm % | `quality_control_records` | `upl_omri_ds_500` | Finished Goods – … |
| UPL OMRI | Dry Sieve 106µm % | `quality_control_records` | `upl_omri_ds_106` | Finished Goods – … |
| UPL OMRI | Dispersion self | `quality_control_records` | `upl_omri_disp_self` | Finished Goods – … |
| UPL OMRI | Dispersion 1 h | `quality_control_records` | `upl_omri_disp_1h` | Finished Goods – … |
| UPL OMRI | Dispersion 24 h | `quality_control_records` | `upl_omri_disp_24h` | Finished Goods – … |
| UPL OMRI | Wet Sieve 160µm % | `quality_control_records` | `upl_omri_ws_160` | Finished Goods – … |
| UPL OMRI | Wet Sieve 25µm % | `quality_control_records` | `upl_omri_ws_25` | Finished Goods – … |

> **Calculated / not-stored fields:** QC formula results (Moisture, Sulphur,
> Suspensibility, Wet/Dry Sieve, Bulk Density, Purity, Mesh Size) are computed
> in the browser and the **result** is stored under its key above — Sheets
> copies that stored result and never recomputes. **UPL Pass/Fail status and
> UPL OMRI dry-sieve status are not stored at all**, so they do not sync; only
> the raw measured values (e.g. `upl_omri_ds_500`) sync.

---

## 10. Test checklist

Perform these after completing steps 1–7. Wait up to one trigger interval
(≈5 min) between saving and checking Sheets, or run `syncTick` manually from the
Apps Script editor.

- [ ] **Dryer per-hour Save (💾):** save one hour → a row appears in
      `Dryer Operator Records → Field Change History` with the field name, old
      and new value, and timestamps. Change the same field and re-save → a new
      `update` row appears (the original `entry` row stays).
- [ ] **Dryer "Save Log Sheet":** finalize a log → `Current Records` gets one
      row for that `date`+`dryer_type` (meta/blower/footer), and
      `Hourly Readings` gets 24 rows keyed by hour. Re-finalizing the same
      `date`+`dryer_type` **updates** the same Current Records row (no
      duplicate).
- [ ] **QC Finished Goods Print/Download:** save an FG report → `Finished Goods
      – Current Records` gets one row keyed by `date`+`dryer`+`batch_no`+`grade`,
      and `Finished Goods – Field Change History` gets one row per non-empty
      field. A second FG report with the **same** date/dryer/batch/grade updates
      the same current row; a **different grade** (Export vs OMRI) creates its
      own current row.
- [ ] **No duplicate deliveries:** run `syncTick` twice in a row → no row is
      written twice (the `_SyncState` hidden tab + the outbox `event_id` prevent
      it).
- [ ] **Repeated no-change save:** save a Dryer hour again with no changes → no
      new Field Change History row (unchanged fields emit no event).
- [ ] **Temporary Sheets failure + retry:** temporarily set a wrong
      `SPREADSHEET_ID_QC`, do an FG save, run `syncTick` (the QC rows fail and
      are retried); fix the ID, run again → the rows land. Confirm with
      `select status, retry_count from sheets_sync_outbox order by id desc;`
- [ ] **Correct routing:** Dryer events only ever appear in the Dryer
      spreadsheet; QC events only in the QC spreadsheet; FG never mixes into RM
      or IP tabs.
- [ ] **No new UI timestamps:** open the website — no new timestamp badge,
      column, or icon appears anywhere. Saving behaves exactly as before.
- [ ] **No lost Supabase records:** every save still lands in Supabase even if
      Apps Script is paused — the website is unaffected by the sync.

## 11. Troubleshooting

- **401 Unauthorized in Executions / pull returns 401:** the
  `SHEETS_SYNC_SECRET` in Apps Script Script Properties does not match the one
  in `supabase secrets`. Set both to the exact same value.
- **"Missing Script Properties: …" in the log:** a required Script Property is
  absent or blank. Add all five (step 6.4). The tick fails closed and writes
  nothing until they are present.
- **Nothing appears in Sheets:** confirm the time trigger exists (Triggers
  panel) or run `syncTick` manually; check `select count(*) from
  sheets_sync_outbox where status='pending';` is > 0 after a save; check the
  Executions log for errors.
- **Wrong spreadsheet ID:** rows for that spreadsheet appear in `failed[]`;
  `sheets_sync_outbox.last_error` shows the error and `retry_count` climbs. Fix
  the Script Property ID; the rows retry automatically (up to 5 attempts) and
  then land. Rows that exhausted retries sit at `status='failed'` — after fixing
  the ID you can requeue them with
  `update sheets_sync_outbox set status='pending', retry_count=0 where status='failed';`
- **Duplicate deliveries:** should not happen; both the outbox `event_id` UNIQUE
  key and the `_SyncState` tab dedup. If you cleared `_SyncState`, re-running is
  still safe for Current Records (idempotent upsert) but can re-append history
  rows — do not delete `_SyncState`.
- **Repeated no-change saves cluttering history:** they do not — unchanged
  allow-listed fields emit no `field_change` event, and meta/identity fields
  (date, batch_no, brand, etc.) are never field-change events.
- **A save seems blocked by the sync:** it cannot be. The triggers are
  observe-only, wrapped so any sync-side error becomes a Postgres warning and the
  save always commits. Check Postgres logs for `sheets_sync trigger …` warnings
  if an outbox row is unexpectedly missing.

---

## 12. Summary — automatic vs manual

| Done automatically by Kiro | You must do manually |
|---|---|
| Inspected the modules + schema | Create the two Google spreadsheets + all tabs |
| Created 021 / 022 SQL files | Run `021` then `022` in the Supabase SQL Editor |
| Created both Edge Functions | Deploy the Edge Functions + set their secrets |
| Created `Code.gs` + `appsscript.json` | Paste, authorize, and deploy the Apps Script Web App |
| Created this guide + the deploy README | Set the five Script Properties |
| Ran the local frontend build (unchanged) | Install the time-driven trigger (the poller) |
| — | Generate the shared secret |
| — | Verify end-to-end in production |

None of the "manual" steps have been performed by Kiro — they are left for you.
