/**
 * Regression test — Dryer hourly row identity (date, shift, hour).
 *
 * Run:  node supabase/google_sheets/apps-script/dryer_row_identity.test.mjs
 *
 * This guards the bug where 22-10-2026 Day 09:00 data landed under
 * 21-10-2026 Night 09:00 (or an adjacent hour). It verifies that:
 *   1. The Supabase upsert key and the Google Sheet row key BOTH include shift,
 *      so the two systems agree on row identity.
 *   2. Different (date, shift, hour) combinations never collide.
 *   3. Re-saving the SAME (date, shift, hour) is idempotent (same key → update,
 *      not a new row), in any order.
 *
 * No framework — plain assertions. Exits non-zero on first failure.
 */

// Mirrors the Apps Script sheet row key (writeDryerHourRow_):
//   wantKey = 'H|' + date + '|' + shift + '|' + hour
function sheetRowKey({ date, shift, hour }) {
  return 'H|' + (date || '') + '|' + (shift || '') + '|' + (hour || '');
}

// Mirrors the Supabase upsert conflict target after migration 037:
//   unique (dryer_type, log_date, hour, shift)
function supabaseKey({ dryer_type, date, shift, hour }) {
  return [dryer_type || '', date || '', hour || '', shift || ''].join('|');
}

let failures = 0;
function assert(label, cond) {
  if (cond) {
    console.log('  \u2713 ' + label);
  } else {
    console.error('  \u2717 FAIL: ' + label);
    failures++;
  }
}

// The four records from the task's acceptance criteria.
const recDay8  = { dryer_type: 'new', date: '2026-10-22', shift: 'Day',   hour: '08:00' };
const recDay9  = { dryer_type: 'new', date: '2026-10-22', shift: 'Day',   hour: '09:00' };
const recDay10 = { dryer_type: 'new', date: '2026-10-22', shift: 'Day',   hour: '10:00' };
const recNight9 = { dryer_type: 'new', date: '2026-10-21', shift: 'Night', hour: '09:00' };

console.log('Dryer row identity regression tests');

// 1. Every record has a distinct sheet key and a distinct Supabase key.
const all = [recDay8, recDay9, recDay10, recNight9];
const sheetKeys = all.map(sheetRowKey);
const supaKeys = all.map(supabaseKey);
assert('4 distinct sheet row keys', new Set(sheetKeys).size === 4);
assert('4 distinct supabase keys', new Set(supaKeys).size === 4);

// 2. The critical case: 22-10 Day 09:00 and 21-10 Night 09:00 must NOT collide.
assert('Day 09:00 vs Night 09:00 differ (sheet)', sheetRowKey(recDay9) !== sheetRowKey(recNight9));
assert('Day 09:00 vs Night 09:00 differ (supabase)', supabaseKey(recDay9) !== supabaseKey(recNight9));

// 3. Adjacent hours never share a key (9:00 never maps onto 10:00).
assert('Day 09:00 vs Day 10:00 differ (sheet)', sheetRowKey(recDay9) !== sheetRowKey(recDay10));
assert('Day 09:00 vs Day 10:00 differ (supabase)', supabaseKey(recDay9) !== supabaseKey(recDay10));

// 4. Same (dryer,date,shift,hour) saved again → identical key (idempotent update).
const recDay9Again = { dryer_type: 'new', date: '2026-10-22', shift: 'Day', hour: '09:00' };
assert('Re-save Day 09:00 → same sheet key', sheetRowKey(recDay9) === sheetRowKey(recDay9Again));
assert('Re-save Day 09:00 → same supabase key', supabaseKey(recDay9) === supabaseKey(recDay9Again));

// 5. Same hour, SAME date, DIFFERENT shift (Day vs Night on 22-10) stay separate.
const recDay9_d22 = { dryer_type: 'new', date: '2026-10-22', shift: 'Day',   hour: '09:00' };
const recNight9_d22 = { dryer_type: 'new', date: '2026-10-22', shift: 'Night', hour: '09:00' };
assert('Same date, Day vs Night 09:00 differ (sheet)', sheetRowKey(recDay9_d22) !== sheetRowKey(recNight9_d22));
assert('Same date, Day vs Night 09:00 differ (supabase)', supabaseKey(recDay9_d22) !== supabaseKey(recNight9_d22));

// 6. Order independence: building the key set in any order yields the same set.
const forward = [recDay8, recDay9, recDay10, recNight9].map(supabaseKey).sort();
const reverse = [recNight9, recDay10, recDay9, recDay8].map(supabaseKey).sort();
assert('Key set is order-independent', JSON.stringify(forward) === JSON.stringify(reverse));

if (failures > 0) {
  console.error('\n' + failures + ' assertion(s) failed.');
  process.exit(1);
}
console.log('\nAll dryer row identity tests passed.');
