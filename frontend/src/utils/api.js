import axios from 'axios'
import useAuthStore from '../store/authStore'

const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
})

// Attach JWT to every request if available
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('fc_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// On 401, log out fully — clears auth state (not just localStorage) so the
// app redirects to the login screen instead of silently rendering stale/empty
// authenticated pages with a token that no longer works.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      useAuthStore.getState().logout()
    }
    return Promise.reject(err)
  }
)

export default api
