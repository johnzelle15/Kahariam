import React, { useEffect, useState, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import api, { rawApi } from '../utils/api'
import { Play, Save, Lock, CheckCircle2, XCircle, WifiOff, Undo2 } from 'lucide-react'
import { Button, Modal } from './ui'
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
  const [socketConnected, setSocketConnected] = useState(false)
  const [hasSocket, setHasSocket] = useState(false)
  const [device, setDevice] = useState({ id: null, name: null })
  const [session, setSession] = useState(null)
  const [lockWarning, setLockWarning] = useState('')
  const [loadError, setLoadError] = useState('')

  const [isSaving, setIsSaving] = useState(false)
  const [confirmSave, setConfirmSave] = useState(false)
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
      const res = await rawApi.get('/get_state')
      const d = res.data || {}
      setActive(!!d.active)
      setDevice({ id: d.device_id || null, name: d.device_name || null })
      setSession(d.session || null)
      setLoadError('')

      const r2 = await rawApi.get('/get_count')
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
    if (typeof window !== 'undefined' && window.io) {
      setHasSocket(true)
      const socket = window.io()
      socket.on('connect', () => { setSocketConnected(true); fetchState() })
      socket.on('disconnect', () => setSocketConnected(false))
      socket.on('reading', data => {
        if (data && typeof data.count !== 'undefined') setCount(data.count)
      })
      socket.on('counting_state', d => {
        setActive(!!d.active)
        if (!d.active) setLockWarning('')
        fetchState()
      })
      const poll = setInterval(fetchState, 5000)
      return () => { clearInterval(poll); socket.off('reading'); socket.off('counting_state'); socket.disconnect() }
    }
    // No socket transport: fall back to polling so the count still advances.
    const poll = setInterval(fetchState, 2000)
    return () => clearInterval(poll)
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
        const lockRes = await api.post(`/devices/${device.id}/lock`)
        if (lockRes?.data?.status !== 'ok') {
          showToast('Could not reserve the counter', 'error')
          return
        }
      }
      await rawApi.get(`/start?variant=${encodeURIComponent(VARIANT)}`)
      setActive(true)
      showToast('Counting started')
      fetchState()
    } catch (e) {
      const err = e.response?.data
      if (err?.status === 'locked') {
        showToast('Another user is counting right now', 'error')
        setLockWarning('In use by another user')
      } else {
        showToast(err?.message || 'Could not start counting', 'error')
      }
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

  const offline = hasSocket && !socketConnected
  const canSave = count > 0 && !isSaving

  return (
    /* Sized to the shortest screen this runs on — a 1024x600 Pi panel — so the
       count and both controls are reachable without scrolling. */
    <div className="flex flex-col gap-3" style={{ minHeight: 'calc(100vh - 4rem)' }}>

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

      <Toast toast={toast} onUndo={handleUndo} />

      {/* ── Context strip: everything about the run in one line ── */}
      <div className="glass-card px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs shrink-0">
        <span className="font-bold text-text-primary">{VARIANT}</span>
        <span className="text-text-muted">
          {device.name || (device.id ? `Counter ${device.id.slice(0, 8)}` : 'No counter device')}
        </span>
        <span className="text-text-muted">{session?.username || user?.username || '—'}</span>
        {active && <span className="text-text-muted tabular-nums">{formatElapsed(elapsed)} elapsed</span>}
        <span className="ml-auto inline-flex items-center gap-2 font-semibold">
          <span className={`h-2 w-2 rounded-full ${active ? 'bg-accent-green animate-pulse' : 'bg-text-muted'}`} />
          <span className={active ? 'text-accent-green' : 'text-text-muted'}>
            {active ? 'Counting' : 'Idle'}
          </span>
        </span>
      </div>

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
      <div className="glass-card flex-1 min-h-0 flex flex-col items-center justify-center gap-2 p-4">
        <p className="text-xs font-bold text-text-muted uppercase tracking-wider">Fish counted</p>
        <p className="font-bold tabular-nums leading-none text-accent-green"
          style={{ fontSize: 'clamp(3.5rem, 16vh, 8rem)' }}>
          {count.toLocaleString()}
        </p>
        <p className="text-sm text-text-muted tabular-nums h-5">
          {active
            ? (rate != null ? `${rate.toLocaleString()} fish/min` : 'measuring rate…')
            : count > 0 ? 'Stopped — ready to save' : 'Press Start to begin'}
        </p>
      </div>

      {/* ── Actions pinned to the bottom, thumb height, always in the same place ── */}
      <div className="grid grid-cols-2 gap-3 shrink-0">
        <Button
          variant={active ? 'secondary' : 'primary'}
          icon={Play}
          disabled={active}
          onClick={start}
          className="!py-0 h-16 text-base font-bold"
        >
          {active ? 'Counting…' : 'Start'}
        </Button>
        <Button
          variant={canSave ? 'primary' : 'secondary'}
          icon={Save}
          loading={isSaving}
          disabled={!canSave}
          onClick={() => setConfirmSave(true)}
          className="!py-0 h-16 text-base font-bold"
        >
          {active ? 'Stop & Save' : 'Save'}
        </Button>
      </div>
      {!canSave && !active && count === 0 && (
        <p className="text-xs text-text-muted text-center shrink-0 -mt-1">
          Save becomes available once fish have been counted.
        </p>
      )}
    </div>
  )
}
