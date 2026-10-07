import React, { useState, useMemo, useRef, useCallback } from 'react'
import { supabase, supabaseReady } from '../supabaseClient'
import './SlurrySection.css'

const DEFAULT_INPUT_OPTIONS = [
  'WATER', 'Crude Sulphur', 'Sulphur powder',
  'Papdi', 'Fine powder', 'Gujmol DN Liquid', 'Gujmol DN Powder',
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
    hour12: true,
    timeZone: 'Asia/Kolkata',
  })
}

function emptyBatchRow(name = '') {
  return { id: uid(), inputName: name, origin: '', qty: '', timestamp: '' }
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
    shift1_operator: '',
    shift2_operator: '',
    operator: '',
    supervisor: '',
    manager: '',
  }
}

// ─────────────────────────────────────────────────────────────
// InputDropdown — searchable native select with add-new
// ─────────────────────────────────────────────────────────────
function InputDropdown({ value, onChange, allOptions, recentlyUsed, usedInForm, onAddNew }) {
  const [addingNew, setAddingNew] = useState(false)
  const [newName, setNewName] = useState('')
  const inputRef = useRef(null)

  function handleSelect(e) {
    const v = e.target.value
    if (v === '__add_new__') {
      setAddingNew(true)
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

  const recentSet = new Set(recentlyUsed)
  const otherOptions = allOptions.filter(o => !recentSet.has(o))

  return (
    <div className="sl-input-dropdown-wrap">
      <select
        className="sl-input-dropdown"
        value={value || ''}
        onChange={handleSelect}
      >
        <option value="">— Select / चुनें —</option>
        {recentlyUsed.length > 0 && (
          <optgroup label="Recently used / हाल ही में उपयोग">
            {recentlyUsed.map(o => (
              <option key={o} value={o} disabled={usedInForm.includes(o) && o !== value}>
                {o}
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label="All inputs / सभी इनपुट">
          {otherOptions.map(o => (
            <option key={o} value={o} disabled={usedInForm.includes(o) && o !== value}>
              {o}
            </option>
          ))}
        </optgroup>
        <option value="__add_new__">＋ Add new / नया जोड़ें</option>
      </select>

      {addingNew && (
        <div className="sl-add-new-inline">
          <input
            ref={inputRef}
            className="sl-add-new-input"
            placeholder="New input name…"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') confirmNew()
              if (e.key === 'Escape') setAddingNew(false)
            }}
          />
          <button type="button" className="sl-add-new-btn" onClick={confirmNew}>OK</button>
          <button type="button" className="sl-add-new-cancel" onClick={() => setAddingNew(false)}>✕</button>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// SlurrySection
// ─────────────────────────────────────────────────────────────
export default function SlurrySection({ sharedBatches, setSharedBatches }) {

  // ── form state ──
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)
  const [error,  setError]  = useState('')

  // ── batch cards state ──
  const [batches, setBatches] = useState([emptyBatchCard()])
  const [batchErrors, setBatchErrors] = useState({})

  // Stable session key
  const sessionId = useRef(`slurry-${new Date().toISOString().slice(0, 10)}`)

  // Debounce timers for auto-save: keyed by "batchId_rowId"
  const saveTimers = useRef({})

  // Save sequence counters: keyed by rowId — incremented on each schedule to detect stale responses
  const saveSeq = useRef({})

  // rowSaveState: { [rowId_batchIdx]: 'saving' | 'saved' | 'error' }
  const [rowSaveState,   setRowSaveState]   = useState({})
  const setRSS = (key, val) => setRowSaveState(p => ({ ...p, [key]: val }))

  // Row timestamps stored separately so saving never re-renders the input cells
  const [rowTimestamps, setRowTimestamps] = useState({})

  // Toast notification: { msg, type: 'success'|'error' } | null
  const [toast, setToast] = useState(null)

  // Custom inputs
  const [customInputs, setCustomInputs] = useState([])
  const allInputOptions = [...DEFAULT_INPUT_OPTIONS, ...customInputs]

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  // =========================================================
  // BATCH HELPERS
  // =========================================================

  /** Sync both local state and parent (BatchTraceability) in one call */
  function syncParent(nextBatches) {
    setBatches(nextBatches)
    setSharedBatches(nextBatches)
  }

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

  const autoSaveBatchRow = useCallback(async (batchId, rowId) => {
    const batchIdx = batches.findIndex(b => b.id === batchId)
    if (batchIdx === -1) return
    const batch = batches[batchIdx]
    const row   = batch.rows.find(r => r.id === rowId)
    if (!row || row.qty === '' || row.qty === null) return

    // Stale-save guard: stamp this save with a sequence number
    saveSeq.current[rowId] = (saveSeq.current[rowId] || 0) + 1
    const mySeq = saveSeq.current[rowId]

    const key    = `${rowId}_${batchIdx}`
    setRSS(key, 'saving')
    const now12  = stamp12hr()
    // Use the separate rowTimestamps store; fall back to row.timestamp for pre-loaded data
    let firstStamp = rowTimestamps[rowId] || row.timestamp || ''

    let saveOk = true
    if (supabaseReady) {
      const { data: existing } = await supabase
        .from('process_input_saves')
        .select('first_stamp')
        .eq('session_id', sessionId.current)
        .eq('row_id', rowId)
        .eq('batch_index', batchIdx)
        .maybeSingle()

      firstStamp = existing?.first_stamp || firstStamp || now12

      const { error: upsertErr } = await supabase
        .from('process_input_saves')
        .upsert(
          {
            session_id:  sessionId.current,
            row_id:      rowId,
            batch_index: batchIdx,
            input_name:  row.inputName,
            origin:      row.origin,
            qty_kg:      parseFloat(row.qty) || 0,
            first_stamp: firstStamp,
            updated_at:  new Date().toISOString(),
          },
          { onConflict: 'session_id,row_id,batch_index' }
        )

      if (upsertErr) {
        console.warn('slurry_input_saves upsert failed:', upsertErr.message)
        saveOk = false
      }
    } else {
      firstStamp = firstStamp || now12
    }

    // Discard stale response — a newer save was triggered after this one started
    if (saveSeq.current[rowId] !== mySeq) return

    if (saveOk) {
      // Update ONLY the timestamp cell — never touch batches state here
      setRowTimestamps(p => ({ ...p, [rowId]: firstStamp }))
      setRSS(key, 'saved')
      setToast({ msg: '✓ Data saved successfully / डेटा सफलतापूर्वक सहेजा गया', type: 'success' })
      setTimeout(() => setRSS(key, null), 2000)
      setTimeout(() => setToast(null), 2000)
    } else {
      setRSS(key, 'error')
      setToast({ msg: 'Save failed, please try again / सहेजना विफल, कृपया पुनः प्रयास करें', type: 'error' })
      setTimeout(() => setRSS(key, null), 3000)
      setTimeout(() => setToast(null), 3000)
    }
  }, [batches, sessionId, rowTimestamps])   // eslint-disable-line react-hooks/exhaustive-deps

  // Schedule a debounced auto-save 1 s after the user stops typing,
  // but only when both origin and qty are filled.
  const scheduleAutoSave = useCallback((batchId, rowId, origin, qty) => {
    const timerKey = `${batchId}_${rowId}`
    clearTimeout(saveTimers.current[timerKey])
    if (!origin.trim() || !qty.toString().trim()) return   // need both fields
    saveTimers.current[timerKey] = setTimeout(() => {
      autoSaveBatchRow(batchId, rowId)
    }, 1000)
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

    setSaving(true)
    setError('')
    setSaved(false)

    const { error: err } = await supabase
      .from('process_job_cards')
      .insert([{
        date:             form.date || null,
        shift1_operator:  form.shift1_operator,
        shift2_operator:  form.shift2_operator,
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
      setForm(emptyForm())
      const fresh = [emptyBatchCard()]
      setBatches(fresh)
      setSharedBatches(fresh)
      setBatchErrors({})
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
              Shift 1 Operator / <span className="sl-label-hi">पहली पाली ऑपरेटर</span>
            </label>
            <input
              className="sl-input"
              placeholder="Operator name"
              value={form.shift1_operator}
              onChange={e => set('shift1_operator', e.target.value)}
            />
          </div>

          <div className="sl-meta-field">
            <label className="sl-label">
              Shift 2 Operator / <span className="sl-label-hi">दूसरी पाली ऑपरेटर</span>
            </label>
            <input
              className="sl-input"
              placeholder="Operator name"
              value={form.shift2_operator}
              onChange={e => set('shift2_operator', e.target.value)}
            />
          </div>
        </div>

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
                            <th>Qty (kg) / मात्रा</th>
                            <th>Timestamp / समय</th>
                          </tr>
                        </thead>
                        <tbody>
                          {batch.rows.map(row => (
                            <tr key={row.id}>
                              <td>{row.inputName || '—'}</td>
                              <td>{row.origin    || '—'}</td>
                              <td>{row.qty       || '—'}</td>
                              <td>
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
                            <td className="sl-td-input">
                              <InputDropdown
                                value={row.inputName}
                                onChange={name => setBatchRowField(batch.id, row.id, 'inputName', name)}
                                allOptions={allInputOptions}
                                recentlyUsed={recentInputNames}
                                usedInForm={usedInBatch.filter(n => n !== row.inputName)}
                                onAddNew={name => {
                                  const lower = name.toLowerCase()
                                  if (!allInputOptions.some(o => o.toLowerCase() === lower)) {
                                    setCustomInputs(prev => [...prev, name])
                                  }
                                  setBatchRowField(batch.id, row.id, 'inputName', name)
                                }}
                              />
                            </td>
                            <td>
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
                            <td>
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
                                onBlur={() => autoSaveBatchRow(batch.id, row.id)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault()
                                    // Save immediately, then move focus to next row's Qty
                                    autoSaveBatchRow(batch.id, row.id)
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
                            <td className="sl-td-ts">
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

        {/* ══════════════════════════════════════════════════
            ACTIONS
        ══════════════════════════════════════════════════ */}

        <div className="sl-actions">
          {error && <div className="sl-error">Error: {error}</div>}
          {saved  && <div className="sl-success">✓ Saved successfully / सफलतापूर्वक सहेजा गया</div>}

          <button type="submit" className="sl-save-btn" disabled={saving}>
            {saving ? 'Saving…' : 'Save Job Card / जॉब कार्ड सहेजें'}
          </button>

          <button
            type="button"
            className="sl-reset-btn"
            onClick={() => {
              setForm(emptyForm())
              const fresh = [emptyBatchCard()]
              setBatches(fresh)
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
