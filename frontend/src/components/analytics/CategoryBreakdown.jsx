import React from 'react'
import { motion } from 'framer-motion'
import { BarChart3 } from 'lucide-react'

function ProgressBar({ name, value, pct, isDominant, index }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className={`text-xs font-medium ${isDominant ? 'text-text-primary' : 'text-text-secondary'}`}>
          {name}
          {isDominant && (
            <span className="ml-1.5 text-[9px] font-bold text-accent-green uppercase">Top</span>
          )}
        </span>
        <span className="text-xs text-text-muted">
          {value.toLocaleString()} · {pct}%
        </span>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--btn-secondary-bg)' }}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ delay: index * 0.1, duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
          className="h-full rounded-full"
          style={{
            background: isDominant
              ? 'linear-gradient(90deg, var(--accent-green), var(--accent-green)cc)'
              : 'var(--text-muted)',
            opacity: isDominant ? 1 : 0.4,
          }}
        />
      </div>
    </div>
  )
}

export default function CategoryBreakdown({ breakdown, loading }) {
  if (loading) {
    return (
      <div className="glass-card p-5 h-full">
        <div className="skeleton-dark mb-4" style={{ width: '50%', height: 12 }} />
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i}>
              <div className="skeleton-dark mb-1" style={{ width: '60%', height: 10 }} />
              <div className="skeleton-dark" style={{ width: '100%', height: 8 }} />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (!breakdown) return null

  const { channels, variants } = breakdown
  const hasChannels = channels.length > 0
  const hasVariants = variants.length > 0

  if (!hasChannels && !hasVariants) {
    return (
      <div className="glass-card p-5 h-full">
        <Header />
        <p className="text-sm text-text-muted py-4 text-center">No breakdown data available</p>
      </div>
    )
  }

  const topChannel = hasChannels ? channels[0].name : null
  const topVariant = hasVariants ? variants[0].name : null

  return (
    <div className="glass-card p-5 h-full">
      <Header />

      {hasChannels && (
        <div className="mt-4">
          <p className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-3">Sales Channel</p>
          <div className="space-y-3">
            {channels.map((ch, i) => (
              <ProgressBar
                key={ch.name}
                name={ch.name}
                value={ch.value}
                pct={ch.pct}
                isDominant={ch.name === topChannel && ch.pct > channels[1]?.pct}
                index={i}
              />
            ))}
          </div>
        </div>
      )}

      {hasVariants && (
        <div className={hasChannels ? 'mt-6 pt-4 border-t' : 'mt-4'} style={{ borderColor: 'var(--glass-border)' }}>
          <p className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-3">Current Stock by Variant</p>
          <div className="space-y-3">
            {variants.map((v, i) => (
              <ProgressBar
                key={v.name}
                name={v.name}
                value={v.value}
                pct={v.pct}
                isDominant={v.name === topVariant && variants.length > 1}
                index={i}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Header() {
  return (
    <div className="flex items-center gap-2">
      <BarChart3 className="w-4 h-4 text-text-muted" />
      <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider">Breakdown</h3>
    </div>
  )
}
