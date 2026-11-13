import React, { useState, useEffect, useCallback } from 'react'
import { supabase, supabaseReady } from '../supabaseClient'
import './DryerRecords.css'

// ─────────────────────────────────────────────────────────────
// Constants — mirrors DryerSection.jsx
// ─────────────────────────────────────────────────────────────

const TIME_SLOTS = [
  '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00',
  '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00', '23:00',
  '00:00', '01:00', '02:00', '03:00', '04:00', '05:00', '06:00', '07:00',
]

const CAL_SENSORS = [
  { key: 'inlet',   label: 'Inlet',   labelHi: 'इनलेट'       },
  { key: 'outlet',  label: 'Outlet',  labelHi: 'आउटलेट'      },
  { key: 'ifbd',    label: 'IFBD',    labelHi: 'आईएफबीडी'    },
  { key: 'fbd',     label: 'FBD',     labelHi: 'एफबीडी'      },
  { key: 'chamber', label: 'Chamber', labelHi: 'चैम्बर'       },
]

const BLOWERS = [
  { label: 'ID Blower', labelHi: 'आईडी ब्लोअर', dp: 'id_blower_dp', mr: 'id_blower_mr' },
  { label: 'FD Blower', labelHi: 'एफडी ब्लोअर', dp: 'fd_blower_dp', mr: 'fd_blower_mr' },
  { label: 'IFBD',      labelHi: 'आईएफबीडी',    dp: 'chamber_dp',   mr: 'chamber_mr'   },
  { label: 'FBD %',     labelHi: 'एफबीडी %',    dp: 'fbd_pct_dp',   mr: 'fbd_pct_mr'   },
]

const MAINTENANCE_OPTIONS = [
  { key: 'shifter_screen', label: 'Shifter-Screen Cleaning' },
  { key: 'atomizer_water', label: 'Running the Atomizer on Water' },
]

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function formatDate(d) {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  if (!y) return d
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${day} ${months[parseInt(m, 10) - 1]} ${y}`
}

function formatSavedAt(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
    timeZone: 'Asia/Kolkata',
  })
}

function getRow(record, i) {
  const rows = Array.isArray(record.log_rows) ? record.log_rows : []
  const r = rows[i]
  if (!r || typeof r !== 'object') return {}
  return r
}

function buildEventsTrail(events, fallbackTs) {
  if (Array.isArray(events) && events.length > 0) {
    return events.map((e, idx) => {
      const label = idx === 0 ? 'Original' : `Edited`
      const ts = e && e.ts ? new Date(e.ts).toLocaleTimeString('en-IN', {
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
        timeZone: 'Asia/Kolkata',
      }) : ''
      return ts ? `${label}: ${ts}` : label
    }).join('\n')
  }
  return fallbackTs || ''
}

const PAGE_SIZE = 30

// ─────────────────────────────────────────────────────────────
// ReadonlyCell — single table cell (read-only value display)
// ─────────────────────────────────────────────────────────────
function ReadonlyCell({ value, isTemp }) {
  const display = (value ?? '').toString().trim()
  return (
    <td className={isTemp ? 'drec-temp-cell' : ''}>
      <div className="drec-cell-val">
        {display || <span className="drec-blank">—</span>}
      </div>
    </td>
  )
}

// ─────────────────────────────────────────────────────────────
// ReadonlyLogTable — the full 24-row hourly table
// ─────────────────────────────────────────────────────────────
function ReadonlyLogTable({ record }) {
  return (
    <div className="dr-table-section">
      <div className="dr-table-scroll">
        <table className="dr-table">
          <colgroup>
            <col className="dr-col-time" />
            <col className="dr-col-temp" /><col className="dr-col-temp" /><col className="dr-col-temp" />
            <col className="dr-col-temp" /><col className="dr-col-temp" /><col className="dr-col-temp" />
            <col className="dr-col-normal" /><col className="dr-col-normal" />
            <col className="dr-col-normal" /><col className="dr-col-normal" /><col className="dr-col-normal" />
            <col className="dr-col-text" />
            <col className="dr-col-normal" /><col className="dr-col-normal" /><col className="dr-col-normal" />
            <col className="dr-col-text" /><col className="dr-col-text" /><col className="dr-col-remarks" />
            <col className="dr-col-text" />
            <col className="dr-col-maint" />
            <col className="dr-col-timestamp" />
          </colgroup>

          <thead>
            <tr className="dr-thead-r1">
              <th className="dr-th-time" rowSpan={2}>
                Time<br /><span className="dr-hi">समय</span>
              </th>
              <th className="dr-temperature-group" colSpan={3}>
                Temperature Deg. Cent.<br /><span className="dr-hi">तापमान (°C)</span>
              </th>
              <th className="dr-temperature-group" colSpan={3}>
                Temperature Deg. Cent.<br /><span className="dr-hi">तापमान (°C)</span>
              </th>
              <th rowSpan={2}>Atomizer Freq.<br /><span className="dr-hi">एटमाइज़र फ्रीक्वेंसी</span></th>
              <th rowSpan={2}>Feed F.C.<br /><span className="dr-hi">फीड एफ.सी.</span></th>
              <th rowSpan={2}>C.Pressure<br /><span className="dr-hi">सी. दबाव</span></th>
              <th rowSpan={2}>Feed Pressure<br /><span className="dr-hi">फीड दबाव</span></th>
              <th rowSpan={2}>Pt. Temp<br /><span className="dr-hi">पीटी. तापमान</span></th>
              <th rowSpan={2}>Batch No.<br /><span className="dr-hi">बैच नं.</span></th>
              <th rowSpan={2}>No. of Bag Per Hours(25)<br /><span className="dr-hi">बैग प्रति घंटा (25)</span></th>
              <th rowSpan={2}>Bag Size By Wt.(25)<br /><span className="dr-hi">बैग का वजन (25)</span></th>
              <th rowSpan={2}>No. of Bag Per Hours(50/1000)<br /><span className="dr-hi">बैग प्रति घंटा (50/1000)</span></th>
              <th rowSpan={2}>Bag Size By Wt(50/1000)<br /><span className="dr-hi">बैग का वजन (50/1000)</span></th>
              <th rowSpan={2}>Kg./Hour Production<br /><span className="dr-hi">किग्रा/घंटा</span></th>
              <th rowSpan={2}>Colour/Normal/OMRI<br /><span className="dr-hi">रंग/सामान्य</span></th>
              <th rowSpan={2}>I.D. Frequency<br /><span className="dr-hi">आईडी फ्रीक्वेंसी</span></th>
              <th rowSpan={2}>Remarks<br /><span className="dr-hi">टिप्पणी</span></th>
              <th rowSpan={2}>Operator Name<br /><span className="dr-hi">ऑपरेटर का नाम</span></th>
              <th rowSpan={2}>Maintenance<br /><span className="dr-hi">रखरखाव</span></th>
              <th rowSpan={2}>Timestamp<br /><span className="dr-hi">समय टिकट</span></th>
            </tr>
            <tr className="dr-thead-r2">
              <th className="dr-temp-subheader">Inlet<br /><span className="dr-hi">इनलेट</span></th>
              <th className="dr-temp-subheader">Outlet<br /><span className="dr-hi">आउटलेट</span></th>
              <th className="dr-temp-subheader">Actual<br /><span className="dr-hi">वास्तविक</span></th>
              <th className="dr-temp-subheader">IFBD</th>
              <th className="dr-temp-subheader">FBD</th>
              <th className="dr-temp-subheader">Chamber<br /><span className="dr-hi">चैम्बर</span></th>
            </tr>
          </thead>

          <tbody>
            {TIME_SLOTS.map((slot, i) => {
              const row = getRow(record, i)
              const hasSaved = !!row.saved || !!row.timestamp
              const trail = buildEventsTrail(row.__events, row.timestamp)

              return (
                <tr key={slot}
                  className={`${i % 2 !== 0 ? 'dr-tr-alt' : ''} ${hasSaved ? 'dr-row-saved' : ''}`}>

                  <td className="dr-td-time">{slot}</td>

                  {/* Temperature cols */}
                  <ReadonlyCell value={row.temp_inlet}    isTemp />
                  <ReadonlyCell value={row.temp_outlet}   isTemp />
                  <ReadonlyCell value={row.temp_actual}   isTemp />
                  <ReadonlyCell value={row.temp_fbd1}     isTemp />
                  <ReadonlyCell value={row.temp_fbd2}     isTemp />
                  <ReadonlyCell value={row.temp_chamber}  isTemp />

                  {/* Other numeric */}
                  <ReadonlyCell value={row.atomizer_freq} />
                  <ReadonlyCell value={row.feed_fc} />
                  <ReadonlyCell value={row.c_pressure} />
                  <ReadonlyCell value={row.pressure} />
                  <ReadonlyCell value={row.pt_temp} />

                  {/* Text */}
                  <ReadonlyCell value={row.batch_no} />
                  <ReadonlyCell value={row.bags_per_hr} />
                  <ReadonlyCell value={row.bag_size_wt} />
                  <ReadonlyCell value={row.bags_per_hr_50} />
                  <ReadonlyCell value={row.bag_size_wt_50} />
                  <ReadonlyCell value={row.kg_per_hr} />
                  <ReadonlyCell value={row.colour} />
                  <ReadonlyCell value={row.id_frequency} />
                  <ReadonlyCell value={row.remarks} />

                  {/* Operator name */}
                  <td className="dr-td-operator">
                    {row.operator_name
                      ? <span className="dr-operator-badge">{row.operator_name}</span>
                      : <span className="dr-ts-empty">—</span>}
                  </td>

                  {/* Maintenance */}
                  <td className="dr-td-maint">
                    {MAINTENANCE_OPTIONS.map(opt => {
                      const iso = (row.maintenance || {})[opt.key] || ''
                      if (!iso) return null
                      const d = new Date(iso)
                      const label = isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-IN', {
                        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
                        timeZone: 'Asia/Kolkata',
                      })
                      return (
                        <div key={opt.key} className="dr-maint-opt">
                          <span className="drec-maint-check">✓</span>
                          <span className="dr-maint-label">{opt.label}</span>
                          {label && <span className="dr-maint-time">{label}</span>}
                        </div>
                      )
                    })}
                    {!MAINTENANCE_OPTIONS.some(opt => !!(row.maintenance || {})[opt.key]) && (
                      <span className="dr-ts-empty">—</span>
                    )}
                  </td>

                  {/* Timestamp */}
                  <td className="dr-td-ts">
                    {trail
                      ? <span className="dr-ts-badge" style={{ whiteSpace: 'pre-line' }}>{trail}</span>
                      : <span className="dr-ts-empty">—</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// RecordDetail — full read-only log sheet view
// ─────────────────────────────────────────────────────────────
function RecordDetail({ record, onBack }) {
  const dryerLabel  = record.dryer_type === 'new' ? 'New Dryer' : 'Old Dryer'
  const dryerLabelHi = record.dryer_type === 'new' ? 'नया ड्रायर' : 'पुराना ड्रायर'

  // calibration_sensors from DB: { inlet: { temp, sensor }, … }
  const calSensors = (record.calibration_sensors && typeof record.calibration_sensors === 'object')
    ? record.calibration_sensors : {}

  const totalProduction = record.total_production ?? (
    (parseFloat(record.fine_powder) || 0) +
    (parseFloat(record.crust_papadi) || 0) +
    (parseFloat(record.startup) || 0) +
    (parseFloat(record.packed_production) || 0)
  )

  return (
    <div className="dr-form-wrapper drec-readonly-wrapper">

      {/* ── Title bar ── */}
      <div className="dr-title-bar">
        <button type="button" className="dr-back-btn" onClick={onBack}>
          ← Back / वापस
        </button>
        <div className="dr-title-main">
          {dryerLabel} — LOG SHEET /{' '}
          <span className="dr-title-hi">{dryerLabelHi} — लॉग शीट</span>
        </div>
        <span className="drec-readonly-badge">View Only</span>
      </div>

      {/* ── Meta bar ── */}
      <div className="dr-meta-bar">
        <div className="dr-meta-field">
          <label className="dr-label">Date / <span className="dr-label-hi">तारीख</span></label>
          <div className="dr-input drec-meta-display">{formatDate(record.date)}</div>
        </div>
        <div className="dr-meta-field">
          <label className="dr-label">Saved At / <span className="dr-label-hi">सहेजा गया</span></label>
          <div className="dr-input drec-meta-display">{formatSavedAt(record.created_at)}</div>
        </div>
      </div>

      {/* ── Hourly log table ── */}
      <ReadonlyLogTable record={record} />

      {/* ── Blower bar ── */}
      <div className="dr-blower-bar">
        {BLOWERS.map(b => (
          <div key={b.label} className="dr-blower-card">
            <div className="dr-blower-title">
              {b.label}<br /><span className="dr-blower-hi">{b.labelHi}</span>
            </div>
            <div className="dr-blower-row">
              <span className="dr-blower-sub">DP</span>
              <div className="dr-input dr-input-sm drec-meta-display">{record[b.dp] || '—'}</div>
            </div>
            <div className="dr-blower-row">
              <span className="dr-blower-sub">MR</span>
              <div className="dr-input dr-input-sm drec-meta-display">{record[b.mr] || '—'}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Footer bar ── */}
      <div className="dr-footer-bar">

        {/* Calibration */}
        <div className="dr-footer-field dr-footer-cal">
          <label className="dr-label">
            Calibration Due Date / <span className="dr-label-hi">कैलिब्रेशन तारीख</span>
          </label>
          <div className="dr-input drec-meta-display" style={{ marginBottom: 8 }}>
            {record.calibration_due ? formatDate(record.calibration_due) : '—'}
          </div>

          <details className="dr-cal-details" open>
            <summary className="dr-cal-summary">
              Sensor Calibration Values / <span style={{ fontWeight: 400, fontSize: 11 }}>सेंसर कैलिब्रेशन मान</span>
            </summary>
            <table className="dr-cal-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Temperature / <span className="dr-hi">तापमान</span></th>
                  <th>Sensor Value / <span className="dr-hi">सेंसर मान</span></th>
                </tr>
              </thead>
              <tbody>
                {CAL_SENSORS.map(s => {
                  const sData = calSensors[s.key] || {}
                  return (
                    <tr key={s.key}>
                      <td className="dr-cal-label">{s.label}<br /><span className="dr-hi">{s.labelHi}</span></td>
                      <td><div className="dr-input dr-cal-input drec-meta-display">{sData.temp || '—'}</div></td>
                      <td><div className="dr-input dr-cal-input drec-meta-display">{sData.sensor || '—'}</div></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </details>
        </div>

        {/* Total Production */}
        <div className="dr-footer-field dr-footer-total">
          <label className="dr-label">
            Total Production of the Day (kg) / <span className="dr-label-hi">दिन का कुल उत्पादन</span>
          </label>
          <div className="dr-total-formula">
            <div className="dr-total-part">
              <span className="dr-total-part-label">Fine Powder (kg)</span>
              <div className="dr-total-input drec-total-display">{record.fine_powder ?? '0'}</div>
            </div>
            <span className="dr-total-op">+</span>
            <div className="dr-total-part">
              <span className="dr-total-part-label">Crust (Papadi) (kg)</span>
              <div className="dr-total-input drec-total-display">{record.crust_papadi ?? '0'}</div>
            </div>
            <span className="dr-total-op">+</span>
            <div className="dr-total-part">
              <span className="dr-total-part-label">Startup (kg)</span>
              <div className="dr-total-input drec-total-display">{record.startup ?? '0'}</div>
            </div>
            <span className="dr-total-op">+</span>
            <div className="dr-total-part">
              <span className="dr-total-part-label">Packed Production (kg)</span>
              <div className="dr-total-input drec-total-display">{record.packed_production ?? '0'}</div>
            </div>
            <span className="dr-total-op">=</span>
            <div className="dr-total-result">
              <span className="dr-total-result-label">Total</span>
              <span className="dr-total-result-value">
                {(parseFloat(totalProduction) || 0).toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        {/* Incharge */}
        <div className="dr-footer-field">
          <label className="dr-label">Incharge / <span className="dr-label-hi">इंचार्ज</span></label>
          <div className="dr-input drec-meta-display">{record.incharge || '—'}</div>
        </div>

        {/* Operator */}
        <div className="dr-footer-field">
          <label className="dr-label">Operator / <span className="dr-label-hi">ऑपरेटर</span></label>
          <div className="dr-input drec-meta-display">{record.operator || '—'}</div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// RecordCard — compact list card
// ─────────────────────────────────────────────────────────────
function RecordCard({ record, onClick }) {
  const dryerLabel = record.dryer_type === 'new' ? 'New Dryer' : 'Old Dryer'
  const rows = Array.isArray(record.log_rows) ? record.log_rows : []
  const filledHours = rows.filter(r => {
    if (!r) return false
    const skip = new Set(['timestamp','saved','__ts','__hist','__events','__last_saved_at','maintenance','operator_name'])
    return Object.keys(r).some(k => !skip.has(k) && (r[k] ?? '').toString().trim() !== '')
  }).length

  return (
    <button type="button" className="drec-card" onClick={() => onClick(record)}>
      <div className="drec-card-top">
        <span className="drec-card-dryer">{dryerLabel}</span>
        <span className="drec-card-date">{formatDate(record.date)}</span>
      </div>
      <div className="drec-card-meta">
        {record.operator && <span className="drec-card-chip">👤 {record.operator}</span>}
        {record.batch_no  && <span className="drec-card-chip">📋 {record.batch_no}</span>}
        {record.total_production != null && (
          <span className="drec-card-chip">⚖️ {record.total_production} kg</span>
        )}
        {filledHours > 0 && (
          <span className="drec-card-chip">{filledHours}/24 hrs</span>
        )}
      </div>
      <div className="drec-card-saved">Saved: {formatSavedAt(record.created_at)}</div>
    </button>
  )
}

// ─────────────────────────────────────────────────────────────
// DryerRecords — main component
// ─────────────────────────────────────────────────────────────
export default function DryerRecords() {
  const [records,      setRecords]      = useState([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState('')
  const [selected,     setSelected]     = useState(null)
  const [dryerFilter,  setDryerFilter]  = useState('all')
  const [dateFilter,   setDateFilter]   = useState('')
  const [page,         setPage]         = useState(0)

  const fetchRecords = useCallback(async () => {
    if (!supabaseReady || !supabase) {
      setError('Database not configured.')
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const { data, error: err } = await supabase
        .from('dryer_logs')
        .select('id, created_at, dryer_type, date, operator, incharge, batch_no, total_production, fine_powder, crust_papadi, startup, packed_production, id_blower_dp, id_blower_mr, fd_blower_dp, fd_blower_mr, chamber_dp, chamber_mr, fbd_pct_dp, fbd_pct_mr, calibration_due, calibration_sensors, log_rows')
        .order('created_at', { ascending: false })
        .limit(500)
      if (err) throw err
      setRecords(data || [])
    } catch (e) {
      setError(e.message || 'Failed to load records.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchRecords() }, [fetchRecords])

  const filtered = records.filter(r => {
    if (dryerFilter !== 'all' && r.dryer_type !== dryerFilter) return false
    if (dateFilter && (r.date || '') !== dateFilter) return false
    return true
  })

  const totalPages  = Math.ceil(filtered.length / PAGE_SIZE)
  const pageRecords = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  if (selected) {
    return <RecordDetail record={selected} onBack={() => setSelected(null)} />
  }

  return (
    <div className="drec-wrapper">

      {/* Dryer type filter */}
      <div className="drec-toolbar">
        <div className="drec-filter-bar">
          {[
            { key: 'all', label: 'All Dryers' },
            { key: 'new', label: 'New Dryer / नया ड्रायर' },
            { key: 'old', label: 'Old Dryer / पुराना ड्रायर' },
          ].map(f => (
            <button key={f.key} type="button"
              className={`drec-filter-btn ${dryerFilter === f.key ? 'drec-filter-active' : ''}`}
              onClick={() => { setDryerFilter(f.key); setPage(0) }}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Date filter */}
      <div className="drec-date-bar">
        <label className="drec-date-label">Filter by Date / तारीख:</label>
        <div className="drec-date-input-wrap">
          <input className="drec-date-input" type="date" value={dateFilter}
            onChange={e => { setDateFilter(e.target.value); setPage(0) }} />
          {dateFilter && (
            <button type="button" className="drec-date-clear"
              onClick={() => { setDateFilter(''); setPage(0) }}>✕ Clear</button>
          )}
        </div>
        {dateFilter && (
          <span className="drec-date-showing">Showing: {formatDate(dateFilter)}</span>
        )}
      </div>

      {!loading && !error && (
        <div className="drec-count">
          {filtered.length === 0 ? 'No records found'
            : `${filtered.length} record${filtered.length === 1 ? '' : 's'}`}
        </div>
      )}

      {loading && <div className="drec-msg">Loading records…</div>}
      {error && (
        <div className="drec-msg drec-msg-error">
          {error}
          <button className="drec-retry-btn" type="button" onClick={fetchRecords}>Retry</button>
        </div>
      )}

      {!loading && !error && (
        <>
          {pageRecords.length === 0
            ? <div className="drec-msg">No records match your filter.</div>
            : (
              <div className="drec-list">
                {pageRecords.map(r => (
                  <RecordCard key={r.id} record={r} onClick={setSelected} />
                ))}
              </div>
            )
          }
          {totalPages > 1 && (
            <div className="drec-pagination">
              <button type="button" className="drec-page-btn"
                disabled={page === 0} onClick={() => setPage(p => p - 1)}>‹ Prev</button>
              <span className="drec-page-label">Page {page + 1} of {totalPages}</span>
              <button type="button" className="drec-page-btn"
                disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next ›</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
