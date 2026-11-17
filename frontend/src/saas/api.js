// The management area's calls to /api/saas, through the app's one fetch wrapper (lib/api.js).
import { api } from '../lib/api.js'

const body = b => (b === undefined ? undefined : JSON.stringify(b))
export const sa = {
  get: p => api('/api/saas' + p),
  post: (p, b = {}) => api('/api/saas' + p, { method: 'POST', body: body(b) }),
  put: (p, b = {}) => api('/api/saas' + p, { method: 'PUT', body: body(b) }),
  del: p => api('/api/saas' + p, { method: 'DELETE' })
}
// The platform's user actions reuse the instance admin routes, which carry the owner rules.
export const adminApi = {
  disable: (id, disabled) => api('/api/admin/user/disable', { method: 'POST', body: JSON.stringify({ id, disabled }) }),
  role: (id, admin) => api('/api/admin/user/role', { method: 'POST', body: JSON.stringify({ id, admin }) }),
  recovery: id => api('/api/admin/user/recovery', { method: 'POST', body: JSON.stringify({ id }) })
}
