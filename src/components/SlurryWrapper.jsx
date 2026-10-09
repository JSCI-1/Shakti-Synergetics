import React, { useState } from 'react'
import SlurrySection from './SlurrySection.jsx'
import './SlurryWrapper.css'

const SLURRY_TABS = [
  { key: 'process',      label: 'Process Job Card' },
  { key: 'traceability', label: 'Batch Traceability Records' },
  { key: 'consumption',  label: 'Slurry Consumption Report' },
]

export function emptyBatch() {
  return { id: Date.now() + Math.random(), batch_no: '', tank_type: '' }
}

/**
 * Sub-tabs are lazy-mounted: a tab's content is only rendered the first time
 * the user opens it, then kept in the DOM (hidden) so state is preserved.
 * This avoids loading BatchTraceability and SlurryConsumption on initial mount.
 */
export default function SlurryWrapper() {
  const [activeTab, setActiveTab] = useState('process')
  const [sharedBatches, setSharedBatches] = useState([emptyBatch()])

  // Track which tabs have been opened at least once
  const [visited, setVisited] = useState({ process: true })

  function openTab(key) {
    setActiveTab(key)
    if (!visited[key]) setVisited(prev => ({ ...prev, [key]: true }))
  }

  return (
    <div className="sw-wrapper">
      <div className="sw-tab-bar">
        {SLURRY_TABS.map(tab => (
          <button key={tab.key} type="button"
            className={`sw-tab-btn ${activeTab === tab.key ? 'sw-tab-active' : ''}`}
            onClick={() => openTab(tab.key)}>
            {tab.label}
          </button>
        ))}
      </div>

      <div className="sw-content">
        {/* Process Job Card — always rendered (first tab) */}
        <div style={{ display: activeTab === 'process' ? 'block' : 'none' }}>
          <SlurrySection
            sharedBatches={sharedBatches}
            setSharedBatches={setSharedBatches}
          />
        </div>

        {/* Batch Traceability — lazy import, only rendered after first visit */}
        {visited.traceability && (
          <div style={{ display: activeTab === 'traceability' ? 'block' : 'none' }}>
            <LazyBatchTraceability sharedBatches={sharedBatches} />
          </div>
        )}

        {/* Slurry Consumption — lazy import, only rendered after first visit */}
        {visited.consumption && (
          <div style={{ display: activeTab === 'consumption' ? 'block' : 'none' }}>
            <LazySlurryConsumption />
          </div>
        )}
      </div>
    </div>
  )
}

// ── Lazy wrappers so BatchTraceability & SlurryConsumption are code-split ──

const BatchTraceabilityModule = React.lazy(() => import('./BatchTraceability.jsx'))
const SlurryConsumptionModule  = React.lazy(() => import('./SlurryConsumption.jsx'))

function LazyBatchTraceability(props) {
  return (
    <React.Suspense fallback={<div className="sw-loading">Loading…</div>}>
      <BatchTraceabilityModule {...props} />
    </React.Suspense>
  )
}

function LazySlurryConsumption(props) {
  return (
    <React.Suspense fallback={<div className="sw-loading">Loading…</div>}>
      <SlurryConsumptionModule {...props} />
    </React.Suspense>
  )
}
