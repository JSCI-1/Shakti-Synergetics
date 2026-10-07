import React, { useState, useMemo, useRef, useCallback } from 'react'
import { supabase, supabaseReady } from '../supabaseClient'
import './SlurrySection.css'

const DEFAULT_INPUT_OPTIONS = [
  'LIGNO-A', 'LIGNO-B', 'WATER', 'Crude Sulphur', 'Sulphur powder',
  'Papdi', 'Fine powder', 'Gujmol DN Liquid', 'Gujmol DN Powder',
  'Tamol DN Powder', 'FBPP', 'FZ1', 'Defoamer', 'China Clay',
  'Domsjo DS-10', 'Domsjo DA-30', 'Borresperse-NA', 'Borresperse-Ca',
  'Greensperse-Ca',
]

const MILLS = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'H1']

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

const SLURRY_MOTORS = [
  { id: 1,  name: 'Vertical Mill 01',  hp: 50 },
  { id: 2,  name: 'Vertical Mill 02',  hp: 50 },
  { id: 3,  name: 'Vertical Mill 03',  hp: 50 },
  { id: 4,  name: 'Vertical Mill 04',  hp: 50 },
  { id: 5,  name: 'Vertical Mill 05',  hp: 50 },
  { id: 6,  name: 'Vertical Mill 06',  hp: 50 },
  { id: 7,  name: 'Vertical Mill 07',  hp: 50 },
  { id: 8,  name: 'Vertical Mill 08',  hp: 50 },
  { id: 9,  name: 'Vertical Mill 09',  hp: 50 },
  { id: 10, name: 'Vertical Mill 10',  hp: 50 },
  { id: 11, name: 'Attrition Mill 01', hp: 75 },
  { id: 12, name: 'Attrition Mill 02', hp: 60 },
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

function emptyMotorEntry() {
  return { amp: '', stop: '', timestamp: '', saved: false }
}

function emptyMotorForm() {
  return {
    running_date: todayISO(),
    checked_by: '',
    remark: '',
    motors: SLURRY_MOTORS.map(() => emptyMotorEntry()),
  }
}

function emptyMillRow(mill) {
  return {
    mill,
    flow_rates: [{ value: '', timestamp: '' }],
    current_amp: '',
    zirconia_beads: '',
    remarks: '',
  }
}

function emptyForm() {
  return {
    date: '',
    shift1_operator: '',
    shift2_operator: '',
    mills: MILLS.map(m => emptyMillRow(m)),
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

  // ── form state (no input_rows — those live in batches) ──
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)
  const [error,  setError]  = useState('')

  // ── batch cards state ──
  const [batches, setBatches] = useState([emptyBatchCard()])
  const [batchErrors, setBatchErrors] = useState({})

  // ── motor accordion ──
  const [motorOpen,    setMotorOpen]    = useState(false)
  const [motorForm,    setMotorForm]    = useState(emptyMotorForm())
  const [motorSaving,  setMotorSaving]  = useState(false)
  const [motorSaved,   setMotorSaved]   = useState(false)
  const [motorError,   setMotorError]   = useState('')

  // Stable session key
  const sessionId = useRef(`slurry-${new Date().toISOString().slice(0, 10)}`)

  // rowSaveState: { [rowId_batchIdx]: 'saving' | 'saved' | 'error' }
  const [rowSaveState, setRowSaveState] = useState({})
  const setRSS = (key, val) => setRowSaveState(p => ({ ...p, [key]: val }))

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

    const key    = `${rowId}_${batchIdx}`
    setRSS(key, 'saving')
    const now12  = stamp12hr()
    let firstStamp = row.timestamp || ''

    if (supabaseReady) {
      const { data: existing } = await supabase
        .from('slurry_input_saves')
        .select('first_stamp')
        .eq('session_id', sessionId.current)
        .eq('row_id', rowId)
        .eq('batch_index', batchIdx)
        .maybeSingle()

      firstStamp = existing?.first_stamp || firstStamp || now12

      const { error: upsertErr } = await supabase
        .from('slurry_input_saves')
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

      if (upsertErr) console.warn('slurry_input_saves upsert failed:', upsertErr.message)
    } else {
      firstStamp = firstStamp || now12
    }

    // Write first_stamp back into row (only if not already set)
    const withStamp = batches.map(b =>
      b.id === batchId
        ? {
            ...b,
            rows: b.rows.map(r =>
              r.id === rowId && !r.timestamp
                ? { ...r, timestamp: firstStamp }
                : r
            ),
          }
        : b
    )
    syncParent(withStamp)

    setRSS(key, 'saved')
    setTimeout(() => setRSS(key, null), 2000)
  }, [batches, sessionId])   // eslint-disable-line react-hooks/exhaustive-deps

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
    const timestamps = batch.rows.map(r => r.timestamp).filter(Boolean)
    const firstStamp = batch.firstStamp || (timestamps[0] || now12)
    const lastStamp  = timestamps.length > 0 ? timestamps[timestamps.length - 1] : now12

    const prefillNames = batch.rows.map(r => r.inputName).filter(Boolean)
    const nextCard     = emptyBatchCard(prefillNames)

    const updated = batches.map(b =>
      b.id === batchId
        ? { ...b, completed: true, locked: true, completedAt: now12, firstStamp, lastStamp, expanded: true }
        : b.completed
          ? { ...b, expanded: false }   // collapse older completed cards
          : b
    )
    syncParent([...updated, nextCard])
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

  // ── Derived values ──

  const shiftTotal = batches.reduce((sum, b) =>
    sum + b.rows.reduce((s, r) => s + (parseFloat(r.qty) || 0), 0), 0
  )

  const recentInputNames = useMemo(() => {
    const completed = batches.filter(b => b.completed)
    const source = completed.length > 0
      ? completed[completed.length - 1]
      : batches[batches.length - 1]
    return [...new Set(source.rows.map(r => r.inputName).filter(Boolean))]
  }, [batches])

  // =========================================================
  // MILL OPERATIONS
  // =========================================================

  const setMill = (idx, field, val) =>
    setForm(p => ({
      ...p,
      mills: p.mills.map((m, i) => i === idx ? { ...m, [field]: val } : m),
    }))

  function addFlowRate(mi) {
    setForm(p => ({
      ...p,
      mills: p.mills.map((m, i) =>
        i === mi
          ? { ...m, flow_rates: [...m.flow_rates, { value: '', timestamp: '' }] }
          : m
      ),
    }))
  }

  function setFlowRate(mi, fi, value) {
    setForm(p => ({
      ...p,
      mills: p.mills.map((m, i) =>
        i === mi
          ? { ...m, flow_rates: m.flow_rates.map((f, j) => j === fi ? { ...f, value } : f) }
          : m
      ),
    }))
  }

  function stampFlowRate(mi, fi) {
    setForm(p => {
      if (p.mills[mi].flow_rates[fi].timestamp) return p
      return {
        ...p,
        mills: p.mills.map((m, i) =>
          i === mi
            ? { ...m, flow_rates: m.flow_rates.map((f, j) => j === fi ? { ...f, timestamp: stamp12hr() } : f) }
            : m
        ),
      }
    })
  }

  function removeFlowRate(mi, fi) {
    setForm(p => ({
      ...p,
      mills: p.mills.map((m, i) =>
        i === mi && m.flow_rates.length > 1
          ? { ...m, flow_rates: m.flow_rates.filter((_, j) => j !== fi) }
          : m
      ),
    }))
  }

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
      .from('slurry_job_cards')
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
            timestamp:  r.timestamp || '',
          }))
        ),
        mills:            form.mills,
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
  // MOTOR OPERATIONS
  // =========================================================

  const setMotorCell = (mi, key, val) =>
    setMotorForm(p => ({
      ...p,
      motors: p.motors.map((m, idx) => idx === mi ? { ...m, [key]: val } : m),
    }))

  function saveMotorRow(mi) {
    setMotorForm(p => {
      if (p.motors[mi].saved) return p
      return {
        ...p,
        motors: p.motors.map((m, idx) =>
          idx === mi ? { ...m, timestamp: stamp12hr(), saved: true } : m
        ),
      }
    })
  }

  async function handleMotorSubmit(e) {
    e.preventDefault()

    if (!supabaseReady) {
      setMotorError('Supabase not configured.')
      return
    }

    setMotorSaving(true)
    setMotorError('')
    setMotorSaved(false)

    const { error: err } = await supabase
      .from('slurry_motor_amp')
      .insert([{
        running_date: motorForm.running_date,
        checked_by:   motorForm.checked_by,
        remark:       motorForm.remark,
        motor_data:   motorForm.motors,
      }])

    setMotorSaving(false)

    if (err) {
      setMotorError(err.message)
    } else {
      setMotorSaved(true)
      setMotorForm(emptyMotorForm())
    }
  }

  // =========================================================
  // RENDER
  // =========================================================

  return (
    <div className="sl-wrapper">

      {/* ── TITLE ── */}
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
                                {row.timestamp
                                  ? <span className="sl-ts-badge">{row.timestamp}</span>
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
                                onChange={e => setBatchRowField(batch.id, row.id, 'origin', e.target.value)}
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                className="sl-input-num"
                                placeholder="—"
                                value={row.qty}
                                onChange={e => setBatchRowField(batch.id, row.id, 'qty', e.target.value)}
                                onBlur={() => autoSaveBatchRow(batch.id, row.id)}
                              />
                              {saveState === 'saving' && <span className="sl-autosave-indicator sl-autosave-saving">…</span>}
                              {saveState === 'saved'  && <span className="sl-autosave-indicator sl-autosave-ok">Saved ✓</span>}
                              {saveState === 'error'  && <span className="sl-autosave-indicator sl-autosave-err">!</span>}
                            </td>
                            <td className="sl-td-ts">
                              {row.timestamp
                                ? <span className="sl-ts-badge">{row.timestamp}</span>
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
                      onClick={() => addRowToBatch(batch.id)}
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
                    onClick={() => completeBatch(batch.id)}
                  >
                    ✓ Complete Batch-{batchIdx + 1} / <span className="sl-hi">बैच पूर्ण करें</span>
                  </button>
                </div>
              </div>
            )
          })}

        </div>

        {/* ── Shift Total ── */}
        <div className="sl-shift-total-bar">
          Shift Total / <span className="sl-hi">शिफ्ट कुल:</span>
          <strong className="sl-shift-total-val">
            {shiftTotal > 0 ? ` ${shiftTotal} kg` : ' —'}
          </strong>
        </div>

        {/* ══════════════════════════════════════════════════
            MILLING TABLE
        ══════════════════════════════════════════════════ */}

        <div className="sl-section-title">
          Sand Milling / <span className="sl-hi">सैंड मिलिंग</span>
        </div>

        <div className="sl-mill-scroll">
          <table className="sl-mill-table">
            <thead>
              <tr>
                <th>Mill / मिल</th>
                <th>Flow Rate (LPH) / फ्लो रेट</th>
                <th>Current AMP / करंट</th>
                <th>Zirconia Beads (kg) / ज़िरकोनिया</th>
                <th>Remarks / टिप्पणी</th>
              </tr>
            </thead>
            <tbody>
              {form.mills.map((m, mi) => (
                <tr key={m.mill}>
                  <td className="sl-mill-name">{m.mill}</td>
                  <td className="sl-mill-flow-cell">
                    {m.flow_rates.map((fr, fi) => (
                      <div key={fi} className="sl-flow-entry">
                        <input
                          type="number"
                          className="sl-input-num-wide"
                          placeholder="—"
                          value={fr.value}
                          onChange={e => setFlowRate(mi, fi, e.target.value)}
                        />
                        {fr.timestamp
                          ? <span className="sl-flow-ts">{fr.timestamp}</span>
                          : (
                            <button
                              type="button"
                              className="sl-flow-stamp-btn"
                              onClick={() => stampFlowRate(mi, fi)}
                            >
                              ⏱ Stamp
                            </button>
                          )}
                        {m.flow_rates.length > 1 && (
                          <button
                            type="button"
                            className="sl-flow-del-btn"
                            onClick={() => removeFlowRate(mi, fi)}
                          >✕</button>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      className="sl-flow-add-btn"
                      onClick={() => addFlowRate(mi)}
                    >+ reading</button>
                  </td>
                  <td>
                    <input
                      type="number"
                      className="sl-input-num-wide"
                      placeholder="—"
                      value={m.current_amp}
                      onChange={e => setMill(mi, 'current_amp', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      className="sl-input-num-wide"
                      placeholder="—"
                      value={m.zirconia_beads}
                      onChange={e => setMill(mi, 'zirconia_beads', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      className="sl-input-wide-text"
                      placeholder="—"
                      value={m.remarks}
                      onChange={e => setMill(mi, 'remarks', e.target.value)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ══════════════════════════════════════════════════
            APPROVAL
        ══════════════════════════════════════════════════ */}

        <div className="sl-approval-bar">
          <div className="sl-approval-field">
            <label className="sl-label">
              Operator / <span className="sl-label-hi">ऑपरेटर</span>
            </label>
            <input
              className="sl-input"
              placeholder="Name"
              value={form.operator}
              onChange={e => set('operator', e.target.value)}
            />
          </div>
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

      {/* ══════════════════════════════════════════════════
          RUNNING MOTOR AMP — accordion
      ══════════════════════════════════════════════════ */}

      <div className="sl-accordion">
        <button
          type="button"
          className="sl-accordion-header"
          onClick={() => setMotorOpen(o => !o)}
        >
          <span className="sl-accordion-title">
            Running Motor Amp Status / <span className="sl-hi">चलते मोटर एम्पेयर स्थिति</span>
          </span>
          <span className="sl-accordion-icon">{motorOpen ? '▲' : '▼'}</span>
        </button>

        {motorOpen && (
          <form className="sl-motor-form" onSubmit={handleMotorSubmit}>

            <div className="sl-motor-meta">
              <div className="sl-motor-meta-field">
                <label className="sl-label">
                  Date / <span className="sl-label-hi">तारीख</span>
                </label>
                <input
                  type="date"
                  className="sl-input"
                  value={motorForm.running_date}
                  onChange={e => setMotorForm(p => ({ ...p, running_date: e.target.value }))}
                />
              </div>
              <div className="sl-motor-meta-field">
                <label className="sl-label">
                  Checked By / <span className="sl-label-hi">जाँचकर्ता</span>
                </label>
                <input
                  className="sl-input"
                  placeholder="Name"
                  value={motorForm.checked_by}
                  onChange={e => setMotorForm(p => ({ ...p, checked_by: e.target.value }))}
                />
              </div>
            </div>

            <div className="sl-motor-scroll">
              <table className="sl-motor-table">
                <thead>
                  <tr>
                    <th>Sr.</th>
                    <th>Motor Name / मोटर नाम</th>
                    <th>HP</th>
                    <th>AMP</th>
                    <th>Stop / रोकें</th>
                    <th>Timestamp / समय</th>
                    <th>Save / सहेजें</th>
                  </tr>
                </thead>
                <tbody>
                  {SLURRY_MOTORS.map((motor, mi) => {
                    const entry = motorForm.motors[mi]
                    return (
                      <tr key={motor.id} className={`${mi % 2 === 0 ? '' : 'sl-motor-alt'} ${entry.saved ? 'sl-motor-saved' : ''}`}>
                        <td className="sl-motor-sr">{motor.id}</td>
                        <td className="sl-motor-name">{motor.name}</td>
                        <td className="sl-motor-hp">{motor.hp}</td>
                        <td>
                          <input
                            type="number"
                            className="sl-motor-input"
                            placeholder="—"
                            value={entry.amp}
                            onChange={e => setMotorCell(mi, 'amp', e.target.value)}
                            disabled={entry.saved}
                          />
                        </td>
                        <td>
                          <select
                            className="sl-motor-select"
                            value={entry.stop}
                            onChange={e => setMotorCell(mi, 'stop', e.target.value)}
                            disabled={entry.saved}
                          >
                            <option value="">—</option>
                            <option value="Yes">Yes</option>
                            <option value="No">No</option>
                          </select>
                        </td>
                        <td className="sl-motor-ts">
                          {entry.timestamp
                            ? <span className="sl-ts-badge">{entry.timestamp}</span>
                            : <span className="sl-ts-empty">—</span>}
                        </td>
                        <td className="sl-motor-save-cell">
                          <button
                            type="button"
                            className={`sl-row-save-btn ${entry.saved ? 'sl-row-saved' : ''}`}
                            onClick={() => saveMotorRow(mi)}
                            disabled={entry.saved}
                          >
                            {entry.saved ? '✓' : 'Save'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="sl-motor-remark">
              <label className="sl-label">
                Remark / <span className="sl-label-hi">टिप्पणी</span>
              </label>
              <textarea
                className="sl-textarea"
                rows={2}
                value={motorForm.remark}
                onChange={e => setMotorForm(p => ({ ...p, remark: e.target.value }))}
              />
            </div>

            <div className="sl-actions">
              {motorError && <div className="sl-error">Error: {motorError}</div>}
              {motorSaved  && <div className="sl-success">✓ Motor log saved / मोटर लॉग सहेजा</div>}

              <button type="submit" className="sl-save-btn" disabled={motorSaving}>
                {motorSaving ? 'Saving…' : 'Save Motor Log / मोटर लॉग सहेजें'}
              </button>

              <button
                type="button"
                className="sl-reset-btn"
                onClick={() => {
                  setMotorForm(emptyMotorForm())
                  setMotorSaved(false)
                  setMotorError('')
                }}
              >
                Reset / रीसेट
              </button>
            </div>

          </form>
        )}
      </div>

    </div>
  )
}
