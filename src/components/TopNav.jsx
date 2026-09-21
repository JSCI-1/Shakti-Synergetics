import React from 'react'
import './TopNav.css'

export default function TopNav({ tabs, active, onChange }) {
  return (
    <nav className="top-nav">
      {tabs.map((tab) => (
        <button
          key={tab}
          className={`top-nav-tab ${active === tab ? 'active' : ''}`}
          onClick={() => onChange(tab)}
        >
          {tab}
        </button>
      ))}
    </nav>
  )
}
