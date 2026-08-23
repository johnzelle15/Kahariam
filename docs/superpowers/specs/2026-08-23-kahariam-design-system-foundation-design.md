# Kahariam Farms Design System — Foundation + Dashboard

## Context

Fish Counter's frontend currently reads as a generic dark-glassmorphism admin
dashboard. The client is Kahariam Farms, a tilapia aquaculture operation, and
the whole app needs to feel like a premium product built specifically for
them: natural, calm, data-driven, trustworthy — farm × water × AI monitoring,
not a neon SaaS template.

This is sub-project 1 of a larger, explicitly-scoped-down redesign: it ships
the design-token system, the shared component primitives, and the rebuilt
Dashboard as one working, verifiable slice. Inventory, the AI Fish Counter
screen, Adjustments/Batches, and Settings get their own follow-up passes once
this foundation is in place and proven — attempting all pages in one pass
was rejected as too large a single change to verify safely.

The live kahariamfarms.com did not return usable content to the fetch tool
(likely a JS-rendered site); the palette below is derived from the logo
asset the client provided directly (gold/orange sun, two-tone green hills,
olive-green wordmark) rather than invented from generic "aquaculture" or
"farm" stock associations.

**Non-goals:** no backend/API/route changes, no new npm dependencies, no new
metrics or fabricated data, no removal of any currently-reachable feature or
functionality, no rewrite of the theming *architecture* (CSS custom
properties → Tailwind, `.theme-dark`/`.theme-light` swap via
`themeStore.js`) — only its token *values* and the components built on it
change.

## Current State (verified)

- `frontend/src/styles.css` defines the full token set on `:root,.theme-dark`
  and `.theme-light`: `--bg-{primary,secondary,tertiary,elevated}` (RGB
  triples for Tailwind's `<alpha-value>` opacity syntax), `--glass-*`,
  `--text-{primary,secondary,muted}`, `--accent-{purple,blue,cyan,green,red,amber}`,
  `--input-*`, `--sidebar-*`, `--tooltip-*`, `--chart-*`, `--scrollbar-*`,
  `--skeleton-*`, `--modal-overlay`, `--table-*`, `--btn-secondary-*`.
- `frontend/tailwind.config.js` maps a subset of those into
  `theme.extend.colors` (`dark.900/800/700/600`, `glass.*`, `accent.*`,
  `text.*`) plus `fontFamily.sans: ['Inter', ...]`.
- Inter is already loaded via Google Fonts `<link>` in `frontend/index.html`
  (weights 300–900) — no font work needed.
- No `frontend/src/components/ui/` directory exists. Confirm/modal dialogs
  are hand-duplicated inline in 8 files (`Counter.jsx`, `Adjustments.jsx`,
  `Inventory.jsx`, `Dashboard.jsx`, `ResetPassword.jsx`,
  `Settings/SecurityTab.jsx`, `Settings/SystemTab.jsx`,
  `Settings/UsersTab.jsx`).
- `Sidebar.jsx` already implements collapse, role-filtered nav items
  (`ADMIN_TABS`/`STAFF_TABS`), theme toggle, and a mobile off-canvas drawer —
  this is reused, only reskinned.
- Confirmed dead code (zero imports anywhere outside itself, verified by
  grep in the earlier repo analysis): `frontend/src/components/analytics/`
  (7 files), `Settings/SystemTab.jsx`, `Settings/NotificationsTab.jsx`,
  `Settings/PreferencesTab.jsx`, `components/Nav.jsx` (stub returning
  `null`), `components/Dashboard.jsx.bak`.

## Color Tokens

Derived from the logo (warm gold/orange sun, layered greens, olive
wordmark). These are the new *values* for the existing token names — no
token is renamed, so every component that already references
`var(--bg-primary)`, `text-accent-green`, etc. picks up the new look without
being touched, except where this spec explicitly rebuilds a component.

| Role | Token(s) | Light (new default) | Dark (restyled) |
|---|---|---|---|
| Background | `--bg-primary` | `#FAF7F1` warm off-white | `#161C16` deep botanical near-black |
| Background (secondary/tertiary/elevated) | `--bg-secondary/tertiary/elevated` | stepped tints toward `#F0ECE3` → `#E4DFD1` | stepped tints toward `#1F281F` → `#2A3529` |
| Surface / glass | `--glass-bg`, `--glass-border` | near-opaque white `rgba(255,255,255,.75)` w/ hairline warm-neutral border | translucent deep green `rgba(255,255,255,.03)` w/ hairline border, same pattern as today |
| Text primary | `--text-primary` | `#2A2E27` deep neutral | `#EDEFE9` |
| Text secondary/muted | `--text-secondary/muted` | `#5A6154` / `#8A8F86` | `#B7C2B0` / `#8FA089` |
| Primary (brand green) | `--accent-green` | `#4C7A3D` | `#7CB342` (lifted for dark-bg contrast) |
| Secondary (aquatic) | new `--accent-teal` | `#5E9B94` | `#6FB3AC` |
| Warning | `--accent-amber` | `#D98E3B` | `#E0A24F` |
| Error | `--accent-red` | `#B5533F` restrained terracotta | `#D97862` |
| Info | `--accent-blue` | `#4A7C8C` aquatic blue | `#6FA0AF` |
| `--accent-purple`, `--accent-cyan` | retired from active use | — kept defined (harmless) but no new component references them; anything still using them today keeps working, unstyled-by-neglect risk is zero since they just become another muted accent |

`--modal-overlay`, `--input-*`, `--sidebar-*`, `--table-*`,
`--btn-secondary-*`, `--scrollbar-*`, `--skeleton-*`, `--tooltip-*`,
`--chart-*` all get warm/earthy-neutral equivalents of their current
rgba-black/white formulas (same alpha structure, new base hue) — mechanical,
not enumerated line-by-line here.

## Typography

No new dependency — Inter is already loaded. Scale (Tailwind utility
classes, not new custom classes):

- Display: `text-4xl md:text-5xl font-semibold tracking-tight`
- Heading: `text-2xl font-semibold`
- Subheading: `text-lg font-medium`
- Body: `text-sm md:text-base font-normal`
- Caption: `text-xs text-muted`
- Data/KPI: `text-3xl font-semibold tabular-nums` — `tabular-nums` added
  specifically so counts/currency align in tables and stat cards.

## Layout

No topbar is introduced. The app is router-less (tab state in `App.jsx`),
and the spec's "sidebar + topbar" recommendation is satisfied by:
`Sidebar` (existing, reskinned) + a new `PageHeader` component rendered at
the top of each page's content area (title, optional subtitle, right-aligned
contextual actions slot). This matches the existing navigation model instead
of introducing a second, redundant nav surface.

## New Components (`frontend/src/components/ui/`)

One file per component, each a small, focused primitive — no prop-explosion,
no variants beyond what the spec's own component list and current usage
actually need:

- `Button.jsx` — variants `primary | secondary | ghost | danger`, sizes
  `sm | md`, replaces the `.glow-btn` class-based pattern with a real
  component so hover/focus/disabled states live in one place.
- `Card.jsx` — replaces `.glass-card` usage; a plain padded surface with
  optional `title`/`actions` header slot.
- `Badge.jsx` — status pill, variants map to `success|warning|error|info|neutral`.
- `StatCard.jsx` — label + value (tabular-nums) + optional trend delta +
  optional icon; used for KPI rows.
- `PageHeader.jsx` — title/subtitle/actions, see Layout above.
- `EmptyState.jsx` — icon + message + optional action button; used for
  "no data" / "no results" cases per spec §16 (Dashboard scope: applied
  where Dashboard already has an empty/zero-data path today — no new
  empty-state scenarios are invented for pages outside this pass).
- `LoadingState.jsx` — skeleton block(s), reusing the existing
  `--skeleton-from/via` tokens.
- `Modal.jsx` — overlay + panel + title/body/footer slots, consolidating
  the pattern currently duplicated inline. **Only Dashboard's existing
  modal usage is migrated to it in this pass**; the other 7 files keep
  their inline implementation until their own redesign pass, so this
  spec doesn't silently touch Counter/Adjustments/Inventory/Settings
  behavior.
- `StatusIndicator.jsx` — small dot+label (e.g. "AI Counter: Idle/Active"),
  built now because Dashboard's socket-status display needs it; reused
  later by the AI Counter page pass.

## Dashboard Rebuild

`Dashboard.jsx` (currently 1135 lines, inline styles + ad hoc markup) is
rebuilt to compose the primitives above around its **existing** data:
`GET /get_statistics`, `GET /api/low-stock`, `GET /api/current-fish`,
`GET /api/daily-trend`, and the existing Socket.IO `reading`/
`counting_state` listeners. No new endpoint is called, no metric is added
that the backend doesn't already return. The existing inline "Analytics
Overview" insight engine (`generateInsights`) is kept as-is functionally,
restyled to sit in a `Card`.

## Cleanup (in scope, zero risk)

Delete: `frontend/src/components/analytics/` (7 files, confirmed
unreferenced), `Settings/SystemTab.jsx`, `Settings/NotificationsTab.jsx`,
`Settings/PreferencesTab.jsx`, `components/Nav.jsx`, `components/Dashboard.jsx.bak`.
None are imported anywhere; deletion has no functional effect. (`Settings/index.jsx`
already doesn't wire these tabs up.)

## Explicitly Out of Scope (follow-up passes)

Counter/AI Fish Counter screen, Inventory, Adjustments/Batches, Settings
tabs (Account/Security/Users), auth screens (Login/OTP/ForgotPassword/
ResetPassword), analytics charts beyond what Dashboard already shows,
responsive/touch pass beyond what falls out of the new components by
default, and migrating the other 7 files' inline modals to the shared
`Modal` component. Each becomes its own brainstorm→plan→implement pass
reusing this same token system and component library.

## Verification

- `npm run dev`, visually check: Dashboard renders with real data in both
  light and dark theme, theme toggle still works, Sidebar nav/collapse/role
  filtering still works, no console errors.
- Confirm Socket.IO live-update still updates the Dashboard (start/stop a
  counting session or trigger a test reading).
- Confirm deleted files' absence doesn't break the build (`npm run build`).
- No change to any `backend/` file; no change to any axios/data-fetching
  call signature in `Dashboard.jsx` (same URLs, same params).
