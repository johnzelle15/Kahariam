// Run: node --test frontend/src/utils/insights.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dedupeInsights, CATEGORY_PRIORITY, MAX_PER_CATEGORY } from './insights.js'

const r = (key, value) => ({ key, value, label: '', detail: '', type: 'neutral' })
const keys = list => list.map(i => i.value)

test('a repeated subject survives once, in the highest-priority category', () => {
  // The real case: under flat pricing the "revenue late-period decline" risk and
  // the "sales weak late-period" trend are the same number with a peso sign.
  const out = dedupeInsights({
    risks: [r('period-trend', 'risk-version')],
    performance: [],
    trends: [r('period-trend', 'trend-version')],
    opportunities: [r('period-trend', 'growth-version')],
  })
  assert.deepEqual(keys(out.risks), ['risk-version'])
  assert.deepEqual(keys(out.trends), [])
  assert.deepEqual(keys(out.opportunities), [])
})

test('risks outrank trends for the same day', () => {
  // "0 sales on Aug 19" (risk) and "+196% rebound after Aug 19 dip" (trend) are
  // one event. The one the operator has to act on is the one that stays.
  const out = dedupeInsights({
    risks: [r('day:2026-08-19', 'zero-sales')],
    trends: [r('day:2026-08-19', 'rebound')],
  })
  assert.deepEqual(keys(out.risks), ['zero-sales'])
  assert.deepEqual(keys(out.trends), [])
})

test('distinct subjects are all kept', () => {
  const out = dedupeInsights({
    performance: [r('peak', 'a'), r('period-total', 'b')],
    trends: [r('momentum', 'c'), r('volatility', 'd')],
  })
  assert.deepEqual(keys(out.performance), ['a', 'b'])
  assert.deepEqual(keys(out.trends), ['c', 'd'])
})

test('a reading with no key never collides', () => {
  const out = dedupeInsights({
    risks: [{ value: 'x' }, { value: 'y' }],
    trends: [{ value: 'z' }],
  })
  assert.deepEqual(keys(out.risks), ['x', 'y'])
  assert.deepEqual(keys(out.trends), ['z'])
})

test('each category is capped after dedupe, not before', () => {
  // Capping first would let a duplicate occupy one of the three slots and then
  // vanish, leaving a category showing two readings when it had four to give.
  const out = dedupeInsights({
    risks: [r('period-trend', 'dup')],
    trends: [r('period-trend', 'dup2'), r('a', '1'), r('b', '2'), r('c', '3'), r('d', '4')],
  })
  assert.equal(out.trends.length, MAX_PER_CATEGORY)
  assert.deepEqual(keys(out.trends), ['1', '2', '3'])
})

test('categories outside the priority list are still processed', () => {
  const out = dedupeInsights({ risks: [r('k', 'first')], extras: [r('k', 'dup'), r('j', 'kept')] })
  assert.deepEqual(keys(out.extras), ['kept'])
  assert.ok(CATEGORY_PRIORITY.every(c => c in out))
})

test('empty and missing input do not throw', () => {
  assert.deepEqual(dedupeInsights({}).risks, [])
  assert.deepEqual(dedupeInsights(null).trends, [])
})
