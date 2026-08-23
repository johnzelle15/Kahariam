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
