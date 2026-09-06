import { useEffect } from 'react'
import { X } from 'lucide-react'
import clsx from 'clsx'

export default function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose?.()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'var(--modal-overlay)' }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={clsx(
          /* Bounded to the viewport with the body as the only scroller: on the
             800x480 panel the browser leaves under 400px of page, and an
             unbounded dialog ran off both ends of the screen with its close
             button out of reach. */
          'w-full rounded-2xl border bg-dark-800 border-[var(--glass-border)] shadow-xl',
          'p-6 [@media(max-height:620px)]:p-4',
          'max-h-[calc(100dvh-2rem)] flex flex-col',
          size === 'sm' && 'max-w-sm',
          size === 'md' && 'max-w-md',
          size === 'lg' && 'max-w-lg',
          size === 'xl' && 'max-w-5xl'
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4 [@media(max-height:620px)]:mb-2 shrink-0">
          <h3 id="modal-title" className="text-lg [@media(max-height:620px)]:text-base font-medium text-text-primary">{title}</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 mt-6 [@media(max-height:620px)]:mt-3 shrink-0">{footer}</div>}
      </div>
    </div>
  )
}
