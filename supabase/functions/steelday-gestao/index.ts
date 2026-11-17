// SteelDay Gestão: the academy management API (/api/saas/*) and the turnstile gateway, as one
// Supabase Edge Function beside opengym-api. Same database (schema opengym), same accounts:
// the app sends the Supabase access token as `Authorization: Bearer`, and the profile is the
// opengym.profiles row opengym-api made on the first request. Tables are reached only through
// this function's direct Postgres connection (RLS on, no grants), like the rest of the schema.
//
// Reached at /functions/v1/steelday-gestao/api/saas/... from the app, and at
// /functions/v1/steelday-gestao/<device path> from turnstiles (rewritten from the site's root by
// vercel.json, since a device is given a host and port only).

import postgres from 'npm:postgres@3.4.5'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { createSaas } from './router.js'
import { createDeviceGateway, devicePath } from './devices.js'
import { SaasError } from './util.js'

const env = (k: string, d = '') => (Deno.env.get(k) ?? d).trim()
const sql = postgres(env('SUPABASE_DB_URL'), { prepare: false, max: Number(env('PG_MAX', '4')) || 4, idle_timeout: 20 })
const sb = env('SUPABASE_URL') ? createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } }) : null
// Local tests only (supabase/functions/steelday-gestao/test): a bearer "test:<profile id>" stands
// for a signed-in profile. Never set in a deployed function.
const TEST_AUTH = env('GESTAO_TEST_AUTH') === '1'

async function userIdOf(req: Request): Promise<string | null> {
  const h = req.headers.get('authorization') || ''
  if (!h.startsWith('Bearer ')) return null
  const jwt = h.slice(7).trim()
  if (TEST_AUTH && jwt.startsWith('test:')) return jwt.slice(5)
  if (!jwt || !sb) return null
  try {
    const { data, error } = await sb.auth.getClaims(jwt)
    const c = data?.claims as { sub?: string; role?: string } | undefined
    if (error || !c?.sub || c.role !== 'authenticated') return null
    return c.sub
  } catch { return null }
}

// The profile behind the request. null: not signed in, a disabled profile, or one opengym-api has
// not made yet (it does on the app's first request after sign-in).
async function session(req: Request) {
  const uid = await userIdOf(req)
  if (!uid) return null
  const [p] = await sql`select id, name, email, admin, owner, disabled from opengym.profiles where id = ${uid}`
  return p && !p.disabled ? p : null
}

// The invitation e-mail a trainer sends a student (Supabase Auth: the student sets a password
// through the link). Someone who already has an account is linked at their next sign-in instead.
async function inviteByEmail(email: string, { name, redirectTo }: { name?: string; redirectTo?: string }) {
  if (TEST_AUTH) return { sent: true, test: true }
  if (!sb) throw new SaasError(503, 'envio de e-mail indisponível')
  const { error } = await sb.auth.admin.inviteUserByEmail(email, { data: { name }, ...(redirectTo ? { redirectTo } : {}) })
  if (!error) return { sent: true }
  if ((error as any).status === 422 || /already/i.test(error.message)) return { sent: false, existing: true }
  console.error('invite e-mail', error)
  throw new SaasError(502, 'não foi possível enviar o convite agora. Tente de novo em alguns minutos.')
}
// Whether Supabase has confirmed this profile's e-mail (an invite link or a sign-up confirmation).
async function emailConfirmed(uid: string) {
  if (TEST_AUTH) return true
  if (!sb) return false
  const { data } = await sb.auth.admin.getUserById(uid)
  return !!data?.user?.email_confirmed_at
}

const saas = createSaas({ sql, session, inviteByEmail, emailConfirmed })
const devices = createDeviceGateway({ sql })

let corsOrigin = '*'
const cors = () => ({ 'Access-Control-Allow-Origin': corsOrigin, 'Vary': 'Origin' })
const json = (status: number, obj: unknown) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors() } })

Deno.serve(async req => {
  corsOrigin = req.headers.get('origin') || '*'
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: {
      ...cors(),
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
      'Access-Control-Max-Age': '86400',
    } })
  }
  const url = new URL(req.url)
  const i = url.pathname.indexOf('/api/')
  const path = i >= 0 ? url.pathname.slice(i) : url.pathname
  try {
    const dev = i < 0 ? devicePath(url.pathname) : null
    if (dev) {
      const h = devices.match(req.method, dev)
      if (h) return await h(req, url)
    }
    const handler = saas.match(req.method, path)
    if (!handler) return json(404, { error: 'not found' })
    const out = await handler(req, url)
    if (out instanceof Response) { for (const [k, v] of Object.entries(cors())) out.headers.set(k, v); return out }
    if (out && (out as any).__status) return json((out as any).__status, (out as any).body)
    return json(200, out ?? { ok: true })
  } catch (e: any) {
    if (e instanceof SaasError) return json(e.status, { error: e.message, ...(e.code ? { code: e.code } : {}) })
    // What Postgres refuses because of the caller's input is the caller's to fix, not a crash.
    if (e?.code === '23505') return json(409, { error: 'já existe um registro com esses dados' })
    if (e?.code === '22P02') return json(400, { error: 'identificador inválido' })
    if (e?.code === '23503') return json(400, { error: 'registro relacionado não existe' })
    console.error(req.method, path, e)
    return json(500, { error: 'server error' })
  }
})
