import { Wheat } from 'lucide-react'
import { feedStatusView } from '../utils/feed'

/* Literal class strings, one per tone, so Tailwind can see them. */
const TONES = {
  positive: 'border-positive/25 bg-positive/10 text-positive',
  attention: 'border-attention/25 bg-attention/10 text-attention',
  negative: 'border-negative/25 bg-negative/10 text-negative',
  info: 'border-info/25 bg-info/10 text-info',
}

/* The feed purchasing alert, tinted by how soon feed is needed — the app's alert
   band. `compact` is the dashboard's: it rides in the page header beside Live,
   and on a short screen drops the expected date and estimate (the Feed page
   still has them), because on the 7" panel a row of its own pushed the
   dashboard further past the bottom of the screen. `action` ends the line. */
export default function FeedAlert({ status, action, compact = false }) {
  const view = feedStatusView(status)
  const urgent = status.status === 'due' || status.status === 'overdue'
  return (
    <div role={urgent ? 'alert' : 'status'}
      className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border px-3 py-1 text-xs ${TONES[view.tone]}`}>
      <Wheat size={14} className="shrink-0" aria-hidden="true" />
      <span className="font-semibold">{view.label}</span>
      <span className={`text-text-secondary ${compact ? '[@media(max-height:620px)]:hidden' : ''}`}>
        {view.detail}
      </span>
      {action && <span className="ml-auto">{action}</span>}
    </div>
  )
}
