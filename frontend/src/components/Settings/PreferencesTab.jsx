/**
 * PreferencesTab — Theme, sidebar, compact mode, date/time format.
 * Preferences are stored in localStorage (no backend call needed).
 */
import React, { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  Sun, Moon, PanelLeftClose, LayoutDashboard,
  Calendar, Clock, Palette, Save, Check,
} from 'lucide-react'
import useThemeStore, { THEMES } from '../../store/themeStore'

/* ── Shared card ─────────────────────────────────────────────────────────────── */
function SettingsCard({ title, description, children }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className="rounded-2xl p-5 md:p-6"
      style={{
        background: 'var(--glass-bg)',
        border: '1px solid var(--glass-border)',
        backdropFilter: 'blur(16px)',
      }}
    >
      {(title || description) && (
        <div className="mb-5">
          {title && <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h3>}
          {description && <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{description}</p>}
        </div>
      )}
      {children}
    </motion.div>
  )
}

/* ── Toggle switch ───────────────────────────────────────────────────────────── */
function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className="relative w-10 h-5.5 rounded-full flex-shrink-0 transition-all duration-200 border-none cursor-pointer"
      style={{
        background: checked ? 'var(--accent-purple)' : 'var(--glass-border-hover)',
        boxShadow: checked ? '0 0 8px rgba(139,92,246,0.35)' : 'none',
        width: '40px', height: '22px',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span
        className="absolute top-[3px] rounded-full transition-transform duration-200"
        style={{
          width: '16px',
          height: '16px',
          background: '#fff',
          left: '3px',
          transform: checked ? 'translateX(18px)' : 'translateX(0)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        }}
      />
    </button>
  )
}

/* ── Preference row ──────────────────────────────────────────────────────────── */
function PrefRow({ icon: Icon, label, description, children }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3"
      style={{ borderBottom: '1px solid var(--table-border)' }}>
      <div className="flex items-center gap-3 min-w-0">
        {Icon && (
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--glass-bg)', color: 'var(--accent-purple)' }}>
            <Icon className="w-4 h-4" />
          </div>
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{label}</p>
          {description && (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{description}</p>
          )}
        </div>
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  )
}

/* ── Select ──────────────────────────────────────────────────────────────────── */
function Select({ value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="rounded-lg px-3 py-1.5 text-xs font-medium outline-none transition-all duration-150 cursor-pointer"
      style={{
        background: 'var(--input-bg)',
        border: '1px solid var(--input-border)',
        color: 'var(--text-primary)',
        minWidth: '130px',
      }}
    >
      {options.map(opt => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  )
}

/* ── Theme card ──────────────────────────────────────────────────────────────── */
function ThemeCard({ id, label, active, onClick }) {
  const isDark = id === 'dark'
  const isLight = id === 'light'
  return (
    <button
      onClick={onClick}
      className="relative flex flex-col gap-2 p-3 rounded-xl cursor-pointer border transition-all duration-200"
      style={{
        background: isDark ? '#0a0f1a' : isLight ? '#f0f4ff' : '#0a1020',
        borderColor: active ? 'var(--accent-purple)' : 'var(--glass-border)',
        boxShadow: active ? '0 0 0 2px rgba(139,92,246,0.3)' : 'none',
        minWidth: '80px',
      }}
      aria-label={`Select ${label} theme`}
    >
      {active && (
        <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full flex items-center justify-center"
          style={{ background: 'var(--accent-purple)' }}>
          <Check className="w-2.5 h-2.5 text-white" />
        </span>
      )}
      {/* Mini preview bars */}
      <div className="flex flex-col gap-1">
        <div className="h-1.5 rounded-full w-full"
          style={{ background: isDark ? 'rgba(139,92,246,0.4)' : isLight ? '#7c3aed' : 'rgba(34,211,238,0.4)' }} />
        <div className="h-1 rounded-full w-4/5"
          style={{ background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }} />
        <div className="h-1 rounded-full w-3/5"
          style={{ background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }} />
      </div>
      <span className="text-[11px] font-semibold"
        style={{ color: isDark ? '#e8ecf2' : isLight ? '#111827' : '#22d3ee' }}>
        {label}
      </span>
    </button>
  )
}

/* ── Storage helper ──────────────────────────────────────────────────────────── */
const PREFS_KEY = 'fc_prefs'

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')
  } catch { return {} }
}

function savePrefs(prefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)) } catch { /* ignore */ }
}

/* ── PreferencesTab ──────────────────────────────────────────────────────────── */
export default function PreferencesTab({ toast }) {
  const { theme, setTheme } = useThemeStore()

  const [prefs, setPrefs] = useState(() => ({
    compactMode:  false,
    dateFormat:   'MMM D, YYYY',
    timeFormat:   '12h',
    language:     'en',
    ...loadPrefs(),
  }))
  const [saved, setSaved] = useState(false)

  function setPref(key, val) {
    setPrefs(p => ({ ...p, [key]: val }))
  }

  function handleSave() {
    savePrefs(prefs)
    setSaved(true)
    toast('Preferences saved', 'success')
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="flex flex-col gap-5">

      {/* ── Appearance ─────────────────────────────────────────────── */}
      <SettingsCard title="Appearance" description="Customize the visual theme">
        <div className="mb-4">
          <p className="text-xs font-medium mb-3" style={{ color: 'var(--text-secondary)' }}>Theme</p>
          <div className="flex gap-3 flex-wrap">
            {Object.values(THEMES).map(t => (
              <ThemeCard
                key={t.id}
                id={t.id}
                label={t.label}
                active={theme === t.id}
                onClick={() => setTheme(t.id)}
              />
            ))}
          </div>
        </div>
      </SettingsCard>

      {/* ── Layout ─────────────────────────────────────────────────── */}
      <SettingsCard title="Layout" description="Configure dashboard display options">
        <div>
          <PrefRow
            icon={LayoutDashboard}
            label="Compact Mode"
            description="Reduce spacing for more content on screen"
          >
            <Toggle
              checked={prefs.compactMode}
              onChange={v => setPref('compactMode', v)}
            />
          </PrefRow>
        </div>
      </SettingsCard>

      {/* ── Localization ───────────────────────────────────────────── */}
      <SettingsCard title="Localization" description="Date, time, and language settings">
        <div>
          <PrefRow icon={Calendar} label="Date Format" description="How dates are displayed">
            <Select
              value={prefs.dateFormat}
              onChange={v => setPref('dateFormat', v)}
              options={[
                { value: 'MMM D, YYYY',  label: 'Jan 1, 2026' },
                { value: 'MM/DD/YYYY',   label: '01/01/2026' },
                { value: 'DD/MM/YYYY',   label: '01/01/2026 (EU)' },
                { value: 'YYYY-MM-DD',   label: '2026-01-01' },
              ]}
            />
          </PrefRow>

          <PrefRow icon={Clock} label="Time Format" description="12-hour or 24-hour clock">
            <Select
              value={prefs.timeFormat}
              onChange={v => setPref('timeFormat', v)}
              options={[
                { value: '12h', label: '12-hour (AM/PM)' },
                { value: '24h', label: '24-hour' },
              ]}
            />
          </PrefRow>

          <div style={{ borderBottom: 'none' }}>
            <PrefRow icon={Palette} label="Language" description="Interface language">
              <Select
                value={prefs.language}
                onChange={v => setPref('language', v)}
                options={[
                  { value: 'en', label: 'English' },
                  { value: 'fil', label: 'Filipino' },
                ]}
              />
            </PrefRow>
          </div>
        </div>
      </SettingsCard>

      {/* Save button */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold
            transition-all duration-200 border-none cursor-pointer"
          style={{
            background: saved ? 'rgba(16,185,129,0.15)' : 'linear-gradient(135deg, #8B5CF6, #6366f1)',
            color: saved ? 'var(--accent-green)' : '#fff',
            border: saved ? '1px solid rgba(16,185,129,0.3)' : 'none',
            boxShadow: saved ? 'none' : '0 4px 14px rgba(139,92,246,0.25)',
          }}
        >
          {saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          {saved ? 'Saved!' : 'Save Preferences'}
        </button>
      </div>
    </div>
  )
}
