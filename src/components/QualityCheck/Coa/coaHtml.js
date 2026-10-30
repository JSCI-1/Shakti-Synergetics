// ═══════════════════════════════════════════════════════════════════════════
// coaHtml — build the COA report HTML from the ACTIVE draft state.
// ---------------------------------------------------------------------------
// ONE builder is used for BOTH the on-screen preview and the print/PDF output,
// so preview == PDF by construction (task §2.3 / §9). Because every value comes
// from resolveValue(draft, entry, fieldId), an edited value REPLACES the loaded
// value in the preview and the PDF — the old value never appears.
//
// Wide multi-batch reports (one column per batch) use landscape orientation and
// table-layout:fixed column scaling so columns are not clipped (task §9).
// ═══════════════════════════════════════════════════════════════════════════

import { resolveValue, resolveParameters, resolveFinalRowValue } from './coaState.js'

function esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Format an ISO date (YYYY-MM-DD) as DD/MM/YYYY for the certificate; leave any
// other value untouched.
function fmtMaybeDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v))
  if (!m) return v
  return `${m[3]}/${m[2]}/${m[1]}`
}

function fmtVal(v) {
  if (v === undefined || v === null || v === '') return '—'
  return esc(fmtMaybeDate(v))
}

// draft, entries (map), template → full standalone HTML document string.
export function buildCoaHtml(draft, entries, template) {
  const order = Array.isArray(draft.batchOrder) ? draft.batchOrder : []
  const cols = order.map(id => entries[id]).filter(Boolean)
  const params = resolveParameters(draft, template)
  const header = (draft && draft.header) || {}
  const multi = (template && template.layout === 'multi') || cols.length > 1
  const orientation = multi ? 'landscape' : 'portrait'

  // Column width scales with batch count so N columns fit the page.
  const colCount = Math.max(cols.length, 1)
  const specColPct = multi ? 26 : 34
  const paramColPct = multi ? 22 : 30
  const dataColPct = Math.max(6, Math.floor((100 - specColPct - paramColPct) / colCount))
  const fontScale = colCount >= 6 ? 'font-size:9px;' : colCount >= 4 ? 'font-size:10px;' : ''

  const headerRows = (template.headerFields || [])
    .filter(f => !f.hideInHeader)
    .map(f => {
      const val = header[f.id] !== undefined ? header[f.id] : (f.defaultValue || '')
      return `<div class="coa-hdr-field"><span class="coa-hdr-label">${esc(f.label)}:</span><span class="coa-hdr-val">${fmtVal(val)}</span></div>`
    })
    .join('')

  const dispatchRows = (template.dispatchFields || [])
    .map(f => `<div class="coa-hdr-field"><span class="coa-hdr-label">${esc(f.label)}:</span><span class="coa-hdr-val">${fmtVal(header[f.id])}</span></div>`)
    .join('')

  // Batch meta row (batch no / product / grade / dryer / mfg date per column).
  const batchMeta = cols.map(e => `
    <div class="coa-batch-chip">
      <div><b>Batch:</b> ${esc(e.batchNo || '—')}</div>
      <div><b>Product:</b> ${esc(e.product || '—')}</div>
      <div><b>Grade:</b> ${esc(e.grade || '—')} &nbsp; <b>Dryer:</b> ${esc(e.dryer || '—')}</div>
      <div><b>Mfg:</b> ${e.logDate ? esc(fmtMaybeDate(e.logDate)) : '—'}</div>
    </div>`).join('')

  const colHeads = cols.map(e =>
    `<th style="width:${dataColPct}%">${template.coaStyle === 'yellowstone' ? 'Results of Analysis' : esc(e.batchNo || '—')}</th>`).join('')

  const bodyRows = params.map(p => {
    const dataCells = cols.map(e => `<td>${fmtVal(resolveValue(draft, e, p.id, p.sourceKey))}</td>`).join('')
    return `<tr>
      <td class="coa-param">${esc(p.parameter || '')}</td>
      <td class="coa-spec">${esc(p.specDisplay || '')}${p.unit ? ' ' + esc(p.unit) : ''}</td>
      ${dataCells}
    </tr>`
  }).join('')

  // Final rows (OMRI: Manufacturing Date / Exp Date / QTY) — one cell per batch.
  const finalRowsHtml = (template.finalRows || []).map(row => {
    const dataCells = cols.map(e => `<td>${fmtVal(resolveFinalRowValue(draft, e, row.id))}</td>`).join('')
    return `<tr class="coa-final-row">
      <td class="coa-param coa-final-label">${esc(row.label)}</td>
      <td class="coa-spec"></td>
      ${dataCells}
    </tr>`
  }).join('')

  const tableBody = (bodyRows + finalRowsHtml) || `<tr><td colspan="${cols.length + 2}">No parameters configured for this party.</td></tr>`

  // Signatures: 2 blocks → left + right pushed to edges; 3+ → evenly spaced.
  // Labels containing \n are split into multiple sub-label lines.
  const renderSigBlock = (s) => {
    const labelLines = s.label.split('\n').map(l => `<div class="coa-sign-label">${esc(l)}</div>`).join('')
    return `<div class="coa-sign"><div class="coa-sign-line">${fmtVal(header[s.id])}</div>${labelLines}</div>`
  }
  const sigBlocks = template.signatureBlocks || []
  const signaturesHtml = sigBlocks.length === 2
    ? `${renderSigBlock(sigBlocks[0])}${renderSigBlock(sigBlocks[1])}`
    : sigBlocks.map(renderSigBlock).join('')

  // Optional company name left-aligned above signatures (ADAMA layout).
  const footerCompanyHtml = template.footerCompany
    ? `<div class="coa-footer-company">${esc(template.footerCompany)}</div>`
    : ''

  const remarks = header.remarks !== undefined ? header.remarks : (template.remarksDefault || '')
  const conformity = header.conformity !== undefined ? header.conformity : (template.conformityDefault || '')
  const footer = header.footer !== undefined ? header.footer : (template.footerDefault || '')

  const materialName = header.materialName || template.materialName ||
    (cols[0] && cols[0].product) || ''

  // Title layout:
  //  - hideBatchMeta: "CERTIFICATE OF ANALYSIS" centered (all new-layout parties).
  //  - default: company name + "CERTIFICATE OF ANALYSIS" subtitle.
  const titleHtml = template.hideBatchMeta
    ? `<div class="coa-title" style="margin-bottom:24px;">CERTIFICATE OF ANALYSIS</div>`
    : `<div class="coa-title">${esc(header.companyHeading || template.name || '')}</div>
       <div class="coa-sub">CERTIFICATE OF ANALYSIS</div>
       ${materialName ? `<div class="coa-material">${esc(materialName)}</div>` : ''}`

  // Optional footer labels row above the signature lines (e.g. AUTHORISED
  // SIGNATORY / CHECKED BY for UPL Export).
  const footerLabelsHtml = (template.footerLabels || []).map(row =>
    `<div class="coa-footer-labels">
      <span class="coa-footer-label-left">${esc(row.left || '')}</span>
      <span class="coa-footer-label-right">${esc(row.right || '')}</span>
    </div>`
  ).join('')

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4 ${orientation}; margin: 12mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color:#111; ${fontScale} }
    .coa-doc { width:100%; }
    .coa-title { text-align:center; font-size:16px; font-weight:700; margin:0 0 2px; }
    .coa-sub { text-align:center; font-size:13px; font-weight:600; margin:0 0 10px; }
    .coa-material { text-align:center; font-size:12px; margin:0 0 12px; }
    .coa-hdr { display:flex; flex-wrap:wrap; gap:4px 24px; margin-bottom:10px; }
    .coa-hdr-field { min-width:45%; display:flex; gap:6px; font-size:11px; }
    .coa-hdr-field-ys { min-width:100%; display:flex; gap:16px; font-size:11px; }
    .coa-hdr-field-ys .coa-hdr-label { min-width:160px; }
    .coa-hdr-label { font-weight:700; }
    .coa-batch-meta { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:10px; }
    .coa-batch-chip { border:1px solid #bbb; border-radius:4px; padding:4px 8px; font-size:10px; }
    table { width:100%; border-collapse:collapse; table-layout:fixed; }
    th, td { border:1px solid #333; padding:4px 6px; word-wrap:break-word; vertical-align:top; }
    th { background:#f0f0f0; font-size:11px; }
    td { font-size:11px; }
    .coa-param { text-align:left; }
    .coa-spec { text-align:left; width:${specColPct}%; }
    .coa-param { width:${paramColPct}%; }
    .coa-final-row td { font-weight:600; }
    .coa-final-label { font-weight:700; }
    .coa-remarks { margin-top:10px; font-size:11px; }
    .coa-conformity { margin-top:8px; font-size:11px; font-weight:600; }
    .coa-footer { margin-top:14px; font-size:10px; color:#444; }
    .coa-footer-labels { display:flex; justify-content:space-between; margin-top:28px; font-size:11px; font-weight:700; }
    .coa-footer-label-left {}
    .coa-footer-label-right {}
    .coa-footer-company { font-size:11px; font-weight:700; margin-top:28px; }
    .coa-signs { display:flex; justify-content:space-between; margin-top:28px; padding:0 32px; }
    .coa-sign { width:28%; }
    .coa-sign-line { border-top:1px solid #333; padding-top:4px; min-height:18px; font-size:11px; }
    .coa-sign-label { font-size:10px; color:#555; margin-top:2px; }
  </style></head><body>
  <div class="coa-doc">
    ${titleHtml}
    <div class="coa-hdr">${headerRows}${dispatchRows}</div>
    ${!template.hideBatchMeta && batchMeta ? `<div class="coa-batch-meta">${batchMeta}</div>` : ''}
    <table>
      <thead><tr>
        <th style="width:${paramColPct}%">Parameter</th>
        <th style="width:${specColPct}%">Specification</th>
        ${colHeads}
      </tr></thead>
      <tbody>${tableBody}</tbody>
    </table>
    ${!template.hideConformity && conformity ? `<div class="coa-conformity">${esc(conformity)}</div>` : ''}
    ${!template.hideRemarks && remarks ? `<div class="coa-remarks"><b>Remarks:</b> ${esc(remarks)}</div>` : ''}
    ${footerLabelsHtml}
    ${footerCompanyHtml}
    <div class="coa-signs">${signaturesHtml}</div>
    ${footer ? `<div class="coa-footer">${esc(footer)}</div>` : ''}
  </div>
  </body></html>`
}
