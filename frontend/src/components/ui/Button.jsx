import clsx from 'clsx'

const VARIANTS = {
  primary: 'bg-accent-green text-[var(--on-accent)] hover:brightness-110 active:brightness-95 shadow-sm',
  secondary: 'bg-[var(--btn-secondary-bg)] border border-[var(--btn-secondary-border)] text-text-primary hover:bg-[var(--btn-secondary-hover)]',
  ghost: 'bg-transparent text-text-secondary hover:bg-[var(--btn-secondary-bg)]',
  danger: 'bg-accent-red text-[var(--on-accent)] hover:brightness-110 active:brightness-95 shadow-sm',
}

const SIZES = {
  sm: 'text-sm px-3 py-1.5 gap-1.5',
  md: 'text-sm px-4 py-2.5 gap-2',
  lg: 'text-base px-5 py-3 gap-2',
}

export default function Button({
  variant = 'primary',
  size = 'md',
  icon: Icon,
  disabled = false,
  loading = false,
  className,
  children,
  ...rest
}) {
  return (
    <button
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center rounded-lg font-medium transition-all duration-150',
        // Disabled has to read as inert, not merely dimmer. At 50% on the dark
        // panel a disabled secondary button was indistinguishable from a live
        // one, which is how "Stop" and a dead "Stop & Save" ended up looking
        // like the same control.
        'disabled:opacity-40 disabled:saturate-50 disabled:shadow-none disabled:cursor-not-allowed',
        // focus-visible, not focus: a mouse or touch press used to leave the
        // ring stuck on the button afterwards. The pale halo around it came
        // from ring-offset, whose offset colour defaults to white — invisible
        // by design on light, a bright seam on this dark surface.
        'outline-none focus-visible:outline focus-visible:outline-2',
        'focus-visible:outline-offset-2 focus-visible:outline-accent-green',
        VARIANTS[variant],
        SIZES[size],
        className
      )}
      {...rest}
    >
      {loading ? (
        <span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
      ) : Icon ? (
        <Icon size={16} />
      ) : null}
      {children}
    </button>
  )
}
