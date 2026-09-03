import clsx from 'clsx'
import Button from './Button'

/* `compact` is for an empty state sitting inside a panel that already has its
   own header and padding — a full py-16 block there reads as a hole in the
   page rather than a message. */
export default function EmptyState({ icon: Icon, title, message, actionLabel, onAction, compact = false }) {
  return (
    <div className={clsx(
      'flex flex-col items-center justify-center text-center px-6',
      compact ? 'py-10' : 'py-16'
    )}>
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
