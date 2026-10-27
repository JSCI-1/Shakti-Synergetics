/**
 * Unit test — Dryer hourly history-aware cell renderers (FEAT-003).
 *
 * Run:  node supabase/google_sheets/apps-script/dryer_cell_history.test.mjs
 *
 * Covers the two renderers added to Code.gs — dryerCellWithHistory_ (scalar
 * fields) and dryerMaintCellWithHistory_ (the maintenance object field) — that
 * rebuild ONE stacked cell newest-first from the payload's hist[] arrays
 * (produced by FEAT-002), so an edited field shows its current value + edit
 * time on top and "Previous: <v> / <ts>" lines beneath, deterministically and
 * replay-safe.
 *
 * No framework — plain assertions, exits non-zero on failure.
 *
 * Like the other harnesses here, this MIRRORS the Apps Script logic rather than
 * importing Code.gs (Code.gs is not an ES module and depends on Google-side
 * globals like Utilities/Session). The renderer bodies below are copied
 * verbatim from Code.gs; renderFieldTs_ is replaced by a minimal, timezone-
 * independent IST stub that extracts the wall-clock HH:MM:SS directly from the
 * ISO string so the assertions are deterministic on any machine.
 *
 * -- Isolated-environment Sheets checks (N1 -- NOT runnable by the build) --
 * These renderers only decide the cell TEXT; the end-to-end sheet behaviour is
 * a manual check against a NON-production Spreadsheet (FEAT-004 checklist),
 * mapped to the feature's Acceptance Tests:
 *   . AT2 -- an edit rewrites only the changed cells IN PLACE (match by
 *     H|date|shift|hour, single setValues), no appended/duplicate row.
 *   . AT3 -- Previous lines stack newest-first; the original value/time is
 *     preserved permanently at the bottom.
 *   . AT4 -- a replay of the same event produces identical cell content (no
 *     duplicated Previous lines) -- guarded here by the determinism assertions.
 *   . AT6 -- timestamps are the field's own IST edit time (renderFieldTs_),
 *     never the Apps Script execution time; QC + "... - Form" tabs untouched.
 */

/* -- Mirrored constants from Code.gs -- */
const FG_SIEVE_LINE_SEP = '\n';
const DRYER_MAINT_LABELS = [
  ['shifter_screen', 'Shifter-Screen Cleaning'],
  ['atomizer_water', 'Running the Atomizer on Water'],
];

/* -- Mirrored helpers from Code.gs -- */
function coalesce_(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

/**
 * Minimal, deterministic IST stub for renderFieldTs_('qc_fg', iso).
 * Code.gs formats the ISO in Asia/Kolkata as "hh:mm:ss a". To stay machine- and
 * timezone-independent, the test payloads use ISO strings whose wall-clock time
 * is ALREADY the IST value we expect to see; this stub just reformats that
 * HH:MM:SS into "hh:mm:ss AM/PM" without any timezone shift. Non-dates pass
 * through unchanged, matching the real function.
 */
function renderFieldTs_(_kind, v) {
  if (v === null || v === undefined || v === '') return '';
  const m = String(v).match(/T(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return String(v);
  let hh = parseInt(m[1], 10);
  const mm = m[2];
  const ss = m[3];
  const ampm = hh >= 12 ? 'PM' : 'AM';
  let h12 = hh % 12;
  if (h12 === 0) h12 = 12;
  const pad = (n) => (n < 10 ? '0' : '') + n;
  return pad(h12) + ':' + mm + ':' + ss + ' ' + ampm;
}

// Copied verbatim from Code.gs renderDryerMaintenance_.
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
      lines.push(label + '  \u2014  ' + renderFieldTs_('qc_fg', iso));
    }
  }
  return lines.join('\n');
}

// Copied verbatim from Code.gs dryerCellWithTs_.
function dryerCellWithTs_(value, iso) {
  var v = coalesce_(value);
  var t = (iso && String(iso) !== '') ? renderFieldTs_('qc_fg', iso) : '';
  if (v === '' && t === '') return '';
  return t ? (v + '\n' + t) : v;
}

// Copied verbatim from Code.gs dryerCellWithHistory_.
function dryerCellWithHistory_(hist) {
  var cur = hist[hist.length - 1];
  var lines = [];
  lines.push(coalesce_(cur.v));
  lines.push(renderFieldTs_('qc_fg', cur.ts));
  for (var i = hist.length - 2; i >= 0; i--) {
    lines.push('Previous: ' + coalesce_(hist[i].v) + ' / ' + renderFieldTs_('qc_fg', hist[i].ts));
  }
  return lines.join(FG_SIEVE_LINE_SEP);
}

// Copied verbatim from Code.gs dryerMaintCellWithHistory_.
function dryerMaintCellWithHistory_(hist) {
  var cur = hist[hist.length - 1];
  var lines = [];
  var curRendered = renderDryerMaintenance_(cur.v);
  if (curRendered !== '') lines.push(curRendered);
  for (var i = hist.length - 2; i >= 0; i--) {
    var prior = renderDryerMaintenance_(hist[i].v);
    if (prior === '') {
      lines.push('Previous: (none)');
    } else {
      lines.push('Previous: ' + prior.split('\n').join(' ; '));
    }
  }
  return lines.join(FG_SIEVE_LINE_SEP);
}

/* -- Mirror of the writeDryerHourRow_ per-field branch (ordering under test) --
 * This is the LOAD-BEARING design 3.2 rule: the hist presence test runs BEFORE
 * the vals non-empty test, so a cleared-but-edited field is rewritten from
 * history rather than being left stale. Defensive fallback: a hist entry that
 * is present but not a non-empty array falls through to the single-value path.
 */
function renderScalarField(fk, vals, ts, hist) {
  if (hist[fk] && Array.isArray(hist[fk]) && hist[fk].length) {
    return dryerCellWithHistory_(hist[fk]);
  } else if (vals[fk] !== undefined && vals[fk] !== null && String(vals[fk]) !== '') {
    return dryerCellWithTs_(vals[fk], ts[fk]);
  }
  return undefined; // leave the cell untouched (unchanged cell -- C3)
}

/* -- Harness -- */
let failures = 0;
function assert(label, cond) {
  if (cond) {
    console.log('  \u2713 ' + label);
  } else {
    console.error('  \u2717 FAIL: ' + label);
    failures++;
  }
}
function assertEq(label, actual, expected) {
  if (actual === expected) {
    console.log('  \u2713 ' + label);
  } else {
    console.error('  \u2717 FAIL: ' + label);
    console.error('      expected: ' + JSON.stringify(expected));
    console.error('      actual:   ' + JSON.stringify(actual));
    failures++;
  }
}

console.log('Dryer cell history renderer tests');

/* 1. Newest-first three-edit ordering (design 3.3 worked example). */
const threeEdits = [
  { v: '180', ts: '2026-10-22T08:05:10' },
  { v: '185', ts: '2026-10-22T09:20:15' },
  { v: '190', ts: '2026-10-22T10:15:30' },
];
const expectedThree =
  '190\n10:15:30 AM\n' +
  'Previous: 185 / 09:20:15 AM\n' +
  'Previous: 180 / 08:05:10 AM';
assertEq('three-edit scalar renders newest-first', dryerCellWithHistory_(threeEdits), expectedThree);

/* 2. Determinism / replay -- same hist always yields the same string. */
assert('scalar renderer is deterministic (replay-safe)',
  dryerCellWithHistory_(threeEdits) === dryerCellWithHistory_(threeEdits));
// A replay must not duplicate Previous lines: exactly two "Previous:" lines.
assertEq('three-edit cell has exactly 2 Previous lines',
  (dryerCellWithHistory_(threeEdits).match(/Previous:/g) || []).length, 2);

/* 3. Cleared current value: blank top line + its edit time + a Previous line. */
const clearedEdits = [
  { v: '180', ts: '2026-10-22T08:05:10' },
  { v: '', ts: '2026-10-22T11:45:00' },
];
assertEq('cleared field -> blank top line + edit time + Previous',
  dryerCellWithHistory_(clearedEdits),
  '\n11:45:00 AM\nPrevious: 180 / 08:05:10 AM');

/* 4. Single edit renders value + time, no Previous lines. */
assertEq('single-entry scalar -> value + time only',
  dryerCellWithHistory_([{ v: '42', ts: '2026-10-22T14:30:00' }]),
  '42\n02:30:00 PM');

/* 5. Maintenance: multi-line current + collapsed Previous lines, per-option IST. */
const maintEdits = [
  { v: { shifter_screen: '2026-10-22T08:10:00', atomizer_water: '' }, ts: '2026-10-22T08:10:00' },
  {
    v: { shifter_screen: '2026-10-22T09:30:00', atomizer_water: '2026-10-22T09:30:05' },
    ts: '2026-10-22T09:30:05',
  },
];
const expectedMaint =
  'Shifter-Screen Cleaning  \u2014  09:30:00 AM\n' +
  'Running the Atomizer on Water  \u2014  09:30:05 AM\n' +
  'Previous: Shifter-Screen Cleaning  \u2014  08:10:00 AM';
assertEq('maintenance current multi-line + collapsed Previous line',
  dryerMaintCellWithHistory_(maintEdits), expectedMaint);
assert('maintenance renderer is deterministic (replay-safe)',
  dryerMaintCellWithHistory_(maintEdits) === dryerMaintCellWithHistory_(maintEdits));

/* 6. Maintenance prior all-deselected -> literal "Previous: (none)". */
const maintCleared = [
  { v: { shifter_screen: '', atomizer_water: '' }, ts: '2026-10-22T07:00:00' },
  { v: { shifter_screen: '2026-10-22T10:00:00', atomizer_water: '' }, ts: '2026-10-22T10:00:00' },
];
assertEq('maintenance prior all-deselected -> Previous: (none)',
  dryerMaintCellWithHistory_(maintCleared),
  'Shifter-Screen Cleaning  \u2014  10:00:00 AM\nPrevious: (none)');

/* 7. Maintenance current all-deselected -> no current line, only Previous. */
const maintClearedNow = [
  { v: { shifter_screen: '2026-10-22T10:00:00', atomizer_water: '' }, ts: '2026-10-22T10:00:00' },
  { v: { shifter_screen: '', atomizer_water: '' }, ts: '2026-10-22T12:00:00' },
];
assertEq('maintenance current all-deselected -> only Previous line',
  dryerMaintCellWithHistory_(maintClearedNow),
  'Previous: Shifter-Screen Cleaning  \u2014  10:00:00 AM');

/* 8. writeDryerHourRow_ ordering: hist present -> history path wins over vals. */
assertEq('hist present -> history renderer used (not single-value)',
  renderScalarField('temp_inlet', { temp_inlet: '999' }, { temp_inlet: '2026-10-22T20:00:00' },
    { temp_inlet: threeEdits }),
  expectedThree);

/* 8b. Cleared-but-edited field: vals empty but hist present -> rewritten. */
assertEq('cleared-but-edited field rewritten from history (not left stale)',
  renderScalarField('temp_inlet', { temp_inlet: '' }, {}, { temp_inlet: clearedEdits }),
  '\n11:45:00 AM\nPrevious: 180 / 08:05:10 AM');

/* 9. Fallback: hist absent -> single-value dryerCellWithTs_ path. */
assertEq('hist absent -> falls back to dryerCellWithTs_',
  renderScalarField('temp_inlet', { temp_inlet: '55' }, { temp_inlet: '2026-10-22T13:15:00' }, {}),
  '55\n01:15:00 PM');

/* 9b. Defensive fallback: hist present but not a non-empty array -> single-value. */
assertEq('hist present but empty array -> falls back to dryerCellWithTs_',
  renderScalarField('temp_inlet', { temp_inlet: '55' }, { temp_inlet: '2026-10-22T13:15:00' },
    { temp_inlet: [] }),
  '55\n01:15:00 PM');
assertEq('hist present but non-array -> falls back to dryerCellWithTs_',
  renderScalarField('temp_inlet', { temp_inlet: '55' }, { temp_inlet: '2026-10-22T13:15:00' },
    { temp_inlet: 'oops' }),
  '55\n01:15:00 PM');

/* 9c. Neither hist nor vals -> cell left untouched (undefined). */
assert('no hist, no value -> cell untouched (undefined)',
  renderScalarField('temp_inlet', {}, {}, {}) === undefined);

if (failures > 0) {
  console.error('\n' + failures + ' assertion(s) failed.');
  process.exit(1);
}
console.log('\nAll dryer cell history renderer tests passed.');
