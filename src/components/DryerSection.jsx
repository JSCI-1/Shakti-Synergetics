import React, { useState } from 'react'
import { supabase, supabaseReady } from '../supabaseClient'
import './DryerSection.css'


const TIME_SLOTS = [
  '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00',
  '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00', '23:00',
  '00:00', '01:00', '02:00', '03:00', '04:00', '05:00', '06:00', '07:00',
]


function stamp12hr() {
  return new Date().toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
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
    pressure: '',
    pt_temp: '',

    batch_no: '',
    bags_per_hr: '',
    bag_size_wt: '',
    kg_per_hr: '',

    colour: '',
    id_frequency: '',
    remarks: '',

    timestamp: '',
    saved: false,
  }
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

    total_production: '',
    incharge: '',
    operator: '',

    rows: TIME_SLOTS.map(() => emptyRow()),
  }
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
  userName,
}) {
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')


  const set = (k, v) => {
    setForm(p => ({
      ...p,
      [k]: v,
    }))
  }


  const setRow = (i, field, val) => {
    setForm(p => ({
      ...p,
      rows: p.rows.map((r, idx) =>
        idx === i
          ? {
              ...r,
              [field]: val,
            }
          : r
      ),
    }))
  }


  function saveRow(i) {
    setForm(p => {
      if (p.rows[i].saved) return p

      return {
        ...p,
        rows: p.rows.map((r, idx) =>
          idx === i
            ? {
                ...r,
                timestamp: stamp12hr(),
                saved: true,
              }
            : r
        ),
      }
    })
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

          total_production: form.total_production
            ? parseFloat(form.total_production)
            : null,

          incharge: form.incharge,
          operator: form.operator,

          log_rows: form.rows,
        },
      ])

    setSaving(false)

    if (err) {
      setError(err.message)
    } else {
      setSaved(true)
      setForm(emptyForm(dryerType))
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
          value={form.rows[ri][field]}
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
        value={form.rows[ri][field]}
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


                {/* Other columns */}

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
                        form.rows[i].saved
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

                    {renderTC(
                      'colour',
                      i
                    )}

                    {renderTC(
                      'id_frequency',
                      i
                    )}

                    {renderTC(
                      'remarks',
                      i
                    )}


                    {/* Timestamp */}

                    <td className="dr-td-ts">

                      {form.rows[i].timestamp ? (

                        <span className="dr-ts-badge">
                          {form.rows[i].timestamp}
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
                        disabled={form.rows[i].saved}
                        onClick={() => saveRow(i)}
                      >
                        {form.rows[i].saved ? '✓' : '💾'}
                      </button>

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


          {/* Total production */}

          <div className="dr-footer-field">

            <label className="dr-label">

              Total Production of the Day (kg) /{' '}

              <span className="dr-label-hi">
                दिन का कुल उत्पादन
              </span>

            </label>

            <input
              type="number"
              className="dr-input"
              placeholder="0"
              value={form.total_production}
              onChange={e =>
                set(
                  'total_production',
                  e.target.value
                )
              }
            />

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

              setForm(
                emptyForm(dryerType)
              )

              setSaved(false)
              setError('')

            }}
          >

            Reset / रीसेट

          </button>

        </div>

      </form>

    </div>
  )
}


export default function DryerSection({ user }) {

  const [activeTab, setActiveTab] =
    useState('new')


  const [formNew, setFormNew] =
    useState(emptyForm('new'))


  const [formOld, setFormOld] =
    useState(emptyForm('old'))


  return (

    <div className="dr-wrapper">

      {/* Tabs */}

      <div className="dr-tab-bar">

        <button
          type="button"
          className={`dr-tab-btn ${
            activeTab === 'new'
              ? 'dr-tab-active'
              : ''
          }`}
          onClick={() =>
            setActiveTab('new')
          }
        >

          New Dryer /{' '}

          <span
            style={{
              fontSize: '11px',
              fontWeight: '400',
            }}
          >
            नया ड्रायर
          </span>

        </button>


        <button
          type="button"
          className={`dr-tab-btn ${
            activeTab === 'old'
              ? 'dr-tab-active'
              : ''
          }`}
          onClick={() =>
            setActiveTab('old')
          }
        >

          Old Dryer /{' '}

          <span
            style={{
              fontSize: '11px',
              fontWeight: '400',
            }}
          >
            पुराना ड्रायर
          </span>

        </button>

      </div>


      <div className="dr-content">

        {/* New Dryer */}

        <div
          style={{
            display:
              activeTab === 'new'
                ? 'block'
                : 'none',
          }}
        >

          <DryerForm
            dryerType="new"
            label="New Dryer"
            labelHi="नया ड्रायर"
            form={formNew}
            setForm={setFormNew}
            userName={user?.name ?? ''}
          />

        </div>


        {/* Old Dryer */}

        <div
          style={{
            display:
              activeTab === 'old'
                ? 'block'
                : 'none',
          }}
        >

          <DryerForm
            dryerType="old"
            label="Old Dryer"
            labelHi="पुराना ड्रायर"
            form={formOld}
            setForm={setFormOld}
            userName={user?.name ?? ''}
          />

        </div>

      </div>

    </div>
  )
}