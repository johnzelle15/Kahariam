/* The page's identity line.

   It carries a title, a quiet operational note beside it, and the controls for
   the screen — and nothing else. It used to open the dashboard with "Welcome
   back, admin" over "Here's what's happening on the farm today", which is two
   lines and roughly a tenth of the 7" panel spent on text that reports no farm
   state at all. An internal system says which screen you are on and when the
   data was read; the greeting is the thing that made it read as a template.
*/
export default function PageHeader({ title, meta, actions }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h1 className="text-base sm:text-lg [@media(max-height:620px)]:text-sm font-semibold tracking-tight text-text-primary
        flex items-baseline gap-2.5 min-w-0">
        <span className="truncate">{title}</span>
        {meta && <span className="meta font-normal shrink-0">{meta}</span>}
      </h1>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}
