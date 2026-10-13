import React, { useState, useEffect, useRef, useCallback } from 'react'
import { supabase, supabaseReady } from '../supabaseClient'
import { formatDate } from '../utils/formatDate.js'
import './ProductionActivity.css'

// Chronological hour order, matching DryerSection TIME_SLOTS (08:00 → 07:00).
const TIME_SLOTS = [
  '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00',
  '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00', '23:00',
  '00:00', '01:00', '02:00', '03:00', '04:00', '05:00', '06:00', '07:00',
]

// Column definitions mirror the Dryer Operator hourly log table EXACTLY:
// two "Temperature Deg. Cent." groups (Inlet/Outlet/Actual and IFBD/FBD/Chamber),
// then the remaining columns in the same order, with the same bilingual labels.
const TEMP_GROUP_1 = [
  { key: 'temp_inlet',   label: 'Inlet',   hi: 'इनलेट' },
  { key: 'temp_outlet',  label: 'Outlet',  hi: 'आउटलेट' },
  { key: 'temp_actual',  label: 'Actual',  hi: 'वास्तविक' },
]
const TEMP_GROUP_2 = [
  { key: 'temp_fbd1',    label: 'IFBD' },
  { key: 'temp_fbd2',    label: 'FBD' },
  { key: 'temp_chamber', label: 'Chamber', hi: 'चैम्बर' },
]
const TEMP_COLUMNS = [...TEMP_GROUP_1, ...TEMP_GROUP_2]

const OTHER_COLUMNS = [
  { key: 'atomizer_freq', label: 'Atomizer Freq.',      hi: 'एटमाइज़र फ्रीक्वेंसी' },
  { key: 'feed_fc',       label: 'Feed F.C.',           hi: 'फीड एफ.सी.' },
  { key: 'pressure',      label: 'Feed Pressure',       hi: 'फीड दबाव' },
  { key: 'pt_temp',       label: 'Pt. Temp',            hi: 'पीटी. तापमान' },
  { key: 'batch_no',      label: 'Batch No.',           hi: 'बैच नं.' },
  { key: 'bags_per_hr',   label: 'No. of Bag Per Hours', hi: 'बैग प्रति घंटा' },
  { key: 'bag_size_wt',   label: 'Bag Size By Wt.',     hi: 'बैग का वजन' },
  { key: 'kg_per_hr',     label: 'Kg./Hour Production', hi: 'किग्रा/घंटा' },
  { key: 'colour',        label: 'Colour/Normal/OMRI',  hi: 'रंग/सामान्य' },
  { key: 'id_frequency',  label: 'I.D. Frequency',      hi: 'आईडी फ्रीक्वेंसी' },
  { key: 'remarks',       label: 'Remarks',             hi: 'टिप्पणी' },
  { key: 'timestamp',     label: 'Timestamp',           hi: 'समय टिकट' },
]

const DRYER_LABEL = { new: 'New Dryer', old: 'Old Dryer' }
const GRADE_LABEL = { normal: 'Normal', export: 'UPL Export', omri: 'UPL OMRI', colour: 'Colour' }
const EXPIRY_MS = 24 * 60 * 60 * 1000

function isActive(row) {
  if (!row?.last_saved_at) return false
  return Date.now() - new Date(row.last_saved_at).getTime() < EXPIRY_MS
}

function stamp12hr(d = new Date()) {
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
}

// Group non-expired rows by dryer_type → log_date, keeping each hour's
// latest values. Returns an array of { dryerType, date, hours }.
function groupRows(rows) {
  const groups = new Map()  // key: `${dryer_type}|${log_date}`
  rows.filter(isActive).forEach(r => {
    const key = `${r.dryer_type}|${r.log_date}`
    if (!groups.has(key)) {
      groups.set(key, { dryerType: r.dryer_type, date: r.log_date, hours: {} })
    }
    groups.get(key).hours[r.hour] = r.values || {}
  })

  return Array.from(groups.values()).sort((a, b) => {
    // Newest date first, then New before Old
    if (a.date !== b.date) return a.date < b.date ? 1 : -1
    return a.dryerType.localeCompare(b.dryerType)
  })
}

// Header: dryer label + date only (dd/mm/yy).
function groupHeader(g) {
  return [DRYER_LABEL[g.dryerType] || g.dryerType, formatDate(g.date)]
    .filter(Boolean)
    .join(' — ')
}

const cellVal = v => (v !== undefined && v !== null && v !== '' ? v : '—')

function ActivityTable({ group }) {
  // Only render hours that actually have a shared entry, in chronological order.
  const presentHours = TIME_SLOTS.filter(h => group.hours[h])
  if (!presentHours.length) {
    return <div className="pa-empty-hours">No hours shared yet. / अभी तक कोई घंटा साझा नहीं किया गया।</div>
  }
  return (
    <div className="pa-table-scroll">
      <table className="pa-table">
        <colgroup>
          <col className="pa-col-time" />
          {TEMP_COLUMNS.map(c => <col key={c.key} className="pa-col-temp" />)}
          {OTHER_COLUMNS.map(c => <col key={c.key} className="pa-col-other" />)}
        </colgroup>
        <thead>
          {/* Row 1 — grouped headers (mirrors the Dryer Operator table) */}
          <tr className="pa-head-r1">
            <th className="pa-th-time" rowSpan={2}>Time<br /><span className="pa-th-hi">समय</span></th>
            <th className="pa-th-group" colSpan={TEMP_GROUP_1.length}>
              Temperature Deg. Cent.<br /><span className="pa-th-hi">तापमान (°C)</span>
            </th>
            <th className="pa-th-group" colSpan={TEMP_GROUP_2.length}>
              Temperature Deg. Cent.<br /><span className="pa-th-hi">तापमान (°C)</span>
            </th>
            {OTHER_COLUMNS.map(c => (
              <th key={c.key} rowSpan={2}>
                {c.label}{c.hi ? <><br /><span className="pa-th-hi">{c.hi}</span></> : null}
              </th>
            ))}
          </tr>
          {/* Row 2 — temperature sub-columns */}
          <tr className="pa-head-r2">
            {TEMP_COLUMNS.map(c => (
              <th key={c.key} className="pa-th-sub">
                {c.label}{c.hi ? <><br /><span className="pa-th-hi">{c.hi}</span></> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {presentHours.map(h => {
            const v = group.hours[h] || {}
            return (
              <tr key={h}>
                <td className="pa-td-time">{h}</td>
                {TEMP_COLUMNS.map(c => <td key={c.key}>{cellVal(v[c.key])}</td>)}
                {OTHER_COLUMNS.map(c => <td key={c.key}>{cellVal(v[c.key])}</td>)}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function StatusTag({ status }) {
  if (status === 'PASS') return <span className="qc-upl-pass">Pass</span>
  if (status === 'FAIL') return <span className="qc-upl-fail">Fail</span>
  return <span className="qc-upl-na">—</span>
}

function SieveLogTable({ title, log }) {
  if (!log || !log.length) return null
  return (
    <div className="pa-qc-sieve">
      <div className="pa-qc-sieve-title">{title}</div>
      <div className="pa-table-scroll">
        <table className="pa-qc-sieve-table">
          <thead>
            <tr><th>#</th><th>Micron</th><th>Result</th><th>Status</th><th>Time</th></tr>
          </thead>
          <tbody>
            {log.map((e, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>{e.targetLabel || '—'}</td>
                <td>{e.result ?? '—'}</td>
                <td><StatusTag status={e.status} /></td>
                <td>{e.time || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Read-only Quality Control (Finished Goods) live card.
function QcCard({ row }) {
  const header = [
    'Quality Control — Finished Goods',
    row.dryer,
    GRADE_LABEL[row.grade] || row.grade,
    formatDate(row.log_date),
  ].filter(Boolean).join(' — ')

  const wet = row.wet_sieve_log || []
  const dry = row.dry_sieve_log || []

  return (
    <div className="pa-group pa-group-qc">
      <div className="pa-group-header">
        <span className="pa-group-title">
          <span className="pa-group-icon" aria-hidden="true">🧪</span>
          {header}
        </span>
        <span className="pa-24h-pill">🕐 Showing lasts upto 24 hours only</span>
      </div>

      <div className="pa-qc-body">
        <div className="pa-qc-fields">
          <div className="pa-qc-field"><span className="pa-qc-field-k">Batch No.</span><span className="pa-qc-field-v">{cellVal(row.batch_no)}</span></div>
          <div className="pa-qc-field"><span className="pa-qc-field-k">Dryer</span><span className="pa-qc-field-v">{cellVal(row.dryer)}</span></div>
          <div className="pa-qc-field"><span className="pa-qc-field-k">Product</span><span className="pa-qc-field-v">{cellVal(row.product)}</span></div>
          <div className="pa-qc-field"><span className="pa-qc-field-k">Moisture (%)</span><span className="pa-qc-field-v">{cellVal(row.moisture_pct)}</span></div>
          <div className="pa-qc-field"><span className="pa-qc-field-k">Suspensibility (%)</span><span className="pa-qc-field-v">{cellVal(row.suspensibility_pct)}</span></div>
        </div>

        {(wet.length > 0 || dry.length > 0) && (
          <div className="pa-qc-sieves">
            <SieveLogTable title="Dry Sieve — recorded" log={dry} />
            <SieveLogTable title="Wet Sieve — recorded" log={wet} />
          </div>
        )}
      </div>
    </div>
  )
}

export default function ProductionActivity() {
  const [rows, setRows] = useState([])
  const [qcRows, setQcRows] = useState([])   // qc_activity_draft (Finished Goods live feed)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState(null)
  // tick re-renders periodically so entries that cross the 24h line
  // drop out of the view even without a new Realtime event.
  const [, setTick] = useState(0)
  const channelRef = useRef(null)

  const fetchRows = useCallback(async () => {
    if (!supabaseReady || !supabase) {
      setError('Supabase not configured.')
      setLoading(false)
      return
    }
    const cutoff = new Date(Date.now() - EXPIRY_MS).toISOString()

    const [dryerRes, qcRes] = await Promise.all([
      supabase
        .from('dryer_hourly_draft')
        .select('dryer_type, log_date, hour, shift, values, operator, last_saved_at')
        .gt('last_saved_at', cutoff)
        .order('log_date', { ascending: false }),
      supabase
        .from('qc_activity_draft')
        .select('dryer, log_date, grade, product, batch_no, moisture_pct, suspensibility_pct, wet_sieve_log, dry_sieve_log, tested_by, last_saved_at')
        .gt('last_saved_at', cutoff)
        .order('log_date', { ascending: false }),
    ])

    if (dryerRes.error) {
      setError(dryerRes.error.message)
    } else {
      setError('')
      setRows(dryerRes.data || [])
      setLastUpdated(new Date())
    }
    // QC feed is optional — a missing table / error must not break the dryer view,
    // but log it so a missing migration 020 / RLS issue is diagnosable.
    if (qcRes.error) {
      console.warn('[QC Activity] fetch failed:', qcRes.error.message, qcRes.error)
    } else {
      setQcRows(qcRes.data || [])
    }
    setLoading(false)
  }, [])

  // Initial fetch, then subscribe to Realtime on BOTH tables; clean up on unmount.
  useEffect(() => {
    fetchRows()

    if (!supabaseReady || !supabase) return

    const channel = supabase
      .channel('production_activity')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'dryer_hourly_draft' },
        () => { fetchRows() }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'qc_activity_draft' },
        () => { fetchRows() }
      )
      .subscribe()
    channelRef.current = channel

    // Fallback refresh + expiry re-evaluation every 60s even if Realtime
    // is disabled for the project.
    const timer = setInterval(() => {
      setTick(t => t + 1)
      fetchRows()
    }, 60 * 1000)

    return () => {
      clearInterval(timer)
      if (channelRef.current) supabase.removeChannel(channelRef.current)
      channelRef.current = null
    }
  }, [fetchRows])

  const groups = groupRows(rows)
  const qcGroups = qcRows.filter(isActive)

  return (
    <div className="pa-wrapper">

      {/* ── Header bar ── */}
      <div className="pa-header">
        <div className="pa-header-left">
          <span className="pa-header-icon" aria-hidden="true">📊</span>
          <div>
            <div className="pa-title">Activity</div>
            <div className="pa-subtitle">
              Live hourly log from Dryer Operator — View only <span className="pa-subtitle-hi">| केवल पढ़ने के लिए</span>
            </div>
          </div>
        </div>

        <div className="pa-header-right">
          <div className="pa-live">
            <span className="pa-live-dot" aria-hidden="true" />
            <div className="pa-live-text">
              <div className="pa-live-title">Live Updates</div>
              <div className="pa-live-sub">
                {lastUpdated ? `Last updated: ${stamp12hr(lastUpdated)}` : 'Connecting…'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {loading && <div className="pa-status">Loading…</div>}
      {error && <div className="pa-error">Error: {error}</div>}

      {!loading && !error && groups.length === 0 && qcGroups.length === 0 && (
        <div className="pa-status">No active entries in the last 24 hours.</div>
      )}

      {groups.map(g => (
        <div key={`${g.dryerType}|${g.date}`} className={`pa-group pa-group-${g.dryerType}`}>
          <div className="pa-group-header">
            <span className="pa-group-title">
              <span className="pa-group-icon" aria-hidden="true"></span>
              {groupHeader(g)}
            </span>
            <span className="pa-24h-pill">🕐 Showing lasts upto 24 hours only</span>
          </div>
          <ActivityTable group={g} />
        </div>
      ))}

      {qcGroups.map(r => (
        <QcCard key={`${r.dryer}|${r.log_date}|${r.grade}`} row={r} />
      ))}
    </div>
  )
}
