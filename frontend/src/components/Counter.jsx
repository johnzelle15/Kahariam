import React, { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import axios from 'axios'
import { Play, Square, Save, Wifi, WifiOff, Lock, Warehouse, Loader2, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react'

/* ──────────────────────────────────────────────────────────────
   Confirmation Modal
   ────────────────────────────────────────────────────────────── */
function ConfirmDialog({ open, title, description, onConfirm, onCancel, loading }) {
  if (!open) return null
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
          onClick={onCancel}
        >
          <motion.div
            key="dialog"
            initial={{ opacity: 0, scale: 0.92, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 12 }}
            transition={{ type: 'spring', damping: 26, stiffness: 350 }}
            className="glass-card w-full max-w-sm p-6 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-accent-amber/10">
                <AlertTriangle className="w-5 h-5 text-accent-amber" />
              </div>
              <div>
                <h3 className="text-base font-bold text-text-primary">{title}</h3>
                <p className="text-sm text-text-muted mt-1">{description}</p>
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={onCancel}
                disabled={loading}
                className="px-4 py-2 text-sm font-semibold rounded-xl text-text-muted
                  bg-white/5 border border-white/10 hover:bg-white/10 transition-colors
                  disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                disabled={loading}
                className="glow-btn flex items-center gap-2 !py-2 !px-4 !text-sm disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  'Confirm'
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* ──────────────────────────────────────────────────────────────
   Toast Notification
   ────────────────────────────────────────────────────────────── */
function Toast({ toast, onDismiss }) {
  if (!toast) return null
  const isError = toast.type === 'error'
  return (
    <AnimatePresence>
      <motion.div
        key={toast.id}
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.95 }}
        className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5
          px-5 py-3 rounded-2xl text-sm font-semibold shadow-xl border
          ${isError
            ? 'bg-red-500/10 border-red-500/20 text-red-400'
            : 'bg-accent-green/10 border-accent-green/20 text-accent-green'
          }`}
      >
        {isError
          ? <XCircle className="w-4.5 h-4.5 shrink-0" />
          : <CheckCircle2 className="w-4.5 h-4.5 shrink-0" />}
        {toast.message}
      </motion.div>
    </AnimatePresence>
  )
}

/* ──────────────────────────────────────────────────────────────
   Counter Component
   ────────────────────────────────────────────────────────────── */
export default function Counter() {
  const DEVICE_ID = 'test-device'

  function getUserId() {
    let uid = localStorage.getItem('fc_user_id')
    if (!uid) {
      uid = 'user-' + Math.random().toString(36).substr(2, 9)
      localStorage.setItem('fc_user_id', uid)
    }
    return uid
  }

  const [lockWarning, setLockWarning] = useState('')
  const [variant, setVariant] = useState('Black')
  const [count, setCount] = useState(0)
  const [active, setActive] = useState(false)
  const [socketConnected, setSocketConnected] = useState(false)

  // Save flow state
  const [isSaving, setIsSaving] = useState(false)
  const [isSaved, setIsSaved] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState(null) // { target: 'tank' | 'wholesale' }
  const [toast, setToast] = useState(null)

  const showToast = useCallback((message, type = 'success') => {
    const id = Date.now()
    setToast({ id, message, type })
    setTimeout(() => setToast(prev => prev?.id === id ? null : prev), 3500)
  }, [])

  useEffect(() => {
    fetchState()
    if (typeof window !== 'undefined' && window.io) {
      const socket = window.io()
      socket.on('connect', () => { setSocketConnected(true); fetchState() })
      socket.on('disconnect', () => setSocketConnected(false))
      socket.on('reading', data => {
        if (data && typeof data.count !== 'undefined') setCount(data.count)
      })
      socket.on('counting_state', d => {
        setActive(!!d.active)
        if (!d.active) setLockWarning('')
      })
      const interval = setInterval(fetchState, 5000)
      return () => {
        clearInterval(interval)
        socket.off('reading')
        socket.off('counting_state')
        socket.disconnect()
      }
    }
  }, [])

  async function fetchState() {
    try {
      const res = await axios.get('/get_state')
      setActive(!!res.data.active)
      const r2 = await axios.get('/get_count')
      setCount(r2.data.count || 0)
      try {
        const uid = getUserId()
        const ls = await axios.get(`/api/v1/devices/${DEVICE_ID}/lock_status`)
        const data = ls?.data
        if (!data || typeof data !== 'object') { setLockWarning('') }
        else if (data.locked) {
          setLockWarning(data.locked_by === uid ? 'You have the lock' : `Device locked by ${data.locked_by}`)
        } else { setLockWarning('') }
      } catch { /* ignore */ }
    } catch (e) { console.error(e) }
  }

  async function start() {
    try {
      const uid = getUserId()
      const lockRes = await axios.post(`/api/v1/devices/${DEVICE_ID}/lock`, { user_id: uid })
      if (lockRes?.data?.status === 'ok') {
        setLockWarning(`Locked by ${uid}`)
        await axios.get('/start')
        setActive(true)
        showToast('Started counting…')
        // Reset save state for a new counting session
        setIsSaved(false)
        poll()
      } else { showToast('Failed to acquire lock', 'error') }
    } catch (e) {
      const err = e.response?.data
      if (err?.status === 'locked') {
        showToast('Device is locked by another user', 'error')
        setLockWarning(`Locked by ${err.locked_by || 'someone'}`)
      } else { showToast(e.response?.data?.message || 'Failed to start', 'error') }
    }
  }

  async function stop() {
    try {
      await axios.get('/stop')
      setActive(false)
      const r = await axios.get('/get_count')
      setCount(r.data.count || 0)
      showToast('Stopped')
      setLockWarning('')
      try {
        const uid = getUserId()
        await axios.post(`/api/v1/devices/${DEVICE_ID}/unlock`, { user_id: uid })
      } catch { /* ignore */ }
    } catch (e) {
      fetchState()
      showToast(e.response?.data?.message || 'Failed to stop', 'error')
    }
  }

  async function poll() {
    if (!active) return
    try {
      const r = await axios.get('/get_count')
      setCount(r.data.count || 0)
    } catch { /* ignore */ }
    setTimeout(poll, 1000)
  }

  // ── Save handlers with confirmation ────────────────────────

  function requestSave(target) {
    if (isSaving || isSaved) return
    setConfirmDialog({ target })
  }

  async function handleConfirmSave() {
    if (isSaving || isSaved || !confirmDialog) return
    const { target } = confirmDialog
    setIsSaving(true)
    try {
      if (target === 'tank') {
        await axios.post('/save_inventory', { count, variant, notes: '', action: 'IN' })
        showToast('Saved to inventory (Tank)')
      } else {
        await axios.post('/save_inventory', { count, variant, notes: '', action: 'WHOLESALE' })
        showToast('Saved to Wholesale Storage')
      }
      // Reset count on backend and locally so re-saving is impossible even after tab switch
      try { await axios.post('/update_count', { count: 0 }) } catch { /* ignore */ }
      setCount(0)
      setIsSaved(true)
    } catch {
      showToast(target === 'tank' ? 'Save to Tank failed' : 'Save to Wholesale failed', 'error')
    } finally {
      setIsSaving(false)
      setConfirmDialog(null)
    }
  }

  const saveDisabled = count <= 0 || isSaving || isSaved || active

  return (
    <div className="max-w-2xl mx-auto space-y-4 sm:space-y-6">
      {/* Confirmation Modal */}
      <ConfirmDialog
        open={!!confirmDialog}
        title={confirmDialog?.target === 'tank' ? 'Save to Tank?' : 'Save to Wholesale Storage?'}
        description={`Are you sure you want to save ${count} ${variant} fish to ${confirmDialog?.target === 'tank' ? 'Tank' : 'Wholesale Storage'}? This cannot be undone.`}
        loading={isSaving}
        onConfirm={handleConfirmSave}
        onCancel={() => !isSaving && setConfirmDialog(null)}
      />

      {/* Toast */}
      <Toast toast={toast} onDismiss={() => setToast(null)} />

      {/* Status */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex justify-center"
      >
        <div className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold
          ${socketConnected ? 'text-accent-green bg-accent-green/10' : 'text-text-muted bg-white/5'}`}>
          {socketConnected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
          {socketConnected ? 'Live Connected' : 'Disconnected'}
        </div>
      </motion.div>

      {lockWarning && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center justify-center gap-2 text-sm font-semibold text-accent-amber"
        >
          <Lock className="w-4 h-4" /> {lockWarning}
        </motion.div>
      )}

      {/* Controls */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="glass-card p-4 sm:p-6"
      >
        <div className="flex flex-wrap items-end gap-3 sm:gap-4">
          <div className="flex flex-col gap-2 min-w-0 flex-1 sm:flex-none sm:min-w-[160px]">
            <label className="text-xs font-bold text-text-muted uppercase tracking-wider">Variant</label>
            <select value={variant} onChange={e => setVariant(e.target.value)} className="neu-input">
              <option>Black</option>
              <option>Platinum</option>
              <option>Pineapple</option>
            </select>
          </div>
          <button onClick={start} disabled={active} className="glow-btn glow-btn-green flex items-center gap-2">
            <Play className="w-4 h-4" /> Start
          </button>
          <button onClick={stop} disabled={!active} className="glow-btn glow-btn-red flex items-center gap-2">
            <Square className="w-4 h-4" /> Stop
          </button>
        </div>
      </motion.div>

      {/* Count Display */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="glass-card stat-glow p-6 sm:p-8 text-center"
      >
        <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-3 sm:mb-4">Current Count</h3>
        <div className="relative">
          <p className="text-5xl sm:text-7xl font-black bg-gradient-to-r from-accent-purple via-accent-blue to-accent-cyan bg-clip-text text-transparent leading-none">
            {count}
          </p>
          {active && (
            <div className="absolute -inset-4 rounded-2xl"
              style={{ boxShadow: '0 0 30px rgba(167, 139, 250, 0.08)' }} />
          )}
        </div>

        <div className="mt-5 sm:mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={() => requestSave('tank')}
            disabled={saveDisabled}
            className={`glow-btn flex items-center gap-2 transition-all duration-200
              ${isSaved ? 'opacity-40 cursor-not-allowed saturate-0' : ''}
              ${isSaving ? 'opacity-60 cursor-wait' : ''}`}
          >
            {isSaving && confirmDialog?.target === 'tank'
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : isSaved
                ? <CheckCircle2 className="w-4 h-4" />
                : <Save className="w-4 h-4" />}
            {isSaved ? 'Saved' : 'Save to Tank'}
          </button>
          <button
            onClick={() => requestSave('wholesale')}
            disabled={saveDisabled}
            className={`glow-btn glow-btn-secondary flex items-center gap-2 transition-all duration-200
              ${isSaved ? 'opacity-40 cursor-not-allowed saturate-0' : ''}
              ${isSaving ? 'opacity-60 cursor-wait' : ''}`}
          >
            {isSaving && confirmDialog?.target === 'wholesale'
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : isSaved
                ? <CheckCircle2 className="w-4 h-4" />
                : <Warehouse className="w-4 h-4" />}
            {isSaved ? 'Saved' : 'Save to Wholesale Storage'}
          </button>
        </div>
      </motion.div>
    </div>
  )
}
