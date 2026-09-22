import React, { useState } from 'react'
import { supabase, supabaseReady } from '../supabaseClient'
import './SlurrySection.css'

// ── Default input rows from the physical form ──
const DEFAULT_INPUTS = [
  { name: 'SULPHUR',    name_hi: 'सल्फर'       },
  { name: 'LIGNO-A',   name_hi: 'लिग्नो-A'    },
  { name: 'LIGNO-B',   name_hi: 'लिग्नो-B'    },
  { name: 'FBPP',      name_hi: 'FBPP'         },
  { name: 'DN Powder', name_hi: 'DN पाउडर'    },
  { name: 'FZ 1',      name_hi: 'FZ 1'         },
  { name: 'DEFOMER',   name_hi: 'डिफोमर'      },
  { name: 'CHINA CLAY',name_hi: 'चाइना क्ले'  },
  { name: 'WATER',     name_hi: 'पानी'         },
]

const BATCHES = ['Batch-1','Batch-2','Batch-3','Batch-4','Batch-5',
                 'Batch-6','Batch-7','Batch-8','Batch-9','Batch-10']

const MILLS = ['V1','V2','V3','V4','V5','V6','V7','H1']

function emptyInputRow(name = '', name_hi = '') {
  return {
    id: Date.now() + Math.random(),
    input_name: name,
    input_name_hi: name_hi,
    origin_rm_batch: '',
    batches: Array(10).fill(''),
  }
}

function emptyMillRow(mill) {
  return { mill, flow_rate: '', rated_time: '', current_amp: '', zirconia_beads: '' }
}

function emptyForm() {
  return {
    batch_no: '',
    date: '',
    shift1_operator: '',
    shift2_operator: '',
    input_rows: DEFAULT_INPUTS.map(r => emptyInputRow(r.name, r.name_hi)),
    mills: MILLS.map(m => emptyMillRow(m)),
    total_wt: '',
    suspension1: '',
    suspension2: '',
    remark: '',
    operator: '',
    supervisor: '',
    manager: '',
  }
}

export default function SlurrySection() {
  const [form, setForm]   = useState(emptyForm())
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)
  const [error, setError]   = useState('')

  // ── Field setters ──
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const setInputRow = (idx, field, val) =>
    setForm(p => ({
      ...p,
      input_rows: p.input_rows.map((r, i) => i === idx ? { ...r, [field]: val } : r),
    }))

  const setInputBatch = (rowIdx, batchIdx, val) =>
    setForm(p => ({
      ...p,
      input_rows: p.input_rows.map((r, i) =>
        i === rowIdx
          ? { ...r, batches: r.batches.map((b, bi) => bi === batchIdx ? val : b) }
          : r
      ),
    }))

  const setMill = (idx, field, val) =>
    setForm(p => ({
      ...p,
      mills: p.mills.map((m, i) => i === idx ? { ...m, [field]: val } : m),
    }))

  // ── Add / Remove dynamic rows ──
  function addInputRow() {
    setForm(p => ({
      ...p,
      input_rows: [...p.input_rows, emptyInputRow()],
    }))
  }

  function removeInputRow(idx) {
    setForm(p => ({
      ...p,
      input_rows: p.input_rows.filter((_, i) => i !== idx),
    }))
  }

  // ── Save to Supabase ──
  async function handleSubmit(e) {
    e.preventDefault()
    if (!supabaseReady) { setError('Supabase not configured.'); return }
    setSaving(true); setError(''); setSaved(false)
    const { error: err } = await supabase.from('slurry_job_cards').insert([{
      batch_no:        form.batch_no,
      date:            form.date || null,
      shift1_operator: form.shift1_operator,
      shift2_operator: form.shift2_operator,
      input_rows:      form.input_rows,
      mills:           form.mills,
      total_wt:        form.total_wt ? parseFloat(form.total_wt) : null,
      suspension1:     form.suspension1,
      suspension2:     form.suspension2,
      remark:          form.remark,
      operator:        form.operator,
      supervisor:      form.supervisor,
      manager:         form.manager,
    }])
    setSaving(false)
    if (err) setError(err.message)
    else { setSaved(true); setForm(emptyForm()) }
  }

  return (
    <div className="sl-wrapper">

      {/* ── Title ── */}
      <div className="sl-title-bar">
        <div className="sl-title-main">Slurry Section</div>
        <div className="sl-title-sub">
          Sulphur 80% W.D.G. — Process Job Card &nbsp;|&nbsp;
          <span className="sl-title-hi">स्लरी सेक्शन — सल्फर 80% प्रोसेस जॉब कार्ड</span>
        </div>
      </div>

      <form className="sl-form" onSubmit={handleSubmit}>

        {/* ══ ROW 1: Batch No + Date + Shift ══ */}
        <div className="sl-meta-bar">
          <div className="sl-meta-field">
            <label className="sl-label">
              Batch No. / <span className="hi">बैच नं.</span>
            </label>
            <input className="sl-input" placeholder="e.g. 3512-3521"
              value={form.batch_no} onChange={e => set('batch_no', e.target.value)} />
          </div>
          <div className="sl-meta-field">
            <label className="sl-label">
              Date / <span className="hi">तारीख</span>
            </label>
            <input type="date" className="sl-input"
              value={form.date} onChange={e => set('date', e.target.value)} />
          </div>
          <div className="sl-meta-field">
            <label className="sl-label">
              Shift 1st Operator / <span className="hi">पहली पाली ऑपरेटर</span>
            </label>
            <input className="sl-input" placeholder="Operator name"
              value={form.shift1_operator} onChange={e => set('shift1_operator', e.target.value)} />
          </div>
          <div className="sl-meta-field">
            <label className="sl-label">
              Shift 2nd Operator / <span className="hi">दूसरी पाली ऑपरेटर</span>
            </label>
            <input className="sl-input" placeholder="Operator name"
              value={form.shift2_operator} onChange={e => set('shift2_operator', e.target.value)} />
          </div>
        </div>

        {/* ══ INPUTS TABLE ══ */}
        <div className="sl-section-title">
          Inputs (kg) / <span className="hi">इनपुट (किग्रा)</span>
        </div>
        <div className="sl-table-scroll">
          <table className="sl-table">
            <thead>
              <tr>
                <th className="sl-th-input">
                  Inputs<br /><span className="hi">इनपुट</span>
                </th>
                <th className="sl-th-origin">
                  Origin / RM Batch No.<br /><span className="hi">उद्गम / RM बैच नं.</span>
                </th>
                {BATCHES.map(b => (
                  <th key={b} className="sl-th-batch">{b}</th>
                ))}
                <th className="sl-th-action"></th>
              </tr>
            </thead>
            <tbody>
              {form.input_rows.map((row, ri) => (
                <tr key={row.id} className={ri % 2 === 0 ? '' : 'sl-tr-alt'}>
                  <td className="sl-td-input">
                    <input className="sl-input-cell" placeholder="Input name"
                      value={row.input_name}
                      onChange={e => setInputRow(ri, 'input_name', e.target.value)} />
                    <input className="sl-input-cell sl-input-hindi" placeholder="हिंदी नाम"
                      value={row.input_name_hi}
                      onChange={e => setInputRow(ri, 'input_name_hi', e.target.value)} />
                  </td>
                  <td className="sl-td-origin">
                    <input className="sl-input-cell"
                      placeholder="RM / Origin"
                      value={row.origin_rm_batch}
                      onChange={e => setInputRow(ri, 'origin_rm_batch', e.target.value)} />
                  </td>
                  {row.batches.map((val, bi) => (
                    <td key={bi} className="sl-td-batch">
                      <input type="number" className="sl-input-num"
                        placeholder="—"
                        value={val}
                        onChange={e => setInputBatch(ri, bi, e.target.value)} />
                    </td>
                  ))}
                  <td className="sl-td-action">
                    {form.input_rows.length > 1 && (
                      <button type="button" className="sl-remove-btn"
                        onClick={() => removeInputRow(ri)} title="Remove row">
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              ))}

              {/* TOTAL WT row */}
              <tr className="sl-total-row">
                <td colSpan={2} className="sl-total-label">
                  TOTAL WT. / <span className="hi">कुल वजन</span>
                </td>
                {Array(10).fill(null).map((_, bi) => {
                  const colTotal = form.input_rows.reduce(
                    (sum, r) => sum + (parseFloat(r.batches[bi]) || 0), 0
                  )
                  return (
                    <td key={bi} className="sl-td-batch sl-total-val">
                      {colTotal > 0 ? colTotal : ''}
                    </td>
                  )
                })}
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* ── Add Row button ── */}
        <div className="sl-add-row-bar">
          <button type="button" className="sl-add-btn" onClick={addInputRow}>
            + Add Input Row / <span className="hi">इनपुट पंक्ति जोड़ें</span>
          </button>
        </div>

        {/* ══ BOTTOM SPLIT: Sand Milling + Suspension/Remark ══ */}
        <div className="sl-bottom-split">

          {/* Sand Milling Details */}
          <div className="sl-milling-block">
            <div className="sl-section-title">
              Sand Milling Details / <span className="hi">सैंड मिलिंग विवरण</span>
            </div>
            <table className="sl-mill-table">
              <thead>
                <tr>
                  <th>Mill No.</th>
                  <th>Flow Rate<br /><span className="hi">प्रवाह दर</span><br /><small>(L/Sec)</small></th>
                  <th>Rated Time<br /><span className="hi">रेटेड समय</span></th>
                  <th>Current Amp<br /><span className="hi">करंट एम्प</span></th>
                  <th>Zirconia Beads (kg)<br /><span className="hi">जिरकोनिया बीड्स</span></th>
                </tr>
              </thead>
              <tbody>
                {form.mills.map((mill, mi) => (
                  <tr key={mill.mill} className={mi % 2 === 0 ? '' : 'sl-tr-alt'}>
                    <td className="sl-mill-name">Mill No. {mill.mill}</td>
                    <td><input type="number" className="sl-input-num-wide" placeholder="—"
                      value={mill.flow_rate} onChange={e => setMill(mi, 'flow_rate', e.target.value)} /></td>
                    <td><input type="number" className="sl-input-num-wide" placeholder="—"
                      value={mill.rated_time} onChange={e => setMill(mi, 'rated_time', e.target.value)} /></td>
                    <td><input type="number" className="sl-input-num-wide" placeholder="—"
                      value={mill.current_amp} onChange={e => setMill(mi, 'current_amp', e.target.value)} /></td>
                    <td><input type="number" className="sl-input-num-wide" placeholder="—"
                      value={mill.zirconia_beads} onChange={e => setMill(mi, 'zirconia_beads', e.target.value)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Suspension + Remark */}
          <div className="sl-susp-block">
            <div className="sl-section-title">
              Suspension &amp; Remarks / <span className="hi">सस्पेंशन और टिप्पणी</span>
            </div>
            <div className="sl-susp-fields">
              <div className="sl-field-group">
                <label className="sl-label">
                  I Suspension / <span className="hi">I सस्पेंशन</span>
                </label>
                <input className="sl-input"
                  placeholder="Value / मूल्य"
                  value={form.suspension1}
                  onChange={e => set('suspension1', e.target.value)} />
              </div>
              <div className="sl-field-group">
                <label className="sl-label">
                  II Suspension / <span className="hi">II सस्पेंशन</span>
                </label>
                <input className="sl-input"
                  placeholder="Value / मूल्य"
                  value={form.suspension2}
                  onChange={e => set('suspension2', e.target.value)} />
              </div>
              <div className="sl-field-group">
                <label className="sl-label">
                  Remark / <span className="hi">टिप्पणी</span>
                </label>
                <textarea className="sl-textarea" rows={3}
                  placeholder="Remark / टिप्पणी..."
                  value={form.remark}
                  onChange={e => set('remark', e.target.value)} />
              </div>
            </div>
          </div>
        </div>

        {/* ══ APPROVAL ══ */}
        <div className="sl-approval-bar">
          <div className="sl-approval-field">
            <label className="sl-label">
              Operator / <span className="hi">ऑपरेटर</span>
            </label>
            <input className="sl-input"
              placeholder="Name / नाम"
              value={form.operator}
              onChange={e => set('operator', e.target.value)} />
          </div>
          <div className="sl-approval-field">
            <label className="sl-label">
              Supervisor / <span className="hi">सुपरवाइज़र</span>
            </label>
            <input className="sl-input"
              placeholder="Name / नाम"
              value={form.supervisor}
              onChange={e => set('supervisor', e.target.value)} />
          </div>
          <div className="sl-approval-field">
            <label className="sl-label">
              Manager / <span className="hi">मैनेजर</span>
            </label>
            <input className="sl-input"
              placeholder="Name / नाम"
              value={form.manager}
              onChange={e => set('manager', e.target.value)} />
          </div>
        </div>

        {/* ══ ACTIONS ══ */}
        <div className="sl-actions">
          {error && <div className="sl-error">Error: {error}</div>}
          {saved  && <div className="sl-success">✓ Saved successfully / सफलतापूर्वक सहेजा गया</div>}
          <button type="submit" className="sl-save-btn" disabled={saving}>
            {saving ? 'Saving… / सहेज रहे हैं…' : 'Save Job Card / जॉब कार्ड सहेजें'}
          </button>
          <button type="button" className="sl-reset-btn"
            onClick={() => { setForm(emptyForm()); setSaved(false); setError('') }}>
            Reset / रीसेट
          </button>
        </div>

      </form>
    </div>
  )
}
