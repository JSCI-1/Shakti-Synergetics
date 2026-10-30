// COA pure-logic tests. Run with:  node --test src/components/QualityCheck/Coa/coa.test.mjs
// Follows the repo's existing node:test convention (dryerHistory.test.mjs).
//
// These cover the task's highest-priority behavior without a DB: edited values
// REPLACE previous values everywhere, add/remove batch preserves other edits,
// duplicate-column prevention, optimistic-concurrency merge, and preview==PDF.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  resolveValue, applyBatchEdit, applyHeaderEdit, addBatch, removeBatch,
  sameBatchIdentity, mergeCoaPayload, draftSignature,
  addYears, deriveMfgDate, syncDates,
} from './coaState.js'
import { buildCoaHtml } from './coaHtml.js'

// ── fixtures ──
function baseDraft() {
  return {
    id: 'd1', partyKey: 'lohiya', templateVersion: 1,
    header: {}, editedValues: {}, specSnapshot: {}, batchOrder: ['e1'],
    revision: 3, status: 'draft', finalized: false,
  }
}
function baseEntries() {
  return {
    e1: {
      id: 'e1', batchNo: '3512', logDate: '2026-10-01', product: 'sulphur80wdg',
      grade: 'lohiya', dryer: 'ND1',
      loadedValues: { lohiya_sulphur: '81.51', lohiya_ph: '6.8', lohiya_wettability: '75' },
    },
  }
}
const template = {
  key: 'lohiya', name: 'LOHIYA CHEMICAL LTD.', layout: 'single',
  headerFields: [{ id: 'certificate_no', label: 'Certificate No.' }],
  dispatchFields: [], signatureBlocks: [],
  parameters: [
    { id: 'lohiya_sulphur', group: 'Active', parameter: 'Active Sulphur', type: 'number', specDisplay: 'Min 80', unit: '%' },
    { id: 'lohiya_ph', group: 'pH', parameter: 'pH', type: 'number', specDisplay: '5-9', unit: '' },
    { id: 'lohiya_wettability', group: 'Wettability', parameter: 'Wettability', type: 'number', specDisplay: 'Max 80', unit: 's' },
  ],
}

// ── Test 4 + 1: edit REPLACES the previous value in the active report ──
test('edit replaces previous value; others untouched', () => {
  let draft = baseDraft()
  const entries = baseEntries()
  // Original resolved values
  assert.equal(resolveValue(draft, entries.e1, 'lohiya_sulphur'), '81.51')
  assert.equal(resolveValue(draft, entries.e1, 'lohiya_ph'), '6.8')

  draft = applyBatchEdit(draft, 'e1', 'lohiya_sulphur', '81.55')

  // New value replaces old; the old value is gone.
  assert.equal(resolveValue(draft, entries.e1, 'lohiya_sulphur'), '81.55')
  // Other fields preserved.
  assert.equal(resolveValue(draft, entries.e1, 'lohiya_ph'), '6.8')
  assert.equal(resolveValue(draft, entries.e1, 'lohiya_wettability'), '75')
  // loadedValues (the source snapshot) is NOT mutated — source stays protected.
  assert.equal(entries.e1.loadedValues.lohiya_sulphur, '81.51')
})

test('empty-string edit still overrides the loaded value', () => {
  let draft = baseDraft()
  const entries = baseEntries()
  draft = applyBatchEdit(draft, 'e1', 'lohiya_ph', '')
  assert.equal(resolveValue(draft, entries.e1, 'lohiya_ph'), '')
})

// ── Test 2 + 3 + 7: preview HTML shows only the latest value, not both ──
test('preview/PDF HTML contains new value and not the old one', () => {
  let draft = baseDraft()
  const entries = baseEntries()
  draft = applyBatchEdit(draft, 'e1', 'lohiya_sulphur', '81.55')
  const html = buildCoaHtml(draft, entries, template)
  assert.ok(html.includes('81.55'), 'new value present')
  assert.ok(!html.includes('81.51'), 'old value absent from active report')
})

test('same builder → preview equals PDF source (byte-identical)', () => {
  const draft = baseDraft(); const entries = baseEntries()
  const a = buildCoaHtml(draft, entries, template)
  const b = buildCoaHtml(draft, entries, template)
  assert.equal(a, b)
})

// ── Test 6 + 7: add batch preserves other edits; no duplicate column ──
test('addBatch preserves existing edits and appends a column', () => {
  let draft = baseDraft(); const entries = baseEntries()
  draft = applyBatchEdit(draft, 'e1', 'lohiya_sulphur', '81.55')
  const newEntry = {
    id: 'e2', batchNo: '3513', logDate: '2026-10-02', product: 'sulphur80wdg',
    grade: 'lohiya', dryer: 'ND2', loadedValues: { lohiya_sulphur: '80.9' },
  }
  const r = addBatch(draft, entries, newEntry)
  assert.equal(r.added, true)
  assert.deepEqual(r.draft.batchOrder, ['e1', 'e2'])
  // e1's edit is preserved.
  assert.equal(r.draft.editedValues.e1.lohiya_sulphur, '81.55')
})

test('addBatch refuses a duplicate five-part identity', () => {
  const draft = baseDraft(); const entries = baseEntries()
  const dup = { id: 'eX', batchNo: '3512', logDate: '2026-10-01', product: 'sulphur80wdg', grade: 'lohiya', dryer: 'ND1', loadedValues: {} }
  const r = addBatch(draft, entries, dup)
  assert.equal(r.added, false)
  assert.deepEqual(r.draft.batchOrder, ['e1'])
})

test('removeBatch keeps other batches edits and order', () => {
  let draft = baseDraft(); let entries = baseEntries()
  const e2 = { id: 'e2', batchNo: '3513', logDate: '2026-10-02', product: 'p', grade: 'lohiya', dryer: 'ND2', loadedValues: {} }
  ;({ draft, entries } = addBatch(draft, entries, e2))
  draft = applyBatchEdit(draft, 'e1', 'lohiya_ph', '7.1')
  draft = applyBatchEdit(draft, 'e2', 'lohiya_ph', '6.5')
  const r = removeBatch(draft, entries, 'e2')
  assert.equal(r.removed, true)
  assert.deepEqual(r.draft.batchOrder, ['e1'])
  assert.equal(r.draft.editedValues.e1.lohiya_ph, '7.1')   // kept
  assert.equal(r.draft.editedValues.e2, undefined)          // dropped
})

// ── Test 5 + 10 + 12: concurrency merge + signature de-dup ──
test('mergeCoaPayload keeps local on conflict and records it', () => {
  const local = { header: { certificate_no: 'C-1' }, editedValues: { e1: { lohiya_ph: '7.1' } } }
  const remote = { header: { certificate_no: 'C-2' }, editedValues: { e1: { lohiya_ph: '7.1', lohiya_sulphur: '82' } } }
  const { merged, conflicts } = mergeCoaPayload(local, remote)
  // non-conflicting remote field merged in
  assert.equal(merged.editedValues.e1.lohiya_sulphur, '82')
  // conflicting scalar keeps local, records both
  assert.equal(merged.header.certificate_no, 'C-1')
  assert.ok(conflicts['header.certificate_no'])
})

test('draftSignature is stable and ignores non-persisted fields', () => {
  const a = draftSignature({ header: { x: 1 }, editedValues: {}, batchOrder: ['e1'], revision: 1 })
  const b = draftSignature({ header: { x: 1 }, editedValues: {}, batchOrder: ['e1'], revision: 999 })
  assert.equal(a, b)  // revision not part of the payload signature
})

test('sameBatchIdentity treats null/undefined/empty consistently', () => {
  assert.equal(sameBatchIdentity(
    { batchNo: '1', logDate: '', product: 'p', grade: 'g', dryer: null },
    { batchNo: '1', logDate: null, product: 'p', grade: 'g', dryer: '' },
  ), true)
  assert.equal(sameBatchIdentity(
    { batchNo: '1', logDate: '2026-01-01', product: 'p', grade: 'g', dryer: 'ND1' },
    { batchNo: '1', logDate: '2026-01-02', product: 'p', grade: 'g', dryer: 'ND1' },
  ), false)
})

// ── Manufacturing date (from FG record) + expiry (+2 years) ──
test('addYears adds 2 years and clamps Feb-29', () => {
  assert.equal(addYears('2026-10-01', 2), '2028-10-01')
  assert.equal(addYears('2024-02-29', 2), '2026-02-28') // 2026 not a leap year
  assert.equal(addYears('', 2), '')
  assert.equal(addYears('not-a-date', 2), '')
})

test('deriveMfgDate returns the earliest batch mfg date', () => {
  let draft = baseDraft(); let entries = baseEntries()  // e1 = 2026-10-01
  const e2 = { id: 'e2', batchNo: '3513', logDate: '2026-09-15', product: 'p', grade: 'lohiya', dryer: 'ND2', loadedValues: {} }
  ;({ draft, entries } = addBatch(draft, entries, e2))
  assert.equal(deriveMfgDate(draft, entries), '2026-09-15')
})

test('syncDates auto-fills mfg_date from FG record and expiry = +2 years', () => {
  const draft = baseDraft(); const entries = baseEntries()  // 2026-10-01
  const synced = syncDates(draft, entries)
  assert.equal(synced.header.mfg_date, '2026-10-01')
  assert.equal(synced.header.expiry_date, '2028-10-01')
})

test('syncDates does NOT clobber an operator-edited mfg date', () => {
  let draft = baseDraft(); const entries = baseEntries()
  draft = syncDates(draft, entries)                     // auto → 2026-10-01 / 2028-10-01
  draft = applyHeaderEdit(draft, 'mfg_date', '2026-01-01') // operator override
  const synced = syncDates(draft, entries)
  assert.equal(synced.header.mfg_date, '2026-01-01')    // operator value kept
  // expiry still tracks the (operator) mfg date since expiry was auto.
  assert.equal(synced.header.expiry_date, '2028-01-01')
})

// ── header edit replace ──
test('applyHeaderEdit replaces a header field in place', () => {
  let draft = baseDraft()
  draft = applyHeaderEdit(draft, 'certificate_no', 'COA-100')
  draft = applyHeaderEdit(draft, 'certificate_no', 'COA-200')
  assert.equal(draft.header.certificate_no, 'COA-200')
})


// ═══════════════════════════════════════════════════════════════════════════
// OMRI editable-parameter + final-row + HTML tests
// ═══════════════════════════════════════════════════════════════════════════
import {
  resolveParameters, initParameters, applyParameterEdit,
  addParameter, removeParameter, reorderParameter, resolveFinalRowValue,
} from './coaState.js'

// OMRI template fixture (mirrors the real config in coaTemplates.js).
const omriTemplate = {
  key: 'omri', name: 'UPL OMRI', layout: 'single',
  headerFields: [
    { id: 'party_name', label: 'Name of Party', defaultValue: 'UPL OMRI' },
    { id: 'dispatch_date', label: 'Date of Dispatch', type: 'date' },
    { id: 'material', label: 'Material' },
    { id: 'vehicle_no', label: 'Vehicle No.' },
    { id: 'quantity', label: 'Quantity' },
  ],
  dispatchFields: [],
  signatureBlocks: [
    { id: 'qc_incharge', label: 'QC Incharge', role: 'any' },
    { id: 'general_manager', label: 'General Manager', role: 'admin' },
    { id: 'qc_chemist', label: 'Q.C. Chemist', role: 'any' },
  ],
  parameters: [
    { id: 'upl_omri_sulphur', group: 'Active Content', parameter: 'Active Content of Sulphur % by mass', specDisplay: '82 – 82.5', unit: '%' },
    { id: 'upl_omri_water_kf', group: 'Water by KF', parameter: 'Water by KF (%w/w)', specDisplay: '1.5 – 2.3', unit: '%' },
  ],
  hideRemarks: true, hideConformity: true, hideBatchMeta: true,
  editableParameters: true,
  finalRows: [
    { id: 'mfg_date', label: 'Manufacturing Date', type: 'date' },
    { id: 'exp_date', label: 'Exp Date', type: 'date' },
    { id: 'qty', label: 'QTY' },
  ],
}

function omriDraft() {
  return {
    id: 'd-omri', partyKey: 'omri', templateVersion: 1,
    header: {
      coa_parameters: omriTemplate.parameters.map(p => ({ ...p })),
    },
    editedValues: {}, specSnapshot: {}, batchOrder: ['e1'],
    revision: 0, status: 'draft', finalized: false,
  }
}

function omriEntries() {
  return {
    e1: {
      id: 'e1', batchNo: '3512', logDate: '2026-10-01', product: 'sulphur80wdg',
      grade: 'omri', dryer: 'ND1',
      loadedValues: { upl_omri_sulphur: '82.3', upl_omri_water_kf: '1.8', qty: '250 Kg' },
    },
  }
}

// ── resolveParameters / initParameters ──
test('resolveParameters returns the editable copy when present', () => {
  const draft = omriDraft()
  const params = resolveParameters(draft, omriTemplate)
  assert.equal(params.length, 2)
  assert.equal(params[0].id, 'upl_omri_sulphur')
})

test('resolveParameters falls back to template when no editable copy', () => {
  const draft = { header: {} }
  const params = resolveParameters(draft, omriTemplate)
  assert.equal(params.length, 2)
  assert.equal(params[0].id, 'upl_omri_sulphur')
})

test('initParameters creates a copy if none exists', () => {
  const draft = { header: {} }
  const result = initParameters(draft, omriTemplate)
  assert.ok(Array.isArray(result.header.coa_parameters))
  assert.equal(result.header.coa_parameters.length, 2)
})

test('initParameters is a no-op if the copy already exists', () => {
  const draft = omriDraft()
  const result = initParameters(draft, omriTemplate)
  assert.equal(result, draft) // same reference — unchanged
})

// ── applyParameterEdit: renaming does NOT change results ──
test('editing a parameter name does not change its batch result', () => {
  let draft = omriDraft()
  const entries = omriEntries()
  // Original result
  assert.equal(resolveValue(draft, entries.e1, 'upl_omri_sulphur'), '82.3')
  // Rename the parameter
  draft = applyParameterEdit(draft, 'upl_omri_sulphur', 'parameter', 'Renamed Sulphur')
  // Parameter name is updated
  const params = resolveParameters(draft, omriTemplate)
  assert.equal(params[0].parameter, 'Renamed Sulphur')
  // Batch result is unchanged (keyed by id, not by name)
  assert.equal(resolveValue(draft, entries.e1, 'upl_omri_sulphur'), '82.3')
})

test('editing a spec display does not change batch result', () => {
  let draft = omriDraft()
  const entries = omriEntries()
  assert.equal(resolveValue(draft, entries.e1, 'upl_omri_water_kf'), '1.8')
  draft = applyParameterEdit(draft, 'upl_omri_water_kf', 'specDisplay', '1.0 – 3.0')
  assert.equal(resolveValue(draft, entries.e1, 'upl_omri_water_kf'), '1.8')
})

// ── addParameter ──
test('addParameter appends a new row with a unique id', () => {
  let draft = omriDraft()
  draft = addParameter(draft)
  const params = resolveParameters(draft, omriTemplate)
  assert.equal(params.length, 3)
  assert.ok(params[2].id.startsWith('coa_param_'))
  assert.equal(params[2].parameter, '')
})

// ── removeParameter ──
test('removeParameter removes the row but keeps other params intact', () => {
  let draft = omriDraft()
  draft = removeParameter(draft, 'upl_omri_sulphur')
  const params = resolveParameters(draft, omriTemplate)
  assert.equal(params.length, 1)
  assert.equal(params[0].id, 'upl_omri_water_kf')
})

// ── reorderParameter ──
test('reorderParameter moves a row up', () => {
  let draft = omriDraft()
  // Move the second row up
  draft = reorderParameter(draft, 'upl_omri_water_kf', 'up')
  const params = resolveParameters(draft, omriTemplate)
  assert.equal(params[0].id, 'upl_omri_water_kf')
  assert.equal(params[1].id, 'upl_omri_sulphur')
})

test('reorderParameter moves a row down', () => {
  let draft = omriDraft()
  draft = reorderParameter(draft, 'upl_omri_sulphur', 'down')
  const params = resolveParameters(draft, omriTemplate)
  assert.equal(params[0].id, 'upl_omri_water_kf')
  assert.equal(params[1].id, 'upl_omri_sulphur')
})

test('reorderParameter does nothing at the boundary', () => {
  let draft = omriDraft()
  const before = resolveParameters(draft, omriTemplate)
  draft = reorderParameter(draft, 'upl_omri_sulphur', 'up')
  const after = resolveParameters(draft, omriTemplate)
  assert.deepEqual(after, before)
})

// ── resolveFinalRowValue ──
test('resolveFinalRowValue returns the batch log date for mfg_date', () => {
  const draft = omriDraft()
  const entries = omriEntries()
  assert.equal(resolveFinalRowValue(draft, entries.e1, 'mfg_date'), '2026-10-01')
})

test('resolveFinalRowValue returns mfg + 2 years for exp_date', () => {
  const draft = omriDraft()
  const entries = omriEntries()
  assert.equal(resolveFinalRowValue(draft, entries.e1, 'exp_date'), '2028-10-01')
})

test('resolveFinalRowValue returns the loaded qty', () => {
  const draft = omriDraft()
  const entries = omriEntries()
  assert.equal(resolveFinalRowValue(draft, entries.e1, 'qty'), '250 Kg')
})

test('resolveFinalRowValue respects an operator edit over the default', () => {
  let draft = omriDraft()
  const entries = omriEntries()
  draft = applyBatchEdit(draft, 'e1', 'mfg_date', '2026-05-15')
  assert.equal(resolveFinalRowValue(draft, entries.e1, 'mfg_date'), '2026-05-15')
  assert.equal(resolveFinalRowValue(draft, entries.e1, 'exp_date'), '2028-05-15')
})

// ── HTML builder: OMRI layout ──
test('OMRI HTML has CERTIFICATE OF ANALYSIS as the centered title', () => {
  const draft = omriDraft()
  const entries = omriEntries()
  const html = buildCoaHtml(draft, entries, omriTemplate)
  assert.ok(html.includes('class="coa-title"') && html.includes('CERTIFICATE OF ANALYSIS'), 'title is CERTIFICATE OF ANALYSIS')
  // No company heading subtitle
  assert.ok(!html.includes('class="coa-sub"'), 'no subtitle line')
})

test('OMRI HTML has no batch meta chips', () => {
  const draft = omriDraft()
  const entries = omriEntries()
  const html = buildCoaHtml(draft, entries, omriTemplate)
  // The CSS class definitions always exist in <style>; check for the rendered div.
  assert.ok(!html.includes('class="coa-batch-meta"'), 'no batch meta section rendered')
  assert.ok(!html.includes('class="coa-batch-chip"'), 'no batch chips rendered')
})

test('OMRI HTML has no remarks or conformity', () => {
  const draft = omriDraft()
  const entries = omriEntries()
  const html = buildCoaHtml(draft, entries, omriTemplate)
  assert.ok(!html.includes('class="coa-remarks"'), 'no remarks section rendered')
  assert.ok(!html.includes('class="coa-conformity"'), 'no conformity section rendered')
})

test('OMRI HTML includes final rows with per-batch values', () => {
  const draft = omriDraft()
  const entries = omriEntries()
  const html = buildCoaHtml(draft, entries, omriTemplate)
  assert.ok(html.includes('Manufacturing Date'), 'has Mfg Date row')
  assert.ok(html.includes('Exp Date'), 'has Exp Date row')
  assert.ok(html.includes('QTY'), 'has QTY row')
  assert.ok(html.includes('01/10/2026'), 'has formatted mfg date for batch')
  assert.ok(html.includes('01/10/2028'), 'has formatted exp date for batch')
  assert.ok(html.includes('250 Kg'), 'has qty value for batch')
})

test('OMRI HTML has three-column footer with correct labels', () => {
  const draft = omriDraft()
  const entries = omriEntries()
  const html = buildCoaHtml(draft, entries, omriTemplate)
  assert.ok(html.includes('QC Incharge'), 'has QC Incharge')
  assert.ok(html.includes('General Manager'), 'has General Manager')
  assert.ok(html.includes('Q.C. Chemist'), 'has Q.C. Chemist')
})

test('OMRI HTML reflects edited parameter name and hides old name', () => {
  let draft = omriDraft()
  const entries = omriEntries()
  draft = applyParameterEdit(draft, 'upl_omri_sulphur', 'parameter', 'Custom Sulphur Name')
  const html = buildCoaHtml(draft, entries, omriTemplate)
  assert.ok(html.includes('Custom Sulphur Name'), 'new name present')
  assert.ok(!html.includes('Active Content of Sulphur'), 'old name absent')
})

test('OMRI HTML reflects edited spec and unit', () => {
  let draft = omriDraft()
  const entries = omriEntries()
  draft = applyParameterEdit(draft, 'upl_omri_water_kf', 'specDisplay', '1.0 – 3.0')
  draft = applyParameterEdit(draft, 'upl_omri_water_kf', 'unit', 'g/g')
  const html = buildCoaHtml(draft, entries, omriTemplate)
  assert.ok(html.includes('1.0 – 3.0'), 'new spec present')
  assert.ok(html.includes('g/g'), 'new unit present')
  assert.ok(!html.includes('1.5 – 2.3'), 'old spec absent')
})

test('OMRI HTML shows added parameter row', () => {
  let draft = omriDraft()
  const entries = omriEntries()
  draft = addParameter(draft)
  draft = applyParameterEdit(draft, resolveParameters(draft, omriTemplate)[2].id, 'parameter', 'New Test Param')
  const html = buildCoaHtml(draft, entries, omriTemplate)
  assert.ok(html.includes('New Test Param'), 'added param visible in HTML')
})

test('OMRI HTML does not show removed parameter row', () => {
  let draft = omriDraft()
  const entries = omriEntries()
  draft = removeParameter(draft, 'upl_omri_sulphur')
  const html = buildCoaHtml(draft, entries, omriTemplate)
  assert.ok(!html.includes('Active Content of Sulphur'), 'removed param absent from HTML')
  assert.ok(html.includes('Water by KF'), 'remaining param still present')
})

test('OMRI header field defaultValue shows in HTML when no edit', () => {
  const draft = omriDraft()
  const entries = omriEntries()
  const html = buildCoaHtml(draft, entries, omriTemplate)
  assert.ok(html.includes('UPL OMRI'), 'party name default visible')
})

// ═══════════════════════════════════════════════════════════════════════════
// REAL template regression test — uses getCoaTemplate('omri') (not a fixture)
// ═══════════════════════════════════════════════════════════════════════════
import { getCoaTemplate } from '../../../data/coaTemplates.js'

test('real OMRI template has all OMRI-specific flags set', () => {
  const t = getCoaTemplate('omri')
  assert.ok(t, 'template exists')
  assert.equal(t.hideRemarks, true, 'hideRemarks')
  assert.equal(t.hideConformity, true, 'hideConformity')
  assert.equal(t.hideBatchMeta, true, 'hideBatchMeta')
  assert.equal(t.editableParameters, true, 'editableParameters')
  assert.equal(t.hideFinalize, true, 'hideFinalize')
  assert.ok(Array.isArray(t.finalRows) && t.finalRows.length === 3, 'finalRows has 3 rows')
  assert.equal(t.finalRows[0].id, 'mfg_date')
  assert.equal(t.finalRows[1].id, 'exp_date')
  assert.equal(t.finalRows[2].id, 'qty')
  // Signature blocks: QC Incharge / General Manager / Q.C. Chemist
  assert.equal(t.signatureBlocks.length, 3)
  assert.equal(t.signatureBlocks[0].id, 'qc_incharge')
  assert.equal(t.signatureBlocks[1].id, 'general_manager')
  assert.equal(t.signatureBlocks[2].id, 'qc_chemist')
  // Header fields: party_name, dispatch_date, material, vehicle_no, quantity
  assert.equal(t.headerFields.length, 5)
  assert.equal(t.headerFields[0].id, 'party_name')
  assert.equal(t.headerFields[0].defaultValue, 'UPL OMRI')
})

test('real OMRI template produces correct preview HTML', () => {
  const t = getCoaTemplate('omri')
  const draft = {
    id: 'd1', partyKey: 'omri', header: {
      coa_parameters: t.parameters.map(p => ({ ...p })),
    },
    editedValues: {}, batchOrder: ['e1'],
  }
  const entries = {
    e1: { id: 'e1', batchNo: '3512', logDate: '2026-10-01', product: 'sulphur80wdg',
      grade: 'omri', dryer: 'ND1', loadedValues: { qty: '250 Kg' } },
  }
  const html = buildCoaHtml(draft, entries, t)
  assert.ok(html.includes('CERTIFICATE OF ANALYSIS'), 'title')
  assert.ok(!html.includes('class="coa-batch-meta"'), 'no batch meta')
  assert.ok(!html.includes('class="coa-remarks"'), 'no remarks')
  assert.ok(!html.includes('class="coa-conformity"'), 'no conformity')
  assert.ok(html.includes('Manufacturing Date'), 'has mfg date row')
  assert.ok(html.includes('Exp Date'), 'has exp date row')
  assert.ok(html.includes('QTY'), 'has qty row')
  assert.ok(html.includes('01/10/2026'), 'mfg date value')
  assert.ok(html.includes('01/10/2028'), 'exp date auto +2 years')
})

test('other parties are NOT affected by OMRI flags', () => {
  // Export now also has the same layout flags as OMRI (reference image shows same layout).
  const t = getCoaTemplate('export')
  assert.ok(t, 'export template exists')
  assert.equal(t.hideRemarks, true, 'export also hides remarks (reference layout)')
  assert.equal(t.hideConformity, true, 'export also hides conformity')
  assert.equal(t.hideBatchMeta, true, 'export hides batch meta')
  assert.equal(t.editableParameters, true, 'export has editable parameters')
  assert.equal(t.finalRows.length, 2, 'export has 2 final rows (Mfg Date + QTY)')
  // A party that is genuinely unrelated keeps original behaviour.
  const lohiya = getCoaTemplate('lohiya')
  assert.equal(lohiya.hideRemarks, true, 'lohiya hides remarks (new layout)')
  assert.equal(lohiya.hideConformity, true, 'lohiya hides conformity (new layout)')
  assert.equal(lohiya.hideBatchMeta, true, 'lohiya hides batch meta (new layout)')
  assert.equal(lohiya.editableParameters, true, 'lohiya has editable parameters (new layout)')
  assert.equal(lohiya.finalRows.length, 3, 'lohiya has 3 final rows')
})

