import { useState } from 'react'
import ResultBadge from './ResultBadge.jsx'
import {
  evaluate,
  calcMoisture, calcSulphur, calcSieve,
  calcBulkDensity, calcPurity, calcMeshSize, calcSuspensibility,
} from '../../utils/qualityUtils.js'

const FN_MAP = {
  calcMoisture, calcSulphur, calcSieve,
  calcBulkDensity, calcPurity, calcMeshSize, calcSuspensibility,
}

export default function FormulaCalculator({ formula, onInputChange }) {
  const [inputs, setInputs] = useState({})

  const setInput = (key, val) => {
    setInputs(prev => ({ ...prev, [key]: val }))
    if (onInputChange) onInputChange(key, val)
  }

  let calcResult    = null
  let intermediates = null
  const fn = FN_MAP[formula.calcFn]
  if (fn) {
    const allFilled = formula.variables.every(
      v => inputs[v.key] !== '' && inputs[v.key] !== undefined
    )
    if (allFilled) {
      const raw = fn(inputs)
      if (raw !== null && typeof raw === 'object') {
        intermediates = { M: raw.M, m: raw.m }
        calcResult    = raw.result
      } else {
        calcResult = raw
      }
    }
  }

  const result = evaluate(calcResult, formula.rule)

  function handleReset() { setInputs({}) }

  return (
    // data-formula-card — identified by printReport for DOM reading
    <div className="qc-formula-card" data-formula-card={formula.id}>
      <div className="qc-formula-name">{formula.name}</div>

      <div className="qc-formula-display">
        <span dangerouslySetInnerHTML={{ __html: formula.formulaHtml }} />
        {formula.resultUnit && <span className="qc-formula-unit"> ({formula.resultUnit})</span>}
      </div>

      {formula.constants && (
        <div className="qc-formula-where qc-constants">
          {formula.constants.map(c => (
            <div key={c.label} className="qc-where-row">
              <span className="qc-where-key">{c.label} = {c.value}</span>
              <span className="qc-where-desc">{c.desc}</span>
            </div>
          ))}
        </div>
      )}

      <div className="qc-vars">
        {formula.variables.map(v => (
          <div key={v.key} className="qc-var-row">
            <label className="qc-var-label">
              <span className="qc-var-sym">{v.label}</span>
              <span className="qc-var-desc">{v.desc}</span>
            </label>
            <div className="qc-input-unit">
              {/* data-var-key and data-var-label used by printReport */}
              <input
                type="number"
                className="qc-input"
                placeholder="—"
                value={inputs[v.key] ?? ''}
                onChange={e => setInput(v.key, e.target.value)}
                step="any"
                min="0"
                data-var-key={v.key}
                data-var-label={v.label}
                data-var-desc={v.desc}
                data-var-unit={v.unit || ''}
              />
              {v.unit && <span className="qc-unit">{v.unit}</span>}
            </div>
          </div>
        ))}
      </div>

      {intermediates && formula.intermediates && (
        <div className="qc-intermediates">
          <div className="qc-inter-title">Intermediate values:</div>
          {formula.intermediates.map(im => (
            <div key={im.key} className="qc-inter-row">
              <span className="qc-inter-key">{im.label}</span>
              <span className="qc-inter-eq">=</span>
              <span className="qc-inter-val">{intermediates[im.key] ?? '—'}</span>
              <span className="qc-inter-formula">({im.formula})</span>
            </div>
          ))}
        </div>
      )}

      {/* data-result used by printReport to read displayed result */}
      <div className="qc-calc-result">
        <span className="qc-calc-label">Result:</span>
        <span className="qc-calc-value" data-result>
          {calcResult !== null ? `${calcResult} ${formula.resultUnit}` : '—'}
        </span>
        {formula.rule && <ResultBadge result={result} />}
      </div>

      <button type="button" className="qc-reset-btn" onClick={handleReset}>
        Reset / रीसेट
      </button>
    </div>
  )
}
