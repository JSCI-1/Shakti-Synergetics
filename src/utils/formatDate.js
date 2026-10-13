/**
 * formatDate — site-wide date DISPLAY formatter → dd/mm/yy.
 *
 * Use this everywhere a date is SHOWN to the user. Do NOT use it for
 * <input type="date"> value props — those require the ISO yyyy-mm-dd
 * form the browser control expects; keep passing the raw ISO string there.
 *
 * Accepts:
 *   - an ISO date string 'yyyy-mm-dd' (optionally with a time suffix)
 *   - a Date object
 *   - '' / null / undefined → returns ''
 *
 * Returns a 2-digit-year dd/mm/yy string, e.g. '2026-10-13' → '13/10/26'.
 */
export function formatDate(value) {
  if (!value) return ''

  let y, m, d

  if (value instanceof Date) {
    if (isNaN(value.getTime())) return ''
    y = String(value.getFullYear())
    m = String(value.getMonth() + 1).padStart(2, '0')
    d = String(value.getDate()).padStart(2, '0')
  } else {
    // String path — take the date part before any 'T'/space, split on '-'.
    const datePart = String(value).split('T')[0].split(' ')[0]
    const parts = datePart.split('-')
    if (parts.length !== 3) return String(value)   // unknown format → show as-is
    ;[y, m, d] = parts
  }

  const yy = y.slice(-2)              // 2-digit year
  const mm = m.padStart(2, '0')
  const dd = d.padStart(2, '0')
  return `${dd}/${mm}/${yy}`
}

export default formatDate
