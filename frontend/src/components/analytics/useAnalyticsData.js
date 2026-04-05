import { useState, useEffect, useMemo } from 'react'
import axios from 'axios'

/* ── Constants ── */
const PRESET_DAYS = { '7d': 7, '30d': 30, 'month': 90, 'year': 365 }

/* ── Utilities ── */
function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function fmtShort(ds) {
  return new Date(ds + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fmtMonth(ds) {
  return new Date(ds + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

export function fmtCurrency(v) {
  return '₱' + Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function getGranularity(days) {
  if (days <= 31) return 'daily'
  if (days <= 120) return 'weekly'
  return 'monthly'
}

/* ── Grouping ── */
function groupWeekly(data) {
  const result = []
  for (let i = 0; i < data.length; i += 7) {
    const chunk = data.slice(i, i + 7)
    result.push({
      date: chunk[0].date,
      label: `${fmtShort(chunk[0].date)} – ${fmtShort(chunk[chunk.length - 1].date)}`,
      sold_total: chunk.reduce((s, d) => s + d.sold_total, 0),
      sold_tank: chunk.reduce((s, d) => s + d.sold_tank, 0),
      sold_wholesale: chunk.reduce((s, d) => s + d.sold_wholesale, 0),
      revenue: chunk.reduce((s, d) => s + d.revenue, 0),
    })
  }
  return result
}

function groupMonthly(data) {
  const map = {}
  data.forEach(d => {
    const key = d.date.slice(0, 7)
    if (!map[key]) {
      map[key] = { date: d.date, label: fmtMonth(d.date), sold_total: 0, sold_tank: 0, sold_wholesale: 0, revenue: 0 }
    }
    map[key].sold_total += d.sold_total
    map[key].sold_tank += d.sold_tank
    map[key].sold_wholesale += d.sold_wholesale
    map[key].revenue += d.revenue
  })
  return Object.values(map)
}

function groupData(data, granularity) {
  if (!data.length) return []
  if (granularity === 'weekly') return groupWeekly(data)
  if (granularity === 'monthly') return groupMonthly(data)
  return data.map(d => ({ ...d, label: fmtShort(d.date) }))
}

/* ── Delta ── */
function pctDelta(cur, prev) {
  if (prev === 0) return cur !== 0 ? 100 : 0
  return ((cur - prev) / Math.abs(prev)) * 100
}

/* ── KPIs ── */
function computeKpis(current, previous) {
  if (!current.length) return []

  const rev = current.reduce((s, d) => s + d.revenue, 0)
  const sold = current.reduce((s, d) => s + d.sold_total, 0)
  const avgDaily = current.length > 0 ? sold / current.length : 0
  const revPerUnit = sold > 0 ? rev / sold : 0

  const pRev = previous.reduce((s, d) => s + d.revenue, 0)
  const pSold = previous.reduce((s, d) => s + d.sold_total, 0)
  const pAvg = previous.length > 0 ? pSold / previous.length : 0
  const pRpu = pSold > 0 ? pRev / pSold : 0

  return [
    { id: 'revenue', label: 'Revenue', value: rev, delta: pctDelta(rev, pRev), isCurrency: true },
    { id: 'sold', label: 'Units Sold', value: sold, delta: pctDelta(sold, pSold) },
    { id: 'avg_daily', label: 'Daily Average', value: avgDaily, delta: pctDelta(avgDaily, pAvg) },
    { id: 'rev_per_unit', label: 'Revenue / Unit', value: revPerUnit, delta: pctDelta(revPerUnit, pRpu), isCurrency: true },
  ]
}

/* ── Category Breakdown ── */
function computeBreakdown(data, stats) {
  const retail = data.reduce((s, d) => s + d.sold_tank, 0)
  const wholesale = data.reduce((s, d) => s + d.sold_wholesale, 0)
  const total = retail + wholesale

  const channels = total > 0
    ? [
        { name: 'Retail', value: retail, pct: Math.round((retail / total) * 100) },
        { name: 'Wholesale', value: wholesale, pct: Math.round((wholesale / total) * 100) },
      ]
    : []

  const variants = []
  if (stats) {
    const totals = {}
    ;[...(stats.by_variant || []), ...(stats.by_variant_wholesale || [])].forEach(v => {
      totals[v.variant] = (totals[v.variant] || 0) + Number(v.count || 0)
    })
    const stockTotal = Object.values(totals).reduce((s, v) => s + v, 0)
    Object.entries(totals)
      .sort((a, b) => b[1] - a[1])
      .forEach(([name, value]) => {
        variants.push({ name, value, pct: stockTotal > 0 ? Math.round((value / stockTotal) * 100) : 0 })
      })
  }

  return { channels, variants }
}

/* ── Insight Generation ── */
function describeMag(val) {
  const abs = Math.abs(val)
  if (abs >= 80) return val > 0 ? 'nearly doubled' : 'collapsed'
  if (abs >= 45) return val > 0 ? 'surged' : 'dropped sharply'
  if (abs >= 20) return val > 0 ? 'climbed strongly' : 'declined noticeably'
  if (abs >= 8) return val > 0 ? 'grew steadily' : 'softened'
  if (abs >= 2) return val > 0 ? 'edged up' : 'dipped slightly'
  return 'held flat'
}

function arrow(v) { return v > 0 ? '↑' : v < 0 ? '↓' : '→' }

function computeInsights(current, previous, stats, alerts) {
  const ins = { performance: [], trends: [], risks: [], opportunities: [] }
  if (!current.length) return ins

  const len = current.length
  const sold = current.reduce((s, d) => s + d.sold_total, 0)
  const rev = current.reduce((s, d) => s + d.revenue, 0)
  const avgDaily = len > 0 ? Math.round(sold / len) : 0
  const avgRev = len > 0 ? rev / len : 0
  const sales = current.map(d => d.sold_total)

  const pSold = previous.reduce((s, d) => s + d.sold_total, 0)
  const pRev = previous.reduce((s, d) => s + d.revenue, 0)
  const revD = pctDelta(rev, pRev)
  const soldD = pctDelta(sold, pSold)

  /* ── Performance ── */
  if (pRev > 0 || rev > 0) {
    ins.performance.push({
      text: `Revenue ${describeMag(revD)} ${arrow(revD)} ${Math.abs(revD).toFixed(1)}% vs previous period`,
      detail: `${fmtCurrency(rev)} current vs ${fmtCurrency(pRev)} previous`,
      type: revD >= 0 ? 'positive' : 'negative',
    })
  }

  const peakIdx = sales.indexOf(Math.max(...sales))
  const peakDay = current[peakIdx]
  if (peakDay && peakDay.sold_total > 0) {
    const peakVsAvg = avgDaily > 0 ? ((peakDay.sold_total / avgDaily) - 1) * 100 : 0
    ins.performance.push({
      text: `Peak: ${peakDay.sold_total} units on ${fmtShort(peakDay.date)} — ${peakVsAvg > 50 ? 'standout spike' : peakVsAvg > 20 ? 'above average' : 'near normal'}`,
      detail: `Period avg: ${avgDaily} units/day (${peakVsAvg > 0 ? '+' : ''}${peakVsAvg.toFixed(0)}%)`,
      type: 'positive',
    })
  }

  if (avgDaily > 0) {
    ins.performance.push({
      text: `Throughput: ${avgDaily} units/day, ${fmtCurrency(avgRev)}/day over ${len} days`,
      detail: `${sold.toLocaleString()} total sold, ${fmtCurrency(rev)} earned`,
      type: 'neutral',
    })
  }

  /* ── Trends ── */
  const mid = Math.floor(len / 2)
  if (mid > 0) {
    const fHalf = current.slice(0, mid).reduce((s, d) => s + d.sold_total, 0)
    const sHalf = current.slice(mid).reduce((s, d) => s + d.sold_total, 0)
    const halfD = pctDelta(sHalf, fHalf)
    ins.trends.push({
      text: `Sales ${describeMag(halfD)} in the later half (${arrow(halfD)} ${Math.abs(halfD).toFixed(1)}%)`,
      detail: `First half: ${fHalf.toLocaleString()} → Second half: ${sHalf.toLocaleString()}`,
      type: halfD >= 5 ? 'positive' : halfD <= -5 ? 'negative' : 'neutral',
    })
  }

  const winSize = Math.max(2, Math.min(7, Math.floor(len * 0.2)))
  if (len >= winSize * 2) {
    const recent = current.slice(-winSize).reduce((s, d) => s + d.sold_total, 0)
    const prior = current.slice(-(winSize * 2), -winSize).reduce((s, d) => s + d.sold_total, 0)
    if (prior > 0) {
      const momD = pctDelta(recent, prior)
      ins.trends.push({
        text: `${winSize}-day momentum ${describeMag(momD)} vs prior window (${arrow(momD)} ${Math.abs(momD).toFixed(1)}%)`,
        detail: `Recent: ${recent.toLocaleString()} vs Prior: ${prior.toLocaleString()} units`,
        type: momD >= 10 ? 'positive' : momD <= -10 ? 'negative' : 'neutral',
      })
    }
  }

  const mean = sold / len
  if (len >= 5 && mean > 0) {
    const cv = Math.sqrt(sales.reduce((s, v) => s + (v - mean) ** 2, 0) / len) / mean
    if (cv > 0.35) {
      ins.trends.push({ text: 'High variability in daily sales — demand is unpredictable', detail: `CV: ${(cv * 100).toFixed(0)}%`, type: 'negative' })
    } else if (cv < 0.15) {
      ins.trends.push({ text: 'Sales remarkably consistent — stable demand signal', detail: `CV: ${(cv * 100).toFixed(0)}%`, type: 'positive' })
    }
  }
  ins.trends = ins.trends.slice(0, 3)

  /* ── Risks ── */
  const diffs = sales.slice(1).map((v, i) => ({ idx: i + 1, pct: pctDelta(v, sales[i]) }))
  const bigDrop = diffs.length > 0 ? diffs.reduce((w, d) => d.pct < w.pct ? d : w, { pct: 0 }) : { pct: 0 }
  if (bigDrop.pct < -25 && current[bigDrop.idx]) {
    ins.risks.push({
      text: `Sharp drop on ${fmtShort(current[bigDrop.idx].date)}: sales fell ${Math.abs(bigDrop.pct).toFixed(0)}% day-over-day`,
      detail: `From ${sales[bigDrop.idx - 1]} to ${sales[bigDrop.idx]} units`,
      type: 'negative',
    })
  }

  const zeroDay = current.find(d => d.sold_total === 0)
  if (zeroDay && len > 1) {
    ins.risks.push({ text: `Zero sales on ${fmtShort(zeroDay.date)}`, detail: 'Verify planned downtime or system gap', type: 'negative' })
  }

  if (revD < -10) {
    ins.risks.push({ text: `Revenue declining ${Math.abs(revD).toFixed(1)}% vs previous period`, detail: 'Review demand drivers and pricing', type: 'negative' })
  }

  const activeAlerts = (alerts || []).filter(a => a.status !== 'ok')
  const criticals = activeAlerts.filter(a => a.status === 'critical')
  if (criticals.length > 0) {
    ins.risks.push({ text: `Critical stock: ${criticals.map(a => `${a.variant} (${a.stock})`).join(', ')}`, detail: 'Below safety threshold', type: 'negative' })
  } else if (activeAlerts.length > 0) {
    ins.risks.push({ text: `${activeAlerts.length} stock warning${activeAlerts.length > 1 ? 's' : ''}`, detail: activeAlerts.map(a => `${a.variant}: ${a.stock}`).join(', '), type: 'negative' })
  }
  ins.risks = ins.risks.slice(0, 4)

  /* ── Opportunities ── */
  if (stats) {
    const totals = {}
    ;[...(stats.by_variant || []), ...(stats.by_variant_wholesale || [])].forEach(v => {
      totals[v.variant] = (totals[v.variant] || 0) + Number(v.count || 0)
    })
    const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1])
    const top = sorted[0]
    const bottom = sorted[sorted.length - 1]
    if (top && top[1] > 0) {
      const allT = sorted.reduce((s, v) => s + v[1], 0)
      ins.opportunities.push({ text: `${top[0]} leads at ${Math.round((top[1] / allT) * 100)}% share (${top[1].toLocaleString()} units)`, detail: 'Prioritize availability and promotion', type: 'positive' })
    }
    if (bottom && sorted.length > 1 && top && top[1] > bottom[1] && bottom[1] > 0) {
      ins.opportunities.push({ text: `${bottom[0]} trails by ${(top[1] - bottom[1]).toLocaleString()} units`, detail: 'Targeted pricing or bundling could close the gap', type: 'neutral' })
    }
  }

  if (soldD > 15) {
    ins.opportunities.push({ text: 'Strong growth momentum — consider scaling supply', detail: `Sales grew ${soldD.toFixed(0)}% vs previous period`, type: 'positive' })
  }

  const retailTotal = current.reduce((s, d) => s + d.sold_tank, 0)
  const wholesaleTotal = current.reduce((s, d) => s + d.sold_wholesale, 0)
  if (retailTotal > 0 && wholesaleTotal > 0) {
    const wPct = Math.round((wholesaleTotal / (retailTotal + wholesaleTotal)) * 100)
    ins.opportunities.push({ text: `Wholesale accounts for ${wPct}% of sales volume`, detail: wPct < 30 ? 'Expanding wholesale could diversify revenue' : 'Healthy channel balance', type: wPct < 30 ? 'neutral' : 'positive' })
  }
  ins.opportunities = ins.opportunities.slice(0, 4)

  return ins
}

/* ══════════════════════════════════════
   Main Hook
   ══════════════════════════════════════ */
export default function useAnalyticsData(timeRange) {
  const [dailyData, setDailyData] = useState([])
  const [prevData, setPrevData] = useState([])
  const [stats, setStats] = useState(null)
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)

  const periodDays = useMemo(() => {
    if (timeRange.type === 'custom' && timeRange.start && timeRange.end) {
      return Math.max(1, Math.ceil((new Date(timeRange.end) - new Date(timeRange.start)) / 86400000) + 1)
    }
    return PRESET_DAYS[timeRange.key] || 7
  }, [timeRange.type, timeRange.key, timeRange.start, timeRange.end])

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    let currentUrl
    if (timeRange.type === 'custom' && timeRange.start && timeRange.end) {
      currentUrl = `/api/daily-trend?start_date=${encodeURIComponent(timeRange.start)}&end_date=${encodeURIComponent(timeRange.end)}`
    } else {
      currentUrl = `/api/daily-trend?days=${PRESET_DAYS[timeRange.key] || 7}`
    }

    const today = new Date()
    let prevStart, prevEnd
    if (timeRange.type === 'custom' && timeRange.start && timeRange.end) {
      const s = new Date(timeRange.start + 'T00:00:00')
      const rangeDays = Math.max(1, Math.ceil((new Date(timeRange.end) - s) / 86400000) + 1)
      prevEnd = new Date(s)
      prevEnd.setDate(prevEnd.getDate() - 1)
      prevStart = new Date(prevEnd)
      prevStart.setDate(prevStart.getDate() - rangeDays + 1)
    } else {
      const days = PRESET_DAYS[timeRange.key] || 7
      prevEnd = new Date(today)
      prevEnd.setDate(prevEnd.getDate() - days)
      prevStart = new Date(prevEnd)
      prevStart.setDate(prevStart.getDate() - days + 1)
    }
    const prevUrl = `/api/daily-trend?start_date=${encodeURIComponent(toISO(prevStart))}&end_date=${encodeURIComponent(toISO(prevEnd))}`

    Promise.all([
      axios.get(currentUrl),
      axios.get(prevUrl),
      axios.get('/get_statistics'),
      axios.get('/api/low-stock'),
    ]).then(([curRes, prevRes, statsRes, alertsRes]) => {
      if (cancelled) return
      setDailyData(curRes.data?.data || [])
      setPrevData(prevRes.data?.data || [])
      setStats(statsRes.data)
      setAlerts(alertsRes.data?.alerts || [])
    }).catch(err => {
      console.error('Analytics fetch error', err)
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })

    return () => { cancelled = true }
  }, [timeRange.type, timeRange.key, timeRange.start, timeRange.end])

  const granularity = getGranularity(periodDays)
  const trendData = useMemo(() => groupData(dailyData, granularity), [dailyData, granularity])
  const kpis = useMemo(() => computeKpis(dailyData, prevData), [dailyData, prevData])
  const breakdown = useMemo(() => computeBreakdown(dailyData, stats), [dailyData, stats])
  const insights = useMemo(() => computeInsights(dailyData, prevData, stats, alerts), [dailyData, prevData, stats, alerts])

  return { loading, dailyData, prevData, stats, alerts, kpis, trendData, breakdown, insights, granularity, days: periodDays }
}
