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
