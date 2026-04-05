import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Lightbulb, ChevronDown } from 'lucide-react'

const TYPE_STYLES = {
  positive: 'text-accent-green',
  negative: 'text-accent-red',
  neutral: 'text-text-secondary',
}

const DEFAULT_VISIBLE = 3

export default function InsightsEngine({ insights, loading }) {
  const [expanded, setExpanded] = useState(false)

  if (loading) {
    return (
      <div className="glass-card p-5 h-full">
        <div className="skeleton-dark mb-4" style={{ width: '40%', height: 12 }} />
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i}>
              <div className="skeleton-dark mb-1" style={{ width: '90%', height: 14 }} />
              <div className="skeleton-dark" style={{ width: '70%', height: 10 }} />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (!insights) return null

  const items = [...(insights.performance || []), ...(insights.trends || [])]
  if (!items.length) {
    return (
      <div className="glass-card p-5 h-full">
        <Header />
        <p className="text-sm text-text-muted py-4 text-center">No insights available for the selected range</p>
      </div>
    )
  }

  const visible = expanded ? items : items.slice(0, DEFAULT_VISIBLE)
  const hasMore = items.length > DEFAULT_VISIBLE

  return (
    <div className="glass-card p-5 h-full">
      <Header count={items.length} />

      <div className="space-y-1 mt-4">
        <AnimatePresence initial={false}>
          {visible.map((item, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25 }}
              className="group flex items-start gap-2.5 p-2 rounded-lg transition-colors hover:bg-white/[0.02]"
              title={item.detail}
            >
              <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
                item.type === 'positive' ? 'bg-accent-green' : item.type === 'negative' ? 'bg-accent-red' : 'bg-text-muted'
              }`} />
              <div className="min-w-0">
                <span className={`text-[13px] font-medium leading-snug block ${TYPE_STYLES[item.type] || TYPE_STYLES.neutral}`}>
                  {item.text}
                </span>
                <span className="text-[11px] text-text-muted leading-snug opacity-0 group-hover:opacity-100 transition-opacity duration-200 block">
                  {item.detail}
                </span>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {hasMore && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="flex items-center gap-1 mt-3 text-[11px] font-semibold text-text-muted hover:text-text-primary transition-colors"
        >
          <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
          {expanded ? 'Show less' : `Show ${items.length - DEFAULT_VISIBLE} more`}
        </button>
      )}
    </div>
  )
}

function Header({ count }) {
  return (
    <div className="flex items-center gap-2">
      <Lightbulb className="w-4 h-4 text-accent-amber" />
      <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider">Insights</h3>
      {count > 0 && <span className="text-[10px] text-text-muted">· {count}</span>}
    </div>
  )
}
