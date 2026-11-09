import { ChevronDown } from 'lucide-react'
import clsx from 'clsx'
import SectionHeader from './SectionHeader'

/* A section *inside* a settings panel — not a panel of its own.
 *
 * Each of these used to be a free-floating card with 24px of padding. On a
 * 1920px screen that produced four stacked boxes 1360px wide, three of which
 * were collapsed and so consisted of a title, a subtitle, and a row count
 * floated 1300px away from the words it counted. Grouping them into one panel
 * divided by hairlines says the same thing — these belong together, this one is
 * shut — using a 1px line instead of four borders and 200px of card padding.
 *
 * `collapsible` keeps the native <details> behaviour it always had. A tab whose
 * sections are all open at once is only readable on a tall screen: Security
 * stacked four of them into 2550px, so on the 7" panel the operator scrolled
 * past three audit logs to reach anything. `count` is what makes a shut section
 * still worth reading — "Login history" alone says nothing the heading doesn't.
 */
export default function SettingsSection({
  title, description, action, children,
  collapsible = false, defaultOpen = false, count,
}) {
  /* The count sits on the title's baseline, next to the words. */
  const meta = [count != null ? String(count) : null, description]
    .filter(Boolean).join(' · ')

  if (collapsible) {
    return (
      <details open={defaultOpen} className="group card-pad">
        <summary className="cursor-pointer list-none flex items-center gap-1.5 rounded-sm
          focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-green">
          <ChevronDown size={14} aria-hidden="true"
            className="shrink-0 text-text-muted transition-transform duration-150 group-open:rotate-180" />
          <SectionHeader title={title} meta={meta} className="min-w-0 flex-1" />
        </summary>
        <div className="mt-3">{children}</div>
      </details>
    )
  }

  return (
    <section className="card-pad">
      {(title || description || action) && (
        <SectionHeader title={title} meta={meta} actions={action} className="mb-3" />
      )}
      {children}
    </section>
  )
}

/* The panel the sections live in. One card per tab. */
export function SettingsPanel({ className, children }) {
  return (
    <div className={clsx('glass-card divide-y divide-rule', className)}>
      {children}
    </div>
  )
}
