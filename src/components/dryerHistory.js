/**
 * dryerHistory.js — framework-free pure helpers for the Dryer hourly
 * edit-history feature (FEAT-001). NO React import: everything here is a plain
 * function over the `values` JSONB contract so it can be unit-tested with a
 * bare `node *.test.mjs` harness (see dryerHistory.test.mjs).
 *
 * This module OWNS the `values` JSONB history shape that the trigger (FEAT-002)
 * and the Apps Script (FEAT-003) read. See .agents/tasks/dryer-edit-history-design.md
 * §1 for the authoritative contract. Summary:
 *   values[field]            → flat CURRENT value (unchanged legacy contract)
 *   values.__ts[field]       → ISO of the current value
 *   values.__hist[field]     → [{v,ts}, …] oldest-first; only for edited fields
 *                              (maintenance stores the whole object as v)
 *   values.__events          → [{type,ts}, …] oldest-first; type 'save'|'edit'
 *   values.__finalized / operator_name / timestamp → preserved as-is
 */

// ── Field sets ──────────────────────────────────────────────────────────────
// History-tracked fields (design §1.5a): the operator-entered scalars plus the
// maintenance object. `operator_name` and `timestamp` are bookkeeping — NEVER
// history-tracked (no __hist entry, no under-field timestamp).
export const HISTORY_SCALAR_FIELDS = [
  'temp_inlet', 'temp_outlet', 'temp_actual', 'temp_fbd1', 'temp_fbd2',
  'temp_chamber', 'atomizer_freq', 'feed_fc', 'c_pressure', 'pressure',
  'pt_temp', 'batch_no', 'bags_per_hr', 'bag_size_wt', 'kg_per_hr',
  'colour', 'id_frequency', 'remarks',
]

const MAINTENANCE_OPTION_KEYS = ['shifter_screen', 'atomizer_water']

// ── Low-level coercion ────────────────────────────────────────────────────────

function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v)
}

/**
 * coerceHistory — default/repair the two reserved history structures on a
 * `values`-shaped object (design §8 backward-compat, §10 input validation):
 *   __hist → plain object (default {})
 *   __events → array (default [])
 * Returns a shallow copy with the two keys normalized; never throws.
 */
export function coerceHistory(values) {
  const v = isPlainObject(values) ? { ...values } : {}
  v.__hist = isPlainObject(v.__hist) ? v.__hist : {}
  v.__events = Array.isArray(v.__events) ? v.__events : []
  return v
}

function trimStr(x) {
  return (x === null || x === undefined ? '' : String(x)).trim()
}

// Maintenance boolean selected-state: an option is "selected" iff its ISO is
// non-empty. Comparison is on presence, NOT the ISO string (design §1.5).
function maintSelectedState(maint) {
  const m = isPlainObject(maint) ? maint : {}
  const state = {}
  MAINTENANCE_OPTION_KEYS.forEach(k => { state[k] = !!(m[k] && String(m[k]).length) })
  return state
}

function maintenanceChanged(baseMaint, nextMaint) {
  const a = maintSelectedState(baseMaint)
  const b = maintSelectedState(nextMaint)
  return MAINTENANCE_OPTION_KEYS.some(k => a[k] !== b[k])
}

// ── Diff ──────────────────────────────────────────────────────────────────────

/**
 * computeRowDiff(baseValues, nextRow) → Set of changed history-tracked field
 * keys (design §1.4/§1.5). Per scalar: trim(base) !== trim(next) — clearing to
 * empty IS a change. For `maintenance`: changed iff the boolean selected-state
 * of either option differs (an off/on re-select of an already-selected option
 * is NOT a change). `baseValues` is the persisted `values`; `nextRow` is the
 * in-memory row (its flat keys + maintenance object).
 */
export function computeRowDiff(baseValues, nextRow) {
  const base = isPlainObject(baseValues) ? baseValues : {}
  const next = isPlainObject(nextRow) ? nextRow : {}
  const changed = new Set()

  HISTORY_SCALAR_FIELDS.forEach(f => {
    if (trimStr(base[f]) !== trimStr(next[f])) changed.add(f)
  })

  if (maintenanceChanged(base.maintenance, next.maintenance)) changed.add('maintenance')

  return changed
}

// ── Row-seed ISO (design §1.3) ────────────────────────────────────────────────

function rowSeedIsoFor(values, commitIso) {
  // (1) min of the real stored per-field ISOs, if any.
  if (isPlainObject(values.__ts)) {
    const isos = Object.values(values.__ts).filter(s => typeof s === 'string' && s)
    if (isos.length) {
      // ISO-8601 strings in the same zone sort lexicographically === chronologically.
      return isos.slice().sort()[0]
    }
  }
  // (2) best-effort parse of the legacy display timestamp string.
  if (typeof values.timestamp === 'string' && values.timestamp) {
    const t = Date.parse(values.timestamp)
    if (!Number.isNaN(t)) return new Date(t).toISOString()
  }
  // (3) final fallback.
  return commitIso
}

// ── Seed legacy history (design §1.3 / Finding 3) ─────────────────────────────

/**
 * seedLegacyHistory(values, commitIso, changedFields) → NEW coerced values with
 * pre-feature originals synthesized BEFORE any edit is appended:
 *  - if __events is absent/empty, set __events = [{type:'save', ts: rowSeedIso}]
 *  - for each changed field lacking __hist[field], seed
 *      __hist[field] = [{ v: <old current>, ts: values.__ts[field] || rowSeedIso }]
 *    (maintenance seeds its whole object as v)
 * Idempotent: a row that already has __events / __hist[field] is left untouched.
 * `changedFields` is optional (iterable of field keys); when omitted, only the
 * __events seed runs.
 */
export function seedLegacyHistory(values, commitIso, changedFields) {
  const v = coerceHistory(values)
  const seedIso = rowSeedIsoFor(v, commitIso)

  if (!v.__events.length) {
    v.__events = [{ type: 'save', ts: seedIso }]
  }

  const tsMap = isPlainObject(v.__ts) ? v.__ts : {}
  const fields = changedFields ? Array.from(changedFields) : []
  if (fields.length) {
    const hist = { ...v.__hist }
    fields.forEach(f => {
      const existing = hist[f]
      if (Array.isArray(existing) && existing.length) return
      const oldVal = (f === 'maintenance')
        ? (isPlainObject(v.maintenance) ? v.maintenance : { shifter_screen: '', atomizer_water: '' })
        : (v[f] === undefined ? '' : v[f])
      hist[f] = [{ v: oldVal, ts: (typeof tsMap[f] === 'string' && tsMap[f]) ? tsMap[f] : seedIso }]
    })
    v.__hist = hist
  }

  return v
}

// ── Apply edit (design §1.5a / §2.4 single shared commit) ─────────────────────

/**
 * applyEdit(values, changedFields, commitIso) → NEW coerced values with the edit
 * applied under ONE shared commit instant:
 *  - for every changed field: __ts[field] = commitIso and append
 *      { v: <new current>, ts: commitIso } to __hist[field]
 *  - append EXACTLY ONE { type:'edit', ts: commitIso } to __events (not one per
 *    field)
 *  - operator_name and timestamp preserved unchanged
 * The caller is expected to have already written the new flat values onto the
 * object and to have run seedLegacyHistory for first-edit originals.
 * `newValues` (optional) supplies the new value for each field; when omitted the
 * flat `values[field]` already on the object is used.
 */
export function applyEdit(values, changedFields, commitIso, newValues) {
  const v = coerceHistory(values)
  const fields = Array.from(changedFields || [])

  const ts = { ...(isPlainObject(v.__ts) ? v.__ts : {}) }
  const hist = { ...v.__hist }
  const src = isPlainObject(newValues) ? newValues : v

  fields.forEach(f => {
    ts[f] = commitIso
    const newVal = (f === 'maintenance')
      ? (isPlainObject(src.maintenance) ? src.maintenance : { shifter_screen: '', atomizer_water: '' })
      : (src[f] === undefined ? '' : src[f])
    const arr = Array.isArray(hist[f]) ? hist[f].slice() : []
    arr.push({ v: newVal, ts: commitIso })
    hist[f] = arr
  })

  v.__ts = ts
  v.__hist = hist
  v.__events = v.__events.concat([{ type: 'edit', ts: commitIso }])

  return v
}

// ── Merge-by-ts (design §6 / §2.4 canonical order) ────────────────────────────

function histEntryKey(e) {
  return (e && e.ts ? String(e.ts) : '') + '|' + JSON.stringify(e ? e.v : null)
}

function eventEntryKey(e) {
  return (e && e.ts ? String(e.ts) : '') + '|' + (e && e.type ? String(e.type) : '')
}

function sortByTsOldestFirst(arr) {
  return arr.slice().sort((a, b) => {
    const ta = a && a.ts ? String(a.ts) : ''
    const tb = b && b.ts ? String(b.ts) : ''
    if (ta < tb) return -1
    if (ta > tb) return 1
    return 0
  })
}

function unionDedup(a, b, keyFn) {
  const out = []
  const seen = new Set()
  sortByTsOldestFirst((Array.isArray(a) ? a : []).concat(Array.isArray(b) ? b : []))
    .forEach(e => {
      const k = keyFn(e)
      if (seen.has(k)) return
      seen.add(k)
      out.push(e)
    })
  return out
}

/**
 * mergeHistoryByTs(persistedValues, localValues) → NEW coerced values whose
 * flat fields / __ts / operator_name / timestamp come from `localValues` (the
 * edit being committed) but whose __hist[field] and __events are the UNION of
 * both sides, sorted oldest-first by ts and deduped by the composite key
 * (ts, JSON.stringify(v)) for __hist entries and (ts, type) for __events
 * (design §6 Finding 5). Two same-millisecond different-value edits on one field
 * are both kept; an exact (ts, v) replay dedups to one.
 */
export function mergeHistoryByTs(persistedValues, localValues) {
  const persisted = coerceHistory(persistedValues)
  const local = coerceHistory(localValues)

  const mergedHist = {}
  const allFields = new Set([
    ...Object.keys(persisted.__hist),
    ...Object.keys(local.__hist),
  ])
  allFields.forEach(f => {
    mergedHist[f] = unionDedup(persisted.__hist[f], local.__hist[f], histEntryKey)
  })

  const mergedEvents = unionDedup(persisted.__events, local.__events, eventEntryKey)

  // Local flat values win (last-write-wins for the flat scalar, design §6);
  // history is the union.
  local.__hist = mergedHist
  local.__events = mergedEvents
  return local
}

// ── Presentation helpers (design §1.3 / §8) ───────────────────────────────────

/**
 * fmtIstTs(iso) → en-IN 12-hour-with-seconds string in Asia/Kolkata, matching
 * the Apps Script renderFieldTs_ IST rendering. Returns '' for an unparseable
 * input.
 */
export function fmtIstTs(iso) {
  if (typeof iso !== 'string' || !iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  })
}

/**
 * buildEventsTrail(events, fallbackTimestamp) → 'Original: <fmt> / Edited: <fmt> / …'
 * from the __events array (design §1.3/§8). The first 'save' renders as
 * 'Original:' and each 'edit' as 'Edited:'. Falls back to
 * 'Original: <fallbackTimestamp>' (the legacy display string, rendered verbatim)
 * when __events is absent/empty. Returns '' when there is nothing to show.
 */
export function buildEventsTrail(events, fallbackTimestamp) {
  const arr = Array.isArray(events) ? events : []
  if (!arr.length) {
    return fallbackTimestamp ? 'Original: ' + fallbackTimestamp : ''
  }
  const parts = sortByTsOldestFirst(arr).map(e => {
    const label = e && e.type === 'edit' ? 'Edited' : 'Original'
    return label + ': ' + fmtIstTs(e && e.ts)
  })
  return parts.join(' / ')
}

/**
 * latestFieldEditIso(hist, field) → the last entry's ts for __hist[field] when
 * that array has length >= 2 (i.e. the field was edited at least once), else
 * null (design §1.3 A7/A8).
 */
export function latestFieldEditIso(hist, field) {
  const arr = isPlainObject(hist) ? hist[field] : undefined
  if (!Array.isArray(arr) || arr.length < 2) return null
  const last = arr[arr.length - 1]
  return last && last.ts ? last.ts : null
}
