// Run: node --test frontend/src/utils/revenue.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isoDay, startOfWeek, startOfMonth, revenueWindow,
  periodRevenue, averageSale, formatPeso, formatPesoShort, rangeLabel,
} from './revenue.js'

const day = (iso, revenue, sold = 0) => ({ date: iso, revenue, sold_total: sold })
// Local noon, so a timezone shift can never move the date under the test.
const at = iso => new Date(iso + 'T12:00:00')

test('isoDay uses local date, not UTC', () => {
  // 23:30 local on the 10th is the 11th in UTC for +08:00. The farm's books say
  // the 10th, so the card must too.
  assert.equal(isoDay(new Date(2026, 8, 10, 23, 30)), '2026-09-10')
  assert.equal(isoDay(new Date(2026, 0, 1, 0, 15)), '2026-01-01')
})

test('startOfWeek is the Monday, including when today is Sunday', () => {
  assert.equal(isoDay(startOfWeek(at('2026-09-10'))), '2026-09-07') // Thu -> Mon
  assert.equal(isoDay(startOfWeek(at('2026-09-07'))), '2026-09-07') // Mon -> itself
  assert.equal(isoDay(startOfWeek(at('2026-09-13'))), '2026-09-07') // Sun -> that Mon
})

test('startOfMonth is the first', () => {
  assert.equal(isoDay(startOfMonth(at('2026-09-10'))), '2026-09-01')
})

test('revenueWindow reaches back to whichever period started earlier', () => {
  // Sep 2026: the 1st is a Tuesday, so the week containing it began Aug 31.
  // A month-to-date-only fetch would silently drop a day of the week total.
  assert.deepEqual(revenueWindow(at('2026-09-01')), {
    start: '2026-08-31', end: '2026-09-01', weekStart: '2026-08-31', monthStart: '2026-09-01',
  })
  // Mid-month the week starts after the 1st, so the month is the longer reach.
  assert.deepEqual(revenueWindow(at('2026-09-10')), {
    start: '2026-09-01', end: '2026-09-10', weekStart: '2026-09-07', monthStart: '2026-09-01',
  })
})

test('periodRevenue windows a daily series into today / week / month', () => {
  const rows = [
    day('2026-08-31', 100),  // previous month, inside this week
    day('2026-09-01', 200),
    day('2026-09-02', 300),
  ]
  const r = periodRevenue(rows, at('2026-09-02'))
  assert.equal(r.today, 300)
  assert.equal(r.week, 600)   // Aug 31 + Sep 1 + Sep 2
  assert.equal(r.month, 500)  // Sep 1 + Sep 2 only
})

test('periodRevenue reports a real zero when nothing sold', () => {
  // The live case: last sale was in August, the dashboard is open in September.
  const rows = [day('2026-09-07', 0), day('2026-09-10', 0)]
  const r = periodRevenue(rows, at('2026-09-10'))
  assert.deepEqual([r.today, r.week, r.month], [0, 0, 0])
})

test('periodRevenue survives a missing today row and bad input', () => {
  assert.equal(periodRevenue([day('2026-09-09', 50)], at('2026-09-10')).today, 0)
  assert.equal(periodRevenue(null, at('2026-09-10')).month, 0)
  assert.equal(periodRevenue([day('2026-09-10', '42.50')], at('2026-09-10')).today, 42.5)
})

test('averageSale is null with no sales, never a fabricated zero', () => {
  assert.equal(averageSale(4000000, 159).toFixed(2), '25157.23')
  assert.equal(averageSale(0, 0), null)
  assert.equal(averageSale(1000, null), null)
  assert.equal(averageSale(1000, -3), null)
})

test('formatPeso always shows two decimals and survives junk', () => {
  assert.equal(formatPeso(0), '₱0.00')
  assert.equal(formatPeso('4000000'), '₱4,000,000.00')
  assert.equal(formatPeso(undefined), '₱0.00')
  assert.equal(formatPeso(NaN), '₱0.00')
})

test('formatPesoShort keeps a wide figure inside a narrow cell', () => {
  assert.equal(formatPesoShort(0), '₱0.00')
  assert.equal(formatPesoShort(9999), '₱9,999.00')
  assert.equal(formatPesoShort(25157.23), '₱25.2K')
  assert.equal(formatPesoShort(400000), '₱400K')
  assert.equal(formatPesoShort(4000000), '₱4.0M')
  assert.equal(formatPesoShort(40000000), '₱40M')
})

test('rangeLabel names the period a figure covers', () => {
  assert.equal(rangeLabel('2026-09-10', '2026-09-10'), 'Sep 10')
  assert.equal(rangeLabel('2026-09-07', '2026-09-10'), '7–10 Sep')
  assert.equal(rangeLabel('2026-08-31', '2026-09-02'), '31 Aug – 2 Sep')
  assert.equal(rangeLabel('', '2026-09-02'), '')
})
