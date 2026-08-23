import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Lock, Eye, EyeOff, AlertCircle, CheckCircle2, Loader2, X, Check } from 'lucide-react'
import api from '../utils/api'

const ease = [0.16, 1, 0.3, 1]

// Password strength rules (must match backend)
const RULES = [
  { id: 'len',     label: 'At least 8 characters',                test: p => p.length >= 8 },
  { id: 'upper',   label: 'At least one uppercase letter (A–Z)',   test: p => /[A-Z]/.test(p) },
  { id: 'lower',   label: 'At least one lowercase letter (a–z)',   test: p => /[a-z]/.test(p) },
  { id: 'number',  label: 'At least one number (0–9)',             test: p => /\d/.test(p) },
  { id: 'special', label: 'At least one special character (!@#$…)', test: p => /[!@#$%^&*()\-_=+[\]{};:'",.<>/?\\|`~]/.test(p) },
]

function strengthScore(password) {
  return RULES.filter(r => r.test(password)).length
}

function strengthLabel(score) {
  if (score <= 1) return { label: 'Very Weak', color: '#f87171' }
  if (score === 2) return { label: 'Weak',      color: '#fb923c' }
  if (score === 3) return { label: 'Fair',      color: '#fbbf24' }
  if (score === 4) return { label: 'Strong',    color: '#34d399' }
  return              { label: 'Very Strong', color: '#34d399' }
}

export default function ResetPassword({ token, onDone }) {
  const [status, setStatus] = useState('validating') // validating | invalid | form | success
  const [tokenError, setTokenError] = useState('')

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showRules, setShowRules] = useState(false)

  const score = strengthScore(password)
  const { label: strengthLbl, color: strengthColor } = strengthLabel(score)
  const allRulesMet = score === RULES.length
  const passwordsMatch = password && confirm && password === confirm

  // Validate token on mount
  useEffect(() => {
    if (!token) { setStatus('invalid'); setTokenError('No reset token found.'); return }
    api.post('/auth/validate-reset-token', { token })
      .then(() => setStatus('form'))
      .catch(err => {
        setStatus('invalid')
        setTokenError(err.response?.data?.error || 'Invalid or expired reset link.')
      })
  }, [token])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (!allRulesMet) { setError('Please meet all password requirements.'); return }
    if (!passwordsMatch) { setError('Passwords do not match.'); return }

    setLoading(true)
    try {
      await api.post('/auth/reset-password', { token, password, confirm_password: confirm })
      setStatus('success')
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to reset password. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // ── Validating ────────────────────────────────────────────────────────────
  if (status === 'validating') {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-6">
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: '#34d399' }} />
        <p className="text-sm" style={{ color: '#8b95a8' }}>Validating reset link…</p>
      </div>
    )
  }

  // ── Invalid token ─────────────────────────────────────────────────────────
  if (status === 'invalid') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center space-y-4"
      >
        <div
          className="inline-flex items-center justify-center w-14 h-14 rounded-full mx-auto"
          style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.2)' }}
        >
          <X className="w-7 h-7" style={{ color: '#f87171' }} />
        </div>
        <div>
          <h3 className="text-base font-bold mb-1" style={{ color: '#e8ecf2' }}>Link Invalid</h3>
          <p className="text-sm" style={{ color: '#8b95a8' }}>{tokenError}</p>
        </div>
        <button
          onClick={onDone}
          className="text-sm font-semibold transition-colors"
          style={{ color: '#34d399' }}
          onMouseEnter={e => e.currentTarget.style.color = '#6ee7b7'}
          onMouseLeave={e => e.currentTarget.style.color = '#34d399'}
        >
          Back to Sign In
        </button>
      </motion.div>
    )
  }

  // ── Success ───────────────────────────────────────────────────────────────
  if (status === 'success') {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="text-center space-y-4"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 20, delay: 0.1 }}
          className="inline-flex items-center justify-center w-14 h-14 rounded-full mx-auto"
          style={{ background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.2)' }}
        >
          <CheckCircle2 className="w-7 h-7" style={{ color: '#34d399' }} />
        </motion.div>
        <div>
          <h3 className="text-base font-bold mb-1" style={{ color: '#e8ecf2' }}>Password Updated!</h3>
          <p className="text-sm" style={{ color: '#8b95a8' }}>
            Your password has been reset successfully. You can now sign in with your new password.
          </p>
        </div>
        <motion.button
          onClick={onDone}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm text-white transition-all duration-300"
          style={{
            background: 'linear-gradient(135deg, #059669, #34d399)',
            boxShadow: '0 0 20px rgba(52,211,153,0.15), 0 4px 12px rgba(0,0,0,0.2)',
            border: '1px solid rgba(52,211,153,0.2)',
          }}
        >
          Sign In Now
        </motion.button>
      </motion.div>
    )
  }

  // ── Form ──────────────────────────────────────────────────────────────────
  return (
    <motion.form
      onSubmit={handleSubmit}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease }}
      className="w-full space-y-4"
    >
      <p className="text-sm text-center" style={{ color: '#8b95a8' }}>
        Choose a strong new password for your account.
      </p>

      {/* New Password */}
      <div>
        <label className="block text-xs font-medium tracking-wide uppercase mb-2"
          style={{ color: 'var(--text-muted)' }}>
          New Password
        </label>
        <div className="relative">
          <input
            type={showPw ? 'text' : 'password'}
            value={password}
            onChange={e => { setPassword(e.target.value); setError(''); setShowRules(true) }}
            autoComplete="new-password"
            autoFocus
            required
            disabled={loading}
            placeholder="Enter new password"
            className="w-full px-4 py-3 pr-11 rounded-xl text-sm outline-none transition-all duration-200"
            style={{
              background: 'var(--input-bg)',
              border: `1px solid ${password ? (allRulesMet ? 'rgba(52,211,153,0.4)' : 'rgba(251,191,36,0.3)') : 'var(--input-border)'}`,
              color: 'var(--text-primary)',
              boxShadow: 'var(--input-shadow)',
            }}
            onFocus={e => { e.target.style.boxShadow = 'var(--input-focus-shadow)'; setShowRules(true) }}
            onBlur={e => e.target.style.boxShadow = 'var(--input-shadow)'}
          />
          <button type="button" onClick={() => setShowPw(!showPw)} tabIndex={-1}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg transition-colors"
            style={{ color: 'var(--text-muted)' }}>
            {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>

        {/* Strength bar */}
        {password && (
          <div className="mt-2 space-y-1">
            <div className="flex items-center justify-between">
              <div className="flex gap-1 flex-1">
                {[1,2,3,4,5].map(i => (
                  <div key={i}
                    className="h-1 flex-1 rounded-full transition-all duration-300"
                    style={{ background: i <= score ? strengthColor : 'rgba(255,255,255,0.08)' }}
                  />
                ))}
              </div>
              <span className="ml-2 text-[10px] font-semibold" style={{ color: strengthColor }}>
                {strengthLbl}
              </span>
            </div>
          </div>
        )}

        {/* Password rules checklist */}
        <AnimatePresence>
          {showRules && password && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-2 overflow-hidden"
            >
              <div className="p-3 rounded-xl space-y-1"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                {RULES.map(rule => (
                  <div key={rule.id} className="flex items-center gap-2">
                    <div className={`w-3.5 h-3.5 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${rule.test(password) ? 'bg-emerald-500/20' : 'bg-white/5'}`}>
                      {rule.test(password)
                        ? <Check className="w-2.5 h-2.5 text-emerald-400" />
                        : <div className="w-1 h-1 rounded-full bg-white/20" />
                      }
                    </div>
                    <span className="text-[11px] transition-colors"
                      style={{ color: rule.test(password) ? '#34d399' : '#6b7585' }}>
                      {rule.label}
                    </span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Confirm Password */}
      <div>
        <label className="block text-xs font-medium tracking-wide uppercase mb-2"
          style={{ color: 'var(--text-muted)' }}>
          Confirm Password
        </label>
        <div className="relative">
          <input
            type={showConfirm ? 'text' : 'password'}
            value={confirm}
            onChange={e => { setConfirm(e.target.value); setError('') }}
            autoComplete="new-password"
            required
            disabled={loading}
            placeholder="Repeat new password"
            className="w-full px-4 py-3 pr-11 rounded-xl text-sm outline-none transition-all duration-200"
            style={{
              background: 'var(--input-bg)',
              border: `1px solid ${confirm ? (passwordsMatch ? 'rgba(52,211,153,0.4)' : 'rgba(248,113,113,0.4)') : 'var(--input-border)'}`,
              color: 'var(--text-primary)',
              boxShadow: 'var(--input-shadow)',
            }}
            onFocus={e => e.target.style.boxShadow = 'var(--input-focus-shadow)'}
            onBlur={e => e.target.style.boxShadow = 'var(--input-shadow)'}
          />
          <button type="button" onClick={() => setShowConfirm(!showConfirm)} tabIndex={-1}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg transition-colors"
            style={{ color: 'var(--text-muted)' }}>
            {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        {confirm && !passwordsMatch && (
          <p className="mt-1 text-[11px]" style={{ color: '#f87171' }}>Passwords do not match</p>
        )}
        {confirm && passwordsMatch && (
          <p className="mt-1 text-[11px]" style={{ color: '#34d399' }}>Passwords match ✓</p>
        )}
      </div>

      {/* Error */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium"
          style={{
            background: 'rgba(248,113,113,0.08)',
            border: '1px solid rgba(248,113,113,0.15)',
            color: 'var(--accent-red)',
          }}
        >
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          {error}
        </motion.div>
      )}

      {/* Submit */}
      <motion.button
        type="submit"
        disabled={loading || !allRulesMet || !passwordsMatch}
        whileHover={!loading ? { scale: 1.02 } : {}}
        whileTap={!loading ? { scale: 0.97 } : {}}
        className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm text-white transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed"
        style={{
          background: 'linear-gradient(135deg, #059669, #34d399)',
          boxShadow: '0 0 20px rgba(52,211,153,0.15), 0 4px 12px rgba(0,0,0,0.2)',
          border: '1px solid rgba(52,211,153,0.2)',
        }}
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
        {loading ? 'Resetting…' : 'Reset Password'}
      </motion.button>
    </motion.form>
  )
}
