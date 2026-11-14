import React from 'react'
import { latestFieldEditIso, fmtIstTs } from './dryerHistory.js'

// Read-only per-field edit history for a Dryer hourly cell — the same display
// the Dryer entry form shows under an edited field:
//   • the latest edit time (blue), then
//   • every previous value, newest first, each with its own time (muted).
// Renders nothing for a field that was never edited (__hist[field] length < 2).
// Used by Dryer "My Records" and Production Activity. Inline styles so it looks
// the same whichever stylesheet the screen loads.

const MAINT_LABELS = {
  shifter_screen: 'Shifter-Screen Cleaning',
  atomizer_water: 'Running the Atomizer on Water',
}

const wrapStyle = { marginTop: '3px', fontSize: '11px', lineHeight: 1.4, color: '#8a7f70', textAlign: 'center' }
const latestStyle = { display: 'block', color: '#1565c0', fontWeight: 600, whiteSpace: 'nowrap' }
const prevStyle = { display: 'block', marginTop: '1px', color: '#a79d8f', fontStyle: 'italic', whiteSpace: 'nowrap' }
const prevTsStyle = { color: '#b7ab99' }

function histOf(row) {
  const h = row && row.__hist
  return h && typeof h === 'object' && !Array.isArray(h) ? h : {}
}

// True when this field of the row was edited at least once.
export function hasFieldHistory(row, field) {
  const arr = histOf(row)[field]
  return Array.isArray(arr) && arr.length >= 2
}

function fmtVal(field, v) {
  if (field === 'maintenance') {
    const m = v && typeof v === 'object' ? v : {}
    const picks = Object.keys(MAINT_LABELS).filter(k => m[k]).map(k => MAINT_LABELS[k])
    return picks.length ? picks.join(', ') : '(none)'
  }
  return v !== undefined && v !== null && v !== '' ? String(v) : '—'
}

export default function DryerFieldHistory({ row, field }) {
  if (!hasFieldHistory(row, field)) return null
  const hist = histOf(row)
  const arr = hist[field]
  const latest = fmtIstTs(latestFieldEditIso(hist, field))
  // Previous values newest-first = every entry except the current (last) one.
  const previous = arr.slice(0, arr.length - 1).reverse()
  return (
    <div style={wrapStyle}>
      {latest && <span style={latestStyle}>{latest}</span>}
      {previous.map((e, k) => (
        <span key={k} style={prevStyle}>
          Previous: {fmtVal(field, e && e.v)}{' '}
          <span style={prevTsStyle}>{fmtIstTs(e && e.ts)}</span>
        </span>
      ))}
    </div>
  )
}
