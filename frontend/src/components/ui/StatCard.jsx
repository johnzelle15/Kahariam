import clsx from 'clsx'
import Card from './Card'

export default function StatCard({ label, value, icon: Icon, trend, trendLabel, onClick }) {
  const hasTrend = typeof trend === 'number' && !Number.isNaN(trend)
  const trendPositive = hasTrend && trend >= 0

  return (
    <Card
      padded
      className={clsx(
        'flex flex-col gap-2',
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
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-text-muted uppercase tracking-wide">{label}</span>
        {Icon && <Icon size={18} className="text-accent-green" />}
      </div>
      <span className="text-2xl sm:text-3xl font-semibold tabular-nums text-text-primary truncate">{value}</span>
      {hasTrend && (
        <span className={clsx('text-xs font-medium', trendPositive ? 'text-accent-green' : 'text-accent-red')}>
          {trendPositive ? '+' : ''}
          {trend}% {trendLabel}
        </span>
      )}
    </Card>
  )
}
