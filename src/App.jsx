import React, { useState } from 'react'
import Header from './components/Header.jsx'
import TopNav from './components/TopNav.jsx'
import ThermpackJobCard from './components/ThermpackJobCard.jsx'
import SlurryWrapper from './components/SlurryWrapper.jsx'
import DryerSection from './components/DryerSection.jsx'
import SlurryOperator from './components/SlurryOperator.jsx'
import QualityCheck from './components/QualityCheck/QualityCheck.jsx'
import './App.css'

const ALL_TABS = [
  'Production',
  'Quality Control',
  'Batch Operator',
  'Slurry Operator',
  'Thermopack Operator',
  'Dryer Operator',
  'Store',
]

const ADMIN_USER = {
  id: 'admin', name: 'Admin', role: 'admin',
  sections: ['all'], is_active: true,
}

export default function App() {
  const [activeNav, setActiveNav] = useState('Production')

  function renderContent() {
    if (activeNav === 'Thermopack Operator') return <ThermpackJobCard />
    if (activeNav === 'Batch Operator')      return <SlurryWrapper />
    if (activeNav === 'Dryer Operator')      return <DryerSection user={ADMIN_USER} />
    if (activeNav === 'Slurry Operator')     return <SlurryOperator />
    if (activeNav === 'Quality Control')     return <QualityCheck />
    return null
  }

  return (
    <div className="app">
      <Header />

      <TopNav tabs={ALL_TABS} active={activeNav} onChange={setActiveNav} />

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
