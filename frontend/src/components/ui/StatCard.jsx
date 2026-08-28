import clsx from 'clsx'
import Card from './Card'

const TONE_DOT = {
  ok: 'bg-accent-green',
  warning: 'bg-accent-amber',
  critical: 'bg-accent-red',
}

const TONE_TEXT = {
  ok: 'text-accent-green',
  warning: 'text-accent-amber',
  critical: 'text-accent-red',
}

export default function StatCard({
  label,
  value,
  icon: Icon,
  trend,
  trendLabel,
  sub,
  tone,
  emphasis = false,
  onClick,
}) {
  const hasTrend = typeof trend === 'number' && !Number.isNaN(trend) && trend !== 0
  const trendPositive = hasTrend && trend > 0

  return (
    <Card
      padded
      className={clsx(
        'flex flex-col gap-2 h-full',
        emphasis && 'bg-[var(--glass-bg-hover)] border-[var(--glass-border-hover)]',
        onClick && 'cursor-pointer hover:border-[var(--glass-border-hover)] transition-colors'
      )}
      {...(onClick
        ? {
            onClick,
            role: 'button',
            tabIndex: 0,
            onKeyDown: (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                if (e.key === ' ') e.preventDefault()
                onClick(e)
              }
            },
          }
        : {})}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 min-w-0">
          {tone && <span className={clsx('h-2 w-2 rounded-full shrink-0', TONE_DOT[tone])} />}
          <span className="text-xs font-medium text-text-muted uppercase tracking-wide truncate">{label}</span>
        </span>
        {Icon && <Icon size={18} className="text-accent-green shrink-0" />}
      </div>

      <span
        className={clsx(
          'font-semibold tabular-nums text-text-primary truncate',
          emphasis ? 'text-3xl sm:text-4xl' : 'text-2xl sm:text-3xl'
        )}
      >
        {value}
      </span>

      {sub && (
        <span className={clsx('text-xs font-medium', tone ? TONE_TEXT[tone] : 'text-text-muted')}>
          {sub}
        </span>
      )}

      {hasTrend && (
        <span className={clsx('text-xs font-medium', trendPositive ? 'text-accent-green' : 'text-accent-red')}>
          {trendPositive ? '+' : ''}
          {trend}% {trendLabel}
        </span>
      )}
    </Card>
  )
}
