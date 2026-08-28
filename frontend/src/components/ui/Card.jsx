import clsx from 'clsx'

export default function Card({ title, actions, className, padded = true, children, ...rest }) {
  return (
    <div
      className={clsx('glass-card', padded && 'p-5', className)}
      {...rest}
    >
      {(title || actions) && (
        <div className="flex items-center justify-between mb-4">
          {title && <h3 className="text-lg font-medium text-text-primary">{title}</h3>}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  )
}
