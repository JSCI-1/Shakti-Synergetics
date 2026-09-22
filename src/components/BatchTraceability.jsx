import React, { useState } from 'react'
import { supabase, supabaseReady } from '../supabaseClient'
import './BatchTraceability.css'

const HS_TANKS = [
  { value: 'HS-1(6000)', label: 'HS-1 (6000)' },
  { value: 'HS-2(4000)', label: 'HS-2 (4000)' },
  { value: 'HS-3(6000)', label: 'HS-3 (6000)' },
  { value: 'NM(2000)',   label: 'NM (2000)'   },
]

const FST_TANKS = [
  { value: 'FST 1/2', label: 'FST 1/2' },
  { value: 'FST 1',   label: 'FST 1'   },
  { value: 'FST 2',   label: 'FST 2'   },
]

const TOTAL_RUNNING_TANKS = [
  { key: 'hs1', label: 'HS-1 (6000 Lt.)' },
  { key: 'hs2', label: 'HS-2 (4000 Lt.)' },
  { key: 'hs3', label: 'HS-3 (6000 Lt.)' },
  { key: 'nm',  label: 'NM (2000 Lt.)'   },
]

function emptyRow() {
  return {
    id: Date.now() + Math.random(),
    batch_no: '',
    charge_tank: '', charge_start: '', charge_stop: '',
    hs_tank: '',     hs_start: '',     hs_stop: '',
    lst_start: '',   lst_stop: '',
    s1_start: '',    s1_stop: '',
    s2_start: '',    s2_stop: '',
    finish_tank: '', finish_start: '', finish_stop: '',
  }
}

function emptyForm() {
  return {
    date: '',
    rows: Array.from({ length: 2 }, () => emptyRow()),
    total_hs1: '', total_hs2: '', total_hs3: '', total_nm: '',
    checked_by: '', approved_by: '',
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

  function addRow() { setForm(p => ({ ...p, rows: [...p.rows, emptyRow()] })) }
  function removeRow(idx) {
    if (form.rows.length <= 1) return
    setForm(p => ({ ...p, rows: p.rows.filter((_, i) => i !== idx) }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!supabaseReady) { setError('Supabase not configured.'); return }
    setSaving(true); setError(''); setSaved(false)
    const { error: err } = await supabase.from('batch_traceability').insert([{
      date: form.date || null, rows: form.rows,
      total_hs1: form.total_hs1, total_hs2: form.total_hs2,
      total_hs3: form.total_hs3, total_nm: form.total_nm,
      checked_by: form.checked_by, approved_by: form.approved_by,
    }])
    setSaving(false)
    if (err) setError(err.message)
    else { setSaved(true); setForm(emptyForm()) }
  }

  const TC = ({ row, field, ri }) => (
    <td className="bt-td-time">
      <input type="time" className="bt-input-cell"
        value={row[field] ?? ''}
        onChange={e => setRow(ri, field, e.target.value)} />
    </td>
  )

  const SC = ({ row, field, ri, options }) => (
    <td className="bt-td-sm">
      <select className="bt-select-cell"
        value={row[field] ?? ''}
        onChange={e => setRow(ri, field, e.target.value)}>
        <option value="">—</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </td>
  )

  return (
    <div className="bt-wrapper">
      <div className="bt-title-bar">
        <div className="bt-title-main">Batch Traceability Records</div>
      </div>

      <form className="bt-form" onSubmit={handleSubmit}>

        <div className="bt-meta-bar">
          <div className="bt-meta-field">
            <label className="bt-label">Date</label>
            <input type="date" className="bt-input"
              value={form.date} onChange={e => set('date', e.target.value)} />
          </div>
        </div>

        {/* ══ TABLE ══ */}
        <div className="bt-table-scroll">
          <table className="bt-table">
            <thead>
              <tr className="bt-thead-r1">
                <th className="bt-th-sticky bt-th-batch" rowSpan={2}>Batch<br />No.</th>
                <th colSpan={3} className="bt-th-group">Batch Charge In</th>
                <th colSpan={3} className="bt-th-group">High Speed Mixing</th>
                <th colSpan={2} className="bt-th-group">Transfer HS to LS<br /><small>(LST 1/2)</small></th>
                <th colSpan={2} className="bt-th-group">1st Storage</th>
                <th colSpan={2} className="bt-th-group">2nd Storage</th>
                <th colSpan={3} className="bt-th-group">Finish Slurry</th>
                <th rowSpan={2} className="bt-th-del"></th>
              </tr>
              <tr className="bt-thead-r2">
                <th>Tank</th><th>Start</th><th>Stop</th>
                <th>Tank</th><th>Start</th><th>Stop</th>
                <th>Start</th><th>Stop</th>
                <th>Start</th><th>Stop</th>
                <th>Start</th><th>Stop</th>
                <th>Tank</th><th>Start</th><th>Stop</th>
              </tr>
            </thead>
            <tbody>
              {form.rows.map((row, ri) => (
                <tr key={row.id} className={ri % 2 === 0 ? '' : 'bt-tr-alt'}>
                  <td className="bt-td-sticky bt-td-batch">
                    <input className="bt-input-cell" placeholder="3512"
                      value={row.batch_no}
                      onChange={e => setRow(ri, 'batch_no', e.target.value)} />
                  </td>
                  <SC row={row} field="charge_tank" ri={ri} options={HS_TANKS} />
                  <TC row={row} field="charge_start" ri={ri} />
                  <TC row={row} field="charge_stop"  ri={ri} />
                  <SC row={row} field="hs_tank" ri={ri} options={HS_TANKS} />
                  <TC row={row} field="hs_start" ri={ri} />
                  <TC row={row} field="hs_stop"  ri={ri} />
                  <TC row={row} field="lst_start" ri={ri} />
                  <TC row={row} field="lst_stop"  ri={ri} />
                  <TC row={row} field="s1_start" ri={ri} />
                  <TC row={row} field="s1_stop"  ri={ri} />
                  <TC row={row} field="s2_start" ri={ri} />
                  <TC row={row} field="s2_stop"  ri={ri} />
                  <SC row={row} field="finish_tank" ri={ri} options={FST_TANKS} />
                  <TC row={row} field="finish_start" ri={ri} />
                  <TC row={row} field="finish_stop"  ri={ri} />
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

        <div className="bt-controls-bar">
          <button type="button" className="bt-add-btn" onClick={addRow}>+ Add Batch Row</button>
        </div>

        <div className="bt-total-section">
          <div className="bt-section-title">Total Running Hours</div>
          <div className="bt-total-grid">
            {TOTAL_RUNNING_TANKS.map(t => (
              <div key={t.key} className="bt-total-field">
                <label className="bt-label">{t.label}</label>
                <input className="bt-input" placeholder="hrs"
                  value={form[`total_${t.key}`]}
                  onChange={e => set(`total_${t.key}`, e.target.value)} />
              </div>
            ))}
          </div>
        </div>

        <div className="bt-sig-bar">
          <div className="bt-sig-field">
            <label className="bt-label">Checked By</label>
            <input className="bt-input" placeholder="Name / Signature"
              value={form.checked_by} onChange={e => set('checked_by', e.target.value)} />
          </div>
          <div className="bt-sig-field">
            <label className="bt-label">Approved By</label>
            <input className="bt-input" placeholder="Name / Signature"
              value={form.approved_by} onChange={e => set('approved_by', e.target.value)} />
          </div>
        </div>

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
