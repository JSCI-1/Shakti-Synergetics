import React, { useState, useEffect, useRef } from 'react'
import { supabase, supabaseReady } from '../supabaseClient'
import { useDraft, useUserId } from '../utils/useDraft.js'
import './DryerSection.css'


const TIME_SLOTS = [
  '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00',
  '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00', '23:00',
  '00:00', '01:00', '02:00', '03:00', '04:00', '05:00', '06:00', '07:00',
]


function stamp12hr() {
  // Include SECONDS so rows saved together in one sitting (e.g. backfilling
  // hours 03:00–07:00 at 07:02) are visually distinct (07:02:30, 07:02:31, …)
  // instead of all reading "07:02 am".
  return new Date().toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })
}


function emptyRow() {
  return {
    temp_inlet: '',
    temp_outlet: '',
    temp_actual: '',
    temp_fbd1: '',
    temp_fbd2: '',
    temp_chamber: '',

    atomizer_freq: '',
    feed_fc: '',
    c_pressure: '',    // C.Pressure — between Feed F.C. and Feed Pressure
    pressure: '',
    pt_temp: '',

    batch_no: '',
    bags_per_hr: '',
    bag_size_wt: '',
    kg_per_hr: '',

    colour: '',
    id_frequency: '',
    remarks: '',

    // Name of the logged-in operator who pressed Save for THIS hour. Captured
    // in saveRow() from the signed-in user; shown after Remarks, before Timestamp.
    operator_name: '',

    // Maintenance — two INDEPENDENT options, each selectable on its own, each
    // recording its OWN timestamp when selected. Shown after Operator Name.
    //   { shifter_screen: '<ISO>'|'' , atomizer_water: '<ISO>'|'' }
    // A non-empty ISO = that option is selected (with that selection time).
    maintenance: { shifter_screen: '', atomizer_water: '' },

    timestamp: '',
    saved: false,
    // Per-field entry/change times for THIS hour's fields { fieldKey: ISO }.
    __ts: {},
  }
}

// Maintenance options (label + the row.maintenance key that stores its ISO time).
const MAINTENANCE_OPTIONS = [
  { key: 'shifter_screen', label: 'Shifter-Screen Cleaning' },
  { key: 'atomizer_water', label: 'Running the Atomizer on Water' },
]

// Total Production of the Day (kg) = fine powder + crust(papadi) + startup +
// packed production. Returns a number (sum of the parsed parts; blanks = 0).
function computeTotalProduction(form) {
  var parts = ['fine_powder', 'crust_papadi', 'startup', 'packed_production']
  var sum = 0
  var any = false
  parts.forEach(function (k) {
    var n = parseFloat(form[k])
    if (Number.isFinite(n)) { sum += n; any = true }
  })
  return any ? +sum.toFixed(2) : null
}


/* Calibration sensors */
const CAL_SENSORS = [
  {
    key: 'inlet',
    label: 'Inlet',
    labelHi: 'इनलेट',
  },
  {
    key: 'outlet',
    label: 'Outlet',
    labelHi: 'आउटलेट',
  },
  {
    key: 'ifbd',
    label: 'IFBD',
    labelHi: 'आईएफबीडी',
  },
  {
    key: 'fbd',
    label: 'FBD',
    labelHi: 'एफबीडी',
  },
  {
    key: 'chamber',
    label: 'Chamber',
    labelHi: 'चैम्बर',
  },
]


function emptyForm(dryerType) {
  return {
    dryer_type: dryerType,

    date: '',
    shift: '',

    id_blower_dp: '',
    id_blower_mr: '',

    fd_blower_dp: '',
    fd_blower_mr: '',

    ifbd_dp: '',
    ifbd_mr: '',

    fbd_pct_dp: '',
    fbd_pct_mr: '',

    batch_no: '',
    calibration_due: '',

    cal_inlet_temp: '',
    cal_inlet_sensor: '',

    cal_outlet_temp: '',
    cal_outlet_sensor: '',

    cal_ifbd_temp: '',
    cal_ifbd_sensor: '',

    cal_fbd_temp: '',
    cal_fbd_sensor: '',

    cal_chamber_temp: '',
    cal_chamber_sensor: '',

    // Production breakdown — entered; Total Production is their computed sum.
    fine_powder: '',
    crust_papadi: '',
    startup: '',
    packed_production: '',

    total_production: '',   // now DERIVED = fine_powder + crust_papadi + startup + packed_production
    incharge: '',
    operator: '',

    rows: TIME_SLOTS.map(() => emptyRow()),

    // Per-field entry/change times for the bottom-form + calibration fields
    // { key: ISO }. Calibration cells use keys 'cal_<sensor>_temp' /
    // 'cal_<sensor>_sensor' (same keys as the form fields).
    __ts: {},
  }
}

/**
 * normalizeForm — guarantee a form object has a valid, complete shape.
 *
 * A draft restored from localStorage can be stale or partial (an older build,
 * a quota-truncated write, or a hand-edited value): its `rows` array may be
 * shorter than 24, or a row may be missing fields like `maintenance`,
 * `timestamp`, or `saved`. The hourly render indexes form.rows[i] for every
 * one of the 24 TIME_SLOTS and reads .saved/.colour/.timestamp, so a missing
 * or malformed row throws "cannot read property of undefined" and the whole
 * Dryer section crashes (the "could not load" screen).
 *
 * This merges whatever was restored onto a fresh emptyForm skeleton so EVERY
 * field exists and `rows` is ALWAYS exactly 24 well-formed rows. Existing
 * entered values are preserved; only missing/invalid structure is filled.
 */
function normalizeForm(raw, dryerType) {
  const base = emptyForm(dryerType)
  if (!raw || typeof raw !== 'object') return base

  const merged = { ...base, ...raw, dryer_type: raw.dryer_type || dryerType }

  // __ts must be a plain object.
  merged.__ts = (raw.__ts && typeof raw.__ts === 'object' && !Array.isArray(raw.__ts))
    ? raw.__ts
    : {}

  // rows must be exactly 24 well-formed rows, one per TIME_SLOT.
  const rawRows = Array.isArray(raw.rows) ? raw.rows : []
  merged.rows = TIME_SLOTS.map((_, i) => {
    const r = rawRows[i]
    const row = (r && typeof r === 'object' && !Array.isArray(r))
      ? { ...emptyRow(), ...r }
      : emptyRow()
    // maintenance must be an object with both option keys.
    row.maintenance = (row.maintenance && typeof row.maintenance === 'object' && !Array.isArray(row.maintenance))
      ? { shifter_screen: '', atomizer_water: '', ...row.maintenance }
      : { shifter_screen: '', atomizer_water: '' }
    // __ts per row must be a plain object.
    row.__ts = (row.__ts && typeof row.__ts === 'object' && !Array.isArray(row.__ts))
      ? row.__ts
      : {}
    return row
  })

  return merged
}


const BLOWERS = [
  {
    label: 'ID Blower',
    labelHi: 'आईडी ब्लोअर',
    dp: 'id_blower_dp',
    mr: 'id_blower_mr',
  },
  {
    label: 'FD Blower',
    labelHi: 'एफडी ब्लोअर',
    dp: 'fd_blower_dp',
    mr: 'fd_blower_mr',
  },
  {
    label: 'IFBD',
    labelHi: 'आईएफबीडी',
    dp: 'ifbd_dp',
    mr: 'ifbd_mr',
  },
  {
    label: 'FBD %',
    labelHi: 'एफबीडी %',
    dp: 'fbd_pct_dp',
    mr: 'fbd_pct_mr',
  },
]


function DryerForm({
  dryerType,
  label,
  labelHi,
  form,
  setForm,
  onClearDraft,
  onBack,
  userName,
  isDryerOperator,
}) {
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  // Repair a stale/partial restored draft ONCE on mount so the section can
  // never crash on a malformed shape (missing rows, missing nested fields).
  // normalizeForm is idempotent, so if the draft is already valid this writes
  // back an equivalent object (the one-time guard still prevents a loop).
  const normalizedRef = useRef(false)
  useEffect(() => {
    if (normalizedRef.current) return
    normalizedRef.current = true
    setForm(p => normalizeForm(p, dryerType))
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // Safe snapshot for THIS render. Even before the normalization effect above
  // commits, reads below go through this guaranteed-complete 24-row shape, so
  // the very first render of a malformed draft cannot throw either.
  const safeForm = normalizeForm(form, dryerType)

  // Auto-fill the Operator box with the logged-in user's name ONLY when they
  // signed in as a Dryer Operator. An admin (or any other role) viewing the
  // dryer section must NOT have their name injected — they fill it manually.
  // Only prefill when the box is still empty so a name the operator typed (or a
  // restored draft value) is never overwritten, and it never re-runs per render.
  useEffect(() => {
    if (!isDryerOperator || !userName) return
    setForm(p => (p.operator ? p : { ...p, operator: userName }))
  }, [isDryerOperator, userName])  // eslint-disable-line react-hooks/exhaustive-deps

  // Per-row shared-save state (SEPARATE from the form-level `error`
  // used by Save Log Sheet, to avoid collision):
  //   rowSaving[i] — the per-hour upsert for row i is in flight
  //   rowErrors[i] — the last shared-save error message for row i
  const [rowSaving, setRowSaving] = useState({})
  const [rowErrors, setRowErrors] = useState({})

  // Transient success toast ("… saved successfully"). Positioned bottom-center
  // on mobile and bottom-right on larger screens (see .dr-toast in the CSS),
  // and auto-dismisses 3s after it is shown.
  const [toast, setToast] = useState('')
  const toastTimerRef = useRef(null)
  function showToast(message) {
    setToast(message)
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToast(''), 3000)
  }
  // Clear the pending timer if the component unmounts mid-toast.
  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
  }, [])

  // Guards the once-per-(dryer,date) cross-device load so it does not
  // thrash against useDraft's 600ms debounced localStorage writer.
  const loadedKeyRef = useRef(null)


  // Record the genuine per-field entry/change time (ISO) the FIRST time a field
  // becomes non-empty and again whenever its value genuinely changes — never the
  // sheet upload time. These maps are sent on save so the Google Sheet shows
  // each field's own Timestamp and preserves unchanged fields' original times.
  //   form.__ts          → bottom-form + calibration field times { key: ISO }
  //   row.__ts (per row) → hourly field times for that hour        { key: ISO }
  function stampTs(prevVal, nextVal, prevIso) {
    const was = (prevVal ?? '').toString().trim()
    const now = (nextVal ?? '').toString().trim()
    if (now === '') return undefined                 // cleared → drop its time
    if (was === now && prevIso) return prevIso        // unchanged → keep original
    return new Date().toISOString()                   // new or changed → now
  }

  const set = (k, v) => {
    setForm(p => {
      const prevTs = p.__ts || {}
      const iso = stampTs(p[k], v, prevTs[k])
      const nextTs = { ...prevTs }
      if (iso === undefined) delete nextTs[k]; else nextTs[k] = iso
      return { ...p, [k]: v, __ts: nextTs }
    })
  }


  const setRow = (i, field, val) => {
    setForm(p => ({
      ...p,
      rows: p.rows.map((r, idx) => {
        if (idx !== i) return r
        const prevTs = r.__ts || {}
        const iso = stampTs(r[field], val, prevTs[field])
        const nextTs = { ...prevTs }
        if (iso === undefined) delete nextTs[field]; else nextTs[field] = iso
        return {
          ...r,
          [field]: val,
          __ts: nextTs,
          // Editing a saved hour un-saves it so the ✓ reverts to 💾
          // and the hour can be re-saved (last-write-wins).
          saved: false,
        }
      }),
    }))
  }


  // Toggle a maintenance option for hour i. Selecting stamps that option's OWN
  // timestamp (now); unselecting clears it. Both options are independent — the
  // user can select one, the other, or both. Editing un-saves the hour.
  const toggleMaintenance = (i, optKey) => {
    setForm(p => ({
      ...p,
      rows: p.rows.map((r, idx) => {
        if (idx !== i) return r
        const m = { ...(r.maintenance || { shifter_screen: '', atomizer_water: '' }) }
        m[optKey] = m[optKey] ? '' : new Date().toISOString()   // toggle: set now / clear
        return { ...r, maintenance: m, saved: false }
      }),
    }))
  }


  // ── Cross-device load / shift handover ──────────────────────
  // MERGE any non-expired remote hours for this (dryer, date) into the form
  // WITHOUT destroying the locally-restored draft. Purely ADDITIVE: a local row
  // that already has data is ALWAYS kept (that is the operator's own in-progress
  // or earlier work), while a remote hour fills a slot ONLY when the local row
  // for that slot is completely empty.
  //
  // This is pulled into a reusable function (instead of living inside the mount
  // effect) so it can run BOTH on mount/date-change AND on a short poll — that
  // way, when Operator A saves hours 08:00–11:00 and Operator B is already on
  // the page (same dryer + date, same OR different shift), Operator B's empty
  // slots fill in within a few seconds without a manual refresh. The data is
  // keyed on (dryer, date) only, so Day and Night operators see each other's
  // saved hours and the data survives a shift change.
  const mergeRemoteHours = useRef(null)
  mergeRemoteHours.current = async (cancelledRef) => {
    if (!supabaseReady || !supabase) return
    if (!form.date) return

    const cutoff = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString()
    // Pull EVERY non-expired saved hour for this dryer + date, regardless of
    // shift. Ordering by last_saved_at ascending means that when the same hour
    // was saved under different shifts, the most recently saved record wins (it
    // is applied last into byHour).
    let data = null
    try {
      const res = await supabase
        .from('dryer_hourly_draft')
        .select('hour, shift, values, operator, last_saved_at')
        .eq('dryer_type', dryerType)
        .eq('log_date', form.date)
        .gt('last_saved_at', cutoff)
        .order('last_saved_at', { ascending: true })
      if (res.error) return
      data = res.data
    } catch {
      // Transient network failure during a poll — ignore and try again next tick.
      return
    }

    if ((cancelledRef && cancelledRef.cancelled) || !data) return

    const byHour = {}
    data.forEach(r => { byHour[r.hour] = r })

    // Merge: keep every local row that has ANY data; only fill a truly-empty
    // local slot from a matching remote hour. NEVER blank a populated row.
    const rowIsEmpty = r =>
      !r || Object.keys(emptyRow()).every(
        k => k === 'timestamp' || k === 'saved' || k === '__ts' || (r[k] ?? '') === ''
      )

    setForm(p => {
      let changed = false
      const nextRows = TIME_SLOTS.map((slot, idx) => {
        const prev = p.rows[idx]
        // Local row has data → KEEP it as-is (restored draft / in-progress /
        // an hour this operator is currently editing). Never overwrite it.
        if (!rowIsEmpty(prev)) return prev

        const remote = byHour[slot]
        if (!remote) return prev || emptyRow()   // nothing remote → keep local (empty) row

        const base = emptyRow()
        const v = remote.values || {}
        changed = true
        return {
          ...base,
          ...v,
          // Preserve per-field entry times from the shared draft so unchanged
          // fields keep their ORIGINAL timestamp across reloads/handover.
          __ts: (v && v.__ts && typeof v.__ts === 'object') ? v.__ts : {},
          // remote rows represent an already-shared (saved) hour
          saved: true,
        }
      })
      // Avoid a needless state update (and re-render) when nothing new arrived.
      if (!changed) return p
      return { ...p, rows: nextRows }
    })
  }

  // Run the merge on mount and whenever the (dryer, date) changes, then keep it
  // fresh with a short poll so an operator who leaves the page open still sees
  // hours saved by the other operator (day/night handover included). The poll
  // is additive and cheap — a single filtered query every 15s — and it stops
  // when the section is unmounted or the date is cleared.
  useEffect(() => {
    if (!supabaseReady || !supabase) return
    if (!form.date) return

    const loadKey = `${dryerType}|${form.date}`
    loadedKeyRef.current = loadKey

    const cancelledRef = { cancelled: false }

    // Immediate merge for this (dryer, date).
    mergeRemoteHours.current(cancelledRef)

    // Poll every 15s so newly-saved hours from the other operator appear
    // without a manual refresh.
    const intervalId = setInterval(() => {
      mergeRemoteHours.current(cancelledRef)
    }, 15000)

    // Re-merge when the tab/app regains focus (operator returns to the page).
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        mergeRemoteHours.current(cancelledRef)
      }
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelledRef.cancelled = true
      clearInterval(intervalId)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [dryerType, form.date])  // eslint-disable-line react-hooks/exhaustive-deps


  // ── Per-hour Save → upsert this hour to the shared draft ────
  // ADDITIVE: Save Log Sheet (handleSubmit → dryer_logs) is unchanged.
  async function saveRow(i) {
    const hour = TIME_SLOTS[i]

    // Clear any prior error for this row
    setRowErrors(prev => {
      const next = { ...prev }
      delete next[i]
      return next
    })

    if (!supabaseReady || !supabase) {
      setRowErrors(prev => ({ ...prev, [i]: 'Supabase not configured.' }))
      return
    }
    if (!form.date) {
      setRowErrors(prev => ({ ...prev, [i]: 'Set the production date first.' }))
      return
    }
    // Shift is part of the record identity (dryer, date, shift, hour). Requiring
    // it before save prevents a row from silently landing under the wrong/empty
    // shift (the root cause of the mismatched 21-10 Night vs 22-10 Day rows).
    if (!form.shift) {
      setRowErrors(prev => ({ ...prev, [i]: 'Select the shift (Day/Night) first.' }))
      return
    }

    const row = (form.rows && form.rows[i]) ? form.rows[i] : emptyRow()
    const { timestamp: _ts, saved: _sv, ...fields } = row
    const ts = stamp12hr()
    // The operator who pressed Save for THIS hour = the logged-in user's name
    // (falls back to the form's Operator box, then the row's existing value).
    const savedBy = userName || form.operator || fields.operator_name || ''

    setRowSaving(prev => ({ ...prev, [i]: true }))

    // Wrap the whole network call in try/catch. supabase-js RESOLVES with
    // { error } for a clean PostgREST error, but it REJECTS (throws) when the
    // HTTP request itself fails — e.g. a dropped mobile connection surfaces as
    // "TypeError: Failed to fetch". Without this catch, that rejection would be
    // unhandled: the spinner would stick, no error would show, and the user
    // could not tell the save failed. We catch it, show a meaningful message,
    // clear the spinner, and — crucially — NEVER touch form.rows, so every
    // entered value stays intact and the row remains re-savable.
    let err = null
    try {
      const res = await supabase
        .from('dryer_hourly_draft')
        .upsert(
          {
            dryer_type: dryerType,
            log_date: form.date,
            hour,
            shift: form.shift,
            operator: form.operator || userName || null,
            // timestamp is display-only (en-IN); never used for expiry/order.
            // operator_name = who pressed Save for this hour (per-row).
            values: { ...fields, operator_name: savedBy, timestamp: ts },
            updated_at: new Date().toISOString(),
            last_saved_at: new Date().toISOString(),
          },
          // Identity now includes shift, matching the Google Sheet row key
          // (H|date|shift|hour) and the widened Supabase unique key (migration
          // 037). Day and Night for the same (dryer, date, hour) are distinct
          // records and never overwrite each other.
          { onConflict: 'dryer_type,log_date,hour,shift' }
        )
      err = res && res.error ? res.error : null
    } catch (e) {
      // Network/transport failure (e.g. "Failed to fetch") or any thrown error.
      err = e
    }

    setRowSaving(prev => {
      const next = { ...prev }
      delete next[i]
      return next
    })

    if (err) {
      // Do NOT mark the row saved and do NOT touch form.rows — leave every
      // entered value intact and the row re-savable for retry.
      const msg = (err && err.message)
        ? err.message
        : (typeof err === 'string' ? err : 'Save failed. Please check your connection and try again.')
      setRowErrors(prev => ({ ...prev, [i]: msg }))
      return
    }

    // Success — stamp timestamp + operator name + mark saved locally. Guard the
    // rows map so a transient malformed state can never throw here.
    setForm(p => ({
      ...p,
      rows: (Array.isArray(p.rows) ? p.rows : []).map((r, idx) =>
        idx === i ? { ...(r || emptyRow()), operator_name: savedBy, timestamp: ts, saved: true } : r
      ),
    }))
    showToast('Data saved successfully')
  }


  async function handleSubmit(e) {
    e.preventDefault()

    if (!supabaseReady) {
      setError('Supabase not configured.')
      return
    }

    setSaving(true)
    setError('')
    setSaved(false)

    const { error: err } = await supabase
      .from('dryer_logs')
      .insert([
        {
          dryer_type: form.dryer_type,

          date: form.date || null,
          shift: form.shift,

          id_blower_dp: form.id_blower_dp,
          id_blower_mr: form.id_blower_mr,

          fd_blower_dp: form.fd_blower_dp,
          fd_blower_mr: form.fd_blower_mr,

          chamber_dp: form.ifbd_dp,
          chamber_mr: form.ifbd_mr,

          fbd_pct_dp: form.fbd_pct_dp,
          fbd_pct_mr: form.fbd_pct_mr,

          batch_no: form.batch_no,

          calibration_due:
            form.calibration_due || null,

          calibration_sensors: CAL_SENSORS.reduce(
            (acc, s) => ({
              ...acc,
              [s.key]: {
                temp: form[`cal_${s.key}_temp`],
                sensor: form[`cal_${s.key}_sensor`],
              },
            }),
            {}
          ),

          // Production breakdown (entered) — sent so the sheet shows each part.
          fine_powder:       form.fine_powder,
          crust_papadi:      form.crust_papadi,
          startup:           form.startup,
          packed_production: form.packed_production,

          // Total Production of the Day = sum of the four parts (derived).
          total_production: computeTotalProduction(form),

          incharge: form.incharge,
          operator: form.operator,

          log_rows: form.rows,

          // Per-field entry/change times for the bottom-form + calibration
          // fields { key: ISO }. The sheet sync renders each field's own
          // Timestamp from this and preserves unchanged fields' original time.
          // (Hourly per-field times ride inside each log_rows[i].__ts.)
          //
          // IMPORTANT key remap: the IFBD blower inputs use the form keys
          // 'ifbd_dp'/'ifbd_mr', but they are SAVED into the DB columns
          // 'chamber_dp'/'chamber_mr' (above). The sync trigger looks up the
          // timestamp by the DB column key, so we copy the IFBD times under the
          // chamber_* keys here — otherwise IFBD DP/MR would show no timestamp.
          field_ts: (function () {
            const t = { ...(form.__ts || {}) }
            if (t.ifbd_dp && !t.chamber_dp) t.chamber_dp = t.ifbd_dp
            if (t.ifbd_mr && !t.chamber_mr) t.chamber_mr = t.ifbd_mr
            return t
          })(),
        },
      ])

    setSaving(false)

    if (err) {
      setError(err.message)
    } else {
      setSaved(true)
      showToast('Log sheet saved successfully')
      // Reset EVERYTHING after a successful Save Log Sheet: clear the
      // localStorage draft and reset the form to a blank emptyForm (all hourly
      // rows, blower/footer/calibration fields, date and shift). Also clear the
      // per-hour save/error state and release the cross-device load guard so a
      // later re-selection of the same date can reload fresh from the server.
      onClearDraft()
      setRowSaving({})
      setRowErrors({})
      loadedKeyRef.current = null
    }
  }

  /*
   * IMPORTANT:
   *
   * These are normal render functions, NOT React components.
   *
   * The old code had:
   *
   * const NC = (...) => (...)
   *
   * inside DryerForm.
   *
   * Because NC was recreated on every render, React could
   * remount the input after every keystroke and the cursor
   * would disappear.
   *
   * These functions return the input directly and therefore
   * preserve focus while typing.
   */


  const renderNC = (field, ri) => {

    const isTemperature =
      field === 'temp_inlet' ||
      field === 'temp_outlet' ||
      field === 'temp_actual' ||
      field === 'temp_fbd1' ||
      field === 'temp_fbd2' ||
      field === 'temp_chamber'


    return (
      <td
        key={`${field}-${ri}`}
        className={
          isTemperature
            ? 'dr-temp-cell'
            : ''
        }
      >

        <input
          type="number"
          inputMode="numeric"
          className={
            isTemperature
              ? 'dr-cell-input dr-temp-input'
              : 'dr-cell-input'
          }
          placeholder="—"
          value={safeForm.rows[ri][field]}
          onChange={e =>
            setRow(
              ri,
              field,
              e.target.value
            )
          }
        />

      </td>
    )
  }


  const renderTC = (field, ri) => (
    <td key={`${field}-${ri}`}>

      <input
        type="text"
        className="dr-cell-input"
        placeholder="—"
        value={safeForm.rows[ri][field]}
        onChange={e =>
          setRow(
            ri,
            field,
            e.target.value
          )
        }
      />

    </td>
  )


  return (
    <div className="dr-form-wrapper">

      {/* ── Title ── */}

      <div className="dr-title-bar">

        {onBack && (
          <button type="button" className="dr-back-btn" onClick={onBack}>
            ← Back / वापस
          </button>
        )}

        <div className="dr-title-main">

          {label}

          {' — LOG SHEET / '}

          <span className="dr-title-hi">
            {labelHi} — लॉग शीट
          </span>

        </div>

      </div>


      <form onSubmit={handleSubmit}>

        {/* ── Meta ── */}

        <div className="dr-meta-bar">

          <div className="dr-meta-field">

            <label className="dr-label">

              Date /{' '}

              <span className="dr-label-hi">
                तारीख
              </span>

            </label>

            <input
              type="date"
              className="dr-input"
              value={form.date}
              onChange={e =>
                set(
                  'date',
                  e.target.value
                )
              }
            />

          </div>


          <div className="dr-meta-field">

            <label className="dr-label">

              Shift /{' '}

              <span className="dr-label-hi">
                पाली
              </span>

            </label>

            <select
              className="dr-input"
              value={form.shift}
              onChange={e =>
                set(
                  'shift',
                  e.target.value
                )
              }
            >

              <option value="">
                — Select / चुनें —
              </option>

              <option value="Day">
                Day / दिन
              </option>

              <option value="Night">
                Night / रात
              </option>

            </select>

          </div>

        </div>


        {/* ═══════════════════════════════════════
            LOG TABLE
            ═══════════════════════════════════════ */}

        <div className="dr-table-section">

          <div className="dr-table-scroll">

            <table className="dr-table">

              {/* ==================================================
                  FIXED COLUMN STRUCTURE
                  ================================================== */}

              <colgroup>

                {/* Time */}

                <col
                  className="dr-col-time"
                />


                {/* Temperature group 1 */}

                <col
                  className="dr-col-temp"
                />

                <col
                  className="dr-col-temp"
                />

                <col
                  className="dr-col-temp"
                />


                {/* Temperature group 2 */}

                <col
                  className="dr-col-temp"
                />

                <col
                  className="dr-col-temp"
                />

                <col
                  className="dr-col-temp"
                />


                {/* Other columns: atomizer, feed_fc, C.Pressure, pressure, pt_temp */}

                <col
                  className="dr-col-normal"
                />

                <col
                  className="dr-col-normal"
                />

                {/* C.Pressure */}
                <col
                  className="dr-col-normal"
                />

                <col
                  className="dr-col-normal"
                />

                <col
                  className="dr-col-normal"
                />

                <col
                  className="dr-col-text"
                />

                <col
                  className="dr-col-normal"
                />

                <col
                  className="dr-col-normal"
                />

                <col
                  className="dr-col-normal"
                />

                <col
                  className="dr-col-text"
                />

                <col
                  className="dr-col-text"
                />

                <col
                  className="dr-col-remarks"
                />

                {/* Operator Name (read-only; who pressed Save for this hour) */}
                <col
                  className="dr-col-text"
                />

                {/* Maintenance (two selectable options with their own times) */}
                <col
                  className="dr-col-maint"
                />

                <col
                  className="dr-col-timestamp"
                />

                <col
                  className="dr-col-save"
                />

              </colgroup>


              <thead>

                {/* ── Header row 1 ── */}

                <tr className="dr-thead-r1">

                  <th
                    className="dr-th-time"
                    rowSpan={2}
                  >

                    Time

                    <br />

                    <span className="dr-hi">
                      समय
                    </span>

                  </th>


                  {/* FIRST TEMPERATURE GROUP */}

                  <th
                    className="dr-temperature-group"
                    colSpan={3}
                  >

                    Temperature Deg. Cent.

                    <br />

                    <span className="dr-hi">
                      तापमान (°C)
                    </span>

                  </th>


                  {/* SECOND TEMPERATURE GROUP */}

                  <th
                    className="dr-temperature-group"
                    colSpan={3}
                  >

                    Temperature Deg. Cent.

                    <br />

                    <span className="dr-hi">
                      तापमान (°C)
                    </span>

                  </th>


                  <th rowSpan={2}>

                    Atomizer Freq.

                    <br />

                    <span className="dr-hi">
                      एटमाइज़र फ्रीक्वेंसी
                    </span>

                  </th>


                  <th rowSpan={2}>

                    Feed F.C.

                    <br />

                    <span className="dr-hi">
                      फीड एफ.सी.
                    </span>

                  </th>


                  <th rowSpan={2}>

                    C.Pressure

                    <br />

                    <span className="dr-hi">
                      सी. दबाव
                    </span>

                  </th>


                  <th rowSpan={2}>

                    Feed Pressure

                    <br />

                    <span className="dr-hi">
                      फीड दबाव
                    </span>

                  </th>


                  <th rowSpan={2}>

                    Pt. Temp

                    <br />

                    <span className="dr-hi">
                      पीटी. तापमान
                    </span>

                  </th>


                  <th rowSpan={2}>

                    Batch No.

                    <br />

                    <span className="dr-hi">
                      बैच नं.
                    </span>

                  </th>


                  <th rowSpan={2}>

                    No. of Bag Per Hours

                    <br />

                    <span className="dr-hi">
                      बैग प्रति घंटा
                    </span>

                  </th>


                  <th rowSpan={2}>

                    Bag Size By Wt.

                    <br />

                    <span className="dr-hi">
                      बैग का वजन
                    </span>

                  </th>


                  <th rowSpan={2}>

                    Kg./Hour Production

                    <br />

                    <span className="dr-hi">
                      किग्रा/घंटा
                    </span>

                  </th>


                  <th rowSpan={2}>

                    Colour/Normal/OMRI

                    <br />

                    <span className="dr-hi">
                      रंग/सामान्य
                    </span>

                  </th>


                  <th rowSpan={2}>

                    I.D. Frequency

                    <br />

                    <span className="dr-hi">
                      आईडी फ्रीक्वेंसी
                    </span>

                  </th>


                  <th rowSpan={2}>

                    Remarks

                    <br />

                    <span className="dr-hi">
                      टिप्पणी
                    </span>

                  </th>


                  <th rowSpan={2}>

                    Operator Name

                    <br />

                    <span className="dr-hi">
                      ऑपरेटर का नाम
                    </span>

                  </th>


                  <th rowSpan={2}>

                    Maintenance

                    <br />

                    <span className="dr-hi">
                      रखरखाव
                    </span>

                  </th>


                  <th rowSpan={2}>

                    Timestamp

                    <br />

                    <span className="dr-hi">
                      समय टिकट
                    </span>

                  </th>


                  <th rowSpan={2}>

                    Save

                    <br />

                    <span className="dr-hi">
                      सहेजें
                    </span>

                  </th>

                </tr>


                {/* ── Header row 2 ── */}

                <tr className="dr-thead-r2">

                  <th className="dr-temp-subheader">

                    Inlet

                    <br />

                    <span className="dr-hi">
                      इनलेट
                    </span>

                  </th>


                  <th className="dr-temp-subheader">

                    Outlet

                    <br />

                    <span className="dr-hi">
                      आउटलेट
                    </span>

                  </th>


                  <th className="dr-temp-subheader">

                    Actual

                    <br />

                    <span className="dr-hi">
                      वास्तविक
                    </span>

                  </th>


                  <th className="dr-temp-subheader">
                    IFBD
                  </th>


                  <th className="dr-temp-subheader">
                    FBD
                  </th>


                  <th className="dr-temp-subheader">

                    Chamber

                    <br />

                    <span className="dr-hi">
                      चैम्बर
                    </span>

                  </th>

                </tr>

              </thead>


              <tbody>

                {TIME_SLOTS.map((slot, i) => (

                  <tr
                    key={slot}
                    className={`
                      ${i % 2 === 0
                        ? ''
                        : 'dr-tr-alt'
                      }
                      ${
                        safeForm.rows[i].saved
                          ? 'dr-row-saved'
                          : ''
                      }
                    `}
                  >

                    {/* Time */}

                    <td className="dr-td-time">
                      {slot}
                    </td>


                    {/* ==================================================
                        TEMPERATURE COLUMNS
                        ================================================== */}

                    {renderNC(
                      'temp_inlet',
                      i
                    )}

                    {renderNC(
                      'temp_outlet',
                      i
                    )}

                    {renderNC(
                      'temp_actual',
                      i
                    )}

                    {renderNC(
                      'temp_fbd1',
                      i
                    )}

                    {renderNC(
                      'temp_fbd2',
                      i
                    )}

                    {renderNC(
                      'temp_chamber',
                      i
                    )}


                    {/* Other numeric fields */}

                    {renderNC(
                      'atomizer_freq',
                      i
                    )}

                    {renderNC(
                      'feed_fc',
                      i
                    )}

                    {renderNC(
                      'c_pressure',
                      i
                    )}

                    {renderNC(
                      'pressure',
                      i
                    )}

                    {renderNC(
                      'pt_temp',
                      i
                    )}


                    {/* Text fields */}

                    {renderTC(
                      'batch_no',
                      i
                    )}

                    {renderNC(
                      'bags_per_hr',
                      i
                    )}

                    {renderNC(
                      'bag_size_wt',
                      i
                    )}

                    {renderNC(
                      'kg_per_hr',
                      i
                    )}

                    {/* Colour/Normal/OMRI — per-row dropdown */}
                    <td>
                      <select
                        className="dr-cell-input"
                        value={safeForm.rows[i].colour}
                        onChange={e => setRow(i, 'colour', e.target.value)}
                      >
                        <option value="">—</option>
                        <option value="Colour">Colour</option>
                        <option value="OMRI">OMRI</option>
                        <option value="Normal">Normal</option>
                      </select>
                    </td>

                    {renderTC(
                      'id_frequency',
                      i
                    )}

                    {renderTC(
                      'remarks',
                      i
                    )}


                    {/* Operator Name — read-only; the logged-in user who pressed
                        Save for this hour (set in saveRow). Shown after Remarks,
                        before Timestamp. */}
                    <td className="dr-td-operator">
                      {safeForm.rows[i].operator_name ? (
                        <span className="dr-operator-badge">
                          {safeForm.rows[i].operator_name}
                        </span>
                      ) : (
                        <span className="dr-ts-empty">—</span>
                      )}
                    </td>


                    {/* Maintenance — two independent options; selecting one stamps
                        its own time shown beside it. Both can be selected. */}
                    <td className="dr-td-maint">
                      {MAINTENANCE_OPTIONS.map(opt => {
                        const iso = (safeForm.rows[i].maintenance || {})[opt.key] || ''
                        const selected = !!iso
                        return (
                          <label key={opt.key} className="dr-maint-opt">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleMaintenance(i, opt.key)}
                            />
                            <span className="dr-maint-label">{opt.label}</span>
                            {selected && (() => {
                              // Guard against a stored value that is not a valid
                              // ISO date (older drafts / corrupt state): an
                              // Invalid Date would otherwise render "Invalid
                              // Date" or throw in some engines.
                              const d = new Date(iso)
                              const label = isNaN(d.getTime())
                                ? ''
                                : d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })
                              return label ? <span className="dr-maint-time">{label}</span> : null
                            })()}
                          </label>
                        )
                      })}
                    </td>


                    {/* Timestamp */}

                    <td className="dr-td-ts">

                      {safeForm.rows[i].timestamp ? (

                        <span className="dr-ts-badge">
                          {safeForm.rows[i].timestamp}
                        </span>

                      ) : (

                        <span className="dr-ts-empty">
                          —
                        </span>

                      )}

                    </td>


                    {/* Save */}

                    <td className="dr-td-save">

                      <button
                        type="button"
                        className="dr-row-save-btn"
                        disabled={!!rowSaving[i]}
                        title={safeForm.rows[i].saved ? 'Saved — click to re-save this hour' : 'Save this hour'}
                        onClick={() => saveRow(i)}
                      >
                        {rowSaving[i] ? '…' : safeForm.rows[i].saved ? '✓' : '💾'}
                      </button>

                      {rowErrors[i] && (
                        <div className="dr-row-save-err" title={rowErrors[i]}>
                          {rowErrors[i]}
                        </div>
                      )}

                    </td>

                  </tr>

                ))}

              </tbody>

            </table>

          </div>

        </div>


        {/* ══ BLOWER BAR ══ */}

        <div className="dr-blower-bar">

          {BLOWERS.map(b => (

            <div
              key={b.label}
              className="dr-blower-card"
            >

              <div className="dr-blower-title">

                {b.label}

                <br />

                <span className="dr-blower-hi">
                  {b.labelHi}
                </span>

              </div>


              <div className="dr-blower-row">

                <span className="dr-blower-sub">
                  DP
                </span>

                <input
                  type="number"
                  className="dr-input dr-input-sm"
                  placeholder="—"
                  value={form[b.dp]}
                  onChange={e => set(b.dp, e.target.value)}
                />

              </div>


              <div className="dr-blower-row">

                <span className="dr-blower-sub">
                  MR
                </span>

                <input
                  type="number"
                  className="dr-input dr-input-sm"
                  placeholder="—"
                  value={form[b.mr]}
                  onChange={e => set(b.mr, e.target.value)}
                />

              </div>

            </div>

          ))}

        </div>


        {/* ══ FOOTER ══ */}

        <div className="dr-footer-bar">

          {/* Batch */}

          <div className="dr-footer-field">

            <label className="dr-label">

              Batch No. /{' '}

              <span className="dr-label-hi">
                बैच नं.
              </span>

            </label>

            <input
              className="dr-input"
              placeholder="Batch number / बैच नंबर"
              value={form.batch_no}
              onChange={e =>
                set(
                  'batch_no',
                  e.target.value
                )
              }
            />

          </div>


          {/* Calibration */}

          <div className="dr-footer-field dr-footer-cal">

            <label className="dr-label">

              Calibration Due Date /{' '}

              <span className="dr-label-hi">
                कैलिब्रेशन तारीख
              </span>

            </label>

            <input
              type="date"
              className="dr-input"
              style={{
                marginBottom: '8px',
              }}
              value={form.calibration_due}
              onChange={e =>
                set(
                  'calibration_due',
                  e.target.value
                )
              }
            />


            <details className="dr-cal-details">

              <summary className="dr-cal-summary">

                Sensor Calibration Values /{' '}

                <span
                  style={{
                    fontWeight: '400',
                    fontSize: '11px',
                  }}
                >
                  सेंसर कैलिब्रेशन मान
                </span>

              </summary>


              <table className="dr-cal-table">

                <thead>

                  <tr>

                    <th></th>

                    <th>

                      Temperature /{' '}

                      <span className="dr-hi">
                        तापमान
                      </span>

                    </th>

                    <th>

                      Sensor Value /{' '}

                      <span className="dr-hi">
                        सेंसर मान
                      </span>

                    </th>

                  </tr>

                </thead>


                <tbody>

                  {CAL_SENSORS.map(s => (

                    <tr key={s.key}>

                      <td className="dr-cal-label">

                        {s.label}

                        <br />

                        <span className="dr-hi">
                          {s.labelHi}
                        </span>

                      </td>


                      <td>

                        {/* Temperature - NUMERIC ONLY */}

                        <input
                          type="text"
                          inputMode="decimal"
                          className="dr-input dr-cal-input"
                          placeholder="—"
                          value={
                            form[
                              `cal_${s.key}_temp`
                            ]
                          }
                          onChange={e => {
                            const value = e.target.value

                            // Allow only numbers and one decimal point
                            if (/^\d*\.?\d*$/.test(value)) {
                              set(
                                `cal_${s.key}_temp`,
                                value
                              )
                            }
                          }}
                        />

                      </td>


                      <td>

                        {/* Sensor Value - NUMERIC ONLY */}

                        <input
                          type="text"
                          inputMode="decimal"
                          className="dr-input dr-cal-input"
                          placeholder="—"
                          value={
                            form[
                              `cal_${s.key}_sensor`
                            ]
                          }
                          onChange={e => {
                            const value = e.target.value

                            // Allow only numbers and one decimal point
                            if (/^\d*\.?\d*$/.test(value)) {
                              set(
                                `cal_${s.key}_sensor`,
                                value
                              )
                            }
                          }}
                        />

                      </td>

                    </tr>

                  ))}

                </tbody>

              </table>

            </details>

          </div>


          {/* Total Production of the Day — computed = fine powder + crust
              (papadi) + startup + packed production, shown as a formula bar. */}
          <div className="dr-footer-field dr-footer-total">

            <label className="dr-label">

              Total Production of the Day (kg) /{' '}

              <span className="dr-label-hi">
                दिन का कुल उत्पादन
              </span>

            </label>

            <div className="dr-total-formula">

              <div className="dr-total-part">
                <span className="dr-total-part-label">Fine Powder (kg)</span>
                <input
                  type="number"
                  className="dr-total-input"
                  placeholder="0"
                  value={form.fine_powder}
                  onChange={e => set('fine_powder', e.target.value)}
                />
              </div>

              <span className="dr-total-op">+</span>

              <div className="dr-total-part">
                <span className="dr-total-part-label">Crust (Papadi) (kg)</span>
                <input
                  type="number"
                  className="dr-total-input"
                  placeholder="0"
                  value={form.crust_papadi}
                  onChange={e => set('crust_papadi', e.target.value)}
                />
              </div>

              <span className="dr-total-op">+</span>

              <div className="dr-total-part">
                <span className="dr-total-part-label">Startup (kg)</span>
                <input
                  type="number"
                  className="dr-total-input"
                  placeholder="0"
                  value={form.startup}
                  onChange={e => set('startup', e.target.value)}
                />
              </div>

              <span className="dr-total-op">+</span>

              <div className="dr-total-part">
                <span className="dr-total-part-label">Packed Production (kg)</span>
                <input
                  type="number"
                  className="dr-total-input"
                  placeholder="0"
                  value={form.packed_production}
                  onChange={e => set('packed_production', e.target.value)}
                />
              </div>

              <span className="dr-total-op">=</span>

              <div className="dr-total-result">
                <span className="dr-total-result-label">Total</span>
                <span className="dr-total-result-value">
                  {(computeTotalProduction(form) ?? 0).toFixed(2)}
                </span>
              </div>

            </div>

          </div>


          {/* Incharge */}

          <div className="dr-footer-field">

            <label className="dr-label">

              Incharge /{' '}

              <span className="dr-label-hi">
                इंचार्ज
              </span>

            </label>

            <input
              className="dr-input"
              placeholder="Name / नाम"
              value={form.incharge}
              onChange={e =>
                set(
                  'incharge',
                  e.target.value
                )
              }
            />

          </div>


          {/* Operator */}

          <div className="dr-footer-field">

            <label className="dr-label">

              Operator /{' '}

              <span className="dr-label-hi">
                ऑपरेटर
              </span>

            </label>

            <input
              className="dr-input"
              placeholder="Name / नाम"
              value={form.operator}
              onChange={e =>
                set(
                  'operator',
                  e.target.value
                )
              }
            />

          </div>

        </div>


        {/* ══ ACTIONS ══ */}

        <div className="dr-actions">

          {error && (
            <div className="dr-error">
              Error: {error}
            </div>
          )}


          {saved && (
            <div className="dr-success">
              ✓ Saved successfully /
              सफलतापूर्वक सहेजा गया
            </div>
          )}


          <button
            type="submit"
            className="dr-save-btn"
            disabled={saving}
          >

            {saving
              ? 'Saving…'
              : 'Save Log Sheet / लॉग शीट सहेजें'}

          </button>


          <button
            type="button"
            className="dr-reset-btn"
            onClick={() => {
              onClearDraft()
              setSaved(false)
              setError('')

            }}
          >

            Reset / रीसेट

          </button>

        </div>

      </form>

      {toast && (
        <div className="dr-toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}

    </div>
  )
}


export default function DryerSection({ user }) {
  const uid = useUserId()

  // Only a user whose role is exactly "Dryer Operator" gets their name
  // auto-filled into the Operator box. Admins and other roles do not.
  const isDryerOperator = user?.role === 'Dryer Operator'

  // null → selection screen; 'new' / 'old' → that dryer's form
  const [activeTab, setActiveTab] = useState(null)

  const [formNew, setFormNew, clearFormNewDraft] =
    useDraft(`draft:${uid}:dryer:formNew`, emptyForm('new'))

  const [formOld, setFormOld, clearFormOldDraft] =
    useDraft(`draft:${uid}:dryer:formOld`, emptyForm('old'))

  const goBack = () => setActiveTab(null)


  return (

    <div className="dr-wrapper">

      {/* ── Selection screen — two large rounded blocks ── */}
      {activeTab === null && (
        <div className="dr-select-screen">
          <div className="dr-select-heading">
            Select Dryer / <span className="dr-select-heading-hi">ड्रायर चुनें</span>
          </div>

          <button
            type="button"
            className="dr-select-block"
            onClick={() => setActiveTab('new')}
          >
            <span className="dr-select-block-text">
              <span className="dr-select-block-en">New Dryer</span>
              <span className="dr-select-block-hi">नया ड्रायर</span>
            </span>
          </button>

          <button
            type="button"
            className="dr-select-block"
            onClick={() => setActiveTab('old')}
          >
            <span className="dr-select-block-text">
              <span className="dr-select-block-en">Old Dryer</span>
              <span className="dr-select-block-hi">पुराना ड्रायर</span>
            </span>
          </button>
        </div>
      )}

      {/* ── Forms — both stay mounted so each dryer keeps its data ── */}
      <div className="dr-content">

        {/* New Dryer */}
        <div style={{ display: activeTab === 'new' ? 'block' : 'none' }}>
          <DryerForm
            dryerType="new"
            label="New Dryer"
            labelHi="नया ड्रायर"
            form={formNew}
            setForm={setFormNew}
            onClearDraft={clearFormNewDraft}
            onBack={goBack}
            userName={user?.name ?? ''}
            isDryerOperator={isDryerOperator}
          />
        </div>

        {/* Old Dryer */}
        <div style={{ display: activeTab === 'old' ? 'block' : 'none' }}>
          <DryerForm
            dryerType="old"
            label="Old Dryer"
            labelHi="पुराना ड्रायर"
            form={formOld}
            setForm={setFormOld}
            onClearDraft={clearFormOldDraft}
            onBack={goBack}
            userName={user?.name ?? ''}
            isDryerOperator={isDryerOperator}
          />
        </div>

      </div>

    </div>
  )
}