/**
 * AccountTab — Profile image upload, name, email, role badge, last login.
 */
import React, { useEffect, useState, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import { User, Camera, Save, Loader2, Mail, AtSign, Clock, Shield, Lock } from 'lucide-react'
import api from '../../utils/api'
import useAuthStore from '../../store/authStore'

/* ── Reusable helpers ────────────────────────────────────────────────────────── */
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
          {title && (
            <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
              {title}
            </h3>
          )}
          {description && (
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {description}
            </p>
          )}
        </div>
      )}
      {children}
    </motion.div>
  )
}

function InputField({ label, id, value, onChange, type = 'text', placeholder, disabled, icon: Icon }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </label>
      <div className="relative">
        {Icon && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: 'var(--text-muted)' }}>
            <Icon className="w-4 h-4" />
          </span>
        )}
        <input
          id={id}
          type={type}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full rounded-xl px-3 py-2.5 text-sm outline-none transition-all duration-150"
          style={{
            paddingLeft: Icon ? '2.25rem' : undefined,
            background: 'var(--input-bg)',
            border: '1px solid var(--input-border)',
            color: 'var(--text-primary)',
            boxShadow: 'var(--input-shadow)',
            opacity: disabled ? 0.5 : 1,
            cursor: disabled ? 'not-allowed' : 'auto',
          }}
          onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent-purple)'; e.currentTarget.style.boxShadow = 'var(--input-focus-shadow)' }}
          onBlur={e => { e.currentTarget.style.borderColor = 'var(--input-border)'; e.currentTarget.style.boxShadow = 'var(--input-shadow)' }}
        />
      </div>
    </div>
  )
}

function RoleBadge({ role }) {
  const isAdmin = role === 'admin'
  return (
    <span
      className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider"
      style={{
        background: isAdmin ? 'rgba(167,139,250,0.12)' : 'rgba(96,165,250,0.10)',
        color:      isAdmin ? 'var(--accent-purple)'   : 'var(--accent-blue)',
        border:     `1px solid ${isAdmin ? 'rgba(167,139,250,0.25)' : 'rgba(96,165,250,0.2)'}`,
      }}
    >
      <Shield className="w-2.5 h-2.5" />
      {role}
    </span>
  )
}

function Skeleton({ width = '100%', height = 16, className = '' }) {
  return (
    <div
      className={`rounded-lg animate-pulse ${className}`}
      style={{ width, height, background: 'var(--skeleton-via)' }}
    />
  )
}

/* ── AccountTab ─────────────────────────────────────────────────────────────── */
export default function AccountTab({ toast }) {
  const user     = useAuthStore(s => s.user)
  const setUser  = useAuthStore(s => s.setUser)
  const isAdmin  = user?.role === 'admin'

  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [imgSaving, setImgSaving] = useState(false)
  const [profile, setProfile] = useState({
    fullname: '', username: '', email: '', role: '', last_login: null, profile_image: '',
  })
  const [errors, setErrors] = useState({})
  const fileRef = useRef(null)

  /* Fetch latest profile */
  const fetchProfile = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/settings/me')
      setProfile({
        fullname:      data.fullname || '',
        username:      data.username || '',
        email:         data.email || '',
        role:          data.role || 'staff',
        last_login:    data.last_login || null,
        profile_image: data.profile_image || '',
      })
    } catch {
      toast('Failed to load profile', 'error')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { fetchProfile() }, [fetchProfile])

  /* Validation */
  function validate() {
    const errs = {}
    if (!profile.email.trim()) {
      errs.email = 'Email is required'
    } else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(profile.email)) {
      errs.email = 'Enter a valid email'
    }
    if (profile.fullname && profile.fullname.length > 200) {
      errs.fullname = 'Full name is too long'
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function handleSave(e) {
    e.preventDefault()
    if (!validate()) return
    setSaving(true)
    try {
      await api.put('/settings/profile', {
        fullname: profile.fullname,
        email:    profile.email,
      })
      toast('Profile updated successfully', 'success')
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to update profile', 'error')
    } finally {
      setSaving(false)
    }
  }

  /* Profile image upload */
  function handleImageFile(file) {
    if (!file) return
    if (file.size > 2 * 1024 * 1024) {
      toast('Image must be under 2 MB', 'error'); return
    }
    const reader = new FileReader()
    reader.onload = async (ev) => {
      const dataUri = ev.target.result
      setImgSaving(true)
      try {
        const base64 = dataUri.split(',')[1]
        const { data } = await api.post('/settings/profile-image', { image: base64 })
        setProfile(p => ({ ...p, profile_image: data.profile_image }))
        if (setUser) setUser({ profile_image: data.profile_image })
        toast('Profile picture updated', 'success')
      } catch (err) {
        toast(err.response?.data?.error || 'Image upload failed', 'error')
      } finally {
        setImgSaving(false)
      }
    }
    reader.readAsDataURL(file)
  }

  function handleDrop(e) {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file?.type.startsWith('image/')) handleImageFile(file)
  }

  function formatDate(d) {
    if (!d) return 'Never'
    try {
      return new Date(d).toLocaleString(undefined, {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    } catch { return d }
  }

  const initials = profile.fullname
    ? profile.fullname.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : (profile.username?.[0] || '?').toUpperCase()

  return (
    <div className="flex flex-col gap-5">

      {/* ── Profile Image + Identity ─────────────────────────────────── */}
      <SettingsCard title="Profile" description="Your public identity in the system">
        {loading ? (
          <div className="flex items-center gap-5">
            <Skeleton width={80} height={80} className="rounded-full" />
            <div className="flex-1 flex flex-col gap-2">
              <Skeleton width="60%" height={20} />
              <Skeleton width="40%" height={14} />
            </div>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
            {/* Avatar */}
            <div className="relative flex-shrink-0">
              <div
                className="w-20 h-20 rounded-2xl overflow-hidden flex items-center justify-center text-2xl font-bold select-none"
                style={{
                  background: profile.profile_image
                    ? 'transparent'
                    : 'linear-gradient(135deg, rgba(139,92,246,0.3), rgba(96,165,250,0.2))',
                  border: '2px solid var(--glass-border)',
                  color: 'var(--accent-purple)',
                }}
              >
                {profile.profile_image
                  ? <img src={profile.profile_image} alt="avatar" className="w-full h-full object-cover" />
                  : initials
                }
              </div>
              {/* Upload overlay */}
              <button
                onClick={() => fileRef.current?.click()}
                disabled={imgSaving}
                onDragOver={e => e.preventDefault()}
                onDrop={handleDrop}
                className="absolute inset-0 rounded-2xl flex items-center justify-center
                  opacity-0 hover:opacity-100 transition-opacity duration-200 cursor-pointer border-none"
                style={{ background: 'rgba(0,0,0,0.55)' }}
                title="Change profile picture"
                aria-label="Change profile picture"
              >
                {imgSaving
                  ? <Loader2 className="w-5 h-5 animate-spin text-white" />
                  : <Camera className="w-5 h-5 text-white" />
                }
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => handleImageFile(e.target.files?.[0])}
              />
            </div>

            {/* Identity info */}
            <div className="flex-1 flex flex-col gap-1.5 text-center sm:text-left">
              <div className="flex items-center gap-2 justify-center sm:justify-start flex-wrap">
                <span className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {profile.fullname || profile.username}
                </span>
                <RoleBadge role={profile.role} />
              </div>
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>@{profile.username}</span>
              <div className="flex items-center gap-1.5 justify-center sm:justify-start mt-1"
                style={{ color: 'var(--text-muted)' }}>
                <Clock className="w-3.5 h-3.5" />
                <span className="text-xs">Last login: {formatDate(profile.last_login)}</span>
              </div>
            </div>
          </div>
        )}
      </SettingsCard>

      {/* ── Edit Form ─────────────────────────────────────────────────── */}
      <SettingsCard title="Personal Information" description="Update your name and contact email">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <Skeleton width="40%" height={12} />
                <Skeleton height={40} />
              </div>
            ))}
          </div>
        ) : (
          <form onSubmit={handleSave} noValidate>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <InputField
                label="Full Name"
                id="fullname"
                value={profile.fullname}
                onChange={e => setProfile(p => ({ ...p, fullname: e.target.value }))}
                placeholder="John Doe"
                icon={User}
              />
              {errors.fullname && (
                <p className="sm:col-span-2 -mt-2 text-xs" style={{ color: 'var(--accent-red)' }}>
                  {errors.fullname}
                </p>
              )}

              <InputField
                label="Username"
                id="username"
                value={profile.username}
                disabled
                icon={AtSign}
              />
              {/* Explain why username is locked */}
              {!isAdmin && (
                <div className="sm:col-span-2 -mt-2 flex items-center gap-1.5 text-[11px]"
                  style={{ color: 'var(--text-muted)' }}>
                  <Lock className="w-3 h-3 flex-shrink-0" />
                  Username can only be changed by an administrator.
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <InputField
                  label="Email Address"
                  id="email"
                  type="email"
                  value={profile.email}
                  onChange={e => setProfile(p => ({ ...p, email: e.target.value }))}
                  placeholder="you@example.com"
                  icon={Mail}
                />
                {errors.email && (
                  <p className="text-xs" style={{ color: 'var(--accent-red)' }}>{errors.email}</p>
                )}
              </div>
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold
                  transition-all duration-200 border-none cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                style={{
                  background: 'linear-gradient(135deg, #8B5CF6, #6366f1)',
                  color: '#fff',
                  boxShadow: '0 4px 14px rgba(139,92,246,0.25)',
                }}
                onMouseEnter={e => { if (!saving) e.currentTarget.style.boxShadow = '0 4px 20px rgba(139,92,246,0.4)' }}
                onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 4px 14px rgba(139,92,246,0.25)' }}
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {saving ? 'Saving…' : 'Save Profile'}
              </button>
            </div>
          </form>
        )}
      </SettingsCard>
    </div>
  )
}
