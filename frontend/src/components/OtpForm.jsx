import React, { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { ShieldCheck, AlertCircle, Loader2, ArrowLeft, Clock } from 'lucide-react'
import useAuthStore from '../store/authStore'

const ease = [0.16, 1, 0.3, 1]
const OTP_LENGTH = 6

export default function OtpForm() {
  const [digits, setDigits] = useState(Array(OTP_LENGTH).fill(''))
  const inputRefs = useRef([])

  const { verifyOtp, cancelOtp, otpEmailHint, otpExpiresIn, loading, error, clearError } = useAuthStore()

  // Countdown timer
  const [secondsLeft, setSecondsLeft] = useState(otpExpiresIn || 300)
  const [expired, setExpired] = useState(false)

  useEffect(() => {
    if (secondsLeft <= 0) {
      setExpired(true)
      return
    }
    const id = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) { setExpired(true); return 0 }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [secondsLeft])

  const formatTime = (s) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  // Handle individual digit input
  const handleChange = (index, value) => {
    clearError()
    // Only accept digits
    const char = value.replace(/\D/g, '').slice(-1)
    const next = [...digits]
    next[index] = char
    setDigits(next)

    // Auto-advance
    if (char && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus()
    }

    // Auto-submit when all digits filled
    if (char && index === OTP_LENGTH - 1 && next.every(d => d)) {
      handleSubmit(next.join(''))
    }
  }

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
  }

  // Paste full OTP
  const handlePaste = (e) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH)
    if (!pasted) return
    const next = Array(OTP_LENGTH).fill('')
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i]
    setDigits(next)
    if (pasted.length === OTP_LENGTH) {
      handleSubmit(pasted)
    } else {
      inputRefs.current[pasted.length]?.focus()
    }
  }

  const handleSubmit = async (code) => {
    if (loading || expired) return
    const otp = code || digits.join('')
    if (otp.length !== OTP_LENGTH) return
    await verifyOtp(otp)
  }

  const handleFormSubmit = (e) => {
    e.preventDefault()
    handleSubmit()
  }

  const timerColor = secondsLeft > 60 ? 'var(--accent-green)' :
    secondsLeft > 30 ? 'var(--accent-amber)' : 'var(--accent-red)'

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease, delay: 0.2 }}
      className="w-full"
    >
      {/* Header */}
      <div className="text-center mb-6">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5, ease, delay: 0.3 }}
          className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
          style={{
            background: 'linear-gradient(135deg, rgba(96,165,250,0.12), rgba(167,139,250,0.1))',
            border: '1px solid rgba(96,165,250,0.12)',
          }}
        >
          <ShieldCheck className="w-7 h-7" style={{ color: 'var(--accent-blue)' }} />
        </motion.div>

        <h2 className="text-lg font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
          Verify Your Identity
        </h2>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          We sent a 6-digit code to <span style={{ color: 'var(--text-secondary)' }}>{otpEmailHint}</span>
        </p>
      </div>

      {/* Timer */}
      <div className="flex items-center justify-center gap-1.5 mb-5">
        <Clock className="w-3.5 h-3.5" style={{ color: timerColor }} />
        <span className="text-xs font-mono font-semibold" style={{ color: timerColor }}>
          {expired ? 'Code expired' : formatTime(secondsLeft)}
        </span>
      </div>

      {/* OTP Inputs */}
      <form onSubmit={handleFormSubmit}>
        <div className="flex justify-center gap-2 sm:gap-3 mb-5" onPaste={handlePaste}>
          {digits.map((digit, i) => (
            <motion.input
              key={i}
              ref={(el) => inputRefs.current[i] = el}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              onChange={(e) => handleChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              disabled={loading || expired}
              autoFocus={i === 0}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.4 + i * 0.05 }}
              className="w-11 h-13 sm:w-12 sm:h-14 rounded-xl text-center text-xl font-bold outline-none transition-all duration-200 disabled:opacity-40"
              style={{
                background: 'var(--input-bg)',
                border: digit ? '1.5px solid rgba(96,165,250,0.4)' : '1px solid var(--input-border)',
                color: 'var(--text-primary)',
                boxShadow: digit ? '0 0 12px rgba(96,165,250,0.08)' : 'var(--input-shadow)',
                caretColor: 'var(--accent-blue)',
              }}
              onFocus={(e) => {
                e.target.style.borderColor = 'rgba(96,165,250,0.5)'
                e.target.style.boxShadow = 'var(--input-focus-shadow)'
              }}
              onBlur={(e) => {
                e.target.style.borderColor = digit ? 'rgba(96,165,250,0.4)' : 'var(--input-border)'
                e.target.style.boxShadow = digit ? '0 0 12px rgba(96,165,250,0.08)' : 'var(--input-shadow)'
              }}
            />
          ))}
        </div>

        {/* Error */}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium mb-4"
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

        {/* Verify Button */}
        <motion.button
          type="submit"
          disabled={loading || expired || digits.some(d => !d)}
          whileHover={!loading ? { scale: 1.02 } : {}}
          whileTap={!loading ? { scale: 0.97 } : {}}
          className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm text-white transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed mb-3"
          style={{
            background: expired
              ? 'rgba(100,100,120,0.3)'
              : 'linear-gradient(135deg, #2563eb, #60a5fa)',
            boxShadow: expired ? 'none' : '0 0 20px rgba(96,165,250,0.15), 0 4px 12px rgba(0,0,0,0.2)',
            border: '1px solid rgba(96,165,250,0.2)',
          }}
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <ShieldCheck className="w-4 h-4" />
          )}
          {loading ? 'Verifying...' : expired ? 'Code Expired' : 'Verify OTP'}
        </motion.button>
      </form>

      {/* Back to Login */}
      <button
        onClick={cancelOtp}
        disabled={loading}
        className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors duration-200 rounded-lg"
        style={{ color: 'var(--text-muted)' }}
        onMouseEnter={(e) => e.target.style.color = 'var(--text-secondary)'}
        onMouseLeave={(e) => e.target.style.color = 'var(--text-muted)'}
      >
        <ArrowLeft className="w-3 h-3" />
        Back to login
      </button>
    </motion.div>
  )
}
