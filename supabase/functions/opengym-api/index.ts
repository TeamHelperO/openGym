// openGym API on Supabase: the routes of api/server.js, served by one Edge Function.
//
// What changed against the self-hosted server:
//   - Accounts are Supabase Auth users (e-mail + password, magic link). The app sends the access
//     token as `Authorization: Bearer`, the header paired phones already used. An `opengym.profiles`
//     row is made on the first signed-in request (the first one becomes admin and owner).
//   - db.json and state-<uid>.json live in the `opengym` schema; uploads in the private
//     `opengym-media` bucket. Only this function (direct Postgres connection) reaches either.
//   - Timers that lived in the process (rest timers, the reminder tick, the media sweep) run from
//     POST /api/tick, called every minute by pg_cron with the CRON_SECRET header.
//   - Passkeys, device links, phone pairing and password routes are gone: Supabase Auth replaces
//     them. The Coach is answered as "not configured" until it is ported.
//
// The sync rules (sync-stamps.js), the reminder rules (nudge.js, queue.js) and the push texts are
// the server's own files, copied unchanged into ./shared.

import postgres from 'npm:postgres@3.4.5'
import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { stampPut } from './shared/sync-stamps.js'
import { excusedOn, nudgeFor, nudgeWindowOpen, toneOf } from './shared/nudge.js'
import { effectiveRoutineId } from './shared/queue.js'
import { dayReminderPush, nudgePush, restTimerPush, testPush } from './shared/push-messages.js'

/* ---------------------------------------------------------------- settings */

const env = (k: string, d = '') => (Deno.env.get(k) ?? d).trim()
const on = (k: string, d: boolean) => {
  const v = env(k)
  if (!v) return d
  return /^(1|true|yes|on)$/i.test(v)
}
const SUPABASE_URL = env('SUPABASE_URL')
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY')
const INVITE_ONLY = on('INVITE_ONLY', false)
const ALLOW_GUEST = on('ALLOW_GUEST', true)
const FIRST_USER_ADMIN = on('FIRST_USER_ADMIN', true)
const DEFAULT_LANG = env('DEFAULT_LANG', 'pt-BR')
const CRON_SECRET = env('CRON_SECRET')
const ORIGIN = env('ORIGIN', 'https://opengym.ch')
const VAPID_SUBJECT = env('VAPID_SUBJECT', ORIGIN)
const BUCKET = 'opengym-media'

const MB = 1024 * 1024
const num = (k: string, d: number, min: number) => {
  const raw = env(k)
  if (!raw) return d
  const n = Number(raw)
  return Number.isFinite(n) && n >= min ? n : d
}
const MEDIA = {
  enabled: !/^(0|false|no|off)$/i.test(env('MEDIA_UPLOADS')),
  quotaMB: num('MEDIA_QUOTA_MB', 200, 0),
  imageMB: num('MEDIA_IMAGE_MAX_MB', 2, 0.001),
  gifMB: num('MEDIA_GIF_MAX_MB', 8, 0.001),
  videoMB: num('MEDIA_VIDEO_MAX_MB', 40, 0.001),
  videoSec: num('MEDIA_VIDEO_MAX_SEC', 60, 1),
  gcGraceDays: num('MEDIA_GC_GRACE_DAYS', 14, 0),
}
const mediaConfig = () => ({ imageMB: MEDIA.imageMB, gifMB: MEDIA.gifMB, videoMB: MEDIA.videoMB, videoSec: MEDIA.videoSec, quotaMB: MEDIA.quotaMB, workouts: true, days: true })

const WID_KEEP = 50
const PULL_NOTE_MS = 10 * 60 * 1000
const PRESENCE_TTL = 70000
const PRESENCE_HIDDEN_GRACE = 45000
const REMINDER_WINDOW_MIN = 15
const MAX_SUBS_PER_USER = 20
const AUDIT_MAX = 5000
const AUDIT_DAYS = 90

/* ---------------------------------------------------------------- clients */

const sql = postgres(env('SUPABASE_DB_URL'), { prepare: false, max: 4, idle_timeout: 20 })
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

/* ---------------------------------------------------------------- http helpers */

class HttpError extends Error {
  status: number
  extra: Record<string, unknown>
  headers?: Record<string, string>
  constructor(status: number, message: string, extra: Record<string, unknown> = {}, headers?: Record<string, string>) {
    super(message); this.status = status; this.extra = extra; this.headers = headers
  }
}

let corsOrigin = '*'
const cors = () => ({
  'Access-Control-Allow-Origin': corsOrigin,
  'Vary': 'Origin',
  'Access-Control-Expose-Headers': 'Content-Length, Retry-After',
})
function json(status: number, obj: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors(), ...headers },
  })
}
async function readBody(req: Request): Promise<Record<string, any>> {
  const t = await req.text()
  if (!t) return {}
  try {
    const v = JSON.parse(t)
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch { throw new HttpError(400, 'invalid JSON') }
}
const text = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
const record = (x: unknown) => !!x && typeof x === 'object' && !Array.isArray(x)
const records = (v: unknown) => (Array.isArray(v) ? v.filter(record) : [])
const deviceIdOf = (v: unknown) => (typeof v === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(v) ? v : undefined)
const ms = (t: unknown) => (t ? new Date(t as string).getTime() : null)
const randomHex = (bytes: number) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), b => b.toString(16).padStart(2, '0')).join('')
async function sha256Hex(data: Uint8Array) {
  const d = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(d), b => b.toString(16).padStart(2, '0')).join('')
}

/* ---------------------------------------------------------------- accounts */

type Profile = {
  id: string; name: string; email: string | null; admin: boolean; owner: boolean; disabled: boolean
  last_pull: string | null; presence: any; last_reminder: string | null; last_nudge: string | null
  invited_by: string | null; created_at: string; extra: any
}

const isAdmin = (u: Profile | null) => !!u && u.admin === true
async function ownerId(): Promise<string | null> {
  const [flagged] = await sql`select id from opengym.profiles where owner and admin limit 1`
  if (flagged) return flagged.id
  const [oldest] = await sql`select id from opengym.profiles where admin order by created_at limit 1`
  return oldest?.id || null
}
const publicUser = (u: Profile, owner: string | null) => ({ id: u.id, name: u.name, admin: isAdmin(u), ...(u.id === owner ? { owner: true } : {}) })

// A name for a new profile: the one given at sign-up, else the e-mail's local part, made unique.
async function freeName(want: string) {
  const base = want.trim().slice(0, 40) || 'Atleta'
  for (let i = 0; i < 50; i++) {
    const name = i ? `${base} ${i + 1}` : base
    const [hit] = await sql`select 1 from opengym.profiles where lower(name) = lower(${name})`
    if (!hit) return name
  }
  return `${base} ${randomHex(2)}`
}

type Claims = { sub: string; email?: string; user_metadata?: Record<string, any>; role?: string }

async function claimsOf(req: Request): Promise<Claims | null> {
  const h = req.headers.get('authorization') || ''
  if (!h.startsWith('Bearer ')) return null
  const jwt = h.slice(7).trim()
  if (!jwt) return null
  try {
    const { data, error } = await sb.auth.getClaims(jwt)
    const c = data?.claims as Claims | undefined
    if (error || !c?.sub || c.role !== 'authenticated') return null
    return c
  } catch { return null }
}

// The profile behind the request's token, made on its first request. null: not signed in, or a
// disabled profile (refused everywhere, as on the self-hosted server).
async function session(req: Request, ctx: Ctx): Promise<Profile | null> {
  if (ctx.user !== undefined) return ctx.user
  const c = await claimsOf(req)
  if (!c) return (ctx.user = null)
  let [p] = await sql<Profile[]>`select * from opengym.profiles where id = ${c.sub}`
  if (!p) p = await createProfile(req, c)
  ctx.user = p && !p.disabled ? p : null
  return ctx.user
}

async function createProfile(req: Request, c: Claims): Promise<Profile> {
  const meta = c.user_metadata || {}
  const wanted = text(meta.name) || (c.email || '').split('@')[0]
  const name = await freeName(wanted)
  const invite = text(meta.invite).trim().toUpperCase()
  const made = await sql.begin(async tx => {
    // One registration at a time decides "first profile" and claims an invite code.
    await tx`select pg_advisory_xact_lock(hashtext('opengym.register'))`
    const [again] = await tx<Profile[]>`select * from opengym.profiles where id = ${c.sub}`
    if (again) return { p: again, fresh: false }
    const [{ n }] = await tx`select count(*)::int as n from opengym.profiles`
    const first = n === 0
    let invitedBy: string | null = null
    if (INVITE_ONLY && !first) {
      const [inv] = await tx`select code, created_by from opengym.invites where code = ${invite} and used_by is null`
      if (!inv) throw new HttpError(403, 'a valid invite code is needed to join this server', { code: 'invite-invalid' })
      invitedBy = inv.created_by
    }
    const admin = first && FIRST_USER_ADMIN
    const [p] = await tx<Profile[]>`
      insert into opengym.profiles (id, name, email, admin, owner, invited_by)
      values (${c.sub}, ${name}, ${c.email || null}, ${admin}, ${admin}, ${invitedBy})
      returning *`
    if (INVITE_ONLY && !first) await tx`update opengym.invites set used_by = ${c.sub}, used_at = now() where code = ${invite}`
    return { p, fresh: true, admin, invite: INVITE_ONLY && !first ? invite : '' }
  })
  if (made.fresh) {
    await audit(req, 'auth.register', { user: made.p, msg: made.invite ? `invite ${made.invite}` : undefined })
    if (made.admin) await audit(req, 'admin.first-user', { user: made.p })
  }
  return made.p
}

async function requireUser(req: Request, ctx: Ctx) {
  const u = await session(req, ctx)
  if (!u) throw new HttpError(401, 'not signed in')
  return u
}
async function requireAdmin(req: Request, ctx: Ctx) {
  const u = await requireUser(req, ctx)
  if (!isAdmin(u)) throw new HttpError(403, 'admins only')
  return u
}
async function requireOwner(req: Request, ctx: Ctx) {
  const u = await requireAdmin(req, ctx)
  if (u.id !== (await ownerId())) throw new HttpError(403, 'only the owner can do this')
  return u
}

async function removeAccount(u: Profile) {
  try {
    const { data } = await sb.storage.from(BUCKET).list(u.id, { limit: 1000 })
    if (data?.length) await sb.storage.from(BUCKET).remove(data.map(f => `${u.id}/${f.name}`))
  } catch (e) { console.error('media: could not remove uploads of', u.id, e) }
  // Deleting the auth user cascades to the profile, its state, subscriptions, timers and media rows.
  const { error } = await sb.auth.admin.deleteUser(u.id)
  if (error) throw new HttpError(500, 'could not delete the account')
}

// Whether `password` is this profile's Supabase Auth password: a password sign-in, whose new
// session is signed out again at once.
async function passwordMatches(u: Profile, password: string) {
  if (!u.email) return false
  const anon = env('SUPABASE_ANON_KEY')
  const r = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anon },
    body: JSON.stringify({ email: u.email, password }),
  })
  if (!r.ok) return false
  const d = await r.json().catch(() => ({}))
  if (d.user?.id !== u.id) return false
  if (d.access_token) await fetch(SUPABASE_URL + '/auth/v1/logout?scope=local', { method: 'POST', headers: { apikey: anon, Authorization: 'Bearer ' + d.access_token } }).catch(() => {})
  return true
}

async function lastAdminLeaving(u: Profile) {
  if (!isAdmin(u)) return false
  const [{ admins, total }] = await sql`select count(*) filter (where admin)::int as admins, count(*)::int as total from opengym.profiles`
  return admins <= 1 && total > 1
}

/* ---------------------------------------------------------------- audit log */

type AuditFields = { user?: Profile | null; target?: Profile | null; msg?: string; ok?: boolean; act?: string; uid?: string; name?: string }
async function audit(_req: Request | null, ev: string, f: AuditFields = {}) {
  try {
    await sql`
      insert into opengym.audit (event, ok, actor_id, actor_name, target_id, target_name, msg, act)
      values (${ev}, ${f.ok !== false}, ${f.user?.id || f.uid || null}, ${(f.user?.name || f.name || '').slice(0, 40) || null},
              ${f.target?.id || null}, ${(f.target?.name || '').slice(0, 40) || null},
              ${f.msg ? String(f.msg).slice(0, 120) : null}, ${f.act ? String(f.act).slice(0, 40) : null})`
  } catch (e) { console.error('audit write failed', e) }
}
async function compactAudit() {
  await sql`delete from opengym.audit where at < now() - make_interval(days => ${AUDIT_DAYS})`
  await sql`delete from opengym.audit where id <= (select id from opengym.audit order by id desc offset ${AUDIT_MAX} limit 1)`
}

/* ---------------------------------------------------------------- state */

type StateRow = { doc: any; rev: number; wid: string | null }
async function readState(uid: string): Promise<StateRow | null> {
  const [row] = await sql<StateRow[]>`select doc, rev, wid from opengym.state where user_id = ${uid}`
  return row || null
}
// A stored document as a client gets it: without the server's own notes `_unstamped` and `_prior`.
function forClient(S: any) {
  if (!S || typeof S !== 'object' || !('_unstamped' in S || '_prior' in S)) return S
  const { _unstamped, _prior, ...rest } = S
  return rest
}
async function notePull(u: Profile) {
  const now = Date.now()
  if (u.last_pull && now - new Date(u.last_pull).getTime() < PULL_NOTE_MS) return
  await sql`update opengym.profiles set last_pull = now() where id = ${u.id}`
}
const lastSyncOf = (u: Profile, S: any) => Math.max(Number(S?._ts) || 0, ms(u.last_pull) || 0) || null

/* ---------------------------------------------------------------- presence */

function livePresence(u: Profile) {
  const p = u.presence
  if (!p || typeof p !== 'object') return null
  const now = Date.now()
  const listed = now - (p.updatedAt || 0) < PRESENCE_TTL && (p.hiddenAt === undefined || now - p.hiddenAt < PRESENCE_HIDDEN_GRACE)
  if (!listed) return null
  const { hiddenAt: _away, ...live } = p
  return live
}

/* ---------------------------------------------------------------- push */

let vapidReady: Promise<{ publicKey: string; privateKey: string }> | null = null
function vapid() {
  if (!vapidReady) {
    vapidReady = (async () => {
      let [row] = await sql`select value from opengym.settings where key = 'vapid'`
      if (!row) {
        const keys = webpush.generateVAPIDKeys()
        await sql`insert into opengym.settings (key, value) values ('vapid', ${sql.json(keys)}) on conflict (key) do nothing`;
        [row] = await sql`select value from opengym.settings where key = 'vapid'`
      }
      const keys = row.value as { publicKey: string; privateKey: string }
      webpush.setVapidDetails(VAPID_SUBJECT, keys.publicKey, keys.privateKey)
      return keys
    })()
    vapidReady.catch(() => { vapidReady = null })
  }
  return vapidReady
}

function pushEndpointError(raw: unknown) {
  let u: URL
  try { u = new URL(String(raw || '')) } catch { return 'endpoint is not a valid URL' }
  if (u.protocol !== 'https:') return 'endpoint must be an https:// URL'
  if (u.username || u.password) return 'endpoint must not carry credentials'
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (/^[0-9.]+$/.test(host) || host.includes(':') || host === 'localhost') return 'endpoint must not point at a private address'
  return null
}

async function sendPush(userId: string, payload: unknown, deviceId?: string) {
  let subs = await sql`select endpoint, keys, device_id from opengym.push_subs where user_id = ${userId}`
  if (deviceId) subs = subs.filter(s => !s.device_id || s.device_id === deviceId)
  if (!subs.length) return
  await vapid()
  const body = JSON.stringify(payload)
  await Promise.all(subs.map(async s => {
    if (pushEndpointError(s.endpoint)) {
      await sql`delete from opengym.push_subs where endpoint = ${s.endpoint}`
      return
    }
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, body, { urgency: 'high', timeout: 10000 })
    } catch (e: any) {
      console.error('push send failed', userId, e?.statusCode, e?.body || e?.message)
      if (e?.statusCode === 404 || e?.statusCode === 410 || e?.statusCode === 403) {
        await sql`delete from opengym.push_subs where endpoint = ${s.endpoint}`
      }
    }
  }))
}

const langOf = async (uid: string) => (await readState(uid))?.doc?.lang

// Fires a rest timer once, whoever gets there first: the request's own wait or the minute tick.
// Matched by its own token (`payload.tok`), not its time: a timestamp read back into JavaScript
// loses the microseconds Postgres keeps, and would never match the row again.
async function fireRestTimer(userId: string, deviceId: string, tok: string) {
  const [t] = await sql`
    delete from opengym.rest_timers where user_id = ${userId} and device_id = ${deviceId} and payload->>'tok' = ${tok}
    returning payload`
  if (t) await sendPush(userId, restTimerPush(t.payload?.lang), deviceId || undefined)
}

/* ---------------------------------------------------------------- reminders (the tick) */

function userNow(tz: string) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date())
    const g = (t: string) => parts.find(p => p.type === t)?.value
    const hour = g('hour') === '24' ? '00' : g('hour')
    const date = `${g('year')}-${g('month')}-${g('day')}`
    return { date, hhmm: `${hour}:${g('minute')}`, weekday: new Date(date + 'T12:00:00Z').getUTCDay() }
  } catch { return null }
}
const hhmmToMin = (v: string) => {
  const m = /^(\d{2}):(\d{2})$/.exec(v || '')
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN
}

async function reminderTick() {
  const rows = await sql`
    select p.*, s.doc->'reminder' as rem
      from opengym.profiles p join opengym.state s on s.user_id = p.id
     where not p.disabled
       and exists (select 1 from opengym.push_subs x where x.user_id = p.id)
       and coalesce((s.doc->'reminder'->>'on')::boolean, false)`
  for (const u of rows) {
    try {
      const rem = u.rem || {}
      const now = userNow(rem.tz || 'UTC')
      if (!now) continue
      const late = hhmmToMin(now.hhmm) - hhmmToMin(rem.time)
      const lastReminder = u.last_reminder ? new Date(u.last_reminder).toISOString().slice(0, 10) : null
      const lastNudge = u.last_nudge ? new Date(u.last_nudge).toISOString().slice(0, 10) : null
      const reminderOpen = late >= 0 && late <= REMINDER_WINDOW_MIN && lastReminder !== now.date
      const nudgeOpen = !!rem.nudge && lastNudge !== now.date && nudgeWindowOpen(rem.time, now.hhmm)
      if (!reminderOpen && !nudgeOpen) continue
      const S = (await readState(u.id))?.doc
      if (!S?.reminder?.on) continue
      if (nudgeOpen && !livePresence(u)) {
        const rid = nudgeFor(S, now.date)
        if (rid) {
          const routine = (S.routines || []).find((r: any) => r?.id === rid)
          await sql`update opengym.profiles set last_nudge = ${now.date} where id = ${u.id}`
          await sendPush(u.id, nudgePush(S.lang, toneOf(S.reminder), routine, now.date))
        }
      }
      if (!reminderOpen) continue
      if ((S.workouts || []).some((w: any) => w?.d === now.date)) { await sql`update opengym.profiles set last_reminder = ${now.date} where id = ${u.id}`; continue }
      if (excusedOn(S, now.date)) { await sql`update opengym.profiles set last_reminder = ${now.date} where id = ${u.id}`; continue }
      const rid = effectiveRoutineId(S, now.date)
      await sql`update opengym.profiles set last_reminder = ${now.date} where id = ${u.id}`
      if (!rid) continue
      const routine = (S.routines || []).find((r: any) => r?.id === rid)
      await sendPush(u.id, dayReminderPush(S.lang, routine))
    } catch (e) { console.error('reminder tick', u.id, e) }
  }
}

/* ---------------------------------------------------------------- media */

const HASH_RE = /^[0-9a-f]{64}$/
const MEDIA_TYPES: Record<string, { kind: string; category: string; ext: string }> = {
  'image/jpeg': { kind: 'image', category: 'still', ext: 'jpg' },
  'image/png': { kind: 'image', category: 'still', ext: 'png' },
  'image/webp': { kind: 'image', category: 'still', ext: 'webp' },
  'image/gif': { kind: 'gif', category: 'still', ext: 'gif' },
  'video/mp4': { kind: 'video', category: 'video', ext: 'mp4' },
  'video/quicktime': { kind: 'video', category: 'video', ext: 'mov' },
  'video/webm': { kind: 'video', category: 'video', ext: 'webm' },
}
const MEDIA_MESSAGES: Record<string, string> = {
  'bad-request': 'bad request',
  'media-type': 'that file type is not accepted',
  'media-too-large': 'that file is too large',
  'media-quota': 'your space for photos and videos is full',
  'media-missing': 'no such file',
  'hash-mismatch': 'the file does not match its name',
}
const mediaError = (status: number, code: string, extra: Record<string, unknown> = {}) =>
  new HttpError(status, MEDIA_MESSAGES[code] || code, { code, ...extra })
const capMB = (kind: string) => (kind === 'video' ? MEDIA.videoMB : kind === 'gif' ? MEDIA.gifMB : MEDIA.imageMB)
const MP4_BRANDS = new Set(['isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ', 'M4VP', 'dash', 'mmp4', 'MSNV', '3gp4', '3gp5', '3gp6', '3g2a'])

function sniffMedia(b: Uint8Array) {
  const as = (mime: string) => ({ mime, ...MEDIA_TYPES[mime] })
  const at = (off: number, ...bytes: number[]) => bytes.every((x, i) => b[off + i] === x)
  const ascii = (off: number, len: number) => (b.length >= off + len ? String.fromCharCode(...b.subarray(off, off + len)) : '')
  if (at(0, 0xff, 0xd8, 0xff)) return as('image/jpeg')
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return as('image/png')
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return as('image/gif')
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return as('image/webp')
  if (ascii(4, 4) === 'ftyp') {
    const brand = ascii(8, 4)
    if (brand === 'qt  ') return as('video/quicktime')
    if (MP4_BRANDS.has(brand)) return as('video/mp4')
    return null
  }
  // EBML header: the DocType string sits within the first bytes; only "webm" is taken.
  if (at(0, 0x1a, 0x45, 0xdf, 0xa3)) return new TextDecoder('latin1').decode(b.subarray(0, 64)).includes('webm') ? as('video/webm') : null
  return null
}

function referencedHashes(state: any) {
  const out = new Set<string>()
  if (!state || typeof state !== 'object') return out
  const isObj = (v: any) => !!v && typeof v === 'object' && !Array.isArray(v)
  const add = (r: any) => { if (r && typeof r === 'object' && typeof r.hash === 'string' && HASH_RE.test(r.hash)) out.add(r.hash) }
  const ref = (m: any) => { add(m); add(m.poster) }
  for (const c of Array.isArray(state.customEx) ? state.customEx : []) if (isObj(c) && isObj(c.media)) ref(c.media)
  for (const w of Array.isArray(state.workouts) ? state.workouts : []) {
    if (!isObj(w) || !Array.isArray(w.media)) continue
    for (const m of w.media) if (isObj(m)) ref(m)
  }
  if (isObj(state.dayPhotos)) for (const e of Object.values(state.dayPhotos)) if (isObj(e) && isObj((e as any).m)) ref((e as any).m)
  return out
}

async function mediaUsage(uid: string) {
  const [u] = await sql`select coalesce(sum(size), 0)::bigint as bytes, count(*)::int as count from opengym.media where user_id = ${uid}`
  return { bytes: Number(u.bytes), count: u.count, quotaBytes: MEDIA.quotaMB ? MEDIA.quotaMB * MB : 0 }
}

// Starts (or stops) the grace clock of each stored file the document stopped (or started) referencing.
async function noteState(uid: string, doc: any) {
  const refs = [...referencedHashes(doc)]
  await sql`update opengym.media set unref_at = null where user_id = ${uid} and unref_at is not null and hash = any(${refs})`
  await sql`update opengym.media set unref_at = now() where user_id = ${uid} and unref_at is null and not (hash = any(${refs}))`
}

async function sweepMedia(uid: string, graceMs: number) {
  const gone = await sql`
    delete from opengym.media
     where user_id = ${uid} and unref_at is not null and unref_at <= now() - make_interval(secs => ${graceMs / 1000})
    returning hash, mime, size`
  if (gone.length) {
    await sb.storage.from(BUCKET).remove(gone.map(g => `${uid}/${g.hash}.${MEDIA_TYPES[g.mime]?.ext || 'bin'}`))
  }
  return { removed: gone.length, freedBytes: gone.reduce((n, g) => n + Number(g.size), 0) }
}

/* ---------------------------------------------------------------- routes */

type Ctx = { url: URL; user?: Profile | null; hash?: string }
type Handler = (req: Request, ctx: Ctx) => Promise<Response>

const routes: Record<string, Handler> = {
  'GET /api/health': async () => {
    const [{ n }] = await sql`select count(*)::int as n from opengym.profiles`
    return json(200, { ok: true, users: n, writable: true })
  },

  'GET /api/config': async (req, ctx) => {
    const signedIn = !!(await session(req, ctx).catch(() => null))
    return json(200, {
      invite_only: INVITE_ONLY, allow_guest: ALLOW_GUEST,
      supabase_auth: true,
      ...(DEFAULT_LANG ? { default_lang: DEFAULT_LANG } : {}),
      ...(MEDIA.enabled ? { media: mediaConfig() } : {}),
      ...(signedIn ? { coach: null } : {}),
    })
  },

  'GET /api/me': async (req, ctx) => {
    const u = await requireUser(req, ctx)
    return json(200, { user: publicUser(u, await ownerId()) })
  },

  // The app signs out of Supabase Auth itself; these keep the routes it calls answering.
  'POST /api/logout': async () => json(200, { ok: true }),
  'POST /api/logout/all': async (req, ctx) => {
    const u = await requireUser(req, ctx)
    const jwt = (req.headers.get('authorization') || '').slice(7)
    await sb.auth.admin.signOut(jwt, 'global').catch(() => {})
    await audit(req, 'auth.logout.all', { user: u })
    return json(200, { ok: true })
  },

  // What can prove it is the owner before a change to the account (the delete sheet asks first):
  // the Supabase Auth password. No passkeys on this server. Someone who only ever signed in by
  // e-mail link sets a password in Settings first.
  'GET /api/account/passkeys': async (req, ctx) => {
    const u = await requireUser(req, ctx)
    return json(200, { passkeys: [], password: true, ...(await lastAdminLeaving(u) ? { deleteBlocked: 'last-admin' } : {}) })
  },

  'POST /api/account/delete': async (req, ctx) => {
    const u = await requireUser(req, ctx)
    const body = await readBody(req)
    if (typeof body.name !== 'string' || body.name.trim() !== u.name) {
      return json(400, { error: 'type the account name to confirm', code: 'confirm-name' })
    }
    if (await lastAdminLeaving(u)) return json(409, { error: 'the last admin cannot leave while other profiles remain', code: 'last-admin' })
    // The current password, checked against Supabase Auth, is the proof (ProveOwner in the app).
    if (typeof body.current !== 'string' || !body.current) return json(400, { error: 'enter your password to confirm', code: 'missing' })
    if (!(await passwordMatches(u, body.current))) {
      await audit(req, 'auth.account.delete', { ok: false, user: u, msg: 'bad-password' })
      return json(403, { error: 'wrong password', code: 'bad-credentials' })
    }
    await audit(req, 'auth.account.delete', { user: u, msg: 'password' })
    await removeAccount(u)
    return json(200, { ok: true })
  },

  /* ---------- sync ---------- */

  'GET /api/data': async (req, ctx) => {
    const u = await requireUser(req, ctx)
    const row = await readState(u.id)
    await notePull(u)
    return json(200, { state: row ? forClient(row.doc) : null, rev: row?.rev || 0 })
  },

  'GET /api/data/rev': async (req, ctx) => {
    const u = await requireUser(req, ctx)
    const [row] = await sql`select rev, wid from opengym.state where user_id = ${u.id}`
    return json(200, { rev: row?.rev || 0, ...(row?.wid ? { wid: row.wid } : {}) })
  },

  'GET /api/nudge-check': async (req, ctx) => {
    const u = await requireUser(req, ctx)
    const date = ctx.url.searchParams.get('date') || ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date + 'T00:00:00Z'))) {
      return json(400, { error: 'date must be YYYY-MM-DD', code: 'date-invalid' })
    }
    const doc = (await readState(u.id))?.doc || {}
    const workouts = Array.isArray(doc.workouts) ? doc.workouts : []
    const done = workouts.some((w: any) => w && w.d === date) || excusedOn(doc, date)
    let nudge = false
    try { nudge = !done && !!nudgeFor(doc, date) } catch { nudge = true }
    return json(200, { date, done, nudge, rev: doc._rev || 0 })
  },

  // The same conditional write as the self-hosted server (see api/server.js PUT /api/data), with
  // the row lock standing in for "synchronous, nothing awaited between read and write".
  'PUT /api/data': async (req, ctx) => {
    const u = await requireUser(req, ctx)
    const body = await readBody(req)
    if (!body.state || typeof body.state !== 'object') return json(400, { error: 'state required' })
    if (!Array.isArray(body.state) && !Object.keys(body.state).some(k => k !== '_rev' && k !== '_ts')) {
      return json(400, { error: 'state required' })
    }
    const list = (v: unknown) => v == null || Array.isArray(v)
    if (Array.isArray(body.state) || !list(body.state.workouts) || !list(body.state.routines)) return json(400, { error: 'invalid state' })
    for (const k of ['workouts', 'routines']) if (Array.isArray(body.state[k])) body.state[k] = records(body.state[k])

    const out = await sql.begin(async tx => {
      await tx`insert into opengym.state (user_id) values (${u.id}) on conflict do nothing`
      const [row] = await tx<StateRow[]>`select doc, rev, wid from opengym.state where user_id = ${u.id} for update`
      const cur = row && row.rev > 0 ? row.doc : null
      const curRev = cur?._rev || 0
      if ((body.baseRev != null && body.baseRev !== curRev) ||
          (body.baseRev != null && typeof body.baseWid === 'string' && cur?._wid && body.baseWid !== cur._wid)) {
        return { conflict: true, rev: curRev, state: forClient(cur) }
      }
      delete body.state.active
      const storedReset = Number(cur?.resetAt) || 0
      if (storedReset > (Number(body.state.resetAt) || 0)) {
        body.state.resetAt = cur.resetAt
        if (cur.resetIds && typeof cur.resetIds === 'object') body.state.resetIds = cur.resetIds
        else delete body.state.resetIds
      }
      const report: Record<string, unknown> = {}
      try { stampPut(cur, body.state, { overRead: body.baseRev != null && body.baseRev === curRev, stamped: body.stamped === true, report }) }
      catch (e) { if (e instanceof RangeError) throw new HttpError(400, 'invalid state'); throw e }
      body.state._rev = curRev + 1
      if (report.changed) body.state._rev = curRev + 2
      body.state._wids = [...(Array.isArray(cur?._wids) ? cur._wids : []), ...(cur?._wid ? [cur._wid] : [])]
        .filter((x: unknown) => typeof x === 'string').slice(-WID_KEEP)
      body.state._wid = randomHex(8)
      try { JSON.stringify(body.state) } catch (e) { if (e instanceof RangeError) throw new HttpError(400, 'invalid state'); throw e }
      await tx`update opengym.state set doc = ${tx.json(body.state)}, rev = ${body.state._rev}, wid = ${body.state._wid}, updated_at = now()
               where user_id = ${u.id}`
      return { conflict: false, rev: curRev + 1 }
    })
    if (out.conflict) return json(409, { error: 'conflict', rev: out.rev, state: out.state })
    if (MEDIA.enabled) { try { await noteState(u.id, body.state) } catch (e) { console.error('media noteState', e) } }
    return json(200, { ok: true, ts: body.state._ts || null, rev: out.rev, wid: body.state._wid })
  },

  /* ---------- push ---------- */

  'GET /api/push/public-key': async () => json(200, { key: (await vapid()).publicKey }),

  'POST /api/push/subscribe': async (req, ctx) => {
    const u = await requireUser(req, ctx)
    const body = await readBody(req)
    const sub = body.subscription
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return json(400, { error: 'invalid subscription' })
    const bad = pushEndpointError(sub.endpoint)
    if (bad) return json(400, { error: bad })
    const keys = { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) }
    const deviceId = deviceIdOf(body.deviceId)
    const [prev] = await sql`select user_id, keys, device_id from opengym.push_subs where endpoint = ${sub.endpoint}`
    if (prev && prev.user_id !== u.id && (prev.keys?.p256dh !== keys.p256dh || prev.keys?.auth !== keys.auth)) {
      return json(409, { error: 'this subscription belongs to another account' })
    }
    const storedDevice = deviceId || prev?.device_id || null
    await sql`
      insert into opengym.push_subs (endpoint, user_id, keys, device_id)
      values (${sub.endpoint}, ${u.id}, ${sql.json(keys)}, ${storedDevice})
      on conflict (endpoint) do update set user_id = excluded.user_id, keys = excluded.keys, device_id = excluded.device_id`
    await sql`
      delete from opengym.push_subs where user_id = ${u.id} and endpoint in (
        select endpoint from opengym.push_subs where user_id = ${u.id} order by created_at desc offset ${MAX_SUBS_PER_USER})`
    return json(200, { ok: true })
  },

  'GET /api/push/status': async (req, ctx) => {
    const u = await requireUser(req, ctx)
    const endpoint = ctx.url.searchParams.get('endpoint') || ''
    const [row] = await sql`select device_id from opengym.push_subs where user_id = ${u.id} and endpoint = ${endpoint}`
    return json(200, row ? { subscribed: true, deviceId: row.device_id || null } : { subscribed: false })
  },

  'POST /api/push/unsubscribe': async (req, ctx) => {
    const u = await requireUser(req, ctx)
    const body = await readBody(req)
    await sql`delete from opengym.push_subs where user_id = ${u.id} and endpoint = ${text(body.endpoint)}`
    return json(200, { ok: true })
  },

  'POST /api/push/test': async (req, ctx) => {
    const u = await requireUser(req, ctx)
    await sendPush(u.id, testPush(await langOf(u.id)))
    return json(200, { ok: true })
  },

  'POST /api/push/rest-timer': async (req, ctx) => {
    const u = await requireUser(req, ctx)
    const body = await readBody(req)
    const raw = body.seconds
    const n = typeof raw === 'number' || typeof raw === 'string' ? Number(raw) : NaN
    if (!(n >= 1)) return json(400, { error: 'seconds required' })
    const sec = Math.min(3600, Math.round(n))
    const device = deviceIdOf(body.deviceId) || ''
    const tok = randomHex(8)
    await sql`
      insert into opengym.rest_timers (user_id, device_id, fire_at, payload)
      values (${u.id}, ${device}, now() + make_interval(secs => ${sec}), ${sql.json({ lang: (await langOf(u.id)) || null, tok })})
      on conflict (user_id, device_id) do update set fire_at = excluded.fire_at, payload = excluded.payload`
    // Short rests fire from here, on time; longer ones (or this wait cut short) from the minute tick.
    if (sec <= 120) {
      // @ts-ignore EdgeRuntime is the Supabase runtime global
      EdgeRuntime.waitUntil((async () => {
        await new Promise(r => setTimeout(r, sec * 1000))
        await fireRestTimer(u.id, device, tok)
      })())
    }
    return json(200, { ok: true })
  },

  'POST /api/push/rest-timer/cancel': async (req, ctx) => {
    const u = await requireUser(req, ctx)
    const body = await readBody(req)
    const device = deviceIdOf(body.deviceId)
    if (device) await sql`delete from opengym.rest_timers where user_id = ${u.id} and device_id = ${device}`
    else await sql`delete from opengym.rest_timers where user_id = ${u.id}`
    return json(200, { ok: true })
  },

  'POST /api/activity': async (req, ctx) => {
    const u = await requireUser(req, ctx)
    const body = await readBody(req)
    if (body.active) {
      const p = {
        name: text(body.name).slice(0, 60),
        exIdx: +body.exIdx || 0, exTotal: +body.exTotal || 0,
        setsDone: +body.setsDone || 0, setsTotal: +body.setsTotal || 0,
        startedAt: +body.startedAt || Date.now(), updatedAt: Date.now(),
      }
      await sql`update opengym.profiles set presence = ${sql.json(p)}, last_seen = now() where id = ${u.id}`
    } else if (body.reason === 'hidden') {
      await sql`update opengym.profiles set presence = presence || ${sql.json({ hiddenAt: Date.now() })}
                 where id = ${u.id} and presence is not null and not (presence ? 'hiddenAt')`
    } else {
      await sql`update opengym.profiles set presence = null where id = ${u.id}`
    }
    return json(200, { ok: true })
  },

  /* ---------- admin ---------- */

  'GET /api/admin/users': async (req, ctx) => {
    await requireAdmin(req, ctx)
    const owner = await ownerId()
    const rows = await sql`
      select p.*,
             coalesce(jsonb_array_length(case when jsonb_typeof(s.doc->'workouts') = 'array' then s.doc->'workouts' end), 0) as n_workouts,
             s.doc->'workouts'->-1->>'d' as last_workout,
             (s.doc->>'_ts') as doc_ts,
             exists (select 1 from opengym.push_subs x where x.user_id = p.id) as has_push
        from opengym.profiles p left join opengym.state s on s.user_id = p.id
       order by p.created_at`
    const users = rows.map((u: any) => ({
      id: u.id, name: u.name, created: u.created_at, email: u.email || null,
      disabled: !!u.disabled, admin: isAdmin(u), owner: u.id === owner, invitedBy: u.invited_by || null,
      workouts: u.n_workouts, lastWorkout: u.last_workout || null,
      lastSync: Math.max(Number(u.doc_ts) || 0, ms(u.last_pull) || 0) || null,
      hasPush: u.has_push, live: livePresence(u),
    }))
    return json(200, { users, invite_only: INVITE_ONLY, now: Date.now() })
  },

  'GET /api/admin/user': async (req, ctx) => {
    await requireAdmin(req, ctx)
    const id = ctx.url.searchParams.get('id') || ''
    const [u] = await sql<Profile[]>`select * from opengym.profiles where id::text = ${id}`
    if (!u) return json(404, { error: 'no such user' })
    const owner = await ownerId()
    const S = (await readState(u.id))?.doc || {}
    return json(200, {
      user: { id: u.id, name: u.name, created: u.created_at, email: u.email || null, disabled: !!u.disabled, admin: isAdmin(u), owner: u.id === owner, invitedBy: u.invited_by || null, recoveryUntil: null },
      unit: S.unit || 'kg',
      lastSync: lastSyncOf(u, S),
      routines: records(S.routines).map((r: any) => ({ id: r.id, name: r.name, emoji: r.emoji, count: records(r.ex).length })),
      bodyweight: records(S.bodyweight),
      workouts: records(S.workouts).reverse().map(({ media: _m, ...w }: any) => w),
    })
  },

  // Recovery for someone locked out: a Supabase password-recovery link the admin hands over.
  'POST /api/admin/user/recovery': async (req, ctx) => {
    const admin = await requireAdmin(req, ctx)
    const body = await readBody(req)
    const [u] = await sql<Profile[]>`select * from opengym.profiles where id::text = ${text(body.id)}`
    if (!u) return json(404, { error: 'no such user' })
    if (u.id === admin.id) return json(400, { error: 'you are signed in: change your password in Settings instead', code: 'self' })
    const owner = await ownerId()
    if (u.id === owner) return json(403, { error: 'the owner recovers with the password reset e-mail', code: 'owner' })
    if (isAdmin(u) && admin.id !== owner) { await audit(req, 'admin.denied', { ok: false, user: admin, target: u, msg: 'recovery' }); return json(403, { error: 'only the owner can make a recovery code for an admin' }) }
    if (u.disabled) return json(400, { error: 'enable the account first', code: 'disabled' })
    if (!u.email) return json(400, { error: 'this profile has no e-mail address', code: 'no-email' })
    const { data, error } = await sb.auth.admin.generateLink({ type: 'recovery', email: u.email, options: { redirectTo: ORIGIN } })
    if (error || !data?.properties?.action_link) return json(500, { error: 'could not make a recovery link' })
    await audit(req, 'admin.user.recovery', { user: admin, target: u })
    return json(200, { ok: true, name: u.name, code: data.properties.action_link, expires: Date.now() + 3600000 })
  },

  'POST /api/admin/user/disable': async (req, ctx) => {
    const admin = await requireAdmin(req, ctx)
    const body = await readBody(req)
    const [u] = await sql<Profile[]>`select * from opengym.profiles where id::text = ${text(body.id)}`
    if (!u) return json(404, { error: 'no such user' })
    if (isAdmin(u)) return json(400, { error: 'cannot disable an admin' })
    const disabled = !!body.disabled
    await sql`update opengym.profiles set disabled = ${disabled}, presence = case when ${disabled} then null else presence end where id = ${u.id}`
    await audit(req, disabled ? 'admin.user.disable' : 'admin.user.enable', { user: admin, target: u })
    return json(200, { ok: true, id: u.id, disabled })
  },

  'POST /api/admin/user/delete': async (req, ctx) => {
    const admin = await requireAdmin(req, ctx)
    const body = await readBody(req)
    const [u] = await sql<Profile[]>`select * from opengym.profiles where id::text = ${text(body.id)}`
    if (!u) return json(404, { error: 'no such user' })
    if (u.id === admin.id) return json(400, { error: 'you cannot delete your own account' })
    const [{ admins }] = await sql`select count(*) filter (where admin)::int as admins from opengym.profiles`
    if (isAdmin(u) && admins <= 1) return json(400, { error: 'cannot delete the last admin' })
    const owner = await ownerId()
    if (u.id === owner) return json(400, { error: 'the owner cannot be deleted; hand the role to another admin first' })
    if (isAdmin(u) && admin.id !== owner) { await audit(req, 'admin.denied', { ok: false, user: admin, target: u }); return json(403, { error: 'only the owner can delete an admin' }) }
    await removeAccount(u)
    await audit(req, 'admin.user.delete', { user: admin, msg: u.name })
    return json(200, { ok: true, id: u.id })
  },

  'POST /api/admin/user/role': async (req, ctx) => {
    const owner = await requireOwner(req, ctx)
    const body = await readBody(req)
    const [u] = await sql<Profile[]>`select * from opengym.profiles where id::text = ${text(body.id)}`
    if (!u) return json(404, { error: 'no such user' })
    if (u.id === owner.id) return json(400, { error: 'the owner stays an admin' })
    if (typeof body.admin !== 'boolean') return json(400, { error: 'admin must be true or false' })
    if (body.admin && u.disabled) return json(400, { error: 'enable the account first' })
    await sql`update opengym.profiles set admin = ${body.admin}, owner = case when ${body.admin} then owner else false end where id = ${u.id}`
    await audit(req, body.admin ? 'admin.role.grant' : 'admin.role.revoke', { user: owner, target: u })
    return json(200, { ok: true, id: u.id, admin: body.admin })
  },

  'POST /api/admin/owner': async (req, ctx) => {
    const owner = await requireOwner(req, ctx)
    const body = await readBody(req)
    const [u] = await sql<Profile[]>`select * from opengym.profiles where id::text = ${text(body.id)}`
    if (!u) return json(404, { error: 'no such user' })
    if (u.id === owner.id) return json(400, { error: 'you already are the owner' })
    if (!isAdmin(u) || u.disabled) return json(400, { error: 'make them an admin first' })
    await sql.begin(async tx => {
      await tx`update opengym.profiles set owner = false where owner`
      await tx`update opengym.profiles set owner = true where id = ${u.id}`
    })
    await audit(req, 'admin.owner.transfer', { user: owner, target: u })
    return json(200, { ok: true, id: u.id })
  },

  'GET /api/admin/invites': async (req, ctx) => {
    await requireAdmin(req, ctx)
    const rows = await sql`
      select i.*, p.name as used_by_name from opengym.invites i left join opengym.profiles p on p.id = i.used_by
       order by i.created_at`
    const invites = rows.map((i: any) => ({
      code: i.code, note: i.note || '', createdBy: i.created_by, created: i.created_at,
      ...(i.used_by ? { usedBy: i.used_by, used: i.used_at } : {}), usedByName: i.used_by_name || null,
    }))
    return json(200, { invites, invite_only: INVITE_ONLY })
  },

  'POST /api/admin/invites/new': async (req, ctx) => {
    const admin = await requireAdmin(req, ctx)
    const body = await readBody(req)
    const code = randomHex(8).toUpperCase()
    const [i] = await sql`insert into opengym.invites (code, note, created_by) values (${code}, ${text(body.note).slice(0, 60)}, ${admin.id}) returning *`
    await audit(req, 'admin.invite.create', { user: admin, msg: code })
    return json(200, { invite: { code: i.code, note: i.note, createdBy: i.created_by, created: i.created_at } })
  },

  'POST /api/admin/invites/revoke': async (req, ctx) => {
    const admin = await requireAdmin(req, ctx)
    const body = await readBody(req)
    const code = text(body.code).toUpperCase()
    const [inv] = await sql`select * from opengym.invites where code = ${code}`
    if (!inv) return json(404, { error: 'no such code' })
    if (inv.used_by) return json(400, { error: 'already used, cannot revoke' })
    await sql`delete from opengym.invites where code = ${code}`
    await audit(req, 'admin.invite.revoke', { user: admin, msg: code })
    return json(200, { ok: true })
  },

  'GET /api/admin/audit': async (req, ctx) => {
    await requireAdmin(req, ctx)
    const q = ctx.url.searchParams
    const limit = Math.max(1, Math.min(200, +(q.get('limit') || 0) || 100))
    const before = +(q.get('before') || 0) || Number.MAX_SAFE_INTEGER
    const cat = q.get('cat') || ''
    const where = cat === 'fail' ? sql`and not ok` : cat ? sql`and event like ${cat + '.%'}` : sql``
    const rows = await sql`select * from opengym.audit where id < ${before} ${where} order by id desc limit ${limit}`
    const [{ total }] = await sql`select count(*)::int as total from opengym.audit where true ${where}`
    const events = rows.map((r: any) => ({
      id: Number(r.id), ts: ms(r.at), ev: r.event, ok: r.ok,
      ...(r.actor_id ? { uid: r.actor_id } : {}), ...(r.actor_name ? { name: r.actor_name } : {}),
      ...(r.target_id ? { tgt: r.target_id, tname: r.target_name } : {}),
      ...(r.msg ? { msg: r.msg } : {}), ...(r.act ? { act: r.act } : {}),
    }))
    return json(200, {
      events, total,
      nextBefore: events.length === limit ? events[events.length - 1].id : null,
      enabled: true, ip_mode: 'off', retention: { max: AUDIT_MAX, days: AUDIT_DAYS }, now: Date.now(),
    })
  },

  'POST /api/admin/audit/clear': async (req, ctx) => {
    const admin = await requireOwner(req, ctx)
    await sql`delete from opengym.audit`
    await audit(req, 'admin.audit.clear', { user: admin })
    return json(200, { ok: true })
  },

  /* ---------- photos & videos ---------- */

  'PUT /api/media/{hash}': async (req, ctx) => {
    if (!MEDIA.enabled) return json(404, { error: 'not found' })
    const u = await requireUser(req, ctx)
    const hash = ctx.hash!
    const declared = MEDIA_TYPES[(req.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()]
    if (!declared) throw mediaError(415, 'media-type')
    const cap = capMB(declared.kind) * MB
    const len = Number(req.headers.get('content-length'))
    if (Number.isFinite(len) && len > cap) throw mediaError(413, 'media-too-large', { maxMB: capMB(declared.kind) })
    const [have] = await sql`select mime, size from opengym.media where user_id = ${u.id} and hash = ${hash}`
    if (have) {
      await req.body?.cancel().catch(() => {})
      return json(200, { ok: true, hash, mime: have.mime, size: Number(have.size), existed: true })
    }
    const bytes = new Uint8Array(await req.arrayBuffer())
    if (bytes.length > cap) throw mediaError(413, 'media-too-large', { maxMB: capMB(declared.kind) })
    if (!bytes.length) throw mediaError(400, 'bad-request')
    if (MEDIA.quotaMB) {
      let usage = await mediaUsage(u.id)
      if (usage.bytes + bytes.length > usage.quotaBytes) {
        await sweepMedia(u.id, 3600000)
        usage = await mediaUsage(u.id)
        if (usage.bytes + bytes.length > usage.quotaBytes) {
          throw mediaError(413, 'media-quota', { usedMB: Math.round(usage.bytes / MB * 10) / 10, quotaMB: MEDIA.quotaMB })
        }
      }
    }
    if ((await sha256Hex(bytes)) !== hash) throw mediaError(400, 'hash-mismatch')
    const sn = sniffMedia(bytes.subarray(0, 64))
    if (!sn || sn.category !== declared.category) throw mediaError(415, 'media-type')
    if (bytes.length > capMB(sn.kind) * MB) throw mediaError(413, 'media-too-large', { maxMB: capMB(sn.kind) })
    const { error } = await sb.storage.from(BUCKET).upload(`${u.id}/${hash}.${sn.ext}`, bytes, { contentType: sn.mime, upsert: true })
    if (error) { console.error('media upload', error); return json(500, { error: 'server error' }) }
    const doc = (await readState(u.id))?.doc
    const referenced = referencedHashes(doc).has(hash)
    await sql`
      insert into opengym.media (user_id, hash, mime, size, unref_at)
      values (${u.id}, ${hash}, ${sn.mime}, ${bytes.length}, ${referenced ? null : sql`now()`})
      on conflict (user_id, hash) do update set mime = excluded.mime, size = excluded.size`
    return json(201, { ok: true, hash, mime: sn.mime, size: bytes.length, existed: false })
  },

  'GET /api/media/{hash}': async (req, ctx) => {
    if (!MEDIA.enabled) return json(404, { error: 'not found' })
    const u = await requireUser(req, ctx)
    const hash = ctx.hash!
    const [f] = await sql`select mime, size from opengym.media where user_id = ${u.id} and hash = ${hash}`
    if (!f) throw mediaError(404, 'media-missing')
    const ext = MEDIA_TYPES[f.mime]?.ext || 'bin'
    const { data, error } = await sb.storage.from(BUCKET).download(`${u.id}/${hash}.${ext}`)
    if (error || !data) throw mediaError(404, 'media-missing')
    return new Response(data.stream(), {
      status: 200,
      headers: {
        ...cors(),
        'Content-Type': f.mime,
        'Content-Length': String(data.size),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Content-Disposition': `inline; filename="${hash}.${ext}"`,
      },
    })
  },

  'POST /api/media/missing': async (req, ctx) => {
    if (!MEDIA.enabled) return json(404, { error: 'not found' })
    const u = await requireUser(req, ctx)
    const body = await readBody(req)
    const hashes = body.hashes
    if (!Array.isArray(hashes) || hashes.length > 1000 || !hashes.every((h: unknown) => typeof h === 'string' && HASH_RE.test(h))) {
      throw mediaError(400, 'bad-request', { error: 'hashes must be a list of at most 1000 lowercase sha256 hex strings' })
    }
    const uniq = [...new Set(hashes as string[])]
    const have = new Set((await sql`select hash from opengym.media where user_id = ${u.id} and hash = any(${uniq})`).map((r: any) => r.hash))
    return json(200, { missing: uniq.filter(h => !have.has(h)), usage: await mediaUsage(u.id) })
  },

  'POST /api/media/sweep': async (req, ctx) => {
    if (!MEDIA.enabled) return json(404, { error: 'not found' })
    const u = await requireUser(req, ctx)
    await readBody(req)
    const r = await sweepMedia(u.id, 0)
    await audit(req, 'media.sweep', { user: u, msg: `${r.removed} file(s), ${(r.freedBytes / MB).toFixed(1)} MB` })
    return json(200, { removed: r.removed, freedBytes: r.freedBytes, usage: await mediaUsage(u.id) })
  },

  /* ---------- the minute tick (pg_cron) ---------- */

  'POST /api/tick': async (req) => {
    // The secret is CRON_SECRET when set, else the one the pg_cron job reads from opengym.settings.
    let secret = CRON_SECRET
    if (!secret) { const [row] = await sql`select value->>'secret' as s from opengym.settings where key = 'cron'`; secret = row?.s || '' }
    if (!secret || req.headers.get('x-cron-secret') !== secret) return json(404, { error: 'not found' })
    const due = await sql`select user_id, device_id, payload->>'tok' as tok from opengym.rest_timers where fire_at <= now()`
    for (const t of due) await fireRestTimer(t.user_id, t.device_id, t.tok || '')
    await reminderTick()
    if (new Date().getUTCMinutes() === 7) {
      const users = await sql`select distinct user_id from opengym.media where unref_at is not null`
      for (const { user_id } of users) await sweepMedia(user_id, MEDIA.gcGraceDays * 86400000).catch(e => console.error('media sweep', e))
      await compactAudit().catch(e => console.error('audit compact', e))
    }
    return json(200, { ok: true, timers: due.length })
  },
}

/* ---------------------------------------------------------------- server */

Deno.serve(async req => {
  corsOrigin = req.headers.get('origin') || '*'
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...cors(),
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info, x-cron-secret',
        'Access-Control-Max-Age': '86400',
      },
    })
  }
  const url = new URL(req.url)
  // The function is reached at /functions/v1/opengym-api/…; the routes keep the server's /api/… paths.
  const i = url.pathname.indexOf('/api/')
  const path = i >= 0 ? url.pathname.slice(i) : url.pathname
  let key = `${req.method} ${path}`
  const ctx: Ctx = { url }
  const mm = /^\/api\/media\/([0-9a-f]{64})$/.exec(path)
  if (mm) { key = `${req.method} /api/media/{hash}`; ctx.hash = mm[1] }
  const handler = routes[key]
  if (!handler) {
    // The Coach is not ported yet: its routes say so instead of a bare 404.
    if (path.startsWith('/api/coach/')) return json(404, { error: 'the Coach is not set up on this server', code: 'coach-off' })
    return json(404, { error: 'not found' })
  }
  try { return await handler(req, ctx) }
  catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.message, ...e.extra }, e.headers)
    console.error(key, e)
    return json(500, { error: 'server error' })
  }
})
