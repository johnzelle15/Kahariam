import clsx from 'clsx'

const COLORS = {
  active: 'bg-positive',
  idle: 'bg-text-muted',
  error: 'bg-negative',
  warning: 'bg-attention',
}

/* No pulse on the active dot. A connection that is simply up does not need to
   report itself twice a second, and on a wall-mounted panel that never sleeps
   it is motion in the operator's peripheral vision all day. The dot changing
   colour is the signal; movement is reserved for something actually changing.
*/
export default function StatusIndicator({ status = 'idle', label }) {
  return (
    <span className="inline-flex items-center gap-1.5 meta">
      <span className={clsx('h-1.5 w-1.5 rounded-full shrink-0', COLORS[status] || COLORS.idle)} />
      {label}
    </span>
  )
}
