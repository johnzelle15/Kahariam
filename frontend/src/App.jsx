import React, { useState, useCallback, useEffect, lazy, Suspense } from 'react'
import { motion, AnimatePresence, MotionConfig } from 'framer-motion'
import Counter from './components/Counter'
import { LoadingState } from './components/ui'
import Sidebar from './components/Sidebar'
import WelcomeScreen from './components/WelcomeScreen'
import LoginScreen from './components/LoginScreen'
import ResetPassword from './components/ResetPassword'
import useThemeStore from './store/themeStore'
import useAuthStore from './store/authStore'

/* Counter is loaded eagerly: it is the kiosk screen and the default tab for
   staff, so it must paint immediately. The rest are split out — between them
   they pull in the charting, spreadsheet and image-export libraries, which is
   most of the bundle the Pi panel used to parse before showing anything. */
const Dashboard = lazy(() => import('./components/Dashboard'))
const Inventory = lazy(() => import('./components/Inventory'))
const Adjustments = lazy(() => import('./components/Adjustments'))
const Settings = lazy(() => import('./components/Settings/index'))

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

/* A short cross-fade only. The previous slide re-animated the whole screen on
   every tab switch, which delayed the first read of the data on the hardware
   least able to afford it. */
const pageVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.12 } },
  exit: { opacity: 0, transition: { duration: 0.08 } },
}

export default function App() {
  const [showWelcome, setShowWelcome] = useState(!hasEntered())
  // Auto-collapse on tablet / Pi widths: at 1024px an expanded 240px rail is a
  // quarter of the screen, and the manual toggle was a step every user repeated.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 1280
  )
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const initTheme = useThemeStore(s => s.initTheme)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const user = useAuthStore(s => s.user)
  const role = user?.role || 'staff'
  const allowedTabs = getAllowedTabs(role)

  const [tab, setTabState] = useState(() => getInitialTab(role))

  useEffect(() => { initTheme() }, [initTheme])

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1279px)')
    const apply = e => setSidebarCollapsed(e.matches)
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  // If role changes or tab is not allowed, reset to default
  useEffect(() => {
    if (!allowedTabs.has(tab)) setTabState(getDefaultTab(role))
  }, [role, tab, allowedTabs])

  /* The initial tab is resolved on the very first render — before anyone has
     logged in — so `role` is still the 'staff' fallback and the tab lands on
     the staff default, Counter. The guard above only rescues a tab that is
     *disallowed*, and Counter is allowed for admins too, so nothing ever
     corrected it: an admin signed in and landed on Counter every single time.
     Re-resolve once the real role arrives. `setTab` writes the hash on every
     manual navigation and getInitialTab reads the hash first, so this cannot
     stomp a tab the operator picked while the profile was still loading. */
  useEffect(() => {
    if (user?.role) setTabState(getInitialTab(user.role))
  }, [user?.role])

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
    <MotionConfig reducedMotion="user">
      <AnimatePresence>
        {showWelcome && <WelcomeScreen onEnter={handleEnter} />}
      </AnimatePresence>

      {/* App shell owns the height; <main> is the only scroller.
          Letting the document scroll meant that whenever the dashboard came out
          a hair taller than the screen — 742px against 740 at the operator's
          browser zoom — a touch drag had two pixels of travel to work with and
          the whole page bounced back against the finger, which reads as the
          screen shaking. With the document pinned to the viewport there is no
          page-level scroll to rubber-band, sideways or vertically, and content
          that genuinely overflows scrolls inside the pane instead. */}
      <motion.div
        className="flex h-dvh overflow-hidden bg-dark-900"
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
      {/* The pane is its own positioned box so the watermark can sit centred in
          it and stay put. <main> is the scroller, and anything placed inside it
          would travel up the screen with the content. */}
      <div className="relative flex-1 min-w-0 flex">
      <main className="flex-1 min-w-0 overflow-y-auto overscroll-contain transition-all duration-300
        flex flex-col">
        {/* ── Mobile top bar ──
               Sticky inside the scroller, not fixed over it. As `position:
               fixed` it sat on top of the page and the page was pushed down by
               a hardcoded pt-16 — 64px, sized for the 36px menu button. The
               `pointer: coarse` rule then grew that button to a 44px touch
               target, the bar became 69px, and on every phone the page title
               started 5px underneath it before anything had scrolled. Sticky
               reserves its own height in the flow, so there is no number to
               keep in step with it.

               Opaque, too. At rgb(… / 0.95) with no blur, whatever scrolled
               beneath the bar showed through it — the page header read as a
               ghost behind "Kahariam Farms", which is the overlap the phone
               screenshot showed. ── */}
        <div className="sticky top-0 z-40 md:hidden shrink-0 flex items-center gap-3 px-4 py-3
          bg-dark-900 border-b border-[var(--glass-border)]">
          <button onClick={() => setMobileMenuOpen(true)}
            className="w-11 h-11 -my-1 -ml-2 rounded-lg flex items-center justify-center text-text-secondary
              hover:text-text-primary hover:bg-[var(--btn-secondary-bg)] transition-colors
              focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-green"
            aria-label="Open menu">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
          </button>
          <span className="text-sm font-bold text-text-primary">Kahariam Farms</span>
        </div>

        {/* `grow shrink-0`, not min-h-full: with the bar now inside <main>,
            min-h-full would make the page 100% of the pane *plus* the bar, and
            every screen that fits a phone exactly would scroll by 69px. As a
            flex child it fills whatever the bar leaves and still grows past
            that with its content. No min-h-0 anywhere in this chain on purpose:
            a flex item's default min-height:auto is what stops a card being
            squeezed below its own content, which is the difference between the
            chart getting smaller and the chart getting cut off. */}
        <div className="p-4 md:pt-6 md:px-6 lg:px-8 lg:py-6 max-w-[1760px] w-full mx-auto
          [@media(max-height:620px)]:md:py-2 [@media(max-height:620px)]:md:px-4
          [@media(max-height:620px)]:md:pb-4
          grow shrink-0 flex flex-col">
          <AnimatePresence mode="wait">
            {/* `[&>*]:w-full`: in a flex column a child with auto side margins
                is not stretched — it shrinks to fit its content instead. So a
                page written the block way, `max-w-5xl mx-auto`, was exactly as
                wide as its widest descendant: Inventory measured 726px on a
                360px phone because its table asked for 700, and the whole page
                scrolled sideways. Full width first, then the page's own cap. */}
            <motion.div key={tab} variants={pageVariants} initial="initial" animate="animate" exit="exit"
              className="grow flex flex-col [&>*]:w-full">
              <Suspense fallback={<LoadingState rows={4} />}>
                {tab === 'dashboard' && allowedTabs.has('dashboard') && <Dashboard />}
                {tab === 'counter' && <Counter />}
                {tab === 'inventory' && allowedTabs.has('inventory') && <Inventory />}
                {tab === 'adjustments' && allowedTabs.has('adjustments') && <Adjustments />}
                {tab === 'settings' && allowedTabs.has('settings') && <Settings />}
              </Suspense>
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
      <div aria-hidden="true" className="watermark" />
      </div>
      </motion.div>
    </MotionConfig>
  )
}
