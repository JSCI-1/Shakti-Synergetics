import React, { useState, useEffect, lazy, Suspense } from 'react'
import { supabase, supabaseReady } from './supabaseClient.js'
import Header from './components/Header.jsx'
import TopNav from './components/TopNav.jsx'
import LoginPage from './components/LoginPage.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import './App.css'

// Lazy-load every heavy section
const ThermpackJobCard = lazy(() => import('./components/ThermpackJobCard.jsx'))
const SlurryWrapper    = lazy(() => import('./components/SlurryWrapper.jsx'))
const DryerSection     = lazy(() => import('./components/DryerSection.jsx'))
const SlurryOperator   = lazy(() => import('./components/SlurryOperator.jsx'))
const QualityCheck     = lazy(() => import('./components/QualityCheck/QualityCheck.jsx'))
const ProductionActivity = lazy(() => import('./components/ProductionActivity.jsx'))

// Map nav-tab labels → the section key stored in app_users.sections
const ALL_TABS = [
  { label: 'Production',          key: 'production'   },
  { label: 'Quality Control',     key: 'quality'      },
  { label: 'Batch Operator',      key: 'batch'        },
  { label: 'Slurry Operator',     key: 'slurry'       },
  { label: 'Thermopack Operator', key: 'thermopack'   },
  { label: 'Dryer Operator',      key: 'dryer'        },
  { label: 'Store',               key: 'store'        },
]

/** Returns the set of tab labels this user can see */
function getAllowedTabs(user) {
  if (!user) return []
  const sections = user.sections ?? []
  if (user.role === 'admin' || sections.includes('all')) {
    return ALL_TABS.map(t => t.label)
  }
  return ALL_TABS
    .filter(t => sections.includes(t.key))
    .map(t => t.label)
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
  const [user,      setUser]      = useState(null)   // app_users profile
  const [authReady, setAuthReady] = useState(false)  // session check complete
  const [activeNav, setActiveNav] = useState(null)   // set after login

  // ── 1. Restore session on mount ───────────────────────────
  useEffect(() => {
    if (!supabaseReady) {
      // Supabase not configured — skip auth entirely
      setAuthReady(true)
      return
    }

    // Check for an existing Supabase session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session) {
        await loadProfile(session)
      }
      setAuthReady(true)
    })

    // Keep session in sync across tabs / token refresh
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_OUT') {
          setUser(null)
          setActiveNav(null)
          localStorage.removeItem('jsci_user')
        }
        // SIGNED_IN handled only on initial mount (getSession above)
        // to avoid double-loading the profile
      }
    )

    return () => subscription.unsubscribe()
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  async function loadProfile(session) {
    const phone = session.user?.phone
    if (!phone) return null

    const { data: profile } = await supabase
      .from('app_users')
      .select('id, name, role, sections, is_active')
      .eq('phone', phone)
      .maybeSingle()

    if (!profile || !profile.is_active) {
      await supabase.auth.signOut()
      return null
    }

    localStorage.setItem('jsci_user', JSON.stringify(profile))
    localStorage.setItem('draft_uid', profile.id)
    applyUser(profile)
    return profile
  }

  function applyUser(profile) {
    setUser(profile)
    // Stale batch:cards migration (DRAFT_VERSION=2 handles most cases, this is belt+braces)
    try {
      const batchKey = `draft:${profile.id}:batch:cards`
      const raw = localStorage.getItem(batchKey)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed) ||
            (parsed && typeof parsed === 'object' && parsed.v !== 2))
          localStorage.removeItem(batchKey)
      }
    } catch { /* silent */ }
  }

  // Called by LoginPage after successful OTP verify + profile load
  function handleLogin(profile) {
    applyUser(profile)
    const allowed = getAllowedTabs(profile)
    setActiveNav(allowed[0] ?? null)
  }

  // ── 2. Sign out ───────────────────────────────────────────
  async function handleSignOut() {
    // Keep the user's drafts across logout (Option A): do NOT clear
    // draft:<uid>:* keys, and keep `draft_uid` so the same per-user draft
    // namespace is restored when they log back in. Only the auth session and
    // cached profile are cleared.
    localStorage.removeItem('jsci_user')
    await supabase.auth.signOut()
    setUser(null)
    setActiveNav(null)
  }

  // ── 3. Route guard — keep activeNav inside allowed tabs ──
  const allowedTabs = getAllowedTabs(user)
  useEffect(() => {
    if (!user) return
    if (!activeNav || !allowedTabs.includes(activeNav)) {
      setActiveNav(allowedTabs[0] ?? null)
    }
  }, [user, allowedTabs.join(',')])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── 4. Not ready yet (checking session) ──────────────────
  if (!authReady) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        background: '#f0ede8', color: '#888', fontSize: 15,
      }}>
        Loading… / लोड हो रहा है…
      </div>
    )
  }

  // ── 5. Not logged in → show login page ───────────────────
  if (!user) {
    return <LoginPage onLogin={handleLogin} />
  }

  // ── 6. Render app ─────────────────────────────────────────
  function renderContent() {
    switch (activeNav) {
      case 'Thermopack Operator':
        return (
          <ErrorBoundary label="Thermopack Operator">
            <Suspense fallback={<SectionLoader />}>
              <ThermpackJobCard user={user} />
            </Suspense>
          </ErrorBoundary>
        )
      case 'Batch Operator':
        return (
          <ErrorBoundary label="Batch Operator">
            <Suspense fallback={<SectionLoader />}>
              <SlurryWrapper user={user} />
            </Suspense>
          </ErrorBoundary>
        )
      case 'Dryer Operator':
        return (
          <ErrorBoundary label="Dryer Operator">
            <Suspense fallback={<SectionLoader />}>
              <DryerSection user={user} />
            </Suspense>
          </ErrorBoundary>
        )
      case 'Slurry Operator':
        return (
          <ErrorBoundary label="Slurry Operator">
            <Suspense fallback={<SectionLoader />}>
              <SlurryOperator user={user} />
            </Suspense>
          </ErrorBoundary>
        )
      case 'Quality Control':
        return (
          <ErrorBoundary label="Quality Control">
            <Suspense fallback={<SectionLoader />}>
              <QualityCheck user={user} />
            </Suspense>
          </ErrorBoundary>
        )
      case 'Production':
        // Read-only live view of the shared hourly dryer draft.
        // Tab visibility is role-gated by getAllowedTabs (sections
        // includes 'production', or admin/'all').
        return (
          <ErrorBoundary label="Production">
            <Suspense fallback={<SectionLoader />}>
              <ProductionActivity />
            </Suspense>
          </ErrorBoundary>
        )
      default:
        return null
    }
  }

  return (
    <div className="app">
      <Header user={user} onSignOut={handleSignOut} />

      <TopNav
        tabs={allowedTabs}
        active={activeNav}
        onChange={setActiveNav}
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
