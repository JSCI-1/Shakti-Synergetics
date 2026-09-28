import React, { useState, useMemo } from 'react'
import { supabase, supabaseReady } from '../supabaseClient'
import './SlurryConsumption.css'

function todayISO() { return new Date().toISOString().slice(0, 10) }
function stamp12hr() {
  return new Date().toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: true,
  })
}
function fmtDate(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function emptyForm() {
  return {
    date:            todayISO(),
    opening_bal:     '',
    total_batches:   '',
    closing_bal:     '',   // user-editable
    slurry_consumed: '',
    production:      '',
    prepared_by:     '',
    qc_lab:          '',
    store_dept:      '',
    sanction_by:     '',
    approved_by:     '',
    timestamp:       '',
  }
}

export default function SlurryConsumption() {
  const [form, setForm]     = useState(emptyForm())
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)
  const [error, setError]   = useState('')

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  // Diff = Slurry Consumed − Production  (as requested)
  const diff = useMemo(() => {
    const c = parseFloat(form.slurry_consumed) || 0
    const p = parseFloat(form.production)      || 0
    return (c || p) ? c - p : null
  }, [form.slurry_consumed, form.production])

  function stampTime() {
    set('timestamp', stamp12hr())
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!supabaseReady) { setError('Supabase not configured.'); return }
    setSaving(true); setError(''); setSaved(false)
    const { error: err } = await supabase.from('slurry_consumption').insert([{
      rows: [{
        date:            form.date,
        opening_bal:     parseFloat(form.opening_bal)     || null,
        total_batches:   parseFloat(form.total_batches)   || null,
        closing_bal:     parseFloat(form.closing_bal)     || null,
        slurry_consumed: parseFloat(form.slurry_consumed) || null,
        production:      parseFloat(form.production)      || null,
        diff:            diff,
        prepared_by:     form.prepared_by,
        qc_lab:          form.qc_lab,
        store_dept:      form.store_dept,
        sanction_by:     form.sanction_by,
        approved_by:     form.approved_by,
        timestamp:       form.timestamp,
      }],
    }])
    setSaving(false)
    if (err) setError(err.message)
    else { setSaved(true); setForm(emptyForm()) }
  }

  const fmtDiff = v => {
    if (v === null) return '—'
    return v > 0 ? `+${v.toFixed(0)}` : v.toFixed(0)
  }

  return (
    <div className="sc-wrapper">

      <div className="sc-title-bar">
        <div className="sc-title-main">
          Slurry Consumption Report / <span className="sc-title-hi">स्लरी खपत रिपोर्ट</span>
        </div>
      </div>

      <form onSubmit={handleSubmit}>

        {/* ── Date (today only) ── */}
        <div className="sc-date-bar">
          <div className="sc-date-label">
            Date / <span className="sc-hi-inline">तारीख</span>
          </div>
          <div className="sc-date-val">
            <strong>{fmtDate(form.date)}</strong>
            <span className="sc-date-lock">Today only / आज केवल</span>
          </div>
        </div>

        {/* ── Single-row entry form ── */}
        <div className="sc-table-scroll">
          <table className="sc-table">
            <thead>
              <tr>
                <th>Slurry (Solid)<br />Opening Bal.<br /><span className="sc-hi">शुरुआती शेष</span></th>
                <th>Total Weight<br />of Batches<br /><span className="sc-hi">बैच कुल वजन</span></th>
                <th>Slurry (Solid)<br />Closing Bal.<br /><span className="sc-hi">समापन शेष</span></th>
                <th>Slurry<br />Consumed<br /><span className="sc-hi">खपत स्लरी</span></th>
                <th>Production<br /><span className="sc-hi">उत्पादन</span></th>
                <th className="sc-th-calc">Diff.<br />(Consumed −<br />Production)<br /><span className="sc-hi">अंतर</span></th>
                <th>Prepared By<br /><span className="sc-hi">तैयार किया</span></th>
                <th>QC Lab<br /><span className="sc-hi">QC लैब</span></th>
                <th>Store Dept.<br /><span className="sc-hi">स्टोर</span></th>
                <th>Sanction By<br /><span className="sc-hi">स्वीकृत</span></th>
                <th>Approved By<br /><span className="sc-hi">अनुमोदित</span></th>
                <th>Timestamp<br /><span className="sc-hi">समय</span></th>
                <th>Save<br /><span className="sc-hi">सहेजें</span></th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <input type="number" className="sc-input-num" placeholder="—"
                    value={form.opening_bal} onChange={e => set('opening_bal', e.target.value)} />
                </td>
                <td>
                  <input type="number" className="sc-input-num" placeholder="—"
                    value={form.total_batches} onChange={e => set('total_batches', e.target.value)} />
                </td>
                {/* Editable closing balance */}
                <td>
                  <input type="number" className="sc-input-num" placeholder="—"
                    value={form.closing_bal} onChange={e => set('closing_bal', e.target.value)} />
                </td>
                <td>
                  <input type="number" className="sc-input-num" placeholder="—"
                    value={form.slurry_consumed} onChange={e => set('slurry_consumed', e.target.value)} />
                </td>
                <td>
                  <input type="number" className="sc-input-num" placeholder="—"
                    value={form.production} onChange={e => set('production', e.target.value)} />
                </td>
                {/* Auto diff = consumed - production */}
                <td className="sc-calc-cell">
                  <span className={`sc-calc-val ${diff !== null && diff < 0 ? 'sc-neg' : diff > 0 ? 'sc-pos' : ''}`}>
                    {fmtDiff(diff)}
                  </span>
                </td>
                <td><input className="sc-input-text" placeholder="—" value={form.prepared_by} onChange={e => set('prepared_by', e.target.value)} /></td>
                <td><input className="sc-input-text" placeholder="—" value={form.qc_lab}      onChange={e => set('qc_lab',      e.target.value)} /></td>
                <td><input className="sc-input-text" placeholder="—" value={form.store_dept}  onChange={e => set('store_dept',  e.target.value)} /></td>
                <td><input className="sc-input-text" placeholder="—" value={form.sanction_by} onChange={e => set('sanction_by', e.target.value)} /></td>
                <td><input className="sc-input-text" placeholder="—" value={form.approved_by} onChange={e => set('approved_by', e.target.value)} /></td>
                {/* Timestamp */}
                <td className="sc-ts-cell">
                  {form.timestamp
                    ? <span className="sc-ts-badge">{form.timestamp}</span>
                    : <span className="sc-ts-empty">—</span>}
                </td>
                {/* Stamp button */}
                <td className="sc-save-cell">
                  <button type="button" className="sc-stamp-btn" onClick={stampTime}
                    title="Stamp current time">
                    {form.timestamp ? '✓' : '🕐'}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="sc-actions">
          {error && <div className="sc-error">Error: {error}</div>}
          {saved  && <div className="sc-success">✓ Saved successfully / सफलतापूर्वक सहेजा गया</div>}
          <button type="submit" className="sc-save-btn" disabled={saving}>
            {saving ? 'Saving…' : 'Save Report / रिपोर्ट सहेजें'}
          </button>
          <button type="button" className="sc-reset-btn"
            onClick={() => { setForm(emptyForm()); setSaved(false); setError('') }}>
            Reset / रीसेट
          </button>
        </div>

      </form>
    </div>
  )
}
