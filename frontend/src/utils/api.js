import axios from 'axios'
import useAuthStore from '../store/authStore'

function withAuth(instance) {
  // Attach JWT to every request if available
  instance.interceptors.request.use((config) => {
    const token = localStorage.getItem('fc_token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  })

  // On 401, log out fully — clears auth state (not just localStorage) so the
  // app redirects to the login screen instead of silently rendering stale/empty
  // authenticated pages with a token that no longer works.
  instance.interceptors.response.use(
    (res) => res,
    (err) => {
      if (err.response?.status === 401) {
        useAuthStore.getState().logout()
      }
      return Promise.reject(err)
    }
  )
  return instance
}

const api = withAuth(axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
}))

// Same JWT-authed behavior as `api`, but for the legacy inventory/counting
// routes (backend/api/inventory.py, counting.py) which are mounted at the
// root instead of under /api/v1.
export const rawApi = withAuth(axios.create({
  headers: { 'Content-Type': 'application/json' },
}))

export default api
