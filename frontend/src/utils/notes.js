const GENERIC_NOTES = new Set([
  'saved from react',
  'saved from react (wholesale)',
  'saved from react (tank)',
  '',
])

/**
 * Returns the display label for a note field.
 * If the note is meaningful, returns it as-is.
 * If empty or generic, returns a contextual fallback based on action type.
 */
export function getNoteDisplay(notes, action) {
  const trimmed = (notes || '').trim()
  const isGeneric = GENERIC_NOTES.has(trimmed.toLowerCase())

  if (trimmed && !isGeneric) {
    return { text: trimmed, isFallback: false }
  }

  const upper = (action || '').toUpperCase()
  let fallback = 'General'
  if (upper === 'IN') fallback = 'Tank'
  else if (upper === 'WHOLESALE') fallback = 'Wholesale'
  else if (upper === 'OUT') fallback = 'Sold'

  return { text: fallback, isFallback: true }
}

/**
 * Classify an inventory row into a movement type: WHOLESALE_IN | SOLD | DIED.
 *
 * Single source of truth — the dashboard activity list and the inventory ledger
 * must never disagree about what a row is. Rows from /get_statistics carry no
 * transaction_type, so the action + sign + notes fallback is the common path.
 */
export function getRecordType(record) {
  const tt = (record?.transaction_type || '').toUpperCase()
  if (tt) {
    if (tt === 'WHOLESALE_SOLD') return 'SOLD'
    if (tt === 'TANK_IN') return 'WHOLESALE_IN'
    return tt
  }
  const action = (record?.action || '').toUpperCase()
  const notes = (record?.notes || '').toLowerCase()
  if (action === 'OUT' && notes.startsWith('died')) return 'DIED'
  if (action === 'OUT') return 'SOLD'
  if (action === 'IN') return 'WHOLESALE_IN'
  if (action === 'WHOLESALE' || action === 'INVENTORY') {
    return Number(record?.count) < 0 ? 'SOLD' : 'WHOLESALE_IN'
  }
  return action || 'UNKNOWN'
}

/* The word and colour for each movement type, wherever a row is shown — the
   other half of "never disagree about what a row is". */
export const MOVEMENT = {
  WHOLESALE_IN: { label: 'Counted', text: 'text-positive' },
  SOLD:         { label: 'Sold',    text: 'text-info' },
  DIED:         { label: 'Died',    text: 'text-negative' },
  UNKNOWN:      { label: 'Moved',   text: 'text-text-muted' },
  ABORTED:      { label: 'Stopped', text: 'text-text-muted' },
}

/* "Aug 24, 2:00 PM". The year only when it isn't this one, and hour:'numeric'
   drops the leading zero, so the stamp stays short enough for a phone row. */
export function formatRecordDate(value) {
  if (!value) return 'N/A'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  const opts = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
  if (date.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric'
  return date.toLocaleDateString('en-US', opts)
}
