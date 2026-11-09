import React, { useState, useRef, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts'
import { Calendar, Image, FileSpreadsheet, ChevronDown, Activity } from 'lucide-react'
import * as XLSX from 'xlsx'
import { toPng } from 'html-to-image'
import { EmptyState, SectionHeader } from './ui'
import { formatPeso as fmtCurrency } from '../utils/revenue'

/* ─── Helpers ─── */
const fmt = (n) => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(n)
}

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

/* Read off the theme at render rather than hardcoded: the series was pinned to
   the light palette's olive, so on the dark panel the line sat several steps
   darker than every other green on screen. */
const soldColor = () =>
  getComputedStyle(document.documentElement).getPropertyValue('--positive').trim() || '#4c7a3d'

/* ─── Custom Tooltip ─── */
function SalesTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const row = payload[0]?.payload
  if (!row) return null
  const rows = [
    { label: 'Units Sold', color: 'var(--positive)', value: Number(row.sold_total).toLocaleString() },
    { label: 'Revenue', color: 'var(--info)', value: fmtCurrency(row.revenue) },
  ]
  /* No green bloom behind the panel and no glow on the swatches — the second of
     those was `${r.color}30`, which since the colours became CSS variables
     produced the invalid `var(--positive)30` and drew nothing anyway. */
  return (
    <div className="rounded-lg overflow-hidden"
      style={{
        background: 'var(--tooltip-bg)',
        border: '1px solid var(--tooltip-border)',
        boxShadow: '0 6px 20px rgba(0,0,0,0.28)',
      }}>
      <p className="px-3 py-1.5 text-[11px] font-semibold"
        style={{ color: 'var(--text-primary)', borderBottom: '1px solid var(--rule)' }}>
        {fmtDateFull(row.date)}
      </p>
      <div className="px-3 py-2 space-y-1">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-6">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: r.color }} />
              <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{r.label}</span>
            </span>
            <span className="text-[11px] font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>
              {r.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ─── The plot itself ───
   One definition, two callers: the live card sizes it with a ResponsiveContainer,
   the PNG export renders it at a fixed size with animation off. Duplicating the
   markup for the export is how an export drifts out of sync with the chart it is
   supposed to be a picture of. */
function TrendChart({ data, width, height, animate = true }) {
  const color = soldColor()
  const chart = (
    <AreaChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 4 }}>
      <defs>
        <linearGradient id="gradSoldWave" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.18} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>

      <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
      <XAxis
        dataKey="label"
        stroke="var(--chart-text)"
        fontSize={10}
        tickLine={false}
        axisLine={false}
        interval="preserveStartEnd"
        minTickGap={24}
        dy={6}
      />
      <YAxis
        stroke="var(--chart-text)"
        fontSize={10}
        tickLine={false}
        axisLine={false}
        tickFormatter={fmt}
        domain={[0, 'auto']}
        allowDecimals={false}
        width={40}
      />
      {animate && <Tooltip content={<SalesTooltip />} cursor={{ stroke: 'var(--glass-border)', strokeWidth: 1 }} />}

      {/* Units sold. Revenue is units × flat price, so plotting it as a
          second series would just redraw this line on a second axis —
          it lives in the revenue strip and the tooltip instead. */}
      <Area
        type="monotone"
        dataKey="sold_total"
        name="Units Sold"
        stroke={color}
        fill="url(#gradSoldWave)"
        strokeWidth={1.75}
        dot={false}
        /* A plain filled dot. The one it replaces carried a Gaussian-blur glow
           filter, which is a decorative effect on the single most precise mark
           in the chart — the point whose exact value the operator is reading. */
        activeDot={{ r: 3.5, fill: color, stroke: 'var(--glass-bg)', strokeWidth: 2 }}
        isAnimationActive={animate}
        animationDuration={450}
        animationEasing="ease-out"
      />
    </AreaChart>
  )

  /* A fixed size is what the export needs: off-screen there is nothing for a
     ResponsiveContainer to measure, so it renders at zero and the capture comes
     back blank. */
  if (width) return React.cloneElement(chart, { width, height })
  return <ResponsiveContainer width="100%" height="100%">{chart}</ResponsiveContainer>
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
  const exportRef = useRef(null)
  const [exporting, setExporting] = useState(false)
  const [pngPending, setPngPending] = useState(false)

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

  /* ── Export: PNG ───
     Renders a sheet built for the purpose rather than photographing the live
     card. Screenshotting the card dragged in whatever the card happened to be
     showing — the Excel and PNG buttons, the range pills, a half-scrolled Daily
     Breakdown table and its scrollbars — and inherited the panel's cramped
     layout, so the chart came out letterboxed with its axis labels sliced off.
     The background was hardcoded to a navy the app has not used since the olive
     palette landed, which is why the title read as grey-on-grey. */
  function exportPng() {
    if (data.length === 0) return
    setExporting(true)
    setPngPending(true)
  }

  /* The sheet has to be mounted and painted before it can be captured, so the
     capture waits a frame rather than running inside the click handler. */
  useEffect(() => {
    if (!pngPending) return
    let cancelled = false

    ;(async () => {
      try {
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
        await new Promise(r => setTimeout(r, 80))
        if (cancelled || !exportRef.current) return

        const dataUrl = await toPng(exportRef.current, {
          // The app's own ground, whichever theme is on — not a fixed colour.
          backgroundColor: getComputedStyle(document.body).backgroundColor,
          pixelRatio: 2,
        })
        const link = document.createElement('a')
        link.download = `sales-trend-${data[0]?.date || 'chart'}.png`
        link.href = dataUrl
        link.click()
      } catch (e) {
        console.error('PNG export failed', e)
      } finally {
        if (!cancelled) { setPngPending(false); setExporting(false) }
      }
    })()

    return () => { cancelled = true }
  }, [pngPending]) // eslint-disable-line react-hooks/exhaustive-deps

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
      /* No min-h-0 and no overflow clipping here on purpose. Letting this card
         shrink below its own content made it "fit" the pane on paper while
         quietly cutting the chart and the Daily Breakdown row off inside it.
         The chart flexes down to its floor; past that the card keeps its
         natural height and the pane scrolls the last few pixels instead. */
      className="glass-card card-pad w-full flex flex-col">

      {/* ── Header ──
             Title and exports share the first row, the range filter gets the
             second. Merging all three into one wrapping row was measurably
             worse: below ~1400px the controls wrap as a block and the card
             grows taller than these two tidy rows.
             It wraps on its own width, not the viewport's: at 1024px this card
             is only ~430px wide, so a sm:flex-row that the viewport had already
             switched on ran the date range straight into the export buttons. ── */}
      <SectionHeader
        className="mb-2"
        title="Sales trend"
        /* The span sits on the title's baseline instead of on a line of its own
            under an icon tile. Spelled out in full it was ~300px wide, which is
            what pushed the export buttons onto a wrapped row. */
        meta={loading ? 'loading…' : data.length > 0
          ? `${fmtDate(data[0].date)} – ${fmtDate(data[data.length - 1].date)}`
          : 'no data'}
        /* Export — off on the shortest screens. Saving a spreadsheet or a PNG is
            desk work, and on the panel these two 44px touch targets cost more
            page than the chart they export. They return above 520px. */
        actions={
          <span className="flex items-center gap-1 [@media(max-height:520px)]:hidden">
            <button onClick={exportExcel} disabled={exporting || data.length === 0}
              className="chart-btn" title="Export to Excel">
              <FileSpreadsheet size={12} aria-hidden="true" /> Excel
            </button>
            <button onClick={exportPng} disabled={exporting || data.length === 0}
              className="chart-btn" title="Export as PNG">
              <Image size={12} aria-hidden="true" /> PNG
            </button>
          </span>
        }
      />

      {/* ── Range filter — governs this card AND the analytics panel below ─── */}
      {/* A segmented control, not four independently styled buttons. The active
          preset used to be a 135° two-colour gradient with a drop shadow, which
          made the loudest element on the dashboard a date filter. */}
      <div className="flex flex-wrap items-center gap-1.5 mb-2" role="group" aria-label="Date range">
        <div className="segmented">
          {PRESETS.map(p => {
            const active = !range.custom && range.days === p.days
            return (
              <button key={p.days}
                onClick={() => setRange({ days: p.days, start: '', end: '', custom: false })}
                aria-pressed={active}
                data-active={active}>
                {p.label}
              </button>
            )
          })}
          <button onClick={() => setRange(r => ({ ...r, custom: !r.custom }))}
            aria-pressed={range.custom}
            data-active={range.custom}>
            <Calendar size={12} className="inline-block -mt-px mr-1" aria-hidden="true" />Custom
          </button>
        </div>

        {range.custom && (
          <div className="flex items-center gap-1.5">
            <input type="date" aria-label="Range start" value={range.start}
              onChange={e => setRange(r => ({ ...r, start: e.target.value }))}
              className="neu-input text-xs py-1 px-2" />
            <span className="meta">to</span>
            <input type="date" aria-label="Range end" value={range.end}
              onChange={e => setRange(r => ({ ...r, end: e.target.value }))}
              className="neu-input text-xs py-1 px-2" />
          </div>
        )}
      </div>

      {/* ── Period summary ─── */}
      {/* One line — three stat tiles restated what the chart already plots. */}
      {!loading && !isEmpty && (
        <p className="text-xs text-text-secondary mb-2 flex flex-wrap gap-x-1.5 gap-y-0.5
          [@media(max-height:520px)]:hidden">
          <span><b className="font-semibold text-text-primary tabular-nums">{totalSold.toLocaleString()}</b> sold</span>
          <span className="text-text-muted">·</span>
          <span><b className="font-semibold text-text-primary tabular-nums">{fmtCurrency(totalRevenue)}</b></span>
          <span className="text-text-muted">·</span>
          <span className="text-text-muted tabular-nums">avg {avgDaily.toLocaleString()}/day</span>
          {/* Dropped on the shortest screens: it is the clause that wraps this
              summary onto a second line, and the peak is both plotted on the
              chart and called out in Analytics Overview. */}
          {peakDay && peakDay.sold_total > 0 && (
            <>
              <span className="text-text-muted [@media(max-height:520px)]:hidden">·</span>
              <span className="text-text-muted tabular-nums [@media(max-height:520px)]:hidden">
                peak {peakDay.sold_total.toLocaleString()} on {fmtDate(peakDay.date)}
              </span>
            </>
          )}
        </p>
      )}

      {/* ── Chart ─── */}
      {loading ? <ChartSkeleton /> : isEmpty ? (
        /* Takes the height of its own two lines and no more.
           It used to be `flex-1` inside a stretched card, so on a desktop an
           empty week rendered a ~650px panel containing one grey circle and a
           sentence — the single largest thing on the dashboard was the absence
           of data. Dashboard stops stretching this card when the range is
           empty, and the message sits at the top of it where the chart begins. */
        <EmptyState
          compact
          icon={Activity}
          title="No sales in this period"
          message="Sales recorded against this range will plot here."
        />
      ) : (
        /* Grows with the screen instead of sitting at one tall fixed height:
           on a 720px-tall laptop the 260px chart pushed the analytics panel
           fully below the fold, and it only has room to be that tall on a
           large monitor. And it keys off viewport *height*, not just width: the
           7" panel is 480px tall, where a 190px chart is 40% of the screen
           before the analytics panel gets a single pixel. */
        /* A floor, not a height: flex-1 lets the plot take every pixel the card
           has spare, so on a big screen it is large. The floor only binds when
           the pane is cramped, and it is deliberately low there — a short chart
           the operator can see all of beats a tall one whose bottom is off the
           screen. No tinted well behind it: the card it sits in is already
           --glass-bg, so the inner panel was an invisible box costing 16px. */
        <div className="chart-plot">
          <TrendChart data={chartData} />
        </div>
      )}

      {/* ── PNG export sheet ──
             Off-screen and only while exporting. Fixed 1200px wide so the image
             is the same shape whether it was taken from the 7" panel or a
             desktop, and laid out for reading as a document: what it is, the
             period it covers, the four figures, then the plot. ── */}
      {pngPending && (
        /* The off-screen positioning belongs on this wrapper, never on the node
           being captured: html-to-image copies the captured node's own computed
           style into its clone, so a `position: fixed; left: -10000px` on it
           travels into the image and shoves the content off the canvas — the
           export comes back as a blank rectangle of background. */
        <div aria-hidden style={{ position: 'fixed', left: '-10000px', top: 0, pointerEvents: 'none' }}>
        <div ref={exportRef}
          style={{
            width: 1200, padding: 32, borderRadius: 20,
            background: 'var(--glass-bg)', border: '1px solid var(--glass-border)',
          }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
                Sales Trend
              </div>
              <div style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 6 }}>
                {data.length > 0
                  ? `${fmtDateFull(data[0].date)} — ${fmtDateFull(data[data.length - 1].date)}`
                  : ''}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent-green)' }}>Kahariam Farms</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                {data.length} day{data.length === 1 ? '' : 's'} · exported {new Date().toLocaleDateString()}
              </div>
            </div>
          </div>

          <div style={{
            display: 'flex', gap: 48, margin: '24px 0 8px', paddingTop: 20,
            borderTop: '1px solid var(--glass-border)',
          }}>
            {[
              ['Total sold', `${totalSold.toLocaleString()} fish`],
              ['Revenue', fmtCurrency(totalRevenue)],
              ['Average per day', `${avgDaily.toLocaleString()} fish`],
              ['Peak', peakDay && peakDay.sold_total > 0
                ? `${peakDay.sold_total.toLocaleString()} on ${fmtDate(peakDay.date)}`
                : '—'],
            ].map(([label, value]) => (
              <div key={label}>
                <div style={{
                  fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
                  textTransform: 'uppercase', color: 'var(--text-muted)',
                }}>{label}</div>
                <div style={{
                  fontSize: 22, fontWeight: 700, marginTop: 4,
                  color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums',
                }}>{value}</div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 20, borderRadius: 14, padding: 8, background: 'var(--glass-bg)' }}>
            <TrendChart data={chartData} width={1120} height={400} animate={false} />
          </div>
        </div>
        </div>
      )}

      {/* ── Daily Breakdown Table ─── */}
      {/* `!isEmpty`, not `data.length > 0`: a range with no sales still returns
          a row per day, so the toggle used to open a table of seven zeros. An
          empty period has no breakdown, and saying so by not offering one costs
          ~30px of a 394px panel. */}
      {!loading && !isEmpty && (
        <details className="mt-2 group [@media(max-height:520px)]:hidden">
          <summary className="cursor-pointer list-none flex items-center gap-1.5 py-0.5 rounded-sm
            focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-green">
            <ChevronDown size={13} className="text-text-muted shrink-0 transition-transform duration-150 group-open:rotate-180" aria-hidden="true" />
            <span className="section-title">Daily breakdown</span>
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
