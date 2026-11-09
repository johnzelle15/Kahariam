import { useId, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import clsx from 'clsx'

/* One labelled text input.
 *
 * Settings had three copies of this — AccountTab's `InputField`, SecurityTab's
 * `PasswordInput`, and the fields inside UsersTab's staff modal — each
 * rebuilding the same control out of inline styles, and each mutating
 * `style.borderColor` from `onFocus`/`onBlur` handlers. That is why the focus
 * ring in Settings was purple while every other input in the app focuses green:
 * the ring was hardcoded per copy instead of coming from `.neu-input`, which
 * has always had the correct one in CSS.
 *
 * Inline handlers also meant the styling never reached `:focus-visible`, so a
 * mouse click left the ring stuck on, and the disabled state was an opacity
 * with no `cursor` or `aria` consequence.
 */
export default function Field({
  label,
  hint,
  /* `ok` turns the hint green — for a live check that came back clean, such as
     "username available". Feedback about a field belongs under that field, not
     as a chip floated to the far end of its label row. */
  ok = false,
  error,
  icon: Icon,
  /* `reveal` turns the field into a password box with a show/hide toggle.
     The toggle is a real tab stop: it was `tabIndex={-1}`, which put the only
     way to check a typed password out of reach of the keyboard. */
  reveal = false,
  type = 'text',
  id,
  className,
  inputClassName,
  ...rest
}) {
  const auto = useId()
  const fieldId = id || auto
  const [shown, setShown] = useState(false)

  const hintId = hint ? `${fieldId}-hint` : null
  const errId = error ? `${fieldId}-err` : null
  const describedBy = [errId, hintId].filter(Boolean).join(' ') || undefined

  return (
    <div className={clsx('flex flex-col gap-1', className)}>
      <label htmlFor={fieldId} className="text-xs font-medium text-text-secondary">
        {label}
      </label>

      <div className="relative">
        {Icon && (
          <Icon size={14} aria-hidden="true"
            className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-text-muted" />
        )}
        <input
          id={fieldId}
          type={reveal ? (shown ? 'text' : 'password') : type}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={clsx(
            'neu-input w-full',
            Icon && 'pl-8',
            reveal && 'pr-9',
            error && 'border-negative',
            inputClassName
          )}
          {...rest}
        />
        {reveal && (
          <button
            type="button"
            onClick={() => setShown(s => !s)}
            aria-label={shown ? 'Hide password' : 'Show password'}
            aria-pressed={shown}
            className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded text-text-muted
              hover:text-text-primary focus-visible:outline focus-visible:outline-2
              focus-visible:outline-accent-green"
          >
            {shown ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        )}
      </div>

      {error
        ? <p id={errId} className="text-xs text-negative">{error}</p>
        : hint && (
          <p id={hintId} className={clsx('text-xs', ok ? 'text-positive' : 'text-text-muted')}>
            {hint}
          </p>
        )}
    </div>
  )
}
