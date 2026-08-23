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
