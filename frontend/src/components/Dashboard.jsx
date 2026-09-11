import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { io } from 'socket.io-client'
import { rawApi } from '../utils/api'
import { Fish, Lightbulb, ChevronDown, AlertTriangle } from 'lucide-react'
import SalesTrend from './SalesTrend'
import { getNoteDisplay, getRecordType, MOVEMENT as ACTIVITY } from '../utils/notes'
import { avgDailyOutflow, daysOfCover, stockStatus, coverLabel } from '../utils/stock'
import { dedupeInsights } from '../utils/insights'
import {
  isoDay, revenueWindow, periodRevenue, averageSale,
  formatPeso, formatPesoShort,
  /* aliased: the insight engine below has its own rangeLabel, which names a
     duration ("7 days") rather than a span of dates ("7–10 Sep"). */
  rangeLabel as dateSpan,
} from '../utils/revenue'
import { Button, EmptyState, Metric, Modal, PageHeader, SectionHeader, StatusIndicator, Skeleton } from './ui'

/* ─── Helpers ─── */
function MetricSkeleton() {
  return (
    <div className="strip-cell">
      <Skeleton width="60%" height={9} className="mb-1.5" />
      <Skeleton width="70%" height={18} />
    </div>
  )
}

const formatCurrency = formatPeso

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

/* Every count in an insight goes through this — raw interpolation left six-figure
   numbers unseparated next to formatted currency on the same line. */
const fmtNum = (n) => Math.round(Number(n) || 0).toLocaleString()

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

/** Describe a range length in human terms.
 *
 *  Days, not weeks, up to two months. Rounding 30 days to "4 weeks" here while
 *  the weekly grouping below counted 5 buckets put two different lengths for
 *  one range in the same panel — "4 weeks total" beside "5 weeks analyzed". */
function rangeLabel(len) {
  if (len <= 1) return 'today'
  if (len <= 60) return `${len} days`
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
      key: 'today-revenue',
      value: `${dir ? '+' : '−'}${Math.abs(revChange).toFixed(1)}%`,
      label: 'revenue vs yesterday',
      detail: `${formatCurrency(todayRev)} · previous ${formatCurrency(ydayRev)}`,
      type: dir ? 'positive' : 'negative',
    })
  } else if (todayRev > 0) {
    insights.performance.push({
      key: 'today-revenue',
      value: formatCurrency(todayRev),
      label: 'revenue today',
      detail: '',
      type: 'positive',
    })
  }

  if (peakDay && peakDay.sold_total > 0) {
    // "3.2× the average" says what "outlier spike" was gesturing at, and it
    // saves the detail line that used to restate the average as its own number
    // two bullets above the bullet that already reports it.
    const multiple = avgDaily > 0 ? peakDay.sold_total / avgDaily : 0
    insights.performance.push({
      key: 'peak',
      value: `${fmtNum(peakDay.sold_total)} units`,
      label: multiple >= 1.1
        ? `peak on ${fmtShortDate(peakDay.date)} · ${multiple.toFixed(1)}× the daily average`
        : `peak on ${fmtShortDate(peakDay.date)}`,
      detail: '',
      type: 'positive',
    })
  }

  if (avgDaily > 0) {
    insights.performance.push({
      key: 'period-total',
      value: `${fmtNum(totalSold)} sold`,
      label: `${periodName} total · ${formatCurrency(totalRevenue)}`,
      detail: `${fmtNum(avgDaily)} units/day · ${formatCurrency(avgRevenue)}/day avg`,
      type: 'neutral',
    })
  }

  // ┌─────────────────────────────────────────┐
  // │  2. TRENDS (adaptive by tier)           │
  // └─────────────────────────────────────────┘

  /* Period-over-period direction.
     This one bullet now carries the money as well as the units. It used to have
     a twin under Risks — "revenue · late-period decline" — computed from the
     same split; under a flat price per fish a revenue trend and a unit trend
     are arithmetically the same number, so the panel printed −100.0% twice, in
     two categories, as though they were two findings. */
  if (split && split.firstSold > 0) {
    const stopped = split.secondSold === 0
    insights.trends.push(stopped
      /* "−100.0%" is technically what happened and tells the reader nothing
         they can act on. Nobody writes that sentence; they write the date it
         stopped. */
      ? {
          key: 'period-trend',
          value: 'No sales',
          label: `since ${fmtShortDate(split.second[0].date)}`,
          detail: `${split.firstLabel}: ${fmtNum(split.firstSold)} sold · ${formatCurrency(split.firstRev)}`,
          type: 'negative',
        }
      : {
          key: 'period-trend',
          value: `${splitTrend >= 0 ? '+' : '−'}${Math.abs(splitTrend).toFixed(1)}%`,
          label: `sales · ${splitTrend >= 5 ? 'strong' : splitTrend <= -5 ? 'weak' : 'flat'} late-period`,
          detail: `${split.firstLabel}: ${fmtNum(split.firstSold)} · ${formatCurrency(split.firstRev)}`
            + ` → ${split.secondLabel}: ${fmtNum(split.secondSold)} · ${formatCurrency(split.secondRev)}`,
          type: splitTrend >= 5 ? 'positive' : splitTrend <= -5 ? 'negative' : 'neutral',
        })
  }

  // Momentum
  if (len >= 4 && priorWindow > 0) {
    const dir = momentumPct >= 0
    const windowLabel = windowSize === 1 ? 'day' : `${windowSize} days`
    insights.trends.push({
      key: 'momentum',
      value: `${dir ? '+' : '−'}${Math.abs(momentumPct).toFixed(1)}%`,
      label: `last ${windowLabel} · ${dir ? 'accelerating' : 'decelerating'}`,
      detail: `recent ${fmtNum(recentWindow)} vs prior ${fmtNum(priorWindow)}`,
      type: momentumPct >= 10 ? 'positive' : momentumPct <= -10 ? 'negative' : 'neutral',
    })
  }

  /* Long-range: weekly pattern for medium tier.
     Skipped when the peak day falls inside the best week, which is almost
     always — the same spike is then reported once as a day and once as the week
     containing it, and the reader is left comparing two numbers that are the
     same event. The week count in the detail is gone too: the panel header
     already says how long the range is. */
  if (tier === 'medium' && weeks.length >= 3) {
    const bestWeek = weeks.reduce((b, w) => w.sold > b.sold ? w : b, weeks[0])
    const bestWeekIdx = weeks.indexOf(bestWeek)
    const peakInBestWeek = peakIdx >= bestWeekIdx * 7 && peakIdx < (bestWeekIdx + 1) * 7
    if (!peakInBestWeek) {
      insights.trends.push({
        key: 'best-week',
        value: `${fmtNum(bestWeek.sold)} units`,
        label: `best week · ${bestWeek.label}`,
        detail: '',
        type: 'neutral',
      })
    }
  }

  // Long-range: monthly seasonality
  if (tier === 'long' && months.length >= 2) {
    const bestMonth = months.reduce((b, m) => m.sold > b.sold ? m : b, months[0])
    const worstMonth = months.reduce((w, m) => m.sold < w.sold ? m : w, months[0])
    if (bestMonth.label !== worstMonth.label) {
      insights.trends.push({
        key: 'seasonality',
        value: `${fmtNum(bestMonth.sold)} units`,
        label: `peak in ${bestMonth.label} · low ${worstMonth.label}`,
        detail: `${worstMonth.label}: ${fmtNum(worstMonth.sold)} · ${months.length} months compared`,
        type: 'neutral',
      })
    }
  }

  /* Recovery detection. `sales[biggestDrop.idx] > 0` is the new condition: a
     rebound measured from a day that sold nothing is a percentage against zero,
     which produced things like "+196% rebound" for what was simply sales
     starting again — and the day it stopped is already reported as a risk. */
  if (biggestDrop.pct < -20 && sales[biggestDrop.idx] > 0
      && biggestGain.pct > 15 && biggestGain.pct <= 500 && biggestGain.idx > biggestDrop.idx) {
    insights.trends.push({
      key: `day:${days[biggestDrop.idx].date}`,
      value: `+${biggestGain.pct.toFixed(0)}%`,
      label: `rebound after ${fmtShortDate(days[biggestDrop.idx].date)} dip`,
      detail: `dropped ${Math.abs(biggestDrop.pct).toFixed(0)}%, recovered in ${biggestGain.idx - biggestDrop.idx}d`,
      type: 'positive',
    })
  }

  /* Volatility — only when meaningful, skip extreme noise.
     Reported as units, not as a coefficient of variation. "129% CV" is a
     statistic about a statistic: it is precise, it is correct, and nobody
     running a fish farm can act on it. The standard deviation in fish is the
     same finding in a unit the reader already has on the rest of the page. */
  const swing = Math.round(vol * (len > 0 ? totalSold / len : 0))
  if (isVolatile && vol <= 2) {
    insights.trends.push({
      key: 'volatility',
      value: `±${fmtNum(swing)}`,
      label: `typical day-to-day swing · demand is not steady`,
      detail: `against an average of ${fmtNum(avgDaily)} units/day over ${periodName}`,
      type: 'negative',
    })
  } else if (isStable && len >= 5) {
    insights.trends.push({
      key: 'volatility',
      value: `±${fmtNum(swing)}`,
      label: 'typical day-to-day swing · steady demand',
      detail: `against an average of ${fmtNum(avgDaily)} units/day over ${periodName}`,
      type: 'positive',
    })
  }


  // ┌─────────────────────────────────────────┐
  // │  3. RISKS (max 3)                       │
  // └─────────────────────────────────────────┘
  // Zero revenue today — this is a risk, not performance
  if (todayRev === 0 && ydayRev > 0) {
    insights.risks.push({
      key: 'today-revenue',
      value: '₱0',
      label: 'revenue today · −100% vs yesterday',
      detail: `previous ${formatCurrency(ydayRev)}`,
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
      key: `day:${dropDay.date}`,
      value: '0 sales',
      label: `on ${fmtShortDate(dropDay.date)} · ${Math.abs(biggestDrop.pct).toFixed(0)}% drop from prior day`,
      detail: `previous day ${fmtNum(sales[biggestDrop.idx - 1])} units`,
      type: 'negative',
    })
  } else {
    if (biggestDrop.pct < -25) {
      insights.risks.push({
        key: `day:${days[biggestDrop.idx].date}`,
        value: `−${Math.abs(biggestDrop.pct).toFixed(0)}%`,
        label: `drop on ${fmtShortDate(days[biggestDrop.idx].date)} · ${fmtNum(sales[biggestDrop.idx])} units`,
        detail: `previous day ${fmtNum(sales[biggestDrop.idx - 1])} units`,
        type: 'negative',
      })
    }
    if (lowDay && lowDay.sold_total === 0 && len > 1 && !zeroIsDropDay) {
      insights.risks.push({
        key: `day:${lowDay.date}`,
        value: '0 sales',
        label: `on ${fmtShortDate(lowDay.date)} · verify downtime or gap`,
        detail: '',
        type: 'negative',
      })
    } else if (lowDay && lowDay.sold_total > 0 && avgDaily > 0 && lowDay.sold_total < avgDaily * 0.35) {
      insights.risks.push({
        key: `day:${lowDay.date}`,
        value: `${fmtNum(lowDay.sold_total)} units`,
        label: `on ${fmtShortDate(lowDay.date)} · ${Math.round((lowDay.sold_total / avgDaily) * 100)}% of avg`,
        detail: `avg ${fmtNum(avgDaily)} units/day`,
        type: 'negative',
      })
    }
  }

  const activeAlerts = (lowStockAlerts || []).filter(a => a.status !== 'ok')
  const criticals = activeAlerts.filter(a => a.status === 'critical')
  if (criticals.length > 0) {
    insights.risks.push({
      key: 'stock',
      value: 'Critical',
      label: `${criticals.map(a => `${a.variant} (${fmtNum(a.stock)})`).join(', ')} · restock now`,
      detail: 'below safety threshold',
      type: 'negative',
    })
  } else if (activeAlerts.length > 0) {
    insights.risks.push({
      key: 'stock',
      value: `${activeAlerts.length} warning${activeAlerts.length > 1 ? 's' : ''}`,
      label: activeAlerts.map(a => a.variant).join(', '),
      detail: 'approaching low levels',
      type: 'negative',
    })
  }


  // ┌─────────────────────────────────────────┐
  // │  4. OPPORTUNITIES (max 3)               │
  // └─────────────────────────────────────────┘
  // Only meaningful with more than one variant — "leads at 100%" says nothing.
  // by_variant counts are stock on hand, not units sold.
  if (topVariant && topVariant[1] > 0 && sortedVariants.length > 1) {
    const allTotal = sortedVariants.reduce((s, v) => s + v[1], 0)
    const share = allTotal > 0 ? Math.round((topVariant[1] / allTotal) * 100) : 0
    insights.opportunities.push({
      key: 'variant-share',
      value: `${share}%`,
      label: `${topVariant[0]} share · ${fmtNum(topVariant[1])} in stock`,
      detail: 'prioritize availability for top variant',
      type: 'positive',
    })
  }

  if (bottomVariant && sortedVariants.length > 1 && topVariant && topVariant[1] > 0) {
    const gap = topVariant[1] - bottomVariant[1]
    if (gap > 0 && bottomVariant[1] > 0) {
      insights.opportunities.push({
        key: 'variant-gap',
        value: `${fmtNum(gap)} units`,
        label: `${bottomVariant[0]} trails · growth room`,
        detail: 'consider pricing or bundling to close gap',
        type: 'neutral',
      })
    }
  }

  // Upward momentum opportunity — same split as the sales trend above, so it
  // carries that reading's key and drops out when the trend already said it.
  if (split && splitTrend > 15) {
    insights.opportunities.push({
      key: 'period-trend',
      value: `+${splitTrend.toFixed(0)}%`,
      label: 'growth trend · scale supply to match',
      detail: 'demand accelerating in later half',
      type: 'positive',
    })
  }

  // One event, one bullet — see utils/insights.js.
  return dedupeInsights(insights)
}

/* ─── Category config ───
   Names only. Each category used to carry a colour and an icon, which meant
   four hues and four glyphs decorating four headings whose own words already
   said "Performance", "Trends", "Risks". Colour is left to the readings, where
   it means a direction; the categories are labels, and labels are grey. */
const INSIGHT_CATEGORIES = [
  { key: 'performance',   label: 'Performance' },
  { key: 'trends',        label: 'Trends' },
  { key: 'risks',         label: 'Risks' },
  { key: 'opportunities', label: 'Opportunities' },
]

const TYPE_COLORS = {
  positive: 'text-positive',
  negative: 'text-negative',
  neutral: 'text-text-primary',
}

const MOBILE_VISIBLE = 2  // rows past this collapse on phones; all show from 640px up

/* One category of readings. Not a card: it is a heading, a rule, and a list.
   The three boxes this replaces each had a border, a background, a coloured
   left edge, a coloured icon, a coloured heading and a coloured dot per row —
   six pieces of chrome around what is, in the end, six lines of text. */
function InsightGroup({ cat, items }) {
  const [expanded, setExpanded] = useState(false)
  if (!items || items.length === 0) return null

  const overflow = items.length - MOBILE_VISIBLE

  return (
    <section className="insight-group" aria-label={cat.label}>
      <h4 className="insight-group-label">{cat.label}</h4>
      <dl className="m-0">
        {items.map((insight, i) => (
          <div
            key={i}
            className={`insight-row${i >= MOBILE_VISIBLE && !expanded ? ' is-overflow' : ''}`}
          >
            {/* Value and label are separate elements so a wrap breaks between
                them rather than mid-phrase, and only the figure takes colour. */}
            <dt className="inline text-xs leading-snug">
              {insight.value && (
                <span className={`font-semibold ${TYPE_COLORS[insight.type]}`}>{insight.value}</span>
              )}
            </dt>
            <dd className="inline m-0 text-xs leading-snug text-text-secondary">
              {insight.value && insight.label && ' '}
              {insight.label}
            </dd>
            {/* Always visible: hover-reveal reserved the same height anyway and
                was unreachable on touch, where :hover and title= never fire. */}
            {insight.detail && <p className="meta m-0">{insight.detail}</p>}
          </div>
        ))}
      </dl>

      {overflow > 0 && (
        <button onClick={() => setExpanded(v => !v)} className="insight-more-btn"
          aria-expanded={expanded}>
          {expanded ? 'Show less' : `+${overflow} more`}
        </button>
      )}
    </section>
  )
}

function InsightSkeleton() {
  return (
    <div className="insight-group">
      <div className="insight-group-label"><Skeleton width="45%" height={9} /></div>
      <div className="space-y-2">
        {[1, 2].map(i => (
          <div key={i} className="space-y-1">
            <Skeleton width="90%" height={11} />
            <Skeleton width="60%" height={9} />
          </div>
        ))}
      </div>
    </div>
  )
}

/* The panel's contents, without the container that opens it. */
function AnalyticsBody({ insights, hasAny, trendLoading }) {
  /* A grid, not CSS multi-columns. `columns-*` flows the four groups
     top-to-bottom and then wraps, so which category landed in which column
     depended on how many bullets each happened to generate that day — the panel
     reordered itself as the farm's data changed. auto-fit keeps Performance,
     Trends, Risks and Opportunities in that order and closes the gap when a
     category has nothing to report. */
  const cls = 'grid gap-x-6 gap-y-3 items-start grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))]'
  if (trendLoading) {
    return (
      <div className="glass-card card-pad">
        <div className={cls}>{[1, 2, 3, 4].map(i => <InsightSkeleton key={i} />)}</div>
      </div>
    )
  }
  if (!hasAny) {
    return (
      <div className="glass-card card-pad">
        <EmptyState compact icon={Lightbulb} title="No insights yet"
          message="Insights appear once there's enough sales activity in the selected range." />
      </div>
    )
  }
  /* One panel holding four groups, rather than four panels sitting in a row.
     The groups are separated by the gap and by their own heading rules, which
     is all the separation a set of related readings needs. */
  return (
    <div className="glass-card card-pad">
      <div className={cls}>
        {INSIGHT_CATEGORIES.map(cat => (
          <InsightGroup key={cat.key} cat={cat} items={insights ? insights[cat.key] : []} />
        ))}
      </div>
    </div>
  )
}

/* Range and daily-trend data come from Dashboard, shared with SalesTrend above.
   A collapsible panel on the page, not a dialog: this is the dashboard's own
   reading, and it belongs in the flow of the page with everything else. It sits
   directly under the KPI row so it is reachable on the 7" panel without
   scrolling; opening it does push the chart down, which is the honest trade on
   a screen that cannot show both at once. */
function AnalyticsInsights({ stats, lowStockAlerts, loading, dailyData, trendLoading }) {
  if (loading || !stats) return null

  const insights = !trendLoading ? generateInsights(dailyData, stats, lowStockAlerts) : null
  const hasAny = insights ? Object.values(insights).some(arr => arr.length > 0) : false

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
    >
      <details className="group">
        <summary className="cursor-pointer list-none flex items-baseline gap-1.5 py-0.5
          rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-green">
          <ChevronDown size={13} className="self-center text-text-muted shrink-0
            transition-transform duration-150 group-open:rotate-180" aria-hidden="true" />
          <span className="section-title">Analytics Overview</span>
          {dailyData.length > 0 && !trendLoading && (
            <span className="meta">
              {fmtShortDate(dailyData[0].date)} – {fmtShortDate(dailyData[dailyData.length - 1].date)}
              {' · '}{dailyData.length} day{dailyData.length !== 1 ? 's' : ''}
            </span>
          )}
        </summary>

        <div className="mt-2">
          <AnalyticsBody insights={insights} hasAny={hasAny} trendLoading={trendLoading} />
        </div>
      </details>
    </motion.div>
  )
}

/* ─── Main Dashboard ─── */
export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [statsLoading, setStatsLoading] = useState(true)
  const [lowStockAlerts, setLowStockAlerts] = useState([])
  const [socketConnected, setSocketConnected] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [sessions, setSessions] = useState([])
  const [kpiModal, setKpiModal] = useState(null) // { label, value, color, icon, details }
  // One range + one daily-trend fetch, shared by SalesTrend and AnalyticsInsights
  const [range, setRange] = useState({ days: 7, start: '', end: '', custom: false })
  const [dailyData, setDailyData] = useState([])
  const [trendLoading, setTrendLoading] = useState(true)
  /* Revenue Overview reads its own fixed window (this week / this month), which
     must not move when the operator changes the chart's range — "This Month"
     that silently becomes "last 90 days" is worse than no card at all. */
  const [revRows, setRevRows] = useState(null)
  const [pricePerFish, setPricePerFish] = useState(null)

  useEffect(() => {
    let cancelled = false
    setTrendLoading(true)
    const qs = range.custom && range.start && range.end
      ? `start_date=${range.start}&end_date=${range.end}`
      : `days=${range.days}`
    rawApi.get(`/api/daily-trend?${qs}`)
      .then(res => { if (!cancelled) setDailyData(res.data?.data || []) })
      .catch(() => { if (!cancelled) setLoadError('Could not load the sales trend.') })
      .finally(() => { if (!cancelled) setTrendLoading(false) })
    return () => { cancelled = true }
  }, [range, stats]) // stats changes on each new reading, so the trend refreshes with it

  /* One fetch covers today, this week and this month — the window reaches back
     to whichever of the two periods started earlier. Re-runs with `stats` so a
     sale recorded while the dashboard is open lands in the cards. */
  useEffect(() => {
    let cancelled = false
    const w = revenueWindow()
    rawApi.get(`/api/daily-trend?start_date=${w.start}&end_date=${w.end}`)
      .then(res => {
        if (cancelled) return
        setRevRows(res.data?.data || [])
        const p = Number(res.data?.prices?.wholesale)
        if (Number.isFinite(p)) setPricePerFish(p)
      })
      .catch(() => { if (!cancelled) setRevRows([]) })
    return () => { cancelled = true }
  }, [stats])

  useEffect(() => {
    reload()
    const socket = io()
    socket.on('connect', () => setSocketConnected(true))
    socket.on('disconnect', () => setSocketConnected(false))
    socket.on('reading', () => reload())
    socket.on('counting_state', () => reload())
    return () => { socket.disconnect() }
  }, [])

  function reload() { loadStats(); loadLowStock(); loadSessions() }

  async function loadLowStock() {
    try { setLowStockAlerts((await rawApi.get('/api/low-stock')).data.alerts || []) }
    catch { setLoadError('Could not load stock levels.') }
  }

  async function loadSessions() {
    try { setSessions((await rawApi.get('/api/sessions?limit=15')).data.sessions || []) }
    catch { /* sessions are supplementary; the activity list falls back to movements */ }
  }

  async function loadStats() {
    setStatsLoading(true)
    try {
      setStats((await rawApi.get('/get_statistics')).data)
      setLoadError('')
    } catch {
      setLoadError('Could not load dashboard data.')
    } finally { setStatsLoading(false) }
  }

  const yday = stats?.yesterday || {}
  const global = stats?.global || {}

  /* Stock actually on hand right now: wholesale in minus wholesale out, unfiltered.
     `additions_total` is lifetime gross additions and never decreases — it is not stock. */
  const stockOnHand = Number(global.wholesale_total || 0)
  const outflowRate = avgDailyOutflow(dailyData, 7)
  const cover = daysOfCover(stockOnHand, outflowRate)
  const stockTone = stockStatus(stockOnHand, cover)

  /* One activity stream. Counting runs come from counting_sessions, which know
     who ran them and for how long; sales and losses come from inventory. A run
     that reached inventory is dropped from the movement side so it appears once,
     while movements predating session tracking still show. */
  const sessionInventoryIds = new Set(
    sessions.map(s => s.inventory_id).filter(id => id != null)
  )

  function sessionDuration(s) {
    if (!s.started_at || !s.ended_at) return null
    const ms = new Date(s.ended_at.replace(' ', 'T')) - new Date(s.started_at.replace(' ', 'T'))
    if (!(ms > 0)) return null
    const mins = Math.floor(ms / 60000)
    const secs = Math.floor((ms % 60000) / 1000)
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
  }

  const SESSION_STATUS_NOTE = {
    saved: 'saved to inventory',
    completed: 'counted, not yet saved',
    aborted: 'stopped with no count',
    active: 'in progress',
  }

  const activityFeed = [
    ...sessions.map(s => {
      const dur = sessionDuration(s)
      return {
        key: `s${s.id}`,
        at: s.ended_at || s.started_at || '',
        date: (s.ended_at || s.started_at || '').slice(0, 16),
        // An aborted run counted nothing; "Stopped 0 SPIN_20" reads as a quantity
        // when the point is that there wasn't one.
        count: s.status === 'aborted' ? null : Number(s.final_count || 0),
        variant: s.status === 'aborted' ? '' : (s.variant || ''),
        kind: s.status === 'aborted' ? ACTIVITY.ABORTED : ACTIVITY.WHOLESALE_IN,
        note: [s.username, dur, SESSION_STATUS_NOTE[s.status]].filter(Boolean).join(' · '),
        noteFallback: false,
      }
    }),
    ...(stats?.recent_additions || [])
      .filter(r => !sessionInventoryIds.has(r.id))
      .map(r => {
        const note = getNoteDisplay(r.notes, r.action)
        return {
          key: `i${r.id}`,
          at: r.date || '',
          date: r.date,
          count: Math.abs(Number(r.count) || 0),
          variant: r.variant,
          kind: ACTIVITY[getRecordType(r)] || ACTIVITY.UNKNOWN,
          note: note.text,
          noteFallback: note.isFallback,
        }
      }),
  /* Beside a full-height Sales Trend card this column has room for a dozen rows;
     six left it half empty. The list scrolls, so the extra rows cost no height. */
  ].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 15)

  /* Day headings, so the feed reads as a log rather than as fifteen rows that
     all open with the same "2026-09-" prefix. The stored timestamp is
     "YYYY-MM-DD HH:MM", so the split is positional and needs no parsing. */
  const todayIso = isoDay(new Date())
  const yesterdayIso = isoDay(new Date(Date.now() - 86400000))
  function dayHeading(iso) {
    if (!iso) return 'Undated'
    if (iso === todayIso) return 'Today'
    if (iso === yesterdayIso) return 'Yesterday'
    return new Date(iso + 'T00:00:00')
      .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  }

  const activityDays = []
  activityFeed.forEach(item => {
    const iso = String(item.date || '').slice(0, 10)
    const last = activityDays[activityDays.length - 1]
    if (!last || last.iso !== iso) activityDays.push({ iso, heading: dayHeading(iso), items: [item] })
    else last.items.push(item)
  })

  // Today's outflow in units — the trend series' last row is always today.
  const soldToday = dailyData.length > 0 ? Number(dailyData[dailyData.length - 1].sold_total || 0) : 0
  const countedToday = Number(stats?.today_session_total || 0)

  /* ── The stock band ──
     One panel, four readings, and only the first of them is set large. These
     were four equally-weighted cards, three of which routinely read "0" or (in
     the case of the lifetime total) a seven-figure number that is explicitly
     not current stock — so the loudest thing on the dashboard was whichever
     number happened to be longest. Stock on hand is the question the farm
     actually opens this screen to answer. */
  const stockCells = stats ? [
    {
      key: 'stock_on_hand', label: 'Stock on Hand', value: stockOnHand.toLocaleString(),
      size: 'hero', tone: stockTone, sub: coverLabel(cover),
    },
    {
      key: 'today_session', label: 'Counted in today', value: countedToday.toLocaleString(),
      sub: countedToday === 0 ? 'no session yet' : 'added to inventory',
    },
    {
      key: 'sold_today', label: 'Sold today', value: soldToday.toLocaleString(),
      sub: formatCurrency(stats.today_revenue), rawValue: Number(stats.today_revenue || 0),
    },
    {
      key: 'total_fish', label: 'Stocked all time', value: Number(stats.additions_total || 0).toLocaleString(),
      sub: 'gross, never decreases',
    },
  ] : []

  /* ── Revenue Overview ──
     Five figures from two existing endpoints. Today leads; the rest are
     supporting context and are set one step down. Nothing here is computed
     from anything the farm has not actually recorded — a period with no sales
     shows ₱0.00, and an average with no sales at all shows a dash. */
  const rev = periodRevenue(revRows || [], new Date())
  const salesCount = Number(global.sales_count || 0)
  const avgSale = averageSale(global.total_revenue, salesCount)
  const revLoading = revRows === null || statsLoading

  const revenueCells = [
    {
      key: 'today', label: "Today's revenue", size: 'md',
      value: formatPeso(stats?.today_revenue), sub: dateSpan(todayIso, todayIso),
    },
    {
      key: 'week', label: 'This week',
      value: formatPesoShort(rev.week), sub: dateSpan(rev.weekStart, todayIso),
    },
    {
      key: 'month', label: 'This month',
      value: formatPesoShort(rev.month), sub: dateSpan(rev.monthStart, todayIso),
    },
    {
      key: 'total', label: 'Total sales',
      value: formatPesoShort(global.total_revenue),
      sub: salesCount > 0 ? `${salesCount.toLocaleString()} recorded sales` : 'no sales recorded',
    },
    {
      key: 'avg', label: 'Average sale',
      value: avgSale === null ? '—' : formatPesoShort(avgSale),
      sub: avgSale === null
        ? 'needs a recorded sale'
        : pricePerFish ? `at ₱${pricePerFish.toFixed(2)}/fish` : 'per recorded sale',
    },
  ]

  const activeAlerts = (lowStockAlerts || []).filter(a => a.status && a.status !== 'ok')

  /* Mirrors SalesTrend's own isEmpty. The layout has to know before it lays out
     — a card that is about to render two lines of text must not be handed a
     third of the page first. */
  const trendEmpty = !trendLoading && (
    dailyData.length === 0 ||
    dailyData.every(d => !Number(d.sold_total) && !Number(d.revenue))
  )

  function openKpiModal(card) {
    let details = null

    if (card.key === 'stock_on_hand') {
      const ydayStock = Number(yday.wholesale_total || 0)
      const diff = stockOnHand - ydayStock
      details = {
        title: 'Stock on Hand',
        subtitle: `${stockOnHand.toLocaleString()} SPIN_20 available for sale right now`,
        rows: [
          { label: 'Available now', color: 'var(--positive)', value: `${stockOnHand.toLocaleString()} fish` },
          { label: 'As of yesterday', color: 'var(--info)', value: `${ydayStock.toLocaleString()} fish` },
          { label: 'Selling at', color: 'var(--attention)', value: `${Math.round(outflowRate).toLocaleString()} fish/day (7-day avg)` },
          { label: 'Cover remaining', color: 'var(--negative)', value: coverLabel(cover) },
        ],
        extra: diff === 0
          ? 'No change from yesterday'
          : `${diff > 0 ? '+' : ''}${diff.toLocaleString()} fish since yesterday`
      }
    } else if (card.key === 'total_fish') {
      const total = Number(stats.additions_total || 0)
      const ydayTotal = Number(yday.additions_total || 0)
      const diff = total - ydayTotal
      details = {
        title: 'Stocked All Time',
        subtitle: `${total.toLocaleString()} fish added since records began`,
        rows: [
          { label: 'Gross additions (all time)', color: 'var(--positive)', value: `${total.toLocaleString()} fish` },
          { label: 'As of yesterday', color: 'var(--info)', value: `${ydayTotal.toLocaleString()} fish` },
          { label: 'Still on hand', color: 'var(--attention)', value: `${stockOnHand.toLocaleString()} fish` },
        ],
        extra: 'This is a lifetime running total of fish added — it never decreases and is not current stock.'
          + (diff === 0 ? '' : ` ${diff > 0 ? '+' : ''}${diff.toLocaleString()} added since yesterday.`)
      }
    } else if (card.key === 'today_session') {
      const todayCount = Number(stats.today_session_total || 0)
      const ydayCount = Number(yday.today_session_total || 0)
      const diff = todayCount - ydayCount
      details = {
        title: 'Counted Today',
        subtitle: `Counted today: ${todayCount.toLocaleString()} fish`,
        rows: [
          { label: 'Today', color: 'var(--positive)', value: `${todayCount.toLocaleString()} fish` },
          { label: 'Yesterday', color: 'var(--info)', value: `${ydayCount.toLocaleString()} fish` },
        ],
        extra: diff === 0
          ? 'No change from yesterday'
          : `${diff > 0 ? '+' : ''}${diff.toLocaleString()} fish vs. yesterday`
      }
    } else if (card.key === 'sold_today') {
      details = {
        title: 'Sold Today',
        subtitle: `${soldToday.toLocaleString()} fish · ${formatCurrency(card.rawValue)}`,
        rows: [
          { label: 'Units sold today', color: 'var(--positive)', value: `${soldToday.toLocaleString()} fish` },
          ...(pricePerFish ? [{ label: 'Price per fish', color: 'var(--info)', value: `₱${pricePerFish.toFixed(2)} (wholesale)` }] : []),
          { label: 'Revenue today', color: 'var(--attention)', value: formatCurrency(card.rawValue) },
        ],
        extra: `Yesterday: ${formatCurrency(Number(yday.today_revenue || 0))}`
      }
    }
    setKpiModal({ ...card, details })
  }

  return (
    /* The gap between sections comes from the scale, so the panel's rhythm is
       decided once in styles.css instead of at every block on this page. */
    <div className="flex flex-col gap-section grow">
      {/* ── Identity line ──
             Which screen, which stock item, whether the reading is live. The
             greeting that used to sit here reported nothing about the farm. ── */}
      <PageHeader
        title="Farm Overview"
        meta={new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
        actions={
          <StatusIndicator
            status={socketConnected ? 'active' : 'idle'}
            label={socketConnected ? 'Live' : 'Reconnecting'}
          />
        }
      />

      {loadError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-negative/25
          bg-negative/10 px-3 py-2 text-xs font-medium text-negative">
          {loadError}
          <button onClick={reload} className="underline underline-offset-2 hover:no-underline">
            Retry
          </button>
        </div>
      )}

      {/* ── Needs attention ──
             Low-stock alerts used to exist only as a bullet inside the
             *collapsed* Analytics Overview, which is the one place an
             operational warning must never live. It surfaces here, above
             everything but the stock itself, and renders nothing at all when
             the farm is fine — so it costs no page on a good day. ── */}
      {activeAlerts.length > 0 && (
        <div role="status" className={`flex items-start gap-2 rounded-lg border px-3 py-2
          ${activeAlerts.some(a => a.status === 'critical')
            ? 'border-negative/30 bg-negative/10 text-negative'
            : 'border-attention/30 bg-attention/10 text-attention'}`}>
          <AlertTriangle size={14} className="shrink-0 mt-px" aria-hidden="true" />
          <p className="text-xs font-medium leading-snug">
            {activeAlerts.map(a =>
              `${a.variant} at ${Number(a.stock || 0).toLocaleString()}`).join(' · ')}
            <span className="font-normal opacity-80">
              {' — '}{activeAlerts.some(a => a.status === 'critical') ? 'restock now' : 'approaching low levels'}
            </span>
          </p>
        </div>
      )}

      {/* ── Stock band ──
             One panel with four readings in it, not four cards. Stock on hand
             takes the wide cell and the hero figure; what moved today and the
             lifetime total are supporting context beside it, at a third the
             size. Each cell still opens its own detail dialog on tap, exactly
             as the cards did. ── */}
      <section aria-label="Stock">
        <div className="strip grid-cols-2 md:[grid-template-columns:1.6fr_1fr_1fr_1fr]">
          {statsLoading
            ? Array.from({ length: 4 }).map((_, i) => <MetricSkeleton key={i} />)
            : stockCells.map(cell => (
              <Metric
                key={cell.key}
                label={cell.label}
                value={cell.value}
                sub={cell.sub}
                tone={cell.tone}
                size={cell.size || 'sm'}
                /* Two columns below md: the hero takes a full row, then the two
                   "today" figures pair off, then the lifetime total takes the
                   last row on its own — spanning it too, so the strip doesn't
                   end with an empty half-cell. */
                className={cell.size === 'hero' || cell.key === 'total_fish'
                  ? 'col-span-2 md:col-span-1' : undefined}
                onClick={() => openKpiModal(cell)}
              />
            ))}
        </div>
      </section>

      {/* ── Revenue Overview ──
             Five figures in one strip. Today leads at the middle figure size;
             the four behind it are context and stay quiet. On the 7" panel the
             per-card date ranges drop out (`strip-compact`) — the label above
             each figure already names the period, so the range beneath it is a
             restatement costing ~30px of a 390px screen. ── */}
      <section aria-labelledby="revenue-heading">
        <SectionHeader
          id="revenue-heading"
          title="Revenue"
          meta={pricePerFish ? `wholesale · ₱${pricePerFish.toFixed(2)} per fish` : 'wholesale'}
          className="mb-1.5 [@media(max-height:620px)]:hidden"
        />
        <div className="strip strip-compact grid-cols-2 sm:grid-cols-3 md:grid-cols-5">
          {revLoading
            ? Array.from({ length: 5 }).map((_, i) => <MetricSkeleton key={i} />)
            : revenueCells.map(cell => (
              <Metric
                key={cell.key}
                label={cell.label}
                value={cell.value}
                sub={cell.sub}
                size={cell.size || 'sm'}
                className={cell.key === 'today' ? 'col-span-2 sm:col-span-1' : undefined}
              />
            ))}
        </div>
      </section>

      {/* ── Analytics Insights — collapsed, in the flow of the page ── */}
      <AnalyticsInsights stats={stats} lowStockAlerts={lowStockAlerts} loading={statsLoading}
        dailyData={dailyData} trendLoading={trendLoading} />

      {/* ── Chart beside recent activity: uses the page width instead of stacking,
             which is what kept the dashboard two viewports tall.
             The columns stretch rather than sitting at their natural heights —
             opening Daily Breakdown doubles the left card, and with items-start
             that left a card-sized hole of empty page beside it. ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-grid flex-1">
        {/* With no sales in the range the trend card is two lines of text, so it
            stops stretching and the row's height comes from the activity feed
            instead — which is the content that still has something to say. */}
        <div className={`xl:col-span-2 min-w-0 flex ${trendEmpty ? 'self-start' : ''}`}>
        {/* ── Sales & Inventory Trend (owns the shared range filter) ── */}
        <SalesTrend data={dailyData} loading={trendLoading} range={range} setRange={setRange} />
        </div>
        {/* With a chart beside it the activity card is taken out of flow and
            pinned to the row: the row height then comes from the Sales Trend
            card alone, and the feed fills it exactly however tall that card
            gets. Left in flow the two cards fight — whichever is taller sets the
            row and the other column ends in a card-sized hole of empty page. */}
        <div className={`min-w-0 flex ${trendEmpty ? 'self-start' : 'md:block md:relative'}`}>
        {/* ── Recent Activity ── */}
        <section aria-labelledby="activity-heading"
          className={`glass-card card-pad w-full flex flex-col ${trendEmpty ? '' : 'md:absolute md:inset-0'}`}>
          <SectionHeader id="activity-heading" title="Recent activity"
            meta={activityFeed.length > 0 ? `${activityFeed.length} entries` : undefined}
            className="mb-1.5 shrink-0" />
          {statsLoading ? (
            <div className="space-y-2">
              <Skeleton width="100%" height={16} />
              <Skeleton width="90%" height={16} />
              <Skeleton width="95%" height={16} />
            </div>
          ) : activityFeed.length === 0 ? (
            <EmptyState compact icon={Fish} title="No recent entries"
              message="Counting sessions and sales appear here as they happen." />
          ) : (
            /* Stacked (below md) the list keeps its own cap so it can't run the
               page long. Side by side it instead fills whatever height the
               column has — the card is stretched to the Sales Trend card beside
               it, and a fixed cap there just moved the empty space inside the
               card. It scrolls if the feed outgrows the room. */
            <div className={`activity-scroll overflow-y-auto -mr-1 pr-1
              ${trendEmpty ? '' : 'md:max-h-none md:flex-1 md:min-h-0'}`}>
              {activityDays.map(day => (
                <React.Fragment key={day.iso || day.heading}>
                  <h4 className="activity-day">{day.heading}</h4>
                  <ul className="list-none m-0 p-0">
                    {day.items.map(item => (
                      <li key={item.key} className="activity-row">
                        {/* The clock time is the spine of the list; the date is
                            already said once, by the heading above it. */}
                        <time className="activity-time"
                          dateTime={String(item.date || '').replace(' ', 'T')}>
                          {String(item.date || '').slice(11, 16) || '—'}
                        </time>
                        {/* Magnitude, not the stored sign — "-65560" is a database detail. */}
                        <span className="text-xs leading-snug min-w-0">
                          <span className={`font-semibold ${item.kind.text}`}>{item.kind.label}</span>
                          {item.count != null && (
                            <>
                              {' '}
                              <span className="font-semibold text-text-primary tabular-nums">
                                {item.count.toLocaleString()}
                              </span>
                              {item.variant && <span className="text-text-secondary"> {item.variant}</span>}
                            </>
                          )}
                        </span>
                        {item.note && (
                          <span className={`meta col-start-2 truncate ${item.noteFallback ? 'note-fallback' : ''}`}>
                            {item.note}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </React.Fragment>
              ))}
            </div>
          )}
        </section>
        </div>
      </div>

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
            <p className="text-xs text-text-secondary -mt-1 mb-3">{kpiModal.details.subtitle}</p>
            {/* A definition list, not four bordered boxes. These are label/value
                pairs about one figure, so hairlines between them say what a
                border around each one was trying to. */}
            <dl className="m-0">
              {kpiModal.details.rows.map((row, i) => (
                <div key={i}
                  className="flex items-baseline justify-between gap-4 py-2 border-t border-rule first:border-t-0">
                  <dt className="flex items-baseline gap-2 min-w-0">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0 translate-y-[-1px]"
                      style={{ background: row.color }} />
                    <span className="text-xs text-text-secondary">{row.label}</span>
                  </dt>
                  <dd className="m-0 text-xs font-semibold text-text-primary tabular-nums text-right">
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
            {kpiModal.details.extra && (
              <p className="meta mt-3 leading-relaxed">{kpiModal.details.extra}</p>
            )}
          </>
        )}
      </Modal>
    </div>
  )
}
