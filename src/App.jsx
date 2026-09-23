import React, { useState } from 'react'
import Header from './components/Header.jsx'
import TopNav from './components/TopNav.jsx'
import ThermpackJobCard from './components/ThermpackJobCard.jsx'
import SlurryWrapper from './components/SlurryWrapper.jsx'
import DryerSection from './components/DryerSection.jsx'
import './App.css'

const TOP_NAV_TABS = ['Production', 'Quality Check', 'Thermopack Operator', 'Grinder', 'Dryer Section', 'Store', 'Slurry Section']

export default function App() {
  const [activeNav, setActiveNav] = useState('Production')

  function renderContent() {
    if (activeNav === 'Thermopack Operator') return <ThermpackJobCard />
    if (activeNav === 'Slurry Section')      return <SlurryWrapper />
    if (activeNav === 'Dryer Section')       return <DryerSection />
    return null
  }

  return (
    <div className="app">
      <Header />
      <TopNav tabs={TOP_NAV_TABS} active={activeNav} onChange={setActiveNav} />
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
