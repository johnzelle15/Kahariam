import { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'
import clsx from 'clsx'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  /* useId, not a hardcoded "modal-title": two dialogs mounted at once — the
     dashboard's KPI detail and the sidebar's sign-out confirm both live in the
     tree — produced duplicate ids, so aria-labelledby resolved to whichever one
     the browser found first and a screen reader announced the wrong dialog. */
  const titleId = useId()
  const panelRef = useRef(null)
  const returnFocusRef = useRef(null)

  useEffect(() => {
    if (!open) return

    // Remember what had focus so it can be handed back on close, rather than
    // dropping the caret at the top of the document.
    returnFocusRef.current = document.activeElement
    const panel = panelRef.current
    panel?.focus()

    function onKey(e) {
      if (e.key === 'Escape') { onClose?.(); return }
      if (e.key !== 'Tab' || !panel) return

      // Keep Tab inside the dialog. Without this the focus ring walks out into
      // the page behind the overlay, where nothing is clickable.
      const items = [...panel.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null)
      if (items.length === 0) { e.preventDefault(); return }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault(); last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault(); first.focus()
      }
    }

    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      const el = returnFocusRef.current
      if (el && typeof el.focus === 'function') el.focus()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'var(--modal-overlay)' }}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={clsx(
          /* Bounded to the viewport with the body as the only scroller: on the
             800x480 panel the browser leaves under 400px of page, and an
             unbounded dialog ran off both ends of the screen with its close
             button out of reach. */
          'w-full rounded-xl border bg-dark-800 border-[var(--glass-border)] shadow-xl outline-none',
          'p-5 [@media(max-height:620px)]:p-3.5',
          'max-h-[calc(100dvh-2rem)] flex flex-col',
          size === 'sm' && 'max-w-sm',
          size === 'md' && 'max-w-md',
          size === 'lg' && 'max-w-lg',
          size === 'xl' && 'max-w-5xl'
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-3 [@media(max-height:620px)]:mb-2 shrink-0">
          <h2 id={titleId} className="text-sm font-semibold text-text-primary leading-snug">{title}</h2>
          <button
            onClick={onClose}
            className="-m-1 p-1 rounded text-text-muted hover:text-text-primary
              focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-green shrink-0"
            aria-label="Close dialog"
          >
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 mt-4 [@media(max-height:620px)]:mt-2.5 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
