import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { LogIn, Eye, EyeOff, AlertCircle, Loader2 } from 'lucide-react'
import useAuthStore from '../store/authStore'

const ease = [0.16, 1, 0.3, 1]

export default function LoginForm({ onForgotPassword }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)

  const { login, loading, error, clearError } = useAuthStore()

  const handleSubmit = async (e) => {
    e.preventDefault()
    clearError()
    try {
      await login(username, password)
    } catch {
      // error is set in store
    }
  }

  return (
    <motion.form
      onSubmit={handleSubmit}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease, delay: 0.3 }}
      className="w-full space-y-5"
    >
      {/* Username */}
      <div>
        <label className="block text-xs font-medium tracking-wide uppercase mb-2"
          style={{ color: 'var(--text-muted)' }}>
          Username or Email
        </label>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoFocus
          required
          disabled={loading}
          placeholder="Enter username or email"
          className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-all duration-200"
          style={{
            background: 'var(--input-bg)',
            border: '1px solid var(--input-border)',
            color: 'var(--text-primary)',
            boxShadow: 'var(--input-shadow)',
          }}
          onFocus={(e) => e.target.style.boxShadow = 'var(--input-focus-shadow)'}
          onBlur={(e) => e.target.style.boxShadow = 'var(--input-shadow)'}
        />
      </div>

      {/* Password */}
      <div>
        <label className="block text-xs font-medium tracking-wide uppercase mb-2"
          style={{ color: 'var(--text-muted)' }}>
          Password
        </label>
        <div className="relative">
          <input
            type={showPw ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            disabled={loading}
            placeholder="Enter password"
            className="w-full px-4 py-3 pr-11 rounded-xl text-sm outline-none transition-all duration-200"
            style={{
              background: 'var(--input-bg)',
              border: '1px solid var(--input-border)',
              color: 'var(--text-primary)',
              boxShadow: 'var(--input-shadow)',
            }}
            onFocus={(e) => e.target.style.boxShadow = 'var(--input-focus-shadow)'}
            onBlur={(e) => e.target.style.boxShadow = 'var(--input-shadow)'}
          />
          <button
            type="button"
            onClick={() => setShowPw(!showPw)}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg transition-colors"
            style={{ color: 'var(--text-muted)' }}
            tabIndex={-1}
          >
            {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium"
          style={{
            background: 'rgba(248, 113, 113, 0.08)',
            border: '1px solid rgba(248, 113, 113, 0.15)',
            color: 'var(--accent-red)',
          }}
        >
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          {error}
        </motion.div>
      )}

      {/* Submit */}
      <div className="space-y-3">
        <motion.button
          type="submit"
        disabled={loading || !username || !password}
        whileHover={!loading ? { scale: 1.02 } : {}}
        whileTap={!loading ? { scale: 0.97 } : {}}
        className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm text-white transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed"
        style={{
          background: 'linear-gradient(135deg, #059669, #34d399)',
          boxShadow: '0 0 20px rgba(52,211,153,0.15), 0 4px 12px rgba(0,0,0,0.2)',
          border: '1px solid rgba(52,211,153,0.2)',
        }}
      >
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <LogIn className="w-4 h-4" />
        )}
        {loading ? 'Sending OTP...' : 'Sign In'}
      </motion.button>

      {/* Forgot Password link */}
      {onForgotPassword && (
        <div className="text-center">
          <button
            type="button"
            onClick={onForgotPassword}
            disabled={loading}
            className="text-xs font-medium transition-colors"
            style={{ color: '#8b95a8' }}
            onMouseEnter={e => e.currentTarget.style.color = '#34d399'}
            onMouseLeave={e => e.currentTarget.style.color = '#8b95a8'}
          >
            Forgot password?
          </button>
        </div>
      )}
      </div>
    </motion.form>
  )
}
