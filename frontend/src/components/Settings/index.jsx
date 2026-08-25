/**
 * Settings — Main page with animated tab navigation.
 * Tabs: Account | Security | System (admin only)
 * Role-based: Staff sees Account + Security; admin sees all 3 tabs.
 */
import React, { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  User, Shield, Users, ChevronRight, Lock,
} from 'lucide-react'
import useAuthStore from '../../store/authStore'
import AccountTab  from './AccountTab'
import SecurityTab from './SecurityTab'
import UsersTab    from './UsersTab'

/* ── Tab definitions ────────────────────────────────────────────────────────── */
const ALL_TABS = [
  { id: 'account',  label: 'Account',  icon: User,   adminOnly: false },
  { id: 'security', label: 'Security', icon: Shield, adminOnly: false },
  { id: 'users',    label: 'Users',    icon: Users,  adminOnly: true  },
]

/* ── Toast context ──────────────────────────────────────────────────────────── */
export const ToastContext = React.createContext(null)

function ToastContainer({ toasts, dismiss }) {
  return (
    <div className="fixed bottom-5 right-5 z-[200] flex flex-col gap-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map(t => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, x: 60, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 60, scale: 0.9 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            className="pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl text-sm font-medium min-w-[260px] max-w-[380px]"
            style={{
              background: t.type === 'success'
                ? 'rgba(16,185,129,0.12)'
                : t.type === 'error'
                  ? 'rgba(239,68,68,0.12)'
                  : 'rgba(96,165,250,0.12)',
              border: `1px solid ${
                t.type === 'success' ? 'rgba(16,185,129,0.3)'
                : t.type === 'error'  ? 'rgba(239,68,68,0.3)'
                : 'rgba(96,165,250,0.3)'
              }`,
              color: t.type === 'success' ? '#34d399'
                   : t.type === 'error'   ? '#f87171'
                   : '#60a5fa',
              backdropFilter: 'blur(16px)',
            }}
            onClick={() => dismiss(t.id)}
          >
            <span className="flex-1">{t.message}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

function useToast() {
  const [toasts, setToasts] = useState([])
  const toast = useCallback((message, type = 'info', duration = 3500) => {
    const id = Date.now() + Math.random()
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration)
  }, [])
  const dismiss = useCallback((id) => setToasts(prev => prev.filter(t => t.id !== id)), [])
  return { toasts, toast, dismiss }
}

/* ── Page transition variants ───────────────────────────────────────────────── */
const tabVariants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.22, ease: [0.4, 0, 0.2, 1] } },
  exit:    { opacity: 0, y: -6, transition: { duration: 0.15 } },
}

/* ── Settings Page ──────────────────────────────────────────────────────────── */
export default function Settings() {
  const user    = useAuthStore(s => s.user)
  const isAdmin = user?.role === 'admin'
  const { toasts, toast, dismiss } = useToast()

  const tabs = ALL_TABS.filter(t => isAdmin || !t.adminOnly)
  const [activeTab, setActiveTab] = useState('account')

  const renderTab = () => {
    switch (activeTab) {
      case 'account':  return <AccountTab  toast={toast} />
      case 'security': return <SecurityTab toast={toast} />
      case 'users':    return isAdmin ? <UsersTab toast={toast} /> : null
      default:         return null
    }
  }

  return (
    <ToastContext.Provider value={toast}>
      {/* Settings content */}
      <div className="w-full">

        {/* Page header */}
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="mb-6"
        >
          <div className="flex items-center gap-2 mb-1 text-xs"
            style={{ color: 'var(--text-muted)' }}>
            <span>Kahariam Farms</span>
            <ChevronRight className="w-3 h-3" />
            <span style={{ color: 'var(--text-secondary)' }}>Settings</span>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              Settings
            </h1>
            {/* Role badge */}
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider"
              style={{
                background: isAdmin ? 'rgba(167,139,250,0.12)' : 'rgba(96,165,250,0.10)',
                color:      isAdmin ? 'var(--accent-purple)'   : 'var(--accent-blue)',
                border:     `1px solid ${isAdmin ? 'rgba(167,139,250,0.25)' : 'rgba(96,165,250,0.2)'}`,
              }}
            >
              <Shield className="w-3 h-3" />
              {isAdmin ? 'Admin' : 'Staff'}
            </span>
          </div>

          {/* Staff access-level notice */}
          {!isAdmin && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.25 }}
              className="flex items-center gap-2 mt-3 px-3.5 py-2.5 rounded-xl text-xs"
              style={{
                background: 'rgba(96,165,250,0.06)',
                border: '1px solid rgba(96,165,250,0.15)',
                color: 'var(--accent-blue)',
              }}
            >
              <Lock className="w-3.5 h-3.5 flex-shrink-0" />
              <span>
                System administration features are restricted to admin accounts.
                Contact your administrator to request changes.
              </span>
            </motion.div>
          )}
        </motion.div>

        {/* Layout: tab list + content */}
        <div className="flex flex-col lg:flex-row gap-5">

          {/* ── Tab list (sidebar on lg+, horizontal scroll on mobile) ─── */}
          <motion.nav
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, delay: 0.05 }}
            className="lg:w-52 flex-shrink-0"
          >
            {/* Mobile: horizontal scroll */}
            <div className="flex lg:flex-col gap-1 overflow-x-auto pb-1 lg:pb-0 lg:overflow-visible
              scrollbar-hide snap-x snap-mandatory">
              {tabs.map(t => {
                const Icon = t.icon
                const isActive = activeTab === t.id
                return (
                  <button
                    key={t.id}
                    onClick={() => setActiveTab(t.id)}
                    className="relative flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-sm font-medium
                      transition-all duration-200 border-none cursor-pointer whitespace-nowrap
                      snap-start flex-shrink-0"
                    style={{
                      color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                      background: isActive ? 'var(--glass-bg-hover)' : 'transparent',
                    }}
                    onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background = 'var(--glass-bg)'; e.currentTarget.style.color = 'var(--text-secondary)' } }}
                    onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)' } }}
                  >
                    {isActive && (
                      <motion.div
                        layoutId="settings-tab-bg"
                        className="absolute inset-0 rounded-xl"
                        style={{
                          background: 'var(--glass-bg-hover)',
                          border: '1px solid var(--glass-border)',
                        }}
                        transition={{ type: 'spring', stiffness: 400, damping: 35 }}
                      />
                    )}
                    <Icon className="relative w-4 h-4 flex-shrink-0" />
                    <span className="relative">{t.label}</span>
                    {isActive && (
                      <motion.div
                        layoutId="settings-tab-indicator"
                        className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-l-full"
                        style={{ background: 'var(--accent-purple)' }}
                        transition={{ type: 'spring', stiffness: 400, damping: 35 }}
                      />
                    )}
                  </button>
                )
              })}
            </div>
          </motion.nav>

          {/* ── Tab content ─────────────────────────────────────────────── */}
          <div className="flex-1 min-w-0">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                variants={tabVariants}
                initial="initial"
                animate="animate"
                exit="exit"
              >
                {renderTab()}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>

      <ToastContainer toasts={toasts} dismiss={dismiss} />
    </ToastContext.Provider>
  )
}
