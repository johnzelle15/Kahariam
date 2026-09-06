/* The page title anchors the hierarchy but doesn't need to shout: at text-xl/2xl
   it stays clearly above the 14–18px card titles under it without eating a
   sixth of the viewport before any data shows. */
export default function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4
      [@media(max-height:620px)]:mb-2">
      <div>
        <h1 className="text-xl sm:text-2xl [@media(max-height:620px)]:text-base font-semibold tracking-tight text-text-primary">{title}</h1>
        {/* The greeting line is the first thing to go on a short screen: it is
            the one block on the page carrying no data. */}
        {subtitle && <p className="text-sm text-text-secondary mt-0.5 [@media(max-height:620px)]:hidden">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
