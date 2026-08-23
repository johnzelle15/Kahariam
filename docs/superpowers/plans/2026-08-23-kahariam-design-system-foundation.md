# Kahariam Farms Design System Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin the Fish Counter frontend's existing dark-glassmorphism theme into a light, natural, earthy "Kahariam Farms" theme (with a restyled dark mode kept as an option), build a small shared `ui/` component library, and rebuild the Dashboard on top of it — all with zero backend changes and zero new npm dependencies.

**Architecture:** The app's theming is already CSS-custom-properties-driven (`frontend/src/styles.css`, swapped via `.theme-dark`/`.theme-light` on `<html>`, mapped into Tailwind via `frontend/tailwind.config.js`). This plan changes token *values* only — every component that already reads `var(--text-primary)`, `text-accent-green`, `.glass-card`, etc. picks up the new look automatically. On top of that, a new `frontend/src/components/ui/` library is added, and `Dashboard.jsx` + `Sidebar.jsx` get surgical edits to use it and to remove a handful of hardcoded hex colors that bypass the token system.

**Tech Stack:** React 18, Tailwind CSS, `clsx` (already an installed but unused dependency — reused here for className composition), `lucide-react`, `framer-motion`, `recharts`. No new packages.

**Spec:** `docs/superpowers/specs/2026-08-23-kahariam-design-system-foundation-design.md`

## Global Constraints

- No new npm dependencies — `clsx` and Inter (Google Fonts, already linked in `frontend/index.html`) satisfy everything needed.
- No backend/API changes. Every `axios`/fetch call in `Dashboard.jsx` keeps its exact current URL and params.
- CSS custom property **names** are never renamed — only their values change — so any file not touched by this plan keeps working unmodified.
- **This frontend has no test runner configured** (verified: no Jest/Vitest/RTL in `package.json`, no test script). Per-task verification is therefore `npm run build` (catches syntax errors) plus a manual visual check via `npm run dev` — not automated unit tests. This matches the spec's own Verification section, which is manual/visual.
- Out of scope, do not touch: `Counter.jsx`, `Inventory.jsx`, `Adjustments.jsx`, `Settings/*`, `LoginForm.jsx`/`OtpForm.jsx`/`ForgotPassword.jsx`/`ResetPassword.jsx`/`LoginScreen.jsx`, `App.jsx`, any `backend/` file.
- Actual Kahariam Farms logo image file (to replace `frontend/src/assets/logo.png`) is **not available in this plan** — the client hasn't provided the asset file yet, only an on-screen preview. Do not attempt to fabricate or recreate it; leave `logoImg` import pointing at the current placeholder file.

---

### Task 1: Retheme color tokens

**Files:**
- Modify: `frontend/src/styles.css:9-73` (`:root, .theme-dark` block)
- Modify: `frontend/src/styles.css:76-140` (`.theme-light` block)
- Modify: `frontend/tailwind.config.js:14-21` (`accent` color map)

**Interfaces:**
- Produces: new value for existing token `--accent-teal` (new token, additive) and new Tailwind class `text-accent-teal` / `bg-accent-teal` / `border-accent-teal`, alongside all pre-existing token names (`--bg-primary`, `--accent-green`, etc.) which keep their names but get new values.

- [ ] **Step 1: Replace the dark theme token block**

In `frontend/src/styles.css`, replace the entire `:root, .theme-dark { ... }` block (current lines 9-73) with:

```css
:root,
.theme-dark {
  --bg-primary: 22 28 22;
  --bg-secondary: 31 40 31;
  --bg-tertiary: 42 53 41;
  --bg-elevated: 56 68 55;

  --glass-bg: rgba(255, 255, 255, 0.03);
  --glass-bg-hover: rgba(255, 255, 255, 0.055);
  --glass-border: rgba(255, 255, 255, 0.06);
  --glass-border-hover: rgba(255, 255, 255, 0.10);

  --text-primary: #edefe9;
  --text-secondary: #b7c2b0;
  --text-muted: #8fa089;

  --accent-purple: #a78bfa;
  --accent-blue: #6fa0af;
  --accent-cyan: #22d3ee;
  --accent-green: #7cb342;
  --accent-teal: #6fb3ac;
  --accent-red: #d97862;
  --accent-amber: #e0a24f;

  --input-bg: rgba(31, 40, 31, 0.85);
  --input-border: rgba(255, 255, 255, 0.06);
  --input-shadow: inset 1px 1px 3px rgba(0, 0, 0, 0.25), inset -1px -1px 2px rgba(255, 255, 255, 0.02);
  --input-focus-shadow: 0 0 0 3px rgba(124, 179, 66, 0.16);

  --sidebar-bg: rgba(22, 28, 22, 0.75);
  --sidebar-border: rgba(255, 255, 255, 0.05);

  --tooltip-bg: rgba(31, 40, 31, 0.96);
  --tooltip-border: rgba(255, 255, 255, 0.08);

  --chart-grid: rgba(255, 255, 255, 0.04);
  --chart-text: #8fa089;

  --scrollbar-thumb: rgba(255, 255, 255, 0.08);
  --scrollbar-thumb-hover: rgba(255, 255, 255, 0.14);

  --skeleton-from: rgba(255, 255, 255, 0.03);
  --skeleton-via: rgba(255, 255, 255, 0.06);

  --modal-overlay: rgba(10, 14, 10, 0.6);

  --table-border: rgba(255, 255, 255, 0.05);
  --table-row-hover: rgba(255, 255, 255, 0.025);

  --btn-secondary-bg: rgba(255, 255, 255, 0.04);
  --btn-secondary-border: rgba(255, 255, 255, 0.07);
  --btn-secondary-hover: rgba(255, 255, 255, 0.08);
}
```

- [ ] **Step 2: Replace the light theme token block**

Replace the `.theme-light { ... }` block (current lines 76-140) with:

```css
.theme-light {
  --bg-primary: 250 247 241;
  --bg-secondary: 240 236 227;
  --bg-tertiary: 228 223 209;
  --bg-elevated: 213 207 189;

  --glass-bg: rgba(255, 255, 255, 0.75);
  --glass-bg-hover: rgba(255, 255, 255, 0.88);
  --glass-border: rgba(42, 46, 39, 0.08);
  --glass-border-hover: rgba(42, 46, 39, 0.14);

  --text-primary: #2a2e27;
  --text-secondary: #5a6154;
  --text-muted: #8a8f86;

  --accent-purple: #7c3aed;
  --accent-blue: #4a7c8c;
  --accent-cyan: #0891b2;
  --accent-green: #4c7a3d;
  --accent-teal: #5e9b94;
  --accent-red: #b5533f;
  --accent-amber: #d98e3b;

  --input-bg: rgba(255, 255, 255, 0.92);
  --input-border: rgba(42, 46, 39, 0.10);
  --input-shadow: inset 1px 1px 2px rgba(0, 0, 0, 0.04), inset -1px -1px 2px rgba(255, 255, 255, 0.9);
  --input-focus-shadow: 0 0 0 3px rgba(76, 122, 61, 0.14);

  --sidebar-bg: rgba(255, 255, 255, 0.85);
  --sidebar-border: rgba(42, 46, 39, 0.06);

  --tooltip-bg: rgba(255, 255, 255, 0.96);
  --tooltip-border: rgba(42, 46, 39, 0.08);

  --chart-grid: rgba(42, 46, 39, 0.06);
  --chart-text: #8a8f86;

  --scrollbar-thumb: rgba(42, 46, 39, 0.12);
  --scrollbar-thumb-hover: rgba(42, 46, 39, 0.18);

  --skeleton-from: rgba(42, 46, 39, 0.04);
  --skeleton-via: rgba(42, 46, 39, 0.08);

  --modal-overlay: rgba(30, 26, 18, 0.32);

  --table-border: rgba(42, 46, 39, 0.07);
  --table-row-hover: rgba(76, 122, 61, 0.04);

  --btn-secondary-bg: rgba(42, 46, 39, 0.04);
  --btn-secondary-border: rgba(42, 46, 39, 0.08);
  --btn-secondary-hover: rgba(42, 46, 39, 0.07);
}
```

- [ ] **Step 3: Add the teal accent to Tailwind's color map**

In `frontend/tailwind.config.js`, inside `theme.extend.colors.accent`, add one line so the object reads:

```js
        accent: {
          purple: 'var(--accent-purple)',
          blue: 'var(--accent-blue)',
          cyan: 'var(--accent-cyan)',
          green: 'var(--accent-green)',
          teal: 'var(--accent-teal)',
          red: 'var(--accent-red)',
          amber: 'var(--accent-amber)',
        },
```

- [ ] **Step 4: Check `themeStore.js`'s default theme**

Read `frontend/src/store/themeStore.js`. If it sets `theme: 'dark'` as the initial/default state (rather than reading a persisted value first), change the fallback default to `'light'` so first-time visitors land on the new Kahariam light theme. Leave the persisted-preference read logic (`localStorage['fc_theme']`) untouched — this only changes what a user with no saved preference sees first.

- [ ] **Step 5: Verify**

Run `npm run build` inside `frontend/` — expect success, no CSS/JS errors.
Run `npm run dev`, open the app, and visually confirm the background is now a warm off-white with green/amber/teal accents (not the old dark-purple glass look) and that toggling the theme switcher (in Sidebar) still swaps to a restyled dark botanical theme without errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/styles.css frontend/tailwind.config.js frontend/src/store/themeStore.js
git commit -m "feat: retheme color tokens to Kahariam Farms palette"
```

---

### Task 2: Remove confirmed-dead frontend files

**Files:**
- Delete: `frontend/src/components/analytics/useAnalyticsData.js`
- Delete: `frontend/src/components/analytics/TimeRangeFilter.jsx`
- Delete: `frontend/src/components/analytics/KpiStrip.jsx`
- Delete: `frontend/src/components/analytics/TrendsChart.jsx`
- Delete: `frontend/src/components/analytics/CategoryBreakdown.jsx`
- Delete: `frontend/src/components/analytics/InsightsEngine.jsx`
- Delete: `frontend/src/components/analytics/RisksOpportunities.jsx`
- Delete: `frontend/src/components/Settings/SystemTab.jsx`
- Delete: `frontend/src/components/Settings/NotificationsTab.jsx`
- Delete: `frontend/src/components/Settings/PreferencesTab.jsx`
- Delete: `frontend/src/components/Nav.jsx`
- Delete: `frontend/src/components/Dashboard.jsx.bak`

**Interfaces:** None — these files are confirmed unreferenced by any other file in the codebase.

- [ ] **Step 1: Confirm nothing imports these files**

```bash
cd frontend && grep -rn "components/analytics\|Settings/SystemTab\|Settings/NotificationsTab\|Settings/PreferencesTab\|components/Nav'" src/ --include="*.jsx" --include="*.js" | grep -v "^src/components/analytics/\|^src/components/Nav.jsx\|^src/components/Settings/SystemTab.jsx\|^src/components/Settings/NotificationsTab.jsx\|^src/components/Settings/PreferencesTab.jsx"
```

Expected: no output (only self-references inside the files themselves, which the filter excludes).

- [ ] **Step 2: Delete the files**

```bash
cd frontend && rm -rf src/components/analytics
rm src/components/Settings/SystemTab.jsx src/components/Settings/NotificationsTab.jsx src/components/Settings/PreferencesTab.jsx
rm src/components/Nav.jsx src/components/Dashboard.jsx.bak
```

- [ ] **Step 3: Verify**

Run `npm run build` — expect success (proves nothing was actually importing the deleted files).

- [ ] **Step 4: Commit**

```bash
git add -A frontend/src/components
git commit -m "chore: remove dead frontend code (orphaned analytics/, unused Settings tabs, stub Nav, stray backup)"
```

---

### Task 3: Atomic UI primitives — Button, Badge, StatusIndicator

**Files:**
- Create: `frontend/src/components/ui/Button.jsx`
- Create: `frontend/src/components/ui/Badge.jsx`
- Create: `frontend/src/components/ui/StatusIndicator.jsx`

**Interfaces:**
- Produces: `Button({variant='primary'|'secondary'|'ghost'|'danger', size='sm'|'md', icon?: LucideIcon, disabled?, loading?, className?, children, ...rest}) => JSX`
- Produces: `Badge({variant='success'|'warning'|'error'|'info'|'neutral', children, className?}) => JSX`
- Produces: `StatusIndicator({status='active'|'idle'|'error'|'warning', label}) => JSX`

- [ ] **Step 1: Create `Button.jsx`**

```jsx
import clsx from 'clsx'

const VARIANTS = {
  primary: 'bg-accent-green text-white hover:brightness-110 active:brightness-95 shadow-sm',
  secondary: 'bg-[var(--btn-secondary-bg)] border border-[var(--btn-secondary-border)] text-text-primary hover:bg-[var(--btn-secondary-hover)]',
  ghost: 'bg-transparent text-text-secondary hover:bg-[var(--btn-secondary-bg)]',
  danger: 'bg-accent-red text-white hover:brightness-110 active:brightness-95 shadow-sm',
}

const SIZES = {
  sm: 'text-sm px-3 py-1.5 gap-1.5',
  md: 'text-sm px-4 py-2.5 gap-2',
}

export default function Button({
  variant = 'primary',
  size = 'md',
  icon: Icon,
  disabled = false,
  loading = false,
  className,
  children,
  ...rest
}) {
  return (
    <button
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center rounded-xl font-medium transition-all duration-150',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-accent-green/50',
        VARIANTS[variant],
        SIZES[size],
        className
      )}
      {...rest}
    >
      {loading ? (
        <span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
      ) : Icon ? (
        <Icon size={16} />
      ) : null}
      {children}
    </button>
  )
}
```

- [ ] **Step 2: Create `Badge.jsx`**

```jsx
import clsx from 'clsx'

const VARIANTS = {
  success: 'bg-accent-green/10 text-accent-green',
  warning: 'bg-accent-amber/10 text-accent-amber',
  error: 'bg-accent-red/10 text-accent-red',
  info: 'bg-accent-blue/10 text-accent-blue',
  neutral: 'bg-text-muted/10 text-text-secondary',
}

export default function Badge({ variant = 'neutral', children, className }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium',
        VARIANTS[variant],
        className
      )}
    >
      {children}
    </span>
  )
}
```

- [ ] **Step 3: Create `StatusIndicator.jsx`**

```jsx
import clsx from 'clsx'

const COLORS = {
  active: 'bg-accent-green',
  idle: 'bg-text-muted',
  error: 'bg-accent-red',
  warning: 'bg-accent-amber',
}

export default function StatusIndicator({ status = 'idle', label }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-text-secondary">
      <span
        className={clsx(
          'h-2 w-2 rounded-full',
          COLORS[status] || COLORS.idle,
          status === 'active' && 'animate-pulse'
        )}
      />
      {label}
    </span>
  )
}
```

- [ ] **Step 4: Verify**

Run `npm run build` — expect success (these files aren't imported anywhere yet, so this only checks they're syntactically valid JSX/ES modules; Vite/esbuild will still parse unreferenced files that are part of `src/**/*.{js,jsx}` only if imported — since nothing imports them yet, confirm instead with `npx eslint src/components/ui --no-eslintrc --parser-options=ecmaVersion:2022,sourceType:module,ecmaFeatures:{jsx:true}` if ESLint is unavailable, simply visually re-read each file for balanced braces/tags before moving on; Task 6's barrel export and Task 8's Dashboard import are what actually exercise these files through the build).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/Button.jsx frontend/src/components/ui/Badge.jsx frontend/src/components/ui/StatusIndicator.jsx
git commit -m "feat: add Button, Badge, StatusIndicator ui primitives"
```

---

### Task 4: Surface primitives — Card, StatCard, PageHeader

**Files:**
- Create: `frontend/src/components/ui/Card.jsx`
- Create: `frontend/src/components/ui/StatCard.jsx`
- Create: `frontend/src/components/ui/PageHeader.jsx`

**Interfaces:**
- Consumes: nothing from Task 3 (independent).
- Produces: `Card({title?, actions?, className?, padded=true, children, ...rest}) => JSX`
- Produces: `StatCard({label, value, icon?: LucideIcon, trend?: number, trendLabel?: string, onClick?}) => JSX` (built on `Card`)
- Produces: `PageHeader({title, subtitle?, actions?}) => JSX`

- [ ] **Step 1: Create `Card.jsx`**

```jsx
import clsx from 'clsx'

export default function Card({ title, actions, className, padded = true, children, ...rest }) {
  return (
    <div
      className={clsx(
        'rounded-2xl border bg-[var(--glass-bg)] border-[var(--glass-border)]',
        padded && 'p-5',
        className
      )}
      {...rest}
    >
      {(title || actions) && (
        <div className="flex items-center justify-between mb-4">
          {title && <h3 className="text-lg font-medium text-text-primary">{title}</h3>}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  )
}
```

- [ ] **Step 2: Create `StatCard.jsx`**

```jsx
import clsx from 'clsx'
import Card from './Card'

export default function StatCard({ label, value, icon: Icon, trend, trendLabel, onClick }) {
  const hasTrend = typeof trend === 'number' && !Number.isNaN(trend)
  const trendPositive = hasTrend && trend >= 0

  return (
    <Card
      padded
      className={clsx(
        'flex flex-col gap-2',
        onClick && 'cursor-pointer hover:border-[var(--glass-border-hover)] transition-colors'
      )}
      {...(onClick ? { onClick, role: 'button', tabIndex: 0 } : {})}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-text-muted uppercase tracking-wide">{label}</span>
        {Icon && <Icon size={18} className="text-accent-green" />}
      </div>
      <span className="text-3xl font-semibold tabular-nums text-text-primary">{value}</span>
      {hasTrend && (
        <span className={clsx('text-xs font-medium', trendPositive ? 'text-accent-green' : 'text-accent-red')}>
          {trendPositive ? '+' : ''}
          {trend}% {trendLabel}
        </span>
      )}
    </Card>
  )
}
```

- [ ] **Step 3: Create `PageHeader.jsx`**

```jsx
export default function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
      <div>
        <h1 className="text-2xl font-semibold text-text-primary">{title}</h1>
        {subtitle && <p className="text-sm text-text-secondary mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
```

- [ ] **Step 4: Verify**

Re-read each file for balanced JSX; full exercise happens once Task 8 imports them and `npm run build` runs against Dashboard.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/Card.jsx frontend/src/components/ui/StatCard.jsx frontend/src/components/ui/PageHeader.jsx
git commit -m "feat: add Card, StatCard, PageHeader ui primitives"
```

---

### Task 5: State/overlay primitives — EmptyState, LoadingState, Modal

**Files:**
- Create: `frontend/src/components/ui/EmptyState.jsx`
- Create: `frontend/src/components/ui/LoadingState.jsx`
- Create: `frontend/src/components/ui/Modal.jsx`

**Interfaces:**
- Consumes: `Button` from Task 3 (`EmptyState`'s optional action).
- Produces: `EmptyState({icon?: LucideIcon, title, message?, actionLabel?, onAction?}) => JSX`
- Produces: `Skeleton({className}) => JSX` (named export) and default `LoadingState({rows=3}) => JSX`, both reusing the existing `--skeleton-from`/`--skeleton-via` tokens and the `shimmer` keyframe already defined in `frontend/src/styles.css`.
- Produces: `Modal({open: boolean, onClose, title, children, footer?, size='sm'|'md'|'lg'}) => JSX`

- [ ] **Step 1: Create `EmptyState.jsx`**

```jsx
import Button from './Button'

export default function EmptyState({ icon: Icon, title, message, actionLabel, onAction }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      {Icon && (
        <div className="h-12 w-12 rounded-full bg-[var(--btn-secondary-bg)] flex items-center justify-center mb-4">
          <Icon size={22} className="text-text-muted" />
        </div>
      )}
      <h3 className="text-base font-medium text-text-primary">{title}</h3>
      {message && <p className="text-sm text-text-secondary mt-1 max-w-sm">{message}</p>}
      {actionLabel && onAction && (
        <Button variant="secondary" size="sm" onClick={onAction} className="mt-4">
          {actionLabel}
        </Button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create `LoadingState.jsx`**

`shimmer` keyframe and `--skeleton-from`/`--skeleton-via` tokens already exist in `frontend/src/styles.css` (used today by the `.skeleton-dark` class) — reused here rather than redefined.

`Skeleton`'s signature must match the local `Skeleton` component Dashboard.jsx already defines today (`{className, width, height}`, defaults `width='100%'`, `height=20`) so it's a true drop-in for every existing call site in Task 8 (`KpiSkeleton`, `InsightSkeleton`, the bar/pie chart loading states, Recent Sessions loading rows, etc.) — none of those call sites are being rewritten, only re-pointed at this import.

```jsx
export function Skeleton({ className = '', width = '100%', height = 20 }) {
  return (
    <div
      className={className}
      style={{
        width,
        height,
        background:
          'linear-gradient(90deg, var(--skeleton-from) 25%, var(--skeleton-via) 37%, var(--skeleton-from) 63%)',
        backgroundSize: '400% 100%',
        animation: 'shimmer 1.4s ease infinite',
        borderRadius: '0.75rem',
      }}
    />
  )
}

export default function LoadingState({ rows = 3 }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} height={64} />
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Create `Modal.jsx`**

```jsx
import { useEffect } from 'react'
import { X } from 'lucide-react'
import clsx from 'clsx'

export default function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose?.()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'var(--modal-overlay)' }}
      onClick={onClose}
    >
      <div
        className={clsx(
          'w-full rounded-2xl border bg-[var(--bg-secondary)] border-[var(--glass-border)] p-6 shadow-xl',
          size === 'sm' && 'max-w-sm',
          size === 'md' && 'max-w-md',
          size === 'lg' && 'max-w-lg'
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-text-primary">{title}</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div>{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 mt-6">{footer}</div>}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Verify**

Re-read each file for balanced JSX; full exercise happens once Task 8 imports them.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/EmptyState.jsx frontend/src/components/ui/LoadingState.jsx frontend/src/components/ui/Modal.jsx
git commit -m "feat: add EmptyState, LoadingState, Modal ui primitives"
```

---

### Task 6: Barrel export for `ui/`

**Files:**
- Create: `frontend/src/components/ui/index.js`

**Interfaces:**
- Consumes: default/named exports from every file created in Tasks 3-5.
- Produces: `import { Button, Card, Badge, StatCard, PageHeader, EmptyState, LoadingState, Skeleton, Modal, StatusIndicator } from './ui'`

- [ ] **Step 1: Create the barrel file**

```js
export { default as Button } from './Button'
export { default as Card } from './Card'
export { default as Badge } from './Badge'
export { default as StatCard } from './StatCard'
export { default as PageHeader } from './PageHeader'
export { default as EmptyState } from './EmptyState'
export { default as LoadingState, Skeleton } from './LoadingState'
export { default as Modal } from './Modal'
export { default as StatusIndicator } from './StatusIndicator'
```

- [ ] **Step 2: Verify**

Run `npm run build` inside `frontend/` — expect success. This is the first point the whole `ui/` set gets bundled, so this is where a real syntax error in any Task 3-5 file would surface.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ui/index.js
git commit -m "feat: add ui/ barrel export"
```

---

### Task 7: Reskin Sidebar

**Files:**
- Modify: `frontend/src/components/Sidebar.jsx:116-119` (brand text)
- Modify: `frontend/src/components/Sidebar.jsx:174` (active-nav indicator color)

**Interfaces:** None — `Sidebar`'s props (`tab, setTab, collapsed, onToggle, mobileOpen, onMobileClose`) and all logic (role filtering, collapse, theme switch, logout) are unchanged.

- [ ] **Step 1: Update the brand text**

`Sidebar.jsx` already reads every color from `var(--...)` tokens, so Task 1 reskins almost all of it automatically. Two things don't come from tokens today: the placeholder brand copy and one hardcoded purple accent.

Replace (lines 115-120):
```jsx
            <h1 className="text-sm font-bold leading-tight truncate" style={{ color: 'var(--text-primary)' }}>
              Aquaculture
            </h1>
            <p className="text-[10px] font-medium tracking-wider uppercase" style={{ color: 'var(--text-muted)' }}>
              Management
            </p>
```
with:
```jsx
            <h1 className="text-sm font-bold leading-tight truncate" style={{ color: 'var(--text-primary)' }}>
              Kahariam Farms
            </h1>
            <p className="text-[10px] font-medium tracking-wider uppercase" style={{ color: 'var(--text-muted)' }}>
              Fish Management
            </p>
```

(The `logoImg` image itself is left pointing at the current `frontend/src/assets/logo.png` placeholder — the real Kahariam logo file isn't available yet; see Global Constraints.)

- [ ] **Step 2: Swap the leftover purple active-nav indicator**

Replace (line 174):
```jsx
                  style={{ background: 'var(--accent-purple)' }}
```
with:
```jsx
                  style={{ background: 'var(--accent-green)' }}
```

- [ ] **Step 3: Verify**

Run `npm run build` — expect success.
Run `npm run dev`, confirm the sidebar shows "Kahariam Farms" / "Fish Management", the active nav item's left indicator bar is green (not purple), collapse/expand still works, and role-based nav filtering (admin vs staff) is unaffected.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Sidebar.jsx
git commit -m "feat: reskin Sidebar brand text and nav indicator for Kahariam Farms"
```

---

### Task 8: Rebuild Dashboard on ui/ primitives

**Files:**
- Modify: `frontend/src/components/Dashboard.jsx` (multiple targeted edits, listed below; all existing data-fetching functions — `loadStats`, `loadLowStock`, `loadFishInTank`, the Socket.IO `useEffect`, `applyFilters`/`clearFilters`, `openKpiModal` — and the entire `generateInsights` engine and `AnalyticsInsights`/`InsightCard`/`LowStockAlerts`/`ChartTooltip` components are left untouched)

**Interfaces:**
- Consumes: `Button, EmptyState, Modal, PageHeader, StatCard, StatusIndicator` from `./ui` (Task 6); `useAuthStore` from `../store/authStore` (existing, already used elsewhere in the app).

- [ ] **Step 1: Add imports**

At the top of `Dashboard.jsx`, after the existing `import { getNoteDisplay } from '../utils/notes'` (line 14), add:
```jsx
import { Button, EmptyState, Modal, PageHeader, StatCard, StatusIndicator } from './ui'
import useAuthStore from '../store/authStore'
```

- [ ] **Step 2: Replace hardcoded chart/variant hex colors**

Replace (lines 41-42):
```jsx
const CHART_COLORS = ['#a78bfa', '#60a5fa', '#22d3ee']
const VARIANT_COLORS = { Black: '#a78bfa', Platinum: '#60a5fa', Pineapple: '#22d3ee' }
```
with:
```jsx
const CHART_COLORS = ['#4C7A3D', '#5E9B94', '#D98E3B']
const VARIANT_COLORS = { Black: '#4C7A3D', Platinum: '#5E9B94', Pineapple: '#D98E3B' }
```

- [ ] **Step 3: Replace the local `Skeleton` with a `trendPercent` helper, remove now-unused `TrendBadge`**

`TrendBadge` (current lines 49-70) is only used inside the KPI card block that Step 6 below replaces with `StatCard`, so it becomes dead code — remove it and keep its percentage math as a plain helper. Also drop the local `Skeleton` function (lines 27-29) — `KpiSkeleton`/`InsightSkeleton` (lines 31-39, 638-659) keep using a `Skeleton` component, just sourced from the barrel instead of redefined locally.

Delete (lines 27-29):
```jsx
function Skeleton({ className = '', width = '100%', height = 20 }) {
  return <div className={`skeleton-dark ${className}`} style={{ width, height }} />
}
```

Delete the whole `TrendBadge` function (current lines 49-70):
```jsx
/* ─── Trend Badge ─── */
function TrendBadge({ current, yesterday, isCurrency }) {
  ...
}
```

Add in its place:
```jsx
/* ─── Trend percentage (used by StatCard) ─── */
function trendPercent(current, yesterday) {
  const cur = Number(current || 0)
  const yday = Number(yesterday || 0)
  const diff = cur - yday
  if (yday !== 0) return (diff / Math.abs(yday)) * 100
  return diff !== 0 ? 100 : 0
}
```

Add this import alongside the other named imports at the top of the file (the local `Skeleton`/`KpiSkeleton`/`InsightSkeleton` functions stay in this file — only `Skeleton` itself now comes from the barrel):
```jsx
import { Skeleton } from './ui'
```
(Combine this into the same import line as Step 1 rather than a separate statement: `import { Button, EmptyState, Modal, PageHeader, StatCard, StatusIndicator, Skeleton } from './ui'`.)

- [ ] **Step 4: Replace the revenue-breakdown hardcoded row colors**

Replace (lines 925-926):
```jsx
          { label: 'Retail Price', color: '#34d399', value: `₱${retailPrice.toFixed(2)} per fish` },
          { label: 'Wholesale Price', color: '#22d3ee', value: `₱${wholesalePrice.toFixed(2)} per fish` },
```
with:
```jsx
          { label: 'Retail Price', color: '#4C7A3D', value: `₱${retailPrice.toFixed(2)} per fish` },
          { label: 'Wholesale Price', color: '#5E9B94', value: `₱${wholesalePrice.toFixed(2)} per fish` },
```

- [ ] **Step 5: Update the 5 KPI card colors**

Replace (lines 876-882):
```jsx
  const kpiCards = stats ? [
    { key: 'total_fish', label: 'Total Fish', value: Number(stats.additions_total || 0).toLocaleString(), icon: Fish, color: '#a78bfa', current: global.additions_total, yesterday: yday.additions_total },
    { key: 'fish_in_tank', label: 'Fish in Tank', value: Number(stats.tank_total || 0).toLocaleString(), icon: Package, color: '#60a5fa', current: global.tank_total, yesterday: yday.tank_total },
    { key: 'wholesale', label: 'Wholesale Storage', value: Number(stats.wholesale_total || 0).toLocaleString(), icon: Warehouse, color: '#22d3ee', current: global.wholesale_total, yesterday: yday.wholesale_total },
    { key: 'today_revenue', label: "Today's Revenue", value: formatCurrency(stats.today_revenue), icon: DollarSign, color: '#34d399', current: global.today_revenue, yesterday: yday.today_revenue, isCurrency: true, rawValue: Number(stats.today_revenue || 0) },
    { key: 'total_revenue', label: 'Total Revenue', value: formatCurrency(stats.total_revenue), icon: Activity, color: '#fbbf24', current: global.total_revenue, yesterday: yday.total_revenue, isCurrency: true, rawValue: Number(stats.total_revenue || 0) },
  ] : []
```
with:
```jsx
  const kpiCards = stats ? [
    { key: 'total_fish', label: 'Total Fish', value: Number(stats.additions_total || 0).toLocaleString(), icon: Fish, color: '#4C7A3D', current: global.additions_total, yesterday: yday.additions_total },
    { key: 'fish_in_tank', label: 'Fish in Tank', value: Number(stats.tank_total || 0).toLocaleString(), icon: Package, color: '#5E9B94', current: global.tank_total, yesterday: yday.tank_total },
    { key: 'wholesale', label: 'Wholesale Storage', value: Number(stats.wholesale_total || 0).toLocaleString(), icon: Warehouse, color: '#D98E3B', current: global.wholesale_total, yesterday: yday.wholesale_total },
    { key: 'today_revenue', label: "Today's Revenue", value: formatCurrency(stats.today_revenue), icon: DollarSign, color: '#4A7C8C', current: global.today_revenue, yesterday: yday.today_revenue, isCurrency: true, rawValue: Number(stats.today_revenue || 0) },
    { key: 'total_revenue', label: 'Total Revenue', value: formatCurrency(stats.total_revenue), icon: Activity, color: '#8C6E4A', current: global.total_revenue, yesterday: yday.total_revenue, isCurrency: true, rawValue: Number(stats.total_revenue || 0) },
  ] : []
```
`card.color` is kept in this array (still used by the KPI detail modal's row-dot colors in `openKpiModal`, untouched) — only `StatCard` itself (Step 6) doesn't take a per-card color, using one consistent brand-green icon tint instead, per the spec's "avoid random colors" guidance.

- [ ] **Step 6: Add a PageHeader and swap the KPI grid to StatCard**

Add `const user = useAuthStore(s => s.user)` near the top of the `Dashboard` function body (right after the existing `useState` declarations, before the `useEffect`).

Replace the KPI grid block (current lines 936-964, i.e. the opening `return (` through the closing of the KPI `</div>`):
```jsx
  return (
    <div className="space-y-8">
      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-5">
        {statsLoading ? (
          Array.from({ length: 5 }).map((_, i) => <KpiSkeleton key={i} />)
        ) : kpiCards.map((card, i) => {
          const Icon = card.icon
          return (
            <motion.div key={i}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08, duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
              whileHover={{ scale: 1.015, y: -1 }}
              onClick={() => openKpiModal(card)}
              className="glass-card stat-glow p-3 sm:p-5 cursor-pointer overflow-hidden select-none transition-shadow duration-300 hover:shadow-lg">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: `${card.color}20` }}>
                  <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" style={{ color: card.color }} />
                </div>
                <p className="text-[9px] sm:text-[10px] font-bold text-text-muted uppercase tracking-wider leading-tight">{card.label}</p>
              </div>
              <p className="text-lg sm:text-2xl font-extrabold text-text-primary truncate">{card.value}</p>
              <TrendBadge current={card.current} yesterday={card.yesterday} isCurrency={card.isCurrency} />
            </motion.div>
          )
        })}
      </div>
```
with:
```jsx
  return (
    <div className="space-y-8">
      <PageHeader
        title={`Welcome back${user?.username ? `, ${user.username}` : ''}`}
        subtitle="Here's what's happening on the farm today."
      />

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-5">
        {statsLoading ? (
          Array.from({ length: 5 }).map((_, i) => <KpiSkeleton key={i} />)
        ) : kpiCards.map((card, i) => (
          <motion.div key={i}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08, duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
            whileHover={{ scale: 1.015, y: -1 }}
          >
            <StatCard
              label={card.label}
              value={card.value}
              icon={card.icon}
              trend={Math.round(trendPercent(card.current, card.yesterday) * 10) / 10}
              trendLabel="vs yesterday"
              onClick={() => openKpiModal(card)}
            />
          </motion.div>
        ))}
      </div>
```

- [ ] **Step 7: Replace the "LIVE" badge with StatusIndicator**

Replace (lines 983-987):
```jsx
            {socketConnected && (
              <span className="flex items-center gap-1.5 text-[10px] font-semibold text-accent-green">
                <span className="w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse" /> LIVE
              </span>
            )}
```
with:
```jsx
            {socketConnected && <StatusIndicator status="active" label="Live" />}
```

- [ ] **Step 8: Replace the pie-chart empty state**

Replace (line 1013):
```jsx
              <p className="text-sm text-text-muted py-16 text-center">No inventory data yet</p>
```
with:
```jsx
              <EmptyState icon={Package} title="No inventory data yet" message="Counted fish will appear here once you save your first session." />
```

- [ ] **Step 9: Replace the Recent Sessions empty state**

Replace (line 1052):
```jsx
        ) : (!stats?.recent_additions || stats.recent_additions.length === 0) ? (
          <p className="text-sm text-text-muted">No recent entries</p>
        ) : (
```
with:
```jsx
        ) : (!stats?.recent_additions || stats.recent_additions.length === 0) ? (
          <EmptyState icon={Fish} title="No recent entries" message="Saved counting sessions will show up here." />
        ) : (
```

- [ ] **Step 10: Replace the Analytics Insights empty state**

Replace (lines 784-788):
```jsx
      {/* Empty state */}
      {!trendLoading && !hasAny && (
        <div className="glass-card py-8 px-4 text-center">
          <p className="text-sm text-text-muted">No insights available for the selected range</p>
        </div>
      )}
```
with:
```jsx
      {/* Empty state */}
      {!trendLoading && !hasAny && (
        <EmptyState icon={Lightbulb} title="No insights yet" message="Insights appear once there's enough sales activity in the selected range." />
      )}
```

- [ ] **Step 11: Update the Recent Sessions row dot color**

Replace (line 1059):
```jsx
                  <div className="w-2 h-2 rounded-full bg-accent-purple flex-shrink-0" />
```
with:
```jsx
                  <div className="w-2 h-2 rounded-full bg-accent-green flex-shrink-0" />
```

- [ ] **Step 12: Update the Analytics Overview header icon gradient**

Replace (lines 707-708):
```jsx
              <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, rgba(251, 191, 36, 0.15), rgba(167, 139, 250, 0.15))' }}>
```
with:
```jsx
              <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, rgba(217, 142, 59, 0.15), rgba(76, 122, 61, 0.15))' }}>
```

- [ ] **Step 13: Replace the KPI detail modal with the shared Modal**

Replace the entire KPI Detail Modal block (current lines 1072-1131, from `{/* ── KPI Detail Modal ── */}` through its closing `)}`):
```jsx
      {/* ── KPI Detail Modal ── */}
      {kpiModal && kpiModal.details && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setKpiModal(null)}>
          ... (existing block)
        </div>
      )}
```
with:
```jsx
      {/* ── KPI Detail Modal ── */}
      <Modal
        open={!!(kpiModal && kpiModal.details)}
        onClose={() => setKpiModal(null)}
        title={kpiModal?.details?.title}
        footer={
          <Button variant="secondary" size="sm" onClick={() => setKpiModal(null)}>
            Close
          </Button>
        }
      >
        {kpiModal?.details && (
          <>
            <p className="text-xs text-text-muted -mt-2 mb-4">{kpiModal.details.subtitle}</p>
            <div className="space-y-2 mb-4">
              {kpiModal.details.rows.map((row, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between p-3 rounded-xl border"
                  style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)' }}
                >
                  <span className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: row.color }} />
                    <span className="text-sm text-text-secondary font-medium">{row.label}</span>
                  </span>
                  <span className="text-sm font-bold text-text-primary">{row.value}</span>
                </div>
              ))}
            </div>
            {kpiModal.details.extra && <p className="text-xs text-text-muted px-1">{kpiModal.details.extra}</p>}
          </>
        )}
      </Modal>
```
This drops the old modal's per-KPI icon header — the shared `Modal` component only has a plain title, no icon slot, since no other current caller needs one. Flagging this as a deliberate simplification, not an oversight: adding an icon prop to `Modal` for this single caller would be speculative flexibility the spec's "no unrequested abstractions" guidance argues against. Revisit only if a later page's redesign genuinely needs a modal icon too.

- [ ] **Step 14: Verify**

Run `npm run build` inside `frontend/` — expect success.
Run `npm run dev`, log in, open the Dashboard, and confirm: the page shows a "Welcome back" header, all 5 KPI cards render with the new StatCard look and correct values/trends, clicking a KPI card opens the new Modal with correct data, the bar/pie charts and Recent Sessions/Analytics Overview panels render in the new green/teal/amber palette (no purple), the "LIVE" indicator shows when Socket.IO is connected, and empty states (if you have no data, or filter to an empty range) show the new EmptyState panels instead of plain text.

- [ ] **Step 15: Commit**

```bash
git add frontend/src/components/Dashboard.jsx
git commit -m "feat: rebuild Dashboard on Kahariam ui/ primitives"
```

---

### Task 9: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Production build**

```bash
cd frontend && npm run build
```
Expect a clean build with no errors, producing an updated `frontend/dist/`.

- [ ] **Step 2: Manual visual/functional check**

```bash
cd frontend && npm run dev
```
With the Flask backend running (`python app.py` or `python run_app.py` from the repo root), open the app and confirm:
- Light theme (new default) renders the warm/earthy Kahariam palette across Sidebar and Dashboard.
- Toggling to dark theme shows the restyled deep-botanical dark palette, not the old dark-glass/purple look.
- Sidebar shows "Kahariam Farms" / "Fish Management", collapse/expand still works, role-based nav filtering (log in as admin vs staff, if both accounts are available) still hides/shows the correct tabs.
- Dashboard KPI cards, charts, Recent Sessions, Analytics Overview, and the KPI detail modal all load real data with no console errors.
- Start (or simulate) a counting session and confirm the Dashboard's Socket.IO-driven live update (the "Live" status dot and KPI refresh) still works.
- Navigate to Counter/Inventory/Adjustments/Settings and confirm they still function exactly as before (out of scope for this pass, but must not have broken from the shared token/Sidebar changes).

- [ ] **Step 3: Record completion**

No commit needed for this task — it's a verification gate. If any check fails, fix it under the task that owns the affected file and re-run this task before considering the plan complete.
