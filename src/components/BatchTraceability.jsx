import React, { useState } from 'react'
import { supabase, supabaseReady } from '../supabaseClient'
import './BatchTraceability.css'

// Each batch row covers: HST (start/stop), LST1/2 (start/stop), 1st Storage (start/stop),
// 2nd Storage (start/stop), Finish Slurry (start/stop), Total Running Hours per tank

const TANKS = [
  { key: 'hs1', label: 'HS-1 (6000 Lt.)' },
  { key: 'hs2', label: 'HS-2 (4000 Lt.)' },
  { key: 'hs3', label: 'HS-3 (6000 Lt.)' },
  { key: 'nm',  label: 'NM (2000 Lt.)'   },
]

function emptyBatchRow(batchNo = '') {
  return {
    id: Date.now() + Math.random(),
    batch_no: batchNo,
    // High Speed Tank
    hst_tank: '',
    hst_start: '', hst_stop: '',
    // LST 1/2
    lst_start: '', lst_stop: '',
    // 1st Storage
    s1_start: '', s1_stop: '',
    // 2nd Storage
    s2_start: '', s2_stop: '',
    // Finish Slurry
    finish_start: '', finish_stop: '',
    // Finish tank name
    finish_tank: '',
  }
}

function emptyForm() {
  return {
    date: '',
    rows: Array.from({ length: 10 }, (_, i) => emptyBatchRow('')),
    // Total Running Hours per tank
    total_hs1: '', total_hs2: '', total_hs3: '', total_nm: '',
    checked_by: '',
    approved_by: '',
  }
}

export default function BatchTraceability() {
  const [form, setForm]     = useState(emptyForm())
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)
  const [error, setError]   = useState('')

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const setRow = (idx, field, val) =>
    setForm(p => ({
      ...p,
      rows: p.rows.map((r, i) => i === idx ? { ...r, [field]: val } : r),
    }))

  function addRow() {
    setForm(p => ({ ...p, rows: [...p.rows, emptyBatchRow()] }))
  }

  function removeRow(idx) {
    if (form.rows.length <= 1) return
    setForm(p => ({ ...p, rows: p.rows.filter((_, i) => i !== idx) }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!supabaseReady) { setError('Supabase not configured.'); return }
    setSaving(true); setError(''); setSaved(false)
    const { error: err } = await supabase.from('batch_traceability').insert([{
      date:        form.date || null,
      rows:        form.rows,
      total_hs1:   form.total_hs1,
      total_hs2:   form.total_hs2,
      total_hs3:   form.total_hs3,
      total_nm:    form.total_nm,
      checked_by:  form.checked_by,
      approved_by: form.approved_by,
    }])
    setSaving(false)
    if (err) setError(err.message)
    else { setSaved(true); setForm(emptyForm()) }
  }

  return (
    <div className="bt-wrapper">

      {/* ── Title ── */}
      <div className="bt-title-bar">
        <div className="bt-title-main">Batch Traceability Records</div>
        <div className="bt-title-sub">
          73 MIDC Ambad, Nashik — Slurry Section
          <span className="bt-title-pipe"> | </span>
          Batch Charging in High Speed Mixing — Transfer HS to LS
        </div>
      </div>

      <form className="bt-form" onSubmit={handleSubmit}>

        {/* ── Date ── */}
        <div className="bt-meta-bar">
          <div className="bt-meta-field">
            <label className="bt-label">Date</label>
            <input type="date" className="bt-input"
              value={form.date} onChange={e => set('date', e.target.value)} />
          </div>
        </div>

        {/* ── Main Table ── */}
        <div className="bt-table-scroll">
          <table className="bt-table">
            <thead>
              <tr>
                <th className="bt-th-sticky bt-th-batch" rowSpan={2}>Batch No.</th>
                <th colSpan={3}>High Speed Tank (HST)</th>
                <th colSpan={2}>LST 1/2</th>
                <th colSpan={2}>1st Storage</th>
                <th colSpan={2}>2nd Storage</th>
                <th colSpan={2}>Finish Slurry</th>
                <th rowSpan={2} className="bt-th-del"></th>
              </tr>
              <tr>
                <th>Tank</th>
                <th>Start Time</th>
                <th>Stop/End Time</th>
                <th>Start Time</th>
                <th>Stop/End Time</th>
                <th>Start Time</th>
                <th>Stop/End Time</th>
                <th>Start Time</th>
                <th>Stop/End Time</th>
                <th>Start Time</th>
                <th>Stop/End Time</th>
              </tr>
            </thead>
            <tbody>
              {form.rows.map((row, ri) => (
                <tr key={row.id} className={ri % 2 === 0 ? '' : 'bt-tr-alt'}>
                  {/* Batch No — sticky */}
                  <td className="bt-td-sticky bt-td-batch">
                    <input className="bt-input-cell" placeholder="e.g. 3512"
                      value={row.batch_no}
                      onChange={e => setRow(ri, 'batch_no', e.target.value)} />
                  </td>
                  {/* HST */}
                  <td className="bt-td-sm">
                    <select className="bt-select-cell"
                      value={row.hst_tank}
                      onChange={e => setRow(ri, 'hst_tank', e.target.value)}>
                      <option value="">—</option>
                      {TANKS.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                    </select>
                  </td>
                  <td className="bt-td-time">
                    <input type="time" className="bt-input-cell"
                      value={row.hst_start}
                      onChange={e => setRow(ri, 'hst_start', e.target.value)} />
                  </td>
                  <td className="bt-td-time">
                    <input type="time" className="bt-input-cell"
                      value={row.hst_stop}
                      onChange={e => setRow(ri, 'hst_stop', e.target.value)} />
                  </td>
                  {/* LST */}
                  <td className="bt-td-time">
                    <input type="time" className="bt-input-cell"
                      value={row.lst_start}
                      onChange={e => setRow(ri, 'lst_start', e.target.value)} />
                  </td>
                  <td className="bt-td-time">
                    <input type="time" className="bt-input-cell"
                      value={row.lst_stop}
                      onChange={e => setRow(ri, 'lst_stop', e.target.value)} />
                  </td>
                  {/* 1st Storage */}
                  <td className="bt-td-time">
                    <input type="time" className="bt-input-cell"
                      value={row.s1_start}
                      onChange={e => setRow(ri, 's1_start', e.target.value)} />
                  </td>
                  <td className="bt-td-time">
                    <input type="time" className="bt-input-cell"
                      value={row.s1_stop}
                      onChange={e => setRow(ri, 's1_stop', e.target.value)} />
                  </td>
                  {/* 2nd Storage */}
                  <td className="bt-td-time">
                    <input type="time" className="bt-input-cell"
                      value={row.s2_start}
                      onChange={e => setRow(ri, 's2_start', e.target.value)} />
                  </td>
                  <td className="bt-td-time">
                    <input type="time" className="bt-input-cell"
                      value={row.s2_stop}
                      onChange={e => setRow(ri, 's2_stop', e.target.value)} />
                  </td>
                  {/* Finish Slurry */}
                  <td className="bt-td-time">
                    <input type="time" className="bt-input-cell"
                      value={row.finish_start}
                      onChange={e => setRow(ri, 'finish_start', e.target.value)} />
                  </td>
                  <td className="bt-td-time">
                    <input type="time" className="bt-input-cell"
                      value={row.finish_stop}
                      onChange={e => setRow(ri, 'finish_stop', e.target.value)} />
                  </td>
                  <td className="bt-td-del">
                    {form.rows.length > 1 && (
                      <button type="button" className="bt-del-btn"
                        onClick={() => removeRow(ri)}>✕</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Add Row ── */}
        <div className="bt-controls-bar">
          <button type="button" className="bt-add-btn" onClick={addRow}>
            + Add Batch Row
          </button>
        </div>

        {/* ── Total Running Hours ── */}
        <div className="bt-total-section">
          <div className="bt-section-title">Total Running Hours</div>
          <div className="bt-total-grid">
            {TANKS.map(t => (
              <div key={t.key} className="bt-total-field">
                <label className="bt-label">{t.label}</label>
                <input className="bt-input" placeholder="hrs"
                  value={form[`total_${t.key}`]}
                  onChange={e => set(`total_${t.key}`, e.target.value)} />
              </div>
            ))}
          </div>
        </div>

        {/* ── Signatures ── */}
        <div className="bt-sig-bar">
          <div className="bt-sig-field">
            <label className="bt-label">Checked By</label>
            <input className="bt-input" placeholder="Name / Signature"
              value={form.checked_by}
              onChange={e => set('checked_by', e.target.value)} />
          </div>
          <div className="bt-sig-field">
            <label className="bt-label">Approved By</label>
            <input className="bt-input" placeholder="Name / Signature"
              value={form.approved_by}
              onChange={e => set('approved_by', e.target.value)} />
          </div>
        </div>

        {/* ── Actions ── */}
        <div className="bt-actions">
          {error && <div className="bt-error">Error: {error}</div>}
          {saved  && <div className="bt-success">✓ Saved successfully</div>}
          <button type="submit" className="bt-save-btn" disabled={saving}>
            {saving ? 'Saving…' : 'Save Record'}
          </button>
          <button type="button" className="bt-reset-btn"
            onClick={() => { setForm(emptyForm()); setSaved(false); setError('') }}>
            Reset
          </button>
        </div>

      </form>
    </div>
  )
}
