import React, { useState } from 'react'
import { motion } from 'framer-motion'
import {
  AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts'
import { fmtCurrency, fmtShort } from './useAnalyticsData'

/* ── Tooltip ── */
function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const row = payload[0]?.payload
  if (!row) return null

  return (
    <div className="rounded-xl text-sm overflow-hidden"
      style={{
        background: 'var(--tooltip-bg)',
        border: '1px solid var(--tooltip-border)',
        backdropFilter: 'blur(14px)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
      }}>
      <div className="px-4 pt-3 pb-2" style={{ borderBottom: '1px solid var(--glass-border)' }}>
        <p className="font-bold text-xs" style={{ color: 'var(--text-primary)' }}>
          {row.label || fmtShort(row.date)}
        </p>
      </div>
      <div className="px-4 py-2.5 space-y-1.5">
        {payload.map((p, i) => (
          <div key={i} className="flex items-center justify-between gap-6">
            <span className="text-xs flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color }} />
              {p.name}
            </span>
            <span className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
              {p.name === 'Revenue' ? fmtCurrency(p.value) : Number(p.value).toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Metric selector ── */
const METRICS = [
  { key: 'revenue', label: 'Revenue', dataKey: 'revenue', color: 'var(--accent-green)' },
  { key: 'units', label: 'Units Sold', dataKey: 'sold_total', color: 'var(--accent-blue)' },
]

export default function TrendsChart({ data, granularity, loading }) {
  const [metric, setMetric] = useState('revenue')
  const active = METRICS.find(m => m.key === metric) || METRICS[0]

  if (loading) {
    return (
      <div className="glass-card p-5">
        <div className="skeleton-dark mb-4" style={{ width: '30%', height: 12 }} />
        <div className="skeleton-dark" style={{ width: '100%', height: 260 }} />
      </div>
    )
  }

  if (!data.length) {
    return (
      <div className="glass-card p-5">
        <Header metric={metric} setMetric={setMetric} granularity={granularity} />
        <p className="text-sm text-text-muted py-16 text-center">No trend data for this range</p>
      </div>
    )
  }

  const gradientId = `trend-gradient-${metric}`

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="glass-card p-4 sm:p-5"
    >
      <Header metric={metric} setMetric={setMetric} granularity={granularity} />

      <div className="mt-4" style={{ height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={active.color} stopOpacity={0.2} />
                <stop offset="95%" stopColor={active.color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
            <XAxis
              dataKey="label"
              stroke="var(--chart-text)"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              interval={granularity === 'daily' && data.length > 14 ? Math.floor(data.length / 7) : 0}
            />
            <YAxis
              stroke="var(--chart-text)"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              tickFormatter={v => metric === 'revenue' ? `₱${v >= 1000 ? (v / 1000).toFixed(0) + 'K' : v}` : (v >= 1000 ? (v / 1000).toFixed(0) + 'K' : v)}
              width={48}
            />
            <Tooltip content={<ChartTooltip />} />
            <Area
              type="monotone"
              dataKey={active.dataKey}
              name={active.label}
              stroke={active.color}
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              animationDuration={600}
              animationEasing="ease-out"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  )
}

function Header({ metric, setMetric, granularity }) {
  const granLabel = granularity === 'daily' ? 'Daily' : granularity === 'weekly' ? 'Weekly' : 'Monthly'

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider">Trends</h3>
        <span className="text-[10px] text-text-muted px-1.5 py-0.5 rounded"
          style={{ background: 'var(--btn-secondary-bg)', border: '1px solid var(--glass-border)' }}>
          {granLabel}
        </span>
      </div>
      <div className="flex items-center gap-0.5 p-0.5 rounded-lg"
        style={{ background: 'var(--btn-secondary-bg)', border: '1px solid var(--glass-border)' }}>
        {METRICS.map(m => (
          <button
            key={m.key}
            onClick={() => setMetric(m.key)}
            className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all duration-200 ${
              metric === m.key ? 'text-white shadow-sm' : 'text-text-muted hover:text-text-primary'
            }`}
            style={metric === m.key ? { background: `linear-gradient(135deg, ${m.color}, ${m.color}cc)` } : {}}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  )
}
