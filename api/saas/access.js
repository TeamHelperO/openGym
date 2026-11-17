/* Turnstiles ("catracas"): devices, the access decision, the entry log and the command queue.
 *
 * Two ways a device talks to the platform:
 *
 * Control iD (iDBlock, iDAccess, iDFlex, iDFace...), the most common biometric turnstiles in Brazil:
 *   - online mode (Pro): the device matches the fingerprint itself and POSTs the user it found to
 *     <server>/new_user_identified.fcgi; the answer says whether to turn the arm (event 7 + a
 *     "catra" action) or not (event 6). The device's "user id" is the person's access_id here.
 *   - push mode: the device polls GET <server>/push and runs what it gets (create the person,
 *     enroll a finger remotely, release the arm), then POSTs the outcome to <server>/result. That
 *     is how a cloud server reaches a device behind the academy's router.
 *   Formats from Control iD's official samples (github.com/controlid/integracao).
 *
 * Generic: any other brand (Henry, Topdata, Intelbras, Hikvision...) through the manufacturer's
 *   software or a small bridge at the academy, which asks POST /api/saas/access/check with the
 *   device's token and gets { allow, message }.
 */
import crypto from 'node:crypto';
import { ADMIN, STAFF } from './roles.js';
import { newId, nowIso, tx } from './db.js';
import { str, oneOf, bad, notFound, SaasError } from './util.js';
import { todayDate } from './calc.js';
import { decideAccess, accessSettings, controlIdAnswer, RELEASE_ACTIONS } from './access-rules.js';

const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const KINDS = ['controlid', 'generic'];

/** Decide and log one identification at a device (or at the reception, device null). */
export function checkAccess(db, { gym, member, device = null, identifier = '', method = 'fingerprint', byUser = null }) {
  let settings = {};
  try { settings = JSON.parse(gym.settings_json || '{}'); } catch { /* defaults */ }
  let oldestOpenDue = null, hasPlan = false;
  if (member) {
    oldestOpenDue = db.prepare("SELECT MIN(due_date) AS d FROM charges WHERE member_id = ? AND status = 'open'").get(member.id).d || null;
    hasPlan = !!db.prepare("SELECT 1 FROM subscriptions WHERE member_id = ? AND status = 'active'").get(member.id);
  }
  const decision = decideAccess({ gym, member, oldestOpenDue, hasPlan, today: todayDate(), settings: accessSettings(settings) });
  db.prepare('INSERT INTO access_logs (id, gym_id, device_id, member_id, identifier, method, allowed, reason, by_user, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(newId(), gym.id, device?.id || null, member?.id || null, String(identifier).slice(0, 64), method, decision.allow ? 1 : 0, decision.reason, byUser, nowIso());
  return decision;
}

export function queueCommand(db, { device, purpose, endpoint, body = {}, memberId = null }) {
  const id = newId();
  db.prepare('INSERT INTO device_commands (id, gym_id, device_id, purpose, member_id, endpoint, body_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, device.gym_id, device.id, purpose, memberId, endpoint, JSON.stringify(body), nowIso());
  return id;
}

const deviceUser = m => ({ id: m.access_id, name: String(m.name || '').slice(0, 60), registration: '' });

/** Panel routes: devices, releases, enrollment, the entry log. */
export function registerAccess(route, { db, audit, rand }) {
  const getDevice = (gymId, id) => {
    const d = db().prepare('SELECT * FROM access_devices WHERE id = ? AND gym_id = ?').get(id, gymId);
    if (!d) throw notFound('equipamento');
    return d;
  };
  const view = d => {
    const { token_hash, ...rest } = d;
    const pending = db().prepare("SELECT COUNT(*) AS n FROM device_commands WHERE device_id = ? AND status IN ('queued','sent')").get(d.id).n;
    const online = d.last_seen_at && Date.now() - Date.parse(d.last_seen_at) < 2 * 60 * 1000;
    return { ...rest, hasToken: !!token_hash, pendingCommands: pending, online: !!online };
  };

  route('GET', '/gyms/:gymId/access/devices', STAFF, ctx => ({
    devices: db().prepare('SELECT * FROM access_devices WHERE gym_id = ? ORDER BY active DESC, name').all(ctx.gym.id).map(view),
    releaseActions: Object.keys(RELEASE_ACTIONS)
  }));

  route('POST', '/gyms/:gymId/access/devices', ADMIN, async ctx => {
    const b = await ctx.body();
    const kind = oneOf(b.kind, 'tipo', KINDS);
    const serial = kind === 'controlid' ? str(b.serial, 'número de série', { max: 64 }) : null;
    let token = null;
    if (kind === 'generic') token = rand(24).toString('base64url');
    const id = newId();
    db().prepare('INSERT INTO access_devices (id, gym_id, name, kind, serial, token_hash, release_action, allowed_ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      id, ctx.gym.id, str(b.name, 'nome', { max: 80 }), kind, serial, token ? sha(token) : null,
      oneOf(b.releaseAction, 'liberação', Object.keys(RELEASE_ACTIONS), { opt: true, def: 'catra_clockwise' }),
      str(b.allowedIp, 'IP permitido', { opt: true, max: 64 }), nowIso());
    audit(ctx, 'access.device.create', { deviceId: id, kind });
    // The token is shown once: only its hash is kept.
    return { __status: 201, body: { device: view(getDevice(ctx.gym.id, id)), token } };
  });

  route('PUT', '/gyms/:gymId/access/devices/:deviceId', ADMIN, async ctx => {
    const d = getDevice(ctx.gym.id, ctx.params.deviceId);
    const b = await ctx.body();
    db().prepare('UPDATE access_devices SET name = ?, serial = ?, release_action = ?, allowed_ip = ?, active = ? WHERE id = ?').run(
      b.name !== undefined ? str(b.name, 'nome', { max: 80 }) : d.name,
      d.kind === 'controlid' && b.serial !== undefined ? str(b.serial, 'número de série', { max: 64 }) : d.serial,
      b.releaseAction !== undefined ? oneOf(b.releaseAction, 'liberação', Object.keys(RELEASE_ACTIONS)) : d.release_action,
      b.allowedIp !== undefined ? str(b.allowedIp, 'IP permitido', { opt: true, max: 64 }) : d.allowed_ip,
      b.active !== undefined ? (b.active ? 1 : 0) : d.active, d.id);
    return { device: view(getDevice(ctx.gym.id, d.id)) };
  });

  route('POST', '/gyms/:gymId/access/devices/:deviceId/token', ADMIN, ctx => {
    const d = getDevice(ctx.gym.id, ctx.params.deviceId);
    if (d.kind !== 'generic') throw bad('só integrações genéricas usam token');
    const token = rand(24).toString('base64url');
    db().prepare('UPDATE access_devices SET token_hash = ? WHERE id = ?').run(sha(token), d.id);
    audit(ctx, 'access.device.token', { deviceId: d.id });
    return { token };
  });

  // Release the arm from the panel (reception), logged as a manual entry.
  route('POST', '/gyms/:gymId/access/devices/:deviceId/release', STAFF, async ctx => {
    const d = getDevice(ctx.gym.id, ctx.params.deviceId);
    if (d.kind !== 'controlid') throw bad('a liberação remota é para equipamentos Control iD');
    const b = await ctx.body();
    let member = null;
    if (b.memberId) member = db().prepare('SELECT * FROM memberships WHERE id = ? AND gym_id = ?').get(b.memberId, ctx.gym.id);
    tx(db(), () => {
      queueCommand(db(), { device: d, purpose: 'release', endpoint: 'execute_actions', body: { actions: [RELEASE_ACTIONS[d.release_action] || RELEASE_ACTIONS.catra_clockwise] }, memberId: member?.id || null });
      db().prepare("INSERT INTO access_logs (id, gym_id, device_id, member_id, identifier, method, allowed, reason, by_user, at) VALUES (?, ?, ?, ?, '', 'manual', 1, ?, ?, ?)")
        .run(newId(), ctx.gym.id, d.id, member?.id || null, str(b.reason || 'Liberação manual', 'motivo', { max: 120 }), ctx.user.id, nowIso());
    });
    audit(ctx, 'access.release', { deviceId: d.id, memberId: member?.id || null });
    return { ok: true, note: 'A catraca libera na próxima consulta do equipamento (alguns segundos).' };
  });

  // Put every active person on a device (id + name), so it can match their fingers.
  route('POST', '/gyms/:gymId/access/devices/:deviceId/sync', ADMIN, ctx => {
    const d = getDevice(ctx.gym.id, ctx.params.deviceId);
    if (d.kind !== 'controlid') throw bad('a sincronização é para equipamentos Control iD');
    const people = db().prepare("SELECT * FROM memberships WHERE gym_id = ? AND status = 'active' AND access_id IS NOT NULL ORDER BY access_id").all(ctx.gym.id);
    let batches = 0;
    tx(db(), () => {
      for (let i = 0; i < people.length; i += 50) {
        queueCommand(db(), { device: d, purpose: 'sync_users', endpoint: 'create_objects', body: { object: 'users', values: people.slice(i, i + 50).map(deviceUser) } });
        batches++;
      }
    });
    return { people: people.length, batches };
  });

  // Fingerprint enrollment: the device asks the person to put the finger on the sensor.
  route('POST', '/gyms/:gymId/members/:memberId/enroll', STAFF, async ctx => {
    const m = db().prepare('SELECT * FROM memberships WHERE id = ? AND gym_id = ?').get(ctx.params.memberId, ctx.gym.id);
    if (!m) throw notFound('pessoa');
    const b = await ctx.body();
    const d = getDevice(ctx.gym.id, b.deviceId);
    if (d.kind !== 'controlid') throw bad('o cadastro de digital remoto é para equipamentos Control iD');
    const type = oneOf(b.type || 'biometry', 'tipo', ['biometry', 'card', 'face']);
    tx(db(), () => {
      queueCommand(db(), { device: d, purpose: 'sync_users', endpoint: 'create_objects', body: { object: 'users', values: [deviceUser(m)] }, memberId: m.id });
      queueCommand(db(), { device: d, purpose: 'enroll_' + type, endpoint: 'remote_enroll', body: { type, save: true, user_id: m.access_id, sync: false }, memberId: m.id });
    });
    audit(ctx, 'access.enroll', { memberId: m.id, deviceId: d.id, type });
    return { ok: true, accessId: m.access_id, note: `Peça para ${m.name.split(' ')[0]} ir ao equipamento "${d.name}" e seguir as instruções da tela.` };
  });

  route('PUT', '/gyms/:gymId/members/:memberId/card', STAFF, async ctx => {
    const m = db().prepare('SELECT * FROM memberships WHERE id = ? AND gym_id = ?').get(ctx.params.memberId, ctx.gym.id);
    if (!m) throw notFound('pessoa');
    const b = await ctx.body();
    const card = str(b.cardNumber, 'cartão', { opt: true, max: 32 }).replace(/\D/g, '');
    db().prepare('UPDATE memberships SET card_number = ? WHERE id = ?').run(card || null, m.id);
    return { ok: true, cardNumber: card || null };
  });

  // Entry at the reception, without a turnstile: the same rules, logged the same way.
  route('POST', '/gyms/:gymId/access/checkin', STAFF, async ctx => {
    const b = await ctx.body();
    const m = db().prepare('SELECT * FROM memberships WHERE id = ? AND gym_id = ?').get(b.memberId, ctx.gym.id);
    if (!m) throw notFound('pessoa');
    const d = checkAccess(db(), { gym: ctx.gym, member: m, method: 'manual', byUser: ctx.user.id });
    return { ...d, member: { id: m.id, name: m.name } };
  });

  route('GET', '/gyms/:gymId/access/logs', STAFF, ctx => {
    const day = ctx.query.get('date') || new Date().toISOString().slice(0, 10);
    const mid = ctx.query.get('memberId');
    const rows = db().prepare(`SELECT l.*, m.name AS member_name, d.name AS device_name FROM access_logs l
      LEFT JOIN memberships m ON m.id = l.member_id LEFT JOIN access_devices d ON d.id = l.device_id
      WHERE l.gym_id = ? ${mid ? 'AND l.member_id = ?' : 'AND substr(l.at, 1, 10) = ?'} ORDER BY l.at DESC LIMIT 500`).all(ctx.gym.id, mid || day);
    const today = new Date().toISOString().slice(0, 10);
    const present = db().prepare("SELECT COUNT(DISTINCT member_id) AS n FROM access_logs WHERE gym_id = ? AND allowed = 1 AND substr(at, 1, 10) = ?").get(ctx.gym.id, today).n;
    const denied = db().prepare("SELECT COUNT(*) AS n FROM access_logs WHERE gym_id = ? AND allowed = 0 AND substr(at, 1, 10) = ?").get(ctx.gym.id, today).n;
    return { logs: rows, today: { present, denied } };
  });

  route('GET', '/gyms/:gymId/access/devices/:deviceId/commands', ADMIN, ctx => {
    const d = getDevice(ctx.gym.id, ctx.params.deviceId);
    return { commands: db().prepare('SELECT c.id, c.purpose, c.endpoint, c.status, c.created_at, c.sent_at, c.done_at, c.result_json, m.name AS member_name FROM device_commands c LEFT JOIN memberships m ON m.id = c.member_id WHERE c.device_id = ? ORDER BY c.created_at DESC LIMIT 100').all(d.id) };
  });
  route('POST', '/gyms/:gymId/access/devices/:deviceId/commands/clear', ADMIN, ctx => {
    const d = getDevice(ctx.gym.id, ctx.params.deviceId);
    const r = db().prepare("UPDATE device_commands SET status = 'canceled' WHERE device_id = ? AND status IN ('queued','sent')").run(d.id);
    return { canceled: r.changes };
  });

  // Generic integration: a bridge or the manufacturer's software asks with the device token.
  route('POST', '/access/check', 'public', async ctx => {
    const auth = ctx.req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!token) throw new SaasError(401, 'token do equipamento ausente');
    const d = db().prepare("SELECT * FROM access_devices WHERE token_hash = ? AND kind = 'generic'").get(sha(token));
    if (!d || !d.active) throw new SaasError(401, 'token inválido');
    const gym = db().prepare('SELECT * FROM gyms WHERE id = ?').get(d.gym_id);
    const b = await ctx.body();
    const by = oneOf(b.method || 'access_id', 'método', ['access_id', 'card', 'cpf']);
    const ident = str(b.identifier, 'identificador', { max: 64 });
    const m = findMember(db(), gym.id, by, ident);
    db().prepare('UPDATE access_devices SET last_seen_at = ?, last_ip = ? WHERE id = ?').run(nowIso(), ctx.req.socket?.remoteAddress || null, d.id);
    const r = checkAccess(db(), { gym, member: m, device: d, identifier: ident, method: by === 'access_id' ? 'fingerprint' : by });
    return { allow: r.allow, message: r.allow && m ? `Bem-vindo, ${m.name.split(' ')[0]}!` : r.reason, name: m?.name || null, accessId: m?.access_id || null };
  });
}

export function findMember(db, gymId, by, ident) {
  if (by === 'card') return db.prepare('SELECT * FROM memberships WHERE gym_id = ? AND card_number = ?').get(gymId, String(ident).replace(/\D/g, '')) || null;
  if (by === 'cpf') {
    const digits = String(ident).replace(/\D/g, '');
    return db.prepare("SELECT * FROM memberships WHERE gym_id = ? AND replace(replace(replace(document, '.', ''), '-', ''), ' ', '') = ?").get(gymId, digits) || null;
  }
  const n = Number(ident);
  return Number.isInteger(n) ? db.prepare('SELECT * FROM memberships WHERE gym_id = ? AND access_id = ?').get(gymId, n) || null : null;
}
