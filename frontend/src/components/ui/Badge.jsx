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
