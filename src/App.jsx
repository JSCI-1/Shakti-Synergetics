import React, { useState } from 'react'
import Header from './components/Header.jsx'
import TopNav from './components/TopNav.jsx'
import ThermpackJobCard from './components/ThermpackJobCard.jsx'
import './App.css'

const TOP_NAV_TABS = ['Production', 'Quality Check', 'Operator', 'Grinder', 'Spray Drayer', 'Store']

export default function App() {
  const [activeNav, setActiveNav] = useState('Production')

  function handleNavChange(tab) {
    setActiveNav(tab)
  }

  function renderContent() {
    if (activeNav === 'Operator') {
      return <ThermpackJobCard />
    }
    return null
  }

  return (
    <div className="app">
      <Header />
      <TopNav
        tabs={TOP_NAV_TABS}
        active={activeNav}
        onChange={handleNavChange}
      />
      <main className="main-content">
        {renderContent()}
      </main>
      <footer className="app-footer">
        <span>Online</span>
        <span>SHAKTI/PROD/02 · Rev 02</span>
      </footer>
    </div>
  )
}
