import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { rawApi } from '../utils/api'
import { getRecordType, formatRecordDate, MOVEMENT } from '../utils/notes'
import { RefreshCw, Archive, RotateCcw, Package, ChevronLeft, ChevronRight, AlertCircle, Search, X } from 'lucide-react'
import { Button, PageHeader, SectionHeader, EmptyState, Modal, Skeleton, DateInput } from './ui'

const VARIANTS = ['SPIN_20']
const PER_PAGE_OPTIONS = [5, 10, 20, 50]

function formatCurrency(val) {
  if (val == null || val === '' || val === 0) return '—'
  return `₱${Number(val).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const PRICE_PER_FISH = 0.40

function computeTotal(record) {
  const type = getRecordType(record)
  const count = Math.abs(Number(record?.count) || 0)
  if (type === 'SOLD') {
    return count * PRICE_PER_FISH
  }
  return null
}

/* The dashboard's word and colour for a movement, so a row reads the same on
   both screens. A type the map doesn't know keeps its own name, muted. */
function movementOf(record) {
  const type = getRecordType(record)
  return MOVEMENT[type] || {
    label: type.charAt(0) + type.slice(1).toLowerCase().replace(/_/g, ' '),
    text: 'text-text-muted',
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

/* With a capture group in the pattern, split puts the matches on the odd indexes. */
function highlight(text, query) {
  if (!query || !text) return text
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return String(text).split(new RegExp(`(${escaped})`, 'gi')).map((part, i) =>
    i % 2
      ? <mark key={i}>{part}</mark>
      : part
  )
}

/* One ledger for both the active records and the archive — they were two
   hand-copied tables that had already drifted apart (the archive printed
   counts without thousands separators).

   From md it is a table whose numbers are right-aligned so they compare down
   the column. Below md it is a list: the table needed 700px, and on a phone
   the only way to reach a row's Archive button was to scroll the page sideways.
   The note is shown only while searching — it is what the search matched, and
   otherwise it restates the count ("Wholesale order: 65,560 pcs"). */
function RecordList({ label, records, query, action, actionWidth = '4.5rem', pendingIds }) {
  const noteOf = r => (query && r.notes ? highlight(r.notes, query) : null)
  return (
    <>
      <table className="dark-table ledger table-fixed hidden md:table">
        <caption className="sr-only">{label}</caption>
        <colgroup>
          <col />
          <col className="w-[5.5rem]" />
          <col className="w-[6rem]" />
          <col className="w-[5.5rem]" />
          <col className="w-[7rem]" />
          <col style={{ width: actionWidth }} />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Type</th>
            <th scope="col">Variant</th>
            <th scope="col" className="!text-right">Count</th>
            <th scope="col" className="!text-right">Total</th>
            <th scope="col"><span className="sr-only">Action</span></th>
          </tr>
        </thead>
        <tbody>
          {records.map(r => {
            const m = movementOf(r)
            const note = noteOf(r)
            return (
              <tr key={r.id} className={pendingIds?.has(r.id) ? 'opacity-40' : undefined}>
                <td>
                  <span className="text-text-primary whitespace-nowrap">{highlight(formatRecordDate(r.date), query)}</span>
                  {note && <span className="meta block truncate">{note}</span>}
                </td>
                <td><span className={`font-medium ${m.text}`}>{m.label}</span></td>
                <td className="whitespace-nowrap">{r.variant}</td>
                <td className="text-right tabular-nums">
                  <span className="font-semibold text-text-primary">{Math.abs(r.count).toLocaleString()}</span>
                </td>
                <td className="text-right tabular-nums whitespace-nowrap">{formatCurrency(computeTotal(r))}</td>
                <td className="!py-0 text-right">{action(r)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <ul aria-label={label} className="md:hidden list-none m-0 p-0 divide-y divide-rule">
        {records.map(r => {
          const m = movementOf(r)
          const total = computeTotal(r)
          const note = noteOf(r)
          return (
            <li key={r.id}
              className={`grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 py-1.5 px-[var(--pad-card)]
                ${pendingIds?.has(r.id) ? 'opacity-40' : ''}`}>
              <div className="min-w-0">
                <p className="text-[13px] text-text-primary truncate">{highlight(formatRecordDate(r.date), query)}</p>
                <p className="meta truncate">
                  <span className={`font-semibold ${m.text}`}>{m.label}</span> · {r.variant}
                </p>
                {note && <p className="meta truncate">{note}</p>}
              </div>
              <div className="text-right tabular-nums">
                <p className="text-[13px] font-semibold text-text-primary">{Math.abs(r.count).toLocaleString()}</p>
                {total != null && <p className="meta">{formatCurrency(total)}</p>}
              </div>
              {action(r)}
            </li>
          )
        })}
      </ul>
    </>
  )
}

export default function Inventory() {
  const [variantFilter, setVariantFilter] = useState('')
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
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

  // Confirmation modal state. The close handler is stable because Modal
  // re-runs its focus effect whenever onClose changes identity.
  const [confirmAction, setConfirmAction] = useState(null) // { type: 'delete'|'restore', id, label, record }
  const closeConfirm = useCallback(() => setConfirmAction(null), [])

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
      const res = await rawApi.get(`/get_inventory?${params}`)
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
      setLoadError(false)
    } catch (e) {
      console.error(e)
      // Without this a failed request rendered as "No records found".
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [page, perPage, variantFilter, searchQuery, searchStartDate, searchEndDate])

  const loadArchive = useCallback(async () => {
    setArchiveLoading(true)
    try {
      const params = new URLSearchParams()
      if (archiveVariant) params.set('variant', archiveVariant)
      const res = await rawApi.get(`/get_deleted_records?${params}`)
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

  function clearAll() {
    clearSearch()
    clearDateFilter()
    setVariantFilter('')
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
    setConfirmAction({ type: 'restore', id: record.id, label: `${record.count} ${record.variant} (${record.action})`, record })
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
    // The row dims and its button disables while the request is in flight.
    setArchivingIds(prev => new Set(prev).add(id))
    try {
      const res = await rawApi.delete(`/delete_inventory/${id}`)
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
      const res = await rawApi.post(`/restore_record/${id}`)
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
      const res = await rawApi.post(`/restore_record/${id}`)
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

  const filtered = !!(searchQuery || searchStartDate || searchEndDate || variantFilter)
  const first = (page - 1) * perPage + 1
  const last = Math.min(page * perPage, displayTotalRecords)
  const isArchiving = confirmAction?.type === 'delete'
  const confirmRecord = confirmAction?.record
  const confirmKind = confirmRecord ? movementOf(confirmRecord) : null

  return (
    /* Left-aligned, not centred: every other screen's title sits at the pane's
       left edge, and a centred column made "Inventory" jump sideways on each
       tab switch. The cap keeps the ledger's columns close enough to read
       across on a wide monitor. */
    <div className="flex flex-col gap-section max-w-5xl">
      <PageHeader
        title="Inventory"
        meta={loading ? undefined
          : `${displayTotalRecords.toLocaleString()} ${filtered ? 'matching ' : ''}record${displayTotalRecords === 1 ? '' : 's'}`}
        actions={
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => load(page)}>
            Refresh
          </Button>
        }
      />

      {deleteMsg && <p role="status" className="text-sm text-positive">{deleteMsg}</p>}

      {/* ── Records: filters, ledger and pager as one panel ──
             They were three floating cards — a filter card, a records card
             with its own icon-and-caps heading, and a pager inside that — so
             the filters read as unrelated to the rows they filter. */}
      <section aria-label="Inventory records" className="glass-card overflow-hidden">
        {/* Controls wrap onto a second line on narrow screens instead of
            pushing the panel wider than the page. */}
        <div className="card-pad flex flex-wrap items-center gap-2 border-b border-rule">
          <div className="relative flex-[1_1_9rem] min-w-0">
            <Search size={14} aria-hidden="true"
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
            <input
              type="text"
              enterKeyHint="search"
              value={searchInput}
              onChange={e => handleSearchChange(e.target.value)}
              placeholder="Search notes or dates"
              aria-label="Search records"
              className={`neu-input w-full pl-8 py-1.5 text-[13px] ${searchInput ? 'pr-9' : ''}`}
            />
            {searchInput && (
              <button type="button" onClick={clearSearch} aria-label="Clear search"
                className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded text-text-muted hover:text-text-primary
                  focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-green">
                <X size={14} />
              </button>
            )}
          </div>

          <select aria-label="Variant" value={variantFilter}
            onChange={e => { setVariantFilter(e.target.value); setPage(1) }}
            className="neu-input flex-none py-1.5 text-[13px]">
            <option value="">All variants</option>
            {VARIANTS.map(v => <option key={v} value={v}>{v}</option>)}
          </select>

          <div className="grid grid-cols-2 gap-2 flex-[1_1_17rem]">
            <DateInput label="From" inset="pl-10" value={searchStartDate} max={searchEndDate}
              onChange={v => { setSearchStartDate(v); setPage(1) }} />
            <DateInput label="To" inset="pl-6" value={searchEndDate} min={searchStartDate}
              onChange={v => { setSearchEndDate(v); setPage(1) }} />
          </div>

          {/* A search alone has the × in its own box. This clears everything,
              and shows only once a date or variant is set — so an ordinary
              search doesn't push a third row onto a phone's toolbar. */}
          {(searchStartDate || searchEndDate || variantFilter) && (
            <Button variant="ghost" size="sm" onClick={clearAll}>Clear</Button>
          )}
        </div>

        {loading ? (
          <div className="card-pad flex flex-col gap-3" aria-hidden="true">
            {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} height={16} />)}
          </div>
        ) : loadError ? (
          <div className="px-[var(--pad-card)]">
            <EmptyState compact icon={AlertCircle} title="Couldn't load records"
              message="Check the connection to the server, then try again."
              actionLabel="Try again" onAction={() => load(page)} />
          </div>
        ) : displayRecords.length === 0 ? (
          <div className="px-[var(--pad-card)]">
            {filtered
              ? <EmptyState compact icon={Search} title="No matching records"
                  message="Nothing matches this search, variant or date range."
                  actionLabel="Clear filters" onAction={clearAll} />
              : <EmptyState compact icon={Package} title="No records yet"
                  message="Saved counts and adjustments appear here." />}
          </div>
        ) : (
          <RecordList
            label="Inventory records"
            records={displayRecords}
            query={searchQuery}
            pendingIds={archivingIds}
            action={r => (
              <button type="button" onClick={() => confirmDelete(r)} disabled={archivingIds.has(r.id)}
                aria-label={`Archive record from ${formatRecordDate(r.date)}`} title="Archive"
                className="icon-btn disabled:opacity-40 disabled:cursor-not-allowed">
                <Archive size={14} />
              </button>
            )}
          />
        )}

        {!loading && !loadError && displayRecords.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-[var(--pad-card)] py-2 border-t border-rule">
            <p className="meta tabular-nums">
              {first.toLocaleString()}–{last.toLocaleString()} of {displayTotalRecords.toLocaleString()}
            </p>
            <div className="flex items-center gap-2">
              <label className="meta flex items-center gap-1.5">
                Rows
                <select value={perPage} onChange={e => { setPerPage(Number(e.target.value)); setPage(1) }}
                  className="neu-input py-1 text-[13px]">
                  {PER_PAGE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              {displayTotalPages > 1 && (
                <nav aria-label="Pages" className="flex items-center gap-1">
                  <button type="button" onClick={() => goPage(page - 1)} disabled={page <= 1}
                    aria-label="Previous page" className="icon-btn disabled:opacity-40 disabled:cursor-not-allowed">
                    <ChevronLeft size={16} />
                  </button>
                  {/* Page numbers from sm; on a phone "1–5 of 177" already says
                      where you are, and five 44px targets don't fit beside it. */}
                  <div className="hidden sm:block">
                    <div className="segmented">
                      {pageNumbers().map(p => (
                        <button key={p} type="button" onClick={() => goPage(p)}
                          data-active={p === page} aria-current={p === page ? 'page' : undefined}
                          aria-label={`Page ${p}`} className="tabular-nums">
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button type="button" onClick={() => goPage(page + 1)} disabled={page >= displayTotalPages}
                    aria-label="Next page" className="icon-btn disabled:opacity-40 disabled:cursor-not-allowed">
                    <ChevronRight size={16} />
                  </button>
                </nav>
              )}
            </div>
          </div>
        )}
      </section>

      {/* ── Archive ── expands in place, below the records it came from. */}
      <section aria-labelledby="archive-heading" className="glass-card overflow-hidden">
        <SectionHeader id="archive-heading" title="Archived records"
          meta={showArchive && !archiveLoading && archiveRecords.length > 0
            ? `${archiveRecords.length.toLocaleString()} record${archiveRecords.length === 1 ? '' : 's'}`
            : undefined}
          className="card-pad !items-center"
          actions={
            <Button variant="secondary" size="sm" onClick={() => setShowArchive(s => !s)}
              aria-expanded={showArchive} aria-controls="archive-body">
              {showArchive ? 'Hide' : 'Show'}
            </Button>
          } />

        {showArchive && (
          <div id="archive-body" className="border-t border-rule">
            <div className="card-pad flex flex-wrap items-center gap-2">
              <select aria-label="Archived variant" value={archiveVariant}
                onChange={e => setArchiveVariant(e.target.value)}
                className="neu-input py-1.5 text-[13px]">
                <option value="">All variants</option>
                {VARIANTS.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
              <Button variant="ghost" size="sm" icon={RefreshCw} onClick={loadArchive}>Refresh</Button>
            </div>

            {(restoreMsg || restoreError) && (
              <p role={restoreError ? 'alert' : 'status'}
                className={`px-[var(--pad-card)] pb-2 text-sm flex items-center gap-1.5
                  ${restoreError ? 'text-negative' : 'text-positive'}`}>
                {restoreError && <AlertCircle size={14} className="shrink-0" aria-hidden="true" />}
                {restoreError || restoreMsg}
              </p>
            )}

            <div className="border-t border-rule">
              {archiveLoading ? (
                <p className="meta card-pad">Loading archived records…</p>
              ) : archiveRecords.length === 0 ? (
                <div className="px-[var(--pad-card)]">
                  <EmptyState compact icon={Archive} title="Nothing archived"
                    message="Records you archive are kept here and can be restored." />
                </div>
              ) : (
                <RecordList
                  label="Archived records"
                  records={archiveRecords}
                  actionWidth="8.5rem"
                  action={r => (
                    <Button variant="secondary" size="sm" icon={RotateCcw} onClick={() => confirmRestore(r)}
                      aria-label={`Restore record from ${formatRecordDate(r.date)}`}>
                      Restore
                    </Button>
                  )}
                />
              )}
            </div>
          </div>
        )}
      </section>

      {/* Confirmation — the shared dialog, so it traps focus, closes on Escape
          and hands focus back to the row's button like every other dialog. */}
      <Modal open={!!confirmAction} onClose={closeConfirm} size="sm"
        title={isArchiving ? 'Archive this record?' : 'Restore this record?'}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={closeConfirm}>Cancel</Button>
            <Button variant="primary" size="sm" icon={isArchiving ? Archive : RotateCcw} onClick={executeConfirmed}>
              {isArchiving ? 'Archive' : 'Restore'}
            </Button>
          </>
        }>
        {confirmRecord && (
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 m-0 mb-3 px-3 py-2 text-sm
            rounded-lg border border-rule">
            <dt className="meta self-center">Date</dt>
            <dd className="m-0 text-text-primary">{formatRecordDate(confirmRecord.date)}</dd>
            <dt className="meta self-center">Type</dt>
            <dd className={`m-0 font-medium ${confirmKind.text}`}>{confirmKind.label}</dd>
            <dt className="meta self-center">Count</dt>
            <dd className="m-0 text-text-primary tabular-nums">
              {Math.abs(confirmRecord.count).toLocaleString()} {confirmRecord.variant}
            </dd>
            <dt className="meta self-center">Total</dt>
            <dd className="m-0 text-text-secondary tabular-nums">{formatCurrency(computeTotal(confirmRecord))}</dd>
          </dl>
        )}
        <p className="text-sm text-text-secondary">
          {isArchiving
            ? 'It will be hidden from this list. Stock and sales totals are not affected.'
            : 'It will return to the active records list.'}
        </p>
      </Modal>

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
