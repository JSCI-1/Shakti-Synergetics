// ResultBadge — shows PASS (green) or FAIL (red).
// Renders nothing if result is null.
export default function ResultBadge({ result }) {
  if (!result) return null
  return (
    <span className={result === 'PASS' ? 'qc-badge-pass' : 'qc-badge-fail'}>
      {result}
    </span>
  )
}
