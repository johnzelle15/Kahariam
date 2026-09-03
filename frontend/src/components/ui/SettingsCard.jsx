import { motion } from 'framer-motion'

/* The single settings-section card. Every Settings tab used to define its own
   copy of this (six times, each drifting slightly), so a change to the card
   chrome meant editing six files. */
export default function SettingsCard({ title, description, action, children }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className="glass-card p-5 md:p-6"
    >
      {(title || description || action) && (
        <div className="flex items-start justify-between gap-2 mb-5">
          <div>
            {title && <h3 className="text-base font-semibold text-text-primary">{title}</h3>}
            {description && <p className="text-xs mt-0.5 text-text-muted">{description}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </motion.div>
  )
}
