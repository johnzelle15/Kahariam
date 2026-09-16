/**
 * What the feed purchasing alert says.
 *
 * The server decides the status and counts the days on the Pi's clock
 * (backend/api/feed.py); this only puts it into words. Nothing here reads the
 * browser's clock, so a phone in another timezone, or one with the wrong date,
 * shows the same alert as the panel.
 */

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/** 'Sep 13', plus the year when it isn't `todayIso`'s. Built from the parts:
 *  new Date('2026-09-13') is UTC midnight, which is still the 12th anywhere
 *  west of Greenwich. */
export function formatDay(iso, todayIso = iso) {
  const [y, m, d] = String(iso).split('-').map(Number)
  const opts = { month: 'short', day: 'numeric' }
  if (String(todayIso).slice(0, 4) !== String(y)) opts.year = 'numeric'
  return new Date(y, m - 1, d).toLocaleDateString('en-US', opts)
}

/** An estimate, so whole pesos: ₱20,000. */
export const formatEstimate = n => `₱${Math.round(Number(n) || 0).toLocaleString('en-US')}`

/** { tone, label, detail } for a /feed/status payload. `tone` is one of the
 *  palette's meanings: positive, attention, negative, info. */
export function feedStatusView(s) {
  if (s.status === 'no_history') {
    return {
      tone: 'info',
      label: 'No feed purchases recorded',
      detail: `Record one to start the ${s.interval_days}-day reminder`,
    }
  }
  const days = s.days_remaining
  const estimate = `est. ${formatEstimate(s.estimated_amount)}`
  const expected = formatDay(s.next_purchase_on, s.today)
  switch (s.status) {
    case 'overdue':
      return {
        tone: 'negative',
        label: `Feed purchase overdue by ${plural(-days, 'day')}`,
        detail: [
          `expected ${expected}`,
          estimate,
          s.cycles_missed > 0 && `${plural(s.cycles_missed, 'purchase')} skipped`,
        ].filter(Boolean).join(' · '),
      }
    case 'due':
      return { tone: 'attention', label: 'Feed purchase due today', detail: estimate }
    case 'approaching':
      return { tone: 'attention', label: `Feed purchase due in ${plural(days, 'day')}`, detail: `${expected} · ${estimate}` }
    default:
      return { tone: 'positive', label: `Next feed purchase in ${plural(days, 'day')}`, detail: `${expected} · ${estimate}` }
  }
}
