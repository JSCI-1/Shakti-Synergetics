import React, { useState, useMemo } from 'react'
import { supabase, supabaseReady } from '../supabaseClient'
import './SlurrySection.css'

const DEFAULT_INPUTS = [
  'SULPHUR', 'LIGNO-A', 'LIGNO-B', 'FBPP',
  'DN Powder', 'FZ 1', 'DEFOMER', 'CHINA CLAY', 'WATER',
]

const MILLS = ['V1','V2','V3','V4','V5','V6','V7','H1']

const BATCH_OPTIONS = [
  { group: 'Attrition Mills', options: [
    { label: '1st Attrition Mill — 1.6 MT', value: 'Attrition-1st-1.6MT' },
    { label: '2nd Attrition Mill — 1.2 MT', value: 'Attrition-2nd-1.2MT' },
  ]},
  { group: 'HST (High Speed Tank)', options: [
    { label: 'HST 1st — 8 MT', value: 'HST-1st-8MT' },
    { label: 'HST 2nd — 6 MT', value: 'HST-2nd-6MT' },
  ]},
]

const SLURRY_MOTORS = [
  { id: 1,  name: 'Vertical Mill 01', hp: 50 },
  { id: 2,  name: 'Vertical Mill 02', hp: 50 },
  { id: 3,  name: 'Vertical Mill 03', hp: 50 },
  { id: 4,  name: 'Vertical Mill 04', hp: 50 },
  { id: 5,  name: 'Vertical Mill 05', hp: 50 },
  { id: 6,  name: 'Vertical Mill 06', hp: 50 },
  { id: 7,  name: 'Vertical Mill 07', hp: 50 },
  { id: 8,  name: 'Vertical Mill 08', hp: 50 },
  { id: 9,  name: 'Vertical Mill 09', hp: 50 },
  { id: 10, name: 'Vertical Mill 10', hp: 50 },
  { id: 11, name: 'Attrition Mill 01', hp: 75 },
  { id: 12, name: 'Attrition Mill 02', hp: 60 },
]

function todayISO() { return new Date().toISOString().slice(0, 10) }
function emptyMotorEntry() { return { amp: '', stop: '', timestamp: '', saved: false } }

function emptyMotorForm() {
  return {
    running_date: todayISO(),
    checked_by: '',
    remark: '',
    motors: SLURRY_MOTORS.map(() => emptyMotorEntry()),
  }
}

// Batch now has batch_no field for user entry
function emptyBatch(index) {
  return { id: Date.now() + Math.random(), batch_no: '', tank_type: '' }
}

function emptyInputRow(name = '') {
  return {
    id: Date.now() + Math.random(),
    input_name: name,
    origin_rm_batch: '',
    batches: [],
    timestamp: '',
    saved: false,
  }
}

// Mill row — replaced rated_time with remarks
function emptyMillRow(mill) {
  return { mill, flow_rate: '', current_amp: '', zirconia_beads: '', remarks: '' }
}

function emptyForm() {
  return {
    date: '',
    shift1_operator: '',
    shift2_operator: '',
    batches: [emptyBatch(0)],
    input_rows: DEFAULT_INPUTS.map(n => emptyInputRow(n)),
    mills: MILLS.map(m => emptyMillRow(m)),
    operator: '', supervisor: '', manager: '',
  }
}

// 12-hour timestamp
function stamp12hr() {
  return new Date().toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: true,
  })
}

export default function SlurrySection() {
  const [form, setForm]       = useState(emptyForm())
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [error, setError]     = useState('')

  const [motorOpen, setMotorOpen]     = useState(false)
  const [motorForm, setMotorForm]     = useState(emptyMotorForm())
  const [motorSaving, setMotorSaving] = useState(false)
  const [motorSaved, setMotorSaved]   = useState(false)
  const [motorError, setMotorError]   = useState('')

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  // ── Batch header ──
  const setBatchField = (bi, field, val) =>
    setForm(p => ({
      ...p,
      batches: p.batches.map((b, i) => i === bi ? { ...b, [field]: val } : b),
    }))

  // ── Input rows ──
  const setInputRow = (idx, field, val) =>
    setForm(p => ({
      ...p,
      input_rows: p.input_rows.map((r, i) => i === idx ? { ...r, [field]: val } : r),
    }))

  const setInputBatch = (rowIdx, batchIdx, val) =>
    setForm(p => ({
      ...p,
      input_rows: p.input_rows.map((r, i) => {
        if (i !== rowIdx) return r
        const batches = [...r.batches]
        batches[batchIdx] = val
        return { ...r, batches }
      }),
    }))

  // Save a single input row (stamp timestamp)
  function saveInputRow(idx) {
    setForm(p => ({
      ...p,
      input_rows: p.input_rows.map((r, i) =>
        i === idx ? { ...r, timestamp: stamp12hr(), saved: true } : r
      ),
    }))
  }

  const setMill = (idx, field, val) =>
    setForm(p => ({
      ...p,
      mills: p.mills.map((m, i) => i === idx ? { ...m, [field]: val } : m),
    }))

  function addInputRow() {
    setForm(p => ({ ...p, input_rows: [...p.input_rows, emptyInputRow()] }))
  }

  function removeInputRow(idx) {
    setForm(p => ({ ...p, input_rows: p.input_rows.filter((_, i) => i !== idx) }))
  }

  function addBatch() {
    setForm(p => ({ ...p, batches: [...p.batches, emptyBatch(p.batches.length)] }))
  }

  function removeBatch(bi) {
    setForm(p => ({
      ...p,
      batches: p.batches.filter((_, i) => i !== bi),
      input_rows: p.input_rows.map(r => ({
        ...r,
        batches: r.batches.filter((_, i) => i !== bi),
      })),
    }))
  }

  const colTotals = useMemo(() =>
    form.batches.map((_, bi) =>
      form.input_rows.reduce((sum, r) => sum + (parseFloat(r.batches[bi]) || 0), 0)
    ),
    [form.input_rows, form.batches]
  )

  async function handleSubmit(e) {
    e.preventDefault()
    if (!supabaseReady) { setError('Supabase not configured.'); return }
    setSaving(true); setError(''); setSaved(false)
    const { error: err } = await supabase.from('slurry_job_cards').insert([{
      date:            form.date || null,
      shift1_operator: form.shift1_operator,
      shift2_operator: form.shift2_operator,
      batches:         form.batches,
      input_rows:      form.input_rows,
      mills:           form.mills,
      operator:        form.operator,
      supervisor:      form.supervisor,
      manager:         form.manager,
    }])
    setSaving(false)
    if (err) setError(err.message)
    else { setSaved(true); setForm(emptyForm()) }
  }

  // ── Motor Amp ──
  const setMotorCell = (mi, key, val) =>
    setMotorForm(p => ({
      ...p,
      motors: p.motors.map((m, idx) => idx === mi ? { ...m, [key]: val } : m),
    }))

  function saveMotorRow(mi) {
    setMotorForm(p => ({
      ...p,
      motors: p.motors.map((m, idx) =>
        idx === mi ? { ...m, timestamp: stamp12hr(), saved: true } : m
      ),
    }))
  }

  async function handleMotorSubmit(e) {
    e.preventDefault()
    if (!supabaseReady) { setMotorError('Supabase not configured.'); return }
    setMotorSaving(true); setMotorError(''); setMotorSaved(false)
    const { error: err } = await supabase.from('slurry_motor_amp').insert([{
      running_date: motorForm.running_date,
      checked_by:   motorForm.checked_by,
      remark:       motorForm.remark,
      motor_data:   motorForm.motors,
    }])
    setMotorSaving(false)
    if (err) setMotorError(err.message)
    else { setMotorSaved(true); setMotorForm(emptyMotorForm()) }
  }

  return (
    <div className="sl-wrapper">

      <div className="sl-title-bar">
        <div className="sl-title-main">Process Job Card</div>
      </div>

      <form className="sl-form" onSubmit={handleSubmit}>

        {/* ══ META ══ */}
        <div className="sl-meta-bar">
          <div className="sl-meta-field">
            <label className="sl-label">Date</label>
            <input type="date" className="sl-input"
              value={form.date} onChange={e => set('date', e.target.value)} />
          </div>
          <div className="sl-meta-field">
            <label className="sl-label">Shift 1st Operator</label>
            <input className="sl-input" placeholder="Operator name"
              value={form.shift1_operator} onChange={e => set('shift1_operator', e.target.value)} />
          </div>
          <div className="sl-meta-field">
            <label className="sl-label">Shift 2nd Operator</label>
            <input className="sl-input" placeholder="Operator name"
              value={form.shift2_operator} onChange={e => set('shift2_operator', e.target.value)} />
          </div>
        </div>

        {/* ══ INPUTS TABLE ══ */}
        <div className="sl-section-title">Inputs (kg)</div>
        <div className="sl-table-scroll">
          <table className="sl-table">
            <thead>
              <tr>
                <th className="sl-th-sticky sl-th-input">Inputs</th>
                <th className="sl-th-origin sl-th-sticky2">Origin / RM Batch No.</th>
                {form.batches.map((batch, bi) => (
                  <th key={batch.id} className="sl-th-batch sl-th-batch-head">
                    <div className="sl-batch-head-row">
                      <span className="sl-batch-num">Batch-{bi + 1}</span>
                      {form.batches.length > 1 && (
                        <button type="button" className="sl-del-batch-btn"
                          onClick={() => removeBatch(bi)}>✕</button>
                      )}
                    </div>
                    {/* User-entered batch number */}
                    <input
                      className="sl-batch-no-input"
                      placeholder="Batch No."
                      value={batch.batch_no}
                      onChange={e => setBatchField(bi, 'batch_no', e.target.value)}
                    />
                    <select className="sl-batch-select"
                      value={batch.tank_type}
                      onChange={e => setBatchField(bi, 'tank_type', e.target.value)}>
                      <option value="">— Select Tank —</option>
                      {BATCH_OPTIONS.map(grp => (
                        <optgroup key={grp.group} label={grp.group}>
                          {grp.options.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </th>
                ))}
                <th className="sl-th-ts">Timestamp</th>
                <th className="sl-th-save">Save</th>
                <th className="sl-th-action"></th>
              </tr>
            </thead>
            <tbody>
              {form.input_rows.map((row, ri) => (
                <tr key={row.id} className={`${ri % 2 === 0 ? '' : 'sl-tr-alt'} ${row.saved ? 'sl-row-saved' : ''}`}>
                  <td className="sl-td-sticky sl-td-input">
                    <input className="sl-input-cell" placeholder="Input name"
                      value={row.input_name}
                      onChange={e => setInputRow(ri, 'input_name', e.target.value)} />
                  </td>
                  <td className="sl-td-sticky2 sl-td-origin">
                    <input className="sl-input-cell" placeholder="RM / Origin"
                      value={row.origin_rm_batch}
                      onChange={e => setInputRow(ri, 'origin_rm_batch', e.target.value)} />
                  </td>
                  {form.batches.map((_, bi) => (
                    <td key={bi} className="sl-td-batch">
                      <input type="number" className="sl-input-num" placeholder="—"
                        value={row.batches[bi] ?? ''}
                        onChange={e => setInputBatch(ri, bi, e.target.value)} />
                    </td>
                  ))}
                  {/* Timestamp */}
                  <td className="sl-td-ts">
                    {row.timestamp
                      ? <span className="sl-ts-badge">{row.timestamp}</span>
                      : <span className="sl-ts-empty">—</span>}
                  </td>
                  {/* Row save button */}
                  <td className="sl-td-save">
                    <button type="button" className="sl-row-save-btn"
                      onClick={() => saveInputRow(ri)}>
                      {row.saved ? '✓' : '💾'}
                    </button>
                  </td>
                  <td className="sl-td-action">
                    {form.input_rows.length > 1 && (
                      <button type="button" className="sl-remove-btn"
                        onClick={() => removeInputRow(ri)}>✕</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Total WT ── */}
        <div className="sl-total-bar">
          <span className="sl-total-bar-label">TOTAL WT.</span>
          <div className="sl-total-bar-cols">
            {colTotals.map((total, bi) => (
              <span key={bi} className="sl-total-bar-item">
                <span className="sl-total-bar-batch">
                  {form.batches[bi]?.batch_no || `Batch-${bi + 1}`}
                </span>
                <span className="sl-total-bar-val">{total > 0 ? total : '—'}</span>
              </span>
            ))}
          </div>
        </div>

        {/* ── Controls ── */}
        <div className="sl-add-row-bar">
          <button type="button" className="sl-add-btn" onClick={addInputRow}>
            + Add Input Row
          </button>
          <button type="button" className="sl-add-btn sl-add-batch-btn" onClick={addBatch}>
            + Add Batch {form.batches.length + 1}
          </button>
        </div>

        {/* ══ SAND MILLING — no suspension block, full width ══ */}
        <div className="sl-section-title">Sand Milling Details</div>
        <div className="sl-mill-scroll">
          <table className="sl-mill-table">
            <thead>
              <tr>
                <th>Mill No.</th>
                <th>Flow Rate (L/Sec)</th>
                <th>Current Amp</th>
                <th>Zirconox/Zircosil Beads (kg)</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {form.mills.map((mill, mi) => (
                <tr key={mill.mill} className={mi % 2 === 0 ? '' : 'sl-tr-alt'}>
                  <td className="sl-mill-name">Mill No. {mill.mill}</td>
                  <td><input type="number" className="sl-input-num-wide" placeholder="—"
                    value={mill.flow_rate} onChange={e => setMill(mi, 'flow_rate', e.target.value)} /></td>
                  <td><input type="number" className="sl-input-num-wide" placeholder="—"
                    value={mill.current_amp} onChange={e => setMill(mi, 'current_amp', e.target.value)} /></td>
                  <td><input type="number" className="sl-input-num-wide" placeholder="—"
                    value={mill.zirconia_beads} onChange={e => setMill(mi, 'zirconia_beads', e.target.value)} /></td>
                  <td><input className="sl-input-wide-text" placeholder="—"
                    value={mill.remarks} onChange={e => setMill(mi, 'remarks', e.target.value)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ══ APPROVAL ══ */}
        <div className="sl-approval-bar">
          <div className="sl-approval-field">
            <label className="sl-label">Operator</label>
            <input className="sl-input" placeholder="Name"
              value={form.operator} onChange={e => set('operator', e.target.value)} />
          </div>
          <div className="sl-approval-field">
            <label className="sl-label">Supervisor</label>
            <input className="sl-input" placeholder="Name"
              value={form.supervisor} onChange={e => set('supervisor', e.target.value)} />
          </div>
          <div className="sl-approval-field">
            <label className="sl-label">Manager</label>
            <input className="sl-input" placeholder="Name"
              value={form.manager} onChange={e => set('manager', e.target.value)} />
          </div>
        </div>

        {/* ══ ACTIONS ══ */}
        <div className="sl-actions">
          {error && <div className="sl-error">Error: {error}</div>}
          {saved  && <div className="sl-success">✓ Saved successfully</div>}
          <button type="submit" className="sl-save-btn" disabled={saving}>
            {saving ? 'Saving…' : 'Save Job Card'}
          </button>
          <button type="button" className="sl-reset-btn"
            onClick={() => { setForm(emptyForm()); setSaved(false); setError('') }}>
            Reset
          </button>
        </div>

      </form>

      {/* ══ ACCORDION: Running Motor Amp Status ══ */}
      <div className="sl-accordion">
        <button type="button" className="sl-accordion-header"
          onClick={() => setMotorOpen(o => !o)}>
          <span className="sl-accordion-title">Running Motor Amp Status</span>
          <span className="sl-accordion-icon">{motorOpen ? '▲' : '▼'}</span>
        </button>

        {motorOpen && (
          <form className="sl-motor-form" onSubmit={handleMotorSubmit}>
            <div className="sl-motor-meta">
              <div className="sl-motor-meta-field">
                <label className="sl-label">Running Date</label>
                <input type="date" className="sl-input"
                  value={motorForm.running_date}
                  min={todayISO()} max={todayISO()} readOnly
                  style={{ background: '#f5f0ea', cursor: 'not-allowed' }} />
                <div style={{ fontSize: '10px', color: '#999', marginTop: '3px' }}>
                  Today only — {motorForm.running_date.split('-').reverse().join('/')}
                </div>
              </div>
              <div className="sl-motor-meta-field">
                <label className="sl-label">Checked By</label>
                <input className="sl-input" placeholder="Name"
                  value={motorForm.checked_by}
                  onChange={e => setMotorForm(p => ({ ...p, checked_by: e.target.value }))} />
              </div>
            </div>

            <div className="sl-motor-scroll">
              <table className="sl-motor-table">
                <thead>
                  <tr>
                    <th>Sr. No.</th>
                    <th>Motor Name</th>
                    <th>HP</th>
                    <th>Amp Reading</th>
                    <th>Status</th>
                    <th>Timestamp</th>
                    <th>Save</th>
                  </tr>
                </thead>
                <tbody>
                  {SLURRY_MOTORS.map((motor, mi) => (
                    <tr key={motor.id}
                      className={`${mi % 2 === 0 ? '' : 'sl-motor-alt'} ${motorForm.motors[mi].saved ? 'sl-motor-saved' : ''}`}>
                      <td className="sl-motor-sr">{motor.id}</td>
                      <td className="sl-motor-name">{motor.name}</td>
                      <td className="sl-motor-hp">{motor.hp}</td>
                      <td>
                        <input type="number" className="sl-motor-input" placeholder="—"
                          value={motorForm.motors[mi].amp}
                          onChange={e => setMotorCell(mi, 'amp', e.target.value)} />
                      </td>
                      <td>
                        <select className="sl-motor-select"
                          value={motorForm.motors[mi].stop}
                          onChange={e => setMotorCell(mi, 'stop', e.target.value)}>
                          <option value="">—</option>
                          <option value="OK">OK</option>
                          <option value="STOP">STOP</option>
                        </select>
                      </td>
                      <td className="sl-motor-ts">
                        {motorForm.motors[mi].timestamp
                          ? <span className="sl-ts-badge">{motorForm.motors[mi].timestamp}</span>
                          : <span className="sl-ts-empty">—</span>}
                      </td>
                      <td className="sl-motor-save-cell">
                        <button type="button" className="sl-row-save-btn"
                          onClick={() => saveMotorRow(mi)}>
                          {motorForm.motors[mi].saved ? '✓' : '💾'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="sl-motor-remark">
              <label className="sl-label">Remark</label>
              <input className="sl-input" placeholder="Remark..."
                value={motorForm.remark}
                onChange={e => setMotorForm(p => ({ ...p, remark: e.target.value }))} />
            </div>

            <div className="sl-actions">
              {motorError && <div className="sl-error">Error: {motorError}</div>}
              {motorSaved  && <div className="sl-success">✓ Saved successfully</div>}
              <button type="submit" className="sl-save-btn" disabled={motorSaving}>
                {motorSaving ? 'Saving…' : 'Save Motor Status'}
              </button>
              <button type="button" className="sl-reset-btn"
                onClick={() => { setMotorForm(emptyMotorForm()); setMotorSaved(false); setMotorError('') }}>
                Reset
              </button>
            </div>
          </form>
        )}
      </div>

    </div>
  )
}
