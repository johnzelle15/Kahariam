/**
 * Revenue Overview figures, derived entirely from data the app already serves.
 *
 * Two sources, no new ones:
 *   • /api/daily-trend  — one { date, sold_total, revenue } row per day for any
 *     requested range. Today / this week / this month are windows over that.
 *   • /get_statistics   — global.total_revenue and global.sales_count, which are
 *     lifetime figures the endpoint already computes from the same sale
 *     predicate. Total Sales and Average Sale are those two.
 *
 * Nothing here invents a figure. A period with no recorded sales returns 0,
 * which is a fact about the farm; Average Sale with no sales at all returns
 * null, which is the absence of one, and the card is expected to say so rather
 * than print ₱0.00 as though an average existed.
 */

/** Local YYYY-MM-DD. `toISOString()` is UTC and lands on the wrong day for the
 *  first/last hours of a Philippine day, which is exactly when a farm closing
 *  its books would be reading these numbers. */
export function isoDay(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Monday of the week containing `date`. */
export function startOfWeek(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const shift = (d.getDay() + 6) % 7 // Sun=0 -> 6, Mon=1 -> 0
  d.setDate(d.getDate() - shift)
  return d
}

/** First of the month containing `date`. */
export function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

/**
 * The single date range that covers every window the cards need.
 *
 * One fetch, not three. Early in a month the current week starts in the
 * previous one — on the 1st of a month falling on a Wednesday, month-to-date is
 * one day and the week reaches back five more — so the range starts at
 * whichever of the two is earlier.
 */
export function revenueWindow(today = new Date()) {
  const week = startOfWeek(today)
  const month = startOfMonth(today)
  return {
    start: isoDay(week < month ? week : month),
    end: isoDay(today),
    weekStart: isoDay(week),
    monthStart: isoDay(month),
  }
}

const sumRevenue = (rows, from) =>
  rows.reduce((s, r) => (r.date >= from ? s + (Number(r.revenue) || 0) : s), 0)

/**
 * Period totals from a daily-trend series.
 *
 * `rows` must span at least `revenueWindow().start`; anything earlier is simply
 * excluded by the date comparisons, so passing a longer series is harmless.
 */
export function periodRevenue(rows, today = new Date()) {
  const w = revenueWindow(today)
  const series = Array.isArray(rows) ? rows : []
  const todayRow = series.find(r => r.date === w.end)
  return {
    today: Number(todayRow?.revenue) || 0,
    week: sumRevenue(series, w.weekStart),
    month: sumRevenue(series, w.monthStart),
    weekStart: w.weekStart,
    monthStart: w.monthStart,
  }
}

/** Lifetime revenue divided by the number of recorded sales. Null when there
 *  are none — an average of nothing is not zero. */
export function averageSale(totalRevenue, salesCount) {
  const n = Number(salesCount) || 0
  if (n <= 0) return null
  return (Number(totalRevenue) || 0) / n
}

/** Peso, always two decimals. The one definition — Dashboard and SalesTrend
 *  each had their own, and they disagreed on the fallback. */
export function formatPeso(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '₱0.00'
  return '₱' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Compact peso for a figure that has to fit a 120px-wide cell on the panel:
 *  ₱4.0M, ₱25.2K. Full precision stays in the tooltip and the detail dialog. */
export function formatPesoShort(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '₱0'
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `₱${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`
  if (abs >= 10_000) return `₱${(n / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}K`
  return formatPeso(n)
}

/** "8–10 Sep" / "1–10 Sep" / "Sep 10" — the range a card's figure covers. */
export function rangeLabel(fromIso, toIso) {
  if (!fromIso || !toIso) return ''
  const from = new Date(fromIso + 'T00:00:00')
  const to = new Date(toIso + 'T00:00:00')
  const mon = d => d.toLocaleDateString('en-US', { month: 'short' })
  if (fromIso === toIso) return `${mon(to)} ${to.getDate()}`
  if (from.getMonth() === to.getMonth()) return `${from.getDate()}–${to.getDate()} ${mon(to)}`
  return `${from.getDate()} ${mon(from)} – ${to.getDate()} ${mon(to)}`
}
