import React, { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { TrendingUp, TrendingDown, Minus, DollarSign, Package, Activity, BarChart3 } from 'lucide-react'
import { fmtCurrency } from './useAnalyticsData'

/* ── Animated counter hook ── */
function useAnimatedValue(target, duration = 800) {
  const [display, setDisplay] = useState(0)
  const currentRef = useRef(0)
  const rafRef = useRef(null)

  useEffect(() => {
    cancelAnimationFrame(rafRef.current)
    const from = currentRef.current
    const start = performance.now()

    function tick(now) {
      const t = Math.min((now - start) / duration, 1)
      const eased = 1 - (1 - t) ** 3
      const val = from + (target - from) * eased
      currentRef.current = val
      setDisplay(val)
      if (t < 1) rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [target, duration])

  return display
}

/* ── Skeleton ── */
function KpiSkeleton() {
  return (
    <div className="glass-card p-5">
      <div className="skeleton-dark mb-3" style={{ width: '60%', height: 12 }} />
      <div className="skeleton-dark mb-2" style={{ width: '50%', height: 32 }} />
      <div className="skeleton-dark" style={{ width: '80%', height: 14 }} />
    </div>
  )
}

/* ── Icon mapping ── */
const KPI_META = {
  revenue: { icon: DollarSign, color: 'var(--accent-green)' },
  sold: { icon: Package, color: 'var(--accent-blue)' },
  avg_daily: { icon: Activity, color: 'var(--accent-purple)' },
  rev_per_unit: { icon: BarChart3, color: 'var(--accent-cyan)' },
}

/* ── Single KPI Card ── */
function KpiCard({ kpi, index }) {
  const animated = useAnimatedValue(kpi.value)
  const meta = KPI_META[kpi.id] || { icon: Activity, color: 'var(--accent-blue)' }
  const Icon = meta.icon

  const formatted = kpi.isCurrency
    ? fmtCurrency(animated)
    : animated < 10
      ? animated.toFixed(1)
      : Math.round(animated).toLocaleString()

  const d = kpi.delta
  const isPositive = d > 0.5
  const isNegative = d < -0.5
  const DeltaIcon = isPositive ? TrendingUp : isNegative ? TrendingDown : Minus
  const deltaColor = isPositive ? 'text-accent-green' : isNegative ? 'text-accent-red' : 'text-text-muted'
  const deltaSign = d > 0 ? '+' : ''

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
      className="glass-card p-4 sm:p-5 select-none"
    >
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: `${meta.color}20` }}>
          <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" style={{ color: meta.color }} />
        </div>
        <p className="text-[9px] sm:text-[10px] font-bold text-text-muted uppercase tracking-wider leading-tight">
          {kpi.label}
        </p>
      </div>

      <p className="text-xl sm:text-2xl lg:text-3xl font-extrabold text-text-primary truncate leading-tight">
        {formatted}
      </p>

      <div className={`flex items-center gap-1.5 mt-2 ${deltaColor}`}>
        <DeltaIcon className="w-3.5 h-3.5" />
        <span className="text-xs font-semibold">
          {deltaSign}{Math.abs(d).toFixed(1)}%
        </span>
        <span className="text-[10px] text-text-muted font-medium ml-1">vs prev period</span>
      </div>
    </motion.div>
  )
}

/* ── KPI Strip ── */
export default function KpiStrip({ kpis, loading }) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map(i => <KpiSkeleton key={i} />)}
      </div>
    )
  }

  if (!kpis.length) return null

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {kpis.map((kpi, i) => <KpiCard key={kpi.id} kpi={kpi} index={i} />)}
    </div>
  )
}
