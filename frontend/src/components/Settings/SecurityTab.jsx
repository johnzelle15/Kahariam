/**
 * SecurityTab — Change password with strength meter, login history,
 *               security activity, and session management.
 */
import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Eye, EyeOff, Lock, Loader2, ShieldCheck, ShieldAlert,
  Monitor, CheckCircle, XCircle, Clock, AlertTriangle,
  Smartphone, Globe, Trash2, LogOut,
} from 'lucide-react'
import api from '../../utils/api'

/* ── Shared primitives ────────────────────────────────────────────────────────── */
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

function Skeleton({ width = '100%', height = 16, className = '' }) {
  return <div className={`rounded-lg animate-pulse ${className}`} style={{ width, height, background: 'var(--skeleton-via)' }} />
}

function PasswordInput({ id, label, value, onChange, disabled, placeholder }) {
  const [show, setShow] = useState(false)
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
          style={{ color: 'var(--text-muted)' }}>
          <Lock className="w-4 h-4" />
        </span>
        <input
          id={id}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete="new-password"
          className="w-full rounded-xl pl-9 pr-10 py-2.5 text-sm outline-none transition-all duration-150"
          style={{
            background: 'var(--input-bg)',
            border: '1px solid var(--input-border)',
            color: 'var(--text-primary)',
            boxShadow: 'var(--input-shadow)',
            opacity: disabled ? 0.5 : 1,
          }}
          onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent-purple)'; e.currentTarget.style.boxShadow = 'var(--input-focus-shadow)' }}
          onBlur={e => { e.currentTarget.style.borderColor = 'var(--input-border)'; e.currentTarget.style.boxShadow = 'var(--input-shadow)' }}
        />
        <button
          type="button"
          onClick={() => setShow(s => !s)}
          className="absolute right-3 top-1/2 -translate-y-1/2 border-none bg-transparent cursor-pointer p-0"
          style={{ color: 'var(--text-muted)' }}
          tabIndex={-1}
          aria-label={show ? 'Hide password' : 'Show password'}
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  )
}

/* ── Password strength meter ─────────────────────────────────────────────────── */
function getStrength(pw) {
  if (!pw) return { label: '', score: 0 }
  let score = 0
  if (pw.length >= 8)  score++
  if (pw.length >= 12) score++
  if (/[A-Z]/.test(pw)) score++
  if (/[a-z]/.test(pw)) score++
  if (/\d/.test(pw))   score++
  if (/[^A-Za-z0-9]/.test(pw)) score++
  if (score <= 2) return { label: 'Weak',   score: 1, color: 'var(--accent-red)' }
  if (score <= 4) return { label: 'Fair',   score: 2, color: 'var(--accent-amber)' }
  return            { label: 'Strong', score: 3, color: 'var(--accent-green)' }
}

function StrengthMeter({ password }) {
  const { label, score, color } = getStrength(password)
  if (!password) return null
  return (
    <div className="flex flex-col gap-1.5 mt-1">
      <div className="flex gap-1">
        {[1, 2, 3].map(i => (
          <div key={i} className="flex-1 h-1.5 rounded-full transition-all duration-300"
            style={{ background: i <= score ? color : 'var(--glass-border)' }} />
        ))}
      </div>
      <span className="text-xs font-medium" style={{ color }}>
        {label}
      </span>
    </div>
  )
}

/* ── Validation indicator ─────────────────────────────────────────────────────── */
function ValidationRule({ met, label }) {
  return (
    <div className="flex items-center gap-1.5">
      {met
        ? <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--accent-green)' }} />
        : <XCircle    className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
      }
      <span className="text-xs" style={{ color: met ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
        {label}
      </span>
    </div>
  )
}

/* ── Confirm modal ────────────────────────────────────────────────────────────── */
function ConfirmModal({ open, onConfirm, onCancel, loading }) {
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0"
            style={{ background: 'var(--modal-overlay)', backdropFilter: 'blur(4px)' }}
            onClick={onCancel}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 10 }}
            transition={{ type: 'spring', stiffness: 340, damping: 28 }}
            className="relative z-10 w-full max-w-sm rounded-2xl p-6"
            style={{
              background: 'rgb(var(--bg-secondary))',
              border: '1px solid var(--glass-border)',
              boxShadow: '0 24px 48px rgba(0,0,0,0.4)',
            }}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--accent-red)' }}>
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Confirm Password Change
                </h3>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  This will update your login credentials.
                </p>
              </div>
            </div>
            <p className="text-sm mb-5" style={{ color: 'var(--text-secondary)' }}>
              Are you sure you want to change your password? You will remain logged in.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={onCancel}
                disabled={loading}
                className="px-4 py-2 rounded-xl text-sm font-medium border-none cursor-pointer transition-colors"
                style={{ background: 'var(--btn-secondary-bg)', color: 'var(--text-secondary)' }}
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border-none cursor-pointer
                  disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200"
                style={{
                  background: 'linear-gradient(135deg, #8B5CF6, #6366f1)',
                  color: '#fff',
                  boxShadow: '0 4px 12px rgba(139,92,246,0.25)',
                }}
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                {loading ? 'Saving…' : 'Confirm'}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

/* ── SecurityTab ──────────────────────────────────────────────────────────────── */
export default function SecurityTab({ toast }) {
  /* Password form */
  const [form, setForm] = useState({ current: '', newPw: '', confirm: '' })
  const [saving, setSaving] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [fieldErrors, setFieldErrors] = useState({})

  /* Login history */
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyPage, setHistoryPage] = useState(1)
  const [historyTotal, setHistoryTotal] = useState(0)
  const HISTORY_LIMIT = 5

  /* Security activity */
  const [activity, setActivity] = useState([])
  const [activityLoading, setActivityLoading] = useState(true)
  // The endpoint returns the last 20; showing all of them buries the rest of the tab.
  const [showAllActivity, setShowAllActivity] = useState(false)
  const ACTIVITY_VISIBLE = 5

  /* Session management */
  const [sessions, setSessions] = useState([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [revokingId, setRevokingId] = useState(null)
  const [logoutAllLoading, setLogoutAllLoading] = useState(false)
  const [showLogoutAllConfirm, setShowLogoutAllConfirm] = useState(false)

  const strength = getStrength(form.newPw)
  const rules = [
    { met: form.newPw.length >= 8,              label: 'At least 8 characters' },
    { met: /[A-Z]/.test(form.newPw),            label: 'Uppercase letter' },
    { met: /[a-z]/.test(form.newPw),            label: 'Lowercase letter' },
    { met: /\d/.test(form.newPw),               label: 'Number' },
    { met: /[^A-Za-z0-9]/.test(form.newPw),    label: 'Special character' },
    { met: form.newPw === form.confirm && !!form.newPw, label: 'Passwords match' },
  ]

  const fetchHistory = useCallback(async (page = 1) => {
    setHistoryLoading(true)
    try {
      const { data } = await api.get('/settings/login-history', {
        params: { page, limit: HISTORY_LIMIT },
      })
      setHistory(data.history || [])
      setHistoryTotal(data.total || 0)
    } catch {
      // silently fail — table may not exist yet
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  const fetchActivity = useCallback(async () => {
    setActivityLoading(true)
    try {
      const { data } = await api.get('/settings/security-activity')
      setActivity(data.events || [])
    } catch {
      // silently fail
    } finally {
      setActivityLoading(false)
    }
  }, [])

  const fetchSessions = useCallback(async () => {
    setSessionsLoading(true)
    try {
      const { data } = await api.get('/settings/sessions')
      setSessions(data.sessions || [])
    } catch {
      // silently fail if table not yet created
    } finally {
      setSessionsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchHistory(1)
    fetchActivity()
    fetchSessions()
  }, [fetchHistory, fetchActivity, fetchSessions])

  useEffect(() => { fetchHistory(historyPage) }, [historyPage, fetchHistory])

  function validateForm() {
    const errs = {}
    if (!form.current) errs.current = 'Current password is required'
    if (!form.newPw)   errs.newPw   = 'New password is required'
    else if (form.newPw.length < 8) errs.newPw = 'Minimum 8 characters'
    else if (strength.score < 2) errs.newPw = 'Password too weak'
    if (form.newPw !== form.confirm) errs.confirm = 'Passwords do not match'
    setFieldErrors(errs)
    return Object.keys(errs).length === 0
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (validateForm()) setShowConfirm(true)
  }

  async function doChangePassword() {
    setSaving(true)
    try {
      await api.put('/settings/password', {
        current_password:  form.current,
        new_password:      form.newPw,
        confirm_password:  form.confirm,
      })
      setShowConfirm(false)
      setForm({ current: '', newPw: '', confirm: '' })
      toast('Password changed successfully', 'success')
      fetchActivity()
    } catch (err) {
      setShowConfirm(false)
      toast(err.response?.data?.error || 'Failed to change password', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleRevokeSession(sessionId) {
    setRevokingId(sessionId)
    try {
      await api.delete(`/settings/sessions/${sessionId}`)
      toast('Session revoked successfully', 'success')
      fetchSessions()
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to revoke session', 'error')
    } finally {
      setRevokingId(null)
    }
  }

  async function handleLogoutAll() {
    setLogoutAllLoading(true)
    try {
      await api.post('/settings/sessions/logout-all')
      toast('All other devices have been logged out', 'success')
      setShowLogoutAllConfirm(false)
      fetchSessions()
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to logout all devices', 'error')
    } finally {
      setLogoutAllLoading(false)
    }
  }

  function parseDeviceString(ua) {
    if (!ua || ua === 'Unknown device') return { name: 'Unknown device', type: 'desktop' }
    const lower = ua.toLowerCase()
    if (/mobile|android|iphone|ipad/.test(lower)) return { name: ua.slice(0, 60), type: 'mobile' }
    return { name: ua.slice(0, 60), type: 'desktop' }
  }

  function formatDate(d) {
    if (!d) return '—'
    try {
      return new Date(d).toLocaleString(undefined, {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    } catch { return d }
  }

  const totalPages = Math.max(1, Math.ceil(historyTotal / HISTORY_LIMIT))

  return (
    <>
      <div className="flex flex-col gap-5">

        {/* ── Change Password ──────────────────────────────────────── */}
        <SettingsCard
          title="Change Password"
          description="Secure your account with a strong password"
        >
          <form onSubmit={handleSubmit} noValidate>
            <div className="flex flex-col gap-4">
              <div>
                <PasswordInput
                  id="current"
                  label="Current Password"
                  value={form.current}
                  onChange={e => setForm(f => ({ ...f, current: e.target.value }))}
                  placeholder="Enter current password"
                />
                {fieldErrors.current && (
                  <p className="mt-1 text-xs" style={{ color: 'var(--accent-red)' }}>{fieldErrors.current}</p>
                )}
              </div>

              <div>
                <PasswordInput
                  id="newpw"
                  label="New Password"
                  value={form.newPw}
                  onChange={e => setForm(f => ({ ...f, newPw: e.target.value }))}
                  placeholder="Enter new password"
                />
                <StrengthMeter password={form.newPw} />
                {fieldErrors.newPw && (
                  <p className="mt-1 text-xs" style={{ color: 'var(--accent-red)' }}>{fieldErrors.newPw}</p>
                )}
              </div>

              <div>
                <PasswordInput
                  id="confirm"
                  label="Confirm New Password"
                  value={form.confirm}
                  onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))}
                  placeholder="Repeat new password"
                />
                {fieldErrors.confirm && (
                  <p className="mt-1 text-xs" style={{ color: 'var(--accent-red)' }}>{fieldErrors.confirm}</p>
                )}
              </div>

              {/* Validation rules */}
              {form.newPw && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="grid grid-cols-2 gap-x-4 gap-y-1.5 p-3 rounded-xl"
                  style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}
                >
                  {rules.map(r => <ValidationRule key={r.label} met={r.met} label={r.label} />)}
                </motion.div>
              )}

              <div className="flex justify-end mt-1">
                <button
                  type="submit"
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold
                    transition-all duration-200 border-none cursor-pointer"
                  style={{
                    background: 'linear-gradient(135deg, #8B5CF6, #6366f1)',
                    color: '#fff',
                    boxShadow: '0 4px 14px rgba(139,92,246,0.25)',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 20px rgba(139,92,246,0.4)' }}
                  onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 4px 14px rgba(139,92,246,0.25)' }}
                >
                  <Lock className="w-4 h-4" />
                  Update Password
                </button>
              </div>
            </div>
          </form>
        </SettingsCard>

        {/* ── Login History ─────────────────────────────────────────── */}
        <SettingsCard
          title="Login History"
          description="Recent sign-in events for your account"
        >
          {historyLoading ? (
            <div className="flex flex-col gap-2">
              {[...Array(4)].map((_, i) => <Skeleton key={i} height={44} />)}
            </div>
          ) : history.length === 0 ? (
            <div className="flex flex-col items-center py-8 gap-2"
              style={{ color: 'var(--text-muted)' }}>
              <Monitor className="w-8 h-8 opacity-40" />
              <p className="text-sm">No login history yet</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto -mx-1">
                <table className="w-full text-sm min-w-[460px]">
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--table-border)' }}>
                      {['Time', 'IP Address', 'Device / Browser', 'Status'].map(h => (
                        <th key={h} className="py-2 px-3 text-left text-xs font-semibold uppercase tracking-wide"
                          style={{ color: 'var(--text-muted)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {history.map(row => (
                      <tr key={row.id}
                        className="transition-colors"
                        style={{ borderBottom: '1px solid var(--table-border)' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--table-row-hover)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        <td className="py-2.5 px-3 text-xs whitespace-nowrap"
                          style={{ color: 'var(--text-secondary)' }}>
                          <div className="flex items-center gap-1.5">
                            <Clock className="w-3 h-3 flex-shrink-0" />
                            {formatDate(row.login_time)}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-xs font-mono"
                          style={{ color: 'var(--text-secondary)' }}>
                          {row.ip_address || '—'}
                        </td>
                        <td className="py-2.5 px-3 text-xs max-w-[180px] truncate"
                          style={{ color: 'var(--text-muted)', maxWidth: '180px' }}
                          title={row.device}>
                          {row.device || '—'}
                        </td>
                        <td className="py-2.5 px-3">
                          {row.status === 'success'
                            ? <span className="inline-flex items-center gap-1 text-xs font-medium"
                                style={{ color: 'var(--accent-green)' }}>
                                <CheckCircle className="w-3.5 h-3.5" /> Success
                              </span>
                            : <span className="inline-flex items-center gap-1 text-xs font-medium"
                                style={{ color: 'var(--accent-red)' }}>
                                <XCircle className="w-3.5 h-3.5" /> Failed
                              </span>
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-3 pt-3"
                  style={{ borderTop: '1px solid var(--table-border)' }}>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    Page {historyPage} of {totalPages} ({historyTotal} events)
                  </span>
                  <div className="flex gap-1">
                    {[
                      { label: '←', disabled: historyPage <= 1, onClick: () => setHistoryPage(p => Math.max(1, p - 1)) },
                      { label: '→', disabled: historyPage >= totalPages, onClick: () => setHistoryPage(p => Math.min(totalPages, p + 1)) },
                    ].map(btn => (
                      <button
                        key={btn.label}
                        onClick={btn.onClick}
                        disabled={btn.disabled}
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-xs font-medium
                          border-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        style={{
                          background: 'var(--btn-secondary-bg)',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        {btn.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </SettingsCard>

        {/* ── Recent Security Activity ─────────────────────────────── */}
        <SettingsCard
          title="Recent Security Activity"
          description="Audit trail of account-related actions"
        >
          {activityLoading ? (
            <div className="flex flex-col gap-2">
              {[...Array(4)].map((_, i) => <Skeleton key={i} height={40} />)}
            </div>
          ) : activity.length === 0 ? (
            <div className="flex flex-col items-center py-8 gap-2"
              style={{ color: 'var(--text-muted)' }}>
              <ShieldCheck className="w-8 h-8 opacity-40" />
              <p className="text-sm">No security events recorded</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {(showAllActivity ? activity : activity.slice(0, ACTIVITY_VISIBLE)).map(ev => (
                <div key={ev.id}
                  className="flex items-start gap-3 p-3 rounded-xl"
                  style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}
                >
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0"
                    style={{ color: 'var(--accent-amber)' }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                      {ev.action.replace(/_/g, ' ')}
                    </p>
                    {ev.details && (
                      <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                        {ev.details}
                      </p>
                    )}
                  </div>
                  <span className="text-[11px] whitespace-nowrap flex-shrink-0"
                    style={{ color: 'var(--text-muted)' }}>
                    {formatDate(ev.created_at)}
                  </span>
                </div>
              ))}

              {activity.length > ACTIVITY_VISIBLE && (
                <button onClick={() => setShowAllActivity(v => !v)}
                  aria-expanded={showAllActivity}
                  className="w-full py-2 rounded-xl text-[11px] font-bold uppercase tracking-wider transition-colors"
                  style={{
                    background: 'var(--btn-secondary-bg)',
                    border: '1px solid var(--glass-border)',
                    color: 'var(--text-muted)',
                  }}>
                  {showAllActivity
                    ? 'Show less'
                    : `+${activity.length - ACTIVITY_VISIBLE} more`}
                </button>
              )}
            </div>
          )}
        </SettingsCard>

        {/* ── Active Sessions ───────────────────────────────────── */}
        <SettingsCard
          title="Active Sessions"
          description="Devices currently signed in to your account"
        >
          {sessionsLoading ? (
            <div className="flex flex-col gap-2">
              {[...Array(3)].map((_, i) => <Skeleton key={i} height={56} />)}
            </div>
          ) : sessions.length === 0 ? (
            <div className="flex flex-col items-center py-8 gap-2" style={{ color: 'var(--text-muted)' }}>
              <Globe className="w-8 h-8 opacity-40" />
              <p className="text-sm">No session data available yet</p>
              <p className="text-xs opacity-60">Session tracking starts from your next login</p>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-2 mb-4">
                {sessions.map(sess => {
                  const { name: devName, type: devType } = parseDeviceString(sess.device)
                  const DevIcon = devType === 'mobile' ? Smartphone : Monitor
                  return (
                    <motion.div
                      key={sess.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-center gap-3 p-3 rounded-xl"
                      style={{
                        background: sess.is_current
                          ? 'rgba(52,211,153,0.06)'
                          : 'var(--glass-bg)',
                        border: `1px solid ${sess.is_current ? 'rgba(52,211,153,0.2)' : 'var(--glass-border)'}`,
                      }}
                    >
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{
                          background: sess.is_current ? 'rgba(52,211,153,0.12)' : 'var(--glass-bg-hover)',
                          color: sess.is_current ? 'var(--accent-green)' : 'var(--text-muted)',
                        }}>
                        <DevIcon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                            {devName || 'Unknown browser'}
                          </p>
                          {sess.is_current && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold"
                              style={{ background: 'rgba(52,211,153,0.12)', color: 'var(--accent-green)' }}>
                              <CheckCircle className="w-2.5 h-2.5" /> Current
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                          <span className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
                            {sess.ip_address}
                          </span>
                          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                            Last seen {formatDate(sess.last_seen)}
                          </span>
                        </div>
                      </div>
                      {!sess.is_current && (
                        <button
                          onClick={() => handleRevokeSession(sess.id)}
                          disabled={revokingId === sess.id}
                          title="Revoke this session"
                          className="w-8 h-8 flex items-center justify-center rounded-lg border-none cursor-pointer
                            disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                          style={{
                            background: 'rgba(239,68,68,0.08)',
                            color: 'var(--accent-red)',
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.18)' }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.08)' }}
                        >
                          {revokingId === sess.id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Trash2 className="w-3.5 h-3.5" />
                          }
                        </button>
                      )}
                    </motion.div>
                  )
                })}
              </div>

              {/* Logout all other devices */}
              {sessions.filter(s => !s.is_current).length > 0 && (
                <div className="flex justify-end pt-1"
                  style={{ borderTop: '1px solid var(--glass-border)' }}>
                  <button
                    onClick={() => setShowLogoutAllConfirm(true)}
                    disabled={logoutAllLoading}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold
                      border-none cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200"
                    style={{
                      background: 'rgba(239,68,68,0.08)',
                      color: 'var(--accent-red)',
                      border: '1px solid rgba(239,68,68,0.15)',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.15)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.08)' }}
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Logout All Other Devices
                  </button>
                </div>
              )}
            </>
          )}
        </SettingsCard>

      </div>

      <ConfirmModal
        open={showConfirm}
        onConfirm={doChangePassword}
        onCancel={() => setShowConfirm(false)}
        loading={saving}
      />

      {/* ── Logout-All Confirm Modal ────────────────────────────── */}
      <AnimatePresence>
        {showLogoutAllConfirm && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0"
              style={{ background: 'var(--modal-overlay)', backdropFilter: 'blur(4px)' }}
              onClick={() => setShowLogoutAllConfirm(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 10 }}
              transition={{ type: 'spring', stiffness: 340, damping: 28 }}
              className="relative z-10 w-full max-w-sm rounded-2xl p-6"
              style={{
                background: 'rgb(var(--bg-secondary))',
                border: '1px solid var(--glass-border)',
                boxShadow: '0 24px 48px rgba(0,0,0,0.4)',
              }}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--accent-red)' }}>
                  <LogOut className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    Logout All Other Devices
                  </h3>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    This will immediately end all other active sessions.
                  </p>
                </div>
              </div>
              <p className="text-sm mb-5" style={{ color: 'var(--text-secondary)' }}>
                All devices except this one will be signed out immediately. They will need to log in again.
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setShowLogoutAllConfirm(false)}
                  disabled={logoutAllLoading}
                  className="px-4 py-2 rounded-xl text-sm font-medium border-none cursor-pointer transition-colors"
                  style={{ background: 'var(--btn-secondary-bg)', color: 'var(--text-secondary)' }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleLogoutAll}
                  disabled={logoutAllLoading}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border-none
                    cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200"
                  style={{ background: 'rgba(239,68,68,0.85)', color: '#fff' }}
                >
                  {logoutAllLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
                  {logoutAllLoading ? 'Signing out…' : 'Logout All Devices'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  )
}
