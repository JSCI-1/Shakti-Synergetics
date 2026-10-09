import React from 'react'

// OverallResult — shows PASS / FAIL / Incomplete summary for all limited params.
// Hidden entirely when no params have rules.
//
// Logic:
//   - Only considers parameters that HAVE a rule.
//   - If none → hidden.
//   - Any FAIL  → FAIL.
//   - Any null (empty, no value yet) and no FAIL → Incomplete.
//   - All PASS  → PASS.

export function overallResult(results) {
  // results: { [paramId]: "PASS" | "FAIL" | null }
  const limited = Object.values(results)
  if (limited.length === 0) return null          // no ruled params → hide

  if (limited.some(v => v === 'FAIL'))  return 'FAIL'
  if (limited.some(v => v === null))    return 'Incomplete'
  return 'PASS'
}

export default function OverallResult({ results }) {
  const overall = overallResult(results)
  if (overall === null) return null

  const cls =
    overall === 'PASS'       ? 'qc-badge-pass qc-badge-lg' :
    overall === 'FAIL'       ? 'qc-badge-fail qc-badge-lg' :
                               'qc-badge-incomplete qc-badge-lg'

  return (
    <div className="qc-overall">
      <span className="qc-overall-label">Overall Result / समग्र परिणाम</span>
      <span className={cls}>{overall}</span>
    </div>
  )
}
