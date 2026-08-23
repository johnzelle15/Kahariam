import React, { useEffect, useState, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import axios from 'axios'
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend
} from 'recharts'
import {
  TrendingUp, Fish, ScanLine, DollarSign,
  Activity, AlertTriangle, Filter, Calendar, X, Package,
  Lightbulb, Zap, Target, ShieldAlert
} from 'lucide-react'
import SalesTrend from './SalesTrend'
import { getNoteDisplay } from '../utils/notes'
import { Button, EmptyState, Modal, PageHeader, StatCard, StatusIndicator, Skeleton } from './ui'
import useAuthStore from '../store/authStore'

/* ─── Helpers ─── */
function useDebounce(fn, delay) {
  const timer = useRef(null)
  const fnRef = useRef(fn)
  fnRef.current = fn
  return useCallback((...args) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => fnRef.current(...args), delay)
  }, [delay])
}

function KpiSkeleton() {
  return (
    <div className="glass-card stat-glow p-5">
      <Skeleton width="60%" height={12} className="mb-3" />
      <Skeleton width="50%" height={32} className="mb-2" />
      <Skeleton width="80%" height={14} />
    </div>
  )
}

const CHART_COLORS = ['#4C7A3D']
const VARIANT_COLORS = { SPIN_20: '#4C7A3D' }

const formatCurrency = v => {
  try { return '₱' + Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
  catch { return '₱0.00' }
}

/* ─── Trend percentage (used by StatCard) ─── */
function trendPercent(current, yesterday) {
  const cur = Number(current || 0)
  const yday = Number(yesterday || 0)
  const diff = cur - yday
  if (yday !== 0) return (diff / Math.abs(yday)) * 100
  return diff !== 0 ? 100 : 0
}

/* ─── Low Stock Alerts ─── */
function LowStockAlerts({ alerts, loading }) {
  if (loading) {
    return (
      <div className="glass-card p-5">
        <Skeleton width="40%" height={16} className="mb-3" />
        <Skeleton width="100%" height={48} />
      </div>
    )
  }

  const activeAlerts = (alerts || []).filter(a => a.status !== 'ok')

  return (
    <div className="glass-card p-5 h-full">
      <div className="flex items-center gap-2 mb-4">
        <AlertTriangle className="w-4 h-4 text-accent-amber" />
        <h3 className="text-sm font-bold text-text-primary uppercase tracking-wider">Stock Alerts</h3>
      </div>
      {activeAlerts.length === 0 ? (
        <p className="text-sm text-accent-green font-medium">All stock levels healthy</p>
      ) : (
        <div className="flex flex-col gap-3">
          {activeAlerts.map((a, i) => (
            <div key={i} className={`flex items-center justify-between p-3 rounded-xl border
              ${a.status === 'critical'
                ? 'bg-accent-red/10 border-accent-red/20'
                : 'bg-accent-amber/10 border-accent-amber/20'
              }`}>
              <div>
                <p className="text-sm font-semibold text-text-primary">{a.variant}</p>
                <p className="text-xs text-text-muted">{a.source === 'tank' ? 'Fish Tank' : 'Wholesale'}</p>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold text-text-primary">{a.stock}</p>
                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full
                  ${a.status === 'critical' ? 'bg-accent-red/20 text-accent-red' : 'bg-accent-amber/20 text-accent-amber'}
                `}>{a.status}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-4 pt-3 border-t border-white/5">
        <p className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-2">Indicators</p>
        <div className="flex gap-4 text-xs text-text-muted">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-accent-red" /> Critical (≤15)
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-accent-amber" /> Warning (16-30)
          </span>
        </div>
      </div>
    </div>
  )
}

/* ─── Custom Tooltip ─── */
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="px-4 py-3 rounded-xl text-sm"
      style={{
        background: 'var(--tooltip-bg)',
        border: '1px solid var(--tooltip-border)',
        backdropFilter: 'blur(12px)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      }}>
      <p className="font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }}>
          {p.name}: {typeof p.value === 'number' ? p.value.toLocaleString() : p.value}
        </p>
      ))}
    </div>
  )
}

/* ═══════════════════════════════════════════════════
   RANGE-ADAPTIVE ANALYTICS INSIGHT ENGINE
   ═══════════════════════════════════════════════════ */

const fmtShortDate = (ds) => {
  const d = new Date(ds + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
const fmtMonthYear = (ds) => {
  const d = new Date(ds + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

const pct = (a, b) => (b !== 0 ? ((a - b) / Math.abs(b)) * 100 : a !== 0 ? 100 : 0)
const arrow = (v) => (v > 0 ? '↑' : v < 0 ? '↓' : '→')

/* ── Adaptive helpers ── */

/** Group daily data into weekly buckets. Returns [{label, sold, revenue, days}] */
function groupByWeek(data) {
  const weeks = []
  for (let i = 0; i < data.length; i += 7) {
    const chunk = data.slice(i, i + 7)
    const start = chunk[0].date
    const end = chunk[chunk.length - 1].date
    weeks.push({
      label: `${fmtShortDate(start)} – ${fmtShortDate(end)}`,
      sold: chunk.reduce((s, d) => s + d.sold_total, 0),
      revenue: chunk.reduce((s, d) => s + d.revenue, 0),
      days: chunk.length,
    })
  }
  return weeks
}

/** Group daily data into monthly buckets */
function groupByMonth(data) {
  const months = {}
  data.forEach(d => {
    const key = d.date.slice(0, 7) // YYYY-MM
    if (!months[key]) months[key] = { label: fmtMonthYear(d.date), sold: 0, revenue: 0, days: 0 }
    months[key].sold += d.sold_total
    months[key].revenue += d.revenue
    months[key].days++
  })
  return Object.values(months)
}

/** Determine range tier: "short" (≤7), "medium" (8–30), "long" (>30) */
function rangeTier(len) {
  if (len <= 7) return 'short'
  if (len <= 30) return 'medium'
  return 'long'
}

/** Describe a range length in human terms */
function rangeLabel(len) {
  if (len <= 1) return 'today'
  if (len <= 7) return `${len} days`
  if (len <= 14) return `${len} days`
  if (len <= 35) return `${Math.round(len / 7)} weeks`
  if (len <= 95) return `${Math.round(len / 30)} months`
  return `${Math.round(len / 30)} months`
}

/** Split data into two comparable halves; returns { first, second, firstLabel, secondLabel } */
function splitPeriod(data) {
  const mid = Math.floor(data.length / 2)
  const first = data.slice(0, mid)
  const second = data.slice(mid)
  if (first.length === 0 || second.length === 0) return null
  return {
    first, second,
    firstLabel: `${fmtShortDate(first[0].date)} – ${fmtShortDate(first[first.length - 1].date)}`,
    secondLabel: `${fmtShortDate(second[0].date)} – ${fmtShortDate(second[second.length - 1].date)}`,
    firstSold: first.reduce((s, d) => s + d.sold_total, 0),
    secondSold: second.reduce((s, d) => s + d.sold_total, 0),
    firstRev: first.reduce((s, d) => s + d.revenue, 0),
    secondRev: second.reduce((s, d) => s + d.revenue, 0),
  }
}

/** Describe magnitude in natural language */
function describeMagnitude(absPct) {
  if (absPct >= 80) return 'nearly doubled'
  if (absPct >= 45) return 'surged'
  if (absPct >= 20) return 'climbed strongly'
  if (absPct >= 8) return 'grew steadily'
  if (absPct >= 2) return 'edged up'
  return 'held flat'
}
function describeDecline(absPct) {
  if (absPct >= 50) return 'collapsed'
  if (absPct >= 30) return 'dropped sharply'
  if (absPct >= 15) return 'declined noticeably'
  if (absPct >= 5) return 'softened'
  return 'dipped slightly'
}

/** Detect overall volatility: stdev / mean of daily sales */
function volatility(sales) {
  const n = sales.length
  if (n < 3) return 0
  const mean = sales.reduce((s, v) => s + v, 0) / n
  if (mean === 0) return 0
  const variance = sales.reduce((s, v) => s + (v - mean) ** 2, 0) / n
  return Math.sqrt(variance) / mean // coefficient of variation
}

/**
 * Core insight generation engine — fully range-adaptive.
 */
function generateInsights(dailyData, stats, lowStockAlerts) {
  const insights = { performance: [], trends: [], risks: [], opportunities: [] }
  if (!dailyData || dailyData.length === 0 || !stats) return insights

  const days = dailyData
  const len = days.length
  const tier = rangeTier(len)
  const periodName = rangeLabel(len)
  const yday = stats.yesterday || {}

  // ── Core metrics ──
  const totalSold = days.reduce((s, d) => s + d.sold_total, 0)
  const totalRevenue = days.reduce((s, d) => s + d.revenue, 0)
  const avgDaily = len > 0 ? Math.round(totalSold / len) : 0
  const avgRevenue = len > 0 ? totalRevenue / len : 0
  const sales = days.map(d => d.sold_total)

  // Peak & Lowest (daily for short/medium, grouped for long)
  const peakIdx = sales.indexOf(Math.max(...sales))
  const lowIdx = sales.indexOf(Math.min(...sales))
  const peakDay = days[peakIdx]
  const lowDay = days[lowIdx]

  // Day-over-day diffs
  const diffs = sales.slice(1).map((v, i) => ({ idx: i + 1, change: v - sales[i], pct: pct(v, sales[i]) }))
  const biggestDrop = diffs.length > 0 ? diffs.reduce((w, d) => d.pct < w.pct ? d : w, { pct: 0 }) : { pct: 0 }
  const biggestGain = diffs.length > 0 ? diffs.reduce((b, d) => d.pct > b.pct ? d : b, { pct: 0 }) : { pct: 0 }

  // Revenue comparison
  const todayRev = Number(stats.today_revenue || 0)
  const ydayRev = Number(yday.today_revenue || 0)
  const revChange = pct(todayRev, ydayRev)

  // Variant data
  const allVariants = (stats.by_variant || []).concat(stats.by_variant_wholesale || [])
  const variantTotals = {}
  allVariants.forEach(v => { variantTotals[v.variant] = (variantTotals[v.variant] || 0) + Number(v.count || 0) })
  const sortedVariants = Object.entries(variantTotals).sort((a, b) => b[1] - a[1])
  const topVariant = sortedVariants[0]
  const bottomVariant = sortedVariants[sortedVariants.length - 1]

  // ── Adaptive split ──
  const split = splitPeriod(days)
  const splitTrend = split ? pct(split.secondSold, split.firstSold) : 0
  const splitRevTrend = split ? pct(split.secondRev, split.firstRev) : 0

  // ── Adaptive momentum (last ~20% vs prior ~20%) ──
  const windowSize = Math.max(2, Math.min(7, Math.floor(len * 0.2)))
  const recentWindow = days.slice(-windowSize).reduce((s, d) => s + d.sold_total, 0)
  const priorWindow = days.slice(-(windowSize * 2), -windowSize).reduce((s, d) => s + d.sold_total, 0)
  const momentumPct = pct(recentWindow, priorWindow)

  // ── Grouped data for long ranges ──
  const weeks = tier === 'medium' || tier === 'long' ? groupByWeek(days) : []
  const months = tier === 'long' ? groupByMonth(days) : []

  // Volatility
  const vol = volatility(sales)
  const isVolatile = vol > 0.35
  const isStable = vol < 0.15

  // ┌─────────────────────────────────────────┐
  // │  1. PERFORMANCE (max 3)                 │
  // └─────────────────────────────────────────┘
  if (todayRev > 0 && ydayRev > 0) {
    const dir = revChange >= 0
    insights.performance.push({
      text: `${dir ? '📈' : '📉'} ${dir ? '+' : ''}${revChange.toFixed(1)}% revenue vs yesterday → ${formatCurrency(todayRev)}`,
      detail: `Previous: ${formatCurrency(ydayRev)}`,
      type: dir ? 'positive' : 'negative',
    })
  } else if (todayRev > 0) {
    insights.performance.push({
      text: `🔵 ${formatCurrency(todayRev)} revenue today`,
      detail: '',
      type: 'positive',
    })
  }

  if (peakDay && peakDay.sold_total > 0) {
    const peakVsAvg = avgDaily > 0 ? ((peakDay.sold_total / avgDaily) - 1) * 100 : 0
    const peakSuffix = peakVsAvg > 200 ? 'outlier spike' : `+${peakVsAvg.toFixed(0)}% vs avg`
    insights.performance.push({
      text: `📈 ${peakDay.sold_total.toLocaleString()} units peak on ${fmtShortDate(peakDay.date)} → ${peakSuffix}`,
      detail: `${periodName} avg: ${avgDaily} units/day`,
      type: 'positive',
    })
  }

  if (avgDaily > 0) {
    insights.performance.push({
      text: `🔵 ${totalSold.toLocaleString()} sold, ${formatCurrency(totalRevenue)} → ${periodName} total`,
      detail: `${avgDaily} units/day, ${formatCurrency(avgRevenue)}/day avg`,
      type: 'neutral',
    })
  }

  insights.performance = insights.performance.slice(0, 3)

  // ┌─────────────────────────────────────────┐
  // │  2. TRENDS (adaptive by tier)           │
  // └─────────────────────────────────────────┘

  // Period-over-period direction
  if (split && split.firstSold > 0) {
    insights.trends.push({
      text: `${splitTrend >= 0 ? '📈' : '📉'} ${splitTrend >= 0 ? '+' : ''}${splitTrend.toFixed(1)}% sales → ${splitTrend >= 5 ? 'strong' : splitTrend <= -5 ? 'weak' : 'flat'} late-period`,
      detail: `${split.firstLabel}: ${split.firstSold.toLocaleString()} → ${split.secondLabel}: ${split.secondSold.toLocaleString()}`,
      type: splitTrend >= 5 ? 'positive' : splitTrend <= -5 ? 'negative' : 'neutral',
    })
  }

  // Momentum
  if (len >= 4 && priorWindow > 0) {
    const dir = momentumPct >= 0
    const windowLabel = windowSize === 1 ? 'day' : `${windowSize} days`
    insights.trends.push({
      text: `${dir ? '📈' : '📉'} ${dir ? '+' : ''}${momentumPct.toFixed(1)}% last ${windowLabel} → ${dir ? 'accelerating' : 'decelerating'}`,
      detail: `Recent: ${recentWindow.toLocaleString()} vs Prior: ${priorWindow.toLocaleString()}`,
      type: momentumPct >= 10 ? 'positive' : momentumPct <= -10 ? 'negative' : 'neutral',
    })
  }

  // Long-range: weekly pattern for medium tier
  if (tier === 'medium' && weeks.length >= 3) {
    const bestWeek = weeks.reduce((b, w) => w.sold > b.sold ? w : b, weeks[0])
    insights.trends.push({
      text: `🔵 ${bestWeek.sold.toLocaleString()} units → best week (${bestWeek.label})`,
      detail: `${weeks.length} weeks analyzed`,
      type: 'neutral',
    })
  }

  // Long-range: monthly seasonality
  if (tier === 'long' && months.length >= 2) {
    const bestMonth = months.reduce((b, m) => m.sold > b.sold ? m : b, months[0])
    const worstMonth = months.reduce((w, m) => m.sold < w.sold ? m : w, months[0])
    if (bestMonth.label !== worstMonth.label) {
      insights.trends.push({
        text: `📈 ${bestMonth.label}: ${bestMonth.sold.toLocaleString()} peak → ${worstMonth.label}: ${worstMonth.sold.toLocaleString()} low`,
        detail: `${months.length} months compared`,
        type: 'neutral',
      })
    }
  }

  // Recovery detection — skip noise from zero-to-nonzero bounces
  if (biggestDrop.pct < -20 && biggestGain.pct > 15 && biggestGain.pct <= 500 && biggestGain.idx > biggestDrop.idx) {
    insights.trends.push({
      text: `📈 +${biggestGain.pct.toFixed(0)}% rebound → recovery after ${fmtShortDate(days[biggestDrop.idx].date)} dip`,
      detail: `Dropped ${Math.abs(biggestDrop.pct).toFixed(0)}%, recovered in ${biggestGain.idx - biggestDrop.idx}d`,
      type: 'positive',
    })
  }

  // Volatility — only when meaningful, skip extreme noise
  if (isVolatile && vol <= 2) {
    insights.trends.push({
      text: `⚠️ High demand variability → inconsistent daily sales`,
      detail: `CV: ${(vol * 100).toFixed(0)}% over ${periodName}`,
      type: 'negative',
    })
  } else if (isStable && len >= 5) {
    insights.trends.push({
      text: `📈 Stable demand → consistent daily sales`,
      detail: `CV: ${(vol * 100).toFixed(0)}% over ${periodName}`,
      type: 'positive',
    })
  }

  // Limit trends to top 3
  insights.trends = insights.trends.slice(0, 3)

  // ┌─────────────────────────────────────────┐
  // │  3. RISKS (max 3)                       │
  // └─────────────────────────────────────────┘
  // Zero revenue today — this is a risk, not performance
  if (todayRev === 0 && ydayRev > 0) {
    insights.risks.push({
      text: `⚠️ ₱0 revenue today → −100% vs yesterday`,
      detail: `Previous: ${formatCurrency(ydayRev)}`,
      type: 'negative',
    })
  }

  // Deduplicate: if biggest drop lands on a zero-sales day, show one combined bullet
  const dropDay = biggestDrop.pct < -25 ? days[biggestDrop.idx] : null
  const dropIsZero = dropDay && dropDay.sold_total === 0
  const zeroIsDropDay = lowDay && lowDay.sold_total === 0 && dropDay && lowDay.date === dropDay.date

  if (dropDay && dropIsZero) {
    // Combined: the drop resulted in zero sales
    insights.risks.push({
      text: `⚠️ 0 sales on ${fmtShortDate(dropDay.date)} → ${Math.abs(biggestDrop.pct).toFixed(0)}% drop from prior day`,
      detail: `Previous day: ${sales[biggestDrop.idx - 1].toLocaleString()} units`,
      type: 'negative',
    })
  } else {
    if (biggestDrop.pct < -25) {
      insights.risks.push({
        text: `⚠️ −${Math.abs(biggestDrop.pct).toFixed(0)}% drop on ${fmtShortDate(days[biggestDrop.idx].date)} → ${sales[biggestDrop.idx]} units`,
        detail: `Previous day: ${sales[biggestDrop.idx - 1].toLocaleString()} units`,
        type: 'negative',
      })
    }
    if (lowDay && lowDay.sold_total === 0 && len > 1 && !zeroIsDropDay) {
      insights.risks.push({
        text: `⚠️ 0 sales on ${fmtShortDate(lowDay.date)} → verify downtime or gap`,
        detail: '',
        type: 'negative',
      })
    } else if (lowDay && lowDay.sold_total > 0 && avgDaily > 0 && lowDay.sold_total < avgDaily * 0.35) {
      insights.risks.push({
        text: `📉 ${lowDay.sold_total} units on ${fmtShortDate(lowDay.date)} → ${Math.round((lowDay.sold_total / avgDaily) * 100)}% of avg`,
        detail: `Avg: ${avgDaily} units/day`,
        type: 'negative',
      })
    }
  }

  // Revenue declining across period
  if (split && split.firstRev > 0 && splitRevTrend < -10) {
    insights.risks.push({
      text: `📉 −${Math.abs(splitRevTrend).toFixed(1)}% revenue → late-period decline`,
      detail: `${split.firstLabel}: ${formatCurrency(split.firstRev)} → ${split.secondLabel}: ${formatCurrency(split.secondRev)}`,
      type: 'negative',
    })
  }

  const activeAlerts = (lowStockAlerts || []).filter(a => a.status !== 'ok')
  const criticals = activeAlerts.filter(a => a.status === 'critical')
  if (criticals.length > 0) {
    insights.risks.push({
      text: `⚠️ Critical: ${criticals.map(a => `${a.variant} (${a.stock})`).join(', ')} → restock now`,
      detail: 'Below safety threshold',
      type: 'negative',
    })
  } else if (activeAlerts.length > 0) {
    insights.risks.push({
      text: `⚠️ ${activeAlerts.length} stock warning${activeAlerts.length > 1 ? 's' : ''} → ${activeAlerts.map(a => a.variant).join(', ')}`,
      detail: 'Approaching low levels',
      type: 'negative',
    })
  }

  insights.risks = insights.risks.slice(0, 3)

  // ┌─────────────────────────────────────────┐
  // │  4. OPPORTUNITIES (max 3)               │
  // └─────────────────────────────────────────┘
  if (topVariant && topVariant[1] > 0) {
    const allTotal = sortedVariants.reduce((s, v) => s + v[1], 0)
    const share = allTotal > 0 ? Math.round((topVariant[1] / allTotal) * 100) : 0
    insights.opportunities.push({
      text: `🟢 ${topVariant[0]} leads at ${share}% → ${topVariant[1].toLocaleString()} units sold`,
      detail: 'Prioritize availability for top variant',
      type: 'positive',
    })
  }

  if (bottomVariant && sortedVariants.length > 1 && topVariant && topVariant[1] > 0) {
    const gap = topVariant[1] - bottomVariant[1]
    if (gap > 0 && bottomVariant[1] > 0) {
      insights.opportunities.push({
        text: `🟢 ${bottomVariant[0]} trails by ${gap.toLocaleString()} units → growth room`,
        detail: 'Consider pricing or bundling to close gap',
        type: 'neutral',
      })
    }
  }

  // Upward momentum opportunity
  if (split && splitTrend > 15) {
    insights.opportunities.push({
      text: `🟢 +${splitTrend.toFixed(0)}% growth trend → scale supply to match`,
      detail: 'Demand accelerating in later half',
      type: 'positive',
    })
  }

  insights.opportunities = insights.opportunities.slice(0, 3)

  return insights
}

/* ─── Range presets for insight panel ─── */
const INSIGHT_RANGES = [
  { key: '7d',    label: '7D',      days: 7 },
  { key: '30d',   label: '30D',     days: 30 },
  { key: 'month', label: '3 Months', days: 90 },
]

/* ─── Category config ─── */
const INSIGHT_CATEGORIES = [
  { key: 'performance',   label: 'Performance',   icon: Zap,          color: 'text-accent-amber',  dot: 'bg-accent-amber',  accentClass: 'accent-amber',  iconBg: 'bg-accent-amber/10' },
  { key: 'trends',        label: 'Trends',        icon: TrendingUp,   color: 'text-accent-blue',   dot: 'bg-accent-blue',   accentClass: 'accent-blue',   iconBg: 'bg-accent-blue/10' },
  { key: 'risks',         label: 'Risks',         icon: ShieldAlert,  color: 'text-accent-red',    dot: 'bg-accent-red',    accentClass: 'accent-red',    iconBg: 'bg-accent-red/10' },
  { key: 'opportunities', label: 'Opportunities', icon: Target,       color: 'text-accent-green',  dot: 'bg-accent-green',  accentClass: 'accent-green',  iconBg: 'bg-accent-green/10' },
]

const TYPE_COLORS = {
  positive: 'text-accent-green',
  negative: 'text-accent-red',
  neutral: 'text-text-secondary',
}

/* ─── Analytics Insights Panel (premium SaaS layout) ─── */
function InsightCard({ cat, items }) {
  const CatIcon = cat.icon
  if (!items || items.length === 0) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
      className="insight-card group/card"
    >
      {/* Card header accent line */}
      <div className={`insight-card-accent ${cat.accentClass}`} />

      {/* Section label */}
      <div className="flex items-center gap-2 mb-3 pt-1">
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${cat.iconBg}`}>
          <CatIcon className={`w-3.5 h-3.5 ${cat.color}`} />
        </div>
        <span className={`text-[11px] font-bold uppercase tracking-wider ${cat.color}`}>{cat.label}</span>
        <span className="ml-auto text-[10px] text-text-muted font-medium">{items.length}</span>
      </div>

      {/* Insight rows */}
      <div className="space-y-0.5">
        {items.map((insight, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.06, duration: 0.3 }}
            className="insight-row group"
            title={insight.detail}
          >
            <span className={`insight-dot ${cat.dot}`} />
            <div className="min-w-0 flex-1">
              <span className={`text-[13px] font-medium leading-snug block ${TYPE_COLORS[insight.type]}`}>
                {insight.text}
              </span>
              {insight.detail && (
                <span className="text-[11px] text-text-muted leading-snug block mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                  {insight.detail}
                </span>
              )}
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  )
}

function InsightSkeleton() {
  return (
    <div className="insight-card">
      <div className="insight-card-accent bg-white/5" />
      <div className="flex items-center gap-2 mb-3 pt-1">
        <Skeleton width={28} height={28} className="!rounded-lg" />
        <Skeleton width="40%" height={10} />
      </div>
      <div className="space-y-2.5">
        {[1, 2].map(i => (
          <div key={i} className="flex items-start gap-2.5 p-2">
            <Skeleton width={6} height={6} className="!rounded-full mt-1" />
            <div className="flex-1 space-y-1.5">
              <Skeleton width="90%" height={13} />
              <Skeleton width="60%" height={10} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function AnalyticsInsights({ stats, lowStockAlerts, loading }) {
  const [dailyData, setDailyData] = useState([])
  const [trendLoading, setTrendLoading] = useState(true)
  const [rangeKey, setRangeKey] = useState('7d')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [showCustom, setShowCustom] = useState(false)

  // Fetch daily-trend data whenever range changes
  useEffect(() => {
    let cancelled = false
    setTrendLoading(true)

    let url
    if (showCustom && customStart && customEnd) {
      url = `/api/daily-trend?start_date=${customStart}&end_date=${customEnd}`
    } else {
      const preset = INSIGHT_RANGES.find(r => r.key === rangeKey)
      url = `/api/daily-trend?days=${preset?.days || 7}`
    }

    axios.get(url)
      .then(res => { if (!cancelled) setDailyData(res.data?.data || []) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setTrendLoading(false) })
    return () => { cancelled = true }
  }, [rangeKey, showCustom, customStart, customEnd, stats])

  if (loading || !stats) return null

  const insights = !trendLoading ? generateInsights(dailyData, stats, lowStockAlerts) : null
  const hasAny = insights ? Object.values(insights).some(arr => arr.length > 0) : false

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.25, duration: 0.4 }}
      className="space-y-4"
    >
      {/* ── Header bar ── */}
      <div className="glass-card analytics-header">
        <div className="flex flex-col gap-3">
          {/* Top row: title + range selector */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, rgba(217, 142, 59, 0.15), rgba(76, 122, 61, 0.15))' }}>
                <Lightbulb className="w-4 h-4 text-accent-amber" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-text-primary tracking-tight">Analytics Overview</h3>
                {dailyData.length > 0 && !trendLoading && (
                  <p className="text-[10px] text-text-muted mt-0.5">
                    {dailyData.length} day{dailyData.length !== 1 ? 's' : ''} analyzed
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Preset buttons */}
              <div className="flex items-center gap-0.5 p-0.5 rounded-lg analytics-range-bar">
                {INSIGHT_RANGES.map(r => (
                  <button key={r.key}
                    onClick={() => { setRangeKey(r.key); setShowCustom(false) }}
                    className={`px-2.5 py-1.5 rounded-md text-[11px] font-semibold transition-all duration-200 ${
                      !showCustom && rangeKey === r.key
                        ? 'analytics-range-active'
                        : 'text-text-muted hover:text-text-primary'
                    }`}>
                    {r.label}
                  </button>
                ))}
              </div>

              {/* Custom range toggle */}
              <button
                onClick={() => setShowCustom(!showCustom)}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-200 ${
                  showCustom ? 'analytics-range-active' : 'text-text-muted hover:text-text-primary analytics-range-bar'
                }`}>
                <Calendar className="w-3 h-3" /> Custom
              </button>
            </div>
          </div>

          {/* Custom range inputs */}
          {showCustom && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="flex items-center gap-2"
            >
              <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
                className="neu-input text-xs py-1.5 px-2.5" />
              <span className="text-[10px] text-text-muted font-medium">to</span>
              <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
                className="neu-input text-xs py-1.5 px-2.5" />
            </motion.div>
          )}
        </div>
      </div>

      {/* ── Insight cards grid ── */}
      {trendLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <InsightSkeleton key={i} />)}
        </div>
      )}

      {!trendLoading && hasAny && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {INSIGHT_CATEGORIES.map(cat => {
            const items = insights ? insights[cat.key] : []
            return <InsightCard key={cat.key} cat={cat} items={items} />
          })}
        </div>
      )}

      {/* Empty state */}
      {!trendLoading && !hasAny && (
        <EmptyState icon={Lightbulb} title="No insights yet" message="Insights appear once there's enough sales activity in the selected range." />
      )}
    </motion.div>
  )
}

/* ─── Main Dashboard ─── */
export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [statsLoading, setStatsLoading] = useState(true)
  const [lowStockAlerts, setLowStockAlerts] = useState([])
  const [lowStockLoading, setLowStockLoading] = useState(true)
  const [variant, setVariant] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [socketConnected, setSocketConnected] = useState(false)
  const [kpiModal, setKpiModal] = useState(null) // { label, value, color, icon, details }
  const user = useAuthStore(s => s.user)

  useEffect(() => {
    loadStats(); loadLowStock()
    if (typeof window !== 'undefined' && window.io) {
      const socket = window.io()
      socket.on('connect', () => setSocketConnected(true))
      socket.on('disconnect', () => setSocketConnected(false))
      socket.on('reading', () => { loadStats(); loadLowStock() })
      socket.on('counting_state', () => { loadStats(); loadLowStock() })
      return () => { socket.disconnect?.() }
    }
  }, [])

  async function loadLowStock() {
    try { setLowStockAlerts((await axios.get('/api/low-stock')).data.alerts || []) }
    catch (e) { console.error('Failed to load low stock', e) }
    finally { setLowStockLoading(false) }
  }

  async function loadStats() {
    setStatsLoading(true)
    try {
      const params = new URLSearchParams()
      if (variant) params.append('variant', variant)
      if (startDate) params.append('start_date', startDate)
      if (endDate) params.append('end_date', endDate)
      const qs = params.toString()
      setStats((await axios.get('/get_statistics' + (qs ? '?' + qs : ''))).data)
    } catch (e) { console.error('Failed to load stats', e) }
    finally { setStatsLoading(false) }
  }

  const debouncedApply = useDebounce(() => { loadStats() }, 350)
  function applyFilters() { debouncedApply() }
  function clearFilters() {
    setVariant(''); setStartDate(''); setEndDate('')
    setTimeout(() => { loadStats() }, 0)
  }

  const yday = stats?.yesterday || {}
  const global = stats?.global || {}

  const variantCounts = stats ? ['SPIN_20'].map(name => {
    const tank = Number(stats.by_variant?.find(v => v.variant === name)?.count) || 0
    const wholesale = Number(stats.by_variant_wholesale?.find(v => v.variant === name)?.count) || 0
    return tank + wholesale
  }) : [0]

  const pieData = ['SPIN_20'].map((name, i) => ({
    name, value: variantCounts[i]
  }))

  const kpiCards = stats ? [
    { key: 'total_fish', label: 'Total Fish', value: Number(stats.additions_total || 0).toLocaleString(), icon: Fish, current: global.additions_total, yesterday: yday.additions_total },
    { key: 'today_session', label: "Today's Session", value: Number(stats.today_session_total || 0).toLocaleString(), icon: ScanLine, current: global.today_session_total, yesterday: yday.today_session_total },
    { key: 'today_revenue', label: "Today's Revenue", value: formatCurrency(stats.today_revenue), icon: DollarSign, current: global.today_revenue, yesterday: yday.today_revenue, rawValue: Number(stats.today_revenue || 0) },
    { key: 'total_revenue', label: 'Total Revenue', value: formatCurrency(stats.total_revenue), icon: Activity, current: global.total_revenue, yesterday: yday.total_revenue, rawValue: Number(stats.total_revenue || 0) },
  ] : []

  function openKpiModal(card) {
    let details = null

    if (card.key === 'total_fish') {
      const total = Number(stats.additions_total || 0)
      const ydayTotal = Number(yday.additions_total || 0)
      const diff = total - ydayTotal
      details = {
        title: 'Total Fish Inventory',
        subtitle: `Total: ${total.toLocaleString()} fish (SPIN_20)`,
        rows: [
          { label: 'Total (all time)', color: '#4C7A3D', value: `${total.toLocaleString()} fish` },
          { label: 'As of yesterday', color: '#5E9B94', value: `${ydayTotal.toLocaleString()} fish` },
        ],
        extra: diff === 0
          ? 'No change from yesterday'
          : `${diff > 0 ? '+' : ''}${diff.toLocaleString()} fish added since yesterday`
      }
    } else if (card.key === 'today_session') {
      const todayCount = Number(stats.today_session_total || 0)
      const ydayCount = Number(yday.today_session_total || 0)
      const diff = todayCount - ydayCount
      details = {
        title: "Today's Session",
        subtitle: `Counted today: ${todayCount.toLocaleString()} fish`,
        rows: [
          { label: 'Today', color: '#4C7A3D', value: `${todayCount.toLocaleString()} fish` },
          { label: 'Yesterday', color: '#5E9B94', value: `${ydayCount.toLocaleString()} fish` },
        ],
        extra: diff === 0
          ? 'No change from yesterday'
          : `${diff > 0 ? '+' : ''}${diff.toLocaleString()} fish vs. yesterday`
      }
    } else if (card.key === 'today_revenue' || card.key === 'total_revenue') {
      const isToday = card.key === 'today_revenue'
      const pricePerFish = 0.40
      details = {
        title: isToday ? "Today's Revenue Breakdown" : 'Total Revenue Breakdown',
        subtitle: `Exact: ${formatCurrency(card.rawValue)}`,
        rows: [
          { label: 'Price per fish', color: '#4C7A3D', value: `₱${pricePerFish.toFixed(2)} (wholesale)` },
        ],
        extra: isToday
          ? `Yesterday: ${formatCurrency(Number(yday.today_revenue || 0))}`
          : `Yesterday cumulative: ${formatCurrency(Number(yday.total_revenue || 0))}`
      }
    }
    setKpiModal({ ...card, details })
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title={`Welcome back${user?.username ? `, ${user.username}` : ''}`}
        subtitle="Here's what's happening on the farm today."
      />

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
        {statsLoading ? (
          Array.from({ length: 4 }).map((_, i) => <KpiSkeleton key={i} />)
        ) : kpiCards.map((card, i) => (
          <motion.div key={i}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08, duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
            whileHover={{ scale: 1.015, y: -1 }}
          >
            <StatCard
              label={card.label}
              value={card.value}
              icon={card.icon}
              trend={Math.round(trendPercent(card.current, card.yesterday) * 10) / 10}
              trendLabel="vs yesterday"
              onClick={() => openKpiModal(card)}
            />
          </motion.div>
        ))}
      </div>

      {/* ── Sales & Inventory Trend ── */}
      <SalesTrend />

      {/* ── Analytics Insights ── */}
      <AnalyticsInsights stats={stats} lowStockAlerts={lowStockAlerts} loading={statsLoading} />

      {/* ── Charts Grid ── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.5 }}
        className="grid grid-cols-1 md:grid-cols-2 gap-5"
      >
        {/* Variant Pie */}
        <div className="glass-card p-4 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider">
              Overall Variant Inventory
            </h3>
            {socketConnected && <StatusIndicator status="active" label="Live" />}
          </div>
          {statsLoading ? <Skeleton width="100%" height={200} /> : (
            variantCounts.every(v => v === 0) ? (
              <EmptyState icon={Package} title="No inventory data yet" message="Counted fish will appear here once you save your first session." />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80}
                    dataKey="value" paddingAngle={4} strokeWidth={0}>
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={CHART_COLORS[i]} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
                </PieChart>
              </ResponsiveContainer>
            )
          )}
        </div>

        {/* Low Stock Alerts */}
        <div>
          <LowStockAlerts alerts={lowStockAlerts} loading={lowStockLoading} />
        </div>
      </motion.div>

      {/* ── Recent Sessions ── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 0.5 }}
        className="glass-card p-4 sm:p-6"
      >
        <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-4">Recent Sessions</h3>
        {statsLoading ? (
          <div className="space-y-2">
            <Skeleton width="100%" height={18} />
            <Skeleton width="90%" height={18} />
            <Skeleton width="95%" height={18} />
          </div>
        ) : (!stats?.recent_additions || stats.recent_additions.length === 0) ? (
          <EmptyState icon={Fish} title="No recent entries" message="Saved counting sessions will show up here." />
        ) : (
          <div className="space-y-2">
            {stats.recent_additions.map(r => {
              const note = getNoteDisplay(r.notes, r.action)
              return (
                <div key={r.id} className="flex flex-wrap items-center gap-2 sm:gap-4 p-3 rounded-xl transition-colors hover:bg-white/[0.02]">
                  <div className="w-2 h-2 rounded-full bg-accent-green flex-shrink-0" />
                  <span className="text-xs text-text-muted font-medium min-w-[90px] sm:min-w-[100px]">{r.date}</span>
                  <span className="text-sm font-semibold text-text-primary">{r.count} {r.variant}</span>
                  <span className={`text-xs truncate basis-full sm:basis-auto sm:flex-1 ${note.isFallback ? 'note-fallback text-text-muted' : 'text-text-muted'}`}>
                    — {note.text}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </motion.div>

      {/* ── KPI Detail Modal ── */}
      <Modal
        open={!!(kpiModal && kpiModal.details)}
        onClose={() => setKpiModal(null)}
        title={kpiModal?.details?.title}
        footer={
          <Button variant="secondary" size="sm" onClick={() => setKpiModal(null)}>
            Close
          </Button>
        }
      >
        {kpiModal?.details && (
          <>
            <p className="text-xs text-text-muted -mt-2 mb-4">{kpiModal.details.subtitle}</p>
            <div className="space-y-2 mb-4">
              {kpiModal.details.rows.map((row, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between p-3 rounded-xl border"
                  style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)' }}
                >
                  <span className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: row.color }} />
                    <span className="text-sm text-text-secondary font-medium">{row.label}</span>
                  </span>
                  <span className="text-sm font-bold text-text-primary">{row.value}</span>
                </div>
              ))}
            </div>
            {kpiModal.details.extra && <p className="text-xs text-text-muted px-1">{kpiModal.details.extra}</p>}
          </>
        )}
      </Modal>
    </div>
  )
}
