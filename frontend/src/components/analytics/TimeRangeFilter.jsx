import React, { useState } from 'react'
import { Calendar } from 'lucide-react'

const PRESETS = [
  { key: '7d', label: '7 Days' },
  { key: '30d', label: '30 Days' },
  { key: 'month', label: 'Monthly' },
  { key: 'year', label: 'Yearly' },
]

export default function TimeRangeFilter({ value, onChange }) {
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const isCustom = value.type === 'custom'

  function selectPreset(key) {
    onChange({ type: 'preset', key })
  }

  function applyCustom(start, end) {
    if (start && end) {
      onChange({ type: 'custom', start, end })
    }
  }

  function handleStartChange(e) {
    const v = e.target.value
    setCustomStart(v)
    applyCustom(v, customEnd)
  }

  function handleEndChange(e) {
    const v = e.target.value
    setCustomEnd(v)
    applyCustom(customStart, v)
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <h2 className="text-lg sm:text-xl font-extrabold text-text-primary tracking-tight">Analytics</h2>

      <div className="flex flex-wrap items-center gap-2">
        {/* Preset pills */}
        <div className="flex items-center gap-0.5 p-0.5 rounded-lg"
          style={{ background: 'var(--btn-secondary-bg)', border: '1px solid var(--glass-border)' }}>
          {PRESETS.map(p => {
            const active = !isCustom && value.key === p.key
            return (
              <button
                key={p.key}
                onClick={() => selectPreset(p.key)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all duration-200 whitespace-nowrap ${
                  active ? 'text-white shadow-sm' : 'text-text-muted hover:text-text-primary'
                }`}
                style={active ? { background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-blue))' } : {}}
              >
                {p.label}
              </button>
            )
          })}
        </div>

        {/* Custom range */}
        <div className="flex items-center gap-1.5">
          <Calendar className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
          <input
            type="date"
            value={customStart}
            onChange={handleStartChange}
            className="neu-input text-xs py-1.5 px-2 w-[130px]"
            aria-label="Start date"
          />
          <span className="text-[10px] text-text-muted font-medium">to</span>
          <input
            type="date"
            value={customEnd}
            onChange={handleEndChange}
            className="neu-input text-xs py-1.5 px-2 w-[130px]"
            aria-label="End date"
          />
        </div>
      </div>
    </div>
  )
}
