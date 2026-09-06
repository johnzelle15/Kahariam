import { motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'

/* The single settings-section card. Every Settings tab used to define its own
   copy of this (six times, each drifting slightly), so a change to the card
   chrome meant editing six files.

   `collapsible` makes the section a native <details>. A tab whose sections are
   all open at once is only readable on a tall screen: Security stacked four of
   them into 2550px, so on the 7" panel the operator scrolled past three audit
   logs to reach anything. Collapsed, each section states what it holds and how
   many rows are in it, and opens on a tap. `count` is what makes a shut section
   still worth reading — "Login History" alone says nothing that the heading
   doesn't. */
export default function SettingsCard({
  title, description, action, children,
  collapsible = false, defaultOpen = false, count,
}) {
  const heading = (
    <div className="min-w-0">
      {title && (
        <h3 className="text-base [@media(max-height:620px)]:text-sm font-semibold text-text-primary">
          {title}
        </h3>
      )}
      {description && (
        <p className="text-xs mt-0.5 text-text-muted [@media(max-height:620px)]:hidden">{description}</p>
      )}
    </div>
  )

  const countChip = count != null && (
    <span className="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums
      bg-[var(--btn-secondary-bg)] text-text-muted border border-[var(--glass-border)]">
      {count}
    </span>
  )

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className="glass-card p-5 md:p-6 [@media(max-height:620px)]:p-3"
    >
      {collapsible ? (
        <details open={defaultOpen} className="group">
          <summary className="cursor-pointer list-none flex items-center justify-between gap-3
            hover:text-accent-green transition-colors">
            <span className="flex items-center gap-2 min-w-0">
              <ChevronDown className="w-4 h-4 shrink-0 text-text-muted transition-transform
                duration-200 group-open:rotate-180" />
              {heading}
            </span>
            {countChip}
          </summary>
          <div className="mt-4 [@media(max-height:620px)]:mt-2.5">{children}</div>
        </details>
      ) : (
        <>
          {(title || description || action) && (
            <div className="flex items-start justify-between gap-2 mb-5 [@media(max-height:620px)]:mb-2">
              <span className="flex items-center gap-2 min-w-0">{heading}{countChip}</span>
              {action}
            </div>
          )}
          {children}
        </>
      )}
    </motion.div>
  )
}
