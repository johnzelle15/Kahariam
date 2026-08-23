import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { Mail, ArrowLeft, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import api from '../utils/api'

const ease = [0.16, 1, 0.3, 1]

export default function ForgotPassword({ onBack }) {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    const trimmed = email.trim().toLowerCase()
    if (!trimmed || !trimmed.includes('@')) {
      setError('Please enter a valid email address.')
      return
    }

    setLoading(true)
    try {
      await api.post('/auth/forgot-password', { email: trimmed })
    } catch {
      // Endpoint always returns 200; any error is network-level.
      // Still show success to prevent email enumeration.
    } finally {
      setLoading(false)
      setSuccess(true)
    }
  }

  return (
    <motion.div
      key="forgot"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.45, ease }}
      className="w-full"
    >
      {success ? (
        /* ── Success state ── */
        <div className="text-center space-y-4">
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
            <h3 className="text-base font-bold mb-1" style={{ color: '#e8ecf2' }}>
              Check Your Email
            </h3>
            <p className="text-sm leading-relaxed" style={{ color: '#8b95a8' }}>
              If <strong style={{ color: '#c4cad4' }}>{email}</strong> is registered,
              a password reset link has been sent. It expires in{' '}
              <strong style={{ color: '#c4cad4' }}>30 minutes</strong>.
            </p>
            <p className="text-xs mt-2" style={{ color: '#6b7585' }}>
              Didn't receive it? Check your spam folder.
            </p>
          </div>

          <button
            type="button"
            onClick={onBack}
            className="flex items-center justify-center gap-1.5 mx-auto text-sm font-medium transition-colors"
            style={{ color: '#8b95a8' }}
            onMouseEnter={e => e.target.style.color = '#e8ecf2'}
            onMouseLeave={e => e.target.style.color = '#8b95a8'}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Sign In
          </button>
        </div>
      ) : (
        /* ── Form state ── */
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="text-center mb-2">
            <p className="text-sm leading-relaxed" style={{ color: '#8b95a8' }}>
              Enter your registered email address and we'll send you a link to reset your password.
            </p>
          </div>

          {/* Email input */}
          <div>
            <label
              className="block text-xs font-medium tracking-wide uppercase mb-2"
              style={{ color: 'var(--text-muted)' }}
            >
              Email Address
            </label>
            <div className="relative">
              <Mail
                className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
                style={{ color: 'var(--text-muted)' }}
              />
              <input
                type="email"
                value={email}
                onChange={e => { setEmail(e.target.value); setError('') }}
                autoComplete="email"
                autoFocus
                required
                disabled={loading}
                placeholder="you@example.com"
                className="w-full pl-10 pr-4 py-3 rounded-xl text-sm outline-none transition-all duration-200"
                style={{
                  background: 'var(--input-bg)',
                  border: '1px solid var(--input-border)',
                  color: 'var(--text-primary)',
                  boxShadow: 'var(--input-shadow)',
                }}
                onFocus={e => e.target.style.boxShadow = 'var(--input-focus-shadow)'}
                onBlur={e => e.target.style.boxShadow = 'var(--input-shadow)'}
              />
            </div>
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
            disabled={loading || !email}
            whileHover={!loading ? { scale: 1.02 } : {}}
            whileTap={!loading ? { scale: 0.97 } : {}}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm text-white transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: 'linear-gradient(135deg, #059669, #34d399)',
              boxShadow: '0 0 20px rgba(52,211,153,0.15), 0 4px 12px rgba(0,0,0,0.2)',
              border: '1px solid rgba(52,211,153,0.2)',
            }}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
            {loading ? 'Sending...' : 'Send Reset Link'}
          </motion.button>

          {/* Back */}
          <button
            type="button"
            onClick={onBack}
            disabled={loading}
            className="w-full flex items-center justify-center gap-1.5 text-sm font-medium transition-colors"
            style={{ color: '#8b95a8' }}
            onMouseEnter={e => e.currentTarget.style.color = '#e8ecf2'}
            onMouseLeave={e => e.currentTarget.style.color = '#8b95a8'}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Sign In
          </button>
        </form>
      )}
    </motion.div>
  )
}
