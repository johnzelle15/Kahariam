/* The page title is the one piece of type that anchors the whole hierarchy,
   and at 24px it was barely separated from the 18px card titles under it.
   30px from sm upward gives the page a clear top of the stack. */
export default function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-text-primary">{title}</h1>
        {subtitle && <p className="text-sm text-text-secondary mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
