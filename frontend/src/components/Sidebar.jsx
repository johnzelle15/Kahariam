import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import logoImg from '../assets/logo.svg'
import {
  LayoutDashboard,
  ScanLine,
  Package,
  Settings2,
  Settings,
  ChevronLeft,
  ChevronRight,
  X,
  Sun,
  Moon,
  LogOut,
} from 'lucide-react'
import useThemeStore, { THEMES } from '../store/themeStore'
import useAuthStore from '../store/authStore'
import Modal from './ui/Modal'
import Button from './ui/Button'

/* Grouped by what the operator is doing, not by an alphabet. Counting and
   selling are the daily jobs; the records behind them are consulted, not
   worked; Settings is neither. Five flat items gave no clue that Counter is
   used hourly and Settings monthly. */
const ALL_NAV_ITEMS = [
  { id: 'dashboard',   group: 'Daily',   label: 'Dashboard',   icon: LayoutDashboard, tooltip: 'Stock, revenue & activity',  adminOnly: true },
  { id: 'counter',     group: 'Daily',   label: 'Counter',     icon: ScanLine,        tooltip: 'Live fish counting',         adminOnly: false },
  { id: 'inventory',   group: 'Records', label: 'Inventory',   icon: Package,         tooltip: 'Manage stock records',       adminOnly: true },
  { id: 'adjustments', group: 'Records', label: 'Adjustments', icon: Settings2,       tooltip: 'Record sales & adjustments', adminOnly: true },
  { id: 'settings',    group: 'System',  label: 'Settings',    icon: Settings,        tooltip: 'Account & system settings',  adminOnly: false },
]

/** [{ group, items }] in declaration order, skipping groups the role can't see. */
function groupNav(items) {
  const out = []
  items.forEach(item => {
    const last = out[out.length - 1]
    if (last && last.group === item.group) last.items.push(item)
    else out.push({ group: item.group, items: [item] })
  })
  return out
}

const THEME_ICONS = { dark: Moon, light: Sun }

function ThemeSwitcher({ collapsed }) {
  const { theme, setTheme } = useThemeStore()

  if (collapsed) {
    const next = theme === 'dark' ? 'light' : 'dark'
    const Icon = THEME_ICONS[theme]
    return (
      <button
        onClick={() => setTheme(next)}
        className="nav-action w-full flex items-center justify-center p-2 rounded-lg border-none cursor-pointer tap-feedback"
        style={{ background: 'var(--btn-secondary-bg)' }}
        title={`Theme: ${THEMES[theme].label} — click to switch`}
        aria-label={`Switch to ${THEMES[next].label} theme`}
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

function LogoutButton({ collapsed }) {
  const logout = useAuthStore(s => s.logout)
  const user = useAuthStore(s => s.user)
  const [confirming, setConfirming] = React.useState(false)

  const confirmModal = (
    <Modal
      open={confirming}
      onClose={() => setConfirming(false)}
      title="Sign out?"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
          <Button variant="danger" icon={LogOut} onClick={logout}>Sign out</Button>
        </>
      }
    >
      <p className="text-sm text-text-secondary">
        {user?.username ? `You'll be signed out of ${user.username}'s account.` : "You'll be signed out."}
      </p>
    </Modal>
  )

  if (collapsed) {
    return (
      <>
        <button
          onClick={() => setConfirming(true)}
          className="nav-action nav-action-danger w-full flex items-center justify-center p-2 rounded-lg border-none cursor-pointer"
          style={{ color: 'var(--accent-red)' }}
          title="Sign out"
          aria-label="Sign out"
        >
          <LogOut className="w-4 h-4" />
        </button>
        {confirmModal}
      </>
    )
  }

  return (
    <>
      <button
        onClick={() => setConfirming(true)}
        className="nav-action nav-action-danger w-full flex items-center gap-2 px-3 py-2 rounded-lg border-none cursor-pointer text-xs font-medium"
      >
        <LogOut className="w-3.5 h-3.5" />
        <span className="truncate">{user?.username ? `Sign out (${user.username})` : 'Sign out'}</span>
      </button>
      {confirmModal}
    </>
  )
}

export default function Sidebar({ tab, setTab, collapsed, onToggle, mobileOpen, onMobileClose }) {
  const user = useAuthStore(s => s.user)
  const isAdmin = user?.role === 'admin'
  const NAV_ITEMS = ALL_NAV_ITEMS.filter(item => isAdmin || !item.adminOnly)

  const navContent = (isMobile) => (
    <>
      {/* Logo */}
      <div className={`flex items-center gap-3 px-5 py-6 [@media(max-height:620px)]:py-2 shrink-0 ${!isMobile && collapsed ? 'justify-center px-3' : ''}`}
        style={{ borderBottom: '1px solid var(--glass-border)' }}>
        {/* object-contain, not cover: the mark is wider than it is tall, so
            cover was cropping its sides off inside the square. The SVG is
            transparent, so it needs no tile behind it. When the rail is
            collapsed the mark is the only branding left, so it keeps a label. */}
        <img
          src={logoImg}
          alt={!isMobile && collapsed ? 'Kahariam Farms' : ''}
          className="w-9 h-9 flex-shrink-0 object-contain"
        />
        {(isMobile || !collapsed) && (
          <div className="overflow-hidden flex-1">
            <h1 className="text-sm font-bold leading-tight truncate" style={{ color: 'var(--text-primary)' }}>
              Kahariam Farms
            </h1>
            <p className="text-xs font-medium tracking-wider uppercase" style={{ color: 'var(--text-muted)' }}>
              Fish Management
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
      {/* min-h-0 + overflow-y-auto is what keeps the rail inside its own h-screen
          box. Without it `flex-1` cannot shrink below the buttons' intrinsic
          height, so on the 800x480 panel — where the browser leaves ~390px of
          page — the rail's ~530px of content spilled past the bottom of the
          screen and dragged the whole document to 530px with it. Every screen
          in the app then scrolled, no matter how short its own content was. */}
      <nav className="flex-1 min-h-0 overflow-y-auto py-3 [@media(max-height:620px)]:py-1 px-1.5"
        aria-label="Main navigation">
        {groupNav(NAV_ITEMS).map(({ group, items }) => (
          <div key={group} className="nav-group">
            {/* The group label is what a collapsed rail cannot show, so there it
                becomes a hairline separator instead of vanishing silently. */}
            {(isMobile || !collapsed)
              ? <p className="nav-group-label">{group}</p>
              : <hr className="nav-group-rule" />}
            <ul className="list-none m-0 p-0 flex flex-col gap-0.5">
              {items.map(item => {
                const Icon = item.icon
                const isActive = tab === item.id
                return (
                  <li key={item.id}>
                    <button
                      onClick={() => setTab(item.id)}
                      title={!isMobile && collapsed ? item.tooltip : undefined}
                      aria-current={isActive ? 'page' : undefined}
                      className={`
                        nav-item group relative flex w-full items-center gap-2.5 rounded-lg
                        border-none cursor-pointer tap-feedback
                        ${!isMobile && collapsed ? 'justify-center p-2.5' : 'px-3 py-2'}
                      `}
                    >
                      {isActive && (
                        <motion.span
                          layoutId="nav-indicator"
                          className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-5 rounded-r"
                          style={{ background: 'var(--accent-green)' }}
                          transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                          aria-hidden="true"
                        />
                      )}

                      {/* No hover scale on the icon: a nav item is a destination,
                          not a thing that reacts. The colour and ground already
                          say it is under the pointer. */}
                      <Icon size={17} className="flex-shrink-0" aria-hidden="true" />

                      {(isMobile || !collapsed)
                        ? <span className="text-[13px] font-medium truncate">{item.label}</span>
                        : <span className="sr-only">{item.label}</span>}

                      {!isMobile && collapsed && (
                        <span className="nav-tooltip" aria-hidden="true">{item.label}</span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Theme switcher */}
      <div className="px-3 pb-2 [@media(max-height:620px)]:pb-1 shrink-0" style={{ borderTop: '1px solid var(--glass-border)' }}>
        <div className="pt-3 [@media(max-height:620px)]:pt-1.5">
          <ThemeSwitcher collapsed={!isMobile && collapsed} />
        </div>
      </div>

      {/* Logout */}
      <div className="px-3 pb-1 shrink-0">
        <LogoutButton collapsed={!isMobile && collapsed} />
      </div>

      {/* Collapse toggle (desktop only) — the one control here that is pure
          chrome, so it is what goes when the rail has no room to spare. */}
      {!isMobile && (
        <div className="p-3 [@media(max-height:620px)_and_(max-width:1279px)]:hidden">
          <button
            onClick={onToggle}
            className="nav-action w-full flex items-center justify-center p-2 rounded-lg border-none cursor-pointer"
            style={{ background: 'var(--btn-secondary-bg)' }}
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
          hidden md:flex h-full flex-shrink-0 flex-col
          transition-all duration-300 ease-in-out z-50
          ${collapsed ? 'w-[72px]' : 'w-[240px]'}
        `}
        style={{
          background: 'var(--sidebar-bg)',
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
