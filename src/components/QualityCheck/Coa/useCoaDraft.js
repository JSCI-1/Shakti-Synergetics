// ═══════════════════════════════════════════════════════════════════════════
// useCoaDraft — server-backed COA draft with optimistic concurrency.
// ---------------------------------------------------------------------------
// Direct clone of the proven Finished Goods shared-draft driver in
// QualityCheck.jsx (saveFgSharedDraft / mergeFgPayload / finalizeFgSharedDraft),
// adapted to the coa_draft / coa_batch_entry / coa_issued tables (migration 048).
//
// Guarantees (task §2, §8):
//   • The DB draft (highest revision) is the single source of truth after load.
//   • Version-checked UPDATE (.eq('revision', baseRev)): a stale/delayed write
//     can never clobber a newer edit; on conflict we re-pull + merge.
//   • localStorage is a bounded convenience cache only — on load the DB wins and
//     localStorage is reconciled, never applied over a newer DB revision.
//   • Finalize is idempotent (coa_issued.certificate_no is unique); a repeated
//     Save/Finalize/Print does not create a duplicate record.
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, supabaseReady } from '../../../supabaseClient.js'
import { mergeCoaPayload, draftSignature } from './coaState.js'

const POLL_MS = 15000
const AUTOSAVE_MS = 900

// Load a draft + its batch entries by draft id. Returns { draft, entries } or null.
export async function loadCoaDraft(draftId) {
  if (!supabaseReady || !supabase || !draftId) return null
  const { data: d, error } = await supabase
    .from('coa_draft')
    .select('*')
    .eq('id', draftId)
    .maybeSingle()
  if (error || !d) return null

  const { data: rows } = await supabase
    .from('coa_batch_entry')
    .select('*')
    .eq('coa_draft_id', draftId)
    .order('position', { ascending: true })

  const entries = {}
  ;(rows || []).forEach(r => {
    entries[r.id] = {
      id: r.id,
      sourceRecordId: r.source_record_id,
      batchNo: r.batch_no,
      logDate: r.log_date,
      product: r.product,
      grade: r.grade,
      dryer: r.dryer,
      loadedValues: r.loaded_values || {},
      position: r.position,
    }
  })

  return {
    draft: {
      id: d.id,
      partyKey: d.party_key,
      templateVersion: d.template_version,
      product: d.product,
      header: d.header || {},
      editedValues: d.edited_values || {},
      specSnapshot: d.spec_snapshot || {},
      batchOrder: Array.isArray(d.batch_order) ? d.batch_order : [],
      revision: d.revision,
      status: d.status,
      finalized: d.finalized,
      updatedBy: d.updated_by,
      createdBy: d.created_by,
    },
    entries,
  }
}

export function useCoaDraft({ draftId, userName }) {
  const [draft, setDraft] = useState(null)
  const [entries, setEntries] = useState({})
  const [conflicts, setConflicts] = useState({})
  const [status, setStatus] = useState('')        // 'saving' | 'saved' | 'error' | ''
  const [finalizedByOther, setFinalizedByOther] = useState(false)

  const revRef = useRef(null)      // last server revision this device saw
  const pushedSigRef = useRef('')  // last payload signature we pushed
  const readyRef = useRef(false)   // skip the first autosave after (re)bind
  const draftRef = useRef(null)    // freshest draft for the saver closure
  const entriesRef = useRef({})

  useEffect(() => { draftRef.current = draft }, [draft])
  useEffect(() => { entriesRef.current = entries }, [entries])

  const lsKey = draftId ? `coa:draft:${draftId}` : ''

  // ── Initial load: DB wins; reconcile a bounded localStorage cache into it ──
  useEffect(() => {
    if (!draftId) return
    let cancelled = false
    readyRef.current = false
    ;(async () => {
      const loaded = await loadCoaDraft(draftId)
      if (cancelled) return
      if (!loaded) { setDraft(null); return }

      revRef.current = loaded.draft.revision
      setFinalizedByOther(!!loaded.draft.finalized)

      // Reconcile a local cache ONLY as a merge INTO the authoritative DB draft.
      // The DB (highest revision) always wins; the cache can only fill gaps.
      let base = loaded.draft
      try {
        const raw = lsKey ? localStorage.getItem(lsKey) : null
        if (raw) {
          const cached = JSON.parse(raw)
          // Never let a cache from an older-or-equal revision override the DB.
          if (cached && typeof cached.rev === 'number' && cached.rev > loaded.draft.revision && cached.payload) {
            const { merged } = mergeCoaPayload(cached.payload, {
              header: loaded.draft.header,
              editedValues: loaded.draft.editedValues,
              batchOrder: loaded.draft.batchOrder,
            })
            base = { ...loaded.draft, ...merged }
          }
        }
      } catch { /* ignore bad cache */ }

      setDraft(base)
      setEntries(loaded.entries)
      pushedSigRef.current = draftSignature(base)
    })()
    return () => { cancelled = true }
  }, [draftId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Poll: pull remote → merge into local without clobbering newer local ──
  useEffect(() => {
    if (!draftId || !supabaseReady || !supabase) return
    let cancelled = false
    const pull = async () => {
      try {
        const { data, error } = await supabase
          .from('coa_draft')
          .select('header, edited_values, batch_order, revision, finalized, status')
          .eq('id', draftId)
          .maybeSingle()
        if (cancelled || error || !data) return
        if (data.finalized) { revRef.current = data.revision; setFinalizedByOther(true); return }
        // Only merge when the remote is actually newer than what we based on.
        if (typeof data.revision === 'number' && revRef.current !== null && data.revision <= revRef.current) return
        revRef.current = data.revision
        setDraft(prev => {
          if (!prev) return prev
          const { merged, conflicts: c } = mergeCoaPayload(
            { header: prev.header, editedValues: prev.editedValues, batchOrder: prev.batchOrder },
            { header: data.header || {}, editedValues: data.edited_values || {}, batchOrder: Array.isArray(data.batch_order) ? data.batch_order : [] },
          )
          if (Object.keys(c).length) setConflicts(prevC => ({ ...prevC, ...c }))
          return { ...prev, ...merged, revision: data.revision }
        })
        // Batch entries can change on another device (add/remove) — refresh them.
        const { data: rows } = await supabase
          .from('coa_batch_entry').select('*').eq('coa_draft_id', draftId).order('position', { ascending: true })
        if (!cancelled && rows) {
          const next = {}
          rows.forEach(r => { next[r.id] = {
            id: r.id, sourceRecordId: r.source_record_id, batchNo: r.batch_no,
            logDate: r.log_date, product: r.product, grade: r.grade, dryer: r.dryer,
            loadedValues: r.loaded_values || {}, position: r.position } })
          setEntries(next)
        }
      } catch { /* transient poll error — next tick retries */ }
    }
    const id = setInterval(pull, POLL_MS)
    const onVis = () => { if (document.visibilityState === 'visible') pull() }
    document.addEventListener('visibilitychange', onVis)
    return () => { cancelled = true; clearInterval(id); document.removeEventListener('visibilitychange', onVis) }
  }, [draftId])

  // ── Core writer: version-checked UPDATE of the draft payload ──
  const save = useCallback(async () => {
    const d = draftRef.current
    if (!supabaseReady || !supabase || !d || !d.id) return 'skipped'
    if (finalizedByOther) return 'finalized'

    const payload = { header: d.header || {}, editedValues: d.editedValues || {}, batchOrder: d.batchOrder || [] }
    const sig = draftSignature(d)
    if (sig === pushedSigRef.current) return 'skipped'

    const baseRev = revRef.current
    const nowIso = new Date().toISOString()
    try {
      const { data, error } = await supabase
        .from('coa_draft')
        .update({
          header: payload.header,
          edited_values: payload.editedValues,
          batch_order: payload.batchOrder,
          revision: (baseRev ?? 0) + 1,
          updated_by: userName || '',
          updated_at: nowIso,
          last_saved_at: nowIso,
        })
        .eq('id', d.id)
        .eq('revision', baseRev ?? 0)
        .is('finalized', false)
        .select('revision')
        .maybeSingle()

      if (error) return 'error'
      if (!data) {
        // Stale revision (or finalized): re-pull + merge, never clobber.
        const { data: fresh } = await supabase
          .from('coa_draft')
          .select('header, edited_values, batch_order, revision, finalized')
          .eq('id', d.id).maybeSingle()
        if (fresh) {
          revRef.current = fresh.revision
          if (fresh.finalized) { setFinalizedByOther(true); return 'finalized' }
          setDraft(prev => {
            const { merged, conflicts: c } = mergeCoaPayload(
              { header: prev.header, editedValues: prev.editedValues, batchOrder: prev.batchOrder },
              { header: fresh.header || {}, editedValues: fresh.edited_values || {}, batchOrder: Array.isArray(fresh.batch_order) ? fresh.batch_order : [] },
            )
            if (Object.keys(c).length) setConflicts(prevC => ({ ...prevC, ...c }))
            return { ...prev, ...merged, revision: fresh.revision }
          })
        }
        return 'conflict'
      }

      revRef.current = data.revision
      pushedSigRef.current = sig
      // Bounded cache: store only the latest payload + its revision.
      try { if (lsKey) localStorage.setItem(lsKey, JSON.stringify({ rev: data.revision, payload })) } catch { /* quota */ }
      return 'saved'
    } catch {
      return 'error'
    }
  }, [userName, finalizedByOther, lsKey])

  // ── Debounced autosave ──
  const timerRef = useRef(null)
  const sig = draft ? draftSignature(draft) : ''
  useEffect(() => {
    if (!draftId || !supabaseReady || !supabase || !draft) return
    if (finalizedByOther) return
    if (!readyRef.current) { readyRef.current = true; return }
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      setStatus('saving')
      const r = await save()
      setStatus(r === 'saved' ? 'saved' : r === 'error' || r === 'conflict' ? 'error' : '')
    }, AUTOSAVE_MS)
    return () => clearTimeout(timerRef.current)
  }, [sig, draftId, finalizedByOther]) // eslint-disable-line react-hooks/exhaustive-deps

  const flush = useCallback(async () => {
    clearTimeout(timerRef.current)
    return save()
  }, [save])

  return {
    draft, setDraft, entries, setEntries,
    conflicts, setConflicts,
    status, finalizedByOther,
    revRef, save, flush,
  }
}
