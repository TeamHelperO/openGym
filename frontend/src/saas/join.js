// An academy's own front door. Someone who opens its signup link (#/a/<slug>) or its own domain
// sees its name and logo on the sign-in screen; once signed in, the profile joins it as a student.
// Kept small and free of React: Login and the app shell import it.
import { sa } from './api.js'

const KEY = 'saas_join'
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null') } catch { return null } }
export const pendingJoin = () => read()
export function clearJoin() { try { localStorage.removeItem(KEY) } catch { /* private mode */ } }
function keep(gym) { try { localStorage.setItem(KEY, JSON.stringify({ slug: gym.slug, name: gym.name, logoUrl: gym.logoUrl, color: gym.primary_color, publicSignup: gym.publicSignup, at: Date.now() })) } catch { /* private mode */ } }

const listeners = new Set()
export function onJoinChange(fn) { listeners.add(fn); return () => listeners.delete(fn) }

/** The slug in a signup link, from the hash route. */
export const slugFromHash = (hash = location.hash) => (/^#\/a\/([a-z0-9-]{1,48})\/?$/.exec(hash || '') || [])[1] || null

let detected = false
/** Once per load: find the academy behind the link or the domain, and remember it. */
export async function detectJoin() {
  if (detected) return read()
  detected = true
  const slug = slugFromHash()
  try {
    const r = await sa.get('/public/gym' + (slug ? '?slug=' + encodeURIComponent(slug) : ''))
    if (r?.gym) { keep(r.gym); listeners.forEach(f => f(read())) }
  } catch { /* no SaaS on this server, or offline: the plain sign-in it is */ }
  return read()
}
