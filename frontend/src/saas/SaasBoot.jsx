// Runs in the app shell once someone is signed in:
//  - finishes a signup that came through an academy's link or domain (joins it as a student);
//  - sends people who run an academy (or the platform) to the management panel when they open
//    the app, and everyone else to the training app, from the same sign-in.
import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from '../lib/api.js'
import { useUI } from '../store/useUI.js'
import { pendingJoin, clearJoin, detectJoin, slugFromHash } from './join.js'

const LANDED = 'saas_landed'

export default function SaasBoot({ user }) {
  const nav = useNavigate()
  const loc = useLocation()
  const busy = useRef(false)
  useEffect(() => {
    if (!user || busy.current) return
    const atStart = loc.pathname === '/home' || loc.pathname.startsWith('/a/')
    let landed = false
    try { landed = sessionStorage.getItem(LANDED) === user.id } catch { /* private mode */ }
    const viaLink = loc.pathname.startsWith('/a/')
    if (!pendingJoin() && !viaLink && (landed || !atStart)) return
    busy.current = true
    ;(async () => {
      try {
        // A link opened while already signed in: look the academy up now.
        const join = pendingJoin() || (slugFromHash() ? await detectJoin() : null)
        if (join) {
          clearJoin()
          try {
            const r = await api(`/api/saas/public/join/${encodeURIComponent(join.slug)}`, { method: 'POST', body: '{}' })
            if (!r.already) useUI.getState().toast(`Você entrou na ${r.gym.name}. Bons treinos!`)
          } catch (e) { useUI.getState().toast(e.message) }
        }
        try { sessionStorage.setItem(LANDED, user.id) } catch { /* private mode */ }
        const me = await api('/api/saas/me')
        const runsSomething = me.platformAdmin || me.memberships.some(m => m.role !== 'student')
        if (runsSomething) nav('/gestao', { replace: true })
        else if (viaLink) nav('/home', { replace: true })
      } catch { if (viaLink) nav('/home', { replace: true }) }
      finally { busy.current = false }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])
  return null
}

/** The signup link's own route once signed in: a moment's notice while SaasBoot joins. */
export function JoinRoute() {
  return <div className="narrow" style={{ paddingTop: '30vh', textAlign: 'center' }}>Entrando na academia…</div>
}
