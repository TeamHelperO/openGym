// Supabase Auth, for a build that runs against the opengym-api Edge Function instead of the
// self-hosted server (VITE_SUPABASE_URL and VITE_SUPABASE_KEY set at build time).
//
// Plain fetch against the Auth REST API rather than supabase-js: the app keeps its short dependency
// list (CONTRIBUTING.md), and only these few calls are needed. The session (access and refresh
// token) lives in localStorage; freshToken() renews it shortly before it runs out, and api.js asks
// it for the token before every request (setTokenSource).
//
// Magic links, sign-up confirmations and password resets come back to the app with the session in
// the address fragment (#access_token=…&refresh_token=…&type=…). The app routes with a HashRouter,
// so takeRedirect() reads that fragment before the router starts and puts a route back in its place.

const URL_BASE = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '')
const KEY = import.meta.env.VITE_SUPABASE_KEY || ''

export const SUPA = !!(URL_BASE && KEY)
export const API_BASE = SUPA ? URL_BASE + '/functions/v1/opengym-api' : ''

const LS = 'gym_supa_session'
// Set when a sign-in starts away from the app (a magic link, a confirmation e-mail): the login
// screen finishes it after the redirect, with the same question about this device's data a
// sign-in here asks.
const PENDING = 'gym_supa_pending'
const EARLY_MS = 60000          // renew this long before the access token runs out

const read = () => { try { return JSON.parse(localStorage.getItem(LS) || 'null') } catch { return null } }
const write = s => { try { s ? localStorage.setItem(LS, JSON.stringify(s)) : localStorage.removeItem(LS) } catch { /* private mode */ } }

const sessionOf = d => ({
  access_token: d.access_token,
  refresh_token: d.refresh_token,
  expires_at: d.expires_at ? Number(d.expires_at) * 1000 : Date.now() + (Number(d.expires_in) || 3600) * 1000,
})

const redirectTo = () => window.location.origin + window.location.pathname

// One call to the Auth API. Its error text comes back as the Error's message, its code as `code`.
async function auth(path, { method = 'POST', body, token } = {}) {
  const r = await fetch(URL_BASE + '/auth/v1' + path, {
    method,
    headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: 'Bearer ' + (token || KEY) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  let data = {}
  try { data = await r.json() } catch { /* empty answer */ }
  if (!r.ok) {
    const msg = data.msg || data.error_description || data.message || data.error || ('HTTP ' + r.status)
    throw Object.assign(new Error(msg), { status: r.status, code: data.error_code || data.code || data.error })
  }
  return data
}

export const hasSession = () => !!read()?.refresh_token

let refreshing = null
// The access token to send, renewed first when it is about to run out. null: no session, or one
// the server no longer renews (signed out elsewhere, refresh token revoked). A renewal that fails
// for want of a network keeps the session and hands back the token it has, so the request decides.
export async function freshToken() {
  const s = read()
  if (!s?.refresh_token) return null
  if (s.access_token && s.expires_at - Date.now() > EARLY_MS) return s.access_token
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const d = await auth('/token?grant_type=refresh_token', { body: { refresh_token: s.refresh_token } })
        const next = sessionOf(d)
        write(next)
        return next.access_token
      } catch (e) {
        if (e.status && e.status < 500) { write(null); return null }
        return s.access_token || null
      } finally { refreshing = null }
    })()
  }
  return refreshing
}

export async function signIn(email, password) {
  const d = await auth('/token?grant_type=password', { body: { email: email.trim(), password } })
  write(sessionOf(d))
}

// A new account. With e-mail confirmation on (the Supabase default) no session comes back: the
// confirmation link signs the person in, and { confirm: true } says to tell them to look for it.
export async function signUp(email, password, { name, invite } = {}) {
  const d = await auth('/signup?redirect_to=' + encodeURIComponent(redirectTo()), {
    body: { email: email.trim(), password, data: { name: (name || '').trim(), ...(invite ? { invite: invite.trim().toUpperCase() } : {}) } },
  })
  if (d.access_token) { write(sessionOf(d)); return { confirm: false } }
  markPending()
  return { confirm: true }
}

// A sign-in link by e-mail; it makes the account too when there is none yet.
export async function sendMagicLink(email, { name, invite } = {}) {
  await auth('/otp?redirect_to=' + encodeURIComponent(redirectTo()), {
    body: { email: email.trim(), create_user: true, data: { ...(name ? { name: name.trim() } : {}), ...(invite ? { invite: invite.trim().toUpperCase() } : {}) } },
  })
  markPending()
}

export async function sendPasswordReset(email) {
  await auth('/recover?redirect_to=' + encodeURIComponent(redirectTo()), { body: { email: email.trim() } })
}

export async function setPassword(password) {
  const token = await freshToken()
  if (!token) throw Object.assign(new Error('not signed in'), { status: 401 })
  await auth('/user', { method: 'PUT', token, body: { password } })
}

export async function signOut() {
  const s = read()
  write(null)
  clearPending()
  if (s?.access_token) { try { await auth('/logout', { token: s.access_token }) } catch { /* the session is gone here either way */ } }
}

function markPending() { try { localStorage.setItem(PENDING, String(Date.now())) } catch { /* private mode */ } }
export function clearPending() { try { localStorage.removeItem(PENDING) } catch { /* private mode */ } }
// A sign-in that came back from an e-mail and has not been finished on the login screen yet.
export const pendingSignIn = () => { try { return !!localStorage.getItem(PENDING) && hasSession() } catch { return false } }

// What a failed e-mail link said (expired, already used), once, for the login screen to show.
export function takeLinkError() {
  try { const e = sessionStorage.getItem('gym_supa_error'); sessionStorage.removeItem('gym_supa_error'); return e } catch { return null }
}

/**
 * Reads the session an e-mail link brought back in the address fragment, saves it, and puts a
 * route in its place. Returns { type } ('magiclink', 'signup', 'recovery', …), { error } for a
 * link that failed (expired, used), or null when the address carries neither.
 */
export function takeRedirect() {
  const raw = window.location.hash.replace(/^#\/?/, '')
  if (!/(^|&)(access_token|error)=/.test(raw)) return null
  const p = new URLSearchParams(raw)
  const clean = route => window.history.replaceState(null, '', window.location.pathname + window.location.search + '#' + route)
  if (p.get('error')) {
    clean('/')
    const error = p.get('error_description') || p.get('error')
    try { sessionStorage.setItem('gym_supa_error', error) } catch { /* private mode */ }
    return { error }
  }
  write(sessionOf({ access_token: p.get('access_token'), refresh_token: p.get('refresh_token'), expires_at: p.get('expires_at'), expires_in: p.get('expires_in') }))
  const type = p.get('type') || 'magiclink'
  // A password reset lands in Settings, where the new password is set; a sign-in on the home screen.
  clean(type === 'recovery' ? '/settings' : '/')
  if (type === 'recovery') { try { sessionStorage.setItem('gym_supa_recovery', '1') } catch { /* private mode */ } }
  else markPending()
  return { type }
}
