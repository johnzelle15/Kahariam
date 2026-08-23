/**
 * SystemTab — Admin-only system management: staff, audit logs, DB status, server info.
 */
import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Users, Database, Activity, FileText, Plus, Edit2, Power,
  CheckCircle, XCircle, RefreshCw, Loader2, Server, HardDrive,
  Eye, EyeOff, Shield, X, Save,
} from 'lucide-react'
import api from '../../utils/api'

/* ── Shared primitives ────────────────────────────────────────────────────────── */
function SettingsCard({ title, description, children, action }) {
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
      <div className="flex items-start justify-between gap-2 mb-5">
        <div>
          {title && <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h3>}
          {description && <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </motion.div>
  )
}

function Skeleton({ height = 40, className = '' }) {
  return (
    <div className={`rounded-lg animate-pulse ${className}`}
      style={{ height, background: 'var(--skeleton-via)' }} />
  )
}

function StatChip({ label, value, color }) {
  return (
    <div className="flex flex-col gap-0.5 px-4 py-3 rounded-xl"
      style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
      <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
        {label}
      </span>
      <span className="text-xl font-bold" style={{ color: color || 'var(--text-primary)' }}>
        {value}
      </span>
    </div>
  )
}

/* ── Staff Modal ──────────────────────────────────────────────────────────────── */
function StaffModal({ mode, staff, onClose, onSaved, toast }) {
  const isEdit = mode === 'edit'
  const [form, setForm] = useState({
    username: staff?.username || '',
    fullname: staff?.fullname || '',
    email:    staff?.email    || '',
    role:     staff?.role     || 'staff',
    password: '',
  })
  const [showPw, setShowPw] = useState(false)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState({})

  function validate() {
    const errs = {}
    if (!isEdit && !form.username.trim()) errs.username = 'Required'
    if (!isEdit && !form.password)        errs.password = 'Required'
    if (form.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) errs.email = 'Invalid email'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function handleSave() {
    if (!validate()) return
    setSaving(true)
    try {
      if (isEdit) {
        await api.put(`/settings/staff/${staff.id}`, {
          fullname: form.fullname,
          email:    form.email,
          role:     form.role,
        })
        toast('Staff account updated', 'success')
      } else {
        await api.post('/settings/staff', form)
        toast('Staff account created', 'success')
      }
      onSaved()
      onClose()
    } catch (err) {
      toast(err.response?.data?.error || 'Operation failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
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
        className="relative z-10 w-full max-w-md rounded-2xl p-6"
        style={{
          background: 'rgb(var(--bg-secondary))',
          border: '1px solid var(--glass-border)',
          boxShadow: '0 24px 48px rgba(0,0,0,0.4)',
        }}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
            {isEdit ? 'Edit Staff Account' : 'Create Staff Account'}
          </h3>
          <button onClick={onClose} className="border-none bg-transparent cursor-pointer"
            style={{ color: 'var(--text-muted)' }}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex flex-col gap-3.5">
          {/* Username (create only) */}
          {!isEdit && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                Username <span style={{ color: 'var(--accent-red)' }}>*</span>
              </label>
              <input
                value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                placeholder="e.g. jdoe"
                className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                style={{
                  background: 'var(--input-bg)',
                  border: `1px solid ${errors.username ? 'var(--accent-red)' : 'var(--input-border)'}`,
                  color: 'var(--text-primary)',
                }}
              />
              {errors.username && <p className="text-xs" style={{ color: 'var(--accent-red)' }}>{errors.username}</p>}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Full Name</label>
            <input
              value={form.fullname}
              onChange={e => setForm(f => ({ ...f, fullname: e.target.value }))}
              placeholder="Jane Doe"
              className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
              style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Email</label>
            <input
              type="email"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              placeholder="staff@example.com"
              className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
              style={{
                background: 'var(--input-bg)',
                border: `1px solid ${errors.email ? 'var(--accent-red)' : 'var(--input-border)'}`,
                color: 'var(--text-primary)',
              }}
            />
            {errors.email && <p className="text-xs" style={{ color: 'var(--accent-red)' }}>{errors.email}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Role</label>
            <select
              value={form.role}
              onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
              className="w-full rounded-xl px-3 py-2.5 text-sm outline-none cursor-pointer"
              style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
            >
              <option value="staff">Staff</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          {/* Password (create only) */}
          {!isEdit && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                Password <span style={{ color: 'var(--accent-red)' }}>*</span>
              </label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  placeholder="Minimum 8 characters"
                  className="w-full rounded-xl px-3 pr-10 py-2.5 text-sm outline-none"
                  style={{
                    background: 'var(--input-bg)',
                    border: `1px solid ${errors.password ? 'var(--accent-red)' : 'var(--input-border)'}`,
                    color: 'var(--text-primary)',
                  }}
                />
                <button type="button" onClick={() => setShowPw(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 border-none bg-transparent cursor-pointer"
                  style={{ color: 'var(--text-muted)' }}>
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.password && <p className="text-xs" style={{ color: 'var(--accent-red)' }}>{errors.password}</p>}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-medium border-none cursor-pointer"
            style={{ background: 'var(--btn-secondary-bg)', color: 'var(--text-secondary)' }}>
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold
              border-none cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            style={{
              background: 'linear-gradient(135deg, #8B5CF6, #6366f1)',
              color: '#fff',
              boxShadow: '0 4px 12px rgba(139,92,246,0.25)',
            }}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isEdit ? 'Update' : 'Create'}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

/* ── SystemTab ────────────────────────────────────────────────────────────────── */
export default function SystemTab({ toast }) {
  /* System status */
  const [status, setStatus]     = useState(null)
  const [statusLoading, setSL]  = useState(true)
  const [statusError, setSE]    = useState(false)

  /* Staff */
  const [staff, setStaff]         = useState([])
  const [staffLoading, setStaffL] = useState(true)
  const [staffModal, setStaffModal] = useState(null) // { mode: 'create'|'edit', staff? }

  /* Audit logs */
  const [logs, setLogs]         = useState([])
  const [logsLoading, setLogsL] = useState(true)
  const [logsPage, setLogsPage] = useState(1)
  const [logsTotal, setLogsTotal] = useState(0)
  const LOGS_LIMIT = 15

  const fetchStatus = useCallback(async () => {
    setSL(true); setSE(false)
    try {
      const { data } = await api.get('/settings/system-status')
      setStatus(data)
    } catch { setSE(true) }
    finally { setSL(false) }
  }, [])

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
      const { data } = await api.get('/settings/audit-logs', {
        params: { page, limit: LOGS_LIMIT },
      })
      setLogs(data.logs || [])
      setLogsTotal(data.total || 0)
    } catch { /* silent */ }
    finally { setLogsL(false) }
  }, [])

  useEffect(() => {
    fetchStatus()
    fetchStaff()
    fetchLogs(1)
  }, [fetchStatus, fetchStaff, fetchLogs])

  useEffect(() => { fetchLogs(logsPage) }, [logsPage, fetchLogs])

  async function toggleStaff(member) {
    try {
      const { data } = await api.post(`/settings/staff/${member.id}/toggle`)
      toast(data.active ? 'Account activated' : 'Account deactivated', 'success')
      fetchStaff()
    } catch (err) {
      toast(err.response?.data?.error || 'Operation failed', 'error')
    }
  }

  function formatDate(d, fallback = 'Never') {
    if (!d) return fallback
    try {
      return new Date(d).toLocaleString(undefined, {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    } catch { return d }
  }

  function formatUptime(seconds) {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    return `${h}h ${m}m`
  }

  const totalLogPages = Math.max(1, Math.ceil(logsTotal / LOGS_LIMIT))

  return (
    <>
      <div className="flex flex-col gap-5">

        {/* ── System Status ──────────────────────────────────────── */}
        <SettingsCard
          title="System Status"
          description="Real-time server and database health"
          action={
            <button
              onClick={fetchStatus}
              disabled={statusLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                border-none cursor-pointer transition-colors disabled:opacity-50"
              style={{ background: 'var(--btn-secondary-bg)', color: 'var(--text-secondary)' }}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${statusLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          }
        >
          {statusLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[...Array(4)].map((_, i) => <Skeleton key={i} height={64} />)}
            </div>
          ) : statusError ? (
            <div className="flex items-center gap-2 py-4" style={{ color: 'var(--accent-red)' }}>
              <XCircle className="w-5 h-5" />
              <span className="text-sm">Unable to reach system status endpoint</span>
            </div>
          ) : status && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                <StatChip label="DB Version"   value={status.db_version?.split('-')[0] || '—'} color="var(--accent-blue)" />
                <StatChip label="DB Size"      value={`${status.db_size_mb} MB`} color="var(--accent-cyan)" />
                <StatChip label="Active Users" value={status.active_users} color="var(--accent-green)" />
                <StatChip label="Uptime"       value={formatUptime(status.uptime_seconds)} color="var(--accent-purple)" />
              </div>

              {/* Table sizes */}
              {status.tables?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold mb-2 uppercase tracking-wide"
                    style={{ color: 'var(--text-muted)' }}>Database Tables</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs min-w-[320px]">
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--table-border)' }}>
                          {['Table', 'Rows', 'Size (KB)'].map(h => (
                            <th key={h} className="py-1.5 px-3 text-left font-semibold uppercase tracking-wide"
                              style={{ color: 'var(--text-muted)' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {status.tables.map(t => (
                          <tr key={t.name} style={{ borderBottom: '1px solid var(--table-border)' }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--table-row-hover)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                            <td className="py-1.5 px-3 font-mono" style={{ color: 'var(--text-primary)' }}>{t.name}</td>
                            <td className="py-1.5 px-3" style={{ color: 'var(--text-secondary)' }}>{t.rows.toLocaleString()}</td>
                            <td className="py-1.5 px-3" style={{ color: 'var(--text-muted)' }}>{t.size_kb}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Server info */}
              <div className="flex flex-wrap gap-3 mt-4 pt-4" style={{ borderTop: '1px solid var(--table-border)' }}>
                {[
                  { label: 'Python', value: status.python_version, icon: Server },
                  { label: 'Platform', value: status.platform, icon: HardDrive },
                  { label: 'Server Time', value: new Date(status.server_time).toLocaleTimeString(), icon: Activity },
                ].map(item => {
                  const Icon = item.icon
                  return (
                    <div key={item.label} className="flex items-center gap-2 px-3 py-2 rounded-lg"
                      style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
                      <Icon className="w-3.5 h-3.5" style={{ color: 'var(--accent-purple)' }} />
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{item.label}:</span>
                      <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>{item.value}</span>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </SettingsCard>

        {/* ── Staff Management ────────────────────────────────────── */}
        <SettingsCard
          title="Staff Accounts"
          description="Create and manage staff access"
          action={
            <button
              onClick={() => setStaffModal({ mode: 'create' })}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                border-none cursor-pointer transition-all duration-200"
              style={{
                background: 'linear-gradient(135deg, #8B5CF6, #6366f1)',
                color: '#fff',
                boxShadow: '0 2px 8px rgba(139,92,246,0.25)',
              }}
            >
              <Plus className="w-3.5 h-3.5" />
              New Staff
            </button>
          }
        >
          {staffLoading ? (
            <div className="flex flex-col gap-2">
              {[...Array(3)].map((_, i) => <Skeleton key={i} height={56} />)}
            </div>
          ) : staff.length === 0 ? (
            <div className="flex flex-col items-center py-8 gap-2" style={{ color: 'var(--text-muted)' }}>
              <Users className="w-8 h-8 opacity-40" />
              <p className="text-sm">No staff accounts yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-sm min-w-[480px]">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--table-border)' }}>
                    {['User', 'Role', 'Status', 'Last Login', ''].map(h => (
                      <th key={h} className="py-2 px-3 text-left text-xs font-semibold uppercase tracking-wide"
                        style={{ color: 'var(--text-muted)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {staff.map(member => (
                    <tr key={member.id}
                      className="transition-colors"
                      style={{ borderBottom: '1px solid var(--table-border)' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--table-row-hover)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
                            style={{
                              background: 'linear-gradient(135deg, rgba(139,92,246,0.2), rgba(96,165,250,0.15))',
                              color: 'var(--accent-purple)',
                            }}>
                            {(member.fullname || member.username)?.[0]?.toUpperCase()}
                          </div>
                          <div>
                            <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                              {member.fullname || member.username}
                            </p>
                            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                              @{member.username}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold"
                          style={{
                            background: member.role === 'admin'
                              ? 'rgba(167,139,250,0.12)' : 'rgba(96,165,250,0.10)',
                            color: member.role === 'admin'
                              ? 'var(--accent-purple)' : 'var(--accent-blue)',
                          }}>
                          <Shield className="w-2.5 h-2.5" />
                          {member.role}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="flex items-center gap-1 text-xs"
                          style={{ color: member.active ? 'var(--accent-green)' : 'var(--text-muted)' }}>
                          {member.active
                            ? <><CheckCircle className="w-3.5 h-3.5" /> Active</>
                            : <><XCircle    className="w-3.5 h-3.5" /> Inactive</>
                          }
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-xs whitespace-nowrap"
                        style={{ color: 'var(--text-muted)' }}>
                        {formatDate(member.last_login, 'Never logged in')}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1.5 justify-end">
                          <button
                            onClick={() => setStaffModal({ mode: 'edit', staff: member })}
                            className="w-7 h-7 flex items-center justify-center rounded-lg border-none cursor-pointer transition-colors"
                            style={{ background: 'var(--btn-secondary-bg)', color: 'var(--text-secondary)' }}
                            title="Edit"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => toggleStaff(member)}
                            className="w-7 h-7 flex items-center justify-center rounded-lg border-none cursor-pointer transition-colors"
                            style={{
                              background: member.active ? 'rgba(239,68,68,0.08)' : 'rgba(16,185,129,0.08)',
                              color: member.active ? 'var(--accent-red)' : 'var(--accent-green)',
                            }}
                            title={member.active ? 'Deactivate' : 'Activate'}
                          >
                            <Power className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SettingsCard>

        {/* ── Audit Logs ──────────────────────────────────────────── */}
        <SettingsCard
          title="Audit Logs"
          description="System-wide action history"
        >
          {logsLoading ? (
            <div className="flex flex-col gap-2">
              {[...Array(5)].map((_, i) => <Skeleton key={i} height={40} />)}
            </div>
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
                      <tr key={log.id}
                        className="transition-colors"
                        style={{ borderBottom: '1px solid var(--table-border)' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--table-row-hover)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        <td className="py-2.5 px-3 text-xs whitespace-nowrap"
                          style={{ color: 'var(--text-muted)' }}>
                          {formatDate(log.created_at)}
                        </td>
                        <td className="py-2.5 px-3 text-xs font-medium"
                          style={{ color: 'var(--text-secondary)' }}>
                          @{log.username}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold"
                            style={{
                              background: 'rgba(139,92,246,0.10)',
                              color: 'var(--accent-purple)',
                            }}>
                            {log.action}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-xs max-w-[200px] truncate"
                          style={{ color: 'var(--text-muted)' }}
                          title={log.details}>
                          {log.details || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {totalLogPages > 1 && (
                <div className="flex items-center justify-between mt-3 pt-3"
                  style={{ borderTop: '1px solid var(--table-border)' }}>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    Page {logsPage} of {totalLogPages} ({logsTotal} entries)
                  </span>
                  <div className="flex gap-1">
                    {[
                      { label: '←', disabled: logsPage <= 1, onClick: () => setLogsPage(p => Math.max(1, p - 1)) },
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
        </SettingsCard>
      </div>

      {/* Staff Modal */}
      <AnimatePresence>
        {staffModal && (
          <StaffModal
            key="staff-modal"
            mode={staffModal.mode}
            staff={staffModal.staff}
            onClose={() => setStaffModal(null)}
            onSaved={fetchStaff}
            toast={toast}
          />
        )}
      </AnimatePresence>
    </>
  )
}
