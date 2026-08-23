import { create } from 'zustand'
import api from '../utils/api'

const useAuthStore = create((set, get) => ({
  // State
  user: _loadUser(),
  token: localStorage.getItem('fc_token') || null,
  isAuthenticated: !!localStorage.getItem('fc_token'),

  // OTP flow state
  otpPending: false,
  otpUserId: null,
  otpEmailHint: '',
  otpExpiresIn: 300, // seconds

  // Loading / error
  loading: false,
  error: null,

  /**
   * Step 1 — Login with username/password → triggers OTP email.
   */
  login: async (username, password) => {
    set({ loading: true, error: null })
    try {
      const { data } = await api.post('/auth/login', { username, password })
      set({
        otpPending: true,
        otpUserId: data.user_id,
        otpEmailHint: data.email_hint || '',
        otpExpiresIn: data.expires_in || 300,
        loading: false,
      })
      return data
    } catch (err) {
      const msg = err.response?.data?.error || 'Login failed'
      set({ loading: false, error: msg })
      throw err
    }
  },

  /**
   * Step 2 — Verify OTP → receive JWT.
   */
  verifyOtp: async (otp) => {
    const { otpUserId } = get()
    set({ loading: true, error: null })
    try {
      const { data } = await api.post('/auth/verify-otp', {
        user_id: otpUserId,
        otp,
      })
      const { token, user } = data
      localStorage.setItem('fc_token', token)
      localStorage.setItem('fc_user', JSON.stringify(user))
      set({
        token,
        user,
        isAuthenticated: true,
        otpPending: false,
        otpUserId: null,
        loading: false,
      })
      return data
    } catch (err) {
      const msg = err.response?.data?.error || 'OTP verification failed'
      const remaining = err.response?.data?.attempts_remaining
      set({ loading: false, error: msg })
      return { error: msg, attempts_remaining: remaining }
    }
  },

  /**
   * Logout — clear local state.
   */
  logout: () => {
    localStorage.removeItem('fc_token')
    localStorage.removeItem('fc_user')
    set({
      user: null,
      token: null,
      isAuthenticated: false,
      otpPending: false,
      otpUserId: null,
      error: null,
    })
  },

  /**
   * Cancel OTP flow (go back to login).
   */
  cancelOtp: () => {
    set({
      otpPending: false,
      otpUserId: null,
      otpEmailHint: '',
      error: null,
    })
  },

  clearError: () => set({ error: null }),

  /**
   * Update the stored user object (e.g. after profile/image changes).
   */
  setUser: (updatedUser) => {
    const merged = { ...get().user, ...updatedUser }
    localStorage.setItem('fc_user', JSON.stringify(merged))
    set({ user: merged })
  },
}))

function _loadUser() {
  try {
    const raw = localStorage.getItem('fc_user')
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export default useAuthStore
