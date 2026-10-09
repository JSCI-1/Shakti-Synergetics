import React, { useState, useRef, useEffect, useCallback, Fragment } from 'react'
import { RAW_MATERIALS, IN_PROCESS, IN_PROCESS_PINNED, FINISHED_GOODS } from '../../data/qualityData.js'
import { UPL_GRADES } from '../../data/uplData.js'
import { evaluate, calcSuspensibility } from '../../utils/qualityUtils.js'
import { overallResult } from './OverallResult.jsx'
import SpecTable from './SpecTable.jsx'
import FormulaCalculator from './FormulaCalculator.jsx'
import OverallResult from './OverallResult.jsx'
import { useDraft, useUserId } from '../../utils/useDraft.js'
import './QualityCheck.css'

const TABS = [
  { key: 'rm', label: 'Raw Materials',  labelHi: 'कच्चा माल'  },
  { key: 'ip', label: 'In-Process',     labelHi: 'इन-प्रोसेस' },
  { key: 'fg', label: 'Finished Goods', labelHi: 'तैयार माल'  },
]

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
// printReport
// ─────────────────────────────────────────────────────────────
function printReport({ activeTab, rmSelected, ipSelected, fgSelected, date, testedBy,
                       rmBrand, ipBrand, fgBrand, rmSupplierName, rmInvoiceNo, rmBatchNo,
                       uplGrade, uplValues }) {
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

  const gradeLabel        = uplGrade === 'export' ? 'Export Grade' : uplGrade === 'omri' ? 'OMRI Grade' : ''
  const uplSuffix         = (activeTab === 'fg' && uplGrade) ? ` – UPL Limited (${gradeLabel})` : ''
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
  if (activeTab === 'fg' && uplGrade && uplValues) {
    const rows = UPL_GRADES[uplGrade]
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
      <div style="font-weight:bold;font-size:13px;color:#b85c2c;margin-bottom:6px">UPL Parameters – ${gradeLabel}</div>
      <table style="width:100%;border-collapse:collapse;table-layout:fixed;word-break:break-word">
        <tr>
          <th style="${TH};width:30%">Parameter</th>
          <th style="${TH};width:25%">Specification</th>
          <th style="${TH};width:22%;text-align:center">Result</th>
          <th style="${TH};width:23%;text-align:center">Status</th>
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
      ${sectionLabel} &nbsp;›&nbsp; ${materialWithBrand}
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
export default function QualityCheck() {
  const uid = useUserId()

  // ── Active tab (persisted) ──
  const [activeTab, setActiveTab] = useDraft(`draft:${uid}:qc:activeTab`, 'rm')

  // ── Per-tab draft state ──
  const [rmDraft, setRmDraft, clearRmDraft] = useDraft(`draft:${uid}:qc:rm`, {
    selected: RAW_MATERIALS[0].id,
    values: {}, date: '', testedBy: '',
    invoiceNo: '', batchNo: '', supplierName: '', time: '',
    brand: '',
  })
  const [ipDraft, setIpDraft, clearIpDraft] = useDraft(`draft:${uid}:qc:ip`, {
    selected: IN_PROCESS[0].id,
    values: {}, date: '', testedBy: '',
    batchNo: '', time: '',
    brand: '',
    millRows: emptyMillRows(), suspInputs: {}, suspCardMill: IP_MILLS[0],
  })
  const [fgDraft, setFgDraft, clearFgDraft] = useDraft(`draft:${uid}:qc:fg`, {
    selected: FINISHED_GOODS[0].id,
    values: {}, date: '', testedBy: '',
    batchNo: '', time: '',
    brand: '',
    uplGrade: null, uplValues: {},
  })

  // Convenience aliases — read from active tab draft
  const rmSelected     = rmDraft.selected
  const ipSelected     = ipDraft.selected
  const fgSelected     = fgDraft.selected
  const values         = activeTab === 'rm' ? rmDraft.values : activeTab === 'ip' ? ipDraft.values : fgDraft.values
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
  const uplGrade       = fgDraft.uplGrade
  const uplValues      = fgDraft.uplValues
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
    else setFgDraft(p => ({ ...p, values: typeof fn === 'function' ? fn(p.values) : fn }))
  }
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
  const setRmInvoiceNo    = v => setRmDraft(p => ({ ...p, invoiceNo: v }))
  const setRmBatchNo      = v => setRmDraft(p => ({ ...p, batchNo: v }))
  const setRmSupplierName = v => setRmDraft(p => ({ ...p, supplierName: v }))
  const setRmTime         = v => setRmDraft(p => ({ ...p, time: v }))
  const setIpBatchNo      = v => setIpDraft(p => ({ ...p, batchNo: v }))
  const setIpTime         = v => setIpDraft(p => ({ ...p, time: v }))
  const setFgBatchNo      = v => setFgDraft(p => ({ ...p, batchNo: v }))
  const setFgTime         = v => setFgDraft(p => ({ ...p, time: v }))
  const setUplGrade       = v => setFgDraft(p => ({ ...p, uplGrade: v }))
  const setUplValues      = fn => setFgDraft(p => ({ ...p, uplValues: typeof fn === 'function' ? fn(p.uplValues) : fn }))
  const setUplMenuOpen    = v => setUplMenuOpenLocal(v)  // menu state is NOT persisted (intentional)
  const setIpMillRows     = fn => setIpDraft(p => ({ ...p, millRows: typeof fn === 'function' ? fn(p.millRows) : fn }))
  const setSuspInputs     = fn => setIpDraft(p => ({ ...p, suspInputs: typeof fn === 'function' ? fn(p.suspInputs) : fn }))
  const setSuspCardMill   = v => setIpDraft(p => ({ ...p, suspCardMill: v }))

  // Brand/type state — stored in draft, not useBrandType hook
  const rmBrand    = rmDraft.brand || ''
  const ipBrand    = ipDraft.brand || ''
  const fgBrand    = fgDraft.brand || ''
  const setRmBrand = v => setRmDraft(p => ({ ...p, brand: v }))
  const setIpBrand = v => setIpDraft(p => ({ ...p, brand: v }))
  const setFgBrand = v => setFgDraft(p => ({ ...p, brand: v }))

  // ── resetKey for FormulaCalculator remounting ──
  const [resetKey, setResetKey] = useState(0)

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

  const setIpMillCell = (idx, field, val) =>
    setIpMillRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: val } : r))

  // ── Suspensibility card inputs (lifted for mill table) ──
  const setSuspInput = useCallback((key, val) =>
    setSuspInputs(prev => ({ ...prev, [key]: val })), [])  // eslint-disable-line react-hooks/exhaustive-deps

  function copySuspToMill() {
    const cardBR = suspInputs.BR ?? ''
    const idx = ipMillRows.findIndex(r => r.mill === suspCardMill)
    if (idx === -1 || !cardBR) return
    setIpMillRows(prev => prev.map((r, i) => i === idx ? { ...r, br: cardBR } : r))
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
    setIpMillRows(prev => prev.map((r, i) => i === idx ? { ...r, br: cardBR } : r))
  }

  const setVal = (id, val) => setValues(p => ({ ...p, [id]: val }))

  function handleTabChange(key) {
    setActiveTab(key)
    setResetKey(k => k + 1)
  }

  function handleReset() {
    setResetKey(k => k + 1)
    if (activeTab === 'rm') {
      clearRmDraft()
    }
    if (activeTab === 'ip') {
      clearIpDraft()
    }
    if (activeTab === 'fg') {
      clearFgDraft()
      setUplMenuOpen(false)
    }
  }

  function handlePrint() {
    printReport({
      activeTab, rmSelected, ipSelected, fgSelected, date, testedBy,
      rmBrand, ipBrand, fgBrand,
      rmSupplierName, rmInvoiceNo, rmBatchNo,
      uplGrade, uplValues,
    })
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
            <FormulaCalculator key={`${f.id}-${resetKey}`} formula={f} />
          ))
        )}

        {/* Additional test dropdown */}
        <div className="qc-dropdown-bar" style={{borderTop: '2px solid #e0dbd4', marginTop: '4px'}}>
          <label className="qc-dropdown-label">Additional Test / अतिरिक्त परीक्षण</label>
          <select className="qc-dropdown" value={ipSelected}
            onChange={e => { setIpSelected(e.target.value); setResetKey(k => k + 1) }}>
            {IN_PROCESS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>

        {test && (
          <>
            <div className="qc-mat-title">{ipLabel}</div>
            {test.tests.map(f => (
              <FormulaCalculator
                key={`${f.id}-${resetKey}-${ipSelected}`}
                formula={f}
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
                        type="number"
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
                        type="number"
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
    const gradeLabel = uplGrade === 'export' ? 'Export Grade' : uplGrade === 'omri' ? 'OMRI Grade' : ''
    const displayLabel = fgBrand
      ? `${product.label} – ${fgBrand}${uplGrade ? ` – UPL Limited (${gradeLabel})` : ''}`
      : `${product.label}${uplGrade ? ` – UPL Limited (${gradeLabel})` : ''}`

    // Group UPL rows by heading
    const uplGroups = uplGrade ? (() => {
      const groups = []
      let cur = null
      UPL_GRADES[uplGrade].forEach(row => {
        if (row.group !== cur) { groups.push({ heading: row.group, rows: [] }); cur = row.group }
        groups[groups.length - 1].rows.push(row)
      })
      return groups
    })() : []

    // WDG tests hidden when UPL grade covers them
    const hiddenTests = uplGrade ? (UPL_GRADES[uplGrade].hideTests ?? []) : []

    return (
      <>
        <DropdownWithBrand
          label="Product / उत्पाद"
          value={fgSelected}
          options={FINISHED_GOODS}
          onChange={v => { setFgSelected(v); setValues({}); setResetKey(k => k + 1); setUplGrade(null); setUplValues({}); setUplMenuOpen(false) }}
          bt={fgBT}
        />

        {/* UPL button — only for Sulphur 80% WDG */}
        {isWDG && (
          <div className="qc-upl-bar" ref={uplBtnRef}>
            {!uplGrade ? (
              /* ── No grade selected: plain toggle button ── */
              <button
                type="button"
                className="qc-upl-btn"
                onClick={() => setUplMenuOpen(o => !o)}
              >
                UPL ▾
              </button>
            ) : (
              /* ── Grade active: label part + separate ✕ part ── */
              <div className="qc-upl-btn-active-wrap">
                <button
                  type="button"
                  className="qc-upl-btn qc-upl-btn-active qc-upl-btn-label"
                  onClick={() => setUplMenuOpen(o => !o)}
                >
                  UPL · {gradeLabel}
                </button>
                <button
                  type="button"
                  className="qc-upl-btn qc-upl-btn-active qc-upl-btn-close"
                  title="Turn off UPL"
                  onClick={() => {
                    if (Object.values(uplValues).some(v => v !== '') &&
                        !window.confirm('Turn off UPL? Existing UPL results will be cleared.')) return
                    setUplGrade(null); setUplValues({}); setUplMenuOpen(false)
                  }}
                >
                  ✕
                </button>
              </div>
            )}
            {uplMenuOpen && (
              <div className="qc-upl-menu">
                {[['export', 'Export Grade'], ['omri', 'OMRI Grade']].map(([g, label]) => (
                  <button
                    key={g}
                    type="button"
                    className={`qc-upl-menu-item${uplGrade === g ? ' qc-upl-menu-item-active' : ''}`}
                    onClick={() => {
                      if (uplGrade === g) {
                        // clicking active grade in menu → turn off
                        if (Object.values(uplValues).some(v => v !== '') &&
                            !window.confirm('Turn off UPL? Existing UPL results will be cleared.')) return
                        setUplGrade(null); setUplValues({})
                      } else {
                        // switch to a different grade
                        if (uplGrade && Object.values(uplValues).some(v => v !== '') &&
                            !window.confirm('Switch UPL grade? Existing UPL results will be cleared.')) return
                        setUplGrade(g); setUplValues({})
                      }
                      setUplMenuOpen(false)
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="qc-mat-title">{displayLabel}</div>

        {product.tests
          .filter(test => !hiddenTests.includes(test.id))
          .map(test => {
          if (test.calcFn) return (
            <FormulaCalculator key={`${test.id}-${resetKey}`} formula={test} />
          )
          if (test.type === 'spec-single') return (
            <div key={test.id} className="qc-single-spec">
              <div className="qc-single-name">{test.name}</div>
              {test.method && <div className="qc-method">{test.method}</div>}
              <div className="qc-input-unit">
                <input type="number" className="qc-input" placeholder="—"
                  value={values[test.id] ?? ''}
                  onChange={e => setVal(test.id, e.target.value)} step="any" min="0" />
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

        {/* UPL Parameters table */}
        {uplGrade && (
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
                        const val    = uplValues[row.id] ?? ''
                        const status = evaluate(val, row.rule)
                        return (
                          <tr key={row.id}>
                            <td>{row.parameter}{row.unit ? ` (${row.unit})` : ''}</td>
                            <td>{row.specDisplay}</td>
                            <td>
                              {row.type === 'complies' ? (
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
                                  type="number"
                                  className="qc-upl-input"
                                  placeholder="—"
                                  step="any"
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

        {/* Overall result — merges WDG rules (minus hidden) + UPL params */}
        <OverallResult results={{
          ...collectFGResults(product, values, hiddenTests),
          ...(uplGrade
            ? Object.fromEntries(
                UPL_GRADES[uplGrade].map(row => [row.id, evaluate(uplValues[row.id] ?? '', row.rule)])
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
            { key: 'fbatch', label: 'Batch No. / बैच नं.', placeholder: 'e.g. 3512',    value: fgBatchNo,   onChange: setFgBatchNo },
            { key: 'ftime',  label: 'Time / समय',          value: fgTime,               onChange: setFgTime, type: 'time' },
          ]
        }
      />

      <div className="qc-content" id="qc-content">
        {activeTab === 'rm' && renderRM()}
        {activeTab === 'ip' && renderIP()}
        {activeTab === 'fg' && renderFG()}
      </div>

      <div className="qc-actions">
        <button type="button" className="qc-print-btn" onClick={handlePrint}>
          Print / Download
        </button>
        <button type="button" className="qc-clear-btn" onClick={handleReset}>
          Reset All / सभी रीसेट करें
        </button>
      </div>

    </div>
  )
}
