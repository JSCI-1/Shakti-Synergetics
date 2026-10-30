// ═══════════════════════════════════════════════════════════════════════════
// CoaSection — the editable, multi-batch Certificate of Analysis workspace.
// ---------------------------------------------------------------------------
// Sits beside Finished Goods inside Quality Control (QualityCheck activeTab
// 'coa'). Flow: pick a party → create/open a draft → add one or more batches
// (with disambiguation) → edit header + per-batch result cells → preview →
// finalize → print/download. The DRAFT is the single source of truth for the
// active report; an edit REPLACES the previous value everywhere (editable grid,
// preview and PDF all read resolveValue()).
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabaseReady } from '../../../supabaseClient.js'
import { COA_PARTIES, getCoaTemplate, buildSpecSnapshot } from '../../../data/coaTemplates.js'
import {
  resolveValue, applyBatchEdit, applyHeaderEdit, syncDates,
  resolveParameters, initParameters, applyParameterEdit, addParameter,
  removeParameter, reorderParameter, resolveFinalRowValue,
} from './coaState.js'
import { buildCoaHtml } from './coaHtml.js'
import { useCoaDraft } from './useCoaDraft.js'
import {
  createCoaDraft, insertBatchEntry, deleteBatchEntry, finalizeCoa,
} from './coaService.js'
import CoaBatchPicker from './CoaBatchPicker.jsx'
import './CoaSection.css'

export default function CoaSection({ user }) {
  const userName = user?.name || ''
  const isAdmin = user?.role === 'admin'
  const [partyKey, setPartyKey] = useState('')
  const [draftId, setDraftId] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)

  const template = partyKey ? getCoaTemplate(partyKey) : null

  const {
    draft, setDraft, entries, setEntries,
    conflicts, status, finalizedByOther, revRef, flush,
  } = useCoaDraft({ draftId, userName })

  const cols = useMemo(
    () => (draft?.batchOrder || []).map(id => entries[id]).filter(Boolean),
    [draft, entries],
  )

  // ── OMRI: ensure the draft carries its own editable parameter copy ──
  // Stored inside header.coa_parameters so it persists through the existing
  // header JSONB column (no schema migration). Initialised once from the
  // template's static array; after that the draft copy is the source of truth.
  useEffect(() => {
    if (draft && template?.editableParameters && !Array.isArray(draft.header?.coa_parameters)) {
      setDraft(prev => initParameters(prev, template))
    }
  }, [draft, template, setDraft])

  // ── Parameter edit handlers (OMRI editable table) ──
  const editParam = useCallback((paramId, fieldId, value) => {
    setDraft(prev => applyParameterEdit(prev, paramId, fieldId, value))
  }, [setDraft])

  const handleAddParam = useCallback(() => {
    setDraft(prev => addParameter(prev))
  }, [setDraft])

  const handleRemoveParam = useCallback((paramId) => {
    setDraft(prev => removeParameter(prev, paramId))
  }, [setDraft])

  const handleReorderParam = useCallback((paramId, dir) => {
    setDraft(prev => reorderParameter(prev, paramId, dir))
  }, [setDraft])

  // ── Start a draft for the chosen party ──
  const startDraft = useCallback(async () => {
    if (!partyKey) { setNotice('Select a party first.'); return }
    if (!supabaseReady) { setNotice('Database not configured.'); return }
    setBusy(true); setNotice('')
    try {
      const spec = buildSpecSnapshot(template)
      // For OMRI (editableParameters), seed the header with a copy of the
      // template's parameter array so it is immediately editable + persistable.
      const initialHeader = template?.editableParameters
        ? { coa_parameters: (template.parameters || []).map(p => ({ ...p })) }
        : {}
      const id = await createCoaDraft({
        partyKey, templateVersion: template?.needsTranscription ? 1 : 1,
        product: null, specSnapshot: spec, userName, initialHeader,
      })
      if (!id) { setNotice('Could not create the draft.'); return }
      setDraftId(id)
    } finally { setBusy(false) }
  }, [partyKey, template, userName])

  // ── Add a batch (from the picker's disambiguated candidate) ──
  const handleAddBatch = useCallback(async (candidate) => {
    if (!draft || !draftId) return
    setBusy(true); setNotice('')
    try {
      const pos = (draft.batchOrder || []).length
      const { entry, duplicate, error } = await insertBatchEntry(draftId, candidate, pos)
      if (duplicate) { setNotice('That batch column already exists — not added again.'); return }
      if (error || !entry) { setNotice('Could not add the batch.'); return }
      // Update local state WITHOUT reloading the whole draft (preserves edits).
      const nextEntries = { ...entries, [entry.id]: entry }
      setEntries(nextEntries)
      setDraft(prev => {
        const withBatch = { ...prev, batchOrder: [...(prev.batchOrder || []), entry.id] }
        // Auto-fill Manufacturing Date (from the batch's FG record) + Expiry
        // (+2 years), without clobbering an operator-edited value.
        return syncDates(withBatch, nextEntries)
      })
      // Persist the new batch order (+ derived dates) via the version-checked save.
      await flush()
    } finally { setBusy(false) }
  }, [draft, draftId, setDraft, setEntries, flush])

  // ── Remove a batch (preserves all other edits) ──
  const handleRemoveBatch = useCallback(async (entryId) => {
    if (!draft || finalizedByOther) return
    setBusy(true); setNotice('')
    try {
      const ok = await deleteBatchEntry(entryId)
      if (!ok) { setNotice('Could not remove the batch.'); return }
      const nextEntries = { ...entries }
      delete nextEntries[entryId]
      setEntries(nextEntries)
      setDraft(prev => {
        const nextEdited = { ...(prev.editedValues || {}) }
        delete nextEdited[entryId]
        const next = { ...prev, editedValues: nextEdited, batchOrder: (prev.batchOrder || []).filter(id => id !== entryId) }
        // Recompute derived dates against the remaining batches.
        return syncDates(next, nextEntries)
      })
      await flush()
    } finally { setBusy(false) }
  }, [draft, finalizedByOther, setDraft, setEntries, flush])

  // ── Edit handlers (REPLACE in place) ──
  const editCell = useCallback((entryId, fieldId, value) => {
    setDraft(prev => applyBatchEdit(prev, entryId, fieldId, value))
  }, [setDraft])

  const editHeader = useCallback((fieldId, value) => {
    setDraft(prev => applyHeaderEdit(prev, fieldId, value))
  }, [setDraft])

  // ── Preview / Print (shared HTML builder → preview == PDF) ──
  const html = useMemo(
    () => (draft && template ? buildCoaHtml(draft, entries, template) : ''),
    [draft, entries, template],
  )

  const handlePrint = useCallback(async () => {
    // Flush the latest edit so the PDF uses the newest saved revision.
    await flush()
    const w = window.open('', '_blank')
    if (!w) { setNotice('Allow pop-ups to print/download the PDF.'); return }
    w.document.open(); w.document.write(html); w.document.close()
    w.focus()
    // Let layout settle, then open the print (Save-as-PDF) dialog.
    setTimeout(() => { try { w.print() } catch { /* user cancelled */ } }, 300)
  }, [flush, html])

  const handleFinalize = useCallback(async () => {
    if (!draft || !draftId) return
    if ((draft.batchOrder || []).length === 0) { setNotice('Add at least one batch before finalizing.'); return }
    // Parties whose header does NOT show a certificate_no field (e.g. OMRI)
    // auto-generate one at finalize so the issued record is still unique.
    const hasCertNoField = (template?.headerFields || []).some(f => f.id === 'certificate_no')
    const certNo = (draft.header?.certificate_no || '').trim()
      || (!hasCertNoField ? `COA-${(partyKey || 'X').toUpperCase()}-${draftId.slice(-8)}` : '')
    if (!certNo) { setNotice('Enter a Certificate No. before finalizing.'); return }
    setBusy(true); setNotice('')
    try {
      await flush()
      const snapshot = { header: draft.header, editedValues: draft.editedValues, batchOrder: draft.batchOrder, specSnapshot: draft.specSnapshot, entries, html }
      const { issued, error, duplicate } = await finalizeCoa({
        draftId, certificateNo: certNo, partyKey, templateVersion: draft.templateVersion,
        snapshot, userName,
      })
      if (error) { setNotice('Finalization failed.'); return }
      setNotice(duplicate
        ? `Certificate ${certNo} was already issued — no duplicate created.`
        : `Certificate ${certNo} issued and locked.`)
    } finally { setBusy(false) }
  }, [draft, draftId, partyKey, template, userName, entries, html, flush])

  // ── Render ──
  if (!supabaseReady) {
    return <div className="coa-wrap"><div className="coa-picker-msg">Database not configured — COA needs a Supabase connection.</div></div>
  }

  return (
    <div className="coa-wrap">
      {/* Party selector + start */}
      <div className="coa-party-bar">
        <label className="coa-label">Party / पक्ष</label>
        <select className="coa-input" value={partyKey}
          onChange={e => {
            const next = e.target.value
            if (next !== partyKey && draftId) {
              // Switching party abandons the current in-progress draft.
              setDraftId('')
              setDraft(null)
              setEntries({})
              setNotice('')
            }
            setPartyKey(next)
          }}>
          <option value="">— Select party —</option>
          {COA_PARTIES.map((p, i) => (
            <option key={p.key} value={p.key}>{i + 1}. {p.name}</option>
          ))}
        </select>
        {!draftId && (
          <button type="button" className="coa-btn" onClick={startDraft} disabled={busy || !partyKey}>
            Start COA
          </button>
        )}
        {status && <span className={`coa-status coa-status-${status}`}>{status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved ✓' : 'Save failed — retrying'}</span>}
      </div>

      {template?.needsTranscription && (
        <div className="coa-warn">
          The <b>{template.name}</b> template has not been transcribed from its reference image yet,
          so its parameters/specifications are not available. Add the template config in
          <code> src/data/coaTemplates.js</code> before issuing this party's COA. Values will not be invented.
        </div>
      )}

      {notice && <div className="coa-picker-msg">{notice}</div>}

      {draftId && draft && (
        <>
          {finalizedByOther && (
            <div className="coa-warn" role="alert">
              This certificate has been finalized and is locked against further editing.
            </div>
          )}

          {/* Batch picker */}
          <div className="coa-section-card">
            <div className="coa-section-title">Batches</div>
            <CoaBatchPicker onAdd={handleAddBatch} disabled={busy || finalizedByOther} />
            {cols.length > 0 && (
              <div className="coa-batch-chips">
                {cols.map(e => (
                  <div key={e.id} className="coa-chip">
                    <span>{template.hideBatchMeta
                      ? e.batchNo
                      : `${e.batchNo} · ${e.product || '—'} · ${e.grade || '—'} · ${e.logDate || '—'} · ${e.dryer || '—'}`}</span>
                    {!finalizedByOther && (
                      <button type="button" className="coa-chip-x" title="Remove batch"
                        onClick={() => handleRemoveBatch(e.id)} disabled={busy}>×</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Editable header fields */}
          <div className="coa-section-card">
            <div className="coa-section-title">Certificate Header</div>
            <div className="coa-fields-grid">
              {[...(template.headerFields || []), ...(template.dispatchFields || [])].map(f => (
                <label key={f.id} className="coa-field">
                  <span className="coa-field-label">
                    {f.label}
                    {f.auto && <span className="coa-field-hint">auto</span>}
                  </span>
                  <input
                    className="coa-input"
                    type={f.type === 'date' ? 'date' : 'text'}
                    value={draft.header?.[f.id] ?? f.defaultValue ?? ''}
                    disabled={finalizedByOther}
                    onChange={e => editHeader(f.id, e.target.value)}
                  />
                </label>
              ))}
            </div>
          </div>

          {/* Editable result grid (one column per batch) */}
          {cols.length > 0 && (resolveParameters(draft, template).length > 0 || template.editableParameters) && (
            <div className="coa-section-card">
              <div className="coa-section-title">Results</div>
              {resolveParameters(draft, template).length > 0 && (
                <div className="coa-grid-scroll">
                  <table className="coa-grid">
                    <thead>
                      <tr>
                        <th>Parameter</th><th>Specification</th>
                        {cols.map(e => <th key={e.id}>{template.coaStyle === 'yellowstone' ? 'Results of Analysis' : e.batchNo}</th>)}
                        {template.editableParameters && !finalizedByOther && <th className="coa-grid-actions-h"></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {resolveParameters(draft, template).map((p) => (
                        <tr key={p.id}>
                          <td className="coa-grid-param">
                            {template.editableParameters && !finalizedByOther ? (
                              <input className="coa-cell" value={p.parameter || ''}
                                onChange={ev => editParam(p.id, 'parameter', ev.target.value)} />
                            ) : (
                              p.parameter
                            )}
                          </td>
                          <td className="coa-grid-spec">
                            {template.editableParameters && !finalizedByOther ? (
                              <input className="coa-cell" value={p.specDisplay || ''}
                                onChange={ev => editParam(p.id, 'specDisplay', ev.target.value)} />
                            ) : (
                              <>{p.specDisplay}{p.unit ? ` ${p.unit}` : ''}</>
                            )}
                          </td>
                          {cols.map(e => (
                            <td key={e.id}>
                              <input className="coa-cell" disabled={finalizedByOther}
                                value={resolveValue(draft, e, p.id, p.sourceKey) ?? ''}
                                onChange={ev => editCell(e.id, p.id, ev.target.value)} />
                            </td>
                          ))}
                          {template.editableParameters && !finalizedByOther && (
                            <td className="coa-grid-actions">
                              <button type="button" className="coa-grid-btn coa-grid-btn-del" title="Delete row"
                                onClick={() => handleRemoveParam(p.id)}>✕</button>
                            </td>
                          )}
                        </tr>
                      ))}
                      {/* Final rows (OMRI: Mfg Date / Exp Date / QTY per batch) */}
                      {(template.finalRows || []).map(row => (
                        <tr key={'final_' + row.id} className="coa-final-row">
                          <td className="coa-grid-param coa-final-label">{row.label}</td>
                          <td className="coa-grid-spec"></td>
                          {cols.map(e => (
                            <td key={e.id}>
                              <input className="coa-cell" type={row.type === 'date' ? 'date' : 'text'}
                                disabled={finalizedByOther}
                                value={resolveFinalRowValue(draft, e, row.id) ?? ''}
                                onChange={ev => editCell(e.id, row.id, ev.target.value)} />
                            </td>
                          ))}
                          {template.editableParameters && !finalizedByOther && <td className="coa-grid-actions"></td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {template.editableParameters && !finalizedByOther && (
                <button type="button" className="coa-btn coa-btn-sm coa-add-param" onClick={handleAddParam}>
                  + Add Parameter
                </button>
              )}
            </div>
          )}

          {/* Remarks / conformity / signatures (OMRI hides remarks + conformity) */}
          <div className="coa-section-card">
            <div className="coa-section-title">
              {template.hideRemarks && template.hideConformity ? 'Signatures' : 'Remarks & Signatures'}
            </div>
            {!template.hideRemarks && (
              <label className="coa-field coa-field-wide">
                <span className="coa-field-label">Remarks</span>
                <textarea className="coa-input" rows={2} disabled={finalizedByOther}
                  value={draft.header?.remarks ?? template.remarksDefault ?? ''}
                  onChange={e => editHeader('remarks', e.target.value)} />
              </label>
            )}
            {!template.hideConformity && (
              <label className="coa-field coa-field-wide">
                <span className="coa-field-label">Conformity Statement</span>
                <textarea className="coa-input" rows={2} disabled={finalizedByOther}
                  value={draft.header?.conformity ?? template.conformityDefault ?? ''}
                  onChange={e => editHeader('conformity', e.target.value)} />
              </label>
            )}
            <div className="coa-fields-grid">
              {(template.signatureBlocks || []).map(s => {
                const locked = finalizedByOther || (s.role === 'admin' && !isAdmin)
                return (
                  <label key={s.id} className="coa-field">
                    <span className="coa-field-label">
                      {s.label}{s.role === 'admin' && !isAdmin ? ' (admin only)' : ''}
                    </span>
                    <input className="coa-input" value={draft.header?.[s.id] ?? ''} disabled={locked}
                      onChange={e => editHeader(s.id, e.target.value)} />
                  </label>
                )
              })}
            </div>
          </div>

          {Object.keys(conflicts).length > 0 && (
            <div className="coa-warn" role="alert">
              Another operator edited this certificate. Latest server values were merged;
              review the highlighted fields before finalizing.
            </div>
          )}

          {/* Actions */}
          <div className="coa-actions">
            <button type="button" className="coa-btn" onClick={() => setPreviewOpen(v => !v)}>
              {previewOpen ? 'Hide Preview' : 'Preview'}
            </button>
            <button type="button" className="coa-btn" onClick={handlePrint} disabled={cols.length === 0}>
              Print / Download PDF
            </button>
            {!template.hideFinalize && (
              <button type="button" className="coa-btn coa-btn-primary" onClick={handleFinalize}
                disabled={busy || finalizedByOther || cols.length === 0}>
                Finalize
              </button>
            )}
          </div>

          {previewOpen && (
            <div className="coa-preview">
              <iframe title="COA preview" className="coa-preview-frame" srcDoc={html} />
            </div>
          )}
        </>
      )}
    </div>
  )
}
