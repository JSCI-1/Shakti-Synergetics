/**
 * Unit tests — Dryer hourly edit-history pure helpers (FEAT-001).
 *
 * Run:  node src/components/dryerHistory.test.mjs
 *
 * No framework — plain assertions over the framework-free module. Exits
 * non-zero on the first set of failures. Covers the design §1–§8 rules that the
 * trigger (FEAT-002) and Apps Script (FEAT-003) depend on:
 *   - scalar no-op vs change incl. clearing-to-empty
 *   - maintenance off/on re-select = no change (keeps persisted ISO); genuine
 *     toggle = change
 *   - applyEdit uses ONE commitIso across a multi-field edit → exactly one
 *     __events edit entry, both fields share that ts (design §1.6(d))
 *   - seedLegacyHistory synthesizes __events[0] from min(__ts) and
 *     __hist[field][0] from __ts[field]
 *   - mergeHistoryByTs keeps two same-millisecond different-value edits but
 *     dedups an exact (ts,v) replay
 *   - buildEventsTrail formats IST
 *   - coerceHistory defaults absent __hist/__events
 */

import {
  coerceHistory,
  computeRowDiff,
  seedLegacyHistory,
  applyEdit,
  mergeHistoryByTs,
  buildEventsTrail,
  latestFieldEditIso,
  fmtIstTs,
} from './dryerHistory.js'

let failures = 0
function assert(label, cond) {
  if (cond) console.log('  \u2713 ' + label)
  else { console.error('  \u2717 FAIL: ' + label); failures++ }
}

console.log('Dryer edit-history helper tests')

// ── coerceHistory ────────────────────────────────────────────────────────────
console.log('coerceHistory')
{
  const c = coerceHistory({ temp_inlet: '180' })
  assert('absent __hist defaults to {} object',
    c.__hist && typeof c.__hist === 'object' && !Array.isArray(c.__hist) && Object.keys(c.__hist).length === 0)
  assert('absent __events defaults to [] array', Array.isArray(c.__events) && c.__events.length === 0)
  assert('flat value preserved', c.temp_inlet === '180')

  const bad = coerceHistory({ __hist: [1, 2], __events: { nope: true } })
  assert('array __hist repaired to {}', !Array.isArray(bad.__hist) && typeof bad.__hist === 'object')
  assert('object __events repaired to []', Array.isArray(bad.__events))

  const nul = coerceHistory(null)
  assert('null values → coerced object', nul && typeof nul === 'object' && Array.isArray(nul.__events))
}

// ── computeRowDiff (scalars) ──────────────────────────────────────────────────
console.log('computeRowDiff — scalars')
{
  const base = { temp_inlet: '180', colour: 'Normal' }

  assert('no-op: identical values → no changes',
    computeRowDiff(base, { temp_inlet: '180', colour: 'Normal' }).size === 0)

  assert('no-op: whitespace-only difference → no change (trim)',
    computeRowDiff(base, { temp_inlet: ' 180 ', colour: 'Normal' }).size === 0)

  const d1 = computeRowDiff(base, { temp_inlet: '185', colour: 'Normal' })
  assert('change: value differs → field in diff', d1.has('temp_inlet') && d1.size === 1)

  const d2 = computeRowDiff(base, { temp_inlet: '', colour: 'Normal' })
  assert('change: clearing to empty IS a change', d2.has('temp_inlet') && d2.size === 1)

  const d3 = computeRowDiff(base, { temp_inlet: '185', colour: 'OMRI' })
  assert('multi-field change detected', d3.has('temp_inlet') && d3.has('colour') && d3.size === 2)

  assert('operator_name is NOT history-tracked',
    computeRowDiff({ operator_name: 'A' }, { operator_name: 'B' }).size === 0)
}

// ── computeRowDiff (maintenance) ──────────────────────────────────────────────
console.log('computeRowDiff — maintenance')
{
  const base = { maintenance: { shifter_screen: '2025-02-10T08:05:10.000Z', atomizer_water: '' } }

  // off/on re-select of an already-selected option yields a NEW ISO but the
  // selected-state is unchanged → NOT a change.
  const reselect = { maintenance: { shifter_screen: '2025-02-10T09:00:00.000Z', atomizer_water: '' } }
  assert('maintenance re-select (new ISO, same selected-state) → no change',
    computeRowDiff(base, reselect).size === 0)

  // genuine toggle: select the second option.
  const toggleOn = { maintenance: { shifter_screen: '2025-02-10T08:05:10.000Z', atomizer_water: '2025-02-10T09:00:00.000Z' } }
  assert('maintenance newly-selected option → change',
    computeRowDiff(base, toggleOn).has('maintenance'))

  // deselect the selected option.
  const toggleOff = { maintenance: { shifter_screen: '', atomizer_water: '' } }
  assert('maintenance deselect → change', computeRowDiff(base, toggleOff).has('maintenance'))
}

// ── seedLegacyHistory ─────────────────────────────────────────────────────────
console.log('seedLegacyHistory')
{
  const legacy = {
    temp_inlet: '180',
    colour: 'Normal',
    timestamp: '08:05:10 AM',
    __ts: {
      temp_inlet: '2025-02-10T08:05:10.000Z',
      colour: '2025-02-10T08:10:00.000Z',
    },
    // no __events, no __hist — pre-feature row
  }
  const commitIso = '2025-02-10T09:20:15.000Z'
  const changed = new Set(['temp_inlet'])
  const seeded = seedLegacyHistory(legacy, commitIso, changed)

  assert('__events[0] synthesized as save',
    seeded.__events.length === 1 && seeded.__events[0].type === 'save')
  assert('__events[0].ts = min(__ts) (not commitIso)',
    seeded.__events[0].ts === '2025-02-10T08:05:10.000Z')
  assert('__hist[temp_inlet][0] = {old value, __ts[field]}',
    Array.isArray(seeded.__hist.temp_inlet) &&
    seeded.__hist.temp_inlet.length === 1 &&
    seeded.__hist.temp_inlet[0].v === '180' &&
    seeded.__hist.temp_inlet[0].ts === '2025-02-10T08:05:10.000Z')
  assert('unchanged field colour gets no __hist seed', seeded.__hist.colour === undefined)

  // idempotent: already-seeded row is untouched
  const already = {
    temp_inlet: '185',
    __ts: { temp_inlet: '2025-02-10T09:20:15.000Z' },
    __hist: { temp_inlet: [{ v: '180', ts: '2025-02-10T08:05:10.000Z' }] },
    __events: [{ type: 'save', ts: '2025-02-10T08:05:10.000Z' }],
  }
  const again = seedLegacyHistory(already, commitIso, new Set(['temp_inlet']))
  assert('existing __events not re-seeded', again.__events.length === 1)
  assert('existing __hist[field] not re-seeded', again.__hist.temp_inlet.length === 1)

  // fallback chain: no __ts, parseable timestamp — just assert it does not throw
  // and produces a save event.
  const noTs = seedLegacyHistory({ timestamp: '2025-02-10T07:00:00.000Z' }, commitIso)
  assert('seed with no __ts still produces a save event', noTs.__events[0].type === 'save')

  // final fallback: nothing usable → commitIso
  const empty = seedLegacyHistory({}, commitIso)
  assert('seed with nothing usable falls back to commitIso', empty.__events[0].ts === commitIso)
}

// ── applyEdit (single shared commit) ──────────────────────────────────────────
console.log('applyEdit — single shared commitIso, one edit event')
{
  const commitIso = '2025-02-10T11:00:00.000Z'
  // start from a seeded single-edit base for both fields
  let v = {
    temp_inlet: '192',
    colour: 'OMRI',
    __ts: { temp_inlet: '2025-02-10T08:05:10.000Z', colour: '2025-02-10T08:05:10.000Z' },
    __hist: {
      temp_inlet: [{ v: '190', ts: '2025-02-10T08:05:10.000Z' }],
      colour: [{ v: 'Normal', ts: '2025-02-10T08:05:10.000Z' }],
    },
    __events: [{ type: 'save', ts: '2025-02-10T08:05:10.000Z' }],
  }
  const changed = new Set(['temp_inlet', 'colour'])
  const after = applyEdit(v, changed, commitIso)

  const editEvents = after.__events.filter(e => e.type === 'edit')
  assert('exactly ONE edit event for a multi-field edit', editEvents.length === 1)
  assert('the edit event uses commitIso', editEvents[0].ts === commitIso)
  assert('temp_inlet __ts = commitIso', after.__ts.temp_inlet === commitIso)
  assert('colour __ts = commitIso', after.__ts.colour === commitIso)
  assert('both fields share commitIso in their appended __hist entry',
    after.__hist.temp_inlet[after.__hist.temp_inlet.length - 1].ts === commitIso &&
    after.__hist.colour[after.__hist.colour.length - 1].ts === commitIso)
  assert('appended __hist entries carry the new flat values',
    after.__hist.temp_inlet[after.__hist.temp_inlet.length - 1].v === '192' &&
    after.__hist.colour[after.__hist.colour.length - 1].v === 'OMRI')

  // operator_name / timestamp preserved
  const v2 = applyEdit(
    { temp_inlet: '5', operator_name: 'A. Kumar', timestamp: '08:05:10 AM' },
    new Set(['temp_inlet']), commitIso)
  assert('operator_name preserved', v2.operator_name === 'A. Kumar')
  assert('timestamp preserved', v2.timestamp === '08:05:10 AM')
}

// ── mergeHistoryByTs ──────────────────────────────────────────────────────────
console.log('mergeHistoryByTs')
{
  // two devices edited the SAME field to DIFFERENT values in the SAME ms →
  // both kept (dedup by (ts, value)).
  const persisted = {
    temp_inlet: '186',
    __hist: {
      temp_inlet: [
        { v: '180', ts: '2025-02-10T08:05:10.000Z' },
        { v: '186', ts: '2025-02-10T09:00:00.000Z' },
      ],
    },
    __events: [
      { type: 'save', ts: '2025-02-10T08:05:10.000Z' },
      { type: 'edit', ts: '2025-02-10T09:00:00.000Z' },
    ],
  }
  const local = {
    temp_inlet: '185',
    __hist: {
      temp_inlet: [
        { v: '180', ts: '2025-02-10T08:05:10.000Z' },
        { v: '185', ts: '2025-02-10T09:00:00.000Z' },
      ],
    },
    __events: [
      { type: 'save', ts: '2025-02-10T08:05:10.000Z' },
      { type: 'edit', ts: '2025-02-10T09:00:00.000Z' },
    ],
  }
  const merged = mergeHistoryByTs(persisted, local)
  assert('same-ms different-value edits on one field both kept',
    merged.__hist.temp_inlet.length === 3)
  assert('exact (ts,v) replay of original deduped to one',
    merged.__hist.temp_inlet.filter(e => e.v === '180').length === 1)
  assert('union sorted oldest-first by ts',
    merged.__hist.temp_inlet[0].ts === '2025-02-10T08:05:10.000Z')
  assert('same-(ts,type) events deduped',
    merged.__events.length === 2)
  assert('local flat value wins', merged.temp_inlet === '185')

  // exact replay: persisted == local → identical union, no growth.
  const replay = mergeHistoryByTs(persisted, persisted)
  assert('exact replay does not duplicate __hist entries',
    replay.__hist.temp_inlet.length === 2)
  assert('exact replay does not duplicate __events', replay.__events.length === 2)
}

// ── buildEventsTrail / latestFieldEditIso / fmtIstTs ──────────────────────────
console.log('buildEventsTrail / latestFieldEditIso / fmtIstTs')
{
  const events = [
    { type: 'save', ts: '2025-02-10T02:35:10.000Z' },  // 08:05:10 AM IST
    { type: 'edit', ts: '2025-02-10T03:50:15.000Z' },  // 09:20:15 AM IST
  ]
  const trail = buildEventsTrail(events)
  assert('trail has Original then Edited', /^Original: .+ \/ Edited: .+$/.test(trail))
  assert('trail renders IST 08:05:10 AM for first event', trail.includes('08:05:10'))
  assert('trail renders IST 09:20:15 AM for edit event', trail.includes('09:20:15'))

  assert('empty events falls back to Original: <timestamp>',
    buildEventsTrail([], '08:05:10 AM') === 'Original: 08:05:10 AM')
  assert('absent events + no fallback → empty string', buildEventsTrail(undefined) === '')

  const hist = {
    temp_inlet: [
      { v: '180', ts: '2025-02-10T02:35:10.000Z' },
      { v: '185', ts: '2025-02-10T03:50:15.000Z' },
    ],
    colour: [{ v: 'Normal', ts: '2025-02-10T02:35:10.000Z' }],
  }
  assert('latestFieldEditIso returns last ts when length >= 2',
    latestFieldEditIso(hist, 'temp_inlet') === '2025-02-10T03:50:15.000Z')
  assert('latestFieldEditIso returns null when length 1',
    latestFieldEditIso(hist, 'colour') === null)
  assert('latestFieldEditIso returns null when field absent',
    latestFieldEditIso(hist, 'pressure') === null)

  assert('fmtIstTs formats IST', fmtIstTs('2025-02-10T02:35:10.000Z').includes('08:05:10'))
  assert('fmtIstTs empty for garbage', fmtIstTs('not-a-date') === '')
}

if (failures > 0) {
  console.error('\n' + failures + ' assertion(s) failed.')
  process.exit(1)
}
console.log('\nAll dryer edit-history helper tests passed.')
