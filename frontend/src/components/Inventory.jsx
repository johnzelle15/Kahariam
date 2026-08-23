import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import axios from 'axios'
import { RefreshCw, Archive, RotateCcw, Package, ChevronLeft, ChevronRight, AlertCircle, Search, X } from 'lucide-react'

const VARIANTS = ['SPIN_20']
const PER_PAGE_OPTIONS = [5, 10, 20, 50]

function formatCurrency(val) {
  if (val == null || val === '' || val === 0) return '—'
  return `₱${Number(val).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const RETAIL_PRICE = 5
const WHOLESALE_PRICE = 1.75

function computeTotal(record) {
  const type = getTypeLabel(record)
  const count = Math.abs(Number(record?.count) || 0)
  if (type === 'SOLD') {
    return count * RETAIL_PRICE
  }
  if (type === 'WHOLESALE_SOLD') {
    return count * WHOLESALE_PRICE
  }
  return null
}

function getTypeLabel(record) {
  const tt = (record?.transaction_type || '').toUpperCase()
  if (tt) return tt
  const action = (record?.action || '').toUpperCase()
  const notes = (record?.notes || '').toLowerCase()
  if (action === 'OUT' && notes.startsWith('died')) return 'DIED'
  if (action === 'OUT') return 'SOLD'
  if (action === 'IN') return 'TANK_IN'
  if ((action === 'WHOLESALE' || action === 'INVENTORY') && Number(record?.count) >= 0) return 'WHOLESALE_IN'
  if ((action === 'WHOLESALE' || action === 'INVENTORY') && Number(record?.count) < 0) return 'WHOLESALE_SOLD'
  return action || 'UNKNOWN'
}

function getTypeBadgeClass(type) {
  switch (type) {
    case 'SOLD': return 'bg-accent-blue/20 text-accent-blue'
    case 'WHOLESALE_SOLD': return 'bg-accent-cyan/20 text-accent-cyan'
    case 'DIED': return 'bg-accent-amber/20 text-accent-amber'
    case 'TANK_IN': return 'bg-accent-green/20 text-accent-green'
    case 'WHOLESALE_IN': return 'bg-accent-purple/20 text-accent-purple'
    default: return 'bg-white/10 text-text-muted'
  }
}

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

export default function Inventory() {
  const [variantFilter, setVariantFilter] = useState('')
  const [records, setRecords] = useState([])
  const [deleteMsg, setDeleteMsg] = useState('')

  // Pagination
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

  // Confirmation modal state
  const [confirmAction, setConfirmAction] = useState(null) // { type: 'delete'|'restore', id, label }

  // Undo snackbar state
  const [undoSnackbar, setUndoSnackbar] = useState(null) // { id, label, timerId }
  const [archivingIds, setArchivingIds] = useState(new Set())

  // Archive state
  const [showArchive, setShowArchive] = useState(false)
  const [archiveRecords, setArchiveRecords] = useState([])
  const [archiveVariant, setArchiveVariant] = useState('')
  const [archiveLoading, setArchiveLoading] = useState(false)
  const [restoreMsg, setRestoreMsg] = useState('')
  const [restoreError, setRestoreError] = useState('')

  const load = useCallback(async (p) => {
    try {
      const params = new URLSearchParams()
      // When searching, fetch ALL records (no page param) so server returns full dataset
      // for client-side multi-field filtering (notes + date + month + day)
      if (!searchQuery) {
        params.set('page', String(p || page))
        params.set('per_page', String(perPage))
      }
      if (variantFilter) params.set('variant', variantFilter)
      if (searchStartDate) params.set('start_date', searchStartDate)
      if (searchEndDate) params.set('end_date', searchEndDate)
      const res = await axios.get(`/get_inventory?${params}`)
      if (res.data && res.data.items) {
        setRecords(res.data.items)
        setTotalPages(res.data.pages || 1)
        setTotalRecords(res.data.total || 0)
      } else {
        const arr = Array.isArray(res.data) ? res.data : []
        setRecords(arr)
        setTotalPages(1)
        setTotalRecords(arr.length)
      }
    } catch (e) { console.error(e) }
  }, [page, perPage, variantFilter, searchQuery, searchStartDate, searchEndDate])

  const loadArchive = useCallback(async () => {
    setArchiveLoading(true)
    try {
      const params = new URLSearchParams()
      if (archiveVariant) params.set('variant', archiveVariant)
      const res = await axios.get(`/get_deleted_records?${params}`)
      setArchiveRecords(Array.isArray(res.data) ? res.data : [])
    } catch (e) { console.error(e) }
    finally { setArchiveLoading(false) }
  }, [archiveVariant])

  useEffect(() => { load(page) }, [load])
  useEffect(() => { if (showArchive) loadArchive() }, [showArchive, loadArchive])

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
        ? <mark key={i} className="bg-accent-purple/30 text-accent-purple rounded-sm px-0.5 font-semibold">{part}</mark>
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

  function confirmDelete(record) {
    setConfirmAction({ type: 'delete', id: record.id, label: `${record.count} ${record.variant} (${record.action})`, record })
  }

  function confirmRestore(record) {
    setConfirmAction({ type: 'restore', id: record.id, label: `${record.count} ${record.variant} (${record.action})` })
  }

  async function executeConfirmed() {
    if (!confirmAction) return
    const { type, id } = confirmAction
    setConfirmAction(null)
    if (type === 'delete') {
      await doDelete(id, confirmAction.label)
    } else if (type === 'restore') {
      await doRestore(id)
    }
  }

  async function doDelete(id, label) {
    setDeleteMsg('')
    // Animate out
    setArchivingIds(prev => new Set(prev).add(id))
    // Brief delay for animation
    await new Promise(r => setTimeout(r, 250))
    try {
      const res = await axios.delete(`/delete_inventory/${id}`)
      if (res.data?.status === 'success') {
        load(page)
        if (showArchive) loadArchive()
        // Show undo snackbar
        if (undoSnackbar?.timerId) clearTimeout(undoSnackbar.timerId)
        const timerId = setTimeout(() => setUndoSnackbar(null), 5000)
        setUndoSnackbar({ id, label: label || 'Record', timerId })
      }
    } catch (e) { console.error(e) }
    finally {
      setArchivingIds(prev => { const next = new Set(prev); next.delete(id); return next })
    }
  }

  async function handleUndo() {
    if (!undoSnackbar) return
    const { id, timerId } = undoSnackbar
    if (timerId) clearTimeout(timerId)
    setUndoSnackbar(null)
    try {
      const res = await axios.post(`/restore_record/${id}`)
      if (res.data?.success) {
        setDeleteMsg('Record restored')
        load(page)
        if (showArchive) loadArchive()
        setTimeout(() => setDeleteMsg(''), 3000)
      }
    } catch (e) { console.error(e) }
  }

  async function doRestore(id) {
    setRestoreMsg('')
    setRestoreError('')
    try {
      const res = await axios.post(`/restore_record/${id}`)
      if (res.data?.success) {
        setRestoreMsg(res.data.message || 'Record restored')
        loadArchive()
        load(page)
      } else {
        setRestoreError(res.data?.message || 'Failed to restore record')
      }
    } catch (e) {
      setRestoreError(e?.response?.data?.message || 'Unable to restore record')
    }
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
    <div className="max-w-5xl mx-auto space-y-4 sm:space-y-6">
      {/* Filter Bar */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="glass-card p-2.5 sm:p-3"
      >
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          {/* Search */}
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted/60 pointer-events-none" />
            <input
              type="text"
              value={searchInput}
              onChange={e => handleSearchChange(e.target.value)}
              placeholder="Search notes, dates, days..."
              className="neu-input w-full pl-10 pr-8 py-[7px] text-xs transition-all duration-200 focus:ring-1 focus:ring-accent-purple/30"
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
            <span className="text-text-muted/40 text-[10px]">–</span>
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

          {/* Dropdowns + Refresh */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <select value={variantFilter} onChange={e => { setVariantFilter(e.target.value); setPage(1) }}
              className="neu-input text-xs py-[7px] px-2">
              <option value="">All Variants</option>
              {VARIANTS.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
            <select value={perPage} onChange={e => { setPerPage(Number(e.target.value)); setPage(1) }}
              className="neu-input text-xs py-[7px] px-2">
              {PER_PAGE_OPTIONS.map(n => <option key={n} value={n}>{n}/pg</option>)}
            </select>
            <button onClick={() => load(page)}
              className="neu-input py-[7px] px-2 text-text-muted hover:text-text-primary transition-colors"
              title="Refresh">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Active filter tags */}
        {(searchQuery || searchStartDate || searchEndDate) && (
          <div className="flex flex-wrap items-center gap-1.5 mt-2 pt-2 border-t border-white/[0.04]">
            <span className="text-[9px] text-text-muted/50 font-medium uppercase tracking-wider">Filters:</span>
            {searchQuery && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold bg-accent-purple/10 text-accent-purple border border-accent-purple/15">
                {searchQuery}
                <button onClick={clearSearch} className="hover:text-white transition-colors"><X className="w-2 h-2" /></button>
              </span>
            )}
            {searchStartDate && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold bg-accent-blue/10 text-accent-blue border border-accent-blue/15">
                {searchStartDate}
              </span>
            )}
            {searchEndDate && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold bg-accent-blue/10 text-accent-blue border border-accent-blue/15">
                {searchEndDate}
              </span>
            )}
          </div>
        )}
      </motion.div>

      {/* Delete success message */}
      <AnimatePresence>
        {deleteMsg && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="p-3 rounded-xl bg-accent-green/10 border border-accent-green/20 text-accent-green text-sm">
            {deleteMsg}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Records Table */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.35 }}
        className="glass-card p-3 sm:p-6"
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4 text-accent-blue" />
            <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider">
              Inventory Records {displayTotalRecords > 0 && <span className="text-text-muted/60">({displayTotalRecords})</span>}
            </h3>
          </div>
        </div>
        {displayRecords.length === 0 ? (
          <div className="py-12 text-center">
            <Search className="w-8 h-8 text-text-muted/30 mx-auto mb-3" />
            <p className="text-sm text-text-muted">
              {searchQuery || searchStartDate || searchEndDate
                ? 'No matching records found'
                : 'No records found'}
            </p>
            {(searchQuery || searchStartDate || searchEndDate) && (
              <button onClick={() => { clearSearch(); clearDateFilter() }}
                className="mt-2 text-xs font-bold text-accent-purple hover:text-accent-purple/80 transition-colors">
                Clear all filters
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="dark-table table-fixed w-full">
              <colgroup>
                <col className="w-[220px]" />
                <col className="w-[130px]" />
                <col className="w-[80px]" />
                <col className="w-[100px]" />
                <col />
                <col className="w-[64px]" />
              </colgroup>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Variant</th>
                  <th>Count</th>
                  <th>Total</th>
                  <th>Type</th>
                  <th className="text-center">Archive</th>
                </tr>
              </thead>
              <tbody>
                {displayRecords.map(r => {
                  const typeLabel = getTypeLabel(r)
                  const total = computeTotal(r)
                  return (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap">{searchQuery ? highlightMatch(r.date || '', searchQuery) : r.date}</td>
                      <td>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-accent-green" />
                          {r.variant}
                        </span>
                      </td>
                      <td className="font-semibold">{Math.abs(r.count)}</td>
                      <td className="text-text-muted font-semibold">{formatCurrency(total)}</td>
                      <td>
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${getTypeBadgeClass(typeLabel)}`}>
                          {typeLabel.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="!p-0 text-center">
                        <button onClick={() => confirmDelete(r)}
                          aria-label="Archive item"
                          className="archive-btn tap-feedback">
                          <Archive className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
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
                    ? 'bg-gradient-to-r from-accent-purple to-accent-blue text-white shadow-lg shadow-accent-purple/20'
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
      </motion.div>

      {/* Archive Section */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.35 }}
        className="glass-card p-3 sm:p-6"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider flex items-center gap-2">
            <Archive className="w-4 h-4 text-accent-amber" /> Archived Records
          </h3>
          <button onClick={() => setShowArchive(!showArchive)}
            className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
              showArchive
                ? 'bg-accent-amber/20 text-accent-amber border border-accent-amber/30'
                : 'bg-white/5 text-text-muted hover:bg-white/10 border border-transparent'
            }`}>
            {showArchive ? 'Hide Archive' : 'Show Archive'}
          </button>
        </div>

        {showArchive && (
          <>
            {/* Archive Filter */}
            <div className="flex flex-wrap items-end gap-3 sm:gap-4 mb-4">
              <div className="flex flex-col gap-2 min-w-0 flex-1 sm:flex-none sm:min-w-[160px]">
                <label className="text-xs font-bold text-text-muted uppercase tracking-wider">Filter by Variant</label>
                <select value={archiveVariant} onChange={e => setArchiveVariant(e.target.value)} className="neu-input">
                  <option value="">All</option>
                  <option>SPIN_20</option>
                </select>
              </div>
              <button onClick={loadArchive} className="glow-btn glow-btn-secondary flex items-center gap-2">
                <RefreshCw className="w-4 h-4" /> Refresh
              </button>
            </div>

            {/* Restore Messages */}
            {restoreMsg && (
              <div className="mb-4 p-3 rounded-xl bg-accent-green/10 border border-accent-green/20 text-accent-green text-sm">
                {restoreMsg}
              </div>
            )}
            {restoreError && (
              <div className="mb-4 p-3 rounded-xl bg-accent-red/10 border border-accent-red/20 text-accent-red text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" /> {restoreError}
              </div>
            )}

            {archiveLoading ? (
              <p className="text-sm text-text-muted py-8 text-center">Loading archived records...</p>
            ) : archiveRecords.length === 0 ? (
              <p className="text-sm text-text-muted py-8 text-center">No archived records found</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="dark-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Variant</th>
                      <th>Count</th>
                      <th>Total</th>
                      <th>Type</th>
                      <th className="text-right">Restore</th>
                    </tr>
                  </thead>
                  <tbody>
                    {archiveRecords.map(r => {
                      const typeLabel = getTypeLabel(r)
                      const total = computeTotal(r)
                      return (
                        <tr key={r.id}>
                          <td className="whitespace-nowrap">{r.date}</td>
                          <td>
                            <span className="inline-flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-accent-green" />
                              {r.variant}
                            </span>
                          </td>
                          <td className="font-semibold">{Math.abs(r.count)}</td>
                          <td className="text-text-muted font-semibold">{formatCurrency(total)}</td>
                          <td>
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${getTypeBadgeClass(typeLabel)}`}>
                              {typeLabel.replace('_', ' ')}
                            </span>
                          </td>
                          <td className="text-right">
                            <button onClick={() => confirmRestore(r)}
                              aria-label="Restore item"
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider bg-accent-green/10 text-accent-green border border-accent-green/20 hover:bg-accent-green/20 transition-colors tap-feedback">
                              <RotateCcw className="w-3.5 h-3.5" /> Restore
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </motion.div>

      {/* Confirmation Modal */}
      <AnimatePresence>
        {confirmAction && (
          <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setConfirmAction(null)}>
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
              className="relative glass-card p-6 max-w-sm w-full mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-3 mb-4">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                  confirmAction.type === 'delete'
                    ? 'bg-accent-blue/15'
                    : 'bg-accent-green/20'
                }`}>
                  {confirmAction.type === 'delete'
                    ? <Archive className="w-5 h-5 text-accent-blue" />
                    : <RotateCcw className="w-5 h-5 text-accent-green" />
                  }
                </div>
                <div>
                  <h4 className="text-sm font-bold text-text-primary">
                    {confirmAction.type === 'delete' ? 'Archive Record' : 'Restore Record'}
                  </h4>
                  <p className="text-xs text-text-muted">This action can be reversed</p>
                </div>
              </div>
              <p className="text-sm text-text-secondary mb-6">
                Are you sure you want to {confirmAction.type === 'delete' ? 'archive' : 'restore'}{' '}
                <span className="font-semibold text-text-primary">{confirmAction.label}</span>?
              </p>
              <div className="flex items-center justify-end gap-3">
                <button onClick={() => setConfirmAction(null)}
                  className="glow-btn glow-btn-secondary text-xs py-2 px-4">
                  Cancel
                </button>
                <button onClick={executeConfirmed}
                  className={`glow-btn text-xs py-2 px-4 flex items-center gap-1.5 ${
                    confirmAction.type === 'delete' ? '' : 'glow-btn-green'
                  }`}>
                  {confirmAction.type === 'delete'
                    ? <><Archive className="w-3.5 h-3.5" /> Archive</>
                    : <><RotateCcw className="w-3.5 h-3.5" /> Restore</>
                  }
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Undo Snackbar */}
      <AnimatePresence>
        {undoSnackbar && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            className="snackbar"
          >
            <Archive className="w-4 h-4 text-text-muted flex-shrink-0" />
            <span className="text-sm">Record archived</span>
            <button onClick={handleUndo} className="snackbar-undo">Undo</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
