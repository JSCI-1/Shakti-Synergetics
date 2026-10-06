import { useState, useRef, useEffect, useCallback } from 'react'
import { RAW_MATERIALS, IN_PROCESS, IN_PROCESS_PINNED, FINISHED_GOODS } from '../../data/qualityData.js'
import { evaluate, calcSuspensibility } from '../../utils/qualityUtils.js'
import { overallResult } from './OverallResult.jsx'
import SpecTable from './SpecTable.jsx'
import FormulaCalculator from './FormulaCalculator.jsx'
import OverallResult from './OverallResult.jsx'
import { supabase, supabaseReady } from '../../supabaseClient.js'
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
                       rmBrand, ipBrand, fgBrand, prodBalance }) {
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

  const materialWithBrand = brand ? `${materialLabel} – ${brand}` : materialLabel

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

  // Production Balance box
  const balBox = content ? content.querySelector('[data-prod-balance]') : null
  if (balBox) {
    const rows = Array.from(balBox.querySelectorAll('.qc-prod-bal-row'))
    const rowsHtml = rows.map(r => {
      const label = r.querySelector('.qc-prod-bal-label')?.textContent.trim() || ''
      const val   = r.querySelector('.qc-prod-bal-value')?.textContent.trim() || '—'
      return `<tr><td style="${TD}">${label}</td><td style="${TD};font-weight:bold">${val}</td></tr>`
    }).join('')
    contentHtml = `<div style="page-break-inside:avoid;margin-bottom:16px;padding:10px;border:2px solid #b85c2c;border-radius:3px;box-sizing:border-box;width:100%">
    <div style="font-weight:bold;font-size:13px;color:#b85c2c;margin-bottom:8px">Dry Slurry Balance / ड्राई स्लरी शेष</div>
    <table style="width:100%;border-collapse:collapse;table-layout:fixed">
      <tr><th style="${TH};width:60%">Item</th><th style="${TH};width:40%">Value</th></tr>
      ${rowsHtml}
    </table>
  </div>` + contentHtml
  }

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
function collectFGResults(product, values) {
  const out = {}
  product.tests.forEach(test => {
    if (test.type === 'spec-single' && test.rule) out[test.id] = evaluate(values[test.id] ?? '', test.rule)
    if (test.type === 'spec-group') test.params.forEach(p => { if (p.rule) out[p.id] = evaluate(values[p.id] ?? '', p.rule) })
    if (test.calcFn && test.rule) out[test.id] = evaluate(values[test.id] ?? '', test.rule)
  })
  return out
}

// ─────────────────────────────────────────────────────────────
// BatchHeader
// ─────────────────────────────────────────────────────────────
function BatchHeader({ date, setDate, dateLabel, testedBy, setTestedBy, extra = [] }) {
  return (
    <div className="qc-batch-bar">
      <div className="qc-batch-field">
        <label className="qc-batch-label">{dateLabel || 'Date / तारीख'}</label>
        <input type="date" className="qc-batch-input" value={date} onChange={e => setDate(e.target.value)} />
      </div>
      <div className="qc-batch-field">
        <label className="qc-batch-label">Tested By / परीक्षक</label>
        <input className="qc-batch-input" placeholder="Name / नाम" value={testedBy} onChange={e => setTestedBy(e.target.value)} />
      </div>
      {extra.map(f => (
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
      ))}
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
function ProductionBalance({ loading, balance, fgUsed, setFgUsed, onSave, saving }) {
  if (loading) return <div className="qc-prod-bal qc-prod-bal-loading">Loading production data…</div>

  const todayTotal    = balance?.todayTotal ?? null
  const prevRemaining = balance?.prevRemaining ?? null
  const prevDate      = balance?.prevDate ?? null
  const fgUsedNum     = parseFloat(fgUsed) || 0
  const todayTotalNum = typeof todayTotal === 'number' ? todayTotal : null
  const remaining     = todayTotalNum !== null ? todayTotalNum - fgUsedNum : null
  const isNegative    = remaining !== null && remaining < 0

  return (
    <div className="qc-prod-bal" data-prod-balance>
      <div className="qc-prod-bal-title">
        Dry Slurry Balance / ड्राई स्लरी शेष
      </div>
      <div className="qc-prod-bal-rows">
        <div className="qc-prod-bal-row">
          <span className="qc-prod-bal-label">
            {prevDate ? `Remaining from ${prevDate}:` : 'Previous balance:'}
          </span>
          <span className="qc-prod-bal-value">
            {prevRemaining !== null ? `${prevRemaining} kg` : '—'}
          </span>
        </div>
        <div className="qc-prod-bal-row">
          <span className="qc-prod-bal-label">Today's total production:</span>
          <span className="qc-prod-bal-value">
            {todayTotal !== null ? `${todayTotal} kg` : 'Not entered yet'}
          </span>
        </div>
        <div className="qc-prod-bal-row">
          <span className="qc-prod-bal-label">FG Today (kg):</span>
          <div className="qc-prod-bal-edit-row">
            <input
              type="number"
              className="qc-prod-bal-input"
              value={fgUsed}
              min="0"
              step="0.01"
              onChange={e => setFgUsed(e.target.value)}
            />
            <button
              type="button"
              className="qc-prod-bal-save-btn"
              onClick={onSave}
              disabled={saving}
            >
              {saving ? '…' : 'Save'}
            </button>
          </div>
        </div>
        <div className={`qc-prod-bal-row qc-prod-bal-remaining ${isNegative ? 'qc-prod-bal-negative' : ''}`}>
          <span className="qc-prod-bal-label">Today's remaining:</span>
          <span className="qc-prod-bal-value">
            {remaining !== null ? `${remaining.toFixed(2)} kg` : '—'}
            {isNegative && <span className="qc-prod-bal-warn"> ⚠ Production less than FG requirement</span>}
          </span>
        </div>
      </div>
    </div>
  )
}

export default function QualityCheck() {
  const [activeTab,  setActiveTab]  = useState('rm')
  const [rmSelected, setRmSelected] = useState(RAW_MATERIALS[0].id)
  const [ipSelected, setIpSelected] = useState(IN_PROCESS[0].id)
  const [fgSelected, setFgSelected] = useState(FINISHED_GOODS[0].id)
  const [values,     setValues]     = useState({})
  const [resetKey,   setResetKey]   = useState(0)
  const [date,       setDate]       = useState('')
  const [testedBy,   setTestedBy]   = useState('')

  // Extra per-section batch fields
  const [rmInvoiceNo, setRmInvoiceNo] = useState('')
  const [rmBatchNo,   setRmBatchNo]   = useState('')
  const [rmTime,      setRmTime]      = useState('')
  const [ipBatchNo,   setIpBatchNo]   = useState('')
  const [ipTime,      setIpTime]      = useState('')
  const [fgBatchNo,   setFgBatchNo]   = useState('')
  const [fgTime,      setFgTime]      = useState('')

  // ── Per-section brand/type ──
  const rmBT = useBrandType()
  const ipBT = useBrandType()
  const fgBT = useBrandType()

  // ── Production Balance (Finished Goods) ──
  const [prodBalance,        setProdBalance]        = useState(null)
  const [prodBalanceLoading, setProdBalanceLoading] = useState(false)
  const [fgUsedEdit,         setFgUsedEdit]         = useState('5')
  const [fgSaving,           setFgSaving]           = useState(false)

  // ── In-Process mill rows ──
  const [ipMillRows, setIpMillRows] = useState(emptyMillRows())

  useEffect(() => {
    if (activeTab !== 'fg' || !supabaseReady) return
    fetchProdBalance()
  }, [activeTab])

  async function fetchProdBalance() {
    setProdBalanceLoading(true)
    const today = new Date().toISOString().slice(0, 10)
    const { data } = await supabase
      .from('daily_production')
      .select('production_date, total_kg, fg_used_kg, remaining_kg')
      .order('production_date', { ascending: false })
      .limit(2)
    setProdBalanceLoading(false)
    if (!data || data.length === 0) { setProdBalance(null); return }
    const todayRow = data.find(r => r.production_date === today)
    const prevRow  = data.find(r => r.production_date !== today) || (todayRow ? null : data[0])
    setProdBalance({
      prevDate:      prevRow?.production_date ?? null,
      prevRemaining: prevRow?.remaining_kg ?? null,
      todayTotal:    todayRow?.total_kg ?? null,
      todayFgUsed:   todayRow?.fg_used_kg ?? 5,
    })
    setFgUsedEdit(String(todayRow?.fg_used_kg ?? 5))
  }

  async function saveFgUsed() {
    if (!supabaseReady) return
    setFgSaving(true)
    const today = new Date().toISOString().slice(0, 10)
    // Always read the current row first to avoid overwriting total_kg with 0
    const { data: existing } = await supabase
      .from('daily_production')
      .select('total_kg')
      .eq('production_date', today)
      .maybeSingle()
    const safeTotalKg = existing?.total_kg ?? prodBalance?.todayTotal ?? 0
    await supabase
      .from('daily_production')
      .upsert(
        {
          production_date: today,
          total_kg: safeTotalKg,
          fg_used_kg: parseFloat(fgUsedEdit) || 5,
        },
        { onConflict: 'production_date' }
      )
    setFgSaving(false)
    fetchProdBalance()
  }

  const setIpMillCell = (idx, field, val) =>
    setIpMillRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: val } : r))

  // ── Suspensibility card inputs (lifted for mill table) ──
  const [suspInputs,  setSuspInputs]  = useState({})
  const [suspCardMill, setSuspCardMill] = useState(IP_MILLS[0])
  const setSuspInput = useCallback((key, val) =>
    setSuspInputs(prev => ({ ...prev, [key]: val })), [])

  function copySuspToMill() {
    const cardBR = suspInputs.BR ?? ''
    const idx = ipMillRows.findIndex(r => r.mill === suspCardMill)
    if (idx === -1 || !cardBR) return
    setIpMillRows(prev => prev.map((r, i) => i === idx ? { ...r, br: cardBR } : r))
  }

  const setVal = (id, val) => setValues(p => ({ ...p, [id]: val }))

  function handleTabChange(key) {
    setActiveTab(key)
    setValues({})
    setResetKey(k => k + 1)
  }

  function handleReset() {
    setValues({})
    setResetKey(k => k + 1)
    if (activeTab === 'rm') { setRmInvoiceNo(''); setRmBatchNo(''); setRmTime(''); rmBT.reset() }
    if (activeTab === 'ip') {
      setIpBatchNo(''); setIpTime('')
      setIpMillRows(emptyMillRows()); setSuspInputs({}); setSuspCardMill(IP_MILLS[0])
    }
    if (activeTab === 'fg') { setFgBatchNo(''); setFgTime(''); fgBT.reset(); fetchProdBalance() }
  }

  function handlePrint() {
    printReport({
      activeTab, rmSelected, ipSelected, fgSelected, date, testedBy,
      rmBrand: rmBT.brand, ipBrand: ipBT.brand, fgBrand: fgBT.brand,
      prodBalance,
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
    const displayLabel = rmBT.brand ? `${mat.label} – ${rmBT.brand}` : mat.label
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
    const ipLabel = test ? (ipBT.brand ? `${test.label} – ${ipBT.brand}` : test.label) : ''
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
    const displayLabel = fgBT.brand ? `${product.label} – ${fgBT.brand}` : product.label
    return (
      <>
        <ProductionBalance
          loading={prodBalanceLoading}
          balance={prodBalance}
          fgUsed={fgUsedEdit}
          setFgUsed={setFgUsedEdit}
          onSave={saveFgUsed}
          saving={fgSaving}
        />
        <DropdownWithBrand
          label="Product / उत्पाद"
          value={fgSelected}
          options={FINISHED_GOODS}
          onChange={v => { setFgSelected(v); setValues({}); setResetKey(k => k + 1) }}
          bt={fgBT}
        />
        <div className="qc-mat-title">{displayLabel}</div>
        {product.tests.map(test => {
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
        <OverallResult results={collectFGResults(product, values)} />
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
        extra={
          activeTab === 'rm' ? [
            { key: 'rinv',   label: 'Invoice No.',          placeholder: 'e.g. INV-001', value: rmInvoiceNo, onChange: setRmInvoiceNo },
            { key: 'rbatch', label: 'Batch No. / बैच नं.', placeholder: 'e.g. 3512',    value: rmBatchNo,   onChange: setRmBatchNo },
            { key: 'rtime',  label: 'Time / समय',          value: rmTime,               onChange: setRmTime, type: 'time' },
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
