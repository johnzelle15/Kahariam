import clsx from 'clsx'

/* One labelled figure. It is a *cell*, not a card: it draws no border and no
   background of its own and expects to sit inside a `.strip`, which supplies
   the panel and the hairlines between cells. That is the whole difference
   between a row of related readings and the four floating tiles this replaced.

   `size` is the hierarchy control, and it is deliberately the only one — the
   dashboard has exactly three tiers of figure (the stock count that carries
   the screen, the headline revenue, and everything supporting them) and giving
   a caller a free-form font size is how a fourth tier gets invented by
   accident.
*/

const TONE_TEXT = {
  ok: 'text-positive',
  warning: 'text-attention',
  critical: 'text-negative',
}

const TONE_DOT = {
  ok: 'bg-positive',
  warning: 'bg-attention',
  critical: 'bg-negative',
}

const SIZES = {
  hero: 'figure figure-hero',
  md: 'figure',
  sm: 'figure figure-sm',
}

export default function Metric({
  label,
  value,
  sub,
  tone,
  size = 'sm',
  hint,
  onClick,
  className,
}) {
  const Tag = onClick ? 'button' : 'div'

  return (
    <Tag
      className={clsx('strip-cell', className)}
      {...(onClick ? { onClick, type: 'button', title: hint } : {})}
    >
      <span className="eyebrow flex items-center gap-1.5">
        {tone && <span className={clsx('h-1.5 w-1.5 rounded-full shrink-0', TONE_DOT[tone])} />}
        {/* The label wraps rather than truncating: on a phone two of these share
            a 390px screen, and "Stock on Hand" came out as "STOCK ON HA…". */}
        <span className="min-w-0">{label}</span>
      </span>

      <span className={clsx(SIZES[size], 'truncate')}>{value}</span>

      {sub && (
        <span className={clsx('meta truncate', tone && TONE_TEXT[tone])}>{sub}</span>
      )}
    </Tag>
  )
}
