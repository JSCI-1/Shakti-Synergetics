import React, { useState } from 'react'
import { supabase, supabaseReady } from '../supabaseClient'
import './ThermpackJobCard.css'

// Bilingual label — English + Hindi
function Label({ en, hi, required }) {
  return (
    <label className="bi-label">
      <span className="bi-en">{en}{required && <span className="req"> *</span>}</span>
      <span className="bi-hi">{hi}{required && <span className="req"> *</span>}</span>
    </label>
  )
}

const TIME_SLOTS = [
  '7:30','8:30','9:30','10:30','11:30','12:30','13:30','14:30',
  '15:30','16:30','17:30','18:30','19:30','20:30','21:30','22:30',
  '23:30','0:30','1:30','2:30','3:30','4:30','5:30','6:30',
]

const LOG_FIELDS = [
  'temp_in','temp_out',
  'oil_press_in','oil_press_out','oil_press_level',
  'fuel_coal','fuel_bugass',
  'temp_exhaust','diesel_stock',
]

// Motors for the Running Motor Amp Status table
const MOTORS = [
  { id: 1, name: 'ID Blower',              hp: 15  },
  { id: 2, name: 'FD Blower',              hp: 10  },
  { id: 3, name: 'Circulation Pump (Old)', hp: 15  },
  { id: 4, name: 'Compressor',             hp: 20  },
  { id: 5, name: 'Jockey Pump',            hp: 10  },
  { id: 6, name: 'Circulation Pump (New)', hp: 7.5 },
]

const DAYS_IN_MONTH = Array.from({ length: 31 }, (_, i) => i + 1)

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

function emptyRow() {
  return { ...Object.fromEntries(LOG_FIELDS.map(f => [f, ''])), timestamp: '', saved: false }
}

function emptyMotorRow() {
  // each motor has 31 day cells, each with two readings (amp + stop/ok)
  return DAYS_IN_MONTH.map(() => ({ val: '', stop: false }))
}

function emptyForm() {
  return {
    day: '', date: '',
    operator1: '', helper1: '', time_in1: '', time_out1: '',
    operator2: '', helper2: '', time_in2: '', time_out2: '',
    coal_date: '', coal_qty: '', bugass_qty: '',
    rows: TIME_SLOTS.map(() => emptyRow()),
    total_coal: '', total_bugass: '',
    remarks: '',
  }
}

function emptyMotorForm() {
  const now = new Date()
  return {
    month: MONTHS[now.getMonth()],
    year: String(now.getFullYear()),
    checked_by: '',
    remark: '',
    motors: MOTORS.map(() => emptyMotorRow()),
  }
}

export default function ThermpackJobCard() {
  const [form, setForm]           = useState(emptyForm())
  const [motorForm, setMotorForm] = useState(emptyMotorForm())
  const [motorOpen, setMotorOpen] = useState(false)
  const [saving, setSaving]       = useState(false)
  const [savedMain, setSavedMain] = useState(false)
  const [savedMotor, setSavedMotor] = useState(false)
  const [error, setError]         = useState('')

  const set = (name, value) => setForm(prev => ({ ...prev, [name]: value }))

  const setRow = (i, field, value) =>
    setForm(prev => ({
      ...prev,
      rows: prev.rows.map((r, idx) => idx === i ? { ...r, [field]: value } : r),
    }))

  // stamp current time on a row and mark it saved
  function saveRow(i) {
    const now = new Date()
    const ts = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    setForm(prev => ({
      ...prev,
      rows: prev.rows.map((r, idx) =>
        idx === i ? { ...r, timestamp: ts, saved: true } : r
      ),
    }))
  }

  const setMotorCell = (motorIdx, dayIdx, key, value) =>
    setMotorForm(prev => ({
      ...prev,
      motors: prev.motors.map((m, mi) =>
        mi === motorIdx
          ? m.map((cell, di) => di === dayIdx ? { ...cell, [key]: value } : cell)
          : m
      ),
    }))

  // ── Save main job card ──
  async function handleSubmit(e) {
    e.preventDefault()
    if (!supabaseReady) { setError('Supabase not configured. Add credentials to .env'); return }
    setSaving(true); setError(''); setSavedMain(false)
    const payload = {
      day: form.day, date: form.date || null,
      operator1: form.operator1, helper1: form.helper1,
      time_in1: form.time_in1, time_out1: form.time_out1,
      operator2: form.operator2, helper2: form.helper2,
      time_in2: form.time_in2, time_out2: form.time_out2,
      coal_date: form.coal_date || null,
      coal_qty:    form.coal_qty    ? parseFloat(form.coal_qty)    : null,
      bugass_qty:  form.bugass_qty  ? parseFloat(form.bugass_qty)  : null,
      total_coal:  form.total_coal  ? parseFloat(form.total_coal)  : null,
      total_bugass:form.total_bugass? parseFloat(form.total_bugass): null,
      remarks: form.remarks,
      log_rows: form.rows,
    }
    const { error: e1 } = await supabase.from('thermopack_job_cards').insert([payload])
    setSaving(false)
    if (e1) setError(e1.message)
    else { setSavedMain(true); setForm(emptyForm()) }
  }

  // ── Save motor amp status ──
  async function handleMotorSubmit(e) {
    e.preventDefault()
    if (!supabaseReady) { setError('Supabase not configured.'); return }
    setSaving(true); setError(''); setSavedMotor(false)
    const { error: e2 } = await supabase.from('motor_amp_status').insert([{
      month:      motorForm.month,
      year:       parseInt(motorForm.year),
      checked_by: motorForm.checked_by,
      remark:     motorForm.remark,
      motor_data: motorForm.motors,
    }])
    setSaving(false)
    if (e2) setError(e2.message)
    else { setSavedMotor(true); setMotorForm(emptyMotorForm()) }
  }

  return (
    <div className="tjc-wrapper">

      {/* ── Title bar ── */}
      <div className="tjc-title-bar">
        <span className="tjc-title-en">Thermopack Job Card</span>
        <span className="tjc-title-divider">|</span>
        <span className="tjc-title-hi">थर्मोपैक जॉब कार्ड</span>
      </div>

      <form className="tjc-form" onSubmit={handleSubmit}>

        {/* Supabase warning */}
        {!supabaseReady && (
          <div className="tjc-config-warning">
            ⚠️ Supabase not connected — data won't save until you add credentials to <code>.env</code>
            &nbsp;|&nbsp;
            ⚠️ सुपाबेस कनेक्ट नहीं है — <code>.env</code> में credentials डालें
          </div>
        )}

        {/* ══ SECTION 1: Operator & Time ══ */}
        <div className="tjc-section">
          <table className="tjc-table">
            <thead>
              <tr>
                <th>Day / Date<br /><span className="hi">दिन / तारीख</span></th>
                <th>Name of Operator / Helper<br /><span className="hi">ऑपरेटर / हेल्पर का नाम</span></th>
                <th>Time In<br /><span className="hi">समय प्रवेश</span></th>
                <th>Time Out<br /><span className="hi">समय बाहर</span></th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td rowSpan={2} className="td-date-cell">
                  <div className="cell-stack">
                    <div className="cell-mini-label">Day / <span className="hi">दिन</span></div>
                    <input className="tjc-input" placeholder="Monday / सोमवार"
                      value={form.day} onChange={e => set('day', e.target.value)} />
                    <div className="cell-mini-label mt8">Date / <span className="hi">तारीख</span></div>
                    <input type="date" className="tjc-input"
                      value={form.date} onChange={e => set('date', e.target.value)} />
                  </div>
                </td>
                <td>
                  <div className="cell-mini-label">Operator / <span className="hi">ऑपरेटर</span></div>
                  <input className="tjc-input" placeholder="Operator name / ऑपरेटर का नाम"
                    value={form.operator1} onChange={e => set('operator1', e.target.value)} />
                  <div className="cell-mini-label mt6">Helper / <span className="hi">हेल्पर</span></div>
                  <input className="tjc-input" placeholder="Helper name / हेल्पर का नाम"
                    value={form.helper1} onChange={e => set('helper1', e.target.value)} />
                </td>
                <td>
                  <div className="cell-mini-label">In / <span className="hi">प्रवेश</span></div>
                  <input type="time" className="tjc-input"
                    value={form.time_in1} onChange={e => set('time_in1', e.target.value)} />
                </td>
                <td>
                  <div className="cell-mini-label">Out / <span className="hi">बाहर</span></div>
                  <input type="time" className="tjc-input"
                    value={form.time_out1} onChange={e => set('time_out1', e.target.value)} />
                </td>
              </tr>
              <tr>
                <td>
                  <div className="cell-mini-label">Operator / <span className="hi">ऑपरेटर</span></div>
                  <input className="tjc-input" placeholder="Operator name / ऑपरेटर का नाम"
                    value={form.operator2} onChange={e => set('operator2', e.target.value)} />
                  <div className="cell-mini-label mt6">Helper / <span className="hi">हेल्पर</span></div>
                  <input className="tjc-input" placeholder="Helper name / हेल्पर का नाम"
                    value={form.helper2} onChange={e => set('helper2', e.target.value)} />
                </td>
                <td>
                  <div className="cell-mini-label">In / <span className="hi">प्रवेश</span></div>
                  <input type="time" className="tjc-input"
                    value={form.time_in2} onChange={e => set('time_in2', e.target.value)} />
                </td>
                <td>
                  <div className="cell-mini-label">Out / <span className="hi">बाहर</span></div>
                  <input type="time" className="tjc-input"
                    value={form.time_out2} onChange={e => set('time_out2', e.target.value)} />
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* ══ SECTION 2: Stock Received ══ */}
        <div className="tjc-section">
          <table className="tjc-table stock-table">
            <thead>
              <tr>
                <th>Stock Received<br /><span className="hi">प्राप्त स्टॉक</span></th>
                <th>Date<br /><span className="hi">तारीख</span></th>
                <th>Qty. MT (Coal)<br /><span className="hi">मात्रा - कोयला</span></th>
                <th>Qty. MT (Bugass)<br /><span className="hi">मात्रा - बगास</span></th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="row-label">Coal / <span className="hi">कोयला</span></td>
                <td>
                  <input type="date" className="tjc-input"
                    value={form.coal_date} onChange={e => set('coal_date', e.target.value)} />
                </td>
                <td>
                  <input type="number" className="tjc-input" placeholder="0"
                    value={form.coal_qty} onChange={e => set('coal_qty', e.target.value)} />
                </td>
                <td className="td-empty"></td>
              </tr>
              <tr>
                <td className="row-label">Bugass / <span className="hi">बगास</span></td>
                <td className="td-empty"></td>
                <td className="td-empty"></td>
                <td>
                  <input type="number" className="tjc-input" placeholder="0"
                    value={form.bugass_qty} onChange={e => set('bugass_qty', e.target.value)} />
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* ══ SECTION 3: Hourly Log ══ */}
        <div className="tjc-section tjc-log-section">
          <div className="tjc-log-scroll">
            <table className="tjc-log-table">
              <thead>
                <tr>
                  <th rowSpan={2}>Time<br /><span className="hi">समय</span></th>
                  <th colSpan={2}>Temp<br /><span className="hi">तापमान</span></th>
                  <th colSpan={3}>Oil Press<br /><span className="hi">तेल दबाव</span></th>
                  <th colSpan={2}>Fuel Charged<br /><span className="hi">इंधन भरा</span></th>
                  <th rowSpan={2}>Temp Exhaust<br /><span className="hi">एग्जॉस्ट</span></th>
                  <th rowSpan={2}>Diesel Stock<br /><span className="hi">डीजल स्टॉक</span></th>
                  <th rowSpan={2}>Timestamp<br /><span className="hi">समय टिकट</span></th>
                  <th rowSpan={2}>Save<br /><span className="hi">सहेजें</span></th>
                </tr>
                <tr>
                  <th>In<br /><span className="hi">अंदर</span></th>
                  <th>Out<br /><span className="hi">बाहर</span></th>
                  <th>In<br /><span className="hi">अंदर</span></th>
                  <th>Out<br /><span className="hi">बाहर</span></th>
                  <th>Level<br /><span className="hi">स्तर</span></th>
                  <th>Coal<br /><span className="hi">कोयला</span></th>
                  <th>Bugass<br /><span className="hi">बगास</span></th>
                </tr>
              </thead>
              <tbody>
                {TIME_SLOTS.map((slot, i) => (
                  <tr key={slot} className={form.rows[i].saved ? 'row-saved' : ''}>
                    <td className="time-cell">{slot}</td>
                    {LOG_FIELDS.map(field => (
                      <td key={field}>
                        <input type="number" className="tjc-log-input" placeholder="—"
                          value={form.rows[i][field]}
                          onChange={e => setRow(i, field, e.target.value)} />
                      </td>
                    ))}
                    <td className="ts-cell">
                      {form.rows[i].timestamp
                        ? <span className="ts-badge">{form.rows[i].timestamp}</span>
                        : <span className="ts-empty">—</span>}
                    </td>
                    <td className="ts-save-cell">
                      <button
                        type="button"
                        className="row-save-btn"
                        onClick={() => saveRow(i)}
                        title="Stamp time and save row"
                      >
                        {form.rows[i].saved ? '✓' : '💾'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={6} className="total-label">
                    Total Fuel Consumption / <span className="hi">कुल इंधन खपत</span>
                  </td>
                  <td>
                    <input type="number" className="tjc-log-input total-input"
                      placeholder="Coal" value={form.total_coal}
                      onChange={e => set('total_coal', e.target.value)} />
                  </td>
                  <td>
                    <input type="number" className="tjc-log-input total-input"
                      placeholder="Bugass" value={form.total_bugass}
                      onChange={e => set('total_bugass', e.target.value)} />
                  </td>
                  <td colSpan={4}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* ══ SECTION 4: Remarks ══ */}
        <div className="tjc-section tjc-remarks-section">
          <Label en="Remarks" hi="टिप्पणी" />
          <textarea className="tjc-textarea" rows={3}
            placeholder="Remarks / टिप्पणी..."
            value={form.remarks} onChange={e => set('remarks', e.target.value)} />
        </div>

        {/* ══ Actions ══ */}
        <div className="tjc-actions">
          {error && <div className="tjc-error">Error: {error}</div>}
          {savedMain && <div className="tjc-success">✓ Saved / सहेजा गया</div>}
          <button type="submit" className="tjc-save-btn" disabled={saving}>
            {saving ? 'Saving… / सहेज रहे हैं…' : 'Save Job Card / जॉब कार्ड सहेजें'}
          </button>
          <button type="button" className="tjc-reset-btn"
            onClick={() => { setForm(emptyForm()); setSavedMain(false); setError('') }}>
            Reset / रीसेट
          </button>
        </div>
      </form>

      {/* ══ COLLAPSIBLE: Running Motor Amp Status ══ */}
      <div className="sc-accordion">
        <button
          type="button"
          className="sc-accordion-header"
          onClick={() => setMotorOpen(o => !o)}
          aria-expanded={motorOpen}
        >
          <span className="sc-accordion-title">
            Running Motor Amp Status
            <span className="sc-accordion-title-hi"> / रनिंग मोटर एम्प स्थिति</span>
          </span>
          <span className="sc-accordion-icon">{motorOpen ? '▲' : '▼'}</span>
        </button>

        {motorOpen && (
          <form className="sc-form" onSubmit={handleMotorSubmit}>
            {/* Meta row */}
            <div className="sc-meta-row">
              <div className="sc-meta-field">
                <Label en="Month" hi="महीना" />
                <select className="tjc-input" value={motorForm.month}
                  onChange={e => setMotorForm(p => ({ ...p, month: e.target.value }))}>
                  {MONTHS.map(m => <option key={m}>{m}</option>)}
                </select>
              </div>
              <div className="sc-meta-field">
                <Label en="Year" hi="वर्ष" />
                <input type="number" className="tjc-input" placeholder="2026"
                  value={motorForm.year}
                  onChange={e => setMotorForm(p => ({ ...p, year: e.target.value }))} />
              </div>
              <div className="sc-meta-field sc-meta-wide">
                <Label en="Checked By" hi="जाँच की गई" />
                <input className="tjc-input" placeholder="Name / नाम"
                  value={motorForm.checked_by}
                  onChange={e => setMotorForm(p => ({ ...p, checked_by: e.target.value }))} />
              </div>
            </div>

            {/* Motor amp table */}
            <div className="sc-table-scroll">
              <table className="sc-table">
                <thead>
                  <tr>
                    <th rowSpan={2}>Sr.<br />No.</th>
                    <th rowSpan={2}>Daily Motor Amp<br /><span className="hi">दैनिक मोटर एम्प</span></th>
                    <th rowSpan={2}>HP</th>
                    <th colSpan={31}>Date / <span className="hi">तारीख</span></th>
                  </tr>
                  <tr>
                    {DAYS_IN_MONTH.map(d => <th key={d}>{d}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {MOTORS.map((motor, mi) => (
                    <React.Fragment key={motor.id}>
                      {/* Amp reading row */}
                      <tr>
                        <td rowSpan={2} className="sc-sr">{motor.id}</td>
                        <td rowSpan={2} className="sc-motor-name">{motor.name}</td>
                        <td rowSpan={2} className="sc-hp">{motor.hp}</td>
                        {DAYS_IN_MONTH.map((_, di) => (
                          <td key={di} className="sc-cell">
                            <input
                              type="number"
                              className="sc-input"
                              placeholder="—"
                              value={motorForm.motors[mi][di].val}
                              onChange={e => setMotorCell(mi, di, 'val', e.target.value)}
                            />
                          </td>
                        ))}
                      </tr>
                      {/* Stop/OK row */}
                      <tr>
                        {DAYS_IN_MONTH.map((_, di) => (
                          <td key={di} className="sc-cell sc-stop-cell">
                            <select
                              className="sc-stop-select"
                              value={motorForm.motors[mi][di].stop}
                              onChange={e => setMotorCell(mi, di, 'stop', e.target.value)}
                            >
                              <option value="">—</option>
                              <option value="STOP">STOP</option>
                              <option value="OK">OK</option>
                            </select>
                          </td>
                        ))}
                      </tr>
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Remark + save */}
            <div className="sc-bottom">
              <div className="sc-remark-field">
                <Label en="Remark" hi="टिप्पणी" />
                <input className="tjc-input" placeholder="Remark / टिप्पणी"
                  value={motorForm.remark}
                  onChange={e => setMotorForm(p => ({ ...p, remark: e.target.value }))} />
              </div>
              <div className="tjc-actions sc-actions">
                {savedMotor && <div className="tjc-success">✓ Saved / सहेजा गया</div>}
                <button type="submit" className="tjc-save-btn" disabled={saving}>
                  {saving ? 'Saving…' : 'Save Motor Status / मोटर स्थिति सहेजें'}
                </button>
                <button type="button" className="tjc-reset-btn"
                  onClick={() => { setMotorForm(emptyMotorForm()); setSavedMotor(false) }}>
                  Reset / रीसेट
                </button>
              </div>
            </div>
          </form>
        )}
      </div>

    </div>
  )
}
