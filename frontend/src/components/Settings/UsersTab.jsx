/**
 * UsersTab — Admin-only: manage staff accounts and view audit logs.
 * Features: real-time username/email availability check, strong password
 * meter with live checklist, confirm-before-create modal, audit log table.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Users, FileText, Plus, Edit2, Power,
  CheckCircle, XCircle, Loader2,
  Eye, EyeOff, Shield, X, Save,
  Check, AlertCircle, RefreshCw, Copy,
} from 'lucide-react'
import api from '../../utils/api'

/* ── Shared primitives ──────────────────────────────────────────────────────── */
function SettingsCard({ title, description, children, action }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className="rounded-2xl p-5 md:p-6"
      style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', backdropFilter: 'blur(16px)' }}
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

function Skeleton({ height = 40 }) {
  return <div className="rounded-lg animate-pulse" style={{ height, background: 'var(--skeleton-via)' }} />
}

/* ── Availability indicator ─────────────────────────────────────────────────── */
function AvailBadge({ state }) {
  if (state === 'checking') return (
    <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
      <Loader2 className="w-3 h-3 animate-spin" /> Checking…
    </span>
  )
  if (state === 'available') return (
    <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--accent-green)' }}>
      <CheckCircle className="w-3 h-3" /> Available
    </span>
  )
  if (state === 'taken') return (
    <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--accent-red)' }}>
      <XCircle className="w-3 h-3" /> Already exists
    </span>
  )
  if (state === 'invalid') return (
    <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--accent-amber)' }}>
      <AlertCircle className="w-3 h-3" /> Invalid format
    </span>
  )
  return null
}

/* ── Password strength helpers ──────────────────────────────────────────────── */
function calcStrength(pw) {
  const rules = {
    length:    pw.length >= 8,
    upper:     /[A-Z]/.test(pw),
    lower:     /[a-z]/.test(pw),
    digit:     /[0-9]/.test(pw),
    special:   /[^A-Za-z0-9]/.test(pw),
  }
  const passed = Object.values(rules).filter(Boolean).length
  const level  = passed <= 2 ? 'weak' : passed === 3 ? 'fair' : passed === 4 ? 'good' : 'strong'
  return { rules, passed, level }
}

const STRENGTH_META = {
  weak:   { label: 'Weak',   color: 'var(--accent-red)',    bars: 1 },
  fair:   { label: 'Fair',   color: 'var(--accent-amber)',  bars: 2 },
  good:   { label: 'Good',   color: 'var(--accent-blue)',   bars: 3 },
  strong: { label: 'Strong', color: 'var(--accent-green)',  bars: 4 },
}

function PasswordStrength({ password }) {
  if (!password) return null
  const { rules, level } = calcStrength(password)
  const meta = STRENGTH_META[level]

  return (
    <div className="mt-2 flex flex-col gap-2">
      {/* Strength bar */}
      <div className="flex items-center gap-2">
        <div className="flex gap-1 flex-1">
          {[1,2,3,4].map(i => (
            <div key={i} className="h-1 flex-1 rounded-full transition-all duration-300"
              style={{ background: i <= meta.bars ? meta.color : 'var(--input-border)' }} />
          ))}
        </div>
        <span className="text-[11px] font-semibold w-12 text-right" style={{ color: meta.color }}>
          {meta.label}
        </span>
      </div>
      {/* Checklist */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        {[
          { key: 'length',  label: 'Min. 8 characters' },
          { key: 'upper',   label: 'Uppercase letter' },
          { key: 'lower',   label: 'Lowercase letter' },
          { key: 'digit',   label: 'Number' },
          { key: 'special', label: 'Special character' },
        ].map(({ key, label }) => (
          <span key={key} className="flex items-center gap-1 text-[11px] transition-colors duration-200"
            style={{ color: rules[key] ? 'var(--accent-green)' : 'var(--text-muted)' }}>
            {rules[key]
              ? <CheckCircle className="w-3 h-3 flex-shrink-0" />
              : <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ border: '1.5px solid var(--text-muted)' }} />
            }
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}

/* ── Auto-generate password ─────────────────────────────────────────────────── */
function generatePassword() {
  const upper   = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const lower   = 'abcdefghijklmnopqrstuvwxyz'
  const digits  = '0123456789'
  const special = '!@#$%^&*()_+-=[]{}|;:,.<>?'
  const all     = upper + lower + digits + special
  const arr     = [
    upper  [Math.floor(Math.random() * upper.length)],
    lower  [Math.floor(Math.random() * lower.length)],
    digits [Math.floor(Math.random() * digits.length)],
    special[Math.floor(Math.random() * special.length)],
  ]
  for (let i = 0; i < 8; i++) arr.push(all[Math.floor(Math.random() * all.length)])
  return arr.sort(() => Math.random() - 0.5).join('')
}

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
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
            style={{ background: 'rgba(139,92,246,0.12)' }}>
            <Users className="w-7 h-7" style={{ color: 'var(--accent-purple)' }} />
          </div>
          <div>
            <p className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
              Create this account?
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              A new <strong style={{ color: 'var(--text-secondary)' }}>{form.role}</strong> account will be
              created for <strong style={{ color: 'var(--text-secondary)' }}>@{form.username}</strong>.
              This action will be logged.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium border-none cursor-pointer"
            style={{ background: 'var(--btn-secondary-bg)', color: 'var(--text-secondary)' }}>
            Cancel
          </button>
          <button onClick={onConfirm} disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold
              border-none cursor-pointer disabled:opacity-60"
            style={{
              background: 'linear-gradient(135deg, #8B5CF6, #6366f1)',
              color: '#fff',
              boxShadow: '0 4px 12px rgba(139,92,246,0.3)',
            }}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {saving ? 'Creating…' : 'Yes, create'}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

/* ── StaffModal ─────────────────────────────────────────────────────────────── */
function StaffModal({ mode, staff, onClose, onSaved, toast }) {
  const isEdit = mode === 'edit'
  const DEBOUNCE_MS = 500

  const [form, setForm] = useState({
    username: staff?.username || '',
    fullname: staff?.fullname || '',
    email:    staff?.email    || '',
    role:     staff?.role     || 'staff',
    password: '',
    confirmPassword: '',
  })

  // availability states: 'idle' | 'checking' | 'available' | 'taken' | 'invalid'
  const [unameState, setUnameState]   = useState('idle')
  const [emailState, setEmailState]   = useState('idle')
  const [showPw, setShowPw]           = useState(false)
  const [showCPw, setShowCPw]         = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [saving, setSaving]           = useState(false)
  const [copied, setCopied]           = useState(false)

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
  const strength   = calcStrength(form.password)
  const pwStrong   = strength.passed >= 5  // all 5 rules
  const pwMatch    = form.password && form.password === form.confirmPassword

  const canSubmit = isEdit
    ? (emailState === 'available' || emailState === 'idle') && !saving
    : unameState === 'available' &&
      (emailState === 'available' || emailState === 'idle') &&
      pwStrong && pwMatch && !saving

  /* ── Auto-generate ── */
  function autoGenerate() {
    const pw = generatePassword()
    setForm(f => ({ ...f, password: pw, confirmPassword: pw }))
    setShowPw(true)
  }

  function handleCopy() {
    if (!form.password) return
    navigator.clipboard.writeText(form.password).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

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
          password: form.password,
        })
        toast('Account created successfully', 'success')
      }
      onSaved()
      onClose()
    } catch (err) {
      toast(err.response?.data?.error || 'Something went wrong', 'error')
    } finally {
      setSaving(false)
    }
  }

  const inputStyle = (hasErr) => ({
    background: 'var(--input-bg)',
    border: `1px solid ${hasErr ? 'var(--accent-red)' : 'var(--input-border)'}`,
    color: 'var(--text-primary)',
  })

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
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                style={{ background: 'rgba(139,92,246,0.12)' }}>
                <Users className="w-4.5 h-4.5" style={{ color: 'var(--accent-purple)' }} />
              </div>
              <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                {isEdit ? 'Edit Account' : 'Create New Account'}
              </h3>
            </div>
            <button onClick={onClose} className="border-none bg-transparent cursor-pointer p-1"
              style={{ color: 'var(--text-muted)' }}>
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex flex-col gap-4">
            {/* ── Username (create only) ── */}
            {!isEdit && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                    Username <span style={{ color: 'var(--accent-red)' }}>*</span>
                  </label>
                  <AvailBadge state={unameState} />
                </div>
                <input
                  value={form.username}
                  onChange={e => setForm(f => ({ ...f, username: e.target.value.replace(/\s/g, '') }))}
                  placeholder="4-20 characters, letters/numbers/underscore"
                  maxLength={20}
                  className="w-full rounded-xl px-3 py-2.5 text-sm outline-none transition-all"
                  style={{
                    ...inputStyle(unameState === 'taken' || unameState === 'invalid'),
                    boxShadow: unameState === 'available' ? '0 0 0 2px rgba(16,185,129,0.2)' :
                               unameState === 'taken'     ? '0 0 0 2px rgba(239,68,68,0.2)' : 'none',
                  }}
                />
                <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  Only letters, numbers, and underscore _ allowed
                </p>
              </div>
            )}

            {/* ── Full Name ── */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Full Name</label>
              <input
                value={form.fullname}
                onChange={e => setForm(f => ({ ...f, fullname: e.target.value }))}
                placeholder="e.g. Jane Dela Cruz"
                className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                style={inputStyle(false)}
              />
            </div>

            {/* ── Email ── */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Email</label>
                <AvailBadge state={emailState} />
              </div>
              <input
                type="email"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value.trim() }))}
                placeholder="staff@example.com"
                className="w-full rounded-xl px-3 py-2.5 text-sm outline-none transition-all"
                style={{
                  ...inputStyle(emailState === 'taken' || emailState === 'invalid'),
                  boxShadow: emailState === 'available' ? '0 0 0 2px rgba(16,185,129,0.2)' :
                             emailState === 'taken'     ? '0 0 0 2px rgba(239,68,68,0.2)' : 'none',
                }}
              />
            </div>

            {/* ── Role ── */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Role</label>
              <div className="flex gap-2">
                {['staff', 'admin'].map(r => (
                  <button key={r} type="button"
                    onClick={() => setForm(f => ({ ...f, role: r }))}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm
                      font-medium border-none cursor-pointer transition-all duration-200"
                    style={{
                      background: form.role === r
                        ? (r === 'admin' ? 'rgba(139,92,246,0.15)' : 'rgba(96,165,250,0.12)')
                        : 'var(--btn-secondary-bg)',
                      color: form.role === r
                        ? (r === 'admin' ? 'var(--accent-purple)' : 'var(--accent-blue)')
                        : 'var(--text-muted)',
                      border: `1px solid ${form.role === r
                        ? (r === 'admin' ? 'rgba(139,92,246,0.35)' : 'rgba(96,165,250,0.3)')
                        : 'transparent'}`,
                    }}>
                    <Shield className="w-3.5 h-3.5" />
                    {r.charAt(0).toUpperCase() + r.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Password (create only) ── */}
            {!isEdit && (
              <>
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                      Password <span style={{ color: 'var(--accent-red)' }}>*</span>
                    </label>
                    <div className="flex items-center gap-1.5">
                      {form.password && (
                        <button type="button" onClick={handleCopy}
                          className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-medium
                            border-none cursor-pointer transition-colors"
                          style={{ background: 'var(--btn-secondary-bg)', color: 'var(--text-muted)' }}>
                          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                          {copied ? 'Copied' : 'Copy'}
                        </button>
                      )}
                      <button type="button" onClick={autoGenerate}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-medium
                          border-none cursor-pointer transition-colors"
                        style={{ background: 'var(--btn-secondary-bg)', color: 'var(--text-muted)' }}>
                        <RefreshCw className="w-3 h-3" /> Generate
                      </button>
                    </div>
                  </div>
                  <div className="relative">
                    <input
                      type={showPw ? 'text' : 'password'}
                      value={form.password}
                      onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                      placeholder="Min. 8 chars with uppercase, number, symbol"
                      className="w-full rounded-xl px-3 pr-10 py-2.5 text-sm outline-none transition-all"
                      style={inputStyle(false)}
                    />
                    <button type="button" onClick={() => setShowPw(s => !s)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 border-none bg-transparent cursor-pointer"
                      style={{ color: 'var(--text-muted)' }}>
                      {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {/* Live strength meter + checklist */}
                  <PasswordStrength password={form.password} />
                </div>

                {/* ── Confirm password ── */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                      Confirm Password <span style={{ color: 'var(--accent-red)' }}>*</span>
                    </label>
                    {form.confirmPassword && (
                      <span className="flex items-center gap-1 text-[11px]"
                        style={{ color: pwMatch ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                        {pwMatch
                          ? <><CheckCircle className="w-3 h-3" /> Passwords match</>
                          : <><XCircle    className="w-3 h-3" /> Passwords don't match</>
                        }
                      </span>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type={showCPw ? 'text' : 'password'}
                      value={form.confirmPassword}
                      onChange={e => setForm(f => ({ ...f, confirmPassword: e.target.value }))}
                      placeholder="Re-enter your password"
                      className="w-full rounded-xl px-3 pr-10 py-2.5 text-sm outline-none transition-all"
                      style={{
                        ...inputStyle(form.confirmPassword && !pwMatch),
                        boxShadow: form.confirmPassword
                          ? pwMatch ? '0 0 0 2px rgba(16,185,129,0.2)' : '0 0 0 2px rgba(239,68,68,0.2)'
                          : 'none',
                      }}
                    />
                    <button type="button" onClick={() => setShowCPw(s => !s)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 border-none bg-transparent cursor-pointer"
                      style={{ color: 'var(--text-muted)' }}>
                      {showCPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* ── Readiness summary (create mode) ── */}
          {!isEdit && (
            <div className="mt-4 flex flex-wrap gap-2">
              {[
                { ok: unameState === 'available',              label: 'Username' },
                { ok: emailState === 'available', label: 'Email' },
                { ok: pwStrong,                                label: 'Password strength' },
                { ok: pwMatch,                                 label: 'Passwords match' },
              ].map(({ ok, label }) => (
                <span key={label} className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
                  style={{
                    background: ok ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.06)',
                    color:      ok ? 'var(--accent-green)'   : 'var(--text-muted)',
                    border:     `1px solid ${ok ? 'rgba(16,185,129,0.2)' : 'var(--glass-border)'}`,
                  }}>
                  {ok ? <Check className="w-2.5 h-2.5" /> : <div className="w-2.5 h-2.5 rounded-full" style={{ border: '1.5px solid currentColor' }} />}
                  {label}
                </span>
              ))}
            </div>
          )}

          {/* ── Actions ── */}
          <div className="flex justify-end gap-2 mt-5">
            <button onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-medium border-none cursor-pointer"
              style={{ background: 'var(--btn-secondary-bg)', color: 'var(--text-secondary)' }}>
              Cancel
            </button>
            <button
              onClick={handleSubmitClick}
              disabled={!canSubmit}
              title={!canSubmit && !isEdit ? 'Complete all requirements above' : undefined}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold
                border-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              style={{
                background: 'linear-gradient(135deg, #8B5CF6, #6366f1)',
                color: '#fff',
                boxShadow: canSubmit ? '0 4px 12px rgba(139,92,246,0.3)' : 'none',
              }}
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {isEdit ? 'Save Changes' : 'Create Account'}
            </button>
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
        month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    } catch { return d }
  }

  const totalLogPages = Math.max(1, Math.ceil(logsTotal / LOGS_LIMIT))

  return (
    <>
      <div className="flex flex-col gap-5">

        {/* ── Staff Accounts ── */}
        <SettingsCard
          title="Staff Accounts"
          description="Create and manage user access"
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
              <Plus className="w-3.5 h-3.5" /> New Staff
            </button>
          }
        >
          {staffLoading ? (
            <div className="flex flex-col gap-2">{[...Array(3)].map((_, i) => <Skeleton key={i} height={56} />)}</div>
          ) : staff.length === 0 ? (
            <div className="flex flex-col items-center py-8 gap-2" style={{ color: 'var(--text-muted)' }}>
              <Users className="w-8 h-8 opacity-40" />
              <p className="text-sm">No accounts yet</p>
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
                    <tr key={member.id} className="transition-colors"
                      style={{ borderBottom: '1px solid var(--table-border)' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--table-row-hover)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
                            style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.2), rgba(96,165,250,0.15))', color: 'var(--accent-purple)' }}>
                            {(member.fullname || member.username)?.[0]?.toUpperCase()}
                          </div>
                          <div>
                            <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                              {member.fullname || member.username}
                            </p>
                            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>@{member.username}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold"
                          style={{
                            background: member.role === 'admin' ? 'rgba(167,139,250,0.12)' : 'rgba(96,165,250,0.10)',
                            color: member.role === 'admin' ? 'var(--accent-purple)' : 'var(--accent-blue)',
                          }}>
                          <Shield className="w-2.5 h-2.5" />{member.role}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="flex items-center gap-1 text-xs"
                          style={{ color: member.active ? 'var(--accent-green)' : 'var(--text-muted)' }}>
                          {member.active
                            ? <><CheckCircle className="w-3.5 h-3.5" /> Active</>
                            : <><XCircle    className="w-3.5 h-3.5" /> Inactive</>}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                        {formatDate(member.last_login, 'Never logged in')}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1.5 justify-end">
                          <button onClick={() => setStaffModal({ mode: 'edit', staff: member })}
                            className="w-7 h-7 flex items-center justify-center rounded-lg border-none cursor-pointer"
                            style={{ background: 'var(--btn-secondary-bg)', color: 'var(--text-secondary)' }} title="Edit">
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => toggleStaff(member)}
                            className="w-7 h-7 flex items-center justify-center rounded-lg border-none cursor-pointer"
                            style={{
                              background: member.active ? 'rgba(239,68,68,0.08)' : 'rgba(16,185,129,0.08)',
                              color: member.active ? 'var(--accent-red)' : 'var(--accent-green)',
                            }}
                            title={member.active ? 'Deactivate' : 'Activate'}>
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

        {/* ── Audit Logs ── */}
        <SettingsCard title="Audit Logs" description="System-wide action history">
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
                        <td className="py-2.5 px-3">
                          <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold"
                            style={{ background: 'rgba(139,92,246,0.10)', color: 'var(--accent-purple)' }}>
                            {log.action}
                          </span>
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
