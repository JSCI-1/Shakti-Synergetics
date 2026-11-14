/**
 * Thermopack Sheets Sync and Slurry and Batch 
  — DEDICATED Apps Script worker (Option C).
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
      syncPass_();                              // handles both Thermopack AND Slurry Operator
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

  // Open the Slurry Operator spreadsheet lazily (only if a slurry row arrives).
  var slurrySS = null;
  function getSlurrySS_() {
    if (slurrySS) return slurrySS;
    var soId = PropertiesService.getScriptProperties()
      .getProperty('SPREADSHEET_ID_SLURRY_OP');
    if (!soId || String(soId).trim() === '') {
      throw new Error('[syncPass] SPREADSHEET_ID_SLURRY_OP not set — '
        + 'cannot route slurry_op_* record. Set the Script Property first.');
    }
    slurrySS = SpreadsheetApp.openById(String(soId).trim());
    return slurrySS;
  }

  for (var i = 0; i < pulled.rows.length; i++) {
    var row = pulled.rows[i];
    try {
      routeRow_(ss, row, getSlurrySS_);
      done.push(row.event_id);
    } catch (e) {
      failed.push({ event_id: row.event_id, error: String(e && e.message ? e.message : e) });
    }
  }

  ack_(cfg, done, failed);
  return pulled.rows.length;
}

function routeRow_(ss, row, getSlurrySS_) {
  var kind = row.record_kind;
  var payload = row.payload || {};
  if (kind === 'thermo_jobcard') {
    writeJobCard_(ss, row, payload);
  } else if (kind === 'thermo_hourly') {
    writeHourly_(ss, row, payload);
  } else if (kind === 'thermo_motor') {
    writeMotor_(ss, row, payload);
  } else if (kind === 'slurry_op_jobcard') {
    writeSlurryOpJobCard_(getSlurrySS_(), row, payload);
  } else if (kind === 'slurry_op_motor') {
    writeSlurryOpMotor_(getSlurrySS_(), row, payload);
  } else if (kind === 'batch_op_jobcard') {
    boWriteJobCard_(boOpenSS_(), row, payload);
  } else if (kind === 'batch_op_traceability') {
    boWriteTraceability_(boOpenSS_(), row, payload);
  } else if (kind === 'batch_op_consumption') {
    boWriteConsumption_(boOpenSS_(), row, payload);
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


/* ═══════════════════════════════════════════════════════════════════════════
 * SLURRY OPERATOR — Sheets Sync (combined into this Thermopack worker)
 * ───────────────────────────────────────────────────────────────────────────
 * Writes to a SEPARATE spreadsheet: "Slurry Operator"
 * (Script Property: SPREADSHEET_ID_SLURRY_OP)
 *
 * Two tabs:
 *   SO_TAB.JOBCARD → "Job Card"
 *   SO_TAB.MOTOR   → "Running Motor Amp Status"
 *
 * Routing (record_kind):
 *   slurry_op_jobcard → "Job Card"
 *   slurry_op_motor   → "Running Motor Amp Status"
 *
 * TIMESTAMPS: every timestamp shown in the sheet is captured at the
 * website/backend SAVE moment, rendered in Asia/Kolkata as hh:mm:ss AM/PM
 * (same TZ and TS_FORMAT constants as Thermopack). The script NEVER uses
 * its own upload time as a record timestamp.
 *
 * Additional Script Property required:
 *   SPREADSHEET_ID_SLURRY_OP   — the dedicated "Slurry Operator" spreadsheet id
 *                                 (the ONLY new Script Property needed)
 *
 * NO new Edge Functions, no new secrets, no new triggers in Apps Script.
 * Slurry rows arrive via the SAME thermopack-sheets-sync-pull endpoint because
 * migration 050 enqueues them into thermopack_sheets_sync_outbox.
 *
 * DEDUP / UPSERT: both tabs use the same upsertByKey_ helper from the
 * Thermopack section (keyed by the hidden trailing _source_pk column), so
 * replays never produce duplicate rows.
 * ═══════════════════════════════════════════════════════════════════════════ */

/* ── Slurry Operator — Tab names ──────────────────────────────────────────── */
var SO_TAB = {
  JOBCARD: 'Job Card',
  MOTOR:   'Running Motor Amp Status'
};

/* ── Slurry Operator — Job Card header ───────────────────────────────────────
 * VERTICAL layout: one row per mill per job card submission.
 * Identity columns (Date, Shift, Operator Name, Supervisor, Manager) repeat on
 * every mill row. "Mill No." identifies which mill the row belongs to.
 *
 * Columns:
 *   Date | Shift | Operator Name | Mill No. |
 *   Flow Rates (L/Sec) | Current Amp | Zirconia/Zircosil Beads (kg) | Remarks |
 *   Supervisor | Manager
 *
 * Dedup key: source_pk + '|' + mill_name  → one row per mill per submission.
 * A re-sync of the same submission UPSERTs the same rows (idempotent).
 * ──────────────────────────────────────────────────────────────────────────── */
var SO_MILL_NAMES = ['V1','V2','V3','V4','V5','V6','V7','V8','V9','V10'];

var SO_JOBCARD_HEADER = [
  'Date', 'Shift', 'Operator Name',
  'Mill No.',
  'Flow Rates (L/Sec)',
  'Current Amp',
  'Zirconia/Zircosil Beads (kg)',
  'Remarks',
  'Supervisor', 'Manager'
];

/* ── Slurry Operator — Running Motor Amp Status header ───────────────────────
 * One row per motor per submission (same pattern as Thermopack motor tab).
 * Columns: Running Date | Sr. No. | Motor Name | HP | Amp Reading | Status | Timestamp | Checked By | Remark
 * ──────────────────────────────────────────────────────────────────────────── */
var SO_MOTOR_HEADER = [
  'Running Date',
  'Sr. No.', 'Motor Name', 'HP',
  'Amp Reading',
  'Status',
  'Timestamp',
  'Checked By', 'Remark'
];

// Slurry motors — mirrors SLURRY_MOTORS in SlurryOperator.jsx
var SO_MOTORS = [
  { id: 1,  name: 'Vertical Mill 01',  hp: 50 },
  { id: 2,  name: 'Vertical Mill 02',  hp: 50 },
  { id: 3,  name: 'Vertical Mill 03',  hp: 50 },
  { id: 4,  name: 'Vertical Mill 04',  hp: 50 },
  { id: 5,  name: 'Vertical Mill 05',  hp: 50 },
  { id: 6,  name: 'Vertical Mill 06',  hp: 50 },
  { id: 7,  name: 'Vertical Mill 07',  hp: 50 },
  { id: 8,  name: 'Vertical Mill 08',  hp: 50 },
  { id: 9,  name: 'Vertical Mill 09',  hp: 50 },
  { id: 10, name: 'Vertical Mill 10',  hp: 50 },
  { id: 11, name: 'Attrition Mill 01', hp: 75 },
  { id: 12, name: 'Attrition Mill 02', hp: 60 }
];


/* ── Slurry Operator — Config ─────────────────────────────────────────────── */
/*
 * Slurry Operator uses the SAME thermopack_sheets_sync_outbox, the SAME
 * Edge Function endpoints, and the SAME shared secret as Thermopack.
 * No extra Script Properties are needed — getConfig_() (Thermopack) supplies
 * everything. The pull endpoint already returns slurry_op_* record_kinds
 * because they are enqueued into the same outbox by migration 050 triggers.
 *
 * SPREADSHEET_ID_SLURRY_OP is the ONLY extra Script Property required:
 *   the dedicated "Slurry Operator" Google Spreadsheet id.
 */

function getSlurryOpConfig_() {
  var props = PropertiesService.getScriptProperties();
  var required = [
    'THERMOPACK_SHEETS_SYNC_SECRET',
    'THERMOPACK_PULL_URL',
    'THERMOPACK_ACK_URL',
    'SPREADSHEET_ID_SLURRY_OP'
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
    throw new Error('[SlurryOp] Missing Script Properties: ' + missing.join(', '));
  }
  // Expose under the names the Slurry helpers expect
  cfg.SLURRY_OP_SECRET   = cfg.THERMOPACK_SHEETS_SYNC_SECRET;
  cfg.SLURRY_OP_PULL_URL = cfg.THERMOPACK_PULL_URL;
  cfg.SLURRY_OP_ACK_URL  = cfg.THERMOPACK_ACK_URL;
  return cfg;
}


/* ── Slurry Operator — One-time setup ────────────────────────────────────── */

/**
 * Create the two Slurry Operator tabs with headers up front. Run ONCE manually.
 * Idempotent: creates a tab only if missing, writes header only if row 1 empty.
 */
function initSlurryOpTabs() {
  var cfg;
  try { cfg = getSlurryOpConfig_(); }
  catch (e) { Logger.log('[initSlurryOpTabs] Fail-closed: ' + e.message); return; }

  var ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID_SLURRY_OP);
  Logger.log('[initSlurryOpTabs] Spreadsheet: "' + ss.getName()
    + '"  id=' + cfg.SPREADSHEET_ID_SLURRY_OP + '  url=' + ss.getUrl());

  ensureTab_(ss, SO_TAB.JOBCARD, SO_JOBCARD_HEADER);
  ensureTab_(ss, SO_TAB.MOTOR,   SO_MOTOR_HEADER);
  Logger.log('[initSlurryOpTabs] Done. "Job Card" and "Running Motor Amp Status" tabs are ready.');
}

/**
 * ONE-SHOT: WIPE and recreate both Slurry Operator tabs with the CURRENT
 * headers. Use when the layout changed. SAFE: touches ONLY the Slurry Operator
 * spreadsheet. To also delete source data so it cannot re-sync, run in Supabase:
 *   delete from slurry_operator_job_cards;
 *   delete from slurry_operator_motor_amp;
 *   delete from slurry_op_sheets_sync_outbox;  -- (when that table exists)
 */
function resetSlurryOpTabsClean() {
  var cfg;
  try { cfg = getSlurryOpConfig_(); }
  catch (e) { Logger.log('[resetSlurryOpTabsClean] Fail-closed: ' + e.message); return; }

  var ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID_SLURRY_OP);
  var specs = [
    { name: SO_TAB.JOBCARD, header: SO_JOBCARD_HEADER },
    { name: SO_TAB.MOTOR,   header: SO_MOTOR_HEADER   }
  ];
  for (var i = 0; i < specs.length; i++) {
    var old = ss.getSheetByName(specs[i].name);
    if (old) ss.deleteSheet(old);
    ss.insertSheet(specs[i].name);
    ensureTab_(ss, specs[i].name, specs[i].header);
    Logger.log('[resetSlurryOpTabsClean] Wiped + recreated: ' + specs[i].name);
  }
  Logger.log('[resetSlurryOpTabsClean] Done. Both Slurry Operator tabs are empty.');
}


/* ── Slurry Operator — Sync loop ─────────────────────────────────────────── */
/*
 * Slurry Operator rows are routed INSIDE syncPass_() — no separate pass or
 * pull/ack loop is needed. pullSlurryOp_() / ackSlurryOp_() / syncPassSlurryOp_()
 * are intentionally absent: the shared pull endpoint already returns
 * slurry_op_* rows (same outbox), and routeRow_() dispatches them to
 * writeSlurryOpJobCard_() / writeSlurryOpMotor_() with a lazily-opened
 * Slurry spreadsheet. Everything is handled in one atomic pull-route-ack pass.
 */


/* ── Slurry Operator — Writers ───────────────────────────────────────────── */

/**
 * Write Slurry Operator job card — VERTICAL layout, one row per mill.
 *
 * Each mill in the payload produces one sheet row:
 *   Date | Shift | Operator Name | Mill No. |
 *   Flow Rates | Current Amp | Zirconia Beads | Remarks |
 *   Supervisor | Manager
 *
 * Flow rates are stacked in a single cell: "value\ntimestamp" per reading,
 * separated by a blank line between readings.
 * Dedup key: source_pk + '|' + mill_name → idempotent upsert per mill row.
 * Mills with no data at all are still written (blank data columns) so every
 * submission always produces exactly 10 rows in the sheet.
 */
function writeSlurryOpJobCard_(ss, row, p) {
  var sh = ensureTab_(ss, SO_TAB.JOBCARD, SO_JOBCARD_HEADER);

  var millsArr = Array.isArray(p.mills) ? p.mills : [];

  // Index mills by name for lookup
  var millsByName = {};
  for (var mi = 0; mi < millsArr.length; mi++) {
    var ml = millsArr[mi];
    if (ml && ml.mill) millsByName[ml.mill] = ml;
  }

  // Shared identity / footer values
  var date         = fmtDate_(p.date);
  var shift        = valOrBlank_(p.shift);
  var operatorName = valOrBlank_(p.operator_name);
  var supervisor   = valOrBlank_(p.supervisor);
  var manager      = valOrBlank_(p.manager);

  for (var si = 0; si < SO_MILL_NAMES.length; si++) {
    var millName = SO_MILL_NAMES[si];
    var mill = millsByName[millName] || {};

    // Flow Rates: stack each reading as "value\ntimestamp"
    var flowRates = Array.isArray(mill.flow_rates) ? mill.flow_rates : [];
    var flowLines = [];
    for (var fi = 0; fi < flowRates.length; fi++) {
      var fr  = flowRates[fi];
      var fv  = valOrBlank_(fr ? fr.value : '');
      var fts = (fr && fr.timestamp && String(fr.timestamp).trim() !== '')
        ? String(fr.timestamp).trim() : '';
      if (fv === '' && fts === '') continue;   // skip truly empty readings
      flowLines.push(fts ? (String(fv) + LINE_SEP + fts) : String(fv));
    }
    var flowCell = flowLines.join(LINE_SEP + LINE_SEP);  // blank line between readings

    var rowVals = [
      date, shift, operatorName,
      millName,
      flowCell,
      // Current Amp: value on line 1, entry timestamp on line 2 (same cell)
      soStackWithTs_(mill.current_amp,    mill.current_amp_ts),
      // Zirconia Beads: value on line 1, entry timestamp on line 2 (same cell)
      soStackWithTs_(mill.zirconia_beads, mill.zirconia_beads_ts),
      valOrBlank_(mill.remarks),
      supervisor, manager
    ];

    // One dedup key per mill row — upserts in place on replay
    var dedupKey = row.source_pk + '|' + millName;
    upsertByKey_(sh, SO_JOBCARD_HEADER, rowVals, dedupKey);
  }

  formatTab_(sh, SO_JOBCARD_HEADER.length);
}

/**
 * Write one Slurry Operator Running Motor Amp Status submission.
 *
 * payload shape (matches slurry_operator_motor_amp insert):
 *   {
 *     running_date: 'yyyy-mm-dd',
 *     checked_by:   string,
 *     remark:       string,
 *     motor_data: [
 *       { amp: number, stop: 'OK'|'STOP'|'', timestamp: 'hh:mm:ss AM/PM' },
 *       ... (one entry per SLURRY_MOTORS index, 12 entries total)
 *     ]
 *   }
 *
 * One row per motor (only motors with a non-empty Amp or Status are written).
 * Amp Reading and Status each show value on line 1 + the website timestamp on
 * line 2 (same stacked-cell style as Thermopack). Timestamp column repeats the
 * per-motor captured time as plain text for easy reading.
 */
function writeSlurryOpMotor_(ss, row, p) {
  var sh = ensureTab_(ss, SO_TAB.MOTOR, SO_MOTOR_HEADER);

  var motorData = Array.isArray(p.motor_data) ? p.motor_data : [];
  var submissionId = p.submission_id || row.source_pk;

  for (var mi = 0; mi < SO_MOTORS.length; mi++) {
    var motor   = SO_MOTORS[mi];
    var reading = motorData[mi] || {};

    var amp    = reading.amp;
    var status = reading.stop;
    var hasData =
      (amp    !== undefined && amp    !== null && String(amp).trim()    !== '') ||
      (status !== undefined && status !== null && String(status).trim() !== '');
    if (!hasData) continue;   // skip rows the operator left blank

    var rowVals = [
      fmtDate_(p.running_date),
      motor.id, motor.name, motor.hp,
      // Amp Reading: value on line 1, entry timestamp on line 2 (same cell)
      soStackWithTs_(amp,    reading.amp_ts),
      // Status: value on line 1, entry timestamp on line 2 (same cell)
      soStackWithTs_(status, reading.stop_ts),
      // Timestamp: auto-stamped when both amp+stop filled (visible on website)
      reading.timestamp || '',
      valOrBlank_(p.checked_by),
      valOrBlank_(p.remark)
    ];

    // Dedup key: one row per (submission, motor) — replay is idempotent.
    var dedupKey = submissionId + '|' + motor.id;
    upsertByKey_(sh, SO_MOTOR_HEADER, rowVals, dedupKey);
  }

  formatTab_(sh, SO_MOTOR_HEADER.length);
}

/**
 * Stack a value + a pre-formatted display timestamp (already hh:mm:ss AM/PM)
 * into a single cell. Unlike Thermopack's stackCell_() which converts ISO → IST,
 * here the timestamp is ALREADY a display string from the website (stamp12hr).
 */
function soStackWithTs_(value, tsDisplay) {
  var v = valOrBlank_(value);
  if (v === '' || v === null || v === undefined) return '';
  return tsDisplay ? (String(v) + LINE_SEP + tsDisplay) : String(v);
}


/* ── END SLURRY OPERATOR SECTION ─────────────────────────────────────────── */


/* ═══════════════════════════════════════════════════════════════════════════
 * BATCH OPERATOR — Sheets Sync (combined into this Thermopack/Slurry worker)
 * ───────────────────────────────────────────────────────────────────────────
 * Writes to a SEPARATE spreadsheet: "Batch Operator"
 * (Script Property: SPREADSHEET_ID_BATCH_OP — the ONLY new property needed)
 *
 * Three tabs (one per Batch Operator form):
 *   BO_TAB.JOBCARD     → "Process Job Card"
 *   BO_TAB.TRACE       → "Batch Traceability Records"
 *   BO_TAB.CONSUMPTION → "Slurry Consumption Report"
 *
 * Routing (record_kind) — rows arrive through the SAME thermopack-sheets-sync-
 * pull endpoint because migration 063 enqueues them into the SAME
 * thermopack_sheets_sync_outbox (exactly like Slurry Operator, migration 050):
 *   batch_op_jobcard      ← process_job_cards
 *   batch_op_traceability ← batch_traceability
 *   batch_op_consumption  ← slurry_consumption
 *
 * NO new Edge Functions, secrets, queues or triggers in Apps Script. Only the
 * helper functions below are new; nothing above this section was changed
 * except the three routing branches in routeRow_().
 *
 * TIMESTAMPS: shown exactly as captured on the website (hh:mm:ss AM/PM for
 * Process Job Card input times). The script NEVER uses its own upload time.
 * ═══════════════════════════════════════════════════════════════════════════ */

var BO_TAB = {
  JOBCARD:     'Process Job Card',
  TRACE:       'Batch Traceability Records',
  CONSUMPTION: 'Slurry Consumption Report'
};

// Tank value → label (mirrors BATCH_OPTIONS / CHARGE_TANKS / LST_TANKS /
// FST_TANKS on the website). Unknown values are shown as-is.
var BO_TANK_LABELS = {
  'Attrition-1st-1.6MT': '1st Attrition Mill — 1.6 MT',
  'Attrition-2nd-1.2MT': '2nd Attrition Mill — 1.2 MT',
  'HST-1st-8MT':         'HST 1st — 8 MT',
  'HST-2nd-6MT':         'HST 2nd — 6 MT',
  'HS-1(6000)':          'HS-1 (6000)',
  'HS-2(4000)':          'HS-2 (4000)',
  'HS-3(6000)':          'HS-3 (6000)',
  'NM(2000)':            'NM (2000)',
  'LST1':                'LST 1',
  'LST2':                'LST 2',
  'LST1/2':              'LST 1/2',
  'FST 1/2':             'FST 1/2',
  'FST 1':               'FST 1',
  'FST 2':               'FST 2'
};

/* A. Process Job Card — one row per input line, then a bold "Batch Total" row
 *    after each batch (matches the stacked batch card on the website).
 *    Identity columns repeat on every row, including the total row, so
 *    filtering still works; total rows have "Batch Total" in the Input column. */
var BO_JOBCARD_HEADER = [
  'Date', 'Shift', 'Operator Name',
  'Batch No. (Card)', 'Tank',
  'Input', 'Origin/RM', 'Batch No.', 'Qty (kg)', 'Timestamp',
  'Supervisor', 'Manager'
];

/* B. Batch Traceability Records — one row per batch. Tank totals are
 *    per-record and repeat on each batch row of that record. */
var BO_TRACE_HEADER = [
  'Date', 'Batch No.',
  'Charge In Tank', 'Charge In Start', 'Charge In Stop',
  'High Speed Mixing Tank', 'High Speed Mixing Start', 'High Speed Mixing Stop',
  'Transfer HS to LS Tank', 'Transfer HS to LS Start', 'Transfer HS to LS Stop',
  '1st Storage Start', '1st Storage Stop',
  '2nd Storage Start', '2nd Storage Stop',
  'Finish Slurry Tank', 'Finish Slurry Start', 'Finish Slurry Stop',
  'Total Running HS-1 (6000 Lt.)', 'Total Running HS-2 (4000 Lt.)',
  'Total Running HS-3 (6000 Lt.)', 'Total Running NM (2000 Lt.)',
  'Checked By', 'Approved By'
];

/* C. Slurry Consumption Report — one row per date (a later save for the same
 *    date replaces the earlier one). */
var BO_CONSUMPTION_HEADER = [
  'Date',
  'Slurry (Solid) Opening Bal.', 'Total Weight of Batches',
  'Slurry (Solid) Closing Bal.', 'Slurry Consumed', 'Production',
  'Diff. (Consumed - Prod.)', 'Cumulative Diff.',
  'Prepared By', 'QC Lab', 'Store Dept.', 'Sanction By', 'Approved By',
  'Timestamp'
];


/* ── Batch Operator — spreadsheet access ─────────────────────────────────── */

// Opened lazily (only when a batch_op_* row arrives). Throws if the Script
// Property is missing so the row is retried / marked failed, never lost.
function boOpenSS_() {
  var id = PropertiesService.getScriptProperties()
    .getProperty('SPREADSHEET_ID_BATCH_OP');
  if (!id || String(id).trim() === '') {
    throw new Error('[BatchOp] SPREADSHEET_ID_BATCH_OP not set — '
      + 'cannot route batch_op_* record. Set the Script Property first.');
  }
  return SpreadsheetApp.openById(String(id).trim());
}


/* ── Batch Operator — One-time setup (run manually) ──────────────────────── */

/**
 * Create the three Batch Operator tabs with headers up front. Run ONCE
 * manually. Idempotent: creates a tab only if missing, writes the header only
 * if row 1 is empty.
 */
function initBatchOpTabs() {
  var ss;
  try { ss = boOpenSS_(); }
  catch (e) { Logger.log('[initBatchOpTabs] Fail-closed: ' + e.message); return; }

  Logger.log('[initBatchOpTabs] Spreadsheet: "' + ss.getName()
    + '"  url=' + ss.getUrl());

  ensureTab_(ss, BO_TAB.JOBCARD,     BO_JOBCARD_HEADER);
  ensureTab_(ss, BO_TAB.TRACE,       BO_TRACE_HEADER);
  ensureTab_(ss, BO_TAB.CONSUMPTION, BO_CONSUMPTION_HEADER);
  Logger.log('[initBatchOpTabs] Done. All three Batch Operator tabs are ready.');
}

/**
 * ONE-SHOT: WIPE and recreate the three Batch Operator tabs with the CURRENT
 * headers. Use when the layout changed (ensureHeader_ only fills a blank
 * row 1). SAFE: touches ONLY the three tabs in SPREADSHEET_ID_BATCH_OP.
 * To also stop the old records re-syncing, run in Supabase SQL:
 *   delete from thermopack_sheets_sync_outbox
 *    where record_kind like 'batch_op_%';
 */
function resetBatchOpTabsClean() {
  var ss;
  try { ss = boOpenSS_(); }
  catch (e) { Logger.log('[resetBatchOpTabsClean] Fail-closed: ' + e.message); return; }

  var specs = [
    { name: BO_TAB.JOBCARD,     header: BO_JOBCARD_HEADER },
    { name: BO_TAB.TRACE,       header: BO_TRACE_HEADER },
    { name: BO_TAB.CONSUMPTION, header: BO_CONSUMPTION_HEADER }
  ];
  for (var i = 0; i < specs.length; i++) {
    var old = ss.getSheetByName(specs[i].name);
    if (old) {
      // A spreadsheet cannot have zero sheets: rename, create new, then delete.
      old.setName(specs[i].name + ' (old ' + new Date().getTime() + ')');
      ensureTab_(ss, specs[i].name, specs[i].header);
      ss.deleteSheet(old);
    } else {
      ensureTab_(ss, specs[i].name, specs[i].header);
    }
    Logger.log('[resetBatchOpTabsClean] Wiped + recreated tab: ' + specs[i].name);
  }
  Logger.log('[resetBatchOpTabsClean] Done. All three tabs are empty with the current headers.');
}


/* ── Batch Operator — Writers ────────────────────────────────────────────── */

/* A. Process Job Card — one row per input line, then a "Batch Total" row.
 *
 * Every row of one saved job card carries a hidden key starting with
 * "<source_pk>|". Re-syncing the same job card REPLACES that contiguous block
 * in place (resized if needed), so a replay never duplicates rows. */
function boWriteJobCard_(ss, row, p) {
  var sh = ensureTab_(ss, BO_TAB.JOBCARD, BO_JOBCARD_HEADER);
  var pk = String(row.source_pk);

  var batches = Array.isArray(p.batches) ? p.batches : [];
  var inputRows = Array.isArray(p.input_rows) ? p.input_rows : [];

  var date = fmtDate_(p.date);
  var shift = valOrBlank_(p.shift);
  var operator = valOrBlank_(p.operator_name);
  var supervisor = valOrBlank_(p.supervisor);
  var manager = valOrBlank_(p.manager);

  var block = [];
  var flatIdx = 0;   // input_rows is the flat mirror of batches[].rows (same order)

  for (var b = 0; b < batches.length; b++) {
    var batch = batches[b] || {};
    var rows = Array.isArray(batch.rows) ? batch.rows : [];
    var batchNo = valOrBlank_(batch.batchNo);
    var tank = boTankLabel_(batch.tankType);
    var sum = 0;
    var batchRows = [];

    for (var r = 0; r < rows.length; r++) {
      var rw = rows[r] || {};
      var flat = inputRows[flatIdx];
      flatIdx++;
      if (flat && flat.batch_id !== undefined && String(flat.batch_id) !== String(batch.id)) {
        flat = null;   // misaligned mirror → ignore rather than mix rows up
      }

      var qtyRaw = (rw.qty !== undefined && rw.qty !== null && String(rw.qty).trim() !== '')
        ? rw.qty : (flat ? flat.qty_kg : '');
      var qty = numOrBlank_(qtyRaw);
      var input = valOrBlank_(rw.inputName);
      var origin = valOrBlank_(rw.origin);
      var rowBatchNo = valOrBlank_(rw.batchNo);

      // Skip completely empty input lines.
      if (String(input).trim() === '' && String(origin).trim() === ''
          && String(rowBatchNo).trim() === '' && qty === '') continue;

      var ts = boNormTs_(rw.timestamp || (flat ? flat.timestamp : ''));
      if (typeof qty === 'number') sum += qty;

      batchRows.push({
        key: pk + '|' + valOrBlank_(batch.id) + '|' + valOrBlank_(rw.id),
        vals: [
          date, shift, operator, batchNo, tank,
          input, origin, rowBatchNo, qty, ts,
          supervisor, manager
        ]
      });
    }

    if (batchRows.length === 0) continue;   // nothing entered for this batch card

    for (var k = 0; k < batchRows.length; k++) block.push(batchRows[k]);
    block.push({
      key: pk + '|' + valOrBlank_(batch.id) + '|TOTAL',
      vals: [
        date, shift, operator, batchNo, tank,
        'Batch Total', '', '', sum, '',
        supervisor, manager
      ]
    });
  }

  if (block.length === 0) return;   // empty job card → nothing to show

  boWriteBlock_(sh, BO_JOBCARD_HEADER, block, pk + '|');
  formatTab_(sh, BO_JOBCARD_HEADER.length);
  boStyleTotalRows_(sh, BO_JOBCARD_HEADER.length, pk + '|');
}

/* B. Batch Traceability Records — one row per batch row of the record. */
function boWriteTraceability_(ss, row, p) {
  var sh = ensureTab_(ss, BO_TAB.TRACE, BO_TRACE_HEADER);
  var pk = String(row.source_pk);
  var rows = Array.isArray(p.rows) ? p.rows : [];
  var date = fmtDate_(p.date);
  var fields = ['batch_no', 'charge_tank', 'charge_start', 'charge_stop',
    'hs_tank', 'hs_start', 'hs_stop', 'lst_tank', 'lst_start', 'lst_stop',
    's1_start', 's1_stop', 's2_start', 's2_stop',
    'finish_tank', 'finish_start', 'finish_stop'];

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i] || {};
    var hasData = false;
    for (var f = 0; f < fields.length; f++) {
      var fv = r[fields[f]];
      if (fv !== undefined && fv !== null && String(fv).trim() !== '') { hasData = true; break; }
    }
    if (!hasData) continue;

    var vals = [
      date, valOrBlank_(r.batch_no),
      boTankLabel_(r.charge_tank), boFmtHm_(r.charge_start), boFmtHm_(r.charge_stop),
      boTankLabel_(r.hs_tank),     boFmtHm_(r.hs_start),     boFmtHm_(r.hs_stop),
      boTankLabel_(r.lst_tank),    boFmtHm_(r.lst_start),    boFmtHm_(r.lst_stop),
      boFmtHm_(r.s1_start), boFmtHm_(r.s1_stop),
      boFmtHm_(r.s2_start), boFmtHm_(r.s2_stop),
      boTankLabel_(r.finish_tank), boFmtHm_(r.finish_start), boFmtHm_(r.finish_stop),
      valOrBlank_(p.total_hs1), valOrBlank_(p.total_hs2),
      valOrBlank_(p.total_hs3), valOrBlank_(p.total_nm),
      valOrBlank_(p.checked_by), valOrBlank_(p.approved_by)
    ];
    upsertByKey_(sh, BO_TRACE_HEADER, vals, pk + '|' + i);
  }
  formatTab_(sh, BO_TRACE_HEADER.length);
}

/* C. Slurry Consumption Report — one row per date (latest save wins). */
function boWriteConsumption_(ss, row, p) {
  var sh = ensureTab_(ss, BO_TAB.CONSUMPTION, BO_CONSUMPTION_HEADER);
  var rows = Array.isArray(p.rows) ? p.rows : [];

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i] || {};
    var key = r.date ? ('date|' + fmtDate_(r.date)) : (String(row.source_pk) + '|' + i);
    var vals = [
      fmtDate_(r.date),
      numOrBlank_(r.opening_bal), numOrBlank_(r.total_batches),
      numOrBlank_(r.closing_bal), numOrBlank_(r.slurry_consumed),
      numOrBlank_(r.production),
      numOrBlank_(r.diff), numOrBlank_(r.cumulative_diff),
      valOrBlank_(r.prepared_by), valOrBlank_(r.qc_lab), valOrBlank_(r.store_dept),
      valOrBlank_(r.sanction_by), valOrBlank_(r.approved_by),
      boNormTs_(r.timestamp)
    ];
    upsertByKey_(sh, BO_CONSUMPTION_HEADER, vals, key);
  }
  formatTab_(sh, BO_CONSUMPTION_HEADER.length);
}


/* ── Batch Operator — helpers ────────────────────────────────────────────── */

/* Write a contiguous block of rows [{key, vals}] for one saved job card.
 *
 * If rows whose hidden key starts with `prefix` already exist (a replay of the
 * same submission), the block is overwritten in place; surplus old rows are
 * removed and missing ones inserted, so the block stays contiguous and never
 * duplicates. Otherwise the block is appended at the end of the sheet.
 * (At least one non-frozen row always remains, so Sheets' "cannot delete all
 * non-frozen rows" rule is never hit.) */
function boWriteBlock_(sh, header, block, prefix) {
  var keyColIndex = header.length + 1;   // hidden trailing _source_pk column
  var m = block.length;
  var lastRow = sh.getLastRow();

  var first = -1, n = 0, contiguous = true, prevRow = -1;
  var existing = [];
  if (lastRow >= 2) {
    var keys = sh.getRange(2, keyColIndex, lastRow - 1, 1).getValues();
    for (var i = 0; i < keys.length; i++) {
      if (String(keys[i][0]).indexOf(prefix) === 0) {
        var rowNo = i + 2;
        existing.push(rowNo);
        if (first === -1) first = rowNo;
        else if (rowNo !== prevRow + 1) contiguous = false;
        prevRow = rowNo;
        n++;
      }
    }
  }

  var start;
  if (n === 0) {
    start = Math.max(2, lastRow + 1);
  } else if (!contiguous) {
    // Rows were re-ordered by hand: blank the old copies and append fresh ones.
    for (var e = 0; e < existing.length; e++) {
      sh.getRange(existing[e], 1, 1, keyColIndex).clearContent();
    }
    start = Math.max(2, sh.getLastRow() + 1);
  } else {
    start = first;
    if (m > n) sh.insertRowsAfter(first + n - 1, m - n);
    else if (m < n) sh.deleteRows(first + m, n - m);
  }

  var values = [];
  for (var j = 0; j < m; j++) {
    var full = block[j].vals.slice();
    full.push(block[j].key);
    values.push(full);
  }
  sh.getRange(start, 1, m, keyColIndex).setValues(values);
}

// Bold + light fill on every "…|TOTAL" row of this job card; normal on the rest.
function boStyleTotalRows_(sh, visibleCols, prefix) {
  try {
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return;
    var keys = sh.getRange(2, visibleCols + 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < keys.length; i++) {
      var k = String(keys[i][0]);
      if (k.indexOf(prefix) !== 0) continue;
      var rng = sh.getRange(i + 2, 1, 1, visibleCols);
      if (/\|TOTAL$/.test(k)) {
        rng.setFontWeight('bold').setBackground('#fff2cc');
      } else {
        rng.setFontWeight('normal').setBackground(null);
      }
    }
  } catch (e) { /* cosmetic — never fail a sync write */ }
}

function boTankLabel_(v) {
  if (v === undefined || v === null || String(v).trim() === '') return '';
  return BO_TANK_LABELS[String(v)] || String(v);
}

// Normalise a website-captured time to hh:mm:ss AM/PM (hh:mm AM/PM when the
// site stored no seconds). "02:30:15 pm" is upper-cased/padded; ISO timestamps
// are rendered in IST. Blank in → blank out; unrecognised values are shown
// as-is. NEVER substitutes the current (upload) time.
function boNormTs_(v) {
  if (v === undefined || v === null) return '';
  var s = String(v).trim();
  if (s === '') return '';
  var m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp])\.?[Mm]\.?$/.exec(s);
  if (m) {
    var hh = ('0' + m[1]).slice(-2);
    return hh + ':' + m[2] + (m[3] ? ':' + m[3] : '') + ' ' + m[4].toUpperCase() + 'M';
  }
  if (/\d{4}-\d{2}-\d{2}T/.test(s)) {
    var t = fmtTs_(s);
    if (t) return t.toUpperCase();
  }
  return s;
}

// Stored 24-hour "HH:mm" → "hh:mm AM/PM". Blank stays blank.
function boFmtHm_(v) {
  if (v === undefined || v === null || String(v).trim() === '') return '';
  var m = /^(\d{1,2}):(\d{2})$/.exec(String(v).trim());
  if (!m) return String(v);
  var h = parseInt(m[1], 10);
  if (isNaN(h) || h < 0 || h > 23) return String(v);
  var mer = h >= 12 ? 'PM' : 'AM';
  var h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return ('0' + h12).slice(-2) + ':' + m[2] + ' ' + mer;
}
/* ── END BATCH OPERATOR SECTION ─────────────────────────────────────────── */
