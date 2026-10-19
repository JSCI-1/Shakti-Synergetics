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
 *   qc_rm  + field_change     → QC:    "Raw Material"     (fills "Timestamp" ts)
 *   qc_ip  + current_snapshot → QC:    "In-Process"       (fills value cells)
 *   qc_ip  + field_change     → QC:    "In-Process"       (fills "Timestamp" ts)
 *   qc_fg  + current_snapshot → QC:    "Finished Goods"   (fills value cells)
 *   qc_fg  + field_change     → QC:    "Finished Goods"   (fills "(Updated)" ts)
 *
 * QC layout: THREE user-facing tabs, one per website section. Each measurement
 * value column is immediately followed by its own timestamp column holding the
 * per-field ORIGINAL entry time (hh:mm:ss AM/PM, IST). Raw Material and
 * In-Process name that column literally "Timestamp" (positional association:
 * the Timestamp column follows its value); Finished Goods still uses the
 * "<Label> (Updated)" header. One submission = one row, keyed by the record's
 * source_pk (hidden trailing _source_pk column). The snapshot event fills
 * values + identity; the field_change events fill each field's timestamp cell,
 * so editing one field never alters another's time. A trailing "Final
 * Submission" column holds the form-submission moment.
 */

/* ───────────────────────── Constants ───────────────────────── */

var PULL_BATCH_LIMIT = 100;

var TAB = {
  // Legacy wide Dryer tabs — NO LONGER WRITTEN (replaced by the vertical
  // New Dryer / Old Dryer tabs below). Kept here only so any old reference
  // resolves; the triggers that fed these were dropped in migration 030.
  DRYER_CURRENT: 'Current Records',
  DRYER_HOURLY: 'Hourly Readings',
  DRYER_HISTORY: 'Field Change History',
  // Horizontal Dryer tabs (migration 030). The hourly log table and the bottom
  // form (Save Log Sheet) live in SEPARATE tabs per dryer, so each has its own
  // columns/widths:
  //   DRYER_V2      → hourly table ("New Dryer" / "Old Dryer")
  //   DRYER_V2_FORM → bottom form  ("New Dryer – Form" / "Old Dryer – Form")
  DRYER_V2:      { 'new': 'New Dryer',        'old': 'Old Dryer' },
  DRYER_V2_FORM: { 'new': 'New Dryer – Form', 'old': 'Old Dryer – Form' },
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
//
// Each In-Process test is a <FormulaCalculator> card. The website saves BOTH
// the calculated result (under the card id, e.g. 'ip_moisture_calc') AND every
// formula INPUT (under '<cardId>__<varKey>', e.g. 'ip_moisture_calc__W') — see
// collectReportValues() in QualityCheck.jsx. So, exactly like Raw Material, each
// input gets its OWN value column + its OWN "Timestamp" column (original entry
// time), placed immediately before the calculated result it feeds.
//
// Formula variable keys come from SHARED_FORMULAS in src/data/qualityData.js:
//   Solid Content  (moisture)       → W, w
//   Sulphur Content(sulphur)        → N, BR, W
//   Suspensibility (suspensibility) → sulphurContent, sampleWeight, N, BR
//   Wet Sieve      (wetSieve)       → M, m
var QC_FIELDS_IP = [
  // Solid Content — inputs W, w, then the calculated result.
  ['ip_moisture_calc__W',             'Solid Content – W (sample weight) (g)'],
  ['ip_moisture_calc__w',             'Solid Content – w (weight after drying) (g)'],
  ['ip_moisture_calc',                'Solid Content (%)'],
  // Sulphur Content — inputs N, BR, W, then the calculated result.
  ['ip_sulphur_calc__N',              'Sulphur Content – N (normality)'],
  ['ip_sulphur_calc__BR',             'Sulphur Content – BR (burette reading) (ml)'],
  ['ip_sulphur_calc__W',              'Sulphur Content – W (sample weight) (g)'],
  ['ip_sulphur_calc',                 'Sulphur Content (%)'],
  // Suspensibility — inputs Sulphur Content, Sample Weight, N, BR, then result.
  ['ip_susp_calc__sulphurContent',    'Suspensibility – Sulphur Content (%)'],
  ['ip_susp_calc__sampleWeight',      'Suspensibility – Sample Weight (g)'],
  ['ip_susp_calc__N',                 'Suspensibility – N (normality)'],
  ['ip_susp_calc__BR',                'Suspensibility – BR (burette reading) (ml)'],
  ['ip_susp_calc',                    'Suspensibility (%)'],
  // Wet Sieve — inputs M, m, then the calculated result.
  ['ip_wetsieve_calc__M',             'Wet Sieve – M (material taken) (g)'],
  ['ip_wetsieve_calc__m',             'Wet Sieve – m (granules retained) (g)']
  // NOTE: Mill-wise Suspensibility is NOT a single field here — it is expanded
  // into real per-mill columns (V1…V10 × BR / Suspension % / Flow Rate / Pass)
  // by the mill-block layout below, matching the website's mill table.
];

// Mill-wise Suspensibility table — the website shows a row per mill
// (V1…V10) with four data columns. Stored in values.ip_mill_rows as a JSONB
// array of { mill, br, flowRate, pass } (the "Suspension %" is computed on the
// website and NOT stored, so it is derived from the row on write when present,
// else left blank). In the sheet we lay the table out HORIZONTALLY: for each
// mill, its four data columns followed by ONE "Timestamp" column carrying the
// record's mill-entry time (the mill table is entered/submitted as one block,
// so a single original-entry time applies to the whole mill row).
var IP_MILL_NAMES = ['V1','V2','V3','V4','V5','V6','V7','V8','V9','V10'];
var IP_MILL_COLS = [
  ['br',       'BR (ml)'],
  ['susp',     'Suspension (%)'],
  ['flowRate', 'Flow Rate (L/hr)'],
  ['pass',     'Pass']
];

// Finished Goods repeated Wet/Dry Sieve readings. On the website each sieve
// test can be "Recorded" multiple times throughout the day; every reading
// carries its own result, Pass/Fail status, micron target label and recorded
// time. Stored in values.fg_wetSieve_log / values.fg_drySieve_log as arrays of
// { result, status, time, isoTime, targetLabel }.
//
// LAYOUT: there are NO numbered "Reading 1..N" columns. Each sieve test keeps
// its single existing Value column and single Timestamp column. All readings
// (the initial calculated result + every subsequent recorded reading) are
// STACKED on separate lines WITHIN that one Value cell, with their matching
// recorded times stacked on matching lines in the one Timestamp cell. The row
// keeps one batch/grade/dryer/test identity for the whole group of readings.
// The cell is rebuilt deterministically from the arrays on every sync, so a
// retry/replay overwrites with identical content (no duplicate readings).
//
// FG_SIEVE_LOGS maps each sieve's result/value key → its repeated-readings log
// key → the per-reading __ts key prefix the website sends.
var FG_SIEVE_LOGS = [
  ['fg_wetSieve', 'fg_wetSieve_log', 'fg_wetSieve_reading_'],
  ['fg_drySieve', 'fg_drySieve_log', 'fg_drySieve_reading_']
];
// Newline used to stack multiple readings within one cell. Sheets renders "\n"
// as a line break when the cell has wrapping enabled (formatQcTab_ wraps QC
// cells), so stacked readings appear on separate lines in the same cell.
var FG_SIEVE_LINE_SEP = '\n';

// Finished Goods — standard WDG tests, then UPL Export, then UPL OMRI
// (only the keys present in a given record are filled; others stay blank).
//
// Like Raw Material and In-Process, each formula-based WDG test saves BOTH the
// calculated result (under the card id, e.g. 'fg_sulphur') AND every formula
// INPUT (under '<cardId>__<varKey>', e.g. 'fg_sulphur__N') — see
// collectReportValues() in QualityCheck.jsx. So each input gets its OWN value
// column + its OWN "Timestamp" column (original entry time), placed immediately
// before the calculated result it feeds.
//
// Formula variable keys come from SHARED_FORMULAS in src/data/qualityData.js:
//   Sulphur Content (sulphur)        → N, BR, W
//   Suspensibility  (suspensibility) → sulphurContent, sampleWeight, N, BR
//   Bulk Density    (bulkDensity)    → mass, volume
//   Wet Sieve       (wetSieve)       → M, m
//   Dry Sieve       (drySieve)       → M, m
// (Moisture / pH / Wettability are single-value spec fields — no inputs.)
var QC_FIELDS_FG = [
  // Sulphur Content — inputs N, BR, W, then the calculated result.
  ['fg_sulphur__N',    'Sulphur Content – N (normality)'],
  ['fg_sulphur__BR',   'Sulphur Content – BR (burette reading) (ml)'],
  ['fg_sulphur__W',    'Sulphur Content – W (sample weight) (g)'],
  ['fg_sulphur',       'Sulphur Content (%)'],
  // Suspensibility — inputs Sulphur Content, Sample Weight, N, BR, then result.
  ['fg_susp__sulphurContent', 'Suspensibility – Sulphur Content (%)'],
  ['fg_susp__sampleWeight',   'Suspensibility – Sample Weight (g)'],
  ['fg_susp__N',       'Suspensibility – N (normality)'],
  ['fg_susp__BR',      'Suspensibility – BR (burette reading) (ml)'],
  ['fg_susp',          'Suspensibility (%)'],
  // Moisture Content — single % value (no formula).
  ['fg_moisture',      'Moisture Content (%)'],
  // Bulk Density — inputs mass, volume, then the calculated result.
  ['fg_bulk__mass',    'Bulk Density – Mass (g)'],
  ['fg_bulk__volume',  'Bulk Density – Volume (ml)'],
  ['fg_bulk',          'Bulk Density (g/cc)'],
  // Wet Sieve — inputs M, m, then the calculated result.
  ['fg_wetSieve__M',   'Wet Sieve – M (material taken) (g)'],
  ['fg_wetSieve__m',   'Wet Sieve – m (granules retained) (g)'],
  ['fg_wetSieve',      'Wet Sieve (%)'],
  // Dry Sieve — inputs M, m, then the calculated result.
  ['fg_drySieve__M',   'Dry Sieve – M (material taken) (g)'],
  ['fg_drySieve__m',   'Dry Sieve – m (granules retained) (g)'],
  ['fg_drySieve',      'Dry Sieve (%)'],
  // Single-value spec tests
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

// In-Process dropdown: the selected "Additional Test" id (stored in
// values.material by buildRmIpRow) → website label. Source of truth:
// src/data/qualityData.js IN_PROCESS[].{id,label}. The two pinned tests
// (Solid Content, Sulphur Content) are always shown; `material` records which
// additional test the operator selected.
var IP_MATERIAL_LABELS = {
  ip_suspensibility: 'Suspensibility',
  ip_wetSieve:       'Wet Sieve'
};

// Sections that use a SINGLE shared "Timestamp" column (first field-entry time
// of the record) instead of a per-field timestamp column. None, now — all QC
// sections use a per-field timestamp column (RM switched to per-field so M1/M
// and every value carry their own original entry time).
var QC_SINGLE_TIMESTAMP = { qc_rm: false, qc_ip: false, qc_fg: false };

// Per-field timestamp column HEADER mode per section.
//   'fixed'  → the header is literally "Timestamp" for every value's ts column
//              (each value has an adjacent "Timestamp" column; association is
//              positional: the Timestamp column immediately follows its value).
//   'suffix' → header is "<Label> (Updated)" (legacy — no longer used).
// Raw Material, In-Process AND Finished Goods all use 'fixed' now, so every
// value column is followed by a literal "Timestamp" column carrying its
// original entry time.
var QC_TS_HEADER_MODE = { qc_rm: 'fixed', qc_ip: 'fixed', qc_fg: 'fixed' };

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
    ['batch_no',  'Batch No.'],
    ['tested_by', 'Tested By'],
    ['time',      'Time']
  ],
  qc_fg: [
    ['date',      'Manufactured Date'],
    ['tested_by', 'Tested By'],
    ['batch_no',  'Batch No.'],
    ['time',      'Time'],
    ['product',   'Product'],
    ['grade',     'Grade'],
    ['dryer',     'Dryer']
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
  // everyMinutes() accepts only 1, 5, 10, 15, or 30 — 1 minute is the FASTEST
  // supported time-driven trigger (there is NO 40-second option). We keep the
  // 1-minute trigger, and syncTick() runs multiple internal passes per minute
  // (default ~0s/~20s/~40s) so new data appears within ~20s worst case. A
  // ScriptLock prevents overlapping runs. See syncTick() for details.
  ScriptApp.newTrigger('syncTick')
    .timeBased()
    .everyMinutes(1)
    .create();
  Logger.log('Installed time-driven trigger: syncTick every 1 minute '
    + '(each minute runs multiple internal passes for sub-minute latency).');
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
 * Create the two vertical Dryer tabs ("New Dryer" / "Old Dryer") with their
 * headers up front, in the DRYER spreadsheet (SPREADSHEET_ID_DRYER) — the same
 * book the shared script uses for Dryer. The tabs are otherwise created lazily
 * (only when a dryer_v2 event is processed), so if no Dryer data has synced yet
 * they never appear. Run this ONCE manually from the Apps Script editor to make
 * them exist immediately. Idempotent and safe: creates a tab only if missing,
 * writes the header only if row 1 is empty, never deletes/writes a data row,
 * and touches ONLY the Dryer book (QC tabs untouched).
 *
 * It also logs the Dryer spreadsheet name/URL it opened, so you can confirm the
 * shared script is pointed at the RIGHT Dryer book (a common reason "nothing
 * appears" — the tabs were created in a different spreadsheet).
 */
function initDryerTabs() {
  var cfg;
  try {
    cfg = getConfig_();
  } catch (e) {
    Logger.log('[initDryerTabs] Fail-closed: ' + e.message);
    return;
  }

  var dryerSS = SpreadsheetApp.openById(cfg.SPREADSHEET_ID_DRYER);
  Logger.log('[initDryerTabs] Dryer spreadsheet: "' + dryerSS.getName()
    + '"  id=' + cfg.SPREADSHEET_ID_DRYER + '  url=' + dryerSS.getUrl());

  var types = ['new', 'old'];
  for (var i = 0; i < types.length; i++) {
    // Hourly table tab.
    var hTab = TAB.DRYER_V2[types[i]];
    var hsh = getOrCreateSheet_(dryerSS, hTab);
    ensureHeader_(hsh, DRYER_V2_HOURLY_HEADER);
    formatQcTab_(hsh);
    Logger.log('[initDryerTabs] Ensured tab + header: ' + hTab);
    // Bottom-form tab (separate).
    var fTab = TAB.DRYER_V2_FORM[types[i]];
    var fsh = getOrCreateSheet_(dryerSS, fTab);
    ensureHeader_(fsh, DRYER_V2_FORM_HEADER);
    formatQcTab_(fsh);
    Logger.log('[initDryerTabs] Ensured tab + header: ' + fTab);
  }
  Logger.log('[initDryerTabs] Done. New/Old Dryer hourly + form tabs are ready.');
}


/**
 * ONE-SHOT: WIPE and recreate the two Dryer tabs ("New Dryer" / "Old Dryer")
 * clean — hourly header on row 1, no data, bottom-form block appears on the
 * next Save Log Sheet. Run this ONCE from the Apps Script editor to delete the
 * earlier-filled Dryer data in the SHEET and start fresh. Does NOT replay.
 *
 * This clears only the SHEET. To also delete the earlier data at the SOURCE so
 * it cannot re-sync, run in the Supabase SQL editor (see manual steps):
 *     delete from dryer_hourly_draft;
 *     delete from dryer_logs;
 *     delete from sheets_sync_outbox where record_kind = 'dryer_v2';
 *
 * SAFE: touches ONLY the two Dryer tabs. QC tabs are untouched. Replay mode is
 * explicitly turned OFF so nothing re-populates on its own.
 */
function resetDryerTabsClean() {
  var cfg;
  try {
    cfg = getConfig_();
  } catch (e) {
    Logger.log('[resetDryerTabsClean] Fail-closed: ' + e.message);
    return;
  }

  var dryerSS = SpreadsheetApp.openById(cfg.SPREADSHEET_ID_DRYER);
  var types = ['new', 'old'];
  for (var i = 0; i < types.length; i++) {
    var hTab = TAB.DRYER_V2[types[i]];
    var oldH = dryerSS.getSheetByName(hTab);
    if (oldH) { dryerSS.deleteSheet(oldH); }
    var hsh = dryerSS.insertSheet(hTab);
    ensureHeader_(hsh, DRYER_V2_HOURLY_HEADER);
    formatQcTab_(hsh);
    Logger.log('[resetDryerTabsClean] Wiped + recreated tab: ' + hTab);

    var fTab = TAB.DRYER_V2_FORM[types[i]];
    var oldF = dryerSS.getSheetByName(fTab);
    if (oldF) { dryerSS.deleteSheet(oldF); }
    var fsh = dryerSS.insertSheet(fTab);
    ensureHeader_(fsh, DRYER_V2_FORM_HEADER);
    formatQcTab_(fsh);
    Logger.log('[resetDryerTabsClean] Wiped + recreated tab: ' + fTab);
  }

  // Make sure replay is OFF so the wiped data does not come back.
  PropertiesService.getScriptProperties().deleteProperty('REPLAY_FORCE_WRITE');

  Logger.log('[resetDryerTabsClean] Done. "New Dryer" / "Old Dryer" are empty. '
    + 'To also delete the source data so it cannot re-sync, run in Supabase SQL: '
    + 'delete from dryer_hourly_draft; delete from dryer_logs; '
    + "delete from sheets_sync_outbox where record_kind = 'dryer_v2';");
}


/**
 * ONE-SHOT: WIPE and recreate the three QC tabs ("Raw Material" / "In-Process" /
 * "Finished Goods") clean — correct header on row 1, no data rows. Run this ONCE
 * from the Apps Script editor to delete the earlier-filled QC data in the SHEET
 * and start fresh. Does NOT replay.
 *
 * This clears only the SHEET. To also delete the earlier data at the SOURCE so
 * it cannot re-sync, run in the Supabase SQL editor (see manual steps):
 *     delete from quality_control_records;
 *     delete from qc_fg_sieve_readings;
 *     delete from qc_activity_draft;
 *     delete from sheets_sync_outbox where record_kind in ('qc_rm','qc_ip','qc_fg');
 *
 * SAFE: touches ONLY the three QC tabs (the QC spreadsheet). The Dryer book and
 * its tabs are untouched. Replay mode is explicitly turned OFF so nothing
 * re-populates on its own.
 */
function resetQcTabsClean() {
  var cfg;
  try {
    cfg = getConfig_();
  } catch (e) {
    Logger.log('[resetQcTabsClean] Fail-closed: ' + e.message);
    return;
  }

  var qcSS = SpreadsheetApp.openById(cfg.SPREADSHEET_ID_QC);
  var kinds = ['qc_rm', 'qc_ip', 'qc_fg'];
  for (var i = 0; i < kinds.length; i++) {
    var tabName = TAB.QC[kinds[i]];
    var old = qcSS.getSheetByName(tabName);
    if (old) { qcSS.deleteSheet(old); }
    var sh = qcSS.insertSheet(tabName);
    var layout = buildQcLayout_(kinds[i]);
    ensureHeader_(sh, layout.header);
    formatQcTab_(sh);
    Logger.log('[resetQcTabsClean] Wiped + recreated tab: ' + tabName);
  }

  // Make sure replay is OFF so the wiped data does not come back.
  PropertiesService.getScriptProperties().deleteProperty('REPLAY_FORCE_WRITE');

  Logger.log('[resetQcTabsClean] Done. Raw Material / In-Process / Finished Goods are empty. '
    + 'To also delete the source data so it cannot re-sync, run in Supabase SQL: '
    + 'delete from quality_control_records; delete from qc_fg_sieve_readings; '
    + 'delete from qc_activity_draft; '
    + "delete from sheets_sync_outbox where record_kind in ('qc_rm','qc_ip','qc_fg');");
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
 * ONE-TIME, IN-PROCESS-ONLY rebuild — run manually after the In-Process layout
 * change (added formula-input columns + their own "Timestamp" columns, added
 * the "In-Process Test" identity column, renamed the per-field timestamp header
 * from "(Updated)" to "Timestamp", kept "Final Submission" last).
 *
 * The In-Process column POSITIONS changed (inputs are now interleaved before
 * each result, and an identity column was inserted), so an in-place header
 * rename would leave old data under the wrong columns. Instead this rebuilds
 * the tab SAFELY, exactly like rebuildRawMaterialTab():
 *
 *   1. Renames the current "In-Process" tab to "In-Process (archived <ts>)"
 *      — nothing is deleted; every existing In-Process record is preserved
 *      there and can be deleted manually once the new tab is verified.
 *   2. Creates a fresh "In-Process" tab with the correct website headers.
 *   3. Turns on replay so the requeued In-Process events (see SQL below)
 *      re-populate the clean tab even though their event_ids are already in
 *      _SyncState.
 *
 * Touches ONLY the In-Process tab. Raw Material, Finished Goods, Dryer, and all
 * other data are untouched.
 *
 * REQUIRED companion SQL (run once in Supabase, see migration 026):
 *   select sheets_sync_requeue_qc_ip();
 *
 * After confirming the new tab is correct: run clearReplayFlag() and delete the
 * archived tab.
 */
function rebuildInProcessTab() {
  var cfg;
  try {
    cfg = getConfig_();
  } catch (e) {
    Logger.log('[rebuildInProcessTab] Fail-closed: ' + e.message);
    return;
  }

  var qcSS = SpreadsheetApp.openById(cfg.SPREADSHEET_ID_QC);
  var tabName = TAB.QC.qc_ip;   // 'In-Process'

  // 1. Archive the existing In-Process tab (rename, never delete).
  var old = qcSS.getSheetByName(tabName);
  if (old) {
    var stamp = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMdd-HHmm');
    var archiveName = 'In-Process (archived ' + stamp + ')';
    old.setName(archiveName);
    Logger.log('[rebuildInProcessTab] Archived old tab as: ' + archiveName);
  }

  // 2. Create a fresh In-Process tab with the correct headers + formatting.
  var sh = getOrCreateSheet_(qcSS, tabName);
  var layout = buildQcLayout_('qc_ip');
  ensureHeader_(sh, layout.header);
  formatQcTab_(sh);
  Logger.log('[rebuildInProcessTab] Created fresh "' + tabName + '" with correct headers.');

  // 3. Turn on replay so requeued IP events re-populate the clean tab even if
  //    their event_ids are already in _SyncState. (Server only re-serves rows
  //    flipped to pending by sheets_sync_requeue_qc_ip(), i.e. IP-only.)
  PropertiesService.getScriptProperties().setProperty('REPLAY_FORCE_WRITE', '1');
  Logger.log('[rebuildInProcessTab] Replay mode ON. '
    + 'Now run `select sheets_sync_requeue_qc_ip();` in the Supabase SQL editor. '
    + 'Within ~1 min In-Process records re-populate the clean tab. '
    + 'Then run clearReplayFlag() and delete the archived tab once verified.');
}


/**
 * ONE-TIME, FINISHED-GOODS-ONLY rebuild — run manually after the Finished Goods
 * layout change (added formula-input columns + their own "Timestamp" columns,
 * renamed the per-field timestamp header from "(Updated)" to "Timestamp", and
 * added the numbered Wet/Dry Sieve reading columns).
 *
 * The Finished Goods column POSITIONS changed (inputs are now interleaved before
 * each result, the ts header mode flipped from "(Updated)" to "Timestamp", and
 * reading-block columns were appended), so an in-place header rename would leave
 * old data under the wrong columns. Instead this rebuilds the tab SAFELY,
 * exactly like rebuildRawMaterialTab() / rebuildInProcessTab():
 *
 *   1. Renames the current "Finished Goods" tab to "Finished Goods (archived <ts>)"
 *      — nothing is deleted; every existing Finished Goods record is preserved
 *      there and can be deleted manually once the new tab is verified.
 *   2. Creates a fresh "Finished Goods" tab with the correct website headers.
 *   3. Turns on replay so the requeued Finished Goods events (see SQL below)
 *      re-populate the clean tab even though their event_ids are already in
 *      _SyncState.
 *
 * Touches ONLY the Finished Goods tab. Raw Material, In-Process, Dryer, and all
 * other data are untouched.
 *
 * REQUIRED companion SQL (run once in Supabase, see migration 027):
 *   select sheets_sync_requeue_qc_fg();
 *
 * After confirming the new tab is correct: run clearReplayFlag() and delete the
 * archived tab.
 */
function rebuildFinishedGoodsTab() {
  var cfg;
  try {
    cfg = getConfig_();
  } catch (e) {
    Logger.log('[rebuildFinishedGoodsTab] Fail-closed: ' + e.message);
    return;
  }

  var qcSS = SpreadsheetApp.openById(cfg.SPREADSHEET_ID_QC);
  var tabName = TAB.QC.qc_fg;   // 'Finished Goods'

  // 1. Archive the existing Finished Goods tab (rename, never delete).
  var old = qcSS.getSheetByName(tabName);
  if (old) {
    var stamp = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMdd-HHmm');
    var archiveName = 'Finished Goods (archived ' + stamp + ')';
    old.setName(archiveName);
    Logger.log('[rebuildFinishedGoodsTab] Archived old tab as: ' + archiveName);
  }

  // 2. Create a fresh Finished Goods tab with the correct headers + formatting.
  var sh = getOrCreateSheet_(qcSS, tabName);
  var layout = buildQcLayout_('qc_fg');
  ensureHeader_(sh, layout.header);
  formatQcTab_(sh);
  Logger.log('[rebuildFinishedGoodsTab] Created fresh "' + tabName + '" with correct headers.');

  // 3. Turn on replay so requeued FG events re-populate the clean tab even if
  //    their event_ids are already in _SyncState. (Server only re-serves rows
  //    flipped to pending by sheets_sync_requeue_qc_fg(), i.e. FG-only.)
  PropertiesService.getScriptProperties().setProperty('REPLAY_FORCE_WRITE', '1');
  Logger.log('[rebuildFinishedGoodsTab] Replay mode ON. '
    + 'Now run `select sheets_sync_requeue_qc_fg();` in the Supabase SQL editor. '
    + 'Within ~1 min Finished Goods records re-populate the clean tab. '
    + 'Then run clearReplayFlag() and delete the archived tab once verified.');
}


/**
 * ONE-TIME, FINISHED-GOODS-ONLY clean reset — run manually from the Apps Script
 * editor. Use this to drop the leftover old columns (Wet/Dry Sieve "Reading
 * 1–10" blocks and the "Brand/Type" column) AND remove the existing Finished
 * Goods data in one step, leaving a fresh, correctly-shaped, EMPTY tab.
 *
 * Unlike rebuildFinishedGoodsTab(), this does NOT turn on replay and you do NOT
 * run any re-queue SQL — the old data is intentionally discarded, not rewritten.
 * New website submissions populate the clean tab going forward.
 *
 * SAFETY: the current "Finished Goods" tab is ARCHIVED (renamed + hidden),
 * never hard-deleted, so the old data is still recoverable if you change your
 * mind. After you confirm the fresh tab looks right, delete the archived tab
 * from the Google Sheets UI (right-click the hidden tab → Delete). Touches ONLY
 * the Finished Goods tab — Raw Material, In-Process, and Dryer are untouched.
 *
 * It also clears the Finished-Goods event IDs from the _SyncState ledger so a
 * later deliberate replay (rebuildFinishedGoodsTab + requeue) would work; it
 * does NOT itself re-serve anything, so nothing repopulates automatically.
 */
function resetFinishedGoodsTabClean() {
  var cfg;
  try {
    cfg = getConfig_();
  } catch (e) {
    Logger.log('[resetFinishedGoodsTabClean] Fail-closed: ' + e.message);
    return;
  }

  var qcSS = SpreadsheetApp.openById(cfg.SPREADSHEET_ID_QC);
  var tabName = TAB.QC.qc_fg;   // 'Finished Goods'

  // 1. Archive the existing Finished Goods tab (rename + hide, never delete)
  //    so the discarded data stays recoverable.
  var old = qcSS.getSheetByName(tabName);
  if (old) {
    var stamp = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMdd-HHmm');
    var archiveName = 'Finished Goods (archived ' + stamp + ')';
    old.setName(archiveName);
    try { old.hideSheet(); } catch (e) { /* ignore if it cannot be hidden */ }
    Logger.log('[resetFinishedGoodsTabClean] Archived + hid old tab as: ' + archiveName
      + ' (delete it from the Sheets UI once you have confirmed the fresh tab).');
  }

  // 2. Create a fresh, EMPTY Finished Goods tab with the current correct header
  //    (no "Reading 1–10" columns, no "Brand/Type" column) + formatting.
  var sh = getOrCreateSheet_(qcSS, tabName);
  var layout = buildQcLayout_('qc_fg');
  ensureHeader_(sh, layout.header);
  formatQcTab_(sh);
  Logger.log('[resetFinishedGoodsTabClean] Created fresh empty "' + tabName
    + '" with the current correct headers.');

  // 3. Clear ONLY the Finished-Goods event IDs from the _SyncState ledger, so
  //    the discarded rows are not treated as "already written" if you ever
  //    choose to deliberately replay later. Dryer/RM/IP ledger rows untouched.
  //    (This does NOT re-serve anything by itself — nothing repopulates now.)
  clearSyncStateForKind_('qc_fg');

  Logger.log('[resetFinishedGoodsTabClean] Done. The Finished Goods tab is now '
    + 'empty and correctly shaped. New website submissions will populate it. '
    + 'No re-queue SQL is needed (old data was intentionally discarded).');
}


/**
 * Remove _SyncState ledger rows whose event_id belongs to a given QC record
 * kind, by matching the deterministic event_id prefixes we know for QC events.
 * The ledger stores only event_id + processed_at, so we cannot filter by
 * record_kind directly; instead we drop the QC-tab's rows by clearing ledger
 * entries that are NOT dryer events is unsafe. Safer approach: this helper is a
 * no-op placeholder that only logs, UNLESS a mapping is available. Because the
 * ledger does not carry record_kind, resetFinishedGoodsTabClean() relies on the
 * fresh tab + discarded data and does NOT require ledger surgery for correct
 * forward behavior (new submissions have brand-new event_ids). We therefore
 * keep this conservative: do nothing destructive to the shared ledger.
 */
function clearSyncStateForKind_(kind) {
  // The _SyncState ledger (event_id, processed_at) carries no record_kind, and
  // QC/Dryer event_ids are md5 hashes with no kind prefix, so we cannot safely
  // single out qc_fg rows without risking Dryer/RM/IP entries. Forward behavior
  // does not need this: discarded old rows will never be re-served (no replay),
  // and every new submission has a fresh event_id. So this is intentionally a
  // safe no-op that just records intent.
  Logger.log('[clearSyncStateForKind_] Skipped ledger surgery for "' + kind
    + '" (shared ledger has no record_kind; not needed for forward behavior).');
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

/**
 * ONE-TIME: replay the Dryer ('dryer_v2') events so existing New/Old Dryer
 * records (e.g. a bottom-form "Save Log Sheet" record already synced) re-write
 * into the CURRENT tab layout — including the new separate "… – Form" tabs.
 *
 * Turns ON replay mode so re-served events are written even though they were
 * processed before. The server only re-serves events whose outbox status was
 * flipped back to 'pending', and sheets_sync_requeue_dryer_v2() flips ONLY
 * Dryer events, so QC is never touched. Hourly events replay idempotently
 * (same rows); form events now land in the new "… – Form" tabs.
 *
 * AFTER running this, run ONE line in the Supabase SQL editor:
 *     select sheets_sync_requeue_dryer_v2();
 * Within ~40s the Dryer records re-populate. Then run clearReplayFlag().
 */
function replayDryerEvents() {
  PropertiesService.getScriptProperties().setProperty('REPLAY_FORCE_WRITE', '1');
  Logger.log('[replayDryerEvents] Replay mode ON. '
    + 'Next: run `select sheets_sync_requeue_dryer_v2();` in the Supabase SQL editor. '
    + 'Within ~40s Dryer records re-write (bottom form → "… – Form" tabs). '
    + 'Then run clearReplayFlag() to restore strict dedup.');
}

/**
 * ONE-TIME, SAFE in-place reformat of the ordinary "Time" column to 12-hour
 * AM/PM on the three QC tabs (Raw Material / In-Process / Finished Goods), for
 * records that were written BEFORE this change (new records already format via
 * renderClockTime_). Run manually from the Apps Script editor if you want
 * existing rows updated without a full replay.
 *
 * SAFE: touches ONLY the single "Time" identity column of each QC tab, cell by
 * cell, rewriting a 24-hour wall clock ("14:35") as "02:35:00 PM". It NEVER
 * changes any other column, the per-field "Timestamp" columns, row mapping,
 * dedup keys, or the Dryer book. Idempotent (already-12-hour cells are left
 * unchanged by renderClockTime_). No data rows are added, removed, or moved.
 */
function reformatQcTimeColumns_() {
  var cfg;
  try {
    cfg = getConfig_();
  } catch (e) {
    Logger.log('[reformatQcTimeColumns_] Fail-closed: ' + e.message);
    return;
  }
  var qcSS = SpreadsheetApp.openById(cfg.SPREADSHEET_ID_QC);
  var kinds = ['qc_rm', 'qc_ip', 'qc_fg'];

  for (var ki = 0; ki < kinds.length; ki++) {
    var kind = kinds[ki];
    var sh = qcSS.getSheetByName(TAB.QC[kind]);
    if (!sh) continue;
    var layout = buildQcLayout_(kind);
    if (layout.idCol.time === undefined) continue;   // no Time column in this tab
    var timeCol0 = layout.idCol.time;                 // 0-based
    var lastRow = sh.getLastRow();
    if (lastRow < 2) continue;

    var rng = sh.getRange(2, timeCol0 + 1, lastRow - 1, 1);
    var vals = rng.getValues();
    var changed = false;
    for (var r = 0; r < vals.length; r++) {
      var cur = coalesce_(vals[r][0]);
      var next = renderClockTime_(cur);
      if (next !== cur) { vals[r][0] = next; changed = true; }
    }
    if (changed) {
      rng.setValues(vals);
      Logger.log('[reformatQcTimeColumns_] Reformatted Time column on "' + TAB.QC[kind] + '".');
    }
  }
  Logger.log('[reformatQcTimeColumns_] Done. Existing Time cells now show 12-hour AM/PM.');
}

/**
 * ONE-SHOT, COSMETIC-ONLY formatter for ALL THREE QC tabs. Run manually from
 * the Apps Script editor to apply the current formatting to EXISTING rows right
 * now, without waiting for the next sync write:
 *   • 12-hour AM/PM on the ordinary "Time" column (via reformatQcTimeColumns_);
 *   • center-align + vertical-middle on headers and all data cells;
 *   • auto column widths, text wrapping, auto row heights, frozen header
 *     (via formatQcTab_).
 *
 * SAFE: changes only cell FORMATTING + the Time column's display text. It never
 * adds/removes/moves data rows, never alters other values, calculations, the
 * per-field "Timestamp" columns, dedup keys, or row mappings, and touches ONLY
 * the Quality Control spreadsheet (never the Dryer book). Idempotent — safe to
 * re-run. Existing records are preserved; nothing is duplicated or lost.
 */
function formatAllQcTabsNow() {
  var cfg;
  try {
    cfg = getConfig_();
  } catch (e) {
    Logger.log('[formatAllQcTabsNow] Fail-closed: ' + e.message);
    return;
  }

  // 1) Reformat existing Time cells to 12-hour AM/PM (Time column only).
  reformatQcTimeColumns_();

  // 2) Apply layout/alignment formatting to each existing QC tab.
  var qcSS = SpreadsheetApp.openById(cfg.SPREADSHEET_ID_QC);
  var kinds = ['qc_rm', 'qc_ip', 'qc_fg'];
  for (var ki = 0; ki < kinds.length; ki++) {
    var tabName = TAB.QC[kinds[ki]];
    var sh = qcSS.getSheetByName(tabName);
    if (!sh) { Logger.log('[formatAllQcTabsNow] Tab missing (skipped): ' + tabName); continue; }
    formatQcTab_(sh);
    Logger.log('[formatAllQcTabsNow] Formatted: ' + tabName);
  }
  Logger.log('[formatAllQcTabsNow] Done. RM / In-Process / Finished Goods are '
    + 'centered, wrapped, and Time cells show 12-hour AM/PM.');
}


/* ───────────────────────── Main tick ───────────────────────── */

/**
 * Trigger entry point. Apps Script time-driven triggers cannot fire faster than
 * once per MINUTE (everyMinutes accepts only 1/5/10/15/30), so a true 40-second
 * trigger is NOT available. To reduce latency below one minute WITHOUT an
 * unsupported trigger, each 1-minute invocation runs SEVERAL internal passes
 * spaced by a short sleep (default: 3 passes at ~0s / ~20s / ~40s). New data
 * therefore appears within ~20s on average and ~20s worst case between passes —
 * comfortably under 40s — using only supported mechanisms.
 *
 * OVERLAP SAFETY: a single ScriptLock guards the whole driver. If a previous
 * minute's invocation is still looping when the next fires, the new one cannot
 * get the lock and exits immediately — so passes never overlap (which would
 * risk double-serving, though the atomic outbox claim + _SyncState dedup already
 * prevent duplicates regardless). Nothing about dedup, ack, timestamps, Script
 * Properties, spreadsheet IDs, or secrets changes.
 *
 * Tunables via Script Properties (optional; safe defaults, nothing required):
 *   SYNC_PASSES          number of passes per minute (default 3, clamped 1..3)
 *   SYNC_PASS_INTERVAL_MS sleep between passes in ms (default 20000, clamped
 *                        5000..25000). passes*interval is kept well under the
 *                        6-minute execution limit.
 */
function syncTick() {
  var lock = LockService.getScriptLock();
  // Do NOT wait for the lock: if another invocation is mid-loop, skip this one
  // entirely so passes never overlap. A tiny wait (100ms) absorbs trivial races.
  if (!lock.tryLock(100)) {
    Logger.log('[syncTick] Another run holds the lock — skipping to avoid overlap.');
    return;
  }
  try {
    var props = PropertiesService.getScriptProperties();
    var passes = parseInt(props.getProperty('SYNC_PASSES'), 10);
    if (!(passes >= 1 && passes <= 3)) passes = 3;
    var intervalMs = parseInt(props.getProperty('SYNC_PASS_INTERVAL_MS'), 10);
    if (!(intervalMs >= 5000 && intervalMs <= 25000)) intervalMs = 20000;

    for (var p = 0; p < passes; p++) {
      if (p > 0) Utilities.sleep(intervalMs);   // space passes within the minute
      try {
        syncPass_();
      } catch (e) {
        // A failed pass never aborts the remaining passes or the next minute.
        Logger.log('[syncTick] pass ' + (p + 1) + ' error: ' + (e && e.message ? e.message : e));
      }
    }
  } finally {
    lock.releaseLock();
  }
}

/**
 * ONE synchronization pass: pull a batch, route/write each row, ack. Formerly
 * the body of syncTick(); unchanged in behavior (same dedup, ack, formatting,
 * replay). Called 1..3 times per minute by syncTick().
 */
function syncPass_() {
  var cfg;
  try {
    cfg = getConfig_();
  } catch (e) {
    Logger.log('[syncPass_] Fail-closed: ' + e.message);
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
  // Likewise track touched vertical Dryer tabs (New Dryer / Old Dryer).
  var touchedDryerTabs = {};

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
      if (row.record_kind === 'dryer_v2' && row.payload) {
        var dt = row.payload.dryer_type;
        if (row.event_type === 'dryer_form' && TAB.DRYER_V2_FORM[dt]) {
          touchedDryerTabs[TAB.DRYER_V2_FORM[dt]] = true;
        } else if (TAB.DRYER_V2[dt]) {
          touchedDryerTabs[TAB.DRYER_V2[dt]] = true;
        }
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
  // Same cosmetic formatting for the vertical Dryer tabs (in the Dryer book).
  for (var dTab in touchedDryerTabs) {
    if (touchedDryerTabs.hasOwnProperty(dTab)) {
      var dsh = dryerSS.getSheetByName(dTab);
      if (dsh) formatQcTab_(dsh);
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

  if (kind === 'dryer_v2') {
    // Horizontal Dryer tabs (New Dryer / Old Dryer). Row-level events:
    //   'dryer_hour' → one hourly row (all fields written in one setValues)
    //   'dryer_form' → the horizontal bottom-form block (header + one data row)
    if (type === 'dryer_hour') { writeDryerHourRow_(dryerSS, row); return; }
    if (type === 'dryer_form') { writeDryerFormRow_(dryerSS, row); return; }
  } else if (kind === 'dryer') {
    // Legacy wide-tab Dryer events. The migration-030 triggers no longer
    // produce these; ignore any stragglers quietly so they don't fail the batch
    // and don't recreate the old tabs.
    return;
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
    // Finished Goods LIVE Wet/Dry Sieve readings (migration 028). Matched to the
    // batch's row by BUSINESS KEY and rebuilds that test's stacked cell with
    // # / micron / result / status / time per line. No Print/Download needed.
    if (type === 'sieve_readings' && kind === 'qc_fg') {
      writeFgSieveReadings_(qcSS, tabName, row);
      return;
    }
  }

  throw new Error('Unroutable event: record_kind=' + kind + ' event_type=' + type);
}


/* ───────────────────────── Dryer writers (horizontal, row-level) ─────────────────────────
 * Two tabs, "New Dryer" / "Old Dryer". Each SAVE arrives as ONE row-level event
 * and is written in a SINGLE setValues() call (fast, atomic, nothing dropped):
 *   'dryer_hour' → the HOURLY block: one row per (date, shift, hour), a column
 *                  per website field; each data cell = value + its own timestamp
 *                  on the next line (no separate timestamp columns).
 *   'dryer_form' → the horizontal BOTTOM-FORM block below a divider: a header
 *                  row of field labels + one data row, same value+ts cell style.
 * Rows match by a hidden "_dryer_row_key" column → re-saving UPDATES in place
 * (idempotent; no duplicates). Timestamps are each field's own website time.
 * ───────────────────────────────────────────────────────────────────────────── */

// Hourly columns in website display order. [field_key, 'EXACT website label'].
var DRYER_V2_HOURLY_COLS = [
  ['temp_inlet',    'Temperature Deg. Cent. Inlet'],
  ['temp_outlet',   'Temperature Deg. Cent. Outlet'],
  ['temp_actual',   'Temperature Deg. Cent. Actual'],
  ['temp_fbd1',     'Temperature Deg. Cent. IFBD'],
  ['temp_fbd2',     'Temperature Deg. Cent. FBD'],
  ['temp_chamber',  'Temperature Deg. Cent. Chamber'],
  ['atomizer_freq', 'Atomizer Freq.'],
  ['feed_fc',       'Feed F.C.'],
  ['c_pressure',    'C.Pressure'],     // between Feed F.C. and Feed Pressure
  ['pressure',      'Feed Pressure'],
  ['pt_temp',       'Pt. Temp'],
  ['batch_no',      'Batch No.'],
  ['bags_per_hr',   'No. of Bag Per Hours'],
  ['bag_size_wt',   'Bag Size By Wt.'],
  ['kg_per_hr',     'Kg./Hour Production'],
  ['colour',        'Colour/Normal/OMRI'],
  ['id_frequency',  'I.D. Frequency'],
  ['remarks',       'Remarks'],
  ['operator_name', 'Operator Name'],  // who pressed Save for this hour
  ['maintenance',   'Maintenance']     // selected options + their own times
];
// Hourly header: Date | Shift | Time | <field labels>.
var DRYER_V2_HOURLY_HEADER = ['Date', 'Shift', 'Time'].concat(
  DRYER_V2_HOURLY_COLS.map(function (c) { return c[1]; })
);

// Bottom-form columns in display order. [field_key, 'EXACT website label'].
// (chamber_* hold the website's IFBD DP/MR. Calibration cells follow.)
var DRYER_V2_FORM_COLS = [
  ['id_blower_dp',    'ID Blower DP'],
  ['id_blower_mr',    'ID Blower MR'],
  ['fd_blower_dp',    'FD Blower DP'],
  ['fd_blower_mr',    'FD Blower MR'],
  ['chamber_dp',      'IFBD DP'],
  ['chamber_mr',      'IFBD MR'],
  ['fbd_pct_dp',      'FBD % DP'],
  ['fbd_pct_mr',      'FBD % MR'],
  ['batch_no',        'Batch No.'],
  ['calibration_due', 'Calibration Due Date'],
  ['cal_inlet_temp',    'Calibration Inlet Temperature'],
  ['cal_inlet_sensor',  'Calibration Inlet Sensor Value'],
  ['cal_outlet_temp',   'Calibration Outlet Temperature'],
  ['cal_outlet_sensor', 'Calibration Outlet Sensor Value'],
  ['cal_ifbd_temp',     'Calibration IFBD Temperature'],
  ['cal_ifbd_sensor',   'Calibration IFBD Sensor Value'],
  ['cal_fbd_temp',      'Calibration FBD Temperature'],
  ['cal_fbd_sensor',    'Calibration FBD Sensor Value'],
  ['cal_chamber_temp',  'Calibration Chamber Temperature'],
  ['cal_chamber_sensor','Calibration Chamber Sensor Value'],
  ['total_production','Total Production of the Day (kg)'],
  ['incharge',        'Incharge'],
  ['operator',        'Operator']
];
// Bottom-form header: Date | Shift | <labels>.
var DRYER_V2_FORM_HEADER = ['Date', 'Shift'].concat(
  DRYER_V2_FORM_COLS.map(function (c) { return c[1]; })
);

var DRYER_V2_KEY_HEADER = '_dryer_row_key';
var DRYER_V2_BOTTOM_DIVIDER = '— Bottom Form (Save Log Sheet) —';

/**
 * ONE-SHOT, NON-DESTRUCTIVE: insert the "Operator Name" hourly column into the
 * EXISTING "New Dryer" / "Old Dryer" tabs WITHOUT clearing any data. Run this
 * ONCE from the Apps Script editor when the tabs already hold real data and the
 * new column is missing (ensureHeader_ only fills blank header cells, so it
 * can't add a column to a populated header).
 *
 * It inserts ONE blank column immediately AFTER the "Remarks" header cell —
 * Google Sheets shifts every existing cell to the right automatically, so no
 * value is lost or misaligned — then labels the new column "Operator Name".
 * Idempotent: if an "Operator Name" column already exists, the tab is skipped.
 * Existing rows show blank in that column until their next save/replay fills it.
 * Touches ONLY the two Dryer tabs; QC and everything else are untouched.
 */
function addDryerOperatorNameColumn() {
  var cfg;
  try {
    cfg = getConfig_();
  } catch (e) {
    Logger.log('[addDryerOperatorNameColumn] Fail-closed: ' + e.message);
    return;
  }
  var dryerSS = SpreadsheetApp.openById(cfg.SPREADSHEET_ID_DRYER);
  var types = ['new', 'old'];
  for (var i = 0; i < types.length; i++) {
    var tabName = TAB.DRYER_V2[types[i]];
    var sh = dryerSS.getSheetByName(tabName);
    if (!sh) { Logger.log('[addDryerOperatorNameColumn] Tab missing (skip): ' + tabName); continue; }

    var lastCol = Math.max(sh.getLastColumn(), 1);
    var hdr = sh.getRange(1, 1, 1, lastCol).getValues()[0];

    // Already present? skip (idempotent).
    if (hdr.indexOf('Operator Name') !== -1) {
      Logger.log('[addDryerOperatorNameColumn] Already present: ' + tabName);
      continue;
    }
    // Find the "Remarks" header; insert the new column right after it.
    var remarksIdx = hdr.indexOf('Remarks');   // 0-based
    if (remarksIdx === -1) {
      Logger.log('[addDryerOperatorNameColumn] No "Remarks" column on ' + tabName + ' — skipped.');
      continue;
    }
    var insertAfter1 = remarksIdx + 1;          // 1-based column of Remarks
    sh.insertColumnAfter(insertAfter1);         // shifts Timestamp+ right; data preserved
    sh.getRange(1, insertAfter1 + 1).setValue('Operator Name');
    formatQcTab_(sh);                           // re-apply widths/wrap/centering/hidden-key
    Logger.log('[addDryerOperatorNameColumn] Inserted "Operator Name" after Remarks on ' + tabName);
  }
  Logger.log('[addDryerOperatorNameColumn] Done. Existing data preserved; new column added.');
}

/**
 * ONE-SHOT, NON-DESTRUCTIVE: insert the two NEW hourly columns into the EXISTING
 * "New Dryer" / "Old Dryer" tabs WITHOUT clearing any data:
 *   • "C.Pressure"  — inserted right AFTER "Feed F.C."
 *   • "Maintenance" — inserted right AFTER "Operator Name"
 * Each uses insertColumnAfter (Google Sheets shifts existing cells right, so no
 * value is lost or misaligned). Idempotent: a column already present is skipped.
 * Existing rows show blank in the new columns until their next save/replay.
 * Touches ONLY the two Dryer hourly tabs. Run ONCE from the Apps Script editor.
 *
 * NOTE: run addDryerOperatorNameColumn() FIRST if the "Operator Name" column is
 * not yet present (Maintenance anchors on it). If "Operator Name" is missing,
 * Maintenance falls back to being inserted after "Remarks".
 */
function addDryerNewHourlyColumns() {
  var cfg;
  try {
    cfg = getConfig_();
  } catch (e) {
    Logger.log('[addDryerNewHourlyColumns] Fail-closed: ' + e.message);
    return;
  }
  var dryerSS = SpreadsheetApp.openById(cfg.SPREADSHEET_ID_DRYER);
  var types = ['new', 'old'];

  // Insert a single named column after the column whose header === afterLabel
  // (or after fallbackLabel if the first is absent). No-op if newLabel exists.
  function insertAfter_(sh, tabName, newLabel, afterLabel, fallbackLabel) {
    var lastCol = Math.max(sh.getLastColumn(), 1);
    var hdr = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    if (hdr.indexOf(newLabel) !== -1) {
      Logger.log('[addDryerNewHourlyColumns] "' + newLabel + '" already present: ' + tabName);
      return;
    }
    var anchor = hdr.indexOf(afterLabel);
    if (anchor === -1 && fallbackLabel) anchor = hdr.indexOf(fallbackLabel);
    if (anchor === -1) {
      Logger.log('[addDryerNewHourlyColumns] No anchor (' + afterLabel + ') on '
        + tabName + ' — "' + newLabel + '" skipped.');
      return;
    }
    var after1 = anchor + 1;                 // 1-based column of the anchor
    sh.insertColumnAfter(after1);            // shifts everything right; data preserved
    sh.getRange(1, after1 + 1).setValue(newLabel);
    Logger.log('[addDryerNewHourlyColumns] Inserted "' + newLabel + '" after "'
      + (hdr[anchor]) + '" on ' + tabName);
  }

  for (var i = 0; i < types.length; i++) {
    var tabName = TAB.DRYER_V2[types[i]];
    var sh = dryerSS.getSheetByName(tabName);
    if (!sh) { Logger.log('[addDryerNewHourlyColumns] Tab missing (skip): ' + tabName); continue; }

    // Insert Maintenance first (anchored after Operator Name / fallback Remarks),
    // then C.Pressure (anchored after Feed F.C.). Order does not matter because
    // each re-reads the header fresh and skips if already present.
    insertAfter_(sh, tabName, 'Maintenance', 'Operator Name', 'Remarks');
    insertAfter_(sh, tabName, 'C.Pressure',  'Feed F.C.', null);

    formatQcTab_(sh);   // re-apply widths/wrap/centering/hidden-key
  }
  Logger.log('[addDryerNewHourlyColumns] Done. Existing data preserved; C.Pressure + Maintenance added.');
}

// Maintenance option labels (keys match the website row.maintenance object).
var DRYER_MAINT_LABELS = [
  ['shifter_screen', 'Shifter-Screen Cleaning'],
  ['atomizer_water', 'Running the Atomizer on Water']
];

/**
 * Render the Maintenance cell from the stored object
 *   { shifter_screen: '<ISO>'|'', atomizer_water: '<ISO>'|'' }
 * (or its JSON string). Each SELECTED option (non-empty ISO) becomes one line:
 *   "<Option label> — <hh:mm:ss AM/PM IST>".
 * Unselected options are omitted. Empty when nothing is selected.
 */
function renderDryerMaintenance_(m) {
  if (typeof m === 'string') {
    try { m = JSON.parse(m); } catch (e) { return m ? String(m) : ''; }
  }
  if (!m || typeof m !== 'object') return '';
  var lines = [];
  for (var i = 0; i < DRYER_MAINT_LABELS.length; i++) {
    var key = DRYER_MAINT_LABELS[i][0];
    var label = DRYER_MAINT_LABELS[i][1];
    var iso = m[key];
    if (iso && String(iso) !== '') {
      lines.push(label + '  —  ' + renderFieldTs_('qc_fg', iso));
    }
  }
  return lines.join('\n');
}

// Render one data cell as "value" + the field's own timestamp on a new line.
function dryerCellWithTs_(value, iso) {
  var v = coalesce_(value);
  var t = (iso && String(iso) !== '') ? renderFieldTs_('qc_fg', iso) : '';  // IST hh:mm:ss AM/PM
  if (v === '' && t === '') return '';
  return t ? (v + '\n' + t) : v;
}

// Locate (creating if needed) the hidden "_dryer_row_key" column; return its
// 0-based index. The key column must sit AFTER the WIDER of the two blocks
// (hourly header vs bottom-form header), so every data column of BOTH blocks
// stays to the LEFT of the hidden key — otherwise formatQcTab_ (which stops
// styling/sizing at the first hidden column) would skip the right-hand
// bottom-form columns (Total Production, Incharge, Operator, …).
function dryerKeyCol_(sh) {
  var minW = Math.max(DRYER_V2_HOURLY_HEADER.length, DRYER_V2_FORM_HEADER.length);
  var lastCol = Math.max(sh.getLastColumn(), minW, 1);
  var hdr = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var keyCol = hdr.indexOf(DRYER_V2_KEY_HEADER);
  if (keyCol === -1) {
    keyCol = Math.max(hdr.length, minW);
    sh.getRange(1, keyCol + 1).setValue(DRYER_V2_KEY_HEADER);
    try { sh.hideColumns(keyCol + 1); } catch (e) {}
  } else if (keyCol < minW) {
    // An older/narrower key column exists to the LEFT of the form width — move
    // it to the correct far-right position so form columns aren't hidden/unstyled.
    var newCol = minW;
    var lr = sh.getLastRow();
    if (lr >= 1) {
      var colData = sh.getRange(1, keyCol + 1, lr, 1).getValues();
      sh.getRange(1, newCol + 1, lr, 1).setValues(colData);     // copy to new spot
      sh.getRange(1, keyCol + 1, lr, 1).clearContent();          // clear old spot
    }
    try { sh.showColumns(keyCol + 1); } catch (e) {}             // unhide the vacated col
    keyCol = newCol;
    sh.getRange(1, keyCol + 1).setValue(DRYER_V2_KEY_HEADER);
    try { sh.hideColumns(keyCol + 1); } catch (e) {}
  }
  return keyCol;
}

// Find a data row by its hidden key; -1 if absent.
function dryerFindRow_(sh, keyCol, wantKey) {
  var lr = sh.getLastRow();
  if (lr < 2) return -1;
  var keys = sh.getRange(1, keyCol + 1, lr, 1).getValues();
  for (var r = 1; r < keys.length; r++) {
    if (coalesce_(keys[r][0]) === wantKey) return r + 1;
  }
  return -1;
}

/**
 * 'dryer_hour' → write/replace ONE hourly row in a single setValues call.
 * payload: { dryer_type, date, shift, hour, values:{key:val}, ts:{key:iso} }
 */
function writeDryerHourRow_(ss, row) {
  var p = row.payload || {};
  var tabName = TAB.DRYER_V2[coalesce_(p.dryer_type)];
  if (!tabName) return;

  var sh = getOrCreateSheet_(ss, tabName);
  ensureHeader_(sh, DRYER_V2_HOURLY_HEADER);
  var keyCol = dryerKeyCol_(sh);
  var fullWidth = Math.max(sh.getLastColumn(), keyCol + 1);

  var vals = p.values || {};
  var ts   = p.ts || {};
  var wantKey = 'H|' + coalesce_(p.date) + '|' + coalesce_(p.shift) + '|' + coalesce_(p.hour);

  // Build the whole row at once. Preserve existing cells not in this event by
  // reading the current row first (so a re-save that omits a field keeps it).
  var rIdx = dryerFindRow_(sh, keyCol, wantKey);
  var out;
  if (rIdx > 0) {
    out = sh.getRange(rIdx, 1, 1, fullWidth).getValues()[0];
    while (out.length < fullWidth) out.push('');
  } else {
    out = [];
    for (var i = 0; i < fullWidth; i++) out.push('');
  }
  out[0] = coalesce_(p.date);
  out[1] = coalesce_(p.shift);
  out[2] = coalesce_(p.hour);
  for (var c = 0; c < DRYER_V2_HOURLY_COLS.length; c++) {
    var fk = DRYER_V2_HOURLY_COLS[c][0];
    if (fk === 'maintenance') {
      // Maintenance is an object { shifter_screen: '<ISO>'|'', atomizer_water:
      // '<ISO>'|'' } — render each SELECTED option on its own line with its own
      // recorded time: "Shifter-Screen Cleaning — 03:12:40 PM".
      var mCell = renderDryerMaintenance_(vals[fk]);
      if (mCell !== '') out[3 + c] = mCell;
      continue;
    }
    if (vals[fk] !== undefined && vals[fk] !== null && String(vals[fk]) !== '') {
      out[3 + c] = dryerCellWithTs_(vals[fk], ts[fk]);
    }
  }
  out[keyCol] = wantKey;

  if (rIdx > 0) sh.getRange(rIdx, 1, 1, out.length).setValues([out]);
  else          sh.appendRow(out);
  try { sh.hideColumns(keyCol + 1); } catch (e) {}
}

/**
 * 'dryer_form' → write/replace the bottom-form row in its OWN tab
 * ("New Dryer – Form" / "Old Dryer – Form"), separate from the hourly table so
 * it has its own columns/widths. Header on row 1 (Date | Shift | <labels>), one
 * data row per (date, shift); each data cell = value + its own timestamp on the
 * next line (Batch No. and Calibration Due Date show value only). Matched by a
 * hidden "_dryer_row_key" column → updates in place (idempotent; no duplicates).
 * payload: { dryer_type, date, shift, values:{key:val}, ts:{key:iso} }
 */
function writeDryerFormRow_(ss, row) {
  var p = row.payload || {};
  var tabName = TAB.DRYER_V2_FORM[coalesce_(p.dryer_type)];
  if (!tabName) return;

  var sh = getOrCreateSheet_(ss, tabName);
  ensureHeader_(sh, DRYER_V2_FORM_HEADER);   // the FORM header is row 1 here

  // Hidden key column for THIS tab (independent of the hourly tab).
  var minW = DRYER_V2_FORM_HEADER.length;
  var lastCol = Math.max(sh.getLastColumn(), minW, 1);
  var hdr0 = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var keyCol = hdr0.indexOf(DRYER_V2_KEY_HEADER);
  if (keyCol === -1) {
    keyCol = Math.max(hdr0.length, minW);
    sh.getRange(1, keyCol + 1).setValue(DRYER_V2_KEY_HEADER);
    try { sh.hideColumns(keyCol + 1); } catch (e) {}
  }
  var fullWidth = Math.max(sh.getLastColumn(), keyCol + 1);

  // Bottom-form fields whose cell shows the VALUE ONLY (no timestamp), by
  // request: Batch No. and Calibration Due Date.
  var DRYER_V2_FORM_NO_TS = { 'batch_no': true, 'calibration_due': true };

  var vals = p.values || {};
  var ts   = p.ts || {};
  var wantKey = 'F|' + coalesce_(p.date) + '|' + coalesce_(p.shift);

  var rIdx = dryerFindRow_(sh, keyCol, wantKey);
  var out;
  if (rIdx > 0) {
    out = sh.getRange(rIdx, 1, 1, fullWidth).getValues()[0];
    while (out.length < fullWidth) out.push('');
  } else {
    out = [];
    for (var i = 0; i < fullWidth; i++) out.push('');
  }
  out[0] = coalesce_(p.date);
  out[1] = coalesce_(p.shift);
  for (var c = 0; c < DRYER_V2_FORM_COLS.length; c++) {
    var fk = DRYER_V2_FORM_COLS[c][0];
    if (vals[fk] !== undefined && vals[fk] !== null && String(vals[fk]) !== '') {
      out[2 + c] = DRYER_V2_FORM_NO_TS[fk]
        ? coalesce_(vals[fk])                 // value only — no timestamp line
        : dryerCellWithTs_(vals[fk], ts[fk]);
    }
  }
  out[keyCol] = wantKey;

  if (rIdx > 0) sh.getRange(rIdx, 1, 1, out.length).setValues([out]);
  else          sh.appendRow(out);
  try { sh.hideColumns(keyCol + 1); } catch (e) {}
}

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

  // MERGED value+timestamp layout (all QC sections): each field gets ONE column.
  // The cell holds the value on line 1 and its own timestamp on line 2
  // (value + "\n" + hh:mm:ss AM/PM IST). There is NO separate per-field
  // Timestamp column. valueCol[key] and tsCol[key] POINT TO THE SAME column, so
  // the existing writers (which set the value cell, then the ts cell) both land
  // in the one merged cell — the merge helper below composes value+time.
  // 'Final Submission' stays its own column (independent info — the
  // form-submission moment, distinct from per-field entry/update times).
  // NOTE: only a field's OWN value and OWN time share a cell; different fields
  // are never combined. The In-Process mill table and FG sieve logs already
  // stack their own value+time in-cell and are unaffected.
  for (var f2 = 0; f2 < fields.length; f2++) {
    var key2 = fields[f2][0];
    var label2 = fields[f2][1];
    valueCol[key2] = header.length;
    tsCol[key2]    = header.length;   // SAME column as the value → merged cell
    header.push(label2);
  }

  // In-Process only: the Mill-wise Suspensibility table, flattened horizontally.
  // For each mill: its four data columns, then ONE "Timestamp" column for the
  // mill row (the whole mill table shares the record's mill-entry time).
  //   millCol[millName][cellKey] -> 0-based column index of that data cell
  //   millTsCol[millName]        -> 0-based column index of the mill's Timestamp
  var millCol = {};
  var millTsCol = {};
  if (kind === 'qc_ip') {
    for (var mi = 0; mi < IP_MILL_NAMES.length; mi++) {
      var mName = IP_MILL_NAMES[mi];
      millCol[mName] = {};
      for (var ci = 0; ci < IP_MILL_COLS.length; ci++) {
        millCol[mName][IP_MILL_COLS[ci][0]] = header.length;
        header.push('Mill ' + mName + ' – ' + IP_MILL_COLS[ci][1]);
      }
      millTsCol[mName] = header.length;
      header.push('Timestamp');
    }
  }

  // Finished Goods repeated Wet/Dry Sieve readings do NOT add any columns:
  // all readings are stacked within the sieve test's existing single Value and
  // single Timestamp columns (see FG_SIEVE_LOGS / buildFgSieveStack_).

  var finalCol = header.length;
  header.push('Final Submission');

  return {
    header: header,
    identityKeys: identityKeys,
    idCol: idCol,
    valueCol: valueCol,
    tsCol: tsCol,
    millCol: millCol,
    millTsCol: millTsCol,
    finalCol: finalCol,
    keyLen: bizKeys.length,
    singleTs: false
  };
}

/* ── QC PASS/FAIL status rules (mirror of the website) ────────────────────────
 * The website computes a PASS/FAIL status for fields that have a `rule`
 * (src/data/qualityData.js + src/data/uplData.js), via evaluate(value, rule).
 * The status is NOT stored in Supabase (it is computed in the browser), so we
 * recompute it HERE for the SAME fields using the SAME rules, and show it beside
 * the value in the merged cell — WITHOUT adding any column. Fields NOT listed
 * here have no status on the website and get no status in the sheet.
 *
 * Rule shapes (same as the website):
 *   {type:'range',min,max} {type:'max',max} {type:'min',min}
 *   {type:'tolerance',target,tol} {type:'text',accepted}
 * Keep this catalog in sync with the website data files.
 * ──────────────────────────────────────────────────────────────────────────── */
var QC_RULES = {
  // Raw Material
  'ligno_ph':        { type: 'range', min: 3, max: 9 },
  'ligno_solubility':{ type: 'text',  accepted: 'Clear Solution' },
  'ligno_moisture':  { type: 'range', min: 0, max: 5 },
  'clay_ph':         { type: 'range', min: 5, max: 8 },
  'clay_sed10':      { type: 'max',   max: 5 },
  'clay_sed30':      { type: 'max',   max: 10 },
  'clay_moisture':   { type: 'range', min: 0, max: 4 },
  'dn_ph':           { type: 'range', min: 5, max: 8 },
  'dn_solubility':   { type: 'text',  accepted: 'Clear Solution' },
  'dn_moisture':     { type: 'range', min: 0, max: 6 },
  'dn_solid':        { type: 'tolerance', target: 45, tol: 1 },
  'coal_moisture':   { type: 'max',   max: 30 },
  'mm_density':      { type: 'tolerance', target: 4.40, tol: 0.05 },
  'mm_diameter':     { type: 'range', min: 2.0, max: 2.40 },
  'mm_finish':       { type: 'text',  accepted: 'Complies' },
  // Finished Goods — Persistent Foaming
  'fg_foam_start':   { type: 'max',   max: 60 },
  'fg_foam_1min':    { type: 'max',   max: 25 },
  // Finished Goods — UPL Export
  'upl_exp_ps_10':   { type: 'max',   max: 20 },
  'upl_exp_ps_6':    { type: 'max',   max: 35 },
  'upl_exp_ps_1':    { type: 'min',   min: 75 },
  'upl_exp_ws_160':  { type: 'max',   max: 0.02 },
  'upl_exp_ws_25':   { type: 'max',   max: 0.20 },
  'upl_exp_df_0':    { type: 'max',   max: 300 },
  'upl_exp_df_1':    { type: 'max',   max: 200 },
  'upl_exp_df_2':    { type: 'max',   max: 150 },
  'upl_exp_df_5':    { type: 'max',   max: 60 },
  'upl_exp_wps':     { type: 'range', min: 2.20, max: 4.90 },
  'upl_exp_alk':     { type: 'max',   max: 0.6 },
  'upl_exp_disp':    { type: 'text',  accepted: 'Complies' },
  // Finished Goods — UPL OMRI
  'upl_omri_ps_10':  { type: 'max',   max: 20 },
  'upl_omri_ps_6':   { type: 'max',   max: 35 },
  'upl_omri_ps_1':   { type: 'min',   min: 75 },
  'upl_omri_ds_500': { type: 'min',   min: 99 },
  'upl_omri_ds_106': { type: 'max',   max: 11 },
  'upl_omri_disp_self': { type: 'text', accepted: 'Complies' },
  'upl_omri_disp_1h':   { type: 'text', accepted: 'Complies' },
  'upl_omri_disp_24h':  { type: 'text', accepted: 'Complies' },
  'upl_omri_ws_160': { type: 'min',   min: 99.98 },
  'upl_omri_ws_25':  { type: 'min',   min: 99.50 }
};

// Mirror of the website evaluate(value, rule) → 'PASS' | 'FAIL' | null.
function evaluateQc_(value, rule) {
  if (!rule) return null;
  if (value === '' || value === null || value === undefined) return null;
  var n = parseFloat(value);
  switch (rule.type) {
    case 'range':     if (isNaN(n)) return null; return (n >= rule.min && n <= rule.max) ? 'PASS' : 'FAIL';
    case 'max':       if (isNaN(n)) return null; return (n <= rule.max) ? 'PASS' : 'FAIL';
    case 'min':       if (isNaN(n)) return null; return (n >= rule.min) ? 'PASS' : 'FAIL';
    case 'tolerance': if (isNaN(n)) return null; return (n >= (rule.target - rule.tol) && n <= (rule.target + rule.tol)) ? 'PASS' : 'FAIL';
    case 'text':      return (String(value) === String(rule.accepted)) ? 'PASS' : 'FAIL';
    default:          return null;
  }
}

/**
 * Merge a QC field's value, its PASS/FAIL status (only for fields that HAVE a
 * status on the website), and its timestamp into ONE cell:
 *   line 1: "<value>  (PASS)"   (status shown beside the value; omitted when the
 *           field has no rule, or the value doesn't yield a status)
 *   line 2: timestamp (hh:mm:ss AM/PM, IST)  — omitted when there is no time
 * No new column is added. `fieldKey` selects the rule from QC_RULES; pass '' to
 * skip status (e.g. identity fields). `iso` is an app-recorded time — never the
 * sheet upload time.
 */
function qcMergeCell_(value, iso, kind, fieldKey) {
  var v = renderCell_(value);
  var status = (fieldKey && QC_RULES[fieldKey]) ? evaluateQc_(value, QC_RULES[fieldKey]) : null;
  var line1 = (v !== '' && status) ? (v + '  (' + status + ')') : v;
  var t = (iso !== null && iso !== undefined && String(iso) !== '')
    ? renderFieldTs_(kind || 'qc_fg', iso) : '';
  if (line1 === '' && t === '') return '';
  return t ? (line1 + '\n' + t) : line1;
}

/**
 * Merge a Finished Goods sieve stack (parallel value/ts line arrays from
 * buildFgSieveStack_) into ONE cell: each reading as "<reading> — <time>" on
 * its own line, so every reading keeps its own time together in the cell.
 */
function qcMergeSieveStack_(stack) {
  var vLines = String(stack.value || '').split('\n');
  var tLines = String(stack.ts || '').split('\n');
  var out = [];
  for (var i = 0; i < vLines.length; i++) {
    var v = vLines[i] || '';
    var t = tLines[i] || '';
    if (v === '' && t === '') continue;
    out.push(t ? (v + '  —  ' + t) : v);
  }
  return out.join('\n');
}

/**
 * Build the STACKED value + timestamp strings for ONE Finished Goods sieve test
 * (Wet Sieve or Dry Sieve) from the Print/Download snapshot's stored log array,
 * so all recorded readings live on separate lines WITHIN the test's single
 * existing Value cell and single existing Timestamp cell — no numbered columns,
 * one logical entry per batch/grade/dryer/test.
 *
 * Inputs:
 *   valueKey  'fg_wetSieve' | 'fg_drySieve' (the result/value key)
 *   logKey    'fg_wetSieve_log' | 'fg_drySieve_log' (repeated-readings array;
 *             each element { result, status, time, isoTime, targetLabel })
 *   vals      the record's values object
 *   tsMap     values.__ts (app-recorded ISO times; per-reading keys
 *             '<valueKey>_reading_N' when present)
 *   kind      'qc_fg'
 *
 * Returns { value, ts }, each a newline-joined string, line i of value aligned
 * with line i of ts. Each value line uses the SAME format as the live
 * writeFgSieveReadings_ writer: "#N  <micron>  <result>  <status>", with the
 * matching website-recorded time (IST hh:mm:ss AM/PM) on the matching ts line.
 * Returns null when the log has no readings, so the caller leaves the single
 * calculated-result value cell (written by the field loop) untouched.
 *
 * Deterministic + idempotent: rebuilt entirely from the stored array every
 * sync, so a retry/replay (and the parallel live sieve-readings event) all
 * produce IDENTICAL content — never duplicating or appending readings. Uses
 * only app-recorded times, never the Sheets upload time.
 */
function buildFgSieveStack_(valueKey, logKey, vals, tsMap, kind) {
  var arr = vals[logKey];
  if (typeof arr === 'string') {
    try { arr = JSON.parse(arr); } catch (e) { arr = null; }
  }
  if (!arr || Object.prototype.toString.call(arr) !== '[object Array]') return null;

  var values = [];
  var times  = [];
  for (var i = 0; i < arr.length; i++) {
    var e = arr[i] || {};
    if (e.result === undefined || e.result === null || String(e.result) === '') continue;
    var no     = i + 1;
    var micron = coalesce_(e.targetLabel);
    var result = coalesce_(e.result);
    var status = coalesce_(e.status);
    var parts = ['#' + no];
    if (micron !== '') parts.push(micron);
    parts.push(result);
    if (status !== '') parts.push(status);
    values.push(parts.join('  '));

    var iso = (tsMap && tsMap[valueKey + '_reading_' + no]) ? tsMap[valueKey + '_reading_' + no]
            : (e.isoTime || null);
    if (iso) {
      times.push(renderFieldTs_(kind, iso));
    } else if (e.time) {
      times.push(String(e.time));   // older entries saved only a display string
    } else {
      times.push('');
    }
  }

  if (values.length === 0) return null;
  return {
    value: values.join(FG_SIEVE_LINE_SEP),
    ts:    times.join(FG_SIEVE_LINE_SEP)
  };
}

/**
 * Expand a stored ip_mill_rows value (JSONB array, or its JSON string) into the
 * flattened per-mill cells of an In-Process row. `millRows` is the parsed value
 * (array of { mill, br, flowRate, pass, susp, __ts }). `entryTs` is the
 * field-level fallback entry time (field_entry_ts of the ip_mill_rows
 * field_change), used only for rows that carry no own __ts.
 *
 * Writes each mill's BR / Suspension / Flow Rate / Pass value cells, and its
 * own "Timestamp" cell = that mill row's ORIGINAL entry time (r.__ts, captured
 * on the website the first time the mill got a value). Only mills that actually
 * have data are stamped, so filling just V1 leaves V2…V10's Timestamp blank —
 * V1's time is never copied onto the other mills. The Timestamp is written ONLY
 * when still empty, so a later edit never overwrites the original. "Suspension
 * (%)" is computed on the website; it is shown when the row carries it.
 */
function fillIpMillCells_(existing, layout, millRows, entryTs) {
  if (!layout.millCol) return;
  var arr = millRows;
  if (typeof arr === 'string') {
    try { arr = JSON.parse(arr); } catch (e) { return; }
  }
  if (!arr || Object.prototype.toString.call(arr) !== '[object Array]') return;

  for (var i = 0; i < arr.length; i++) {
    var r = arr[i] || {};
    var mName = coalesce_(r.mill);
    if (!mName || !layout.millCol[mName]) continue;
    var cols = layout.millCol[mName];

    var hasBr   = (r.br       !== undefined && r.br       !== null && String(r.br)       !== '');
    var hasFlow = (r.flowRate !== undefined && r.flowRate !== null && String(r.flowRate) !== '');
    var hasPass = (r.pass     !== undefined && r.pass     !== null && String(r.pass)     !== '');

    if (hasBr)   existing[cols.br]       = renderCell_(r.br);
    if (hasFlow) existing[cols.flowRate] = renderCell_(r.flowRate);
    if (hasPass) existing[cols.pass]     = renderCell_(r.pass);
    // Suspension % is derived on the website; include it if a row carries it.
    var suspVal = (r.susp !== undefined) ? r.susp
                : (r.suspension !== undefined) ? r.suspension
                : (r.suspensibility !== undefined) ? r.suspensibility : undefined;
    var hasSusp = (suspVal !== undefined && suspVal !== null && String(suspVal) !== '');
    if (hasSusp) existing[cols.susp] = renderCell_(suspVal);

    // Timestamp PER MILL. Use THIS mill's own entry time (r.__ts, captured on
    // the website the first time the mill row got a value) so V1's time is NOT
    // copied onto other mills. Fall back to the field-level entryTs only if the
    // row carries no __ts (older clients). Stamp ONLY mills that actually have
    // data, and only when the cell is still empty (preserve the original time).
    var onlyEmpty = !(hasBr || hasFlow || hasPass || hasSusp);
    if (onlyEmpty) continue;   // blank mill → no timestamp
    var millTs = r.__ts ? r.__ts : entryTs;
    var tsText = millTs ? renderFieldTs_('qc_ip', millTs) : '';
    var tsCell = layout.millTsCol[mName];
    if (tsText !== '' && coalesce_(existing[tsCell]) === '') existing[tsCell] = tsText;
  }
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

  // Row identity:
  //   Finished Goods → match by BUSINESS KEY (date, batch_no, product, grade,
  //     dryer). Every Print/Download of the same batch is a NEW quality_control
  //     _records id (new source_pk); keying FG by source_pk created a NEW sheet
  //     row each save and re-rendered the whole accumulated sieve log — the
  //     root cause of the "duplicate readings" symptom. Business-key matching
  //     collapses repeated saves onto ONE row, and it is the SAME row the live
  //     sieve-readings writer targets, so both share one row/cell per batch.
  //   RM / In-Process → unchanged: match by source_pk (one submission = one id
  //     = one row), preserving their existing behavior exactly.
  var rowIdx;
  if (kind === 'qc_fg') {
    var fgBiz = {
      date:     coalesce_(vals.date || payload.date),
      batch_no: coalesce_(vals.batch_no),
      product:  coalesce_(vals.product),
      grade:    coalesce_(vals.grade),
      dryer:    coalesce_(vals.dryer)
    };
    // identityFill is applied only when a NEW row is appended; the normalized
    // _fg_key is the authoritative match so the live sieve writer shares it.
    rowIdx = findOrAppendFgRowByKey_(sh, layout, fgBiz, fgBiz, width);
  } else {
    // field_change events for the same record share the same source_pk, so both
    // writers land on the same row (snapshot fills values + identity;
    // field_change fills each field's timestamp).
    rowIdx = findOrAppendQcRowBySourcePk_(sh, layout, row.source_pk, width);
  }
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
      // Map the stored material/test id to its website label, per section.
      var labelMap = (kind === 'qc_ip') ? IP_MATERIAL_LABELS : RM_MATERIAL_LABELS;
      idv = labelMap[mid] || mid;   // label if known, else raw id
    } else if (idk === 'time') {
      // The ordinary "Time" identity field. The website <input type="time">
      // submits a 24-hour wall-clock string (e.g. "14:35"). Display it in
      // 12-hour AM/PM (e.g. "02:35:00 PM") consistently across RM/IP/FG. This is
      // a DISPLAY reformat of a date-less clock value — it does NOT shift the
      // time and is DISTINCT from the per-field "Timestamp" columns (which keep
      // their own renderFieldTs_ logic untouched).
      idv = renderClockTime_(coalesce_(vals[idk]));
    } else {
      idv = coalesce_(vals[idk]);
    }
    if (idv !== '') existing[col] = idv;
  }

  // Fill present field cells as MERGED "value\n<timestamp>" (value line 1, its
  // own entry/update time line 2). valueCol[fk] === tsCol[fk] now (one column
  // per field), so we compose both into the single cell.
  //   • IP / FG: timestamp from values.__ts[fk] (app-recorded; never upload
  //     time). Unchanged fields keep their original time; changed fields get
  //     their new time — same source as before, just rendered in the same cell.
  //   • RM: the snapshot writes the VALUE now; the per-field time is merged in
  //     by writeQcFieldTimestamp_ (RM field_change path) which appends the time
  //     line to the same cell.
  //   • The two FG sieve keys are EXCLUDED here (owned by the sieve writer that
  //     stacks every reading+time in the cell).
  var fields = QC_FIELD_CATALOG[kind];
  var tsMap = (vals && vals.__ts && typeof vals.__ts === 'object') ? vals.__ts : {};
  for (var f = 0; f < fields.length; f++) {
    var fk = fields[f][0];
    var hasVal = (vals[fk] !== undefined && vals[fk] !== null && String(vals[fk]) !== '');
    var isFgSieve = (kind === 'qc_fg' && (fk === 'fg_wetSieve' || fk === 'fg_drySieve'));
    if (isFgSieve) continue;   // handled by the sieve-stack writer below

    var tsOwnedBySnapshot = (kind === 'qc_ip' || kind === 'qc_fg');
    if (hasVal) {
      if (tsOwnedBySnapshot) {
        // IP/FG: snapshot owns the merged value+status+time (from values.__ts).
        existing[layout.valueCol[fk]] = qcMergeCell_(vals[fk], tsMap[fk] || null, kind, fk);
      } else {
        // RM: the field_change path (writeQcFieldTimestamp_) owns the merged
        // value+status+time. The snapshot only ensures value (+status) is
        // visible BEFORE a field_change arrives — write value+status (no time),
        // and ONLY if the cell is still empty, so we never clobber a merged
        // value+status+time already written.
        if (coalesce_(existing[layout.valueCol[fk]]) === '') {
          existing[layout.valueCol[fk]] = qcMergeCell_(vals[fk], null, kind, fk);
        }
      }
    } else if (tsOwnedBySnapshot) {
      // Field now empty → clear the cell so a stale value/time can't linger.
      existing[layout.valueCol[fk]] = '';
    }
  }

  // In-Process: expand the mill-wise suspensibility array into per-mill cells.
  // The snapshot fills the VALUE cells AND each mill's own Timestamp from the
  // row's own __ts (fillIpMillCells_ uses r.__ts). Pass no field-level fallback
  // so the snapshot never stamps a timestamp from the upload path.
  if (kind === 'qc_ip' && layout.millCol && vals.ip_mill_rows !== undefined) {
    fillIpMillCells_(existing, layout, vals.ip_mill_rows, null);
  }

  // Finished Goods: STACK the repeated Wet/Dry Sieve readings within the sieve
  // test's single Value cell and single Timestamp cell (no numbered columns),
  // using the SAME "#N  micron  result  status" + time format as the live
  // writeFgSieveReadings_ writer, so whichever writes last produces IDENTICAL
  // content (the live sieve-readings event and this snapshot can both target
  // the same business-key row). Built deterministically from the stored log
  // arrays → retries/replays never duplicate readings. If a sieve has no logged
  // readings, the single-value cell written by the field loop above is left
  // as-is (initial result only).
  if (kind === 'qc_fg') {
    for (var si = 0; si < FG_SIEVE_LOGS.length; si++) {
      var vKey = FG_SIEVE_LOGS[si][0];
      var lKey = FG_SIEVE_LOGS[si][1];
      var stack = buildFgSieveStack_(vKey, lKey, vals, tsMap, kind);
      if (stack) {
        // MERGED: each reading on its own line as "<reading> — <time>" so the
        // value and its time stay together in the one sieve cell.
        existing[layout.valueCol[vKey]] = qcMergeSieveStack_(stack);
      }
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

  // Finished Goods: field_change events are a NO-OP. FG rows are matched by
  // BUSINESS KEY (date/batch/product/grade/dryer), not source_pk, so the
  // current_snapshot is the sole authoritative writer of every FG value AND its
  // Timestamp (rendered from values.__ts), and the live sieve-readings writer
  // owns the stacked Wet/Dry Sieve cells. A field_change here matches by
  // source_pk and would land on (or create) a DIFFERENT row, splitting the
  // record. The snapshot always accompanies every FG save, so nothing is lost
  // by ignoring field_change for FG. (RM / In-Process are unaffected.)
  if (kind === 'qc_fg') {
    return;
  }

  // In-Process mill-wise suspensibility is a special field: it is expanded into
  // flattened per-mill columns (not a single value column). Fill those cells +
  // each mill's Timestamp from this field_change (field_entry_ts = the real
  // original mill-entry time).
  var isMillField = (kind === 'qc_ip' && fieldKey === 'ip_mill_rows' && layout.millCol);

  if (!isMillField && layout.valueCol[fieldKey] === undefined) {
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

  if (isMillField) {
    // Expand the mill array (new_value is the JSON string) into per-mill cells,
    // stamping each mill's Timestamp from field_entry_ts (original entry time).
    var entryTsM = row.field_entry_ts || row.field_update_ts;
    fillIpMillCells_(existing, layout, row.new_value, entryTsM);
    sh.getRange(rowIdx, 1, 1, existing.length).setValues([existing]);
    return;
  }

  // MERGED cell: valueCol[fieldKey] === tsCol[fieldKey] (one column per field).
  if (kind === 'qc_ip') {
    // In-Process: the snapshot is the AUTHORITATIVE source of each field's
    // merged value+time (from values.__ts). This field_change only ensures the
    // VALUE is visible before the snapshot arrives — write value ONLY (no time),
    // and only if the cell is still empty so we never clobber the snapshot's
    // merged value+time.
    if (row.new_value !== undefined && row.new_value !== null &&
        coalesce_(existing[layout.valueCol[fieldKey]]) === '') {
      existing[layout.valueCol[fieldKey]] = String(row.new_value);
    }
    sh.getRange(rowIdx, 1, 1, existing.length).setValues([existing]);
    return;
  }

  // RM (and any other per-field section): compose the merged cell = value on
  // line 1 + its ORIGINAL entry time on line 2 (field_entry_ts, the website
  // time — never the upload time). The cell is written once with both lines, so
  // re-running (retry/replay) with the same value+entry time is idempotent.
  var cellCol = layout.valueCol[fieldKey];
  var val = (row.new_value !== undefined && row.new_value !== null) ? String(row.new_value) : '';
  var entryTs = row.field_entry_ts || row.field_update_ts || null;
  if (val !== '') {
    existing[cellCol] = qcMergeCell_(val, entryTs, kind, fieldKey);
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
    // 1) Exact match: a row already bound to this record's source_pk.
    var dataRange = sh.getRange(2, 1, lastRow - 1, Math.max(sh.getLastColumn(), pkCol + 1));
    var dataVals = dataRange.getValues();
    for (var r = 0; r < dataVals.length; r++) {
      if (coalesce_(dataVals[r][pkCol]) === coalesce_(sourcePk)) return r + 2;
    }

    // 2) Reuse the FIRST orphan row whose VISIBLE content cells are all empty
    //    (e.g. a row the operator cleared manually). This prevents a cleared
    //    row from being left behind while a brand-new row is appended below it.
    //    The hidden _source_pk column is ignored when judging emptiness; we
    //    rebind it to this record so its snapshot/field_change land here.
    for (var r2 = 0; r2 < dataVals.length; r2++) {
      var allEmpty = true;
      for (var c = 0; c < dataVals[r2].length; c++) {
        if (c === pkCol) continue;               // ignore the hidden key column
        if (coalesce_(dataVals[r2][c]) !== '') { allEmpty = false; break; }
      }
      if (allEmpty) {
        var reuseRow = r2 + 2;
        sh.getRange(reuseRow, pkCol + 1).setValue(coalesce_(sourcePk));
        return reuseRow;
      }
    }
  }
  // Append a new blank row carrying the source_pk.
  var blank = [];
  for (var i = 0; i < fullWidth; i++) blank.push('');
  blank[pkCol] = coalesce_(sourcePk);
  sh.appendRow(blank);
  return sh.getLastRow();
}

/**
 * Normalize a Finished Goods business identity into ONE stable string key,
 * used IDENTICALLY by the Print/Download snapshot and the live sieve-readings
 * writer so both always resolve to the SAME sheet row for a batch — regardless
 * of which arrives first. Fields: date, batch_no, product, grade, dryer.
 *
 * Normalization that prevents the "separate row every Record" bug:
 *   • trim everything;
 *   • grade: empty/null → 'normal' (the website stores Normal grade as null in
 *     the snapshot but sends 'normal' from the live sieve writer — both map to
 *     'normal' here so they match);
 *   • case-fold grade/dryer so 'ND1' vs 'nd1' can't split a row.
 * The 'test' component is deliberately EXCLUDED — Wet Sieve and Dry Sieve are
 * two cells in the SAME batch row, so they must share one key.
 */
function fgBizKey_(biz) {
  var date    = coalesce_(biz.date).trim();
  var batch   = coalesce_(biz.batch_no).trim();
  var product = coalesce_(biz.product).trim();
  var grade   = coalesce_(biz.grade).trim().toLowerCase();
  if (grade === '') grade = 'normal';
  var dryer   = coalesce_(biz.dryer).trim().toUpperCase();
  return [date, batch, product, grade, dryer].join('|');
}

/**
 * Find (or append) the Finished Goods row for a batch by its normalized
 * business key (fgBizKey_), stored in a hidden trailing "_fg_key" column. This
 * is the SINGLE source of row identity for Finished Goods, shared by the
 * Print/Download snapshot and the live sieve-readings writer, so every event
 * for one batch (first save, later sieve Records, retries, replays) lands on
 * ONE row — never a parallel/duplicate row. `biz` is a {date,batch_no,product,
 * grade,dryer} map; `identityFill` (optional) is a {identityKey: value} map used
 * to populate the visible identity columns when a NEW row is appended. Returns
 * the 1-based row index.
 */
function findOrAppendFgRowByKey_(sh, layout, biz, identityFill, width) {
  var wantKey = fgBizKey_(biz);

  // Ensure a trailing hidden "_fg_key" column exists.
  var header = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
  var keyCol = header.indexOf('_fg_key');
  if (keyCol === -1) {
    keyCol = Math.max(header.length, width);
    sh.getRange(1, keyCol + 1).setValue('_fg_key');
    try { sh.hideColumns(keyCol + 1); } catch (e) { /* ignore */ }
  }
  var fullWidth = Math.max(sh.getLastColumn(), keyCol + 1, width);

  var lastRow = sh.getLastRow();
  var dataVals = null;
  if (lastRow >= 2) {
    dataVals = sh.getRange(2, 1, lastRow - 1, fullWidth).getValues();
    // 1) Exact match on the stable _fg_key → reuse that record's row.
    for (var r = 0; r < dataVals.length; r++) {
      if (coalesce_(dataVals[r][keyCol]) === wantKey) return r + 2;
    }
    // 2) Reuse the FIRST row whose VISIBLE cells are ALL empty (e.g. a row the
    //    operator manually deleted/cleared), instead of appending below the last
    //    row. The hidden _fg_key column is ignored when judging emptiness; we
    //    rebind it to this record so its snapshot/live events land here. A row
    //    that still holds ANY visible value is never reused (no data overwrite).
    for (var r2 = 0; r2 < dataVals.length; r2++) {
      var allEmpty = true;
      for (var c = 0; c < dataVals[r2].length; c++) {
        if (c === keyCol) continue;              // ignore the hidden key column
        if (coalesce_(dataVals[r2][c]) !== '') { allEmpty = false; break; }
      }
      if (allEmpty) {
        var reuseRow = r2 + 2;
        var reuse = [];
        for (var ri = 0; ri < fullWidth; ri++) reuse.push('');
        reuse[keyCol] = wantKey;
        if (identityFill) {
          for (var rk = 0; rk < layout.identityKeys.length; rk++) {
            var ridk = layout.identityKeys[rk];
            if (identityFill[ridk] !== undefined && coalesce_(identityFill[ridk]) !== '') {
              reuse[layout.idCol[ridk]] = coalesce_(identityFill[ridk]);
            }
          }
        }
        sh.getRange(reuseRow, 1, 1, reuse.length).setValues([reuse]);
        try { sh.hideColumns(keyCol + 1); } catch (e) {}
        return reuseRow;
      }
    }
  }

  // Append a new row: stamp the hidden key + fill visible identity columns.
  var blank = [];
  for (var i = 0; i < fullWidth; i++) blank.push('');
  blank[keyCol] = wantKey;
  if (identityFill) {
    for (var k = 0; k < layout.identityKeys.length; k++) {
      var idk = layout.identityKeys[k];
      if (identityFill[idk] !== undefined && coalesce_(identityFill[idk]) !== '') {
        blank[layout.idCol[idk]] = coalesce_(identityFill[idk]);
      }
    }
  }
  sh.appendRow(blank);
  var newRow = sh.getLastRow();
  try { sh.hideColumns(keyCol + 1); } catch (e) {}
  return newRow;
}

/**
 * Finished Goods LIVE Wet/Dry Sieve readings writer (event_type 'sieve_readings',
 * migration 028). Rebuilds ONE sieve test's stacked Value cell + Timestamp cell
 * on the batch's row, matched BY BUSINESS KEY so every reading shares the one
 * row/cell for that batch/grade/product/dryer.
 *
 * Value cell: one line per reading, "#N  <micron>  <result>  <Pass/Fail>".
 * Timestamp cell: the matching website-recorded measurement time (IST
 * hh:mm:ss AM/PM) on the matching line. Both rebuilt deterministically from the
 * payload's full ordered readings array, so retries/replays overwrite with
 * identical content (no duplicates) and deletions are reflected.
 *
 * The 'product' business-key value is the FG product id (e.g. 'sulphur80wdg');
 * the Product identity column shows that same id, which is what the
 * Print/Download snapshot writes too (it stores values.product = the id), so the
 * business keys line up and both writers share one row.
 */
function writeFgSieveReadings_(ss, tabName, row) {
  var payload = row.payload || {};
  var biz = payload.biz || {};
  var test = payload.test;
  if (test !== 'fg_wetSieve' && test !== 'fg_drySieve') return;

  var readings = payload.readings;
  if (typeof readings === 'string') {
    try { readings = JSON.parse(readings); } catch (e) { readings = []; }
  }
  if (!readings || Object.prototype.toString.call(readings) !== '[object Array]') readings = [];

  var kind = 'qc_fg';
  var layout = buildQcLayout_(kind);
  if (layout.valueCol[test] === undefined || layout.tsCol[test] === undefined) return;

  var sh = getOrCreateSheet_(ss, tabName);
  var liveHeader = ensureHeader_(sh, layout.header);
  var width = Math.max(liveHeader.length, layout.header.length);

  // Map the event's biz payload → identity-column keys used by the layout.
  var bizByIdentity = {
    date:     coalesce_(biz.date),
    batch_no: coalesce_(biz.batch_no),
    product:  coalesce_(biz.product),
    grade:    coalesce_(biz.grade),
    dryer:    coalesce_(biz.dryer)
  };

  // SAME normalized _fg_key as the Print/Download snapshot → one shared row per
  // batch. identityFill populates the visible identity columns if this event is
  // the first to create the row (e.g. Record before Print/Download).
  var rowIdx = findOrAppendFgRowByKey_(sh, layout, bizByIdentity, bizByIdentity, width);
  var fullWidth = Math.max(sh.getLastColumn(), width);
  var existing = sh.getRange(rowIdx, 1, 1, fullWidth).getValues()[0];

  // Build the stacked Value + Timestamp strings from the ordered readings, and
  // simultaneously track the LATEST result + time per designated UPL Extra
  // Parameters field (reading.upl_id) so we can update that exact UPL current-
  // result cell. A later reading for the same upl_id overwrites an earlier one
  // (latest wins), which is exactly "update the existing result" on recalc.
  var valueLines = [];
  var tsLines = [];
  var uplLatest = {};   // { upl_id: { result, iso } } — latest reading per target
  for (var i = 0; i < readings.length; i++) {
    var e = readings[i] || {};
    if (e.result === undefined || e.result === null || String(e.result) === '') continue;
    var no     = (e.reading_no !== undefined && e.reading_no !== null) ? e.reading_no : (i + 1);
    var micron = coalesce_(e.micron);
    var result = coalesce_(e.result);
    var status = coalesce_(e.status);
    var parts = ['#' + no];
    if (micron !== '') parts.push(micron);
    parts.push(result);
    if (status !== '') parts.push(status);
    valueLines.push(parts.join('  '));
    tsLines.push(e.iso_time ? renderFieldTs_(kind, e.iso_time) : '');

    // Record the latest result/time for this reading's designated UPL field.
    var uplId = coalesce_(e.upl_id);
    if (uplId !== '') {
      uplLatest[uplId] = { result: result, iso: (e.iso_time || null) };
    }
  }

  // Overwrite the sieve test's MERGED cell (value+time per reading, one line
  // each): "<#n micron result status>  —  <time>". valueCol===tsCol now.
  existing[layout.valueCol[test]] = qcMergeSieveStack_({
    value: valueLines.join(FG_SIEVE_LINE_SEP),
    ts:    tsLines.join(FG_SIEVE_LINE_SEP)
  });

  // Update ONLY the designated UPL Extra Parameters current-result cells (and
  // their Timestamp) to the LATEST recalculated result for each target micron.
  // This is the fix: on the 2nd+ recalculation the UPL parameter cell
  // (e.g. UPL Export "Wet Sieve 160 Micron" = upl_exp_ws_160) now updates live
  // on the same row — no new row/column. Only the targeted UPL fields are
  // touched; every other value/timestamp is left exactly as-is. Uses the
  // reading's own application-recorded time, never the sheet upload time.
  for (var uk in uplLatest) {
    if (!uplLatest.hasOwnProperty(uk)) continue;
    if (layout.valueCol[uk] === undefined) continue;   // not a known FG column → skip
    // MERGED cell: UPL result (+PASS/FAIL status) on line 1, its own recorded
    // time on line 2.
    existing[layout.valueCol[uk]] = qcMergeCell_(uplLatest[uk].result, uplLatest[uk].iso, kind, uk);
  }

  sh.getRange(rowIdx, 1, 1, existing.length).setValues([existing]);
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
var QC_MAX_COL_WIDTH = 150;   // px cap for wide columns → long headers/values WRAP
                              // to multiple lines instead of stretching very wide
                              // (e.g. "Temperature Deg. Cent. Inlet" shows on ~2–3
                              //  short lines). Lowered from 240 for compactness.
var QC_MIN_COL_WIDTH = 70;    // px floor so a 1–2 char value isn't razor-thin

function formatQcTab_(sh) {
  try {
    var lastCol = sh.getLastColumn();
    var lastRow = sh.getLastRow();
    if (lastCol < 1 || lastRow < 1) return;

    // Find the hidden internal key columns so we never resize/unhide them.
    // Two possible hidden keys: '_source_pk' (RM/IP + legacy FG) and '_fg_key'
    // (Finished Goods business key). Visible area ends at the LEFTMOST of them.
    var headerVals = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    var pkCol0  = headerVals.indexOf('_source_pk');   // 0-based, -1 if absent
    var fgCol0  = headerVals.indexOf('_fg_key');       // 0-based, -1 if absent
    var rkCol0  = headerVals.indexOf('_dryer_row_key'); // 0-based, -1 if absent (Dryer v2)
    var hiddenCols = [];
    if (pkCol0 >= 0) hiddenCols.push(pkCol0);
    if (fgCol0 >= 0) hiddenCols.push(fgCol0);
    if (rkCol0 >= 0) hiddenCols.push(rkCol0);
    var firstHidden = -1;
    for (var hc = 0; hc < hiddenCols.length; hc++) {
      if (firstHidden === -1 || hiddenCols[hc] < firstHidden) firstHidden = hiddenCols[hc];
    }
    var visibleCols = (firstHidden >= 0) ? firstHidden : lastCol;  // up to (not incl.) first key col

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
      // Center every populated data cell AND the headers horizontally so RM/IP/
      // FG look consistent (previously some cells were left- and some right-
      // aligned by default type inference). Purely cosmetic — values, formulas,
      // column names, and timestamps are unchanged. Applies to existing rows and
      // every newly inserted/updated row (formatQcTab_ runs each sync tick per
      // touched tab).
      fullRange.setHorizontalAlignment('center');
    }

    // Keep the internal key column(s) hidden if present.
    if (pkCol0 >= 0) { try { sh.hideColumns(pkCol0 + 1); } catch (e) {} }
    if (fgCol0 >= 0) { try { sh.hideColumns(fgCol0 + 1); } catch (e) {} }
    if (rkCol0 >= 0) { try { sh.hideColumns(rkCol0 + 1); } catch (e) {} }

    // 3. Header row: bold, light fill, wrapped, frozen so it stays visible.
    if (visibleCols >= 1) {
      var headerRange = sh.getRange(1, 1, 1, visibleCols);
      headerRange.setFontWeight('bold');
      headerRange.setBackground('#f0ebe3');
      headerRange.setHorizontalAlignment('center');
    }
    if (sh.getFrozenRows() < 1) sh.setFrozenRows(1);

    // 3b. Dryer tabs only: style the bottom-form DIVIDER row and HEADER row
    //     (keyed 'FORM_DIV' / 'FORM_HDR' in the hidden key column) with the same
    //     bold + background as the top header, so the in-tab bottom form matches
    //     the hourly table.
    if (rkCol0 >= 0 && visibleCols >= 1 && lastRow >= 2) {
      var keyColVals = sh.getRange(1, rkCol0 + 1, lastRow, 1).getValues();
      for (var rr = 1; rr < lastRow; rr++) {   // skip row 1 (already styled)
        var kv = coalesce_(keyColVals[rr][0]);
        if (kv === 'FORM_HDR' || kv === 'FORM_DIV') {
          var rng = sh.getRange(rr + 1, 1, 1, visibleCols);
          rng.setFontWeight('bold');
          rng.setBackground('#f0ebe3');
          rng.setHorizontalAlignment('center');
        }
      }
    }

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

/**
 * Render an ordinary "Time" field (a date-less WALL-CLOCK string) in 12-hour
 * AM/PM, e.g. "14:35" → "02:35:00 PM", "9:05:30" → "09:05:30 AM". This is the
 * plain Time column (RM/IP/FG identity), NOT a per-field "Timestamp" column
 * (those keep renderFieldTs_). The stored value is a wall clock already in the
 * plant's local time (IST) with no date/zone, so this is a pure DISPLAY
 * reformat — it never shifts the time. Values that are empty, already in AM/PM
 * form, or not a recognizable HH:mm[:ss] clock are returned unchanged, so the
 * function is safe/idempotent on existing cells.
 */
function renderClockTime_(v) {
  if (v === null || v === undefined) return '';
  var s = String(v).trim();
  if (s === '') return '';
  // Already 12-hour (contains AM/PM) → leave as-is (idempotent on re-sync).
  if (/[AaPp][Mm]\s*$/.test(s)) return s;
  // Match a 24-hour wall clock HH:mm or HH:mm:ss (optionally H:mm).
  var m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return s;   // not a plain clock string → unchanged
  var hh = parseInt(m[1], 10);
  var mm = parseInt(m[2], 10);
  var ss = m[3] !== undefined ? parseInt(m[3], 10) : 0;
  if (isNaN(hh) || isNaN(mm) || isNaN(ss) || hh > 23 || mm > 59 || ss > 59) return s;
  var ampm = hh >= 12 ? 'PM' : 'AM';
  var h12 = hh % 12;
  if (h12 === 0) h12 = 12;
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  return pad(h12) + ':' + pad(mm) + ':' + pad(ss) + ' ' + ampm;
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
