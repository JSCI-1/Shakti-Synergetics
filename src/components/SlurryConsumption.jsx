import React, { useState, useMemo, useEffect, useCallback } from 'react'
import { supabase, supabaseReady } from '../supabaseClient'
import './SlurryConsumption.css'

function todayISO() { return new Date().toISOString().slice(0, 10) }
function yesterdayISO() {
  const d = new Date(); d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}
function stamp12hr() {
  return new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
}
function fmtDate(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function emptyForm() {
  return {
    opening_bal: '', total_batches: '', closing_bal: '',
    slurry_consumed: '', production: '',
    prepared_by: '', qc_lab: '', store_dept: '',
    sanction_by: '', approved_by: '', timestamp: '',
  }
}

const COL_HEADERS = (
  <tr>
    <th className="sc-th-sticky sc-th-date">Date<br /><span className="sc-hi">तारीख</span></th>
    <th>Slurry (Solid)<br />Opening Bal.<br /><span className="sc-hi">शुरुआती शेष</span></th>
    <th>Total Weight<br />of Batches<br /><span className="sc-hi">बैच वजन</span></th>
    <th>Slurry (Solid)<br />Closing Bal.<br /><span className="sc-hi">समापन शेष</span></th>
    <th>Slurry<br />Consumed<br /><span className="sc-hi">खपत</span></th>
    <th>Production<br /><span className="sc-hi">उत्पादन</span></th>
    <th className="sc-th-calc">Diff.<br />(Consumed−Prod.)<br /><span className="sc-hi">अंतर</span></th>
    <th className="sc-th-calc">Cumulative<br />Diff.<br /><span className="sc-hi">संचयी अंतर</span></th>
    <th>Prepared By<br /><span className="sc-hi">तैयार किया</span></th>
    <th>QC Lab</th>
    <th>Store Dept.</th>
    <th>Sanction By<br /><span className="sc-hi">स्वीकृत</span></th>
    <th>Approved By<br /><span className="sc-hi">अनुमोदित</span></th>
    <th>Timestamp<br /><span className="sc-hi">समय</span></th>
    <th>Save<br /><span className="sc-hi">सहेजें</span></th>
  </tr>
)

export default function SlurryConsumption() {
  // ── Today's entry ──
  const today = todayISO()
  const [form, setForm]     = useState(emptyForm())
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)
  const [error, setError]   = useState('')
  const [prevCumDiff, setPrevCumDiff] = useState(0)

  // ── History viewer ──
  const [histDate, setHistDate]   = useState(yesterdayISO())
  const [histRow, setHistRow]     = useState(null)
  const [histCum, setHistCum]     = useState(null)
  const [histLoading, setHistLoading] = useState(false)

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  // Diff = Consumed − Production
  const diff = useMemo(() => {
    const c = parseFloat(form.slurry_consumed) || 0
    const p = parseFloat(form.production) || 0
    return (c || p) ? c - p : null
  }, [form.slurry_consumed, form.production])

  // Cumulative = all previous records' diffs + today's diff
  const cumulativeDiff = useMemo(() => {
    if (diff === null && prevCumDiff === 0) return null
    return prevCumDiff + (diff || 0)
  }, [prevCumDiff, diff])

  // Load cumulative diff of the most recent record before today
  // Formula: today's cumulative = previous record's cumulative_diff + today's diff
  const loadPrevCumDiff = useCallback(async () => {
    if (!supabaseReady) return
    const { data } = await supabase.from('slurry_consumption').select('rows')
    if (!data) return

    // Flatten, filter before today, sort by date descending → take most recent
    const all = data.flatMap(r => r.rows || [])
      .filter(r => r.date && r.date < today)
      .sort((a, b) => a.date > b.date ? 1 : -1)

    // Use the stored cumulative_diff of the most recent previous record
    const lastRecord = all.length > 0 ? all[all.length - 1] : null
    const prevCum = lastRecord ? (parseFloat(lastRecord.cumulative_diff) || 0) : 0
    setPrevCumDiff(prevCum)

    // Pre-fill today if already saved
    const existing = data.flatMap(r => r.rows || []).find(r => r.date === today)
    if (existing) {
      setForm({
        opening_bal:     existing.opening_bal     != null ? String(existing.opening_bal)     : '',
        total_batches:   existing.total_batches   != null ? String(existing.total_batches)   : '',
        closing_bal:     existing.closing_bal     != null ? String(existing.closing_bal)     : '',
        slurry_consumed: existing.slurry_consumed != null ? String(existing.slurry_consumed) : '',
        production:      existing.production      != null ? String(existing.production)      : '',
        prepared_by:     existing.prepared_by     || '',
        qc_lab:          existing.qc_lab          || '',
        store_dept:      existing.store_dept      || '',
        sanction_by:     existing.sanction_by     || '',
        approved_by:     existing.approved_by     || '',
        timestamp:       existing.timestamp       || '',
      })
    }
  }, [today])

  useEffect(() => { loadPrevCumDiff() }, [loadPrevCumDiff])

  // Load a specific past date for history viewer
  const loadHistRow = useCallback(async (selectedDate) => {
    if (!supabaseReady || !selectedDate) return
    setHistLoading(true)
    const { data } = await supabase.from('slurry_consumption').select('rows')
    setHistLoading(false)
    if (!data) { setHistRow(null); setHistCum(null); return }

    const all = data.flatMap(r => r.rows || []).filter(r => r.date)

    const row = all.find(r => r.date === selectedDate)
    if (row) {
      setHistRow(row)
      // Use the stored cumulative_diff directly
      setHistCum(row.cumulative_diff != null ? parseFloat(row.cumulative_diff) : null)
    } else {
      setHistRow(null)
      setHistCum(null)
    }
  }, [])

  useEffect(() => { loadHistRow(histDate) }, [histDate, loadHistRow])

  function stampTime() {
    if (form.timestamp) return
    set('timestamp', stamp12hr())
  }

  async function handleSubmit() {
    if (!supabaseReady) { setError('Supabase not configured.'); return }
    setSaving(true); setError(''); setSaved(false)
    const { error: err } = await supabase.from('slurry_consumption').insert([{
      rows: [{
        date:            today,
        opening_bal:     parseFloat(form.opening_bal)     || null,
        total_batches:   parseFloat(form.total_batches)   || null,
        closing_bal:     parseFloat(form.closing_bal)     || null,
        slurry_consumed: parseFloat(form.slurry_consumed) || null,
        production:      parseFloat(form.production)      || null,
        diff,
        cumulative_diff: cumulativeDiff,
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
    else { setSaved(true); loadPrevCumDiff() }
  }

  const fmtV = v => (v === null || v === undefined || v === '') ? '—' : v
  const fmtD = v => {
    if (v === null || v === undefined) return '—'
    const n = parseFloat(v); if (isNaN(n)) return '—'
    return n > 0 ? `+${n.toFixed(0)}` : n.toFixed(0)
  }
  const cls = v => {
    if (v === null || v === undefined) return ''
    const n = parseFloat(v)
    return n > 0 ? 'sc-pos' : n < 0 ? 'sc-neg' : ''
  }

  return (
    <div className="sc-wrapper">
      <div className="sc-title-bar">
        <div className="sc-title-main">
          Slurry Consumption Report / <span className="sc-title-hi">स्लरी खपत रिपोर्ट</span>
        </div>
      </div>

      {/* ══ SECTION 1: Today's Entry ══ */}
      <div className="sc-section-title">
        Today's Entry / <span className="sc-hi-inline">आज की प्रविष्टि</span>
        <span className="sc-today-badge">{fmtDate(today)}</span>
      </div>

      <div className="sc-table-scroll">
        <table className="sc-table">
          <thead>{COL_HEADERS}</thead>
          <tbody>
            <tr className="sc-current-row">
              <td className="sc-td-sticky sc-td-date"><strong>{fmtDate(today)}</strong></td>
              <td><input type="number" className="sc-input-num" placeholder="—" value={form.opening_bal}     onChange={e => set('opening_bal',     e.target.value)} /></td>
              <td><input type="number" className="sc-input-num" placeholder="—" value={form.total_batches}   onChange={e => set('total_batches',   e.target.value)} /></td>
              <td><input type="number" className="sc-input-num" placeholder="—" value={form.closing_bal}     onChange={e => set('closing_bal',     e.target.value)} /></td>
              <td><input type="number" className="sc-input-num" placeholder="—" value={form.slurry_consumed} onChange={e => set('slurry_consumed', e.target.value)} /></td>
              <td><input type="number" className="sc-input-num" placeholder="—" value={form.production}      onChange={e => set('production',      e.target.value)} /></td>
              <td className="sc-calc-cell"><span className={`sc-calc-val ${cls(diff)}`}>{fmtD(diff)}</span></td>
              <td className="sc-calc-cell"><span className={`sc-calc-val ${cls(cumulativeDiff)}`}>{fmtD(cumulativeDiff)}</span></td>
              <td><input className="sc-input-text" placeholder="—" value={form.prepared_by} onChange={e => set('prepared_by', e.target.value)} /></td>
              <td><input className="sc-input-text" placeholder="—" value={form.qc_lab}      onChange={e => set('qc_lab',      e.target.value)} /></td>
              <td><input className="sc-input-text" placeholder="—" value={form.store_dept}  onChange={e => set('store_dept',  e.target.value)} /></td>
              <td><input className="sc-input-text" placeholder="—" value={form.sanction_by} onChange={e => set('sanction_by', e.target.value)} /></td>
              <td><input className="sc-input-text" placeholder="—" value={form.approved_by} onChange={e => set('approved_by', e.target.value)} /></td>
              <td className="sc-ts-cell">
                {form.timestamp ? <span className="sc-ts-badge">{form.timestamp}</span> : <span className="sc-ts-empty">—</span>}
              </td>
              <td className="sc-save-cell">
                <button type="button" className="sc-stamp-btn"
                  disabled={!!form.timestamp} onClick={stampTime}>
                  {form.timestamp ? '✓' : '💾'}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="sc-actions">
        {error && <div className="sc-error">Error: {error}</div>}
        {saved  && <div className="sc-success">✓ Saved / सफलतापूर्वक सहेजा गया</div>}
        <button type="button" className="sc-save-btn" disabled={saving} onClick={handleSubmit}>
          {saving ? 'Saving…' : 'Save Report / रिपोर्ट सहेजें'}
        </button>
        <button type="button" className="sc-reset-btn"
          onClick={() => { setForm(emptyForm()); setSaved(false); setError('') }}>
          Reset / रीसेट
        </button>
      </div>

      {/* ══ SECTION 2: History Viewer ══ */}
      <div className="sc-section-title sc-hist-title">
        View Previous Record / <span className="sc-hi-inline">पिछला रिकॉर्ड देखें</span>
      </div>

      <div className="sc-date-bar">
        <label className="sc-date-label">Select Past Date / <span className="sc-hi-inline">तारीख चुनें</span></label>
        <input
          type="date"
          className="sc-date-input"
          value={histDate}
          max={yesterdayISO()}        /* cannot select today or future */
          onChange={e => setHistDate(e.target.value)}
        />
        {histLoading && <span className="sc-loading">Loading…</span>}
      </div>

      <div className="sc-table-scroll">
        <table className="sc-table">
          <thead>{COL_HEADERS}</thead>
          <tbody>
            <tr className="sc-past-row">
              <td className="sc-td-sticky sc-td-date sc-past-date">
                {histRow ? fmtDate(histRow.date) : fmtDate(histDate)}
              </td>
              <td className="sc-past-val">{histRow ? fmtV(histRow.opening_bal)     : '—'}</td>
              <td className="sc-past-val">{histRow ? fmtV(histRow.total_batches)   : '—'}</td>
              <td className="sc-past-val">{histRow ? fmtV(histRow.closing_bal)     : '—'}</td>
              <td className="sc-past-val">{histRow ? fmtV(histRow.slurry_consumed) : '—'}</td>
              <td className="sc-past-val">{histRow ? fmtV(histRow.production)      : '—'}</td>
              <td className={`sc-calc-cell ${histRow ? cls(histRow.diff) : ''}`}>
                <span className="sc-calc-val">{histRow ? fmtD(histRow.diff) : '—'}</span>
              </td>
              <td className={`sc-calc-cell ${cls(histCum)}`}>
                <span className="sc-calc-val">{histCum !== null ? fmtD(histCum) : '—'}</span>
              </td>
              <td className="sc-past-val">{histRow ? fmtV(histRow.prepared_by) : '—'}</td>
              <td className="sc-past-val">{histRow ? fmtV(histRow.qc_lab)      : '—'}</td>
              <td className="sc-past-val">{histRow ? fmtV(histRow.store_dept)  : '—'}</td>
              <td className="sc-past-val">{histRow ? fmtV(histRow.sanction_by) : '—'}</td>
              <td className="sc-past-val">{histRow ? fmtV(histRow.approved_by) : '—'}</td>
              <td className="sc-past-val">{histRow ? fmtV(histRow.timestamp)   : '—'}</td>
              <td style={{textAlign:'center',color:'#ccc',fontSize:'14px'}}>🔒</td>
            </tr>
            {!histRow && (
              <tr>
                <td colSpan={15} className="sc-no-data">
                  No record found for {fmtDate(histDate)} / इस तारीख का कोई रिकॉर्ड नहीं मिला
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

    </div>
  )
}
