import clsx from 'clsx'
import Button from './Button'

/* Two shapes, and the compact one is the default for anything living inside a
   panel that already has its own header.

   `compact` is left-aligned and takes only the height of its own two lines.
   Centring a message inside a flex-1 container is what turned "no sales in this
   period" into 650px of empty page with a grey disc floating in the middle of
   it — the panel was sized for a chart, and the empty state inherited the
   chart's height instead of collapsing the panel to the size of the message.
*/
export default function EmptyState({ icon: Icon, title, message, actionLabel, onAction, compact = false }) {
  if (compact) {
    return (
      <div className="flex items-start gap-2.5 py-2.5">
        {Icon && <Icon size={15} className="text-text-muted shrink-0 mt-px" aria-hidden="true" />}
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-text-secondary leading-snug">{title}</p>
          {message && <p className="meta mt-0.5">{message}</p>}
          {actionLabel && onAction && (
            <Button variant="secondary" size="sm" onClick={onAction} className="mt-2">
              {actionLabel}
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center text-center px-6 py-10
      [@media(max-height:620px)]:py-4">
      {Icon && (
        <Icon size={20} className="text-text-muted mb-2.5 [@media(max-height:620px)]:hidden" aria-hidden="true" />
      )}
      <h3 className="text-sm font-medium text-text-primary">{title}</h3>
      {message && <p className="text-xs text-text-secondary mt-1 max-w-xs leading-relaxed">{message}</p>}
      {actionLabel && onAction && (
        <Button variant="secondary" size="sm" onClick={onAction} className="mt-3">
          {actionLabel}
        </Button>
      )}
    </div>
  )
}
