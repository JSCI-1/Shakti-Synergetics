import React, { useState, useMemo } from 'react'
import { supabase, supabaseReady } from '../supabaseClient'
import './SlurrySection.css'

const DEFAULT_INPUTS = [
  'SULPHUR', 'LIGNO-A', 'LIGNO-B', 'FBPP',
  'DN Powder', 'FZ 1', 'DEFOMER', 'CHINA CLAY', 'WATER',
]

const MILLS = ['V1','V2','V3','V4','V5','V6','V7','H1']

const BATCH_OPTIONS = [
  { group: 'Attrition Mills / अट्रिशन मिल्स', options: [
    { label: '1st Attrition Mill — 1.6 MT', value: 'Attrition-1st-1.6MT' },
    { label: '2nd Attrition Mill — 1.2 MT', value: 'Attrition-2nd-1.2MT' },
  ]},
  { group: 'HST (High Speed Tank) / उच्च गति टैंक', options: [
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
  return { running_date: todayISO(), checked_by: '', remark: '', motors: SLURRY_MOTORS.map(() => emptyMotorEntry()) }
}

// Each input row has origin_rm per batch (array matching batches)
function emptyInputRow(name = '') {
  return { id: Date.now() + Math.random(), input_name: name, origins: [], batches: [], timestamp: '', saved: false }
}
function emptyMillRow(mill) {
  return {
    mill,
    flow_rates: [{ value: '', timestamp: '' }],  // array of readings
    current_amp: '',
    zirconia_beads: '',
    remarks: '',
  }
}
function emptyForm() {
  return {
    date: '', shift1_operator: '', shift2_operator: '',
    input_rows: DEFAULT_INPUTS.map(n => emptyInputRow(n)),
    mills: MILLS.map(m => emptyMillRow(m)),
    operator: '', supervisor: '', manager: '',
  }
}
function stamp12hr() {
  return new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
}

export default function SlurrySection({ sharedBatches, setSharedBatches }) {
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

  // Batch operations — write to shared state
  const setBatchField = (bi, field, val) =>
    setSharedBatches(prev => prev.map((b, i) => i === bi ? { ...b, [field]: val } : b))

  function addBatch() {
    setSharedBatches(prev => [...prev, { id: Date.now() + Math.random(), batch_no: '', tank_type: '' }])
  }

  function removeBatch(bi) {
    if (sharedBatches.length <= 1) return
    setSharedBatches(prev => prev.filter((_, i) => i !== bi))
    setForm(p => ({
      ...p,
      input_rows: p.input_rows.map(r => ({
        ...r,
        origins: r.origins.filter((_, i) => i !== bi),
        batches: r.batches.filter((_, i) => i !== bi),
      })),
    }))
  }

  // Input row operations
  const setInputRow = (idx, field, val) =>
    setForm(p => ({ ...p, input_rows: p.input_rows.map((r, i) => i === idx ? { ...r, [field]: val } : r) }))

  const setInputBatch = (rowIdx, batchIdx, val) =>
    setForm(p => ({
      ...p,
      input_rows: p.input_rows.map((r, i) => {
        if (i !== rowIdx) return r
        const batches = [...r.batches]; batches[batchIdx] = val
        return { ...r, batches }
      }),
    }))

  const setInputOrigin = (rowIdx, batchIdx, val) =>
    setForm(p => ({
      ...p,
      input_rows: p.input_rows.map((r, i) => {
        if (i !== rowIdx) return r
        const origins = [...r.origins]; origins[batchIdx] = val
        return { ...r, origins }
      }),
    }))

  function saveInputRow(idx) {
    setForm(p => ({
      ...p,
      input_rows: p.input_rows.map((r, i) => i === idx ? { ...r, timestamp: stamp12hr(), saved: true } : r),
    }))
  }

  function addInputRow() { setForm(p => ({ ...p, input_rows: [...p.input_rows, emptyInputRow()] })) }
  function removeInputRow(idx) { setForm(p => ({ ...p, input_rows: p.input_rows.filter((_, i) => i !== idx) })) }

  const setMill = (idx, field, val) =>
    setForm(p => ({ ...p, mills: p.mills.map((m, i) => i === idx ? { ...m, [field]: val } : m) }))

  // Add a new flow rate reading entry for a mill
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

  // Update a flow rate entry value
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

  // Stamp timestamp on a flow rate entry
  function stampFlowRate(mi, fi) {
    setForm(p => ({
      ...p,
      mills: p.mills.map((m, i) =>
        i === mi
          ? { ...m, flow_rates: m.flow_rates.map((f, j) => j === fi ? { ...f, timestamp: stamp12hr() } : f) }
          : m
      ),
    }))
  }

  // Remove a flow rate entry (keep at least one)
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

  const colTotals = useMemo(() =>
    sharedBatches.map((_, bi) =>
      form.input_rows.reduce((sum, r) => sum + (parseFloat(r.batches[bi]) || 0), 0)
    ), [form.input_rows, sharedBatches])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!supabaseReady) { setError('Supabase not configured.'); return }
    setSaving(true); setError(''); setSaved(false)
    const { error: err } = await supabase.from('slurry_job_cards').insert([{
      date: form.date || null, shift1_operator: form.shift1_operator, shift2_operator: form.shift2_operator,
      batches: sharedBatches, input_rows: form.input_rows, mills: form.mills,
      operator: form.operator, supervisor: form.supervisor, manager: form.manager,
    }])
    setSaving(false)
    if (err) setError(err.message)
    else { setSaved(true); setForm(emptyForm()) }
  }

  const setMotorCell = (mi, key, val) =>
    setMotorForm(p => ({ ...p, motors: p.motors.map((m, idx) => idx === mi ? { ...m, [key]: val } : m) }))

  function saveMotorRow(mi) {
    setMotorForm(p => ({
      ...p,
      motors: p.motors.map((m, idx) => idx === mi ? { ...m, timestamp: stamp12hr(), saved: true } : m),
    }))
  }

  async function handleMotorSubmit(e) {
    e.preventDefault()
    if (!supabaseReady) { setMotorError('Supabase not configured.'); return }
    setMotorSaving(true); setMotorError(''); setMotorSaved(false)
    const { error: err } = await supabase.from('slurry_motor_amp').insert([{
      running_date: motorForm.running_date, checked_by: motorForm.checked_by,
      remark: motorForm.remark, motor_data: motorForm.motors,
    }])
    setMotorSaving(false)
    if (err) setMotorError(err.message)
    else { setMotorSaved(true); setMotorForm(emptyMotorForm()) }
  }

  return (
    <div className="sl-wrapper">

      <div className="sl-title-bar">
        <div className="sl-title-main">Process Job Card / <span className="sl-title-hi">प्रोसेस जॉब कार्ड</span></div>
      </div>

      <form className="sl-form" onSubmit={handleSubmit}>

        {/* ══ META ══ */}
        <div className="sl-meta-bar">
          <div className="sl-meta-field">
            <label className="sl-label">Date / <span className="sl-label-hi">तारीख</span></label>
            <input type="date" className="sl-input" value={form.date} onChange={e => set('date', e.target.value)} />
          </div>
          <div className="sl-meta-field">
            <label className="sl-label">Shift 1 Operator / <span className="sl-label-hi">पहली पाली ऑपरेटर</span></label>
            <input className="sl-input" placeholder="Operator name" value={form.shift1_operator} onChange={e => set('shift1_operator', e.target.value)} />
          </div>
          <div className="sl-meta-field">
            <label className="sl-label">Shift 2 Operator / <span className="sl-label-hi">दूसरी पाली ऑपरेटर</span></label>
            <input className="sl-input" placeholder="Operator name" value={form.shift2_operator} onChange={e => set('shift2_operator', e.target.value)} />
          </div>
        </div>

        {/* ══ INPUTS TABLE ══ */}
        <div className="sl-section-title">Inputs (kg) / <span className="sl-hi">इनपुट (किग्रा)</span></div>
        <div className="sl-table-scroll">
          <table className="sl-table">
            <thead>
              <tr>
                {/* Inputs column — sticky */}
                <th className="sl-th-sticky sl-th-input">
                  Inputs<br /><span className="sl-hi">इनपुट</span>
                </th>
                {/* One pair of [Origin | Qty] per batch — NOT sticky */}
                {sharedBatches.map((batch, bi) => (
                  <th key={batch.id} className="sl-th-batch-pair" colSpan={2}>
                    <div className="sl-batch-head-row">
                      <span className="sl-batch-num">
                        {batch.batch_no
                          ? `Batch: ${batch.batch_no}`
                          : `Batch-${bi + 1} / बैच-${bi + 1}`}
                      </span>
                      {sharedBatches.length > 1 && (
                        <button type="button" className="sl-del-batch-btn" onClick={() => removeBatch(bi)}>✕</button>
                      )}
                    </div>
                    <input
                      className="sl-batch-no-input"
                      placeholder="Enter Batch No. / बैच नं."
                      value={batch.batch_no}
                      onChange={e => setBatchField(bi, 'batch_no', e.target.value)}
                    />
                    <select className="sl-batch-select"
                      value={batch.tank_type}
                      onChange={e => setBatchField(bi, 'tank_type', e.target.value)}>
                      <option value="">— Select Tank / टैंक चुनें —</option>
                      {BATCH_OPTIONS.map(grp => (
                        <optgroup key={grp.group} label={grp.group}>
                          {grp.options.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    {/* Sub-headers for Origin and Qty */}
                    <div className="sl-batch-sub-headers">
                      <span>Origin/RM<br /><span className="sl-hi">उद्गम/RM</span></span>
                      <span>Qty (kg)<br /><span className="sl-hi">मात्रा</span></span>
                    </div>
                  </th>
                ))}
                <th className="sl-th-ts">Timestamp<br /><span className="sl-hi">समय</span></th>
                <th className="sl-th-save">Save<br /><span className="sl-hi">सहेजें</span></th>
                <th className="sl-th-action"></th>
              </tr>
            </thead>
            <tbody>
              {form.input_rows.map((row, ri) => (
                <tr key={row.id} className={`${ri % 2 === 0 ? '' : 'sl-tr-alt'} ${row.saved ? 'sl-row-saved' : ''}`}>
                  <td className="sl-td-sticky sl-td-input">
                    <input className="sl-input-cell" placeholder="Input name / इनपुट नाम"
                      value={row.input_name} onChange={e => setInputRow(ri, 'input_name', e.target.value)} />
                  </td>
                  {sharedBatches.map((_, bi) => (
                    <React.Fragment key={bi}>
                      {/* Origin per batch */}
                      <td className="sl-td-origin-cell">
                        <input className="sl-input-cell" placeholder="RM / Origin"
                          value={row.origins[bi] ?? ''}
                          onChange={e => setInputOrigin(ri, bi, e.target.value)} />
                      </td>
                      {/* Qty per batch */}
                      <td className="sl-td-batch">
                        <input type="number" className="sl-input-num" placeholder="—"
                          value={row.batches[bi] ?? ''}
                          onChange={e => setInputBatch(ri, bi, e.target.value)} />
                      </td>
                    </React.Fragment>
                  ))}
                  <td className="sl-td-ts">
                    {row.timestamp ? <span className="sl-ts-badge">{row.timestamp}</span> : <span className="sl-ts-empty">—</span>}
                  </td>
                  <td className="sl-td-save">
                    <button type="button" className="sl-row-save-btn" onClick={() => saveInputRow(ri)}>
                      {row.saved ? '✓' : '💾'}
                    </button>
                  </td>
                  <td className="sl-td-action">
                    {form.input_rows.length > 1 && (
                      <button type="button" className="sl-remove-btn" onClick={() => removeInputRow(ri)}>✕</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Total WT ── */}
        <div className="sl-total-bar">
          <span className="sl-total-bar-label">TOTAL WT. / <span className="sl-hi">कुल वजन</span></span>
          <div className="sl-total-bar-cols">
            {colTotals.map((total, bi) => (
              <span key={bi} className="sl-total-bar-item">
                <span className="sl-total-bar-batch">
                  {sharedBatches[bi]?.batch_no
                    ? `Batch-${bi + 1} / बैच-${bi + 1} (${sharedBatches[bi].batch_no})`
                    : `Batch-${bi + 1} / बैच-${bi + 1}`}
                </span>
                <span className="sl-total-bar-sep"> — </span>
                <span className="sl-total-bar-val">{total > 0 ? total : '—'}</span>
              </span>
            ))}
          </div>
        </div>

        {/* ── Controls ── */}
        <div className="sl-add-row-bar">
          <button type="button" className="sl-add-btn" onClick={addInputRow}>
            + Add Input Row / <span className="sl-hi">इनपुट पंक्ति जोड़ें</span>
          </button>
          <button type="button" className="sl-add-btn sl-add-batch-btn" onClick={addBatch}>
            + Add Batch {sharedBatches.length + 1}
          </button>
        </div>

        {/* ══ SAND MILLING ══ */}
        <div className="sl-section-title">Sand Milling Details / <span className="sl-hi">सैंड मिलिंग विवरण</span></div>
        <div className="sl-mill-scroll">
          <table className="sl-mill-table">
            <thead>
              <tr>
                <th>Mill No.<br /><span className="sl-hi">मिल नं.</span></th>
                <th>Flow Rate (L/Sec)<br /><span className="sl-hi">प्रवाह दर</span>
                  <div style={{fontWeight:'400',fontSize:'10px',color:'#999'}}>Multiple readings / एकाधिक रीडिंग</div>
                </th>
                <th>Current Amp<br /><span className="sl-hi">करंट एम्प</span></th>
                <th>Zirconox/Zircosil Beads (kg)<br /><span className="sl-hi">बीड्स (किग्रा)</span></th>
                <th>Remarks<br /><span className="sl-hi">टिप्पणी</span></th>
              </tr>
            </thead>
            <tbody>
              {form.mills.map((mill, mi) => (
                <tr key={mill.mill} className={mi % 2 === 0 ? '' : 'sl-tr-alt'}>
                  <td className="sl-mill-name">Mill No. {mill.mill}</td>

                  {/* Flow Rate — multiple readings with timestamp */}
                  <td className="sl-mill-flow-cell">
                    {mill.flow_rates.map((fr, fi) => (
                      <div key={fi} className="sl-flow-entry">
                        <input
                          type="number"
                          className="sl-input-num-wide"
                          placeholder="—"
                          value={fr.value}
                          onChange={e => setFlowRate(mi, fi, e.target.value)}
                        />
                        <button
                          type="button"
                          className="sl-flow-stamp-btn"
                          onClick={() => stampFlowRate(mi, fi)}
                          title="Stamp time / समय"
                        >
                          {fr.timestamp
                            ? <span className="sl-flow-ts">{fr.timestamp}</span>
                            : '🕐'}
                        </button>
                        {mill.flow_rates.length > 1 && (
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
                    >+ Add Reading</button>
                  </td>

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
            <label className="sl-label">Operator / <span className="sl-label-hi">ऑपरेटर</span></label>
            <input className="sl-input" placeholder="Name" value={form.operator} onChange={e => set('operator', e.target.value)} />
          </div>
          <div className="sl-approval-field">
            <label className="sl-label">Supervisor / <span className="sl-label-hi">सुपरवाइज़र</span></label>
            <input className="sl-input" placeholder="Name" value={form.supervisor} onChange={e => set('supervisor', e.target.value)} />
          </div>
          <div className="sl-approval-field">
            <label className="sl-label">Manager / <span className="sl-label-hi">मैनेजर</span></label>
            <input className="sl-input" placeholder="Name" value={form.manager} onChange={e => set('manager', e.target.value)} />
          </div>
        </div>

        {/* ══ ACTIONS ══ */}
        <div className="sl-actions">
          {error && <div className="sl-error">Error: {error}</div>}
          {saved  && <div className="sl-success">✓ Saved successfully / सफलतापूर्वक सहेजा गया</div>}
          <button type="submit" className="sl-save-btn" disabled={saving}>
            {saving ? 'Saving…' : 'Save Job Card / जॉब कार्ड सहेजें'}
          </button>
          <button type="button" className="sl-reset-btn"
            onClick={() => { setForm(emptyForm()); setSaved(false); setError('') }}>
            Reset / रीसेट
          </button>
        </div>

      </form>

      {/* ══ MOTOR AMP ACCORDION ══ */}
      <div className="sl-accordion">
        <button type="button" className="sl-accordion-header" onClick={() => setMotorOpen(o => !o)}>
          <span className="sl-accordion-title">Running Motor Amp Status / <span className="sl-hi">रनिंग मोटर एम्प स्थिति</span></span>
          <span className="sl-accordion-icon">{motorOpen ? '▲' : '▼'}</span>
        </button>

        {motorOpen && (
          <form className="sl-motor-form" onSubmit={handleMotorSubmit}>
            <div className="sl-motor-meta">
              <div className="sl-motor-meta-field">
                <label className="sl-label">Running Date / <span className="sl-label-hi">चलने की तारीख</span></label>
                <input type="date" className="sl-input" value={motorForm.running_date}
                  min={todayISO()} max={todayISO()} readOnly
                  style={{ background: '#f5f0ea', cursor: 'not-allowed' }} />
                <div style={{ fontSize: '10px', color: '#999', marginTop: '3px' }}>
                  Today only — {motorForm.running_date.split('-').reverse().join('/')}
                </div>
              </div>
              <div className="sl-motor-meta-field">
                <label className="sl-label">Checked By / <span className="sl-label-hi">जाँच की गई</span></label>
                <input className="sl-input" placeholder="Name"
                  value={motorForm.checked_by}
                  onChange={e => setMotorForm(p => ({ ...p, checked_by: e.target.value }))} />
              </div>
            </div>

            <div className="sl-motor-scroll">
              <table className="sl-motor-table">
                <thead>
                  <tr>
                    <th>Sr. No.<br /><span className="sl-hi">क्र.सं.</span></th>
                    <th>Motor Name<br /><span className="sl-hi">मोटर नाम</span></th>
                    <th>HP</th>
                    <th>Amp Reading<br /><span className="sl-hi">एम्प रीडिंग</span></th>
                    <th>Status<br /><span className="sl-hi">स्थिति</span></th>
                    <th>Timestamp<br /><span className="sl-hi">समय</span></th>
                    <th>Save<br /><span className="sl-hi">सहेजें</span></th>
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
                        <button type="button" className="sl-row-save-btn" onClick={() => saveMotorRow(mi)}>
                          {motorForm.motors[mi].saved ? '✓' : '💾'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="sl-motor-remark">
              <label className="sl-label">Remark / <span className="sl-label-hi">टिप्पणी</span></label>
              <input className="sl-input" placeholder="Remark..."
                value={motorForm.remark}
                onChange={e => setMotorForm(p => ({ ...p, remark: e.target.value }))} />
            </div>

            <div className="sl-actions">
              {motorError && <div className="sl-error">Error: {motorError}</div>}
              {motorSaved  && <div className="sl-success">✓ Saved successfully</div>}
              <button type="submit" className="sl-save-btn" disabled={motorSaving}>
                {motorSaving ? 'Saving…' : 'Save Motor Status / मोटर स्थिति सहेजें'}
              </button>
              <button type="button" className="sl-reset-btn"
                onClick={() => { setMotorForm(emptyMotorForm()); setMotorSaved(false); setMotorError('') }}>
                Reset / रीसेट
              </button>
            </div>
          </form>
        )}
      </div>

    </div>
  )
}
