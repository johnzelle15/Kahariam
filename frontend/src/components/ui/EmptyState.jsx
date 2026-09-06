import clsx from 'clsx'
import Button from './Button'

/* `compact` is for an empty state sitting inside a panel that already has its
   own header and padding — a full py-16 block there reads as a hole in the
   page rather than a message. */
export default function EmptyState({ icon: Icon, title, message, actionLabel, onAction, compact = false }) {
  return (
    /* On a short screen an empty state is the one block whose height buys the
       reader nothing — it says there is no data. It keeps the message and drops
       the breathing room and the decorative icon disc. */
    <div className={clsx(
      'flex flex-col items-center justify-center text-center px-6',
      compact ? 'py-6 [@media(max-height:620px)]:py-2' : 'py-16 [@media(max-height:620px)]:py-4'
    )}>
      {Icon && (
        <div className="h-12 w-12 rounded-full bg-[var(--btn-secondary-bg)] flex items-center justify-center mb-4
          [@media(max-height:620px)]:hidden">
          <Icon size={22} className="text-text-muted" />
        </div>
      )}
      <h3 className="text-base [@media(max-height:620px)]:text-sm font-medium text-text-primary">{title}</h3>
      {message && <p className="text-sm [@media(max-height:620px)]:text-xs text-text-secondary mt-1 max-w-sm">{message}</p>}
      {actionLabel && onAction && (
        <Button variant="secondary" size="sm" onClick={onAction} className="mt-4">
          {actionLabel}
        </Button>
      )}
    </div>
  )
}
