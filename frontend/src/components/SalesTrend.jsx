import React, { useState, useRef } from 'react'
import { motion } from 'framer-motion'
import {
  AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts'
import { Calendar, Image, FileSpreadsheet, ChevronDown, Activity } from 'lucide-react'
import * as XLSX from 'xlsx'
import { toPng } from 'html-to-image'
import { EmptyState } from './ui'

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

const SOLD_COLOR = '#4C7A3D'

/* ─── Custom Tooltip ─── */
function SalesTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const row = payload[0]?.payload
  if (!row) return null
  const rows = [
    { label: 'Units Sold', color: SOLD_COLOR, value: Number(row.sold_total).toLocaleString() },
    { label: 'Revenue', color: '#5E9B94', value: fmtCurrency(row.revenue) },
  ]
  return (
    <div className="rounded-2xl text-sm overflow-hidden"
      style={{
        background: 'var(--tooltip-bg)',
        border: '1px solid var(--tooltip-border)',
        boxShadow: '0 12px 40px rgba(0,0,0,0.35), 0 0 24px rgba(76,122,61,0.04)',
      }}>
      <div className="px-4 pt-3 pb-2" style={{ borderBottom: '1px solid var(--glass-border)' }}>
        <p className="font-bold text-xs" style={{ color: 'var(--text-primary)' }}>{fmtDateFull(row.date)}</p>
      </div>
      <div className="px-4 py-2.5 space-y-2">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-6">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full"
                style={{ background: r.color, boxShadow: `0 0 6px ${r.color}30` }} />
              <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{r.label}</span>
            </span>
            <span className="font-bold text-xs" style={{ color: 'var(--text-primary)' }}>{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ─── Skeleton — matches the rendered chart geometry so nothing reflows on load ─── */
function ChartSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="skeleton-dark rounded-2xl" style={{ width: '100%', height: 260 }} />
    </div>
  )
}

/* ════════════════════════════════════════════════════
   MAIN COMPONENT
   Range state and data are owned by Dashboard so the
   chart and the analytics panel always agree.
   ════════════════════════════════════════════════════ */
export default function SalesTrend({ data = [], loading, range, setRange }) {
  const chartRef = useRef(null)
  const [exporting, setExporting] = useState(false)

  /* ── Computed Stats ─── */
  const totalSold = data.reduce((s, d) => s + d.sold_total, 0)
  const totalRevenue = data.reduce((s, d) => s + d.revenue, 0)
  const avgDaily = data.length > 0 ? Math.round(totalSold / data.length) : 0
  const peakDay = data.reduce((best, d) => (d.sold_total > (best?.sold_total || 0) ? d : best), data[0])

  const isEmpty = data.length === 0 || (totalSold === 0 && totalRevenue === 0)

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
      XLSX.writeFile(wb, `sales-trend-${data[0]?.date || 'export'}.xlsx`)
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
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      className="rounded-2xl p-4 sm:p-6"
      style={{
        background: 'var(--glass-bg)',
        border: '1px solid var(--glass-border)',
      }}>

      {/* ── Header ─── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
        <div>
          <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: 'rgba(76,122,61,0.1)' }}>
              <Activity className="w-3.5 h-3.5 text-accent-green" />
            </div>
            Sales Trend
          </h3>
          <p className="text-xs text-text-muted mt-1 ml-9">
            {loading
              ? 'Loading…'
              : data.length > 0
                ? `${fmtDateFull(data[0].date)} — ${fmtDateFull(data[data.length - 1].date)}`
                : 'No data'}
          </p>
        </div>

        {/* Export */}
        <div className="flex items-center gap-1.5">
          <button onClick={exportExcel} disabled={exporting || data.length === 0}
            className="flex items-center gap-1.5 text-xs sm:text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-all text-text-muted hover:text-text-primary"
            style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}
            title="Export to Excel">
            <FileSpreadsheet className="w-3.5 h-3.5" /> Excel
          </button>
          <button onClick={exportPng} disabled={exporting || data.length === 0}
            className="flex items-center gap-1.5 text-xs sm:text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-all text-text-muted hover:text-text-primary"
            style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}
            title="Export as PNG">
            <Image className="w-3.5 h-3.5" /> PNG
          </button>
        </div>
      </div>

      {/* ── Range filter — governs this card AND the analytics panel below ─── */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {/* Period Presets */}
        <div className="flex items-center gap-0.5 p-1 rounded-xl"
          style={{ background: 'var(--btn-secondary-bg)', border: '1px solid var(--glass-border)' }}>
          {PRESETS.map(p => {
            const active = !range.custom && range.days === p.days
            return (
              <button key={p.days}
                onClick={() => setRange({ days: p.days, start: '', end: '', custom: false })}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-300 ${
                  active ? 'text-white shadow-lg' : 'text-text-muted hover:text-text-primary hover:bg-glass-hover'
                }`}
                style={active ? {
                  background: 'linear-gradient(135deg, #4C7A3D, #5E9B94)',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                } : {}}>
                {p.label}
              </button>
            )
          })}
        </div>

        {/* Custom Range */}
        <button onClick={() => setRange(r => ({ ...r, custom: !r.custom }))}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-300 ${
            range.custom
              ? 'bg-accent-green/15 text-accent-green border border-accent-green/25'
              : 'text-text-muted hover:text-text-primary border border-glass-border'
          }`}
          style={!range.custom ? { background: 'var(--btn-secondary-bg)' } : {}}>
          <Calendar className="w-3.5 h-3.5" /> Custom
        </button>

        {range.custom && (
          <div className="flex items-center gap-2">
            <input type="date" value={range.start} onChange={e => setRange(r => ({ ...r, start: e.target.value }))}
              className="neu-input text-xs py-1.5 px-2" />
            <span className="text-xs text-text-muted font-medium">to</span>
            <input type="date" value={range.end} onChange={e => setRange(r => ({ ...r, end: e.target.value }))}
              className="neu-input text-xs py-1.5 px-2" />
          </div>
        )}
      </div>

      {/* ── KPI Stats ─── */}
      {/* Period summary as one line — three tiles restated what the chart already plots. */}
      {!loading && !isEmpty && (
        <p className="text-xs text-text-secondary mb-3 flex flex-wrap gap-x-1.5 gap-y-1">
          <span><b className="font-semibold text-text-primary tabular-nums">{totalSold.toLocaleString()}</b> sold</span>
          <span className="text-text-muted">·</span>
          <span><b className="font-semibold text-text-primary tabular-nums">{fmtCurrency(totalRevenue)}</b></span>
          <span className="text-text-muted">·</span>
          <span className="text-text-muted tabular-nums">avg {avgDaily.toLocaleString()}/day</span>
          {peakDay && peakDay.sold_total > 0 && (
            <>
              <span className="text-text-muted">·</span>
              <span className="text-text-muted tabular-nums">
                peak {peakDay.sold_total.toLocaleString()} on {fmtDate(peakDay.date)}
              </span>
            </>
          )}
        </p>
      )}

      {/* ── Chart ─── */}
      {loading ? <ChartSkeleton /> : isEmpty ? (
        /* Sits on the same tinted panel the chart uses, so an empty range
           still reads as "the chart, with nothing in it" rather than a gap
           where a card should be — which is how it looked on a wide screen,
           beside a Recent Activity column full of rows. */
        <div className="rounded-2xl" style={{ background: 'var(--glass-bg)' }}>
          <EmptyState
            compact
            icon={Activity}
            title="No sales in this period"
            message="Sales recorded against this range will plot here."
          />
        </div>
      ) : (
        <div className="h-[220px] sm:h-[260px] rounded-2xl overflow-hidden p-2"
          style={{ background: 'var(--glass-bg)' }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 12, right: 16, left: 0, bottom: 8 }}>
              <defs>
                <linearGradient id="gradSoldWave" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={SOLD_COLOR} stopOpacity={0.25} />
                  <stop offset="50%" stopColor={SOLD_COLOR} stopOpacity={0.06} />
                  <stop offset="100%" stopColor={SOLD_COLOR} stopOpacity={0} />
                </linearGradient>
                <filter id="glowGreen" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="2" result="blur" />
                  <feFlood floodColor={SOLD_COLOR} floodOpacity="0.15" />
                  <feComposite in2="blur" operator="in" />
                  <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              </defs>

              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
              <XAxis
                dataKey="label"
                stroke="var(--chart-text)"
                fontSize={12}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                minTickGap={24}
                dy={8}
              />
              <YAxis
                stroke="var(--chart-text)"
                fontSize={12}
                tickLine={false}
                axisLine={false}
                tickFormatter={fmt}
                domain={[0, 'auto']}
                allowDecimals={false}
                width={54}
              />
              <Tooltip content={<SalesTooltip />} cursor={{ stroke: 'var(--glass-border)', strokeWidth: 1 }} />

              {/* Units sold. Revenue is units × flat price, so plotting it as a
                  second series would just redraw this line on a second axis —
                  it lives in the KPI card and the tooltip instead. */}
              <Area
                type="monotone"
                dataKey="sold_total"
                name="Units Sold"
                stroke={SOLD_COLOR}
                fill="url(#gradSoldWave)"
                strokeWidth={2}
                dot={false}
                activeDot={{
                  r: 4, fill: SOLD_COLOR, stroke: '#064e3b', strokeWidth: 2,
                  filter: 'url(#glowGreen)',
                }}
                animationDuration={1200}
                animationEasing="ease-in-out"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Daily Breakdown Table ─── */}
      {!loading && data.length > 0 && (
        <details className="mt-3 group">
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
                {data.slice().reverse().map((d, ri) => {
                  const prev = data[data.length - 2 - ri]
                  const soldChange = prev ? d.sold_total - prev.sold_total : 0
                  return (
                    <tr key={d.date}
                      className={`transition-colors ${d === peakDay ? 'bg-accent-amber/5' : ''}`}
                      style={{ borderTop: '1px solid var(--table-border)' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--table-row-hover)'}
                      onMouseLeave={e => e.currentTarget.style.background = d === peakDay ? '' : 'transparent'}
                    >
                      <td className="py-2 px-3 text-text-secondary font-medium">{fmtDate(d.date)}</td>
                      <td className="py-2 px-3 text-right font-semibold text-text-primary">
                        {d.sold_total}
                        {soldChange !== 0 && (
                          <span className={`ml-1 text-xs ${soldChange > 0 ? 'text-accent-green' : 'text-accent-red'}`}>
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
                  <td className="py-2.5 px-3 font-bold text-text-primary uppercase text-xs tracking-wider">Total</td>
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
