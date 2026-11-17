// The management area's calls to /api/saas. On the SteelDay build (Supabase) they go to the
// steelday-gestao Edge Function with the signed-in user's access token; on a self-hosted server,
// through the app's own fetch wrapper (lib/api.js) to the same origin.
import { api } from '../lib/api.js'
import { GESTAO_BASE, freshToken } from '../lib/supa-auth.js'

// Paths the server hands back (a logo's /api/saas/... address) point at the function there.
function absolute(v) {
  if (!GESTAO_BASE || !v || typeof v !== 'object') return v
  if (Array.isArray(v)) return v.map(absolute)
  const out = {}
  for (const [k, x] of Object.entries(v)) out[k] = k === 'logoUrl' && typeof x === 'string' && x.startsWith('/api/') ? GESTAO_BASE + x : absolute(x)
  return out
}

async function call(method, p, body) {
  if (!GESTAO_BASE) return api('/api/saas' + p, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const token = await freshToken()
  let r
  try {
    r = await fetch(GESTAO_BASE + '/api/saas' + p, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
  } catch { throw Object.assign(new Error('Sem conexão com o servidor. Tente de novo.'), { code: 'offline' }) }
  let data = null
  try { data = await r.json() } catch { /* not JSON */ }
  if (!r.ok) throw Object.assign(new Error(data?.error || 'HTTP ' + r.status), { status: r.status, data: data || {} })
  return absolute(data)
}

// A private file (a meal photo) as an object URL: an <img> cannot send the access token itself.
async function blobUrl(p) {
  const token = GESTAO_BASE ? await freshToken() : null
  const r = await fetch((GESTAO_BASE || '') + '/api/saas' + p, { headers: token ? { Authorization: 'Bearer ' + token } : {}, credentials: 'same-origin' })
  if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { status: r.status })
  return URL.createObjectURL(await r.blob())
}

export const sa = {
  blobUrl,
  get: p => call('GET', p),
  post: (p, b = {}) => call('POST', p, b),
  put: (p, b = {}) => call('PUT', p, b),
  del: p => call('DELETE', p)
}
// The platform's user actions reuse opengym-api's admin routes, which carry the owner rules.
export const adminApi = {
  disable: (id, disabled) => api('/api/admin/user/disable', { method: 'POST', body: JSON.stringify({ id, disabled }) }),
  role: (id, admin) => api('/api/admin/user/role', { method: 'POST', body: JSON.stringify({ id, admin }) }),
  recovery: id => api('/api/admin/user/recovery', { method: 'POST', body: JSON.stringify({ id }) })
}
