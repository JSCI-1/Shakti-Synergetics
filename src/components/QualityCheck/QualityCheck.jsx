import { useState } from 'react'
import { RAW_MATERIALS, IN_PROCESS, FINISHED_GOODS } from '../../data/qualityData.js'
import { evaluate } from '../../utils/qualityUtils.js'
import { supabase, supabaseReady } from '../../supabaseClient.js'
import SpecTable from './SpecTable.jsx'
import FormulaCalculator from './FormulaCalculator.jsx'
import OverallResult from './OverallResult.jsx'
import './QualityCheck.css'

const TABS = [
  { key: 'rm',  label: 'Raw Materials',  labelHi: 'कच्चा माल'     },
  { key: 'ip',  label: 'In-Process',     labelHi: 'इन-प्रोसेस'    },
  { key: 'fg',  label: 'Finished Goods', labelHi: 'तैयार माल'     },
]

// ── batch header ────────────────────────────────────────────
function BatchHeader({ date, setDate, testedBy, setTestedBy }) {
  return (
    <div className="qc-batch-bar">
      <div className="qc-batch-field">
        <label className="qc-batch-label">Date / तारीख</label>
        <input type="date" className="qc-batch-input"
          value={date} onChange={e => setDate(e.target.value)} />
      </div>
      <div className="qc-batch-field">
        <label className="qc-batch-label">Tested By / परीक्षक</label>
        <input className="qc-batch-input" placeholder="Name / नाम"
          value={testedBy} onChange={e => setTestedBy(e.target.value)} />
      </div>
    </div>
  )
}

// ── flatten all limited param results from a material ───────
function collectResults(material, values) {
  const out = {}

  if (material.type === 'spec') {
    material.params.forEach(p => {
      if (p.rule) out[p.id] = evaluate(values[p.id] ?? '', p.rule)
    })
  }

  if (material.type === 'formula-only') {
    // formulas with rules (none currently, but future-proof)
    material.tests.forEach(t => {
      if (t.rule) out[t.id] = evaluate(values[t.id] ?? '', t.rule)
    })
  }

  return out
}

// ── FG product — collect results ────────────────────────────
function collectFGResults(product, values) {
  const out = {}
  product.tests.forEach(test => {
    if (test.type === 'spec-single' && test.rule) {
      out[test.id] = evaluate(values[test.id] ?? '', test.rule)
    }
    if (test.type === 'spec-group') {
      test.params.forEach(p => {
        if (p.rule) out[p.id] = evaluate(values[p.id] ?? '', p.rule)
      })
    }
    if (test.rule) out[test.id] = evaluate(values[test.id] ?? '', test.rule)
  })
  return out
}

// ── Print / Download ─────────────────────────────────────────
function handlePrint() { window.print() }

// ═══════════════════════════════════════════════════════════
// Main component
// ═══════════════════════════════════════════════════════════
export default function QualityCheck() {
  const [activeTab, setActiveTab] = useState('rm')
  const [rmSelected,  setRmSelected]  = useState(RAW_MATERIALS[0].id)
  const [ipSelected,  setIpSelected]  = useState(IN_PROCESS[0].id)
  const [fgSelected,  setFgSelected]  = useState(FINISHED_GOODS[0].id)
  const [values, setValues] = useState({})
  const [date,      setDate]      = useState('')
  const [testedBy,  setTestedBy]  = useState('')
  const [saving,    setSaving]    = useState(false)
  const [saveMsg,   setSaveMsg]   = useState('')

  const setVal = (id, val) => setValues(prev => ({ ...prev, [id]: val }))

  function handleTabChange(key) {
    setActiveTab(key)
    setValues({})
    setSaveMsg('')
  }

  // ── Raw Materials ──────────────────────────────────────────
  function renderRM() {
    const mat = RAW_MATERIALS.find(m => m.id === rmSelected)
    if (!mat) return null
    const limited = collectResults(mat, values)

    return (
      <>
        <div className="qc-dropdown-bar">
          <label className="qc-dropdown-label">Material / सामग्री</label>
          <select className="qc-dropdown"
            value={rmSelected}
            onChange={e => { setRmSelected(e.target.value); setValues({}) }}>
            {RAW_MATERIALS.map(m => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>

        <div className="qc-mat-title">{mat.label}</div>

        {mat.type === 'spec' && (
          <>
            <SpecTable params={mat.params} values={values} onChange={setVal} />
            <OverallResult results={limited} />
          </>
        )}

        {mat.type === 'formula-only' && mat.tests.map(t => (
          <FormulaCalculator key={t.id} formula={t} />
        ))}
      </>
    )
  }

  // ── In-Process ─────────────────────────────────────────────
  function renderIP() {
    const test = IN_PROCESS.find(t => t.id === ipSelected)
    if (!test) return null

    return (
      <>
        <div className="qc-dropdown-bar">
          <label className="qc-dropdown-label">Test / परीक्षण</label>
          <select className="qc-dropdown"
            value={ipSelected}
            onChange={e => { setIpSelected(e.target.value); setValues({}) }}>
            {IN_PROCESS.map(t => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </div>

        <div className="qc-mat-title">{test.label}</div>

        {test.tests.map(f => (
          <FormulaCalculator key={f.id} formula={f} />
        ))}
      </>
    )
  }

  // ── Finished Goods ─────────────────────────────────────────
  function renderFG() {
    const product = FINISHED_GOODS.find(p => p.id === fgSelected)
    if (!product) return null
    const limited = collectFGResults(product, values)

    return (
      <>
        <div className="qc-dropdown-bar">
          <label className="qc-dropdown-label">Product / उत्पाद</label>
          <select className="qc-dropdown"
            value={fgSelected}
            onChange={e => { setFgSelected(e.target.value); setValues({}) }}>
            {FINISHED_GOODS.map(p => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>

        <div className="qc-mat-title">{product.label}</div>

        {product.tests.map(test => {
          // Formula-based tests
          if (test.calcFn) {
            return <FormulaCalculator key={test.id} formula={test} />
          }
          // Single spec (pH, Wettability)
          if (test.type === 'spec-single') {
            return (
              <div key={test.id} className="qc-single-spec">
                <div className="qc-single-name">{test.name}</div>
                {test.method && <div className="qc-method">{test.method}</div>}
                <div className="qc-input-unit">
                  <input type="number" className="qc-input" placeholder="—"
                    value={values[test.id] ?? ''}
                    onChange={e => setVal(test.id, e.target.value)}
                    step="any" min="0" />
                  {test.unit && <span className="qc-unit">{test.unit}</span>}
                </div>
              </div>
            )
          }
          // Group spec (Persistent Foaming)
          if (test.type === 'spec-group') {
            return (
              <div key={test.id}>
                <div className="qc-group-title">{test.name}</div>
                <SpecTable params={test.params} values={values} onChange={setVal} />
              </div>
            )
          }
          return null
        })}

        <OverallResult results={limited} />
      </>
    )
  }

  return (
    <div className="qc-wrapper">

      {/* ── Header ── */}
      <div className="qc-header-bar">
        <div className="qc-title-main">
          Quality Control / <span className="qc-title-hi">गुणवत्ता नियंत्रण</span>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="qc-tab-bar">
        {TABS.map(tab => (
          <button key={tab.key} type="button"
            className={`qc-tab-btn ${activeTab === tab.key ? 'qc-tab-active' : ''}`}
            onClick={() => handleTabChange(tab.key)}>
            {tab.label}
            <span className="qc-tab-hi"> / {tab.labelHi}</span>
          </button>
        ))}
      </div>

      {/* ── Batch header ── */}
      <BatchHeader
        date={date}         setDate={setDate}
        testedBy={testedBy} setTestedBy={setTestedBy}
      />

      {/* ── Content ── */}
      <div className="qc-content">
        {activeTab === 'rm' && renderRM()}
        {activeTab === 'ip' && renderIP()}
        {activeTab === 'fg' && renderFG()}
      </div>

      {/* ── Actions ── */}
      <div className="qc-actions">
        {saveMsg && <div className="qc-save-msg">{saveMsg}</div>}
        <button type="button" className="qc-print-btn" disabled={saving}
          onClick={async () => {
            if (!supabaseReady) { setSaveMsg('⚠ Supabase not configured.'); return }
            setSaving(true); setSaveMsg('')
            const { error } = await supabase.from('quality_control_records').insert([{
              tab:       activeTab,
              date:      date || null,
              tested_by: testedBy,
              values,
            }])
            setSaving(false)
            setSaveMsg(error ? `❌ ${error.message}` : '✓ Saved successfully / सफलतापूर्वक सहेजा गया')
          }}>
          {saving ? 'Saving…' : 'Save Report / रिपोर्ट सहेजें'}
        </button>
        <button type="button" className="qc-clear-btn"
          onClick={() => { setValues({}); setDate(''); setTestedBy(''); setSaveMsg('') }}>
          Reset All / सभी रीसेट करें
        </button>
      </div>

    </div>
  )
}
