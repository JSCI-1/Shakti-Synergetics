// ════════════════════════════════════════════════════════════
// Slurry Operator Job Card
// Saves to:
//     slurry_operator_job_cards
//
// Motor Amp Status saves to:
//     slurry_operator_motor_amp
// ════════════════════════════════════════════════════════════

import React, { useState } from 'react'
import { supabase, supabaseReady } from '../supabaseClient'
import './SlurrySection.css'


// ════════════════════════════════════════════════════════════
// MILL LIST
// ════════════════════════════════════════════════════════════

const MILLS = [
  'V1',
  'V2',
  'V3',
  'V4',
  'V5',
  'V6',
  'V7',
  'H1'
]


// ════════════════════════════════════════════════════════════
// MOTOR LIST
// ════════════════════════════════════════════════════════════

const SLURRY_MOTORS = [
  { id: 1,  name: 'Vertical Mill 01', hp: 50 },
  { id: 2,  name: 'Vertical Mill 02', hp: 50 },
  { id: 3,  name: 'Vertical Mill 03', hp: 50 },
  { id: 4,  name: 'Vertical Mill 04', hp: 50 },
  { id: 5,  name: 'Vertical Mill 05', hp: 50 },
  { id: 6,  name: 'Vertical Mill 06', hp: 50 },
  { id: 7,  name: 'Vertical Mill 07', hp: 50 },
  { id: 8,  name: 'Vertical Mill 08', hp: 50 },
  { id: 9,  name: 'Vertical Mill 09', hp: 50 },
  { id: 10, name: 'Vertical Mill 10', hp: 50 },
  { id: 11, name: 'Attrition Mill 01', hp: 75 },
  { id: 12, name: 'Attrition Mill 02', hp: 60 }
]


// ════════════════════════════════════════════════════════════
// TODAY'S DATE
// ════════════════════════════════════════════════════════════

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}


// ════════════════════════════════════════════════════════════
// EMPTY MOTOR ENTRY
// ════════════════════════════════════════════════════════════

function emptyMotorEntry() {

  return {
    amp: '',
    stop: '',
    timestamp: '',
    saved: false
  }

}


// ════════════════════════════════════════════════════════════
// EMPTY MOTOR FORM
// ════════════════════════════════════════════════════════════

function emptyMotorForm() {

  return {

    running_date: todayISO(),

    checked_by: '',

    remark: '',

    motors: SLURRY_MOTORS.map(() =>
      emptyMotorEntry()
    )

  }

}


// ════════════════════════════════════════════════════════════
// EMPTY MILL ROW
// ════════════════════════════════════════════════════════════

function emptyMillRow(mill) {

  return {

    mill,

    flow_rates: [
      {
        value: '',
        timestamp: ''
      }
    ],

    current_amp: '',

    zirconia_beads: '',

    remarks: ''

  }

}


// ════════════════════════════════════════════════════════════
// EMPTY MAIN FORM
// ════════════════════════════════════════════════════════════

function emptyForm() {

  return {

    date: '',

    shift1_operator: '',

    shift2_operator: '',

    mills: MILLS.map(m =>
      emptyMillRow(m)
    ),

    operator: '',

    supervisor: '',

    manager: ''

  }

}


// ════════════════════════════════════════════════════════════
// 12-HOUR TIMESTAMP
// ════════════════════════════════════════════════════════════

function stamp12hr() {

  return new Date().toLocaleTimeString(
    'en-IN',
    {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    }
  )

}


// ════════════════════════════════════════════════════════════
// SLURRY OPERATOR COMPONENT
// ════════════════════════════════════════════════════════════

export default function SlurryOperator() {

  // ══════════════════════════════════════════════════════════
  // MAIN FORM STATE
  // ══════════════════════════════════════════════════════════

  const [form, setForm] =
    useState(emptyForm())

  const [saving, setSaving] =
    useState(false)

  const [saved, setSaved] =
    useState(false)

  const [error, setError] =
    useState('')


  // ══════════════════════════════════════════════════════════
  // MOTOR FORM STATE
  // ══════════════════════════════════════════════════════════

  const [motorOpen, setMotorOpen] =
    useState(false)

  const [motorForm, setMotorForm] =
    useState(emptyMotorForm())

  const [motorSaving, setMotorSaving] =
    useState(false)

  const [motorSaved, setMotorSaved] =
    useState(false)

  const [motorError, setMotorError] =
    useState('')


  // ══════════════════════════════════════════════════════════
  // MAIN FORM SETTER
  // ══════════════════════════════════════════════════════════

  const set = (key, value) => {

    setForm(previous => ({
      ...previous,
      [key]: value
    }))

  }


  // ══════════════════════════════════════════════════════════
  // MILL SETTER
  // ══════════════════════════════════════════════════════════

  const setMill = (
    index,
    field,
    value
  ) => {

    setForm(previous => ({

      ...previous,

      mills: previous.mills.map(
        (mill, i) =>

          i === index

            ? {
                ...mill,
                [field]: value
              }

            : mill
      )

    }))

  }


  // ══════════════════════════════════════════════════════════
  // ADD FLOW RATE READING
  // ══════════════════════════════════════════════════════════

  function addFlowRate(millIndex) {

    setForm(previous => ({

      ...previous,

      mills: previous.mills.map(
        (mill, i) =>

          i === millIndex

            ? {

                ...mill,

                flow_rates: [
                  ...mill.flow_rates,

                  {
                    value: '',
                    timestamp: ''
                  }
                ]

              }

            : mill
      )

    }))

  }


  // ══════════════════════════════════════════════════════════
  // SET FLOW RATE
  // ══════════════════════════════════════════════════════════

  function setFlowRate(
    millIndex,
    flowIndex,
    value
  ) {

    setForm(previous => ({

      ...previous,

      mills: previous.mills.map(
        (mill, i) => {

          if (i !== millIndex) {
            return mill
          }

          return {

            ...mill,

            flow_rates:
              mill.flow_rates.map(
                (flow, j) =>

                  j === flowIndex

                    ? {
                        ...flow,
                        value
                      }

                    : flow
              )

          }

        }
      )

    }))

  }


  // ══════════════════════════════════════════════════════════
  // FLOW RATE TIMESTAMP
  // ══════════════════════════════════════════════════════════

  function stampFlowRate(
    millIndex,
    flowIndex
  ) {

    setForm(previous => {

      if (
        previous
          .mills[millIndex]
          .flow_rates[flowIndex]
          .timestamp
      ) {

        return previous

      }


      return {

        ...previous,

        mills: previous.mills.map(
          (mill, i) => {

            if (i !== millIndex) {
              return mill
            }

            return {

              ...mill,

              flow_rates:
                mill.flow_rates.map(
                  (flow, j) =>

                    j === flowIndex

                      ? {
                          ...flow,
                          timestamp:
                            stamp12hr()
                        }

                      : flow
                )

            }

          }
        )

      }

    })

  }


  // ══════════════════════════════════════════════════════════
  // REMOVE FLOW RATE
  // ══════════════════════════════════════════════════════════

  function removeFlowRate(
    millIndex,
    flowIndex
  ) {

    setForm(previous => ({

      ...previous,

      mills: previous.mills.map(
        (mill, i) =>

          i === millIndex &&
          mill.flow_rates.length > 1

            ? {

                ...mill,

                flow_rates:
                  mill.flow_rates.filter(
                    (_, j) =>
                      j !== flowIndex
                  )

              }

            : mill
      )

    }))

  }


  // ══════════════════════════════════════════════════════════
  // SAVE SLURRY OPERATOR JOB CARD
  // ══════════════════════════════════════════════════════════

  async function handleSubmit(e) {

    e.preventDefault()


    if (!supabaseReady) {

      setError(
        'Supabase not configured.'
      )

      return

    }


    setSaving(true)

    setError('')

    setSaved(false)


    const {
      error: err
    } = await supabase

      .from('slurry_operator_job_cards')

      .insert([

        {

          date:
            form.date || null,

          shift1_operator:
            form.shift1_operator,

          shift2_operator:
            form.shift2_operator,

          mills:
            form.mills,

          operator:
            form.operator,

          supervisor:
            form.supervisor,

          manager:
            form.manager

        }

      ])


    setSaving(false)


    if (err) {

      setError(err.message)

    } else {

      setSaved(true)

      setForm(emptyForm())

    }

  }


  // ══════════════════════════════════════════════════════════
  // MOTOR CELL SETTER
  // ══════════════════════════════════════════════════════════

  const setMotorCell = (
    motorIndex,
    key,
    value
  ) => {

    setMotorForm(previous => ({

      ...previous,

      motors:
        previous.motors.map(
          (motor, index) =>

            index === motorIndex

              ? {
                  ...motor,
                  [key]: value
                }

              : motor
        )

    }))

  }


  // ══════════════════════════════════════════════════════════
  // SAVE INDIVIDUAL MOTOR ROW
  // ══════════════════════════════════════════════════════════

  function saveMotorRow(motorIndex) {

    setMotorForm(previous => {

      if (
        previous
          .motors[motorIndex]
          .saved
      ) {

        return previous

      }


      return {

        ...previous,

        motors:
          previous.motors.map(
            (motor, index) =>

              index === motorIndex

                ? {

                    ...motor,

                    timestamp:
                      stamp12hr(),

                    saved: true

                  }

                : motor
          )

      }

    })

  }


  // ══════════════════════════════════════════════════════════
  // SAVE MOTOR STATUS
  // ══════════════════════════════════════════════════════════

  async function handleMotorSubmit(e) {

    e.preventDefault()


    if (!supabaseReady) {

      setMotorError(
        'Supabase not configured.'
      )

      return

    }


    setMotorSaving(true)

    setMotorError('')

    setMotorSaved(false)


    const {
      error: err
    } = await supabase

      .from('slurry_operator_motor_amp')

      .insert([

        {

          running_date:
            motorForm.running_date,

          checked_by:
            motorForm.checked_by,

          remark:
            motorForm.remark,

          motor_data:
            motorForm.motors

        }

      ])


    setMotorSaving(false)


    if (err) {

      setMotorError(err.message)

    } else {

      setMotorSaved(true)

      setMotorForm(
        emptyMotorForm()
      )

    }

  }


  // ══════════════════════════════════════════════════════════
  // UI
  // ══════════════════════════════════════════════════════════

  return (

    <div className="sl-wrapper">


      {/* ════════════════════════════════════════════════════
          TITLE
      ════════════════════════════════════════════════════ */}

      <div className="sl-title-bar">

        <div className="sl-title-main">

          Slurry Operator /

          <span className="sl-title-hi">

            स्लरी ऑपरेटर

          </span>

        </div>

      </div>


      <form
        className="sl-form"
        onSubmit={handleSubmit}
      >


        {/* ════════════════════════════════════════════════════
            DATE + SHIFT OPERATORS
        ════════════════════════════════════════════════════ */}

        <div className="sl-meta-bar">


          {/* DATE */}

          <div className="sl-meta-field">

            <label className="sl-label">

              Date /

              <span className="sl-label-hi">

                तारीख

              </span>

            </label>


            <input

              type="date"

              className="sl-input"

              value={form.date}

              onChange={e =>
                set(
                  'date',
                  e.target.value
                )
              }

            />

          </div>


          {/* SHIFT 1 */}

          <div className="sl-meta-field">

            <label className="sl-label">

              Shift 1 Operator /

              <span className="sl-label-hi">

                पहली पाली ऑपरेटर

              </span>

            </label>


            <input

              className="sl-input"

              placeholder="Operator name"

              value={
                form.shift1_operator
              }

              onChange={e =>
                set(
                  'shift1_operator',
                  e.target.value
                )
              }

            />

          </div>


          {/* SHIFT 2 */}

          <div className="sl-meta-field">

            <label className="sl-label">

              Shift 2 Operator /

              <span className="sl-label-hi">

                दूसरी पाली ऑपरेटर

              </span>

            </label>


            <input

              className="sl-input"

              placeholder="Operator name"

              value={
                form.shift2_operator
              }

              onChange={e =>
                set(
                  'shift2_operator',
                  e.target.value
                )
              }

            />

          </div>


        </div>


        {/* ════════════════════════════════════════════════════
            SAND MILLING DETAILS
        ════════════════════════════════════════════════════ */}

        <div className="sl-section-title">

          Sand Milling Details /

          <span className="sl-hi">

            सैंड मिलिंग विवरण

          </span>

        </div>


        <div className="sl-mill-scroll">


          <table className="sl-mill-table">


            <thead>

              <tr>


                <th>

                  Mill No.

                  <br />

                  <span className="sl-hi">

                    मिल नं.

                  </span>

                </th>


                <th>

                  Flow Rate (L/Sec)

                  <br />

                  <span className="sl-hi">

                    प्रवाह दर

                  </span>


                  <div
                    style={{
                      fontWeight: '400',
                      fontSize: '10px',
                      color: '#999'
                    }}
                  >

                    Multiple readings

                  </div>

                </th>


                <th>

                  Current Amp

                  <br />

                  <span className="sl-hi">

                    करंट एम्प

                  </span>

                </th>


                <th>

                  Zirconox/Zircosil Beads (kg)

                  <br />

                  <span className="sl-hi">

                    बीड्स (किग्रा)

                  </span>

                </th>


                <th>

                  Remarks

                  <br />

                  <span className="sl-hi">

                    टिप्पणी

                  </span>

                </th>


              </tr>

            </thead>


            <tbody>


              {form.mills.map(
                (mill, mi) => (

                  <tr

                    key={mill.mill}

                    className={
                      mi % 2 === 0
                        ? ''
                        : 'sl-tr-alt'
                    }

                  >


                    {/* MILL NUMBER */}

                    <td className="sl-mill-name">

                      Mill No. {mill.mill}

                    </td>


                    {/* FLOW RATE */}

                    <td className="sl-mill-flow-cell">


                      {mill.flow_rates.map(
                        (flow, fi) => (

                          <div

                            key={fi}

                            className="sl-flow-entry"

                          >


                            <input

                              type="number"

                              className="sl-input-num-wide"

                              placeholder="—"

                              value={
                                flow.value
                              }

                              onChange={e =>
                                setFlowRate(
                                  mi,
                                  fi,
                                  e.target.value
                                )
                              }

                            />


                            <button

                              type="button"

                              className="sl-flow-stamp-btn"

                              disabled={
                                !!flow.timestamp
                              }

                              onClick={() =>
                                stampFlowRate(
                                  mi,
                                  fi
                                )
                              }

                            >

                              {flow.timestamp ? (

                                <span className="sl-flow-ts">

                                  {
                                    flow.timestamp
                                  }

                                </span>

                              ) : (

                                '🕐'

                              )}

                            </button>


                            {mill.flow_rates.length > 1 && (

                              <button

                                type="button"

                                className="sl-flow-del-btn"

                                onClick={() =>
                                  removeFlowRate(
                                    mi,
                                    fi
                                  )
                                }

                              >

                                ✕

                              </button>

                            )}


                          </div>

                        )
                      )}


                      <button

                        type="button"

                        className="sl-flow-add-btn"

                        onClick={() =>
                          addFlowRate(mi)
                        }

                      >

                        + Add Reading

                      </button>


                    </td>


                    {/* CURRENT AMP */}

                    <td>

                      <input

                        type="number"

                        className="sl-input-num-wide"

                        placeholder="—"

                        value={
                          mill.current_amp
                        }

                        onChange={e =>
                          setMill(
                            mi,
                            'current_amp',
                            e.target.value
                          )
                        }

                      />

                    </td>


                    {/* ZIRCONOX / ZIRCOSIL BEADS */}

                    <td>

                      <input

                        type="number"

                        className="sl-input-num-wide"

                        placeholder="—"

                        value={
                          mill.zirconia_beads
                        }

                        onChange={e =>
                          setMill(
                            mi,
                            'zirconia_beads',
                            e.target.value
                          )
                        }

                      />

                    </td>


                    {/* REMARKS */}

                    <td>

                      <input

                        className="sl-input-wide-text"

                        placeholder="—"

                        value={
                          mill.remarks
                        }

                        onChange={e =>
                          setMill(
                            mi,
                            'remarks',
                            e.target.value
                          )
                        }

                      />

                    </td>


                  </tr>

                )
              )}


            </tbody>

          </table>

        </div>


        {/* ════════════════════════════════════════════════════
            APPROVAL
        ════════════════════════════════════════════════════ */}

        <div className="sl-approval-bar">


          {/* OPERATOR */}

          <div className="sl-approval-field">

            <label className="sl-label">

              Operator /

              <span className="sl-label-hi">

                ऑपरेटर

              </span>

            </label>


            <input

              className="sl-input"

              placeholder="Name"

              value={
                form.operator
              }

              onChange={e =>
                set(
                  'operator',
                  e.target.value
                )
              }

            />

          </div>


          {/* SUPERVISOR */}

          <div className="sl-approval-field">

            <label className="sl-label">

              Supervisor /

              <span className="sl-label-hi">

                सुपरवाइज़र

              </span>

            </label>


            <input

              className="sl-input"

              placeholder="Name"

              value={
                form.supervisor
              }

              onChange={e =>
                set(
                  'supervisor',
                  e.target.value
                )
              }

            />

          </div>


          {/* MANAGER */}

          <div className="sl-approval-field">

            <label className="sl-label">

              Manager /

              <span className="sl-label-hi">

                मैनेजर

              </span>

            </label>


            <input

              className="sl-input"

              placeholder="Name"

              value={
                form.manager
              }

              onChange={e =>
                set(
                  'manager',
                  e.target.value
                )
              }

            />

          </div>


        </div>


        {/* ════════════════════════════════════════════════════
            MAIN ACTIONS
        ════════════════════════════════════════════════════ */}

        <div className="sl-actions">


          {error && (

            <div className="sl-error">

              Error: {error}

            </div>

          )}


          {saved && (

            <div className="sl-success">

              ✓ Saved successfully /

              सफलतापूर्वक सहेजा गया

            </div>

          )}


          <button

            type="submit"

            className="sl-save-btn"

            disabled={saving}

          >

            {saving

              ? 'Saving…'

              : 'Save Job Card / जॉब कार्ड सहेजें'}

          </button>


          <button

            type="button"

            className="sl-reset-btn"

            onClick={() => {

              setForm(
                emptyForm()
              )

              setSaved(false)

              setError('')

            }}

          >

            Reset / रीसेट

          </button>


        </div>


      </form>


      {/* ════════════════════════════════════════════════════
          RUNNING MOTOR AMP STATUS
      ════════════════════════════════════════════════════ */}

      <div className="sl-accordion">


        <button

          type="button"

          className="sl-accordion-header"

          onClick={() =>
            setMotorOpen(
              open => !open
            )
          }

        >

          <span className="sl-accordion-title">

            Running Motor Amp Status /

            <span className="sl-hi">

              रनिंग मोटर एम्प स्थिति

            </span>

          </span>


          <span className="sl-accordion-icon">

            {motorOpen
              ? '▲'
              : '▼'}

          </span>


        </button>


        {motorOpen && (


          <form

            className="sl-motor-form"

            onSubmit={
              handleMotorSubmit
            }

          >


            {/* MOTOR META */}

            <div className="sl-motor-meta">


              {/* RUNNING DATE */}

              <div className="sl-motor-meta-field">


                <label className="sl-label">

                  Running Date /

                  <span className="sl-label-hi">

                    चलने की तारीख

                  </span>

                </label>


                <input

                  type="date"

                  className="sl-input"

                  value={
                    motorForm.running_date
                  }

                  min={
                    todayISO()
                  }

                  max={
                    todayISO()
                  }

                  readOnly

                  style={{
                    background:
                      '#f5f0ea',

                    cursor:
                      'not-allowed'
                  }}

                />


              </div>


              {/* CHECKED BY */}

              <div className="sl-motor-meta-field">


                <label className="sl-label">

                  Checked By /

                  <span className="sl-label-hi">

                    जाँच की गई

                  </span>

                </label>


                <input

                  className="sl-input"

                  placeholder="Name"

                  value={
                    motorForm.checked_by
                  }

                  onChange={e =>
                    setMotorForm(
                      previous => ({

                        ...previous,

                        checked_by:
                          e.target.value

                      })
                    )
                  }

                />


              </div>


            </div>


            {/* MOTOR TABLE */}

            <div className="sl-motor-scroll">


              <table className="sl-motor-table">


                <thead>

                  <tr>


                    <th>

                      Sr. No.

                      <br />

                      <span className="sl-hi">

                        क्र.सं.

                      </span>

                    </th>


                    <th>

                      Motor Name

                      <br />

                      <span className="sl-hi">

                        मोटर नाम

                      </span>

                    </th>


                    <th>

                      HP

                    </th>


                    <th>

                      Amp Reading

                      <br />

                      <span className="sl-hi">

                        एम्प रीडिंग

                      </span>

                    </th>


                    <th>

                      Status

                      <br />

                      <span className="sl-hi">

                        स्थिति

                      </span>

                    </th>


                    <th>

                      Timestamp

                      <br />

                      <span className="sl-hi">

                        समय

                      </span>

                    </th>


                    <th>

                      Save

                      <br />

                      <span className="sl-hi">

                        सहेजें

                      </span>

                    </th>


                  </tr>

                </thead>


                <tbody>


                  {SLURRY_MOTORS.map(
                    (motor, mi) => (

                      <tr

                        key={motor.id}

                        className={`

                          ${
                            mi % 2 === 0
                              ? ''
                              : 'sl-motor-alt'
                          }

                          ${
                            motorForm
                              .motors[mi]
                              .saved

                              ? 'sl-motor-saved'

                              : ''
                          }

                        `}

                      >


                        {/* SR NO */}

                        <td className="sl-motor-sr">

                          {motor.id}

                        </td>


                        {/* MOTOR NAME */}

                        <td className="sl-motor-name">

                          {motor.name}

                        </td>


                        {/* HP */}

                        <td className="sl-motor-hp">

                          {motor.hp}

                        </td>


                        {/* AMP */}

                        <td>

                          <input

                            type="number"

                            className="sl-motor-input"

                            placeholder="—"

                            value={
                              motorForm
                                .motors[mi]
                                .amp
                            }

                            onChange={e =>
                              setMotorCell(
                                mi,
                                'amp',
                                e.target.value
                              )
                            }

                          />

                        </td>


                        {/* STATUS */}

                        <td>

                          <select

                            className="sl-motor-select"

                            value={
                              motorForm
                                .motors[mi]
                                .stop
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

                            <option value="OK">
                              OK
                            </option>

                            <option value="STOP">
                              STOP
                            </option>

                          </select>

                        </td>


                        {/* TIMESTAMP */}

                        <td className="sl-motor-ts">


                          {motorForm
                            .motors[mi]
                            .timestamp ? (

                            <span className="sl-ts-badge">

                              {
                                motorForm
                                  .motors[mi]
                                  .timestamp
                              }

                            </span>

                          ) : (

                            <span className="sl-ts-empty">

                              —

                            </span>

                          )}


                        </td>


                        {/* SAVE */}

                        <td className="sl-motor-save-cell">


                          <button

                            type="button"

                            className="sl-row-save-btn"

                            disabled={
                              motorForm
                                .motors[mi]
                                .saved
                            }

                            onClick={() =>
                              saveMotorRow(mi)
                            }

                          >

                            {
                              motorForm
                                .motors[mi]
                                .saved

                                ? '✓'

                                : '💾'
                            }

                          </button>


                        </td>


                      </tr>

                    )
                  )}


                </tbody>

              </table>

            </div>


            {/* REMARK */}

            <div className="sl-motor-remark">


              <label className="sl-label">

                Remark /

                <span className="sl-label-hi">

                  टिप्पणी

                </span>

              </label>


              <input

                className="sl-input"

                placeholder="Remark..."

                value={
                  motorForm.remark
                }

                onChange={e =>
                  setMotorForm(
                    previous => ({

                      ...previous,

                      remark:
                        e.target.value

                    })
                  )
                }

              />


            </div>


            {/* MOTOR ACTIONS */}

            <div className="sl-actions">


              {motorError && (

                <div className="sl-error">

                  Error: {motorError}

                </div>

              )}


              {motorSaved && (

                <div className="sl-success">

                  ✓ Saved successfully

                </div>

              )}


              <button

                type="submit"

                className="sl-save-btn"

                disabled={
                  motorSaving
                }

              >

                {motorSaving

                  ? 'Saving…'

                  : 'Save Motor Status / मोटर स्थिति सहेजें'}

              </button>


              <button

                type="button"

                className="sl-reset-btn"

                onClick={() => {

                  setMotorForm(
                    emptyMotorForm()
                  )

                  setMotorSaved(false)

                  setMotorError('')

                }}

              >

                Reset / रीसेट

              </button>


            </div>


          </form>

        )}


      </div>


    </div>

  )

}