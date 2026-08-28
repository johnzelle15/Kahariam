import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import useAuthStore from '../store/authStore'
import LoginForm from './LoginForm'
import OtpForm from './OtpForm'
import ForgotPassword from './ForgotPassword'
import logoSvg from '../assets/logo.svg'

const ease = [0.16, 1, 0.3, 1]

export default function LoginScreen() {
  const [showForgot, setShowForgot] = useState(false)
  const otpPending = useAuthStore(s => s.otpPending)

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden"
      style={{ background: 'rgb(var(--bg-primary))' }}>

      {/* Ambient */}
      {/* One soft brand glow. The three drifting orbs and twenty floating
          particles were decoration that animated forever behind a login form. */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 70% 50% at 50% 0%, rgba(124,179,66,0.10), transparent 70%)' }} />

      {/* Glass Card */}
      <motion.div
        className="relative z-10 w-full max-w-md mx-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
      >
        <div className="glass-card relative p-8 sm:p-10 overflow-hidden"
          style={{ boxShadow: '0 24px 48px rgba(0,0,0,0.28)' }}>

          <div className="relative flex flex-col items-center text-center">
            {/* Fish icon */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
              className="mb-4"
            >
              <div className="w-14 h-14 rounded-xl flex items-center justify-center"
                style={{ background: 'var(--glass-bg-hover)', border: '1px solid var(--glass-border)' }}>
                <img src={logoSvg} alt="" className="w-9 h-9" />
              </div>
            </motion.div>

            {/* Title */}
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
              className="text-xs font-medium tracking-[0.25em] uppercase mb-2"
              style={{ color: 'var(--accent-green)' }}
            >
              Kahariam Farms
            </motion.p>

            <motion.h1
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
              className="text-2xl sm:text-3xl font-extrabold tracking-tight mb-6"
              style={{ color: 'var(--text-primary)' }}
            >
              {otpPending ? 'Enter OTP' : showForgot ? 'Reset Password' : 'Sign In'}
            </motion.h1>

            {/* Form */}
            <AnimatePresence mode="wait">
              {otpPending ? (
                <motion.div key="otp" className="w-full"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}>
                  <OtpForm />
                </motion.div>
              ) : showForgot ? (
                <motion.div key="forgot" className="w-full"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}>
                  <ForgotPassword onBack={() => setShowForgot(false)} />
                </motion.div>
              ) : (
                <motion.div key="login" className="w-full"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}>
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
