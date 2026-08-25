import React, { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import useAuthStore from '../store/authStore'
import LoginForm from './LoginForm'
import OtpForm from './OtpForm'
import ForgotPassword from './ForgotPassword'

/* ─── Ambient orb ─── */
function Orb({ color, size, x, y, delay }) {
  return (
    <motion.div
      className="absolute rounded-full pointer-events-none"
      style={{
        width: size, height: size,
        background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
        filter: 'blur(80px)', left: x, top: y,
      }}
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{
        opacity: [0, 0.5, 0.3, 0.5, 0.3],
        scale: [0.6, 1, 0.85, 1, 0.9],
        x: [0, 30, -20, 15, 0],
        y: [0, -20, 15, -10, 0],
      }}
      transition={{ duration: 18, ease: 'easeInOut', repeat: Infinity, delay }}
    />
  )
}

/* ─── Floating particles ─── */
function Particles({ count = 20 }) {
  const dots = useMemo(() =>
    Array.from({ length: count }, (_, i) => ({
      id: i,
      x: Math.random() * 100, y: Math.random() * 100,
      size: Math.random() * 2.5 + 1,
      duration: Math.random() * 8 + 12,
      delay: Math.random() * 4,
      opacity: Math.random() * 0.3 + 0.1,
    })), [count])

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {dots.map(dot => (
        <motion.div key={dot.id}
          className="absolute rounded-full bg-white"
          style={{ width: dot.size, height: dot.size, left: `${dot.x}%`, top: `${dot.y}%` }}
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, dot.opacity, 0], y: [0, -40, -80] }}
          transition={{ duration: dot.duration, ease: 'easeInOut', repeat: Infinity, delay: dot.delay }}
        />
      ))}
    </div>
  )
}

/* ─── Fish icon ─── */
function FishIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      className="text-emerald-400">
      <path d="M6.5 12c3-6 11-6 14.5 0-3.5 6-11.5 6-14.5 0z" />
      <path d="M3 12c-1.5-2-2-4-1-5.5 2 1 3.5 2.5 4.5 5.5" />
      <path d="M3 12c-1.5 2-2 4-1 5.5 2-1 3.5-2.5 4.5-5.5" />
      <circle cx="16" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

const ease = [0.16, 1, 0.3, 1]

export default function LoginScreen() {
  const [showForgot, setShowForgot] = useState(false)
  const otpPending = useAuthStore(s => s.otpPending)

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #020617 0%, #0f172a 40%, #020617 100%)' }}>

      {/* Ambient */}
      <Orb color="rgba(52, 211, 153, 0.15)" size="500px" x="-10%" y="-15%" delay={0} />
      <Orb color="rgba(96, 165, 250, 0.12)"  size="450px" x="60%"  y="55%"  delay={2} />
      <Orb color="rgba(167, 139, 250, 0.10)" size="350px" x="70%"  y="-10%" delay={4} />
      <Particles count={20} />

      {/* Vignette */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse at center, transparent 40%, rgba(2,6,23,0.7) 100%)' }} />

      {/* Glass Card */}
      <motion.div
        className="relative z-10 w-full max-w-md mx-4"
        initial={{ opacity: 0, scale: 0.92, y: 30 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.9, ease, delay: 0.1 }}
      >
        <div className="relative p-8 sm:p-10 rounded-3xl border border-white/[0.08] overflow-hidden"
          style={{
            background: 'rgba(255, 255, 255, 0.03)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            boxShadow: '0 32px 64px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)',
          }}>

          {/* Glow */}
          <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-64 h-40 pointer-events-none"
            style={{
              background: 'radial-gradient(ellipse, rgba(52,211,153,0.12) 0%, transparent 70%)',
              filter: 'blur(40px)',
            }} />

          <div className="relative flex flex-col items-center text-center">
            {/* Fish icon */}
            <motion.div
              initial={{ opacity: 0, y: 15, scale: 0.8 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.7, ease, delay: 0.2 }}
              className="mb-4"
            >
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center border border-white/[0.08]"
                style={{
                  background: 'linear-gradient(135deg, rgba(52,211,153,0.1), rgba(96,165,250,0.08))',
                  boxShadow: '0 0 40px rgba(52,211,153,0.08)',
                }}>
                <FishIcon />
              </div>
            </motion.div>

            {/* Title */}
            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease, delay: 0.25 }}
              className="text-xs font-medium tracking-[0.25em] uppercase mb-2"
              style={{ color: 'rgba(52, 211, 153, 0.8)' }}
            >
              Kahariam Farms
            </motion.p>

            <motion.h1
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease, delay: 0.3 }}
              className="text-2xl sm:text-3xl font-extrabold tracking-tight mb-6"
              style={{ color: '#e8ecf2' }}
            >
              {otpPending ? 'Enter OTP' : showForgot ? 'Reset Password' : 'Sign In'}
            </motion.h1>

            {/* Form */}
            <AnimatePresence mode="wait">
              {otpPending ? (
                <motion.div key="otp" className="w-full"
                  initial={{ opacity: 0, x: 40 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -40 }}
                  transition={{ duration: 0.35, ease }}>
                  <OtpForm />
                </motion.div>
              ) : showForgot ? (
                <motion.div key="forgot" className="w-full"
                  initial={{ opacity: 0, x: 40 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -40 }}
                  transition={{ duration: 0.35, ease }}>
                  <ForgotPassword onBack={() => setShowForgot(false)} />
                </motion.div>
              ) : (
                <motion.div key="login" className="w-full"
                  initial={{ opacity: 0, x: -40 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 40 }}
                  transition={{ duration: 0.35, ease }}>
                  <LoginForm onForgotPassword={() => setShowForgot(true)} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
