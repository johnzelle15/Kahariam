# Kahariam Counter Screen Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `frontend/src/components/Counter.jsx` on the Kahariam design-system primitives, and lay it out to fit the RPi5 kiosk's 7" touchscreen (effective ~1194×716 viewport) without scrolling.

**Architecture:** Two tasks. Task 1 adds one new `lg` size to the shared `Button` primitive (touch-target-safe, reusable by later passes). Task 2 rebuilds `Counter.jsx`'s markup and styling only — every data call, Socket.IO listener, and handler function keeps its exact current name, signature, and behavior.

**Tech Stack:** React 18, Tailwind CSS, framer-motion, lucide-react, the existing `frontend/src/components/ui/` primitive library.

**Spec:** `docs/superpowers/specs/2026-08-24-kahariam-counter-screen-design.md`

## Global Constraints

- No backend/API changes. No new npm dependencies.
- Every existing data call in `Counter.jsx` (`rawApi.get('/get_state')`, `rawApi.get('/get_count')`, `rawApi.get('/start')`, `rawApi.get('/stop')`, `rawApi.post('/save_inventory', ...)`, `rawApi.post('/update_count', ...)`, `axios.get('/api/v1/devices/${DEVICE_ID}/lock_status')`, `axios.post('/api/v1/devices/${DEVICE_ID}/lock', ...)`, `axios.post('/api/v1/devices/${DEVICE_ID}/unlock', ...)`) keeps its exact URL, method, and payload — this is a visual/layout rebuild only.
- Every existing function (`getUserId`, `fetchState`, `start`, `stop`, `poll`, `requestSave`, `handleConfirmSave`) keeps its exact name and logic.
- Socket.IO listener names (`connect`, `disconnect`, `reading`, `counting_state`) and the 5-second `fetchState` poll interval are unchanged.
- The variant `<select>` keeps its current `.neu-input` class and single `SPIN_20` option, byte-for-byte — the spec explicitly leaves this control alone (shared class also used by other out-of-scope screens).
- The custom `Toast` component is kept as-is (on-brand already; no shared Toast primitive exists).
- `Button size="lg"` is used for Start, Stop, and Save — the spec's touch-target-safe size.
- Kiosk effective viewport target: ~1194×716 (800×480 physical × 67% Firefox zoom) — the full header-through-Save-button flow must fit without a vertical scrollbar at that width.

---

### Task 1: Add `lg` size to the shared Button primitive

**Files:**
- Modify: `frontend/src/components/ui/Button.jsx:10-13`

**Interfaces:**
- Consumes: nothing new.
- Produces: `Button` now accepts `size="lg"` (in addition to existing `"sm"`/`"md"`), rendering `text-base px-5 py-3 gap-2` (~48px tall, clears the 44×44px touch-target floor). Task 2 uses this on Start/Stop/Save.

- [ ] **Step 1: Add the `lg` entry to `SIZES`**

In `frontend/src/components/ui/Button.jsx`, change:

```js
const SIZES = {
  sm: 'text-sm px-3 py-1.5 gap-1.5',
  md: 'text-sm px-4 py-2.5 gap-2',
}
```

to:

```js
const SIZES = {
  sm: 'text-sm px-3 py-1.5 gap-1.5',
  md: 'text-sm px-4 py-2.5 gap-2',
  lg: 'text-base px-5 py-3 gap-2',
}
```

No other line in the file changes.

- [ ] **Step 2: Manual check**

Run `cd frontend && npm run build` — must complete with no new errors or warnings (this is a pure CSS-class addition; there is no unit test suite for this component, so a clean build is the verification).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ui/Button.jsx
git commit -m "feat: add lg size to Button primitive for touch-target-safe controls"
```

---

### Task 2: Rebuild Counter.jsx on the design-system primitives

**Files:**
- Modify: `frontend/src/components/Counter.jsx` (full rewrite of the file's sub-components and JSX return; state/handler logic body unchanged)

**Interfaces:**
- Consumes: `Button` (with `size="lg"` from Task 1), `Card`, `Modal`, `PageHeader`, `StatusIndicator` from `./ui` (props documented below).
  - `Button({ variant: 'primary'|'secondary'|'ghost'|'danger', size: 'sm'|'md'|'lg', icon: LucideComponent, disabled, loading, className, children, ...rest })`
  - `Card({ title, actions, className, padded = true, children, ...rest })`
  - `Modal({ open, onClose, title, children, footer, size: 'sm'|'md'|'lg' })`
  - `PageHeader({ title, subtitle, actions })`
  - `StatusIndicator({ status: 'active'|'idle'|'error'|'warning', label })`
- Produces: no exported interface changes — `Counter` remains the default export, same props (none), used identically by `App.jsx`.

- [ ] **Step 1: Replace the full contents of `frontend/src/components/Counter.jsx`**

```jsx
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
        <div className="flex items-end gap-4">
          <div className="flex flex-col gap-2 min-w-[160px]">
            <label className="text-xs font-bold text-text-muted uppercase tracking-wider">Variant</label>
            <select value={variant} onChange={e => setVariant(e.target.value)} className="neu-input">
              <option>SPIN_20</option>
            </select>
          </div>
          <Button variant="primary" size="lg" icon={Play} disabled={active} onClick={start}>
            Start
          </Button>
          <Button variant="danger" size="lg" icon={Square} disabled={!active} onClick={stop}>
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
```

- [ ] **Step 2: Compile-check via build**

Run: `cd frontend && npm run build`
Expected: build completes with no new errors and no new warnings beyond the pre-existing "chunks larger than 500kB" notice.

- [ ] **Step 3: Manual functional + visual check**

Run: `cd frontend && npm run dev`, open the app, sign in, go to the Counter tab.

Check, in both light and dark theme:
- At browser width ≈1194px (kiosk effective viewport): the whole flow — header, status indicator, controls card, count card, Save button — is visible with no vertical scrollbar.
- At a normal desktop width (e.g. 1440px): layout still looks correct, no regression.
- Click Start: count begins updating live (via Socket.IO `reading` events or the 1s poll fallback), Start disables, Stop enables.
- Click Stop: counting stops, count freezes at last value.
- Click "Save to Inventory": confirmation modal opens with the correct count/variant text; Cancel closes it with no side effect; Confirm shows a spinner, then a success toast, then the button shows "Saved" and stays disabled, and the count resets to 0.
- If a lock is held elsewhere (or simulate by checking the network calls), the amber lock-warning banner appears/disappears correctly and does not shift the rest of the layout when toggled.
- No console errors in the browser dev tools.

Expected: all of the above pass. If the kiosk-width check shows a scrollbar, reduce `Card` padding or the count's `text-8xl` to `text-7xl` at that breakpoint and re-check — do not proceed to commit until it fits.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Counter.jsx
git commit -m "feat: rebuild Counter screen on design-system primitives, fit kiosk viewport"
```

---

## Verification (final, whole-plan)

- `cd frontend && npm run build` — clean, no new warnings.
- `npm run dev` visual check in both themes at ~1194px width (no scroll) and normal desktop width (no regression) — per Task 2 Step 3.
- Full Start → live count → Stop → Save → confirm → toast flow verified end-to-end against the running backend.
- Socket.IO live count updates confirmed working (start a real counting session or trigger a test `reading` event).
