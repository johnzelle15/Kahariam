import clsx from 'clsx'

/* The one treatment for "this block is called X". Before this existed the
   dashboard named its blocks three different ways — an 18px medium heading on
   Card, a 14px bold heading with an icon tile on Sales Trend, and a 12px bold
   uppercase label on Recent Activity — for what is structurally the same thing.

   `meta` is the quiet second half of the line: a date range, a count, a
   timestamp. It sits on the baseline beside the title instead of under it,
   because a second line here costs more of a 390px-tall panel than it is worth.
*/
export default function SectionHeader({ title, meta, actions, className, id }) {
  return (
    <div className={clsx('flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1', className)}>
      <h3 id={id} className="section-title flex items-baseline gap-2 min-w-0">
        <span className="truncate">{title}</span>
        {meta && <span className="meta font-normal shrink-0">{meta}</span>}
      </h3>
      {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
    </div>
  )
}
