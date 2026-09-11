// Run: node --test frontend/src/utils/reports.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { presetRange, bucketKey, periodsBetween, buildReport, formatCell, exportTable } from './reports.js'
import { formatPeso } from './revenue.js'

// Local noon, so a timezone shift can never move the date under the test.
const at = iso => new Date(iso + 'T12:00:00')
const rec = (id, date, type, count, notes = '') =>
  ({ id, date, transaction_type: type, action: 'WHOLESALE', count, notes, variant: 'SPIN_20' })
const payload = (records, extra = {}) => ({
  start_date: '2026-09-07', end_date: '2026-09-13',
  price_per_fish: 0.4, opening_stock: 1000, records, sessions: [], ...extra,
})

test('presetRange: 7D, last month across a month end and a year end, this year', () => {
  assert.deepEqual(presetRange('7d', at('2026-09-11')), { start: '2026-09-05', end: '2026-09-11' })
  assert.deepEqual(presetRange('last-month', at('2026-03-31')), { start: '2026-02-01', end: '2026-02-28' })
  assert.deepEqual(presetRange('last-month', at('2026-01-15')), { start: '2025-12-01', end: '2025-12-31' })
  assert.deepEqual(presetRange('year', at('2026-09-11')), { start: '2026-01-01', end: '2026-09-11' })
})

test('bucketKey: a Sunday belongs to the week that started the Monday before', () => {
  assert.equal(bucketKey('2026-09-13 18:30', 'week'), '2026-09-07')
  assert.equal(bucketKey('2026-09-07', 'week'), '2026-09-07')
  assert.equal(bucketKey('2026-09-13 18:30', 'month'), '2026-09')
  assert.equal(bucketKey('2026-09-13 18:30', 'day'), '2026-09-13')
})

test('periodsBetween lists every period in the range, empty ones included', () => {
  assert.deepEqual(periodsBetween('2026-08-30', '2026-09-02', 'day'),
    ['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02'])
  assert.deepEqual(periodsBetween('2026-08-30', '2026-09-08', 'week'),
    ['2026-08-24', '2026-08-31', '2026-09-07'])
  assert.deepEqual(periodsBetween('2026-08-30', '2026-09-08', 'month'), ['2026-08', '2026-09'])
})

test('sales: a death is not a sale, revenue is count × price, zero days listed', () => {
  const r = buildReport('sales', payload([
    rec(1, '2026-09-08 09:00', 'SOLD', 100),
    rec(2, '2026-09-08 15:00', 'SOLD', 50),
    rec(3, '2026-09-09 10:00', 'DIED', 30),
    rec(4, '2026-09-10 10:00', 'WHOLESALE_IN', 500),
  ]), { group: 'day' })
  assert.equal(r.rows.length, 7)
  const d8 = r.rows.find(x => x.key === '2026-09-08')
  assert.deepEqual([d8.orders, d8.sold, d8.revenue], [2, 150, 60])
  assert.equal(r.rows.find(x => x.key === '2026-09-09').sold, 0)
  assert.deepEqual([r.totals.orders, r.totals.sold, r.totals.revenue], [2, 150, 60])
})

test('stock: opening + in − sold − died = closing, carried period to period', () => {
  const r = buildReport('stock', payload([
    rec(1, '2026-09-07 08:00', 'WHOLESALE_IN', 500),
    rec(2, '2026-09-08 09:00', 'SOLD', 200),
    rec(3, '2026-09-13 10:00', 'DIED', 30),
  ]), { group: 'day' })
  assert.deepEqual([r.rows[0].opening, r.rows[0].closing], [1000, 1500])
  assert.deepEqual([r.rows[1].opening, r.rows[1].closing], [1500, 1300])
  assert.equal(r.rows.at(-1).closing, 1270)
  assert.deepEqual(
    [r.totals.opening, r.totals.in, r.totals.sold, r.totals.died, r.totals.closing],
    [1000, 500, 200, 30, 1270])
})

test('stock by week: a Sunday-night sale lands in the week that began on Monday', () => {
  const r = buildReport('stock',
    payload([rec(1, '2026-09-13 23:00', 'SOLD', 10)], { end_date: '2026-09-14' }),
    { group: 'week' })
  assert.deepEqual(r.rows.map(x => [x.key, x.sold]), [['2026-09-07', 10], ['2026-09-14', 0]])
})

test('transactions: type filter, TANK_IN reads as counted, an amount only on sales', () => {
  const recs = [
    rec(1, '2026-09-08 09:00', 'SOLD', 100),
    rec(2, '2026-09-08 10:00', 'TANK_IN', 40),
    rec(3, '2026-09-09 10:00', 'DIED', 5),
  ]
  const all = buildReport('transactions', payload(recs), {})
  assert.equal(all.rows.length, 3)
  assert.equal(all.rows.find(x => x.key === 2).type, 'Counted')
  assert.equal(all.rows.find(x => x.key === 1).amount, 40)
  assert.equal(all.rows.find(x => x.key === 3).amount, null)
  const counted = buildReport('transactions', payload(recs), { txType: 'WHOLESALE_IN' })
  assert.deepEqual(counted.rows.map(x => x.key), [2])
})

test('sessions: duration in minutes, fish counted, status words', () => {
  const r = buildReport('sessions', payload([], { sessions: [
    { id: 1, username: 'ana', started_at: '2026-09-08 09:00:00', ended_at: '2026-09-08 09:45:30', final_count: 1200, status: 'saved' },
    { id: 2, username: 'ben', started_at: '2026-09-09 10:00:00', ended_at: '2026-09-09 10:05:00', final_count: 0, status: 'aborted' },
    { id: 3, username: 'ana', started_at: '2026-09-10 10:00:00', ended_at: null, final_count: null, status: 'active' },
  ] }), {})
  assert.deepEqual(r.rows.map(x => x.duration), [46, 5, null])
  assert.deepEqual(r.rows.map(x => x.status), ['Saved', 'Stopped', 'In progress'])
  assert.equal(r.totals.count, 1200)
})

test('formatCell: a dash for missing, thousands, pesos, percent, duration', () => {
  assert.equal(formatCell('int', null), '—')
  assert.equal(formatCell('int', 1234567), '1,234,567')
  assert.equal(formatCell('peso', 60), formatPeso(60))
  assert.equal(formatCell('pct', 0.0125), '1.3%')
  assert.equal(formatCell('duration', 65), '1 h 05 min')
  assert.equal(formatCell('duration', 12), '12 min')
})

test('exportTable: units in the headers, raw numbers in the cells, totals last', () => {
  const r = buildReport('sales', payload([rec(1, '2026-09-08 09:00', 'SOLD', 1500)]), { group: 'week' })
  assert.deepEqual(exportTable(r), [
    ['Week', 'Orders', 'Fish sold', 'Revenue (PHP)'],
    ['Week of Sep 7, 2026', 1, 1500, 600],
    ['Total', 1, 1500, 600],
  ])
})
