import ResultBadge from './ResultBadge.jsx'
import { evaluate } from '../../utils/qualityUtils.js'

export default function SpecTable({ params, values, onChange }) {
  const hasAnyRule = params.some(p => p.rule)

  return (
    <div className="qc-table-wrap">
      <table className="qc-table">
        <thead>
          <tr>
            <th>Parameter / पैरामीटर</th>
            <th>Specification / मानक</th>
            <th>Observation / प्रेक्षण</th>
            {hasAnyRule && <th>Result / परिणाम</th>}
          </tr>
        </thead>
        <tbody>
          {params.map(param => {
            const val    = values[param.id] ?? ''
            const result = evaluate(val, param.rule)
            return (
              <tr key={param.id} className={result === 'FAIL' ? 'qc-row-fail' : ''}>
                <td className="qc-param-name">
                  {param.name}
                  {param.method && <div className="qc-method">{param.method}</div>}
                </td>
                <td className="qc-spec">{param.specification}</td>
                <td className="qc-obs">
                  {param.inputType === 'dropdown' ? (
                    <select
                      className="qc-select"
                      value={val}
                      onChange={e => onChange(param.id, e.target.value)}
                      // data attrs for DOM reading
                      data-param-id={param.id}
                      data-param-name={param.name}
                      data-param-unit={param.unit || ''}
                      data-param-spec={param.specification}
                    >
                      <option value="">— Select —</option>
                      {param.options.map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  ) : (
                    <div className="qc-input-unit">
                      <input
                        type="number"
                        className="qc-input"
                        placeholder="—"
                        value={val}
                        onChange={e => onChange(param.id, e.target.value)}
                        step="any"
                        min="0"
                        // data attrs for DOM reading
                        data-param-id={param.id}
                        data-param-name={param.name}
                        data-param-unit={param.unit || ''}
                        data-param-spec={param.specification}
                      />
                      {param.unit && <span className="qc-unit">{param.unit}</span>}
                    </div>
                  )}
                </td>
                {hasAnyRule && (
                  <td className="qc-result">
                    {/* data-result used by printReport */}
                    <span data-result data-has-rule={!!param.rule}>
                      <ResultBadge result={result} />
                    </span>
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
