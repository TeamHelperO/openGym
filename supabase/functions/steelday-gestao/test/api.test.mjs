// The management API end to end: the real function (Deno) against a local Postgres (PGlite) with
// the same schema. Run: see README.md in this folder.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startDb } from './local-db.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const DENO = process.env.DENO || 'deno'
const DB_PORT = 55432
const BASE = 'http://127.0.0.1:8000'
const U = {
  root: '00000000-0000-4000-8000-000000000001',
  owner: '00000000-0000-4000-8000-000000000002',
  coach: '00000000-0000-4000-8000-000000000003',
  student: '00000000-0000-4000-8000-000000000004',
  other: '00000000-0000-4000-8000-000000000005',
  invited: '00000000-0000-4000-8000-000000000006'
}
let db, fn, log = ''

before(async () => {
  db = await startDb(DB_PORT)
  await db.db.exec(`insert into opengym.profiles (id, name, email, admin, owner) values
    ('${U.root}', 'Plataforma', 'root@example.com', true, true), ('${U.owner}', 'Dona da Academia', 'dona@example.com', false, false),
    ('${U.coach}', 'Carlos Instrutor', 'carlos@example.com', false, false), ('${U.student}', 'Ana Aluna', 'ana@example.com', false, false),
    ('${U.other}', 'Outro Dono', 'outro@example.com', false, false),
    ('${U.invited}', 'Bia Convidada', 'bia@example.com', false, false)`)
  fn = spawn(DENO, ['run', '--allow-net', '--allow-env', '--allow-read', '--node-modules-dir=none', path.join(here, '..', 'index.ts')], {
    env: { ...process.env, SUPABASE_DB_URL: `postgres://postgres:postgres@127.0.0.1:${DB_PORT}/postgres`, GESTAO_TEST_AUTH: '1', PG_MAX: '1', SUPABASE_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  fn.stdout.on('data', d => log += d); fn.stderr.on('data', d => log += d)
  for (let i = 0; i < 100; i++) {
    try { await fetch(BASE + '/api/saas/config'); return } catch { await new Promise(r => setTimeout(r, 200)) }
  }
  throw new Error('function did not start:\n' + log)
})
after(async () => { fn?.kill('SIGKILL'); await db?.stop() })

const as = who => async (method, p, body) => {
  const r = await fetch(BASE + '/api/saas' + p, { method, headers: { 'Content-Type': 'application/json', ...(who ? { Authorization: 'Bearer test:' + U[who] } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const ct = r.headers.get('content-type') || ''
  return { status: r.status, body: ct.includes('json') ? await r.json() : new Uint8Array(await r.arrayBuffer()), headers: r.headers }
}
const device = async (p, params, method = 'POST') => {
  const r = await fetch(BASE + '/functions/v1/steelday-gestao/' + p + (method === 'GET' ? '?' + new URLSearchParams(params) : ''),
    method === 'GET' ? {} : { method, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) })
  const t = await r.text()
  return { status: r.status, body: t ? JSON.parse(t) : null }
}
let n = 0
async function gymWithPeople(name = 'Academia Força Total ' + (++n)) {
  const owner = as('owner')
  const g = await owner('POST', '/gyms', { name, document: '12.345.678/0001-90' })
  assert.equal(g.status, 201, JSON.stringify(g.body))
  const gid = g.body.id
  const coachRow = await owner('POST', `/gyms/${gid}/members`, { name: 'Carlos', role: 'trainer' })
  assert.equal(coachRow.status, 201, JSON.stringify(coachRow.body))
  const studRow = await owner('POST', `/gyms/${gid}/members`, { name: 'Ana', role: 'student', goal: 'hipertrofia' })
  assert.match(studRow.body.member.invite_code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
  assert.equal((await as('coach')('POST', '/join', { code: coachRow.body.member.invite_code })).status, 200)
  assert.equal((await as('student')('POST', '/join', { code: studRow.body.member.invite_code.toLowerCase() })).status, 200)
  return { gid, coachId: coachRow.body.member.id, studentId: studRow.body.member.id, slug: g.body.slug }
}

test('academies, roles and the tenant boundary', async () => {
  assert.equal((await as(null)('GET', '/me')).status, 401)
  assert.equal((await as(null)('GET', '/config')).body.exerciseMedia, false)
  const { gid, studentId } = await gymWithPeople()
  const me = await as('student')('GET', '/me')
  assert.equal(me.body.memberships.at(-1).role, 'student')
  assert.equal((await as('student')('GET', `/gyms/${gid}/members`)).status, 403)
  assert.equal((await as('coach')('GET', `/gyms/${gid}/members`)).status, 200)
  assert.equal((await as('coach')('GET', `/gyms/${gid}/transactions`)).status, 403)
  const coachDash = await as('coach')('GET', `/gyms/${gid}/dashboard`)
  assert.equal(coachDash.status, 200, JSON.stringify(coachDash.body))
  assert.equal(coachDash.body.finance, undefined)
  const g2 = await as('other')('POST', '/gyms', { name: 'Outra Academia' })
  assert.equal((await as('other')('GET', `/gyms/${gid}/members`)).status, 403)
  assert.equal((await as('other')('GET', `/gyms/${g2.body.id}/members/${studentId}`)).status, 404)
  assert.equal((await as('other')('GET', `/gyms/not-a-uuid/members`)).status, 404)
  const root = as('root')
  assert.equal((await root('GET', `/gyms/${gid}/members`)).status, 200)
  assert.equal((await as('owner')('GET', '/platform/gyms')).status, 403)
  assert.ok((await root('GET', '/platform/gyms')).body.gyms.length >= 2)
  assert.equal((await root('POST', `/platform/gyms/${gid}/status`, { status: 'suspended' })).status, 200)
  assert.equal((await as('owner')('GET', `/gyms/${gid}/dashboard`)).status, 423)
  await root('POST', `/platform/gyms/${gid}/status`, { status: 'active' })
  const users = await root('GET', '/platform/users')
  assert.ok(users.body.users.find(u => u.id === U.student).gyms.some(x => x.role === 'student'))
  const ov = await root('GET', '/platform/overview')
  assert.ok(ov.body.gyms >= 2)
  const admins = await as('owner')('GET', `/gyms/${gid}/members?role=gym_admin`)
  assert.equal((await as('owner')('POST', `/gyms/${gid}/members/${admins.body.members[0].id}/status`, { status: 'inactive' })).status, 400)
  assert.ok((await root('GET', '/platform/audit')).body.entries.length > 0)
})

test('logo, signup link and own domain', async () => {
  const { gid, slug } = await gymWithPeople()
  const owner = as('owner')
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52])
  const b64 = btoa(String.fromCharCode(...png))
  assert.equal((await owner('PUT', `/gyms/${gid}/logo`, { dataUrl: 'data:image/png;base64,' + btoa('<svg onload=alert(1)>') })).status, 400)
  const ok = await owner('PUT', `/gyms/${gid}/logo`, { dataUrl: 'data:image/png;base64,' + b64 })
  assert.equal(ok.status, 200, JSON.stringify(ok.body))
  assert.match(ok.body.gym.logoUrl, /\/logo\?v=1$/)
  const got = await as(null)('GET', `/gyms/${gid}/logo`)
  assert.equal(got.headers.get('content-type'), 'image/png')
  assert.deepEqual([...got.body], [...png])
  const brand = await as(null)('GET', `/public/gym?slug=${slug}`)
  assert.equal(brand.body.gym.publicSignup, true)
  assert.equal(brand.body.gym.document, undefined)
  const joined = await as('other')('POST', `/public/join/${slug}`)
  assert.equal(joined.status, 201, JSON.stringify(joined.body))
  assert.equal((await as('other')('POST', `/public/join/${slug}`)).body.already, true)
  const list = await owner('GET', `/gyms/${gid}/members?role=student`)
  const viaLink = list.body.members.find(m => m.joined_via === 'link')
  assert.ok(viaLink)
  assert.equal(viaLink.access_id, 1004)
  await owner('PUT', `/gyms/${gid}`, { settings: { publicSignup: false } })
  assert.equal((await as('root')('POST', `/public/join/${slug}`)).status, 403)
  assert.equal((await owner('PUT', `/gyms/${gid}`, { customDomain: 'https://App.Link' + n + '.com.br/' })).body.gym.custom_domain, `app.link${n}.com.br`)
  assert.equal((await owner('PUT', `/gyms/${gid}`, { customDomain: 'not a domain' })).status, 400)
  const r = await fetch(BASE + '/api/saas/public/gym', { headers: { 'X-Forwarded-Host': `app.link${n}.com.br` } })
  assert.equal((await r.json()).gym.slug, slug)
  assert.equal((await as(null)('GET', `/public/domain-check?domain=app.link${n}.com.br`)).status, 200)
  assert.equal((await as(null)('GET', '/public/domain-check?domain=evil.example.com')).status, 404)
})

test('a trainer writes a sheet and the student gets a copy', async () => {
  const { gid, studentId } = await gymWithPeople()
  const coach = as('coach')
  const plan = { routines: [{ id: 'a', name: 'Treino A', ex: [{ id: '0025', sets: 4, reps: 12, weight: 20, restSec: 90, note: 'controle a descida' }, { id: '0001', sets: 99, reps: 'x' }] }], week: { 1: ['a'], 4: ['a', 'zzz'] } }
  const w = await coach('POST', `/gyms/${gid}/workouts`, { name: 'Hipertrofia iniciante', plan })
  assert.equal(w.status, 201, JSON.stringify(w.body))
  assert.equal(w.body.workout.plan.routines[0].ex[1].sets, 3)
  assert.deepEqual(w.body.workout.plan.week, { 1: ['a'], 4: ['a'] })
  assert.equal((await coach('POST', `/gyms/${gid}/workouts/${w.body.workout.id}/assign`, { memberIds: [studentId], notes: '3x por semana' })).status, 200)
  await coach('PUT', `/gyms/${gid}/workouts/${w.body.workout.id}`, { name: 'Renomeada' })
  const my = await as('student')('GET', `/gyms/${gid}/my`)
  assert.equal(my.status, 200, JSON.stringify(my.body))
  assert.equal(my.body.assignments[0].name, 'Hipertrofia iniciante')
  assert.equal(my.body.assignments[0].plan.routines[0].ex[0].note, 'controle a descida')
  assert.equal(my.body.member.notes, undefined)
  assert.equal(my.body.trainer.name, 'Carlos')
  assert.equal((await as('student')('POST', `/gyms/${gid}/my/assignments/${my.body.assignments[0].id}/imported`)).status, 200)
  await db.db.query(`insert into opengym.state (user_id, doc) values ($1, $2) on conflict (user_id) do update set doc = excluded.doc`,
    [U.student, JSON.stringify({ workouts: [{ id: 'w', name: 'Treino A', d: new Date().toISOString().slice(0, 10), start: 0, end: 3600000, entries: [{}, {}] }] })])
  const prog = await coach('GET', `/gyms/${gid}/members/${studentId}/progress`)
  assert.equal(prog.body.last30, 1)
  assert.equal(prog.body.recent[0].durationMin, 60)
  assert.equal((await coach('GET', `/gyms/${gid}/assignments`)).body.assignments.length, 1)
})

test('fees, shop and supplies keep stock and the books together', async () => {
  const { gid, studentId } = await gymWithPeople()
  const owner = as('owner')
  const today = new Date().toISOString().slice(0, 10)
  const plan = await owner('POST', `/gyms/${gid}/plans`, { name: 'Mensal', priceCents: 12000 })
  assert.equal(plan.status, 201)
  const sub = await owner('POST', `/gyms/${gid}/subscriptions`, { memberId: studentId, planId: plan.body.plan.id, dueDay: 5 })
  assert.equal(sub.status, 201, JSON.stringify(sub.body))
  assert.equal((await owner('POST', `/gyms/${gid}/charges/generate`, {})).body.created, 0)
  const open = await owner('GET', `/gyms/${gid}/charges?status=open`)
  assert.equal(open.body.charges.length, 1)
  const paid = await owner('POST', `/gyms/${gid}/charges/${open.body.charges[0].id}/pay`, { paymentMethod: 'pix' })
  assert.equal(paid.body.charge.status, 'paid')

  const water = await owner('POST', `/gyms/${gid}/products`, { name: 'Água 500ml', priceCents: 300, costCents: 100, stockQty: 10, minQty: 3 })
  const coco = await owner('POST', `/gyms/${gid}/products`, { name: 'Água de coco', priceCents: 700, stockQty: 2 })
  const sell = body => owner('POST', `/gyms/${gid}/sales`, body)
  assert.equal((await sell({ items: [{ productId: water.body.product.id, qty: 1 }], paymentMethod: 'cash' })).body.code, 'cash-closed')
  assert.equal((await owner('POST', `/gyms/${gid}/cash/open`, { openingCents: 5000 })).status, 200)
  assert.equal((await sell({ items: [{ productId: coco.body.product.id, qty: 3 }], paymentMethod: 'pix' })).body.code, 'stock')
  const sale = await sell({ items: [{ productId: water.body.product.id, qty: 2 }, { productId: coco.body.product.id, qty: 1 }], paymentMethod: 'cash', paidCents: 2000, discountCents: 100 })
  assert.equal(sale.status, 201, JSON.stringify(sale.body))
  assert.equal(sale.body.sale.total_cents, 1200)
  assert.equal(sale.body.sale.change_cents, 800)
  assert.equal((await sell({ items: [{ productId: water.body.product.id, qty: 1 }], paymentMethod: 'account', memberId: studentId })).status, 201)
  assert.equal((await owner('GET', `/gyms/${gid}/products`)).body.products.find(p => p.name === 'Água 500ml').stock_qty, 7)
  await owner('POST', `/gyms/${gid}/cash/movement`, { kind: 'withdrawal', amountCents: 1000, reason: 'cofre' })
  const closed = await owner('POST', `/gyms/${gid}/cash/close`, { countedCents: 5100 })
  assert.equal(closed.body.session.expected_cents, 5200)
  assert.equal(closed.body.differenceCents, -100)
  assert.equal((await owner('GET', `/gyms/${gid}/sales?date=${today}`)).body.sales.length, 2)
  assert.equal((await owner('POST', `/gyms/${gid}/sales/${sale.body.sale.id}/cancel`, {})).status, 200)
  assert.equal((await owner('GET', `/gyms/${gid}/products`)).body.products.find(p => p.name === 'Água 500ml').stock_qty, 9)

  const sup = await owner('POST', `/gyms/${gid}/suppliers`, { name: 'Limpa Tudo Ltda' })
  const item = await owner('POST', `/gyms/${gid}/supplies`, { name: 'Desinfetante 5L', unit: 'galão', minQty: 2 })
  const order = await owner('POST', `/gyms/${gid}/purchases`, { supplierId: sup.body.supplier.id, items: [{ itemId: item.body.supply.id, qty: 4, unitCostCents: 2500 }, { kind: 'product', itemId: water.body.product.id, qty: 24, unitCostCents: 90 }] })
  assert.equal(order.status, 201, JSON.stringify(order.body))
  assert.equal(order.body.purchase.total_cents, 12160)
  assert.equal((await owner('POST', `/gyms/${gid}/purchases/${order.body.purchase.id}/receive`, { paymentMethod: 'boleto' })).body.purchase.status, 'received')
  assert.equal((await owner('GET', `/gyms/${gid}/supplies`)).body.supplies[0].stock_qty, 4)
  assert.equal((await owner('POST', `/gyms/${gid}/supplies/${item.body.supply.id}/stock`, { qtyDelta: -9 })).status, 400)
  const flow = await owner('GET', `/gyms/${gid}/cashflow?from=${today.slice(0, 8)}01&to=${today}`)
  assert.equal(flow.body.incomeCents, 12000)
  assert.equal(flow.body.expenseCents, 12160)
  assert.equal(flow.body.receivable.total, 300)
  const tx = await owner('POST', `/gyms/${gid}/transactions`, { kind: 'expense', description: 'Conta de luz', amountCents: 45000 })
  assert.equal(tx.status, 201, JSON.stringify(tx.body))
  assert.equal((await owner('POST', `/gyms/${gid}/transactions/${tx.body.transaction.id}/cancel`)).status, 200)
  const dash = await owner('GET', `/gyms/${gid}/dashboard`)
  assert.equal(dash.body.finance.incomeCents, 12000)
  assert.equal(dash.body.setup.plans, true)
  assert.equal((await owner('GET', `/gyms/${gid}/categories`)).body.categories.length, 10)
})

test('turnstile: Control iD online mode, push queue, reception and the generic bridge', async () => {
  const { gid, studentId } = await gymWithPeople()
  const owner = as('owner')
  const serial = 'SN-' + n
  const dev = await owner('POST', `/gyms/${gid}/access/devices`, { name: 'Catraca entrada', kind: 'controlid', serial })
  assert.equal(dev.status, 201, JSON.stringify(dev.body))
  const did = dev.body.device.id
  const stud = (await owner('GET', `/gyms/${gid}/members/${studentId}`)).body.member
  let a = await device('new_user_identified.fcgi', { device_id: serial, user_id: String(stud.access_id), portal_id: '1' })
  assert.equal(a.body.result.event, 7, JSON.stringify(a.body))
  assert.deepEqual(a.body.result.actions, [{ action: 'catra', parameters: 'allow=clockwise' }])
  assert.equal((await device('new_user_identified.fcgi', { device_id: 'stranger', user_id: String(stud.access_id) })).body.result.event, 3)
  assert.equal((await device('new_user_identified.fcgi', { device_id: serial, user_id: '0' })).body.result.event, 3)
  const old = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  await owner('POST', `/gyms/${gid}/charges`, { memberId: studentId, description: 'Mensal', amountCents: 9990, dueDate: old })
  a = await device('new_user_identified.fcgi', { device_id: serial, user_id: String(stud.access_id) })
  assert.equal(a.body.result.event, 6)
  assert.equal(a.body.result.message, 'Mensalidade em atraso')
  assert.equal((await owner('POST', `/gyms/${gid}/access/checkin`, { memberId: studentId })).body.allow, false)
  assert.equal((await owner('POST', `/gyms/${gid}/members/${studentId}/enroll`, { deviceId: did })).status, 200)
  await owner('POST', `/gyms/${gid}/access/devices/${did}/release`, { memberId: studentId })
  let p = await device('push', { deviceId: serial }, 'GET')
  assert.equal(p.body.endpoint, 'create_objects')
  assert.deepEqual(p.body.body.values[0], { id: stud.access_id, name: 'Ana', registration: '' })
  await device('result', { deviceId: serial })
  p = await device('push', { deviceId: serial }, 'GET')
  assert.deepEqual(p.body.body, { type: 'biometry', save: true, user_id: stud.access_id, sync: false })
  await device('result', { deviceId: serial })
  assert.equal((await device('push', { deviceId: serial }, 'GET')).body.endpoint, 'execute_actions')
  await device('result', { deviceId: serial })
  assert.equal((await device('push', { deviceId: serial }, 'GET')).body, null)
  assert.deepEqual((await owner('GET', `/gyms/${gid}/access/devices/${did}/commands`)).body.commands.map(c => c.status), ['done', 'done', 'done'])
  const logs = await owner('GET', `/gyms/${gid}/access/logs`)
  assert.ok(logs.body.logs.length >= 4)
  assert.equal(logs.body.today.present, 1)
  assert.equal((await owner('GET', `/gyms/${gid}/access/devices`)).body.devices[0].online, true)
  assert.equal((await owner('PUT', `/gyms/${gid}/members/${studentId}/card`, { cardNumber: '123-456' })).body.cardNumber, '123456')
  const gen = await owner('POST', `/gyms/${gid}/access/devices`, { name: 'Henry recepção', kind: 'generic' })
  assert.ok(gen.body.token)
  const check = (token, body) => fetch(BASE + '/api/saas/access/check', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) })
  assert.equal((await check('wrong', { identifier: '1' })).status, 401)
  const coachRow = (await owner('GET', `/gyms/${gid}/members?role=staff`)).body.members.find(m => m.role === 'trainer')
  assert.equal((await (await check(gen.body.token, { identifier: String(coachRow.access_id) })).json()).allow, true)
  assert.equal((await as('coach')('POST', `/gyms/${gid}/access/devices`, { name: 'x', kind: 'generic' })).status, 403)
  assert.doesNotMatch(log, /server error|Error:/, log)
})

test('personal trainer: e-mail invite, assessments, meal plan and the food diary', async () => {
  const pt = as('coach')
  const g = await pt('POST', '/gyms', { kind: 'personal' })
  assert.equal(g.status, 201, JSON.stringify(g.body))
  assert.equal(g.body.kind, 'personal')
  assert.equal(g.body.name, 'Consultoria Carlos Instrutor')
  const gid = g.body.id
  const st = await pt('POST', `/gyms/${gid}/members`, { name: 'Bia', role: 'student', email: 'BIA@example.com', sendInvite: true, redirectTo: 'https://steelday.vercel.app/' })
  assert.equal(st.status, 201, JSON.stringify(st.body))
  assert.deepEqual(st.body.invite, { sent: true, test: true })
  assert.equal(st.body.member.joined_via, 'email')
  assert.equal((await pt('POST', `/gyms/${gid}/members`, { name: 'Sem email', role: 'student', sendInvite: true })).body.invite.sent, false)
  // Bia signs in with the invited address: the row becomes hers.
  const me = await as('invited')('GET', '/me')
  const mine = me.body.memberships.find(m => m.gym.id === gid)
  assert.equal(mine.role, 'student')
  assert.equal(mine.gym.kind, 'personal')
  const sid = st.body.member.id

  const a1 = await pt('POST', `/gyms/${gid}/members/${sid}/assessments`, { date: '2026-10-01', weightKg: 70.5, heightCm: 165, perimeters: { waist: 80, hip: 100, arm_r: 30, bogus: 5 }, bio: { fat_pct: 28, lean_kg: 50.2 } })
  assert.equal(a1.status, 201, JSON.stringify(a1.body))
  assert.deepEqual(a1.body.assessment.perimeters, { waist: 80, hip: 100, arm_r: 30 })
  assert.equal((await pt('POST', `/gyms/${gid}/members/${sid}/assessments`, { perimeters: { waist: 9999 } })).status, 400)
  assert.equal((await pt('POST', `/gyms/${gid}/members/${sid}/assessments`, {})).status, 400)
  await pt('POST', `/gyms/${gid}/members/${sid}/assessments`, { date: '2026-11-01', weightKg: 68, perimeters: { waist: 76 } })
  assert.equal((await pt('GET', `/gyms/${gid}/members/${sid}/assessments`)).body.assessments.length, 2)
  assert.equal((await as('invited')('GET', `/gyms/${gid}/my/assessments`)).body.assessments[0].weight_kg, 68)

  const plan = await pt('POST', `/gyms/${gid}/members/${sid}/meal-plans`, {
    name: 'Cutting', targets: { kcal: 1800, protein: 130 },
    meals: [{ key: 'cafe', name: 'Café da manhã', time: '07:30', items: [{ name: 'Ovo, de galinha, inteiro, cozido', tacoId: 488, grams: 100, kcal: 146, protein: 13.3, carbs: 0.6, fat: 9.5 }] },
      { name: 'Almoço', time: '12:00', items: [{ name: 'Arroz, tipo 1, cozido', grams: 150, kcal: 192, protein: 3.8, carbs: 42, fat: 0.3 }] }]
  })
  assert.equal(plan.status, 201, JSON.stringify(plan.body))
  assert.deepEqual(plan.body.plan.meals.map(m => m.key), ['cafe', 'm2'])
  const pid = plan.body.plan.id
  const my = await as('invited')('GET', `/gyms/${gid}/my/meal-plan`)
  assert.equal(my.body.plan.id, pid)
  const jpg = 'data:image/jpeg;base64,' + btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4))
  const log = await as('invited')('PUT', `/gyms/${gid}/my/meal-plan/${pid}/log`, { mealKey: 'cafe', done: true, note: 'comi 2 ovos', photoDataUrl: jpg })
  assert.equal(log.status, 200, JSON.stringify(log.body))
  assert.equal(log.body.log.has_photo, true)
  assert.equal((await as('invited')('PUT', `/gyms/${gid}/my/meal-plan/${pid}/log`, { mealKey: 'nope' })).status, 400)
  const seen = await pt('GET', `/gyms/${gid}/members/${sid}/food-logs`)
  assert.equal(seen.body.logs.length, 1)
  assert.equal(seen.body.adherence.days.at(-1).done, 1)
  const photo = await pt('GET', `/gyms/${gid}/food-logs/${seen.body.logs[0].id}/photo`)
  assert.equal(photo.headers.get('content-type'), 'image/jpeg')
  // Someone else's student cannot read it.
  assert.equal((await as('student')('GET', `/gyms/${gid}/food-logs/${seen.body.logs[0].id}/photo`)).status, 403)
  // A new plan retires the old one.
  await pt('POST', `/gyms/${gid}/members/${sid}/meal-plans`, { name: 'Manutenção', meals: [{ name: 'Livre', items: [] }] })
  const plans = await pt('GET', `/gyms/${gid}/members/${sid}/meal-plans`)
  assert.deepEqual(plans.body.plans.map(p => p.status).sort(), ['active', 'archived'])
})
