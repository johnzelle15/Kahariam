/**
 * UsersTab — Admin-only: manage staff accounts and view audit logs.
 * Features: real-time username/email availability check, confirm-before-create
 * modal, audit log table. Passwords are never typed here — the backend
 * generates and emails them on create and on "Resend credentials".
 */
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Users, FileText, Plus, Edit2, Power, Mail,
  CheckCircle, XCircle, Loader2,
  Shield, X, Save,
  Check, AlertCircle,
} from 'lucide-react'
import api from '../../utils/api'
import { Badge, Button, EmptyState, Field, SettingsSection, SettingsPanel, Skeleton } from '../ui'

/* Live username / email availability, expressed as the field's own message.
   AvailBadge used to render this as a chip beside the label, built from
   rgba(16,185,129) and rgba(239,68,68) — emerald-500 and red-500, from the
   palette this app replaced. */
const AVAIL = {
  checking:  { hint: 'Checking…' },
  available: { hint: 'Available', ok: true },
  taken:     { error: 'Already taken' },
  invalid:   { error: 'Invalid format' },
}
const avail = (state, fallbackHint) => ({ hint: fallbackHint, ...(AVAIL[state] || {}) })

/* ── Confirm Dialog ─────────────────────────────────────────────────────────── */
function ConfirmDialog({ form, onConfirm, onCancel, saving }) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="absolute inset-0"
        style={{ background: 'var(--modal-overlay)', backdropFilter: 'blur(4px)' }}
        onClick={onCancel}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 16 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        className="relative z-10 w-full max-w-sm rounded-2xl p-6"
        style={{
          background: 'rgb(var(--bg-secondary))',
          border: '1px solid var(--glass-border)',
          boxShadow: '0 24px 48px rgba(0,0,0,0.45)',
        }}
      >
        <div className="flex flex-col items-center text-center gap-3 mb-5">
          <Users size={22} className="text-info" aria-hidden="true" />
          <div>
            <p className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
              Create this account?
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              A new <strong style={{ color: 'var(--text-secondary)' }}>{form.role}</strong> account will be
              created for <strong style={{ color: 'var(--text-secondary)' }}>@{form.username}</strong>. A
              random password will be generated and emailed to{' '}
              <strong style={{ color: 'var(--text-secondary)' }}>{form.email}</strong>. This action will be logged.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" className="flex-1" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" className="flex-1" icon={Check} loading={saving} onClick={onConfirm}>
            {saving ? 'Creating…' : 'Yes, create'}
          </Button>
        </div>
      </motion.div>
    </div>
  )
}

/* ── StaffModal ─────────────────────────────────────────────────────────────── */
function StaffModal({ mode, staff, onClose, onSaved, onResendCredentials, toast }) {
  const isEdit = mode === 'edit'
  const DEBOUNCE_MS = 500

  const [form, setForm] = useState({
    username: staff?.username || '',
    fullname: staff?.fullname || '',
    email:    staff?.email    || '',
    role:     staff?.role     || 'staff',
  })

  // availability states: 'idle' | 'checking' | 'available' | 'taken' | 'invalid'
  const [unameState, setUnameState]   = useState('idle')
  const [emailState, setEmailState]   = useState('idle')
  const [showConfirm, setShowConfirm] = useState(false)
  const [saving, setSaving]           = useState(false)

  const unameTimer = useRef(null)
  const emailTimer = useRef(null)

  /* ── Username live check ── */
  useEffect(() => {
    if (isEdit) return
    const val = form.username.trim()
    if (!val) { setUnameState('idle'); return }

    const formatOk = /^[a-zA-Z0-9_]{4,20}$/.test(val)
    if (!formatOk) { setUnameState('invalid'); return }

    setUnameState('checking')
    clearTimeout(unameTimer.current)
    unameTimer.current = setTimeout(async () => {
      try {
        const { data } = await api.get('/settings/check-username', { params: { value: val } })
        setUnameState(data.available ? 'available' : 'taken')
      } catch { setUnameState('idle') }
    }, DEBOUNCE_MS)
    return () => clearTimeout(unameTimer.current)
  }, [form.username, isEdit])

  /* ── Email live check ── */
  useEffect(() => {
    const val = form.email.trim()
    if (!val) { setEmailState('idle'); return }

    const formatOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(val)
    if (!formatOk) { setEmailState('invalid'); return }

    setEmailState('checking')
    clearTimeout(emailTimer.current)
    const excludeId = isEdit ? staff?.id : undefined
    emailTimer.current = setTimeout(async () => {
      try {
        const params = { value: val }
        if (excludeId) params.exclude_id = excludeId
        const { data } = await api.get('/settings/check-email', { params })
        setEmailState(data.available ? 'available' : 'taken')
      } catch { setEmailState('idle') }
    }, DEBOUNCE_MS)
    return () => clearTimeout(emailTimer.current)
  }, [form.email, isEdit, staff?.id])

  /* ── Derived validation ── */
  const canSubmit = isEdit
    ? (emailState === 'available' || emailState === 'idle') && !saving
    : unameState === 'available' && emailState === 'available' && !saving

  /* ── Submit flow ── */
  function handleSubmitClick() {
    if (!canSubmit) return
    if (isEdit) { doSave(); return }
    setShowConfirm(true)
  }

  async function doSave() {
    setSaving(true)
    setShowConfirm(false)
    try {
      if (isEdit) {
        await api.put(`/settings/staff/${staff.id}`, {
          fullname: form.fullname,
          email:    form.email,
          role:     form.role,
        })
        toast('Staff account updated', 'success')
      } else {
        await api.post('/settings/staff', {
          username: form.username,
          fullname: form.fullname,
          email:    form.email,
          role:     form.role,
        })
        toast('Account created — login credentials emailed to ' + form.email, 'success')
      }
      onSaved()
      onClose()
    } catch (err) {
      toast(err.response?.data?.error || 'Something went wrong', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="absolute inset-0"
          style={{ background: 'var(--modal-overlay)', backdropFilter: 'blur(4px)' }}
          onClick={onClose}
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 12 }}
          transition={{ type: 'spring', stiffness: 340, damping: 28 }}
          className="relative z-10 w-full max-w-lg rounded-2xl p-6 overflow-y-auto"
          style={{
            background: 'rgb(var(--bg-secondary))',
            border: '1px solid var(--glass-border)',
            boxShadow: '0 24px 48px rgba(0,0,0,0.4)',
            maxHeight: '92dvh',
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-sm font-semibold text-text-primary">
              {isEdit ? 'Edit account' : 'New staff account'}
            </h3>
            <button onClick={onClose} aria-label="Close"
              className="-m-1 p-1 rounded border-none bg-transparent cursor-pointer text-text-muted
                hover:text-text-primary focus-visible:outline focus-visible:outline-2
                focus-visible:outline-accent-green">
              <X size={16} />
            </button>
          </div>

          <div className="flex flex-col gap-4">
            {/* ── Username (create only) ── */}
            {!isEdit && (
              <Field
                label="Username"
                required
                value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value.replace(/\s/g, '') }))}
                placeholder="4–20 characters"
                maxLength={20}
                {...avail(unameState, 'Letters, numbers and underscore only.')}
              />
            )}

            {/* ── Full Name ── */}
            <Field
              label="Full name"
              value={form.fullname}
              onChange={e => setForm(f => ({ ...f, fullname: e.target.value }))}
              placeholder="e.g. Jane Dela Cruz"
            />

            {/* ── Email ── */}
            <div className="flex flex-col gap-1.5">
              <Field
                label="Email"
                type="email"
                required={!isEdit}
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value.trim() }))}
                placeholder="staff@example.com"
                {...avail(emailState, isEdit
                  ? undefined
                  : 'A random password is generated and emailed to this address.')}
              />
              {isEdit && (
                <Button type="button" variant="secondary" size="sm" icon={Mail}
                  className="self-start"
                  onClick={() => staff?.email && onResendCredentials?.(staff)}
                  disabled={!staff?.email}
                  title={staff?.email ? undefined : 'No email on file'}>
                  Resend credentials
                </Button>
              )}
            </div>

            {/* ── Role ── */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Role</label>
              {/* The app's segmented control. This was two buttons whose
                   selected state was a different colour per option — violet for
                   admin, blue for staff — so "which is selected" and "which one
                   is admin" were carried by the same signal. */}
              <div className="segmented self-start" role="group" aria-label="Role">
                {['staff', 'admin'].map(r => (
                  <button key={r} type="button"
                    onClick={() => setForm(f => ({ ...f, role: r }))}
                    aria-pressed={form.role === r}
                    data-active={form.role === r}>
                    {r.charAt(0).toUpperCase() + r.slice(1)}
                  </button>
                ))}
              </div>
            </div>

          </div>

          {/* ── Readiness summary (create mode) ── */}
          {!isEdit && (
            <div className="mt-4 flex flex-wrap gap-2">
              {[
                { ok: unameState === 'available', label: 'Username' },
                { ok: emailState === 'available', label: 'Email' },
              ].map(({ ok, label }) => (
                <Badge key={label} variant={ok ? 'success' : 'neutral'} className="gap-1">
                  {ok
                    ? <Check size={10} aria-hidden="true" />
                    : <span aria-hidden="true" className="w-2.5 h-2.5 rounded-full border border-current" />}
                  {label}
                </Badge>
              ))}
            </div>
          )}

          {/* ── Actions ── */}
          <div className="flex justify-end gap-2 mt-5">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              icon={Save}
              loading={saving}
              disabled={!canSubmit}
              onClick={handleSubmitClick}
              title={!canSubmit && !isEdit ? 'Complete all requirements above' : undefined}
            >
              {isEdit ? 'Save Changes' : 'Create Account'}
            </Button>
          </div>
        </motion.div>
      </div>

      {/* Confirm dialog (create only) */}
      <AnimatePresence>
        {showConfirm && (
          <ConfirmDialog
            key="confirm"
            form={form}
            onConfirm={doSave}
            onCancel={() => setShowConfirm(false)}
            saving={saving}
          />
        )}
      </AnimatePresence>
    </>
  )
}

/* ── UsersTab ────────────────────────────────────────────────────────────────── */
export default function UsersTab({ toast }) {
  const [staff, setStaff]           = useState([])
  const [staffLoading, setStaffL]   = useState(true)
  const [staffModal, setStaffModal] = useState(null)
  const [toggleConfirm, setToggleConfirm] = useState(null) // member pending activate/deactivate confirmation
  const [toggling, setToggling]     = useState(false)
  const [resendConfirm, setResendConfirm] = useState(null) // member pending resend-credentials confirmation
  const [resending, setResending]   = useState(false)

  const [logs, setLogs]             = useState([])
  const [logsLoading, setLogsL]     = useState(true)
  const [logsPage, setLogsPage]     = useState(1)
  const [logsTotal, setLogsTotal]   = useState(0)
  const LOGS_LIMIT = 15

  const fetchStaff = useCallback(async () => {
    setStaffL(true)
    try {
      const { data } = await api.get('/settings/staff')
      setStaff(data.staff || [])
    } catch { toast('Failed to load staff', 'error') }
    finally { setStaffL(false) }
  }, [toast])

  const fetchLogs = useCallback(async (page = 1) => {
    setLogsL(true)
    try {
      const { data } = await api.get('/settings/audit-logs', { params: { page, limit: LOGS_LIMIT } })
      setLogs(data.logs || [])
      setLogsTotal(data.total || 0)
    } catch { /* silent */ }
    finally { setLogsL(false) }
  }, [])

  useEffect(() => { fetchStaff(); fetchLogs(1) }, [fetchStaff, fetchLogs])
  useEffect(() => { fetchLogs(logsPage) }, [logsPage, fetchLogs])

  async function toggleStaff(member) {
    setToggling(true)
    try {
      const { data } = await api.post(`/settings/staff/${member.id}/toggle`)
      toast(data.active ? 'Account activated' : 'Account deactivated', 'success')
      fetchStaff()
    } catch (err) {
      toast(err.response?.data?.error || 'Operation failed', 'error')
    } finally {
      setToggling(false)
      setToggleConfirm(null)
    }
  }

  async function resendCredentials(member) {
    setResending(true)
    try {
      const { data } = await api.post(`/settings/staff/${member.id}/resend-credentials`)
      toast('New credentials emailed to ' + data.email, 'success')
    } catch (err) {
      toast(err.response?.data?.error || 'Operation failed', 'error')
    } finally {
      setResending(false)
      setResendConfirm(null)
    }
  }

  function formatDate(d, fallback = 'Never') {
    if (!d) return fallback
    try {
      return new Date(d).toLocaleString(undefined, {
        month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    } catch { return d }
  }

  const totalLogPages = Math.max(1, Math.ceil(logsTotal / LOGS_LIMIT))

  return (
    <>
      <SettingsPanel>

        {/* ── Staff Accounts ── */}
        <SettingsSection
          count={staff.length || undefined}
          title="Staff accounts"
          description="who can sign in"
          action={
            <Button variant="primary" size="sm" icon={Plus} onClick={() => setStaffModal({ mode: 'create' })}>
              New staff
            </Button>
          }
        >
          {staffLoading ? (
            <div className="flex flex-col gap-2">{[...Array(3)].map((_, i) => <Skeleton key={i} height={44} />)}</div>
          ) : staff.length === 0 ? (
            <EmptyState compact icon={Users} title="No accounts yet"
              message="Staff you add will be able to sign in and run the counter." />
          ) : (
            /* The app's own table styling, so this reads like Inventory and
               Adjustments rather than a fifth table invented in this file. The
               row hover was two inline mouse handlers mutating background; it is
               a CSS rule in .dark-table. */
            <div className="overflow-x-auto -mx-1">
              <table className="dark-table table-fixed w-full min-w-[620px]">
                <colgroup>
                  <col />
                  <col className="w-[92px]" />
                  <col className="w-[104px]" />
                  <col className="w-[168px]" />
                  <col className="w-[100px]" />
                </colgroup>
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Last login</th>
                    <th><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {staff.map(member => (
                    <tr key={member.id}>
                      <td>
                        <div className="flex items-center gap-2.5 min-w-0">
                          {/* The initial tile carried a violet-to-blue gradient
                              and violet text — the pre-olive palette, surviving
                              only here and on the profile avatar. */}
                          <span aria-hidden="true"
                            className="w-7 h-7 [@media(max-height:620px)]:w-6 [@media(max-height:620px)]:h-6
                              rounded-md flex items-center justify-center text-[11px] font-semibold shrink-0
                              bg-[var(--btn-secondary-bg)] border border-[var(--glass-border)] text-text-secondary">
                            {(member.fullname || member.username)?.[0]?.toUpperCase()}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-xs font-medium text-text-primary truncate">
                              {member.fullname || member.username}
                            </span>
                            <span className="block meta truncate">@{member.username}</span>
                          </span>
                        </div>
                      </td>
                      <td>
                        <Badge variant={member.role === 'admin' ? 'info' : 'neutral'}
                          className="uppercase tracking-wider">
                          {member.role}
                        </Badge>
                      </td>
                      <td>
                        <span className={`flex items-center gap-1 text-xs ${
                          member.active ? 'text-positive' : 'text-text-muted'}`}>
                          {member.active
                            ? <><CheckCircle size={12} aria-hidden="true" /> Active</>
                            : <><XCircle size={12} aria-hidden="true" /> Inactive</>}
                        </span>
                      </td>
                      <td className="meta whitespace-nowrap">
                        {formatDate(member.last_login, 'Never')}
                      </td>
                      <td>
                        <div className="flex items-center gap-1 justify-end">
                          <button onClick={() => setStaffModal({ mode: 'edit', staff: member })}
                            className="icon-btn" aria-label={`Edit ${member.username}`}>
                            <Edit2 size={13} aria-hidden="true" />
                          </button>
                          <button onClick={() => setToggleConfirm(member)}
                            className={`icon-btn ${member.active ? 'icon-btn-danger' : 'icon-btn-positive'}`}
                            aria-label={`${member.active ? 'Deactivate' : 'Activate'} ${member.username}`}>
                            <Power size={13} aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SettingsSection>

        {/* ── Audit Logs ── */}
        <SettingsSection collapsible count={logsTotal || undefined} title="Audit log" description="system-wide action history">
          {logsLoading ? (
            <div className="flex flex-col gap-2">{[...Array(5)].map((_, i) => <Skeleton key={i} height={40} />)}</div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center py-8 gap-2" style={{ color: 'var(--text-muted)' }}>
              <FileText className="w-8 h-8 opacity-40" />
              <p className="text-sm">No audit logs yet</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto -mx-1">
                <table className="w-full text-sm min-w-[480px]">
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--table-border)' }}>
                      {['Timestamp', 'User', 'Action', 'Details'].map(h => (
                        <th key={h} className="py-2 px-3 text-left text-xs font-semibold uppercase tracking-wide"
                          style={{ color: 'var(--text-muted)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map(log => (
                      <tr key={log.id} className="transition-colors"
                        style={{ borderBottom: '1px solid var(--table-border)' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--table-row-hover)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        <td className="py-2.5 px-3 text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                          {formatDate(log.created_at)}
                        </td>
                        <td className="py-2.5 px-3 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                          @{log.username}
                        </td>
                        <td className="py-2.5 [@media(max-height:620px)]:py-1.5 px-3">
                          <Badge variant="neutral">{log.action}</Badge>
                        </td>
                        <td className="py-2.5 px-3 text-xs max-w-[200px] truncate"
                          style={{ color: 'var(--text-muted)' }} title={log.details}>
                          {log.details || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {totalLogPages > 1 && (
                <div className="flex items-center justify-between mt-3 pt-3" style={{ borderTop: '1px solid var(--table-border)' }}>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    Page {logsPage} of {totalLogPages} ({logsTotal} entries)
                  </span>
                  <div className="flex gap-1">
                    {[
                      { label: '←', disabled: logsPage <= 1,            onClick: () => setLogsPage(p => Math.max(1, p - 1)) },
                      { label: '→', disabled: logsPage >= totalLogPages, onClick: () => setLogsPage(p => Math.min(totalLogPages, p + 1)) },
                    ].map(btn => (
                      <button key={btn.label} onClick={btn.onClick} disabled={btn.disabled}
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-xs font-medium
                          border-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{ background: 'var(--btn-secondary-bg)', color: 'var(--text-secondary)' }}>
                        {btn.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </SettingsSection>
      </SettingsPanel>

      {/* Staff Modal */}
      <AnimatePresence>
        {staffModal && (
          <StaffModal
            key="staff-modal"
            mode={staffModal.mode}
            staff={staffModal.staff}
            onClose={() => setStaffModal(null)}
            onSaved={fetchStaff}
            onResendCredentials={setResendConfirm}
            toast={toast}
          />
        )}
      </AnimatePresence>

      {/* Activate/Deactivate confirmation */}
      <AnimatePresence>
        {toggleConfirm && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" key="toggle-confirm">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0"
              style={{ background: 'var(--modal-overlay)', backdropFilter: 'blur(4px)' }}
              onClick={() => !toggling && setToggleConfirm(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 16 }}
              transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              className="relative z-10 w-full max-w-sm rounded-2xl p-6"
              style={{
                background: 'rgb(var(--bg-secondary))',
                border: '1px solid var(--glass-border)',
                boxShadow: '0 24px 48px rgba(0,0,0,0.45)',
              }}
            >
              <div className="flex flex-col items-center text-center gap-3 mb-5">
                <Power size={22} aria-hidden="true"
                  className={toggleConfirm.active ? 'text-negative' : 'text-positive'} />
                <div>
                  <p className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {toggleConfirm.active ? 'Deactivate this account?' : 'Activate this account?'}
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                    {toggleConfirm.active
                      ? <>@{toggleConfirm.username} will no longer be able to sign in until reactivated.</>
                      : <>@{toggleConfirm.username} will be able to sign in again.</>}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" className="flex-1" onClick={() => setToggleConfirm(null)} disabled={toggling}>
                  Cancel
                </Button>
                <Button
                  variant={toggleConfirm.active ? 'danger' : 'primary'}
                  className="flex-1"
                  icon={Check}
                  loading={toggling}
                  onClick={() => toggleStaff(toggleConfirm)}
                >
                  {toggling ? 'Saving…' : toggleConfirm.active ? 'Yes, deactivate' : 'Yes, activate'}
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Resend credentials confirmation */}
      <AnimatePresence>
        {resendConfirm && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" key="resend-confirm">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0"
              style={{ background: 'var(--modal-overlay)', backdropFilter: 'blur(4px)' }}
              onClick={() => !resending && setResendConfirm(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 16 }}
              transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              className="relative z-10 w-full max-w-sm rounded-2xl p-6"
              style={{
                background: 'rgb(var(--bg-secondary))',
                border: '1px solid var(--glass-border)',
                boxShadow: '0 24px 48px rgba(0,0,0,0.45)',
              }}
            >
              <div className="flex flex-col items-center text-center gap-3 mb-5">
                <Mail size={22} className="text-info" aria-hidden="true" />
                <div>
                  <p className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                    Resend credentials?
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                    A new random password will be generated and emailed to{' '}
                    <strong style={{ color: 'var(--text-secondary)' }}>{resendConfirm.email}</strong>.
                    The old password will stop working immediately.
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" className="flex-1" onClick={() => setResendConfirm(null)} disabled={resending}>
                  Cancel
                </Button>
                <Button variant="primary" className="flex-1" icon={Mail} loading={resending} onClick={() => resendCredentials(resendConfirm)}>
                  {resending ? 'Sending…' : 'Yes, resend'}
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  )
}
