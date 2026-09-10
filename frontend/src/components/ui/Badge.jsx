import clsx from 'clsx'

/* Tinted text on a tinted ground, not a pill. A rounded-full chip reads as a
   count or a tag; these mark the state of the row they sit in, so they take the
   same radius as everything else at this scale.
*/
const VARIANTS = {
  success: 'bg-positive/10 text-positive',
  warning: 'bg-attention/10 text-attention',
  error: 'bg-negative/10 text-negative',
  info: 'bg-info/10 text-info',
  neutral: 'bg-text-muted/10 text-text-secondary',
}

export default function Badge({ variant = 'neutral', children, className }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium leading-tight',
        VARIANTS[variant],
        className
      )}
    >
      {children}
    </span>
  )
}
