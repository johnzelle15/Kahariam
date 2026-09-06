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
        'flex flex-col gap-1.5 h-full',
        '[@media(max-height:620px)]:gap-0.5 [@media(max-height:620px)]:!p-2.5',
        emphasis && 'glass-card-raised',
        onClick && 'glass-card-interactive cursor-pointer'
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
      <div className="flex items-start justify-between gap-2">
        {/* The label wraps rather than truncating: on a phone, two of these sit
            across a 390px screen and "Stock on Hand" came out as "STOCK ON HA…". */}
        <span className="flex items-start gap-2 min-w-0">
          {tone && <span className={clsx('h-2 w-2 rounded-full shrink-0 mt-1', TONE_DOT[tone])} />}
          {/* Steps down at md for the same reason the figure does: that is where
              four of these share an 800px panel, and at text-xs "Stock on Hand"
              and "Stocked All Time" both wrapped to a second line — 16px of a
              480px screen spent on nothing. */}
          <span className="text-xs md:text-[10px] lg:text-xs font-medium text-text-muted uppercase tracking-wide leading-snug">{label}</span>
        </span>
        {Icon && <Icon size={18} className="text-accent-green shrink-0" />}
      </div>

      {/* Steps back down at md: that is where the dashboard starts putting four
          of these across an 800px panel, leaving ~120px of usable card width,
          and a seven-figure stock count truncates in a card that narrow. It
          climbs again at lg and xl, where four across is genuinely wide. */}
      <span
        className={clsx(
          'font-semibold tabular-nums text-text-primary truncate',
          emphasis
            ? 'text-2xl sm:text-3xl md:text-xl lg:text-2xl xl:text-3xl'
            : 'text-xl sm:text-2xl md:text-lg lg:text-xl xl:text-2xl'
        )}
      >
        {value}
      </span>

      {/* One line on the shortest screens: "gross additions, never decreases"
          wrapped to two and set the height of all four cards in the row. */}
      {sub && (
        <span className={clsx('text-xs font-medium [@media(max-height:520px)]:truncate',
          tone ? TONE_TEXT[tone] : 'text-text-muted')}>
          {sub}
        </span>
      )}

      {/* Dropped on the shortest screens — four of these are a whole row of the
          panel, and tapping the card shows the same comparison in the detail
          dialog with yesterday's figure spelled out beside it. */}
      {hasTrend && (
        <span className={clsx('text-xs font-medium [@media(max-height:520px)]:hidden',
          trendPositive ? 'text-accent-green' : 'text-accent-red')}>
          {trendPositive ? '+' : ''}
          {trend}% {trendLabel}
        </span>
      )}
    </Card>
  )
}
