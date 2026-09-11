/**
 * The Reports tab, built in the browser from one payload.
 *
 * /api/reports/data returns the stock on hand before the range plus every
 * inventory row and counting session inside it. Each report is a view of that
 * payload, returned as one model — columns, rows, totals, summary figures and a
 * chart spec. The on-screen table, the printable document, the workbook and the
 * CSV are all drawn from the model, so an export cannot disagree with the
 * screen it was taken from.
 *
 * Rows are classified by getRecordType, the rule the Inventory ledger uses: a
 * death is never a sale, and a legacy TANK_IN row is stock counted in.
 */
import { isoDay, startOfWeek, startOfMonth, formatPeso } from './revenue.js'
import { getRecordType, getNoteDisplay, MOVEMENT, formatRecordDate } from './notes.js'

export const REPORTS = [
  { id: 'sales',        label: 'Sales & revenue',   title: 'Sales & Revenue Report',   grouped: true },
  { id: 'stock',        label: 'Stock movement',    title: 'Stock Movement Report',    grouped: true },
  { id: 'transactions', label: 'Transactions',      title: 'Transaction Log',          grouped: false },
  { id: 'sessions',     label: 'Counting sessions', title: 'Counting Sessions Report', grouped: false },
]

/* Each preset carries the grouping that reads best for it: a year of daily
   bars is 250 slivers, twelve months is a chart. */
export const PRESETS = [
  { id: '7d',         label: '7D',         group: 'day' },
  { id: '30d',        label: '30D',        group: 'day' },
  { id: 'month',      label: 'This month', group: 'day' },
  { id: 'last-month', label: 'Last month', group: 'day' },
  { id: 'year',       label: 'This year',  group: 'month' },
]

export const GROUPS = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
]

export const TX_TYPES = [
  { id: '', label: 'All types' },
  { id: 'WHOLESALE_IN', label: MOVEMENT.WHOLESALE_IN.label },
  { id: 'SOLD', label: MOVEMENT.SOLD.label },
  { id: 'DIED', label: MOVEMENT.DIED.label },
]

const PERIOD_HEAD = { day: 'Date', week: 'Week', month: 'Month' }

const STATUS = { saved: 'Saved', completed: 'Completed', aborted: MOVEMENT.ABORTED.label, active: 'In progress' }

/** Local noon on an ISO day, so no timezone can move it onto another date. */
const toDate = iso => new Date(String(iso).slice(0, 10) + 'T12:00:00')

/** { start, end } ISO days for a preset. Last month ends on its own last day. */
export function presetRange(id, today = new Date()) {
  const y = today.getFullYear(), m = today.getMonth(), d = today.getDate()
  const end = isoDay(today)
  switch (id) {
    case '7d':         return { start: isoDay(new Date(y, m, d - 6)), end }
    case '30d':        return { start: isoDay(new Date(y, m, d - 29)), end }
    case 'month':      return { start: isoDay(startOfMonth(today)), end }
    case 'last-month': return { start: isoDay(new Date(y, m - 1, 1)), end: isoDay(new Date(y, m, 0)) }
    case 'year':       return { start: isoDay(new Date(y, 0, 1)), end }
    default:           return null
  }
}

/** The period a timestamp falls in: its day, the Monday of its week, or its month. */
export function bucketKey(iso, group) {
  const day = String(iso).slice(0, 10)
  if (group === 'month') return day.slice(0, 7)
  if (group === 'week') return isoDay(startOfWeek(toDate(day)))
  return day
}

/** Every period from start to end in order, the empty ones included. */
export function periodsBetween(start, end, group) {
  const out = []
  for (let d = toDate(start), last = toDate(end); d <= last; d.setDate(d.getDate() + 1)) {
    const key = bucketKey(isoDay(d), group)
    if (out[out.length - 1] !== key) out.push(key)
  }
  return out
}

function periodLabel(key, group) {
  if (group === 'month') return toDate(key + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const day = toDate(key).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return group === 'week' ? `Week of ${day}` : day
}

function periodTick(key, group) {
  if (group === 'month') return toDate(key + '-01').toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
  return toDate(key).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Whole minutes between two stored timestamps, or null while one is missing. */
function minutesBetween(from, to) {
  if (!from || !to) return null
  const ms = new Date(String(to).replace(' ', 'T')) - new Date(String(from).replace(' ', 'T'))
  return Number.isFinite(ms) ? Math.round(ms / 60000) : null
}

/** The one way a report value is written, in the table and on paper alike. */
export function formatCell(kind, v) {
  if (v == null || v === '') return '—'
  switch (kind) {
    case 'int':      return Number(v).toLocaleString('en-US')
    case 'peso':     return formatPeso(v)
    case 'pct':      return `${(v * 100).toFixed(1)}%`
    case 'datetime': return formatRecordDate(String(v).replace(' ', 'T'))
    case 'duration': return v >= 60 ? `${Math.floor(v / 60)} h ${String(v % 60).padStart(2, '0')} min` : `${v} min`
    default:         return String(v)
  }
}

const int = v => formatCell('int', v)
const sum = (rows, key) => rows.reduce((s, r) => s + (Number(r[key]) || 0), 0)
const round2 = n => Math.round(n * 100) / 100

/** One row per period, keyed for the records to be dropped into. */
function periodRows(data, group, blank) {
  const list = periodsBetween(data.start_date, data.end_date, group).map(key => ({
    key, label: periodLabel(key, group), tick: periodTick(key, group), ...blank(),
  }))
  return { list, at: new Map(list.map(r => [r.key, r])) }
}

function sales({ data, records, price, group }) {
  const { list: rows, at } = periodRows(data, group, () => ({ orders: 0, sold: 0, revenue: 0 }))
  for (const r of records) {
    const row = r.type === 'SOLD' && at.get(bucketKey(r.date, group))
    if (row) { row.orders += 1; row.sold += r.count }
  }
  rows.forEach(r => { r.revenue = round2(r.sold * price) })

  const totals = { label: 'Total', orders: sum(rows, 'orders'), sold: sum(rows, 'sold') }
  totals.revenue = round2(totals.sold * price)
  const days = periodsBetween(data.start_date, data.end_date, 'day').length || 1
  const best = rows.reduce((b, r) => (r.sold > (b?.sold || 0) ? r : b), null)

  return {
    columns: [
      { key: 'label', label: PERIOD_HEAD[group], kind: 'text' },
      { key: 'orders', label: 'Orders', kind: 'int' },
      { key: 'sold', label: 'Fish sold', kind: 'int' },
      { key: 'revenue', label: 'Revenue', kind: 'peso' },
    ],
    rows,
    totals,
    summary: [
      { label: 'Fish sold', value: int(totals.sold) },
      { label: 'Revenue', value: formatPeso(totals.revenue), sub: `at ${formatPeso(price)} per fish` },
      { label: 'Orders', value: int(totals.orders) },
      { label: 'Average per day', value: int(Math.round(totals.sold / days)) },
      { label: `Best ${group}`, value: best ? int(best.sold) : '—', sub: best?.label },
    ],
    chart: { type: 'bar', key: 'sold', name: 'Fish sold', detail: { key: 'revenue', name: 'Revenue', kind: 'peso' } },
  }
}

function stock({ data, records, group }) {
  const { list: rows, at } = periodRows(data, group, () => ({ opening: 0, in: 0, sold: 0, died: 0, closing: 0 }))
  for (const r of records) {
    const row = at.get(bucketKey(r.date, group))
    if (!row) continue
    if (r.type === 'SOLD') row.sold += r.count
    else if (r.type === 'DIED') row.died += r.count
    else if (r.type === 'WHOLESALE_IN') row.in += r.count
  }
  let running = Number(data.opening_stock) || 0
  for (const row of rows) {
    row.opening = running
    running += row.in - row.sold - row.died
    row.closing = running
  }

  const totals = {
    label: 'Total', opening: rows[0]?.opening ?? running,
    in: sum(rows, 'in'), sold: sum(rows, 'sold'), died: sum(rows, 'died'), closing: running,
  }
  const base = totals.opening + totals.in
  const mortality = base > 0 ? totals.died / base : null

  return {
    columns: [
      { key: 'label', label: PERIOD_HEAD[group], kind: 'text' },
      { key: 'opening', label: 'Opening', kind: 'int' },
      { key: 'in', label: 'Counted in', kind: 'int' },
      { key: 'sold', label: 'Sold', kind: 'int' },
      { key: 'died', label: 'Died', kind: 'int' },
      { key: 'closing', label: 'Closing', kind: 'int' },
    ],
    rows,
    totals,
    summary: [
      { label: 'Opening stock', value: int(totals.opening) },
      { label: 'Counted in', value: int(totals.in) },
      { label: 'Sold', value: int(totals.sold) },
      {
        label: 'Died', value: int(totals.died),
        sub: mortality == null ? undefined : `${formatCell('pct', mortality)} mortality`,
        tone: totals.died > 0 ? 'warning' : undefined,
      },
      { label: 'Closing stock', value: int(totals.closing) },
    ],
    chart: { type: 'area', key: 'closing', name: 'Closing stock' },
  }
}

function transactions({ records, price, txType }) {
  const rows = records.filter(r => !txType || r.type === txType).map(r => {
    const note = getNoteDisplay(r.notes, r.action)
    return {
      key: r.id,
      date: r.date,
      type: (MOVEMENT[r.type] || MOVEMENT.UNKNOWN).label,
      fish: r.count,
      amount: r.type === 'SOLD' ? round2(r.count * price) : null,
      notes: note.isFallback ? '' : note.text,
    }
  })
  const fishOf = type => records.reduce((s, r) => (r.type === type ? s + r.count : s), 0)
  const sold = fishOf('SOLD')
  const amounts = rows.filter(r => r.amount != null)

  return {
    columns: [
      { key: 'date', label: 'Date & time', kind: 'datetime' },
      { key: 'type', label: 'Type', kind: 'text' },
      { key: 'fish', label: 'Fish', kind: 'int' },
      { key: 'amount', label: 'Amount', kind: 'peso' },
      { key: 'notes', label: 'Notes', kind: 'text' },
    ],
    rows,
    // Fish of different kinds don't add up to anything, so the column only
    // totals once the log is narrowed to one type.
    totals: { date: 'Total', fish: txType ? sum(rows, 'fish') : null, amount: amounts.length ? round2(sum(amounts, 'amount')) : null },
    summary: [
      { label: 'Records', value: int(rows.length) },
      { label: 'Counted in', value: int(fishOf('WHOLESALE_IN')) },
      { label: 'Sold', value: int(sold) },
      { label: 'Died', value: int(fishOf('DIED')), tone: fishOf('DIED') > 0 ? 'warning' : undefined },
      { label: 'Sales value', value: formatPeso(round2(sold * price)) },
    ],
    chart: null,
  }
}

function sessions({ data }) {
  const list = data.sessions || []
  const rows = list.map(s => ({
    key: s.id,
    started: s.started_at,
    operator: s.username || '',
    duration: minutesBetween(s.started_at, s.ended_at),
    count: s.final_count == null ? null : Number(s.final_count),
    status: STATUS[s.status] || s.status,
  }))
  const timed = rows.filter(r => r.duration != null)
  const withStatus = status => list.filter(s => s.status === status).length

  return {
    columns: [
      { key: 'started', label: 'Started', kind: 'datetime' },
      { key: 'operator', label: 'Operator', kind: 'text' },
      { key: 'duration', label: 'Duration', kind: 'duration' },
      { key: 'count', label: 'Count', kind: 'int' },
      { key: 'status', label: 'Status', kind: 'text' },
    ],
    rows,
    totals: { started: 'Total', count: sum(rows, 'count') },
    summary: [
      { label: 'Sessions', value: int(rows.length) },
      { label: 'Fish counted', value: int(sum(rows, 'count')) },
      { label: 'Saved', value: int(withStatus('saved')) },
      { label: STATUS.aborted, value: int(withStatus('aborted')) },
      {
        label: 'Avg duration',
        value: timed.length ? formatCell('duration', Math.round(sum(timed, 'duration') / timed.length)) : '—',
      },
    ],
    chart: null,
  }
}

const BUILDERS = { sales, stock, transactions, sessions }

const UNIT = { peso: 'PHP', duration: 'min' }

/** The model as spreadsheet rows: headers that name their units, raw values
 *  rather than display strings — so the sheet can be summed — and the totals
 *  as the last row. */
export function exportTable(model) {
  const head = model.columns.map(c => (UNIT[c.kind] ? `${c.label} (${UNIT[c.kind]})` : c.label))
  const line = row => model.columns.map(c => row[c.key] ?? '')
  return [head, ...model.rows.map(line), ...(model.totals ? [line(model.totals)] : [])]
}

/**
 * The model for one report over one payload.
 * `group` is day | week | month (sales, stock); `txType` narrows the log.
 */
export function buildReport(type, data, { group = 'day', txType = '' } = {}) {
  const meta = REPORTS.find(r => r.id === type)
  const records = (data.records || []).map(r => ({
    ...r, type: getRecordType(r), count: Math.abs(Number(r.count) || 0),
  }))
  return {
    id: type,
    title: meta.title,
    ...BUILDERS[type]({ data, records, price: Number(data.price_per_fish) || 0, group, txType }),
  }
}
