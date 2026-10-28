import React, { useState, useRef, useEffect, useCallback, Fragment } from 'react'
import { RAW_MATERIALS, IN_PROCESS, IN_PROCESS_PINNED, FINISHED_GOODS } from '../../data/qualityData.js'
import { UPL_GRADES, TABLE_GRADES } from '../../data/uplData.js'
import { evaluate, calcSuspensibility } from '../../utils/qualityUtils.js'
import { overallResult } from './OverallResult.jsx'
import SpecTable from './SpecTable.jsx'
import FormulaCalculator from './FormulaCalculator.jsx'
import OverallResult from './OverallResult.jsx'
import { useDraft, useUserId } from '../../utils/useDraft.js'
import { supabase, supabaseReady } from '../../supabaseClient.js'
import './QualityCheck.css'

const TABS = [
  { key: 'rm', label: 'Raw Materials',  labelHi: 'कच्चा माल'  },
  { key: 'ip', label: 'In-Process',     labelHi: 'इन-प्रोसेस' },
  { key: 'fg', label: 'Finished Goods', labelHi: 'तैयार माल'  },
]

// ─────────────────────────────────────────────────────────────
// Finished Goods live push to Production → Activity (qc_activity_draft).
// ENABLED. The row only goes live once ALL required FG fields are entered
// (see FG_ACTIVITY_REQUIRED_READY below) — no partial/incomplete row is
// surfaced. The authoritative save (Print/Download → quality_control_records
// → Google Sheets) is independent of this feed.
// ─────────────────────────────────────────────────────────────
const FG_ACTIVITY_LIVE_PUSH_ENABLED = true

// ─────────────────────────────────────────────────────────────
// Live Google-Sheet sync for the repeated FG readings (Wet/Dry Sieve + Moisture
// → qc_fg_sieve_readings / qc_fg_moisture_readings) as the chemist presses
// "Record". DISABLED per requirement: QC data must reach the Google Sheet ONLY
// when the final "Save" button is pressed (not live as readings are recorded).
// The authoritative Save path (→ quality_control_records → Sheets) carries each
// reading's own website entry time, so the sheet still shows real entry
// timestamps, just written once on Save. Production → Activity (qc_activity_draft)
// is a SEPARATE live feed and is NOT affected by this flag.
// Flip back to true to restore the live-as-you-record sheet sync.
const FG_READINGS_LIVE_SHEET_SYNC_ENABLED = false


// ─────────────────────────────────────────────────────────────
// IST time helpers — single source of truth for recorded reading times.
//
// BUG FIX: a recorded reading once showed a stray morning time (e.g. 6:32 AM)
// that was really an afternoon reading. Root cause: the display time string was
// built with the BROWSER's local timezone (toLocaleTimeString with no timeZone),
// so on any device not set to IST it rendered the wrong wall-clock (a ~12:00 PM
// IST reading printed as its UTC equivalent ~06:30 AM). Every recorded reading
// time is now derived EXPLICITLY in Asia/Kolkata from the same Date object whose
// ISO is stored, so the UI, the ISO, and the Google Sheet always agree and no
// reading can ever drift to the wrong half of the day again.
const IST_TIME_FMT = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true,
})
// Format a Date (or ISO string) as an IST hh:mm AM/PM clock string.
function istClock(dateOrIso) {
  const d = dateOrIso instanceof Date ? dateOrIso : new Date(dateOrIso)
  if (isNaN(d.getTime())) return ''
  return IST_TIME_FMT.format(d)
}

// Which UPL parameter rows a Wet/Dry Sieve formula result can be pushed into
// (the micron targets shown in the UPL Parameters table), per grade.
//   OMRI   → Wet Sieve + Dry Sieve
//   Export → Wet Sieve only (Dry Sieve is not an Export parameter)
const SIEVE_UPL_TARGETS = {
  omri: {
    fg_drySieve: [
      { id: 'upl_omri_ds_500', label: '500 Micron (Min 99)' },
      { id: 'upl_omri_ds_106', label: '106 Micron (Max 11)' },
    ],
    fg_wetSieve: [
      { id: 'upl_omri_ws_160', label: '160 Micron (Min 99.98)' },
      { id: 'upl_omri_ws_25',  label: '25 Micron (Min 99.50)' },
    ],
  },
  export: {
    fg_wetSieve: [
      { id: 'upl_exp_ws_160', label: '160 Micron (Max 0.02)' },
      { id: 'upl_exp_ws_25',  label: '25 Micron (Max 0.20)' },
    ],
  },
}

// ─────────────────────────────────────────────────────────────
// BrandTypePopup — reusable dropdown-anchored popup
// Props:
//   anchorRef     ref to the element the popup aligns under
//   open          bool
//   initialValue  string  pre-fill the input
//   placeholder   string
//   onConfirm(v)  called with trimmed value (may be '')
//   onClose()     called on skip / esc / outside click
// ─────────────────────────────────────────────────────────────
function BrandTypePopup({ anchorRef, open, initialValue, placeholder, onConfirm, onClose }) {
  const [draft, setDraft] = useState(initialValue || '')
  const inputRef = useRef(null)
  const panelRef = useRef(null)

  // Sync draft when popup reopens with a new initial value
  useEffect(() => {
    if (open) {
      setDraft(initialValue || '')
      // auto-focus after paint
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open, initialValue])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handler(e) {
      if (panelRef.current && !panelRef.current.contains(e.target) &&
          anchorRef.current && !anchorRef.current.contains(e.target)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, onClose, anchorRef])

  // Close on Esc
  useEffect(() => {
    if (!open) return
    function handler(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  function confirm() { onConfirm(draft.trim()) }

  return (
    <div className="qc-brand-popup" ref={panelRef} role="dialog" aria-modal="true">
      <div className="qc-brand-popup-label">
        Brand / Type <span className="qc-brand-popup-opt">(optional) / ब्रँड / प्रकार</span>
      </div>
      <input
        ref={inputRef}
        className="qc-brand-popup-input"
        placeholder=""
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') confirm() }}
      />
      <div className="qc-brand-popup-actions">
        <button type="button" className="qc-brand-popup-confirm" onClick={confirm}>
          Confirm
        </button>
        <button type="button" className="qc-brand-popup-skip" onClick={onClose}>
          Skip
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// useBrandType — per-section brand/type state + popup control
// Returns: { brand, popupOpen, dropdownRef, openPopup, handleConfirm, handleClose, reset }
// ─────────────────────────────────────────────────────────────
function useBrandType() {
  const [brand,     setBrand]     = useState('')
  const [popupOpen, setPopupOpen] = useState(false)
  const dropdownRef = useRef(null)

  const openPopup  = useCallback(() => setPopupOpen(true),  [])
  const handleClose = useCallback(() => setPopupOpen(false), [])

  const handleConfirm = useCallback((val) => {
    setBrand(val)
    setPopupOpen(false)
  }, [])

  const reset = useCallback(() => {
    setBrand('')
    setPopupOpen(false)
  }, [])

  return { brand, popupOpen, dropdownRef, openPopup, handleConfirm, handleClose, reset }
}

// ─────────────────────────────────────────────────────────────
// DOM-based report builder
// ─────────────────────────────────────────────────────────────
const TD = 'padding:6px 8px;border:1px solid #999;font-size:11px;vertical-align:top;word-break:break-word'
const TH = `${TD};background:#f0f0f0;font-weight:bold`

function formulaCardToHtml(card) {
  const name    = card.querySelector('.qc-formula-name')?.textContent.trim() || ''
  const formula = card.querySelector('.qc-formula-display')?.innerHTML.trim() || ''
  const unit    = card.querySelector('.qc-formula-unit')?.textContent.trim()  || ''
  const result  = card.querySelector('[data-result]')?.textContent.trim()     || '—'

  const inputs  = Array.from(card.querySelectorAll('input[data-var-key]'))
  const varRows = inputs.map(inp => {
    const sym  = inp.dataset.varLabel || inp.dataset.varKey || ''
    const desc = inp.dataset.varDesc  || ''
    const unt  = inp.dataset.varUnit  || ''
    const val  = inp.value || '—'
    return `<tr>
      <td style="${TD};width:12%;font-weight:600">${sym}</td>
      <td style="${TD};width:48%">${desc}</td>
      <td style="${TD};width:22%;text-align:center">${val}</td>
      <td style="${TD};width:18%;text-align:center">${unt || '—'}</td>
    </tr>`
  }).join('')

  const resultRow = `<tr style="-webkit-print-color-adjust:exact;print-color-adjust:exact;background:#fffde7">
    <td style="${TD};font-weight:bold" colspan="3">Result / परिणाम</td>
    <td style="${TD};text-align:center;font-weight:bold">${result}</td>
  </tr>`

  return `<div style="page-break-inside:avoid;margin-bottom:16px;padding:10px;border:1px solid #e0e0e0;border-radius:3px;box-sizing:border-box;width:100%">
    <div style="font-weight:bold;font-size:13px;color:#b85c2c;margin-bottom:6px">${name}</div>
    <div style="background:#f9f9f9;border:1px solid #ddd;padding:7px 10px;margin-bottom:8px;border-radius:3px;font-size:12px;word-break:break-word">
      <b>Formula:</b>&nbsp;${formula}&nbsp;&nbsp;<em style="color:#777;font-size:11px">${unit}</em>
    </div>
    <table style="width:100%;border-collapse:collapse;table-layout:fixed;word-break:break-word">
      <tr>
        <th style="${TH};width:12%">Symbol</th>
        <th style="${TH};width:48%">Description</th>
        <th style="${TH};width:22%;text-align:center">Value</th>
        <th style="${TH};width:18%;text-align:center">Unit</th>
      </tr>
      ${varRows}
      ${resultRow}
    </table>
  </div>`
}

function specTableToHtml(container) {
  const rows  = Array.from(container.querySelectorAll('tbody tr'))
  if (!rows.length) return ''
  const hasRule = !!container.querySelector('[data-has-rule="true"]')
  const header = `<tr>
    <th style="${TH};width:30%">Parameter</th>
    <th style="${TH};width:25%">Specification</th>
    <th style="${TH};width:${hasRule ? '25%' : '45%'}">Observation</th>
    ${hasRule ? `<th style="${TH};width:20%;text-align:center">Result</th>` : ''}
  </tr>`
  const bodyRows = rows.map(tr => {
    const paramEl  = tr.querySelector('.qc-param-name')
    const specEl   = tr.querySelector('.qc-spec')
    const input    = tr.querySelector('input[data-param-id], select[data-param-id]')
    const resultEl = tr.querySelector('[data-result]')
    const paramName = paramEl?.firstChild?.textContent?.trim() || ''
    const spec      = specEl?.textContent.trim() || '—'
    const val       = input ? (input.value ? `${input.value}${input.dataset.paramUnit ? ' ' + input.dataset.paramUnit : ''}` : '—') : '—'
    const resultTxt = resultEl?.textContent.trim() || ''
    const resultDisp = resultTxt
      ? (() => {
          const c = resultTxt === 'PASS' ? '#2e7d32' : resultTxt === 'FAIL' ? '#c62828' : '#f57f17'
          return `<span style="color:${c};font-weight:bold">${resultTxt}</span>`
        })()
      : '—'
    return `<tr>
      <td style="${TD}">${paramName}</td>
      <td style="${TD}">${spec}</td>
      <td style="${TD}">${val}</td>
      ${hasRule ? `<td style="${TD};text-align:center">${resultDisp}</td>` : ''}
    </tr>`
  }).join('')
  return `<div style="page-break-inside:avoid;margin-bottom:16px">
    <table style="width:100%;border-collapse:collapse;table-layout:fixed;word-break:break-word">
      ${header}${bodyRows}
    </table>
  </div>`
}

// ─────────────────────────────────────────────────────────────
// collectReportValues — scrape the live DOM (#qc-content) for the
// SAME values the printed report shows, keyed by test/param id so
// the saved Supabase record matches the printout exactly.
//   - Formula cards  → result value under the card's test id
//   - .qc-single-spec → input value under its data-test-id
//   - spec-group     → input/select value under data-param-id
//   - UPL table      → input/select value under data-upl-id
// Formula-card results read the displayed "<num> <unit>" and keep
// only the leading number so numeric view casts keep working.
// ─────────────────────────────────────────────────────────────
function collectReportValues() {
  const out = {}
  const content = document.getElementById('qc-content')
  if (!content) return out

  // Formula cards — store BOTH the computed result AND each input variable.
  // The result is keyed by the card id (e.g. 'sulphurPowder_purity').
  // Each input var is keyed as '<cardId>__<varKey>' (e.g.
  // 'sulphurPowder_purity__M1') so purity's M and mesh-size's M never collide,
  // and the sync pipeline emits an independent field_change (own entry time)
  // for every input exactly like a spec field.
  content.querySelectorAll('[data-formula-card]').forEach(card => {
    const id = card.getAttribute('data-formula-card')
    if (!id) return
    const resultText = card.querySelector('.qc-calc-value[data-result]')?.textContent.trim() || ''
    const num = resultText.replace(/[^0-9.+-].*$/, '').trim()
    out[id] = num !== '' && num !== '—' ? num : ''

    // Capture each input variable cell as its own value key.
    card.querySelectorAll('input[data-var-key]').forEach(inp => {
      const vk = inp.getAttribute('data-var-key')
      if (!vk) return
      out[`${id}__${vk}`] = inp.value ?? ''
    })
  })

  // Single-spec blocks (pH, Wettability, Moisture %) — keyed by data-test-id
  content.querySelectorAll('.qc-single-spec[data-test-id]').forEach(block => {
    const id = block.getAttribute('data-test-id')
    if (!id) return
    const inp = block.querySelector('input')
    out[id] = inp ? (inp.value ?? '') : ''
  })

  // Spec-group inputs/selects (Persistent Foaming) — keyed by data-param-id
  content.querySelectorAll('[data-param-id]').forEach(el => {
    const id = el.getAttribute('data-param-id')
    if (!id) return
    out[id] = el.value ?? ''
  })

  // UPL parameters — keyed by data-upl-id
  content.querySelectorAll('[data-upl-id]').forEach(el => {
    const id = el.getAttribute('data-upl-id')
    if (!id) return
    out[id] = el.value ?? ''
  })

  return out
}

// ─────────────────────────────────────────────────────────────
// printReport
// ─────────────────────────────────────────────────────────────
function printReport({ activeTab, rmSelected, ipSelected, fgSelected, date, testedBy,
                       rmBrand, ipBrand, fgBrand, rmSupplierName, rmInvoiceNo, rmBatchNo,
                       uplGrade, uplValues, fgDryer }) {
  const now      = new Date()
  const printTs  = now.toLocaleDateString('en-IN') + ' ' +
                   now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
  const safeDate = date || now.toISOString().slice(0, 10)

  let sectionLabel = '', materialLabel = '', brand = ''
  if (activeTab === 'rm') {
    sectionLabel  = 'Raw Materials'
    materialLabel = RAW_MATERIALS.find(m => m.id === rmSelected)?.label || ''
    brand         = rmBrand
  } else if (activeTab === 'ip') {
    sectionLabel  = 'In-Process'
    materialLabel = IN_PROCESS.find(t => t.id === ipSelected)?.label || ''
    brand         = ipBrand
  } else {
    sectionLabel  = 'Finished Goods'
    materialLabel = FINISHED_GOODS.find(p => p.id === fgSelected)?.label || ''
    brand         = fgBrand
  }

  const gradeLabel        = uplGrade === 'export' ? 'UPL Export Grade' : uplGrade === 'omri' ? 'UPL OMRI Grade' : uplGrade === 'colour' ? 'Colour' : uplGrade === 'sumitomo' ? 'SUMITOMO CHEMICAL INDIA' : uplGrade === 'hemani_v' ? 'HEMANI INDUSTRIES UNIT - V' : uplGrade === 'lohiya' ? 'LOHIYA CHEMICAL LTD.' : uplGrade === 'adama' ? 'ADAMA INDIA P LTD.' : uplGrade === 'biostadt' ? 'BIOSTADT INDIA LTD.' : uplGrade === 'sanaca' ? 'Sanaca Dubai' : uplGrade === 'villacrop' ? 'Villa Crop' : uplGrade === 'yellowstone' ? 'Yellowstone' : uplGrade === 'iffco' ? 'IFFCO' : 'Normal'
  const uplSuffix         = (activeTab === 'fg' && uplGrade) ? ` (${gradeLabel})` : ''
  const materialWithBrand = brand ? `${materialLabel} – ${brand}${uplSuffix}` : `${materialLabel}${uplSuffix}`

  const content = document.getElementById('qc-content')
  let   contentHtml = ''

  if (content) {
    content.querySelectorAll('[data-formula-card]').forEach(card => {
      contentHtml += formulaCardToHtml(card)
    })
    content.querySelectorAll('.qc-table-wrap').forEach(wrap => {
      contentHtml += specTableToHtml(wrap)
    })
    content.querySelectorAll('.qc-single-spec').forEach(block => {
      const nameEl = block.querySelector('.qc-single-name')
      const methEl = block.querySelector('.qc-method')
      const inp    = block.querySelector('input')
      const name   = nameEl?.textContent.trim() || ''
      const meth   = methEl?.textContent.trim() || ''
      const unit   = inp?.nextElementSibling?.textContent.trim() || ''
      const val    = inp?.value ? `${inp.value}${unit ? ' ' + unit : ''}` : '—'
      contentHtml += `<div style="page-break-inside:avoid;margin-bottom:16px;padding:10px;border:1px solid #e0e0e0;border-radius:3px;box-sizing:border-box;width:100%">
        <div style="font-weight:bold;font-size:13px;color:#b85c2c;margin-bottom:4px">${name}</div>
        ${meth ? `<div style="font-size:10px;color:#888;margin-bottom:6px;font-style:italic">${meth}</div>` : ''}
        <table style="width:100%;border-collapse:collapse;table-layout:fixed">
          <tr><th style="${TH};width:60%">Parameter</th><th style="${TH};width:40%">Value</th></tr>
          <tr><td style="${TD}">${name}</td><td style="${TD}">${val}</td></tr>
        </table>
      </div>`
    })

    // Mill-wise Suspensibility table
    const millTable = content.querySelector('[data-mill-table] table')
    if (millTable) {
      const rows = Array.from(millTable.querySelectorAll('tbody tr'))
      const bodyRows = rows.map(tr => {
        const cells  = Array.from(tr.querySelectorAll('td'))
        const mill   = cells[0]?.textContent.trim() || '—'
        const br     = cells[1]?.querySelector('input')?.value || '—'
        const susp   = cells[2]?.textContent.trim() || '—'
        const fr     = cells[3]?.querySelector('input')?.value || '—'
        const pass   = cells[4]?.querySelector('input')?.value || '—'
        return `<tr>
          <td style="${TD};font-weight:700;color:#b85c2c">${mill}</td>
          <td style="${TD};text-align:center">${br}</td>
          <td style="${TD};text-align:center;font-weight:700">${susp}</td>
          <td style="${TD};text-align:center">${fr}</td>
          <td style="${TD};text-align:center">${pass}</td>
        </tr>`
      }).join('')
      contentHtml += `<div style="page-break-inside:avoid;margin-bottom:16px">
        <div style="font-weight:bold;font-size:13px;color:#b85c2c;margin-bottom:6px">Mill-wise Suspensibility / मिल-वार निलंबनीयता</div>
        <table style="width:100%;border-collapse:collapse;table-layout:fixed;word-break:break-word">
          <tr>
            <th style="${TH};width:12%">Mill</th>
            <th style="${TH};width:18%;text-align:center">BR (ml)</th>
            <th style="${TH};width:22%;text-align:center">Suspension (%)</th>
            <th style="${TH};width:24%;text-align:center">Flow Rate (L/hr)</th>
            <th style="${TH};width:24%;text-align:center">Pass</th>
          </tr>
          ${bodyRows}
        </table>
      </div>`
    }
  }

  // UPL Parameters table (Finished Goods only, when a grade is active)
  // UPL grades (export/omri) use UPL_GRADES; parameter-table grades (ADMA,
  // Lohiya, …) use their own extra-param rows. Other grades (normal/colour)
  // have no extra table → rows stays undefined.
  const printTableGrade = TABLE_GRADES[uplGrade] || null
  const fgExtraRows = printTableGrade
    ? printTableGrade.rows
    : UPL_GRADES[uplGrade]
  if (activeTab === 'fg' && uplGrade && uplValues && fgExtraRows) {
    const rows = fgExtraRows
    const tableTitle = printTableGrade ? printTableGrade.title : 'UPL Parameters'
    const groups = []
    let cur = null
    rows.forEach(row => {
      if (row.group !== cur) { groups.push({ heading: row.group, rows: [] }); cur = row.group }
      groups[groups.length - 1].rows.push(row)
    })
    const grpRows = groups.map(g => {
      const headerRow = `<tr style="-webkit-print-color-adjust:exact;print-color-adjust:exact;background:#fdf3ee">
        <td colspan="4" style="${TD};font-weight:bold;color:#b85c2c">${g.heading}</td>
      </tr>`
      const dataRows = g.rows.map(row => {
        const val    = uplValues[row.id] ?? ''
        const status = evaluate(val, row.rule)
        const statusHtml = status === 'PASS'
          ? `<span style="color:#2e7d32;font-weight:bold">Pass</span>`
          : status === 'FAIL'
          ? `<span style="color:#c62828;font-weight:bold">Fail</span>`
          : '—'
        return `<tr>
          <td style="${TD}">${row.parameter}${row.unit ? ` (${row.unit})` : ''}</td>
          <td style="${TD}">${row.specDisplay}</td>
          <td style="${TD};text-align:center">${val !== '' ? val : '—'}</td>
          <td style="${TD};text-align:center">${statusHtml}</td>
        </tr>`
      }).join('')
      return headerRow + dataRows
    }).join('')

    contentHtml += `<div style="page-break-inside:avoid;margin-bottom:16px">
      <div style="font-weight:bold;font-size:13px;color:#b85c2c;margin-bottom:6px">${tableTitle} – ${gradeLabel}</div>
      <table style="width:100%;border-collapse:collapse;table-layout:fixed;word-break:break-word">
        <tr>
          <th style="${TH};width:30%">Parameter</th>
          <th style="${TH};width:25%">Specification</th>
          <th style="${TH};width:22%;text-align:center">${printTableGrade ? 'Observation' : 'Result'}</th>
          <th style="${TH};width:23%;text-align:center">${printTableGrade ? 'Result' : 'Status'}</th>
        </tr>
        ${grpRows}
      </table>
    </div>`
  }

  // (Production Balance block removed)

  const reportHtml = `
    <style>
      @page { size: A4 portrait; margin: 12mm; }
      #print-area, #print-area * { font-family: Arial, sans-serif; box-sizing: border-box; }
      #print-area { width: 100%; max-width: 100%; font-size: 12px; color: #000; }
    </style>
    <div style="text-align:center;border-bottom:2px solid #000;padding-bottom:8px;margin-bottom:12px">
      <div style="font-size:15px;font-weight:bold">Jaishil Sulphur &amp; Chemical Industries</div>
      <div style="font-size:10px;color:#555">Plot No. D-73, Ambad, Nashik – 422 010</div>
      <div style="font-size:17px;font-weight:bold;margin:6px 0 2px">Test Report / परीक्षण रिपोर्ट</div>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:12px;font-size:11px">
      <tr>
        <td style="padding:4px 0"><b>Date / तारीख:</b> ${safeDate}</td>
        <td style="padding:4px 0;text-align:center"><b>Tested By / परीक्षक:</b> ${testedBy || '—'}</td>
        <td style="padding:4px 0;text-align:right"><b>Printed:</b> ${printTs}</td>
      </tr>
      ${activeTab === 'rm' && (rmSupplierName || rmInvoiceNo || rmBatchNo) ? `<tr>
        ${rmSupplierName ? `<td style="padding:2px 0"><b>Supplier / आपूर्तिकर्ता:</b> ${rmSupplierName}</td>` : '<td></td>'}
        ${rmInvoiceNo    ? `<td style="padding:2px 0;text-align:center"><b>Invoice No.:</b> ${rmInvoiceNo}</td>` : '<td></td>'}
        ${rmBatchNo      ? `<td style="padding:2px 0;text-align:right"><b>Batch No.:</b> ${rmBatchNo}</td>` : '<td></td>'}
      </tr>` : ''}
    </table>
    <div style="font-size:12px;font-weight:bold;background:#f5f5f5;padding:6px 10px;margin-bottom:14px;border-left:4px solid #b85c2c">
      ${sectionLabel} &nbsp;›&nbsp; ${materialWithBrand}${activeTab === 'fg' && fgDryer ? ` &nbsp;›&nbsp; Dryer: ${fgDryer}` : ''}
    </div>
    ${contentHtml}
    <div style="display:flex;justify-content:space-between;margin-top:32px;flex-wrap:wrap;gap:16px">
      <div style="border-top:1px solid #000;min-width:140px;padding-top:4px;font-size:10px">Tested By / परीक्षक<br>${testedBy || ''}</div>
      <div style="border-top:1px solid #000;min-width:140px;padding-top:4px;font-size:10px">Approved By / अनुमोदित</div>
    </div>
    <div style="margin-top:16px;border-top:1px solid #ccc;padding-top:8px;display:flex;justify-content:space-between;font-size:10px;color:#666;flex-wrap:wrap;gap:4px">
      <span>Jaishil Sulphur &amp; Chemical Industries, Nashik</span>
      <span>Printed: ${printTs}</span>
    </div>`

  const area = document.getElementById('print-area')
  area.innerHTML = reportHtml
  const clean = s => s.split('/')[0].replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  const origTitle = document.title
  document.title  = `${clean(sectionLabel)}_${clean(materialLabel)}_${safeDate}`
  window.print()
  const cleanup = () => { area.innerHTML = ''; document.title = origTitle }
  window.addEventListener('afterprint', cleanup, { once: true })
  setTimeout(cleanup, 4000)
}

// ─────────────────────────────────────────────────────────────
// Collect results for OverallResult
// ─────────────────────────────────────────────────────────────
function collectResults(material, values) {
  const out = {}
  if (material.type === 'spec')
    material.params.forEach(p => { if (p.rule) out[p.id] = evaluate(values[p.id] ?? '', p.rule) })
  if (material.type === 'formula-only')
    material.tests.forEach(t => { if (t.rule) out[t.id] = evaluate(values[t.id] ?? '', t.rule) })
  return out
}
function collectFGResults(product, values, hiddenTests = []) {
  const out = {}
  product.tests.forEach(test => {
    if (hiddenTests.includes(test.id)) return   // skip hidden tests
    if (test.type === 'spec-single' && test.rule) out[test.id] = evaluate(values[test.id] ?? '', test.rule)
    if (test.type === 'spec-group') test.params.forEach(p => { if (p.rule) out[p.id] = evaluate(values[p.id] ?? '', p.rule) })
    if (test.calcFn && test.rule) out[test.id] = evaluate(values[test.id] ?? '', test.rule)
  })
  return out
}

// ─────────────────────────────────────────────────────────────
// BatchHeader
// ─────────────────────────────────────────────────────────────
function BatchHeader({ date, setDate, dateLabel, testedBy, setTestedBy, extra = [], splitTime = false }) {
  // splitTime=true: time-type fields go on a separate row with a top border (RM tab only)
  const mainFields = splitTime ? extra.filter(f => f.type !== 'time') : extra
  const timeFields = splitTime ? extra.filter(f => f.type === 'time') : []

  const renderField = f => (
    <div key={f.key} className="qc-batch-field">
      <label className="qc-batch-label">
        {f.label}{f.optional && <span style={{fontWeight:'400',color:'#aaa',fontSize:'10px'}}> (optional)</span>}
      </label>
      <input
        type={f.type || 'text'}
        className="qc-batch-input"
        placeholder={f.placeholder || ''}
        value={f.value}
        onChange={e => f.onChange(e.target.value)}
      />
    </div>
  )

  return (
    <div className="qc-batch-header-wrap">
      <div className="qc-batch-bar">
        <div className="qc-batch-field">
          <label className="qc-batch-label">{dateLabel || 'Date / तारीख'}</label>
          <input type="date" className="qc-batch-input" value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <div className="qc-batch-field">
          <label className="qc-batch-label">Tested By / परीक्षक</label>
          <input className="qc-batch-input" placeholder="Name / नाम" value={testedBy} onChange={e => setTestedBy(e.target.value)} />
        </div>
        {mainFields.map(renderField)}
      </div>
      {timeFields.length > 0 && (
        <div className="qc-batch-bar qc-batch-bar-time">
          {timeFields.map(renderField)}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Mill table constants
// ─────────────────────────────────────────────────────────────
const IP_MILLS = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8', 'V9', 'V10']

function emptyMillRows() {
  return IP_MILLS.map(m => ({ mill: m, br: '', flowRate: '', pass: '' }))
}

function computeRowSusp(br, suspInputs) {
  const { sulphurContent, sampleWeight, N } = suspInputs
  if (!br || !sulphurContent || !sampleWeight || !N) return null
  const raw = calcSuspensibility({ sulphurContent, sampleWeight, N, BR: br })
  if (!raw) return null
  return raw.result
}

// ─────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────
export default function QualityCheck({ user }) {
  const uid = useUserId()

  // Auto-fill testedBy with logged-in user's name (falls back to empty for manual entry)
  const userName = user?.name || ''

  // ── Active tab (persisted) ──
  const [activeTab, setActiveTab] = useDraft(`draft:${uid}:qc:activeTab`, 'rm')

  // ── Per-tab draft state ──
  const [rmDraft, setRmDraft, clearRmDraft] = useDraft(`draft:${uid}:qc:rm`, {
    selected: RAW_MATERIALS[0].id,
    values: {}, date: '', testedBy: userName,
    invoiceNo: '', batchNo: '', supplierName: '', time: '',
    brand: '',
  })
  const [ipDraft, setIpDraft, clearIpDraft] = useDraft(`draft:${uid}:qc:ip`, {
    selected: IN_PROCESS[0].id,
    values: {}, date: '', testedBy: userName,
    batchNo: '', time: '',
    brand: '',
    millRows: emptyMillRows(), suspInputs: {}, suspCardMill: IP_MILLS[0],
    // Persisted per-field timestamp bookkeeping (survives reload; cleared on
    // Reset). tsMap: { [fieldKey]: ISO } is the authoritative entry/change time
    // for each field; savedValues: { [fieldKey]: normalizedString } is the last
    // saved value used to decide whether a field actually changed. On each
    // Print/Download these are recomputed by comparing current vs saved values,
    // so unchanged fixed tests keep their original timestamp across submits.
    tsMap: {}, savedValues: {},
  })
  const [fgDraft, setFgDraft, clearFgDraft] = useDraft(`draft:${uid}:qc:fg`, {
    selected: FINISHED_GOODS[0].id,
    values: {}, date: '', testedBy: userName,
    batchNo: '', time: '', endTime: '',
    brand: '',
    uplGrade: null, uplValues: {},
    // OMRI sieve calculation log: timestamped entries per sieve test.
    //   { fg_wetSieve: [{ result, status, time, targetLabel }], fg_drySieve: [...] }
    sieveLog: {},
    // Per-dryer FG value buckets (ND1 / ND2). Fully independent — switching
    // never overwrites/clears/mixes. Legacy flat `values` is migrated into ND1.
    dryer: 'ND1',
    // Per-(dryer, grade) FG values, per-grade UPL values, per-grade sieve logs.
    valuesByDryer: { ND1: {}, ND2: {} },   // shape: { [dryer]: { [grade]: {...} } }
    uplValuesByGrade: {},                   // shape: { [grade]: {...} }
    sieveLogByGrade: {},                    // shape: { [grade]: { fg_wetSieve:[], fg_drySieve:[] } }
  })

  // When user logs in mid-session (e.g. tab restore), backfill empty testedBy fields
  useEffect(() => {
    if (!userName) return
    setRmDraft(p => ({ ...p, testedBy: p.testedBy || userName }))
    setIpDraft(p => ({ ...p, testedBy: p.testedBy || userName }))
    setFgDraft(p => ({ ...p, testedBy: p.testedBy || userName }))
  }, [userName])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── FG per-dryer × per-grade buckets ──
  // FG values, UPL values, and sieve logs are kept independent per
  // (dryer, grade) so switching ND1/ND2 or Normal/Export/OMRI/Colour never
  // overwrites, clears, or mixes another combination's data. Backward
  // compatible with old flat drafts (legacy `values` migrates into ND1/normal;
  // flat uplValues/sieveLog migrate into the 'normal' grade). Handled via
  // derived reads + setter rewrites so DRAFT_VERSION does not need bumping.
  const fgDryer   = fgDraft.dryer || 'ND1'
  const fgGrade   = fgDraft.uplGrade || 'normal'

  // Legacy-safe per-(dryer,grade) values bucket.
  const fgValuesByDryer = fgDraft.valuesByDryer || { ND1: { normal: fgDraft.values || {} }, ND2: {} }
  const fgDryerBucket   = fgValuesByDryer[fgDryer] || {}
  // A dryer bucket may be legacy flat (values object) or grade-keyed.
  const fgValues = (fgDryerBucket && typeof fgDryerBucket === 'object' && !Array.isArray(fgDryerBucket))
    ? (fgDryerBucket[fgGrade] || {})
    : {}

  // Convenience aliases — read from active tab draft
  const rmSelected     = rmDraft.selected
  const ipSelected     = ipDraft.selected
  const fgSelected     = fgDraft.selected
  const values         = activeTab === 'rm' ? rmDraft.values : activeTab === 'ip' ? ipDraft.values : fgValues
  const date           = activeTab === 'rm' ? rmDraft.date : activeTab === 'ip' ? ipDraft.date : fgDraft.date
  const testedBy       = activeTab === 'rm' ? rmDraft.testedBy : activeTab === 'ip' ? ipDraft.testedBy : fgDraft.testedBy
  const rmInvoiceNo    = rmDraft.invoiceNo
  const rmBatchNo      = rmDraft.batchNo
  const rmSupplierName = rmDraft.supplierName
  const rmTime         = rmDraft.time
  const ipBatchNo      = ipDraft.batchNo
  const ipTime         = ipDraft.time
  const fgBatchNo      = fgDraft.batchNo
  const fgTime         = fgDraft.time
  const fgEndTime      = fgDraft.endTime || ''
  const uplGrade       = fgDraft.uplGrade
  // UPL values are per-grade. Legacy flat `uplValues` migrates into 'normal'.
  const uplValuesByGrade = fgDraft.uplValuesByGrade || { normal: fgDraft.uplValues || {} }
  const uplValues        = uplValuesByGrade[fgGrade] || {}
  const ipMillRows     = ipDraft.millRows
  const suspInputs     = ipDraft.suspInputs
  const suspCardMill   = ipDraft.suspCardMill

  // Setters
  const setRmSelected     = v => setRmDraft(p => ({ ...p, selected: v }))
  const setIpSelected     = v => setIpDraft(p => ({ ...p, selected: v }))
  const setFgSelected     = v => setFgDraft(p => ({ ...p, selected: v }))
  const setValues         = fn => {
    if (activeTab === 'rm') setRmDraft(p => ({ ...p, values: typeof fn === 'function' ? fn(p.values) : fn }))
    else if (activeTab === 'ip') setIpDraft(p => ({ ...p, values: typeof fn === 'function' ? fn(p.values) : fn }))
    else setFgDraft(p => {
      // Write into the CURRENT (dryer, grade) bucket only — every other
      // combination is preserved untouched (never overwritten/cleared/mixed).
      const dryer = p.dryer || 'ND1'
      const grade = p.uplGrade || 'normal'
      const vbd   = p.valuesByDryer || { ND1: { normal: p.values || {} }, ND2: {} }
      let   db    = vbd[dryer] || {}
      // Normalize a legacy flat dryer bucket → { normal: {...} }
      if (db && typeof db === 'object' && (db.fg_moisture !== undefined || db.fg_susp !== undefined)) {
        db = { normal: db }
      }
      const cur   = db[grade] || {}
      const next  = typeof fn === 'function' ? fn(cur) : fn
      return { ...p, valuesByDryer: { ...vbd, [dryer]: { ...db, [grade]: next } } }
    })
  }
  const setFgDryer = v => setFgDraft(p => {
    const vbd = p.valuesByDryer || { ND1: { normal: p.values || {} }, ND2: {} }
    return { ...p, dryer: v, valuesByDryer: vbd }
  })
  const setDate = v => {
    if (activeTab === 'rm') setRmDraft(p => ({ ...p, date: v }))
    else if (activeTab === 'ip') setIpDraft(p => ({ ...p, date: v }))
    else setFgDraft(p => ({ ...p, date: v }))
  }
  const setTestedBy = v => {
    if (activeTab === 'rm') setRmDraft(p => ({ ...p, testedBy: v }))
    else if (activeTab === 'ip') setIpDraft(p => ({ ...p, testedBy: v }))
    else setFgDraft(p => ({ ...p, testedBy: v }))
  }
  const setRmInvoiceNo    = v => { markIdentityEntry('invoice_no', v);   setRmDraft(p => ({ ...p, invoiceNo: v })) }
  const setRmBatchNo      = v => { markIdentityEntry('batch_no', v);     setRmDraft(p => ({ ...p, batchNo: v })) }
  const setRmSupplierName = v => { markIdentityEntry('supplier_name', v); setRmDraft(p => ({ ...p, supplierName: v })) }
  const setRmTime         = v => { markIdentityEntry('time', v);         setRmDraft(p => ({ ...p, time: v })) }
  const setIpBatchNo      = v => setIpDraft(p => ({ ...p, batchNo: v }))
  const setIpTime         = v => setIpDraft(p => ({ ...p, time: v }))
  // Changing the FG Batch No. means we are now working on a DIFFERENT batch, so
  // the previously-visible values must NOT linger (which also caused a false
  // "conflict" when the new batch's shared draft loaded). When the batch number
  // actually changes to a different value, wipe this batch's measurement values
  // + reading logs so the form is blank; the DB-restore effect then repopulates
  // if that (date, dryer, grade, batch) already has saved data, or clears the
  // date/time for a fresh entry when it does not (see the restore effect).
  const setFgBatchNo = v => {
    const prev = (fgDraft.batchNo || '')
    const next = (v || '')
    if (prev === next) { setFgDraft(p => ({ ...p, batchNo: v })); return }

    // Batch changed → we are on a DIFFERENT batch now. Clear the shared-draft
    // conflict banner + rebind so the new batch's draft loads cleanly (no false
    // conflict against lingering old values), and reset this tab's entry-time
    // capture so the new record stamps from scratch.
    setFgConflicts({})
    setFgFinalizedByOther('')
    fgSharedKeyRef.current = ''
    fgSharedRevRef.current = null
    fgSharedReadyRef.current = false
    fgSharedPushedSig.current = ''
    fgLoadedKeyRef.current = ''
    fgBatchJustChangedRef.current = true   // user changed batch → allow date/time blank if no saved data
    fieldEntryTimesRef.current.fg = {}
    identityEntryTimesRef.current.fg = {}

    setFgDraft(p => ({
      ...p,
      batchNo: v,
      // Clear all per-(dryer,grade) measurement buckets, UPL values, and the
      // sieve/moisture reading logs so no previous-batch data stays visible.
      valuesByDryer: { ND1: {}, ND2: {} },
      values: {},
      uplValues: {},
      uplValuesByGrade: {},
      sieveLog: {},
      sieveLogByGrade: {},
      moistureLogByGrade: {},
      fgFormulaInputsByGrade: {},   // clear Suspensibility (and any FG formula) inputs for the new batch
      // Time is per-batch → blank it for the new batch. (Date is kept for a
      // moment so the restore lookup can check whether this batch already has
      // saved data; if it does NOT, the restore effect blanks the date too so
      // the user re-enters it. If it DOES, the saved time is restored.)
      time: '',
      endTime: '',
      // Per-field entry-time bookkeeping for a clean record.
      __ts: {},
    }))
  }
  const setFgTime         = v => setFgDraft(p => ({ ...p, time: v }))
  const setFgEndTime      = v => setFgDraft(p => ({ ...p, endTime: v }))
  const setUplGrade       = v => setFgDraft(p => ({ ...p, uplGrade: v }))
  const setUplValues      = fn => setFgDraft(p => {
    const grade = p.uplGrade || 'normal'
    const uvg   = p.uplValuesByGrade || { normal: p.uplValues || {} }
    const cur   = uvg[grade] || {}
    const next  = typeof fn === 'function' ? fn(cur) : fn
    return { ...p, uplValuesByGrade: { ...uvg, [grade]: next } }
  })
  // FG formula-card inputs (e.g. Suspensibility fg_susp), persisted per-grade so
  // they SURVIVE a page refresh / relogin and are part of the shared draft —
  // previously they lived only in the FormulaCalculator's local state and were
  // lost on reload. Shape: { [grade]: { [formulaId]: { [varKey]: val } } }.
  const fgFormulaInputsByGrade = fgDraft.fgFormulaInputsByGrade || {}
  const getFgFormulaInputs = fid =>
    (fgFormulaInputsByGrade[fgGrade] && fgFormulaInputsByGrade[fgGrade][fid]) || {}
  const setFgFormulaInputs = (fid, next) => setFgDraft(p => {
    const grade = p.uplGrade || 'normal'
    const fbg   = p.fgFormulaInputsByGrade || {}
    const curG  = fbg[grade] || {}
    return { ...p, fgFormulaInputsByGrade: { ...fbg, [grade]: { ...curG, [fid]: next } } }
  })

  // Sieve logs are per-grade. Legacy flat `sieveLog` migrates into 'normal'.
  const sieveLogByGrade   = fgDraft.sieveLogByGrade || { normal: fgDraft.sieveLog || {} }
  const sieveLog          = sieveLogByGrade[fgGrade] || {}
  const addSieveEntry     = (testId, entry) => setFgDraft(p => {
    const grade = p.uplGrade || 'normal'
    const slg   = p.sieveLogByGrade || { normal: p.sieveLog || {} }
    const cur   = slg[grade] || {}
    return { ...p, sieveLogByGrade: { ...slg, [grade]: { ...cur, [testId]: [ ...(cur[testId] || []), entry ] } } }
  })

  // ── Moisture readings log (per-grade) ──────────────────────────────────────
  // Moisture Content is measured several times per batch (exactly like Wet/Dry
  // Sieve). Each reading is a timestamped entry stored under the test id
  // 'fg_moisture' in a per-grade bucket, so Normal / UPL Export / UPL OMRI /
  // Colour each keep their own independent list. The recording trigger mirrors
  // the sieve "Record" button and the live Google-Sheet sync is identical in
  // shape (qc_fg_moisture_readings). No legacy flat value to migrate — the old
  // single fg_moisture input becomes the FIRST reading when present.
  const moistureLogByGrade = fgDraft.moistureLogByGrade || {}
  const moistureLog        = (moistureLogByGrade[fgGrade] && moistureLogByGrade[fgGrade].fg_moisture) || []
  const addMoistureEntry   = (entry) => setFgDraft(p => {
    const grade = p.uplGrade || 'normal'
    const mlg   = p.moistureLogByGrade || {}
    const cur   = mlg[grade] || {}
    return { ...p, moistureLogByGrade: { ...mlg, [grade]: { ...cur, fg_moisture: [ ...(cur.fg_moisture || []), entry ] } } }
  })
  const removeMoistureEntry = (idx) => {
    const nextLog = (moistureLog || []).filter((_, i) => i !== idx)
    setFgDraft(p => {
      const grade = p.uplGrade || 'normal'
      const mlg   = p.moistureLogByGrade || {}
      const cur   = mlg[grade] || {}
      return { ...p, moistureLogByGrade: { ...mlg, [grade]: { ...cur, fg_moisture: (cur.fg_moisture || []).filter((_, i) => i !== idx) } } }
    })
    pushFgMoistureReadings(nextLog)
  }
  const removeSieveEntry  = (testId, idx) => {
    // Compute the post-delete list from the CURRENT active-grade log so we can
    // sync the full updated list to the Google Sheet (handles deletions). The
    // state update below uses its own functional updater for correctness.
    const nextLog = ((sieveLog[testId]) || []).filter((_, i) => i !== idx)
    setFgDraft(p => {
      const grade = p.uplGrade || 'normal'
      const slg   = p.sieveLogByGrade || { normal: p.sieveLog || {} }
      const cur   = slg[grade] || {}
      return { ...p, sieveLogByGrade: { ...slg, [grade]: { ...cur, [testId]: (cur[testId] || []).filter((_, i) => i !== idx) } } }
    })
    // Live push the updated (post-delete) list so the sheet cell drops the
    // removed reading. Guard: only the two sieve tests sync live.
    if (testId === 'fg_wetSieve' || testId === 'fg_drySieve') {
      pushFgSieveReadings(testId, nextLog)
    }
  }
  const setUplMenuOpen    = v => setUplMenuOpenLocal(v)  // menu state is NOT persisted (intentional)

  const setIpMillRows     = fn => setIpDraft(p => ({ ...p, millRows: typeof fn === 'function' ? fn(p.millRows) : fn }))
  const setSuspInputs     = fn => setIpDraft(p => ({ ...p, suspInputs: typeof fn === 'function' ? fn(p.suspInputs) : fn }))
  const setSuspCardMill   = v => setIpDraft(p => ({ ...p, suspCardMill: v }))

  // In-Process formula-card inputs, persisted per formula id so switching the
  // "Additional Test" dropdown (which remounts the cards) never loses typed
  // data — switching back restores it. Shape: { [formulaId]: { [varKey]: val } }
  const ipFormulaInputs      = ipDraft.formulaInputs || {}
  const getIpFormulaInputs   = fid => ipFormulaInputs[fid] || {}
  const setIpFormulaInputs   = (fid, next) =>
    setIpDraft(p => ({
      ...p,
      formulaInputs: { ...(p.formulaInputs || {}), [fid]: next },
    }))

  // Brand/type state — stored in draft, not useBrandType hook
  const rmBrand    = rmDraft.brand || ''
  const ipBrand    = ipDraft.brand || ''
  const fgBrand    = fgDraft.brand || ''
  const setRmBrand = v => setRmDraft(p => ({ ...p, brand: v }))
  const setIpBrand = v => setIpDraft(p => ({ ...p, brand: v }))
  const setFgBrand = v => setFgDraft(p => ({ ...p, brand: v }))

  // ── resetKey for FormulaCalculator remounting ──
  const [resetKey, setResetKey] = useState(0)

  // ── Latest computed Wet/Dry Sieve formula results + chosen UPL micron
  //    target (OMRI only). Lets the operator push a sieve formula result
  //    into the matching UPL row so its Pass/Fail status auto-computes. ──
  const [sieveResult, setSieveResult] = useState({})   // { fg_wetSieve, fg_drySieve }
  const [sieveTarget, setSieveTarget] = useState({ fg_wetSieve: 'upl_omri_ws_160', fg_drySieve: 'upl_omri_ds_500' })

  // Latest computed Suspensibility result (fg_susp is a formula card, so its
  // result lives in the card's local state — capture it for the live feed).
  const [suspResult, setSuspResult] = useState(null)

  // Latest computed Sulphur Content result (fg_sulphur formula card). Captured
  // so the ADMA parameter table can mirror it into its read-only Observation
  // column. Other grades do not use this value.
  const [fgSulphurResult, setFgSulphurResult] = useState(null)

  // Latest computed Bulk Density result (fg_bulk formula card). Captured so the
  // Sanaca Dubai table can mirror it into its read-only Observation column.
  const [fgBulkResult, setFgBulkResult] = useState(null)

  // ── Live push to Production → Activity (qc_activity_draft) ──────────
  // Upserts the current Finished Goods snapshot keyed on
  // (Dryer, Date, Grade, Batch No.) — migration 039. One live row per that
  // combination, so every later Moisture / Wet / Dry Sieve reading for the same
  // (batch, date, dryer, grade) updates the SAME live entry. Batch numbers are
  // not always unique, so date + dryer + grade qualify the batch.
  // Called on each sieve/moisture "Record" and (debounced) when batch / start
  // time / moisture / susp / dryer / date / grade change. Requires a date to
  // key on; guards supabaseReady. Never blocks the UI — errors are swallowed
  // (this is an optional feed; the authoritative save is still Print/Download →
  // quality_control_records).
  const toNum = v => {
    const n = parseFloat(v)
    return Number.isFinite(n) ? n : null
  }
  const pushQcActivity = useCallback((override = {}) => {
    // TEMPORARILY DISABLED: skip the live Production → Activity feed while the
    // Google Sheet mapping is being verified. Flip FG_ACTIVITY_LIVE_PUSH_ENABLED
    // back to true to resume. The Print/Download → quality_control_records save
    // path (and the Google Sheets sync) is unaffected by this guard.
    if (!FG_ACTIVITY_LIVE_PUSH_ENABLED) return
    if (!supabaseReady || !supabase) return
    const d = fgDraft || {}
    const dryer = d.dryer || 'ND1'
    const logDate = d.date
    if (!logDate) return   // need a date to key the live row
    const grade = d.uplGrade || 'normal'
    // Read the CURRENT (dryer, grade) buckets (shape matches the derived reads).
    const vbd = d.valuesByDryer || { ND1: { normal: d.values || {} }, ND2: {} }
    let db = vbd[dryer] || {}
    if (db && typeof db === 'object' && (db.fg_moisture !== undefined || db.fg_susp !== undefined)) {
      db = { normal: db }   // normalize legacy flat bucket
    }
    const curVals = db[grade] || {}
    const slg = d.sieveLogByGrade || { normal: d.sieveLog || {} }
    const log = slg[grade] || {}
    const product = (FINISHED_GOODS.find(p => p.id === d.selected) || {}).label || null

    // Moisture readings log for this grade (the record now requires at least one
    // RECORDED reading, not just a typed value). Legacy single fg_moisture value
    // still counts so older drafts aren't blocked.
    const mlg = d.moistureLogByGrade || {}
    // override.moistureLog lets the Record handler pass the just-updated list
    // (draft state updates are async), exactly like override.wetLog/dryLog.
    const moistureReadings = override.moistureLog ?? ((mlg[grade] && mlg[grade].fg_moisture) || [])

    // ── Readiness gate (FG only) ───────────────────────────────────────────
    // The row goes live in Production → Activity ONLY once ALL of the required
    // fields below are active. Until then nothing is pushed, so no partial /
    // incomplete row ever appears. Required (per request):
    //   • Batch No.                       • Batch Start Time
    //   • Dryer (ND1/ND2)                 • Moisture readings (≥1 recorded)
    //   • Wet/Dry Sieve readings AS PER GRADE:
    //       – OMRI   → BOTH Wet Sieve AND Dry Sieve have ≥1 reading
    //       – Export → Wet Sieve has ≥1 reading (Dry Sieve is not an Export parameter)
    //       – Normal / Colour → no sieve requirement (they have no UPL sieve targets)
    // Manufactured Date is enforced separately above (it is the row key and the
    // feed cannot be keyed without it). Tested By / Product / Grade are NOT part
    // of the gate.
    //
    // This gate now applies to ALL grades: Export/OMRI via the debounced feed as
    // the user works, and Normal/Colour on the Save button. (override.skipReadyGate
    // remains as an explicit escape hatch but is no longer used by Save.)
    const notEmpty = v => v !== null && v !== undefined && String(v).trim() !== ''
    const hasList  = arr => Array.isArray(arr) && arr.length > 0

    // Sieve readiness depends on the grade (which sieve tests that grade uses).
    const wetReadings = override.wetLog ?? (log.fg_wetSieve || [])
    const dryReadings = override.dryLog ?? (log.fg_drySieve || [])
    let sieveReady = true
    if (grade === 'omri')        sieveReady = hasList(wetReadings) && hasList(dryReadings)
    else if (grade === 'export') sieveReady = hasList(wetReadings)
    // Normal / Colour → no sieve targets → no sieve requirement (sieveReady stays true).

    const FG_ACTIVITY_REQUIRED_READY =
      notEmpty(logDate) &&
      notEmpty(d.batchNo) &&
      notEmpty(d.time) &&                 // Batch Start Time
      notEmpty(dryer) &&
      (hasList(moistureReadings) || notEmpty(curVals.fg_moisture)) &&
      sieveReady
    if (!override.skipReadyGate && !FG_ACTIVITY_REQUIRED_READY) return   // incomplete → do not go live yet

    // Normalize the batch number (trim) so the Activity upsert key
    // (dryer, log_date, grade, batch_no) is IDENTICAL every time the SAME batch
    // is entered. Without trimming, "683/94" vs "683/94 " would be two distinct
    // keys → two live cards (a duplicate). With a stable key, re-entering an
    // already-live batch UPSERTS onto its existing card instead of creating a
    // new one.
    const batchKey = (d.batchNo || '').trim() || null
    const row = {
      dryer,
      log_date: logDate,
      grade,
      product,
      batch_no: batchKey,
      // Prefer the LATEST recorded moisture reading; fall back to the legacy
      // single value for older drafts.
      moisture_pct: toNum(
        moistureReadings.length
          ? moistureReadings[moistureReadings.length - 1].result
          : curVals.fg_moisture
      ),
      // Full ordered list of recorded moisture readings so Production → Activity
      // can show EVERY reading as a table (like Wet/Dry Sieve), not just the
      // latest value. Each entry: { result, time, isoTime }.
      moisture_log: moistureReadings,
      suspensibility_pct: override.susp !== undefined ? toNum(override.susp) : toNum(suspResult),
      wet_sieve_log: override.wetLog ?? (log.fg_wetSieve || []),
      dry_sieve_log: override.dryLog ?? (log.fg_drySieve || []),
      tested_by: d.testedBy || userName || null,
      updated_at: new Date().toISOString(),
      last_saved_at: new Date().toISOString(),
    }

    supabase
      .from('qc_activity_draft')
      // ONE live row per (Dryer, Date, Grade, Batch No.) — migration 039. Every
      // later Moisture / Wet Sieve / Dry Sieve reading for that SAME combination
      // updates the one existing live entry. Because batch numbers are NOT always
      // unique, the date + dryer + grade qualify the batch so the same batch no.
      // on a different day, dryer, or grade correctly becomes its own live card.
      .upsert(row, { onConflict: 'dryer,log_date,grade,batch_no' })
      .then(({ error }) => {
        // Optional feed — does not block the UI. Log so a failing push
        // (missing table / RLS / Realtime) is diagnosable in the console.
        if (error) console.warn('[QC Activity] live push failed:', error.message, error)
      })
  }, [fgDraft, suspResult, userName])

  // ── Live Wet/Dry Sieve readings → Google Sheet (qc_fg_sieve_readings) ──────
  // SEPARATE from Production → Activity (that is qc_activity_draft and stays
  // bypassed). This path upserts ONE row per (date, batch, product, grade,
  // dryer, test) holding the CURRENT full ordered reading list, so each
  // recorded Wet/Dry Sieve reading reaches the Finished Goods tab AUTOMATICALLY
  // on the "Record"/delete click — no Print/Download needed. The trigger
  // (migration 028) enqueues an idempotent outbox event keyed by this business
  // identity, and Code.gs rebuilds the stacked sieve cell by business key.
  //
  // We write the WHOLE current list every time (not a delta), so additions AND
  // deletions are reflected, and the server-side rebuild is deterministic (no
  // duplicates on retries). Each reading keeps its own website-recorded iso_time.
  // Never blocks the UI; errors are logged, not thrown. The authoritative
  // Print/Download → quality_control_records save is unaffected.
  const pushFgSieveReadings = useCallback((testId, readingsArr) => {
    // Live sheet sync disabled: readings go to the Google Sheet only on final
    // Save (via quality_control_records), carrying each reading's entry time.
    if (!FG_READINGS_LIVE_SHEET_SYNC_ENABLED) return
    if (!supabaseReady || !supabase) return
    const d = fgDraft || {}
    const logDate = d.date
    if (!logDate) return                 // need a date to key the live row
    if (testId !== 'fg_wetSieve' && testId !== 'fg_drySieve') return
    const grade   = d.uplGrade || 'normal'
    const dryer   = d.dryer || 'ND1'
    const product = d.selected || null   // product id (e.g. 'sulphur80wdg')

    // Normalize the readings into the stored shape: ordered, with a 1-based
    // reading_no, micron (targetLabel), result, status, and the genuine
    // website-recorded iso_time (never an upload time).
    const arr = Array.isArray(readingsArr) ? readingsArr : []
    const readings = arr.map((e, i) => ({
      reading_no: i + 1,
      result:     e && e.result !== undefined && e.result !== null ? String(e.result) : '',
      micron:     e && e.targetLabel ? String(e.targetLabel) : '',
      status:     e && e.status ? String(e.status) : '',
      iso_time:   e && e.isoTime ? e.isoTime : null,
      // Designated UPL Extra Parameters result field this reading feeds
      // (e.g. 'upl_exp_ws_160' / 'upl_omri_ds_500'). Lets the sheet update that
      // exact UPL parameter's current-result cell + timestamp, not just the log.
      upl_id:     e && e.uplId ? String(e.uplId) : null,
    }))

    const row = {
      log_date:  logDate,
      batch_no:  d.batchNo || null,
      product,
      grade,
      dryer,
      test:      testId,
      readings,
      tested_by: d.testedBy || userName || null,
      updated_at: new Date().toISOString(),
    }

    supabase
      .from('qc_fg_sieve_readings')
      .upsert(row, { onConflict: 'log_date,batch_no,product,grade,dryer,test' })
      .then(({ error }) => {
        if (error) console.warn('[FG Sieve Sync] live push failed:', error.message, error)
      })
  }, [fgDraft, userName])

  // ── Live Moisture readings → Google Sheet (qc_fg_moisture_readings) ────────
  // Identical in shape and behavior to pushFgSieveReadings above, for the
  // repeated Moisture Content readings. Upserts ONE row per
  // (date, batch, product, grade, dryer) holding the CURRENT full ordered
  // reading list, so each recorded Moisture reading (and each deletion) reaches
  // the Finished Goods sheet AUTOMATICALLY on the "Record"/× click — no
  // Print/Download needed. We write the WHOLE current list every time so the
  // server-side rebuild is deterministic (no duplicates on retries). Each
  // reading keeps its own website-recorded iso_time (IST-locked). Never blocks
  // the UI; errors are logged, not thrown. The authoritative Print/Download →
  // quality_control_records save is unaffected.
  const pushFgMoistureReadings = useCallback((readingsArr) => {
    // Live sheet sync disabled: readings go to the Google Sheet only on final
    // Save (via quality_control_records), carrying each reading's entry time.
    if (!FG_READINGS_LIVE_SHEET_SYNC_ENABLED) return
    if (!supabaseReady || !supabase) return
    const d = fgDraft || {}
    const logDate = d.date
    if (!logDate) return                 // need a date to key the live row
    const grade   = d.uplGrade || 'normal'
    const dryer   = d.dryer || 'ND1'
    const product = d.selected || null   // product id (e.g. 'sulphur80wdg')

    const arr = Array.isArray(readingsArr) ? readingsArr : []
    const readings = arr.map((e, i) => ({
      reading_no: i + 1,
      result:     e && e.result !== undefined && e.result !== null ? String(e.result) : '',
      iso_time:   e && e.isoTime ? e.isoTime : null,
    }))

    const row = {
      log_date:  logDate,
      batch_no:  d.batchNo || null,
      product,
      grade,
      dryer,
      readings,
      tested_by: d.testedBy || userName || null,
      updated_at: new Date().toISOString(),
    }

    supabase
      .from('qc_fg_moisture_readings')
      .upsert(row, { onConflict: 'log_date,batch_no,product,grade,dryer' })
      .then(({ error }) => {
        if (error) console.warn('[FG Moisture Sync] live push failed:', error.message, error)
      })
  }, [fgDraft, userName])

  // ═══════════════════════════════════════════════════════════════════════════
  // FG SHARED DRAFT — cross-chemist, server-backed (table: fg_shared_draft)
  // ---------------------------------------------------------------------------
  // Lets up to three chemists collaborate on the SAME Finished Goods batch form
  // across logins/devices. Debounced autosave of the WHOLE fgDraft payload +
  // a 15s poll that MERGES remote→local without clobbering newer local edits,
  // with revision-based optimistic concurrency and a visible conflict banner.
  //
  // Strictly ADDITIVE and FG-only:
  //   • Never writes quality_control_records, qc_activity_draft, or the
  //     sieve/moisture tables — those existing paths are untouched.
  //   • fg_shared_draft has NO Google-Sheets outbox trigger, so autosaves never
  //     produce sheet rows/events.
  // ═══════════════════════════════════════════════════════════════════════════

  // Build the stable business identity for the CURRENT FG form. Returns null
  // when the identity is not complete enough to share (we require date, product,
  // dryer, grade — mirroring the "need a date" gate the sieve/moisture pushes
  // already use — so unrelated incomplete forms never merge under one key).
  // batch_no may be empty; the server index coalesces it to '' as its own slot.

  // ── FG Print/Download save state (FG tab only) ──
  // Declared here (before the shared-draft effects/callbacks) because those
  // close over setQcError / showSavedToast; declaring them later caused a
  // temporal-dead-zone crash that broke the whole QC page on load.
  const [qcSaving, setQcSaving] = useState(false)
  const [qcError, setQcError]   = useState('')
  const [qcSaved, setQcSaved]   = useState(false)   // "Data saved successfully" toast
  const lastSavedSig            = useRef('')
  const savedToastTimer         = useRef(null)

  // Show the "Data saved successfully" toast for ~3s. Clears any pending hide.
  const showSavedToast = useCallback(() => {
    setQcSaved(true)
    if (savedToastTimer.current) clearTimeout(savedToastTimer.current)
    savedToastTimer.current = setTimeout(() => setQcSaved(false), 3000)
  }, [])

  // Clean up the toast timer on unmount
  useEffect(() => () => { if (savedToastTimer.current) clearTimeout(savedToastTimer.current) }, [])

  // ── FG SHARED DRAFT (cross-chemist) state (FG tab only) ──
  // These MUST be declared BEFORE the shared-draft effects/callbacks below,
  // which close over them — declaring them later causes a temporal-dead-zone
  // crash ("Cannot access '…' before initialization") that breaks the whole QC
  // page on load.
  // sharedStatus: '' | 'saving' | 'saved' | 'error'  — shown next to Save.
  const [sharedStatus, setSharedStatus] = useState('')
  // conflicts: { [fieldPath]: { local, remote } } awaiting the chemist's choice.
  const [fgConflicts, setFgConflicts]   = useState({})
  // The server revision this browser last saw for the CURRENT identity. Used for
  // the version-checked update (optimistic concurrency). null = not loaded yet.
  const fgSharedRevRef   = useRef(null)
  // The identity key this browser is currently bound to (so a mid-flight save
  // from an old identity is ignored after the chemist switches batch).
  const fgSharedKeyRef   = useRef('')
  // created_by for the current identity (never overwritten on resume).
  const fgSharedCreatedByRef = useRef('')
  // Debounce timer + "skip first autosave after (re)bind" guard.
  const fgSharedSaveTimer = useRef(null)
  const fgSharedReadyRef  = useRef(false)
  // Last payload signature this browser successfully pushed, so the 15s poll's
  // merge-back of our own write does not echo into another autosave loop.
  const fgSharedPushedSig = useRef('')
  // Identity key for which an active shared draft was found on the server. The
  // saved-records restore effect reads this so it does NOT blank the Batch Start
  // Time for an in-progress batch that another chemist is sharing (that batch
  // has a time from the shared draft but is not yet in quality_control_records).
  const fgSharedDraftExistsRef = useRef('')
  // F-1: when the authoritative insert SUCCEEDED but finalizing the shared draft
  // FAILED, we hold the identity to retry finalize — WITHOUT re-inserting.
  const [fgFinalizePending, setFgFinalizePending] = useState(null)
  // F-2: set when a poll / conflict-recovery discovers THIS batch's shared draft
  // is already finalized by another chemist. Autosave + final submit are then
  // disabled for this identity; local values are preserved.
  const [fgFinalizedByOther, setFgFinalizedByOther] = useState('')

  const fgSharedIdentity = useCallback(() => {
    const d = fgDraft || {}
    const log_date = d.date
    const product  = d.selected
    const dryer    = d.dryer || 'ND1'
    const grade    = d.uplGrade || 'normal'
    if (!log_date || !product || !dryer || !grade) return null
    return { log_date, batch_no: d.batchNo || null, product, grade, dryer }
  }, [fgDraft])

  const fgSharedIdentityKey = useCallback(() => {
    const idn = fgSharedIdentity()
    if (!idn) return ''
    return [idn.log_date, idn.batch_no || '', idn.product, idn.grade, idn.dryer].join('|')
  }, [fgSharedIdentity])

  // The sharable payload = the full fgDraft MINUS transient UI-only bits. We
  // store source inputs + reading logs; the UI recomputes derived values.
  const fgSharedPayload = useCallback(() => {
    const { ...rest } = fgDraft || {}
    return rest
  }, [fgDraft])

  // Deep-merge a remote payload INTO local without destroying newer local work.
  // Rules:
  //   • Scalars: if equal → keep. If one side empty → take the non-empty one.
  //     If both non-empty AND different → CONFLICT (record both; keep local for
  //     now; surface in the banner for the chemist to resolve). This lets a
  //     chemist intentionally correct a value (they resolve the conflict).
  //   • Plain objects (the per-(dryer,grade) buckets, __ts): merge key by key.
  //   • Reading-log arrays (sieve/moisture): merge by stable reading identity
  //     (iso_time, else result+index) — never blind concat, no dup, newer kept.
  // Returns { merged, conflicts } where conflicts is { path: {local, remote} }.
  const mergeFgPayload = useCallback((local, remote) => {
    const conflicts = {}
    const isEmpty = v => v === undefined || v === null || v === ''
    const isPlainObj = v => v && typeof v === 'object' && !Array.isArray(v)

    // Merge a reading-log array by stable identity. Preserves order, drops
    // exact dups, and never lets an older entry overwrite a newer one.
    const mergeReadings = (a, b) => {
      const out = []
      const seen = new Map()  // key → index in out
      const keyOf = (e, i) => {
        if (e && e.isoTime) return 'iso:' + e.isoTime
        if (e && e.iso_time) return 'iso:' + e.iso_time
        return 'rk:' + String(e && e.result) + ':' + i
      }
      ;[...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])].forEach((e, i) => {
        const k = keyOf(e, i)
        if (seen.has(k)) return   // identical reading already present → skip dup
        seen.set(k, out.length)
        out.push(e)
      })
      return out
    }

    const isReadingArray = (path) =>
      /(^|\.)fg_wetSieve($|\.)/.test(path) ||
      /(^|\.)fg_drySieve($|\.)/.test(path) ||
      /(^|\.)fg_moisture($|\.)/.test(path)

    const walk = (lv, rv, path) => {
      if (rv === undefined) return lv
      if (lv === undefined) return rv
      if (Array.isArray(lv) || Array.isArray(rv)) {
        if (isReadingArray(path)) return mergeReadings(lv, rv)
        // Non-reading arrays: prefer the non-empty, else local.
        if (Array.isArray(lv) && lv.length) return lv
        if (Array.isArray(rv) && rv.length) return rv
        return lv
      }
      if (isPlainObj(lv) || isPlainObj(rv)) {
        const lo = isPlainObj(lv) ? lv : {}
        const ro = isPlainObj(rv) ? rv : {}
        const out = { ...lo }
        new Set([...Object.keys(lo), ...Object.keys(ro)]).forEach(k => {
          out[k] = walk(lo[k], ro[k], path ? `${path}.${k}` : k)
        })
        return out
      }
      // Scalars
      if (lv === rv) return lv
      if (isEmpty(lv)) return rv
      if (isEmpty(rv)) return lv
      // Both non-empty and different → conflict. Keep local; record both.
      conflicts[path] = { local: lv, remote: rv }
      return lv
    }

    const merged = walk(local || {}, remote || {}, '')
    return { merged, conflicts }
  }, [])

  // Load the shared draft for the current identity + poll every 15s to pick up
  // the other chemists' saved work. Additive merge; never clobbers newer local.
  useEffect(() => {
    if (activeTab !== 'fg') return
    if (!supabaseReady || !supabase) return
    const key = fgSharedIdentityKey()
    if (!key) return

    // Rebind to this identity: reset per-identity refs and skip the first
    // autosave (so a fresh load does not immediately echo back). Also clear the
    // F-2 "finalized by other" lock (it is per-identity; a NEW batch starts
    // unlocked and loads normally).
    if (fgSharedKeyRef.current !== key) {
      fgSharedKeyRef.current = key
      fgSharedRevRef.current = null
      fgSharedCreatedByRef.current = ''
      fgSharedReadyRef.current = false
      fgSharedPushedSig.current = ''
      fgSharedDraftExistsRef.current = ''
      setFgConflicts({})
      setFgFinalizedByOther('')
    }

    const idn = fgSharedIdentity()
    let cancelled = false

    const pull = async () => {
      try {
        let q = supabase
          .from('fg_shared_draft')
          .select('payload, revision, created_by, finalized')
          .eq('log_date', idn.log_date)
          .eq('product', idn.product)
          .eq('grade', idn.grade)
          .eq('dryer', idn.dryer)
        q = idn.batch_no === null ? q.is('batch_no', null) : q.eq('batch_no', idn.batch_no)
        const { data, error } = await q.maybeSingle()
        if (cancelled || error || !data) return
        // F-2: a finalized batch must not reopen as an editable active draft.
        // Lock this identity: stop autosaving/retrying, show the "already
        // submitted" banner, and PRESERVE the chemist's local values (we do not
        // merge the remote payload or clear anything — they can switch batches).
        if (data.finalized) {
          fgSharedRevRef.current = data.revision
          setFgFinalizedByOther(key)
          return
        }

        fgSharedRevRef.current = data.revision
        if (!fgSharedCreatedByRef.current) fgSharedCreatedByRef.current = data.created_by || ''
        // Mark that an active shared draft EXISTS for this identity, so the
        // saved-records restore effect does NOT blank the Batch Start Time it
        // just merged in (the in-progress batch legitimately has a time from the
        // other chemist, even though it is not yet in quality_control_records).
        fgSharedDraftExistsRef.current = key

        // Merge remote → current local draft (functional update so we always
        // merge against the freshest local state).
        setFgDraft(prevLocal => {
          const { merged, conflicts } = mergeFgPayload(prevLocal, data.payload || {})
          if (Object.keys(conflicts).length) {
            setFgConflicts(c => ({ ...c, ...conflicts }))
          }
          return merged
        })
      } catch {
        // transient network error on a poll — ignore; next tick retries
      }
    }

    pull()
    const intervalId = setInterval(pull, 15000)
    const onVisible = () => { if (document.visibilityState === 'visible') pull() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearInterval(intervalId)
      document.removeEventListener('visibilitychange', onVisible)
    }
    // Depend on the identity STRING (not the callback, which is a new function
    // every keystroke) so the poll/interval is set up once per identity and not
    // torn down and recreated on every edit.
  }, [activeTab, fgSharedIdentityKey()])  // eslint-disable-line react-hooks/exhaustive-deps

  // Core writer: version-checked upsert of the current payload. Returns
  // 'saved' | 'conflict' | 'error' | 'skipped'. Exposed for the debounce AND
  // for an explicit flush before final submit.
  const saveFgSharedDraft = useCallback(async () => {
    if (!supabaseReady || !supabase) return 'skipped'
    const idn = fgSharedIdentity()
    if (!idn) return 'skipped'
    const key = [idn.log_date, idn.batch_no || '', idn.product, idn.grade, idn.dryer].join('|')

    const payload = fgSharedPayload()
    const sig = JSON.stringify(payload)
    if (sig === fgSharedPushedSig.current) return 'skipped'  // nothing new to push

    const who = userName || ''
    const nowIso = new Date().toISOString()
    const baseRev = fgSharedRevRef.current

    try {
      if (baseRev === null || baseRev === undefined) {
        // No known server row yet → INSERT (revision starts at 0). If another
        // chemist already created it, the unique index rejects us → fall through
        // to a re-pull on the next poll (and we retry as an update).
        const { data, error } = await supabase
          .from('fg_shared_draft')
          .insert({
            log_date: idn.log_date, batch_no: idn.batch_no, product: idn.product,
            grade: idn.grade, dryer: idn.dryer,
            payload, revision: 0, finalized: false,
            created_by: who, updated_by: who,
            updated_at: nowIso, last_saved_at: nowIso,
          })
          .select('revision')
          .single()
        if (error) {
          // Likely a concurrent insert (unique violation). Let the poll pull the
          // row; the next debounce will update it. Not a hard error for the user.
          return 'skipped'
        }
        if (fgSharedKeyRef.current === key) {
          fgSharedRevRef.current = data.revision
          fgSharedPushedSig.current = sig
        }
        return 'saved'
      }

      // Version-checked UPDATE: only applies if the stored revision still equals
      // the one we based this edit on. Otherwise someone else wrote first.
      let uq = supabase
        .from('fg_shared_draft')
        .update({
          payload, revision: baseRev + 1, updated_by: who,
          updated_at: nowIso, last_saved_at: nowIso,
        })
        .eq('log_date', idn.log_date)
        .eq('product', idn.product)
        .eq('grade', idn.grade)
        .eq('dryer', idn.dryer)
        .eq('revision', baseRev)
        .is('finalized', false)
      uq = idn.batch_no === null ? uq.is('batch_no', null) : uq.eq('batch_no', idn.batch_no)
      const { data, error } = await uq.select('revision').maybeSingle()

      if (error) return 'error'
      if (!data) {
        // Stale revision (or finalized). Re-pull and merge; conflicts surface.
        let q = supabase
          .from('fg_shared_draft')
          .select('payload, revision, finalized')
          .eq('log_date', idn.log_date).eq('product', idn.product)
          .eq('grade', idn.grade).eq('dryer', idn.dryer)
        q = idn.batch_no === null ? q.is('batch_no', null) : q.eq('batch_no', idn.batch_no)
        const { data: fresh } = await q.maybeSingle()
        if (fresh && fgSharedKeyRef.current === key) {
          fgSharedRevRef.current = fresh.revision
          if (fresh.finalized) {
            // F-2: another chemist finalized this batch. Lock it (stop autosave
            // + submit) and preserve local values; do NOT merge/overwrite.
            setFgFinalizedByOther(key)
            return 'finalized'
          }
          setFgDraft(prevLocal => {
            const { merged, conflicts } = mergeFgPayload(prevLocal, fresh.payload || {})
            if (Object.keys(conflicts).length) setFgConflicts(c => ({ ...c, ...conflicts }))
            return merged
          })
        }
        return 'conflict'
      }

      if (fgSharedKeyRef.current === key) {
        fgSharedRevRef.current = data.revision
        fgSharedPushedSig.current = sig
      }
      return 'saved'
    } catch {
      return 'error'
    }
  }, [fgSharedIdentity, fgSharedPayload, mergeFgPayload, userName, setFgDraft])

  // Debounced autosave: fire ~900ms after the FG draft changes, but never until
  // the identity is complete and the first post-bind change has happened.
  const fgSharedSig = (() => {
    try { return JSON.stringify(fgSharedPayload()) } catch { return '' }
  })()
  useEffect(() => {
    if (activeTab !== 'fg') return
    if (!supabaseReady || !supabase) return
    if (!fgSharedIdentityKey()) return
    // F-2: stop autosaving once this batch has been finalized by another chemist.
    if (fgFinalizedByOther && fgFinalizedByOther === fgSharedIdentityKey()) return
    // Skip the very first run after binding to an identity (that state came from
    // a load/restore, not a user edit) to avoid an immediate echo save.
    if (!fgSharedReadyRef.current) { fgSharedReadyRef.current = true; return }

    clearTimeout(fgSharedSaveTimer.current)
    fgSharedSaveTimer.current = setTimeout(async () => {
      setSharedStatus('saving')
      const r = await saveFgSharedDraft()
      // 'finalized' → F-2 banner takes over (no retry status). Others map as
      // before: saved=green, error/conflict=retry, skipped=clear.
      setSharedStatus(
        r === 'saved' ? 'saved'
          : r === 'finalized' ? ''
          : r === 'error' ? 'error'
          : r === 'conflict' ? 'error'
          : ''
      )
    }, 900)
    return () => clearTimeout(fgSharedSaveTimer.current)
  }, [activeTab, fgSharedSig, fgSharedIdentityKey()])  // eslint-disable-line react-hooks/exhaustive-deps

  // Flush any pending debounced autosave immediately (used before final submit
  // and reset so no in-flight change is lost).
  const flushFgSharedDraft = useCallback(async () => {
    clearTimeout(fgSharedSaveTimer.current)
    return saveFgSharedDraft()
  }, [saveFgSharedDraft])

  // Mark the current identity's shared draft finalized. IDEMPOTENT: finalizing
  // an already-finalized row is a harmless no-op, so a retry after a partial
  // final-save never creates duplicates. Returns true on success, false on any
  // failure so the caller can surface "finalization pending" and offer a safe
  // retry WITHOUT re-inserting the authoritative record (F-1).
  const finalizeFgSharedDraft = useCallback(async (idn) => {
    if (!supabaseReady || !supabase || !idn) return false
    try {
      let q = supabase
        .from('fg_shared_draft')
        .update({ finalized: true, updated_at: new Date().toISOString() })
        .eq('log_date', idn.log_date).eq('product', idn.product)
        .eq('grade', idn.grade).eq('dryer', idn.dryer)
      q = idn.batch_no === null ? q.is('batch_no', null) : q.eq('batch_no', idn.batch_no)
      const { error } = await q
      return !error   // true on success; false lets the caller show "pending"
    } catch {
      return false
    }
  }, [])

  // Resolve one conflicted field: 'local' keeps the local value, 'remote'
  // adopts the server value. Removing it from the conflicts map lets autosave
  // push the resolved value (bumping the revision) on the next debounce.
  const resolveFgConflict = useCallback((path, choice) => {
    if (choice === 'remote') {
      const remote = fgConflicts[path]?.remote
      // Write the chosen remote value back into the draft at `path`.
      setFgDraft(prev => {
        const next = JSON.parse(JSON.stringify(prev || {}))
        const parts = path.split('.')
        let o = next
        for (let i = 0; i < parts.length - 1; i++) {
          if (!o[parts[i]] || typeof o[parts[i]] !== 'object') o[parts[i]] = {}
          o = o[parts[i]]
        }
        o[parts[parts.length - 1]] = remote
        return next
      })
    }
    setFgConflicts(c => {
      const n = { ...c }; delete n[path]; return n
    })
  }, [fgConflicts, setFgDraft])

  // F-1: retry ONLY the draft-finalization step after the authoritative record
  // was already saved. This never re-inserts into quality_control_records (that
  // insert is guarded by lastSavedSig and is not touched here). On success it
  // clears the pending state and resets the form as a normal successful save
  // would have.
  const retryFinalizeFgSharedDraft = useCallback(async () => {
    if (!fgFinalizePending) return
    setQcError('')
    const ok = await finalizeFgSharedDraft(fgFinalizePending)
    if (!ok) {
      setQcError('Finalization still failed. Check your connection and retry.')
      return
    }
    setFgFinalizePending(null)
    fgSharedKeyRef.current = ''
    fgSharedRevRef.current = null
    fgSharedReadyRef.current = false
    fgSharedPushedSig.current = ''
    setSharedStatus('')
    showSavedToast()
    handleReset()
  }, [fgFinalizePending, finalizeFgSharedDraft, showSavedToast])  // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced live push when FG batch / moisture / suspensibility / dryer /
  // date / grade change (FG tab only, and only once a date is set).
  const fgMoistureVal = fgValues.fg_moisture

  // Skip the FIRST live push after mount/login. The localStorage draft persists
  // across logout, so when the user logs back in the draft may still hold an
  // OLD date. Without this guard, the debounce effect fires on mount and pushes
  // stale data with the old date — updating the wrong qc_activity_draft row
  // (the old date's key) and resetting its last_saved_at to "now", which makes
  // the old activity reappear as live with the wrong date. Only push once the
  // user actively changes something.
  const fgPushReadyRef = useRef(false)

  // Compact signals of the ACTIVE grade's reading logs so the debounced push
  // re-fires whenever a moisture / wet / dry sieve reading is recorded or
  // deleted (the readiness gate depends on these lists, not just typed values).
  const moistureLogSig = JSON.stringify(moistureLog)
  const wetSieveLogSig  = JSON.stringify(sieveLog.fg_wetSieve || [])
  const drySieveLogSig  = JSON.stringify(sieveLog.fg_drySieve || [])

  useEffect(() => {
    if (activeTab !== 'fg') return
    if (!fgDraft.date) return
    // Only UPL Export and OMRI grades go live automatically (debounced) as the
    // user types. Normal (uplGrade === null) and Colour go live ONLY when the
    // Save button is clicked — handled in handlePrint — so skip them here.
    if (fgDraft.uplGrade !== 'export' && fgDraft.uplGrade !== 'omri') return
    if (!fgPushReadyRef.current) {
      fgPushReadyRef.current = true
      return
    }
    const t = setTimeout(() => pushQcActivity(), 700)
    return () => clearTimeout(t)
  }, [activeTab, fgDryer, fgDraft.date, fgDraft.uplGrade, fgDraft.batchNo, fgDraft.time, fgMoistureVal, moistureLogSig, wetSieveLogSig, drySieveLogSig, suspResult])  // eslint-disable-line react-hooks/exhaustive-deps

  // Suspensibility is OPTIONAL for the readiness gate (it does not make a row go
  // live on its own), but when the chemist DOES enter it, it should appear on
  // the live Activity card. The main debounced effect above only auto-pushes for
  // Export/OMRI grades, so for Normal/Colour a typed suspensibility never showed.
  // This effect pushes on a suspensibility change for ANY grade — pushQcActivity
  // still enforces the full readiness gate internally, so an incomplete row is
  // NOT created; it only updates a row that already qualifies to be live.
  useEffect(() => {
    if (activeTab !== 'fg') return
    if (!fgDraft.date) return
    if (suspResult === null || suspResult === undefined || String(suspResult).trim() === '') return
    if (!fgPushReadyRef.current) return   // skip the mount/stale-draft run
    const t = setTimeout(() => pushQcActivity(), 700)
    return () => clearTimeout(t)
  }, [activeTab, suspResult, fgDraft.date, fgDraft.uplGrade, fgDraft.batchNo, fgDryer])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load saved FG data from the database on date change ──────────
  // When the user selects a date, query quality_control_records for the most
  // recent FG entry for that (date, dryer, grade) and restore its values into
  // the form. This ensures data persists across logouts, logins, and date
  // switches — the form always reflects what was actually saved, not a stale
  // localStorage draft. Does NOT clear existing draft values; only fills the
  // form when a matching saved record exists. Skips the initial mount (the
  // draft is already restored from localStorage by useDraft).
  const fgLoadedKeyRef = useRef('')   // last "date|dryer|grade|batch" we loaded from DB
  // Set true by setFgBatchNo ONLY when the user actually changes the batch
  // number. The restore effect uses it to blank date/time when the new batch
  // has no saved data (fresh entry) — WITHOUT blanking on a page reload, so
  // in-progress work survives a refresh/relogin.
  const fgBatchJustChangedRef = useRef(false)

  useEffect(() => {
    if (activeTab !== 'fg') return
    if (!fgDraft.date) return
    if (!supabaseReady || !supabase) return
    // Skip the very first run (draft already has the restored data).
    if (!fgPushReadyRef.current) return
    // Avoid re-loading the same (date, dryer, grade, batch) combo. batch_no is
    // part of the identity: WITHOUT it, starting a new batch on the SAME date +
    // dryer + grade would reload the PREVIOUS batch's saved values (incl. the
    // sieve / moisture reading logs) into the fresh form — the stale-data bug.
    const loadKey = `${fgDraft.date}|${fgDraft.dryer || 'ND1'}|${fgDraft.uplGrade || 'normal'}|${fgDraft.batchNo || ''}`
    if (fgLoadedKeyRef.current === loadKey) return
    fgLoadedKeyRef.current = loadKey

    let cancelled = false
    supabase
      .from('quality_control_records')
      .select('values')
      .eq('tab', 'fg')
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data, error }) => {
        if (cancelled || error || !data || !data.length) return
        // Find the most recent record matching the selected (date, dryer, grade).
        const dryer = fgDraft.dryer || 'ND1'
        const grade = fgDraft.uplGrade || 'normal'
        // Match on the FULL identity including batch_no. A new batch on the same
        // date/dryer/grade must NOT pull back the previous batch's saved values.
        const batchNo = fgDraft.batchNo || ''
        const match = data.find(r => {
          const v = r.values || {}
          return v.date === fgDraft.date &&
                 (v.dryer || 'ND1') === dryer &&
                 (v.grade || 'normal') === grade &&
                 (v.batch_no || '') === batchNo
        })
        // Consume the one-shot "user just changed the batch" flag.
        const userChangedBatch = fgBatchJustChangedRef.current
        fgBatchJustChangedRef.current = false

        if (!match) {
          // No saved record for this (date, dryer, grade, batch).
          //   • If the USER just changed the batch number to a new one with no
          //     data → blank only TIME/End Time for the fresh batch (measurement
          //     values were already cleared by setFgBatchNo). We do NOT blank the
          //     DATE here — blanking the date undid the date the user had just
          //     picked (the "date won't select in one click" bug).
          //   • On a page RELOAD (flag false), do NOT blank anything — keep the
          //     in-progress draft useDraft just restored, so a refresh/relogin
          //     never loses the values the user already filled.
          //   • If an active SHARED draft exists for this identity (another
          //     chemist is working this in-progress batch), do NOT blank the
          //     time — it was legitimately merged in from the shared draft even
          //     though the batch is not yet saved to quality_control_records.
          const sharedExists = fgSharedDraftExistsRef.current === fgSharedIdentityKey()
          if (userChangedBatch && batchNo && !sharedExists) {
            setFgDraft(p => ({ ...p, time: '', endTime: '' }))
          }
          return
        }
        const v = match.values || {}
        // Restore the saved values into the current (dryer, grade) bucket.
        setFgDraft(p => {
          const d = p.dryer || 'ND1'
          const g = p.uplGrade || 'normal'
          const vbd = p.valuesByDryer || { ND1: { normal: {} }, ND2: {} }
          let db = vbd[dryer] || {}
          if (db && typeof db === 'object' && (db.fg_moisture !== undefined || db.fg_susp !== undefined)) {
            db = { normal: db }
          }
          // Merge ALL saved FG measurement values into the bucket (preserve any
          // already-typed values the user may have entered). Restore EVERY key
          // from the saved record EXCEPT the meta / identity / log keys handled
          // separately below — a hardcoded allow-list dropped fields that were
          // not listed (spec-group, newer UPL params, etc.), which is why some
          // values did not reappear when reopening a saved batch.
          const META_KEYS = new Set([
            'date','shift','tested_by','batch_no','time','end_time','brand',
            'product','grade','dryer',
            // reading logs + per-field timestamps + formula inputs are restored
            // on their own, below (not as plain measurement values):
            'fg_wetSieve_log','fg_drySieve_log','fg_moisture_log','fg_formula_inputs','__ts',
          ])
          const savedVals = {}
          Object.keys(v || {}).forEach(k => {
            if (META_KEYS.has(k)) return
            if (v[k] === undefined || v[k] === '' || v[k] === null) return
            savedVals[k] = v[k]
          })
          const cur = db[grade] || {}
          // Reopening a SAVED batch: the saved values are the source of truth, so
          // they take precedence over whatever (usually empty) values are in the
          // current bucket. This is why some values were missing before — the
          // empty current bucket was overriding the saved values.
          const merged = { ...cur, ...savedVals }
          // Restore the identity/meta fields FROM THE SAVED RECORD so the Time
          // (and End Time / brand / product) auto-reflect the saved batch once
          // the batch no. + date are entered. We overwrite with the saved value
          // when present (the user is viewing a saved batch), falling back to the
          // current form value only when the record has none.
          const next = {
            ...p,
            batchNo: v.batch_no || p.batchNo || '',
            time: v.time || p.time || '',
            endTime: v.end_time || p.endTime || '',
            brand: v.brand || p.brand || '',
            selected: v.product || p.selected || FINISHED_GOODS[0].id,
          }
          const newVbd = { ...vbd, [d]: { ...db, [g]: merged } }
          next.valuesByDryer = newVbd
          // Restore sieve log for this grade if present.
          if (v.fg_wetSieve_log || v.fg_drySieve_log) {
            const slg = p.sieveLogByGrade || {}
            const curSg = slg[grade] || {}
            next.sieveLogByGrade = {
              ...slg,
              [grade]: {
                ...curSg,
                ...(v.fg_wetSieve_log ? { fg_wetSieve: v.fg_wetSieve_log } : {}),
                ...(v.fg_drySieve_log ? { fg_drySieve: v.fg_drySieve_log } : {}),
              },
            }
          }
          // Restore moisture readings log for this grade if present.
          if (v.fg_moisture_log) {
            const mlg = p.moistureLogByGrade || {}
            const curMg = mlg[grade] || {}
            next.moistureLogByGrade = {
              ...mlg,
              [grade]: { ...curMg, fg_moisture: v.fg_moisture_log },
            }
          }
          // Restore the formula-card INPUTS (Sulphur Content, Suspensibility,
          // etc.) for this grade so the cards recompute and SHOW their saved
          // result instead of appearing blank. Only present on records saved
          // after this feature shipped (older records have no inputs → cards
          // stay blank, which is unavoidable since the inputs were never saved).
          if (v.fg_formula_inputs && typeof v.fg_formula_inputs === 'object') {
            const fbg = p.fgFormulaInputsByGrade || {}
            const curFg = fbg[grade] || {}
            next.fgFormulaInputsByGrade = {
              ...fbg,
              [grade]: { ...curFg, ...v.fg_formula_inputs },
            }
          }
          return next
        })
        // Remount the formula cards (outside the state updater) so they re-read
        // the restored inputs and recompute their result.
        if (!cancelled) setResetKey(k => k + 1)
      })
    return () => { cancelled = true }
  }, [activeTab, fgDraft.date, fgDraft.dryer, fgDraft.uplGrade, fgDraft.batchNo])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── UPL menu open state (transient, not persisted) ──
  const [uplMenuOpenLocal, setUplMenuOpenLocal] = useState(false)
  const uplMenuOpen = uplMenuOpenLocal
  const uplBtnRef = useRef(null)

  // Close UPL menu on outside click or Esc
  useEffect(() => {
    if (!uplMenuOpen) return
    function handleOutside(e) {
      if (uplBtnRef.current && !uplBtnRef.current.contains(e.target)) setUplMenuOpen(false)
    }
    function handleEsc(e) { if (e.key === 'Escape') setUplMenuOpen(false) }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [uplMenuOpen])

  // ── In-Process mill rows ── (now stored in ipDraft.millRows via setIpMillRows alias above)

  // Set a mill cell and, the FIRST time that mill row becomes non-empty, stamp
  // its own entry time (__ts). Each mill thus carries its OWN original entry
  // time, so the Google Sheet shows a distinct Timestamp per mill (V1's time is
  // not copied onto V2…V10). The stamp is set once and preserved on later edits.
  const setIpMillCell = (idx, field, val) =>
    setIpMillRows(prev => prev.map((r, i) => {
      if (i !== idx) return r
      const next = { ...r, [field]: val }
      const hasData = String(next.br ?? '') !== '' || String(next.flowRate ?? '') !== '' ||
                      String(next.pass ?? '') !== ''
      if (hasData && !next.__ts) next.__ts = new Date().toISOString()
      return next
    }))

  // ── Suspensibility card inputs (lifted for mill table) ──
  const setSuspInput = useCallback((key, val) =>
    setSuspInputs(prev => ({ ...prev, [key]: val })), [])  // eslint-disable-line react-hooks/exhaustive-deps

  function copySuspToMill() {
    const cardBR = suspInputs.BR ?? ''
    const idx = ipMillRows.findIndex(r => r.mill === suspCardMill)
    if (idx === -1 || !cardBR) return
    setIpMillRows(prev => prev.map((r, i) => {
      if (i !== idx) return r
      const next = { ...r, br: cardBR }
      if (!next.__ts) next.__ts = new Date().toISOString()   // stamp this mill's own entry time
      return next
    }))
  }

  // ── Brand/type popup state (transient — not persisted) ──
  const [rmPopupOpen, setRmPopupOpen] = useState(false)
  const [ipPopupOpen, setIpPopupOpen] = useState(false)
  const [fgPopupOpen, setFgPopupOpen] = useState(false)
  const rmDropdownRef = useRef(null)
  const ipDropdownRef = useRef(null)
  const fgDropdownRef = useRef(null)

  // Build bt-compatible objects from draft brand + transient popup state
  const rmBT = {
    brand: rmBrand, popupOpen: rmPopupOpen, dropdownRef: rmDropdownRef,
    openPopup:    () => setRmPopupOpen(true),
    handleClose:  () => setRmPopupOpen(false),
    handleConfirm: v => { setRmBrand(v); setRmPopupOpen(false) },
    reset:        () => { setRmBrand(''); setRmPopupOpen(false) },
  }
  const ipBT = {
    brand: ipBrand, popupOpen: ipPopupOpen, dropdownRef: ipDropdownRef,
    openPopup:    () => setIpPopupOpen(true),
    handleClose:  () => setIpPopupOpen(false),
    handleConfirm: v => { setIpBrand(v); setIpPopupOpen(false) },
    reset:        () => { setIpBrand(''); setIpPopupOpen(false) },
  }
  const fgBT = {
    brand: fgBrand, popupOpen: fgPopupOpen, dropdownRef: fgDropdownRef,
    openPopup:    () => setFgPopupOpen(true),
    handleClose:  () => setFgPopupOpen(false),
    handleConfirm: v => { setFgBrand(v); setFgPopupOpen(false) },
    reset:        () => { setFgBrand(''); setFgPopupOpen(false) },
  }

  function copySuspToMill() {
    const cardBR = suspInputs.BR ?? ''
    const idx = ipMillRows.findIndex(r => r.mill === suspCardMill)
    if (idx === -1 || !cardBR) return
    setIpMillRows(prev => prev.map((r, i) => {
      if (i !== idx) return r
      const next = { ...r, br: cardBR }
      if (!next.__ts) next.__ts = new Date().toISOString()   // stamp this mill's own entry time
      return next
    }))
  }

  const setVal = (id, val) => setValues(p => ({ ...p, [id]: val }))

  // ── Per-field FIRST-ENTRY timestamps ────────────────────────────
  // The RM/IP/FG forms only persist once (on Print/Download), so without this
  // every field would share the save-moment timestamp. Here we record, per tab,
  // the real clock time each field FIRST receives a non-empty value as the user
  // types. A single capture-phase 'input' listener on the QC content area keys
  // each field exactly as collectReportValues() does, so the times line up with
  // the saved value keys. These times are sent to the DB on save (inside
  // values.__ts) and the trigger uses them as field_entry_ts. No UI change.
  const fieldEntryTimesRef = useRef({})   // { [activeTab]: { [valueKey]: ISO } }

  function fieldKeyForInput(el) {
    // Match the exact keys collectReportValues() produces.
    if (el.hasAttribute('data-var-key')) {
      const card = el.closest('[data-formula-card]')
      const cardId = card ? card.getAttribute('data-formula-card') : ''
      return cardId ? `${cardId}__${el.getAttribute('data-var-key')}` : null
    }
    if (el.hasAttribute('data-param-id')) return el.getAttribute('data-param-id')
    if (el.hasAttribute('data-upl-id'))   return el.getAttribute('data-upl-id')
    const specBlock = el.closest('.qc-single-spec[data-test-id]')
    if (specBlock) return specBlock.getAttribute('data-test-id')
    return null
  }

  useEffect(() => {
    const content = document.getElementById('qc-content')
    if (!content) return
    function onInput(e) {
      const el = e.target
      if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'SELECT' && el.tagName !== 'TEXTAREA')) return
      const key = fieldKeyForInput(el)
      if (!key) return
      const val = (el.value ?? '').trim()
      const bucket = fieldEntryTimesRef.current[activeTab] || (fieldEntryTimesRef.current[activeTab] = {})
      if (val !== '') {
        // Record only the FIRST time this field becomes non-empty (original entry).
        if (!bucket[key]) bucket[key] = new Date().toISOString()
      }
    }
    content.addEventListener('input', onInput, true)   // capture phase
    content.addEventListener('change', onInput, true)  // selects fire 'change'
    return () => {
      content.removeEventListener('input', onInput, true)
      content.removeEventListener('change', onInput, true)
    }
  }, [activeTab])

  // Capture identity-field first-entry times (Batch No., Supplier, Invoice,
  // Time, Tested By, Date) which live in the BatchHeader, outside #qc-content.
  // Keyed by the identity keys the trigger/allow-list expect.
  const identityEntryTimesRef = useRef({})
  function markIdentityEntry(key, val) {
    const bucket = identityEntryTimesRef.current[activeTab] || (identityEntryTimesRef.current[activeTab] = {})
    if ((val ?? '').toString().trim() !== '' && !bucket[key]) {
      bucket[key] = new Date().toISOString()
    }
  }

  function handleTabChange(key) {
    setActiveTab(key)
    setResetKey(k => k + 1)
  }

  function handleReset() {
    setResetKey(k => k + 1)
    // Clear captured per-field entry times for this tab so a fresh record
    // starts stamping from scratch.
    fieldEntryTimesRef.current[activeTab] = {}
    identityEntryTimesRef.current[activeTab] = {}
    if (activeTab === 'rm') {
      clearRmDraft()
    }
    if (activeTab === 'ip') {
      clearIpDraft()
    }
    if (activeTab === 'fg') {
      clearFgDraft()
    }
  }

  function doPrint() {
    printReport({
      activeTab, rmSelected, ipSelected, fgSelected, date, testedBy,
      rmBrand, ipBrand, fgBrand,
      rmSupplierName, rmInvoiceNo, rmBatchNo,
      uplGrade,
      // Parameter-table grades (ADMA, Lohiya, …): the Sulphur table row is a
      // read-only mirror of the live formula result (not stored in uplValues),
      // so inject it under that grade's sulphur row id for the printout.
      uplValues: (() => {
        // 'calc' rows are read-only mirrors of a live formula result (not stored
        // in uplValues). Inject each one's current value under its row id so the
        // printout shows the computed Observation. Rows come from the company
        // parameter-table grades (ADMA, Lohiya, …) OR from the UPL Export/OMRI
        // grade tables, both of which may now carry 'calc' rows.
        const rows = (TABLE_GRADES[uplGrade] && TABLE_GRADES[uplGrade].rows)
          || UPL_GRADES[uplGrade]
          || null
        if (!rows) return uplValues
        const injected = { ...uplValues }
        rows.filter(r => r.type === 'calc').forEach(r => {
          const v = r.sourceResult === 'fg_sulphur' ? fgSulphurResult
            : r.sourceResult === 'fg_susp' ? suspResult
            : r.sourceResult === 'fg_bulk' ? fgBulkResult
            : null
          injected[r.id] = (v !== null && v !== undefined && v !== '') ? String(v) : ''
        })
        return injected
      })(),
      fgDryer,
    })
  }

  // ───────────────────────────────────────────────────────────
  // Build the quality_control_records row for the Raw Materials or
  // In-Process tab. Mirrors the FG row shape: a flat `values` jsonb of
  // the captured observation values PLUS the section's meta/identity keys
  // (date, tested_by, batch_no, …) so the existing qc_raw_materials /
  // qc_in_process views and the Google Sheets sync pick them up with no
  // further mapping. `captured` is the live-DOM scrape (same values the
  // printout shows). Returns null if the tab is not rm/ip.
  // ───────────────────────────────────────────────────────────
  // Normalize a field value for change-detection so equivalent values are not
  // treated as different (e.g. '5' == '5.0' == 5; trims whitespace; '' for
  // null/undefined). Numeric strings compare by numeric value; everything else
  // by trimmed string.
  function normalizeTsValue(v) {
    if (v === null || v === undefined) return ''
    const s = String(v).trim()
    if (s === '') return ''
    const n = Number(s)
    return Number.isFinite(n) && s !== '' ? String(n) : s
  }

  // Compute the authoritative per-field timestamp map for an In-Process save.
  // For every field key present in `captured` (plus the identity keys), compare
  // its normalized current value against the last saved value
  // (ipDraft.savedValues):
  //   • unchanged   → keep the existing ipDraft.tsMap[key] (original time)
  //   • new/changed → use the REAL per-field entry time the capture-phase
  //                   listener recorded when the user first typed THAT field
  //                   (fieldEntryTimesRef / identityEntryTimesRef). Fall back to
  //                   `nowIso` only when no captured time exists (e.g. a value
  //                   restored from a draft that was never re-typed this session).
  // This is what makes fields typed at DIFFERENT times show DIFFERENT times,
  // instead of every field sharing the single Print/Download moment.
  // Mill rows keep their own per-mill __ts (set in setIpMillCell). Returns the
  // next { tsMap, savedValues } to both send (__ts) and persist to the draft.
  function computeIpTimestamps(captured, millRows, nowIso) {
    const prevTs    = ipDraft.tsMap || {}
    const prevVals  = ipDraft.savedValues || {}
    const nextTs     = { ...prevTs }
    const nextSaved  = { ...prevVals }

    // Real per-field first-entry times captured while the user typed.
    const fieldTimes    = fieldEntryTimesRef.current[activeTab] || {}
    const identityTimes = identityEntryTimesRef.current[activeTab] || {}
    const capturedTimeFor = key =>
      fieldTimes[key] || identityTimes[key] || null

    // Build the set of value keys to track: captured DOM fields + identity keys.
    const keys = new Set(Object.keys(captured || {}))
    Object.keys(identityTimes).forEach(k => keys.add(k))

    keys.forEach(key => {
      const curNorm = normalizeTsValue(captured[key])
      if (curNorm === '') {
        // Field is empty now — drop its tracked value/time (Reset-like per field).
        delete nextSaved[key]
        delete nextTs[key]
        return
      }
      const prevNorm = Object.prototype.hasOwnProperty.call(nextSaved, key)
        ? nextSaved[key] : undefined
      if (prevNorm === undefined) {
        // NEWLY entered this cycle → use the real first-typing time if captured,
        // else the save moment. (The capture listener records the first time the
        // field became non-empty, so different fields get different times.)
        nextTs[key] = capturedTimeFor(key) || nowIso
      } else if (prevNorm !== curNorm) {
        // GENUINELY CHANGED since last save → new time = the change moment.
        // (The first-entry capture does not update on edits, so use nowIso.)
        nextTs[key] = nowIso
      }
      // else: unchanged → keep nextTs[key] as-is (original time preserved).
      nextSaved[key] = curNorm
    })

    return { tsMap: nextTs, savedValues: nextSaved }
  }

  function buildRmIpRow(captured) {
    if (activeTab === 'rm') {
      return {
        tab: 'rm',
        date: date || null,
        tested_by: testedBy || null,
        values: {
          ...captured,
          date: date || null,
          tested_by: testedBy || null,
          material: rmSelected || null,
          brand: rmBrand || null,
          supplier_name: rmSupplierName || null,
          invoice_no: rmInvoiceNo || null,
          batch_no: rmBatchNo || null,
          time: rmTime || null,
          // Per-field first-entry times (ISO) → used by the trigger as
          // field_entry_ts so each field shows its REAL entry time, not the
          // single save-moment time.
          __ts: collectFieldEntryTimes(),
        },
      }
    }
    if (activeTab === 'ip') {
      // Authoritative per-field timestamps: unchanged fields keep their original
      // time; new/changed fields get `now`. Persisted in ipDraft so repeated
      // Print/Download (and changing the additional test) never regenerate a
      // stable field's timestamp. tsInfo is computed by handlePrint and passed
      // on ipTsOverride; fall back to the stored map if absent.
      const tsMap = (buildRmIpRow._ipTsMap) || (ipDraft.tsMap || {})
      return {
        tab: 'ip',
        date: date || null,
        tested_by: testedBy || null,
        values: {
          ...captured,
          date: date || null,
          tested_by: testedBy || null,
          material: ipSelected || null,
          brand: ipBrand || null,
          batch_no: ipBatchNo || null,
          time: ipTime || null,
          // Mill-wise suspensibility rows (array) — stored under the key the
          // qc_in_process / qc_in_process_mills views already read. Enrich each
          // row with the computed Suspension % (same value the UI shows via
          // computeRowSusp) so the Google Sheet mill columns match the website
          // table exactly. 'susp' is additive; existing readers ignore it.
          // Each row keeps its own per-mill __ts (set in setIpMillCell).
          ip_mill_rows: Array.isArray(ipMillRows)
            ? ipMillRows.map(r => {
                const susp = computeRowSusp(r.br, suspInputs)
                return { ...r, susp: susp !== null && susp !== undefined ? String(susp) : '' }
              })
            : [],
          // Authoritative per-field entry/change times (ISO). The Apps Script
          // snapshot renders these directly into each field's Timestamp cell,
          // so unchanged fields keep their original time across submits.
          __ts: tsMap,
        },
      }
    }
    return null
  }

  // Merge the captured per-field + identity first-entry times for the active tab
  // into one { valueKey: ISO } map, to send inside values.__ts on save.
  function collectFieldEntryTimes() {
    return {
      ...(identityEntryTimesRef.current[activeTab] || {}),
      ...(fieldEntryTimesRef.current[activeTab] || {}),
    }
  }

  async function handlePrint() {
    // Save-before-print now covers all three tabs. The Finished Goods path
    // keeps its original per-(dryer,grade) behavior below; Raw Materials and
    // In-Process use the shared buildRmIpRow() shape. The DB table + RLS
    // (migration 006) already accept tab='rm'/'ip'.
    if (activeTab === 'rm' || activeTab === 'ip') {
      if (qcSaving) return   // in-flight guard — ignore repeated clicks

      const captured = collectReportValues()

      // Required batch-identification fields BEFORE saving, named explicitly so
      // the chemist knows exactly what to fill (same approach as Finished Goods).
      // These match each tab's identity columns in the Google Sheet + the
      // qc_raw_materials / qc_in_process views.
      const missingRmIp = []
      if (activeTab === 'rm') {
        if (!date) missingRmIp.push('Received Date')
        if (!rmBatchNo) missingRmIp.push('Batch Number')
        if (!testedBy) missingRmIp.push('Tested By')
        if (!rmSelected) missingRmIp.push('Material')
        if (!rmSupplierName) missingRmIp.push('Supplier Name')
        if (!rmInvoiceNo) missingRmIp.push('Invoice Number')
        if (!rmTime) missingRmIp.push('Time')
      } else { // ip
        if (!date) missingRmIp.push('Manufacturing Date')
        if (!ipBatchNo) missingRmIp.push('Batch No.')
        if (!testedBy) missingRmIp.push('Tested By')
        if (!ipTime) missingRmIp.push('Time')
      }
      if (missingRmIp.length > 0) {
        setQcError('Please fill these required fields before saving: ' + missingRmIp.join(', ') + '.')
        return
      }

      // In-Process: compute authoritative per-field timestamps by comparing the
      // current values with the last-saved values. Unchanged fields keep their
      // original time; new/changed fields get `now`. Stash the map so
      // buildRmIpRow sends it, and remember the next maps to persist on success.
      let ipTsNext = null
      if (activeTab === 'ip') {
        const nowIso = new Date().toISOString()
        ipTsNext = computeIpTimestamps(captured, ipMillRows, nowIso)
        buildRmIpRow._ipTsMap = ipTsNext.tsMap
      }

      const row = buildRmIpRow(captured)
      buildRmIpRow._ipTsMap = null   // clear the one-shot stash

      // Skip an identical immediate re-save (defence against double submit).
      const sig = JSON.stringify(row.values)
      if (sig === lastSavedSig.current) {
        showSavedToast()
        return
      }

      if (!supabaseReady) {
        setQcError('Supabase not configured. Cannot save report.')
        return
      }

      setQcSaving(true)
      setQcError('')

      const { error } = await supabase.from('quality_control_records').insert([row])

      setQcSaving(false)

      if (error) {
        setQcError(error.message || 'Failed to save report.')
        return   // do NOT show success on save failure
      }

      // Persist the recomputed In-Process timestamp bookkeeping so the NEXT
      // submit can preserve unchanged fields' original times.
      if (activeTab === 'ip' && ipTsNext) {
        setIpDraft(p => ({ ...p, tsMap: ipTsNext.tsMap, savedValues: ipTsNext.savedValues }))
      }

      lastSavedSig.current = sig
      showSavedToast()
      handleReset()   // clear the whole form after a successful save
      return
    }

    if (qcSaving) return   // in-flight guard — ignore repeated clicks

    // F-2: this batch was already submitted by another chemist — block a
    // duplicate authoritative submission entirely.
    if (fgFinalizedByOther && fgFinalizedByOther === fgSharedIdentityKey()) {
      setQcError('This Finished Goods batch has already been submitted by another chemist.')
      return
    }

    // Unresolved shared-draft conflicts must be resolved before the final,
    // authoritative save — otherwise the record could lock in a value the other
    // chemist is still disputing. Point the chemist at the conflict banner.
    if (Object.keys(fgConflicts).length > 0) {
      setQcError('Resolve the highlighted conflicts before saving.')
      return
    }

    // Flush any pending debounced shared-draft autosave so the server copy is
    // current before we build the authoritative record and then reset the form.
    await flushFgSharedDraft()

    // Capture the SAME values the printout shows (from the live DOM) so the
    // saved record matches the printed report exactly.
    const captured = collectReportValues()

    // Finished Goods: require the batch-identification fields BEFORE saving, and
    // name exactly which are missing. These fields form the record identity
    // (date|batch|product|grade|dryer) and the shared-draft key, so saving
    // without them both misroutes the sheet row and leaves the shared draft
    // unfinalizable (the old confusing "Finalizing the shared draft is pending"
    // banner). A clear, specific message is shown instead.
    if (activeTab === 'fg') {
      const missing = []
      if (!date) missing.push('Manufactured Date')
      if (!fgBatchNo) missing.push('Batch No.')
      if (!fgTime) missing.push('Batch Start Time')
      if (!uplGrade) missing.push('Grade')
      if (!fgDryer) missing.push('Dryer')
      if (!fgSelected) missing.push('Product')
      if (missing.length > 0) {
        setQcError('Please fill these required fields before saving: ' + missing.join(', ') + '.')
        return
      }
    }

    // Light validation (RM/IP) — require a date or at least one captured value.
    const hasValue = Object.values(captured).some(v => v !== '' && v != null)
    if (!date && !hasValue) {
      setQcError('Enter at least one value before saving.')
      return
    }

    // Capture the shared-draft identity NOW (before handleReset clears the form)
    // so we can finalize exactly this batch's draft after a successful insert.
    const finalizeIdn = fgSharedIdentity()

    // Repeated Wet/Dry Sieve readings for the ACTIVE grade. Each entry carries
    // its own recorded time (entry.time, already an IST hh:mm AM/PM string) and
    // the micron target label it was recorded against. Stored as arrays so the
    // Google Sheet can lay each reading out as its OWN numbered value+Timestamp
    // pair — repeated readings are never collapsed into one cell. The ISO entry
    // times go into values.__ts under synthetic per-reading keys so each reading
    // column shows its genuine recorded time (not the save moment).
    const wetSieveLog = Array.isArray(sieveLog.fg_wetSieve) ? sieveLog.fg_wetSieve : []
    const drySieveLog = Array.isArray(sieveLog.fg_drySieve) ? sieveLog.fg_drySieve : []
    // Repeated Moisture Content readings for the ACTIVE grade (same shape as the
    // sieve logs). Each entry carries its own IST display time + ISO time.
    const moistureReadingsLog = Array.isArray(moistureLog) ? moistureLog : []

    // Per-field FIRST-ENTRY times the capture listener recorded as the user
    // typed (same source RM uses). Each FG field thus shows its genuine entry
    // time instead of the single Print/Download moment.
    const fgEntryTimes = collectFieldEntryTimes()

    // Add a per-reading ISO timestamp for every recorded sieve reading, keyed
    // so Code.gs can place it next to the matching numbered reading column.
    // Prefer each entry's own isoTime (captured at Record time); fall back to
    // the field's first-entry time only when an older entry lacks isoTime.
    const sieveTs = {}
    wetSieveLog.forEach((e, i) => {
      const iso = e && e.isoTime ? e.isoTime : (fgEntryTimes.fg_wetSieve || null)
      if (iso) sieveTs[`fg_wetSieve_reading_${i + 1}`] = iso
    })
    drySieveLog.forEach((e, i) => {
      const iso = e && e.isoTime ? e.isoTime : (fgEntryTimes.fg_drySieve || null)
      if (iso) sieveTs[`fg_drySieve_reading_${i + 1}`] = iso
    })
    // Per-reading ISO timestamps for each recorded Moisture reading, keyed so
    // Code.gs places each next to its matching numbered reading line.
    moistureReadingsLog.forEach((e, i) => {
      const iso = e && e.isoTime ? e.isoTime : (fgEntryTimes.fg_moisture || null)
      if (iso) sieveTs[`fg_moisture_reading_${i + 1}`] = iso
    })

    // One row for quality_control_records. Only the ACTIVE dryer's values are
    // saved per click (values.dryer makes the record unambiguous); this keeps
    // saved == printed since the DOM reflects the active dryer only.
    const row = {
      tab: 'fg',
      date: date || null,
      tested_by: testedBy || null,
      values: {
        ...captured,
        date: date || null,
        shift: null,            // FG form has no shift input today — stored null for forward-compat
        batch_no: fgBatchNo || null,
        time: fgTime || null,
        end_time: fgEndTime || null,
        brand: fgBrand || null,
        product: fgSelected || null,
        grade: uplGrade || null,
        dryer: fgDryer,
        // Repeated Wet/Dry Sieve readings (arrays; each { result, status, time,
        // targetLabel, isoTime? }). The Google Sheet expands these into
        // numbered reading columns so no reading is lost or overwritten.
        fg_wetSieve_log: wetSieveLog,
        fg_drySieve_log: drySieveLog,
        // Repeated Moisture Content readings (array; each { result, time,
        // isoTime }). The Google Sheet stacks these in the single Moisture cell
        // exactly like the Wet/Dry Sieve cells. fg_moisture itself holds the
        // LATEST recorded reading (or the un-recorded live input) so the summary
        // and backward-compatible readers still see a value.
        fg_moisture: (moistureReadingsLog.length
          ? String(moistureReadingsLog[moistureReadingsLog.length - 1].result)
          : String(fgValues.fg_moisture ?? captured.fg_moisture ?? '')),
        fg_moisture_log: moistureReadingsLog,
        // Formula-card INPUTS for the active grade (Sulphur Content, Suspensibility,
        // etc.) keyed { [formulaId]: { [varKey]: val } }. Saved so reopening this
        // batch can restore the raw inputs and the cards RECOMPUTE their result —
        // otherwise only the computed result was kept and the cards showed blank.
        fg_formula_inputs: (fgDraft.fgFormulaInputsByGrade && fgDraft.fgFormulaInputsByGrade[uplGrade || 'normal']) || {},
        // Per-field first-entry times (ISO) → the trigger uses these as
        // field_entry_ts so each FG field (inputs + results) shows its REAL
        // entry time, not the single save-moment time. Includes synthetic
        // per-reading keys (fg_wetSieve_reading_N / fg_drySieve_reading_N).
        __ts: { ...fgEntryTimes, ...sieveTs },
      },
    }

    // Skip an identical immediate re-save (defence against double submit).
    const sig = JSON.stringify(row.values)
    if (sig === lastSavedSig.current) {
      showSavedToast()
      return
    }

    if (!supabaseReady) {
      setQcError('Supabase not configured. Cannot save report.')
      return
    }

    setQcSaving(true)
    setQcError('')

    const { error } = await supabase.from('quality_control_records').insert([row])

    setQcSaving(false)

    if (error) {
      // Durable cross-device duplicate guard (migration 041): a second
      // authoritative insert for the SAME five-part FG identity (date | batch |
      // product | grade | dryer, non-empty batch) is rejected by the partial
      // unique index quality_control_records_fg_submission_key_uq with Postgres
      // error 23505. Treat THAT specific violation as "already submitted" (not a
      // failure): no duplicate record was created and none should be retried.
      //
      // IMPORTANT (condition 5): classify as a duplicate FG submission ONLY when
      // the error is confirmed to come from OUR index — both the SQLSTATE 23505
      // AND the constraint/index name must match. Any other unique violation is
      // surfaced as a normal error so unrelated constraints are never masked.
      const isFgDuplicate =
        error.code === '23505' &&
        (
          (error.constraint && error.constraint === 'quality_control_records_fg_submission_key_uq') ||
          (typeof error.message === 'string' && error.message.includes('quality_control_records_fg_submission_key_uq')) ||
          (typeof error.details === 'string' && error.details.includes('quality_control_records_fg_submission_key_uq'))
        )

      if (isFgDuplicate) {
        // Mark this exact submission as done for THIS session (no re-insert) and
        // reuse the F-2 lock so the "already submitted" banner shows, the Save
        // button is disabled for this identity, and local values are preserved.
        lastSavedSig.current = sig
        setFgFinalizedByOther(fgSharedIdentityKey())
        setQcError('This Finished Goods batch has already been submitted. No duplicate was created.')
        return
      }

      setQcError(error.message || 'Failed to save report.')
      return   // do NOT show success on save failure
    }

    // F-1: record the authoritative success durably in THIS session FIRST. The
    // lastSavedSig guard above already blocks a byte-identical re-insert, so from
    // here on the authoritative record is "done" and must NEVER be inserted again
    // by this component instance — regardless of whether finalization succeeds.
    lastSavedSig.current = sig

    // Production → Activity live feed (Normal/Colour on Save; Export/OMRI are
    // already live). Independent of finalization. Push BEFORE any reset so the
    // current (pre-reset) FG values are read. Behavior unchanged from before.
    if (uplGrade !== 'export' && uplGrade !== 'omri') {
      pushQcActivity()
    }

    // Finalize this batch's SHARED draft so it cannot reopen as an editable
    // active draft for another chemist. Treated as a SEPARATE operation that can
    // fail independently of the authoritative insert (F-1).
    const finalized = await finalizeFgSharedDraft(finalizeIdn)

    if (!finalized) {
      // The authoritative record IS saved (and lastSavedSig guards re-insert),
      // but the shared draft is still unfinalized. Do NOT fully reset or claim
      // full success: keep the form + identity binding so the chemist can retry
      // finalization (which never re-inserts), and show the pending banner.
      setFgFinalizePending(finalizeIdn)
      setQcError('Record saved. Finalizing the shared draft is pending — tap "Retry finalization".')
      return
    }

    // Reset the shared-draft identity binding so a fresh form starts clean.
    setFgFinalizePending(null)
    fgSharedKeyRef.current = ''
    fgSharedRevRef.current = null
    fgSharedReadyRef.current = false
    fgSharedPushedSig.current = ''
    setSharedStatus('')

    showSavedToast()
    handleReset()   // clear the whole form after a successful save
  }

  // ─────────────────────────────────────────────────────────
  // Shared dropdown + brand popup block
  // Used by all 3 sections — keeps code DRY
  // ─────────────────────────────────────────────────────────
  function DropdownWithBrand({ label, value, options, onChange, bt }) {
    return (
      <div className="qc-dropdown-bar" style={{ position: 'relative' }}>
        <label className="qc-dropdown-label">{label}</label>
        <div className="qc-dropdown-wrap" ref={bt.dropdownRef}>
          <select
            className="qc-dropdown"
            value={value}
            onChange={e => { onChange(e.target.value); bt.reset(); bt.openPopup() }}
          >
            {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          {/* Edit icon — shown when a brand is already saved */}
          {bt.brand && (
            <button
              type="button"
              className="qc-brand-edit-icon"
              title="Edit brand / type"
              onClick={bt.openPopup}
            >✎</button>
          )}
          <BrandTypePopup
            anchorRef={bt.dropdownRef}
            open={bt.popupOpen}
            initialValue={bt.brand}
            placeholder={`e.g. Vedanta, Local…`}
            onConfirm={bt.handleConfirm}
            onClose={bt.handleClose}
          />
        </div>
        {/* Brand badge shown next to the dropdown when confirmed */}
        {bt.brand && (
          <span className="qc-brand-badge">
            – {bt.brand}
          </span>
        )}
      </div>
    )
  }

  // ── Renderers ──────────────────────────────────────────────

  function renderRM() {
    const mat = RAW_MATERIALS.find(m => m.id === rmSelected)
    if (!mat) return null
    const displayLabel = rmBrand ? `${mat.label} – ${rmBrand}` : mat.label
    return (
      <>
        <DropdownWithBrand
          label="Material / सामग्री"
          value={rmSelected}
          options={RAW_MATERIALS}
          onChange={v => { setRmSelected(v); setValues({}); setResetKey(k => k + 1) }}
          bt={rmBT}
        />
        <div className="qc-mat-title">{displayLabel}</div>
        {mat.type === 'spec' && (
          <>
            <SpecTable params={mat.params} values={values} onChange={setVal} />
            <OverallResult results={collectResults(mat, values)} />
          </>
        )}
        {mat.type === 'formula-only' && mat.tests.map(t => (
          <FormulaCalculator key={`${t.id}-${resetKey}`} formula={t} />
        ))}
      </>
    )
  }

  function renderIP() {
    const test = IN_PROCESS.find(t => t.id === ipSelected)
    const ipLabel = test ? (ipBrand ? `${test.label} – ${ipBrand}` : test.label) : ''
    return (
      <>
        {/* Fixed tests */}
        <div className="qc-mat-title" style={{borderTop:'2px solid #b85c2c'}}>
          Fixed Tests / नियत परीक्षण
        </div>
        {IN_PROCESS_PINNED.map(item =>
          item.tests.map(f => (
            <FormulaCalculator
              key={f.id}
              formula={f}
              storedInputs={getIpFormulaInputs(f.id)}
              onInputsChange={next => setIpFormulaInputs(f.id, next)}
            />
          ))
        )}

        {/* Additional test dropdown.
            NOTE: switching the test no longer bumps resetKey — the cards are
            now CONTROLLED (values live in ipDraft.formulaInputs), so changing
            the dropdown simply swaps which card is shown while every test's
            entered data is preserved and restored on switch-back. */}
        <div className="qc-dropdown-bar" style={{borderTop: '2px solid #e0dbd4', marginTop: '4px'}}>
          <label className="qc-dropdown-label">Additional Test / अतिरिक्त परीक्षण</label>
          <select className="qc-dropdown" value={ipSelected}
            onChange={e => { setIpSelected(e.target.value) }}>
            {IN_PROCESS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>

        {test && (
          <>
            <div className="qc-mat-title">{ipLabel}</div>
            {test.tests.map(f => (
              <FormulaCalculator
                key={f.id}
                formula={f}
                storedInputs={getIpFormulaInputs(f.id)}
                onInputsChange={next => setIpFormulaInputs(f.id, next)}
                onInputChange={f.calcFn === 'calcSuspensibility' ? setSuspInput : undefined}
              />
            ))}

            {/* Copy-to-mill bar — only when Suspensibility is selected */}
            {test.id === 'ip_suspensibility' && (
              <div className="qc-susp-copy-bar">
                <span className="qc-susp-copy-label">Copy card BR to mill:</span>
                <select
                  className="qc-susp-copy-select"
                  value={suspCardMill}
                  onChange={e => setSuspCardMill(e.target.value)}
                >
                  {IP_MILLS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
                <button
                  type="button"
                  className="qc-susp-copy-btn"
                  onClick={copySuspToMill}
                  disabled={!suspInputs.BR}
                >
                  ↓ Copy to {suspCardMill}
                </button>
              </div>
            )}
          </>
        )}

        {/* Mill-wise Suspensibility table */}
        <div className="qc-mat-title qc-mill-table-title">
          Mill-wise Suspensibility / मिल-वार निलंबनीयता
        </div>
        <div className="qc-ip-mill-wrap" data-mill-table>
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
              {ipMillRows.map((row, idx) => {
                const suspVal = computeRowSusp(row.br, suspInputs)
                return (
                  <tr key={row.mill}>
                    <td className="qc-ip-mill-name">{row.mill}</td>
                    <td className="qc-ip-mill-td">
                      <input
                        type="text"
                        inputMode="text"
                        pattern="-?[0-9]*\.?[0-9]*"
                        className="qc-ip-mill-input"
                        placeholder="—"
                        value={row.br}
                        onChange={e => setIpMillCell(idx, 'br', e.target.value)}
                      />
                    </td>
                    <td className="qc-ip-mill-susp" data-susp-val={suspVal ?? ''}>
                      {suspVal !== null ? `${suspVal}` : '—'}
                    </td>
                    <td className="qc-ip-mill-td">
                      <input
                        type="text"
                        inputMode="text"
                        pattern="-?[0-9]*\.?[0-9]*"
                        className="qc-ip-mill-input"
                        placeholder="—"
                        value={row.flowRate}
                        onChange={e => setIpMillCell(idx, 'flowRate', e.target.value)}
                      />
                    </td>
                    {/* Pass — free text input */}
                    <td className="qc-ip-mill-td">
                      <input
                        type="text"
                        className="qc-ip-mill-input qc-ip-mill-pass"
                        placeholder=""
                        value={row.pass}
                        onChange={e => setIpMillCell(idx, 'pass', e.target.value)}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </>
    )
  }

  function renderFG() {
    const product = FINISHED_GOODS.find(p => p.id === fgSelected)
    if (!product) return null
    const isWDG = fgSelected === 'sulphur80wdg'

    // Grade label for display and print
    const gradeLabel =
      uplGrade === 'export'   ? 'UPL Export Grade' :
      uplGrade === 'omri'     ? 'UPL OMRI Grade'   :
      uplGrade === 'colour'   ? 'Colour'            :
      uplGrade === 'sumitomo' ? 'SUMITOMO CHEMICAL INDIA' :
      uplGrade === 'hemani_v' ? 'HEMANI INDUSTRIES UNIT - V' :
      uplGrade === 'lohiya'   ? 'LOHIYA CHEMICAL LTD.' :
      uplGrade === 'adama'    ? 'ADAMA INDIA P LTD.' :
      uplGrade === 'biostadt' ? 'BIOSTADT INDIA LTD.' :
      uplGrade === 'sanaca'   ? 'Sanaca Dubai' :
      uplGrade === 'villacrop'? 'Villa Crop' :
      uplGrade === 'yellowstone' ? 'Yellowstone' :
      uplGrade === 'iffco'    ? 'IFFCO' : 'Normal'

    const displayLabel = fgBrand
      ? `${product.label} – ${fgBrand}${isWDG ? ` (${gradeLabel})` : ''}`
      : `${product.label}${isWDG ? ` (${gradeLabel})` : ''}`

    // Group UPL rows by heading
    const uplGroups = (uplGrade === 'export' || uplGrade === 'omri') ? (() => {
      const groups = []
      let cur = null
      UPL_GRADES[uplGrade].forEach(row => {
        if (row.group !== cur) { groups.push({ heading: row.group, rows: [] }); cur = row.group }
        groups[groups.length - 1].rows.push(row)
      })
      return groups
    })() : []

    // Parameter-table grade config (ADMA, Lohiya, …). null for every other grade.
    const tableGrade = TABLE_GRADES[uplGrade] || null

    // Resolve a 'calc' table row's read-only Observation from the matching live
    // formula-card result. Supports the Sulphur and Suspensibility cards.
    const calcRowObserved = (sourceResult) => {
      const v = sourceResult === 'fg_sulphur' ? fgSulphurResult
        : sourceResult === 'fg_susp' ? suspResult
        : sourceResult === 'fg_bulk' ? fgBulkResult
        : null
      return (v !== null && v !== undefined && v !== '') ? String(v) : ''
    }

    // Table-grade extra-param rows grouped by heading.
    const admaGroups = tableGrade ? (() => {
      const groups = []
      let cur = null
      tableGrade.rows.forEach(row => {
        if (row.group !== cur) { groups.push({ heading: row.group, rows: [] }); cur = row.group }
        groups[groups.length - 1].rows.push(row)
      })
      return groups
    })() : []

    // WDG tests hidden when UPL grade covers them. Parameter-table grades hide
    // pH + Wettability (moved into their table) plus Dry Sieve / Moisture / Bulk
    // (not parameters for those grades).
    const hiddenTests = (uplGrade === 'export' || uplGrade === 'omri')
      ? (UPL_GRADES[uplGrade].hideTests ?? [])
      : tableGrade
      ? tableGrade.hiddenCards
      : []

    return (
      <>
        {/* Product dropdown + Grade dropdown in one bar */}
        <div className="qc-fg-bar">
          <div className="qc-dropdown-bar" style={{ position: 'relative', flex: 1 }}>
            <label className="qc-dropdown-label">Product / उत्पाद</label>
            <div className="qc-dropdown-wrap" ref={fgBT.dropdownRef}>
              <select
                className="qc-dropdown"
                value={fgSelected}
                onChange={e => {
                  setFgSelected(e.target.value)
                  setValues({})
                  setResetKey(k => k + 1)
                  setUplGrade(null)
                  setUplValues({})
                  fgBT.reset()
                  fgBT.openPopup()
                }}
              >
                {FINISHED_GOODS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
              {fgBT.brand && (
                <button type="button" className="qc-brand-edit-icon" title="Edit brand / type" onClick={fgBT.openPopup}>✎</button>
              )}
              <BrandTypePopup
                anchorRef={fgBT.dropdownRef}
                open={fgBT.popupOpen}
                initialValue={fgBT.brand}
                placeholder="e.g. Vedanta, Local…"
                onConfirm={fgBT.handleConfirm}
                onClose={fgBT.handleClose}
              />
            </div>
            {fgBT.brand && <span className="qc-brand-badge">– {fgBT.brand}</span>}
          </div>

          {/* Grade dropdown — only for Sulphur 80% WDG */}
          {isWDG && (
            <div className="qc-grade-field">
              <label className="qc-dropdown-label">Grade / ग्रेड</label>
              <select
                className="qc-dropdown qc-grade-select"
                value={uplGrade ?? 'normal'}
                onChange={e => {
                  const v = e.target.value
                  // Each grade keeps its OWN values/uplValues/sieveLog bucket,
                  // so switching only changes which grade is active — the other
                  // grades' data is preserved and restored when you switch back.
                  setUplGrade(v === 'normal' ? null : v)
                  // Clear only the TRANSIENT computed results (they recompute
                  // from the newly-active grade's inputs after remount).
                  setSieveResult({})
                  setSuspResult(null)
                  // Remount formula cards so they re-read the active grade's values.
                  setResetKey(k => k + 1)
                }}
              >
                <option value="normal">Normal</option>
                <option value="export">UPL Export</option>
                <option value="omri">UPL OMRI</option>
                <option value="colour">Colour</option>
                <option value="sumitomo">SUMITOMO CHEMICAL INDIA</option>
                <option value="hemani_v">HEMANI INDUSTRIES UNIT - V</option>
                <option value="lohiya">LOHIYA CHEMICAL LTD.</option>
                <option value="adama">ADAMA INDIA P LTD.</option>
                <option value="biostadt">BIOSTADT INDIA LTD.</option>
                <option value="sanaca">Sanaca Dubai</option>
                <option value="villacrop">Villa Crop</option>
                <option value="yellowstone">Yellowstone</option>
                <option value="iffco">IFFCO</option>
              </select>
            </div>
          )}

          {/* Select Dryer dropdown — ND1 / ND2 (always shown for all FG products) */}
          <div className="qc-grade-field">
            <label className="qc-dropdown-label">Select Dryer / ड्रायर चुनें</label>
            <select
              className="qc-dropdown qc-dryer-select"
              value={fgDryer}
              onChange={e => {
                setFgDryer(e.target.value)
                // Remount FormulaCalculator cards so their local input state
                // reflects the newly-active dryer's values (prevents bleed-over).
                setResetKey(k => k + 1)
              }}
            >
              <option value="ND1">ND1</option>
              <option value="ND2">ND2</option>
            </select>
          </div>
        </div>

        <div className="qc-mat-title">{displayLabel}</div>

        {product.tests
          .filter(test => !hiddenTests.includes(test.id))
          .map(test => {
          // Wet/Dry Sieve are measured several times. Each calculation can be
          // RECORDED as a timestamped entry (result + Pass/Fail status + time)
          // shown beside the formula; recording also pushes the value into the
          // chosen UPL micron row. OMRI → Wet+Dry Sieve; Export → Wet Sieve only.
          const gradeTargets = SIEVE_UPL_TARGETS[uplGrade] || {}
          const sieveApply = gradeTargets[test.id]
          if (test.calcFn && sieveApply) {
            const opts   = gradeTargets[test.id]
            // Fall back to the first option if the stored target isn't valid for
            // this grade's options (e.g. an OMRI default carried into Export).
            const stored = sieveTarget[test.id]
            const target = opts.some(o => o.id === stored) ? stored : opts[0].id
            const res    = sieveResult[test.id]
            const hasRes = res !== null && res !== undefined && res !== ''
            const log    = sieveLog[test.id] || []
            const targetRule = ((UPL_GRADES[uplGrade] || []).find(r => r.id === target) || {}).rule

            function recordSieve() {
              if (!hasRes) return
              const status = evaluate(res, targetRule) || '—'
              const now = new Date()
              // IST-locked display time (see istClock): never the browser-local
              // wall-clock, so a reading can't drift to the wrong half of the day.
              const time = istClock(now)
              const targetLabel = (opts.find(o => o.id === target) || {}).label || ''
              // isoTime: genuine recording moment (ISO) so the Google Sheet can
              // render this reading's own Timestamp. `time` stays for the UI log.
              const nowIso = now.toISOString()
              // uplId: the designated UPL Extra Parameters result field this
              // reading feeds (e.g. 'upl_exp_ws_160'). Carried on the entry so the
              // live sync can update that exact UPL parameter cell + timestamp.
              const entry = { result: String(res), status, time, isoTime: nowIso, targetLabel, uplId: target }
              addSieveEntry(test.id, entry)
              // Also push into the UPL row so its table status reflects the latest.
              setUplValues(p => ({ ...p, [target]: String(res) }))
              // The UPL value is set PROGRAMMATICALLY here (not typed), so the
              // capture-phase input listener never records a first-entry time for
              // it — which is why e.g. UPL Export "Wet Sieve 160 Micron"
              // (upl_exp_ws_160) had a blank Timestamp column. Record the genuine
              // measurement time for the target UPL key here so Print/Download's
              // values.__ts carries it and the column shows the real time. Each
              // Record is a fresh measurement moment for that micron, so we stamp
              // on first entry and refresh on change.
              if (target) {
                const fgBucket = fieldEntryTimesRef.current.fg || (fieldEntryTimesRef.current.fg = {})
                fgBucket[target] = nowIso
              }
              // Live push to Production → Activity immediately with the fresh log
              // (state updates are async, so pass the updated array as an override).
              const newLog = [ ...((sieveLog[test.id]) || []), entry ]
              pushQcActivity(
                test.id === 'fg_wetSieve' ? { wetLog: newLog } : { dryLog: newLog }
              )
              // Live push to the Google Sheet (qc_fg_sieve_readings) — but ONLY
              // from the SECOND recorded reading onward. The first Record click
              // just retains the reading locally (no incomplete single-reading
              // row is created in the sheet). On the second Record the full
              // record (both readings + original timestamps) syncs at once, and
              // every later reading updates the SAME business-key row. Pass the
              // updated array because the draft state update above is async.
              if (newLog.length >= 2) {
                pushFgSieveReadings(test.id, newLog)
              }
            }

            return (
              <div key={`${test.id}-${resetKey}`} className="qc-sieve-apply-wrap">
                <div className="qc-sieve-apply-grid">
                  <div className="qc-sieve-apply-formula">
                    <FormulaCalculator
                      formula={test}
                      onResult={val => setSieveResult(p => ({ ...p, [test.id]: val }))}
                    />
                    <div className="qc-sieve-apply-bar">
                      <span className="qc-sieve-apply-label">Micron:</span>
                      <select
                        className="qc-sieve-apply-select"
                        value={target}
                        onChange={e => setSieveTarget(p => ({ ...p, [test.id]: e.target.value }))}
                      >
                        {opts.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                      </select>
                      <button
                        type="button"
                        className="qc-sieve-apply-btn"
                        disabled={!hasRes}
                        onClick={recordSieve}
                      >
                        + Record {hasRes ? `(${res})` : ''}
                      </button>
                    </div>
                  </div>

                  {/* Recorded entries — result + status + time */}
                  <div className="qc-sieve-log" data-sieve-log={test.id}>
                    <div className="qc-sieve-log-title">{test.name} — recorded</div>
                    {log.length === 0 ? (
                      <div className="qc-sieve-log-empty">No entries yet.</div>
                    ) : (
                      <div className="qc-sieve-log-scroll">
                        <table className="qc-sieve-log-table">
                          <thead>
                            <tr><th>#</th><th>Micron</th><th>Result</th><th>Status</th><th>Time</th><th></th></tr>
                          </thead>
                          <tbody>
                            {log.map((e, idx) => (
                              <tr key={idx}>
                                <td>{idx + 1}</td>
                                <td>{e.targetLabel}</td>
                                <td>{e.result}</td>
                                <td>
                                  {e.status === 'PASS' && <span className="qc-upl-pass">Pass</span>}
                                  {e.status === 'FAIL' && <span className="qc-upl-fail">Fail</span>}
                                  {e.status !== 'PASS' && e.status !== 'FAIL' && <span className="qc-upl-na">—</span>}
                                </td>
                                <td>{e.time}</td>
                                <td>
                                  <button type="button" className="qc-sieve-log-del"
                                    title="Remove" onClick={() => removeSieveEntry(test.id, idx)}>×</button>
                                </td>
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
          if (test.calcFn) return (
            <FormulaCalculator
              key={`${test.id}-${resetKey}`}
              // Parameter-table grades (ADMA, Lohiya, …) override the displayed
              // card name for Wet Sieve to carry the spec text. Does not mutate
              // the shared test definition, so other grades keep the original
              // "Wet Sieve" name.
              formula={
                tableGrade && tableGrade.nameOverrides[test.id]
                  ? { ...test, name: tableGrade.nameOverrides[test.id] }
                  : test
              }
              onResult={
                test.id === 'fg_susp'
                  ? setSuspResult
                  // Grades that mirror the Sulphur result into a table row:
                  // company parameter-table grades AND UPL Export/OMRI.
                  : (test.id === 'fg_sulphur' && (tableGrade || uplGrade === 'export' || uplGrade === 'omri'))
                  ? setFgSulphurResult
                  // Sanaca mirrors the Bulk Density result into its table.
                  : (test.id === 'fg_bulk' && tableGrade)
                  ? setFgBulkResult
                  : undefined
              }
              // CONTROLLED: persist this card's inputs in the FG draft (per
              // grade) so Suspensibility (and any FG formula) SURVIVES a refresh
              // / relogin and is part of the shared draft.
              storedInputs={getFgFormulaInputs(test.id)}
              onInputsChange={next => setFgFormulaInputs(test.id, next)}
            />
          )
          if (test.type === 'moisture-readings') {
            // Moisture Content is recorded several times per batch (same UX as
            // Wet/Dry Sieve) for EVERY grade. The live input holds the current
            // reading; "Record" stamps it with its own IST time into the
            // per-grade moisture log and live-syncs the full list to the sheet.
            const mVal    = values[test.id] ?? ''
            const hasMVal = mVal !== null && mVal !== undefined && String(mVal).trim() !== ''
            const mLog    = moistureLog

            function recordMoisture() {
              if (!hasMVal) return
              const now    = new Date()
              const time   = istClock(now)           // IST-locked display time
              const nowIso = now.toISOString()
              const entry  = { result: String(mVal), time, isoTime: nowIso }
              addMoistureEntry(entry)
              // Clear the live input so the next reading starts fresh.
              setVal(test.id, '')
              // Live push the full updated list (state update is async → pass override).
              const newLog = [ ...(moistureLog || []), entry ]
              // Live push to Production → Activity immediately with the fresh log
              // (state updates are async, so pass the updated array as override).
              pushQcActivity({ moistureLog: newLog })
              // Google-Sheet live sync is intentionally disabled (readings reach
              // the sheet only on final Save); this is a no-op while the flag is
              // off, kept so re-enabling restores the sheet sync.
              pushFgMoistureReadings(newLog)
            }

            return (
              <div key={`${test.id}-${resetKey}`} className="qc-sieve-apply-wrap" data-test-id={test.id}>
                <div className="qc-sieve-apply-grid">
                  <div className="qc-sieve-apply-formula">
                    {/* Bordered card so the Record bar attaches seamlessly below
                        it, exactly like the Wet/Dry Sieve formula card. */}
                    <div className="qc-moisture-card">
                      <div className="qc-moisture-name">{test.name}</div>
                      <div className="qc-moisture-input-row">
                        <input type="text" inputMode="text" pattern="-?[0-9]*\.?[0-9]*"
                          className="qc-input qc-moisture-input" placeholder="—"
                          value={mVal}
                          onChange={e => setVal(test.id, e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') recordMoisture() }} />
                        {test.unit && <span className="qc-unit">{test.unit}</span>}
                      </div>
                    </div>
                    <div className="qc-sieve-apply-bar">
                      <button
                        type="button"
                        className="qc-sieve-apply-btn"
                        disabled={!hasMVal}
                        onClick={recordMoisture}
                      >
                        + Record {hasMVal ? `(${mVal})` : ''}
                      </button>
                    </div>
                  </div>

                  {/* Recorded moisture readings — result + time. For the UPL
                      Export and UPL OMRI grades ONLY, each reading also shows a
                      Pass/Fail status against the moisture spec (range 1.5–2.2).
                      Other grades keep the original columns unchanged. */}
                  <div className="qc-sieve-log" data-moisture-log={test.id}>
                    <div className="qc-sieve-log-title">{test.name} — recorded</div>
                    {mLog.length === 0 ? (
                      <div className="qc-sieve-log-empty">No entries yet.</div>
                    ) : (
                      <div className="qc-sieve-log-scroll">
                        <table className="qc-sieve-log-table">
                          <thead>
                            <tr>
                              <th>#</th>
                              <th>Result ({test.unit})</th>
                              {(uplGrade === 'export' || uplGrade === 'omri') && <th>Status</th>}
                              <th>Time</th>
                              <th></th>
                            </tr>
                          </thead>
                          <tbody>
                            {mLog.map((e, idx) => {
                              // Export + OMRI per-reading Pass/Fail (range 1.5–2.2).
                              const mStatus = (uplGrade === 'export' || uplGrade === 'omri')
                                ? evaluate(e.result, { type: 'range', min: 1.5, max: 2.2 })
                                : null
                              return (
                              <tr key={idx}>
                                <td>{idx + 1}</td>
                                <td>{e.result}</td>
                                {(uplGrade === 'export' || uplGrade === 'omri') && (
                                  <td>
                                    {mStatus === 'PASS' && <span className="qc-upl-pass">Pass</span>}
                                    {mStatus === 'FAIL' && <span className="qc-upl-fail">Fail</span>}
                                    {mStatus === null   && <span className="qc-upl-na">—</span>}
                                  </td>
                                )}
                                <td>{e.time}</td>
                                <td>
                                  <button type="button" className="qc-sieve-log-del"
                                    title="Remove" onClick={() => removeMoistureEntry(idx)}>×</button>
                                </td>
                              </tr>
                            )})}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          }
          if (test.type === 'spec-single') return (
            <div key={test.id} className="qc-single-spec" data-test-id={test.id}>
              <div className="qc-single-name">{test.name}</div>
              {test.method && <div className="qc-method">{test.method}</div>}
              <div className="qc-input-unit">
                <input type="text" inputMode="text" pattern="-?[0-9]*\.?[0-9]*"
                  className="qc-input" placeholder="—"
                  value={values[test.id] ?? ''}
                  onChange={e => setVal(test.id, e.target.value)} />
                {test.unit && <span className="qc-unit">{test.unit}</span>}
              </div>
            </div>
          )
          if (test.type === 'spec-group') return (
            <div key={test.id}>
              <div className="qc-group-title">{test.name}</div>
              <SpecTable params={test.params} values={values} onChange={setVal} />
            </div>
          )
          return null
        })}

        {/* UPL Parameters table — only for export/omri grades */}
        {(uplGrade === 'export' || uplGrade === 'omri') && (
          <div className="qc-upl-table-wrap" data-upl-table>
            <div className="qc-upl-table-title">
              UPL Parameters – {gradeLabel}
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
                  {uplGroups.map(g => (
                    <Fragment key={g.heading}>
                      <tr className="qc-upl-group-row">
                        <td colSpan={4}>{g.heading}</td>
                      </tr>
                      {g.rows.map(row => {
                        // 'calc' rows mirror a formula-card result (read-only);
                        // all others take the stored value.
                        const val = row.type === 'calc'
                          ? calcRowObserved(row.sourceResult)
                          : (uplValues[row.id] ?? '')
                        const status = evaluate(val, row.rule)
                        return (
                          <tr key={row.id}>
                            <td>{row.parameter}{row.unit ? ` (${row.unit})` : ''}</td>
                            <td>{row.specDisplay}</td>
                            <td>
                              {row.type === 'calc' ? (
                                <input
                                  type="text"
                                  readOnly
                                  className="qc-upl-input"
                                  placeholder="—"
                                  value={val}
                                  data-upl-id={row.id}
                                />
                              ) : row.type === 'complies' ? (
                                <select
                                  className="qc-upl-select"
                                  value={val}
                                  data-upl-id={row.id}
                                  onChange={e => setUplValues(p => ({ ...p, [row.id]: e.target.value }))}
                                >
                                  <option value="">— Select —</option>
                                  <option value="Complies">Complies</option>
                                  <option value="Does not comply">Does not comply</option>
                                </select>
                              ) : (
                                <input
                                  type="text"
                                  inputMode="text"
                                  pattern="-?[0-9]*\.?[0-9]*"
                                  className="qc-upl-input"
                                  placeholder="—"
                                  value={val}
                                  data-upl-id={row.id}
                                  onChange={e => setUplValues(p => ({ ...p, [row.id]: e.target.value }))}
                                />
                              )}
                            </td>
                            <td className="qc-upl-status-cell">
                              {status === 'PASS' && <span className="qc-upl-pass">Pass</span>}
                              {status === 'FAIL' && <span className="qc-upl-fail">Fail</span>}
                              {status === null   && <span className="qc-upl-na">—</span>}
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
        )}

        {/* Parameter-table grades (ADMA, Lohiya, …). Four-column table:
            Parameter / Specification / Observation / Result. The Sulphur 'calc'
            row mirrors the live formula-card result; pH + Wettability take
            operator observations; Appearance + Drop Test are dropdowns. Each
            such grade also hides pH/Wettability/DrySieve/Moisture/Bulk cards. */}
        {tableGrade && (
          <div className="qc-upl-table-wrap" data-adma-table>
            <div className="qc-upl-table-title">
              {tableGrade.title} – {gradeLabel}
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
                  {admaGroups.map(g => (
                    <Fragment key={g.heading}>
                      <tr className="qc-upl-group-row">
                        <td colSpan={4}>{g.heading}</td>
                      </tr>
                      {g.rows.map(row => {
                        // 'calc' rows mirror a formula-card result (read-only);
                        // all others take the stored observation value.
                        const observed = row.type === 'calc'
                          ? calcRowObserved(row.sourceResult)
                          : (uplValues[row.id] ?? '')
                        const status = evaluate(observed, row.rule)
                        return (
                          <tr key={row.id}>
                            <td>{row.parameter}{row.unit ? ` (${row.unit})` : ''}</td>
                            <td>{row.specDisplay}</td>
                            <td>
                              {row.type === 'calc' ? (
                                // Read-only observation sourced from the live
                                // formula card. data-upl-id so Print/Download and
                                // the save snapshot capture the computed value.
                                <input
                                  type="text"
                                  readOnly
                                  className="qc-upl-input"
                                  placeholder="—"
                                  value={observed}
                                  data-upl-id={row.id}
                                />
                              ) : row.type === 'complies' ? (
                                <select
                                  className="qc-upl-select"
                                  value={observed}
                                  data-upl-id={row.id}
                                  onChange={e => setUplValues(p => ({ ...p, [row.id]: e.target.value }))}
                                >
                                  <option value="">— Select —</option>
                                  <option value="Complies">Complies</option>
                                  <option value="Does not comply">Does not comply</option>
                                </select>
                              ) : row.type === 'droptest' ? (
                                <select
                                  className="qc-upl-select"
                                  value={observed}
                                  data-upl-id={row.id}
                                  onChange={e => setUplValues(p => ({ ...p, [row.id]: e.target.value }))}
                                >
                                  <option value="">— Select —</option>
                                  <option value="Found OK no leakage">Found OK no leakage</option>
                                  <option value="Fail">Fail</option>
                                </select>
                              ) : row.type === 'text' ? (
                                // Free-text observation (e.g. Arsenic Content).
                                <input
                                  type="text"
                                  className="qc-upl-input"
                                  placeholder="—"
                                  value={observed}
                                  data-upl-id={row.id}
                                  onChange={e => setUplValues(p => ({ ...p, [row.id]: e.target.value }))}
                                />
                              ) : row.type === 'arsenic' ? (
                                // Arsenic Content — Not Detected (Pass) / Detected (Fail).
                                <select
                                  className="qc-upl-select"
                                  value={observed}
                                  data-upl-id={row.id}
                                  onChange={e => setUplValues(p => ({ ...p, [row.id]: e.target.value }))}
                                >
                                  <option value="">— Select —</option>
                                  <option value="Not Detected">Not Detected</option>
                                  <option value="Detected">Detected</option>
                                </select>
                              ) : (
                                <input
                                  type="text"
                                  inputMode="text"
                                  pattern="-?[0-9]*\.?[0-9]*"
                                  className="qc-upl-input"
                                  placeholder="—"
                                  value={observed}
                                  data-upl-id={row.id}
                                  onChange={e => setUplValues(p => ({ ...p, [row.id]: e.target.value }))}
                                />
                              )}
                            </td>
                            <td className="qc-upl-status-cell">
                              {status === 'PASS' && <span className="qc-upl-pass">Pass</span>}
                              {status === 'FAIL' && <span className="qc-upl-fail">Fail</span>}
                              {status === null   && <span className="qc-upl-na">—</span>}
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
        )}

        {/* Overall result */}
        <OverallResult results={{
          ...collectFGResults(product, values, hiddenTests),
          ...((uplGrade === 'export' || uplGrade === 'omri')
            ? Object.fromEntries(
                UPL_GRADES[uplGrade].map(row => [
                  row.id,
                  evaluate(row.type === 'calc' ? calcRowObserved(row.sourceResult) : (uplValues[row.id] ?? ''), row.rule),
                ])
              )
            : {}),
          ...(tableGrade
            // Only ruled table-grade rows count toward Overall (mirrors
            // collectFGResults, which excludes rule-less params so an unruled
            // field never forces a permanent "Incomplete"). 'calc' rows read
            // their live formula result; others read the stored observation.
            ? Object.fromEntries(
                tableGrade.rows.filter(row => row.rule)
                  .map(row => [
                    row.id,
                    evaluate(row.type === 'calc' ? calcRowObserved(row.sourceResult) : (uplValues[row.id] ?? ''), row.rule),
                  ])
              )
            : {}),
        }} />
      </>
    )
  }

  return (
    <div className="qc-wrapper">

      <div className="qc-header-bar">
        <div className="qc-title-main">
          Quality Control / <span className="qc-title-hi">गुणवत्ता नियंत्रण</span>
        </div>
      </div>

      <div className="qc-tab-bar">
        {TABS.map(tab => (
          <button key={tab.key} type="button"
            className={`qc-tab-btn ${activeTab === tab.key ? 'qc-tab-active' : ''}`}
            onClick={() => handleTabChange(tab.key)}>
            {tab.label}<span className="qc-tab-hi"> / {tab.labelHi}</span>
          </button>
        ))}
      </div>

      <BatchHeader
        date={date} setDate={setDate}
        dateLabel={
          activeTab === 'rm' ? 'Received Date / प्राप्ति तारीख' :
          activeTab === 'ip' ? 'Manufacturing Date / निर्माण तारीख' :
          'Manufactured Date / निर्मित तारीख'
        }
        testedBy={testedBy} setTestedBy={setTestedBy}
        splitTime={activeTab === 'rm'}
        extra={
          activeTab === 'rm' ? [
            { key: 'rinv',       label: 'Invoice No.',                            placeholder: 'e.g. INV-001', value: rmInvoiceNo,    onChange: setRmInvoiceNo },
            { key: 'rsupplier',  label: 'Supplier Name / आपूर्तिकर्ता का नाम',  value: rmSupplierName,        onChange: setRmSupplierName },
            { key: 'rbatch',     label: 'Batch No. / बैच नं.',                   placeholder: 'e.g. 3512',    value: rmBatchNo,       onChange: setRmBatchNo },
            { key: 'rtime',      label: 'Time / समय',                            value: rmTime,                onChange: setRmTime, type: 'time' },
          ] :
          activeTab === 'ip' ? [
            { key: 'ibatch', label: 'Batch No. / बैच नं.', placeholder: 'e.g. 3512',    value: ipBatchNo,   onChange: setIpBatchNo },
            { key: 'itime',  label: 'Time / समय',          value: ipTime,               onChange: setIpTime, type: 'time' },
          ] : [
            { key: 'fbatch',   label: 'Batch No. / बैच नं.',                 placeholder: 'e.g. 3512', value: fgBatchNo,   onChange: setFgBatchNo },
            { key: 'ftime',    label: 'Batch Start Time / बॅच सुरू वेळ',     value: fgTime,             onChange: setFgTime,    type: 'time' },
            { key: 'fendtime', label: 'Batch End Time / बॅच समाप्ती वेळ',   value: fgEndTime,          onChange: setFgEndTime, type: 'time' },
          ]
        }
      />

      <div className="qc-content" id="qc-content">
        {activeTab === 'rm' && renderRM()}
        {activeTab === 'ip' && renderIP()}
        {activeTab === 'fg' && renderFG()}
      </div>

      {/* F-2: this batch was already submitted by another chemist. Editing and
          final submission are blocked for this identity; local values are kept
          so nothing is lost. The chemist can switch to a different batch. */}
      {activeTab === 'fg' && fgFinalizedByOther && fgFinalizedByOther === fgSharedIdentityKey() && (
        <div className="qc-conflict-banner qc-finalized-banner" role="alert">
          <div className="qc-conflict-title">
            This Finished Goods batch has already been submitted by another chemist.
          </div>
          <div className="qc-finalized-note">
            Editing and saving are disabled for this batch. Your entered values are
            kept on this device. Select a different Date / Batch / Product / Grade /
            Dryer to continue with another batch.
          </div>
        </div>
      )}

      {/* F-1: the authoritative record was saved but finalizing the shared draft
          failed. The record is NOT re-inserted on retry — this only finalizes the
          draft. Until it succeeds we do not claim full success or reset. */}
      {activeTab === 'fg' && fgFinalizePending && (
        <div className="qc-conflict-banner qc-pending-banner" role="alert">
          <div className="qc-conflict-title">
            Record saved — shared-draft finalization pending.
          </div>
          <div className="qc-finalized-note">
            The report was saved successfully. Finalizing the shared draft (so no
            one else can resubmit this batch) did not complete. Retrying will NOT
            create a duplicate record.
          </div>
          <button type="button" className="qc-conflict-choice"
            onClick={retryFinalizeFgSharedDraft}>
            Retry finalization
          </button>
        </div>
      )}

      {/* FG shared-draft conflict banner — shown only when two chemists set a
          different non-empty value for the same field. The chemist keeps either
          their own value or the other chemist's; both are preserved until then.
          Final Save is blocked while any conflict is unresolved. */}
      {activeTab === 'fg' && Object.keys(fgConflicts).length > 0 && (
        <div className="qc-conflict-banner" role="alert">
          <div className="qc-conflict-title">
            Conflicting edits from another chemist — choose which value to keep:
          </div>
          {Object.entries(fgConflicts).map(([path, { local, remote }]) => (
            <div key={path} className="qc-conflict-row">
              <span className="qc-conflict-field">{path}</span>
              <button type="button" className="qc-conflict-choice"
                onClick={() => resolveFgConflict(path, 'local')}>
                Keep yours: <b>{String(local)}</b>
              </button>
              <button type="button" className="qc-conflict-choice"
                onClick={() => resolveFgConflict(path, 'remote')}>
                Use theirs: <b>{String(remote)}</b>
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="qc-actions">
        {qcError && (
          <div className="qc-error">Error: {qcError}</div>
        )}
        {activeTab === 'fg' && sharedStatus && (
          <span className={`qc-shared-status qc-shared-status-${sharedStatus}`} aria-live="polite">
            {sharedStatus === 'saving' ? 'Sharing…'
              : sharedStatus === 'saved' ? 'Shared ✓'
              : 'Share failed — will retry'}
          </span>
        )}
        <button
          type="button"
          className="qc-print-btn"
          onClick={handlePrint}
          disabled={qcSaving || (activeTab === 'fg' && fgFinalizedByOther === fgSharedIdentityKey() && !!fgFinalizedByOther)}
        >
          {qcSaving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="qc-clear-btn" onClick={handleReset}>
          Reset All / सभी रीसेट करें
        </button>
      </div>

      {qcSaved && (
        <div className="qc-saved-toast" role="status" aria-live="polite">
          Data saved successfully
        </div>
      )}

    </div>
  )
}
