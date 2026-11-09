/**
 * One event, one bullet.
 *
 * The dashboard's insight engine can derive a dozen readings from a fortnight
 * of data, and several of them are the same fact seen from another angle. Under
 * a flat price per fish, a revenue trend and a unit trend are arithmetically
 * the same number; the day sales stopped is also the biggest drop and the dip a
 * later rebound is measured from; a growth "opportunity" is the period trend
 * with an imperative attached.
 *
 * Printing each of those separately is what made the panel read as generated
 * rather than written — four bullets, one thing happening. Every reading
 * carries a `key` naming its subject, and this pass keeps the first appearance
 * of each.
 */

/** Categories in the order a collision is resolved. Risks come first: when two
 *  categories describe the same event, the operational reading is the one worth
 *  the space. */
export const CATEGORY_PRIORITY = ['risks', 'performance', 'trends', 'opportunities']

/** Most readings a single category may show. */
export const MAX_PER_CATEGORY = 3

/**
 * Drop repeated subjects and cap each category. Mutates nothing; returns a new
 * object with the same category keys.
 *
 * A reading with no `key` is always kept — it has declared no subject, so
 * nothing can collide with it.
 */
export function dedupeInsights(insights) {
  const seen = new Set()
  const out = {}
  const categories = new Set([...CATEGORY_PRIORITY, ...Object.keys(insights || {})])

  categories.forEach(cat => {
    const items = (insights && insights[cat]) || []
    out[cat] = items
      .filter(i => {
        if (!i || !i.key) return true
        if (seen.has(i.key)) return false
        seen.add(i.key)
        return true
      })
      .slice(0, MAX_PER_CATEGORY)
  })

  return out
}
