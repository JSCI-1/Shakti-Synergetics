import React, { useState, useEffect, useCallback, Fragment } from 'react'
import { supabase, supabaseReady } from '../../supabaseClient.js'
import {
  RAW_MATERIALS, IN_PROCESS_PINNED, IN_PROCESS, FINISHED_GOODS,
  SHARED_FORMULAS,
} from '../../data/qualityData.js'
import { UPL_GRADES, TABLE_GRADES } from '../../data/uplData.js'
import { evaluate } from '../../utils/qualityUtils.js'
import { overallResult } from './OverallResult.jsx'
import OverallResult from './OverallResult.jsx'
import './MyRecords.css'

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────
const TAB_LABELS = { rm: 'Raw Material', ip: 'In-Process', fg: 'Finished Good' }
const TAB_COLORS = { rm: '#2e7d32', ip: '#1565c0', fg: '#b85c2c' }

const GRADE_LABELS = {
  export: 'UPL Export Grade', omri: 'UPL OMRI Grade', colour: 'Colour',
  sumitomo: 'SUMITOMO CHEMICAL INDIA', hemani_v: 'HEMANI INDUSTRIES UNIT - V',
  lohiya: 'LOHIYA CHEMICAL LTD.', adama: 'ADAMA INDIA P LTD.',
  biostadt: 'BIOSTADT INDIA LTD.', sanaca: 'Sanaca Dubai',
  villacrop: 'Villa Crop', yellowstone: 'CropSure', pratasha: 'Pratasha',
  haychem: 'Haychem', farmalinx: 'Farmalinx', mcdonald: 'McDonald', iffco: 'IFFCO',
}
function gradeLabel(g) { return GRADE_LABELS[g] || (g ? g : 'Normal') }

// ─────────────────────────────────────────────────────────────
// Get operator name — works for all three tabs.
// FG does NOT store tested_by inside values (only at top-level row.tested_by).
// RM/IP store it both in values.tested_by AND top-level.
// ─────────────────────────────────────────────────────────────
function getOperator(record) {
  return record.values?.tested_by || record.tested_by || '—'
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function getMaterialLabel(record) {
  const { tab, values } = record
  if (tab === 'rm') {
    const mat = RAW_MATERIALS.find(m => m.id === values?.material)
    return mat ? mat.label : (values?.material || '—')
  }
  if (tab === 'ip') return 'In-Process'
  if (tab === 'fg') {
    const prod = FINISHED_GOODS.find(p => p.id === values?.product)
    const base = prod ? prod.label : (values?.product || '—')
    const parts = [base]
    if (values?.grade && values.grade !== 'normal') parts.push(gradeLabel(values.grade))
    if (values?.dryer) parts.push(values.dryer)
    return parts.join(' · ')
  }
  return '—'
}

function formatDate(d) {
  if (!d) return '—'
  const p = String(d).split('-')
  if (p.length === 3) {
    const dt = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]))
    return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  }
  const dt = new Date(d)
  return isNaN(dt) ? d : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatSavedAt(iso) {
  if (!iso) return '—'
  const dt = new Date(iso)
  if (isNaN(dt)) return iso
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' + dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
}

// ─────────────────────────────────────────────────────────────
// Flatten fg_formula_inputs into formulaId__varKey flat keys.
// FG saves raw formula inputs as:
//   fg_formula_inputs: { fg_sulphur: { N: '0.1', BR: '25', W: '1' }, … }
// The formula cards read them as formulaId__varKey (e.g. fg_sulphur__N).
// Both paths (flat from older saves + nested from fg_formula_inputs) are merged.
// ─────────────────────────────────────────────────────────────
function flattenFormulaInputs(values) {
  const out = { ...values }
  const inputs = values.fg_formula_inputs
  if (inputs && typeof inputs === 'object') {
    Object.entries(inputs).forEach(([formulaId, vars]) => {
      if (vars && typeof vars === 'object') {
        Object.entries(vars).forEach(([varKey, val]) => {
          const flatKey = `${formulaId}__${varKey}`
          // Only fill if the flat key isn't already present (older records may
          // have both; prefer the flat key already in values)
          if (out[flatKey] === undefined || out[flatKey] === null || out[flatKey] === '') {
            out[flatKey] = val
          }
        })
      }
    })
  }
  return out
}

// ─────────────────────────────────────────────────────────────
// Read-only PASS/FAIL badge
// ─────────────────────────────────────────────────────────────
function Badge({ value, rule }) {
  const result = evaluate(value, rule)
  if (!result) return null
  return <span className={result === 'PASS' ? 'qc-badge-pass' : 'qc-badge-fail'}>{result}</span>
}

// UPL-style Pass/Fail span
function UplStatus({ value, rule }) {
  const result = evaluate(value, rule)
  if (result === 'PASS') return <span className="qc-upl-pass">Pass</span>
  if (result === 'FAIL') return <span className="qc-upl-fail">Fail</span>
  return <span className="qc-upl-na">—</span>
}

// ─────────────────────────────────────────────────────────────
// Read-only Formula Card  (mirrors FormulaCalculator)
// ─────────────────────────────────────────────────────────────
function ReadonlyFormulaCard({ formula, values }) {
  const resultVal = values[formula.id]
  const hasResult = resultVal !== undefined && resultVal !== null && resultVal !== ''

  return (
    <div className="qc-formula-card mr-readonly-card">
      <div className="qc-formula-name">{formula.name}</div>
      <div className="qc-vars">
        {formula.variables.map(v => {
          const val = values[`${formula.id}__${v.key}`]
          const hasVal = val !== undefined && val !== null && val !== ''
          return (
            <div key={v.key} className="qc-var-row">
              <label className="qc-var-label">
                <span className="qc-var-sym">{v.label}</span>
                <span className="qc-var-desc">{v.desc}</span>
              </label>
              <div className="qc-input-unit">
                <span className="mr-readonly-val">{hasVal ? val : '—'}</span>
                {v.unit && <span className="qc-unit">{v.unit}</span>}
              </div>
            </div>
          )
        })}
      </div>
      <div className="qc-calc-result">
        <span className="qc-calc-label">Result:</span>
        <span className="qc-calc-value">
          {hasResult ? `${resultVal} ${formula.resultUnit}` : '—'}
        </span>
        {formula.rule && <Badge value={resultVal} rule={formula.rule} />}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Read-only Spec Table  (mirrors SpecTable)
// ─────────────────────────────────────────────────────────────
function ReadonlySpecTable({ params, values }) {
  const hasAnyRule = params.some(p => p.rule)
  return (
    <div className="qc-table-wrap">
      <table className="qc-table">
        <thead>
          <tr>
            <th>Parameter / पैरामीटर</th>
            <th>Specification / मानक</th>
            <th>Observation / प्रेक्षण</th>
            {hasAnyRule && <th>Result / परिणाम</th>}
          </tr>
        </thead>
        <tbody>
          {params.map(param => {
            const val = values[param.id] ?? ''
            const result = evaluate(val, param.rule)
            const display = val !== '' ? (param.unit ? `${val} ${param.unit}` : val) : '—'
            return (
              <tr key={param.id} className={result === 'FAIL' ? 'qc-row-fail' : ''}>
                <td className="qc-param-name">
                  {param.name}
                  {param.method && <div className="qc-method">{param.method}</div>}
                </td>
                <td className="qc-spec">{param.specification}</td>
                <td className="qc-obs">{display}</td>
                {hasAnyRule && (
                  <td className="qc-result"><Badge value={val} rule={param.rule} /></td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Read-only Single Spec (pH, Wettability)
// valueOverride: used when the value is stored under a grade-specific
// table row's sourceKey rather than directly under test.id
// ─────────────────────────────────────────────────────────────
function ReadonlySingleSpec({ test, values, valueOverride }) {
  // Primary: direct key. Fallback: valueOverride (from tableGrade sourceKey lookup)
  const directVal = values[test.id]
  const val = (directVal !== undefined && directVal !== null && String(directVal).trim() !== '')
    ? String(directVal)
    : (valueOverride !== undefined && valueOverride !== null && String(valueOverride).trim() !== '')
    ? String(valueOverride)
    : ''
  const display = val !== '' ? (test.unit ? `${val} ${test.unit}` : val) : '—'
  return (
    <div className="qc-single-spec" data-test-id={test.id} style={{ display: 'block' }}>
      <div className="qc-single-name">{test.name}</div>
      {test.method && <div className="qc-method">{test.method}</div>}
      <div className="qc-input-unit" style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="mr-readonly-val">{display}</span>
        {val !== '' && <Badge value={val} rule={test.rule} />}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Read-only Moisture Readings block (FG)
// ─────────────────────────────────────────────────────────────
function ReadonlyMoisture({ values, uplGrade }) {
  const log    = Array.isArray(values.fg_moisture_log) ? values.fg_moisture_log : []
  const single = values.fg_moisture

  return (
    <div className="qc-sieve-apply-wrap">
      <div className="qc-sieve-apply-grid">
        <div className="qc-sieve-apply-formula">
          <div className="qc-moisture-card">
            <div className="qc-moisture-name">Moisture Content</div>
            <div className="qc-moisture-input-row">
              <span className="mr-readonly-val">
                {single !== undefined && single !== null && single !== '' ? `${single}` : '—'}
              </span>
              <span className="qc-unit">%</span>
            </div>
          </div>
        </div>
        <div className="qc-sieve-log">
          <div className="qc-sieve-log-title">Moisture Content — recorded</div>
          {log.length === 0 ? (
            <div className="qc-sieve-log-empty">No entries recorded.</div>
          ) : (
            <div className="qc-sieve-log-scroll">
              <table className="qc-sieve-log-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Result (%)</th>
                    {(uplGrade === 'export' || uplGrade === 'omri') && <th>Status</th>}
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {log.map((e, i) => {
                    const mStatus = (uplGrade === 'export' || uplGrade === 'omri')
                      ? evaluate(e.result, { type: 'range', min: 1.5, max: 2.2 })
                      : null
                    return (
                      <tr key={i}>
                        <td>{i + 1}</td>
                        <td>{e.result}</td>
                        {(uplGrade === 'export' || uplGrade === 'omri') && (
                          <td>
                            {mStatus === 'PASS' && <span className="qc-upl-pass">Pass</span>}
                            {mStatus === 'FAIL' && <span className="qc-upl-fail">Fail</span>}
                            {!mStatus && <span className="qc-upl-na">—</span>}
                          </td>
                        )}
                        <td>{e.time}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Read-only Sieve block (Wet / Dry Sieve) with recorded log table
// ─────────────────────────────────────────────────────────────
function ReadonlySieve({ formula, values }) {
  const logKey = `${formula.id}_log`
  const log    = Array.isArray(values[logKey]) ? values[logKey] : []
  const single = values[formula.id]

  return (
    <div className="qc-sieve-apply-wrap">
      <div className="qc-sieve-apply-grid">
        <div className="qc-sieve-apply-formula">
          <div className="qc-formula-card mr-readonly-card">
            <div className="qc-formula-name">{formula.name}</div>
            <div className="qc-vars">
              {formula.variables.map(v => {
                const val = values[`${formula.id}__${v.key}`]
                const hasVal = val !== undefined && val !== null && val !== ''
                return (
                  <div key={v.key} className="qc-var-row">
                    <label className="qc-var-label">
                      <span className="qc-var-sym">{v.label}</span>
                      <span className="qc-var-desc">{v.desc}</span>
                    </label>
                    <div className="qc-input-unit">
                      <span className="mr-readonly-val">{hasVal ? val : '—'}</span>
                      {v.unit && <span className="qc-unit">{v.unit}</span>}
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="qc-calc-result">
              <span className="qc-calc-label">Result:</span>
              <span className="qc-calc-value">
                {single !== undefined && single !== null && single !== ''
                  ? `${single} ${formula.resultUnit}` : '—'}
              </span>
            </div>
          </div>
        </div>

        <div className="qc-sieve-log">
          <div className="qc-sieve-log-title">{formula.name} — recorded</div>
          {log.length === 0 ? (
            <div className="qc-sieve-log-empty">No entries recorded.</div>
          ) : (
            <div className="qc-sieve-log-scroll">
              <table className="qc-sieve-log-table">
                <thead>
                  <tr><th>#</th><th>Micron</th><th>Result</th><th>Status</th><th>Time</th></tr>
                </thead>
                <tbody>
                  {log.map((e, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td>{e.targetLabel}</td>
                      <td>{e.result}</td>
                      <td>
                        {e.status === 'PASS' && <span className="qc-upl-pass">Pass</span>}
                        {e.status === 'FAIL' && <span className="qc-upl-fail">Fail</span>}
                        {e.status !== 'PASS' && e.status !== 'FAIL' && <span className="qc-upl-na">—</span>}
                      </td>
                      <td>{e.time}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Read-only UPL Parameters table (Export / OMRI grades)
// ─────────────────────────────────────────────────────────────
function ReadonlyUplTable({ uplGrade, uplRows, observed }) {
  const groups = []
  let cur = null
  uplRows.forEach(row => {
    if (row.group !== cur) { groups.push({ heading: row.group, rows: [] }); cur = row.group }
    groups[groups.length - 1].rows.push(row)
  })

  return (
    <div className="qc-upl-table-wrap">
      <div className="qc-upl-table-title">
        UPL Parameters – {gradeLabel(uplGrade)}
      </div>
      <div className="qc-upl-scroll">
        <table className="qc-upl-table">
          <thead>
            <tr>
              <th>Parameter / पैरामीटर</th>
              <th>Specification / विनिर्देश</th>
              <th>Result / परिणाम</th>
              <th>Status / स्थिति</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(g => (
              <Fragment key={g.heading}>
                <tr className="qc-upl-group-row">
                  <td colSpan={4}>{g.heading}</td>
                </tr>
                {g.rows.map(row => {
                  const obs = observed(row)
                  return (
                    <tr key={row.id}>
                      <td>{row.parameter}{row.unit ? ` (${row.unit})` : ''}</td>
                      <td>{row.specDisplay}</td>
                      <td>
                        <span className="mr-readonly-val" style={{ minWidth: 60 }}>
                          {obs !== '' ? obs : '—'}
                        </span>
                      </td>
                      <td className="qc-upl-status-cell">
                        <UplStatus value={obs} rule={row.rule} />
                      </td>
                    </tr>
                  )
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Read-only TABLE_GRADES table (Normal, Colour, ADMA, Lohiya, etc.)
// ─────────────────────────────────────────────────────────────
function ReadonlyTableGrade({ tableGrade, gradeKey, observed }) {
  const groups = []
  let cur = null
  tableGrade.rows.forEach(row => {
    if (row.group !== cur) { groups.push({ heading: row.group, rows: [] }); cur = row.group }
    groups[groups.length - 1].rows.push(row)
  })

  return (
    <div className="qc-upl-table-wrap">
      <div className="qc-upl-table-title">
        {tableGrade.title} – {gradeLabel(gradeKey)}
      </div>
      <div className="qc-upl-scroll">
        <table className="qc-upl-table">
          <thead>
            <tr>
              <th>Parameter / पैरामीटर</th>
              <th>Specification / विनिर्देश</th>
              <th>Observation / निरीक्षण</th>
              <th>Result / परिणाम</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(g => (
              <Fragment key={g.heading}>
                <tr className="qc-upl-group-row">
                  <td colSpan={4}>{g.heading}</td>
                </tr>
                {g.rows.map(row => {
                  const obs = observed(row)
                  return (
                    <tr key={row.id}>
                      <td>{row.parameter}{row.unit ? ` (${row.unit})` : ''}</td>
                      <td>{row.specDisplay}</td>
                      <td>
                        <span className="mr-readonly-val" style={{ minWidth: 60 }}>
                          {obs !== '' ? obs : '—'}
                        </span>
                      </td>
                      <td className="qc-upl-status-cell">
                        <UplStatus value={obs} rule={row.rule} />
                      </td>
                    </tr>
                  )
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Mill-wise Suspensibility table (IP)
// ─────────────────────────────────────────────────────────────
function ReadonlyMillTable({ millRows }) {
  if (!Array.isArray(millRows) || millRows.length === 0) return null
  return (
    <>
      <div className="qc-mat-title qc-mill-table-title">
        Mill-wise Suspensibility / मिल-वार निलंबनीयता
      </div>
      <div className="qc-ip-mill-wrap">
        <table className="qc-ip-mill-table">
          <thead>
            <tr>
              <th>Mill</th>
              <th>BR (ml)</th>
              <th>Suspension (%)</th>
              <th>Flow Rate (L/hr)</th>
              <th>Pass</th>
            </tr>
          </thead>
          <tbody>
            {millRows.map((row, i) => (
              <tr key={i}>
                <td className="qc-ip-mill-name">{row.mill || '—'}</td>
                <td className="qc-ip-mill-td">{row.br || '—'}</td>
                <td className="qc-ip-mill-susp">
                  {row.susp !== undefined && row.susp !== null ? row.susp : '—'}
                </td>
                <td className="qc-ip-mill-td">{row.flowRate || '—'}</td>
                <td className="qc-ip-mill-td">{row.pass || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────
// Batch header info strip
// ─────────────────────────────────────────────────────────────
function BatchInfoStrip({ tab, record }) {
  const values   = record.values || {}
  // FG stores tested_by only at the top-level row, not inside values
  const testedBy = values.tested_by || record.tested_by || ''
  const fields = []
  if (tab === 'rm') {
    if (values.date)          fields.push(['Received Date',        formatDate(values.date)])
    if (testedBy)             fields.push(['Tested By',            testedBy])
    if (values.supplier_name) fields.push(['Supplier Name',        values.supplier_name])
    if (values.invoice_no)    fields.push(['Invoice No.',          values.invoice_no])
    if (values.batch_no)      fields.push(['Batch No.',            values.batch_no])
    if (values.brand)         fields.push(['Brand / Type',         values.brand])
    if (values.time)          fields.push(['Time',                 values.time])
  } else if (tab === 'ip') {
    if (values.date)          fields.push(['Manufacturing Date',   formatDate(values.date)])
    if (testedBy)             fields.push(['Tested By',            testedBy])
    if (values.batch_no)      fields.push(['Batch No.',            values.batch_no])
    if (values.brand)         fields.push(['Brand / Type',         values.brand])
    if (values.time)          fields.push(['Time',                 values.time])
  } else if (tab === 'fg') {
    if (values.date)          fields.push(['Manufactured Date',    formatDate(values.date)])
    if (testedBy)             fields.push(['Tested By',            testedBy])
    if (values.batch_no)      fields.push(['Batch No.',            values.batch_no])
    if (values.brand)         fields.push(['Brand / Type',         values.brand])
    if (values.grade)         fields.push(['Grade',                gradeLabel(values.grade)])
    if (values.dryer)         fields.push(['Dryer',                values.dryer])
    if (values.time)          fields.push(['Batch Start Time',     values.time])
    if (values.end_time)      fields.push(['Batch End Time',       values.end_time])
  }
  if (fields.length === 0) return null
  return (
    <div className="qc-batch-header-wrap">
      <div className="qc-batch-bar">
        {fields.map(([label, val]) => (
          <div key={label} className="qc-batch-field">
            <label className="qc-batch-label">{label}</label>
            <div className="qc-batch-input mr-batch-val">{val}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// RM Detail
// ─────────────────────────────────────────────────────────────
function RmDetail({ values }) {
  const mat = RAW_MATERIALS.find(m => m.id === values?.material)
  if (!mat) return <div className="mr-msg">Unknown material</div>
  const brand = values.brand
  const displayLabel = brand ? `${mat.label} – ${brand}` : mat.label
  return (
    <>
      <div className="qc-mat-title">{displayLabel}</div>
      {mat.type === 'spec' && (
        <>
          <ReadonlySpecTable params={mat.params} values={values} />
          <OverallResult results={Object.fromEntries(
            mat.params.filter(p => p.rule).map(p => [p.id, evaluate(values[p.id] ?? '', p.rule)])
          )} />
        </>
      )}
      {mat.type === 'formula-only' && mat.tests.map(test => (
        <ReadonlyFormulaCard key={test.id} formula={test} values={values} />
      ))}
    </>
  )
}

// ─────────────────────────────────────────────────────────────
// IP Detail
// ─────────────────────────────────────────────────────────────
function IpDetail({ values }) {
  // IP stores mill rows as ip_mill_rows (not mill_rows)
  const millRows = Array.isArray(values.ip_mill_rows) ? values.ip_mill_rows : []

  return (
    <>
      <div className="qc-mat-title" style={{ borderTop: '2px solid #b85c2c' }}>
        Fixed Tests / नियत परीक्षण
      </div>
      {IN_PROCESS_PINNED.map(item =>
        item.tests.map(f => (
          <ReadonlyFormulaCard key={f.id} formula={f} values={values} />
        ))
      )}

      {IN_PROCESS.map(section => {
        const hasData = section.tests.some(t => {
          const hasResult = values[t.id] !== undefined && values[t.id] !== null && values[t.id] !== ''
          const hasInputs = t.variables && t.variables.some(v =>
            values[`${t.id}__${v.key}`] !== undefined &&
            values[`${t.id}__${v.key}`] !== null &&
            values[`${t.id}__${v.key}`] !== ''
          )
          return hasResult || hasInputs
        })
        if (!hasData) return null
        return (
          <Fragment key={section.id}>
            <div className="qc-mat-title" style={{ borderTop: '2px solid #b85c2c' }}>
              {section.label}
            </div>
            {section.tests.map(f => (
              <ReadonlyFormulaCard key={f.id} formula={f} values={values} />
            ))}
          </Fragment>
        )
      })}

      <ReadonlyMillTable millRows={millRows} />
    </>
  )
}

// ─────────────────────────────────────────────────────────────
// FG Detail
// ─────────────────────────────────────────────────────────────
function FgDetail({ rawValues }) {
  // Flatten fg_formula_inputs (nested blob) into flat formulaId__varKey keys
  // so ReadonlyFormulaCard can find them the same way the live cards do.
  const values = flattenFormulaInputs(rawValues)

  const product   = FINISHED_GOODS.find(p => p.id === values?.product)
  if (!product) return <div className="mr-msg">Unknown product</div>

  const uplGrade   = values.grade || null
  const tableGrade = TABLE_GRADES[uplGrade || 'normal'] || null
  const isUpl      = uplGrade === 'export' || uplGrade === 'omri'
  const brand      = values.brand
  const isWDG      = values.product === 'sulphur80wdg'

  const displayLabel = brand
    ? `${product.label} – ${brand}${isWDG ? ` (${gradeLabel(uplGrade || 'normal')})` : ''}`
    : `${product.label}${isWDG ? ` (${gradeLabel(uplGrade || 'normal')})` : ''}`

  const hiddenCards = isUpl
    ? (UPL_GRADES[uplGrade]?.hideTests ?? [])
    : tableGrade
    ? tableGrade.hiddenCards
    : []

  // UPL/table grade row values are stored flat directly in values
  // (from ...captured → data-upl-id DOM scrape).
  // Priority: row.id (direct capture) → row.sourceKey (live-state setter) → row.sourceResult
  function observed(row) {
    if (row.type === 'calc') {
      const v = values[row.sourceResult]
      return (v !== undefined && v !== null && v !== '') ? String(v) : ''
    }
    // Try row.id first (direct data-upl-id capture always saves under row.id)
    const byId = values[row.id]
    if (byId !== undefined && byId !== null && String(byId).trim() !== '') {
      return String(byId)
    }
    // Fallback: sourceKey (some rows use setVal(sourceKey) instead of setUplValues)
    if (row.sourceKey) {
      const v = values[row.sourceKey]
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v)
    }
    return ''
  }

  // Overall result
  function collectFGResults() {
    const out = {}
    product.tests
      .filter(t => !hiddenCards.includes(t.id))
      .forEach(t => {
        if (t.type === 'spec-group') {
          t.params.forEach(p => { if (p.rule) out[p.id] = evaluate(values[p.id] ?? '', p.rule) })
        } else if (t.type === 'spec-single') {
          if (t.rule) out[t.id] = evaluate(values[t.id] ?? '', t.rule)
        } else if (t.calcFn && t.rule) {
          out[t.id] = evaluate(values[t.id] ?? '', t.rule)
        }
      })
    return out
  }

  const uplResults = isUpl
    ? Object.fromEntries(
        (UPL_GRADES[uplGrade] || []).map(row => [row.id, evaluate(observed(row), row.rule)])
      )
    : {}

  const tableResults = tableGrade
    ? Object.fromEntries(
        tableGrade.rows.filter(r => r.rule).map(row => [row.id, evaluate(observed(row), row.rule)])
      )
    : {}

  return (
    <>
      <div className="qc-mat-title">{displayLabel}</div>

      {product.tests
        .filter(t => !hiddenCards.includes(t.id))
        .map(test => {
          if (test.type === 'moisture-readings') {
            return <ReadonlyMoisture key={test.id} values={values} uplGrade={uplGrade} />
          }
          if (test.type === 'spec-single') {
            // Resolve valueOverride: scan tableGrade and UPL rows for any row
            // referencing this test as sourceKey, reading value by row.id first
            // (direct DOM scrape key) then sourceKey as fallback.
            let valueOverride
            if (tableGrade) {
              const tableRow = tableGrade.rows.find(r => r.sourceKey === test.id)
              if (tableRow) {
                const byId  = values[tableRow.id]
                const bySrc = values[tableRow.sourceKey]
                const v = (byId  !== undefined && byId  !== null && String(byId ).trim() !== '') ? byId
                        : (bySrc !== undefined && bySrc !== null && String(bySrc).trim() !== '') ? bySrc
                        : undefined
                if (v !== undefined) valueOverride = String(v)
              }
            }
            if (!valueOverride && isUpl && UPL_GRADES[uplGrade]) {
              const uplRow = UPL_GRADES[uplGrade].find(r => r.sourceKey === test.id)
              if (uplRow) {
                const byId  = values[uplRow.id]
                const bySrc = values[uplRow.sourceKey]
                const v = (byId  !== undefined && byId  !== null && String(byId ).trim() !== '') ? byId
                        : (bySrc !== undefined && bySrc !== null && String(bySrc).trim() !== '') ? bySrc
                        : undefined
                if (v !== undefined) valueOverride = String(v)
              }
            }
            return <ReadonlySingleSpec key={test.id} test={test} values={values} valueOverride={valueOverride} />
          }
          if (test.type === 'spec-group') {
            return (
              <div key={test.id}>
                <div className="qc-group-title">{test.name}</div>
                <ReadonlySpecTable params={test.params} values={values} />
              </div>
            )
          }
          if (test.id === 'fg_wetSieve' || test.id === 'fg_drySieve') {
            const nameOverride = tableGrade?.nameOverrides?.[test.id]
            const formula = nameOverride ? { ...test, name: nameOverride } : test
            return <ReadonlySieve key={test.id} formula={formula} values={values} />
          }
          if (test.calcFn) {
            const nameOverride = tableGrade?.nameOverrides?.[test.id]
            const formula = nameOverride ? { ...test, name: nameOverride } : test
            return <ReadonlyFormulaCard key={test.id} formula={formula} values={values} />
          }
          return null
        })}

      {/* UPL Parameters table (Export / OMRI) */}
      {isUpl && (
        <ReadonlyUplTable
          uplGrade={uplGrade}
          uplRows={UPL_GRADES[uplGrade]}
          observed={observed}
        />
      )}

      {/* TABLE_GRADES parameter table (Normal, Colour, ADMA, Lohiya, etc.) */}
      {tableGrade && (
        <ReadonlyTableGrade
          tableGrade={tableGrade}
          gradeKey={uplGrade || 'normal'}
          observed={observed}
        />
      )}

      <OverallResult results={{ ...collectFGResults(), ...uplResults, ...tableResults }} />
    </>
  )
}

// ─────────────────────────────────────────────────────────────
// RecordDetail — full drill-down
// ─────────────────────────────────────────────────────────────
function RecordDetail({ record, onBack }) {
  const { tab, values, created_at } = record
  const matTitle = getMaterialLabel(record)

  return (
    <div className="mr-detail">
      <div className="mr-detail-topbar">
        <button className="mr-back-btn" onClick={onBack} type="button">
          ‹ Back to Records
        </button>
        <span className="mr-tab-badge" style={{ background: TAB_COLORS[tab] || '#888' }}>
          {TAB_LABELS[tab] || tab}
        </span>
        <span className="mr-detail-saved-small">Saved: {formatSavedAt(created_at)}</span>
      </div>

      {/* Dark title bar */}
      <div className="mr-detail-title-bar">
        <div className="qc-title-main" style={{ fontSize: 15 }}>
          {tab === 'rm' ? 'Raw Materials' : tab === 'ip' ? 'In-Process' : 'Finished Goods'}
          <span style={{ fontWeight: 400, fontSize: 13, color: '#f0c890' }}> › {matTitle}</span>
        </div>
      </div>

      {/* Batch header fields */}
      <BatchInfoStrip tab={tab} record={record} />

      {/* Test content — exact replica of live QC form */}
      <div className="qc-content">
        {tab === 'rm' && <RmDetail values={values} />}
        {tab === 'ip' && <IpDetail values={values} />}
        {tab === 'fg' && <FgDetail rawValues={values} />}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// RecordCard — list item
// ─────────────────────────────────────────────────────────────
function RecordCard({ record, onClick }) {
  const { tab, values, created_at } = record
  const batchNo  = values?.batch_no || values?.invoice_no || '—'
  const operator = getOperator(record)
  const date     = values?.date || null

  return (
    <button className="mr-card" onClick={() => onClick(record)} type="button">
      <div className="mr-card-left">
        <div className="mr-card-top-row">
          <span className="mr-tab-badge" style={{ background: TAB_COLORS[tab] || '#888' }}>
            {TAB_LABELS[tab] || tab}
          </span>
          <span className="mr-card-operator">
            <span className="mr-operator-icon">👤</span>
            {operator}
          </span>
        </div>
        <div className="mr-card-material">{getMaterialLabel(record)}</div>
        <div className="mr-card-batch-row">
          <span className="mr-card-batch">Batch No: {batchNo}</span>
        </div>
      </div>
      <div className="mr-card-right">
        <div className="mr-card-date">{formatDate(date)}</div>
        <div className="mr-card-saved">{formatSavedAt(created_at)}</div>
        <span className="mr-card-arrow">›</span>
      </div>
    </button>
  )
}

// ─────────────────────────────────────────────────────────────
// MyRecords — main component
// ─────────────────────────────────────────────────────────────
const PAGE_SIZE = 30

export default function MyRecords({ user }) {
  const [records,    setRecords]    = useState([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState('')
  const [selected,   setSelected]   = useState(null)
  const [filter,     setFilter]     = useState('rm')
  const [search,     setSearch]     = useState('')
  const [dateFilter, setDateFilter] = useState('')
  const [page,       setPage]       = useState(0)

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
        .from('quality_control_records')
        .select('id, created_at, tab, tested_by, values')
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
    if (filter !== 'all' && ['rm','ip','fg'].includes(filter) && r.tab !== filter) return false
    if (dateFilter && (r.values?.date || '') !== dateFilter) return false
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      const b = (r.values?.batch_no || r.values?.invoice_no || '').toLowerCase()
      const o = (r.values?.tested_by || '').toLowerCase()
      const m = getMaterialLabel(r).toLowerCase()
      const d = (r.values?.date || '').toLowerCase()
      if (!b.includes(q) && !o.includes(q) && !m.includes(q) && !d.includes(q)) return false
    }
    return true
  })

  const totalPages  = Math.ceil(filtered.length / PAGE_SIZE)
  const pageRecords = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  if (selected) {
    return <RecordDetail record={selected} onBack={() => setSelected(null)} />
  }

  return (
    <div className="mr-wrapper">

      {/* Type filter + search */}
      <div className="mr-toolbar">
        <div className="mr-filter-bar">
          {['rm', 'ip', 'fg'].map(f => (
            <button key={f} type="button"
              className={`mr-filter-btn ${filter === f ? 'mr-filter-active' : ''}`}
              onClick={() => { setFilter(f); setPage(0) }}
            >
              {TAB_LABELS[f]}
            </button>
          ))}
        </div>
        <input
          className="mr-search"
          type="search"
          placeholder="Search batch, operator, material…"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(0) }}
        />
      </div>

      {/* Date filter */}
      <div className="mr-date-bar">
        <label className="mr-date-label">Filter by Date / तारीख:</label>
        <div className="mr-date-input-wrap">
          <input className="mr-date-input" type="date" value={dateFilter}
            onChange={e => { setDateFilter(e.target.value); setPage(0) }} />
          {dateFilter && (
            <button type="button" className="mr-date-clear"
              onClick={() => { setDateFilter(''); setPage(0) }}>
              ✕ Clear
            </button>
          )}
        </div>
        {dateFilter && (
          <span className="mr-date-showing">Showing: {formatDate(dateFilter)}</span>
        )}
      </div>

      {!loading && !error && (
        <div className="mr-count">
          {filtered.length === 0 ? 'No records found'
            : `${filtered.length} record${filtered.length === 1 ? '' : 's'}`}
        </div>
      )}

      {loading && <div className="mr-msg">Loading records…</div>}
      {error && (
        <div className="mr-msg mr-msg-error">
          {error}
          <button className="mr-retry-btn" type="button" onClick={fetchRecords}>Retry</button>
        </div>
      )}

      {!loading && !error && (
        <>
          {pageRecords.length === 0
            ? <div className="mr-msg">No records match your filter.</div>
            : (
              <div className="mr-list">
                {pageRecords.map(r => (
                  <RecordCard key={r.id} record={r} onClick={setSelected} />
                ))}
              </div>
            )
          }
          {totalPages > 1 && (
            <div className="mr-pagination">
              <button type="button" className="mr-page-btn"
                disabled={page === 0} onClick={() => setPage(p => p - 1)}>‹ Prev</button>
              <span className="mr-page-label">Page {page + 1} of {totalPages}</span>
              <button type="button" className="mr-page-btn"
                disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next ›</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
