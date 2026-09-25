import React, { useState } from 'react'
import SlurrySection from './SlurrySection.jsx'
import BatchTraceability from './BatchTraceability.jsx'
import './SlurryWrapper.css'

const SLURRY_TABS = [
  { key: 'process',      label: 'Process Job Card' },
  { key: 'traceability', label: 'Batch Traceability Records' },
]

// emptyBatch kept here so both children see the same shape
export function emptyBatch(index) {
  return { id: Date.now() + Math.random(), batch_no: '', tank_type: '' }
}

export default function SlurryWrapper() {
  const [activeTab, setActiveTab] = useState('process')
  // Shared batch list — Process Job Card writes, Traceability reads
  const [sharedBatches, setSharedBatches] = useState([emptyBatch(0)])

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
        {activeTab === 'process' && (
          <SlurrySection
            sharedBatches={sharedBatches}
            setSharedBatches={setSharedBatches}
          />
        )}
        {activeTab === 'traceability' && (
          <BatchTraceability sharedBatches={sharedBatches} />
        )}
      </div>
    </div>
  )
}
