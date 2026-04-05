import React, { useState, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Dashboard from './components/Dashboard'
import Counter from './components/Counter'
import Inventory from './components/Inventory'
import Adjustments from './components/Adjustments'
import Sidebar from './components/Sidebar'
import WelcomeScreen from './components/WelcomeScreen'
import useThemeStore from './store/themeStore'

const ALLOWED_TABS = new Set(['dashboard', 'counter', 'inventory', 'adjustments'])
const STORAGE_KEY = 'fc_entered'

function getInitialTab() {
  try {
    const hash = window.location.hash.replace('#', '').trim().toLowerCase()
    if (ALLOWED_TABS.has(hash)) return hash
    const params = new URLSearchParams(window.location.search)
    const requestedTab = (params.get('tab') || '').trim().toLowerCase()
    if (ALLOWED_TABS.has(requestedTab)) return requestedTab
  } catch { /* fallback */ }
  return 'dashboard'
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
  const [tab, setTabState] = useState(getInitialTab)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const initTheme = useThemeStore(s => s.initTheme)

  useEffect(() => { initTheme() }, [initTheme])

  // Keep hash in sync on popstate (back/forward)
  useEffect(() => {
    function onHashChange() {
      const hash = window.location.hash.replace('#', '').trim().toLowerCase()
      if (ALLOWED_TABS.has(hash)) setTabState(hash)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const setTab = useCallback((newTab) => {
    setTabState(newTab)
    window.location.hash = newTab
    setMobileMenuOpen(false)
  }, [])

  const handleEnter = useCallback(() => {
    try { sessionStorage.setItem(STORAGE_KEY, '1') } catch { /* ignore */ }
    setShowWelcome(false)
  }, [])

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
              {tab === 'dashboard' && <Dashboard />}
              {tab === 'counter' && <Counter />}
              {tab === 'inventory' && <Inventory />}
              {tab === 'adjustments' && <Adjustments />}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
      </motion.div>
    </>
  )
}
