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
import { Badge, Button, Field, SettingsSection, SettingsPanel, Skeleton } from '../ui'

/* ── Shared primitives ────────────────────────────────────────────────────────── */
/* PasswordInput lived here — see <Field reveal>, which replaced it along with
   AccountTab's InputField and the copies inside the staff modal. */

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
/* An unmet rule is grey, not red: the password is being typed, and marking each
   requirement as an error before the operator has finished is the form telling
   them off for not having got there yet. */
function ValidationRule({ met, label }) {
  return (
    <li className="flex items-center gap-1.5 text-xs">
      {met
        ? <CheckCircle size={12} className="shrink-0 text-positive" aria-hidden="true" />
        : <XCircle size={12} className="shrink-0 text-text-muted opacity-60" aria-hidden="true" />
      }
      <span className={met ? 'text-text-secondary' : 'text-text-muted'}>{label}</span>
      <span className="sr-only">{met ? ' — met' : ' — not met'}</span>
    </li>
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
              <ShieldAlert size={20} className="shrink-0 text-negative" aria-hidden="true" />
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
              <Button variant="ghost" onClick={onCancel} disabled={loading}>Cancel</Button>
              <Button variant="primary" icon={ShieldCheck} loading={loading} onClick={onConfirm}>
                {loading ? 'Saving…' : 'Confirm'}
              </Button>
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
      <SettingsPanel>

        {/* ── Change Password ──
               Capped at a measure: a password box stretched to 1360px gives the
               eye a metre of empty field to cross between the label and the
               first character typed into it. ── */}
        <SettingsSection
          title="Change password"
          description="the only credential on this account"
        >
          <form onSubmit={handleSubmit} noValidate className="max-w-xl">
            <div className="flex flex-col gap-3">
              <Field
                reveal
                id="current"
                label="Current password"
                autoComplete="current-password"
                value={form.current}
                onChange={e => setForm(f => ({ ...f, current: e.target.value }))}
                placeholder="Enter current password"
                error={fieldErrors.current}
              />

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <Field
                    reveal
                    id="newpw"
                    label="New password"
                    autoComplete="new-password"
                    value={form.newPw}
                    onChange={e => setForm(f => ({ ...f, newPw: e.target.value }))}
                    placeholder="Enter new password"
                    error={fieldErrors.newPw}
                  />
                  <StrengthMeter password={form.newPw} />
                </div>

                <Field
                  reveal
                  id="confirm"
                  label="Confirm new password"
                  autoComplete="new-password"
                  value={form.confirm}
                  onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))}
                  placeholder="Repeat new password"
                  error={fieldErrors.confirm}
                />
              </div>

              {/* Validation rules — a plain checklist. Animating its height on
                  every keystroke made the Update button walk down the page while
                  the operator was still typing. */}
              {form.newPw && (
                <ul className="list-none m-0 grid grid-cols-2 gap-x-4 gap-y-1 p-2.5 rounded-md
                  bg-[var(--btn-secondary-bg)] border border-[var(--glass-border)]">
                  {rules.map(r => <ValidationRule key={r.label} met={r.met} label={r.label} />)}
                </ul>
              )}

              <div className="flex justify-end">
                <Button type="submit" variant="primary" size="sm" icon={Lock}>Update password</Button>
              </div>
            </div>
          </form>
        </SettingsSection>

        {/* ── Login History ─────────────────────────────────────────── */}
        <SettingsSection
          collapsible
          count={historyTotal || history.length || undefined}
          title="Login history"
          description="recent sign-in events"
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
        </SettingsSection>

        {/* ── Recent Security Activity ─────────────────────────────── */}
        <SettingsSection
          collapsible
          count={activity.length || undefined}
          title="Security activity"
          description="account-related actions"
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
              {/* A log, not thirteen cards. Every entry also carried an amber
                  warning triangle — including "UPDATE PROFILE", which is
                  somebody editing their own name. An audit trail is a record of
                  what happened; if everything in it is flagged as a warning,
                  nothing in it is. */}
              <ul className="list-none m-0 p-0 divide-y divide-rule">
                {(showAllActivity ? activity : activity.slice(0, ACTIVITY_VISIBLE)).map(ev => (
                  <li key={ev.id} className="flex items-baseline justify-between gap-3 py-1.5">
                    <span className="min-w-0">
                      <span className="block text-xs font-medium text-text-primary">
                        {ev.action.replace(/_/g, ' ').toLowerCase().replace(/^./, c => c.toUpperCase())}
                      </span>
                      {ev.details && <span className="block meta truncate">{ev.details}</span>}
                    </span>
                    <time className="meta whitespace-nowrap shrink-0 tabular-nums">
                      {formatDate(ev.created_at)}
                    </time>
                  </li>
                ))}
              </ul>

              {activity.length > ACTIVITY_VISIBLE && (
                /* Not .insight-more-btn: that class exists to disappear above
                   640px, where the dashboard's insight rows all fit. Here the
                   toggle has to stay whatever the width. */
                <Button variant="ghost" size="sm" className="mt-1"
                  onClick={() => setShowAllActivity(v => !v)}
                  aria-expanded={showAllActivity}>
                  {showAllActivity
                    ? 'Show less'
                    : `Show ${activity.length - ACTIVITY_VISIBLE} more`}
                </Button>
              )}
            </div>
          )}
        </SettingsSection>

        {/* ── Active Sessions ───────────────────────────────────── */}
        <SettingsSection
          collapsible
          count={sessions.length || undefined}
          title="Active sessions"
          description="devices signed in to your account"
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
              {/* Twenty sessions as twenty bordered cards is a wall of boxes.
                  rgba(52,211,153) — Tailwind emerald-400 — marked the current
                  one; it is now the palette's own positive, and it is carried by
                  a badge rather than by tinting the whole row. */}
              <ul className="list-none m-0 p-0 divide-y divide-rule mb-3">
                {sessions.map(sess => {
                  const { name: devName, type: devType } = parseDeviceString(sess.device)
                  const DevIcon = devType === 'mobile' ? Smartphone : Monitor
                  return (
                    <li key={sess.id} className="flex items-center gap-2.5 py-2">
                      <DevIcon size={14} aria-hidden="true"
                        className={`shrink-0 ${sess.is_current ? 'text-positive' : 'text-text-muted'}`} />
                      <div className="flex-1 min-w-0">
                        <span className="flex items-baseline gap-2 flex-wrap">
                          <span className="text-xs font-medium text-text-primary truncate">
                            {devName || 'Unknown browser'}
                          </span>
                          {sess.is_current && <Badge variant="success">This device</Badge>}
                        </span>
                        <span className="meta flex items-center gap-2.5 flex-wrap">
                          <span className="tabular-nums">{sess.ip_address}</span>
                          <span>Last seen {formatDate(sess.last_seen)}</span>
                        </span>
                      </div>
                      {!sess.is_current && (
                        <button
                          onClick={() => handleRevokeSession(sess.id)}
                          disabled={revokingId === sess.id}
                          aria-label={`Revoke the session on ${devName || 'this device'}`}
                          className="icon-btn icon-btn-danger shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {revokingId === sess.id
                            ? <Loader2 size={13} className="animate-spin" />
                            : <Trash2 size={13} />
                          }
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>

              {/* Logout all other devices */}
              {sessions.filter(s => !s.is_current).length > 0 && (
                <div className="flex justify-end pt-1"
                  style={{ borderTop: '1px solid var(--glass-border)' }}>
                  <Button variant="danger" size="sm" icon={LogOut}
                    onClick={() => setShowLogoutAllConfirm(true)}
                    disabled={logoutAllLoading}>
                    Sign out other devices
                  </Button>
                </div>
              )}
            </>
          )}
        </SettingsSection>

      </SettingsPanel>

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
                <LogOut size={20} className="shrink-0 text-negative" aria-hidden="true" />
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
                <Button variant="ghost" onClick={() => setShowLogoutAllConfirm(false)} disabled={logoutAllLoading}>
                  Cancel
                </Button>
                <Button variant="danger" icon={LogOut} loading={logoutAllLoading} onClick={handleLogoutAll}>
                  {logoutAllLoading ? 'Signing out…' : 'Logout All Devices'}
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  )
}
