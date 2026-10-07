// Slurry Operator Job Card
// Saves to: slurry_operator_job_cards
// Motor Amp Status saves to: slurry_operator_motor_amp

import React, { useState, useRef, useCallback } from 'react'
import { supabase, supabaseReady } from '../supabaseClient'
import './SlurryOperator.css'

// ── Constants ──────────────────────────────────────────────

const MILLS = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8', 'V9', 'V10']

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

// ── Helpers ────────────────────────────────────────────────

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function stamp12hr() {
  return new Date().toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: true,
    timeZone: 'Asia/Kolkata',
  })
}

function emptyMillRow(mill) {
  return { mill, flow_rates: [{ value: '', timestamp: '' }], current_amp: '', zirconia_beads: '', remarks: '' }
}

function emptyMotorEntry() {
  return { amp: '', stop: '', timestamp: '' }
}

function emptyForm() {
  return {
    date: '', shift1_operator: '', shift2_operator: '',
    mills: MILLS.map(m => emptyMillRow(m)),
    operator: '', supervisor: '', manager: '',
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

// ── Component ──────────────────────────────────────────────

export default function SlurryOperator() {

  // ── State ──
  const [form,   setForm]   = useState(emptyForm())
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)
  const [error,  setError]  = useState('')

  const [motorOpen,   setMotorOpen]   = useState(false)
  const [motorForm,   setMotorForm]   = useState(emptyMotorForm())
  const [motorSaving, setMotorSaving] = useState(false)
  const [motorSaved,  setMotorSaved]  = useState(false)
  const [motorError,  setMotorError]  = useState('')

  // Timestamp stores — separate from input values so saves never re-render inputs
  // millTimestamps[`${mi}_${fi}`] = time string
  const [millTimestamps,  setMillTimestamps]  = useState({})
  // motorTimestamps[mi] = time string (set when both amp + stop are filled)
  const [motorTimestamps, setMotorTimestamps] = useState({})

  // Toast / error popup
  const [toast,    setToast]    = useState(null)   // { msg, type }
  const [errPopup, setErrPopup] = useState(null)   // { msg }

  // Debounce timers & stale-save guards
  const millTimers = useRef({})
  const millSeq    = useRef({})
  const motorTimers = useRef({})
  const motorSeq    = useRef({})

  // ── Generic setters ──
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  // ── Mill helpers ──
  const setMill = (mi, field, val) =>
    setForm(p => ({ ...p, mills: p.mills.map((m, i) => i === mi ? { ...m, [field]: val } : m) }))

  function addFlowRate(mi) {
    setForm(p => ({
      ...p,
      mills: p.mills.map((m, i) =>
        i === mi ? { ...m, flow_rates: [...m.flow_rates, { value: '', timestamp: '' }] } : m
      ),
    }))
  }

  // Only update the value — timestamp lives in millTimestamps
  function setFlowRate(mi, fi, val) {
    setForm(p => ({
      ...p,
      mills: p.mills.map((m, i) =>
        i === mi
          ? { ...m, flow_rates: m.flow_rates.map((f, j) => j === fi ? { ...f, value: val } : f) }
          : m
      ),
    }))
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
    setMillTimestamps(p => { const n = { ...p }; delete n[`${mi}_${fi}`]; return n })
  }

  // ── Auto-stamp: mill flow rate ──
  // Called 1 s after user stops typing (if value is non-empty).
  // Stamps only the first time; later edits keep the original timestamp.
  const stampMillFlow = useCallback((mi, fi) => {
    const seqKey = `${mi}_${fi}`
    millSeq.current[seqKey] = (millSeq.current[seqKey] || 0) + 1
    const mySeq = millSeq.current[seqKey]

    setMillTimestamps(prev => {
      if (millSeq.current[seqKey] !== mySeq) return prev  // stale
      if (prev[seqKey]) return prev                        // already stamped
      showToast('success')
      return { ...prev, [seqKey]: stamp12hr() }
    })
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const scheduleMillStamp = useCallback((mi, fi, val) => {
    const key = `${mi}_${fi}`
    clearTimeout(millTimers.current[key])
    if (val === '' || val === null) return
    millTimers.current[key] = setTimeout(() => stampMillFlow(mi, fi), 1000)
  }, [stampMillFlow])

  // ── Auto-stamp: motor row ──
  // Stamps when BOTH amp and stop are filled; only once per row.
  const stampMotorRow = useCallback((mi, entry) => {
    if (!entry.amp || !entry.stop) return
    motorSeq.current[mi] = (motorSeq.current[mi] || 0) + 1
    const mySeq = motorSeq.current[mi]

    setMotorTimestamps(prev => {
      if (motorSeq.current[mi] !== mySeq) return prev  // stale
      if (prev[mi]) return prev                         // already stamped
      showToast('success')
      return { ...prev, [mi]: stamp12hr() }
    })
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  function handleMotorCell(mi, field, val) {
    const nextMotors = motorForm.motors.map((m, i) =>
      i === mi ? { ...m, [field]: val } : m
    )
    const next = { ...motorForm, motors: nextMotors }
    setMotorForm(next)
    clearTimeout(motorTimers.current[mi])
    motorTimers.current[mi] = setTimeout(() => stampMotorRow(mi, nextMotors[mi]), 1000)
  }

  // ── Toast / error popup ──
  function showToast(type) {
    const msg = type === 'success'
      ? '✓ Data saved successfully / डेटा सफलतापूर्वक सहेजा गया'
      : null
    if (msg) {
      setToast({ msg, type: 'success' })
      setTimeout(() => setToast(null), 2000)
    }
  }

  function showErrorPopup(errMsg) {
    console.error('[SlurryOperator save error]', errMsg)
    setErrPopup({ msg: errMsg })
  }

  // ── Main form submit ──
  async function handleSubmit(e) {
    e.preventDefault()
    if (!supabaseReady) { setError('Supabase not configured.'); return }
    setSaving(true); setError(''); setSaved(false)

    // Merge millTimestamps into mills before saving
    const millsWithTs = form.mills.map((m, mi) => ({
      ...m,
      flow_rates: m.flow_rates.map((f, fi) => ({
        ...f,
        timestamp: millTimestamps[`${mi}_${fi}`] || f.timestamp,
      })),
    }))

    const { error: err } = await supabase
      .from('slurry_operator_job_cards')
      .insert([{
        date:            form.date || null,
        shift1_operator: form.shift1_operator,
        shift2_operator: form.shift2_operator,
        mills:           millsWithTs,
        operator:        form.operator,
        supervisor:      form.supervisor,
        manager:         form.manager,
      }])

    setSaving(false)
    if (err) {
      setError(err.message)
      showErrorPopup(err.message)
    } else {
      setSaved(true)
      setForm(emptyForm())
      setMillTimestamps({})
    }
  }

  // ── Motor form submit ──
  async function handleMotorSubmit(e) {
    e.preventDefault()
    if (!supabaseReady) { setMotorError('Supabase not configured.'); return }
    setMotorSaving(true); setMotorError(''); setMotorSaved(false)

    const motorsWithTs = motorForm.motors.map((m, mi) => ({
      ...m,
      timestamp: motorTimestamps[mi] || m.timestamp,
    }))

    const { error: err } = await supabase
      .from('slurry_operator_motor_amp')
      .insert([{
        running_date: motorForm.running_date,
        checked_by:   motorForm.checked_by,
        remark:       motorForm.remark,
        motor_data:   motorsWithTs,
      }])

    setMotorSaving(false)
    if (err) {
      setMotorError(err.message)
      showErrorPopup(err.message)
    } else {
      setMotorSaved(true)
      setMotorForm(emptyMotorForm())
      setMotorTimestamps({})
    }
  }

  // ── Render ─────────────────────────────────────────────────

  return (
    <div className="so-wrapper">

      {/* Toast */}
      {toast && (
        <div className={`so-toast so-toast-${toast.type}`}>{toast.msg}</div>
      )}

      {/* Error popup */}
      {errPopup && (
        <div className="so-err-popup-overlay">
          <div className="so-err-popup">
            <div className="so-err-popup-title">
              Data not saved / डेटा सहेजा नहीं गया
            </div>
            <div className="so-err-popup-msg">{errPopup.msg}</div>
            <button type="button" className="so-err-popup-ok" onClick={() => setErrPopup(null)}>
              OK
            </button>
          </div>
        </div>
      )}

      {/* Title */}
      <div className="so-title-bar">
        <div className="so-title-main">
          Slurry Operator / <span className="so-title-hi">स्लरी ऑपरेटर</span>
        </div>
      </div>

      <form className="so-form" onSubmit={handleSubmit}>

        {/* Meta */}
        <div className="so-meta-bar">
          <div className="so-meta-field">
            <label className="so-label">Date / <span className="so-label-hi">तारीख</span></label>
            <input type="date" className="so-input" value={form.date} onChange={e => set('date', e.target.value)} />
          </div>
          <div className="so-meta-field">
            <label className="so-label">Shift 1 Operator / <span className="so-label-hi">पहली पाली ऑपरेटर</span></label>
            <input className="so-input" placeholder="Operator name" value={form.shift1_operator} onChange={e => set('shift1_operator', e.target.value)} />
          </div>
          <div className="so-meta-field">
            <label className="so-label">Shift 2 Operator / <span className="so-label-hi">दूसरी पाली ऑपरेटर</span></label>
            <input className="so-input" placeholder="Operator name" value={form.shift2_operator} onChange={e => set('shift2_operator', e.target.value)} />
          </div>
        </div>

        {/* Sand Milling */}
        <div className="so-section-title">
          Sand Milling Details / <span className="so-hi">सैंड मिलिंग विवरण</span>
        </div>

        <div className="so-mill-scroll">
          <table className="so-mill-table">
            <thead>
              <tr>
                <th>Mill No.<br /><span className="so-hi">मिल नं.</span></th>
                <th>
                  Flow Rate (L/Sec)<br /><span className="so-hi">प्रवाह दर</span>
                  <div style={{ fontWeight: 400, fontSize: 10, color: '#999' }}>Multiple readings</div>
                </th>
                <th>Current Amp<br /><span className="so-hi">करंट एम्प</span></th>
                <th>Zirconox/Zircosil Beads (kg)<br /><span className="so-hi">बीड्स (किग्रा)</span></th>
                <th>Remarks<br /><span className="so-hi">टिप्पणी</span></th>
              </tr>
            </thead>
            <tbody>
              {form.mills.map((mill, mi) => (
                <tr key={mill.mill} className={mi % 2 === 0 ? '' : 'so-tr-alt'}>
                  <td className="so-mill-name">Mill No. {mill.mill}</td>

                  <td className="so-mill-flow-cell">
                    {mill.flow_rates.map((flow, fi) => {
                      const tsKey = `${mi}_${fi}`
                      const ts    = millTimestamps[tsKey] || flow.timestamp
                      return (
                        <div key={fi} className="so-flow-entry">
                          <div className="so-flow-input-wrap">
                            <input
                              type="number"
                              className="so-input-num-wide"
                              placeholder="—"
                              value={flow.value}
                              onChange={e => {
                                const val = e.target.value
                                setFlowRate(mi, fi, val)
                                scheduleMillStamp(mi, fi, val)
                              }}
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  stampMillFlow(mi, fi)
                                  const all = Array.from(document.querySelectorAll('.so-mill-table input[type="number"]'))
                                  const idx = all.indexOf(e.target)
                                  if (idx !== -1 && idx + 1 < all.length) all[idx + 1].focus()
                                }
                              }}
                            />
                            {ts && <span className="so-flow-ts-auto">{ts}</span>}
                          </div>
                          {mill.flow_rates.length > 1 && (
                            <button type="button" className="so-flow-del-btn" onClick={() => removeFlowRate(mi, fi)}>✕</button>
                          )}
                        </div>
                      )
                    })}
                    <button type="button" className="so-flow-add-btn" onClick={() => addFlowRate(mi)}>
                      + reading
                    </button>
                  </td>

                  <td>
                    <input type="number" className="so-input-num-wide" placeholder="—"
                      value={mill.current_amp} onChange={e => setMill(mi, 'current_amp', e.target.value)} />
                  </td>
                  <td>
                    <input type="number" className="so-input-num-wide" placeholder="—"
                      value={mill.zirconia_beads} onChange={e => setMill(mi, 'zirconia_beads', e.target.value)} />
                  </td>
                  <td>
                    <input className="so-input-wide-text" placeholder="—"
                      value={mill.remarks} onChange={e => setMill(mi, 'remarks', e.target.value)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Approval */}
        <div className="so-approval-bar">
          <div className="so-approval-field">
            <label className="so-label">Supervisor / <span className="so-label-hi">सुपरवाइज़र</span></label>
            <input className="so-input" placeholder="Name" value={form.supervisor} onChange={e => set('supervisor', e.target.value)} />
          </div>
          <div className="so-approval-field">
            <label className="so-label">Manager / <span className="so-label-hi">मैनेजर</span></label>
            <input className="so-input" placeholder="Name" value={form.manager} onChange={e => set('manager', e.target.value)} />
          </div>
        </div>

        {/* Actions */}
        <div className="so-actions">
          {error && <div className="so-error">Error: {error}</div>}
          {saved  && <div className="so-success">✓ Saved successfully / सफलतापूर्वक सहेजा गया</div>}
          <button type="submit" className="so-save-btn" disabled={saving}>
            {saving ? 'Saving…' : 'Save Job Card / जॉब कार्ड सहेजें'}
          </button>
          <button type="button" className="so-reset-btn"
            onClick={() => { setForm(emptyForm()); setMillTimestamps({}); setSaved(false); setError('') }}>
            Reset / रीसेट
          </button>
        </div>

      </form>

      {/* Running Motor Amp Status */}
      <div className="so-accordion">
        <button type="button" className="so-accordion-header" onClick={() => setMotorOpen(o => !o)}>
          <span className="so-accordion-title">
            Running Motor Amp Status / <span className="so-hi">रनिंग मोटर एम्प स्थिति</span>
          </span>
          <span className="so-accordion-icon">{motorOpen ? '▲' : '▼'}</span>
        </button>

        {motorOpen && (
          <form className="so-motor-form" onSubmit={handleMotorSubmit}>

            <div className="so-motor-meta">
              <div className="so-motor-meta-field">
                <label className="so-label">Running Date / <span className="so-label-hi">चलने की तारीख</span></label>
                <input type="date" className="so-input" value={motorForm.running_date} readOnly
                  style={{ background: '#f5f0ea', cursor: 'not-allowed' }} />
              </div>
              <div className="so-motor-meta-field">
                <label className="so-label">Checked By / <span className="so-label-hi">जाँच की गई</span></label>
                <input className="so-input" placeholder="Name" value={motorForm.checked_by}
                  onChange={e => setMotorForm(p => ({ ...p, checked_by: e.target.value }))} />
              </div>
            </div>

            <div className="so-motor-scroll">
              <table className="so-motor-table">
                <thead>
                  <tr>
                    <th>Sr.<br /><span className="so-hi">क्र.</span></th>
                    <th>Motor Name<br /><span className="so-hi">मोटर नाम</span></th>
                    <th>HP</th>
                    <th>Amp Reading<br /><span className="so-hi">एम्प रीडिंग</span></th>
                    <th>Status<br /><span className="so-hi">स्थिति</span></th>
                    <th>Timestamp<br /><span className="so-hi">समय</span></th>
                  </tr>
                </thead>
                <tbody>
                  {SLURRY_MOTORS.map((motor, mi) => {
                    const entry = motorForm.motors[mi]
                    const ts    = motorTimestamps[mi] || entry.timestamp
                    return (
                      <tr key={motor.id} className={mi % 2 === 0 ? '' : 'so-motor-alt'}>
                        <td className="so-motor-sr">{motor.id}</td>
                        <td className="so-motor-name">{motor.name}</td>
                        <td className="so-motor-hp">{motor.hp}</td>
                        <td>
                          <input
                            type="number"
                            className="so-motor-input"
                            placeholder="—"
                            value={entry.amp}
                            onChange={e => handleMotorCell(mi, 'amp', e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                const all = Array.from(document.querySelectorAll('.so-motor-table input[type="number"]'))
                                const idx = all.indexOf(e.target)
                                if (idx !== -1 && idx + 1 < all.length) all[idx + 1].focus()
                              }
                            }}
                          />
                        </td>
                        <td>
                          <select className="so-motor-select" value={entry.stop}
                            onChange={e => handleMotorCell(mi, 'stop', e.target.value)}>
                            <option value="">—</option>
                            <option value="OK">OK</option>
                            <option value="STOP">STOP</option>
                          </select>
                        </td>
                        <td className="so-motor-ts">
                          {ts
                            ? <span className="so-ts-badge">{ts}</span>
                            : <span className="so-ts-empty">—</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="so-motor-remark">
              <label className="so-label">Remark / <span className="so-label-hi">टिप्पणी</span></label>
              <input className="so-input" placeholder="Remark..." value={motorForm.remark}
                onChange={e => setMotorForm(p => ({ ...p, remark: e.target.value }))} />
            </div>

            <div className="so-actions">
              {motorError && <div className="so-error">Error: {motorError}</div>}
              {motorSaved  && <div className="so-success">✓ Saved successfully</div>}
              <button type="submit" className="so-save-btn" disabled={motorSaving}>
                {motorSaving ? 'Saving…' : 'Save Motor Status / मोटर स्थिति सहेजें'}
              </button>
              <button type="button" className="so-reset-btn"
                onClick={() => { setMotorForm(emptyMotorForm()); setMotorTimestamps({}); setMotorSaved(false); setMotorError('') }}>
                Reset / रीसेट
              </button>
            </div>

          </form>
        )}
      </div>

    </div>
  )
}
