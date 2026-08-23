import React, { useEffect, useState, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import axios from 'axios'
import {
  AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts'
import {
  TrendingUp, TrendingDown, Minus, Calendar, Filter,
  Image, FileSpreadsheet, ChevronDown,
  DollarSign, Package, Activity
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { toPng } from 'html-to-image'

/* ─── Helpers ─── */
const fmt = (n) => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(n)
}

const fmtCurrency = (v) => '₱' + Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fmtDate = (dateStr) => {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const fmtDateFull = (dateStr) => {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

/* ─── Period Presets ─── */
const PRESETS = [
  { label: '7D', days: 7 },
  { label: '30D', days: 30 },
  { label: '3 Months', days: 90 },
]

/* ─── Custom Tooltip ─── */
function SalesTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const row = payload[0]?.payload
  if (!row) return null
  return (
    <div className="rounded-2xl text-sm overflow-hidden"
      style={{
        background: 'var(--tooltip-bg)',
        border: '1px solid var(--tooltip-border)',
        backdropFilter: 'blur(14px)',
        boxShadow: '0 12px 40px rgba(0,0,0,0.35), 0 0 24px rgba(76,122,61,0.04)',
      }}>
      <div className="px-4 pt-3 pb-2" style={{ borderBottom: '1px solid var(--glass-border)' }}>
        <p className="font-bold text-xs" style={{ color: 'var(--text-primary)' }}>{fmtDateFull(row.date)}</p>
      </div>
      <div className="px-4 py-2.5 space-y-2">
        {payload.map((p, i) => (
          <div key={i} className="flex items-center justify-between gap-6">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full ring-2 ring-offset-1 ring-offset-transparent"
                style={{ background: p.color, boxShadow: `0 0 6px ${p.color}30` }} />
              <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{p.name}</span>
            </span>
            <span className="font-bold text-xs" style={{ color: 'var(--text-primary)' }}>
              {p.name === 'Revenue' ? fmtCurrency(p.value) : Number(p.value).toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ─── KPI Stat Card ─── */
function StatCard({ label, value, subValue, trend, icon: Icon, color }) {
  const isUp = trend > 0
  const isDown = trend < 0
  return (
    <div className="flex flex-col gap-1.5 p-3 sm:p-4 rounded-2xl min-w-0 sm:min-w-[150px] relative overflow-hidden"
      style={{
        background: 'var(--glass-bg)',
        border: '1px solid var(--glass-border)',
      }}>
      <div className="absolute -top-6 -right-6 w-16 h-16 rounded-full opacity-[0.04]"
        style={{ background: color }} />
      <div className="flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5" style={{ color }} />
        <span className="text-[9px] sm:text-[10px] font-bold text-text-muted uppercase tracking-wider truncate">{label}</span>
      </div>
      <p className="text-base sm:text-xl font-extrabold text-text-primary truncate">{value}</p>
      <div className="flex items-center gap-1">
        {trend !== 0 && (
          <>
            {isUp ? <TrendingUp className="w-3 h-3 text-accent-green" /> : <TrendingDown className="w-3 h-3 text-accent-red" />}
            <span className={`text-[10px] font-bold ${isUp ? 'text-accent-green' : 'text-accent-red'}`}>
              {isUp ? '+' : ''}{trend.toFixed(1)}%
            </span>
          </>
        )}
        {trend === 0 && <Minus className="w-3 h-3 text-text-muted" />}
        {subValue && <span className="text-[10px] text-text-muted ml-1">{subValue}</span>}
      </div>
    </div>
  )
}

/* ─── Series Toggle ─── */
function SeriesToggle({ label, color, active, onClick }) {
  return (
    <button onClick={onClick}
      className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all duration-300"
      style={{
        background: active ? `${color}15` : 'var(--btn-secondary-bg)',
        border: `1px solid ${active ? `${color}30` : 'var(--glass-border)'}`,
        color: active ? color : '#64748b',
        boxShadow: active ? `0 0 20px ${color}10` : 'none',
      }}>
      <span className="w-2.5 h-2.5 rounded-full transition-all duration-300"
        style={{
          background: active ? color : '#475569',
          boxShadow: active ? `0 0 8px ${color}60` : 'none',
        }} />
      {label}
    </button>
  )
}

/* ─── Skeleton ─── */
function ChartSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="flex gap-3">
        <div className="skeleton-dark rounded-2xl" style={{ width: 150, height: 80 }} />
        <div className="skeleton-dark rounded-2xl" style={{ width: 150, height: 80 }} />
        <div className="skeleton-dark rounded-2xl" style={{ width: 150, height: 80 }} />
      </div>
      <div className="skeleton-dark rounded-2xl" style={{ width: '100%', height: 340 }} />
    </div>
  )
}

/* ─── Series Definitions (Sales Only) ─── */
const SERIES = {
  sold_total: { label: 'Units Sold', color: '#4C7A3D' },
  revenue:    { label: 'Revenue',    color: '#5E9B94' },
}

/* ════════════════════════════════════════════════════
   MAIN COMPONENT
   ════════════════════════════════════════════════════ */
export default function SalesTrend() {
  const chartRef = useRef(null)

  const [data, setData] = useState([])
  const [prices, setPrices] = useState({ retail: 0.40, wholesale: 0.40 })
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  // Filters
  const [days, setDays] = useState(7)
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [variant, setVariant] = useState('')
  const [showCustomRange, setShowCustomRange] = useState(false)

  // Visible series (sales only — max 2)
  const [visible, setVisible] = useState({
    sold_total: true,
    revenue: true,
  })

  const toggleSeries = (key) => setVisible(prev => ({ ...prev, [key]: !prev[key] }))

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (showCustomRange && customStart && customEnd) {
        params.set('start_date', customStart)
        params.set('end_date', customEnd)
      } else {
        params.set('days', String(days))
      }
      if (variant) params.set('variant', variant)
      const res = await axios.get(`/api/daily-trend?${params}`)
      setData(res.data.data || [])
      if (res.data.prices) setPrices(res.data.prices)
    } catch (e) {
      console.error('Failed to load daily trend', e)
    } finally {
      setLoading(false)
    }
  }, [days, customStart, customEnd, variant, showCustomRange])

  useEffect(() => { loadData() }, [loadData])

  /* ── Computed Stats ─── */
  const totalSold = data.reduce((s, d) => s + d.sold_total, 0)
  const totalRevenue = data.reduce((s, d) => s + d.revenue, 0)
  const avgDaily = data.length > 0 ? Math.round(totalSold / data.length) : 0
  const avgRevenue = data.length > 0 ? totalRevenue / data.length : 0

  const mid = Math.floor(data.length / 2)
  const firstHalf = data.slice(0, mid)
  const secondHalf = data.slice(mid)
  const firstSold = firstHalf.reduce((s, d) => s + d.sold_total, 0)
  const secondSold = secondHalf.reduce((s, d) => s + d.sold_total, 0)
  const soldTrend = firstSold > 0 ? ((secondSold - firstSold) / firstSold) * 100 : (secondSold > 0 ? 100 : 0)
  const firstRev = firstHalf.reduce((s, d) => s + d.revenue, 0)
  const secondRev = secondHalf.reduce((s, d) => s + d.revenue, 0)
  const revTrend = firstRev > 0 ? ((secondRev - firstRev) / firstRev) * 100 : (secondRev > 0 ? 100 : 0)

  const peakDay = data.reduce((best, d) => (d.sold_total > (best?.sold_total || 0) ? d : best), data[0])

  /* ── Export: Excel ─── */
  async function exportExcel() {
    setExporting(true)
    try {
      const rows = data.map(d => ({
        Date: d.date,
        'Units Sold': d.sold_total,
        'Revenue (₱)': d.revenue,
      }))
      rows.push({})
      rows.push({
        Date: 'TOTAL',
        'Units Sold': totalSold,
        'Revenue (₱)': Math.round(totalRevenue * 100) / 100,
      })
      const ws = XLSX.utils.json_to_sheet(rows)
      ws['!cols'] = [{ wch: 14 }, { wch: 12 }, { wch: 16 }]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Sales Trend')
      const filterLabel = variant || 'All'
      XLSX.writeFile(wb, `sales-trend-${filterLabel}-${data[0]?.date || 'export'}.xlsx`)
    } finally {
      setExporting(false)
    }
  }

  /* ── Export: PNG ─── */
  async function exportPng() {
    if (!chartRef.current) return
    setExporting(true)
    try {
      const dataUrl = await toPng(chartRef.current, {
        backgroundColor: '#0b0f1a',
        pixelRatio: 2,
        style: { padding: '24px' }
      })
      const link = document.createElement('a')
      link.download = `sales-trend-${data[0]?.date || 'chart'}.png`
      link.href = dataUrl
      link.click()
    } catch (e) {
      console.error('PNG export failed', e)
    } finally {
      setExporting(false)
    }
  }

  /* ── Chart data ─── */
  const chartData = data.map(d => ({
    ...d,
    label: fmtDate(d.date),
  }))

  return (
    <motion.div ref={chartRef}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15, duration: 0.5 }}
      className="rounded-2xl p-4 sm:p-6"
      style={{
        background: 'var(--glass-bg)',
        border: '1px solid var(--glass-border)',
        backdropFilter: 'blur(12px)',
      }}>

      {/* ── Header ─── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 sm:mb-6">
        <div>
          <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: 'rgba(76,122,61,0.1)' }}>
              <Activity className="w-3.5 h-3.5 text-accent-green" />
            </div>
            Sales Trend
          </h3>
          <p className="text-[10px] text-text-muted mt-1 ml-9">
            {data.length > 0
              ? `${fmtDateFull(data[0].date)} — ${fmtDateFull(data[data.length - 1].date)}`
              : 'Loading...'}
          </p>
        </div>

        {/* Export */}
        <div className="flex items-center gap-1.5">
          <button onClick={exportExcel} disabled={exporting || data.length === 0}
            className="flex items-center gap-1.5 text-[10px] sm:text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-all text-text-muted hover:text-text-primary"
            style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}
            title="Export to Excel">
            <FileSpreadsheet className="w-3.5 h-3.5" /> Excel
          </button>
          <button onClick={exportPng} disabled={exporting || data.length === 0}
            className="flex items-center gap-1.5 text-[10px] sm:text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-all text-text-muted hover:text-text-primary"
            style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}
            title="Export as PNG">
            <Image className="w-3.5 h-3.5" /> PNG
          </button>
        </div>
      </div>

      {/* ── Filters ─── */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        {/* Period Presets */}
        <div className="flex items-center gap-0.5 p-1 rounded-xl"
          style={{ background: 'var(--btn-secondary-bg)', border: '1px solid var(--glass-border)' }}>
          {PRESETS.map(p => (
            <button key={p.days}
              onClick={() => { setDays(p.days); setShowCustomRange(false) }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-300 ${
                !showCustomRange && days === p.days
                  ? 'text-white shadow-lg'
                  : 'text-text-muted hover:text-text-primary hover:bg-glass-hover'
              }`}
              style={!showCustomRange && days === p.days ? {
                background: 'linear-gradient(135deg, #4C7A3D, #5E9B94)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
              } : {}}>
              {p.label}
            </button>
          ))}
        </div>

        {/* Custom Range */}
        <button onClick={() => setShowCustomRange(!showCustomRange)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-300 ${
            showCustomRange
              ? 'bg-accent-green/15 text-accent-green border border-accent-green/25'
              : 'text-text-muted hover:text-text-primary border border-glass-border'
          }`}
          style={!showCustomRange ? { background: 'var(--btn-secondary-bg)' } : {}}>
          <Calendar className="w-3.5 h-3.5" /> Custom
        </button>

        {showCustomRange && (
          <div className="flex items-center gap-2">
            <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
              className="neu-input text-xs py-1.5 px-2" />
            <span className="text-[10px] text-text-muted font-medium">to</span>
            <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
              className="neu-input text-xs py-1.5 px-2" />
          </div>
        )}

        <div className="w-px h-5 hidden sm:block" style={{ background: 'var(--glass-border)' }} />

        {/* Variant Filter */}
        <div className="flex items-center gap-1.5">
          <Filter className="w-3.5 h-3.5 text-text-muted" />
          <select value={variant} onChange={e => setVariant(e.target.value)}
            className="neu-input text-xs py-1.5 px-2 min-w-[110px]">
            <option value="">All Variants</option>
            <option value="SPIN_20">SPIN_20</option>
          </select>
        </div>
      </div>

      {/* ── KPI Stats ─── */}
      {!loading && data.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3 mb-5">
          <StatCard label="Total Sold" value={totalSold.toLocaleString()} subValue={`avg ${avgDaily}/day`}
            trend={soldTrend} icon={Package} color="#4C7A3D" />
          <StatCard label="Revenue" value={fmtCurrency(totalRevenue)} subValue={`avg ${fmtCurrency(avgRevenue)}/day`}
            trend={revTrend} icon={DollarSign} color="#5E9B94" />
          {peakDay && peakDay.sold_total > 0 && (
            <StatCard label="Peak Day" value={`${peakDay.sold_total} sold`}
              subValue={fmtDate(peakDay.date)} trend={0} icon={TrendingUp} color="#D98E3B" />
          )}
        </div>
      )}

      {/* ── Series Toggles ─── */}
      <div className="flex items-center gap-2 mb-4">
        {Object.entries(SERIES).map(([key, s]) => (
          <SeriesToggle key={key} label={s.label} color={s.color}
            active={visible[key]} onClick={() => toggleSeries(key)} />
        ))}
      </div>

      {/* ── Chart ─── */}
      {loading ? <ChartSkeleton /> : data.length === 0 ? (
        <div className="py-20 text-center">
          <p className="text-sm text-text-muted">No sales data for the selected period</p>
        </div>
      ) : (
        <div className="h-[280px] sm:h-[360px] mt-2 rounded-2xl overflow-hidden p-2"
          style={{ background: 'var(--glass-bg)' }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 12, right: visible.revenue ? 50 : 16, left: 0, bottom: 8 }}>
              <defs>
                <linearGradient id="gradSoldWave" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#4C7A3D" stopOpacity={0.25} />
                  <stop offset="50%" stopColor="#4C7A3D" stopOpacity={0.06} />
                  <stop offset="100%" stopColor="#4C7A3D" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradRevenueWave" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#5E9B94" stopOpacity={0.2} />
                  <stop offset="50%" stopColor="#5E9B94" stopOpacity={0.05} />
                  <stop offset="100%" stopColor="#5E9B94" stopOpacity={0} />
                </linearGradient>
                {/* Glow filters */}
                <filter id="glowGreen" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="2" result="blur" />
                  <feFlood floodColor="#4C7A3D" floodOpacity="0.15" />
                  <feComposite in2="blur" operator="in" />
                  <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
                <filter id="glowTeal" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="2" result="blur" />
                  <feFlood floodColor="#5E9B94" floodOpacity="0.15" />
                  <feComposite in2="blur" operator="in" />
                  <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              </defs>

              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
              <XAxis
                dataKey="label"
                stroke="#475569"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                interval={data.length > 30 ? Math.floor(data.length / 8) : data.length > 14 ? 2 : 0}
                dy={8}
              />
              <YAxis
                yAxisId="left"
                stroke="#475569"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                tickFormatter={fmt}
                domain={[0, 'auto']}
                allowDataOverflow={false}
                width={40}
              />
              {visible.revenue && (
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  stroke="#475569"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={v => `₱${fmt(v)}`}
                  domain={[0, 'auto']}
                  allowDataOverflow={false}
                  width={48}
                />
              )}
              <Tooltip content={<SalesTooltip />} cursor={{ stroke: 'var(--glass-border)', strokeWidth: 1 }} />

              {/* Units Sold — green wave */}
              {visible.sold_total && (
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="sold_total"
                  name="Units Sold"
                  stroke="#4C7A3D"
                  fill="url(#gradSoldWave)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{
                    r: 4, fill: '#4C7A3D', stroke: '#064e3b', strokeWidth: 2,
                    filter: 'url(#glowGreen)',
                  }}
                  animationDuration={1200}
                  animationEasing="ease-in-out"
                />
              )}

              {/* Revenue — teal wave */}
              {visible.revenue && (
                <Area
                  yAxisId="right"
                  type="monotone"
                  dataKey="revenue"
                  name="Revenue"
                  stroke="#5E9B94"
                  fill="url(#gradRevenueWave)"
                  strokeWidth={1.5}
                  dot={false}
                  activeDot={{
                    r: 3.5, fill: '#5E9B94', stroke: '#134e4a', strokeWidth: 2,
                    filter: 'url(#glowTeal)',
                  }}
                  animationDuration={1200}
                  animationEasing="ease-in-out"
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Daily Breakdown Table ─── */}
      {!loading && data.length > 0 && (
        <details className="mt-5 group">
          <summary className="cursor-pointer text-xs font-bold text-text-muted uppercase tracking-wider flex items-center gap-2 hover:text-text-secondary transition-colors py-1">
            <ChevronDown className="w-3.5 h-3.5 transition-transform duration-300 group-open:rotate-180" />
            Daily Breakdown
          </summary>
          <div className="mt-3 max-h-[320px] overflow-auto rounded-xl -mx-1 sm:mx-0"
            style={{ border: '1px solid var(--glass-border)' }}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ background: 'var(--glass-bg)' }} className="sticky top-0">
                  <th className="text-left py-2.5 px-3 font-bold text-text-muted uppercase tracking-wider">Date</th>
                  <th className="text-right py-2.5 px-3 font-bold text-text-muted uppercase tracking-wider">Sold</th>
                  <th className="text-right py-2.5 px-3 font-bold text-text-muted uppercase tracking-wider">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {[...data].reverse().map((d) => {
                  const prev = data[data.indexOf(d) - 1]
                  const soldChange = prev ? d.sold_total - prev.sold_total : 0
                  return (
                    <tr key={d.date}
                      className={`transition-colors ${
                        d === peakDay ? 'bg-accent-amber/5' : ''
                      }`}
                      style={{ borderTop: '1px solid var(--table-border)' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--table-row-hover)'}
                      onMouseLeave={e => e.currentTarget.style.background = d === peakDay ? '' : 'transparent'}
                    >
                      <td className="py-2 px-3 text-text-secondary font-medium">{fmtDate(d.date)}</td>
                      <td className="py-2 px-3 text-right font-semibold text-text-primary">
                        {d.sold_total}
                        {soldChange !== 0 && (
                          <span className={`ml-1 text-[9px] ${soldChange > 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                            {soldChange > 0 ? '↑' : '↓'}
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right text-accent-green font-medium">{fmtCurrency(d.revenue)}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '1px solid var(--glass-border)', background: 'var(--glass-bg)' }}>
                  <td className="py-2.5 px-3 font-bold text-text-primary uppercase text-[10px] tracking-wider">Total</td>
                  <td className="py-2.5 px-3 text-right font-bold text-text-primary">{totalSold.toLocaleString()}</td>
                  <td className="py-2.5 px-3 text-right font-bold text-accent-green">{fmtCurrency(totalRevenue)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </details>
      )}
    </motion.div>
  )
}
