/**
 * AccountTab — Profile image upload, name, email, role badge, last login.
 */
import React, { useEffect, useState, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import { User, Camera, Save, Loader2, Mail, AtSign, Clock, AlertTriangle } from 'lucide-react'
import api from '../../utils/api'
import useAuthStore from '../../store/authStore'
import { Badge, Button, Field, Modal, SettingsSection, SettingsPanel, Skeleton } from '../ui'

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
  // What the server last had, so Save can say what it is about to change.
  const [saved, setSaved] = useState({ fullname: '', email: '' })
  const [confirming, setConfirming] = useState(false)
  const closeConfirm = useCallback(() => setConfirming(false), [])

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
      setSaved({ fullname: data.fullname || '', email: data.email || '' })
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

  const changes = [
    { label: 'Full name', from: saved.fullname, to: profile.fullname },
    { label: 'Email address', from: saved.email, to: profile.email },
  ].filter(c => c.from !== c.to)
  const emailChanged = saved.email !== profile.email

  /* Save asks first and shows what will change. It used to write on the
     click, and a changed email is not a small edit here: it is where the
     sign-in codes go, so a typo in it locks the account out at next login. */
  function handleSave(e) {
    e.preventDefault()
    if (!validate()) return
    if (changes.length === 0) { toast('No changes to save', 'info'); return }
    setConfirming(true)
  }

  async function doSave() {
    setSaving(true)
    try {
      await api.put('/settings/profile', {
        fullname: profile.fullname,
        email:    profile.email,
      })
      setSaved({ fullname: profile.fullname, email: profile.email })
      toast('Profile updated successfully', 'success')
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to update profile', 'error')
    } finally {
      setSaving(false)
      setConfirming(false)
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
    /* Profile beside the form from lg: on its own the form was a 672px column
       inside a card twice that wide. */
    <SettingsPanel className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:divide-y-0 lg:divide-x">

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
             Two columns at most. The cap is the panel's column now rather than
             a max-width: from lg the form has two thirds of the card beside
             Profile, so three inputs never spread across the whole screen.
             Errors belong to their field through <Field>'s aria-describedby
             rather than floating as loose paragraphs between grid cells. */}
      <SettingsSection title="Personal information" description="name and contact email">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <Skeleton width="40%" height={11} />
                <Skeleton height={36} />
              </div>
            ))}
          </div>
        ) : (
          <form onSubmit={handleSave} noValidate>
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

            <div className="mt-3 flex justify-end">
              <Button type="submit" variant="primary" size="sm" icon={Save} loading={saving}>
                {saving ? 'Saving…' : 'Save profile'}
              </Button>
            </div>
          </form>
        )}

        <Modal open={confirming} onClose={closeConfirm} title="Save profile changes?" size="sm"
          footer={
            <>
              <Button variant="ghost" onClick={closeConfirm} disabled={saving}>Cancel</Button>
              <Button variant="primary" icon={Save} loading={saving} onClick={doSave}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </>
          }>
          <dl className="m-0">
            {changes.map(c => (
              <div key={c.label} className="py-2 border-t border-rule first:border-t-0">
                <dt className="meta">{c.label}</dt>
                <dd className="m-0 text-xs break-words">
                  <span className="text-text-muted">{c.from || '—'}</span>
                  <span className="text-text-muted" aria-hidden="true"> → </span>
                  <span className="sr-only"> changes to </span>
                  <span className="font-medium text-text-primary">{c.to || '—'}</span>
                </dd>
              </div>
            ))}
          </dl>
          {emailChanged && (
            <p role="alert" className="mt-2 flex items-start gap-2 rounded-lg border border-attention/30
              bg-attention/10 px-3 py-2 text-xs leading-snug text-attention">
              <AlertTriangle size={14} className="shrink-0 mt-px" aria-hidden="true" />
              Sign-in codes will be sent to the new address. If it is wrong, you will not be able to sign in.
            </p>
          )}
        </Modal>
      </SettingsSection>
    </SettingsPanel>
  )
}
