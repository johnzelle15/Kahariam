import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, Pencil, Save, Trash2, Wheat } from 'lucide-react'
import api from '../utils/api'
import { formatPeso } from '../utils/revenue'
import { formatDay } from '../utils/feed'
import FeedAlert from './FeedAlert'
import { Button, EmptyState, Modal, PageHeader, Pager, SectionHeader, Skeleton } from './ui'

const PER_PAGE_OPTIONS = [3, 10, 20, 50]

/* A new purchase starts on the Pi's today, not the browser's, and at the usual
   amount — most purchases are the routine one, so the form is one tap. */
const blankForm = status => ({
  id: null, purchased_on: status.today, amount: String(status.estimated_amount), notes: '',
})

export default function Feed() {
  const [data, setData] = useState(null) // { purchases, status }
  const [loadError, setLoadError] = useState(false)
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  // One slot, in the form card, for the outcome of the last save or delete: a
  // second line in the history card pushed the panel's pager off the screen.
  const [formMsg, setFormMsg] = useState(null) // { error, text }
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const closeConfirm = useCallback(() => setConfirmDelete(null), [])
  const [page, setPage] = useState(1)
  // Ten where they fit; three on the 7" panel and on phones. There every row is
  // a 44px touch target and the pager wraps to two lines beside the form, so
  // five, as on Inventory, left the pager below the bottom of the screen.
  const [perPage, setPerPage] = useState(() =>
    window.matchMedia('(min-width: 768px) and (min-height: 680px)').matches ? 10 : 3)
  const formRef = useRef(null)

  const load = useCallback(async () => {
    try {
      const res = await api.get('/feed/purchases')
      setData(res.data)
      setLoadError(false)
      return res.data
    } catch {
      setLoadError(true)
      return null
    }
  }, [])

  useEffect(() => {
    load().then(d => d && setForm(blankForm(d.status)))
  }, [load])

  const setField = (key, value) => setForm(f => ({ ...f, [key]: value }))

  async function submit(e) {
    e.preventDefault()
    setFormMsg(null)
    setSaving(true)
    const body = { purchased_on: form.purchased_on, amount: Number(form.amount), notes: form.notes }
    try {
      if (form.id) await api.put(`/feed/purchases/${form.id}`, body)
      else await api.post('/feed/purchases', body)
      setFormMsg({ text: form.id ? 'Purchase updated.' : 'Purchase recorded.' })
      const d = await load()
      if (d) setForm(blankForm(d.status))
    } catch (err) {
      setFormMsg({ error: true, text: err.response?.data?.error || 'Could not save the purchase.' })
    } finally {
      setSaving(false)
    }
  }

  function startEdit(p) {
    setFormMsg(null)
    setForm({ id: p.id, purchased_on: p.purchased_on, amount: String(p.amount), notes: p.notes })
    // Stacked, the form is above the list the Edit button was tapped in.
    formRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }

  async function doDelete() {
    const target = confirmDelete
    setDeleting(true)
    setFormMsg(null)
    try {
      await api.delete(`/feed/purchases/${target.id}`)
      setFormMsg({ text: 'Purchase deleted.' })
      const d = await load()
      if (d && form?.id === target.id) setForm(blankForm(d.status))
    } catch (err) {
      setFormMsg({ error: true, text: err.response?.data?.error || 'Could not delete the purchase.' })
    } finally {
      setDeleting(false)
      setConfirmDelete(null)
    }
  }

  const status = data?.status
  const purchases = data?.purchases || []
  const pages = Math.max(1, Math.ceil(purchases.length / perPage))
  const current = Math.min(page, pages) // a delete can take the last page away
  const shown = purchases.slice((current - 1) * perPage, current * perPage)
  const editing = !!form?.id

  return (
    <div className="flex flex-col gap-section grow">
      {/* The alert rides in the header, as on the dashboard: a row of its own
          pushed the fifth purchase below the 7" panel. */}
      <PageHeader title="Feed"
        meta={status ? `bought every ${status.interval_days} days` : undefined}
        actions={status && <FeedAlert status={status} />} />

      {loadError && !data ? (
        <section className="glass-card px-[var(--pad-card)]">
          <EmptyState compact icon={AlertCircle} title="Couldn't load feed purchases"
            message="Check the connection to the server, then try again."
            actionLabel="Try again" onAction={() => load().then(d => d && setForm(blankForm(d.status)))} />
        </section>
      ) : !data ? (
        <div className="flex flex-col gap-3" aria-hidden="true">
          {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} height={16} />)}
        </div>
      ) : (
        <>
          {/* Side by side from md, so on the 7" panel the history sits beside the
              form instead of a screen below it. */}
          <div className="grid grid-cols-1 md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] gap-grid items-start">
            <section ref={formRef} aria-labelledby="feed-form-heading"
              className="glass-card card-pad md:sticky md:top-0">
              <SectionHeader id="feed-form-heading" title={editing ? 'Edit purchase' : 'Record purchase'}
                className="mb-2.5" />
              <form onSubmit={submit} className="flex flex-col gap-2.5">
                <div className="grid grid-cols-2 gap-2.5">
                  <label className="flex flex-col gap-1 min-w-0">
                    <span className="eyebrow">Date</span>
                    <input type="date" required value={form.purchased_on} min="2000-01-01" max={status.today}
                      onChange={e => setField('purchased_on', e.target.value)}
                      className="neu-input w-full py-1.5 text-[13px]" />
                  </label>
                  <label className="flex flex-col gap-1 min-w-0">
                    <span className="eyebrow">Amount (₱)</span>
                    <input type="number" required min="0.01" max="99999999.99" step="0.01" inputMode="decimal"
                      value={form.amount} onChange={e => setField('amount', e.target.value)}
                      className="neu-input w-full py-1.5 text-[13px] tabular-nums" />
                  </label>
                </div>
                <label className="flex flex-col gap-1">
                  <span className="eyebrow">Notes (optional)</span>
                  <input type="text" maxLength={255} value={form.notes} placeholder="Supplier, bags, feed type"
                    onChange={e => setField('notes', e.target.value)}
                    className="neu-input w-full py-1.5 text-[13px]" />
                </label>

                {formMsg && (
                  <p role={formMsg.error ? 'alert' : 'status'}
                    className={`m-0 flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium ${formMsg.error
                      ? 'border-negative/25 bg-negative/10 text-negative'
                      : 'border-positive/25 bg-positive/10 text-positive'}`}>
                    {formMsg.error && <AlertCircle size={14} className="shrink-0" aria-hidden="true" />}
                    {formMsg.text}
                  </p>
                )}

                <div className="flex justify-end gap-2">
                  {editing && (
                    <Button type="button" variant="ghost" size="sm"
                      onClick={() => { setFormMsg(null); setForm(blankForm(status)) }}>
                      Cancel
                    </Button>
                  )}
                  <Button type="submit" size="sm" icon={Save} loading={saving}>
                    {editing ? 'Save changes' : 'Record purchase'}
                  </Button>
                </div>
              </form>
            </section>

            <section aria-labelledby="feed-history-heading" className="glass-card overflow-hidden">
              <SectionHeader id="feed-history-heading" title="Purchase history"
                meta={purchases.length > 0
                  ? `${purchases.length} purchase${purchases.length === 1 ? '' : 's'}` : undefined}
                className="card-pad border-b border-rule" />

              {purchases.length === 0 ? (
                <div className="px-[var(--pad-card)]">
                  <EmptyState compact icon={Wheat} title="No purchases yet"
                    message="Recorded feed purchases appear here, newest first." />
                </div>
              ) : (
                <ul aria-label="Feed purchases" className="list-none m-0 p-0 divide-y divide-rule">
                  {shown.map(p => {
                    const day = formatDay(p.purchased_on, status.today)
                    return (
                      <li key={p.id}
                        className={`grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 py-1 px-[var(--pad-card)]
                          [@media(pointer:coarse)]:py-0
                          ${form?.id === p.id ? 'bg-[var(--btn-secondary-bg)]' : ''}`}>
                        <div className="min-w-0">
                          <p className="m-0 text-[13px] text-text-primary">{day}</p>
                          {p.notes && <p className="meta m-0 truncate">{p.notes}</p>}
                        </div>
                        <p className="m-0 text-[13px] font-semibold text-text-primary tabular-nums">
                          {formatPeso(p.amount)}
                        </p>
                        <div className="flex items-center gap-1">
                          <button type="button" onClick={() => startEdit(p)} className="icon-btn"
                            aria-label={`Edit purchase from ${day}`} title="Edit">
                            <Pencil size={14} />
                          </button>
                          <button type="button" onClick={() => setConfirmDelete(p)} className="icon-btn"
                            aria-label={`Delete purchase from ${day}`} title="Delete">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}

              {purchases.length > 0 && (
                <Pager page={current} pages={pages} total={purchases.length}
                  perPage={perPage} options={PER_PAGE_OPTIONS}
                  onPage={setPage} onPerPage={n => { setPerPage(n); setPage(1) }} />
              )}
            </section>
          </div>
        </>
      )}

      <Modal open={!!confirmDelete} onClose={closeConfirm} size="sm" title="Delete this purchase?"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={closeConfirm}>Cancel</Button>
            <Button variant="danger" size="sm" icon={Trash2} loading={deleting} onClick={doDelete}>Delete</Button>
          </>
        }>
        {confirmDelete && (
          <p className="text-sm text-text-secondary">
            <span className="text-text-primary font-medium">
              {formatDay(confirmDelete.purchased_on, status?.today)} · {formatPeso(confirmDelete.amount)}
            </span>
            {' '}will be removed, and the next purchase worked out from the ones that remain.
          </p>
        )}
      </Modal>
    </div>
  )
}
