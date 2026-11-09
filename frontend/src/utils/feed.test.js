// Run: node --test frontend/src/utils/feed.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { feedStatusView, formatDay, formatEstimate } from './feed.js'

const status = (over) => ({
  today: '2026-09-15', interval_days: 14, warning_days: 3, estimated_amount: 20000,
  cycles_missed: 0, ...over,
})

test('each status has its own wording and tone', () => {
  assert.deepEqual(feedStatusView(status({ status: 'normal', days_remaining: 9, next_purchase_on: '2026-09-24' })),
    { tone: 'positive', label: 'Next feed purchase in 9 days', detail: 'Sep 24 · est. ₱20,000' })
  assert.deepEqual(feedStatusView(status({ status: 'approaching', days_remaining: 1, next_purchase_on: '2026-09-16' })),
    { tone: 'attention', label: 'Feed purchase due in 1 day', detail: 'Sep 16 · est. ₱20,000' })
  assert.deepEqual(feedStatusView(status({ status: 'due', days_remaining: 0, next_purchase_on: '2026-09-15' })),
    { tone: 'attention', label: 'Feed purchase due today', detail: 'est. ₱20,000' })
  assert.deepEqual(feedStatusView(status({ status: 'overdue', days_remaining: -1, next_purchase_on: '2026-09-14' })),
    { tone: 'negative', label: 'Feed purchase overdue by 1 day', detail: 'expected Sep 14 · est. ₱20,000' })
})

test('an overdue alert counts the purchases skipped', () => {
  const v = feedStatusView(status({ status: 'overdue', days_remaining: -30, next_purchase_on: '2026-08-16', cycles_missed: 2 }))
  assert.equal(v.label, 'Feed purchase overdue by 30 days')
  assert.equal(v.detail, 'expected Aug 16 · est. ₱20,000 · 2 purchases skipped')
})

test('no history asks for the first purchase', () => {
  const v = feedStatusView(status({ status: 'no_history', days_remaining: null, next_purchase_on: null }))
  assert.equal(v.tone, 'info')
  assert.equal(v.detail, 'Record one to start the 14-day reminder')
})

test('formatDay never shifts the day, and names the year only when it differs', () => {
  // Parsed from its parts, so no timezone can turn the 1st into the 31st.
  assert.equal(formatDay('2026-09-01', '2026-09-15'), 'Sep 1')
  assert.equal(formatDay('2026-12-31', '2027-01-02'), 'Dec 31, 2026')
})

test('formatEstimate rounds to whole pesos', () => {
  assert.equal(formatEstimate(20000), '₱20,000')
  assert.equal(formatEstimate(19999.6), '₱20,000')
})
