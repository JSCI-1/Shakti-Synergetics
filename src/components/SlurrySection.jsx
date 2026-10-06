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
      {
        label: '1st Attrition Mill — 1.6 MT',
        value: 'Attrition-1st-1.6MT',
      },
      {
        label: '2nd Attrition Mill — 1.2 MT',
        value: 'Attrition-2nd-1.2MT',
      },
    ],
  },
  {
    group: 'HST (High Speed Tank) / उच्च गति टैंक',
    options: [
      {
        label: 'HST 1st — 8 MT',
        value: 'HST-1st-8MT',
      },
      {
        label: 'HST 2nd — 6 MT',
        value: 'HST-2nd-6MT',
      },
    ],
  },
]

const SLURRY_MOTORS = [
  { id: 1, name: 'Vertical Mill 01', hp: 50 },
  { id: 2, name: 'Vertical Mill 02', hp: 50 },
  { id: 3, name: 'Vertical Mill 03', hp: 50 },
  { id: 4, name: 'Vertical Mill 04', hp: 50 },
  { id: 5, name: 'Vertical Mill 05', hp: 50 },
  { id: 6, name: 'Vertical Mill 06', hp: 50 },
  { id: 7, name: 'Vertical Mill 07', hp: 50 },
  { id: 8, name: 'Vertical Mill 08', hp: 50 },
  { id: 9, name: 'Vertical Mill 09', hp: 50 },
  { id: 10, name: 'Vertical Mill 10', hp: 50 },
  { id: 11, name: 'Attrition Mill 01', hp: 75 },
  { id: 12, name: 'Attrition Mill 02', hp: 60 },
]

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function emptyMotorEntry() {
  return {
    amp: '',
    stop: '',
    timestamp: '',
    saved: false,
  }
}

function emptyMotorForm() {
  return {
    running_date: todayISO(),
    checked_by: '',
    remark: '',
    motors: SLURRY_MOTORS.map(() => emptyMotorEntry()),
  }
}

// Each input row has origin_rm per batch (array matching batches)
function emptyInputRow(name = '') {
  return {
    id: String(Date.now()) + String(Math.random()).slice(2, 8),
    input_name: name,
    origins: [],
    batches: [],
    timestamp: '',  // first-stamp from DB; set once
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
    input_rows: [emptyInputRow()],
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
            onKeyDown={e => { if (e.key === 'Enter') confirmNew() ; if (e.key === 'Escape') setAddingNew(false) }}
          />
          <button type="button" className="sl-add-new-btn" onClick={confirmNew}>OK</button>
          <button type="button" className="sl-add-new-cancel" onClick={() => setAddingNew(false)}>✕</button>
        </div>
      )}
    </div>
  )
}

function stamp12hr() {
  return new Date().toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  })
}

export default function SlurrySection({
  sharedBatches,
  setSharedBatches,
}) {
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [motorOpen, setMotorOpen] = useState(false)
  const [motorForm, setMotorForm] = useState(emptyMotorForm())
  const [motorSaving, setMotorSaving] = useState(false)
  const [motorSaved, setMotorSaved] = useState(false)
  const [motorError, setMotorError] = useState('')

  // Stable session key: one per calendar date so timestamps survive page reload
  const sessionId = useRef(`slurry-${new Date().toISOString().slice(0, 10)}`)

  // rowSaveState: { [rowId_batchIdx]: 'saving' | 'saved' | 'error' }
  const [rowSaveState, setRowSaveState] = useState({})
  const setRSS = (key, val) => setRowSaveState(p => ({ ...p, [key]: val }))

  // Custom inputs added by the user (persisted in session memory)
  const [customInputs, setCustomInputs] = useState([])
  const allInputOptions = [...DEFAULT_INPUT_OPTIONS, ...customInputs]

  // Recently used — updated after each successful auto-save
  const recentlyUsed = useRef([])

  const set = (k, v) =>
    setForm(p => ({
      ...p,
      [k]: v,
    }))

  // =========================================================
  // BATCH OPERATIONS
  // =========================================================

  const setBatchField = (bi, field, val) =>
    setSharedBatches(prev =>
      prev.map((b, i) =>
        i === bi
          ? {
              ...b,
              [field]: val,
            }
          : b
      )
    )

  function addBatch() {
    setSharedBatches(prev => [
      ...prev,
      {
        id: Date.now() + Math.random(),
        batch_no: '',
        tank_type: '',
      },
    ])
    // Pre-fill input rows from recently used names if current rows are all unnamed
    setForm(p => {
      const namedRows = p.input_rows.filter(r => r.input_name)
      if (namedRows.length === 0 && recentlyUsed.current.length > 0) {
        return {
          ...p,
          input_rows: recentlyUsed.current.map(name => emptyInputRow(name)),
        }
      }
      return p
    })
  }

  function removeBatch(bi) {
    if (sharedBatches.length <= 1) return

    setSharedBatches(prev =>
      prev.filter((_, i) => i !== bi)
    )

    setForm(p => ({
      ...p,
      input_rows: p.input_rows.map(r => ({
        ...r,
        origins: r.origins.filter((_, i) => i !== bi),
        batches: r.batches.filter((_, i) => i !== bi),
      })),
    }))
  }

  // =========================================================
  // INPUT ROW OPERATIONS
  // =========================================================

  const setInputRow = (idx, field, val) =>
    setForm(p => ({
      ...p,
      input_rows: p.input_rows.map((r, i) =>
        i === idx
          ? {
              ...r,
              [field]: val,
            }
          : r
      ),
    }))

  const setInputBatch = (rowIdx, batchIdx, val) =>
    setForm(p => ({
      ...p,
      input_rows: p.input_rows.map((r, i) => {
        if (i !== rowIdx) return r

        const batches = [...r.batches]
        batches[batchIdx] = val

        return {
          ...r,
          batches,
        }
      }),
    }))

  const setInputOrigin = (rowIdx, batchIdx, val) =>
    setForm(p => ({
      ...p,
      input_rows: p.input_rows.map((r, i) => {
        if (i !== rowIdx) return r

        const origins = [...r.origins]
        origins[batchIdx] = val

        return {
          ...r,
          origins,
        }
      }),
    }))

  // =========================================================
  // AUTO-SAVE INPUT ROW on qty blur
  // Upserts to slurry_input_saves; preserves first_stamp.
  // =========================================================

  const autoSaveInputRow = useCallback(async (rowIdx, batchIdx) => {
    const row = form.input_rows[rowIdx]
    const qty = row.batches[batchIdx] ?? ''
    if (qty === '' || qty === null) return   // nothing to save yet

    const key = `${row.id}_${batchIdx}`
    setRSS(key, 'saving')

    const now12 = stamp12hr()

    // Check if this row+batch already has a first_stamp in DB
    let firstStamp = row.timestamp || ''

    if (supabaseReady) {
      const { data: existing } = await supabase
        .from('slurry_input_saves')
        .select('first_stamp')
        .eq('session_id', sessionId.current)
        .eq('row_id', String(row.id))
        .eq('batch_index', batchIdx)
        .maybeSingle()

      // Preserve DB first_stamp if it exists; otherwise use now
      firstStamp = existing?.first_stamp || firstStamp || now12

      const { error: upsertErr } = await supabase
        .from('slurry_input_saves')
        .upsert(
          {
            session_id:  sessionId.current,
            row_id:      String(row.id),
            batch_index: batchIdx,
            input_name:  row.input_name,
            origin:      row.origins[batchIdx] ?? '',
            qty_kg:      parseFloat(qty) || 0,
            first_stamp: firstStamp,
            updated_at:  new Date().toISOString(),
          },
          { onConflict: 'session_id,row_id,batch_index' }
        )

      if (upsertErr) {
        // DB not available — fall through to local stamp so timestamp still shows
        console.warn('slurry_input_saves upsert failed:', upsertErr.message)
      }
    } else {
      // Offline: use local stamp
      firstStamp = firstStamp || now12
    }

    // Write first_stamp back into React state (only if not already set)
    setForm(p => ({
      ...p,
      input_rows: p.input_rows.map((r, i) =>
        i === rowIdx && !r.timestamp
          ? { ...r, timestamp: firstStamp }
          : r
      ),
    }))

    setRSS(key, 'saved')
    // Update recently-used list
    recentlyUsed.current = [...new Set(
      form.input_rows.filter(r => r.input_name).map(r => r.input_name)
    )]
    // Clear the 'saved' indicator after 2 s
    setTimeout(() => setRSS(key, null), 2000)
  }, [form.input_rows, sessionId])

  function addInputRow() {
    setForm(p => ({
      ...p,
      input_rows: [
        ...p.input_rows,
        emptyInputRow(),
      ],
    }))
  }

  function removeInputRow(idx) {
    setForm(p => ({
      ...p,
      input_rows: p.input_rows.filter(
        (_, i) => i !== idx
      ),
    }))
  }

  // =========================================================
  // MILL OPERATIONS
  // =========================================================

  const setMill = (idx, field, val) =>
    setForm(p => ({
      ...p,
      mills: p.mills.map((m, i) =>
        i === idx
          ? {
              ...m,
              [field]: val,
            }
          : m
      ),
    }))

  // Add a new flow rate reading entry for a mill
  function addFlowRate(mi) {
    setForm(p => ({
      ...p,
      mills: p.mills.map((m, i) =>
        i === mi
          ? {
              ...m,
              flow_rates: [
                ...m.flow_rates,
                {
                  value: '',
                  timestamp: '',
                },
              ],
            }
          : m
      ),
    }))
  }

  // Update a flow rate entry value
  function setFlowRate(mi, fi, value) {
    setForm(p => ({
      ...p,
      mills: p.mills.map((m, i) =>
        i === mi
          ? {
              ...m,
              flow_rates: m.flow_rates.map(
                (f, j) =>
                  j === fi
                    ? {
                        ...f,
                        value,
                      }
                    : f
              ),
            }
          : m
      ),
    }))
  }

  // Stamp timestamp on a flow rate entry
  function stampFlowRate(mi, fi) {
    setForm(p => {
      if (p.mills[mi].flow_rates[fi].timestamp) return p   // already stamped
      return {
        ...p,
        mills: p.mills.map((m, i) =>
          i === mi
            ? {
                ...m,
                flow_rates: m.flow_rates.map(
                  (f, j) => j === fi ? { ...f, timestamp: stamp12hr() } : f
                ),
              }
            : m
        ),
      }
    })
  }

  // Remove a flow rate entry (keep at least one)
  function removeFlowRate(mi, fi) {
    setForm(p => ({
      ...p,
      mills: p.mills.map((m, i) =>
        i === mi &&
        m.flow_rates.length > 1
          ? {
              ...m,
              flow_rates: m.flow_rates.filter(
                (_, j) => j !== fi
              ),
            }
          : m
      ),
    }))
  }

  // =========================================================
  // TOTALS
  // =========================================================

  const colTotals = useMemo(
    () =>
      sharedBatches.map((_, bi) =>
        form.input_rows.reduce(
          (sum, r) =>
            sum +
            (parseFloat(r.batches[bi]) || 0),
          0
        )
      ),
    [form.input_rows, sharedBatches]
  )

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

    const { error: err } =
      await supabase
        .from('slurry_job_cards')
        .insert([
          {
            date: form.date || null,
            shift1_operator:
              form.shift1_operator,
            shift2_operator:
              form.shift2_operator,
            batches: sharedBatches,
            input_rows: form.input_rows,
            mills: form.mills,
            operator: form.operator,
            supervisor: form.supervisor,
            manager: form.manager,
          },
        ])

    setSaving(false)

    if (err) {
      setError(err.message)
    } else {
      setSaved(true)
      setForm(emptyForm())
    }
  }

  // =========================================================
  // MOTOR OPERATIONS
  // =========================================================

  const setMotorCell = (mi, key, val) =>
    setMotorForm(p => ({
      ...p,
      motors: p.motors.map((m, idx) =>
        idx === mi
          ? {
              ...m,
              [key]: val,
            }
          : m
      ),
    }))

  function saveMotorRow(mi) {
    setMotorForm(p => {
      if (p.motors[mi].saved) return p   // already stamped
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

    const { error: err } =
      await supabase
        .from('slurry_motor_amp')
        .insert([
          {
            running_date:
              motorForm.running_date,
            checked_by:
              motorForm.checked_by,
            remark:
              motorForm.remark,
            motor_data:
              motorForm.motors,
          },
        ])

    setMotorSaving(false)

    if (err) {
      setMotorError(err.message)
    } else {
      setMotorSaved(true)
      setMotorForm(emptyMotorForm())
    }
  }

  return (
    <div className="sl-wrapper">

      {/* =====================================================
          TITLE
      ===================================================== */}

      <div className="sl-title-bar">
        <div className="sl-title-main">
          Batch Operator — Process Job Card / <span className="sl-title-hi">बैच ऑपरेटर — प्रोसेस जॉब कार्ड</span>
        </div>
      </div>

      <form
        className="sl-form"
        onSubmit={handleSubmit}
      >

        {/* ===================================================
            META
        =================================================== */}

        <div className="sl-meta-bar">

          <div className="sl-meta-field">
            <label className="sl-label">
              Date /{' '}
              <span className="sl-label-hi">
                तारीख
              </span>
            </label>

            <input
              type="date"
              className="sl-input"
              value={form.date}
              onChange={e =>
                set('date', e.target.value)
              }
            />
          </div>

          <div className="sl-meta-field">
            <label className="sl-label">
              Shift 1 Operator /{' '}
              <span className="sl-label-hi">
                पहली पाली ऑपरेटर
              </span>
            </label>

            <input
              className="sl-input"
              placeholder="Operator name"
              value={form.shift1_operator}
              onChange={e =>
                set(
                  'shift1_operator',
                  e.target.value
                )
              }
            />
          </div>

          <div className="sl-meta-field">
            <label className="sl-label">
              Shift 2 Operator /{' '}
              <span className="sl-label-hi">
                दूसरी पाली ऑपरेटर
              </span>
            </label>

            <input
              className="sl-input"
              placeholder="Operator name"
              value={form.shift2_operator}
              onChange={e =>
                set(
                  'shift2_operator',
                  e.target.value
                )
              }
            />
          </div>

        </div>

        {/* ===================================================
            INPUTS TABLE
        =================================================== */}

        <div className="sl-section-title">
          Inputs (kg) /{' '}
          <span className="sl-hi">
            इनपुट (किग्रा)
          </span>
        </div>

        <div className="sl-table-scroll">

          <table className="sl-table">

            <thead>

              {/* =================================================
                  FIRST HEADER ROW
                  ================================================= */}

              <tr>

                {/* INPUTS COLUMN */}
                <th
                  className="sl-th-sticky sl-th-input"
                  rowSpan={2}
                >
                  Inputs
                  <br />
                  <span className="sl-hi">
                    इनपुट
                  </span>
                </th>

                {/* BATCH HEADER */}
                {sharedBatches.map(
                  (batch, bi) => (
                    <th
                      key={batch.id}
                      className="sl-th-batch-pair"
                      colSpan={2}
                    >

                      <div className="sl-batch-head-row">

                        <span className="sl-batch-num">
                          {batch.batch_no
                            ? `Batch: ${batch.batch_no}`
                            : `Batch-${bi + 1} / बैच-${bi + 1}`}
                        </span>

                        {sharedBatches.length >
                          1 && (
                          <button
                            type="button"
                            className="sl-del-batch-btn"
                            onClick={() =>
                              removeBatch(bi)
                            }
                          >
                            ✕
                          </button>
                        )}

                      </div>

                      <input
                        className="sl-batch-no-input"
                        placeholder="Enter Batch No. / बैच नं."
                        value={
                          batch.batch_no
                        }
                        onChange={e =>
                          setBatchField(
                            bi,
                            'batch_no',
                            e.target.value
                          )
                        }
                      />

                      <select
                        className="sl-batch-select"
                        value={
                          batch.tank_type
                        }
                        onChange={e =>
                          setBatchField(
                            bi,
                            'tank_type',
                            e.target.value
                          )
                        }
                      >
                        <option value="">
                          — Select Tank / टैंक चुनें —
                        </option>

                        {BATCH_OPTIONS.map(
                          grp => (
                            <optgroup
                              key={grp.group}
                              label={grp.group}
                            >
                              {grp.options.map(
                                opt => (
                                  <option
                                    key={
                                      opt.value
                                    }
                                    value={
                                      opt.value
                                    }
                                  >
                                    {opt.label}
                                  </option>
                                )
                              )}
                            </optgroup>
                          )
                        )}
                      </select>

                    </th>
                  )
                )}

                {/* TIMESTAMP */}
                <th
                  className="sl-th-ts"
                  rowSpan={2}
                >
                  Timestamp
                  <br />
                  <span className="sl-hi">
                    समय
                  </span>
                </th>

                {/* ACTION */}
                <th
                  className="sl-th-action"
                  rowSpan={2}
                >
                </th>

              </tr>

              {/* =================================================
                  SECOND HEADER ROW
                  THESE ARE REAL TABLE CELLS
                  SO THEY ALIGN EXACTLY WITH BODY COLUMNS
                  ================================================= */}

              <tr>

                {sharedBatches.map(
                  batch => (
                    <React.Fragment
                      key={`${batch.id}-subheaders`}
                    >

                      {/* ORIGIN/RM */}
                      <th className="sl-th-origin">
                        Origin/RM
                        <br />
                        <span className="sl-hi">
                          उद्गम/RM
                        </span>
                      </th>

                      {/* QTY */}
                      <th className="sl-th-qty">
                        Qty (kg)
                        <br />
                        <span className="sl-hi">
                          मात्रा
                        </span>
                      </th>

                    </React.Fragment>
                  )
                )}

              </tr>

            </thead>

            {/* ===================================================
                BODY
            =================================================== */}

            <tbody>

              {form.input_rows.map(
                (row, ri) => (

                  <tr
                    key={row.id}
                    className={`${ri % 2 === 0 ? '' : 'sl-tr-alt'}`}
                  >

                    {/* INPUT NAME */}
                    <td className="sl-td-sticky sl-td-input">

                      <InputDropdown
                        value={row.input_name}
                        onChange={name => setInputRow(ri, 'input_name', name)}
                        allOptions={allInputOptions}
                        recentlyUsed={recentlyUsed.current}
                        usedInForm={form.input_rows
                          .filter((_, i) => i !== ri)
                          .map(r => r.input_name)
                          .filter(Boolean)}
                        onAddNew={name => {
                          const lower = name.toLowerCase()
                          if (!allInputOptions.some(o => o.toLowerCase() === lower)) {
                            setCustomInputs(prev => [...prev, name])
                          }
                          setInputRow(ri, 'input_name', name)
                        }}
                      />

                    </td>

                    {/* BATCH COLUMNS */}
                    {sharedBatches.map(
                      (_, bi) => (
                        <React.Fragment
                          key={bi}
                        >

                          {/* ORIGIN */}
                          <td className="sl-td-origin-cell">

                            <input
                              className="sl-input-cell"
                              placeholder="RM / Origin"
                              value={
                                row.origins[
                                  bi
                                ] ?? ''
                              }
                              onChange={e =>
                                setInputOrigin(
                                  ri,
                                  bi,
                                  e.target.value
                                )
                              }
                            />

                          </td>

                          {/* QTY */}
                          <td className="sl-td-batch">

                            <input
                              type="number"
                              className="sl-input-num"
                              placeholder="—"
                              value={
                                row.batches[
                                  bi
                                ] ?? ''
                              }
                              onChange={e =>
                                setInputBatch(
                                  ri,
                                  bi,
                                  e.target.value
                                )
                              }
                              onBlur={() =>
                                autoSaveInputRow(ri, bi)
                              }
                            />
                            {/* Auto-save indicator */}
                            {(() => {
                              const k = `${row.id}_${bi}`
                              const s = rowSaveState[k]
                              if (s === 'saving') return <span className="sl-autosave-indicator sl-autosave-saving">…</span>
                              if (s === 'saved')  return <span className="sl-autosave-indicator sl-autosave-ok">Saved ✓</span>
                              if (s === 'error')  return <span className="sl-autosave-indicator sl-autosave-err">!</span>
                              return null
                            })()}

                          </td>

                        </React.Fragment>
                      )
                    )}

                    {/* TIMESTAMP */}
                    <td className="sl-td-ts">

                      {row.timestamp ? (
                        <span className="sl-ts-badge">
                          {row.timestamp}
                        </span>
                      ) : (
                        <span className="sl-ts-empty">
                          —
                        </span>
                      )}

                    </td>

                    {/* DELETE */}
                    <td className="sl-td-action">

                      {form.input_rows
                        .length > 1 && (
                        <button
                          type="button"
                          className="sl-remove-btn"
                          onClick={() =>
                            removeInputRow(
                              ri
                            )
                          }
                        >
                          ✕
                        </button>
                      )}

                    </td>

                  </tr>

                )
              )}

            </tbody>

          </table>

        </div>

        {/* ===================================================
            TOTAL WT
        =================================================== */}

        <div className="sl-total-bar">

          <span className="sl-total-bar-label">
            TOTAL WT. /{' '}
            <span className="sl-hi">
              कुल वजन
            </span>
          </span>

          <div className="sl-total-bar-cols">

            {colTotals.map(
              (total, bi) => (
                <span
                  key={bi}
                  className="sl-total-bar-item"
                >

                  <span className="sl-total-bar-batch">
                    {sharedBatches[bi]
                      ?.batch_no
                      ? `Batch-${bi + 1} / बैच-${bi + 1} (${sharedBatches[bi].batch_no})`
                      : `Batch-${bi + 1} / बैच-${bi + 1}`}
                  </span>

                  <span className="sl-total-bar-sep">
                    {' '}
                    —{' '}
                  </span>

                  <span className="sl-total-bar-val">
                    {total > 0
                      ? total
                      : '—'}
                  </span>

                </span>
              )
            )}

          </div>

        </div>

        {/* ===================================================
            CONTROLS
        =================================================== */}

        <div className="sl-add-row-bar">

          <button
            type="button"
            className="sl-add-btn"
            onClick={addInputRow}
          >
            + Add Input Row /{' '}
            <span className="sl-hi">
              इनपुट पंक्ति जोड़ें
            </span>
          </button>

          <button
            type="button"
            className="sl-add-btn sl-add-batch-btn"
            onClick={addBatch}
          >
            + Add Batch{' '}
            {sharedBatches.length + 1}
          </button>

        </div>
        {/* ===================================================
            APPROVAL
        =================================================== */}

        <div className="sl-approval-bar">

          <div className="sl-approval-field">

            <label className="sl-label">
              Operator /{' '}
              <span className="sl-label-hi">
                ऑपरेटर
              </span>
            </label>

            <input
              className="sl-input"
              placeholder="Name"
              value={form.operator}
              onChange={e =>
                set(
                  'operator',
                  e.target.value
                )
              }
            />

          </div>

          <div className="sl-approval-field">

            <label className="sl-label">
              Supervisor /{' '}
              <span className="sl-label-hi">
                सुपरवाइज़र
              </span>
            </label>

            <input
              className="sl-input"
              placeholder="Name"
              value={
                form.supervisor
              }
              onChange={e =>
                set(
                  'supervisor',
                  e.target.value
                )
              }
            />

          </div>

          <div className="sl-approval-field">

            <label className="sl-label">
              Manager /{' '}
              <span className="sl-label-hi">
                मैनेजर
              </span>
            </label>

            <input
              className="sl-input"
              placeholder="Name"
              value={
                form.manager
              }
              onChange={e =>
                set(
                  'manager',
                  e.target.value
                )
              }
            />

          </div>

        </div>

        {/* ===================================================
            ACTIONS
        =================================================== */}

        <div className="sl-actions">

          {error && (
            <div className="sl-error">
              Error: {error}
            </div>
          )}

          {saved && (
            <div className="sl-success">
              ✓ Saved successfully /
              सफलतापूर्वक सहेजा गया
            </div>
          )}

          <button
            type="submit"
            className="sl-save-btn"
            disabled={saving}
          >
            {saving
              ? 'Saving…'
              : 'Save Job Card / जॉब कार्ड सहेजें'}
          </button>

          <button
            type="button"
            className="sl-reset-btn"
            onClick={() => {
              setForm(emptyForm())
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
