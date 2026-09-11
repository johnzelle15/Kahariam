/**
 * Stock health, expressed as days of cover rather than absolute units.
 *
 * The previous alert model used fixed thresholds (critical <= 15, warning <= 30)
 * which can never fire on a farm whose orders run to tens of thousands of fish.
 * Days of cover — stock divided by how fast stock is actually leaving — reads the
 * same at 300 fish and at 300,000, so it needs no recalibration as the farm grows.
 */

/** Average units sold per day across the last `days` entries of a daily-trend series. */
export function avgDailyOutflow(dailyData, days = 7) {
  const recent = (dailyData || []).slice(-days)
  if (recent.length === 0) return 0
  const total = recent.reduce((sum, d) => sum + (Number(d?.sold_total) || 0), 0)
  return total / recent.length
}

/**
 * Days of stock remaining at the recent outflow rate.
 * Returns null when nothing is moving — cover is undefined, not infinite.
 */
export function daysOfCover(stock, rate) {
  const r = Number(rate) || 0
  if (r <= 0) return null
  return (Number(stock) || 0) / r
}

export const COVER_CRITICAL = 7
export const COVER_WARNING = 21

/** 'critical' | 'warning' | 'ok' — out of stock is critical whether or not anything is selling. */
export function stockStatus(stock, cover) {
  if ((Number(stock) || 0) <= 0) return 'critical'
  if (cover === null) return 'ok'
  if (cover <= COVER_CRITICAL) return 'critical'
  if (cover <= COVER_WARNING) return 'warning'
  return 'ok'
}

/** Short human label for the stock tile, e.g. "43 days of cover". */
export function coverLabel(cover) {
  if (cover === null) return 'No recent sales'
  if (cover < 1) return 'Under a day of cover'
  return `${Math.round(cover).toLocaleString()} day${Math.round(cover) === 1 ? '' : 's'} of cover`
}
