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
