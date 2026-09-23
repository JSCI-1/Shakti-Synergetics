import React, { useState } from 'react'
import { supabase, supabaseReady } from '../supabaseClient'
import './DryerSection.css'

const TIME_SLOTS = [
  '08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00',
  '16:00','17:00','18:00','19:00','20:00','21:00','22:00','23:00',
  '00:00','01:00','02:00','03:00','04:00','05:00','06:00','07:00',
]

function emptyRow() {
  return {
    temp_inlet: '', temp_outlet: '', temp_actual: '',
    temp_fbd1: '', temp_fbd2: '', temp_chamber: '',
    atomizer_freq: '',
    feed_fc: '', pressure: '', pt_temp: '',
    batch_no: '',
    bags_per_hr: '',
    bag_size_wt: '',
    kg_per_hr: '',
    colour: '',
    id_frequency: '',
    remarks: '',
  }
}

function emptyForm(dryerType) {
  return {
    dryer_type: dryerType,
    date: '',
    shift: '',
    id_blower_dp: '', id_blower_mr: '',
    fd_blower_dp: '', fd_blower_mr: '',
    chamber_dp:   '', chamber_mr:   '',
    fbd_pct_dp:   '', fbd_pct_mr:   '',
    batch_no: '',
    calibration_due: '',
    total_production: '',
    incharge: '',
    operator: '',
    rows: TIME_SLOTS.map(() => emptyRow()),
  }
}

const BLOWERS = [
  { label: 'ID Blower', dp: 'id_blower_dp', mr: 'id_blower_mr' },
  { label: 'FD Blower', dp: 'fd_blower_dp', mr: 'fd_blower_mr' },
  { label: 'Chamber',   dp: 'chamber_dp',   mr: 'chamber_mr'   },
  { label: 'FBD %',     dp: 'fbd_pct_dp',   mr: 'fbd_pct_mr'   },
]

function DryerForm({ dryerType, label }) {
  const [form, setForm]     = useState(emptyForm(dryerType))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)
  const [error, setError]   = useState('')

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const setRow = (i, field, val) =>
    setForm(p => ({
      ...p,
      rows: p.rows.map((r, idx) => idx === i ? { ...r, [field]: val } : r),
    }))

  async function handleSubmit(e) {
    e.preventDefault()
    if (!supabaseReady) { setError('Supabase not configured.'); return }
    setSaving(true); setError(''); setSaved(false)
    const { error: err } = await supabase.from('dryer_logs').insert([{
      dryer_type:       form.dryer_type,
      date:             form.date || null,
      shift:            form.shift,
      id_blower_dp:     form.id_blower_dp,
      id_blower_mr:     form.id_blower_mr,
      fd_blower_dp:     form.fd_blower_dp,
      fd_blower_mr:     form.fd_blower_mr,
      chamber_dp:       form.chamber_dp,
      chamber_mr:       form.chamber_mr,
      fbd_pct_dp:       form.fbd_pct_dp,
      fbd_pct_mr:       form.fbd_pct_mr,
      batch_no:         form.batch_no,
      calibration_due:  form.calibration_due || null,
      total_production: form.total_production ? parseFloat(form.total_production) : null,
      incharge:         form.incharge,
      operator:         form.operator,
      log_rows:         form.rows,
    }])
    setSaving(false)
    if (err) setError(err.message)
    else { setSaved(true); setForm(emptyForm(dryerType)) }
  }

  // Numeric input cell
  const NC = ({ field, ri }) => (
    <td>
      <input type="number" className="dr-cell-input" placeholder="—"
        value={form.rows[ri][field]}
        onChange={e => setRow(ri, field, e.target.value)} />
    </td>
  )
  // Text input cell
  const TC = ({ field, ri }) => (
    <td>
      <input type="text" className="dr-cell-input" placeholder="—"
        value={form.rows[ri][field]}
        onChange={e => setRow(ri, field, e.target.value)} />
    </td>
  )

  return (
    <div className="dr-form-wrapper">

      {/* ── Title ── */}
      <div className="dr-title-bar">
        <div className="dr-title-main">{label} — LOG SHEET</div>
      </div>

      <form onSubmit={handleSubmit}>

        {/* ── Meta: Date + Shift ── */}
        <div className="dr-meta-bar">
          <div className="dr-meta-field">
            <label className="dr-label">Date</label>
            <input type="date" className="dr-input"
              value={form.date} onChange={e => set('date', e.target.value)} />
          </div>
          <div className="dr-meta-field">
            <label className="dr-label">Shift</label>
            <select className="dr-input" value={form.shift} onChange={e => set('shift', e.target.value)}>
              <option value="">— Select —</option>
              <option value="A">Shift A</option>
              <option value="B">Shift B</option>
            </select>
          </div>
        </div>

        {/* ── Main Log Table ── */}
        <div className="dr-table-section">
          <div className="dr-table-scroll">
            <table className="dr-table">
              <thead>
                <tr className="dr-thead-r1">
                  <th className="dr-th-time" rowSpan={2}>Time</th>
                  <th colSpan={3}>Temperature Deg. Cent.</th>
                  <th colSpan={3}>Temperature Deg. Cent.</th>
                  <th rowSpan={2}>Atomizer<br />Freq.</th>
                  <th rowSpan={2}>Feed<br />F.</th>
                  <th rowSpan={2}>C.Pressure</th>
                  <th rowSpan={2}>Pr.<br />Temp</th>
                  <th rowSpan={2}>Batch<br />No.</th>
                  <th rowSpan={2}>No. of Bag<br />Per Hours</th>
                  <th rowSpan={2}>Bag Size<br />By Wt.</th>
                  <th rowSpan={2}>Kg./Hour<br />Production</th>
                  <th rowSpan={2}>Colour /<br />Normal</th>
                  <th rowSpan={2}>I.D.<br />Frequency</th>
                  <th rowSpan={2}>Remarks</th>
                </tr>
                <tr className="dr-thead-r2">
                  <th>Inlet</th>
                  <th>Outlet</th>
                  <th>Actual</th>
                  <th>IFBD</th>
                  <th>FBD</th>
                  <th>Chamber</th>
                </tr>
              </thead>
              <tbody>
                {TIME_SLOTS.map((slot, i) => (
                  <tr key={slot} className={i % 2 === 0 ? '' : 'dr-tr-alt'}>
                    <td className="dr-td-time">{slot}</td>
                    <NC field="temp_inlet"    ri={i} />
                    <NC field="temp_outlet"   ri={i} />
                    <NC field="temp_actual"   ri={i} />
                    <NC field="temp_fbd1"     ri={i} />
                    <NC field="temp_fbd2"     ri={i} />
                    <NC field="temp_chamber"  ri={i} />
                    <NC field="atomizer_freq" ri={i} />
                    <NC field="feed_fc"       ri={i} />
                    <NC field="pressure"      ri={i} />
                    <NC field="pt_temp"       ri={i} />
                    <TC field="batch_no"      ri={i} />
                    <NC field="bags_per_hr"   ri={i} />
                    <NC field="bag_size_wt"   ri={i} />
                    <NC field="kg_per_hr"     ri={i} />
                    <TC field="colour"        ri={i} />
                    <TC field="id_frequency"  ri={i} />
                    <TC field="remarks"       ri={i} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Blower fields — after table, before footer ── */}
        <div className="dr-blower-bar">
          {BLOWERS.map(b => (
            <div key={b.label} className="dr-blower-card">
              <div className="dr-blower-title">{b.label}</div>
              <div className="dr-blower-row">
                <span className="dr-blower-sub">DP</span>
                <input className="dr-input dr-input-sm" placeholder="—"
                  value={form[b.dp]} onChange={e => set(b.dp, e.target.value)} />
              </div>
              <div className="dr-blower-row">
                <span className="dr-blower-sub">MR</span>
                <input className="dr-input dr-input-sm" placeholder="—"
                  value={form[b.mr]} onChange={e => set(b.mr, e.target.value)} />
              </div>
            </div>
          ))}
        </div>

        {/* ── Footer fields ── */}
        <div className="dr-footer-bar">
          <div className="dr-footer-field">
            <label className="dr-label">Batch No.</label>
            <input className="dr-input" placeholder="Batch number"
              value={form.batch_no} onChange={e => set('batch_no', e.target.value)} />
          </div>
          <div className="dr-footer-field">
            <label className="dr-label">Calibration Due Date</label>
            <input type="date" className="dr-input"
              value={form.calibration_due} onChange={e => set('calibration_due', e.target.value)} />
          </div>
          <div className="dr-footer-field">
            <label className="dr-label">Total Production of the Day (kg)</label>
            <input type="number" className="dr-input" placeholder="0"
              value={form.total_production} onChange={e => set('total_production', e.target.value)} />
          </div>
          <div className="dr-footer-field">
            <label className="dr-label">Incharge</label>
            <input className="dr-input" placeholder="Name"
              value={form.incharge} onChange={e => set('incharge', e.target.value)} />
          </div>
          <div className="dr-footer-field">
            <label className="dr-label">Operator</label>
            <input className="dr-input" placeholder="Name"
              value={form.operator} onChange={e => set('operator', e.target.value)} />
          </div>
        </div>

        {/* ── Actions ── */}
        <div className="dr-actions">
          {error && <div className="dr-error">Error: {error}</div>}
          {saved  && <div className="dr-success">✓ Saved successfully</div>}
          <button type="submit" className="dr-save-btn" disabled={saving}>
            {saving ? 'Saving…' : 'Save Log Sheet'}
          </button>
          <button type="button" className="dr-reset-btn"
            onClick={() => { setForm(emptyForm(dryerType)); setSaved(false); setError('') }}>
            Reset
          </button>
        </div>

      </form>
    </div>
  )
}

export default function DryerSection() {
  const [activeTab, setActiveTab] = useState('new')

  return (
    <div className="dr-wrapper">
      <div className="dr-tab-bar">
        <button type="button"
          className={`dr-tab-btn ${activeTab === 'new' ? 'dr-tab-active' : ''}`}
          onClick={() => setActiveTab('new')}>
          New Dryer
        </button>
        <button type="button"
          className={`dr-tab-btn ${activeTab === 'old' ? 'dr-tab-active' : ''}`}
          onClick={() => setActiveTab('old')}>
          Old Dryer
        </button>
      </div>
      <div className="dr-content">
        {activeTab === 'new' && <DryerForm dryerType="new" label="New Dryer" />}
        {activeTab === 'old' && <DryerForm dryerType="old" label="Old Dryer" />}
      </div>
    </div>
  )
}
