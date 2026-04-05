import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ShieldAlert, Target, ChevronDown } from 'lucide-react'

const TYPE_STYLES = {
  positive: 'text-accent-green',
  negative: 'text-accent-red',
  neutral: 'text-text-secondary',
}

function Section({ title, icon: Icon, iconColor, items, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen)

  if (!items || items.length === 0) return null

  return (
    <div className="glass-card overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between p-4 sm:p-5 text-left transition-colors hover:bg-white/[0.02]"
      >
        <div className="flex items-center gap-2">
          <Icon className={`w-4 h-4 ${iconColor}`} />
          <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider">{title}</h3>
          <span className="text-[10px] text-text-muted">· {items.length}</span>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-text-muted transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="px-4 sm:px-5 pb-4 sm:pb-5 space-y-1">
              {items.map((item, i) => (
                <div
                  key={i}
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
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function RisksOpportunities({ insights, loading }) {
  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2].map(i => (
          <div key={i} className="glass-card p-5">
            <div className="skeleton-dark" style={{ width: '30%', height: 12 }} />
          </div>
        ))}
      </div>
    )
  }

  if (!insights) return null

  const hasRisks = insights.risks?.length > 0
  const hasOpps = insights.opportunities?.length > 0

  if (!hasRisks && !hasOpps) return null

  return (
    <div className="space-y-3">
      {hasRisks && (
        <Section
          title="Risks"
          icon={ShieldAlert}
          iconColor="text-accent-red"
          items={insights.risks}
          defaultOpen={false}
        />
      )}
      {hasOpps && (
        <Section
          title="Opportunities"
          icon={Target}
          iconColor="text-accent-green"
          items={insights.opportunities}
          defaultOpen={true}
        />
      )}
    </div>
  )
}
