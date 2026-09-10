import React, { useEffect, useState, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { io } from 'socket.io-client'
import api, { rawApi } from '../utils/api'
import { Play, Square, Save, Lock, CheckCircle2, XCircle, WifiOff, Undo2 } from 'lucide-react'
import { Button, Modal, StatusIndicator } from './ui'
import useAuthStore from '../store/authStore'

const VARIANT = 'SPIN_20'
const UNDO_WINDOW_MS = 10000

/* ──────────────────────────────────────────────────────────────
   Toast — carries an optional Undo, because the save it confirms
   is otherwise irreversible from this screen.
   ────────────────────────────────────────────────────────────── */
function Toast({ toast, onUndo }) {
  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          key={toast.id}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.15 }}
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3
            px-5 py-3 rounded-xl text-sm font-semibold border shadow-lg
            ${toast.type === 'error'
              ? 'bg-accent-red/10 border-accent-red/25 text-accent-red'
              : 'bg-accent-green/10 border-accent-green/25 text-accent-green'}`}
        >
          {toast.type === 'error'
            ? <XCircle className="w-4 h-4 shrink-0" />
            : <CheckCircle2 className="w-4 h-4 shrink-0" />}
          {toast.message}
          {toast.undoId != null && (
            <button
              onClick={onUndo}
              className="ml-1 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1
                text-xs font-bold border border-current/30 hover:bg-current/10 transition-colors"
            >
              <Undo2 className="w-3.5 h-3.5" /> Undo
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* Elapsed wall-clock for the running session, as mm:ss or h:mm:ss. */
function formatElapsed(ms) {
  if (ms == null || ms < 0) return '—'
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = n => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

export default function Counter() {
  const user = useAuthStore(s => s.user)

  const [count, setCount] = useState(0)
  const [active, setActive] = useState(false)
  // Starts false so the disconnected banner never flashes on a normal load;
  // it appears only once a connection has actually dropped or failed.
  const [offline, setOffline] = useState(false)
  const [device, setDevice] = useState({ id: null, name: null })
  const [session, setSession] = useState(null)
  const [lockWarning, setLockWarning] = useState('')
  const [loadError, setLoadError] = useState('')

  const [isSaving, setIsSaving] = useState(false)
  const [confirmSave, setConfirmSave] = useState(false)
  const [confirmStart, setConfirmStart] = useState(false)
  const [toast, setToast] = useState(null)
  const [now, setNow] = useState(Date.now())

  // Rate is derived from observed count deltas rather than asked of the
  // backend: the operator needs to see the line moving, not an exact figure.
  const rateRef = useRef({ lastCount: 0, lastAt: null, perMin: null })
  const [rate, setRate] = useState(null)
  const toastTimer = useRef(null)

  const userId = user?.id != null ? String(user.id) : 'unknown'

  const showToast = useCallback((message, type = 'success', undoId = null) => {
    const id = Date.now()
    setToast({ id, message, type, undoId })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(
      () => setToast(prev => (prev?.id === id ? null : prev)),
      undoId != null ? UNDO_WINDOW_MS : 3500
    )
  }, [])

  const fetchState = useCallback(async () => {
    try {
      // In parallel: these two do not depend on each other, and on the panel
      // three chained round-trips every poll is what made the screen feel slow.
      const [res, r2] = await Promise.all([
        rawApi.get('/get_state'),
        rawApi.get('/get_count'),
      ])
      const d = res.data || {}
      setActive(!!d.active)
      setDevice({ id: d.device_id || null, name: d.device_name || null })
      setSession(d.session || null)
      setLoadError('')
      setCount(r2.data.count || 0)

      if (d.device_id) {
        try {
          const ls = await api.get(`/devices/${d.device_id}/lock_status`)
          const data = ls?.data
          if (data?.locked && data.locked_by !== userId) {
            setLockWarning('In use by another user')
          } else setLockWarning('')
        } catch { /* lock status is advisory; never block the screen on it */ }
      }
    } catch (e) {
      setLoadError(e.response?.data?.message || 'Could not reach the counter service.')
    }
  }, [userId])

  useEffect(() => {
    fetchState()
    const socket = io()
    socket.on('connect', () => { setOffline(false); fetchState() })
    socket.on('disconnect', () => setOffline(true))
    socket.on('connect_error', () => setOffline(true))
    socket.on('reading', data => {
      if (data && typeof data.count !== 'undefined') setCount(data.count)
    })
    socket.on('counting_state', d => {
      setActive(!!d.active)
      if (!d.active) setLockWarning('')
      fetchState()
    })
    // Belt and braces behind the live feed: the panel must keep advancing even
    // if the socket is wedged.
    const poll = setInterval(fetchState, 5000)
    return () => { clearInterval(poll); socket.disconnect() }
  }, [fetchState])

  // Ticks the elapsed clock while a run is open.
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])

  // Track throughput across count updates.
  useEffect(() => {
    if (!active) {
      rateRef.current = { lastCount: count, lastAt: null, perMin: null }
      setRate(null)
      return
    }
    const r = rateRef.current
    const at = Date.now()
    if (r.lastAt && count > r.lastCount) {
      const minutes = (at - r.lastAt) / 60000
      if (minutes > 0.02) {
        const instant = (count - r.lastCount) / minutes
        // Smoothed: raw per-tick rates swing too hard to read at a glance.
        r.perMin = r.perMin == null ? instant : r.perMin * 0.7 + instant * 0.3
        setRate(Math.round(r.perMin))
        r.lastCount = count
        r.lastAt = at
      }
    } else if (!r.lastAt) {
      r.lastCount = count
      r.lastAt = at
    }
  }, [count, active])

  const startedAt = session?.started_at
    ? new Date(session.started_at.replace(' ', 'T')).getTime()
    : null
  const elapsed = active && startedAt ? now - startedAt : null

  async function start() {
    try {
      if (device.id) {
        // Advisory, exactly as in fetchState. Only a real conflict — someone
        // else mid-run (423) — stops the operator. Any other reservation
        // failure is bookkeeping, and bookkeeping must never leave a dead
        // Start button in front of someone with fish to count.
        try {
          await api.post(`/devices/${device.id}/lock`)
        } catch (e) {
          if (e.response?.status === 423) {
            showToast('Another user is counting right now', 'error')
            setLockWarning('In use by another user')
            return
          }
        }
      }
      await rawApi.get(`/start?variant=${encodeURIComponent(VARIANT)}`)
      setActive(true)
      showToast('Counting started')
      fetchState()
    } catch (e) {
      showToast(e.response?.data?.message || 'Could not start counting', 'error')
    }
  }

  async function stopCounting() {
    await rawApi.get('/stop')
    setActive(false)
    if (device.id) {
      try { await api.post(`/devices/${device.id}/unlock`) }
      catch { /* advisory */ }
    }
  }

  /* Ending a run must never depend on having something worth saving. Stop was
     previously only reachable through "Stop & Save", which is disabled until
     the count passes zero — so a run started by mistake could not be ended at
     all until a fish happened to cross the line. Stopping keeps the count
     (the backend clears it on the next start, not on stop), so this discards
     nothing and Save stays available afterwards. */
  async function handleStop() {
    try {
      await stopCounting()
      showToast(count > 0 ? 'Stopped — the count is kept until you save it' : 'Stopped')
      fetchState()
    } catch (e) {
      showToast(e.response?.data?.message || 'Could not stop counting', 'error')
    }
  }

  /* One action. Stopping and saving used to be two steps with a disabled
     button in between and nothing on screen explaining why. */
  async function handleStopAndSave() {
    setIsSaving(true)
    try {
      if (active) await stopCounting()
      const fresh = (await rawApi.get('/get_count')).data.count || 0
      const toSave = fresh || count
      if (toSave <= 0) {
        showToast('Nothing counted to save', 'error')
        return
      }

      const res = await rawApi.post('/save_inventory',
        { count: toSave, variant: VARIANT, notes: '', action: 'WHOLESALE' })
      try { await rawApi.post('/update_count', { count: 0 }) } catch { /* best effort */ }
      setCount(0)
      showToast(`Saved ${toSave.toLocaleString()} ${VARIANT}`, 'success', res.data?.id ?? null)
      fetchState()
    } catch (e) {
      showToast(e.response?.data?.message || 'Save failed', 'error')
    } finally {
      setIsSaving(false)
      setConfirmSave(false)
    }
  }

  async function handleUndo() {
    const id = toast?.undoId
    if (id == null) return
    setToast(null)
    try {
      await rawApi.post(`/undo_save/${id}`)
      showToast('Save undone')
      fetchState()
    } catch (e) {
      showToast(e.response?.data?.message || 'Could not undo', 'error')
    }
  }

  const canSave = count > 0 && !isSaving

  /* A count on screen that has not been saved yet. Start zeroes the counter
     (backend/api/counting.py sets runtime.fish_count = 0), so from here Start
     is the destructive control and Save is the one the operator wants. */
  const unsaved = !active && count > 0

  function handleStartClick() {
    if (unsaved) { setConfirmStart(true); return }
    start()
  }

  return (
    /* Sized to the shortest screen this runs on — a 1024x600 Pi panel — so the
       count and both controls are reachable without scrolling. dvh, not vh: on
       a phone vh counts the space behind the browser's own address bar, so the
       Start/Save row sat below the fold until the bar collapsed. */
    <div className="flex flex-col gap-3 w-full max-w-4xl mx-auto"
      style={{ minHeight: 'calc(100dvh - 4rem)' }}>

      <Modal
        open={confirmSave}
        onClose={() => !isSaving && setConfirmSave(false)}
        title="Save this count?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmSave(false)} disabled={isSaving}>Cancel</Button>
            <Button variant="primary" icon={Save} loading={isSaving} onClick={handleStopAndSave}>
              {isSaving ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-text-secondary">
          {count.toLocaleString()} {VARIANT} will be added to inventory.
          You can undo this for a short time afterwards.
        </p>
      </Modal>

      <Modal
        open={confirmStart}
        onClose={() => setConfirmStart(false)}
        title="Discard the counted fish?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmStart(false)}>Cancel</Button>
            <Button variant="danger" icon={Play}
              onClick={() => { setConfirmStart(false); start() }}>
              Discard and start
            </Button>
          </>
        }
      >
        <p className="text-sm text-text-secondary">
          {count.toLocaleString()} {VARIANT} have been counted but not saved.
          Starting a new run resets the counter to zero.
        </p>
      </Modal>

      <Toast toast={toast} onUndo={handleUndo} />

      {/* ── Context strip ──
             What this run is, on what, by whom. These were three bare values
             in a row — "SPIN_20  Fish Counter  admin" — with nothing saying
             which was the product, which the machine and which the person, so
             the top line of the kiosk screen read as three unrelated words.
             Elapsed time has moved out of here and under the count, where the
             operator is already looking. ── */}
      <dl className="glass-card card-pad py-2 flex flex-wrap items-center gap-x-5 gap-y-1 shrink-0 m-0">
        <div className="flex items-baseline gap-1.5">
          <dt className="eyebrow">Variant</dt>
          <dd className="m-0 text-xs font-semibold text-text-primary">{VARIANT}</dd>
        </div>
        <div className="flex items-baseline gap-1.5 min-w-0">
          <dt className="eyebrow">Counter</dt>
          <dd className="m-0 text-xs text-text-secondary truncate">
            {device.name || (device.id ? device.id.slice(0, 8) : 'none detected')}
          </dd>
        </div>
        <div className="flex items-baseline gap-1.5 min-w-0">
          <dt className="eyebrow">Operator</dt>
          <dd className="m-0 text-xs text-text-secondary truncate">
            {session?.username || user?.username || '—'}
          </dd>
        </div>
        <span className="ml-auto">
          <StatusIndicator status={active ? 'active' : 'idle'} label={active ? 'Counting' : 'Idle'} />
        </span>
      </dl>

      {offline && (
        <div className="flex items-center gap-2 rounded-lg border border-accent-amber/25 bg-accent-amber/10
          px-4 py-2 text-xs font-semibold text-accent-amber shrink-0">
          <WifiOff className="w-4 h-4 shrink-0" />
          Live updates disconnected — the count may be behind. Reconnecting…
        </div>
      )}

      {loadError && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-accent-red/25 bg-accent-red/10
          px-4 py-2 text-xs font-semibold text-accent-red shrink-0">
          {loadError}
          <button onClick={fetchState} className="underline underline-offset-2 hover:no-underline">Retry</button>
        </div>
      )}

      {lockWarning && (
        <div className="flex items-center gap-2 rounded-lg border border-accent-amber/25 bg-accent-amber/10
          px-4 py-2 text-xs font-semibold text-accent-amber shrink-0">
          <Lock className="w-4 h-4 shrink-0" /> {lockWarning}
        </div>
      )}

      {/* ── The count fills the frame. It is the only thing on this screen
             anyone reads from across a room. ── */}
      <div className="glass-card count-frame flex-1 min-h-0 overflow-hidden
        flex flex-col items-center justify-center gap-2 p-4">
        <p className="eyebrow">Fish counted</p>
        {/* Sizing lives in .count-value, which needs to know how wide the
            number is: a six-figure count has to step down or it runs past the
            edge of the frame. Leading is tightened so the glyph fills the
            space rather than its line box. */}
        {/* pb reserves the comma's descender. leading-[0.85] deliberately makes
            the line box shorter than the glyphs so the digits fill the frame,
            which means anything below the baseline spills out of the box — at
            181px the comma in "300,000" was landing on top of the status line
            underneath it. Padding in em keeps that reservation proportional at
            every size the clamp produces. */}
        {/* Set in the primary text colour, not the brand green. This is the one
            glyph on the system that has to be read from the other side of a
            wet-floored shed, and on the dark ground #7cb342 measures about
            6.4:1 against the card while the primary off-white measures about
            13.8:1 — more than double the contrast, for a number whose whole job
            is to be legible at distance. Green stays where it means something:
            the status dot, and a figure that has gone up. */}
        <p
          className="count-value font-bold tabular-nums leading-[0.85] pb-[0.14em] text-text-primary"
          aria-live="polite"
          style={{ '--count-chars': count.toLocaleString().length }}
        >
          {count.toLocaleString()}
        </p>
        {/* Both pieces of run telemetry sit here rather than in 12px grey at the
            top of the screen: while a run is open this line is directly under
            the number the operator is already watching. Fixed height so the
            count does not jump when the wording changes. */}
        <p className="text-sm text-text-secondary tabular-nums h-5">
          {active
            ? (
              <>
                <span>{formatElapsed(elapsed)} elapsed</span>
                <span className="text-text-muted"> · </span>
                <span>{rate != null ? `${rate.toLocaleString()} fish/min` : 'measuring rate…'}</span>
              </>
            )
            : count > 0 ? 'Stopped — ready to save' : 'Press Start to begin'}
        </p>
      </div>

      {/* ── Actions pinned to the bottom, thumb height, always in the same place ── */}
      <div className="grid grid-cols-2 gap-3 shrink-0">
        {/* Secondary whenever there is a count worth losing: two identical
             green slabs, one of which quietly discards the run, is not a choice
             anyone should have to read twice on a touch panel. */}
        <Button
          variant={active || unsaved ? 'secondary' : 'primary'}
          icon={active ? Square : Play}
          onClick={active ? handleStop : handleStartClick}
          className="!py-0 h-16 text-sm sm:text-base font-bold"
        >
          {active ? 'Stop' : unsaved ? 'Start over' : 'Start'}
        </Button>
        <Button
          variant={canSave ? 'primary' : 'secondary'}
          icon={Save}
          loading={isSaving}
          disabled={!canSave}
          onClick={() => setConfirmSave(true)}
          className="!py-0 h-16 text-sm sm:text-base font-bold"
        >
          {active ? 'Stop & Save' : 'Save'}
        </Button>
      </div>
      {!canSave && !active && count === 0 && (
        <p className="meta text-center shrink-0 -mt-1">
          Save becomes available once fish have been counted.
        </p>
      )}
    </div>
  )
}
