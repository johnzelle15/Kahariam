/**
 * NotificationsTab — Toggle email, inventory, revenue, anomaly, task, and system alerts.
 */
import React, { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import {
  Bell, Mail, Package, DollarSign, Fish, CheckSquare,
  AlertTriangle, Loader2, Save,
} from 'lucide-react'
import api from '../../utils/api'

/* ── Card ──────────────────────────────────────────────────────────────────── */
function SettingsCard({ title, description, children }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className="rounded-2xl p-5 md:p-6"
      style={{
        background: 'var(--glass-bg)',
        border: '1px solid var(--glass-border)',
        backdropFilter: 'blur(16px)',
      }}
    >
      {(title || description) && (
        <div className="mb-5">
          {title && <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h3>}
          {description && <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{description}</p>}
        </div>
      )}
      {children}
    </motion.div>
  )
}

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className="relative rounded-full border-none cursor-pointer transition-all duration-200"
      style={{
        width: '40px', height: '22px',
        background: checked ? 'var(--accent-purple)' : 'var(--glass-border-hover)',
        boxShadow: checked ? '0 0 8px rgba(139,92,246,0.35)' : 'none',
        opacity: disabled ? 0.5 : 1,
        flexShrink: 0,
      }}
    >
      <span
        className="absolute top-[3px] rounded-full transition-transform duration-200"
        style={{
          width: '16px', height: '16px',
          background: '#fff',
          left: '3px',
          transform: checked ? 'translateX(18px)' : 'translateX(0)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        }}
      />
    </button>
  )
}

function Skeleton({ height = 52, className = '' }) {
  return (
    <div className={`rounded-xl animate-pulse ${className}`}
      style={{ height, background: 'var(--skeleton-via)' }} />
  )
}

const NOTIF_ITEMS = [
  {
    key:         'email_notifications',
    label:       'Email Notifications',
    description: 'Receive all alerts via email',
    icon:        Mail,
    accent:      'var(--accent-blue)',
  },
  {
    key:         'inventory_alerts',
    label:       'Inventory Alerts',
    description: 'Low stock and inventory change notifications',
    icon:        Package,
    accent:      'var(--accent-cyan)',
  },
  {
    key:         'revenue_alerts',
    label:       'Revenue Alerts',
    description: 'Daily revenue milestones and anomalies',
    icon:        DollarSign,
    accent:      'var(--accent-green)',
  },
  {
    key:         'anomaly_alerts',
    label:       'Fish Count Anomalies',
    description: 'Unusual fish count detections',
    icon:        Fish,
    accent:      'var(--accent-purple)',
  },
  {
    key:         'task_reminders',
    label:       'Task Reminders',
    description: 'Scheduled task and calibration reminders',
    icon:        CheckSquare,
    accent:      'var(--accent-amber)',
  },
  {
    key:         'system_warnings',
    label:       'System Warnings',
    description: 'Hardware errors and connectivity issues',
    icon:        AlertTriangle,
    accent:      'var(--accent-red)',
  },
]

export default function NotificationsTab({ toast }) {
  const [prefs, setPrefs]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)

  const fetchPrefs = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/settings/notification-prefs')
      setPrefs(data)
    } catch {
      // Use safe defaults
      setPrefs({
        email_notifications: true,
        inventory_alerts:    true,
        revenue_alerts:      true,
        anomaly_alerts:      true,
        task_reminders:      true,
        system_warnings:     true,
      })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchPrefs() }, [fetchPrefs])

  async function handleSave() {
    if (!prefs) return
    setSaving(true)
    try {
      await api.put('/settings/notification-prefs', prefs)
      toast('Notification preferences saved', 'success')
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to save preferences', 'error')
    } finally {
      setSaving(false)
    }
  }

  function setKey(key, val) {
    setPrefs(p => ({ ...p, [key]: val }))
  }

  return (
    <div className="flex flex-col gap-5">
      <SettingsCard
        title="Notification Preferences"
        description="Choose which events trigger notifications"
      >
        {loading ? (
          <div className="flex flex-col gap-3">
            {[...Array(6)].map((_, i) => <Skeleton key={i} />)}
          </div>
        ) : (
          <div className="flex flex-col">
            {NOTIF_ITEMS.map((item, idx) => {
              const Icon = item.icon
              const isLast = idx === NOTIF_ITEMS.length - 1
              return (
                <motion.div
                  key={item.key}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.04, duration: 0.2 }}
                  className="flex items-center justify-between gap-4 py-3.5"
                  style={{ borderBottom: isLast ? 'none' : '1px solid var(--table-border)' }}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: `${item.accent}18`, color: item.accent }}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {item.label}
                      </p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {item.description}
                      </p>
                    </div>
                  </div>
                  <Toggle
                    checked={prefs[item.key] ?? true}
                    onChange={v => setKey(item.key, v)}
                  />
                </motion.div>
              )
            })}
          </div>
        )}
      </SettingsCard>

      {/* Save */}
      {!loading && (
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold
              transition-all duration-200 border-none cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            style={{
              background: 'linear-gradient(135deg, #8B5CF6, #6366f1)',
              color: '#fff',
              boxShadow: '0 4px 14px rgba(139,92,246,0.25)',
            }}
            onMouseEnter={e => { if (!saving) e.currentTarget.style.boxShadow = '0 4px 20px rgba(139,92,246,0.4)' }}
            onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 4px 14px rgba(139,92,246,0.25)' }}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Saving…' : 'Save Preferences'}
          </button>
        </div>
      )}
    </div>
  )
}
