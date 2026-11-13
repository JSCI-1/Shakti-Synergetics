// Slurry Operator Job Card
// Saves to: slurry_operator_job_cards
// Motor Amp Status saves to: slurry_operator_motor_amp

import React, { useState, useRef, useCallback, useEffect } from 'react'
import { supabase, supabaseReady } from '../supabaseClient'
import { useDraft, useUserId } from '../utils/useDraft.js'
import { useSharedDraft, deleteSharedDraft, fetchLatestSaved } from '../utils/useSharedDraft.js'
import SharedStatus from './SharedStatus.jsx'
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
  const now = new Date()
  const opts = {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: true, timeZone: 'Asia/Kolkata',
  }
  return now.toLocaleTimeString('en-US', opts).replace(/\s?(am|pm)/i, m => ' ' + m.trim().toUpperCase())
}

// Convert ISO date string (yyyy-mm-dd) → display string (dd/mm/yyyy)
function isoToDMY(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  return `${d}/${m}/${y}`
}

// Convert dd/mm/yyyy typed string → ISO yyyy-mm-dd (returns '' if incomplete)
function dmyToISO(dmy) {
  const parts = dmy.replace(/[^\d/]/g, '').split('/')
  if (parts.length !== 3) return ''
  const [d, m, y] = parts
  if (d.length !== 2 || m.length !== 2 || y.length !== 4) return ''
  const iso = `${y}-${m}-${d}`
  return isNaN(Date.parse(iso)) ? '' : iso
}

/**
 * DateInput — shows dd/mm/yyyy text, opens native date picker on click/icon.
 * `value` must be yyyy-mm-dd ISO string; `onChange` receives yyyy-mm-dd.
 */
function DateInput({ value, onChange, className }) {
  const hiddenRef = useRef(null)
  const [text, setText] = useState(isoToDMY(value))

  useEffect(() => {
    setText(isoToDMY(value))
  }, [value])

  function handleTextChange(e) {
    const raw = e.target.value
    setText(raw)
    const iso = dmyToISO(raw)
    if (iso) onChange(iso)
  }

  function handleTextBlur(e) {
    const iso = dmyToISO(e.target.value)
    if (iso) {
      setText(isoToDMY(iso))
      onChange(iso)
    } else if (e.target.value === '') {
      setText('')
      onChange('')
    } else {
      setText(isoToDMY(value))
    }
  }

  function handleNativePick(e) {
    const iso = e.target.value
    if (iso) {
      setText(isoToDMY(iso))
      onChange(iso)
    }
  }

  return (
    <div className="so-date-wrap">
      <input
        type="text"
        className={className}
        placeholder="dd/mm/yyyy"
        value={text}
        maxLength={10}
        onChange={handleTextChange}
        onBlur={handleTextBlur}
      />
      <input
        ref={hiddenRef}
        type="date"
        className="so-date-hidden"
        value={value || ''}
        onChange={handleNativePick}
        tabIndex={-1}
        aria-hidden="true"
      />
      <button
        type="button"
        className="so-date-icon-btn"
        onClick={() => hiddenRef.current?.showPicker?.()}
        tabIndex={-1}
        aria-label="Pick date"
      >
        📅
      </button>
    </div>
  )
}

function emptyMillRow(mill) {
  return { mill, flow_rates: [{ value: '', timestamp: '' }], current_amp: '', zirconia_beads: '', remarks: '' }
}

function emptyMotorEntry() {
  return { amp: '', stop: '', timestamp: '' }
}

function emptyForm() {
  return {
    date: '', shift: '', operator_name: '',
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

  const uid = useUserId()

  // ── State ──
  const [form,   setForm,   clearFormDraft] = useDraft(`draft:${uid}:slurryop:form`,  emptyForm())
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  const [motorOpen,   setMotorOpen]   = useState(false)
  const [motorForm,   setMotorForm,   clearMotorDraft] = useDraft(`draft:${uid}:slurryop:motor`, emptyMotorForm())
  const [motorSaving, setMotorSaving] = useState(false)
  const [motorError,  setMotorError]  = useState('')

  // ── Timestamp stores (invisible — captured silently, sent to sheet) ──
  const [millFlowTs,  setMillFlowTs,  clearMillFlowTs]  = useDraft(`draft:${uid}:slurryop:millts`,    {})
  const [millAmpTs,   setMillAmpTs,   clearMillAmpTs]   = useDraft(`draft:${uid}:slurryop:millamps`,  {})
  const [millBeadsTs, setMillBeadsTs, clearMillBeadsTs] = useDraft(`draft:${uid}:slurryop:millbeads`, {})
  const [motorAmpTs,  setMotorAmpTs,  clearMotorAmpTs]  = useDraft(`draft:${uid}:slurryop:motoramps`, {})
  const [motorStopTs, setMotorStopTs, clearMotorStopTs] = useDraft(`draft:${uid}:slurryop:motorstops`,{})
  const [motorRowTs,  setMotorRowTs,  clearMotorRowTs]  = useDraft(`draft:${uid}:slurryop:motorts`,   {})

  // Toast / error popup
  const [toast,    setToast]    = useState(null)
  const [errPopup, setErrPopup] = useState(null)

  // Debounce timers
  const millFlowTimers  = useRef({})
  const millFlowSeq     = useRef({})
  const millAmpTimers   = useRef({})
  const millBeadsTimers = useRef({})
  const motorAmpTimers  = useRef({})
  const motorStopTimers = useRef({})
  const motorRowTimers  = useRef({})
  const motorRowSeq     = useRef({})

  // ── Auto-fill operator name from logged-in user ──
  useEffect(() => {
    try {
      const profile = JSON.parse(localStorage.getItem('jsci_user') || '{}')
      if (profile?.name) {
        setForm(p => p.operator_name ? p : { ...p, operator_name: profile.name })
        setMotorForm(p => p.checked_by ? p : { ...p, checked_by: profile.name })
      }
    } catch { /* silent */ }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Shared drafts: other Slurry Operators see what was entered ──
  // Sand-milling card is keyed by form.date; motor status by motorForm.running_date.
  // Each shared row is deleted when its permanent record is saved.
  const millsBlob = {
    meta: { supervisor: form.supervisor, manager: form.manager },
    mills: form.mills.map((m, mi) => ({
      mill: m.mill,
      current_amp:       m.current_amp,
      current_amp_ts:    millAmpTs[mi]   || '',
      zirconia_beads:    m.zirconia_beads,
      zirconia_beads_ts: millBeadsTs[mi] || '',
      remarks:           m.remarks,
      flow_rates: m.flow_rates.map((f, fi) => ({
        value:     f.value,
        timestamp: millFlowTs[`${mi}_${fi}`] || f.timestamp || '',
      })),
    })),
  }

  function applyMillsBlob(m) {
    if (!m || !Array.isArray(m.mills)) return
    const flowTs = {}, ampTs = {}, beadsTs = {}
    m.mills.forEach((r, mi) => {
      if (r.current_amp_ts)    ampTs[mi]   = r.current_amp_ts
      if (r.zirconia_beads_ts) beadsTs[mi] = r.zirconia_beads_ts
      ;(r.flow_rates || []).forEach((f, fi) => { if (f.timestamp) flowTs[`${mi}_${fi}`] = f.timestamp })
    })
    setMillFlowTs(p => ({ ...p, ...flowTs }))
    setMillAmpTs(p => ({ ...p, ...ampTs }))
    setMillBeadsTs(p => ({ ...p, ...beadsTs }))
    setForm(p => ({
      ...p,
      ...(m.meta || {}),
      mills: p.mills.map((cur, mi) => {
        const r = m.mills[mi]
        if (!r) return cur
        return {
          ...cur,
          current_amp:    r.current_amp    ?? '',
          zirconia_beads: r.zirconia_beads ?? '',
          remarks:        r.remarks        ?? '',
          flow_rates: Array.isArray(r.flow_rates) && r.flow_rates.length > 0
            ? r.flow_rates.map(f => ({ value: f.value ?? '', timestamp: f.timestamp || '' }))
            : cur.flow_rates,
        }
      }),
    }))
  }

  const millsShared = useSharedDraft({
    section: 'slurry_mills',
    date: form.date,
    blob: millsBlob,
    hasData: b => !!(b.meta?.supervisor || b.meta?.manager) || b.mills.some(r =>
      r.current_amp || r.zirconia_beads || r.remarks || r.flow_rates.some(f => f.value)
    ),
    apply: applyMillsBlob,
    // Admin picks a date with no live draft → show the latest saved card for it
    loadSaved: async date => {
      const row = await fetchLatestSaved('slurry_operator_job_cards', 'date', date)
      if (!row || !Array.isArray(row.mills)) return null
      return {
        meta: { supervisor: row.supervisor || '', manager: row.manager || '' },
        mills: row.mills.map(m => ({
          mill:              m.mill,
          current_amp:       m.current_amp    ?? '',
          current_amp_ts:    m.current_amp_ts || '',
          zirconia_beads:    m.zirconia_beads ?? '',
          zirconia_beads_ts: m.zirconia_beads_ts || '',
          remarks:           m.remarks        ?? '',
          flow_rates: (m.flow_rates && m.flow_rates.length ? m.flow_rates : [{ value: '', timestamp: '' }])
            .map(f => ({ value: f.value ?? '', timestamp: f.timestamp || '' })),
        })),
      }
    },
    // Date changed: empty the card (keep date, shift, own name) so the new
    // date's shared values load instead of the previous date's being copied.
    onDateSwitch: () => {
      setForm(p => ({ ...emptyForm(), date: p.date, shift: p.shift, operator_name: p.operator_name }))
      clearMillFlowTs(); clearMillAmpTs(); clearMillBeadsTs()
    },
    onRemoteCleared: () => {
      // The sand-milling card for this date was saved by another operator.
      clearFormDraft(); clearMillFlowTs(); clearMillAmpTs(); clearMillBeadsTs()
    },
  })

  const motorBlob = {
    remark: motorForm.remark,
    motors: motorForm.motors.map((m, mi) => ({
      amp:       m.amp,
      stop:      m.stop,
      timestamp: motorRowTs[mi] || m.timestamp || '',
      amp_ts:    motorAmpTs[mi]  || '',
      stop_ts:   motorStopTs[mi] || '',
    })),
  }

  function applyMotorBlob(m) {
    if (!m || !Array.isArray(m.motors)) return
    const rowTs = {}, ampTs = {}, stopTs = {}
    m.motors.forEach((r, mi) => {
      if (r.timestamp) rowTs[mi]  = r.timestamp
      if (r.amp_ts)    ampTs[mi]  = r.amp_ts
      if (r.stop_ts)   stopTs[mi] = r.stop_ts
    })
    setMotorRowTs(p => ({ ...p, ...rowTs }))
    setMotorAmpTs(p => ({ ...p, ...ampTs }))
    setMotorStopTs(p => ({ ...p, ...stopTs }))
    setMotorForm(p => ({
      ...p,
      remark: m.remark ?? '',
      motors: p.motors.map((cur, mi) => {
        const r = m.motors[mi]
        return r ? { ...cur, amp: r.amp ?? '', stop: r.stop ?? '', timestamp: r.timestamp || '' } : cur
      }),
    }))
  }

  const motorShared = useSharedDraft({
    section: 'slurry_motor',
    date: motorForm.running_date,
    blob: motorBlob,
    hasData: b => !!b.remark || b.motors.some(r => r.amp || r.stop),
    apply: applyMotorBlob,
    // Admin picks a running date with no live draft → show the latest saved status
    loadSaved: async date => {
      const row = await fetchLatestSaved('slurry_operator_motor_amp', 'running_date', date)
      if (!row || !Array.isArray(row.motor_data)) return null
      return {
        remark: row.remark || '',
        motors: row.motor_data.map(m => ({
          amp:       m.amp   ?? '',
          stop:      m.stop  ?? '',
          timestamp: m.timestamp || '',
          amp_ts:    m.amp_ts    || '',
          stop_ts:   m.stop_ts   || '',
        })),
      }
    },
    // Running date changed: empty the readings (keep date and Checked By).
    onDateSwitch: () => {
      setMotorForm(p => ({ ...emptyMotorForm(), running_date: p.running_date, checked_by: p.checked_by }))
      clearMotorAmpTs(); clearMotorStopTs(); clearMotorRowTs()
    },
    onRemoteCleared: () => {
      // The motor status for this date was saved by another operator.
      clearMotorDraft(); clearMotorAmpTs(); clearMotorStopTs(); clearMotorRowTs()
    },
  })

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
    setMillFlowTs(p => { const n = { ...p }; delete n[`${mi}_${fi}`]; return n })
  }

  // ── Auto-stamp: flow rate — stamps once on first entry ──
  const stampMillFlow = useCallback((mi, fi) => {
    const seqKey = `${mi}_${fi}`
    millFlowSeq.current[seqKey] = (millFlowSeq.current[seqKey] || 0) + 1
    const mySeq = millFlowSeq.current[seqKey]
    setMillFlowTs(prev => {
      if (millFlowSeq.current[seqKey] !== mySeq) return prev
      if (prev[seqKey]) return prev
      return { ...prev, [seqKey]: stamp12hr() }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const scheduleMillFlowStamp = useCallback((mi, fi, val) => {
    const key = `${mi}_${fi}`
    clearTimeout(millFlowTimers.current[key])
    if (val === '' || val === null) return
    millFlowTimers.current[key] = setTimeout(() => stampMillFlow(mi, fi), 1000)
  }, [stampMillFlow])

  // ── Auto-stamp: current amp — re-stamps on every change ──
  const scheduleMillAmpStamp = useCallback((mi, val) => {
    clearTimeout(millAmpTimers.current[mi])
    if (val === '' || val === null) return
    millAmpTimers.current[mi] = setTimeout(() => {
      const ts = stamp12hr()
      setMillAmpTs(prev => ({ ...prev, [mi]: ts }))
    }, 1000)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-stamp: zirconia beads — re-stamps on every change ──
  const scheduleMillBeadsStamp = useCallback((mi, val) => {
    clearTimeout(millBeadsTimers.current[mi])
    if (val === '' || val === null) return
    millBeadsTimers.current[mi] = setTimeout(() => {
      const ts = stamp12hr()
      setMillBeadsTs(prev => ({ ...prev, [mi]: ts }))
    }, 1000)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Motor cell handler — stamps amp and stop independently,
  //    and auto-stamps the row timestamp when BOTH are filled ──
  function handleMotorCell(mi, field, val) {
    const nextMotors = motorForm.motors.map((m, i) =>
      i === mi ? { ...m, [field]: val } : m
    )
    setMotorForm({ ...motorForm, motors: nextMotors })

    // Per-field silent timestamps (for sheet)
    if (field === 'amp') {
      clearTimeout(motorAmpTimers.current[mi])
      if (val !== '' && val !== null) {
        motorAmpTimers.current[mi] = setTimeout(() => {
          const ts = stamp12hr()
          setMotorAmpTs(prev => ({ ...prev, [mi]: ts }))
        }, 1000)
      }
    } else if (field === 'stop') {
      clearTimeout(motorStopTimers.current[mi])
      if (val !== '' && val !== null) {
        motorStopTimers.current[mi] = setTimeout(() => {
          const ts = stamp12hr()
          setMotorStopTs(prev => ({ ...prev, [mi]: ts }))
        }, 1000)
      }
    }

    // Row timestamp — stamps once when BOTH amp and stop are filled
    const updated = nextMotors[mi]
    const ampVal  = field === 'amp'  ? val : updated.amp
    const stopVal = field === 'stop' ? val : updated.stop
    if (ampVal && stopVal) {
      clearTimeout(motorRowTimers.current[mi])
      motorRowTimers.current[mi] = setTimeout(() => {
        motorRowSeq.current[mi] = (motorRowSeq.current[mi] || 0) + 1
        const mySeq = motorRowSeq.current[mi]
        setMotorRowTs(prev => {
          if (motorRowSeq.current[mi] !== mySeq) return prev
          if (prev[mi]) return prev   // keep original entry time
          return { ...prev, [mi]: stamp12hr() }
        })
      }, 1000)
    }
  }

  // ── Toast / error popup ──
  function showToast(type) {
    if (type === 'success') {
      setToast({ msg: '✓ Data saved successfully / डेटा सफलतापूर्वक सहेजा गया', type: 'success' })
      setTimeout(() => setToast(null), 3000)
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
    setSaving(true); setError('')
    const submittedDate = form.date

    // Merge timestamps into mills before saving
    const millsWithTs = form.mills.map((m, mi) => ({
      ...m,
      flow_rates: m.flow_rates.map((f, fi) => ({
        ...f,
        timestamp: millFlowTs[`${mi}_${fi}`] || f.timestamp,
      })),
      current_amp_ts:    millAmpTs[mi]   || '',
      zirconia_beads_ts: millBeadsTs[mi] || '',
    }))

    const { error: err } = await supabase
      .from('slurry_operator_job_cards')
      .insert([{
        date:          form.date || null,
        shift:         form.shift,
        operator_name: form.operator_name,
        mills:         millsWithTs,
        operator:      form.operator,
        supervisor:    form.supervisor,
        manager:       form.manager,
      }])

    setSaving(false)
    if (err) {
      setError(err.message)
      showErrorPopup(err.message)
    } else {
      showToast('success')
      millsShared.suppress()
      deleteSharedDraft('slurry_mills', submittedDate)
      clearFormDraft()
      clearMillFlowTs()
      clearMillAmpTs()
      clearMillBeadsTs()
    }
  }

  // ── Motor form submit ──
  async function handleMotorSubmit(e) {
    e.preventDefault()
    if (!supabaseReady) { setMotorError('Supabase not configured.'); return }
    setMotorSaving(true); setMotorError('')
    const submittedRunningDate = motorForm.running_date

    const motorsWithTs = motorForm.motors.map((m, mi) => ({
      ...m,
      timestamp: motorRowTs[mi]  || m.timestamp || '',
      amp_ts:    motorAmpTs[mi]  || '',
      stop_ts:   motorStopTs[mi] || '',
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
      showToast('success')
      motorShared.suppress()
      deleteSharedDraft('slurry_motor', submittedRunningDate)
      clearMotorDraft()
      clearMotorAmpTs()
      clearMotorStopTs()
      clearMotorRowTs()
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
            <DateInput className="so-input" value={form.date} onChange={v => set('date', v)} />
          </div>
          <div className="so-meta-field">
            <label className="so-label">Shift / <span className="so-label-hi">पाली</span></label>
            <select className="so-input" value={form.shift} onChange={e => set('shift', e.target.value)}>
              <option value="">— Select Shift —</option>
              <option value="Day">Day / दिन</option>
              <option value="Night">Night / रात</option>
            </select>
          </div>
          <div className="so-meta-field">
            <label className="so-label">Operator Name / <span className="so-label-hi">ऑपरेटर नाम</span></label>
            <input
              className="so-input"
              placeholder="Operator name"
              value={form.operator_name}
              onChange={e => set('operator_name', e.target.value)}
              style={{ background: '#f5f0ea' }}
            />
          </div>
        </div>

        <SharedStatus date={form.date} syncInfo={millsShared.syncInfo} />

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
                      const ts = millFlowTs[`${mi}_${fi}`] || flow.timestamp
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
                                scheduleMillFlowStamp(mi, fi, val)
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
                      value={mill.current_amp}
                      onChange={e => {
                        setMill(mi, 'current_amp', e.target.value)
                        scheduleMillAmpStamp(mi, e.target.value)
                      }} />
                  </td>
                  <td>
                    <input type="number" className="so-input-num-wide" placeholder="—"
                      value={mill.zirconia_beads}
                      onChange={e => {
                        setMill(mi, 'zirconia_beads', e.target.value)
                        scheduleMillBeadsStamp(mi, e.target.value)
                      }} />
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
          <button type="submit" className="so-save-btn" disabled={saving}>
            {saving ? 'Saving…' : 'Save Job Card / जॉब कार्ड सहेजें'}
          </button>
          <button type="button" className="so-reset-btn"
            onClick={() => { clearFormDraft(); clearMillFlowTs(); clearMillAmpTs(); clearMillBeadsTs(); setError('') }}>
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
                <DateInput className="so-input" value={motorForm.running_date}
                  onChange={v => setMotorForm(p => ({ ...p, running_date: v }))} />
              </div>
              <div className="so-motor-meta-field">
                <label className="so-label">Checked By / <span className="so-label-hi">जाँच की गई</span></label>
                <input className="so-input" placeholder="Name" value={motorForm.checked_by}
                  onChange={e => setMotorForm(p => ({ ...p, checked_by: e.target.value }))}
                  style={{ background: '#f5f0ea' }} />
              </div>
            </div>

            <SharedStatus date={motorForm.running_date} syncInfo={motorShared.syncInfo} />

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
                    const ts    = motorRowTs[mi] || entry.timestamp
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
              <button type="submit" className="so-save-btn" disabled={motorSaving}>
                {motorSaving ? 'Saving…' : 'Save Motor Status / मोटर स्थिति सहेजें'}
              </button>
              <button type="button" className="so-reset-btn"
                onClick={() => { clearMotorDraft(); clearMotorAmpTs(); clearMotorStopTs(); clearMotorRowTs(); setMotorError('') }}>
                Reset / रीसेट
              </button>
            </div>

          </form>
        )}
      </div>

    </div>
  )
}
