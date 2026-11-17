/* The SaaS surface end to end, against the real server.js in a child: academies and roles, the
 * tenant boundary, workout sheets, monthly fees, supplies and the shop. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
function mintSession(uid) {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
const USERS = {
  root: { id: 'u_root', name: 'Plataforma', admin: true },
  owner: { id: 'u_owner', name: 'Dona da Academia' },
  coach: { id: 'u_coach', name: 'Instrutor Carlos' },
  student: { id: 'u_stud', name: 'Aluna Ana' },
  other: { id: 'u_other', name: 'Outro Dono' }
};

async function startServer(t, env = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-saas-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: Object.values(USERS).map(u => ({ ...u, created: new Date().toISOString() })), creds: [], subs: [], invites: []
  }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', ...env }
  });
  const h = { log: '', dataDir };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  h.port = await boundPort(child, () => h.log);
  const base = `http://127.0.0.1:${h.port}`;
  h.as = who => async (method, p, body) => {
    const headers = { 'Content-Type': 'application/json', ...(who ? { Cookie: `gymsid=${mintSession(USERS[who].id)}` } : {}) };
    const r = await fetch(base + '/api/saas' + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, body: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()), headers: r.headers };
  };
  h.stackFrames = () => h.log.split('\n').filter(l => /^\s+at /.test(l)).length;
  return h;
}

async function gymWithPeople(h) {
  const owner = h.as('owner');
  const g = await owner('POST', '/gyms', { name: 'Academia Força Total', document: '12.345.678/0001-90' });
  assert.equal(g.status, 201, JSON.stringify(g.body));
  const gid = g.body.id;
  const coachRow = await owner('POST', `/gyms/${gid}/members`, { name: 'Carlos', role: 'trainer' });
  assert.equal(coachRow.status, 201);
  const studRow = await owner('POST', `/gyms/${gid}/members`, { name: 'Ana', role: 'student', goal: 'hipertrofia', healthNotes: 'joelho' });
  assert.equal(studRow.status, 201);
  assert.match(studRow.body.member.invite_code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.equal((await h.as('coach')('POST', '/join', { code: coachRow.body.member.invite_code })).status, 200);
  assert.equal((await h.as('student')('POST', '/join', { code: studRow.body.member.invite_code.toLowerCase() })).status, 200);
  return { gid, coachId: coachRow.body.member.id, studentId: studRow.body.member.id };
}

test('academy sign-up, roles and the tenant boundary', async t => {
  const h = await startServer(t);
  assert.equal((await h.as(null)('GET', '/me')).status, 401);
  const cfg = await h.as(null)('GET', '/config');
  assert.equal(cfg.status, 200);
  assert.equal(cfg.body.exerciseMedia, false, 'exercise media are off unless licensed');

  const { gid, studentId } = await gymWithPeople(h);
  const me = await h.as('student')('GET', '/me');
  assert.equal(me.body.memberships[0].role, 'student');
  assert.equal(me.body.memberships[0].gym.name, 'Academia Força Total');

  // A used code is gone.
  const again = await h.as('other')('POST', '/join', { code: 'XXXX-XXXX' });
  assert.equal(again.status, 400);

  // Students never reach the staff area; trainers never reach money.
  assert.equal((await h.as('student')('GET', `/gyms/${gid}/members`)).status, 403);
  assert.equal((await h.as('coach')('GET', `/gyms/${gid}/members`)).status, 200);
  assert.equal((await h.as('coach')('GET', `/gyms/${gid}/transactions`)).status, 403);
  assert.equal((await h.as('coach')('POST', `/gyms/${gid}/members`, { name: 'X', role: 'gym_admin' })).status, 403);
  const coachDash = await h.as('coach')('GET', `/gyms/${gid}/dashboard`);
  assert.equal(coachDash.status, 200);
  assert.equal(coachDash.body.finance, undefined, 'no money on a trainer dashboard');

  // Another academy's owner sees nothing of this one.
  const other = h.as('other');
  const g2 = await other('POST', '/gyms', { name: 'Outra Academia' });
  assert.equal(g2.status, 201);
  assert.equal((await other('GET', `/gyms/${gid}/members`)).status, 403);
  assert.equal((await other('GET', `/gyms/${g2.body.id}/members/${studentId}`)).status, 404, 'an id from another academy does not resolve');

  // The platform admin passes everywhere and can suspend an academy.
  const root = h.as('root');
  assert.equal((await root('GET', `/gyms/${gid}/members`)).status, 200);
  assert.equal((await h.as('owner')('GET', '/platform/gyms')).status, 403);
  const list = await root('GET', '/platform/gyms');
  assert.equal(list.body.gyms.length, 2);
  assert.equal((await root('POST', `/platform/gyms/${gid}/status`, { status: 'suspended' })).status, 200);
  assert.equal((await h.as('owner')('GET', `/gyms/${gid}/dashboard`)).status, 423);
  await root('POST', `/platform/gyms/${gid}/status`, { status: 'active' });
  const users = await root('GET', '/platform/users');
  assert.equal(users.body.users.find(u => u.id === USERS.student.id).gyms[0].role, 'student');

  // The last administrator cannot be switched off.
  const staff = await h.as('owner')('GET', `/gyms/${gid}/members?role=gym_admin`);
  const self = staff.body.members[0];
  assert.equal((await h.as('owner')('POST', `/gyms/${gid}/members/${self.id}/status`, { status: 'inactive' })).status, 400);
  assert.equal(h.stackFrames(), 0, h.log);
});

test('logo upload accepts real images only and serves them back', async t => {
  const h = await startServer(t);
  const { gid } = await gymWithPeople(h);
  const owner = h.as('owner');
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
  const bad = await owner('PUT', `/gyms/${gid}/logo`, { dataUrl: 'data:image/png;base64,' + Buffer.from('<svg onload=alert(1)>').toString('base64') });
  assert.equal(bad.status, 400);
  const ok = await owner('PUT', `/gyms/${gid}/logo`, { dataUrl: 'data:image/png;base64,' + png.toString('base64') });
  assert.equal(ok.status, 200);
  assert.match(ok.body.gym.logoUrl, /\/logo\?v=1$/);
  const got = await h.as(null)('GET', `/gyms/${gid}/logo`);
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('content-type'), 'image/png');
  assert.deepEqual(got.body, png);
  assert.equal((await h.as('coach')('PUT', `/gyms/${gid}/logo`, { dataUrl: 'data:image/png;base64,' + png.toString('base64') })).status, 403);
});

test('a trainer writes a sheet, assigns it, and the student gets a copy', async t => {
  const h = await startServer(t);
  const { gid, studentId } = await gymWithPeople(h);
  const coach = h.as('coach');
  const plan = { routines: [{ id: 'a', name: 'Treino A', ex: [{ id: '0025', sets: 4, reps: 12, weight: 20, restSec: 90, note: 'controle a descida' }, { id: '0001', sets: 99, reps: 'x' }] }], week: { 1: ['a'], 4: ['a', 'zzz'] } };
  const w = await coach('POST', `/gyms/${gid}/workouts`, { name: 'Hipertrofia iniciante', plan });
  assert.equal(w.status, 201, JSON.stringify(w.body));
  assert.equal(w.body.workout.plan.opengym_plan, 1);
  assert.equal(w.body.workout.plan.routines[0].ex[1].sets, 3, 'out-of-range numbers fall back to defaults');
  assert.deepEqual(w.body.workout.plan.week, { 1: ['a'], 4: ['a'] });
  const a = await coach('POST', `/gyms/${gid}/workouts/${w.body.workout.id}/assign`, { memberIds: [studentId], notes: '3x por semana' });
  assert.equal(a.status, 200);
  // Editing the sheet afterwards leaves the student's copy as assigned.
  await coach('PUT', `/gyms/${gid}/workouts/${w.body.workout.id}`, { name: 'Renomeada' });
  const my = await h.as('student')('GET', `/gyms/${gid}/my`);
  assert.equal(my.status, 200);
  assert.equal(my.body.assignments.length, 1);
  assert.equal(my.body.assignments[0].name, 'Hipertrofia iniciante');
  assert.equal(my.body.assignments[0].plan.routines[0].ex[0].note, 'controle a descida');
  assert.equal(my.body.member.notes, undefined, 'internal notes stay with the staff');
  assert.equal(my.body.trainer.name, 'Carlos', 'the trainer who assigned becomes the student\'s trainer');
  assert.equal((await h.as('student')('POST', `/gyms/${gid}/my/assignments/${my.body.assignments[0].id}/imported`)).status, 200);
  // Progress reads the student's own training log.
  fs.writeFileSync(path.join(h.dataDir, `state-${USERS.student.id}.json`), JSON.stringify({ workouts: [{ id: 'w', name: 'Treino A', d: new Date().toISOString().slice(0, 10), start: 0, end: 3600000, entries: [{}, {}] }] }));
  const prog = await coach('GET', `/gyms/${gid}/members/${studentId}/progress`);
  assert.equal(prog.body.last30, 1);
  assert.equal(prog.body.recent[0].durationMin, 60);
});

test('fees, shop and supplies keep stock and the books together', async t => {
  const h = await startServer(t);
  const { gid, studentId } = await gymWithPeople(h);
  const owner = h.as('owner');
  const today = new Date().toISOString().slice(0, 10);

  // A plan, a subscription, this month's fee, paid by PIX.
  const plan = await owner('POST', `/gyms/${gid}/plans`, { name: 'Mensal', priceCents: 12000 });
  assert.equal(plan.status, 201);
  const sub = await owner('POST', `/gyms/${gid}/subscriptions`, { memberId: studentId, planId: plan.body.plan.id, dueDay: 5 });
  assert.equal(sub.status, 201);
  assert.equal((await owner('POST', `/gyms/${gid}/charges/generate`, {})).body.created, 0, 'generating twice does not double-bill');
  const open = await owner('GET', `/gyms/${gid}/charges?status=open`);
  assert.equal(open.body.charges.length, 1);
  const paid = await owner('POST', `/gyms/${gid}/charges/${open.body.charges[0].id}/pay`, { paymentMethod: 'pix' });
  assert.equal(paid.body.charge.status, 'paid');

  // The shop: no sale without an open drawer, none beyond the stock.
  const water = await owner('POST', `/gyms/${gid}/products`, { name: 'Água 500ml', priceCents: 300, costCents: 100, stockQty: 10, minQty: 3 });
  const coco = await owner('POST', `/gyms/${gid}/products`, { name: 'Água de coco', priceCents: 700, stockQty: 2 });
  const sell = body => owner('POST', `/gyms/${gid}/sales`, body);
  assert.equal((await sell({ items: [{ productId: water.body.product.id, qty: 1 }], paymentMethod: 'cash' })).body.code, 'cash-closed');
  assert.equal((await owner('POST', `/gyms/${gid}/cash/open`, { openingCents: 5000 })).status, 200);
  assert.equal((await sell({ items: [{ productId: coco.body.product.id, qty: 3 }], paymentMethod: 'pix' })).body.code, 'stock');
  const sale = await sell({ items: [{ productId: water.body.product.id, qty: 2 }, { productId: coco.body.product.id, qty: 1 }], paymentMethod: 'cash', paidCents: 2000, discountCents: 100 });
  assert.equal(sale.status, 201, JSON.stringify(sale.body));
  assert.equal(sale.body.sale.total_cents, 1200);
  assert.equal(sale.body.sale.change_cents, 800);
  const fiado = await sell({ items: [{ productId: water.body.product.id, qty: 1 }], paymentMethod: 'account', memberId: studentId });
  assert.equal(fiado.status, 201);
  const products = await owner('GET', `/gyms/${gid}/products`);
  assert.equal(products.body.products.find(p => p.name === 'Água 500ml').stock_qty, 7);

  // Drawer: 50 opening + 12 cash sale - 10 withdrawal = 52 expected.
  await owner('POST', `/gyms/${gid}/cash/movement`, { kind: 'withdrawal', amountCents: 1000, reason: 'cofre' });
  const closed = await owner('POST', `/gyms/${gid}/cash/close`, { countedCents: 5100 });
  assert.equal(closed.body.session.expected_cents, 5200);
  assert.equal(closed.body.differenceCents, -100);

  // Canceling the sale puts the stock back and takes the income out.
  assert.equal((await owner('POST', `/gyms/${gid}/sales/${sale.body.sale.id}/cancel`, {})).status, 200);
  const after = await owner('GET', `/gyms/${gid}/products`);
  assert.equal(after.body.products.find(p => p.name === 'Água 500ml').stock_qty, 9);

  // Supplies: receiving an order stocks it and books the expense.
  const sup = await owner('POST', `/gyms/${gid}/suppliers`, { name: 'Limpa Tudo Ltda' });
  const item = await owner('POST', `/gyms/${gid}/supplies`, { name: 'Desinfetante 5L', unit: 'galão', minQty: 2 });
  const order = await owner('POST', `/gyms/${gid}/purchases`, { supplierId: sup.body.supplier.id, items: [{ itemId: item.body.supply.id, qty: 4, unitCostCents: 2500 }, { kind: 'product', itemId: water.body.product.id, qty: 24, unitCostCents: 90 }] });
  assert.equal(order.status, 201, JSON.stringify(order.body));
  assert.equal(order.body.purchase.total_cents, 12160);
  const rec = await owner('POST', `/gyms/${gid}/purchases/${order.body.purchase.id}/receive`, { paymentMethod: 'boleto' });
  assert.equal(rec.body.purchase.status, 'received');
  const supplies = await owner('GET', `/gyms/${gid}/supplies`);
  assert.equal(supplies.body.supplies[0].stock_qty, 4);
  assert.equal((await owner('POST', `/gyms/${gid}/supplies/${item.body.supply.id}/stock`, { qtyDelta: -9 })).status, 400, 'stock never goes negative');

  // The books: fee 120 in, shop 0 (canceled), purchase 100 + 21.60 out.
  const flow = await owner('GET', `/gyms/${gid}/cashflow?from=${today.slice(0, 8)}01&to=${today}`);
  assert.equal(flow.body.incomeCents, 12000);
  assert.equal(flow.body.expenseCents, 12160);
  assert.equal(flow.body.receivable.total, 300, 'the fiado sale is still owed');
  // A manual expense, then its cancel.
  const tx = await owner('POST', `/gyms/${gid}/transactions`, { kind: 'expense', description: 'Conta de luz', amountCents: 45000 });
  assert.equal(tx.status, 201);
  assert.equal((await owner('POST', `/gyms/${gid}/transactions/${tx.body.transaction.id}/cancel`)).status, 200);
  const dash = await owner('GET', `/gyms/${gid}/dashboard`);
  assert.equal(dash.body.finance.incomeCents, 12000);
  assert.equal(dash.body.students, 1);
  assert.equal(h.stackFrames(), 0, h.log);
});

test('SAAS_MODE=off switches the whole area off', async t => {
  const h = await startServer(t, { SAAS_MODE: 'off' });
  assert.equal((await h.as(null)('GET', '/config')).status, 404);
  assert.equal((await h.as('owner')('POST', '/gyms', { name: 'X' })).status, 404);
});

test('signup link, own domain and the role each person lands on', async t => {
  const h = await startServer(t);
  const owner = h.as('owner');
  const g = await owner('POST', '/gyms', { name: 'Academia Link' });
  const gid = g.body.id;
  assert.equal(g.body.signupPath, '#/a/academia-link');
  const brand = await h.as(null)('GET', '/public/gym?slug=academia-link');
  assert.equal(brand.body.gym.name, 'Academia Link');
  assert.equal(brand.body.gym.publicSignup, true);
  assert.equal(brand.body.gym.document, undefined, 'a visitor sees the face of the academy, not its data');

  const joined = await h.as('student')('POST', '/public/join/academia-link');
  assert.equal(joined.status, 201);
  assert.equal((await h.as('student')('POST', '/public/join/academia-link')).body.already, true);
  const list = await owner('GET', `/gyms/${gid}/members?role=student`);
  assert.equal(list.body.members.length, 1);
  assert.equal(list.body.members[0].joined_via, 'link');
  assert.equal(list.body.members[0].access_id, 1002, 'the owner is 1001, the first student 1002');

  // The academy can close the link.
  await owner('PUT', `/gyms/${gid}`, { settings: { publicSignup: false } });
  assert.equal((await h.as('coach')('POST', '/public/join/academia-link')).status, 403);

  // Its own domain: found by the Host the app is opened at, and answered for the certificate check.
  assert.equal((await owner('PUT', `/gyms/${gid}`, { customDomain: 'https://App.AcademiaLink.com.br/' })).body.gym.custom_domain, 'app.academialink.com.br');
  assert.equal((await owner('PUT', `/gyms/${gid}`, { customDomain: 'not a domain' })).status, 400);
  const r = await fetch(`http://127.0.0.1:${h.port}/api/saas/public/gym`, { headers: { 'X-Forwarded-Host': 'app.academialink.com.br' } });
  assert.equal((await r.json()).gym.slug, 'academia-link');
  assert.equal((await h.as(null)('GET', '/public/domain-check?domain=app.academialink.com.br')).status, 200);
  assert.equal((await h.as(null)('GET', '/public/domain-check?domain=evil.example.com')).status, 404);
});

test('turnstile: Control iD online mode, push queue, reception and the generic bridge', async t => {
  const h = await startServer(t);
  const { gid, studentId } = await gymWithPeople(h);
  const owner = h.as('owner');
  const dev = await owner('POST', `/gyms/${gid}/access/devices`, { name: 'Catraca entrada', kind: 'controlid', serial: '0M0100/001', releaseAction: 'catra_clockwise' });
  assert.equal(dev.status, 201, JSON.stringify(dev.body));
  const did = dev.body.device.id;
  const base = `http://127.0.0.1:${h.port}`;
  const device = async (path, params, method = 'POST') => {
    const r = await fetch(base + path + (method === 'GET' ? '?' + new URLSearchParams(params) : ''), method === 'GET' ? {} : { method, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };
  const stud = (await owner('GET', `/gyms/${gid}/members/${studentId}`)).body.member;

  // A finger the device matched to the student: in, and the arm turns.
  let a = await device('/new_user_identified.fcgi', { device_id: '0M0100/001', user_id: String(stud.access_id), portal_id: '1', event: '7' });
  assert.equal(a.status, 200);
  assert.equal(a.body.result.event, 7);
  assert.deepEqual(a.body.result.actions, [{ action: 'catra', parameters: 'allow=clockwise' }]);
  // An unknown device gets nothing opened.
  a = await device('/new_user_identified.fcgi', { device_id: 'stranger', user_id: String(stud.access_id) });
  assert.equal(a.body.result.event, 3);
  // A finger nobody matched.
  a = await device('/new_user_identified.fcgi', { device_id: '0M0100/001', user_id: '0' });
  assert.equal(a.body.result.event, 3);

  // A fee 30 days overdue blocks the student at the turnstile.
  const old = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  await owner('POST', `/gyms/${gid}/charges`, { memberId: studentId, description: 'Mensal', amountCents: 9990, dueDate: old });
  a = await device('/new_user_identified.fcgi', { device_id: '0M0100/001', user_id: String(stud.access_id) });
  assert.equal(a.body.result.event, 6);
  assert.equal(a.body.result.message, 'Mensalidade em atraso');
  // Same answer at the reception.
  assert.equal((await owner('POST', `/gyms/${gid}/access/checkin`, { memberId: studentId })).body.allow, false);

  // Enrollment and release go out through the push queue, one command per poll.
  assert.equal((await owner('POST', `/gyms/${gid}/members/${studentId}/enroll`, { deviceId: did })).status, 200);
  await owner('POST', `/gyms/${gid}/access/devices/${did}/release`, { memberId: studentId, reason: 'Liberado pela recepção' });
  let p = await device('/push', { deviceId: '0M0100/001', uuid: 'x' }, 'GET');
  assert.equal(p.body.endpoint, 'create_objects');
  assert.deepEqual(p.body.body.values[0], { id: stud.access_id, name: 'Ana', registration: '' });
  await device('/result', { deviceId: '0M0100/001' });
  p = await device('/push', { deviceId: '0M0100/001' }, 'GET');
  assert.deepEqual(p.body.body, { type: 'biometry', save: true, user_id: stud.access_id, sync: false });
  await device('/result', { deviceId: '0M0100/001' });
  p = await device('/push', { deviceId: '0M0100/001' }, 'GET');
  assert.equal(p.body.endpoint, 'execute_actions');
  await device('/result', { deviceId: '0M0100/001' });
  assert.equal((await device('/push', { deviceId: '0M0100/001' }, 'GET')).body, null, 'an empty answer when nothing is queued');
  const cmds = await owner('GET', `/gyms/${gid}/access/devices/${did}/commands`);
  assert.deepEqual(cmds.body.commands.map(c => c.status), ['done', 'done', 'done']);

  const logs = await owner('GET', `/gyms/${gid}/access/logs`);
  assert.ok(logs.body.logs.length >= 4);
  assert.equal(logs.body.today.present, 1);
  const devs = await owner('GET', `/gyms/${gid}/access/devices`);
  assert.equal(devs.body.devices[0].online, true);

  // Generic bridge for other brands: a token, shown once.
  const gen = await owner('POST', `/gyms/${gid}/access/devices`, { name: 'Henry recepção', kind: 'generic' });
  assert.ok(gen.body.token);
  const check = (token, body) => fetch(base + '/api/saas/access/check', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
  assert.equal((await check('wrong', { identifier: '1' })).status, 401);
  const coachRow = (await owner('GET', `/gyms/${gid}/members?role=staff`)).body.members.find(m => m.role === 'trainer');
  const ok = await (await check(gen.body.token, { identifier: String(coachRow.access_id) })).json();
  assert.equal(ok.allow, true);
  // Trainers cannot add devices.
  assert.equal((await h.as('coach')('POST', `/gyms/${gid}/access/devices`, { name: 'x', kind: 'generic' })).status, 403);
  assert.equal(h.stackFrames(), 0, h.log);
});
