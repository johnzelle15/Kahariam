import clsx from 'clsx'
import SectionHeader from './SectionHeader'

export default function Card({ title, meta, actions, className, padded = true, children, ...rest }) {
  return (
    <div
      className={clsx('glass-card', padded && 'card-pad', className)}
      {...rest}
    >
      {(title || actions) && (
        <SectionHeader title={title} meta={meta} actions={actions} className="mb-2.5" />
      )}
      {children}
    </div>
  )
}
