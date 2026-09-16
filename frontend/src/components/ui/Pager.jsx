import { ChevronLeft, ChevronRight } from 'lucide-react'

/* The footer of a paged list: which rows these are, how many to a page, and
   the pages. Lifted from Inventory so Adjustments pages the same way — it had
   its own row of 32px squares under a 24px margin, with the rows-per-page
   choice up in the filter bar, away from the list it sized. */
export default function Pager({ page, pages, total, perPage, options, onPage, onPerPage }) {
  function go(p) {
    if (p >= 1 && p <= pages) onPage(p)
  }

  function pageNumbers() {
    const nums = []
    const maxVisible = 5
    let start = Math.max(1, page - Math.floor(maxVisible / 2))
    const end = Math.min(pages, start + maxVisible - 1)
    if (end - start + 1 < maxVisible) start = Math.max(1, end - maxVisible + 1)
    for (let i = start; i <= end; i++) nums.push(i)
    return nums
  }

  const first = (page - 1) * perPage + 1
  const last = Math.min(page * perPage, total)

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-[var(--pad-card)] py-2 border-t border-rule">
      <p className="meta tabular-nums">
        {first.toLocaleString()}–{last.toLocaleString()} of {total.toLocaleString()}
      </p>
      <div className="flex items-center gap-2">
        <label className="meta flex items-center gap-1.5">
          Rows
          <select value={perPage} onChange={e => onPerPage(Number(e.target.value))}
            className="neu-input py-1 text-[13px]">
            {options.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        {pages > 1 && (
          <nav aria-label="Pages" className="flex items-center gap-1">
            <button type="button" onClick={() => go(page - 1)} disabled={page <= 1}
              aria-label="Previous page" className="icon-btn disabled:opacity-40 disabled:cursor-not-allowed">
              <ChevronLeft size={16} />
            </button>
            {/* Page numbers from sm; on a phone "1–5 of 177" already says
                where you are, and five 44px targets don't fit beside it. */}
            <div className="hidden sm:block">
              <div className="segmented">
                {pageNumbers().map(p => (
                  <button key={p} type="button" onClick={() => go(p)}
                    data-active={p === page} aria-current={p === page ? 'page' : undefined}
                    aria-label={`Page ${p}`} className="tabular-nums">
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <button type="button" onClick={() => go(page + 1)} disabled={page >= pages}
              aria-label="Next page" className="icon-btn disabled:opacity-40 disabled:cursor-not-allowed">
              <ChevronRight size={16} />
            </button>
          </nav>
        )}
      </div>
    </div>
  )
}
