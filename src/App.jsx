import React, { useState, useEffect, lazy, Suspense } from 'react'
import Header from './components/Header.jsx'
import TopNav from './components/TopNav.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import './App.css'

// Lazy-load every heavy section — only bundled & executed when first opened
const ThermpackJobCard = lazy(() => import('./components/ThermpackJobCard.jsx'))
const SlurryWrapper    = lazy(() => import('./components/SlurryWrapper.jsx'))
const DryerSection     = lazy(() => import('./components/DryerSection.jsx'))
const SlurryOperator   = lazy(() => import('./components/SlurryOperator.jsx'))
const QualityCheck     = lazy(() => import('./components/QualityCheck/QualityCheck.jsx'))

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

function SectionLoader() {
  return (
    <div style={{
      display: 'flex', justifyContent: 'center', alignItems: 'center',
      padding: '3rem', color: '#888', fontSize: 14,
    }}>
      Loading…
    </div>
  )
}

export default function App() {
  const [activeNav, setActiveNav] = useState('Production')

  // Set draft_uid in localStorage so useDraft keys are user-scoped.
  // LoginPage writes jsci_user on successful login.
  // On localhost (bypass), fall back to ADMIN_USER.id.
  useEffect(() => {
    try {
      const stored = localStorage.getItem('jsci_user')
      const user = stored ? JSON.parse(stored) : null
      const uid = user?.id || ADMIN_USER.id
      localStorage.setItem('draft_uid', uid)

      // One-time migration: clear batch:cards draft if it uses the old flat format
      // (old: [{ id, batch_no, tank_type }] — new: [{ id, batchNo, rows[] }])
      // With DRAFT_VERSION=2 in useDraft, old unversioned drafts are already discarded
      // automatically. This block handles an extra edge-case stale check.
      const batchKey = `draft:${uid}:batch:cards`
      try {
        const raw = localStorage.getItem(batchKey)
        if (raw) {
          const parsed = JSON.parse(raw)
          // Old unversioned format was a plain array at the top level
          const isOldFormat = Array.isArray(parsed) ||
            (parsed && typeof parsed === 'object' && parsed.v !== 2)
          if (isOldFormat) localStorage.removeItem(batchKey)
        }
      } catch { localStorage.removeItem(batchKey) }

    } catch {
      // localStorage not available — drafts will use 'guest' key
    }
  }, [])

  function renderContent() {
    switch (activeNav) {
      case 'Thermopack Operator':
        return (
          <ErrorBoundary label="Thermopack Operator">
            <Suspense fallback={<SectionLoader />}>
              <ThermpackJobCard />
            </Suspense>
          </ErrorBoundary>
        )
      case 'Batch Operator':
        return (
          <ErrorBoundary label="Batch Operator">
            <Suspense fallback={<SectionLoader />}>
              <SlurryWrapper />
            </Suspense>
          </ErrorBoundary>
        )
      case 'Dryer Operator':
        return (
          <ErrorBoundary label="Dryer Operator">
            <Suspense fallback={<SectionLoader />}>
              <DryerSection user={ADMIN_USER} />
            </Suspense>
          </ErrorBoundary>
        )
      case 'Slurry Operator':
        return (
          <ErrorBoundary label="Slurry Operator">
            <Suspense fallback={<SectionLoader />}>
              <SlurryOperator />
            </Suspense>
          </ErrorBoundary>
        )
      case 'Quality Control':
        return (
          <ErrorBoundary label="Quality Control">
            <Suspense fallback={<SectionLoader />}>
              <QualityCheck />
            </Suspense>
          </ErrorBoundary>
        )
      default:
        return null
    }
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
