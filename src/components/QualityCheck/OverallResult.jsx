// OverallResult — shows PASS/FAIL summary for all limited params.
// Hidden entirely when no params have rules.
export default function OverallResult({ results }) {
  // results: { [paramId]: "PASS" | "FAIL" | null }
  const limited = Object.values(results).filter(v => v !== null)
  if (limited.length === 0) return null

  const overall = limited.every(v => v === 'PASS') ? 'PASS' : 'FAIL'
  return (
    <div className="qc-overall">
      <span className="qc-overall-label">Overall Result / समग्र परिणाम</span>
      <span className={overall === 'PASS' ? 'qc-badge-pass qc-badge-lg' : 'qc-badge-fail qc-badge-lg'}>
        {overall}
      </span>
    </div>
  )
}
