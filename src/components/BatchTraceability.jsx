import React, { useState, useEffect } from 'react'
import { supabase, supabaseReady } from '../supabaseClient'
import { useDraft, useUserId } from '../utils/useDraft.js'
import { useSharedDraft, deleteSharedDraft, fetchLatestSaved } from '../utils/useSharedDraft.js'
import './BatchTraceability.css'

// ── 12-hour time dropdown helpers ────────────────────────────────────────────
// Option lists. Minutes are every minute (00–59) so any time is selectable.
const HOURS_12  = ['1','2','3','4','5','6','7','8','9','10','11','12']
const MINUTES   = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'))

// Parse a stored 24-hour "HH:mm" string into 12-hour parts for the dropdowns.
// Returns { h12, min, mer } or null when the value is empty / unparseable.
function parse24(v) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || '').trim())
  if (!m) return null
  const h = parseInt(m[1], 10)
  const min = m[2]
  if (isNaN(h) || h < 0 || h > 23) return null
  const mer = h >= 12 ? 'PM' : 'AM'
  let h12 = h % 12
  if (h12 === 0) h12 = 12
  return { h12: String(h12), min, mer }
}

// Build a stored 24-hour "HH:mm" string from 12-hour parts.
function to24(h12, min, mer) {
  let h = parseInt(h12, 10) % 12          // 12 → 0
  if (mer === 'PM') h += 12               // 12 PM → 12, 1 PM → 13 …
  return String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0')
}

// ── Total Running Hours auto-calculation ──────────────────────────────────────
// Which Total-Running tank each tank-dropdown value maps to. The Charge In and
// High Speed Mixing dropdowns share these HS-1/2/3/NM tank values.
const TANK_TO_TOTAL = {
  'HS-1(6000)': 'hs1',
  'HS-2(4000)': 'hs2',
  'HS-3(6000)': 'hs3',
  'NM(2000)':   'nm',
}

// Minutes since midnight for a stored "HH:mm" (null if blank/invalid).
function minutesOf(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim())
  if (!m) return null
  const h = +m[1], min = +m[2]
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

// Duration in minutes between two "HH:mm" times. If stop is at/after start it's
// the plain difference; if stop is earlier it is treated as crossing midnight
// (+24h). Returns 0 when either end is missing/invalid.
function durationMins(startHHmm, stopHHmm) {
  const a = minutesOf(startHHmm), b = minutesOf(stopHHmm)
  if (a === null || b === null) return 0
  let d = b - a
  if (d < 0) d += 24 * 60                 // overnight
  return d
}

// Compute Total Running Hours per tank from all batch rows.
//
// EACH STAGE contributes its OWN running time to whatever tank IT has selected:
//   • Batch Charge In  → adds (charge_start → charge_stop) to the charge_tank
//   • High Speed Mixing→ adds (hs_start → hs_stop)         to the hs_tank
// Both the Charge In and HS Mixing dropdowns offer HS-1/2/3/NM. So if a batch
// has HS-1 in Charge In AND HS-1 in High Speed Mixing, BOTH durations add into
// HS-1's total. If Charge In uses HS-1 and HS Mixing uses HS-2, each tank gets
// its own stage's time. The times of ALL batches accumulate per tank.
// Returns { hs1, hs2, hs3, nm } as "H:MM" strings ('' when a tank has no time).
function computeTotals(rows) {
  const mins = { hs1: 0, hs2: 0, hs3: 0, nm: 0 }
  for (const r of rows || []) {
    // Batch Charge In stage → its own tank.
    const chargeKey = TANK_TO_TOTAL[r.charge_tank]
    if (chargeKey) mins[chargeKey] += durationMins(r.charge_start, r.charge_stop)
    // High Speed Mixing stage → its own tank.
    const hsKey = TANK_TO_TOTAL[r.hs_tank]
    if (hsKey) mins[hsKey] += durationMins(r.hs_start, r.hs_stop)
  }
  const fmt = m => m > 0 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}` : ''
  return { hs1: fmt(mins.hs1), hs2: fmt(mins.hs2), hs3: fmt(mins.hs3), nm: fmt(mins.nm) }
}

// ── 12-hour time cell: three dropdowns (Hour / Minute / AM-PM) ────────────────
// The cell STORES a 24-hour "HH:mm" string (the SAME format we already store →
// saved records and the DB stay compatible); the dropdowns only change the UI.
function TimeCell({ value, onChange }) {
  const parsed = parse24(value)        // { h12, min, mer } | null
  const h12 = parsed ? parsed.h12 : ''
  const min = parsed ? parsed.min : ''
  const mer = parsed ? parsed.mer : 'AM'

  // Rebuild "HH:mm" from whichever part changed. If both hour and minute are
  // blank, the cell is cleared (''). If only one is picked, sensible defaults
  // (hour→12, minute→00, meridiem→AM) complete a usable time.
  const update = (nextH12, nextMin, nextMer) => {
    if (nextH12 === '' && nextMin === '') { onChange(''); return }
    onChange(to24(nextH12 || '12', nextMin || '00', nextMer || 'AM'))
  }

  return (
    <div className="bt-time12">
      <select className="bt-time12-sel" value={h12}
        onChange={e => update(e.target.value, min, mer)}>
        <option value="">--</option>
        {HOURS_12.map(h => <option key={h} value={h}>{h}</option>)}
      </select>
      <span className="bt-time12-colon">:</span>
      <select className="bt-time12-sel" value={min}
        onChange={e => update(h12, e.target.value, mer)}>
        <option value="">--</option>
        {MINUTES.map(m => <option key={m} value={m}>{m}</option>)}
      </select>
      <select className="bt-time12-sel bt-time12-mer" value={mer}
        onChange={e => update(h12, min, e.target.value)}>
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  )
}

// Batch Charge In tanks — Attrition Mills + HST only (no FST)
const CHARGE_TANKS = [
  { value: 'Attrition-1st-1.6MT', label: '1st Attrition Mill — 1.6 MT' },
  { value: 'Attrition-2nd-1.2MT', label: '2nd Attrition Mill — 1.2 MT' },
  { value: 'HST-1st-8MT',         label: 'HST 1st — 8 MT'              },
  { value: 'HST-2nd-6MT',         label: 'HST 2nd — 6 MT'              },
  { value: 'HS-1(6000)', label: 'HS-1 (6000)' },
  { value: 'HS-2(4000)', label: 'HS-2 (4000)' },
  { value: 'HS-3(6000)', label: 'HS-3 (6000)' },
  { value: 'NM(2000)',   label: 'NM (2000)'   },
]

// High Speed Mixing tanks — same as Charge (no FST)
const HS_TANKS = CHARGE_TANKS

// LST tanks — LST1, LST2, or both (LST 1/2)
const LST_TANKS = [
  { value: 'LST1',   label: 'LST 1'   },
  { value: 'LST2',   label: 'LST 2'   },
  { value: 'LST1/2', label: 'LST 1/2' },
]

// Finish Slurry tanks — FST only
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

function emptyRow(batch_no = '', charge_tank = '') {
  return {
    id: Date.now() + Math.random(),
    batch_no,
    charge_tank,
    charge_start: '', charge_stop: '',
    hs_tank:     charge_tank,
    hs_start: '', hs_stop: '',
    lst_tank: '', lst_start: '', lst_stop: '',
    s1_start: '', s1_stop: '',
    s2_start: '', s2_stop: '',
    finish_tank: charge_tank,
    finish_start: '', finish_stop: '',
  }
}

function emptyForm(sharedBatches) {
  return {
    date: '',
    // One row per batch from Process Job Card
    rows: sharedBatches.length > 0
      ? sharedBatches.map(b => emptyRow(b.batch_no, b.tank_type))
      : [emptyRow()],
    total_hs1: '', total_hs2: '', total_hs3: '', total_nm: '',
    checked_by: '', approved_by: '',
  }
}

export default function BatchTraceability({ sharedBatches = [] }) {
  const uid = useUserId()
  const [form, setForm, clearFormDraft] = useDraft(`draft:${uid}:batch:traceability`, () => emptyForm(sharedBatches))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)
  const [error, setError]   = useState('')

  // Sync rows to the Process Job Card batches. As soon as the operator clicks
  // "Add Batch" over there, sharedBatches grows → a matching Batch Traceability
  // row is added here automatically (and tank_type fills ALL tank columns).
  //
  // One row per batch, matched POSITIONALLY so already-entered time/tank values
  // in a row are preserved when a new batch is appended (the new batch simply
  // adds a fresh trailing row). The row count always tracks the batch count, so
  // adding a batch increases the rows and removing one decreases them. We depend
  // on sharedBatches.length too so a pure count change always re-syncs.
  useEffect(() => {
    setForm(prev => {
      const prevRows = prev.rows || []
      const newRows = sharedBatches.map((b, i) => {
        const existing = prevRows[i]
        const tank = b.tank_type || ''
        // Batch No. is FETCHED from the Process Job Card batch and always tracks
        // it (there is no batch-no editor here, so it mirrors Process live).
        // The stage tanks (Charge/HS/Finish) are PRE-FILLED from the Process tank
        // but kept editable: once a value exists in the row we don't overwrite the
        // operator's per-stage choice. The operator's time entries are preserved.
        // A new batch (no existing row yet) starts fresh with its batch no. + tank
        // pre-filled into all stage tank columns.
        return existing
          ? {
              ...existing,
              batch_no:    b.batch_no || existing.batch_no || '',
              charge_tank: existing.charge_tank || tank,
              hs_tank:     existing.hs_tank     || tank,
              finish_tank: existing.finish_tank || tank,
            }
          : emptyRow(b.batch_no, b.tank_type)
      })
      return { ...prev, rows: newRows.length > 0 ? newRows : [emptyRow()] }
    })
  }, [sharedBatches, sharedBatches.length])

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const setRow = (idx, field, val) =>
    setForm(p => ({
      ...p,
      rows: p.rows.map((r, i) => i === idx ? { ...r, [field]: val } : r),
    }))

  // Auto-computed Total Running Hours per tank (HS-1/2/3/NM), summed across all
  // batch rows. Recomputes whenever any row's tank/times change or a batch is
  // added/removed. Kept in form.total_* so it persists with the saved record.
  const totals = computeTotals(form.rows)
  useEffect(() => {
    setForm(p => {
      if (p.total_hs1 === totals.hs1 && p.total_hs2 === totals.hs2 &&
          p.total_hs3 === totals.hs3 && p.total_nm === totals.nm) return p   // no change
      return { ...p, total_hs1: totals.hs1, total_hs2: totals.hs2, total_hs3: totals.hs3, total_nm: totals.nm }
    })
  }, [totals.hs1, totals.hs2, totals.hs3, totals.nm])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Shared draft: other Batch Operators see the times/tanks entered ──
  // Keyed by the record date; deleted when the record is saved. Totals are
  // derived from the rows, so they are not shared.
  const sharedBlob = {
    rows: form.rows,
    checked_by: form.checked_by,
    approved_by: form.approved_by,
  }

  const sharedDraft = useSharedDraft({
    section: 'batch_traceability',
    date: form.date,
    blob: sharedBlob,
    hasData: b => !!(b.checked_by || b.approved_by) || (b.rows || []).some(r =>
      r.lst_tank || ['charge_start', 'charge_stop', 'hs_start', 'hs_stop', 'lst_start', 'lst_stop',
        's1_start', 's1_stop', 's2_start', 's2_stop', 'finish_start', 'finish_stop'].some(f => r[f])
    ),
    apply: m => {
      if (!m || !Array.isArray(m.rows) || m.rows.length === 0) return
      if (!m.rows.every(r => r && r.id != null)) return
      setForm(p => ({
        ...p,
        rows: m.rows,
        checked_by: m.checked_by ?? '',
        approved_by: m.approved_by ?? '',
      }))
    },
    // Admin picks a date with no live draft → show the saved record for it
    loadSaved: async date => {
      const row = await fetchLatestSaved('batch_traceability', 'date', date)
      if (!row || !Array.isArray(row.rows) || row.rows.length === 0) return null
      if (!row.rows.every(r => r && r.id != null)) return null
      return { rows: row.rows, checked_by: row.checked_by || '', approved_by: row.approved_by || '' }
    },
    // Date changed: empty the rows so the new date's shared values load
    // instead of the previous date's being copied onto it.
    onDateSwitch: () => {
      setForm(p => ({ ...emptyForm(sharedBatches), date: p.date }))
      setSaved(false); setError('')
    },
    onRemoteCleared: () => {
      // This record was saved by another operator.
      clearFormDraft(); setSaved(false); setError('')
    },
  })

  function addRow() { setForm(p => ({ ...p, rows: [...p.rows, emptyRow()] })) }
  function removeRow(idx) {
    if (form.rows.length <= 1) return
    setForm(p => ({ ...p, rows: p.rows.filter((_, i) => i !== idx) }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!supabaseReady) { setError('Supabase not configured.'); return }
    setSaving(true); setError(''); setSaved(false)
    const submittedDate = form.date
    const { error: err } = await supabase.from('batch_traceability').insert([{
      date: form.date || null, rows: form.rows,
      total_hs1: form.total_hs1, total_hs2: form.total_hs2,
      total_hs3: form.total_hs3, total_nm: form.total_nm,
      checked_by: form.checked_by, approved_by: form.approved_by,
    }])
    setSaving(false)
    if (err) setError(err.message)
    else {
      setSaved(true)
      sharedDraft.suppress()
      deleteSharedDraft('batch_traceability', submittedDate)
      clearFormDraft()
    }
  }

  // ── Single 12-hour time cell ────────────────────────────────────────────────
  // One text box per time. The operator types a time like "230 pm" or "2:30 PM"
  // and it is normalised to "hh:mm AM/PM" on blur/Enter. The VALUE is still
  // STORED as a 24-hour "HH:mm" string (unchanged format → existing saved records
  // and the DB stay compatible); only what's shown/typed is 12-hour.
  const TC = ({ row, field, ri }) => (
    <td className="bt-td-time">
      <TimeCell value={row[field] ?? ''} onChange={v => setRow(ri, field, v)} />
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
        <div className="bt-title-main">
          Batch Traceability Records / <span className="bt-title-hi">बैच ट्रेसेबिलिटी रिकॉर्ड</span>
        </div>
      </div>

      <form className="bt-form" onSubmit={handleSubmit}>

        <div className="bt-meta-bar">
          <div className="bt-meta-field">
            <label className="bt-label">Date / <span className="bt-label-hi">तारीख</span></label>
            <input type="date" className="bt-input"
              value={form.date} onChange={e => set('date', e.target.value)} />
          </div>
        </div>

        {/* ══ TABLE ══ */}
        <div className="bt-table-scroll">
          <table className="bt-table">
            <thead>
              <tr className="bt-thead-r1">
                <th className="bt-th-sticky bt-th-batch" rowSpan={2}>
                  Batch No.<br /><span className="bt-hi">बैच नं.</span>
                </th>
                <th colSpan={3} className="bt-th-group">
                  Batch Charge In<br /><span className="bt-hi">बैच चार्ज इन</span>
                </th>
                <th colSpan={3} className="bt-th-group">
                  High Speed Mixing<br /><span className="bt-hi">हाई स्पीड मिक्सिंग</span>
                </th>
                <th colSpan={3} className="bt-th-group">
                  Transfer HS to LS (LST 1/2)<br /><span className="bt-hi">HS से LS ट्रांसफर</span>
                </th>
                <th colSpan={2} className="bt-th-group">
                  1st Storage<br /><span className="bt-hi">प्रथम स्टोरेज</span>
                </th>
                <th colSpan={2} className="bt-th-group">
                  2nd Storage<br /><span className="bt-hi">द्वितीय स्टोरेज</span>
                </th>
                <th colSpan={3} className="bt-th-group">
                  Finish Slurry<br /><span className="bt-hi">फिनिश स्लरी</span>
                </th>
                <th rowSpan={2} className="bt-th-del"></th>
              </tr>
              <tr className="bt-thead-r2">
                <th>Tank<br /><span className="bt-hi">टैंक</span></th>
                <th>Start<br /><span className="bt-hi">शुरू</span></th>
                <th>Stop<br /><span className="bt-hi">बंद</span></th>
                <th>Tank<br /><span className="bt-hi">टैंक</span></th>
                <th>Start<br /><span className="bt-hi">शुरू</span></th>
                <th>Stop<br /><span className="bt-hi">बंद</span></th>
                <th>Tank<br /><span className="bt-hi">टैंक</span></th>
                <th>Start<br /><span className="bt-hi">शुरू</span></th>
                <th>Stop<br /><span className="bt-hi">बंद</span></th>
                <th>Start<br /><span className="bt-hi">शुरू</span></th>
                <th>Stop<br /><span className="bt-hi">बंद</span></th>
                <th>Start<br /><span className="bt-hi">शुरू</span></th>
                <th>Stop<br /><span className="bt-hi">बंद</span></th>
                <th>Tank<br /><span className="bt-hi">टैंक</span></th>
                <th>Start<br /><span className="bt-hi">शुरू</span></th>
                <th>Stop<br /><span className="bt-hi">बंद</span></th>
              </tr>
            </thead>
            <tbody>
              {form.rows.map((row, ri) => (
                <tr key={row.id} className={ri % 2 === 0 ? '' : 'bt-tr-alt'}>
                  <td className="bt-td-sticky bt-td-batch">
                    <input className="bt-input-cell"
                      placeholder="Batch No. / बैच नं."
                      value={row.batch_no}
                      onChange={e => setRow(ri, 'batch_no', e.target.value)} />
                  </td>
                  <SC row={row} field="charge_tank"  ri={ri} options={CHARGE_TANKS} />
                  <TC row={row} field="charge_start" ri={ri} />
                  <TC row={row} field="charge_stop"  ri={ri} />
                  <SC row={row} field="hs_tank"  ri={ri} options={HS_TANKS} />
                  <TC row={row} field="hs_start"  ri={ri} />
                  <TC row={row} field="hs_stop"   ri={ri} />
                  <SC row={row} field="lst_tank"  ri={ri} options={LST_TANKS} />
                  <TC row={row} field="lst_start" ri={ri} />
                  <TC row={row} field="lst_stop"  ri={ri} />
                  <TC row={row} field="s1_start"  ri={ri} />
                  <TC row={row} field="s1_stop"   ri={ri} />
                  <TC row={row} field="s2_start"  ri={ri} />
                  <TC row={row} field="s2_stop"   ri={ri} />
                  <SC row={row} field="finish_tank"  ri={ri} options={FST_TANKS} />
                  <TC row={row} field="finish_start" ri={ri} />
                  <TC row={row} field="finish_stop"  ri={ri} />
                  <td className="bt-td-del">
                    {form.rows.length > 1 && (
                      <button type="button" className="bt-del-btn" onClick={() => removeRow(ri)}>✕</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bt-controls-bar">
          <button type="button" className="bt-add-btn" onClick={addRow}>
            + Add Batch Row / <span style={{fontSize:'10px'}}>बैच पंक्ति जोड़ें</span>
          </button>
        </div>

        <div className="bt-total-section">
          <div className="bt-section-title">
            Total Running Hours / <span style={{fontWeight:'400',fontSize:'11px'}}>कुल चलने के घंटे</span>
          </div>
          <div className="bt-total-grid">
            {TOTAL_RUNNING_TANKS.map(t => (
              <div key={t.key} className="bt-total-field">
                <label className="bt-label">{t.label}</label>
                <input className="bt-input bt-total-auto" placeholder="0:00"
                  value={totals[t.key] || ''} readOnly tabIndex={-1}
                  title="Auto-calculated from batch start → stop times (H:MM)" />
              </div>
            ))}
          </div>
        </div>

        <div className="bt-sig-bar">
          <div className="bt-sig-field">
            <label className="bt-label">Checked By / <span className="bt-label-hi">जाँच की गई</span></label>
            <input className="bt-input" placeholder="Name / नाम"
              value={form.checked_by} onChange={e => set('checked_by', e.target.value)} />
          </div>
          <div className="bt-sig-field">
            <label className="bt-label">Approved By / <span className="bt-label-hi">अनुमोदित</span></label>
            <input className="bt-input" placeholder="Name / नाम"
              value={form.approved_by} onChange={e => set('approved_by', e.target.value)} />
          </div>
        </div>

        <div className="bt-actions">
          {error && <div className="bt-error">Error: {error}</div>}
          {saved  && <div className="bt-success">✓ Saved successfully / सफलतापूर्वक सहेजा गया</div>}
          <button type="submit" className="bt-save-btn" disabled={saving}>
            {saving ? 'Saving…' : 'Save Record / रिकॉर्ड सहेजें'}
          </button>
          <button type="button" className="bt-reset-btn"
            onClick={() => { clearFormDraft(); setSaved(false); setError('') }}>
            Reset / रीसेट
          </button>
        </div>

      </form>
    </div>
  )
}
