import React, { useState } from 'react'
import SlurrySection from './SlurrySection.jsx'
import BatchTraceability from './BatchTraceability.jsx'
import './SlurryWrapper.css'

const SLURRY_TABS = [
  { key: 'process',      label: 'Process Job Card' },
  { key: 'traceability', label: 'Batch Traceability Records' },
]

export default function SlurryWrapper() {
  const [activeTab, setActiveTab] = useState('process')

  return (
    <div className="sw-wrapper">
      {/* ── Sub-tab bar ── */}
      <div className="sw-tab-bar">
        {SLURRY_TABS.map(tab => (
          <button
            key={tab.key}
            type="button"
            className={`sw-tab-btn ${activeTab === tab.key ? 'sw-tab-active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Content ── */}
      <div className="sw-content">
        {activeTab === 'process'      && <SlurrySection />}
        {activeTab === 'traceability' && <BatchTraceability />}
      </div>
    </div>
  )
}
