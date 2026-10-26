import React, { useState, useMemo } from 'react'
import { supabase, supabaseReady } from '../supabaseClient'
import { useDraft, useUserId } from '../utils/useDraft.js'
import './ThermpackJobCard.css'

function Label({ en, hi, required }) {
  return (
    <label className="bi-label">
      <span className="bi-en">
        {en}
        {required && <span className="req"> *</span>}
      </span>
      <span className="bi-hi">
        {hi}
        {required && <span className="req"> *</span>}
      </span>
    </label>
  )
}

const TIME_SLOTS = [
  '7:30', '8:30', '9:30', '10:30', '11:30', '12:30',
  '13:30', '14:30', '15:30', '16:30', '17:30', '18:30',
  '19:30', '20:30', '21:30', '22:30', '23:30', '0:30',
  '1:30', '2:30', '3:30', '4:30', '5:30', '6:30',
]

const LOG_FIELDS_10L = [
  'temp_in',
  'temp_out',
  'oil_press_in',
  'oil_press_out',
  'oil_press_level',
  'temp_exhaust',
  'feed_freq',
  'bed_clean_start',
  'bed_clean_stop',
  'ash_clinker_wt',
  'coil_clean_time',
]

const LOG_FIELDS_6L = [
  'temp_in',
  'temp_out',
  'oil_press_in',
  'oil_press_out',
  'oil_press_level',
  'temp_exhaust',
  'feed_freq',
  'bed_clean_start',
  'bed_clean_stop',
  'ash_clinker_wt',
  'coil_clean_time',
]

// Both variants share the same fields — just labelled differently
const LOG_FIELDS = LOG_FIELDS_10L

const MOTORS = [
  { id: 1, name: 'ID Blower', hp: 15 },
  { id: 2, name: 'FD Blower', hp: 10 },
  { id: 3, name: 'Circulation Pump (Old)', hp: 15 },
  { id: 4, name: 'Compressor', hp: 20 },
  { id: 5, name: 'Jockey Pump', hp: 10 },
  { id: 6, name: 'Circulation Pump (New)', hp: 7.5 },
]

function emptyRow() {
  return {
    ...Object.fromEntries(LOG_FIELDS_10L.map(f => [f, ''])),
    // Per-field entry/update timestamps for THIS hourly row (ISO), keyed by
    // field name. Populated as the operator types each cell.
    field_ts: {},
    timestamp: '',
    operator: '',
    saved: false,
  }
}

function emptyMotorEntry() {
  return {
    val: '',
    stop: '',
    timestamp: '',
    saved: false,
  }
}

// hh:mm:ss AM/PM in IST (display only — the authoritative save moment is the
// server-side saved_at / created_at captured by Supabase on the actual save).
function stamp12hr() {
  return new Date().toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
    timeZone: 'Asia/Kolkata',
  })
}

// Name of the currently logged-in user (set at login in LoginPage.jsx as
// localStorage 'jsci_user' = { id, name, role, ... }). Used to auto-fill the
// Operator column of each saved hourly log row.
function loggedInUserName() {
  try {
    const raw = localStorage.getItem('jsci_user')
    if (!raw) return ''
    const u = JSON.parse(raw)
    return (u && u.name) ? String(u.name) : ''
  } catch {
    return ''
  }
}

// Update a per-field timestamp map immutably:
//   • value changed to non-empty  → set this field's time to NOW (entry/update)
//   • value unchanged             → keep the existing time (preserve original)
//   • value cleared to empty       → remove this field's time
// Returns the same object reference when nothing changes (cheap no-op).
function stampFieldTs(tsMap, key, oldVal, newVal) {
  const prev = tsMap || {}
  const oldStr = oldVal === undefined || oldVal === null ? '' : String(oldVal)
  const newStr = newVal === undefined || newVal === null ? '' : String(newVal)
  if (oldStr === newStr) return prev   // no value change → keep original time
  const next = { ...prev }
  if (newStr.trim() === '') {
    delete next[key]                   // emptied → no timestamp
  } else {
    next[key] = new Date().toISOString()
  }
  return next
}

// Header fields that are shared across operators for shift handover (the whole
// job card header except the hourly tables and the draft bookkeeping keys).
const HEADER_SHARE_KEYS = [
  'shift', 'operator', 'helper1', 'helper2', 'helper3', 'time_in', 'time_out',
  'coal_date', 'coal_qty', 'bugass_date', 'bugass_qty',
  'coal_charged', 'bugass_charged', 'diesel_charged', 'remarks',
]

// Build the shared-header blob from the current form state.
function buildHeaderBlob(form) {
  const blob = {}
  HEADER_SHARE_KEYS.forEach(k => { blob[k] = form[k] ?? '' })
  blob.summary_10l = form.summary_10l || {}
  blob.summary_6l = form.summary_6l || {}
  blob.field_ts = form.field_ts || {}
  return blob
}

// Does the header have ANY non-empty field worth sharing?
function headerHasData(form) {
  if (HEADER_SHARE_KEYS.some(k => String(form[k] ?? '').trim() !== '')) return true
  const anySummary = (s) => s && Object.values(s).some(v => String(v ?? '').trim() !== '')
  return anySummary(form.summary_10l) || anySummary(form.summary_6l)
}

// Build the shared motor-form blob (what gets handed over between operators).
function buildMotorBlob(mf) {
  return {
    checked_by: mf.checked_by ?? '',
    remark: mf.remark ?? '',
    motors_10l: mf.motors_10l || [],
    motors_6l: mf.motors_6l || [],
  }
}

// Does the motor form have ANY entered value worth sharing?
function motorHasData(mf) {
  if (String(mf.checked_by ?? '').trim() !== '' || String(mf.remark ?? '').trim() !== '') return true
  const anyRow = (arr) => (arr || []).some(m =>
    m && (String(m.val ?? '').trim() !== '' || String(m.stop ?? '').trim() !== ''))
  return anyRow(mf.motors_10l) || anyRow(mf.motors_6l)
}

// Stable per-fill draft key so each per-row hourly Save for THIS job card
// groups together and can be associated with the job card id at submit time.
function newDraftKey() {
  const rnd = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `tjc-${rnd}`
}

function emptyForm() {
  return {
    // Stable grouping key for per-row hourly saves of THIS job card fill.
    draft_key: newDraftKey(),

    // Per-field entry/update timestamps (ISO). Keyed by the same field keys the
    // sheet uses: top-level keys, plus flattened summary keys '10l.<sub>' /
    // '6l.<sub>'. A field's time is set the first time it gets a non-empty
    // value and refreshed whenever its value changes; cleared if emptied.
    field_ts: {},

    date: '',
    shift: '',
    operator: '',
    helper1: '',
    helper2: '',
    helper3: '',
    time_in: '',
    time_out: '',

    coal_date: '',
    coal_qty: '',

    bugass_date: '',
    bugass_qty: '',

    coal_charged: '',
    bugass_charged: '',
    diesel_charged: '',

    log_variant: '10L',

    // Summary fields — separate per variant
    summary_10l: {
      outlet_set_temp: '',
      expansion_tank_level: '',
      type_of_fuel: '',
      qty_fuel_used: '',
      date_of_last_boiler_cleaning: '',
      total_running_hrs: '',
      consumption_per_hr: '',
      total_consumption: '',
      dryer_in_use: '',
    },
    summary_6l: {
      outlet_set_temp: '',
      expansion_tank_level: '',
      type_of_fuel: '',
      qty_fuel_used: '',
      date_of_last_boiler_cleaning: '',
      total_running_hrs: '',
      consumption_per_hr: '',
      total_consumption: '',
      dryer_in_use: '',
    },

    rows_10l: TIME_SLOTS.map(() => emptyRow()),
    rows_6l:  TIME_SLOTS.map(() => emptyRow()),

    remarks: '',
  }
}

function emptyMotorForm() {
  const today = new Date().toISOString().slice(0, 10)
  return {
    running_date: today,
    checked_by: '',
    remark: '',
    motor_variant: '10L',
    motors_10l: MOTORS.map(() => emptyMotorEntry()),
    motors_6l:  MOTORS.map(() => emptyMotorEntry()),
  }
}

export default function ThermpackJobCard() {
  const uid = useUserId()
  const [form,      setForm,      clearFormDraft]  = useDraft(`draft:${uid}:thermopack:form`,  emptyForm())
  const [motorForm, setMotorForm, clearMotorDraft] = useDraft(`draft:${uid}:thermopack:motor`, emptyMotorForm())
  const [motorOpen, setMotorOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savingRow, setSavingRow] = useState('')   // "<variant>:<rowIndex>" while a row saves
  const [submittedJobCardId, setSubmittedJobCardId] = useState(null)   // set after first save
  const [savedMain, setSavedMain] = useState(false)
  const [savedMotor, setSavedMotor] = useState(false)
  const [error, setError] = useState('')

  // A restored older draft may lack draft_key — ensure one exists so per-row
  // hourly saves can group and later associate with the job card.
  React.useEffect(() => {
    if (!form.draft_key) {
      setForm(prev => (prev.draft_key ? prev : { ...prev, draft_key: newDraftKey() }))
    }
    // Default the job card Operator field to the logged-in user's name.
    const name = loggedInUserName()
    if (name) {
      setForm(prev => (prev.operator ? prev : { ...prev, operator: name }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-dismiss the "Saved" confirmations after a few seconds so they don't
  // linger on screen.
  React.useEffect(() => {
    if (!savedMain) return
    const t = setTimeout(() => setSavedMain(false), 4000)
    return () => clearTimeout(t)
  }, [savedMain])

  React.useEffect(() => {
    if (!savedMotor) return
    const t = setTimeout(() => setSavedMotor(false), 4000)
    return () => clearTimeout(t)
  }, [savedMotor])

  // Running Date defaults to today (emptyMotorForm), but the operator can now
  // pick any date. A restored draft keeps whatever date was selected.

  // ── Shift handover: auto-save the header to a SHARED draft ──────────
  // So the next operator sees the header even if operator 1 never clicked Save
  // Job Card. UPSERTS the header blob keyed by (log_date, variant). Fires when
  // operator 1 saves an hourly row and (debounced) when header fields change.
  const saveHeaderDraft = React.useRef(null)
  saveHeaderDraft.current = async () => {
    if (!supabaseReady || !supabase) return
    if (!form.date) return                 // need a date to key the shared draft
    if (!headerHasData(form)) return       // nothing worth sharing yet
    try {
      await supabase
        .from('thermopack_jobcard_draft')
        .upsert(
          {
            log_date: form.date,
            variant: form.log_variant,
            header: buildHeaderBlob(form),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'log_date,variant' }
        )
    } catch {
      // Non-fatal — the local draft still holds the data.
    }
  }

  // Debounced auto-save of the shared header whenever header fields change.
  React.useEffect(() => {
    if (!supabaseReady || !supabase) return
    if (!form.date) return
    const t = setTimeout(() => saveHeaderDraft.current(), 1200)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    form.date, form.log_variant, form.shift, form.operator,
    form.helper1, form.helper2, form.helper3, form.time_in, form.time_out,
    form.coal_date, form.coal_qty, form.bugass_date, form.bugass_qty,
    form.coal_charged, form.bugass_charged, form.diesel_charged, form.remarks,
    form.summary_10l, form.summary_6l,
  ])

  // ── Shift handover: prefill the job-card HEADER from a saved card ──
  // When operator 2 (next shift) selects the SAME date as a job card operator 1
  // already saved, show everything operator 1 filled (operator, helpers, time
  // in/out, stock, fuel, summary, remarks). Reads the most recent saved
  // thermopack_job_cards row for that date and fills ONLY fields the current
  // operator has left empty — never overwriting what operator 2 is typing.
  const prefillHeader = React.useRef(null)
  prefillHeader.current = async () => {
    if (!supabaseReady || !supabase) return
    if (!form.date) return

    // 1. Prefer the SHARED working draft (live, even before Save Job Card),
    //    keyed by (date, variant). 2. Fall back to the most recent saved job
    //    card for the date. Whichever is found provides `card` (same field set).
    let card = null
    try {
      const d = await supabase
        .from('thermopack_jobcard_draft')
        .select('header')
        .eq('log_date', form.date)
        .eq('variant', form.log_variant)
        .maybeSingle()
      if (!d.error && d.data && d.data.header && typeof d.data.header === 'object') {
        card = d.data.header
      }
    } catch { /* ignore, try the saved card */ }

    if (!card) {
      try {
        const res = await supabase
          .from('thermopack_job_cards')
          .select('shift, operator, helper1, helper2, helper3, time_in, time_out, '
            + 'coal_date, coal_qty, bugass_date, bugass_qty, '
            + 'coal_charged, bugass_charged, diesel_charged, '
            + 'summary_10l, summary_6l, remarks, field_ts, created_at')
          .eq('date', form.date)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (res.error) return
        card = res.data
      } catch {
        return
      }
    }
    if (!card) return

    // Fill only EMPTY scalar header fields from the saved card.
    const scalarKeys = [
      'shift', 'operator', 'helper1', 'helper2', 'helper3', 'time_in', 'time_out',
      'coal_date', 'coal_qty', 'bugass_date', 'bugass_qty',
      'coal_charged', 'bugass_charged', 'diesel_charged', 'remarks',
    ]
    setForm(prev => {
      let changed = false
      const next = { ...prev }

      scalarKeys.forEach(k => {
        const cur = String(prev[k] ?? '').trim()
        const saved = card[k]
        if (cur === '' && saved !== null && saved !== undefined && String(saved) !== '') {
          next[k] = saved
          changed = true
        }
      })

      // Summary objects (10L / 6L): fill only sub-fields the operator left empty.
      ;['summary_10l', 'summary_6l'].forEach(sk => {
        const savedSummary = card[sk]
        if (!savedSummary || typeof savedSummary !== 'object') return
        const merged = { ...prev[sk] }
        let summaryChanged = false
        Object.keys(merged).forEach(field => {
          const cur = String(merged[field] ?? '').trim()
          const sv = savedSummary[field]
          if (cur === '' && sv !== null && sv !== undefined && String(sv) !== '') {
            merged[field] = sv
            summaryChanged = true
          }
        })
        if (summaryChanged) { next[sk] = merged; changed = true }
      })

      // Carry over the saved per-field timestamps for any field we just filled,
      // so the sheet keeps operator 1's original entry times (not overwritten).
      if (card.field_ts && typeof card.field_ts === 'object') {
        next.field_ts = { ...(card.field_ts || {}), ...(prev.field_ts || {}) }
        changed = true
      }

      return changed ? next : prev
    })
  }

  React.useEffect(() => {
    if (!supabaseReady || !supabase) return
    prefillHeader.current()
    // Poll so an operator who opens the same date+variant sees header updates
    // the other operator makes, without a manual refresh.
    const id = setInterval(() => prefillHeader.current(), 15000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') prefillHeader.current()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.date, form.log_variant])

  // ── Shift handover / restore: shared Running Motor Amp Status draft ──
  // Auto-save the motor form to a shared draft keyed by (running_date, variant)
  // so the next operator (or the same operator after reload / re-login on
  // another device) sees the entered values even before "Save Motor Status".
  const saveMotorDraft = React.useRef(null)
  saveMotorDraft.current = async () => {
    if (!supabaseReady || !supabase) return
    if (!motorForm.running_date) return
    if (!motorHasData(motorForm)) return
    try {
      await supabase
        .from('thermopack_motor_draft')
        .upsert(
          {
            running_date: motorForm.running_date,
            variant: motorForm.motor_variant,
            form: buildMotorBlob(motorForm),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'running_date,variant' }
        )
    } catch { /* non-fatal; localStorage still holds it */ }
  }

  // Debounced auto-save whenever the motor form changes.
  React.useEffect(() => {
    if (!supabaseReady || !supabase) return
    if (!motorForm.running_date) return
    const t = setTimeout(() => saveMotorDraft.current(), 1200)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    motorForm.running_date, motorForm.motor_variant, motorForm.checked_by,
    motorForm.remark, motorForm.motors_10l, motorForm.motors_6l,
  ])

  // Prefill the motor form from the shared draft on date/variant selection,
  // filling ONLY empty fields (never overwriting what the operator is typing).
  // Polls + refocus so another operator's updates appear without a refresh.
  const prefillMotorDraft = React.useRef(null)
  prefillMotorDraft.current = async () => {
    if (!supabaseReady || !supabase) return
    if (!motorForm.running_date) return
    let blob = null
    try {
      const res = await supabase
        .from('thermopack_motor_draft')
        .select('form')
        .eq('running_date', motorForm.running_date)
        .eq('variant', motorForm.motor_variant)
        .maybeSingle()
      if (res.error) return
      blob = res.data && res.data.form
    } catch { return }
    if (!blob || typeof blob !== 'object') return

    const varKey = motorForm.motor_variant === '10L' ? 'motors_10l' : 'motors_6l'
    const savedRows = blob[varKey] || []

    setMotorForm(prev => {
      let changed = false
      const next = { ...prev }

      if (String(prev.checked_by ?? '').trim() === '' && String(blob.checked_by ?? '').trim() !== '') {
        next.checked_by = blob.checked_by; changed = true
      }
      if (String(prev.remark ?? '').trim() === '' && String(blob.remark ?? '').trim() !== '') {
        next.remark = blob.remark; changed = true
      }

      // Fill only empty motor rows for the active variant.
      const curRows = prev[varKey] || []
      const mergedRows = curRows.map((m, idx) => {
        const localHas = m && (String(m.val ?? '').trim() !== '' || String(m.stop ?? '').trim() !== '')
        if (localHas) return m
        const rem = savedRows[idx]
        if (!rem || (String(rem.val ?? '').trim() === '' && String(rem.stop ?? '').trim() === '')) return m
        changed = true
        return { ...m, val: rem.val ?? '', stop: rem.stop ?? '', timestamp: rem.timestamp || '', isoTime: rem.isoTime || '' }
      })
      if (changed) next[varKey] = mergedRows
      return changed ? next : prev
    })
  }

  React.useEffect(() => {
    if (!supabaseReady || !supabase) return
    prefillMotorDraft.current()
    const id = setInterval(() => prefillMotorDraft.current(), 15000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') prefillMotorDraft.current()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motorForm.running_date, motorForm.motor_variant])

  // ── Shared hourly log across operators ──────────────────────
  // There are multiple Thermopack operators. The hourly draft is shared by
  // (log_date, variant, hour), so an hour one operator saves appears for the
  // others. This pulls every saved hour for the current (date, variant) and
  // fills ONLY empty local slots — a row the current operator is editing (has
  // any data) is never overwritten. Runs on mount/date/variant change and on a
  // 15s poll so new saves from other operators appear without a refresh.
  const mergeSharedHours = React.useRef(null)
  mergeSharedHours.current = async () => {
    if (!supabaseReady || !supabase) return
    const logDate = form.date || new Date().toISOString().slice(0, 10)
    const variant = form.log_variant
    const rowsKey = variant === '10L' ? 'rows_10l' : 'rows_6l'

    let data = null
    try {
      const res = await supabase
        .from('thermopack_hourly_draft')
        .select('hour, values, operator, saved_at')
        .eq('log_date', logDate)
        .eq('variant', variant)
        .order('saved_at', { ascending: true })
      if (res.error) return
      data = res.data
    } catch {
      return
    }
    if (!data) return

    const byHour = {}
    data.forEach(r => { byHour[r.hour] = r })

    const rowHasData = (r) =>
      !!r && LOG_FIELDS_10L.some(f => String(r[f] ?? '').trim() !== '')

    setForm(prev => {
      let changed = false
      const nextRows = TIME_SLOTS.map((slot, idx) => {
        const local = prev[rowsKey][idx]
        if (rowHasData(local)) return local   // keep in-progress / own edits
        const remote = byHour[slot]
        if (!remote) return local
        const v = remote.values || {}
        changed = true
        return {
          ...emptyRow(),
          ...Object.fromEntries(LOG_FIELDS_10L.map(f => [f, v[f] ?? ''])),
          field_ts: (v.__ts && typeof v.__ts === 'object') ? v.__ts : {},
          operator: remote.operator || '',
          timestamp: stamp12hr(),
          saved: true,
        }
      })
      if (!changed) return prev
      return { ...prev, [rowsKey]: nextRows }
    })
  }

  React.useEffect(() => {
    if (!supabaseReady || !supabase) return
    mergeSharedHours.current()
    const id = setInterval(() => mergeSharedHours.current(), 15000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') mergeSharedHours.current()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.date, form.log_variant])

  const set = (name, value) =>
    setForm(prev => ({
      ...prev,
      [name]: value,
      field_ts: stampFieldTs(prev.field_ts, name, prev[name], value),
    }))

  // Numeric fields:
  // Allows only numbers and decimal values.
  // Empty value is also allowed.
  const setNumeric = (name, value) => {
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      set(name, value)
    }
  }

  // setRow targets the currently active variant's rows. Each field keeps its
  // OWN entry/update timestamp in the row's field_ts map (set when the value
  // changes to non-empty, preserved when unchanged), so the sheet can show the
  // time the operator entered THAT field — not one shared row-save time.
  const setRow = (i, field, value) => {
    const key = form.log_variant === '10L'
      ? 'rows_10l'
      : 'rows_6l'

    setForm(prev => ({
      ...prev,
      [key]: prev[key].map((r, idx) =>
        idx === i
          ? {
              ...r,
              [field]: value,
              field_ts: stampFieldTs(r.field_ts, field, r[field], value),
            }
          : r
      ),
    }))
  }

  // Save a SINGLE hourly row to Supabase (thermopack_hourly_draft). Only this
  // row is persisted and stamped; other unsaved rows stay unsaved. The server
  // captures the authoritative save moment in saved_at; the displayed badge is
  // the hh:mm:ss IST time. Re-saving the same (draft_key, variant, hour) is an
  // UPSERT (single row, last write wins) — no duplicates.
  async function saveRow(i) {
    const key = form.log_variant === '10L' ? 'rows_10l' : 'rows_6l'
    if (form[key][i].saved) return   // already saved — no re-stamp

    if (!supabaseReady) {
      setError('Supabase not configured.')
      return
    }

    const variant = form.log_variant
    const slot = TIME_SLOTS[i]
    const draftKey = form.draft_key || newDraftKey()
    const rowData = form[key][i]

    // Only persist the measurement fields (never the client saved/timestamp).
    const values = Object.fromEntries(
      LOG_FIELDS_10L.map(f => [f, rowData[f] ?? ''])
    )
    // Carry the per-field entry timestamps inside values under '__ts' so the
    // sheet shows the time each cell was entered (not the row-save time). No
    // schema change needed — values is already jsonb.
    values.__ts = { ...(rowData.field_ts || {}) }

    setSavingRow(`${variant}:${i}`)
    setError('')

    // Shared across operators by (log_date, variant, hour): the per-row Save
    // UPSERTS onto that key, so every Thermopack operator viewing the same
    // date + variant sees this hour. log_date = the job card date if set, else
    // today (IST).
    const logDate = form.date || new Date().toISOString().slice(0, 10)

    const { error: eRow } = await supabase
      .from('thermopack_hourly_draft')
      .upsert(
        {
          draft_key: draftKey,
          log_date: logDate,
          variant,
          hour: slot,
          values,
          // Operator column auto-filled with the logged-in user's name,
          // falling back to the job card's Operator field if unavailable.
          operator: loggedInUserName() || form.operator || null,
          saved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'log_date,variant,hour' }
      )

    setSavingRow('')

    if (eRow) {
      setError(eRow.message)
      return
    }

    // Also push the current header to the shared draft so the next operator
    // gets it even if Save Job Card is never clicked.
    if (saveHeaderDraft.current) saveHeaderDraft.current()

    const ts = stamp12hr()
    const opName = loggedInUserName() || form.operator || ''
    setForm(prev => ({
      ...prev,
      draft_key: draftKey,
      [key]: prev[key].map((r, idx) =>
        // Stamp the operator name onto THIS row only on save, so the Operator
        // column shows the name only after the row's Save button is clicked.
        idx === i ? { ...r, timestamp: ts, operator: opName, saved: true } : r
      ),
    }))
  }

  // active rows for rendering
  const activeRows =
    form.log_variant === '10L'
      ? form.rows_10l
      : form.rows_6l


  // active summary for rendering — switches with variant
  const activeSummary = form.log_variant === '10L' ? form.summary_10l : form.summary_6l

  const setSummary = (field, val) => {
    const key = form.log_variant === '10L' ? 'summary_10l' : 'summary_6l'
    const tsKey = (form.log_variant === '10L' ? '10l.' : '6l.') + field
    setForm(prev => ({
      ...prev,
      [key]: { ...prev[key], [field]: val },
      field_ts: stampFieldTs(prev.field_ts, tsKey, prev[key][field], val),
    }))
  }

  const setSummaryNumeric = (field, val) => {
    if (val === '' || /^\d*\.?\d*$/.test(val)) setSummary(field, val)
  }

  // Auto-sum Ash/Clinker Wt from both 10L and 6L rows
  const totalClinkerWt = useMemo(() => {
    const sum10l = form.rows_10l.reduce((s, r) => s + (parseFloat(r.ash_clinker_wt) || 0), 0)
    const sum6l  = form.rows_6l.reduce( (s, r) => s + (parseFloat(r.ash_clinker_wt) || 0), 0)
    return sum10l + sum6l
  }, [form.rows_10l, form.rows_6l])

  const setMotorCell = (mi, key, value) =>
    setMotorForm(prev => {
      const varKey = prev.motor_variant === '10L' ? 'motors_10l' : 'motors_6l'
      return {
        ...prev,
        [varKey]: prev[varKey].map((m, idx) => {
          if (idx !== mi) return m
          const next = { ...m, [key]: value }
          // Show a live timestamp as soon as BOTH Amp Reading and Status are
          // filled (the authoritative save moment is re-stamped server-side on
          // Save Motor Status). If a row is already saved, keep its timestamp.
          const hasAmp = next.val !== undefined && next.val !== null && String(next.val).trim() !== ''
          const hasStatus = next.stop !== undefined && next.stop !== null && String(next.stop).trim() !== ''
          if (!next.saved) {
            if (hasAmp && hasStatus) {
              // Capture the FILL moment (display + ISO) once both fields are in.
              if (!next.timestamp) {
                next.timestamp = stamp12hr()
                next.isoTime = new Date().toISOString()
              }
            } else {
              next.timestamp = ''
              next.isoTime = ''
            }
          }
          return next
        }),
      }
    })

  const activeMotors = motorForm.motor_variant === '10L'
    ? motorForm.motors_10l
    : motorForm.motors_6l

  async function handleSubmit(e) {
    e.preventDefault()

    if (!supabaseReady) {
      setError('Supabase not configured.')
      return
    }

    setSaving(true)
    setError('')
    setSavedMain(false)

    // Operator is the authenticated user's name (never manually typed). If the
    // profile has no name, fall back to whatever is in the field; if that is
    // also empty it stays null (no invented name).
    const operatorName = loggedInUserName() || form.operator || ''

    // Build the per-field timestamp map to persist. Start from what the form
    // captured as the operator typed, then ensure operator + total fuel
    // consumption have a time when they carry a value (preserving any existing
    // time). This is what makes each field show its OWN entry/update time.
    const nowIso = new Date().toISOString()
    const fieldTs = { ...(form.field_ts || {}) }
    if (operatorName && !fieldTs.operator) fieldTs.operator = nowIso

    const payload = {
      date: form.date || null,

      shift: form.shift,
      operator: operatorName || null,

      helper1: form.helper1,
      helper2: form.helper2,
      helper3: form.helper3,

      time_in: form.time_in,
      time_out: form.time_out,

      coal_date: form.coal_date || null,
      bugass_date: form.bugass_date || null,

      coal_qty: form.coal_qty
        ? parseFloat(form.coal_qty)
        : null,

      bugass_qty: form.bugass_qty
        ? parseFloat(form.bugass_qty)
        : null,

      coal_charged: form.coal_charged
        ? parseFloat(form.coal_charged)
        : null,

      bugass_charged: form.bugass_charged
        ? parseFloat(form.bugass_charged)
        : null,

      diesel_charged: form.diesel_charged
        ? parseFloat(form.diesel_charged)
        : null,

      // Summary fields
      outlet_set_temp: form.summary_10l.outlet_set_temp
        ? parseFloat(form.summary_10l.outlet_set_temp)
        : null,
      expansion_tank_level:         form.log_variant === '10L' ? form.summary_10l.expansion_tank_level : form.summary_6l.expansion_tank_level,
      type_of_fuel:                 form.log_variant === '10L' ? form.summary_10l.type_of_fuel         : form.summary_6l.type_of_fuel,
      qty_fuel_used:                form.log_variant === '10L' ? form.summary_10l.qty_fuel_used        : form.summary_6l.qty_fuel_used,
      date_of_last_boiler_cleaning: (form.log_variant === '10L' ? form.summary_10l.date_of_last_boiler_cleaning : form.summary_6l.date_of_last_boiler_cleaning) || null,
      total_running_hrs:            form.log_variant === '10L' ? (parseFloat(form.summary_10l.total_running_hrs) || null) : (parseFloat(form.summary_6l.total_running_hrs) || null),
      consumption_per_hr:           form.log_variant === '10L' ? (parseFloat(form.summary_10l.consumption_per_hr) || null) : (parseFloat(form.summary_6l.consumption_per_hr) || null),
      total_consumption:            form.log_variant === '10L' ? (parseFloat(form.summary_10l.total_consumption) || null) : (parseFloat(form.summary_6l.total_consumption) || null),
      total_clinker_wt:             totalClinkerWt || null,
      dryer_in_use:                 form.log_variant === '10L' ? form.summary_10l.dryer_in_use : form.summary_6l.dryer_in_use,
      summary_10l:                  form.summary_10l,
      summary_6l:                   form.summary_6l,

      log_variant: form.log_variant,

      log_rows_10l: form.rows_10l,

      log_rows_6l: form.rows_6l,

      remarks: form.remarks,

      // Per-field entry/update timestamps → synced to the sheet so each value
      // shows its own time. Keyed to match the sheet's field keys.
      field_ts: fieldTs,
    }

    // If this card was already submitted in this session, UPDATE the same row
    // (keeps one job card + one Sheet row) instead of inserting a duplicate.
    // Otherwise INSERT a new row and capture its generated id.
    let inserted = null
    let e1 = null
    if (submittedJobCardId) {
      const res = await supabase
        .from('thermopack_job_cards')
        .update(payload)
        .eq('id', submittedJobCardId)
        .select('id')
        .single()
      inserted = res.data
      e1 = res.error
    } else {
      const res = await supabase
        .from('thermopack_job_cards')
        .insert([payload])
        .select('id')
        .single()
      inserted = res.data
      e1 = res.error
    }

    if (e1) {
      setSaving(false)
      setError(e1.message)
      return
    }

    // Associate every previously-saved hourly row for this fill with the new
    // job card id. This stamps job_card_id on the thermopack_hourly_draft rows,
    // which makes them eligible for Google Sheets sync (orphaned/unsaved rows
    // are never exported). Non-fatal if it fails — the job card is already
    // saved; the hourly rows simply stay unassociated.
    if (inserted && inserted.id && form.draft_key) {
      const { error: eAssoc } = await supabase.rpc('thermopack_associate_hourly', {
        p_draft_key: form.draft_key,
        p_job_card_id: inserted.id,
      })
      if (eAssoc) {
        // Surface but don't block — job card itself succeeded.
        console.warn('thermopack_associate_hourly failed:', eAssoc.message)
      }
    }

    setSaving(false)
    setSavedMain(true)
    setSubmittedJobCardId(null)
    // Clear the job card form after a successful save (fresh draft_key for the
    // next card). Inline confirmation (auto-dismisses) is set via savedMain.
    clearFormDraft()
  }

  async function handleMotorSubmit(e) {
    e.preventDefault()

    if (!supabaseReady) {
      setError('Supabase not configured.')
      return
    }

    // A motor row counts as "completed" when it has an Amp Reading or a Status.
    const isComplete = (m) =>
      (m.val !== undefined && m.val !== null && String(m.val).trim() !== '') ||
      (m.stop !== undefined && m.stop !== null && String(m.stop).trim() !== '')

    // Preserve the time captured when the operator FILLED the row (set live in
    // setMotorCell). Only fall back to now() if a completed row somehow has no
    // fill-time yet. Drop incomplete rows (never saved silently).
    const nowIso = new Date().toISOString()
    const prepare = (motors) =>
      motors.map(m =>
        isComplete(m)
          ? {
              val: m.val,
              stop: m.stop,
              // Keep the fill-time display stamp + its ISO; fall back to now.
              timestamp: m.timestamp || stamp12hr(),
              isoTime: m.isoTime || nowIso,
              saved: true,
            }
          : null
      )

    const prepared10 = prepare(motorForm.motors_10l)
    const prepared6  = prepare(motorForm.motors_6l)
    const completedCount =
      prepared10.filter(Boolean).length + prepared6.filter(Boolean).length

    if (completedCount === 0) {
      setError('Enter at least one motor Amp Reading or Status before saving.')
      return
    }

    setSaving(true)
    setError('')
    setSavedMotor(false)

    // Use the operator-selected running date (defaults to today).
    const runDate = motorForm.running_date || new Date().toISOString().slice(0, 10)

    const { error: e2 } = await supabase
      .from('motor_amp_status')
      .insert([
        {
          running_date:   runDate,
          checked_by:     motorForm.checked_by,
          remark:         motorForm.remark,
          motor_variant:  motorForm.motor_variant,
          motor_data_10l: prepared10,
          motor_data_6l:  prepared6,
        },
      ])

    setSaving(false)

    if (e2) {
      setError(e2.message)
    } else {
      setSavedMotor(true)
      // Remove the shared working draft for this (date, variant) so the just-
      // cleared form is not immediately refilled from it by the prefill poll.
      // The permanent record is already in motor_amp_status.
      try {
        await supabase
          .from('thermopack_motor_draft')
          .delete()
          .eq('running_date', runDate)
          .eq('variant', motorForm.motor_variant)
      } catch { /* non-fatal */ }
      // Clear the motor form after a successful save. Inline confirmation
      // (auto-dismisses) is set via savedMotor above.
      clearMotorDraft()
    }
  }

  return (
    <div className="tjc-wrapper">

      <div className="tjc-title-bar">
        <span className="tjc-title-en">
          Thermopack Job Card
        </span>

        <span className="tjc-title-divider">
          |
        </span>

        <span className="tjc-title-hi">
          थर्मोपैक जॉब कार्ड
        </span>
      </div>

      <form
        className="tjc-form"
        onSubmit={handleSubmit}
      >

        {!supabaseReady && (
          <div className="tjc-config-warning">
            ⚠️ Supabase not connected — add credentials to{' '}
            <code>.env</code>
          </div>
        )}

        {/* ══ SECTION 1: Date + Shift + Operator + Helpers ══ */}
        <div className="tjc-section">
          <div className="op-grid">

            <div className="op-field">
              <div className="cell-mini-label">Date / <span className="hi">तारीख</span></div>
              <input type="date" className="tjc-input"
                value={form.date} onChange={e => set('date', e.target.value)} />
            </div>

            <div className="op-field">
              <div className="cell-mini-label">Shift / <span className="hi">पाली</span></div>
              <select className="tjc-input" value={form.shift} onChange={e => set('shift', e.target.value)}>
                <option value="">— Select —</option>
                <option value="Day">Day / दिन</option>
                <option value="Night">Night / रात</option>
              </select>
            </div>

            <div className="op-field">
              <div className="cell-mini-label">Operator Name/ <span className="hi">ऑपरेटर नाम</span></div>
              <input className="tjc-input" placeholder="Operator"
                value={form.operator} onChange={e => set('operator', e.target.value)} />
            </div>

            <div className="op-field">
              <div className="cell-mini-label">Helper 1 Name/ <span className="hi">हेल्पर १ नाम</span></div>
              <input className="tjc-input" placeholder="Helper 1"
                value={form.helper1} onChange={e => set('helper1', e.target.value)} />
            </div>

            <div className="op-field">
              <div className="cell-mini-label">Helper 2 Name / <span className="hi">हेल्पर २ नाम</span></div>
              <input className="tjc-input" placeholder="Helper 2"
                value={form.helper2} onChange={e => set('helper2', e.target.value)} />
            </div>

            <div className="op-field">
              <div className="cell-mini-label">Helper 3 Name/ <span className="hi">हेल्पर ३ नाम</span></div>
              <input className="tjc-input" placeholder="Helper 3"
                value={form.helper3} onChange={e => set('helper3', e.target.value)} />
            </div>

            <div className="op-field">
              <div className="cell-mini-label">Time In / <span className="hi">समय प्रवेश</span></div>
              <input type="time" className="tjc-input"
                value={form.time_in} onChange={e => set('time_in', e.target.value)} />
            </div>

            <div className="op-field">
              <div className="cell-mini-label">Time Out / <span className="hi">समय बाहर</span></div>
              <input type="time" className="tjc-input"
                value={form.time_out} onChange={e => set('time_out', e.target.value)} />
            </div>

          </div>
        </div>

        {/* ══ SECTION 2: Stock Received ══ */}

        <div className="tjc-section">

          <div className="stock-header">
            Stock Received /{' '}
            <span className="hi">
              प्राप्त स्टॉक
            </span>
          </div>

          <div className="stock-grid">

            <div className="stock-row stock-row-header">

              <div className="stock-label"></div>

              <div className="stock-field stock-col-head">
                Date /{' '}
                <span className="hi">
                  तारीख
                </span>
              </div>

              <div className="stock-field stock-col-head">
                Qty. MT /{' '}
                <span className="hi">
                  मात्रा (मे.टन)
                </span>
              </div>

            </div>

            <div className="stock-row">

              <div className="stock-label">
                Coal /{' '}
                <span className="hi">
                  कोयला
                </span>
              </div>

              <div className="stock-field">

                <div className="cell-mini-label">
                  Date /{' '}
                  <span className="hi">
                    तारीख
                  </span>
                </div>

                <input
                  type="date"
                  className="tjc-input"
                  value={form.coal_date}
                  onChange={e =>
                    set('coal_date', e.target.value)
                  }
                />

              </div>

              <div className="stock-field">

                <div className="cell-mini-label">
                  Qty. MT /{' '}
                  <span className="hi">
                    मात्रा (मे.टन)
                  </span>
                </div>

                <input
                  type="number"
                  className="tjc-input"
                  placeholder="0"
                  value={form.coal_qty}
                  onChange={e =>
                    set('coal_qty', e.target.value)
                  }
                />

              </div>

            </div>

            <div className="stock-row">

              <div className="stock-label">
                Bugass /{' '}
                <span className="hi">
                  भुगैस
                </span>
              </div>

              <div className="stock-field">

                <div className="cell-mini-label">
                  Date /{' '}
                  <span className="hi">
                    तारीख
                  </span>
                </div>

                <input
                  type="date"
                  className="tjc-input"
                  value={form.bugass_date}
                  onChange={e =>
                    set('bugass_date', e.target.value)
                  }
                />

              </div>

              <div className="stock-field">

                <div className="cell-mini-label">
                  Qty. MT /{' '}
                  <span className="hi">
                    मात्रा (मे.टन)
                  </span>
                </div>

                <input
                  type="number"
                  className="tjc-input"
                  placeholder="0"
                  value={form.bugass_qty}
                  onChange={e =>
                    set('bugass_qty', e.target.value)
                  }
                />

              </div>

            </div>

          </div>

        </div>

        {/* ══ SECTION 3: Common Entries (10/6 L kCal) ══ */}

        <div className="tjc-section">

          <div className="stock-header">
            Common Entries (10/6 L kCal) /{' '}
            <span className="hi">
              सामान्य प्रविष्टि
            </span>
          </div>

          {/* ── Fuel Charged row ── */}

          <div className="common-entries-grid">

            <div className="common-entry-field">

              <div className="cell-mini-label">
                Fuel Charged — Coal (MT)
              </div>

              <input
                type="number"
                className="tjc-input"
                placeholder="0"
                value={form.coal_charged}
                onChange={e =>
                  set('coal_charged', e.target.value)
                }
              />

            </div>

            <div className="common-entry-field">

              <div className="cell-mini-label">
                Fuel Charged — Bugass (MT)
              </div>

              <input
                type="number"
                className="tjc-input"
                placeholder="0"
                value={form.bugass_charged}
                onChange={e =>
                  set('bugass_charged', e.target.value)
                }
              />

            </div>

            <div className="common-entry-field">

              <div className="cell-mini-label">
                Diesel (Ltr)
              </div>

              <input
                type="number"
                className="tjc-input"
                placeholder="0"
                value={form.diesel_charged}
                onChange={e =>
                  set('diesel_charged', e.target.value)
                }
              />

            </div>

          </div>

          {/* ── Total Fuel Consumption bar ── */}

          <div className="fuel-total-bar">

            <span className="fuel-total-title">
              Total Fuel Consumption
            </span>

            <div className="fuel-total-items">

              <div className="fuel-total-item">
                <span className="fuel-total-item-label">Coal</span>
                <span className="fuel-total-item-val">
                  {parseFloat(form.coal_charged) || 0} MT
                </span>
              </div>

              <span className="fuel-total-plus">+</span>

              <div className="fuel-total-item">
                <span className="fuel-total-item-label">Bugass</span>
                <span className="fuel-total-item-val">
                  {parseFloat(form.bugass_charged) || 0} MT
                </span>
              </div>

              <span className="fuel-total-equals">=</span>

              <div className="fuel-total-item fuel-total-result">
                <span className="fuel-total-item-label">Total</span>
                <span className="fuel-total-item-val">
                  {(
                    (parseFloat(form.coal_charged) || 0) +
                    (parseFloat(form.bugass_charged) || 0)
                  ).toFixed(2)}
                </span>
              </div>

            </div>

          </div>

        </div>

        {/* ══ SECTION 4: Hourly Log ══ */}

        <div className="tjc-section tjc-log-section">

          {/* ── Variant selector ── */}

          <div className="log-variant-bar">

            <span className="log-variant-label">
              Thermopack Type /{' '}
              <span className="hi">
                प्रकार
              </span>
            </span>

            <div className="log-variant-btns">

              {['10L', '6L'].map(v => (
                <button
                  key={v}
                  type="button"
                  className={`log-variant-btn ${
                    form.log_variant === v
                      ? 'log-variant-active'
                      : ''
                  }`}
                  onClick={() =>
                    set('log_variant', v)
                  }
                >
                  {v === '10L'
                    ? '10 L kCal'
                    : '6 L kCal'}
                </button>
              ))}

            </div>

            <span className="log-variant-badge">
              Hourly Log —{' '}
              {form.log_variant === '10L'
                ? '10 L kCal'
                : '6 L kCal'}
            </span>

          </div>

          <div className="tjc-log-scroll">

            <table className="tjc-log-table">

              <thead>

                <tr>

                  <th
                    className="col-time"
                    rowSpan={2}
                  >
                    Time
                    <br />
                    <span className="hi">
                      समय
                    </span>
                  </th>

                  <th colSpan={2}>
                    Temp
                    <br />
                    <span className="hi">
                      तापमान
                    </span>
                  </th>

                  <th colSpan={3}>
                    Oil Press
                    <br />
                    <span className="hi">
                      तेल दबाव
                    </span>
                  </th>

                  <th rowSpan={2}>
                    Temp Exhaust
                    <br />
                    <span className="hi">
                      एग्जॉस्ट
                    </span>
                  </th>

                  <th rowSpan={2}>
                    Feed Freq.
                    <br />
                    (Hz)
                  </th>

                  <th colSpan={2}>
                    Timing of
                    <br />
                    Bed Cleaning
                  </th>

                  <th rowSpan={2}>
                    Ash/Clinker
                    <br />
                    Wt. (kg)
                  </th>

                  <th rowSpan={2}>
                    Timing of Coil
                    <br />
                    Cleaning by Air
                  </th>

                  <th rowSpan={2}>
                    Operator
                    <br />
                    <span className="hi">
                      ऑपरेटर
                    </span>
                  </th>

                  <th rowSpan={2}>
                    Timestamp
                    <br />
                    <span className="hi">
                      समय टिकट
                    </span>
                  </th>

                  <th rowSpan={2}>
                    Save
                    <br />
                    <span className="hi">
                      सहेजें
                    </span>
                  </th>

                </tr>

                <tr>

                  <th>
                    In
                  </th>

                  <th>
                    Out
                  </th>

                  <th>
                    In
                  </th>

                  <th>
                    Out
                  </th>

                  <th>
                    Level
                  </th>

                  <th>
                    Start
                  </th>

                  <th>
                    Stop
                  </th>

                </tr>

              </thead>

              <tbody>

                {TIME_SLOTS.map((slot, i) => (

                  <tr
                    key={slot}
                    className={
                      activeRows[i].saved
                        ? 'row-saved'
                        : ''
                    }
                  >

                    <td className="col-time">
                      {slot}
                    </td>

                    <td>
                      <input
                        type="number"
                        className="tjc-log-input"
                        placeholder="—"
                        value={activeRows[i].temp_in}
                        onChange={e =>
                          setRow(
                            i,
                            'temp_in',
                            e.target.value
                          )
                        }
                      />
                    </td>

                    <td>
                      <input
                        type="number"
                        className="tjc-log-input"
                        placeholder="—"
                        value={activeRows[i].temp_out}
                        onChange={e =>
                          setRow(
                            i,
                            'temp_out',
                            e.target.value
                          )
                        }
                      />
                    </td>

                    <td>
                      <input
                        type="number"
                        className="tjc-log-input"
                        placeholder="—"
                        value={activeRows[i].oil_press_in}
                        onChange={e =>
                          setRow(
                            i,
                            'oil_press_in',
                            e.target.value
                          )
                        }
                      />
                    </td>

                    <td>
                      <input
                        type="number"
                        className="tjc-log-input"
                        placeholder="—"
                        value={activeRows[i].oil_press_out}
                        onChange={e =>
                          setRow(
                            i,
                            'oil_press_out',
                            e.target.value
                          )
                        }
                      />
                    </td>

                    <td>
                      <input
                        type="number"
                        className="tjc-log-input"
                        placeholder="—"
                        value={activeRows[i].oil_press_level}
                        onChange={e =>
                          setRow(
                            i,
                            'oil_press_level',
                            e.target.value
                          )
                        }
                      />
                    </td>

                    <td>
                      <input
                        type="number"
                        className="tjc-log-input"
                        placeholder="—"
                        value={activeRows[i].temp_exhaust}
                        onChange={e =>
                          setRow(
                            i,
                            'temp_exhaust',
                            e.target.value
                          )
                        }
                      />
                    </td>

                    <td>
                      <input
                        type="number"
                        className="tjc-log-input"
                        placeholder="—"
                        value={activeRows[i].feed_freq}
                        onChange={e =>
                          setRow(
                            i,
                            'feed_freq',
                            e.target.value
                          )
                        }
                      />
                    </td>

                    <td>
                      <input
                        type="time"
                        className="tjc-log-input tjc-log-time"
                        value={
                          activeRows[i].bed_clean_start
                        }
                        onChange={e =>
                          setRow(
                            i,
                            'bed_clean_start',
                            e.target.value
                          )
                        }
                      />
                    </td>

                    <td>
                      <input
                        type="time"
                        className="tjc-log-input tjc-log-time"
                        value={
                          activeRows[i].bed_clean_stop
                        }
                        onChange={e =>
                          setRow(
                            i,
                            'bed_clean_stop',
                            e.target.value
                          )
                        }
                      />
                    </td>

                    <td>
                      <input
                        type="number"
                        className="tjc-log-input"
                        placeholder="—"
                        value={
                          activeRows[i].ash_clinker_wt
                        }
                        onChange={e =>
                          setRow(
                            i,
                            'ash_clinker_wt',
                            e.target.value
                          )
                        }
                      />
                    </td>

                    <td>
                      <input
                        type="time"
                        className="tjc-log-input tjc-log-time"
                        value={
                          activeRows[i].coil_clean_time
                        }
                        onChange={e =>
                          setRow(
                            i,
                            'coil_clean_time',
                            e.target.value
                          )
                        }
                      />
                    </td>

                    <td className="tjc-op-cell">
                      {activeRows[i].saved && activeRows[i].operator
                        ? <span className="tjc-op-name">{activeRows[i].operator}</span>
                        : <span className="ts-empty">—</span>}
                    </td>

                    <td className="ts-cell">

                      {activeRows[i].timestamp ? (
                        <span className="ts-badge">
                          {activeRows[i].timestamp}
                        </span>
                      ) : (
                        <span className="ts-empty">
                          —
                        </span>
                      )}

                    </td>

                    <td className="ts-save-cell">

                      <button
                        type="button"
                        className="row-save-btn"
                        disabled={activeRows[i].saved || savingRow === `${form.log_variant}:${i}`}
                        onClick={() => saveRow(i)}
                      >
                        {activeRows[i].saved
                          ? '✓'
                          : (savingRow === `${form.log_variant}:${i}` ? '…' : '💾')}
                      </button>

                    </td>

                  </tr>

                ))}

              </tbody>

            </table>

          </div>

        </div>

        {/* ══ SECTION 5: Physical Form Summary Fields ══ */}

        <div className="tjc-section">

          <div className="stock-header">
            Summary / <span className="hi">सारांश</span>
            <span className="log-variant-badge" style={{marginLeft:'12px',fontSize:'11px'}}>
              {form.log_variant === '10L' ? '10 L kCal' : '6 L kCal'}
            </span>
          </div>

          <div className="common-two-col">

            {/* Left column */}
            <div className="common-col">

              <div className="common-field-row">
                <div className="common-field-label">
                  Outlet Set Temp (°C) / <br /><span className="hi">आउटलेट सेट तापमान</span>
                </div>
                <div className="input-with-unit">
                  <input className="tjc-input" type="text" inputMode="decimal" placeholder="0"
                    value={activeSummary.outlet_set_temp}
                    onChange={e => setSummaryNumeric('outlet_set_temp', e.target.value)} />
                  <span className="input-unit">°C</span>
                </div>
              </div>

              <div className="common-field-row">
                <div className="common-field-label">
                  Expansion Tank Level / <br /><span className="hi">एक्सपेंशन टैंक स्तर</span>
                </div>
                <input className="tjc-input" placeholder=""
                  value={activeSummary.expansion_tank_level}
                  onChange={e => setSummary('expansion_tank_level', e.target.value)} />
              </div>

              <div className="common-field-row">
                <div className="common-field-label">
                  Type of Fuel / <br /><span className="hi">ईंधन का प्रकार</span>
                </div>
                <input className="tjc-input" type="text" placeholder=""
                  value={activeSummary.type_of_fuel}
                  onChange={e => setSummary('type_of_fuel', e.target.value)} />
              </div>

              <div className="common-field-row">
                <div className="common-field-label">
                  Qty. of Fuel Used / <br /><span className="hi">ईंधन की मात्रा</span>
                </div>
                <input className="tjc-input" placeholder=""
                  value={activeSummary.qty_fuel_used}
                  onChange={e => setSummary('qty_fuel_used', e.target.value)} />
              </div>

              <div className="common-field-row">
                <div className="common-field-label">
                  Date of Last Boiler Cleaning / <br /><span className="hi">अंतिम बॉयलर सफाई तारीख</span>
                </div>
                <input className="tjc-input" type="date"
                  value={activeSummary.date_of_last_boiler_cleaning}
                  onChange={e => setSummary('date_of_last_boiler_cleaning', e.target.value)} />
              </div>

            </div>

            {/* Right column */}
            <div className="common-col">

              <div className="common-field-row">
                <div className="common-field-label">
                  Total Running Hrs. / <br /><span className="hi">कुल चलने के घंटे</span>
                </div>
                <input className="tjc-input" type="text" inputMode="decimal" placeholder="0"
                  value={activeSummary.total_running_hrs}
                  onChange={e => setSummaryNumeric('total_running_hrs', e.target.value)} />
              </div>

              <div className="common-field-row">
                <div className="common-field-label">
                  Consumption Per Hrs. / <br /><span className="hi">प्रति घंटा खपत</span>
                </div>
                <input className="tjc-input" type="text" inputMode="decimal" placeholder="0"
                  value={activeSummary.consumption_per_hr}
                  onChange={e => setSummaryNumeric('consumption_per_hr', e.target.value)} />
              </div>

              <div className="common-field-row">
                <div className="common-field-label">
                  Total Consumption (kg) / <br /><span className="hi">कुल खपत (किग्रा)</span>
                </div>
                <input className="tjc-input" type="text" inputMode="decimal" placeholder="0"
                  value={activeSummary.total_consumption}
                  onChange={e => setSummaryNumeric('total_consumption', e.target.value)} />
              </div>

              <div className="common-field-row">
                <div className="common-field-label">
                  Total Clinker Weight (kg) / <br /><span className="hi">कुल क्लिंकर वजन (किग्रा)</span>
                </div>
                <div className="clinker-auto-val">
                  <span className="clinker-auto-num">
                    {totalClinkerWt % 1 === 0 ? totalClinkerWt : totalClinkerWt.toFixed(2)}
                  </span>
                  <span className="clinker-auto-hint">auto / स्वतः</span>
                </div>
              </div>

              <div className="common-field-row">
                <div className="common-field-label">
                  Dryer in Use / <br /><span className="hi">ड्रायर उपयोग में</span>
                </div>
                <select className="tjc-input" value={activeSummary.dryer_in_use}
                  onChange={e => setSummary('dryer_in_use', e.target.value)}>
                  <option value="">Select / चुनें</option>
                  <option value="Old">Old / पुराना</option>
                  <option value="New">New / नया</option>
                </select>
              </div>

            </div>

          </div>

        </div>

        {/* ══ SECTION 6: Remarks ══ */}

        <div className="tjc-section tjc-remarks-section">

          <Label
            en="Remarks"
            hi="टिप्पणी"
          />

          <textarea
            className="tjc-textarea"
            rows={3}
            placeholder="Remarks / टिप्पणी..."
            value={form.remarks}
            onChange={e =>
              set('remarks', e.target.value)
            }
          />

        </div>

        {/* ══ Actions ══ */}

        <div className="tjc-actions">

          {error && (
            <div className="tjc-error">
              Error: {error}
            </div>
          )}

          {savedMain && (
            <div className="tjc-success tjc-toast" role="status">
              ✓ Saved successfully / सफलतापूर्वक सहेजा गया
            </div>
          )}

          <button
            type="submit"
            className="tjc-save-btn"
            disabled={saving}
          >
            {saving
              ? 'Saving…'
              : 'Save Job Card / जॉब कार्ड सहेजें'}
          </button>

          <button
            type="button"
            className="tjc-reset-btn"
            onClick={() => {
              clearFormDraft()
              setSubmittedJobCardId(null)
              setSavedMain(false)
              setError('')
            }}
          >
            Reset / रीसेट
          </button>

        </div>

      </form>

      {/* ══ COLLAPSIBLE: Running Motor Amp Status ══ */}
      <div className="sc-accordion">

        <button type="button" className="sc-accordion-header"
          onClick={() => setMotorOpen(o => !o)} aria-expanded={motorOpen}>
          <span className="sc-accordion-title">
            Running Motor Amp Status
            <span className="sc-accordion-title-hi"> / रनिंग मोटर एम्प स्थिति</span>
          </span>
          <span className="sc-accordion-icon">{motorOpen ? '▲' : '▼'}</span>
        </button>

        {motorOpen && (
          <form className="sc-form" onSubmit={handleMotorSubmit}>

            {/* ── Meta ── */}
            <div className="sc-meta-row">
              <div className="sc-meta-field">
                <Label en="Select Date" hi="तारीख चुनें" />
                <input type="date" className="tjc-input"
                  value={motorForm.running_date}
                  onChange={e => setMotorForm(p => ({ ...p, running_date: e.target.value }))} />
              </div>
              <div className="sc-meta-field sc-meta-wide">
                <Label en="Checked By" hi="जाँच की गई" />
                <input className="tjc-input" placeholder="Name / नाम"
                  value={motorForm.checked_by}
                  onChange={e => setMotorForm(p => ({ ...p, checked_by: e.target.value }))} />
              </div>
            </div>

            {/* ── Variant selector (10L / 6L) ── */}
            <div className="log-variant-bar">
              <span className="log-variant-label">
                Thermopack Type / <span className="hi">प्रकार</span>
              </span>
              <div className="log-variant-btns">
                {['10L', '6L'].map(v => (
                  <button key={v} type="button"
                    className={`log-variant-btn ${motorForm.motor_variant === v ? 'log-variant-active' : ''}`}
                    onClick={() => setMotorForm(p => ({ ...p, motor_variant: v }))}>
                    {v === '10L' ? '10 L kCal' : '6 L kCal'}
                  </button>
                ))}
              </div>
              <span className="log-variant-badge">
                Motor Amp — {motorForm.motor_variant === '10L' ? '10 L kCal' : '6 L kCal'}
              </span>
            </div>

            {/* ── Motor table ── */}
            <div className="sc-table-scroll">
              <table className="sc-single-table">
                <thead>
                  <tr>
                    <th>Sr. No.<br /><span className="hi">क्र.सं.</span></th>
                    <th>Motor Name<br /><span className="hi">मोटर नाम</span></th>
                    <th>HP</th>
                    <th>Amp Reading<br /><span className="hi">एम्प रीडिंग</span></th>
                    <th>Status<br /><span className="hi">स्थिति</span></th>
                    <th>Timestamp<br /><span className="hi">समय</span></th>
                  </tr>
                </thead>
                <tbody>
                  {MOTORS.map((motor, mi) => (
                    <tr key={motor.id}
                      className={activeMotors[mi].saved ? 'row-saved' : ''}>
                      <td className="sc-sr">{motor.id}</td>
                      <td className="sc-motor-name">{motor.name}</td>
                      <td className="sc-hp">{motor.hp}</td>
                      <td className="sc-cell">
                        <input type="number" className="sc-input-wide" placeholder="—"
                          value={activeMotors[mi].val}
                          onChange={e => setMotorCell(mi, 'val', e.target.value)} />
                      </td>
                      <td className="sc-cell sc-stop-cell">
                        <select className="sc-stop-select-wide"
                          value={activeMotors[mi].stop}
                          onChange={e => setMotorCell(mi, 'stop', e.target.value)}>
                          <option value="">—</option>
                          <option value="STOP">STOP</option>
                          <option value="OK">OK</option>
                        </select>
                      </td>
                      <td className="ts-cell">
                        {activeMotors[mi].timestamp
                          ? <span className="ts-badge">{activeMotors[mi].timestamp}</span>
                          : <span className="ts-empty">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="sc-bottom">
              <div className="sc-remark-field">
                <Label en="Remark" hi="टिप्पणी" />
                <input className="tjc-input" placeholder="Remark / टिप्पणी"
                  value={motorForm.remark}
                  onChange={e => setMotorForm(p => ({ ...p, remark: e.target.value }))} />
              </div>
              <div className="tjc-actions sc-actions">
                {savedMotor && <div className="tjc-success tjc-toast" role="status">✓ Saved successfully / सफलतापूर्वक सहेजा गया</div>}
                <button type="submit" className="tjc-save-btn" disabled={saving}>
                  {saving ? 'Saving…' : 'Save Motor Status / मोटर स्थिति सहेजें'}
                </button>
                <button type="button" className="tjc-reset-btn"
                  onClick={() => { clearMotorDraft(); setSavedMotor(false) }}>
                  Reset / रीसेट
                </button>
              </div>
            </div>

          </form>
        )}

      </div>

    </div>
  )
}