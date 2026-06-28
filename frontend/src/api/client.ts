import axios from 'axios'

const API_BASE = import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api'
const api = axios.create({ baseURL: API_BASE })

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token')
      window.location.href = import.meta.env.BASE_URL + 'login'
    }
    return Promise.reject(err)
  }
)

export default api

// ── Auth ──────────────────────────────────────────────────────────────────────
export const authApi = {
  login: (username: string, password: string) => {
    const form = new URLSearchParams({ username, password })
    return api.post('/auth/token', form, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
  },
  me: () => api.get('/auth/me'),
}

// ── UIDs ──────────────────────────────────────────────────────────────────────
export const uidApi = {
  list: (params?: Record<string, unknown>) => api.get('/uids/', { params }),
  lookup: (code: string) => api.get(`/uids/lookup/${code}`),
  bulkCreate: (data: Record<string, unknown>) => api.post('/uids/bulk-create', data),
  completeStep: (uid_id: number, data: Record<string, unknown>) => api.post(`/uids/${uid_id}/complete-step`, data),
  confirmDesign: (uid_id: number, data: Record<string, unknown>) => api.post(`/uids/${uid_id}/confirm-design`, data),
  linkMO: (uid_id: number, mo_id: number) => api.post(`/uids/${uid_id}/link-mo/${mo_id}`),
  convert: (uid_id: number, data: Record<string, unknown>) => api.post(`/uids/${uid_id}/convert`, data),
  transfer: (uid_id: number, data: Record<string, unknown>) => api.post(`/uids/${uid_id}/transfer`, data),
  bulkChangeCycle: (data: Record<string, unknown>) => api.post('/uids/bulk-change-cycle', data),
  operatorQueue: (location_id?: number) => api.get('/uids/queue/operator', { params: { location_id } }),
}

// ── Cycles ────────────────────────────────────────────────────────────────────
export const cycleApi = {
  list: () => api.get('/cycles/'),
  get: (id: number) => api.get(`/cycles/${id}`),
  versions: (id: number) => api.get(`/cycles/${id}/versions`),
  create: (data: Record<string, unknown>) => api.post('/cycles/', data),
  createVersion: (cycle_id: number, data: Record<string, unknown>) => api.post(`/cycles/${cycle_id}/versions`, data),
  export: (cycle_id: number) => api.get(`/cycles/${cycle_id}/export`),
  import: (data: Record<string, unknown>) => api.post('/cycles/import', data),
}

// ── Factory ───────────────────────────────────────────────────────────────────
export const factoryApi = {
  locations: () => api.get('/factory/locations'),
  workstations: (location_id?: number) => api.get('/factory/workstations', { params: { location_id } }),
  storage: () => api.get('/factory/storage'),
  createWorkstation: (data: Record<string, unknown>) => api.post('/factory/workstations', data),
  updateWorkstation: (id: number, data: Record<string, unknown>) => api.patch(`/factory/workstations/${id}`, data),
  createStorage: (data: Record<string, unknown>) => api.post('/factory/storage', data),
}

// ── Products ──────────────────────────────────────────────────────────────────
export const productApi = {
  sizes: () => api.get('/products/sizes'),
  designs: () => api.get('/products/designs'),
  types: () => api.get('/products/types'),
  createSize: (data: Record<string, unknown>) => api.post('/products/sizes', data),
  createDesign: (data: Record<string, unknown>) => api.post('/products/designs', data),
  updateDesignSizes: (design_id: number, size_ids: number[]) =>
    api.put(`/products/designs/${design_id}/valid-sizes`, size_ids),
}

// ── Manufacturing ─────────────────────────────────────────────────────────────
export const manufacturingApi = {
  orders: (status?: string) => api.get('/manufacturing/orders', { params: { status } }),
  createOrder: (data: Record<string, unknown>) => api.post('/manufacturing/orders', data),
  updateOrderStatus: (id: number, status: string) => api.patch(`/manufacturing/orders/${id}/status`, null, { params: { status } }),
  patterns: () => api.get('/manufacturing/patterns'),
  createPattern: (data: Record<string, unknown>) => api.post('/manufacturing/patterns', data),
  archivePattern: (id: number) => api.patch(`/manufacturing/patterns/${id}/archive`),
}

// ── Shopfloor ─────────────────────────────────────────────────────────────────
export const shopfloorApi = {
  status: (location_id?: number) => api.get('/shopfloor/status', { params: { location_id } }),
  dashboard: () => api.get('/shopfloor/dashboard'),
}

// ── Users ─────────────────────────────────────────────────────────────────────
export const userApi = {
  list: () => api.get('/users/'),
  create: (data: Record<string, unknown>) => api.post('/users/', data),
  update: (id: number, data: Record<string, unknown>) => api.patch(`/users/${id}`, data),
}
