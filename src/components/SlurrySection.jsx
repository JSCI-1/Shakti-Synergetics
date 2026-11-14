import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { supabase, supabaseReady } from '../supabaseClient'
import { useDraft, useUserId } from '../utils/useDraft.js'
import { useSharedDraft, deleteSharedDraft, fetchLatestSaved } from '../utils/useSharedDraft.js'
import SharedStatus from './SharedStatus.jsx'
import './SlurrySection.css'

const DEFAULT_INPUT_OPTIONS = [
  'WATER', 'Crude Sulphur', 'Sulphur powder',
  'Fine powder', 'Gujmol DN Liquid', 'Gujmol DN Powder',
  'Tamol DN Powder', 'FBPP', 'FZ1', 'Defoamer', 'China Clay',
  'Domsjo DS-10', 'Domsjo DA-30', 'Borresperse-NA', 'Borresperse-Ca',
  'Greensperse-Ca',
]

const BATCH_OPTIONS = [
  {
    group: 'Attrition Mills / अट्रिशन मिल्स',
    options: [
      { label: '1st Attrition Mill — 1.6 MT', value: 'Attrition-1st-1.6MT' },
      { label: '2nd Attrition Mill — 1.2 MT', value: 'Attrition-2nd-1.2MT' },
    ],
  },
  {
    group: 'HST (High Speed Tank) / उच्च गति टैंक',
    options: [
      { label: 'HST 1st — 8 MT', value: 'HST-1st-8MT' },
      { label: 'HST 2nd — 6 MT', value: 'HST-2nd-6MT' },
    ],
  },
]

// ─── helpers ────────────────────────────────────────────────

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function uid() {
  return String(Date.now()) + String(Math.random()).slice(2, 8)
}

function stamp12hr() {
  return new Date().toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  })
}

function emptyBatchRow(name = '') {
  return { id: uid(), inputName: name, origin: '', batchNo: '', qty: '', timestamp: '' }
}

function emptyBatchCard(prefillNames = []) {
  return {
    id: uid(),
    batchNo: '',
    tankType: '',
    rows: prefillNames.length > 0
      ? prefillNames.map(n => emptyBatchRow(n))
      : [emptyBatchRow()],
    completed:   false,
    completedAt: null,
    firstStamp:  null,
    lastStamp:   null,
    locked:      false,
    expanded:    true,
  }
}

function emptyForm() {
  return {
    date: '',
    shift: '',
    operator_name: '',
    operator: '',
    supervisor: '',
    manager: '',
  }
}

// ─────────────────────────────────────────────────────────────
// InputDropdown — searchable native select with add-new
// ─────────────────────────────────────────────────────────────
function InputDropdown({ value, onChange, allOptions, defaultOptions, recentlyUsed, usedInForm, onAddNew, onDelete }) {
  const [addingNew, setAddingNew] = useState(false)
  const [managing, setManaging]   = useState(false)
  const [newName, setNewName]     = useState('')
  const inputRef = useRef(null)
  const wrapRef  = useRef(null)

  // Close popup when clicking outside
  useEffect(() => {
    function handleOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setAddingNew(false)
        setManaging(false)
        setNewName('')
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [])

  function handleSelect(e) {
    const v = e.target.value
    if (v === '__add_new__') {
      setAddingNew(true)
      setManaging(false)
      setNewName('')
      setTimeout(() => inputRef.current?.focus(), 50)
    } else {
      onChange(v)
    }
  }

  function confirmNew() {
    const trimmed = newName.trim()
    if (!trimmed) return
    const lower = trimmed.toLowerCase()
    const isDupe = allOptions.some(o => o.toLowerCase() === lower)
    if (!isDupe) onAddNew(trimmed)
    else onChange(allOptions.find(o => o.toLowerCase() === lower) || trimmed)
    setAddingNew(false)
    setNewName('')
  }

  const recentSet    = new Set(recentlyUsed)
  const otherOptions = allOptions.filter(o => !recentSet.has(o))
  const showPopup    = addingNew || managing

  return (
    <div className="sl-input-dropdown-wrap" ref={wrapRef}>
      {/* Native select */}
      <select
        className="sl-input-dropdown"
        value={value || ''}
        onChange={handleSelect}
      >
        <option value="">— Select / चुनें —</option>
        {recentlyUsed.length > 0 && (
          <optgroup label="Recently used / हाल ही में उपयोग">
            {recentlyUsed.map(o => (
              <option key={o} value={o} disabled={usedInForm.includes(o) && o !== value}>{o}</option>
            ))}
          </optgroup>
        )}
        <optgroup label="All inputs / सभी इनपुट">
          {otherOptions.map(o => (
            <option key={o} value={o} disabled={usedInForm.includes(o) && o !== value}>{o}</option>
          ))}
        </optgroup>
        <option value="__add_new__">＋ Add new / नया जोड़ें</option>
      </select>

      {/* Remove toggle link */}
      <button
        type="button"
        className="sl-manage-toggle"
        onClick={() => { setManaging(m => !m); setAddingNew(false) }}
      >
        {managing ? '▲ Close' : '🗑 Remove…'}
      </button>

      {/* Popup — floats over adjacent cells, doesn't push layout */}
      {showPopup && (
        <div className="sl-input-dropdown-popup">
          {addingNew && (
            <div className="sl-add-new-inline">
              <input
                ref={inputRef}
                className="sl-add-new-input"
                placeholder="New input name…"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter')  confirmNew()
                  if (e.key === 'Escape') { setAddingNew(false); setNewName('') }
                }}
              />
              <button type="button" className="sl-add-new-btn" onClick={confirmNew}>OK</button>
              <button type="button" className="sl-add-new-cancel" onClick={() => { setAddingNew(false); setNewName('') }}>✕</button>
            </div>
          )}
          {managing && (
            <div className="sl-manage-list">
              {allOptions.map(o => (
                <div key={o} className="sl-manage-item">
                  <span className="sl-manage-item-name">{o}</span>
                  <button
                    type="button"
                    className="sl-manage-item-del"
                    onClick={() => { onDelete(o); if (value === o) onChange('') }}
                  >✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}


// yyyy-mm-dd → dd-mm-yyyy
function fmtDmy(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || ''))
  return m ? `${m[3]}-${m[2]}-${m[1]}` : String(d || '')
}
// ISO → "14 Nov 2026, 07:40 am" (IST)
function fmtSavedAt(iso) {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    hour12: true, timeZone: 'Asia/Kolkata',
  })
}

// ─────────────────────────────────────────────────────────────
// SlurrySection
// ─────────────────────────────────────────────────────────────
export default function SlurrySection({ sharedBatches, setSharedBatches, setSharedBatchDate }) {
  const uid = useUserId()

  // ── form state (meta: date, operators, approval) ──
  const [form, setForm, clearFormDraft] = useDraft(`draft:${uid}:batch:form`, emptyForm())
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)
  const [error,  setError]  = useState('')

  // ── batch cards state ──
  // Validate restored draft — if shape is wrong (e.g. stale old format), reset to fresh
  const [batchesDraft, setBatches, clearBatchesDraft] = useDraft(
    `draft:${uid}:batch:cards`,
    () => [emptyBatchCard()]
  )

  // Guard: if draft is corrupt/stale, use a fresh card and clear the bad draft
  const isValidDraft = Array.isArray(batchesDraft) &&
    batchesDraft.length > 0 &&
    batchesDraft[0]?.id != null &&
    Array.isArray(batchesDraft[0]?.rows)

  useEffect(() => {
    if (!isValidDraft) clearBatchesDraft()
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const batches = isValidDraft ? batchesDraft : [emptyBatchCard()]

  // Always-current ref so autoSaveBatchRow never reads stale batches from its closure
  const batchesRef = useRef(batches)
  useEffect(() => { batchesRef.current = batches }, [batches])

  const [batchErrors, setBatchErrors] = useState({})

  // Debounce timers for auto-save: keyed by "batchId_rowId"
  const saveTimers = useRef({})

  // Save sequence counters: keyed by rowId — incremented on each schedule to detect stale responses
  const saveSeq = useRef({})

  // rowSaveState: { [rowId_batchIdx]: 'saving' | 'saved' | 'error' }
  const [rowSaveState,   setRowSaveState]   = useState({})
  const setRSS = (key, val) => setRowSaveState(p => ({ ...p, [key]: val }))

  // Row timestamps stored separately so saving never re-renders the input cells
  const [rowTimestamps, setRowTimestamps, clearTimestampsDraft] = useDraft(`draft:${uid}:batch:timestamps`, {})

  // Always-current ref so autoSaveBatchRow never reads stale rowTimestamps from its closure
  const rowTimestampsRef = useRef(rowTimestamps)
  useEffect(() => { rowTimestampsRef.current = rowTimestamps }, [rowTimestamps])

  // Toast notification: { msg, type: 'success'|'error' } | null
  const [toast, setToast] = useState(null)

  // Custom inputs (persist across reloads)
  const [customInputs, setCustomInputs, clearCustomInputsDraft] = useDraft(`draft:${uid}:batch:customInputs`, [])
  // Defaults removed by the user (persist across reloads)
  const [removedDefaults, setRemovedDefaults] = useDraft(`draft:${uid}:batch:removedDefaults`, [])
  const allInputOptions = [
    ...DEFAULT_INPUT_OPTIONS.filter(o => !removedDefaults.includes(o)),
    ...customInputs,
  ]

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  // Already saved: a process_job_cards record exists for this date. Only ONE
  // job card per date is allowed — show a note, lock the card, block Save.
  const [savedInfo, setSavedInfo] = useState(null)   // null | { created_at }
  const [savedCheck, setSavedCheck] = useState(0)
  useEffect(() => {
    setSavedInfo(null)
    if (!supabaseReady || !supabase || !form.date) return
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await supabase
          .from('process_job_cards')
          .select('id, created_at')
          .eq('date', form.date)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (!cancelled) setSavedInfo(data ? { created_at: data.created_at } : null)
      } catch { /* status only — never blocks the form */ }
    })()
    return () => { cancelled = true }
  }, [form.date, savedCheck])
  const locked = !!savedInfo

  // Operator name comes from the logged-in user (jsci_user, set at login).
  // Runs whenever it is empty, so it is also restored after Save / Reset.
  useEffect(() => {
    if (form.operator_name) return
    try {
      const profile = JSON.parse(localStorage.getItem('jsci_user') || '{}')
      if (profile?.name) setForm(p => ({ ...p, operator_name: profile.name }))
    } catch { /* silent */ }
  }, [form.operator_name]) // eslint-disable-line react-hooks/exhaustive-deps

  // =========================================================
  // BATCH HELPERS
  // =========================================================

  /** Sync both local state and parent (BatchTraceability) in one call.
   *  BatchTraceability reads b.batch_no and b.tank_type (snake_case),
   *  so we add those aliases when pushing to the parent. */
  function syncParent(nextBatches) {
    setBatches(nextBatches)
    setSharedBatches(nextBatches.map(b => ({
      ...b,
      batch_no:  b.batchNo  ?? b.batch_no  ?? '',
      tank_type: b.tankType ?? b.tank_type ?? '',
    })))
  }

  // Tell Batch Traceability which date these batches belong to.
  useEffect(() => {
    if (setSharedBatchDate) setSharedBatchDate(form.date || '')
  }, [form.date])  // eslint-disable-line react-hooks/exhaustive-deps

  // On page load, hand the batches restored from this browser's draft to
  // Batch Traceability (the wrapper starts with one empty batch).
  useEffect(() => {
    syncParent(batches)
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // =========================================================
  // SHARED DRAFT — other Batch Operators see what was entered
  // (keyed by job-card date; deleted when the job card is saved)
  // =========================================================

  const sharedBlob = {
    meta: {
      supervisor:      form.supervisor,
      manager:         form.manager,
    },
    batches: batches.map(b => ({
      ...b,
      rows: b.rows.map(r => ({ ...r, timestamp: rowTimestamps[r.id] || r.timestamp || '' })),
    })),
  }

  function sharedHasData(blob) {
    const m = blob.meta || {}
    if (m.supervisor || m.manager) return true
    return (blob.batches || []).some(b =>
      b.batchNo || b.tankType || b.completed ||
      b.rows.some(r => r.inputName || r.origin || r.batchNo || r.qty)
    )
  }

  function applySharedBlob(m) {
    if (!m || !Array.isArray(m.batches) || m.batches.length === 0) return
    const valid = m.batches.every(b =>
      b && b.id != null && Array.isArray(b.rows) && b.rows.every(r => r && r.id != null)
    )
    if (!valid) return

    if (m.meta) setForm(p => ({ ...p, ...m.meta }))

    const stamps = {}
    const names  = []
    m.batches.forEach(b => b.rows.forEach(r => {
      if (r.timestamp) stamps[r.id] = r.timestamp
      if (r.inputName) names.push(r.inputName)
    }))
    setRowTimestamps(p => ({ ...p, ...stamps }))

    // Input names the other operator added must exist in this dropdown too
    const known = new Set(allInputOptions.map(o => o.toLowerCase()))
    const fresh = [...new Set(names.filter(n => !known.has(n.toLowerCase())))]
    if (fresh.length) setCustomInputs(p => [...p, ...fresh])

    syncParent(m.batches)
  }

  const sharedDraft = useSharedDraft({
    section: 'batch_job_card',
    date: form.date,
    blob: sharedBlob,
    hasData: b => !locked && sharedHasData(b),
    apply: applySharedBlob,
    // A date with no live draft → show its saved job card (admins always;
    // every user once the date is saved)
    loadSavedForAll: locked,
    loadSaved: async date => {
      const row = await fetchLatestSaved('process_job_cards', 'date', date)
      if (!row || !Array.isArray(row.batches) || row.batches.length === 0) return null
      const flat = Array.isArray(row.input_rows) ? row.input_rows : []
      let k = 0
      return {
        meta: {
          shift:           row.shift           || '',
          operator_name:   row.operator_name   || '',
          supervisor:      row.supervisor      || '',
          manager:         row.manager         || '',
        },
        batches: row.batches.map(b => ({
          ...b,
          rows: (b.rows || []).map(r => ({ ...r, timestamp: (flat[k++] || {}).timestamp || r.timestamp || '' })),
        })),
      }
    },
    // Date changed: empty the card (keep date, shift, own name) so the new
    // date's shared values load instead of the previous date's being copied.
    onDateSwitch: () => {
      setForm(p => ({ ...emptyForm(), date: p.date, shift: p.shift, operator_name: p.operator_name }))
      clearTimestampsDraft()
      syncParent([emptyBatchCard()])
      setBatchErrors({})
    },
    onRemoteCleared: () => {
      // The job card for this date was saved by another operator: keep the
      // date (the saved card loads next) and re-check → "already saved" note.
      setForm(p => ({ ...emptyForm(), date: p.date, shift: p.shift, operator_name: p.operator_name }))
      clearBatchesDraft()
      clearTimestampsDraft()
      setBatchErrors({})
      setSavedCheck(n => n + 1)
    },
  })

  function setBatchField(batchId, field, val) {
    syncParent(batches.map(b => b.id === batchId ? { ...b, [field]: val } : b))
  }

  function addRowToBatch(batchId) {
    syncParent(batches.map(b =>
      b.id === batchId
        ? { ...b, rows: [...b.rows, emptyBatchRow()] }
        : b
    ))
  }

  function removeRowFromBatch(batchId, rowId) {
    syncParent(batches.map(b =>
      b.id === batchId && b.rows.length > 1
        ? { ...b, rows: b.rows.filter(r => r.id !== rowId) }
        : b
    ))
  }

  function setBatchRowField(batchId, rowId, field, val) {
    syncParent(batches.map(b =>
      b.id === batchId
        ? { ...b, rows: b.rows.map(r => r.id === rowId ? { ...r, [field]: val } : r) }
        : b
    ))
  }

  // =========================================================
  // AUTO-SAVE BATCH ROW
  // =========================================================

  const autoSaveBatchRow = useCallback(async (batchId, rowId, overrideQty, overrideOrigin) => {
    // Always read from the ref so we get the latest state, not the stale closure
    const latestBatches = batchesRef.current
    const batchIdx = latestBatches.findIndex(b => b.id === batchId)
    if (batchIdx === -1) return
    const batch = latestBatches[batchIdx]
    const row   = batch.rows.find(r => r.id === rowId)
    if (!row) return

    // Use override values when provided (e.g. called from onChange before re-render)
    const qty    = overrideQty    !== undefined ? overrideQty    : row.qty
    const origin = overrideOrigin !== undefined ? overrideOrigin : row.origin

    if (qty === '' || qty === null) return

    // Stale-save guard: stamp this save with a sequence number
    saveSeq.current[rowId] = (saveSeq.current[rowId] || 0) + 1
    const mySeq = saveSeq.current[rowId]

    const key    = `${rowId}_${batchIdx}`
    setRSS(key, 'saving')
    const stampToRecord = stamp12hr()

    // Record timestamp locally — the full data is saved when "Save Job Card" is clicked.
    // We skip the per-row Supabase write here to avoid duplicate-key races when the user
    // edits a value multiple times quickly.
    if (saveSeq.current[rowId] !== mySeq) return

    setRowTimestamps(p => ({ ...p, [rowId]: stampToRecord }))
    setRSS(key, 'saved')
    setTimeout(() => setRSS(key, null), 2000)
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  // Schedule a debounced auto-save 1 s after the user stops typing,
  // but only when qty is filled (origin is optional for the timestamp).
  const scheduleAutoSave = useCallback((batchId, rowId, origin, qty) => {
    const timerKey = `${batchId}_${rowId}`
    clearTimeout(saveTimers.current[timerKey])
    if (!qty.toString().trim()) return   // qty is the only required field
    saveTimers.current[timerKey] = setTimeout(() => {
      autoSaveBatchRow(batchId, rowId, qty, origin)
    }, 3000)
  }, [autoSaveBatchRow])

  // =========================================================
  // COMPLETE BATCH
  // =========================================================

  function completeBatch(batchId) {
    const batch = batches.find(b => b.id === batchId)
    if (!batch) return

    if (!batch.batchNo.trim()) {
      setBatchErrors(p => ({ ...p, [batchId]: 'Batch No. is required / बैच नं. आवश्यक है' }))
      return
    }
    if (!batch.tankType) {
      setBatchErrors(p => ({ ...p, [batchId]: 'Tank must be selected / टैंक चुनें' }))
      return
    }
    if (!batch.rows.some(r => parseFloat(r.qty) > 0)) {
      setBatchErrors(p => ({ ...p, [batchId]: 'At least one Qty > 0 required / कम से कम एक मात्रा > 0 चाहिए' }))
      return
    }

    setBatchErrors(p => { const n = { ...p }; delete n[batchId]; return n })

    const now12      = stamp12hr()
    const timestamps = batch.rows.map(r => rowTimestamps[r.id] || r.timestamp).filter(Boolean)
    const firstStamp = batch.firstStamp || (timestamps[0] || now12)
    const lastStamp  = timestamps.length > 0 ? timestamps[timestamps.length - 1] : now12

    // Lock this batch only — never create a new batch here
    const updated = batches.map(b =>
      b.id === batchId
        ? { ...b, completed: true, locked: true, completedAt: now12, firstStamp, lastStamp, expanded: true }
        : b
    )
    syncParent(updated)
  }

  // =========================================================
  // EDIT & TOGGLE
  // =========================================================

  function editBatch(batchId) {
    const ok = window.confirm(
      'Edit this completed batch? Timestamps will not change. / इस बैच को संपादित करें? टाइमस्टैम्प नहीं बदलेगी।'
    )
    if (!ok) return
    syncParent(batches.map(b =>
      b.id === batchId ? { ...b, completed: false, locked: false } : b
    ))
  }

  function toggleBatchExpanded(batchId) {
    syncParent(batches.map(b =>
      b.id === batchId ? { ...b, expanded: !b.expanded } : b
    ))
  }

  // "+ Add Batch" button — validates & locks the current active card, then opens the next one
  function addBatchCard() {
    const activeBatch = batches.find(b => !b.completed && !b.locked)
    if (activeBatch) {
      // Run same validation as completeBatch
      if (!activeBatch.batchNo.trim()) {
        setBatchErrors(p => ({ ...p, [activeBatch.id]: 'Batch No. is required / बैच नं. आवश्यक है' }))
        return
      }
      if (!activeBatch.tankType) {
        setBatchErrors(p => ({ ...p, [activeBatch.id]: 'Tank must be selected / टैंक चुनें' }))
        return
      }
      if (!activeBatch.rows.some(r => parseFloat(r.qty) > 0)) {
        setBatchErrors(p => ({ ...p, [activeBatch.id]: 'At least one Qty > 0 required / कम से कम एक मात्रा > 0 चाहिए' }))
        return
      }
      setBatchErrors(p => { const n = { ...p }; delete n[activeBatch.id]; return n })

      const now12      = stamp12hr()
      const timestamps = activeBatch.rows.map(r => rowTimestamps[r.id] || r.timestamp).filter(Boolean)
      const firstStamp = activeBatch.firstStamp || (timestamps[0] || now12)
      const lastStamp  = timestamps.length > 0 ? timestamps[timestamps.length - 1] : now12
      const prefillNames = activeBatch.rows.map(r => r.inputName).filter(Boolean)
      const nextCard     = emptyBatchCard(prefillNames)

      const updated = batches.map(b =>
        b.id === activeBatch.id
          ? { ...b, completed: true, locked: true, completedAt: now12, firstStamp, lastStamp, expanded: false }
          : b.completed
            ? { ...b, expanded: false }
            : b
      )
      syncParent([...updated, nextCard])
    } else {
      // All batches already completed — just add an empty card
      const lastCompleted = batches.filter(b => b.completed)
      const prefillNames  = lastCompleted.length > 0
        ? lastCompleted[lastCompleted.length - 1].rows.map(r => r.inputName).filter(Boolean)
        : []
      syncParent([...batches, emptyBatchCard(prefillNames)])
    }
  }

  // ── Derived values ──

  const recentInputNames = useMemo(() => {
    const completed = batches.filter(b => b.completed)
    const source = completed.length > 0
      ? completed[completed.length - 1]
      : batches[batches.length - 1]
    return [...new Set(source.rows.map(r => r.inputName).filter(Boolean))]
  }, [batches])

  // =========================================================
  // MAIN FORM SUBMIT
  // =========================================================

  async function handleSubmit(e) {
    e.preventDefault()

    if (!supabaseReady) {
      setError('Supabase not configured.')
      return
    }
    if (locked) return
    if (!form.date) { setError('Select the date before saving.'); return }

    setSaving(true)
    setError('')
    setSaved(false)
    const submittedDate = form.date

    // Server-side re-check: another operator may have saved this date already.
    try {
      const { data: existing } = await supabase
        .from('process_job_cards')
        .select('id, created_at')
        .eq('date', submittedDate)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (existing) {
        setSaving(false)
        setSavedInfo({ created_at: existing.created_at })
        setError('The job card for this date is already saved. It cannot be saved again.')
        return
      }
    } catch { /* the insert below still runs; the note appears on the next check */ }

    const { error: err } = await supabase
      .from('process_job_cards')
      .insert([{
        date:             form.date || null,
        shift:            form.shift,
        operator_name:    form.operator_name,
        batches:          batches,
        input_rows:       batches.flatMap(b =>
          b.rows.map(r => ({
            batch_id:   b.id,
            batch_no:   b.batchNo,
            tank_type:  b.tankType,
            input_name: r.inputName,
            origin:     r.origin,
            qty_kg:     parseFloat(r.qty) || 0,
            timestamp:  rowTimestamps[r.id] || r.timestamp || '',
          }))
        ),
        operator:         form.operator,
        supervisor:       form.supervisor,
        manager:          form.manager,
      }])

    setSaving(false)

    if (err) {
      setError(err.message)
    } else {
      setSaved(true)
      sharedDraft.suppress()
      deleteSharedDraft('batch_job_card', submittedDate)
      // Keep showing the job card just saved (now locked) with the note. The
      // batches stay, so Batch Traceability keeps its rows for this date.
      setBatchErrors({})
      setSavedInfo({ created_at: new Date().toISOString() })
    }
  }

  // =========================================================
  // RENDER
  // =========================================================

  return (
    <div className="sl-wrapper">

      {/* ── Toast notification ── */}
      {toast && (
        <div className={`sl-toast ${toast.type === 'error' ? 'sl-toast-error' : 'sl-toast-success'}`}>
          {toast.msg}
        </div>
      )}
      <div className="sl-title-bar">
        <div className="sl-title-main">
          Batch Operator — Process Job Card /{' '}
          <span className="sl-title-hi">बैच ऑपरेटर — प्रोसेस जॉब कार्ड</span>
        </div>
      </div>

      <form className="sl-form" onSubmit={handleSubmit}>

        {/* ── META ── */}
        <div className="sl-meta-bar">
          <div className="sl-meta-field">
            <label className="sl-label">
              Date / <span className="sl-label-hi">तारीख</span>
            </label>
            <input
              type="date"
              className="sl-input"
              value={form.date}
              onChange={e => set('date', e.target.value)}
            />
          </div>

          <div className="sl-meta-field">
            <label className="sl-label">
              Shift / <span className="sl-label-hi">पाली</span>
            </label>
            <select
              className="sl-input"
              disabled={locked}
              value={form.shift || ''}
              onChange={e => set('shift', e.target.value)}
            >
              <option value="">— Select Shift —</option>
              <option value="Day">Day / दिन</option>
              <option value="Night">Night / रात</option>
            </select>
          </div>

          <div className="sl-meta-field">
            <label className="sl-label">
              Operator Name / <span className="sl-label-hi">ऑपरेटर नाम</span>
            </label>
            <input
              className="sl-input"
              placeholder="Auto-filled from login"
              value={form.operator_name || ''}
              readOnly
              style={{ background: '#f5f0ea' }}
            />
          </div>
        </div>

        {/* Live-sharing status — tells the operator / admin whether this card
            is actually reaching the other screens. */}
        <SharedStatus date={form.date} syncInfo={sharedDraft.syncInfo} />

        {locked && (
          <div className="sl-success" style={{ margin: '8px 0' }}>
            🔒 The Process Job Card for {fmtDmy(form.date)} is already saved
            {savedInfo.created_at ? ` (on ${fmtSavedAt(savedInfo.created_at)})` : ''}. It cannot be saved again.
            {' '}/ इस तारीख का जॉब कार्ड पहले ही सहेजा जा चुका है, इसे दोबारा सहेजा नहीं जा सकता।
          </div>
        )}

        {/* Everything below (batch cards, approval) is locked once saved. */}
        <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>

        {/* ══════════════════════════════════════════════════
            INPUTS (kg) — BATCH CARDS
        ══════════════════════════════════════════════════ */}

        <div className="sl-section-title">
          Inputs (kg) / <span className="sl-hi">इनपुट (किग्रा)</span>
        </div>

        <div className="sl-batch-cards-wrap">

          {batches.map((batch, batchIdx) => {
            const batchTotal = batch.rows.reduce((s, r) => s + (parseFloat(r.qty) || 0), 0)
            const usedInBatch = batch.rows.map(r => r.inputName).filter(Boolean)

            // ── COMPLETED CARD ──
            if (batch.completed && batch.locked) {
              return (
                <div key={batch.id} className="sl-batch-card sl-batch-card-completed">
                  <div className="sl-batch-card-header sl-batch-card-header-completed">
                    <span className="sl-batch-card-summary">
                      Batch-{batchIdx + 1}
                      {batch.batchNo  ? ` · ${batch.batchNo}`  : ''}
                      {batch.tankType ? ` · ${batch.tankType}` : ''}
                      {` · ${batchTotal} kg`}
                      <span className="sl-batch-completed-badge">✓ Completed</span>
                      {batch.firstStamp && batch.lastStamp
                        ? ` · ${batch.firstStamp} → ${batch.lastStamp}`
                        : ''}
                    </span>
                    <div className="sl-batch-card-header-actions">
                      <button
                        type="button"
                        className="sl-batch-toggle-btn"
                        onClick={() => toggleBatchExpanded(batch.id)}
                      >
                        {batch.expanded ? '▲ Hide / छुपाएं' : '▼ Show / दिखाएं'}
                      </button>
                      <button
                        type="button"
                        className="sl-batch-edit-btn"
                        onClick={() => editBatch(batch.id)}
                      >
                        ✎ Edit / संपादित करें
                      </button>
                    </div>
                  </div>

                  {batch.expanded && (
                    <div className="sl-batch-card-body">
                      <table className="sl-batch-card-table sl-batch-card-table-readonly">
                        <thead>
                          <tr>
                            <th>Input / इनपुट</th>
                            <th>Origin/RM / उद्गम</th>
                            <th>Batch No. / बैच नं.</th>
                            <th>Qty (kg) / मात्रा</th>
                            <th>Timestamp / समय</th>
                          </tr>
                        </thead>
                        <tbody>
                          {batch.rows.map(row => (
                            <tr key={row.id}>
                              <td data-label="Input / इनपुट">{row.inputName || '—'}</td>
                              <td data-label="Origin/RM / उद्गम">{row.origin    || '—'}</td>
                              <td data-label="Batch No. / बैच नं.">{row.batchNo   || '—'}</td>
                              <td data-label="Qty (kg) / मात्रा">{row.qty       || '—'}</td>
                              <td data-label="Timestamp / समय">
                                {(rowTimestamps[row.id] || row.timestamp)
                                  ? <span className="sl-ts-badge">{rowTimestamps[row.id] || row.timestamp}</span>
                                  : <span className="sl-ts-empty">—</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            }

            // ── ACTIVE CARD ──
            return (
              <div key={batch.id} className="sl-batch-card sl-batch-card-active">
                <div className="sl-batch-card-header">
                  <span className="sl-batch-card-num">Batch-{batchIdx + 1}</span>
                  <span className="sl-batch-current-badge">Current / चालू</span>
                  <div className="sl-batch-card-meta-inputs">
                    <input
                      className="sl-input sl-batch-no-field"
                      placeholder="Batch No. / बैच नं."
                      value={batch.batchNo}
                      onChange={e => setBatchField(batch.id, 'batchNo', e.target.value)}
                    />
                    <select
                      className="sl-input sl-batch-tank-select"
                      value={batch.tankType}
                      onChange={e => setBatchField(batch.id, 'tankType', e.target.value)}
                    >
                      <option value="">— Select Tank / टैंक चुनें —</option>
                      {BATCH_OPTIONS.map(grp => (
                        <optgroup key={grp.group} label={grp.group}>
                          {grp.options.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="sl-batch-card-body">
                  <table className="sl-batch-card-table">
                    <thead>
                      <tr>
                        <th>Input / इनपुट</th>
                        <th>Origin/RM / उद्गम</th>
                        <th>Batch No. / बैच नं.</th>
                        <th>Qty (kg) / मात्रा</th>
                        <th>Timestamp / समय</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {batch.rows.map((row) => {
                        const saveKey   = `${row.id}_${batchIdx}`
                        const saveState = rowSaveState[saveKey]
                        return (
                          <tr key={row.id}>
                            <td className="sl-td-input" data-label="Input / इनपुट">
                              <InputDropdown
                                value={row.inputName}
                                onChange={name => setBatchRowField(batch.id, row.id, 'inputName', name)}
                                allOptions={allInputOptions}
                                defaultOptions={DEFAULT_INPUT_OPTIONS}
                                recentlyUsed={recentInputNames}
                                usedInForm={usedInBatch.filter(n => n !== row.inputName)}
                                onAddNew={name => {
                                  const lower = name.toLowerCase()
                                  if (!allInputOptions.some(o => o.toLowerCase() === lower)) {
                                    setCustomInputs(prev => [...prev, name])
                                  }
                                  setBatchRowField(batch.id, row.id, 'inputName', name)
                                }}
                                onDelete={name => {
                                  if (DEFAULT_INPUT_OPTIONS.includes(name)) {
                                    setRemovedDefaults(prev => [...prev, name])
                                  } else {
                                    setCustomInputs(prev => prev.filter(o => o !== name))
                                  }
                                }}
                              />
                            </td>
                            <td data-label="Origin/RM / उद्गम">
                              <input
                                className="sl-input-cell"
                                placeholder="RM / Origin"
                                value={row.origin}
                                onChange={e => {
                                  const val = e.target.value
                                  setBatchRowField(batch.id, row.id, 'origin', val)
                                  scheduleAutoSave(batch.id, row.id, val, row.qty)
                                }}
                              />
                            </td>
                            <td data-label="Batch No. / बैच नं.">
                              <input
                                className="sl-input-cell"
                                placeholder="Batch No."
                                value={row.batchNo || ''}
                                onChange={e => setBatchRowField(batch.id, row.id, 'batchNo', e.target.value)}
                              />
                            </td>
                            <td data-label="Qty (kg) / मात्रा">
                              <input
                                type="number"
                                className="sl-input-num"
                                placeholder="—"
                                data-rowid={row.id}
                                data-batchid={batch.id}
                                value={row.qty}
                                onChange={e => {
                                  const val = e.target.value
                                  setBatchRowField(batch.id, row.id, 'qty', val)
                                  scheduleAutoSave(batch.id, row.id, row.origin, val)
                                }}
                                onBlur={e => autoSaveBatchRow(batch.id, row.id, e.target.value, row.origin)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault()
                                    // Save immediately, then move focus to next row's Qty
                                    autoSaveBatchRow(batch.id, row.id, e.target.value, row.origin)
                                    const allQtyInputs = Array.from(
                                      document.querySelectorAll(`[data-batchid="${batch.id}"] input[data-rowid], input[data-batchid="${batch.id}"]`)
                                    )
                                    // simpler: query all qty inputs in the same batch card
                                    const card = e.target.closest('.sl-batch-card')
                                    if (card) {
                                      const qtys = Array.from(card.querySelectorAll('input[data-rowid]'))
                                      const idx  = qtys.indexOf(e.target)
                                      if (idx !== -1 && idx + 1 < qtys.length) {
                                        qtys[idx + 1].focus()
                                      }
                                    }
                                  }
                                }}
                              />
                              {saveState === 'saving' && <span className="sl-autosave-indicator sl-autosave-saving">…</span>}
                              {saveState === 'saved'  && <span className="sl-autosave-indicator sl-autosave-ok">Saved ✓</span>}
                              {saveState === 'error'  && <span className="sl-autosave-indicator sl-autosave-err">!</span>}
                            </td>
                            <td className="sl-td-ts" data-label="Timestamp / समय">
                              {(rowTimestamps[row.id] || row.timestamp)
                                ? <span className="sl-ts-badge">{rowTimestamps[row.id] || row.timestamp}</span>
                                : <span className="sl-ts-empty">—</span>}
                            </td>
                            <td className="sl-td-action">
                              {batch.rows.length > 1 && (
                                <button
                                  type="button"
                                  className="sl-remove-btn"
                                  onClick={() => removeRowFromBatch(batch.id, row.id)}
                                >✕</button>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>

                  <div className="sl-batch-row-controls">
                    <button
                      type="button"
                      className="sl-add-btn"
                      onClick={e => { e.stopPropagation(); addRowToBatch(batch.id) }}
                    >
                      + Add Input Row / <span className="sl-hi">इनपुट पंक्ति जोड़ें</span>
                    </button>
                  </div>

                  <div className="sl-batch-total-line">
                    Batch Total / <span className="sl-hi">बैच कुल:</span>
                    <strong> {batchTotal > 0 ? `${batchTotal} kg` : '—'}</strong>
                  </div>

                  {batchErrors[batch.id] && (
                    <div className="sl-batch-error">{batchErrors[batch.id]}</div>
                  )}

                  <button
                    type="button"
                    className="sl-batch-complete-btn"
                    onClick={e => { e.stopPropagation(); completeBatch(batch.id) }}
                  >
                    ✓ Complete Batch-{batchIdx + 1} / <span className="sl-hi">बैच पूर्ण करें</span>
                  </button>
                </div>
              </div>
            )
          })}

        </div>

        {/* ── Add Batch button ── */}
        <div className="sl-add-batch-bar">
          <button
            type="button"
            className="sl-add-btn sl-add-batch-btn"
            onClick={e => { e.stopPropagation(); addBatchCard() }}
          >
            + Add Batch / <span className="sl-hi">बैच जोड़ें</span>
          </button>
        </div>

        {/* ══════════════════════════════════════════════════
            APPROVAL
        ══════════════════════════════════════════════════ */}

        <div className="sl-approval-bar">
          <div className="sl-approval-field">
            <label className="sl-label">
              Supervisor / <span className="sl-label-hi">सुपरवाइज़र</span>
            </label>
            <input
              className="sl-input"
              placeholder="Name"
              value={form.supervisor}
              onChange={e => set('supervisor', e.target.value)}
            />
          </div>
          <div className="sl-approval-field">
            <label className="sl-label">
              Manager / <span className="sl-label-hi">मैनेजर</span>
            </label>
            <input
              className="sl-input"
              placeholder="Name"
              value={form.manager}
              onChange={e => set('manager', e.target.value)}
            />
          </div>
        </div>

        </fieldset>

        {/* ══════════════════════════════════════════════════
            ACTIONS
        ══════════════════════════════════════════════════ */}

        <div className="sl-actions">
          {error && <div className="sl-error">Error: {error}</div>}
          {saved  && <div className="sl-success">✓ Saved successfully / सफलतापूर्वक सहेजा गया</div>}

          <button type="submit" className="sl-save-btn" disabled={saving || locked}>
            {saving ? 'Saving…' : locked ? '🔒 Already Saved / पहले ही सहेजा गया' : 'Save Job Card / जॉब कार्ड सहेजें'}
          </button>

          <button
            type="button"
            className="sl-reset-btn"
            disabled={locked}
            onClick={() => {
              clearFormDraft()
              clearBatchesDraft()
              clearTimestampsDraft()
              const fresh = [emptyBatchCard()]
              setSharedBatches(fresh)
              setBatchErrors({})
              setSaved(false)
              setError('')
            }}
          >
            Reset / रीसेट
          </button>
        </div>

      </form>

    </div>
  )
}
