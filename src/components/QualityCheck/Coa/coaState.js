// ═══════════════════════════════════════════════════════════════════════════
// coaState — PURE, framework-free COA draft state logic.
// ---------------------------------------------------------------------------
// This module holds the rules that satisfy the task's highest-priority
// requirement: once a field is edited, the new value REPLACES the previous value
// everywhere in the active report. It is deliberately free of React/Supabase so
// it can be unit-tested directly with `node:test`.
//
// State model (the draft is the single source of truth after load):
//   draft = {
//     id, partyKey, templateVersion, product,
//     header:        { [fieldId]: value },        // certificate-level edits
//     editedValues:  { [entryId]: { [fieldId]: value } }, // per-batch OVERRIDES
//     specSnapshot:  { [paramId]: {...} },
//     batchOrder:    [entryId, ...],              // column order
//     revision, status, finalized,
//   }
//   entries = { [entryId]: { id, batchNo, logDate, product, grade, dryer,
//                            loadedValues: { [fieldId]: value }, sourceRecordId } }
//
// resolveValue() is the ONE place the active value is computed: an edit in
// editedValues REPLACES (never appends to) the batch's immutable loadedValues.
// ═══════════════════════════════════════════════════════════════════════════

// Empty-but-present values (e.g. an intentionally blank text cell) must still
// override the loaded value. Only `undefined` means "no edit for this field".
export function hasEdit(editedValues, entryId, fieldId) {
  const bucket = editedValues && editedValues[entryId]
  return !!bucket && Object.prototype.hasOwnProperty.call(bucket, fieldId)
}

// The authoritative active value for one (batch entry, field): the edited value
// if one exists (REPLACING the loaded value), otherwise the loaded source value.
// An optional `sourceKey` on the parameter row lets a COA row with a different
// id read from a different key in loadedValues (e.g. foam: row id is
// `upl_omri_foam` but FG saves it as `fg_foam_1min`).
// When sourceKey ends with `_log`, the stored value is an array of readings —
// the LAST entry's `result` field is used (e.g. fg_wetSieve_log → last wet
// sieve calculated result).
export function resolveValue(draft, entry, fieldId, sourceKey) {
  const editedValues = (draft && draft.editedValues) || {}
  if (entry && hasEdit(editedValues, entry.id, fieldId)) {
    return editedValues[entry.id][fieldId]
  }
  const loaded = (entry && entry.loadedValues) || {}
  const val = loaded[fieldId]
  if ((val === undefined || val === null || val === '') && sourceKey && sourceKey !== fieldId) {
    const raw = loaded[sourceKey]
    // If the source value is a log array (e.g. fg_wetSieve_log /
    // fg_drySieve_log), return the last entry's result so the COA shows
    // the latest calculated value.
    if (Array.isArray(raw) && raw.length > 0) {
      const last = raw[raw.length - 1]
      return (last && last.result !== undefined) ? String(last.result) : ''
    }
    return raw
  }
  return val
}

// Apply an edit to a batch field: REPLACE the value in place (object-key
// assignment), never push/append. Returns a NEW draft (immutable update).
export function applyBatchEdit(draft, entryId, fieldId, value) {
  const prevEdited = (draft && draft.editedValues) || {}
  const prevBucket = prevEdited[entryId] || {}
  return {
    ...draft,
    editedValues: {
      ...prevEdited,
      [entryId]: { ...prevBucket, [fieldId]: value },
    },
  }
}

// Apply an edit to a certificate-level header field (REPLACE in place).
export function applyHeaderEdit(draft, fieldId, value) {
  const prevHeader = (draft && draft.header) || {}
  return { ...draft, header: { ...prevHeader, [fieldId]: value } }
}

// Add a batch column. Preserves ALL existing edits (header + every other
// batch's editedValues) and never duplicates an existing column. Returns
// { draft, entries, added } — added=false if the batch identity already exists.
export function addBatch(draft, entries, newEntry) {
  const order = Array.isArray(draft.batchOrder) ? draft.batchOrder : []
  // Duplicate guard on the five-part identity (same rule as the DB unique index).
  const dup = order.some(id => {
    const e = entries[id]
    return e && sameBatchIdentity(e, newEntry)
  })
  if (dup) return { draft, entries, added: false }

  const nextEntries = { ...entries, [newEntry.id]: { ...newEntry } }
  const nextDraft = {
    ...draft,
    // editedValues untouched → other batches' edits preserved.
    batchOrder: [...order, newEntry.id],
  }
  return { draft: nextDraft, entries: nextEntries, added: true }
}

// Remove a batch column. Preserves every OTHER batch's edits and the header.
// Drops only the removed entry's editedValues bucket and its order slot.
export function removeBatch(draft, entries, entryId) {
  const order = Array.isArray(draft.batchOrder) ? draft.batchOrder : []
  if (!order.includes(entryId)) return { draft, entries, removed: false }

  const nextEntries = { ...entries }
  delete nextEntries[entryId]

  const nextEdited = { ...((draft && draft.editedValues) || {}) }
  delete nextEdited[entryId]

  const nextDraft = {
    ...draft,
    editedValues: nextEdited,
    batchOrder: order.filter(id => id !== entryId),
  }
  return { draft: nextDraft, entries: nextEntries, removed: true }
}

// ── Date helpers (manufacturing / expiry) ────────────────────────────────────

// Add N years to an ISO date string (YYYY-MM-DD), returning ISO. Handles the
// Feb-29 edge case by clamping to Feb-28 in a non-leap target year. Returns ''
// for an unparseable input.
export function addYears(isoDate, years) {
  if (!isoDate || typeof isoDate !== 'string') return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate)
  if (!m) return ''
  const y = Number(m[1]) + years
  const mo = Number(m[2])
  let day = Number(m[3])
  // Clamp day to the last valid day of the target month (e.g. 02-29 → 02-28).
  const lastDay = new Date(y, mo, 0).getDate()
  if (day > lastDay) day = lastDay
  const pad = n => String(n).padStart(2, '0')
  return `${y}-${pad(mo)}-${pad(day)}`
}

// Shelf life for finished goods = 2 years from manufacture (client rule).
export const COA_SHELF_LIFE_YEARS = 2

// The certificate's manufacturing date = the EARLIEST batch mfg date (each
// batch entry's logDate comes straight from its saved FG record). Returns '' if
// no batch has a date yet.
export function deriveMfgDate(draft, entries) {
  const order = Array.isArray(draft.batchOrder) ? draft.batchOrder : []
  const dates = order
    .map(id => entries[id] && entries[id].logDate)
    .filter(d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d))
    .sort()
  return dates[0] || ''
}

// Recompute header mfg_date + expiry_date from the batch data, WITHOUT clobbering
// a value the operator has explicitly edited. An edited header field is one that
// exists in draft.header; auto-derivation only fills a field that is absent or
// still equal to the previously auto-derived value. Returns a NEW draft.
export function syncDates(draft, entries) {
  const mfg = deriveMfgDate(draft, entries)
  if (!mfg) return draft
  const header = { ...((draft && draft.header) || {}) }
  const prevAuto = (draft && draft.__autoDates) || {}

  // mfg_date: fill if empty or if it still holds the last auto value.
  const mfgUserSet = header.mfg_date && header.mfg_date !== prevAuto.mfg_date
  if (!mfgUserSet) header.mfg_date = mfg

  const expiry = addYears(header.mfg_date || mfg, COA_SHELF_LIFE_YEARS)
  const expUserSet = header.expiry_date && header.expiry_date !== prevAuto.expiry_date
  if (!expUserSet && expiry) header.expiry_date = expiry

  return { ...draft, header, __autoDates: { mfg_date: header.mfg_date, expiry_date: header.expiry_date } }
}

// Five-part batch identity equality (date|batch|product|grade|dryer), matching
// the DB unique constraint on coa_batch_entry.
export function sameBatchIdentity(a, b) {
  if (!a || !b) return false
  const norm = v => (v === undefined || v === null) ? '' : String(v)
  return norm(a.batchNo)  === norm(b.batchNo)
      && norm(a.logDate)  === norm(b.logDate)
      && norm(a.product)  === norm(b.product)
      && norm(a.grade)    === norm(b.grade)
      && norm(a.dryer)    === norm(b.dryer)
}

// ── Optimistic-concurrency merge (clone of the FG mergeFgPayload contract) ────
// Merge a remote draft payload into the local one without a stale remote write
// clobbering a newer local edit. Deep-merges header + editedValues; for a scalar
// that differs and is non-empty on both sides, records a conflict and KEEPS the
// local value until the operator resolves it. Returns { merged, conflicts }.
export function mergeCoaPayload(local, remote) {
  const conflicts = {}
  const isEmpty = v => v === undefined || v === null || v === ''
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v)

  const walk = (lv, rv, path) => {
    if (rv === undefined) return lv
    if (lv === undefined) return rv
    if (Array.isArray(lv) || Array.isArray(rv)) {
      // Arrays in COA payload are ordering lists; prefer non-empty, else local.
      if (Array.isArray(lv) && lv.length) return lv
      if (Array.isArray(rv) && rv.length) return rv
      return lv
    }
    if (isObj(lv) || isObj(rv)) {
      const lo = isObj(lv) ? lv : {}
      const ro = isObj(rv) ? rv : {}
      const out = { ...lo }
      new Set([...Object.keys(lo), ...Object.keys(ro)]).forEach(k => {
        out[k] = walk(lo[k], ro[k], path ? `${path}.${k}` : k)
      })
      return out
    }
    if (lv === rv) return lv
    if (isEmpty(lv)) return rv
    if (isEmpty(rv)) return lv
    conflicts[path] = { local: lv, remote: rv }
    return lv
  }

  const merged = walk(local || {}, remote || {}, '')
  return { merged, conflicts }
}

// Serialize just the persisted slice of a draft (what goes to coa_draft columns),
// stable enough to use as a de-dup signature for autosave (prevents re-sending an
// identical payload and prevents an older delayed response re-triggering a save).
// `header` already carries `coa_parameters` (the editable parameter list for OMRI),
// so parameter edits are part of the signature and trigger autosave automatically.
export function draftSignature(draft) {
  try {
    return JSON.stringify({
      header: draft.header || {},
      editedValues: draft.editedValues || {},
      batchOrder: draft.batchOrder || [],
    })
  } catch {
    return ''
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EDITABLE PARAMETERS (UPL OMRI only)
// ---------------------------------------------------------------------------
// The editable parameter list is stored inside draft.header.coa_parameters so
// it persists through the existing header JSONB column WITHOUT a schema
// migration. On first use it is initialised from the template's static array;
// after that the draft copy is the single source of truth. Batch result cells
// remain keyed by parameter.id, so renaming a parameter or editing its spec
// never misassigns or loses its laboratory results.
// ═══════════════════════════════════════════════════════════════════════════

// Return the ACTIVE parameter list: the editable copy from the draft if one
// exists, otherwise the template's static array. This is what both the editor
// grid and the HTML builder read.
export function resolveParameters(draft, template) {
  const stored = draft && draft.header && Array.isArray(draft.header.coa_parameters)
    ? draft.header.coa_parameters
    : null
  if (stored) return stored
  return (template && Array.isArray(template.parameters)) ? template.parameters : []
}

// Ensure the draft carries its own editable parameter copy. Called once after
// load (or at creation) so subsequent edits are isolated from the template.
// Returns a NEW draft (immutable). No-op if the copy already exists.
export function initParameters(draft, template) {
  const header = { ...((draft && draft.header) || {}) }
  if (Array.isArray(header.coa_parameters)) return draft
  header.coa_parameters = ((template && template.parameters) || []).map(p => ({ ...p }))
  return { ...draft, header }
}

// Edit one field (parameter / specDisplay / unit / group) of a parameter row.
// Modifies header.coa_parameters in place (REPLACE), never appends. The
// parameter's `id` is immutable, so batch results stay correctly keyed.
export function applyParameterEdit(draft, paramId, fieldId, value) {
  const header = { ...((draft && draft.header) || {}) }
  const params = Array.isArray(header.coa_parameters)
    ? header.coa_parameters.map(p => ({ ...p }))
    : []
  const row = params.find(p => p.id === paramId)
  if (!row) return draft
  row[fieldId] = value
  header.coa_parameters = params
  return { ...draft, header }
}

// Append a new blank parameter row. Returns a NEW draft.
export function addParameter(draft) {
  const header = { ...((draft && draft.header) || {}) }
  const params = Array.isArray(header.coa_parameters)
    ? header.coa_parameters.map(p => ({ ...p }))
    : []
  const newId = 'coa_param_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)
  params.push({ id: newId, group: '', parameter: '', specDisplay: '', unit: '' })
  header.coa_parameters = params
  return { ...draft, header }
}

// Remove a parameter row. Batch results for that paramId are left in
// editedValues (harmless orphans) — they simply have no row to render in.
export function removeParameter(draft, paramId) {
  const header = { ...((draft && draft.header) || {}) }
  if (!Array.isArray(header.coa_parameters)) return draft
  header.coa_parameters = header.coa_parameters.filter(p => p.id !== paramId)
  return { ...draft, header }
}

// Move a parameter row up or down in the order. Returns a NEW draft.
export function reorderParameter(draft, paramId, dir) {
  const header = { ...((draft && draft.header) || {}) }
  if (!Array.isArray(header.coa_parameters)) return draft
  const params = header.coa_parameters.map(p => ({ ...p }))
  const idx = params.findIndex(p => p.id === paramId)
  if (idx < 0) return draft
  const target = dir === 'up' ? idx - 1 : idx + 1
  if (target < 0 || target >= params.length) return draft
  ;[params[idx], params[target]] = [params[target], params[idx]]
  header.coa_parameters = params
  return { ...draft, header }
}

// ── Final-row resolver (Mfg Date / Exp Date / QTY per batch) ──────────────────
// These rows sit after the parameters and show each batch column's own value.
// Mfg Date falls back to the batch's FG log_date; Exp Date to mfg + 2 years;
// QTY to the batch record's quantity if present, else the operator enters it.
export function resolveFinalRowValue(draft, entry, fieldId) {
  const editedValues = (draft && draft.editedValues) || {}
  if (entry && hasEdit(editedValues, entry.id, fieldId)) {
    return editedValues[entry.id][fieldId]
  }
  if (fieldId === 'batch_no_hdr') {
    return (entry && entry.batchNo) || ''
  }
  if (fieldId === 'mfg_date') {
    return (entry && entry.logDate) || ''
  }
  if (fieldId === 'exp_date') {
    const mfg = resolveFinalRowValue(draft, entry, 'mfg_date')
    return mfg ? addYears(mfg, COA_SHELF_LIFE_YEARS) : ''
  }
  if (fieldId === 'qty') {
    const loaded = (entry && entry.loadedValues) || {}
    return loaded.qty || ''
  }
  return resolveValue(draft, entry, fieldId)
}
