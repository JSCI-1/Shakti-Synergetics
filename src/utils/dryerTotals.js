// Footer totals for the Dryer hourly table. One shared implementation so the
// entry form, "My Records", Production Activity, the save payload and the email
// all agree.
//
//   kg        Σ Kg./Hour Production                       (kg_per_hr)
//   bags25    Σ No. of Bag Per Hours(25)                  (bags_per_hr)
//   bags50Any Σ No. of Bag Per Hours(50/1000), every hour (bags_per_hr_50)
//   bags50    …only hours whose Bag Size By Wt(50/1000) is 50
//   bags1000  …only hours whose Bag Size By Wt(50/1000) is 1000
//
// An hour with bags in the (50/1000) column but NO size (or any other size)
// counts toward bags50Any only — never toward the 50 or the 1000 subtotal.
// Each value is a number, or null when no hour contributed to it.

function num(v) {
  if (v === null || v === undefined) return NaN
  const s = String(v).trim()
  if (s === '') return NaN
  return parseFloat(s)
}

export function computeDryerTotals(rows) {
  const acc = { kg: 0, bags25: 0, bags50Any: 0, bags50: 0, bags1000: 0 }
  const any = { kg: false, bags25: false, bags50Any: false, bags50: false, bags1000: false }
  const add = (k, n) => { acc[k] += n; any[k] = true }

  ;(Array.isArray(rows) ? rows : []).forEach(r => {
    if (!r || typeof r !== 'object') return

    const kg = num(r.kg_per_hr)
    if (!isNaN(kg)) add('kg', kg)

    const b25 = num(r.bags_per_hr)
    if (!isNaN(b25)) add('bags25', b25)

    const b50 = num(r.bags_per_hr_50)
    if (!isNaN(b50)) {
      add('bags50Any', b50)
      const size = num(r.bag_size_wt_50)
      if (size === 50) add('bags50', b50)
      else if (size === 1000) add('bags1000', b50)
    }
  })

  const round = n => Math.round(n * 1000) / 1000
  const out = {}
  Object.keys(acc).forEach(k => { out[k] = any[k] ? round(acc[k]) : null })
  return out
}

// '' for null, otherwise the plain number string.
export function fmtTotal(n) {
  return n === null || n === undefined ? '' : String(n)
}

// Field names of the footer totals (shared by the screens and the email).
export const TOTAL_NAMES = {
  kg:        'Total Kg./Hour Production',
  kgHi:      'कुल किग्रा/घंटा',
  bags25:    'Total No. of Bags(25)',
  bags50Any: 'Total No. of Bags',
  bags50:    'Total No. of Bags(50)',
  bags1000:  'Total No. of Bags(1000)',
}

// [name, value] pairs shown under the "No. of Bag Per Hours(50/1000)" column:
//   Total No. of Bags          — every hour with bags in the (50/1000) column
//   Total No. of Bags(50)      — only when 50 was entered as the size somewhere
//   Total No. of Bags(1000)    — only when 1000 was entered as the size somewhere
export function bags5010Lines(t) {
  if (!t || t.bags50Any === null) return []
  const lines = [[TOTAL_NAMES.bags50Any, t.bags50Any]]
  if (t.bags50 !== null) lines.push([TOTAL_NAMES.bags50, t.bags50])
  if (t.bags1000 !== null) lines.push([TOTAL_NAMES.bags1000, t.bags1000])
  return lines
}
