/**
 * AccountTab — Profile image upload, name, email, role badge, last login.
 */
import React, { useEffect, useState, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import { User, Camera, Save, Loader2, Mail, AtSign, Clock } from 'lucide-react'
import api from '../../utils/api'
import useAuthStore from '../../store/authStore'
import { Badge, Button, Field, SettingsSection, SettingsPanel, Skeleton } from '../ui'

/* ── Reusable helpers ────────────────────────────────────────────────────────── */
/* InputField and RoleBadge used to be defined here: a hand-rolled input whose
   focus ring was painted purple by an inline onFocus handler, and a role chip
   built from rgba() literals left over from the pre-olive palette. Both are now
   the shared <Field> and <Badge>. */

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
    <SettingsPanel>

      {/* ── Identity ──
             A person's own account, so it opens with who you are signed in as.
             The avatar tile carried a violet-to-blue gradient and violet
             initials — two colours from the palette this app replaced, on the
             one element that is meant to read as a photograph's stand-in. */}
      <SettingsSection title="Profile" description="your identity in the system">
        {loading ? (
          <div className="flex items-center gap-4">
            <Skeleton width={56} height={56} className="!rounded-lg" />
            <div className="flex-1 flex flex-col gap-2">
              <Skeleton width="45%" height={16} />
              <Skeleton width="30%" height={12} />
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-4">
            {/* Avatar */}
            <div className="relative shrink-0">
              <div
                className="w-14 h-14 [@media(max-height:620px)]:w-11 [@media(max-height:620px)]:h-11
                  rounded-lg overflow-hidden flex items-center justify-center
                  text-lg [@media(max-height:620px)]:text-sm font-semibold select-none
                  bg-[var(--btn-secondary-bg)] border border-[var(--glass-border)] text-text-secondary"
              >
                {profile.profile_image
                  ? <img src={profile.profile_image} alt="" className="w-full h-full object-cover" />
                  : initials
                }
              </div>
              {/* Upload overlay. Given a focus-visible ring: it was reachable by
                  Tab but invisible until hovered, so a keyboard user landed on a
                  control they could not see. */}
              <button
                onClick={() => fileRef.current?.click()}
                disabled={imgSaving}
                onDragOver={e => e.preventDefault()}
                onDrop={handleDrop}
                className="absolute inset-0 rounded-lg flex items-center justify-center border-none
                  cursor-pointer bg-black/55 opacity-0 hover:opacity-100 focus-visible:opacity-100
                  focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-green
                  transition-opacity duration-150"
                title="Change profile picture"
                aria-label="Change profile picture"
              >
                {imgSaving
                  ? <Loader2 className="w-4 h-4 animate-spin text-white" />
                  : <Camera className="w-4 h-4 text-white" />
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
            <div className="min-w-0 flex flex-col gap-0.5">
              <span className="flex items-baseline gap-2 flex-wrap">
                <span className="text-sm font-semibold text-text-primary truncate">
                  {profile.fullname || profile.username}
                </span>
                <Badge variant={profile.role === 'admin' ? 'info' : 'neutral'}
                  className="uppercase tracking-wider">
                  {profile.role}
                </Badge>
              </span>
              <span className="meta">@{profile.username}</span>
              <span className="meta flex items-center gap-1.5">
                <Clock size={11} aria-hidden="true" />
                Last login {formatDate(profile.last_login)}
              </span>
            </div>
          </div>
        )}
      </SettingsSection>

      {/* ── Edit Form ──
             Two columns at most, and capped: three inputs spread across 1360px
             put the label of one field further from its box than from the next
             field's box. Errors now belong to their field through <Field>'s
             aria-describedby rather than floating as loose paragraphs between
             grid cells. */}
      <SettingsSection title="Personal information" description="name and contact email">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <Skeleton width="40%" height={11} />
                <Skeleton height={36} />
              </div>
            ))}
          </div>
        ) : (
          <form onSubmit={handleSave} noValidate className="max-w-2xl">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field
                label="Full name"
                id="fullname"
                value={profile.fullname}
                onChange={e => setProfile(p => ({ ...p, fullname: e.target.value }))}
                placeholder="John Doe"
                icon={User}
                error={errors.fullname}
              />

              <Field
                label="Username"
                id="username"
                value={profile.username}
                disabled
                icon={AtSign}
                hint={isAdmin ? undefined : 'Only an administrator can change this.'}
              />

              <Field
                label="Email address"
                id="email"
                type="email"
                value={profile.email}
                onChange={e => setProfile(p => ({ ...p, email: e.target.value }))}
                placeholder="you@example.com"
                icon={Mail}
                error={errors.email}
                className="sm:col-span-2"
              />
            </div>

            <div className="mt-4 flex justify-end">
              <Button type="submit" variant="primary" size="sm" icon={Save} loading={saving}>
                {saving ? 'Saving…' : 'Save profile'}
              </Button>
            </div>
          </form>
        )}
      </SettingsSection>
    </SettingsPanel>
  )
}
