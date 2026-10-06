import React, { useState, useEffect } from 'react'
import Header from './components/Header.jsx'
import TopNav from './components/TopNav.jsx'
import ThermpackJobCard from './components/ThermpackJobCard.jsx'
import SlurryWrapper from './components/SlurryWrapper.jsx'
import DryerSection from './components/DryerSection.jsx'
import SlurryOperator from './components/SlurryOperator.jsx'
import QualityCheck from './components/QualityCheck/QualityCheck.jsx'
import LoginPage from './components/LoginPage.jsx'
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

// Which tabs a user can see based on their sections array
function getAllowedTabs(user) {
  if (!user) return []
  const s = user.sections || []
  if (s.includes('all') || user.role === 'admin') return ALL_TABS
  return ALL_TABS.filter(tab => s.includes(tab))
}

export default function App() {
  const [user,       setUser]       = useState(null)
  const [authReady,  setAuthReady]  = useState(false)
  const [activeNav,  setActiveNav]  = useState('Production')

  // On mount — restore session from localStorage
  // On localhost: skip login entirely for development
  useEffect(() => {
    const isLocalhost = window.location.hostname === 'localhost' ||
                        window.location.hostname === '127.0.0.1'
    if (isLocalhost) {
      const devUser = {
        id: 'dev', name: 'Dev (Localhost)', role: 'admin',
        sections: ['all'], is_active: true,
      }
      setUser(devUser)
      setActiveNav(ALL_TABS[0])
      setAuthReady(true)
      return
    }
    try {
      const stored = localStorage.getItem('jsci_user')
      if (stored) {
        const profile = JSON.parse(stored)
        setUser(profile)
        const allowed = getAllowedTabs(profile)
        if (allowed.length > 0) setActiveNav(allowed[0])
      }
    } catch (_) {}
    setAuthReady(true)
  }, [])

  function handleLogin(profile) {
    setUser(profile)
    const allowed = getAllowedTabs(profile)
    setActiveNav(allowed.length > 0 ? allowed[0] : 'Production')
  }

  function handleLogout() {
    localStorage.removeItem('jsci_user')
    setUser(null)
    setActiveNav('Production')
  }

  function renderContent() {
    if (activeNav === 'Thermopack Operator') return <ThermpackJobCard />
    if (activeNav === 'Batch Operator')      return <SlurryWrapper />
    if (activeNav === 'Dryer Operator')      return <DryerSection user={user} />
    if (activeNav === 'Slurry Operator')     return <SlurryOperator />
    if (activeNav === 'Quality Control')     return <QualityCheck />
    return null
  }

  // Loading state
  if (!authReady) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        background: '#f0ede8', fontSize: '16px', color: '#888',
      }}>
        Loading…
      </div>
    )
  }

  // Not logged in
  if (!user) {
    return <LoginPage onLogin={handleLogin} />
  }

  const allowedTabs = getAllowedTabs(user)

  return (
    <div className="app">
      <Header />

      <TopNav tabs={allowedTabs} active={activeNav} onChange={setActiveNav} />

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
