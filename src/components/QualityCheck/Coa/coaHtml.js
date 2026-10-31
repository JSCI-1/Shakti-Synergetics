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
import { LOGO_B64 } from './coaLogo.js'

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

  // Column widths matching the reference image (portrait single-batch):
  // table = 72% page width; param ~25%, spec ~45%, result ~30% of table.
  // For multi-batch landscape, keep the existing scaling.
  const colCount = Math.max(cols.length, 1)
  const specColPct  = multi ? 22 : 45
  const paramColPct = multi ? 20 : 25
  const rawDataColPct = Math.max(6, Math.floor((100 - specColPct - paramColPct) / colCount))
  const dataColPct = rawDataColPct
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

  // Signature blocks — left=signatory, right=chemist (no stamp symbol)
  const renderSigBlock = (s) => {
    const labelLines = s.label.split('\n').map(l => `<div class="coa-sign-label">${esc(l)}</div>`).join('')
    return `<div class="coa-sign">
      <div class="coa-sign-line">${fmtVal(header[s.id])}</div>
      ${labelLines}
    </div>`
  }
  const sigBlocks = template.signatureBlocks || []
  const signaturesHtml = sigBlocks.length === 2
    ? `${renderSigBlock(sigBlocks[0])}${renderSigBlock(sigBlocks[1])}`
    : sigBlocks.map(s => renderSigBlock(s)).join('')

  // Optional company name left-aligned above signatures (ADAMA layout).
  const footerCompanyHtml = template.footerCompany
    ? `<div class="coa-footer-company">${esc(template.footerCompany)}</div>`
    : ''

  const remarks = header.remarks !== undefined ? header.remarks : (template.remarksDefault || '')
  const conformity = header.conformity !== undefined ? header.conformity : (template.conformityDefault || '')
  const footer = header.footer !== undefined ? header.footer : (template.footerDefault || '')

  const materialName = header.materialName || template.materialName ||
    (cols[0] && cols[0].product) || ''

  // Title: "CERTIFICATE OF ANALYSIS FOR <MATERIAL>" — reference image style.
  const certTitle = materialName
    ? `CERTIFICATE OF ANALYSIS FOR ${materialName.toUpperCase()}`
    : 'CERTIFICATE OF ANALYSIS'
  const titleHtml = template.hideBatchMeta
    ? `<div class="coa-title">${esc(certTitle)}</div>`
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

  return `<!doctype html><html><head><meta charset="utf-8"><title></title><style>
    @page { size: A4 ${orientation}; margin: 12mm 14mm; }
    /* Chrome/Edge: setting margin-top/bottom removes space for running headers */
    @page { margin: 12mm 14mm 12mm 14mm; }
    html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color:#111; ${fontScale} margin:0; padding:0; }
    .coa-doc { width:100%; }

    /* ── Letterhead ── */
    .coa-letterhead { display:table; width:100%; border-bottom:2px solid #000; padding-bottom:4px; margin-bottom:8px; }
    .coa-lh-factory { display:table-cell; width:21%; vertical-align:middle; font-size:7px; line-height:1.45; text-align:center; color:#222; }
    .coa-lh-logo    { display:table-cell; width:15%; vertical-align:middle; text-align:center; padding:0 6px; }
    .coa-lh-logo img { max-height:80px; max-width:100%; }
    .coa-lh-company { display:table-cell; width:64%; vertical-align:middle; padding-left:8px; }
    .coa-lh-name    { font-size:18px; font-weight:900; letter-spacing:0.3px; line-height:1.1; color:#000; }
    .coa-lh-mfg     { font-size:8.5px; font-weight:700; margin-top:2px; color:#000; }
    .coa-lh-mfg span { text-decoration:none; }
    .coa-lh-office  { font-size:7px; color:#222; line-height:1.45; margin-top:2px; }

    /* ── Title ── */
    .coa-title   { text-align:center; font-size:12px; font-weight:700; margin:10px 0 8px; letter-spacing:0.2px; }
    .coa-sub     { text-align:center; font-size:11px; font-weight:700; margin:0 0 6px; }
    .coa-material{ text-align:center; font-size:10px; margin:0 0 6px; }

    /* ── Header fields — vertical list, bold label fixed 175px ── */
    .coa-hdr { display:flex; flex-direction:column; margin-bottom:8px; margin-left:4px; }
    .coa-hdr-field { display:flex; font-size:10.5px; line-height:1.75; }
    .coa-hdr-label { font-weight:700; min-width:175px; }
    .coa-hdr-val   { font-weight:400; }

    /* ── Batch meta ── */
    .coa-batch-meta { display:flex; flex-wrap:wrap; gap:4px; margin-bottom:6px; }
    .coa-batch-chip { border:1px solid #bbb; border-radius:3px; padding:2px 4px; font-size:8.5px; }

    /* ── Parameter table — 72% width, left-aligned with indent ── */
    .coa-table-wrap { margin:0 auto 0 4px; width:72%; }
    table { width:100%; border-collapse:collapse; table-layout:fixed; }
    th, td { border:1px solid #000; padding:3px 6px; word-wrap:break-word; vertical-align:top; }
    th { background:#fff; font-size:10.5px; font-weight:700; vertical-align:middle; }
    td { font-size:10.5px; }
    .coa-param { text-align:left; width:${paramColPct}%; }
    .coa-spec  { text-align:left; width:${specColPct}%; }
    .coa-final-row td { font-weight:600; }
    .coa-final-label { font-weight:700; }

    /* ── Remarks / conformity ── */
    .coa-remarks    { margin-top:8px; font-size:10.5px; font-style:italic; margin-left:4px; }
    .coa-conformity { margin-top:5px; font-size:10.5px; font-weight:600;   margin-left:4px; }
    .coa-footer     { margin-top:5px; font-size:8.5px;  color:#444; }
    .coa-footer-labels  { display:flex; justify-content:space-between; margin-top:10px; font-size:10.5px; font-weight:700; }
    .coa-footer-company { font-size:10.5px; font-weight:700; margin-top:10px; }

    /* ── Signatures ── */
    .coa-signs    { display:flex; justify-content:space-between; padding:0 8px; margin-top:22px; }
    .coa-sign     { width:44%; }
    .coa-sign-line  { border-top:1px solid #000; padding-top:4px; min-height:14px; font-size:10.5px; font-style:italic; }
    .coa-sign-label { font-size:10px; color:#000; margin-top:2px; }
  </style></head><body>
  <div class="coa-doc">

    <div class="coa-letterhead">
      <div class="coa-lh-factory">
        <div><b>FACTORY :</b></div>
        <div>Plot No. A-20 / 1,</div>
        <div>&amp; B-11 / 9, Phase - 1, M.I.D.C.,</div>
        <div>Dombivli - 421 203. Dist. Thane</div>
        <br/>
        <div>52 KM Stone, Opp. Murthal Haveli,</div>
        <div>Dhaturi - Malikpur, NH-1, Murthal,</div>
        <div>Sonipat, Haryana - 131027</div>
      </div>
      <div class="coa-lh-logo"><img src="${LOGO_B64}" alt="Jaishil Logo" /></div>
      <div class="coa-lh-company">
        <div class="coa-lh-name">JAISHIL SULPHUR &amp;<br/>CHEMICAL INDUSTRIES</div>
        <div class="coa-lh-mfg">Manufacturers of : <span>SULPHUR POWDER &amp; FORMULATIONS.</span></div>
        <div class="coa-lh-office">
          OFFICE : B-202/203, 2nd Floor, Pratik Industrial Estate,<br/>
          Mulund Goregaon Link Road, Near Fortis hospital,<br/>
          Bhandup (West), Mumbai - 400 078. India.<br/>
          Tel. : +91-22-4920 7900 &nbsp;&bull;&nbsp; Web : www.jaishilsulphur.com
        </div>
      </div>
    </div>

    ${titleHtml}
    <div class="coa-hdr">${headerRows}${dispatchRows}</div>
    ${!template.hideBatchMeta && batchMeta ? `<div class="coa-batch-meta">${batchMeta}</div>` : ''}
    <div class="coa-table-wrap">
      <table>
        <thead><tr>
          <th style="width:${paramColPct}%">Parameter</th>
          <th style="width:${specColPct}%">Specification</th>
          ${colHeads}
        </tr></thead>
        <tbody>${tableBody}</tbody>
      </table>
    </div>
    ${!template.hideConformity && conformity ? `<div class="coa-conformity">${esc(conformity)}</div>` : ''}
    ${!template.hideRemarks && remarks ? `<div class="coa-remarks"><b>Remarks:</b> ${esc(remarks)}</div>` : ''}
    ${footerLabelsHtml}
    ${footerCompanyHtml}
    <div class="coa-signs">${signaturesHtml}</div>
    ${footer ? `<div class="coa-footer">${esc(footer)}</div>` : ''}

  </div>
  </body></html>`
}
