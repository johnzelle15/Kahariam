import { motion } from 'framer-motion'
import useAuthStore from '../store/authStore'
import { Button } from './ui'
import logoSvg from '../assets/logo.svg'

/* Same ground, card and header as LoginScreen, which directly precedes it.
   The drifting orbs, particles, gradient headline, shimmer line and the fake
   "Loading modules…" sequence that held the button disabled for two seconds
   are gone: they loaded nothing, and the card they made came out ~480px tall
   against the Pi panel's 332px Firefox viewport. */
export default function WelcomeScreen({ onEnter }) {
  const user = useAuthStore(s => s.user)
  const name = user?.fullname || user?.username

  return (
    <motion.div
      className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden"
      style={{ background: 'rgb(var(--bg-primary))' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 70% 50% at 50% 0%, rgba(124,179,66,0.10), transparent 70%)' }} />

      <div className="glass-card relative z-10 w-full max-w-md mx-4 p-8 sm:p-10 flex flex-col items-center text-center"
        style={{ boxShadow: '0 24px 48px rgba(0,0,0,0.28)' }}>
        <div className="w-14 h-14 mb-4 rounded-xl flex items-center justify-center"
          style={{ background: 'var(--glass-bg-hover)', border: '1px solid var(--glass-border)' }}>
          <img src={logoSvg} alt="" className="w-9 h-9" />
        </div>

        <p className="text-xs font-medium tracking-[0.25em] uppercase mb-2"
          style={{ color: 'var(--accent-green)' }}>
          Kahariam Farms
        </p>

        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight mb-6 text-balance"
          style={{ color: 'var(--text-primary)' }}>
          {name ? `Welcome back, ${name}` : 'Welcome back'}
        </h1>

        {/* Staff have no dashboard; they land on the Counter (getDefaultTab). */}
        <Button size="lg" className="w-full" onClick={onEnter}>
          {user?.role === 'admin' ? 'Open Dashboard' : 'Open Counter'}
        </Button>
      </div>
    </motion.div>
  )
}
