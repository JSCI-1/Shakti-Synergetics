// ═══════════════════════════════════════════════════════════════════════════
// CoaHistory — browse already-issued (finalized) Certificates of Analysis.
// ---------------------------------------------------------------------------
// Every finalized COA is stored immutably in coa_issued (migration 048) with a
// captured `snapshot.html` (the exact rendered certificate at issue time). This
// view lists those issued COAs, filtered by a From/To date picker (on issued_at)
// and an optional party, and lets the operator view or re-print any of them. A
// reprint re-uses the stored HTML, so the historical PDF is byte-for-byte the
// certificate as originally issued — no re-computation, no drift.
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react'
import { COA_PARTIES } from '../../../data/coaTemplates.js'
import { listIssuedCoas, getIssuedCoa } from './coaService.js'

// party_key → display name (falls back to the key for unknown/legacy parties).
const PARTY_NAME = COA_PARTIES.reduce((m, p) => { m[p.key] = p.name; return m }, {})

// Local YYYY-MM-DD for the date inputs (today / N days ago).
function isoDay(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Friendly issued-at stamp (DD/MM/YYYY hh:mm AM/PM, local).
function fmtIssuedAt(iso) {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso || '—'
  const date = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
  return `${date} ${time}`
}

export default function CoaHistory() {
  const today = isoDay(new Date())
  const monthAgo = isoDay(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))

  const [fromDate, setFromDate] = useState(monthAgo)
  const [toDate, setToDate] = useState(today)
  const [party, setParty] = useState('')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState('')
  const [openId, setOpenId] = useState('')   // id of the row whose preview is open
  const [openHtml, setOpenHtml] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setNotice('')
    try {
      const data = await listIssuedCoas({ party, fromDate, toDate })
      setRows(data)
      if (data.length === 0) setNotice('No issued certificates match these filters.')
    } finally { setLoading(false) }
  }, [party, fromDate, toDate])

  // Load on mount and whenever the filters change.
  useEffect(() => { load() }, [load])

  // View (inline preview) a historical certificate from its stored HTML.
  const handleView = useCallback(async (id) => {
    if (openId === id) { setOpenId(''); setOpenHtml(''); return }   // toggle off
    const rec = await getIssuedCoa(id)
    const html = rec && rec.snapshot && rec.snapshot.html ? rec.snapshot.html : ''
    if (!html) { setNotice('This certificate has no stored layout to preview.'); return }
    setOpenId(id); setOpenHtml(html)
  }, [openId])

  // Re-print a historical certificate using its stored HTML (no re-computation),
  // via a hidden iframe so no new tab opens (mirrors CoaSection.handlePrint).
  const handleReprint = useCallback(async (id) => {
    const rec = await getIssuedCoa(id)
    const html = rec && rec.snapshot && rec.snapshot.html ? rec.snapshot.html : ''
    if (!html) { setNotice('This certificate has no stored layout to print.'); return }
    const iframe = document.createElement('iframe')
    iframe.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden;'
    document.body.appendChild(iframe)
    const doc = iframe.contentDocument || iframe.contentWindow.document
    doc.open(); doc.write(html); doc.close(); doc.title = ''
    setTimeout(() => {
      try { iframe.contentWindow.focus(); iframe.contentWindow.print() } catch { /* cancelled */ }
      setTimeout(() => { document.body.removeChild(iframe) }, 1000)
    }, 300)
  }, [])

  return (
    <div className="coa-history">
      {/* Filter bar — date picker (From / To) + party */}
      <div className="coa-section-card">
        <div className="coa-section-title">Certificate History</div>
        <div className="coa-history-filters">
          <label className="coa-field">
            <span className="coa-field-label">From</span>
            <input className="coa-input" type="date" value={fromDate}
              max={toDate || undefined}
              onChange={e => setFromDate(e.target.value)} />
          </label>
          <label className="coa-field">
            <span className="coa-field-label">To</span>
            <input className="coa-input" type="date" value={toDate}
              min={fromDate || undefined}
              onChange={e => setToDate(e.target.value)} />
          </label>
          <label className="coa-field">
            <span className="coa-field-label">Party</span>
            <select className="coa-input" value={party} onChange={e => setParty(e.target.value)}>
              <option value="">All parties</option>
              {COA_PARTIES.map(p => <option key={p.key} value={p.key}>{p.name}</option>)}
            </select>
          </label>
          <button type="button" className="coa-btn" onClick={load} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {notice && <div className="coa-picker-msg">{notice}</div>}

      {/* Issued certificates list */}
      {rows.length > 0 && (
        <div className="coa-section-card">
          <div className="coa-history-scroll">
            <table className="coa-history-table">
              <thead>
                <tr>
                  <th>Certificate No.</th>
                  <th>Party</th>
                  <th>Issued</th>
                  <th>Issued By</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className={openId === r.id ? 'coa-history-row-open' : ''}>
                    <td>
                      {r.certificateNo}
                      {r.supersedes && <span className="coa-history-badge" title="Supersedes an earlier certificate">revised</span>}
                    </td>
                    <td>{PARTY_NAME[r.partyKey] || r.partyKey}</td>
                    <td>{fmtIssuedAt(r.issuedAt)}</td>
                    <td>{r.issuedBy || '—'}</td>
                    <td className="coa-history-actions">
                      <button type="button" className="coa-btn coa-btn-sm" onClick={() => handleView(r.id)}>
                        {openId === r.id ? 'Hide' : 'View'}
                      </button>
                      <button type="button" className="coa-btn coa-btn-sm" onClick={() => handleReprint(r.id)}>
                        Print
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Inline preview of the selected historical certificate */}
      {openId && openHtml && (
        <div className="coa-preview">
          <iframe title="COA history preview" className="coa-preview-frame" srcDoc={openHtml} />
        </div>
      )}
    </div>
  )
}
