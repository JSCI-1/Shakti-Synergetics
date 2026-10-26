/**
 * Thermopack Sheets Sync — DEDICATED Apps Script worker (Option C).
 *
 * COMPLETELY SEPARATE from the Dryer/QC worker
 * (supabase/google_sheets/apps-script/Code.gs). It has its own Apps Script
 * project, its own time-driven trigger, its own Script Properties, its own
 * spreadsheet, and its own Edge Function endpoints. It PULLS only from the
 * dedicated Thermopack queue (thermopack_sheets_sync_outbox via
 * thermopack-sheets-sync-pull) and ACKs only there, so it can NEVER touch a
 * Dryer/QC record.
 *
 * One-way Supabase → Google Sheets. A time-driven trigger calls syncTick():
 *   pull a batch → route each row by record_kind → UPSERT into the correct
 *   tab (keyed by the hidden _source_pk column) → ack done/failed.
 *
 * Required Script Properties (Project Settings → Script properties):
 *   THERMOPACK_SHEETS_SYNC_SECRET  shared secret → x-sheets-sync-secret header
 *   THERMOPACK_PULL_URL            thermopack-sheets-sync-pull Edge Function URL
 *   THERMOPACK_ACK_URL             thermopack-sheets-sync-ack  Edge Function URL
 *   SPREADSHEET_ID_THERMOPACK      the dedicated Thermopack spreadsheet id
 *
 * Routing — record_kind → tab:
 *   thermo_jobcard → "Job Card Records"          (one row per job card)
 *   thermo_hourly  → "Hourly Log"                (one row per saved hourly row)
 *   thermo_motor   → "Running Motor Amp Status"  (one row per motor reading)
 *
 * TIMESTAMPS: every timestamp displayed in the sheet is captured at the
 * website/backend SAVE moment (payload.saved_at / final_submission_ts /
 * per-reading time), rendered in Asia/Kolkata as hh:mm:ss AM/PM. The script
 * NEVER uses its own upload time as a record timestamp.
 */

/* ───────────────────────── Constants ───────────────────────── */

var PULL_BATCH_LIMIT = 100;
var TZ = 'Asia/Kolkata';
var TS_FORMAT = 'hh:mm:ss a';         // 11:42:08 AM
var SOURCE_PK_COL = '_source_pk';     // hidden dedup/UPSERT key (trailing col)
// Newline used to stack a value (line 1) above its timestamp (line 2) inside a
// single cell. Sheets renders "\n" as a line break when the cell wraps
// (formatTab_ enables wrap). Mirrors the Dryer/QC merged value+timestamp cell.
var LINE_SEP = '\n';

var TAB = {
  JOBCARD: 'Job Card Records',
  HOURLY:  'Hourly Log',
  MOTOR:   'Running Motor Amp Status'
};

// Six Thermopack motors (name + HP), in display order. Source of truth:
// src/components/ThermpackJobCard.jsx MOTORS[].
var MOTORS = [
  { sr: 1, name: 'ID Blower',               hp: 15 },
  { sr: 2, name: 'FD Blower',               hp: 10 },
  { sr: 3, name: 'Circulation Pump (Old)',  hp: 15 },
  { sr: 4, name: 'Compressor',              hp: 20 },
  { sr: 5, name: 'Jockey Pump',             hp: 10 },
  { sr: 6, name: 'Circulation Pump (New)',  hp: 7.5 }
];

/* ── Headers (match the website UI exactly) ─────────────────────
 * A. Job Card Records — one row per submitted job card. Every applicable
 *    website field, then the final submission Timestamp, then the hidden
 *    internal Job Card ID.
 */
// Job Card Records columns as an ORDERED spec: [fieldKey, 'Header', mode].
//   mode 'date'  → plain yyyy-mm-dd, NO timestamp line (Date-type fields).
//   mode 'plain' → plain value, NO timestamp line.
//   mode 'stack' → value on line 1, its OWN entry/update timestamp on line 2
//                  (looked up by fieldKey in payload.field_ts; blank if none).
// fieldKey is the key the website stored the value+timestamp under. Summary
// fields are flattened to '<variant>.<subkey>' (e.g. '10l.outlet_set_temp').
// NO 'Final Submission' column (removed per requirement). 'Total fuel
// Consumption' sits immediately after Diesel and before the 10L Outlet Set Temp.
var JOBCARD_FIELDS = [
  ['date',           'Date',                                  'date'],
  ['shift',          'Shift',                                 'plain'],
  ['log_variant',    'Thermopack Type (active)',              'plain'],
  ['operator',       'Operator',                              'plain'],
  ['helper1',        'Helper 1',                              'plain'],
  ['helper2',        'Helper 2',                              'plain'],
  ['helper3',        'Helper 3',                              'plain'],
  ['time_in',        'Time In',                               'plain'],
  ['time_out',       'Time Out',                              'plain'],
  ['coal_date',      'Coal Received – Date',                  'date'],
  ['coal_qty',       'Coal Received – Qty (MT)',              'stack'],
  ['bugass_date',    'Bugass Received – Date',                'date'],
  ['bugass_qty',     'Bugass Received – Qty (MT)',            'stack'],
  ['coal_charged',   'Fuel Charged – Coal (MT)',              'stack'],
  ['bugass_charged', 'Fuel Charged – Bugass (MT)',            'stack'],
  ['diesel_charged', 'Diesel (Ltr)',                          'stack'],
  // Total fuel Consumption = Coal + Bugass (computed in the writer, not a
  // stored field). mode 'sum_fuel' → plain numeric sum, no timestamp line.
  ['total_fuel_consumption', 'Total fuel Consumption',        'sum_fuel'],
  // Summary — 10 L kCal
  ['10l.outlet_set_temp',              '10L – Outlet Set Temp (°C)',          'stack'],
  ['10l.expansion_tank_level',         '10L – Expansion Tank Level',          'stack'],
  ['10l.type_of_fuel',                 '10L – Type of Fuel',                  'stack'],
  ['10l.qty_fuel_used',                '10L – Qty of Fuel Used',              'stack'],
  ['10l.date_of_last_boiler_cleaning', '10L – Date of Last Boiler Cleaning',  'date'],
  ['10l.total_running_hrs',            '10L – Total Running Hrs',             'stack'],
  ['10l.consumption_per_hr',           '10L – Consumption Per Hr',            'stack'],
  ['10l.total_consumption',            '10L – Total Consumption (kg)',        'stack'],
  ['10l.dryer_in_use',                 '10L – Dryer in Use',                  'stack'],
  // Summary — 6 L kCal
  ['6l.outlet_set_temp',               '6L – Outlet Set Temp (°C)',           'stack'],
  ['6l.expansion_tank_level',          '6L – Expansion Tank Level',           'stack'],
  ['6l.type_of_fuel',                  '6L – Type of Fuel',                   'stack'],
  ['6l.qty_fuel_used',                 '6L – Qty of Fuel Used',               'stack'],
  ['6l.date_of_last_boiler_cleaning',  '6L – Date of Last Boiler Cleaning',   'date'],
  ['6l.total_running_hrs',             '6L – Total Running Hrs',              'stack'],
  ['6l.consumption_per_hr',            '6L – Consumption Per Hr',             'stack'],
  ['6l.total_consumption',             '6L – Total Consumption (kg)',         'stack'],
  ['6l.dryer_in_use',                  '6L – Dryer in Use',                   'stack'],
  ['total_clinker_wt', 'Total Clinker Weight (kg)',           'stack'],
  ['remarks',          'Remarks',                             'stack']
];

var JOBCARD_HEADER = JOBCARD_FIELDS.map(function (f) { return f[1]; });

/* B. Hourly Log — one row per individually saved hourly entry. Mirrors the
 *    website hourly table headers, plus scheduled time, Timestamp, Job Card ID.
 */
// Each measurement field cell holds the value on line 1 and the row's save
// time (hh:mm:ss AM/PM, IST) on line 2. Date / Thermopack Type / Time
// (scheduled) / Operator stay plain single-value columns. No separate
// Timestamp column — the time lives under each value.
var HOURLY_HEADER = [
  'Date', 'Thermopack Type', 'Time (scheduled)',
  'Temp In', 'Temp Out',
  'Oil Press In', 'Oil Press Out', 'Oil Press Level',
  'Temp Exhaust', 'Feed Freq. (Hz)',
  'Bed Cleaning – Start', 'Bed Cleaning – Stop',
  'Ash/Clinker Wt. (kg)', 'Coil Cleaning by Air',
  'Operator'
];

// Hourly value keys in HOURLY_HEADER data-column order (between Time and Operator).
var HOURLY_VALUE_KEYS = [
  'temp_in', 'temp_out',
  'oil_press_in', 'oil_press_out', 'oil_press_level',
  'temp_exhaust', 'feed_freq',
  'bed_clean_start', 'bed_clean_stop',
  'ash_clinker_wt', 'coil_clean_time'
];

/* C. Running Motor Amp Status — one row per motor reading per submission.
 *    Job Card ID left blank (motor checks are submitted independently of a
 *    job card today); Date / Thermopack Type / motor identity / reading /
 *    status / Timestamp per the UI.
 */
// Amp Reading and Status each hold their value on line 1 and the reading's
// save time on line 2. Identity columns (Running Date, Type, Sr/Name/HP,
// Checked By, Remark) stay plain. No separate Timestamp column.
var MOTOR_HEADER = [
  'Running Date', 'Thermopack Type',
  'Sr. No.', 'Motor Name', 'HP',
  'Amp Reading', 'Status', 'Checked By', 'Remark'
];


/* ───────────────────────── Config ───────────────────────── */

function getConfig_() {
  var props = PropertiesService.getScriptProperties();
  var required = [
    'THERMOPACK_SHEETS_SYNC_SECRET', 'THERMOPACK_PULL_URL',
    'THERMOPACK_ACK_URL', 'SPREADSHEET_ID_THERMOPACK'
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
 * Install the time-driven trigger. Run ONCE from the Apps Script editor after
 * setting Script Properties and authorizing scopes. Safe to re-run.
 */
function installTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'syncTick') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('syncTick').timeBased().everyMinutes(1).create();
  Logger.log('Installed Thermopack trigger: syncTick every 1 minute.');
}

/**
 * Create the three Thermopack tabs with headers, widths, and a frozen header
 * row, EVEN IF no events have arrived yet. Run ONCE manually. Idempotent:
 * creates a tab only if missing, writes the header only if row 1 is empty.
 */
function initThermopackTabs() {
  var cfg;
  try { cfg = getConfig_(); }
  catch (e) { Logger.log('[initThermopackTabs] Fail-closed: ' + e.message); return; }

  var ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID_THERMOPACK);
  Logger.log('[initThermopackTabs] Spreadsheet: "' + ss.getName()
    + '"  id=' + cfg.SPREADSHEET_ID_THERMOPACK + '  url=' + ss.getUrl());

  ensureTab_(ss, TAB.JOBCARD, JOBCARD_HEADER);
  ensureTab_(ss, TAB.HOURLY,  HOURLY_HEADER);
  ensureTab_(ss, TAB.MOTOR,   MOTOR_HEADER);
  Logger.log('[initThermopackTabs] Done. All three tabs are ready.');
}

/**
 * ONE-SHOT: WIPE and recreate the three Thermopack tabs with the CURRENT
 * headers. Run this ONCE from the Apps Script editor when the header layout
 * changed (e.g. a new "Operator" column was added) — ensureHeader_ only fills
 * a blank row 1, so an already-created tab keeps its OLD header otherwise.
 *
 * SAFE: touches ONLY the three Thermopack tabs in SPREADSHEET_ID_THERMOPACK.
 * It clears only the SHEET. To also delete the source so it cannot re-sync,
 * run in Supabase SQL:
 *   delete from thermopack_sheets_sync_outbox;
 * (and optionally: delete from thermopack_hourly_draft; delete from
 *  motor_amp_status; delete from thermopack_job_cards;)
 *
 * After wiping, the next saves re-populate the tabs with the correct columns.
 */
function resetThermopackTabsClean() {
  var cfg;
  try { cfg = getConfig_(); }
  catch (e) { Logger.log('[resetThermopackTabsClean] Fail-closed: ' + e.message); return; }

  var ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID_THERMOPACK);
  var specs = [
    { name: TAB.JOBCARD, header: JOBCARD_HEADER },
    { name: TAB.HOURLY,  header: HOURLY_HEADER },
    { name: TAB.MOTOR,   header: MOTOR_HEADER }
  ];
  for (var i = 0; i < specs.length; i++) {
    var old = ss.getSheetByName(specs[i].name);
    if (old) ss.deleteSheet(old);
    ss.insertSheet(specs[i].name);
    ensureTab_(ss, specs[i].name, specs[i].header);
    Logger.log('[resetThermopackTabsClean] Wiped + recreated tab: ' + specs[i].name);
  }
  Logger.log('[resetThermopackTabsClean] Done. All three tabs are empty with the current headers.');
}


/* ───────────────────────── Sync loop ───────────────────────── */

/**
 * Time-driven entry point. Google's fastest time-driven trigger is every 1
 * minute, so to get sub-minute latency we run SEVERAL passes WITHIN the single
 * minute, spaced ~20s apart (t≈0s, 20s, 40s). We do NOT stop early on an empty
 * pass, so data saved anywhere in the minute is picked up by the next pass
 * ~20s later instead of waiting for the next minute's trigger. Worst-case
 * latency is therefore ~20–25s (well inside the 30–40s target). A ScriptLock
 * prevents overlapping runs; each run stays ~40s, far under the 6-min limit.
 */
var SYNC_PASS_INTERVAL_MS = 20000;   // ~20s between passes
var SYNC_PASSES = 3;                 // 3 passes per minute (t≈0s, 20s, 40s)

function syncTick() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) { return; }
  try {
    for (var p = 0; p < SYNC_PASSES; p++) {
      syncPass_();                              // always run; never break early
      if (p < SYNC_PASSES - 1) Utilities.sleep(SYNC_PASS_INTERVAL_MS);
    }
  } finally {
    lock.releaseLock();
  }
}

function syncPass_() {
  var cfg;
  try { cfg = getConfig_(); }
  catch (e) { Logger.log('[syncPass] Fail-closed: ' + e.message); return 0; }

  var pulled = pull_(cfg);
  if (!pulled || !pulled.rows || pulled.rows.length === 0) return 0;

  var ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID_THERMOPACK);
  var done = [];
  var failed = [];

  for (var i = 0; i < pulled.rows.length; i++) {
    var row = pulled.rows[i];
    try {
      routeRow_(ss, row);
      done.push(row.event_id);
    } catch (e) {
      failed.push({ event_id: row.event_id, error: String(e && e.message ? e.message : e) });
    }
  }

  ack_(cfg, done, failed);
  return pulled.rows.length;
}

function routeRow_(ss, row) {
  var kind = row.record_kind;
  var payload = row.payload || {};
  if (kind === 'thermo_jobcard') {
    writeJobCard_(ss, row, payload);
  } else if (kind === 'thermo_hourly') {
    writeHourly_(ss, row, payload);
  } else if (kind === 'thermo_motor') {
    writeMotor_(ss, row, payload);
  } else {
    throw new Error('Unknown record_kind: ' + kind);
  }
}


/* ───────────────────────── Writers (UPSERT) ───────────────────────── */

// Resolve a Job Card field value by key, including flattened summary keys
// ('10l.<sub>' / '6l.<sub>').
function jobCardValue_(p, key) {
  if (key.indexOf('10l.') === 0) {
    var s10 = p.summary_10l || {};
    return s10[key.slice(4)];
  }
  if (key.indexOf('6l.') === 0) {
    var s6 = p.summary_6l || {};
    return s6[key.slice(3)];
  }
  return p[key];
}

function writeJobCard_(ss, row, p) {
  var sh = ensureTab_(ss, TAB.JOBCARD, JOBCARD_HEADER);
  // Per-field entry/update timestamps captured on the website (payload.field_ts
  // = { fieldKey: isoTime }). Blank when the website supplied none — NEVER
  // substituted with the sync/upload time.
  var fts = (p.field_ts && typeof p.field_ts === 'object') ? p.field_ts : {};

  var rowVals = [];
  for (var i = 0; i < JOBCARD_FIELDS.length; i++) {
    var key  = JOBCARD_FIELDS[i][0];
    var mode = JOBCARD_FIELDS[i][2];
    var val  = jobCardValue_(p, key);

    if (mode === 'date') {
      rowVals.push(fmtDate_(val));          // Date-type: no timestamp line
    } else if (mode === 'plain') {
      rowVals.push(valOrBlank_(val));
    } else if (mode === 'sum_fuel') {
      // Total fuel Consumption = Fuel Charged Coal + Fuel Charged Bugass.
      // Blank only if BOTH are blank; otherwise the numeric sum (no timestamp).
      var coal = parseFloat(p.coal_charged);
      var bug  = parseFloat(p.bugass_charged);
      var hasCoal = !isNaN(coal);
      var hasBug  = !isNaN(bug);
      if (!hasCoal && !hasBug) {
        rowVals.push('');
      } else {
        rowVals.push((hasCoal ? coal : 0) + (hasBug ? bug : 0));
      }
    } else {
      // 'stack': value on line 1, its own entry/update time on line 2.
      rowVals.push(stackCell_(val, fts[key]));
    }
  }

  upsertByKey_(sh, JOBCARD_HEADER, rowVals, row.source_pk);
  formatTab_(sh, JOBCARD_HEADER.length);   // format AFTER writing the row
}

function writeHourly_(ss, row, p) {
  var sh = ensureTab_(ss, TAB.HOURLY, HOURLY_HEADER);
  var v = p.values || {};
  // Per-field entry timestamps captured on the website (values.__ts.<field>).
  var fts = (v.__ts && typeof v.__ts === 'object') ? v.__ts : {};
  var rowTs = p.saved_at || row.record_ts;   // fallback only
  // Date = the day the hourly row was saved.
  var rowVals = [ fmtDate_(rowTs), p.variant || '', p.hour || '' ];
  // Each measurement value stacked above the time THAT field was entered on the
  // website. Fall back to the row save time only if a field has no captured ts.
  for (var i = 0; i < HOURLY_VALUE_KEYS.length; i++) {
    var fk = HOURLY_VALUE_KEYS[i];
    rowVals.push(stackCell_(v[fk], fts[fk] || rowTs));
  }
  rowVals.push(p.operator || '');

  upsertByKey_(sh, HOURLY_HEADER, rowVals, row.source_pk);
  formatTab_(sh, HOURLY_HEADER.length);   // format AFTER writing the row
}

function writeMotor_(ss, row, p) {
  var sh = ensureTab_(ss, TAB.MOTOR, MOTOR_HEADER);

  // One submission → up to 12 readings (6 motors × 2 variants). Only rows
  // with a non-empty Amp Reading or Status are written (the website only
  // saves completed motor rows, but we guard here too). Each reading's row
  // uses a deterministic dedup key "<motorId>|<variant>|<sr>" so a replay of
  // the SAME submission UPSERTS the same rows (no duplicates), while a new
  // submission (new motor_amp_status.id) produces a fresh set of rows
  // (history preserved).
  var motorId = p.motor_id || row.source_pk;
  var variants = [
    { key: '10L', data: p.motor_data_10l || [] },
    { key: '6L',  data: p.motor_data_6l  || [] }
  ];

  for (var vi = 0; vi < variants.length; vi++) {
    var variant = variants[vi].key;
    var arr = variants[vi].data;
    for (var m = 0; m < MOTORS.length; m++) {
      var reading = arr[m] || {};
      var amp = reading.val;
      var status = reading.stop;
      var hasData = (amp !== undefined && amp !== null && String(amp).trim() !== '')
                 || (status !== undefined && status !== null && String(status).trim() !== '');
      if (!hasData) continue;    // skip incomplete motor rows

      var motor = MOTORS[m];
      var tsSource = reading.isoTime || p.final_submission_ts || row.record_ts;
      var rowVals = [
        fmtDate_(p.running_date),
        variant,
        motor.sr, motor.name, motor.hp,
        stackCell_(amp, tsSource), stackCell_(status, tsSource),
        p.checked_by || '', p.remark || ''
      ];
      var dedupKey = motorId + '|' + variant + '|' + motor.sr;
      upsertByKey_(sh, MOTOR_HEADER, rowVals, dedupKey);
    }
  }
  formatTab_(sh, MOTOR_HEADER.length);   // format AFTER writing all rows
}


/* ───────────────────────── Sheet helpers ───────────────────────── */

function ensureTab_(ss, name, header) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  ensureHeader_(sh, header);
  // NOTE: formatting is applied AFTER the row is written (see each writer's
  // trailing formatTab_ call), so auto-resize/centering include the new data.
  return sh;
}

// Writes the full header (visible columns + trailing hidden _source_pk) only
// if row 1 is empty; otherwise leaves it as-is (never clobbers existing data).
function ensureHeader_(sh, header) {
  var total = header.length + 1;   // + hidden _source_pk
  var first = sh.getRange(1, 1, 1, Math.max(1, total)).getValues()[0];
  var empty = true;
  for (var i = 0; i < first.length; i++) {
    if (String(first[i]).trim() !== '') { empty = false; break; }
  }
  if (empty) {
    var full = header.slice();
    full.push(SOURCE_PK_COL);
    sh.getRange(1, 1, 1, full.length).setValues([full]);
    sh.setFrozenRows(1);
    sh.hideColumns(total);    // hide the _source_pk column
  }
}

// Auto-size + center the tab, matching the Dryer/QC sheet look: auto-resize
// each visible column to fit its content, cap very wide / very narrow columns,
// wrap text, and center everything (headers + data) both horizontally and
// vertically. Runs on every sync write so freshly added rows stay formatted.
var COL_MIN_WIDTH = 70;
var COL_MAX_WIDTH = 240;

function formatTab_(sh, visibleCols) {
  try {
    var lastRow = Math.max(1, sh.getLastRow());

    // 1. Auto-resize visible columns to fit header + data.
    if (visibleCols >= 1) sh.autoResizeColumns(1, visibleCols);

    // 2. Cap width extremes so one long value can't blow out the layout and a
    //    short one isn't unreadably narrow.
    for (var c = 1; c <= visibleCols; c++) {
      var w = sh.getColumnWidth(c);
      if (w > COL_MAX_WIDTH) sh.setColumnWidth(c, COL_MAX_WIDTH);
      else if (w < COL_MIN_WIDTH) sh.setColumnWidth(c, COL_MIN_WIDTH);
    }

    // 3. Wrap + center every populated cell (headers and data).
    if (visibleCols >= 1) {
      var full = sh.getRange(1, 1, lastRow, visibleCols);
      full.setWrap(true);
      full.setVerticalAlignment('middle');
      full.setHorizontalAlignment('center');
    }

    // 4. Header styling + frozen header row.
    var header = sh.getRange(1, 1, 1, visibleCols);
    header.setFontWeight('bold').setBackground('#f0ece4');
    if (sh.getFrozenRows() < 1) sh.setFrozenRows(1);

    // 5. Auto-size row heights so wrapped text is fully visible.
    try { sh.autoResizeRows(1, lastRow); } catch (e) { /* older runtimes */ }
  } catch (e) { /* formatting is cosmetic — never fail a sync write */ }
}

// UPSERT a data row keyed by the hidden trailing _source_pk column. If a row
// with that key exists, it is overwritten in place (idempotent replay → same
// content); otherwise a new row is appended. Keeps one row per logical record.
function upsertByKey_(sh, header, rowVals, key) {
  var keyColIndex = header.length + 1;    // _source_pk is the trailing column
  var full = rowVals.slice();
  full.push(String(key));

  var lastRow = sh.getLastRow();
  var targetRow = -1;
  if (lastRow >= 2) {
    var keys = sh.getRange(2, keyColIndex, lastRow - 1, 1).getValues();
    for (var i = 0; i < keys.length; i++) {
      if (String(keys[i][0]) === String(key)) { targetRow = i + 2; break; }
    }
  }
  if (targetRow === -1) targetRow = lastRow + 1;
  sh.getRange(targetRow, 1, 1, full.length).setValues([full]);
}


/* ───────────────────────── Formatting ───────────────────────── */

// Render a timestamp (ISO/Date) as hh:mm:ss AM/PM in Asia/Kolkata. Blank in →
// blank out. NEVER substitutes the current (upload) time for a missing value.
function fmtTs_(ts) {
  if (!ts) return '';
  try {
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    return Utilities.formatDate(d, TZ, TS_FORMAT);
  } catch (e) { return ''; }
}

// Stack a value on line 1 and its timestamp (hh:mm:ss AM/PM IST) on line 2 in
// one cell. If the value is blank → blank cell (no invented timestamp). If no
// timestamp is available → value only (never fabricated).
function stackCell_(value, isoTs) {
  var v = valOrBlank_(value);
  if (v === '' || v === null || v === undefined) return '';
  var t = fmtTs_(isoTs);
  return t ? (String(v) + LINE_SEP + t) : String(v);
}

// Date-only → yyyy-mm-dd (IST). Blank stays blank.
function fmtDate_(d) {
  if (!d) return '';
  try {
    var dt = new Date(d);
    if (isNaN(dt.getTime())) return String(d);
    return Utilities.formatDate(dt, TZ, 'yyyy-MM-dd');
  } catch (e) { return String(d); }
}

function valOrBlank_(v) {
  if (v === undefined || v === null) return '';
  return v;
}

function numOrBlank_(v) {
  if (v === undefined || v === null || String(v).trim() === '') return '';
  var n = Number(v);
  return isNaN(n) ? String(v) : n;
}


/* ───────────────────────── HTTP (pull / ack) ───────────────────────── */

function pull_(cfg) {
  var url = cfg.THERMOPACK_PULL_URL + '?limit=' + PULL_BATCH_LIMIT;
  var res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { 'x-sheets-sync-secret': cfg.THERMOPACK_SHEETS_SYNC_SECRET },
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code !== 200) {
    Logger.log('[pull] HTTP ' + code + ': ' + res.getContentText());
    return null;
  }
  return JSON.parse(res.getContentText());
}

function ack_(cfg, done, failed) {
  if ((!done || done.length === 0) && (!failed || failed.length === 0)) return;
  var res = UrlFetchApp.fetch(cfg.THERMOPACK_ACK_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-sheets-sync-secret': cfg.THERMOPACK_SHEETS_SYNC_SECRET },
    payload: JSON.stringify({ done: done || [], failed: failed || [] }),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code !== 200) {
    Logger.log('[ack] HTTP ' + code + ': ' + res.getContentText());
  }
}
