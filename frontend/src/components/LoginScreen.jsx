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
    // theme-dark: the card sits on a photo, so it is always the dark-green
    // surface whatever theme the app itself is set to.
    // m-auto rather than items-center: if the card is ever taller than the
    // screen (an error line on the panel), it scrolls instead of losing its top.
    <div className="theme-dark farm-ground fixed inset-0 z-[9999] flex overflow-y-auto p-3 [@media(max-height:520px)]:p-2">

      <div className="farm-overlay fixed inset-0 pointer-events-none" />

      {/* Glass Card */}
      <motion.div
        className="relative z-10 w-full max-w-md [@media(max-height:520px)]:max-w-2xl m-auto"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
      >
        <div className="glass-card farm-glass relative p-8 sm:p-10 [@media(max-height:520px)]:p-4 overflow-hidden">

          {/* Short screens (the 7" panel) are wide but not tall: brand beside
              the form, so nothing has to be dropped to fit. */}
          <div className="relative flex flex-col items-center text-center [@media(max-height:520px)]:flex-row [@media(max-height:520px)]:gap-8">
            <div className="flex flex-col items-center shrink-0 [@media(max-height:520px)]:w-44">
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
              className="text-2xl sm:text-3xl font-extrabold tracking-tight mb-6 [@media(max-height:520px)]:mb-0"
              style={{ color: 'var(--text-primary)' }}
            >
              {otpPending ? 'Enter OTP' : showForgot ? 'Reset Password' : 'Sign In'}
            </motion.h1>
            </div>

            {/* Form */}
            <div className="w-full min-w-0">
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
        </div>
      </motion.div>
    </div>
  )
}
