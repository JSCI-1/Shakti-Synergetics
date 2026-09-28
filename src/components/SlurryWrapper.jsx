import React, { useState } from 'react'
import SlurrySection from './SlurrySection.jsx'
import BatchTraceability from './BatchTraceability.jsx'
import SlurryConsumption from './SlurryConsumption.jsx'
import './SlurryWrapper.css'

const SLURRY_TABS = [
  { key: 'process',      label: 'Process Job Card' },
  { key: 'traceability', label: 'Batch Traceability Records' },
  { key: 'consumption',  label: 'Slurry Consumption Report' },
]

export function emptyBatch() {
  return { id: Date.now() + Math.random(), batch_no: '', tank_type: '' }
}

export default function SlurryWrapper() {
  const [activeTab, setActiveTab] = useState('process')
  const [sharedBatches, setSharedBatches] = useState([emptyBatch()])

  return (
    <div className="sw-wrapper">
      <div className="sw-tab-bar">
        {SLURRY_TABS.map(tab => (
          <button key={tab.key} type="button"
            className={`sw-tab-btn ${activeTab === tab.key ? 'sw-tab-active' : ''}`}
            onClick={() => setActiveTab(tab.key)}>
            {tab.label}
          </button>
        ))}
      </div>

      <div className="sw-content">
        {/* All tabs always mounted — hidden via CSS so data is preserved */}
        <div style={{ display: activeTab === 'process' ? 'block' : 'none' }}>
          <SlurrySection
            sharedBatches={sharedBatches}
            setSharedBatches={setSharedBatches}
          />
        </div>
        <div style={{ display: activeTab === 'traceability' ? 'block' : 'none' }}>
          <BatchTraceability sharedBatches={sharedBatches} />
        </div>
        <div style={{ display: activeTab === 'consumption' ? 'block' : 'none' }}>
          <SlurryConsumption />
        </div>
      </div>
    </div>
  )
}
