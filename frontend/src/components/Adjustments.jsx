import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { rawApi } from '../utils/api'
import { Send, ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight, AlertCircle, Plus, X, Skull, ShoppingCart, Search } from 'lucide-react'
import { Badge, Button, PageHeader, SectionHeader } from './ui'
import { formatRecordDate as formatDate } from '../utils/notes'

const REASONS_WHOLESALE = ['Sold', 'Died']
const VARIANTS = ['SPIN_20']
const PER_PAGE_OPTIONS = [5, 10, 20, 50]

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
const DAY_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

function getSearchableDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return String(dateStr).toLowerCase()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return [
    `${yyyy}-${mm}-${dd}`,
    `${mm}/${dd}/${yyyy}`,
    MONTH_NAMES[d.getMonth()],
    MONTH_SHORT[d.getMonth()],
    DAY_NAMES[d.getDay()],
    DAY_SHORT[d.getDay()]
  ].join(' ').toLowerCase()
}

export default function Adjustments() {
  // Form state
  const [source, setSource] = useState('wholesale')
  const [reason, setReason] = useState('Sold')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [formSuccess, setFormSuccess] = useState('')

  // Batch items: [{variant, count}]
  const [batchItems, setBatchItems] = useState([{ variant: '', count: 1 }])

  // Stock state
  const [wholesaleStock, setWholesaleStock] = useState({})

  // Confirmation modal
  const [confirmSubmit, setConfirmSubmit] = useState(null) // { items, reason, notes, source, summary }

  // History state
  const [records, setRecords] = useState([])
  const [historyVariant, setHistoryVariant] = useState('')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(5)
  const [totalPages, setTotalPages] = useState(1)
  const [totalRecords, setTotalRecords] = useState(0)

  // Search state
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchStartDate, setSearchStartDate] = useState('')
  const [searchEndDate, setSearchEndDate] = useState('')
  const searchTimerRef = useRef(null)

  const loadStock = useCallback(async () => {
    try {
      const res = await rawApi.get('/get_wholesale_stock')
      setWholesaleStock(res.data || {})
    } catch (e) { console.error(e) }
  }, [])

  const loadHistory = useCallback(async (p) => {
    try {
      const params = new URLSearchParams()
      // When searching, fetch ALL records (no page param) so server returns full dataset
      // for client-side multi-field filtering (notes + date + month + day)
      if (!searchQuery) {
        params.set('page', String(p || page))
        params.set('per_page', String(perPage))
      }
      if (historyVariant) params.set('variant', historyVariant)
      if (searchStartDate) params.set('start_date', searchStartDate)
      if (searchEndDate) params.set('end_date', searchEndDate)
      const res = await rawApi.get(`/get_adjustments?${params}`)
      const outOnly = items => items.filter(r => getDirection(r) === 'OUT')
      if (res.data && res.data.items) {
        setRecords(outOnly(res.data.items))
        setTotalPages(res.data.pages || 1)
        setTotalRecords(res.data.total || 0)
      } else {
        const arr = outOnly(Array.isArray(res.data) ? res.data : [])
        setRecords(arr)
        setTotalPages(1)
        setTotalRecords(arr.length)
      }
    } catch (e) { console.error(e) }
  }, [page, perPage, historyVariant, searchQuery, searchStartDate, searchEndDate])

  useEffect(() => { loadStock() }, [loadStock])
  useEffect(() => { loadHistory(page) }, [page, perPage, historyVariant, searchQuery, searchStartDate, searchEndDate])

  // Debounced search
  function handleSearchChange(value) {
    setSearchInput(value)
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => {
      setSearchQuery(value.trim())
      setPage(1)
    }, 300)
  }

  function clearSearch() {
    setSearchInput('')
    setSearchQuery('')
    setPage(1)
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
  }

  function clearDateFilter() {
    setSearchStartDate('')
    setSearchEndDate('')
    setPage(1)
  }

  // Highlight matching text in notes
  function highlightMatch(text, query) {
    if (!query || !text) return text
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`(${escaped})`, 'gi')
    const parts = text.split(regex)
    return parts.map((part, i) =>
      regex.test(part)
        ? <mark key={i}>{part}</mark>
        : part
    )
  }

  // Multi-field filtered records (notes + date + month + day)
  // Splits query into words — ALL words must match (AND logic)
  // Numeric words use word-boundary matching ("20" matches day 20, not year 2026)
  // Text words use partial matching ("mar" matches "march")
  const filteredRecords = useMemo(() => {
    if (!searchQuery) return records
    const words = searchQuery.toLowerCase().split(/\s+/).filter(Boolean)
    if (words.length === 0) return records
    const matchers = words.map(w => {
      if (/^\d+$/.test(w)) {
        const re = new RegExp(`\\b${w}\\b`)
        return haystack => re.test(haystack)
      }
      return haystack => haystack.includes(w)
    })
    return records.filter(r => {
      const haystack = [
        r.notes || '',
        getSearchableDate(r.date)
      ].join(' ').toLowerCase()
      return matchers.every(fn => fn(haystack))
    })
  }, [records, searchQuery])

  const isSearching = !!searchQuery
  const displayRecords = useMemo(() => {
    if (!isSearching) return records
    const start = (page - 1) * perPage
    return filteredRecords.slice(start, start + perPage)
  }, [isSearching, records, filteredRecords, page, perPage])

  const displayTotalPages = isSearching ? Math.max(1, Math.ceil(filteredRecords.length / perPage)) : totalPages
  const displayTotalRecords = isSearching ? filteredRecords.length : totalRecords

  // Batch item helpers
  function updateBatchItem(index, field, value) {
    setBatchItems(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item))
  }

  function addBatchItem() {
    const usedVariants = batchItems.map(i => i.variant).filter(Boolean)
    const available = VARIANTS.filter(v => !usedVariants.includes(v))
    setBatchItems(prev => [...prev, { variant: available[0] || '', count: 1 }])
  }

  function removeBatchItem(index) {
    setBatchItems(prev => prev.length <= 1 ? prev : prev.filter((_, i) => i !== index))
  }

  // Available variants for a given row (exclude variants already selected in other rows)
  function availableVariants(currentIndex) {
    const usedVariants = batchItems
      .filter((_, i) => i !== currentIndex)
      .map(i => i.variant)
      .filter(Boolean)
    return VARIANTS.filter(v => !usedVariants.includes(v))
  }

  // 0 disables the minimum-order rule: the banner hides and Submit stays enabled. Was 300.
  const WHOLESALE_MIN = 0

  function batchTotal() {
    return batchItems.reduce((sum, item) => sum + (item.count || 0), 0)
  }

  // Wholesale-only: true when source is wholesale, reason is Sold, and total < minimum
  const wholesaleMinNotMet = source === 'wholesale' && reason === 'Sold' && batchTotal() < WHOLESALE_MIN

  async function submitAdjustment() {
    setFormError('')
    setFormSuccess('')

    // Validate batch items
    const validItems = batchItems.filter(i => i.variant && i.count > 0)
    if (validItems.length === 0) {
      setFormError('Please add at least one variant with a count greater than 0')
      return
    }

    // Check for duplicate variants
    const variants = validItems.map(i => i.variant)
    if (new Set(variants).size !== variants.length) {
      setFormError('Duplicate variants found. Each variant can only appear once.')
      return
    }

    // Wholesale minimum order validation (only for Sold, not Died)
    if (source === 'wholesale' && reason === 'Sold' && batchTotal() < WHOLESALE_MIN) {
      setFormError(`Minimum wholesale amount is ${WHOLESALE_MIN} fish to submit an adjustment note.`)
      return
    }

    // Stock validation for wholesale — only when reason is Sold
    if (source === 'wholesale' && reason === 'Sold') {
      for (const item of validItems) {
        const stock = wholesaleStock[item.variant] ?? 0
        if (stock <= 0) { setFormError(`No wholesale stock left for ${item.variant}`); return }
        if (item.count > stock) { setFormError(`Insufficient stock for ${item.variant}. Available: ${stock}`); return }
      }
    }

    // Build summary for confirmation
    const summary = validItems.map(i => `${i.count} ${i.variant}`).join(', ')
    setConfirmSubmit({ items: validItems, reason, notes, source, summary })
  }

  async function executeSubmit() {
    if (!confirmSubmit) return
    const { items: validItems, reason: r, notes: n, source: s } = confirmSubmit
    setConfirmSubmit(null)

    setSubmitting(true)
    try {
      const payload = {
        items: validItems.map(i => ({ variant: i.variant, count: i.count })),
        reason: r,
        notes: n,
        source: s,
        wholesale_action: 'OUT',
      }
      const res = await rawApi.post('/adjust_stock_batch', payload)
      setFormSuccess(res.data?.message || 'Adjustments recorded')
      setBatchItems([{ variant: '', count: 1 }])
      loadStock()
      setPage(1)
      loadHistory(1)
    } catch (e) {
      setFormError(e?.response?.data?.message || 'Unable to submit adjustment')
    } finally {
      setSubmitting(false)
    }
  }

  function getDirection(entry) {
    const tx = (entry?.transaction_type || '').toUpperCase()
    if (tx === 'WHOLESALE_SOLD' || tx === 'SOLD') return 'OUT'
    if (tx === 'TANK_IN' || tx === 'WHOLESALE_IN') return 'IN'
    const action = (entry?.action || '').toUpperCase()
    if (action === 'IN') return 'IN'
    if (action === 'OUT') return 'OUT'
    if (action === 'WHOLESALE') return Number(entry?.count) < 0 ? 'OUT' : 'IN'
    return Number(entry?.count) < 0 ? 'OUT' : 'IN'
  }

  function getSource(entry) {
    if (entry?.source) return entry.source
    const action = (entry?.action || '').toUpperCase()
    if (action === 'IN' || action === 'OUT') return 'Fish Tank'
    return 'Storage Box'
  }

  function getReason(entry) {
    const tx = (entry?.transaction_type || '').toUpperCase()
    const n = (entry?.notes || '').toLowerCase()
    if (tx === 'DIED' || n.startsWith('died')) return 'Died'
    if (tx === 'SOLD' || n.startsWith('sold')) return 'Sold'
    return null
  }

  function goPage(p) {
    if (p < 1 || p > displayTotalPages) return
    setPage(p)
  }

  function pageNumbers() {
    const pages = []
    const maxVisible = 5
    let start = Math.max(1, page - Math.floor(maxVisible / 2))
    let end = Math.min(displayTotalPages, start + maxVisible - 1)
    if (end - start + 1 < maxVisible) start = Math.max(1, end - maxVisible + 1)
    for (let i = start; i <= end; i++) pages.push(i)
    return pages
  }

  return (
    <div className="flex flex-col gap-section grow">
      <PageHeader title="Adjustments" meta="record sales and losses against stock" />

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] gap-grid items-start">
      {/* Adjust Stock Form */}
      <motion.section
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.15 }}
        aria-labelledby="adjust-heading"
        className="glass-card card-pad xl:sticky xl:top-0"
      >
        <SectionHeader id="adjust-heading" title="Adjust stock" meta="sold or died" className="mb-3" />

        {/* Batch Items */}
        <div className="space-y-3 mb-4">
          <label className="eyebrow">Variants &amp; Counts</label>
          {batchItems.map((item, idx) => {
            const stock = source === 'wholesale' && reason === 'Sold' ? (wholesaleStock[item.variant] ?? null) : null
            return (
              <div key={idx} className="flex flex-wrap items-center gap-2 sm:gap-3 p-2 sm:p-3 rounded-xl bg-white/[0.02] border border-white/5">
                {/* Capped so the variant picker stops sprawling to ~1000px on a
                    desktop screen while its quantity stepper hugs the far right
                    edge — they read as one control at any width this way. */}
                <div className="flex-1 min-w-0 sm:min-w-[130px] sm:max-w-md">
                  <select value={item.variant}
                    onChange={e => updateBatchItem(idx, 'variant', e.target.value)}
                    className="neu-input w-full text-sm">
                    <option value="">Select variant</option>
                    {availableVariants(idx).map(v => (
                      <option key={v} value={v}>{v}
                        {source === 'wholesale' && wholesaleStock[v] != null ? ` (${wholesaleStock[v]} in stock)` : ''}
                      </option>
                    ))}
                    {/* Keep currently selected variant visible even if used */}
                    {item.variant && !availableVariants(idx).includes(item.variant) && (
                      <option value={item.variant}>{item.variant}
                        {source === 'wholesale' && wholesaleStock[item.variant] != null ? ` (${wholesaleStock[item.variant]} in stock)` : ''}
                      </option>
                    )}
                  </select>
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => updateBatchItem(idx, 'count', Math.max(1, item.count - 1))}
                    className="w-8 h-8 rounded-lg bg-white/5 text-text-primary hover:bg-white/10 flex items-center justify-center text-sm font-bold transition-colors">−</button>
                  <input type="number" min="1" value={item.count}
                    onChange={e => updateBatchItem(idx, 'count', Math.max(1, Number(e.target.value) || 1))}
                    className="neu-input w-20 text-center text-sm" />
                  <button onClick={() => updateBatchItem(idx, 'count', item.count + 1)}
                    className="w-8 h-8 rounded-lg bg-white/5 text-text-primary hover:bg-white/10 flex items-center justify-center text-sm font-bold transition-colors">+</button>
                </div>
                {stock !== null && item.variant && (
                  <span className={`text-xs font-semibold min-w-[60px] text-right ${
                    stock > 0 ? (item.count > stock ? 'text-accent-red' : 'text-accent-green') : 'text-accent-red'
                  }`}>
                    {item.count > stock ? '⚠ ' : ''}Stock: {stock}
                  </span>
                )}
                {batchItems.length > 1 && (
                  <button onClick={() => removeBatchItem(idx)}
                    className="w-8 h-8 rounded-lg bg-accent-red/10 text-accent-red hover:bg-accent-red/20 flex items-center justify-center transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )
          })}

          {batchItems.length < VARIANTS.length && (
            <button onClick={addBatchItem}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 text-text-muted hover:bg-white/10 hover:text-text-primary text-xs font-bold uppercase tracking-wider transition-all border border-dashed border-white/10">
              <Plus className="w-3.5 h-3.5" /> Add Variant
            </button>
          )}

          {batchItems.filter(i => i.variant && i.count > 0).length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-text-muted">
                Total: <span className="font-bold text-text-primary">{batchTotal()}</span> fish across{' '}
                <span className="font-bold text-text-primary">{batchItems.filter(i => i.variant && i.count > 0).length}</span> variant(s)
              </p>
              {wholesaleMinNotMet && (
                <p className="text-xs font-semibold text-accent-red flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  Minimum wholesale order is {WHOLESALE_MIN} fish. ({WHOLESALE_MIN - batchTotal()} more needed)
                </p>
              )}
            </div>
          )}
        </div>

        {/* Reason + Notes */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div className="flex flex-col gap-2">
            <label className="eyebrow">Reason</label>
            <select value={reason} onChange={e => setReason(e.target.value)} className="neu-input">
              {REASONS_WHOLESALE.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-2 sm:col-span-1">
            <label className="eyebrow">Notes (optional)</label>
            <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Add notes here..."
              className="neu-input min-h-[60px] resize-y py-3" />
          </div>
        </div>

        {/* Error / Success Messages */}
        {formError && (
          <div className="mb-4 p-3 rounded-xl bg-accent-red/10 border border-accent-red/20 text-accent-red text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" /> {formError}
          </div>
        )}
        {formSuccess && (
          <div className="mb-4 p-3 rounded-xl bg-accent-green/10 border border-accent-green/20 text-accent-green text-sm">
            {formSuccess}
          </div>
        )}

        <div className="flex justify-center">
          <Button
            size="lg"
            icon={Send}
            loading={submitting}
            disabled={wholesaleMinNotMet}
            onClick={submitAdjustment}
            title={wholesaleMinNotMet ? `Minimum wholesale order is ${WHOLESALE_MIN} fish` : undefined}
          >
            {submitting ? 'Submitting...' : 'Submit Adjustment'}
          </Button>
        </div>
      </motion.section>

      {/* History */}
      <motion.section
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.15 }}
        aria-labelledby="history-heading"
        className="glass-card card-pad"
      >
        <SectionHeader id="history-heading" title="Adjustment history"
          meta={displayTotalRecords > 0 ? `${displayTotalRecords} records` : undefined}
          className="mb-2.5" />

        {/* Filter Bar */}
        <div className="mb-4 rounded-xl p-2.5"
          style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            {/* Search */}
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted/60 pointer-events-none" />
              <input
                type="text"
                value={searchInput}
                onChange={e => handleSearchChange(e.target.value)}
                placeholder="Search notes, dates, days..."
                className="neu-input w-full pl-10 pr-8 py-[7px] text-xs transition-all duration-200 focus:ring-1 focus:ring-accent-green/30"
              />
              {searchInput && (
                <button onClick={clearSearch}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full bg-white/8 hover:bg-white/15 p-0.5 flex items-center justify-center transition-colors">
                  <X className="w-3 h-3 text-text-muted" />
                </button>
              )}
            </div>

            {/* Date range */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <input type="date" value={searchStartDate}
                onChange={e => { setSearchStartDate(e.target.value); setPage(1) }}
                className="neu-input text-xs py-[7px] px-2" />
              <span className="text-text-muted/40 text-xs">–</span>
              <input type="date" value={searchEndDate}
                onChange={e => { setSearchEndDate(e.target.value); setPage(1) }}
                className="neu-input text-xs py-[7px] px-2" />
              {(searchStartDate || searchEndDate) && (
                <button onClick={clearDateFilter}
                  className="rounded-full bg-accent-red/10 hover:bg-accent-red/20 p-1 flex items-center justify-center transition-colors"
                  title="Clear dates">
                  <X className="w-2.5 h-2.5 text-accent-red" />
                </button>
              )}
            </div>

            {/* Dropdowns */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <select value={historyVariant} onChange={e => { setHistoryVariant(e.target.value); setPage(1) }}
                className="neu-input text-xs py-[7px] px-2">
                <option value="">All Variants</option>
                {VARIANTS.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
              <select value={perPage} onChange={e => { setPerPage(Number(e.target.value)); setPage(1) }}
                className="neu-input text-xs py-[7px] px-2">
                {PER_PAGE_OPTIONS.map(n => <option key={n} value={n}>{n} per page</option>)}
              </select>
            </div>
          </div>

          {/* Active filter tags */}
          {(searchQuery || searchStartDate || searchEndDate) && (
            <div className="flex flex-wrap items-center gap-1.5 mt-2 pt-2 border-t border-white/[0.04]">
              <span className="text-xs text-text-muted/50 font-medium uppercase tracking-wider">Filters:</span>
              {searchQuery && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-accent-blue/10 text-accent-blue border border-accent-blue/15">
                  {searchQuery}
                  <button onClick={clearSearch} className="hover:text-white transition-colors"><X className="w-2 h-2" /></button>
                </span>
              )}
              {searchStartDate && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-accent-blue/10 text-accent-blue border border-accent-blue/15">
                  {searchStartDate}
                </span>
              )}
              {searchEndDate && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-accent-blue/10 text-accent-blue border border-accent-blue/15">
                  {searchEndDate}
                </span>
              )}
            </div>
          )}
        </div>

        {displayRecords.length === 0 ? (
          <div className="py-12 text-center">
            <Search className="w-8 h-8 text-text-muted/30 mx-auto mb-3" />
            <p className="text-sm text-text-muted">
              {searchQuery || searchStartDate || searchEndDate
                ? 'No matching records found'
                : 'No adjustments yet'}
            </p>
            {(searchQuery || searchStartDate || searchEndDate) && (
              <button onClick={() => { clearSearch(); clearDateFilter() }}
                className="mt-2 text-xs font-bold text-accent-green hover:text-accent-green/80 transition-colors">
                Clear all filters
              </button>
            )}
          </div>
        ) : (
          /* A ledger, not a stack of cards. Each row was a tinted, bordered box
             with a 32px coloured icon tile, so a page of them read as fifteen
             separate panels rather than one history — and three tints (amber,
             red, green) competing down the page made none of them mean much.
             The arrow and the sign carry the direction now; the rule carries the
             separation. */
          <ul className="list-none m-0 p-0 divide-y divide-rule">
            {displayRecords.map(r => {
              const dir = getDirection(r)
              const displayCount = Math.abs(Number(r.count) || 0)
              const isOut = dir === 'OUT'
              const reasonTag = getReason(r)
              const isDied = reasonTag === 'Died'
              const Icon = isDied ? Skull : isOut ? ArrowDownRight : ArrowUpRight
              const tone = isDied ? 'text-attention' : isOut ? 'text-negative' : 'text-positive'
              return (
                <li key={r.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 py-2 px-1
                  rounded-sm [@media(hover:hover)]:hover:bg-[var(--table-row-hover)]">
                  <Icon size={14} className={`${tone} shrink-0 mt-0.5`} aria-hidden="true" />
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <p className="text-[13px] font-semibold text-text-primary truncate m-0 tabular-nums">
                        {isOut ? '−' : '+'}{displayCount.toLocaleString()}
                        <span className="font-normal text-text-secondary"> {r.variant}</span>
                      </p>
                      {/* One badge only — the reason implies the direction, and
                          the arrow already carries it. Falls back to IN/OUT when
                          a row has no Sold/Died reason. */}
                      <Badge variant={isDied ? 'warning' : reasonTag ? 'info' : isOut ? 'error' : 'success'}
                        className="shrink-0 uppercase tracking-wider">
                        {reasonTag || (isOut ? 'Out' : 'In')}
                      </Badge>
                    </div>
                    <p className="meta truncate m-0">
                      {getSource(r)} · {searchQuery ? highlightMatch(formatDate(r.date), searchQuery) : formatDate(r.date)}
                    </p>
                    {r.notes && (
                      <p className="meta truncate m-0">{highlightMatch(r.notes, searchQuery)}</p>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {/* Pagination Controls */}
        {displayTotalPages > 1 && (
          <div className="flex items-center justify-center gap-1.5 mt-6 pt-4 border-t border-white/5">
            <button onClick={() => goPage(page - 1)} disabled={page <= 1}
              className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors
                ${page <= 1 ? 'text-text-muted/30 cursor-not-allowed' : 'text-text-muted hover:bg-white/10 hover:text-text-primary'}`}>
              <ChevronLeft className="w-4 h-4" />
            </button>
            {pageNumbers().map(p => (
              <button key={p} onClick={() => goPage(p)}
                className={`w-8 h-8 rounded-lg text-xs font-bold transition-all
                  ${p === page
                    ? 'bg-accent-green text-[var(--on-accent)]'
                    : 'text-text-muted hover:bg-white/10 hover:text-text-primary'
                  }`}>{p}</button>
            ))}
            <button onClick={() => goPage(page + 1)} disabled={page >= displayTotalPages}
              className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors
                ${page >= displayTotalPages ? 'text-text-muted/30 cursor-not-allowed' : 'text-text-muted hover:bg-white/10 hover:text-text-primary'}`}>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </motion.section>
      </div>

      {/* Confirmation Modal */}
      <AnimatePresence>
        {confirmSubmit && (
          <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setConfirmSubmit(null)}>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 backdrop-blur-sm"
              style={{ background: 'var(--modal-overlay)' }}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="relative glass-card p-6 max-w-sm w-full mx-4 shadow-2xl"
              onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-3 mb-4">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                  confirmSubmit.reason === 'Died' ? 'bg-accent-amber/20' : 'bg-accent-red/20'
                }`}>
                  {confirmSubmit.reason === 'Died'
                    ? <Skull className="w-5 h-5 text-accent-amber" />
                    : <ShoppingCart className="w-5 h-5 text-accent-red" />
                  }
                </div>
                <div>
                  <h4 className="text-sm font-bold text-text-primary">Confirm Adjustment</h4>
                  <p className="text-xs text-text-muted">Reason: {confirmSubmit.reason}</p>
                </div>
              </div>

              <div className="space-y-2 mb-4">
                {confirmSubmit.items.map((item, i) => (
                  <motion.div key={i}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.15 }}
                    className="flex items-center justify-between p-2.5 rounded-xl border"
                    style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)' }}>
                    <span className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-accent-green" />
                      <span className="text-sm text-text-secondary font-medium">{item.variant}</span>
                    </span>
                    <span className="text-sm font-bold text-text-primary">−{item.count}</span>
                  </motion.div>
                ))}
              </div>

              <p className="text-xs text-text-muted mb-1">
                Source: <span className="font-semibold text-text-secondary">{confirmSubmit.source === 'wholesale' ? 'Wholesale Storage' : 'Fish Tank'}</span>
              </p>
              {confirmSubmit.notes && (
                <p className="text-xs text-text-muted mb-4">Notes: {confirmSubmit.notes}</p>
              )}

              <div className="flex items-center justify-end gap-3 mt-4">
                <Button variant="secondary" size="sm" onClick={() => setConfirmSubmit(null)}>
                  Cancel
                </Button>
                <Button
                  variant={confirmSubmit.reason === 'Died' ? 'danger' : 'primary'}
                  size="sm"
                  icon={Send}
                  onClick={executeSubmit}
                >
                  Confirm
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
