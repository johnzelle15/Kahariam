// Run: node --test frontend/src/utils/stock.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { avgDailyOutflow, daysOfCover, stockStatus, coverLabel } from './stock.js'

const series = n => Array.from({ length: n }, (_, i) => ({ sold_total: (i + 1) * 100 }))

test('avgDailyOutflow averages only the trailing window', () => {
  // 10 days of 100..1000; last 7 are 400..1000, mean 700
  assert.equal(avgDailyOutflow(series(10), 7), 700)
  assert.equal(avgDailyOutflow(series(3), 7), 200) // fewer days than the window
  assert.equal(avgDailyOutflow([], 7), 0)
  assert.equal(avgDailyOutflow(null, 7), 0)
})

test('avgDailyOutflow tolerates missing and non-numeric values', () => {
  assert.equal(avgDailyOutflow([{ sold_total: 100 }, {}, { sold_total: null }, { sold_total: '300' }], 4), 100)
})

test('daysOfCover divides stock by rate, and is null when nothing moves', () => {
  assert.equal(daysOfCover(70000, 1000), 70)
  assert.equal(daysOfCover(0, 1000), 0)
  assert.equal(daysOfCover(70000, 0), null)
  assert.equal(daysOfCover(70000, -5), null)
})

test('stockStatus classifies on cover, not absolute units', () => {
  // The bug this replaces: 20,000 fish selling 4,000/day is 5 days of cover and
  // must read critical, while the old model called anything over 30 units healthy.
  assert.equal(stockStatus(20000, daysOfCover(20000, 4000)), 'critical')
  assert.equal(stockStatus(60000, daysOfCover(60000, 4000)), 'warning')
  assert.equal(stockStatus(400000, daysOfCover(400000, 4000)), 'ok')
})

test('stockStatus treats empty stock as critical even with no sales', () => {
  assert.equal(stockStatus(0, null), 'critical')
  assert.equal(stockStatus(-10, null), 'critical')
  assert.equal(stockStatus(5000, null), 'ok') // stock on hand, nothing selling
})

test('stockStatus is inclusive at both boundaries', () => {
  assert.equal(stockStatus(700, 7), 'critical')
  assert.equal(stockStatus(701, 7.01), 'warning')
  assert.equal(stockStatus(2100, 21), 'warning')
  assert.equal(stockStatus(2101, 21.01), 'ok')
})

test('coverLabel reads as plain language', () => {
  assert.equal(coverLabel(null), 'No recent sales')
  assert.equal(coverLabel(0.4), 'Under a day of cover')
  assert.equal(coverLabel(1), '1 day of cover')
  assert.equal(coverLabel(43.4), '43 days of cover')
})
