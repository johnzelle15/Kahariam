import React, { useState, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Dashboard from './components/Dashboard'
import Counter from './components/Counter'
import Inventory from './components/Inventory'
import Adjustments from './components/Adjustments'
import Settings from './components/Settings/index'
import Sidebar from './components/Sidebar'
import WelcomeScreen from './components/WelcomeScreen'
import LoginScreen from './components/LoginScreen'
import ResetPassword from './components/ResetPassword'
import useThemeStore from './store/themeStore'
import useAuthStore from './store/authStore'

const ADMIN_TABS = new Set(['dashboard', 'counter', 'inventory', 'adjustments', 'settings'])
const STAFF_TABS = new Set(['counter', 'settings'])
const STORAGE_KEY = 'fc_entered'

function getAllowedTabs(role) {
  return role === 'admin' ? ADMIN_TABS : STAFF_TABS
}

function getDefaultTab(role) {
  return role === 'admin' ? 'dashboard' : 'counter'
}

function getInitialTab(role) {
  const allowed = getAllowedTabs(role)
  try {
    const hash = window.location.hash.replace('#', '').trim().toLowerCase()
    if (allowed.has(hash)) return hash
    const params = new URLSearchParams(window.location.search)
    const requestedTab = (params.get('tab') || '').trim().toLowerCase()
    if (allowed.has(requestedTab)) return requestedTab
  } catch { /* fallback */ }
  return getDefaultTab(role)
}

function hasEntered() {
  try { return sessionStorage.getItem(STORAGE_KEY) === '1' } catch { return false }
}

const pageVariants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.4, 0, 0.2, 1] } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.15 } },
}

export default function App() {
  const [showWelcome, setShowWelcome] = useState(!hasEntered())
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const initTheme = useThemeStore(s => s.initTheme)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const user = useAuthStore(s => s.user)
  const role = user?.role || 'staff'
  const allowedTabs = getAllowedTabs(role)

  const [tab, setTabState] = useState(() => getInitialTab(role))

  useEffect(() => { initTheme() }, [initTheme])

  // If role changes or tab is not allowed, reset to default
  useEffect(() => {
    if (!allowedTabs.has(tab)) setTabState(getDefaultTab(role))
  }, [role, tab, allowedTabs])

  // Keep hash in sync on popstate (back/forward)
  useEffect(() => {
    function onHashChange() {
      const hash = window.location.hash.replace('#', '').trim().toLowerCase()
      if (allowedTabs.has(hash)) setTabState(hash)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [allowedTabs])

  const setTab = useCallback((newTab) => {
    if (!allowedTabs.has(newTab)) return
    setTabState(newTab)
    window.location.hash = newTab
    setMobileMenuOpen(false)
  }, [allowedTabs])

  const handleEnter = useCallback(() => {
    try { sessionStorage.setItem(STORAGE_KEY, '1') } catch { /* ignore */ }
    setShowWelcome(false)
  }, [])

  // Check for password reset token in URL (takes priority over everything else)
  const resetToken = (() => {
    try {
      const params = new URLSearchParams(window.location.search)
      return params.get('reset_token') || null
    } catch { return null }
  })()

  function clearResetToken() {
    try { window.history.replaceState({}, '', window.location.pathname + window.location.hash) } catch { /* ignore */ }
  }

  if (resetToken) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4"
        style={{ background: 'var(--bg-primary, #0a0f1a)' }}>
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="relative w-full max-w-md p-8 rounded-2xl"
          style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.07)',
            backdropFilter: 'blur(20px)',
            boxShadow: '0 25px 50px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)',
          }}
        >
          <h1 className="text-2xl font-extrabold tracking-tight mb-6 text-center"
            style={{ color: '#e8ecf2' }}>
            Reset Password
          </h1>
          <ResetPassword token={resetToken} onDone={() => { clearResetToken(); window.location.reload() }} />
        </motion.div>
      </div>
    )
  }

  // If not authenticated, show LoginScreen
  if (!isAuthenticated) {
    return <LoginScreen />
  }

  return (
    <>
      <AnimatePresence>
        {showWelcome && <WelcomeScreen onEnter={handleEnter} />}
      </AnimatePresence>

      <motion.div
        className="flex min-h-screen bg-dark-900"
        initial={false}
        animate={{ opacity: showWelcome ? 0 : 1 }}
        transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
      >
      <Sidebar
        tab={tab}
        setTab={setTab}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(c => !c)}
        mobileOpen={mobileMenuOpen}
        onMobileClose={() => setMobileMenuOpen(false)}
      />
      {/* Mobile top bar */}
      <div className="fixed top-0 left-0 right-0 z-40 md:hidden flex items-center gap-3 px-4 py-3"
        style={{ background: 'rgb(var(--bg-primary) / 0.95)', backdropFilter: 'blur(12px)', borderBottom: '1px solid var(--glass-border)' }}>
        <button onClick={() => setMobileMenuOpen(true)}
          className="w-9 h-9 rounded-lg flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-white/10 transition-colors"
          aria-label="Open menu">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
          </svg>
        </button>
        <span className="text-sm font-bold text-text-primary">Aquaculture</span>
      </div>
      <main className="flex-1 min-w-0 transition-all duration-300">
        <div className="p-4 pt-16 md:pt-8 md:p-8 max-w-[1400px] mx-auto">
          <AnimatePresence mode="wait">
            <motion.div key={tab} variants={pageVariants} initial="initial" animate="animate" exit="exit">
              {tab === 'dashboard' && allowedTabs.has('dashboard') && <Dashboard />}
              {tab === 'counter' && <Counter />}
              {tab === 'inventory' && allowedTabs.has('inventory') && <Inventory />}
              {tab === 'adjustments' && allowedTabs.has('adjustments') && <Adjustments />}
              {tab === 'settings' && allowedTabs.has('settings') && <Settings />}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
      </motion.div>
    </>
  )
}
