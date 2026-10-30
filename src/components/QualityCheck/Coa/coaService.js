// ═══════════════════════════════════════════════════════════════════════════
// coaService — Supabase data access for the COA module (migration 048).
// ---------------------------------------------------------------------------
// Keeps all COA-specific queries in one place (the project calls supabase.from
// directly from components; this mirrors how useDraft.js / dryerHistory.js
// factor helpers out). Everything here READS quality_control_records as the
// authoritative source and NEVER writes it (task §6).
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, supabaseReady } from '../../../supabaseClient.js'

// Create a new empty COA draft for a party. Returns the new draft id or null.
// `initialHeader` lets the caller seed header JSON at creation (e.g. the editable
// parameter copy for OMRI); it is shallow-merged into the stored `header` column.
export async function createCoaDraft({ partyKey, templateVersion, product, specSnapshot, userName, initialHeader }) {
  if (!supabaseReady || !supabase) return null
  const nowIso = new Date().toISOString()
  const { data, error } = await supabase
    .from('coa_draft')
    .insert({
      party_key: partyKey,
      template_version: templateVersion || 1,
      product: product || null,
      header: { ...(initialHeader || {}) },
      edited_values: {},
      spec_snapshot: specSnapshot || {},
      batch_order: [],
      revision: 0,
      status: 'draft',
      finalized: false,
      created_by: userName || '',
      updated_by: userName || '',
      created_at: nowIso,
      updated_at: nowIso,
      last_saved_at: nowIso,
    })
    .select('id')
    .single()
  if (error) return null
  return data.id
}

// Search authoritative FG records by batch number. Returns an array of candidate
// identities so the caller can DISAMBIGUATE (never silently take the first).
// Each candidate: { sourceRecordId, batchNo, logDate, product, grade, dryer, values }.
export async function searchBatches(batchNo) {
  if (!supabaseReady || !supabase || !batchNo) return []
  const needle = String(batchNo).trim()
  if (!needle) return []
  // Match the batch number inside the FG values jsonb. We filter tab='fg' and
  // compare values->>'batch_no'. Fetch recent matches ordered newest-first.
  const { data, error } = await supabase
    .from('quality_control_records')
    .select('id, created_at, values')
    .eq('tab', 'fg')
    .eq('values->>batch_no', needle)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error || !data) return []
  return data.map(r => {
    const v = r.values || {}
    return {
      sourceRecordId: r.id,
      batchNo: v.batch_no || needle,
      logDate: v.date || '',
      product: v.product || '',
      grade: v.grade || '',
      dryer: v.dryer || '',
      values: v,
    }
  })
}

// Persist a newly added batch column. Returns the created entry row (mapped) or
// null. The DB unique (coa_draft_id, batch_no, log_date, grade, dryer) rejects a
// duplicate column → a 23505 is reported as added:false.
export async function insertBatchEntry(draftId, candidate, position) {
  if (!supabaseReady || !supabase || !draftId) return { entry: null, duplicate: false, error: true }
  const { data, error } = await supabase
    .from('coa_batch_entry')
    .insert({
      coa_draft_id: draftId,
      source_record_id: candidate.sourceRecordId || null,
      batch_no: candidate.batchNo,
      log_date: candidate.logDate || null,
      product: candidate.product || null,
      grade: candidate.grade || null,
      dryer: candidate.dryer || null,
      loaded_values: candidate.values || {},
      position: position || 0,
    })
    .select('*')
    .single()
  if (error) {
    const duplicate = String(error.code) === '23505'
    return { entry: null, duplicate, error: !duplicate }
  }
  return {
    entry: {
      id: data.id, sourceRecordId: data.source_record_id, batchNo: data.batch_no,
      logDate: data.log_date, product: data.product, grade: data.grade, dryer: data.dryer,
      loadedValues: data.loaded_values || {}, position: data.position,
    },
    duplicate: false, error: false,
  }
}

// Remove a batch column (only allowed while the draft is not finalized — RLS
// enforces this too).
export async function deleteBatchEntry(entryId) {
  if (!supabaseReady || !supabase || !entryId) return false
  const { error } = await supabase.from('coa_batch_entry').delete().eq('id', entryId)
  return !error
}

// Finalize: write an IMMUTABLE issued snapshot. IDEMPOTENT via the unique
// certificate_no — a repeated finalize/print with the same certificate number
// returns the existing row instead of creating a duplicate (23505 handled).
export async function finalizeCoa({ draftId, certificateNo, partyKey, templateVersion, snapshot, userName, supersedes }) {
  if (!supabaseReady || !supabase || !draftId || !certificateNo) return { issued: null, error: true }

  // Lock the draft first (version-independent: finalize is terminal).
  await supabase.from('coa_draft')
    .update({ finalized: true, status: 'finalized', updated_at: new Date().toISOString() })
    .eq('id', draftId)

  const { data, error } = await supabase
    .from('coa_issued')
    .insert({
      coa_draft_id: draftId,
      certificate_no: certificateNo,
      party_key: partyKey,
      template_version: templateVersion || 1,
      snapshot,
      supersedes: supersedes || null,
      issued_by: userName || '',
    })
    .select('*')
    .single()

  if (error) {
    if (String(error.code) === '23505') {
      // Already issued with this certificate number → return the existing row.
      const { data: existing } = await supabase
        .from('coa_issued').select('*').eq('certificate_no', certificateNo).maybeSingle()
      return { issued: existing || null, error: false, duplicate: true }
    }
    return { issued: null, error: true }
  }
  return { issued: data, error: false }
}
