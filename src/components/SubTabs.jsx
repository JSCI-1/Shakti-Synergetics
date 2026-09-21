import React, { useRef } from 'react'
import './SubTabs.css'

export default function SubTabs({ tabs, active, onChange }) {
  const scrollRef = useRef(null)

  function scrollLeft() {
    scrollRef.current.scrollBy({ left: -120, behavior: 'smooth' })
  }

  function scrollRight() {
    scrollRef.current.scrollBy({ left: 120, behavior: 'smooth' })
  }

  return (
    <div className="sub-tabs-wrapper">
      <button className="scroll-btn left" onClick={scrollLeft}>&#8249;</button>
      <div className="sub-tabs" ref={scrollRef}>
        {tabs.map((tab) => (
          <button
            key={tab}
            className={`sub-tab ${active === tab ? 'active' : ''}`}
            onClick={() => onChange(tab)}
          >
            {tab}
          </button>
        ))}
      </div>
      <button className="scroll-btn right" onClick={scrollRight}>&#8250;</button>
    </div>
  )
}
