import clsx from 'clsx'

const VARIANTS = {
  primary: 'bg-accent-green text-white hover:brightness-110 active:brightness-95 shadow-sm',
  secondary: 'bg-[var(--btn-secondary-bg)] border border-[var(--btn-secondary-border)] text-text-primary hover:bg-[var(--btn-secondary-hover)]',
  ghost: 'bg-transparent text-text-secondary hover:bg-[var(--btn-secondary-bg)]',
  danger: 'bg-accent-red text-white hover:brightness-110 active:brightness-95 shadow-sm',
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
        'inline-flex items-center justify-center rounded-xl font-medium transition-all duration-150',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-accent-green/50',
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
