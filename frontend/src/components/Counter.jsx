import React, { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import axios from 'axios'
import { rawApi } from '../utils/api'
import { Play, Square, Save, Lock, Loader2, CheckCircle2, XCircle } from 'lucide-react'
import { Button, Card, Modal, PageHeader, StatusIndicator } from './ui'

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
  const [variant, setVariant] = useState('SPIN_20')
  const [count, setCount] = useState(0)
  const [active, setActive] = useState(false)
  const [socketConnected, setSocketConnected] = useState(false)

  // Save flow state
  const [isSaving, setIsSaving] = useState(false)
  const [isSaved, setIsSaved] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState(false)
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
      const res = await rawApi.get('/get_state')
      setActive(!!res.data.active)
      const r2 = await rawApi.get('/get_count')
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
        await rawApi.get('/start')
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
      await rawApi.get('/stop')
      setActive(false)
      const r = await rawApi.get('/get_count')
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
      const r = await rawApi.get('/get_count')
      setCount(r.data.count || 0)
    } catch { /* ignore */ }
    setTimeout(poll, 1000)
  }

  // ── Save handlers with confirmation ────────────────────────

  function requestSave() {
    if (isSaving || isSaved) return
    setConfirmDialog(true)
  }

  async function handleConfirmSave() {
    if (isSaving || isSaved || !confirmDialog) return
    setIsSaving(true)
    try {
      await rawApi.post('/save_inventory', { count, variant, notes: '', action: 'WHOLESALE' })
      showToast('Saved to inventory')
      // Reset count on backend and locally so re-saving is impossible even after tab switch
      try { await rawApi.post('/update_count', { count: 0 }) } catch { /* ignore */ }
      setCount(0)
      setIsSaved(true)
    } catch {
      showToast('Save failed', 'error')
    } finally {
      setIsSaving(false)
      setConfirmDialog(false)
    }
  }

  const saveDisabled = count <= 0 || isSaving || isSaved || active

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {/* Save confirmation modal */}
      <Modal
        open={!!confirmDialog}
        onClose={() => !isSaving && setConfirmDialog(false)}
        title="Save to Inventory?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDialog(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button variant="primary" icon={Save} loading={isSaving} onClick={handleConfirmSave}>
              {isSaving ? 'Saving…' : 'Confirm'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-text-secondary">
          Are you sure you want to save {count} {variant} fish to inventory? This cannot be undone.
        </p>
      </Modal>

      {/* Toast */}
      <Toast toast={toast} onDismiss={() => setToast(null)} />

      <PageHeader
        title="AI Fish Counter"
        actions={
          <StatusIndicator
            status={socketConnected ? 'active' : 'idle'}
            label={socketConnected ? 'Live Connected' : 'Disconnected'}
          />
        }
      />

      {lockWarning && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 rounded-xl border border-accent-amber/20 bg-accent-amber/10
            px-4 py-2 text-sm font-semibold text-accent-amber"
        >
          <Lock className="w-4 h-4 shrink-0" /> {lockWarning}
        </motion.div>
      )}

      {/* Controls */}
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-2 basis-full sm:basis-auto sm:min-w-[160px]">
            <label className="text-xs font-bold text-text-muted uppercase tracking-wider">Variant</label>
            <select value={variant} onChange={e => setVariant(e.target.value)} className="neu-input w-full">
              <option>SPIN_20</option>
            </select>
          </div>
          <Button className="flex-1 sm:flex-none" variant="primary" size="lg" icon={Play} disabled={active} onClick={start}>
            Start
          </Button>
          <Button className="flex-1 sm:flex-none" variant="danger" size="lg" icon={Square} disabled={!active} onClick={stop}>
            Stop
          </Button>
        </div>
      </Card>

      {/* Count Display */}
      <Card className="text-center">
        <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-3">Current Count</h3>
        <div className="relative">
          <p className="text-6xl sm:text-8xl font-black text-accent-green leading-none">
            {count}
          </p>
          {active && (
            <div className="absolute -inset-4 rounded-2xl"
              style={{ boxShadow: '0 0 30px rgba(124, 179, 66, 0.12)' }} />
          )}
        </div>

        <div className="mt-6 flex items-center justify-center">
          <Button
            variant="primary"
            size="lg"
            icon={isSaved ? CheckCircle2 : Save}
            loading={isSaving}
            disabled={saveDisabled}
            className={isSaved ? 'opacity-40 cursor-not-allowed saturate-0' : ''}
            onClick={requestSave}
          >
            {isSaving ? 'Saving…' : isSaved ? 'Saved' : 'Save to Inventory'}
          </Button>
        </div>
      </Card>
    </div>
  )
}
