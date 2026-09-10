/**
 * Settings — Main page with animated tab navigation.
 * Tabs: Account | Security | System (admin only)
 * Role-based: Staff sees Account + Security; admin sees all 3 tabs.
 */
import React, { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { User, Shield, Users, Lock } from 'lucide-react'
import { Badge, PageHeader } from '../ui'
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
            className={`pointer-events-auto flex items-center gap-3 px-3.5 py-2.5 rounded-lg
              border text-xs font-medium min-w-[240px] max-w-[380px] shadow-lg ${
              t.type === 'success' ? 'bg-positive/10 border-positive/30 text-positive'
              : t.type === 'error' ? 'bg-negative/10 border-negative/30 text-negative'
              : 'bg-info/10 border-info/30 text-info'}`}
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
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.12 } },
  exit:    { opacity: 0, transition: { duration: 0.08 } },
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
      {/* Settings is a page of forms, and a form field is unreadable at 1360px.
          The column is capped at a measure the eye can track along; the pane
          keeps its own margins around it rather than stretching the inputs. */}
      <div className="w-full max-w-4xl flex flex-col gap-section">

        <PageHeader
          title="Settings"
          meta={user?.username ? `@${user.username}` : undefined}
          actions={
            <Badge variant={isAdmin ? 'info' : 'neutral'} className="gap-1 uppercase tracking-wider">
              <Shield size={11} aria-hidden="true" />
              {isAdmin ? 'Admin' : 'Staff'}
            </Badge>
          }
        />

        {/* Staff access-level notice — the same treatment as every other
            advisory band in the app, rather than its own blue rgba. */}
        {!isAdmin && (
          <p role="note" className="flex items-start gap-2 rounded-lg border border-info/25
            bg-info/10 px-3 py-2 text-xs leading-snug text-info">
            <Lock size={13} className="shrink-0 mt-px" aria-hidden="true" />
            System administration is restricted to admin accounts. Ask an
            administrator to make changes here.
          </p>
        )}

        {/* ── Tabs ──
               Real tab semantics, so a screen reader announces "tab 2 of 3,
               selected" and arrow keys move between them. They were plain
               buttons with no role, no aria-selected and no keyboard model. ── */}
        <div>
          <div className="tabs" role="tablist" aria-label="Settings sections">
            {tabs.map((t, i) => {
              const Icon = t.icon
              const isActive = activeTab === t.id
              return (
                <button
                  key={t.id}
                  id={`tab-${t.id}`}
                  role="tab"
                  type="button"
                  aria-selected={isActive}
                  aria-controls={`panel-${t.id}`}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => setActiveTab(t.id)}
                  onKeyDown={e => {
                    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
                    if (!step) return
                    e.preventDefault()
                    const next = tabs[(i + step + tabs.length) % tabs.length]
                    setActiveTab(next.id)
                    document.getElementById(`tab-${next.id}`)?.focus()
                  }}
                  className="tab"
                >
                  <Icon size={14} aria-hidden="true" />
                  {t.label}
                </button>
              )
            })}
          </div>

          <div
            id={`panel-${activeTab}`}
            role="tabpanel"
            aria-labelledby={`tab-${activeTab}`}
            tabIndex={0}
            className="mt-4 [@media(max-height:620px)]:mt-2 focus-visible:outline-none"
          >
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
