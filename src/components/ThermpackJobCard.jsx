import React, { useState, useMemo } from 'react'
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

const MOTORS = [
  { id: 1, name: 'ID Blower',              hp: 15  },
  { id: 2, name: 'FD Blower',              hp: 10  },
  { id: 3, name: 'Circulation Pump (Old)', hp: 15  },
  { id: 4, name: 'Compressor',             hp: 20  },
  { id: 5, name: 'Jockey Pump',            hp: 10  },
  { id: 6, name: 'Circulation Pump (New)', hp: 7.5 },
]

function emptyRow() {
  return { ...Object.fromEntries(LOG_FIELDS.map(f => [f, ''])), timestamp: '', saved: false }
}

function emptyMotorEntry() {
  return { val: '', stop: '' }
}

function emptyForm() {
  return {
    day: '', date: '',
    operator1: '', helper1: '', time_in1: '', time_out1: '',
    operator2: '', helper2: '', time_in2: '', time_out2: '',
    coal_date: '', coal_qty: '', bugass_date: '', bugass_qty: '',
    rows: TIME_SLOTS.map(() => emptyRow()),
    remarks: '',
  }
}

function emptyMotorForm() {
  return {
    running_date: new Date().toISOString().slice(0, 10), // today's date
    checked_by: '',
    remark: '',
    // each motor has one entry for the selected date
    motors: MOTORS.map(() => emptyMotorEntry()),
  }
}

export default function ThermpackJobCard() {
  const [form, setForm]             = useState(emptyForm())
  const [motorForm, setMotorForm]   = useState(emptyMotorForm())
  const [motorOpen, setMotorOpen]   = useState(false)
  const [saving, setSaving]         = useState(false)
  const [savedMain, setSavedMain]   = useState(false)
  const [savedMotor, setSavedMotor] = useState(false)
  const [error, setError]           = useState('')

  const set = (name, value) => setForm(prev => ({ ...prev, [name]: value }))

  const setRow = (i, field, value) =>
    setForm(prev => ({
      ...prev,
      rows: prev.rows.map((r, idx) => idx === i ? { ...r, [field]: value } : r),
    }))

  // ── Auto-calculated totals ──
  const totalCoal = useMemo(() =>
    form.rows.reduce((sum, r) => sum + (parseFloat(r.fuel_coal) || 0), 0),
    [form.rows]
  )
  const totalBugass = useMemo(() =>
    form.rows.reduce((sum, r) => sum + (parseFloat(r.fuel_bugass) || 0), 0),
    [form.rows]
  )

  // stamp current time on a row
  function saveRow(i) {
    const now = new Date()
    const ts = now.toLocaleTimeString('en-IN', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    })
    setForm(prev => ({
      ...prev,
      rows: prev.rows.map((r, idx) =>
        idx === i ? { ...r, timestamp: ts, saved: true } : r
      ),
    }))
  }

  const setMotorCell = (mi, key, value) =>
    setMotorForm(prev => ({
      ...prev,
      motors: prev.motors.map((m, idx) => idx === mi ? { ...m, [key]: value } : m),
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
      bugass_date: form.bugass_date || null,
      coal_qty:   form.coal_qty   ? parseFloat(form.coal_qty)   : null,
      bugass_qty: form.bugass_qty ? parseFloat(form.bugass_qty) : null,
      total_coal:   totalCoal,
      total_bugass: totalBugass,
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
      running_date: motorForm.running_date || null,
      checked_by:  motorForm.checked_by,
      remark:      motorForm.remark,
      motor_data:  motorForm.motors,
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
          <div className="stock-header">
            <span>Stock Received / <span className="hi">प्राप्त स्टॉक</span></span>
          </div>
          <div className="stock-grid">
            <div className="stock-row">
              <div className="stock-label">Coal / <span className="hi">कोयला</span></div>
              <div className="stock-field">
                <div className="cell-mini-label">Date / <span className="hi">तारीख</span></div>
                <input type="date" className="tjc-input"
                  value={form.coal_date} onChange={e => set('coal_date', e.target.value)} />
              </div>
              <div className="stock-field">
                <div className="cell-mini-label">Qty. MT / <span className="hi">मात्रा (मे.टन)</span></div>
                <input type="number" className="tjc-input" placeholder="0"
                  value={form.coal_qty} onChange={e => set('coal_qty', e.target.value)} />
              </div>
              <div className="stock-field stock-field-empty"></div>
            </div>
            <div className="stock-row">
              <div className="stock-label">Bugass / <span className="hi">बगास</span></div>
              <div className="stock-field">
                <div className="cell-mini-label">Date / <span className="hi">तारीख</span></div>
                <input type="date" className="tjc-input"
                  value={form.bugass_date} onChange={e => set('bugass_date', e.target.value)} />
              </div>
              <div className="stock-field stock-field-empty"></div>
              <div className="stock-field">
                <div className="cell-mini-label">Qty. MT / <span className="hi">मात्रा (मे.टन)</span></div>
                <input type="number" className="tjc-input" placeholder="0"
                  value={form.bugass_qty} onChange={e => set('bugass_qty', e.target.value)} />
              </div>
            </div>
          </div>
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
                      <button type="button" className="row-save-btn"
                        onClick={() => saveRow(i)} title="Stamp time">
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
                  {/* ── Auto-calculated totals ── */}
                  <td className="total-value-cell">
                    <div className="total-value-label">Coal / <span className="hi">कोयला</span></div>
                    <div className="total-value">{totalCoal % 1 === 0 ? totalCoal : totalCoal.toFixed(2)}</div>
                  </td>
                  <td className="total-value-cell">
                    <div className="total-value-label">Bugass / <span className="hi">बगास</span></div>
                    <div className="total-value">{totalBugass % 1 === 0 ? totalBugass : totalBugass.toFixed(2)}</div>
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
        <button type="button" className="sc-accordion-header"
          onClick={() => setMotorOpen(o => !o)} aria-expanded={motorOpen}>
          <span className="sc-accordion-title">
            Running Motor Amp Status
            <span className="sc-accordion-title-hi"> / रनिंग मोटर एम्प स्थिति</span>
          </span>
          <span className="sc-accordion-icon">{motorOpen ? '▲' : '▼'}</span>
        </button>

        {motorOpen && (
          <form className="sc-form" onSubmit={handleMotorSubmit}>

            {/* ── Single running date + meta ── */}
            <div className="sc-meta-row">
              <div className="sc-meta-field">
                <Label en="Running Date" hi="चलने की तारीख" />
                <input type="date" className="tjc-input"
                  value={motorForm.running_date}
                  onChange={e => setMotorForm(p => ({ ...p, running_date: e.target.value }))} />
              </div>
              <div className="sc-meta-field sc-meta-wide">
                <Label en="Checked By" hi="जाँच की गई" />
                <input className="tjc-input" placeholder="Name / नाम"
                  value={motorForm.checked_by}
                  onChange={e => setMotorForm(p => ({ ...p, checked_by: e.target.value }))} />
              </div>
            </div>

            {/* ── Motor amp table — one column per motor ── */}
            <div className="sc-table-scroll">
              <table className="sc-single-table">
                <thead>
                  <tr>
                    <th>Sr. No.</th>
                    <th>Motor Name / <span className="hi">मोटर नाम</span></th>
                    <th>HP</th>
                    <th>Amp Reading / <span className="hi">एम्प रीडिंग</span></th>
                    <th>Status / <span className="hi">स्थिति</span></th>
                  </tr>
                </thead>
                <tbody>
                  {MOTORS.map((motor, mi) => (
                    <tr key={motor.id}>
                      <td className="sc-sr">{motor.id}</td>
                      <td className="sc-motor-name">{motor.name}</td>
                      <td className="sc-hp">{motor.hp}</td>
                      <td className="sc-cell">
                        <input type="number" className="sc-input-wide" placeholder="—"
                          value={motorForm.motors[mi].val}
                          onChange={e => setMotorCell(mi, 'val', e.target.value)} />
                      </td>
                      <td className="sc-cell sc-stop-cell">
                        <select className="sc-stop-select-wide"
                          value={motorForm.motors[mi].stop}
                          onChange={e => setMotorCell(mi, 'stop', e.target.value)}>
                          <option value="">—</option>
                          <option value="STOP">STOP</option>
                          <option value="OK">OK</option>
                        </select>
                      </td>
                    </tr>
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
