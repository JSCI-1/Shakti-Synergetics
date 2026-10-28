/**
 * Unit tests — Finished Goods grade-specific tab routing + layout (pure logic).
 *
 * Run:  node supabase/google_sheets/apps-script/test/fg-grade-routing.test.mjs
 *
 * ISOLATION: this harness NEVER touches Google. It loads Code.gs as text,
 * evaluates it in a sandbox where the Apps Script globals (PropertiesService,
 * Logger, SpreadsheetApp, ScriptApp, UrlFetchApp) are stubbed, and then exercises
 * only the PURE functions that decide routing + layout:
 *   FG_GRADE_TABS, fgNormalizeGrade_, fgTabForGrade_, fgFieldsForGrade_,
 *   buildQcLayout_, fgBizKey_.
 * No SpreadsheetApp method is ever called by these functions, so no real or test
 * spreadsheet is ever opened. The FG_GRADE_ROUTING kill-switch is driven through
 * the stubbed PropertiesService.
 *
 * Covers the approved spec's acceptance criteria:
 *   - all 13 grades route to their exact tab (adama → 'FG - ADAMA')
 *   - blank grade → 'FG - Normal' (blank normalizes to 'normal', matching
 *     fgBizKey_); unknown grade → original 'Finished Goods' (fallback)
 *   - FG_GRADE_ROUTING='off' → original 'Finished Goods' for every grade
 *   - Normal & Colour carry ONLY core WDG, NONE of the company/UPL params
 *   - each company grade includes its own rows and excludes its hidden cards
 *   - every grade layout keeps the Grade column
 *   - buildQcLayout_('qc_fg') with NO grade === the current global FG layout
 *   - fgBizKey_ unchanged; grade/batch/date/product/dryer kept distinct so
 *     same-key events map to one row (idempotent) and grades never collide
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const __dirname = dirname(fileURLToPath(import.meta.url))
const codePath = join(__dirname, '..', 'Code.gs')
const src = readFileSync(codePath, 'utf8')

// ── Stub the Apps Script globals the file references at load/call time ───────
let scriptProps = {}   // mutable; drives the FG_GRADE_ROUTING kill-switch
const sandbox = {
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: (k) => (k in scriptProps ? scriptProps[k] : null),
      setProperty: (k, v) => { scriptProps[k] = String(v) },
      deleteProperty: (k) => { delete scriptProps[k] },
    }),
  },
  Logger: { log: () => {} },
  // These must EXIST (the file defines functions referencing them) but the pure
  // functions under test never call them. Any accidental call throws loudly.
  SpreadsheetApp: new Proxy({}, { get() { throw new Error('SpreadsheetApp must not be called by pure routing/layout logic') } }),
  ScriptApp: new Proxy({}, { get() { throw new Error('ScriptApp must not be called') } }),
  UrlFetchApp: new Proxy({}, { get() { throw new Error('UrlFetchApp must not be called') } }),
  console,
}
sandbox.globalThis = sandbox
vm.createContext(sandbox)
// Evaluate Code.gs, then surface the symbols we test onto the context.
vm.runInContext(
  src +
    '\n;globalThis.__exports = {' +
    'FG_GRADE_TABS, FG_ORIGINAL_TAB, QC_FIELDS_FG,' +
    'fgNormalizeGrade_, fgTabForGrade_, fgFieldsForGrade_, buildQcLayout_, fgBizKey_' +
    '};',
  sandbox
)
const X = sandbox.__exports

let failures = 0
function assert(label, cond) {
  if (cond) console.log('  \u2713 ' + label)
  else { console.error('  \u2717 FAIL: ' + label); failures++ }
}
function eq(label, got, want) {
  assert(label + ' (got: ' + JSON.stringify(got) + ')', got === want)
}

console.log('FG grade-specific tab routing + layout tests')

// ── 1. All 13 grades route to the exact expected tab ─────────────────────────
console.log('\n[1] grade → tab routing (routing ON)')
scriptProps = {}
const EXPECT = {
  normal: 'FG - Normal', colour: 'FG - Colour', omri: 'FG - UPL OMRI',
  export: 'FG - UPL Export', adama: 'FG - ADAMA', lohiya: 'FG - Lohiya',
  biostadt: 'FG - Biostadt', sumitomo: 'FG - SUMITOMO', hemani_v: 'FG - Hemani Unit V',
  sanaca: 'FG - Sanaca Dubai', villacrop: 'FG - Villa Crop',
  yellowstone: 'FG - Yellowstone', iffco: 'FG - IFFCO',
}
eq('exactly 13 grades configured', Object.keys(EXPECT).length, 13)
for (const g of Object.keys(EXPECT)) eq('route ' + g, X.fgTabForGrade_(g), EXPECT[g])
// ADAMA specifically — correct spelling in tab, key stays 'adama'
eq("adama → 'FG - ADAMA' (correct spelling)", X.fgTabForGrade_('adama'), 'FG - ADAMA')
assert("no 'FG - ADMA' misspelling anywhere in the tab map",
  Object.values(X.FG_GRADE_TABS).indexOf('FG - ADMA') === -1)
// case/whitespace normalized exactly like fgBizKey_
eq('ADAMA (upper) normalizes to adama tab', X.fgTabForGrade_('ADAMA'), 'FG - ADAMA')
eq('"  Omri " (spaces/case) → UPL OMRI tab', X.fgTabForGrade_('  Omri '), 'FG - UPL OMRI')

// ── 2. Blank + unknown fallback ──────────────────────────────────────────────
console.log('\n[2] blank + unknown grade fallback')
eq('blank → FG - Normal (blank normalizes to normal)', X.fgTabForGrade_(''), 'FG - Normal')
eq('null → FG - Normal', X.fgTabForGrade_(null), 'FG - Normal')
eq('undefined → FG - Normal', X.fgTabForGrade_(undefined), 'FG - Normal')
eq('unknown grade → original Finished Goods', X.fgTabForGrade_('mystery_co'), 'Finished Goods')
eq('original tab constant', X.FG_ORIGINAL_TAB, 'Finished Goods')

// ── 3. FG_GRADE_ROUTING kill-switch → original tab for every grade ───────────
console.log('\n[3] FG_GRADE_ROUTING=off kill-switch')
scriptProps = { FG_GRADE_ROUTING: 'off' }
for (const g of Object.keys(EXPECT)) eq('off: ' + g + ' → Finished Goods', X.fgTabForGrade_(g), 'Finished Goods')
eq('off: blank → Finished Goods', X.fgTabForGrade_(''), 'Finished Goods')
scriptProps = {}   // restore ON

// ── 4. Normal & Colour = core WDG only, NO company/UPL params ────────────────
console.log('\n[4] Normal & Colour catalogs')
const COMPANY_UPL_PREFIXES = ['upl_exp_', 'upl_omri_', 'adama_', 'lohiya_', 'biostadt_',
  'sumitomo_', 'hemani_', 'sanaca_', 'villacrop_', 'yellowstone_', 'iffco_']
function hasAnyPrefix(keys, prefixes) {
  return keys.some(k => prefixes.some(p => k.indexOf(p) === 0))
}
for (const g of ['normal', 'colour']) {
  const keys = X.fgFieldsForGrade_(g).map(f => f[0])
  assert(g + ': contains core WDG (fg_sulphur, fg_moisture, fg_drySieve)',
    keys.includes('fg_sulphur') && keys.includes('fg_moisture') && keys.includes('fg_drySieve'))
  assert(g + ': contains NO company/UPL params', !hasAnyPrefix(keys, COMPANY_UPL_PREFIXES))
}
// Normal and Colour must have IDENTICAL catalogs (Colour is not a company grade)
assert('Normal and Colour catalogs are identical',
  JSON.stringify(X.fgFieldsForGrade_('normal')) === JSON.stringify(X.fgFieldsForGrade_('colour')))

// ── 5. Company grades: own rows present, hidden cards absent ─────────────────
console.log('\n[5] company-grade catalogs (own rows in, hidden cards out)')
function keysFor(g) { return X.fgFieldsForGrade_(g).map(f => f[0]) }
// adama family hides fg_ph/fg_wettability/fg_drySieve/fg_moisture/fg_bulk, adds adama_*
{
  const k = keysFor('adama')
  // ADAMA grade key is 'adama' but its row ids are legacy 'adma_*' (uplData.js).
  assert('adama: includes adma_ph, adma_drop_test (legacy adma_* ids)', k.includes('adma_ph') && k.includes('adma_drop_test'))
  assert('adama: excludes hidden fg_ph / fg_wettability / fg_drySieve / fg_moisture / fg_bulk',
    !k.includes('fg_ph') && !k.includes('fg_wettability') && !k.includes('fg_drySieve') &&
    !k.includes('fg_moisture') && !k.includes('fg_bulk'))
  assert('adama: hidden card INPUT keys also removed (fg_bulk__mass, fg_drySieve__M)',
    !k.includes('fg_bulk__mass') && !k.includes('fg_drySieve__M'))
  assert('adama: keeps visible Sulphur card inputs (fg_sulphur__N) + result (fg_sulphur)',
    k.includes('fg_sulphur__N') && k.includes('fg_sulphur'))
}
// export hides only fg_drySieve, keeps fg_wetSieve, adds upl_exp_*
{
  const k = keysFor('export')
  assert('export: includes upl_exp_ps_10 + upl_exp_appearance', k.includes('upl_exp_ps_10') && k.includes('upl_exp_appearance'))
  assert('export: excludes fg_drySieve (hidden) but keeps fg_wetSieve', !k.includes('fg_drySieve') && k.includes('fg_wetSieve'))
  assert('export: has NO omri/company params', !hasAnyPrefix(k, ['upl_omri_', 'adama_', 'sanaca_']))
}
// omri hides fg_ph/fg_wettability, adds upl_omri_* incl water_kf
{
  const k = keysFor('omri')
  assert('omri: includes upl_omri_water_kf + upl_omri_ds_500', k.includes('upl_omri_water_kf') && k.includes('upl_omri_ds_500'))
  assert('omri: excludes fg_ph / fg_wettability (hidden)', !k.includes('fg_ph') && !k.includes('fg_wettability'))
  assert('omri: keeps fg_drySieve + fg_wetSieve (visible for omri)', k.includes('fg_drySieve') && k.includes('fg_wetSieve'))
}
// sanaca family keeps fg_bulk (bulk mirrored), has arsenic row, hides moisture
{
  const k = keysFor('sanaca')
  assert('sanaca: includes sanaca_arsenic + sanaca_suspensibility', k.includes('sanaca_arsenic') && k.includes('sanaca_suspensibility'))
  assert('sanaca: excludes hidden fg_ph/fg_wettability/fg_drySieve/fg_moisture',
    !k.includes('fg_ph') && !k.includes('fg_wettability') && !k.includes('fg_drySieve') && !k.includes('fg_moisture'))
  assert('sanaca: KEEPS fg_bulk inputs (not hidden for sanaca family)', k.includes('fg_bulk__mass') && k.includes('fg_bulk'))
}
// iffco is adama-family shaped with iffco_* ids
{
  const k = keysFor('iffco')
  assert('iffco: includes iffco_sulphur + iffco_drop_test', k.includes('iffco_sulphur') && k.includes('iffco_drop_test'))
  assert('iffco: excludes fg_bulk (hidden)', !k.includes('fg_bulk'))
}
// Different grades never share company param namespaces
assert('adama and lohiya catalogs are different (own ids)',
  JSON.stringify(keysFor('adama')) !== JSON.stringify(keysFor('lohiya')))

// ── 6. Grade column present in every grade layout ────────────────────────────
console.log('\n[6] Grade column retained in every grade tab')
for (const g of Object.keys(EXPECT)) {
  const layout = X.buildQcLayout_('qc_fg', g)
  assert(g + ": header includes 'Grade'", layout.header.indexOf('Grade') >= 0)
  assert(g + ": identityKeys includes 'grade'", layout.identityKeys.indexOf('grade') >= 0)
}

// ── 7. No-grade layout === the original global FG layout (byte-for-byte) ──────
console.log('\n[7] default (no grade) layout is the original FG layout')
const globalLayout = X.buildQcLayout_('qc_fg')
const globalKeys = X.QC_FIELDS_FG.map(f => f[0])
// its field catalog must equal the full global QC_FIELDS_FG
assert('no-grade layout.fields === QC_FIELDS_FG',
  JSON.stringify(globalLayout.fields) === JSON.stringify(X.QC_FIELDS_FG))
// and its header must contain every global field label (nothing narrowed/dropped)
assert('no-grade header has all global field keys represented',
  globalKeys.every(k => globalLayout.valueCol[k] !== undefined))
// a grade layout is NARROWER than the global one (the whole point)
assert('normal grade layout is narrower than global',
  X.buildQcLayout_('qc_fg', 'normal').header.length < globalLayout.header.length)
// unknown grade falls back to the FULL global catalog (original tab not narrowed)
assert('unknown grade → fgFieldsForGrade_ returns null (→ global catalog)',
  X.fgFieldsForGrade_('mystery_co') === null)
const unknownLayout = X.buildQcLayout_('qc_fg', 'mystery_co')
assert('unknown-grade layout === global layout',
  JSON.stringify(unknownLayout.header) === JSON.stringify(globalLayout.header))

// ── 8. fgBizKey_ unchanged + distinct/idempotent ─────────────────────────────
console.log('\n[8] fgBizKey_ identity + dedup invariants')
const b = { date: '2026-10-28', batch_no: 'B1', product: 'sulphur80wdg', grade: 'adama', dryer: 'ND1' }
eq('fgBizKey_ format date|batch|product|grade|dryer',
  X.fgBizKey_(b), '2026-10-28|B1|sulphur80wdg|adama|ND1')
// idempotent: identical input → identical key (same row on retry/replay)
assert('same input → identical key (idempotent)', X.fgBizKey_(b) === X.fgBizKey_({ ...b }))
// grade is part of the key → different grades never collide on one row
assert('different grade → different key', X.fgBizKey_(b) !== X.fgBizKey_({ ...b, grade: 'lohiya' }))
// batch distinct
assert('different batch → different key', X.fgBizKey_(b) !== X.fgBizKey_({ ...b, batch_no: 'B2' }))
// date distinct
assert('different date → different key', X.fgBizKey_(b) !== X.fgBizKey_({ ...b, date: '2026-10-29' }))
// grade normalized (case/blank) consistently with routing
eq('blank grade in key → normal', X.fgBizKey_({ ...b, grade: '' }), '2026-10-28|B1|sulphur80wdg|normal|ND1')
eq('upper grade in key → lowercased', X.fgBizKey_({ ...b, grade: 'ADAMA' }), '2026-10-28|B1|sulphur80wdg|adama|ND1')
// routing tab and key agree on the normalized grade
assert('routing tab + key agree on normalized grade',
  X.fgTabForGrade_('ADAMA') === EXPECT['adama'] &&
  X.fgBizKey_({ ...b, grade: 'ADAMA' }).split('|')[3] === 'adama')

// ── 9. Every website grade param id has a sheet column (incl. calc results) ──
// This is the guard against the "calculated results not reaching the sheet"
// class of bug: if a row id drifts between uplData.js and Code.gs (e.g. the
// ADAMA 'adma_*' vs 'adama_*' mismatch), the value is stored but never written.
// We import the website source of truth and assert a 1:1 id match per grade.
console.log('\n[9] every uplData grade param id is a sheet column (no silent drops)')
{
  const upl = await import('../../../../src/data/uplData.js')
  const websiteIds = {
    export: upl.UPL_GRADES.export.map(r => r.id),
    omri: upl.UPL_GRADES.omri.map(r => r.id),
  }
  for (const [g, cfg] of Object.entries(upl.TABLE_GRADES)) websiteIds[g] = cfg.rows.map(r => r.id)

  // Re-read the catalog straight off the evaluated Code.gs context.
  const mine = sandbox.FG_GRADE_EXTRA_FIELDS ||
    vm.runInContext('FG_GRADE_EXTRA_FIELDS', sandbox)

  for (const [g, ids] of Object.entries(websiteIds)) {
    const have = new Set((mine[g] || []).map(p => p[0]))
    const missing = ids.filter(id => !have.has(id))
    const extra = (mine[g] || []).map(p => p[0]).filter(id => !ids.includes(id))
    assert(g + ': every website param id has a column' +
      (missing.length ? ' (MISSING: ' + missing.join(', ') + ')' : ''), missing.length === 0)
    assert(g + ': no stray columns absent from website' +
      (extra.length ? ' (EXTRA: ' + extra.join(', ') + ')' : ''), extra.length === 0)
  }
  // Pass/Fail parity: every RULED website grade row has an identical QC_RULES
  // entry so the sheet shows the same PASS/FAIL the website computes. Unruled
  // website rows must stay statusless (not checked here — absence is correct).
  const QC_RULES = vm.runInContext('QC_RULES', sandbox)
  const allRows = [...upl.UPL_GRADES.export, ...upl.UPL_GRADES.omri]
  for (const cfg of Object.values(upl.TABLE_GRADES)) allRows.push(...cfg.rows)
  const ruleSeen = {}
  for (const r of allRows) {
    if (ruleSeen[r.id] || !r.rule) continue
    ruleSeen[r.id] = 1
    assert('Pass/Fail rule present+matching: ' + r.id,
      QC_RULES[r.id] && JSON.stringify(QC_RULES[r.id]) === JSON.stringify(r.rule))
  }

  // Explicit calc-row coverage (the ones computed after entry).
  const calcChecks = [
    ['export', 'upl_exp_sulphur'], ['export', 'upl_exp_susp'],
    ['omri', 'upl_omri_sulphur'], ['omri', 'upl_omri_susp'],
    ['sanaca', 'sanaca_sulphur'], ['sanaca', 'sanaca_suspensibility'], ['sanaca', 'sanaca_bulk_density'],
    ['adama', 'adma_sulphur'],
  ]
  for (const [g, id] of calcChecks) {
    const have = new Set((mine[g] || []).map(p => p[0]))
    assert('calc row present: ' + g + '.' + id, have.has(id))
  }
}

// ── summary ──────────────────────────────────────────────────────────────────
console.log('')
if (failures === 0) {
  console.log('ALL TESTS PASSED')
  process.exit(0)
} else {
  console.error(failures + ' TEST(S) FAILED')
  process.exit(1)
}
