import axios from 'axios'

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

// On 401, clear auth state
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('fc_token')
      localStorage.removeItem('fc_user')
    }
    return Promise.reject(err)
  }
)

export default api
