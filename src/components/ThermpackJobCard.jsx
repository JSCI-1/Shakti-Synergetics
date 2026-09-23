import React, { useState } from 'react'
import { supabase, supabaseReady } from '../supabaseClient'
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
    timestamp: '',
    saved: false,
  }
}

function emptyMotorEntry() {
  return {
    val: '',
    stop: '',
  }
}

function emptyForm() {
  return {
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

    // Additional common entries from physical form
    outlet_set_temp: '',
    expansion_tank_level: '',
    type_of_fuel: '',
    qty_fuel_used: '',

    // Changed from fuel_supplier
    date_of_last_boiler_cleaning: '',

    total_running_hrs: '',
    consumption_per_hr: '',
    total_consumption: '',
    total_clinker_wt: '',
    dryer_in_use: '',

    log_variant: '10L',

    rows_10l: TIME_SLOTS.map(() => emptyRow()),
    rows_6l: TIME_SLOTS.map(() => emptyRow()),

    remarks: '',
  }
}

function emptyMotorForm() {
  return {
    running_date: new Date().toISOString().slice(0, 10),
    checked_by: '',
    remark: '',
    motors: MOTORS.map(() => emptyMotorEntry()),
  }
}

// Format date value (yyyy-mm-dd) → dd/mm/yyyy for display label
function fmtDate(val) {
  if (!val) return ''

  const [y, m, d] = val.split('-')

  return `${d}/${m}/${y}`
}

export default function ThermpackJobCard() {
  const [form, setForm] = useState(emptyForm())
  const [motorForm, setMotorForm] = useState(emptyMotorForm())
  const [motorOpen, setMotorOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedMain, setSavedMain] = useState(false)
  const [savedMotor, setSavedMotor] = useState(false)
  const [error, setError] = useState('')

  const set = (name, value) =>
    setForm(prev => ({
      ...prev,
      [name]: value,
    }))

  // Numeric fields:
  // Allows only numbers and decimal values.
  // Empty value is also allowed.
  const setNumeric = (name, value) => {
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      set(name, value)
    }
  }

  // setRow targets the currently active variant's rows
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
            }
          : r
      ),
    }))
  }

  // stamp time on active variant
  function saveRow(i) {
    const now = new Date()

    const ts = now.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })

    const key = form.log_variant === '10L'
      ? 'rows_10l'
      : 'rows_6l'

    setForm(prev => ({
      ...prev,
      [key]: prev[key].map((r, idx) =>
        idx === i
          ? {
              ...r,
              timestamp: ts,
              saved: true,
            }
          : r
      ),
    }))
  }

  // active rows for rendering
  const activeRows =
    form.log_variant === '10L'
      ? form.rows_10l
      : form.rows_6l

  const setMotorCell = (mi, key, value) =>
    setMotorForm(prev => ({
      ...prev,
      motors: prev.motors.map((m, idx) =>
        idx === mi
          ? {
              ...m,
              [key]: value,
            }
          : m
      ),
    }))

  async function handleSubmit(e) {
    e.preventDefault()

    if (!supabaseReady) {
      setError('Supabase not configured.')
      return
    }

    setSaving(true)
    setError('')
    setSavedMain(false)

    const payload = {
      date: form.date || null,

      shift: form.shift,
      operator: form.operator,

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
      outlet_set_temp: form.outlet_set_temp
        ? parseFloat(form.outlet_set_temp)
        : null,

      expansion_tank_level: form.expansion_tank_level,

      type_of_fuel: form.type_of_fuel,

      qty_fuel_used: form.qty_fuel_used,

      // Changed from fuel_supplier
      date_of_last_boiler_cleaning:
        form.date_of_last_boiler_cleaning || null,

      total_running_hrs: form.total_running_hrs
        ? parseFloat(form.total_running_hrs)
        : null,

      consumption_per_hr: form.consumption_per_hr
        ? parseFloat(form.consumption_per_hr)
        : null,

      total_consumption: form.total_consumption
        ? parseFloat(form.total_consumption)
        : null,

      total_clinker_wt: form.total_clinker_wt
        ? parseFloat(form.total_clinker_wt)
        : null,

      dryer_in_use: form.dryer_in_use,

      log_variant: form.log_variant,

      log_rows_10l: form.rows_10l,

      log_rows_6l: form.rows_6l,

      remarks: form.remarks,
    }

    const { error: e1 } = await supabase
      .from('thermopack_job_cards')
      .insert([payload])

    setSaving(false)

    if (e1) {
      setError(e1.message)
    } else {
      setSavedMain(true)
      setForm(emptyForm())
    }
  }

  async function handleMotorSubmit(e) {
    e.preventDefault()

    if (!supabaseReady) {
      setError('Supabase not configured.')
      return
    }

    setSaving(true)
    setError('')
    setSavedMotor(false)

    const { error: e2 } = await supabase
      .from('motor_amp_status')
      .insert([
        {
          running_date: motorForm.running_date || null,
          checked_by: motorForm.checked_by,
          remark: motorForm.remark,
          motor_data: motorForm.motors,
        },
      ])

    setSaving(false)

    if (e2) {
      setError(e2.message)
    } else {
      setSavedMotor(true)
      setMotorForm(emptyMotorForm())
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

          <table className="tjc-table">

            <thead>
              <tr>
                <th>
                  Date
                  <br />
                  <span className="hi">
                    तारीख
                  </span>
                </th>

                <th>
                  Shift
                  <br />
                  <span className="hi">
                    पाली
                  </span>
                </th>

                <th>
                  Operator
                  <br />
                  <span className="hi">
                    ऑपरेटर
                  </span>
                </th>

                <th>
                  Helper 1
                  <br />
                  <span className="hi">
                    हेल्पर १
                  </span>
                </th>

                <th>
                  Helper 2
                  <br />
                  <span className="hi">
                    हेल्पर २
                  </span>
                </th>

                <th>
                  Helper 3
                  <br />
                  <span className="hi">
                    हेल्पर ३
                  </span>
                </th>

                <th>
                  Time In
                  <br />
                  <span className="hi">
                    समय प्रवेश
                  </span>
                </th>

                <th>
                  Time Out
                  <br />
                  <span className="hi">
                    समय बाहर
                  </span>
                </th>
              </tr>
            </thead>

            <tbody>
              <tr>

                <td className="td-date-cell">
                  <div className="cell-stack">

                    {form.date && (
                      <div className="date-display">
                        {fmtDate(form.date)}
                      </div>
                    )}

                    <input
                      type="date"
                      className="tjc-input"
                      value={form.date}
                      onChange={e =>
                        set('date', e.target.value)
                      }
                    />

                  </div>
                </td>

                <td>
                  <select
                    className="tjc-input"
                    value={form.shift}
                    onChange={e =>
                      set('shift', e.target.value)
                    }
                  >
                    <option value="">
                      — Select —
                    </option>

                    <option value="Day">
                      Day/दिन
                    </option>

                    <option value="Night">
                      Night/रात
                    </option>
                  </select>
                </td>

                <td>
                  <input
                    className="tjc-input"
                    placeholder="Operator"
                    value={form.operator}
                    onChange={e =>
                      set('operator', e.target.value)
                    }
                  />
                </td>

                <td>
                  <input
                    className="tjc-input"
                    placeholder="Helper 1"
                    value={form.helper1}
                    onChange={e =>
                      set('helper1', e.target.value)
                    }
                  />
                </td>

                <td>
                  <input
                    className="tjc-input"
                    placeholder="Helper 2"
                    value={form.helper2}
                    onChange={e =>
                      set('helper2', e.target.value)
                    }
                  />
                </td>

                <td>
                  <input
                    className="tjc-input"
                    placeholder="Helper 3"
                    value={form.helper3}
                    onChange={e =>
                      set('helper3', e.target.value)
                    }
                  />
                </td>

                <td>
                  <input
                    type="time"
                    className="tjc-input"
                    value={form.time_in}
                    onChange={e =>
                      set('time_in', e.target.value)
                    }
                  />
                </td>

                <td>
                  <input
                    type="time"
                    className="tjc-input"
                    value={form.time_out}
                    onChange={e =>
                      set('time_out', e.target.value)
                    }
                  />
                </td>

              </tr>
            </tbody>

          </table>

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

                <span className="fuel-total-item-label">
                  Coal
                </span>

                <span className="fuel-total-item-val">
                  {parseFloat(form.coal_charged) || 0} MT
                </span>

              </div>

              <span className="fuel-total-plus">
                +
              </span>

              <div className="fuel-total-item">

                <span className="fuel-total-item-label">
                  Bugass
                </span>

                <span className="fuel-total-item-val">
                  {parseFloat(form.bugass_charged) || 0} MT
                </span>

              </div>

              <span className="fuel-total-plus">
                +
              </span>

              <div className="fuel-total-item">

                <span className="fuel-total-item-label">
                  Diesel
                </span>

                <span className="fuel-total-item-val">
                  {parseFloat(form.diesel_charged) || 0} Ltr
                </span>

              </div>

              <span className="fuel-total-equals">
                =
              </span>

              <div className="fuel-total-item fuel-total-result">

                <span className="fuel-total-item-label">
                  Total
                </span>

                <span className="fuel-total-item-val">
                  {(
                    (parseFloat(form.coal_charged) || 0) +
                    (parseFloat(form.bugass_charged) || 0) +
                    (parseFloat(form.diesel_charged) || 0)
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
                        onClick={() =>
                          saveRow(i)
                        }
                      >
                        {activeRows[i].saved
                          ? '✓'
                          : '💾'}
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
            Summary /{' '}
            <span className="hi">
              सारांश
            </span>
          </div>

          <div className="common-two-col">

            {/* Left column */}

            <div className="common-col">

              {/* Outlet Set Temp */}

              <div className="common-field-row">

                <div className="common-field-label">
                  Outlet Set Temp (°C)
                </div>

                <div className="input-with-unit">

                  <input
                    className="tjc-input"
                    type="text"
                    inputMode="decimal"
                    placeholder="0"
                    value={form.outlet_set_temp}
                    onChange={e =>
                      setNumeric(
                        'outlet_set_temp',
                        e.target.value
                      )
                    }
                  />

                  <span className="input-unit">
                    °C
                  </span>

                </div>

              </div>

              {/* Expansion Tank Level */}

              <div className="common-field-row">

                <div className="common-field-label">
                  Expansion Tank Level
                </div>

                <input
                  className="tjc-input"
                  placeholder=""
                  value={form.expansion_tank_level}
                  onChange={e =>
                    set(
                      'expansion_tank_level',
                      e.target.value
                    )
                  }
                />

              </div>

              {/* Type of Fuel - STRING ONLY */}

              <div className="common-field-row">

                <div className="common-field-label">
                  Type of Fuel
                </div>

                <input
                  className="tjc-input"
                  type="text"
                  placeholder=""
                  value={form.type_of_fuel}
                  onChange={e =>
                    set(
                      'type_of_fuel',
                      e.target.value
                    )
                  }
                />

              </div>

              {/* Qty. of Fuel Used */}

              <div className="common-field-row">

                <div className="common-field-label">
                  Qty. of Fuel Used
                </div>

                <input
                  className="tjc-input"
                  placeholder=""
                  value={form.qty_fuel_used}
                  onChange={e =>
                    set(
                      'qty_fuel_used',
                      e.target.value
                    )
                  }
                />

              </div>

              {/* Date of Last Boiler Cleaning */}

              <div className="common-field-row">

                <div className="common-field-label">
                  Date of Last Boiler Cleaning
                </div>

                <input
                  className="tjc-input"
                  type="date"
                  value={
                    form.date_of_last_boiler_cleaning
                  }
                  onChange={e =>
                    set(
                      'date_of_last_boiler_cleaning',
                      e.target.value
                    )
                  }
                />

              </div>

            </div>

            {/* Right column */}

            <div className="common-col">

              {/* Total Running Hrs. - NUMBER ONLY */}

              <div className="common-field-row">

                <div className="common-field-label">
                  Total Running Hrs.
                </div>

                <input
                  className="tjc-input"
                  type="text"
                  inputMode="decimal"
                  placeholder="0"
                  value={form.total_running_hrs}
                  onChange={e =>
                    setNumeric(
                      'total_running_hrs',
                      e.target.value
                    )
                  }
                />

              </div>

              {/* Consumption Per Hrs. - NUMBER ONLY */}

              <div className="common-field-row">

                <div className="common-field-label">
                  Consumption Per Hrs.
                </div>

                <input
                  className="tjc-input"
                  type="text"
                  inputMode="decimal"
                  placeholder="0"
                  value={form.consumption_per_hr}
                  onChange={e =>
                    setNumeric(
                      'consumption_per_hr',
                      e.target.value
                    )
                  }
                />

              </div>

              {/* Total Consumption - NUMBER ONLY */}

              <div className="common-field-row">

                <div className="common-field-label">
                  Total Consumption (kg)
                </div>

                <input
                  className="tjc-input"
                  type="text"
                  inputMode="decimal"
                  placeholder="0"
                  value={form.total_consumption}
                  onChange={e =>
                    setNumeric(
                      'total_consumption',
                      e.target.value
                    )
                  }
                />

              </div>

              {/* Total Clinker Weight - NUMBER ONLY */}

              <div className="common-field-row">

                <div className="common-field-label">
                  Total Clinker Weight (kg)
                </div>

                <input
                  className="tjc-input"
                  type="text"
                  inputMode="decimal"
                  placeholder="0"
                  value={form.total_clinker_wt}
                  onChange={e =>
                    setNumeric(
                      'total_clinker_wt',
                      e.target.value
                    )
                  }
                />

              </div>

              {/* Dryer in Use - DROPDOWN */}

              <div className="common-field-row">

                <div className="common-field-label">
                  Dryer in Use
                </div>

                <select
                  className="tjc-input"
                  value={form.dryer_in_use}
                  onChange={e =>
                    set(
                      'dryer_in_use',
                      e.target.value
                    )
                  }
                >
                  <option value="">
                    Select
                  </option>

                  <option value="Old">
                    Old
                  </option>

                  <option value="New">
                    New
                  </option>
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
            <div className="tjc-success">
              ✓ Saved / सहेजा गया
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
              setForm(emptyForm())
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

        <button
          type="button"
          className="sc-accordion-header"
          onClick={() =>
            setMotorOpen(o => !o)
          }
          aria-expanded={motorOpen}
        >

          <span className="sc-accordion-title">

            Running Motor Amp Status

            <span className="sc-accordion-title-hi">
              {' '}
              / रनिंग मोटर एम्प स्थिति
            </span>

          </span>

          <span className="sc-accordion-icon">
            {motorOpen ? '▲' : '▼'}
          </span>

        </button>

        {motorOpen && (

          <form
            className="sc-form"
            onSubmit={handleMotorSubmit}
          >

            <div className="sc-meta-row">

              <div className="sc-meta-field">

                <Label
                  en="Running Date"
                  hi="चलने की तारीख"
                />

                <input
                  type="date"
                  className="tjc-input"
                  value={motorForm.running_date}
                  onChange={e =>
                    setMotorForm(p => ({
                      ...p,
                      running_date:
                        e.target.value,
                    }))
                  }
                />

              </div>

              <div className="sc-meta-field sc-meta-wide">

                <Label
                  en="Checked By"
                  hi="जाँच की गई"
                />

                <input
                  className="tjc-input"
                  placeholder="Name / नाम"
                  value={motorForm.checked_by}
                  onChange={e =>
                    setMotorForm(p => ({
                      ...p,
                      checked_by:
                        e.target.value,
                    }))
                  }
                />

              </div>

            </div>

            <div className="sc-table-scroll">

              <table className="sc-single-table">

                <thead>

                  <tr>

                    <th>
                      Sr. No.
                    </th>

                    <th>
                      Motor Name /{' '}
                      <span className="hi">
                        मोटर नाम
                      </span>
                    </th>

                    <th>
                      HP
                    </th>

                    <th>
                      Amp Reading /{' '}
                      <span className="hi">
                        एम्प रीडिंग
                      </span>
                    </th>

                    <th>
                      Status /{' '}
                      <span className="hi">
                        स्थिति
                      </span>
                    </th>

                  </tr>

                </thead>

                <tbody>

                  {MOTORS.map((motor, mi) => (

                    <tr key={motor.id}>

                      <td className="sc-sr">
                        {motor.id}
                      </td>

                      <td className="sc-motor-name">
                        {motor.name}
                      </td>

                      <td className="sc-hp">
                        {motor.hp}
                      </td>

                      <td className="sc-cell">

                        <input
                          type="number"
                          className="sc-input-wide"
                          placeholder="—"
                          value={
                            motorForm.motors[mi].val
                          }
                          onChange={e =>
                            setMotorCell(
                              mi,
                              'val',
                              e.target.value
                            )
                          }
                        />

                      </td>

                      <td className="sc-cell sc-stop-cell">

                        <select
                          className="sc-stop-select-wide"
                          value={
                            motorForm.motors[mi].stop
                          }
                          onChange={e =>
                            setMotorCell(
                              mi,
                              'stop',
                              e.target.value
                            )
                          }
                        >

                          <option value="">
                            —
                          </option>

                          <option value="STOP">
                            STOP
                          </option>

                          <option value="OK">
                            OK
                          </option>

                        </select>

                      </td>

                    </tr>

                  ))}

                </tbody>

              </table>

            </div>

            <div className="sc-bottom">

              <div className="sc-remark-field">

                <Label
                  en="Remark"
                  hi="टिप्पणी"
                />

                <input
                  className="tjc-input"
                  placeholder="Remark / टिप्पणी"
                  value={motorForm.remark}
                  onChange={e =>
                    setMotorForm(p => ({
                      ...p,
                      remark: e.target.value,
                    }))
                  }
                />

              </div>

              <div className="tjc-actions sc-actions">

                {savedMotor && (
                  <div className="tjc-success">
                    ✓ Saved / सहेजा गया
                  </div>
                )}

                <button
                  type="submit"
                  className="tjc-save-btn"
                  disabled={saving}
                >
                  {saving
                    ? 'Saving…'
                    : 'Save Motor Status / मोटर स्थिति सहेजें'}
                </button>

                <button
                  type="button"
                  className="tjc-reset-btn"
                  onClick={() => {
                    setMotorForm(emptyMotorForm())
                    setSavedMotor(false)
                  }}
                >
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