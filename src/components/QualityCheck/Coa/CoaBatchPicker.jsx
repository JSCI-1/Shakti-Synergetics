// ═══════════════════════════════════════════════════════════════════════════
// CoaBatchPicker — look up a batch number and DISAMBIGUATE the match.
// ---------------------------------------------------------------------------
// A bare batch number is NOT unique (same batch recurs on other days/dryers/
// grades — see migrations 036/039). So when more than one authoritative FG
// record matches, this component lists every candidate by its identity fields
// (product / grade / manufacturing date / dryer) and makes the operator pick.
// It NEVER silently selects the first row (task §4).
// ═══════════════════════════════════════════════════════════════════════════

import { useState } from 'react'
import { searchBatches } from './coaService.js'

export default function CoaBatchPicker({ onAdd, disabled }) {
  const [batchNo, setBatchNo] = useState('')
  const [candidates, setCandidates] = useState(null) // null = not searched yet
  const [searching, setSearching] = useState(false)
  const [msg, setMsg] = useState('')

  async function doSearch(e) {
    e?.preventDefault?.()
    const needle = batchNo.trim()
    setMsg('')
    setCandidates(null)
    if (!needle) { setMsg('Enter a batch number to search.'); return }
    setSearching(true)
    try {
      const rows = await searchBatches(needle)
      setCandidates(rows)
      if (rows.length === 0) setMsg(`No saved QC record found for batch "${needle}".`)
    } catch {
      setMsg('Search failed. Check the connection and try again.')
    } finally {
      setSearching(false)
    }
  }

  function pick(c) {
    onAdd?.(c)
    // Keep the list so the operator can add several candidates if intended;
    // clear the message.
    setMsg(`Added batch ${c.batchNo} (${c.product || '—'} / ${c.grade || '—'} / ${c.logDate || '—'} / ${c.dryer || '—'}).`)
  }

  return (
    <div className="coa-picker">
      <form className="coa-picker-bar" onSubmit={doSearch}>
        <input
          className="coa-input"
          placeholder="Batch No. (e.g. 3512)"
          value={batchNo}
          onChange={e => setBatchNo(e.target.value)}
          disabled={disabled}
        />
        <button type="submit" className="coa-btn" disabled={disabled || searching}>
          {searching ? 'Searching…' : 'Search'}
        </button>
      </form>

      {msg && <div className="coa-picker-msg">{msg}</div>}

      {candidates && candidates.length > 1 && (
        <div className="coa-disambig">
          <div className="coa-disambig-title">
            {candidates.length} records match this batch number — select the correct one:
          </div>
          <table className="coa-disambig-table">
            <thead>
              <tr><th>Product</th><th>Grade</th><th>Mfg Date</th><th>Dryer</th><th></th></tr>
            </thead>
            <tbody>
              {candidates.map(c => (
                <tr key={c.sourceRecordId}>
                  <td>{c.product || '—'}</td>
                  <td>{c.grade || '—'}</td>
                  <td>{c.logDate || '—'}</td>
                  <td>{c.dryer || '—'}</td>
                  <td><button type="button" className="coa-btn coa-btn-sm" onClick={() => pick(c)} disabled={disabled}>Add</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {candidates && candidates.length === 1 && (
        <div className="coa-disambig">
          <div className="coa-disambig-one">
            Found: <b>{candidates[0].product || '—'}</b> / {candidates[0].grade || '—'} / {candidates[0].logDate || '—'} / Dryer {candidates[0].dryer || '—'}
          </div>
          <button type="button" className="coa-btn" onClick={() => pick(candidates[0])} disabled={disabled}>
            Add this batch
          </button>
        </div>
      )}
    </div>
  )
}
