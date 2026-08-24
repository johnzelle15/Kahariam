# Kahariam Farms Design System — Counter Screen

## Context

Sub-project 2 of the Kahariam Farms redesign (sub-project 1:
`docs/superpowers/specs/2026-08-23-kahariam-design-system-foundation-design.md`,
shipped the token system, shared primitives in `frontend/src/components/ui/`,
and rebuilt Dashboard + Sidebar). Counter/Inventory/Adjustments/Settings/auth
were explicitly deferred to their own passes. This spec covers the first of
those: the **Counter screen** (`frontend/src/components/Counter.jsx`), the
screen an operator actually stands at and taps repeatedly on the Raspberry
Pi 5's physical 7-inch kiosk touchscreen (start/stop a counting session, save
the result to inventory).

Counter.jsx still uses the pre-redesign global CSS classes (`.glow-btn`,
`.glass-card`) and a leftover purple/blue/cyan gradient on the count number —
visually inconsistent with the rest of the app and, per sub-project 1's
color-tokens table, built on accent colors explicitly retired from active
use.

**New requirement for this pass:** the kiosk's physical screen is the
official Raspberry Pi 7" touchscreen, native resolution **800×480**. The
kiosk launches Firefox full-screen zoomed to 67%
(`scripts/setup/setup_rpi_firefox_inventory.sh`, `ZOOM_PERCENT=67`), so the
effective CSS viewport the page actually lays out against is approximately
**1194×716** (800/0.67 × 480/0.67). This spec designs the Counter screen to
fit that effective viewport, landscape, without scrolling — because this is
the one screen in the app used by touch, all day, not just occasionally
viewed.

**Non-goals:** no backend/API changes, no new npm dependencies, no change to
`Counter.jsx`'s data flow (same `rawApi`/`axios` calls, same Socket.IO
listeners, same lock/start/stop/save logic) — visual/layout rebuild only.
Inventory, Adjustments, Settings tabs, and auth screens remain out of scope,
each getting its own future pass.

## Current State (verified)

- `Counter.jsx` (350 lines): inline `ConfirmDialog` and `Toast`
  sub-components, `.glass-card`/`.glow-btn`/`.neu-input` global classes
  (defined in `frontend/src/styles.css`), a `bg-gradient-to-r from-accent-purple
  via-accent-blue to-accent-cyan` on the live count number.
- `.neu-input` already styles against `--input-*` tokens, which sub-project 1
  already reskinned to the Kahariam palette — reusing it as-is for the
  variant `<select>` needs no changes.
- `frontend/src/components/ui/` has `Button`, `Card`, `Modal`,
  `StatusIndicator` already built (see sub-project 1 spec for their props).
  None of the other primitives (`Badge`, `StatCard`, `PageHeader`,
  `EmptyState`, `LoadingState`) currently fit a "large live number + two
  action buttons" screen, except `PageHeader` for the title row.
- `Button`'s existing sizes (`sm`, `md`) top out at ~40px tall
  (`md`: `text-sm px-4 py-2.5` → 20px line-height + 20px vertical padding),
  under the 44×44px minimum touch-target guideline (WCAG 2.5.5, Apple HIG,
  Material Design). No `lg` size exists yet. (The variant `<select>`'s
  `.neu-input` class is also under 44px at ~37px tall — see Touch Targets
  below for why this pass leaves it as-is.)
- Layout today: `max-w-2xl mx-auto`, `flex-wrap` controls row, `sm:`
  breakpoint bumps for padding/text size — a reasonable narrow-viewport
  fallback, but not deliberately sized against the kiosk's effective
  1194×716 viewport, and not verified to avoid scrolling there.

## Component Change: `Button.jsx` `lg` size

Add one new size to the shared `Button` primitive (reusable by later
kiosk-facing passes, e.g. Adjustments' batch actions):

```js
const SIZES = {
  sm: 'text-sm px-3 py-1.5 gap-1.5',
  md: 'text-sm px-4 py-2.5 gap-2',
  lg: 'text-base px-5 py-3 gap-2',   // ~48px tall — clears the 44px touch-target floor
}
```

No other change to `Button.jsx`.

## Counter Screen Rebuild

`Counter.jsx` is rebuilt to compose existing primitives, replacing the
inline `ConfirmDialog` with the shared `Modal` and the raw markup with
`PageHeader`/`Card`/`Button`/`StatusIndicator`. Structure, top to bottom:

1. **`PageHeader`** — title `"AI Fish Counter"`, the connection
   `StatusIndicator` (`active`/`idle` status, "Live Connected"/"Disconnected"
   label) rendered as the header's right-aligned action instead of the
   current separately-centered pill. This reclaims the vertical space the
   standalone status row uses today.
2. **Lock warning** — when present, a slim inline banner (icon + text,
   `--accent-amber`) between the header and the controls card. Reserves no
   space when absent (no layout shift on appear/disappear beyond the
   banner's own height).
3. **Controls `Card`** — variant `<select>` (kept as `.neu-input`, unchanged
   styling) and Start/Stop `Button`s (`size="lg"`, `variant="primary"` for
   Start, `variant="danger"` for Stop) laid out in a single horizontal row
   (`flex items-end gap-4`, no `flex-wrap`) — the 1194px effective width has
   room; wrapping was only ever a narrow-desktop-window fallback, not a
   kiosk necessity.
4. **Count `Card`** — the live count as the page's clear visual focus:
   `text-7xl sm:text-8xl font-black text-accent-green` (brand green,
   replacing the retired purple/blue/cyan gradient), with the existing
   `active`-state glow effect kept (color updated to
   `rgba(124, 179, 66, 0.12)` to match). `Button` (`size="lg"`,
   `variant="primary"`, icon swaps `Save`/`Loader2`/`CheckCircle2` exactly as
   today) directly beneath the number — reachable without scrolling.
5. **`Modal`** (save confirmation) — title `"Save to Inventory?"`, body =
   today's confirmation sentence, footer = `Button variant="ghost"` Cancel +
   `Button variant="primary" icon={Save}` Confirm (loading state shows the
   spinning `Loader2` via `Button`'s built-in `loading` prop instead of the
   inline conditional today).
6. **Toast** — kept as the existing custom inline component (on-brand
   already; no shared Toast primitive exists yet and one screen doesn't
   justify building one in this pass).

All existing behavior is preserved exactly: `fetchState`, `start`, `stop`,
`poll`, `requestSave`, `handleConfirmSave`, `saveDisabled` logic, the
device-lock acquire/release calls, and the Socket.IO `reading`/
`counting_state` listeners are untouched — only the JSX/markup and styling
change.

## Touch Targets & Responsiveness

- Start, Stop, and Save all use `Button size="lg"` (~48px tall) — clears the
  44×44px minimum.
- The variant `<select>` keeps its current `.neu-input` styling unchanged
  (`padding: 0.625rem 1rem` + `font-size: 0.875rem` → ~37px tall, under the
  44px floor). Left as-is deliberately: it's a single-option control
  (`VARIANTS` has only `SPIN_20` today, so there's nothing to actually pick
  between yet) rather than a primary repeated tap target, and `.neu-input`
  is a shared global class also used by Adjustments/Inventory/Settings
  forms — bumping its padding here would be an unreviewed visual change to
  four other screens still out of scope. If a real touch-sizing need shows
  up for it later, that's a one-line fix, not a blocker for this pass.
- No separate "kiosk mode" — one responsive layout, deliberately checked to
  fit 1194×716 (kiosk effective viewport) without scrolling, and left to
  degrade naturally (existing `sm:` stacking behavior) on narrower desktop
  browser windows below that width.

## Verification

- `npm run dev`: visually check the Counter tab in both light and dark
  theme, at browser width ≈1194px (kiosk effective viewport — confirm no
  vertical scrollbar appears for the full flow: header through Save button)
  and at a normal desktop width (confirm graceful reflow, no regression).
- Confirm Start → live count updates via Socket.IO → Stop → Save →
  confirmation modal → toast, end-to-end against the running backend.
- Confirm the device-lock warning still appears/clears correctly (simulate
  a second lock holder if practical, or verify the lock/unlock network
  calls fire as before).
- `npm run build` — clean, no new warnings beyond the pre-existing
  chunk-size notice.
