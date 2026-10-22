/**
 * Regression test — Dryer form normalization (crash prevention).
 *
 * Run:  node supabase/google_sheets/apps-script/dryer_form_normalize.test.mjs
 *
 * Guards the "Dryer Operator could not load" crash: a stale/partial draft
 * restored from localStorage (short rows array, missing nested fields) used to
 * throw when the hourly render indexed form.rows[i].saved/.colour/.timestamp.
 * normalizeForm() must ALWAYS return exactly 24 well-formed rows so the render
 * can never throw, while preserving any entered values.
 *
 * This mirrors the normalizeForm/emptyForm/emptyRow logic in
 * src/components/DryerSection.jsx (kept in sync by shape, not imported, because
 * the component is JSX and pulls in React/CSS).
 */

const TIME_SLOTS = [
  '08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00',
  '16:00','17:00','18:00','19:00','20:00','21:00','22:00','23:00',
  '00:00','01:00','02:00','03:00','04:00','05:00','06:00','07:00',
];

function emptyRow() {
  return {
    temp_inlet: '', temp_outlet: '', temp_actual: '', temp_fbd1: '',
    temp_fbd2: '', temp_chamber: '', atomizer_freq: '', feed_fc: '',
    c_pressure: '', pressure: '', pt_temp: '', batch_no: '', bags_per_hr: '',
    bag_size_wt: '', kg_per_hr: '', colour: '', id_frequency: '', remarks: '',
    operator_name: '', maintenance: { shifter_screen: '', atomizer_water: '' },
    timestamp: '', saved: false, __ts: {},
  };
}

function emptyForm(dryerType) {
  return {
    dryer_type: dryerType, date: '', shift: '',
    id_blower_dp: '', id_blower_mr: '', fd_blower_dp: '', fd_blower_mr: '',
    ifbd_dp: '', ifbd_mr: '', fbd_pct_dp: '', fbd_pct_mr: '',
    batch_no: '', calibration_due: '',
    cal_inlet_temp: '', cal_inlet_sensor: '', cal_outlet_temp: '', cal_outlet_sensor: '',
    cal_ifbd_temp: '', cal_ifbd_sensor: '', cal_fbd_temp: '', cal_fbd_sensor: '',
    cal_chamber_temp: '', cal_chamber_sensor: '',
    fine_powder: '', crust_papadi: '', startup: '', packed_production: '',
    total_production: '', incharge: '', operator: '',
    rows: TIME_SLOTS.map(() => emptyRow()), __ts: {},
  };
}

function normalizeForm(raw, dryerType) {
  const base = emptyForm(dryerType);
  if (!raw || typeof raw !== 'object') return base;
  const merged = { ...base, ...raw, dryer_type: raw.dryer_type || dryerType };
  merged.__ts = (raw.__ts && typeof raw.__ts === 'object' && !Array.isArray(raw.__ts)) ? raw.__ts : {};
  const rawRows = Array.isArray(raw.rows) ? raw.rows : [];
  merged.rows = TIME_SLOTS.map((_, i) => {
    const r = rawRows[i];
    const row = (r && typeof r === 'object' && !Array.isArray(r)) ? { ...emptyRow(), ...r } : emptyRow();
    row.maintenance = (row.maintenance && typeof row.maintenance === 'object' && !Array.isArray(row.maintenance))
      ? { shifter_screen: '', atomizer_water: '', ...row.maintenance }
      : { shifter_screen: '', atomizer_water: '' };
    row.__ts = (row.__ts && typeof row.__ts === 'object' && !Array.isArray(row.__ts)) ? row.__ts : {};
    return row;
  });
  return merged;
}

// Simulates the hourly render's per-row field access. Throws if any row is bad.
function renderProbe(form) {
  for (let i = 0; i < TIME_SLOTS.length; i++) {
    const r = form.rows[i];
    void r.saved; void r.colour; void r.operator_name;
    void r.timestamp; void (r.maintenance || {}).shifter_screen;
  }
  return true;
}

let failures = 0;
function assert(label, cond) {
  if (cond) console.log('  \u2713 ' + label);
  else { console.error('  \u2717 FAIL: ' + label); failures++; }
}

console.log('Dryer form normalization regression tests');

// 1. null / undefined / non-object drafts → full valid form, render never throws.
[null, undefined, 42, 'oops', []].forEach((bad, n) => {
  const f = normalizeForm(bad, 'new');
  assert('garbage draft #' + n + ' → 24 rows', f.rows.length === 24);
  assert('garbage draft #' + n + ' → render safe', renderProbe(f) === true);
});

// 2. Short rows array (the real crash: fewer than 24 rows) → padded to 24.
const shortDraft = { dryer_type: 'new', date: '2026-10-22', shift: 'Day',
  rows: [ { colour: 'OMRI', saved: true }, { colour: 'Normal' } ] };
const f2 = normalizeForm(shortDraft, 'new');
assert('short rows → padded to 24', f2.rows.length === 24);
assert('short rows → render safe', renderProbe(f2) === true);
assert('short rows → entered value preserved (row0 colour)', f2.rows[0].colour === 'OMRI');
assert('short rows → entered flag preserved (row0 saved)', f2.rows[0].saved === true);
assert('short rows → padded row has maintenance object', typeof f2.rows[5].maintenance === 'object');
assert('short rows → padded row timestamp is empty string', f2.rows[5].timestamp === '');

// 3. Rows present but missing nested fields → filled, values kept.
const missingNested = { dryer_type: 'old',
  rows: TIME_SLOTS.map((_, i) => (i === 3 ? { colour: 'Colour' } : null)) };
const f3 = normalizeForm(missingNested, 'old');
assert('missing-nested → 24 rows', f3.rows.length === 24);
assert('missing-nested → render safe', renderProbe(f3) === true);
assert('missing-nested → row3 colour kept', f3.rows[3].colour === 'Colour');
assert('missing-nested → row3 maintenance repaired', f3.rows[3].maintenance.shifter_screen === '');
assert('missing-nested → null row replaced with emptyRow', f3.rows[0].saved === false);

// 4. Top-level fields preserved; dryer_type defaulted when absent.
const f4 = normalizeForm({ date: '2026-10-22', shift: 'Night', batch_no: '684' }, 'new');
assert('top-level date preserved', f4.date === '2026-10-22');
assert('top-level shift preserved', f4.shift === 'Night');
assert('top-level batch preserved', f4.batch_no === '684');
assert('dryer_type defaulted', f4.dryer_type === 'new');

// 5. A valid full form is unchanged in shape (idempotent).
const valid = emptyForm('new'); valid.rows[0].colour = 'OMRI';
const f5 = normalizeForm(valid, 'new');
assert('valid form stays 24 rows', f5.rows.length === 24);
assert('valid form value kept', f5.rows[0].colour === 'OMRI');
assert('valid form render safe', renderProbe(f5) === true);

if (failures > 0) { console.error('\n' + failures + ' assertion(s) failed.'); process.exit(1); }
console.log('\nAll dryer form normalization tests passed.');
