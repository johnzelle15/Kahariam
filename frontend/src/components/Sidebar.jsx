import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard,
  ScanLine,
  Package,
  Settings2,
  ChevronLeft,
  ChevronRight,
  Fish,
  X,
  Sun,
  Moon,
  Droplets,
} from 'lucide-react'
import useThemeStore, { THEMES } from '../store/themeStore'

const NAV_ITEMS = [
  { id: 'dashboard',   label: 'Dashboard',   icon: LayoutDashboard, tooltip: 'View analytics & KPIs' },
  { id: 'counter',     label: 'Counter',     icon: ScanLine,        tooltip: 'Live fish counting' },
  { id: 'inventory',   label: 'Inventory',   icon: Package,         tooltip: 'Manage stock records' },
  { id: 'adjustments', label: 'Adjustments', icon: Settings2,       tooltip: 'Record sales & adjustments' },
]

const THEME_ICONS = { dark: Moon, light: Sun, aqua: Droplets }

function ThemeSwitcher({ collapsed }) {
  const { theme, setTheme } = useThemeStore()

  if (collapsed) {
    // Cycle through themes on click when collapsed
    const order = ['dark', 'light', 'aqua']
    const next = order[(order.indexOf(theme) + 1) % order.length]
    const Icon = THEME_ICONS[theme]
    return (
      <button
        onClick={() => setTheme(next)}
        className="w-full flex items-center justify-center p-2 rounded-lg transition-colors duration-150 border-none cursor-pointer"
        style={{ color: 'var(--text-muted)', background: 'var(--btn-secondary-bg)' }}
        title={`Theme: ${THEMES[theme].label} — click to switch`}
      >
        <Icon className="w-4 h-4" />
      </button>
    )
  }

  return (
    <div className="theme-pill">
      {Object.values(THEMES).map(t => {
        const Icon = THEME_ICONS[t.id]
        return (
          <button key={t.id} onClick={() => setTheme(t.id)} data-active={theme === t.id}>
            <span className="flex items-center gap-1">
              <Icon className="w-3 h-3" />
              {t.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export default function Sidebar({ tab, setTab, collapsed, onToggle, mobileOpen, onMobileClose }) {
  const navContent = (isMobile) => (
    <>
      {/* Logo */}
      <div className={`flex items-center gap-3 px-5 py-6 ${!isMobile && collapsed ? 'justify-center px-3' : ''}`}
        style={{ borderBottom: '1px solid var(--glass-border)' }}>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-blue))' }}>
          <Fish className="w-5 h-5 text-white" />
        </div>
        {(isMobile || !collapsed) && (
          <div className="overflow-hidden flex-1">
            <h1 className="text-sm font-bold leading-tight truncate" style={{ color: 'var(--text-primary)' }}>
              Aquaculture
            </h1>
            <p className="text-[10px] font-medium tracking-wider uppercase" style={{ color: 'var(--text-muted)' }}>
              Management
            </p>
          </div>
        )}
        {isMobile && (
          <button onClick={onMobileClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors ml-auto border-none cursor-pointer"
            style={{ color: 'var(--text-muted)', background: 'transparent' }}
            aria-label="Close menu">
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-3 flex flex-col gap-1" role="navigation" aria-label="Main navigation">
        {NAV_ITEMS.map(item => {
          const Icon = item.icon
          const isActive = tab === item.id
          return (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              title={!isMobile && collapsed ? item.tooltip : undefined}
              aria-label={item.label}
              aria-current={isActive ? 'page' : undefined}
              className={`
                group relative flex items-center gap-3 rounded-xl
                transition-all duration-200 border-none cursor-pointer
                ${!isMobile && collapsed ? 'justify-center p-3' : 'px-4 py-3'}
              `}
              style={{
                color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                background: isActive
                  ? 'var(--glass-bg-hover)'
                  : 'transparent',
                boxShadow: isActive ? '0 1px 4px rgba(0, 0, 0, 0.06)' : 'none',
              }}
              onMouseEnter={e => {
                if (!isActive) {
                  e.currentTarget.style.background = 'var(--glass-bg-hover)'
                  e.currentTarget.style.color = 'var(--text-primary)'
                }
              }}
              onMouseLeave={e => {
                if (!isActive) {
                  e.currentTarget.style.background = 'transparent'
                  e.currentTarget.style.color = 'var(--text-muted)'
                }
              }}
            >
              {isActive && (
                <motion.div
                  layoutId="nav-indicator"
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 rounded-r-full"
                  style={{ background: 'var(--accent-purple)' }}
                  transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                />
              )}

              <Icon className={`w-5 h-5 flex-shrink-0 transition-all duration-200
                ${isActive ? '' : 'group-hover:scale-105'}
              `} />

              {(isMobile || !collapsed) && (
                <span className="text-sm font-semibold truncate">{item.label}</span>
              )}

              {!isMobile && collapsed && (
                <div className="
                  absolute left-full ml-3 top-1/2 -translate-y-1/2
                  px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap
                  opacity-0 pointer-events-none group-hover:opacity-100
                  transition-opacity duration-150 z-[100]
                "
                  style={{
                    background: 'var(--tooltip-bg)',
                    border: '1px solid var(--tooltip-border)',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                    color: 'var(--text-primary)',
                  }}
                >
                  {item.label}
                </div>
              )}
            </button>
          )
        })}
      </nav>

      {/* Theme switcher */}
      <div className="px-3 pb-2" style={{ borderTop: '1px solid var(--glass-border)' }}>
        <div className="pt-3">
          <ThemeSwitcher collapsed={!isMobile && collapsed} />
        </div>
      </div>

      {/* Collapse toggle (desktop only) */}
      {!isMobile && (
        <div className="p-3">
          <button
            onClick={onToggle}
            className="w-full flex items-center justify-center p-2 rounded-lg
              transition-colors duration-150 border-none cursor-pointer"
            style={{ color: 'var(--text-muted)', background: 'var(--btn-secondary-bg)' }}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>
      )}
    </>
  )

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={`
          hidden md:flex sticky top-0 h-screen flex-shrink-0 flex-col
          transition-all duration-300 ease-in-out z-50
          ${collapsed ? 'w-[72px]' : 'w-[240px]'}
        `}
        style={{
          background: 'var(--sidebar-bg)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderRight: '1px solid var(--sidebar-border)',
          boxShadow: '2px 0 16px rgba(0, 0, 0, 0.12)',
        }}
      >
        {navContent(false)}
      </aside>

      {/* Mobile overlay */}
      <AnimatePresence>
        {mobileOpen && (
          <div className="fixed inset-0 z-50 md:hidden">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              onClick={onMobileClose}
            />
            <motion.aside
              initial={{ x: -260 }}
              animate={{ x: 0 }}
              exit={{ x: -260 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="absolute inset-y-0 left-0 w-[260px] flex flex-col"
              style={{
                background: 'var(--sidebar-bg)',
                backdropFilter: 'blur(24px)',
                WebkitBackdropFilter: 'blur(24px)',
                borderRight: '1px solid var(--sidebar-border)',
                boxShadow: '2px 0 16px rgba(0, 0, 0, 0.25)',
              }}
            >
              {navContent(true)}
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </>
  )
}
