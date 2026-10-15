/**
 * Google Sheets Sync — Apps Script worker.
 *
 * One-way Supabase → Google Sheets. A time-driven trigger calls syncTick():
 *   pull a batch  → route each row (by record_kind + event_type ONLY, never
 *   routing_label) → write to the correct spreadsheet/tab → ack done/failed.
 *
 * All secrets / URLs / spreadsheet IDs are read from Script Properties
 * (Project Settings → Script properties). Nothing is hardcoded. If a required
 * property is missing the tick fails closed (logs + aborts, no partial writes).
 *
 * Required Script Properties:
 *   SHEETS_SYNC_SECRET   shared secret sent as the x-sheets-sync-secret header
 *   PULL_URL             sheets-sync-pull Edge Function URL
 *   ACK_URL              sheets-sync-ack  Edge Function URL
 *   SPREADSHEET_ID_DRYER "Dryer Operator Records" spreadsheet id
 *   SPREADSHEET_ID_QC    "Quality Control Records" spreadsheet id
 *
 * Routing — record_kind + event_type → spreadsheet + tab:
 *   dryer  + current_snapshot → Dryer: "Current Records" + "Hourly Readings"
 *   dryer  + field_change     → Dryer: "Field Change History"
 *   qc_rm  + current_snapshot → QC:    "Raw Material"     (fills value cells)
 *   qc_rm  + field_change     → QC:    "Raw Material"     (fills "(Updated)" ts)
 *   qc_ip  + current_snapshot → QC:    "In-Process"       (fills value cells)
 *   qc_ip  + field_change     → QC:    "In-Process"       (fills "(Updated)" ts)
 *   qc_fg  + current_snapshot → QC:    "Finished Goods"   (fills value cells)
 *   qc_fg  + field_change     → QC:    "Finished Goods"   (fills "(Updated)" ts)
 *
 * QC layout: THREE user-facing tabs, one per website section. Each measurement
 * has a value column followed by a "<Label> (Updated)" column holding the
 * per-field entry/update time (hh:mm AM/PM, IST). One submission = one row,
 * keyed by the record's source_pk (kept in a hidden trailing _source_pk column).
 * The snapshot event fills values + identity; the field_change events fill each
 * field's "(Updated)" cell, so updating one field never alters another's time.
 */

/* ───────────────────────── Constants ───────────────────────── */

var PULL_BATCH_LIMIT = 100;

var TAB = {
  DRYER_CURRENT: 'Current Records',
  DRYER_HOURLY: 'Hourly Readings',
  DRYER_HISTORY: 'Field Change History',
  // Quality Control: THREE user-facing tabs, one per website section.
  // No separate "Current Records" / "Field Change History" tabs — each
  // measurement value sits next to its own "(Updated)" timestamp column.
  QC: {
    qc_rm: 'Raw Material',
    qc_ip: 'In-Process',
    qc_fg: 'Finished Goods'
  }
};


/* ─────────────── QC field catalogs (website source of truth) ───────────────
 * Each entry: [valueKey, 'Website Label'].
 * Order and labels mirror the Quality Control forms exactly
 * (src/data/qualityData.js + src/data/uplData.js).
 *
 * The sheet header for each tab is:
 *   [identity columns…] then, per field: 'Label', 'Label (Updated)'.
 * The value cell holds the measurement; the "(Updated)" cell holds the
 * per-field entry/update timestamp (hh:mm AM/PM) from the field_change event.
 * ─────────────────────────────────────────────────────────────────────────── */

// Raw Material — union of every material's fields, in website order.
// (The website shows one material at a time; the sheet keeps a column for
//  every possible field so any material's record lands in the right columns.)
//
// Sulphur Powder is formula-based: Purity = f(M1, M); Mesh Size = f(m, M).
// The website now saves each formula INPUT under '<cardId>__<varKey>' (see
// collectReportValues in QualityCheck.jsx), so each input is its own column
// with its own entry timestamp, next to the calculated result.
var QC_FIELDS_RM = [
  // Sulphur Powder — Purity: inputs M1, M, then the calculated result.
  ['sulphurPowder_purity__M1', 'Sulphur Powder – Purity M1'],
  ['sulphurPowder_purity__M',  'Sulphur Powder – Purity M'],
  ['sulphurPowder_purity',     'Sulphur Powder – Purity (%)'],
  // Sulphur Powder — Mesh Size: inputs m, M, then the calculated result.
  ['sulphurPowder_meshSize__m', 'Sulphur Powder – Mesh Size m'],
  ['sulphurPowder_meshSize__M', 'Sulphur Powder – Mesh Size M'],
  ['sulphurPowder_meshSize',    'Sulphur Powder – Mesh Size (%)'],
  // Ligno
  ['ligno_ph',               'Ligno – pH'],
  ['ligno_solubility',       'Ligno – Solubility'],
  ['ligno_moisture',         'Ligno – Moisture (%)'],
  // China Clay
  ['clay_ph',                'China Clay – pH'],
  ['clay_sed10',             'China Clay – Sedimentation 10 min (ml)'],
  ['clay_sed30',             'China Clay – Sedimentation 30 min (ml)'],
  ['clay_moisture',          'China Clay – Moisture (%)'],
  // DN Powder / Liquid
  ['dn_ph',                  'DN Powder/Liquid – pH'],
  ['dn_solubility',          'DN Powder/Liquid – Solubility'],
  ['dn_moisture',            'DN Powder/Liquid – Moisture (%)'],
  ['dn_solid',               'DN Powder/Liquid – Solid Content (%)'],
  // Coal
  ['coal_moisture',          'Coal – Moisture Content (%)'],
  // Micro Media
  ['mm_density',             'Micro Media – Density (g/cc)'],
  ['mm_diameter',            'Micro Media – Diameter (mm)'],
  ['mm_finish',              'Micro Media – Finish']
];

// In-Process — pinned tests + dropdown tests, in website order.
var QC_FIELDS_IP = [
  ['ip_moisture_calc', 'Solid Content (%)'],
  ['ip_sulphur_calc',  'Sulphur Content (%)'],
  ['ip_susp_calc',     'Suspensibility (%)'],
  ['ip_wetsieve_calc', 'Wet Sieve (%)']
];

// Finished Goods — standard WDG tests, then UPL Export, then UPL OMRI
// (only the keys present in a given record are filled; others stay blank).
var QC_FIELDS_FG = [
  // Standard WDG tests
  ['fg_sulphur',       'Sulphur Content (%)'],
  ['fg_susp',          'Suspensibility (%)'],
  ['fg_moisture',      'Moisture Content (%)'],
  ['fg_bulk',          'Bulk Density (g/cc)'],
  ['fg_wetSieve',      'Wet Sieve (%)'],
  ['fg_drySieve',      'Dry Sieve (%)'],
  ['fg_ph',            'pH'],
  ['fg_wettability',   'Wettability (sec)'],
  ['fg_foam_start',    'Persistent Foaming – At start (ml)'],
  ['fg_foam_1min',     'Persistent Foaming – After 1 min (ml)'],
  // UPL Export Grade
  ['upl_exp_ps_10',    'UPL Export – Particle >10µm (%)'],
  ['upl_exp_ps_6',     'UPL Export – Particle >6µm (%)'],
  ['upl_exp_ps_1',     'UPL Export – Particle >1µm (%)'],
  ['upl_exp_ws_160',   'UPL Export – Wet Sieve 160 Micron (%)'],
  ['upl_exp_ws_25',    'UPL Export – Wet Sieve 25 Micron (%)'],
  ['upl_exp_df_0',     'UPL Export – Dynamic Foam 0 min (ml)'],
  ['upl_exp_df_1',     'UPL Export – Dynamic Foam 1 min (ml)'],
  ['upl_exp_df_2',     'UPL Export – Dynamic Foam 2 min (ml)'],
  ['upl_exp_df_5',     'UPL Export – Dynamic Foam 5 min (ml)'],
  ['upl_exp_wps',      'UPL Export – Wet Particle Size median (µm)'],
  ['upl_exp_alk',      'UPL Export – Alkalinity (% w/w)'],
  ['upl_exp_disp',     'UPL Export – Dispersibility'],
  // UPL OMRI Grade
  ['upl_omri_ps_10',   'UPL OMRI – Particle >10µm (%)'],
  ['upl_omri_ps_6',    'UPL OMRI – Particle >6µm (%)'],
  ['upl_omri_ps_1',    'UPL OMRI – Particle >1µm (%)'],
  ['upl_omri_ds_500',  'UPL OMRI – Dry Sieve 500 Micron (%)'],
  ['upl_omri_ds_106',  'UPL OMRI – Dry Sieve 106 Micron (%)'],
  ['upl_omri_disp_self','UPL OMRI – Dispersion 1% self dispersing'],
  ['upl_omri_disp_1h', 'UPL OMRI – Stability 1 hour'],
  ['upl_omri_disp_24h','UPL OMRI – Stability 24 hours'],
  ['upl_omri_ws_160',  'UPL OMRI – Wet Sieve 160 Micron (%)'],
  ['upl_omri_ws_25',   'UPL OMRI – Wet Sieve 25 Micron (%)']
];

// Raw Material dropdown: material id (stored in values.material) → website label.
// Source of truth: src/data/qualityData.js RAW_MATERIALS[].{id,label}.
var RM_MATERIAL_LABELS = {
  sulphurPowder: 'Sulphur Powder',
  ligno:         'Ligno (Sodium Ligno Sulphonate)',
  chinaClay:     'China Clay',
  dnPowder:      'DN Powder / Liquid (Gujmol liquid)',
  coal:          'Coal',
  microMedia:    'Micro Media'
};

// Sections that use a SINGLE shared "Timestamp" column (first field-entry time
// of the record) instead of a per-field timestamp column. None, now — all QC
// sections use a per-field timestamp column (RM switched to per-field so M1/M
// and every value carry their own original entry time).
var QC_SINGLE_TIMESTAMP = { qc_rm: false, qc_ip: false, qc_fg: false };

// Per-field timestamp column HEADER mode per section.
//   'fixed'  → the header is literally "Timestamp" for every value's ts column
//              (RM — each value has an adjacent "Timestamp" column; association
//              is positional: the Timestamp column immediately follows its value).
//   'suffix' → header is "<Label> (Updated)" (IP/FG, unchanged).
var QC_TS_HEADER_MODE = { qc_rm: 'fixed', qc_ip: 'suffix', qc_fg: 'suffix' };

// Timestamp cell format per section (Apps Script date pattern, rendered in IST).
//   RM shows TIME ONLY ("hh:mm:ss a" → 10:15:32 AM); IP/FG keep their format.
var QC_TS_FORMAT = { qc_rm: 'hh:mm:ss a', qc_ip: 'hh:mm:ss a', qc_fg: 'hh:mm:ss a' };

// Identity columns per QC section (business key + context), in display order.
// NOTE: RM identity keys MUST match what the website saves in values
// (buildRmIpRow): supplier_name / invoice_no (snake_case), material, brand.
var QC_IDENTITY = {
  qc_rm: [
    ['date',          'Received Date'],
    ['batch_no',      'Batch Number'],
    ['tested_by',     'Tested By'],
    ['supplier_name', 'Supplier Name'],
    ['invoice_no',    'Invoice Number'],
    ['time',          'Time'],
    ['material',      'Material'],
    ['brand',         'Brand/Type']
  ],
  qc_ip: [
    ['date',      'Manufacturing Date'],
    ['tested_by', 'Tested By'],
    ['batch_no',  'Batch No.'],
    ['time',      'Time'],
    ['brand',     'Brand/Type']
  ],
  qc_fg: [
    ['date',      'Manufactured Date'],
    ['tested_by', 'Tested By'],
    ['batch_no',  'Batch No.'],
    ['time',      'Time'],
    ['product',   'Product'],
    ['grade',     'Grade'],
    ['dryer',     'Dryer'],
    ['brand',     'Brand/Type']
  ]
};

var QC_FIELD_CATALOG = {
  qc_rm: QC_FIELDS_RM,
  qc_ip: QC_FIELDS_IP,
  qc_fg: QC_FIELDS_FG
};

var SYNC_STATE_SHEET = '_SyncState';

// 24 chronological TIME_SLOT labels (inspection §1.2) — used to key Hourly
// Readings rows when payload.hours[] carries no explicit hour.
var TIME_SLOTS = [
  '08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00',
  '16:00','17:00','18:00','19:00','20:00','21:00','22:00','23:00',
  '00:00','01:00','02:00','03:00','04:00','05:00','06:00','07:00'
];

// Dryer hourly measurement columns (inspection §1.2), in display order.
var DRYER_HOURLY_KEYS = [
  'temp_inlet','temp_outlet','temp_actual','temp_fbd1','temp_fbd2',
  'temp_chamber','atomizer_freq','feed_fc','pressure','pt_temp',
  'batch_no','bags_per_hr','bag_size_wt','kg_per_hr','colour',
  'id_frequency','remarks','timestamp'
];

// Dryer current-record meta columns (design §5.3 payload.meta).
var DRYER_META_KEYS = [
  'date','shift','dryer_type','id_blower_dp','id_blower_mr',
  'fd_blower_dp','fd_blower_mr','chamber_dp','chamber_mr',
  'fbd_pct_dp','fbd_pct_mr','batch_no','calibration_due',
  'calibration_sensors','total_production','incharge','operator',
  'final_submission_ts'
];


/* ───────────────────────── Config ───────────────────────── */

function getConfig_() {
  var props = PropertiesService.getScriptProperties();
  var required = [
    'SHEETS_SYNC_SECRET', 'PULL_URL', 'ACK_URL',
    'SPREADSHEET_ID_DRYER', 'SPREADSHEET_ID_QC'
  ];
  var cfg = {};
  var missing = [];
  for (var i = 0; i < required.length; i++) {
    var v = props.getProperty(required[i]);
    if (!v || String(v).trim() === '') {
      missing.push(required[i]);
    } else {
      cfg[required[i]] = String(v).trim();
    }
  }
  if (missing.length > 0) {
    throw new Error('Missing Script Properties: ' + missing.join(', '));
  }
  return cfg;
}


/* ───────────────── One-time setup (run manually) ───────────────── */

/**
 * Install the time-driven trigger. Run this ONCE from the Apps Script editor
 * after setting Script Properties and authorizing scopes. Safe to re-run
 * (removes any existing syncTick trigger first).
 */
function installTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'syncTick') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  // everyMinutes() accepts only 1, 5, 10, 15, or 30. 1 is the fastest the
  // Apps Script time-driven trigger allows → near-real-time (data appears
  // within ~1 minute of a save on the website).
  ScriptApp.newTrigger('syncTick')
    .timeBased()
    .everyMinutes(1)
    .create();
  Logger.log('Installed time-driven trigger: syncTick every 1 minute.');
}


/**
 * Initialize the three Quality Control tabs with their website-matching
 * headers, EVEN IF no events have arrived for a section yet.
 *
 * Why this exists: the QC tabs are otherwise created lazily — only when a
 * routed event is written. If a section has never been saved on the website
 * (e.g. In-Process), no event ever arrives, so its tab never appears. This
 * helper makes all three tabs + headers exist up front.
 *
 * Run ONCE manually from the Apps Script editor. Idempotent and safe:
 *   • Creates a tab only if it is missing (never duplicates a tab).
 *   • Writes the header row only if row 1 is empty; otherwise grows it to
 *     fill any blank header cells (same ensureHeader_ rule used by the
 *     writers), so an existing populated tab is never clobbered.
 *   • Touches ONLY the QC spreadsheet; the Dryer book is not opened.
 *   • Never writes or deletes any data row.
 */
function initQcTabs() {
  var cfg;
  try {
    cfg = getConfig_();
  } catch (e) {
    Logger.log('[initQcTabs] Fail-closed: ' + e.message);
    return;
  }

  var qcSS = SpreadsheetApp.openById(cfg.SPREADSHEET_ID_QC);
  var kinds = ['qc_rm', 'qc_ip', 'qc_fg'];

  for (var i = 0; i < kinds.length; i++) {
    var kind = kinds[i];
    var tabName = TAB.QC[kind];
    var layout = buildQcLayout_(kind);
    var sh = getOrCreateSheet_(qcSS, tabName);
    ensureHeader_(sh, layout.header);   // creates header only if missing / fills blanks
    formatQcTab_(sh);                   // widths, wrap, row heights, header styling
    Logger.log('[initQcTabs] Ensured tab + header: ' + tabName);
  }
  Logger.log('[initQcTabs] Done. Raw Material / In-Process / Finished Goods are ready.');
}


/**
 * ONE-TIME, RAW-MATERIAL-ONLY rebuild — run manually after the RM layout change.
 *
 * ensureHeader_ only FILLS BLANK header cells; it will NOT replace the old,
 * incorrect RM headers already in the sheet. So to adopt the corrected layout
 * (M1/M + mesh inputs columns, per-field "… Timestamp" columns, no trailing
 * redundant Timestamp) we must rebuild the RM tab's header. Done SAFELY:
 *
 *   1. Renames the current "Raw Material" tab to "Raw Material (archived <ts>)"
 *      — nothing is deleted, every existing record is preserved there.
 *   2. Creates a fresh "Raw Material" tab with the correct website headers.
 *   3. Clears the RM rows from the _SyncState ledger AND sets REPLAY mode so the
 *      requeued RM events (see SQL below) re-populate the clean tab.
 *
 * Touches ONLY the Raw Material tab. In-Process, Finished Goods, Dryer, and all
 * other data are untouched. After you confirm the new RM tab is correct, you may
 * delete the archived tab manually.
 *
 * REQUIRED companion SQL (run once in Supabase, see migration 025):
 *   select sheets_sync_requeue_qc_rm();
 */
/**
 * SURGICAL header fix (preferred, no archive/requeue needed).
 *
 * Overwrites ONLY row 1 of the existing "Raw Material" tab with the current
 * correct header labels (each value column followed by a "Timestamp" column,
 * "Final Submission" last). Data rows are NOT touched. This is safe because
 * the current writers place every value and its timestamp at the deterministic
 * column positions computed by buildQcLayout_ — only the stale HEADER TEXT
 * ("… M1 Timestamp", "(Updated)", etc.) needs correcting, not the data.
 *
 * Preserves the hidden _source_pk column header and keeps it hidden. Re-applies
 * formatting. Idempotent and safe to re-run. RM only — never touches other tabs.
 *
 * Use this when the RM VALUES are already correct and you only need the headers
 * renamed to "Timestamp". If the data columns themselves are misaligned (older
 * layout), use rebuildRawMaterialTab() instead.
 */
function fixRawMaterialHeaderInPlace() {
  var cfg;
  try {
    cfg = getConfig_();
  } catch (e) {
    Logger.log('[fixRawMaterialHeaderInPlace] Fail-closed: ' + e.message);
    return;
  }

  var qcSS = SpreadsheetApp.openById(cfg.SPREADSHEET_ID_QC);
  var tabName = TAB.QC.qc_rm;   // 'Raw Material'
  var sh = qcSS.getSheetByName(tabName);
  if (!sh) {
    Logger.log('[fixRawMaterialHeaderInPlace] No "' + tabName + '" tab — run initQcTabs first.');
    return;
  }

  var layout = buildQcLayout_('qc_rm');
  var header = layout.header.slice();

  // Preserve a trailing hidden _source_pk column if it exists past the layout.
  var liveWidth = Math.max(sh.getLastColumn(), header.length);
  var liveRow1 = sh.getRange(1, 1, 1, liveWidth).getValues()[0];
  var pkIdx = liveRow1.indexOf('_source_pk');
  if (pkIdx >= 0) {
    while (header.length <= pkIdx) header.push('');
    header[pkIdx] = '_source_pk';
  }

  // Overwrite ONLY row 1 (headers). Data rows below are untouched.
  sh.getRange(1, 1, 1, header.length).setValues([header]);
  if (pkIdx >= 0) { try { sh.hideColumns(pkIdx + 1); } catch (e) {} }

  formatQcTab_(sh);
  Logger.log('[fixRawMaterialHeaderInPlace] Row 1 headers corrected on "' + tabName
    + '". Each field value is followed by a "Timestamp" column; "Final Submission" is last. '
    + 'Data rows were not changed.');
}


function rebuildRawMaterialTab() {
  var cfg;
  try {
    cfg = getConfig_();
  } catch (e) {
    Logger.log('[rebuildRawMaterialTab] Fail-closed: ' + e.message);
    return;
  }

  var qcSS = SpreadsheetApp.openById(cfg.SPREADSHEET_ID_QC);
  var tabName = TAB.QC.qc_rm;   // 'Raw Material'

  // 1. Archive the existing RM tab (rename, never delete).
  var old = qcSS.getSheetByName(tabName);
  if (old) {
    var stamp = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMdd-HHmm');
    var archiveName = 'Raw Material (archived ' + stamp + ')';
    old.setName(archiveName);
    Logger.log('[rebuildRawMaterialTab] Archived old tab as: ' + archiveName);
  }

  // 2. Create a fresh RM tab with the correct headers + apply formatting.
  var sh = getOrCreateSheet_(qcSS, tabName);
  var layout = buildQcLayout_('qc_rm');
  ensureHeader_(sh, layout.header);
  formatQcTab_(sh);
  Logger.log('[rebuildRawMaterialTab] Created fresh "' + tabName + '" with correct headers.');

  // 3. Turn on replay so requeued RM events re-populate the clean tab even if
  //    their event_ids are already in _SyncState. (Server only re-serves rows
  //    flipped to pending by sheets_sync_requeue_qc_rm(), i.e. RM-only.)
  PropertiesService.getScriptProperties().setProperty('REPLAY_FORCE_WRITE', '1');
  Logger.log('[rebuildRawMaterialTab] Replay mode ON. '
    + 'Now run `select sheets_sync_requeue_qc_rm();` in the Supabase SQL editor. '
    + 'Within ~1 min RM records re-populate the clean tab. '
    + 'Then run clearReplayFlag() and delete the archived tab once verified.');
}


/**
 * ONE-TIME QC REPLAY — run manually from the Apps Script editor after the
 * QC layout change (6 tabs → 3 tabs).
 *
 * Why it's needed: the QC outbox events that should populate the new three
 * tabs were already processed by the OLD code, so they are:
 *   (1) status='done' in the outbox  → the pull endpoint won't serve them, and
 *   (2) recorded in the _SyncState ledger → syncTick would skip them anyway.
 *
 * This function clears the QC event IDs from the _SyncState ledger (dedup
 * layer 2). You must ALSO run `select sheets_sync_requeue_qc();` once in the
 * Supabase SQL editor (dedup layer 1) so the pull endpoint re-serves them.
 * Order does not matter; after BOTH are done, the next syncTick re-writes the
 * QC events into Raw Material / In-Process / Finished Goods.
 *
 * Dryer rows in _SyncState are left untouched — Dryer sync is unaffected.
 * Safe to re-run.
 */
function replayQcEvents() {
  // Turn ON replay mode: syncTick will write a re-served event even if the
  // _SyncState ledger already lists it. The server only re-serves events whose
  // outbox status is 'pending', and sheets_sync_requeue_qc() flips QC-only rows
  // back to 'pending' — so ONLY QC events get re-written. Dryer is untouched.
  PropertiesService.getScriptProperties().setProperty('REPLAY_FORCE_WRITE', '1');
  Logger.log('[replayQcEvents] Replay mode ON. '
    + 'Next: run `select sheets_sync_requeue_qc();` in the Supabase SQL editor. '
    + 'Within ~1 min the QC events re-write into Raw Material / In-Process / '
    + 'Finished Goods. After you confirm the tabs look correct, run '
    + 'clearReplayFlag() to restore strict dedup.');
}

/** Turn off replay mode after a successful QC re-write (restores strict dedup). */
function clearReplayFlag() {
  PropertiesService.getScriptProperties().deleteProperty('REPLAY_FORCE_WRITE');
  Logger.log('[clearReplayFlag] REPLAY_FORCE_WRITE cleared — strict dedup restored.');
}


/* ───────────────────────── Main tick ───────────────────────── */

function syncTick() {
  var cfg;
  try {
    cfg = getConfig_();
  } catch (e) {
    Logger.log('[syncTick] Fail-closed: ' + e.message);
    return; // no partial writes
  }

  var rows = pullBatch_(cfg);
  if (!rows || rows.length === 0) {
    return; // nothing pending
  }

  var done = [];
  var failed = [];

  var dryerSS = SpreadsheetApp.openById(cfg.SPREADSHEET_ID_DRYER);
  var qcSS = SpreadsheetApp.openById(cfg.SPREADSHEET_ID_QC);
  var processed = loadProcessed_(dryerSS); // _SyncState lives in the Dryer book

  // One-time replay mode (set by replayQcEvents(), cleared by clearReplayFlag()).
  // When on, a re-served event is written even if the ledger already lists it.
  // The server only re-serves events whose outbox status was flipped back to
  // 'pending' (sheets_sync_requeue_qc() flips QC-only), so this never re-writes
  // Dryer events that were not deliberately re-queued.
  var replayForce = PropertiesService.getScriptProperties()
    .getProperty('REPLAY_FORCE_WRITE') === '1';

  // Track which QC tabs were written this tick so we format them ONCE at the
  // end (not per row). Keyed by tab name → true.
  var touchedQcTabs = {};

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var eventId = row.event_id;
    try {
      if (processed[eventId] && !replayForce) {
        // Second-layer dedup: already written in a prior tick.
        done.push(eventId);
        continue;
      }
      routeAndWrite_(row, dryerSS, qcSS);
      // Note the QC tab this event wrote to (for end-of-tick formatting).
      if (row.record_kind === 'qc_rm' || row.record_kind === 'qc_ip' || row.record_kind === 'qc_fg') {
        touchedQcTabs[TAB.QC[row.record_kind]] = true;
      }
      if (!processed[eventId]) {
        recordProcessed_(dryerSS, eventId);
        processed[eventId] = true;
      }
      done.push(eventId);
    } catch (err) {
      // Per-row try/catch: a bad row never aborts the batch.
      failed.push({ event_id: eventId, error: String(err && err.message ? err.message : err) });
    }
  }

  // Auto-format each QC tab that changed this tick (widths, wrap, row heights,
  // header styling). Cosmetic + once-per-tab — never blocks the ack.
  for (var tabName in touchedQcTabs) {
    if (touchedQcTabs.hasOwnProperty(tabName)) {
      var tsh = qcSS.getSheetByName(tabName);
      if (tsh) formatQcTab_(tsh);
    }
  }

  ackBatch_(cfg, done, failed);
}


/* ───────────────────────── HTTP: pull / ack ───────────────────────── */

function pullBatch_(cfg) {
  var url = cfg.PULL_URL + (cfg.PULL_URL.indexOf('?') >= 0 ? '&' : '?')
    + 'limit=' + PULL_BATCH_LIMIT;
  var resp = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { 'x-sheets-sync-secret': cfg.SHEETS_SYNC_SECRET },
    muteHttpExceptions: true
  });
  var code = resp.getResponseCode();
  if (code !== 200) {
    Logger.log('[pullBatch] HTTP ' + code + ' — aborting tick (rows stay pending).');
    return [];
  }
  var body = JSON.parse(resp.getContentText() || '{}');
  return body.rows || [];
}

function ackBatch_(cfg, done, failed) {
  if (done.length === 0 && failed.length === 0) return;
  var resp = UrlFetchApp.fetch(cfg.ACK_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-sheets-sync-secret': cfg.SHEETS_SYNC_SECRET },
    payload: JSON.stringify({ done: done, failed: failed }),
    muteHttpExceptions: true
  });
  var code = resp.getResponseCode();
  if (code !== 200) {
    // Unacked rows stay in_progress and are reclaimed after the lock timeout.
    Logger.log('[ackBatch] HTTP ' + code + ' — ack not recorded; rows will be reclaimed.');
  }
}


/* ───────────────────────── Routing ───────────────────────── */

function routeAndWrite_(row, dryerSS, qcSS) {
  var kind = row.record_kind;
  var type = row.event_type;

  if (kind === 'dryer') {
    if (type === 'current_snapshot') {
      writeDryerSnapshot_(dryerSS, row);
      return;
    }
    if (type === 'field_change') {
      appendHistory_(dryerSS, TAB.DRYER_HISTORY, buildDryerHistoryRow_(row));
      return;
    }
  } else if (kind === 'qc_rm' || kind === 'qc_ip' || kind === 'qc_fg') {
    var tabName = TAB.QC[kind];
    if (type === 'current_snapshot') {
      writeQcSnapshot_(qcSS, tabName, kind, row);
      return;
    }
    if (type === 'field_change') {
      writeQcFieldTimestamp_(qcSS, tabName, kind, row);
      return;
    }
  }

  throw new Error('Unroutable event: record_kind=' + kind + ' event_type=' + type);
}


/* ───────────────────────── Dryer writers ───────────────────────── */

function writeDryerSnapshot_(ss, row) {
  var payload = row.payload || {};
  var meta = payload.meta || {};
  var hours = payload.hours || [];

  // Current Records: one row per (date, dryer_type), meta/blower/footer only.
  var key = [coalesce_(meta.date), coalesce_(meta.dryer_type)];
  var header = ['date', 'dryer_type'].concat(DRYER_META_KEYS);
  var values = buildKeyedValues_(header, key.length, meta, DRYER_META_KEYS, row.source_pk);
  upsertByKey_(ss, TAB.DRYER_CURRENT, header, key.length, key, values);

  // Hourly Readings: 24 rows, one per (date, dryer_type, hour).
  var hHeader = ['date', 'dryer_type', 'hour'].concat(DRYER_HOURLY_KEYS);
  for (var i = 0; i < hours.length; i++) {
    var hr = hours[i] || {};
    var hourLabel = coalesce_(hr.hour !== undefined ? hr.hour : TIME_SLOTS[i]);
    var hKey = [coalesce_(meta.date), coalesce_(meta.dryer_type), hourLabel];
    var hValues = [hKey[0], hKey[1], hKey[2]];
    for (var k = 0; k < DRYER_HOURLY_KEYS.length; k++) {
      hValues.push(renderCell_(hr[DRYER_HOURLY_KEYS[k]]));
    }
    upsertByKey_(ss, TAB.DRYER_HOURLY, hHeader, 3, hKey, hValues);
  }
}

function buildDryerHistoryRow_(row) {
  return [
    renderTs_(row.record_ts),
    row.source_pk,
    row.hour,
    row.field_path,
    row.change_class,
    row.old_value,
    row.new_value,
    renderTs_(row.field_entry_ts),
    renderTs_(row.field_update_ts),
    row.event_id
  ];
}


/* ───────────────────────── QC writers ───────────────────────── */

/* ── QC column layout ─────────────────────────────────────────────
 * The header is:
 *   [identity labels…]  then, per field:  'Field Label', 'Field Label (Updated)'
 * We also keep a hidden business-key: identity columns form the key.
 * keyLen = number of identity columns that uniquely identify a record.
 * ─────────────────────────────────────────────────────────────────── */

// Which identity keys form the dedup/business key per section.
var QC_BUSINESS_KEY = {
  qc_rm: ['date', 'batch_no', 'tested_by'],
  qc_ip: ['date', 'batch_no', 'tested_by'],
  qc_fg: ['date', 'batch_no', 'product', 'grade', 'dryer']
};

/**
 * Build the full ordered header + the per-key column index maps for a QC tab.
 * Returns:
 *   header       : array of header labels (row 1)
 *   identityKeys : array of identity value-keys in column order
 *   valueCol     : { fieldKey -> 0-based column index of the value cell }
 *   tsCol        : { fieldKey -> 0-based column index of the "(Updated)" cell }
 *   idCol        : { identityKey -> 0-based column index }
 *   keyLen       : number of LEADING columns that form the business key
 */
function buildQcLayout_(kind) {
  var identity = QC_IDENTITY[kind];
  var fields   = QC_FIELD_CATALOG[kind];
  var bizKeys  = QC_BUSINESS_KEY[kind];

  var header = [];
  var identityKeys = [];
  var idCol = {};
  var valueCol = {};
  var tsCol = {};

  // Place business-key identity columns FIRST (so upsertByKey_ can match on a
  // contiguous leading block), then the remaining identity columns, then fields.
  var orderedIdentity = [];
  for (var b = 0; b < bizKeys.length; b++) {
    for (var j = 0; j < identity.length; j++) {
      if (identity[j][0] === bizKeys[b]) { orderedIdentity.push(identity[j]); break; }
    }
  }
  for (var j2 = 0; j2 < identity.length; j2++) {
    if (bizKeys.indexOf(identity[j2][0]) === -1) orderedIdentity.push(identity[j2]);
  }

  for (var i = 0; i < orderedIdentity.length; i++) {
    idCol[orderedIdentity[i][0]] = header.length;
    identityKeys.push(orderedIdentity[i][0]);
    header.push(orderedIdentity[i][1]);
  }

  var singleTs = QC_SINGLE_TIMESTAMP[kind] === true;

  if (singleTs) {
    // SINGLE-TIMESTAMP layout (RM): one value column per field, NO per-field
    // "(Updated)" column. A single shared "Timestamp" column (first field-entry
    // time of the record) sits after all field columns, then "Final Submission".
    for (var f = 0; f < fields.length; f++) {
      var key = fields[f][0];
      valueCol[key] = header.length;
      header.push(fields[f][1]);
    }
    var sharedTsCol = header.length;
    header.push('Timestamp');
    var finalColS = header.length;
    header.push('Final Submission Timestamp');

    return {
      header: header,
      identityKeys: identityKeys,
      idCol: idCol,
      valueCol: valueCol,
      tsCol: tsCol,                 // empty — no per-field ts in this mode
      sharedTsCol: sharedTsCol,     // the single shared "Timestamp" column
      finalCol: finalColS,
      keyLen: bizKeys.length,
      singleTs: true
    };
  }

  // PER-FIELD layout: value + its own timestamp column per field.
  // RM ('fixed'): the ts column header is literally "Timestamp"; association to
  // its field is POSITIONAL (the Timestamp column immediately follows its value).
  // IP/FG ('suffix'): "<Label> (Updated)".
  var tsMode = QC_TS_HEADER_MODE[kind] || 'suffix';
  for (var f2 = 0; f2 < fields.length; f2++) {
    var key2 = fields[f2][0];
    var label2 = fields[f2][1];
    valueCol[key2] = header.length;
    header.push(label2);
    tsCol[key2] = header.length;
    header.push(tsMode === 'fixed' ? 'Timestamp' : (label2 + ' (Updated)'));
  }

  var finalCol = header.length;
  header.push('Final Submission');

  return {
    header: header,
    identityKeys: identityKeys,
    idCol: idCol,
    valueCol: valueCol,
    tsCol: tsCol,
    finalCol: finalCol,
    keyLen: bizKeys.length,
    singleTs: false
  };
}

/**
 * current_snapshot → upsert ONE row per record into the section tab, filling
 * every identity column + every present field's VALUE cell + Final Submission.
 * The per-field "(Updated)" cells are filled by writeQcFieldTimestamp_ (from
 * field_change events); the snapshot does NOT overwrite them.
 */
function writeQcSnapshot_(ss, tabName, kind, row) {
  var payload = row.payload || {};
  var vals = payload.values || {};
  var layout = buildQcLayout_(kind);

  var sh = getOrCreateSheet_(ss, tabName);
  var liveHeader = ensureHeader_(sh, layout.header);
  var width = Math.max(liveHeader.length, layout.header.length);

  // Each QC submission is ONE record = ONE row, keyed by source_pk. The
  // field_change events for the same record share the same source_pk, so
  // both writers land on the same row (snapshot fills values + identity;
  // field_change fills each field's "(Updated)" timestamp).
  var rowIdx = findOrAppendQcRowBySourcePk_(sh, layout, row.source_pk, width);
  var fullWidth = Math.max(sh.getLastColumn(), width);
  var existing = sh.getRange(rowIdx, 1, 1, fullWidth).getValues()[0];

  // Fill identity columns. 'material' is stored as an id (e.g. 'sulphurPowder')
  // → render the website label so the Material column shows the real option.
  for (var i = 0; i < layout.identityKeys.length; i++) {
    var idk = layout.identityKeys[i];
    var col = layout.idCol[idk];
    var idv;
    if (idk === 'date') {
      idv = coalesce_(vals.date || payload.date);
    } else if (idk === 'tested_by') {
      idv = coalesce_(vals.tested_by || payload.tested_by);
    } else if (idk === 'material') {
      var mid = coalesce_(vals.material);
      idv = RM_MATERIAL_LABELS[mid] || mid;   // label if known, else raw id
    } else {
      idv = coalesce_(vals[idk]);
    }
    if (idv !== '') existing[col] = idv;
  }

  // Fill present field VALUE cells (leave per-field "(Updated)" cells, when
  // present, untouched so a field_change timestamp written earlier is kept).
  var fields = QC_FIELD_CATALOG[kind];
  for (var f = 0; f < fields.length; f++) {
    var fk = fields[f][0];
    if (vals[fk] !== undefined && vals[fk] !== null && String(vals[fk]) !== '') {
      existing[layout.valueCol[fk]] = renderCell_(vals[fk]);
    }
  }

  // Final submission timestamp (hh:mm AM/PM).
  existing[layout.finalCol] = renderClock_(payload.final_submission_ts);

  sh.getRange(rowIdx, 1, 1, existing.length).setValues([existing]);
}

/**
 * field_change → upsert the SAME section row by business key and write ONLY the
 * matching field's "(Updated)" timestamp cell. Updating one field never touches
 * another field's timestamp. The field VALUE itself also gets written here so a
 * field entered before the snapshot is still visible.
 */
function writeQcFieldTimestamp_(ss, tabName, kind, row) {
  var layout = buildQcLayout_(kind);

  // field_path grammar is 'values.<key>'.
  var fieldKey = String(row.field_path || '').replace(/^values\./, '');
  if (layout.valueCol[fieldKey] === undefined) {
    // Field not in the catalog for this section — ignore quietly.
    return;
  }

  var sh = getOrCreateSheet_(ss, tabName);
  var liveHeader = ensureHeader_(sh, layout.header);
  var width = Math.max(liveHeader.length, layout.header.length);

  // Reconstruct the business key from the field_change event. The event does
  // not carry the full values object, so we derive the key from the columns we
  // have: field_change rows share the record's identity via a prior snapshot.
  // We match on source_pk stored in a hidden column so the right row is found
  // even before a snapshot exists.
  var rowIdx = findOrAppendQcRowBySourcePk_(sh, layout, row.source_pk, width);

  var existing = sh.getRange(rowIdx, 1, 1, width).getValues()[0];

  // Always write the field value (so a field entered before the snapshot is
  // visible). Timestamp handling differs by layout mode:
  if (row.new_value !== undefined && row.new_value !== null) {
    existing[layout.valueCol[fieldKey]] = String(row.new_value);
  }

  if (layout.singleTs) {
    // SINGLE-TIMESTAMP: one shared "Timestamp" = record's FIRST field entry.
    var sharedCol = layout.sharedTsCol;
    if (coalesce_(existing[sharedCol]) === '' && row.field_entry_ts) {
      existing[sharedCol] = renderFieldTs_(kind, row.field_entry_ts);
    }
  } else {
    // PER-FIELD: write THIS field's own timestamp cell = its ORIGINAL entry
    // time (field_entry_ts, the time the WEBSITE recorded the value, NOT the
    // sheet upload time). Write ONLY if the cell is still empty, so a later
    // edit NEVER overwrites the original entry timestamp.
    var tsCell = layout.tsCol[fieldKey];
    if (coalesce_(existing[tsCell]) === '') {
      var entryTs = row.field_entry_ts || row.field_update_ts;
      if (entryTs) existing[tsCell] = renderFieldTs_(kind, entryTs);
    }
  }

  sh.getRange(rowIdx, 1, 1, existing.length).setValues([existing]);
}

/**
 * Match a QC row by a hidden "_source_pk" column so field_change events (which
 * carry source_pk, not the full key) land on the same row as their snapshot.
 * The hidden column is the LAST column of the sheet, created on demand.
 */
function findOrAppendQcRowBySourcePk_(sh, layout, sourcePk, width) {
  // Ensure a trailing hidden _source_pk column exists.
  var header = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
  var pkCol = header.indexOf('_source_pk');
  if (pkCol === -1) {
    pkCol = Math.max(header.length, width);
    sh.getRange(1, pkCol + 1).setValue('_source_pk');
    // Hide the internal key column from operators.
    try { sh.hideColumns(pkCol + 1); } catch (e) { /* ignore if already hidden */ }
  }
  var fullWidth = Math.max(sh.getLastColumn(), pkCol + 1);

  var lastRow = sh.getLastRow();
  if (lastRow >= 2) {
    var pks = sh.getRange(2, pkCol + 1, lastRow - 1, 1).getValues();
    for (var r = 0; r < pks.length; r++) {
      if (coalesce_(pks[r][0]) === coalesce_(sourcePk)) return r + 2;
    }
  }
  // Append a new blank row carrying the source_pk.
  var blank = [];
  for (var i = 0; i < fullWidth; i++) blank.push('');
  blank[pkCol] = coalesce_(sourcePk);
  sh.appendRow(blank);
  return sh.getLastRow();
}


/* ───────────────────────── Sheet helpers ───────────────────────── */

function getOrCreateSheet_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}

/**
 * Make a QC tab readable: auto-fit column widths to BOTH header and data,
 * wrap long columns, auto-size row heights, and style the header row.
 * Called once per tick per QC tab that was written (not per row), so it never
 * resizes repeatedly within a batch. Touches ONLY the given sheet.
 *
 * Width logic: auto-resize every column, then cap exceptionally wide text
 * columns at a maximum and enable wrapping there so nothing is truncated.
 */
var QC_MAX_COL_WIDTH = 240;   // px cap for very long text columns (then wrap)
var QC_MIN_COL_WIDTH = 70;    // px floor so a 1–2 char value isn't razor-thin

function formatQcTab_(sh) {
  try {
    var lastCol = sh.getLastColumn();
    var lastRow = sh.getLastRow();
    if (lastCol < 1 || lastRow < 1) return;

    // Find the hidden internal key column so we never resize/unhide it.
    var headerVals = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    var pkCol0 = headerVals.indexOf('_source_pk');   // 0-based, -1 if absent
    var visibleCols = (pkCol0 >= 0) ? pkCol0 : lastCol;  // format up to (not incl.) the key col

    // 1. Auto-resize visible columns to fit header + data.
    if (visibleCols >= 1) sh.autoResizeColumns(1, visibleCols);

    // 2. Cap very wide columns and enable wrapping so long headers and values
    //    stay fully visible across multiple lines.
    for (var c = 1; c <= visibleCols; c++) {
      var w = sh.getColumnWidth(c);
      if (w > QC_MAX_COL_WIDTH) sh.setColumnWidth(c, QC_MAX_COL_WIDTH);
      else if (w < QC_MIN_COL_WIDTH) sh.setColumnWidth(c, QC_MIN_COL_WIDTH);
    }

    if (visibleCols >= 1) {
      var fullRange = sh.getRange(1, 1, lastRow, visibleCols);
      fullRange.setWrap(true);
      fullRange.setVerticalAlignment('middle');
    }

    // Keep the internal key column hidden if present.
    if (pkCol0 >= 0) { try { sh.hideColumns(pkCol0 + 1); } catch (e) {} }

    // 3. Header row: bold, light fill, wrapped, frozen so it stays visible.
    if (visibleCols >= 1) {
      var headerRange = sh.getRange(1, 1, 1, visibleCols);
      headerRange.setFontWeight('bold');
      headerRange.setBackground('#f0ebe3');
      headerRange.setHorizontalAlignment('center');
    }
    if (sh.getFrozenRows() < 1) sh.setFrozenRows(1);

    // 4. Auto-size row heights so wrapped text is fully visible.
    try { sh.autoResizeRows(1, lastRow); } catch (e) { /* older runtimes */ }
  } catch (e) {
    // Formatting is cosmetic — never let it fail a sync write.
    Logger.log('[formatQcTab_] skipped: ' + e.message);
  }
}

function ensureHeader_(sh, header) {
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, header.length).setValues([header]);
    return header;
  }
  var width = Math.max(sh.getLastColumn(), header.length);
  var existing = sh.getRange(1, 1, 1, width).getValues()[0];
  // Grow the header if this payload introduced new columns.
  var changed = false;
  for (var i = 0; i < header.length; i++) {
    if (coalesce_(existing[i]) === '' && header[i] !== undefined) {
      existing[i] = header[i];
      changed = true;
    }
  }
  if (changed) {
    sh.getRange(1, 1, 1, existing.length).setValues([existing]);
  }
  return existing;
}

/**
 * Upsert a row by an exact match of the first keyLen cells. The whole key
 * tuple must match to overwrite; otherwise append. If every key component is
 * empty, fall back to source_pk written in the first cell (design §5.2 rule 2).
 */
function upsertByKey_(ss, tabName, header, keyLen, key, rowValues) {
  var sh = getOrCreateSheet_(ss, tabName);
  var liveHeader = ensureHeader_(sh, header);
  var width = Math.max(liveHeader.length, rowValues.length);

  // Wholly-empty key → fall back to source_pk (always the LAST rowValues cell
  // is not source_pk; callers pass it as the fallback via buildKeyedValues_).
  var allEmpty = true;
  for (var e = 0; e < keyLen; e++) {
    if (coalesce_(key[e]) !== '') { allEmpty = false; break; }
  }

  var targetRow = -1;
  var lastRow = sh.getLastRow();
  if (lastRow >= 2) {
    var existing = sh.getRange(2, 1, lastRow - 1, keyLen).getValues();
    for (var r = 0; r < existing.length; r++) {
      var match = true;
      for (var c = 0; c < keyLen; c++) {
        if (coalesce_(existing[r][c]) !== coalesce_(key[c])) { match = false; break; }
      }
      if (match && !allEmpty) { targetRow = r + 2; break; }
    }
  }

  // Pad rowValues to the sheet width.
  var out = rowValues.slice();
  while (out.length < width) out.push('');

  if (targetRow > 0) {
    sh.getRange(targetRow, 1, 1, out.length).setValues([out]);
  } else {
    sh.appendRow(out);
  }
}

/**
 * Build the value array for a current-records row: [key…, meta values…],
 * falling back to source_pk in the first key cell when the key is wholly empty.
 */
function buildKeyedValues_(header, keyLen, meta, metaKeys, sourcePk) {
  var key = [];
  for (var i = 0; i < keyLen; i++) {
    key.push(coalesce_(meta[header[i]]));
  }
  var allEmpty = true;
  for (var e = 0; e < key.length; e++) {
    if (key[e] !== '') { allEmpty = false; break; }
  }
  if (allEmpty) key[0] = coalesce_(sourcePk);

  var values = key.slice();
  for (var m = 0; m < metaKeys.length; m++) {
    var mk = metaKeys[m];
    if (mk === 'final_submission_ts') {
      values.push(renderTs_(meta[mk]));
    } else {
      values.push(renderCell_(meta[mk]));
    }
  }
  return values;
}

function appendHistory_(ss, tabName, rowValues) {
  var sh = getOrCreateSheet_(ss, tabName);
  if (sh.getLastRow() === 0) {
    // Minimal header; history is append-only.
    var header = rowValues.length === 10
      ? ['record_ts', 'source_pk', 'hour', 'field_path', 'change_class',
         'old_value', 'new_value', 'field_entry_ts', 'field_update_ts', 'event_id']
      : ['record_ts', 'source_pk', 'field_path', 'change_class',
         'old_value', 'new_value', 'field_entry_ts', 'field_update_ts', 'event_id'];
    sh.getRange(1, 1, 1, header.length).setValues([header]);
  }
  sh.appendRow(rowValues);
}


/* ───────────────────────── _SyncState dedup ───────────────────────── */

function loadProcessed_(ss) {
  var sh = ss.getSheetByName(SYNC_STATE_SHEET);
  if (!sh) {
    sh = ss.insertSheet(SYNC_STATE_SHEET);
    sh.getRange(1, 1, 1, 2).setValues([['event_id', 'processed_at']]);
    sh.hideSheet();
    return {};
  }
  var map = {};
  var lastRow = sh.getLastRow();
  if (lastRow >= 2) {
    var ids = sh.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      var id = coalesce_(ids[i][0]);
      if (id !== '') map[id] = true;
    }
  }
  return map;
}

function recordProcessed_(ss, eventId) {
  var sh = ss.getSheetByName(SYNC_STATE_SHEET) || ss.insertSheet(SYNC_STATE_SHEET);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, 2).setValues([['event_id', 'processed_at']]);
    sh.hideSheet();
  }
  sh.appendRow([eventId, renderTs_(new Date().toISOString())]);
}


/* ───────────────────────── Value rendering ───────────────────────── */

function coalesce_(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

/** Render a stored value as text exactly as stored; objects/arrays as JSON. */
function renderCell_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Render a timestamp in readable local time; pass non-dates through as text. */
function renderTs_(v) {
  if (v === null || v === undefined || v === '') return '';
  var d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

/**
 * Render a per-field change timestamp as "hh:mm AM/PM" in the business
 * timezone (design §4 requirement). Falls back to raw text for non-dates.
 * Uses IST (Asia/Kolkata) regardless of the script's own timezone so the
 * displayed clock always matches the plant's local time.
 */
function renderClock_(v) {
  if (v === null || v === undefined || v === '') return '';
  var d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  // Final Submission keeps date + time so it reads as a full submission moment.
  return Utilities.formatDate(d, 'Asia/Kolkata', 'dd/MM/yyyy hh:mm:ss a');
}

/**
 * Render an INDIVIDUAL field-entry timestamp (the time the WEBSITE recorded the
 * value — field_entry_ts), per-section format, in IST. RM shows TIME ONLY
 * ("hh:mm:ss AM/PM", e.g. "10:15:32 AM"). Never uses new Date()/upload time.
 */
function renderFieldTs_(kind, v) {
  if (v === null || v === undefined || v === '') return '';
  var d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  var fmt = (QC_TS_FORMAT && QC_TS_FORMAT[kind]) ? QC_TS_FORMAT[kind] : 'hh:mm:ss a';
  return Utilities.formatDate(d, 'Asia/Kolkata', fmt);
}
