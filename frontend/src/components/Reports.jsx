import { cloneElement, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import * as XLSX from 'xlsx'
import {
  RefreshCw, Eye, AlertCircle, Coins, Boxes, ScrollText, ScanLine,
  FileText, FileSpreadsheet, FileDown,
} from 'lucide-react'
import { rawApi } from '../utils/api'
import useAuthStore from '../store/authStore'
import {
  REPORTS, PRESETS, GROUPS, TX_TYPES,
  presetRange, buildReport, formatCell, exportTable,
} from '../utils/reports'
import { formatPeso } from '../utils/revenue'
import { Button, PageHeader, SectionHeader, EmptyState, Metric, Modal, Skeleton, DateInput } from './ui'
import logoImg from '../assets/logo.svg'

const ICONS = { sales: Coins, stock: Boxes, transactions: ScrollText, sessions: ScanLine }

/* Each chart draws one series, so it needs no legend — the card's title names
   it. Fish sold keeps the sales trend's green. The accent tokens, not the
   status aliases: these colours say which series, not good or bad. */
const SERIES_COLOR = { sales: 'var(--accent-green)', stock: 'var(--accent-blue)' }

const EMPTY = {
  sales: ['No sales in this period', 'Sales recorded in Adjustments appear here.'],
  stock: ['No stock movements in this period', 'Saved counts, sales and deaths appear here.'],
  transactions: ['No records in this period', 'Saved counts, sales and deaths appear here.'],
  sessions: ['No counting sessions in this period', 'Sessions run on the Counter appear here.'],
}

/* What each format is for, said where the choice is made — the difference
   between them is the purpose, not the file extension. */
const FORMATS = [
  { id: 'pdf', label: 'PDF', icon: FileText, action: 'Print / save PDF',
    hint: 'Formatted report for printing or sharing. Opens the print dialog — choose “Save to PDF”.' },
  { id: 'xlsx', label: 'Excel', icon: FileSpreadsheet, action: 'Download Excel',
    hint: 'Summary and Data sheets with raw numbers, for further analysis.' },
  { id: 'csv', label: 'CSV', icon: FileDown, action: 'Download CSV',
    hint: 'The data table alone, for importing into other systems.' },
]

const NUMERIC = new Set(['int', 'peso', 'pct', 'duration'])
const BY = { day: 'by day', week: 'by week', month: 'by month' }

const longDay = iso => new Date(iso + 'T12:00:00')
  .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const periodText = (start, end) => (start && end ? `${longDay(start)} – ${longDay(end)}` : '')
const tickFmt = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n))

/* A period with nothing in it has no chart and no table worth drawing — seven
   rows of zeros say less than one sentence. The summary still shows, because
   "nothing sold" is itself the figure. */
function isEmpty(model) {
  const t = model.totals
  if (model.id === 'sales') return !t.sold
  if (model.id === 'stock') return !(t.in || t.sold || t.died)
  return model.rows.length === 0
}

function filterText(model, group, txType) {
  if (model.id === 'sales' || model.id === 'stock') return `Grouped ${BY[group]}`
  if (model.id === 'transactions') return TX_TYPES.find(t => t.id === txType)?.label || 'All types'
  return 'All sessions'
}

/* ─── Exports ─── */

/* The PDF is the browser's own print of the document in the preview, so what
   was previewed is exactly what is saved. Firefox's "Save to PDF" names the
   file after the page title, so the title carries the file name meanwhile. */
function printReport(file) {
  const previous = document.title
  document.title = file
  window.addEventListener('afterprint', () => { document.title = previous }, { once: true })
  window.print()
}

function downloadExcel(model, data, { filters, author, file }) {
  const summary = XLSX.utils.aoa_to_sheet([
    [`Kahariam Farms — ${model.title}`],
    ['Period', `${data.start_date} to ${data.end_date}`],
    ['Filters', filters],
    ['Generated', `${data.generated_at}${author ? ` by ${author}` : ''}`],
    ['Price per fish (PHP)', data.price_per_fish],
    [],
    ['Figure', 'Value', 'Note'],
    ...model.summary.map(s => [s.label, s.value, s.sub || '']),
  ])
  summary['!cols'] = [{ wch: 24 }, { wch: 22 }, { wch: 28 }]

  // Raw numbers, so the sheet can be summed and charted; money keeps two places.
  const table = exportTable(model)
  const sheet = XLSX.utils.aoa_to_sheet(table)
  sheet['!cols'] = model.columns.map(c => ({ wch: c.kind === 'text' || c.kind === 'datetime' ? 22 : 14 }))
  model.columns.forEach((c, col) => {
    if (c.kind !== 'peso') return
    for (let row = 1; row < table.length; row++) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: col })]
      if (cell?.t === 'n') cell.z = '#,##0.00'
    }
  })

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, summary, 'Summary')
  XLSX.utils.book_append_sheet(wb, sheet, 'Data')
  XLSX.writeFile(wb, `${file}.xlsx`)
}

function downloadCsv(model, file) {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(exportTable(model)), 'Data')
  XLSX.writeFile(wb, `${file}.csv`, { bookType: 'csv' })
}

/* ─── Chart ─── */

function ChartTooltip({ active, payload, chart }) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  const lines = [[chart.name, formatCell('int', row[chart.key])]]
  if (chart.detail) lines.push([chart.detail.name, formatCell(chart.detail.kind, row[chart.detail.key])])
  return (
    <div className="rounded-lg overflow-hidden"
      style={{ background: 'var(--tooltip-bg)', border: '1px solid var(--tooltip-border)', boxShadow: '0 6px 20px rgba(0,0,0,0.28)' }}>
      <p className="px-3 py-1.5 text-[11px] font-semibold text-text-primary" style={{ borderBottom: '1px solid var(--rule)' }}>
        {row.label}
      </p>
      <div className="px-3 py-2 space-y-1">
        {lines.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-6">
            <span className="text-[11px] text-text-muted">{label}</span>
            <span className="text-[11px] font-semibold tabular-nums text-text-primary">{value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* One definition, two callers: the page sizes it to its card, the printed sheet
   renders it at a fixed size with animation off — off-screen there is nothing
   for a ResponsiveContainer to measure. The marks are drawn in currentColor, so
   the same chart takes the app's theme on screen and the paper's light theme in
   the document. One axis, starting at zero: a bar or an area encodes its value
   as a length from the baseline. */
function ReportChart({ model, width, height, animate = true }) {
  const gradientId = `report-fill-${useId().replace(/:/g, '')}`
  const { chart, rows } = model
  const margin = { top: 8, right: 8, left: 0, bottom: 4 }
  // Solid hairlines: a dashed grid reads as a threshold or a projection.
  const grid = <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
  const xAxis = (
    <XAxis dataKey="tick" stroke="var(--chart-text)" fontSize={10} tickLine={false} axisLine={false}
      interval="preserveStartEnd" minTickGap={24} dy={6} />
  )
  const yAxis = (
    <YAxis stroke="var(--chart-text)" fontSize={10} tickLine={false} axisLine={false}
      tickFormatter={tickFmt} allowDecimals={false} width={44} domain={[0, 'auto']} />
  )
  const tooltip = animate && (
    <Tooltip content={<ChartTooltip chart={chart} />}
      cursor={chart.type === 'bar' ? { fill: 'var(--table-row-hover)' } : { stroke: 'var(--glass-border)', strokeWidth: 1 }} />
  )

  const plot = chart.type === 'bar' ? (
    <BarChart data={rows} margin={margin} barCategoryGap="20%">
      {grid}{xAxis}{yAxis}{tooltip}
      <Bar dataKey={chart.key} name={chart.name} fill="currentColor" radius={[4, 4, 0, 0]} maxBarSize={28}
        isAnimationActive={animate} animationDuration={450} />
    </BarChart>
  ) : (
    <AreaChart data={rows} margin={margin}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity={0.18} />
          <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
        </linearGradient>
      </defs>
      {grid}{xAxis}{yAxis}{tooltip}
      <Area type="linear" dataKey={chart.key} name={chart.name} stroke="currentColor" strokeWidth={2}
        fill={`url(#${gradientId})`} dot={false}
        activeDot={{ r: 4, fill: 'currentColor', stroke: 'var(--glass-bg)', strokeWidth: 2 }}
        isAnimationActive={animate} animationDuration={450} />
    </AreaChart>
  )

  if (width) return cloneElement(plot, { width, height })
  return <ResponsiveContainer width="100%" height="100%">{plot}</ResponsiveContainer>
}

/* ─── Table ─── */

function cellClass(column, index, paper) {
  if (NUMERIC.has(column.kind)) return '!text-right tabular-nums whitespace-nowrap'
  if (column.key === 'notes') return paper ? '' : 'max-w-[18rem] truncate'
  return index === 0 ? 'whitespace-nowrap text-text-primary' : 'whitespace-nowrap'
}

/* The same rows on screen and on paper; only the frame around them differs. */
function ReportTable({ model, className, paper = false }) {
  const { columns, rows, totals } = model
  return (
    <table className={className}>
      <caption className="sr-only">{model.title}</caption>
      <thead>
        <tr>
          {columns.map(c => (
            <th key={c.key} scope="col" className={NUMERIC.has(c.kind) ? '!text-right' : undefined}>{c.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.key}>
            {columns.map((c, i) => (
              <td key={c.key} className={cellClass(c, i, paper)}>{formatCell(c.kind, r[c.key])}</td>
            ))}
          </tr>
        ))}
      </tbody>
      {totals && (
        <tfoot>
          <tr>
            {columns.map((c, i) => (
              <td key={c.key} className={cellClass(c, i, paper)}>
                {totals[c.key] === undefined ? '' : formatCell(c.kind, totals[c.key])}
              </td>
            ))}
          </tr>
        </tfoot>
      )}
    </table>
  )
}

/* ─── The document ───
   The report as it is handed to someone: letterhead, what it covers, the
   figures, the chart and every row. `theme-light` re-declares the palette on
   this subtree, so it is dark ink on white paper whichever theme the app is in
   — on screen in the preview and, identically, in print. */
function ReportDocument({ model, data, filters, author, chartTitle, chartWidth }) {
  const generated = new Date(String(data.generated_at).replace(' ', 'T'))
    .toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
  return (
    <article className="report-paper theme-light">
      <header className="report-paper-head">
        <img src={logoImg} alt="" className="w-9 h-9 object-contain shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-bold text-text-primary leading-tight">Kahariam Farms</p>
          <p className="eyebrow">Fish Management</p>
        </div>
        <p className="meta ml-auto text-right">
          Generated {generated}
          {author && <><br />by {author}</>}
        </p>
      </header>

      <h2 className="text-lg font-bold tracking-tight text-text-primary">{model.title}</h2>
      <p className="text-text-secondary">{periodText(data.start_date, data.end_date)} · {filters}</p>

      <dl className="report-paper-figures">
        {model.summary.map(s => (
          <div key={s.label}>
            <dt className="eyebrow">{s.label}</dt>
            <dd className="text-base font-semibold text-text-primary">{s.value}</dd>
            {s.sub && <dd className="meta">{s.sub}</dd>}
          </div>
        ))}
      </dl>

      {model.chart && !isEmpty(model) && (
        <figure className="report-paper-chart" style={{ color: SERIES_COLOR[model.id] }}>
          <figcaption className="eyebrow mb-1">{chartTitle}</figcaption>
          <div style={{ height: 180 }}>
            <ReportChart model={model} width={chartWidth} height={chartWidth ? 180 : undefined} animate={false} />
          </div>
        </figure>
      )}

      {model.rows.length > 0
        ? <ReportTable model={model} paper />
        : <p className="meta">{EMPTY[model.id][0]}.</p>}

      <footer className="report-paper-foot meta">
        {model.id === 'sessions'
          ? 'Counts are the final figure of each counting session.'
          : `Sale values use ${formatPeso(data.price_per_fish)} per fish.`}
        {' '}Deleted records are excluded.
      </footer>
    </article>
  )
}

/* ════════════════════════════════════════════════════
   REPORTS
   ════════════════════════════════════════════════════ */
export default function Reports() {
  const author = useAuthStore(s => s.user?.fullname || s.user?.username)
  const [type, setType] = useState('sales')
  const [preset, setPreset] = useState('30d')
  const [range, setRange] = useState(() => presetRange('30d'))
  const [group, setGroup] = useState('day')
  const [txType, setTxType] = useState('')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [format, setFormat] = useState('pdf')
  const request = useRef(0)

  /* Only the latest request may land: stepping through presets quickly could
     otherwise let a slow earlier range overwrite the one on screen. */
  const load = useCallback(async () => {
    if (!range.start || !range.end) return
    const id = ++request.current
    setLoading(true)
    setError(false)
    try {
      const res = await rawApi.get('/api/reports/data', {
        params: { start_date: range.start, end_date: range.end },
      })
      if (id === request.current) setData(res.data)
    } catch {
      if (id === request.current) setError(true)
    } finally {
      if (id === request.current) setLoading(false)
    }
  }, [range.start, range.end])

  useEffect(() => { load() }, [load])

  const model = useMemo(
    () => (data ? buildReport(type, data, { group, txType }) : null),
    [type, data, group, txType])
  const meta = REPORTS.find(r => r.id === type)
  const filters = model ? filterText(model, group, txType) : ''
  const chartTitle = model?.chart ? `${model.chart.name} ${BY[group]}` : ''
  const fmt = FORMATS.find(f => f.id === format)
  const file = data ? `kahariam-${type}-${data.start_date}_${data.end_date}` : 'kahariam-report'
  // Stable, so the dialog doesn't re-run its focus handling on every render.
  const closePreview = useCallback(() => setPreviewing(false), [])

  function pickPreset(p) {
    setPreset(p.id)
    setRange(presetRange(p.id))
    setGroup(p.group)
  }

  function pickDate(key, value) {
    setPreset(null)
    setRange(r => ({ ...r, [key]: value }))
  }

  function runExport() {
    if (!model) return
    if (format === 'pdf') printReport(file)
    else if (format === 'xlsx') downloadExcel(model, data, { filters, author, file })
    else downloadCsv(model, file)
  }

  const docProps = model && { model, data, filters, author, chartTitle }

  return (
    <div className="flex flex-col gap-section max-w-5xl">
      <PageHeader
        title="Reports"
        meta={periodText(range.start, range.end)}
        actions={
          <>
            <Button variant="secondary" size="sm" icon={RefreshCw} onClick={load} disabled={loading}>
              Refresh
            </Button>
            <Button size="sm" icon={Eye} onClick={() => setPreviewing(true)} disabled={!model}>
              Preview &amp; export
            </Button>
          </>
        }
      />

      {/* ── Which report, over which period: one panel ── */}
      <section aria-label="Report options" className="glass-card overflow-hidden">
        <div className="tabs flex-wrap pl-[calc(var(--pad-card)_-_0.625rem)]" role="tablist" aria-label="Report type">
          {REPORTS.map((r, i) => {
            const Icon = ICONS[r.id]
            const active = r.id === type
            return (
              <button
                key={r.id}
                id={`report-tab-${r.id}`}
                role="tab"
                type="button"
                aria-selected={active}
                aria-controls="report-panel"
                tabIndex={active ? 0 : -1}
                onClick={() => setType(r.id)}
                onKeyDown={e => {
                  const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
                  if (!step) return
                  e.preventDefault()
                  const next = REPORTS[(i + step + REPORTS.length) % REPORTS.length]
                  setType(next.id)
                  document.getElementById(`report-tab-${next.id}`)?.focus()
                }}
                className="tab"
              >
                <Icon size={14} aria-hidden="true" />
                {r.label}
              </button>
            )
          })}
        </div>

        {/* Controls wrap onto further lines rather than pushing the panel wider
            than the page — the period presets included. */}
        <div className="card-pad flex flex-wrap items-center gap-2">
          <div className="segmented flex-wrap max-w-full" role="group" aria-label="Period">
            {PRESETS.map(p => (
              <button key={p.id} type="button" onClick={() => pickPreset(p)}
                aria-pressed={preset === p.id} data-active={preset === p.id}>
                {p.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2 flex-[1_1_17rem]">
            <DateInput label="From" inset="pl-10" value={range.start} max={range.end}
              onChange={v => pickDate('start', v)} />
            <DateInput label="To" inset="pl-6" value={range.end} min={range.start}
              onChange={v => pickDate('end', v)} />
          </div>

          {meta.grouped && (
            <div className="segmented" role="group" aria-label="Group by">
              {GROUPS.map(g => (
                <button key={g.id} type="button" onClick={() => setGroup(g.id)}
                  aria-pressed={group === g.id} data-active={group === g.id}>
                  {g.label}
                </button>
              ))}
            </div>
          )}

          {type === 'transactions' && (
            <select aria-label="Record type" value={txType} onChange={e => setTxType(e.target.value)}
              className="neu-input flex-none py-1.5 text-[13px]">
              {TX_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          )}
        </div>
      </section>

      <div id="report-panel" role="tabpanel" aria-labelledby={`report-tab-${type}`} aria-busy={loading}
        className={`flex flex-col gap-section transition-opacity duration-150 ${loading && model ? 'opacity-60' : ''}`}>
        {error ? (
          <section className="glass-card px-[var(--pad-card)]">
            <EmptyState compact icon={AlertCircle} title="Couldn't load the report"
              message="Check the connection to the server, then try again."
              actionLabel="Try again" onAction={load} />
          </section>
        ) : !model ? (
          <div className="flex flex-col gap-section" aria-hidden="true">
            <Skeleton height={64} />
            <Skeleton height={180} />
          </div>
        ) : (
          <>
            {/* Five figures: two rows of two on a phone with the last one
                across the width, one row from md — the 7" panel included. */}
            <div className="strip strip-compact grid-cols-2 md:grid-cols-5
              [&>*:last-child]:col-span-2 md:[&>*:last-child]:col-span-1">
              {model.summary.map(s => (
                <Metric key={s.label} label={s.label} value={s.value} sub={s.sub} tone={s.tone} />
              ))}
            </div>

            {isEmpty(model) ? (
              <section className="glass-card px-[var(--pad-card)]">
                <EmptyState compact icon={ICONS[type]} title={EMPTY[type][0]} message={EMPTY[type][1]} />
              </section>
            ) : (
              <>
                {model.chart && (
                  <section aria-label={chartTitle} className="glass-card card-pad">
                    <SectionHeader className="mb-2" title={chartTitle}
                      meta={periodText(data.start_date, data.end_date)} />
                    <div className="report-chart" style={{ color: SERIES_COLOR[type] }}
                      role="img" aria-label={`${chartTitle}. Every value is listed in the table below.`}>
                      <ReportChart model={model} />
                    </div>
                  </section>
                )}

                {/* The rows scroll inside their own box, header and totals
                    pinned, so a long log never lengthens the page past them. */}
                <section aria-label="Report details" className="glass-card overflow-hidden">
                  <SectionHeader className="card-pad" title="Details"
                    meta={`${model.rows.length.toLocaleString()} row${model.rows.length === 1 ? '' : 's'}`} />
                  <div className="report-scroll border-t border-rule">
                    <ReportTable model={model} className="dark-table ledger report-table" />
                  </div>
                </section>
              </>
            )}
          </>
        )}
      </div>

      {/* ── Preview & export ──
             The document exactly as it will be saved, with the format choice
             pinned beneath it. */}
      <Modal open={previewing} onClose={closePreview} title={`Preview — ${meta.title}`} size="xl"
        footer={model && (
          <div className="flex flex-wrap items-center gap-2 w-full">
            <div className="segmented" role="group" aria-label="Export format">
              {FORMATS.map(f => (
                <button key={f.id} type="button" onClick={() => setFormat(f.id)}
                  aria-pressed={format === f.id} data-active={format === f.id}>
                  {f.label}
                </button>
              ))}
            </div>
            <p className="meta flex-1 min-w-[12rem] [@media(max-height:520px)]:hidden">{fmt.hint}</p>
            <Button size="sm" icon={fmt.icon} onClick={runExport} className="ml-auto">{fmt.action}</Button>
          </div>
        )}>
        {model && <ReportDocument {...docProps} />}
      </Modal>

      {/* The copy the printer sees. It lives outside the app root, so the print
          stylesheet can hide everything else; the dialog's copy is clipped by
          its own scroll box and could never print whole. */}
      {previewing && model && createPortal(
        <div className="print-root"><ReportDocument {...docProps} chartWidth={700} /></div>,
        document.body,
      )}
    </div>
  )
}
