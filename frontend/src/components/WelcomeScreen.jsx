import React, { useState, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'

/* ─── Orb — a slowly drifting ambient light blob ─── */
function Orb({ color, size, x, y, delay }) {
  return (
    <motion.div
      className="absolute rounded-full pointer-events-none"
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
        filter: 'blur(80px)',
        left: x,
        top: y,
      }}
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{
        opacity: [0, 0.5, 0.3, 0.5, 0.3],
        scale: [0.6, 1, 0.85, 1, 0.9],
        x: [0, 30, -20, 15, 0],
        y: [0, -20, 15, -10, 0],
      }}
      transition={{
        duration: 18,
        ease: 'easeInOut',
        repeat: Infinity,
        delay,
      }}
    />
  )
}

/* ─── Floating particle dots ─── */
function Particles({ count = 30 }) {
  const dots = useMemo(() =>
    Array.from({ length: count }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 2.5 + 1,
      duration: Math.random() * 8 + 12,
      delay: Math.random() * 4,
      opacity: Math.random() * 0.3 + 0.1,
    })),
    [count]
  )

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {dots.map(dot => (
        <motion.div
          key={dot.id}
          className="absolute rounded-full bg-white"
          style={{
            width: dot.size,
            height: dot.size,
            left: `${dot.x}%`,
            top: `${dot.y}%`,
          }}
          initial={{ opacity: 0 }}
          animate={{
            opacity: [0, dot.opacity, 0],
            y: [0, -40, -80],
          }}
          transition={{
            duration: dot.duration,
            ease: 'easeInOut',
            repeat: Infinity,
            delay: dot.delay,
          }}
        />
      ))}
    </div>
  )
}

/* ─── Horizontal shimmer line ─── */
function ShimmerLine() {
  return (
    <div className="relative w-48 h-px mx-auto overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      <motion.div
        className="absolute inset-y-0 w-16"
        style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)' }}
        animate={{ x: ['-4rem', '16rem'] }}
        transition={{ duration: 2.5, ease: 'easeInOut', repeat: Infinity, repeatDelay: 1.5 }}
      />
    </div>
  )
}

/* ─── Fish icon (SVG) ─── */
function FishIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      className="text-[#7cb342]">
      <path d="M6.5 12c3-6 11-6 14.5 0-3.5 6-11.5 6-14.5 0z" />
      <path d="M3 12c-1.5-2-2-4-1-5.5 2 1 3.5 2.5 4.5 5.5" />
      <path d="M3 12c-1.5 2-2 4-1 5.5 2-1 3.5-2.5 4.5-5.5" />
      <circle cx="16" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

/* ═══════════════════════════════════════════
   WELCOME SCREEN — Premium Fullscreen Intro
   ═══════════════════════════════════════════ */
const ease = [0.16, 1, 0.3, 1] // premium cubic-bezier

export default function WelcomeScreen({ onEnter }) {
  const [ready, setReady] = useState(false)
  const [statusText, setStatusText] = useState('Initializing system...')

  // Fake loading sequence
  useEffect(() => {
    const t1 = setTimeout(() => setStatusText('Loading modules...'), 700)
    const t2 = setTimeout(() => setStatusText('Syncing data...'), 1300)
    const t3 = setTimeout(() => {
      setStatusText('System ready')
      setReady(true)
    }, 1900)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [])

  return (
    <motion.div
      className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #0a0f0a 0%, #161c16 40%, #0a0f0a 100%)' }}
      exit={{ opacity: 0, scale: 0.97, filter: 'blur(8px)' }}
      transition={{ duration: 0.6, ease }}
    >
      {/* ── Ambient lighting orbs ── */}
      <Orb color="rgba(124, 179, 66, 0.15)" size="500px" x="-10%" y="-15%" delay={0} />
      <Orb color="rgba(111, 179, 172, 0.12)" size="450px" x="60%"  y="55%"  delay={2} />
      <Orb color="rgba(224, 162, 79, 0.10)"  size="350px" x="70%"  y="-10%" delay={4} />

      {/* ── Particles ── */}
      <Particles count={25} />

      {/* ── Radial vignette overlay ── */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse at center, transparent 40%, rgba(10,14,10,0.7) 100%)' }} />

      {/* ── Glass card ── */}
      <motion.div
        className="relative z-10 w-full max-w-lg mx-4"
        initial={{ opacity: 0, scale: 0.92, y: 30 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.9, ease, delay: 0.15 }}
      >
        <div className="relative p-8 sm:p-10 rounded-3xl border border-white/[0.08] overflow-hidden"
          style={{
            background: 'rgba(255, 255, 255, 0.03)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            boxShadow: '0 32px 64px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)',
          }}>

          {/* Card inner glow */}
          <div
            className="absolute -top-24 left-1/2 -translate-x-1/2 w-64 h-40 pointer-events-none"
            style={{
              background: 'radial-gradient(ellipse, rgba(124,179,66,0.12) 0%, transparent 70%)',
              filter: 'blur(40px)',
            }}
          />

          {/* Content */}
          <div className="relative flex flex-col items-center text-center">
            {/* Fish icon */}
            <motion.div
              initial={{ opacity: 0, y: 15, scale: 0.8 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.7, ease, delay: 0.35 }}
              className="mb-5"
            >
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center border border-white/[0.08]"
                style={{
                  background: 'linear-gradient(135deg, rgba(124,179,66,0.1), rgba(111,179,172,0.08))',
                  boxShadow: '0 0 40px rgba(124,179,66,0.08)',
                }}>
                <FishIcon />
              </div>
            </motion.div>

            {/* Welcome text */}
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease, delay: 0.45 }}
              className="text-xs font-medium tracking-[0.25em] uppercase mb-3"
              style={{ color: 'rgba(124, 179, 66, 0.8)' }}
            >
              Welcome back
            </motion.p>

            {/* Title */}
            <motion.h1
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease, delay: 0.55 }}
              className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-2"
              style={{ color: '#edefe9' }}
            >
              Kahariam Farms
              <span className="block text-transparent bg-clip-text"
                style={{ backgroundImage: 'linear-gradient(135deg, #7cb342, #6fb3ac, #e0a24f)' }}>
                Dashboard
              </span>
            </motion.h1>

            {/* Subtitle */}
            <motion.p
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease, delay: 0.7 }}
              className="text-sm mb-6"
              style={{ color: '#8fa089' }}
            >
              Smart insights for smarter farming
            </motion.p>

            {/* Shimmer divider */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.8 }}
              className="mb-7"
            >
              <ShimmerLine />
            </motion.div>

            {/* Status indicator */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.85 }}
              className="flex items-center gap-2 mb-7"
            >
              <motion.span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: ready ? '#7cb342' : '#e0a24f' }}
                animate={ready ? {} : { opacity: [1, 0.4, 1] }}
                transition={{ duration: 1, repeat: Infinity }}
              />
              <span className="text-[11px] font-medium tracking-wide"
                style={{ color: ready ? '#7cb342' : '#8fa089' }}>
                {statusText}
              </span>
            </motion.div>

            {/* Enter button */}
            <motion.button
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: ready ? 1 : 0.3, y: 0 }}
              transition={{ duration: 0.6, ease, delay: 0.95 }}
              whileHover={ready ? { scale: 1.04, boxShadow: '0 0 40px rgba(124,179,66,0.3), 0 8px 32px rgba(0,0,0,0.3)' } : {}}
              whileTap={ready ? { scale: 0.97 } : {}}
              disabled={!ready}
              onClick={onEnter}
              className="relative px-8 py-3 rounded-xl font-semibold text-sm text-white overflow-hidden transition-all duration-300 disabled:cursor-not-allowed"
              style={{
                background: ready
                  ? 'linear-gradient(135deg, #4c7a3d, #7cb342)'
                  : 'linear-gradient(135deg, rgba(76,122,61,0.3), rgba(124,179,66,0.2))',
                boxShadow: ready
                  ? '0 0 24px rgba(124,179,66,0.2), 0 4px 16px rgba(0,0,0,0.25)'
                  : 'none',
                border: '1px solid rgba(124,179,66,0.2)',
              }}
            >
              {/* Button shimmer */}
              {ready && (
                <motion.span
                  className="absolute inset-0 pointer-events-none"
                  style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.1) 50%, transparent 100%)' }}
                  animate={{ x: ['-100%', '200%'] }}
                  transition={{ duration: 2, ease: 'easeInOut', repeat: Infinity, repeatDelay: 3 }}
                />
              )}
              <span className="relative">Enter Dashboard</span>
            </motion.button>

            {/* Version */}
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 1.2 }}
              className="mt-6 text-[10px] font-medium tracking-wider"
              style={{ color: '#4a5449' }}
            >
              KAHARIAM FARMS · FISH MANAGEMENT
            </motion.p>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
