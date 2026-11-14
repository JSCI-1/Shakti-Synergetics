import React from 'react'
import { TOTAL_NAMES, bags5010Lines } from '../utils/dryerTotals.js'

// Footer-row cells of the Dryer hourly table (entry form, Dryer "My Records",
// Production Activity). Compact layout: each total cell starts under its own
// column and also spans the EMPTY column to its right (the "Bag Size By Wt"
// column, or Colour for Kg./Hour), so every total fits on ONE line as
// "name …… value" instead of wrapping into a tall block.
//   No. of Bag Per Hours(25)     + Bag Size By Wt.(25)      → Total No. of Bags(25)
//   No. of Bag Per Hours(50/1000)+ Bag Size By Wt(50/1000)  → Total No. of Bags,
//                                                             (50), (1000)
//   Kg./Hour Production          + Colour/Normal/OMRI      → Total Kg./Hour Production
// So the row uses 6 columns for the three totals; callers shrink the trailing
// filler by one column accordingly.

const cellStyle = {
  textAlign: 'left',
  verticalAlign: 'middle',
  background: '#f5f0ea',
  padding: '4px 8px',
  borderTop: '2px solid #c9b79f',
}
const lineStyle = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: '8px',
  lineHeight: 1.35,
}
const nameStyle = { fontSize: '10.5px', fontWeight: 600, color: '#8a5a35', whiteSpace: 'nowrap' }
const hiStyle = { fontWeight: 400, color: '#8a7f70' }
const valueStyle = { fontSize: '12.5px', fontWeight: 700, color: '#3b2a1a', whiteSpace: 'nowrap' }

const show = v => (v === null || v === undefined || v === '' ? '—' : v)

function Line({ name, hi, value }) {
  return (
    <div style={lineStyle}>
      <span style={nameStyle}>
        {name}
        {hi ? <> / <span style={hiStyle}>{hi}</span></> : null}
      </span>
      <span style={valueStyle}>{show(value)}</span>
    </div>
  )
}

// Under "No. of Bag Per Hours(25)" (spans it + "Bag Size By Wt.(25)")
export function Bags25TotalCell({ totals }) {
  return (
    <td colSpan={2} style={cellStyle}>
      <Line name={TOTAL_NAMES.bags25} value={totals.bags25} />
    </td>
  )
}

// Under "No. of Bag Per Hours(50/1000)" (spans it + "Bag Size By Wt(50/1000)"):
// Total No. of Bags, plus (50) / (1000) when those sizes were entered.
export function Bags5010TotalCell({ totals }) {
  const lines = bags5010Lines(totals)
  return (
    <td colSpan={2} style={cellStyle}>
      {lines.length === 0
        ? <Line name={TOTAL_NAMES.bags50Any} value={null} />
        : lines.map(([name, value]) => <Line key={name} name={name} value={value} />)}
    </td>
  )
}

// Under "Kg./Hour Production" (spans it + "Colour/Normal/OMRI")
export function KgTotalCell({ value }) {
  return (
    <td colSpan={2} style={cellStyle}>
      <Line name={TOTAL_NAMES.kg} value={value} />
      <div style={{ ...nameStyle, ...hiStyle, fontSize: '10px', lineHeight: 1.2 }}>{TOTAL_NAMES.kgHi}</div>
    </td>
  )
}

// Leading cell of the totals row (spans the columns before the bag counts).
export function TotalsLeadCell({ colSpan }) {
  return (
    <td colSpan={colSpan} style={{ textAlign: 'right', fontWeight: 700, padding: '4px 10px', verticalAlign: 'middle', borderTop: '2px solid #c9b79f' }}>
      Totals / <span style={hiStyle}>कुल</span>
    </td>
  )
}
