// Turnstiles ("catracas"): devices, the access decision, the entry log and the command queue.
// Control iD devices talk to devices.js (online mode and push mode, formats from Control iD's
// official samples, github.com/controlid/integracao); any other brand goes through a bridge or
// the manufacturer's software calling POST /api/saas/access/check with the device token.
import { ADMIN, STAFF } from './roles.js';
import { str, oneOf, bad, notFound, SaasError, id as uuid } from './util.js';
import { todayDate } from './calc.js';
import { decideAccess, accessSettings, RELEASE_ACTIONS } from './access-rules.js';

const KINDS = ['controlid', 'generic'];
export async function sha(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
  return Array.from(new Uint8Array(d), b => b.toString(16).padStart(2, '0')).join('');
}
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Decide and log one identification at a device (or at the reception, device null). */
export async function checkAccess(sql, { gym, member, device = null, identifier = '', method = 'fingerprint', byUser = null }) {
  let oldestOpenDue = null, hasPlan = false;
  if (member) {
    const [r] = await sql`select min(due_date) as d from opengym.gym_charges where member_id = ${member.id} and status = 'open'`;
    oldestOpenDue = r.d || null;
    hasPlan = (await sql`select 1 from opengym.gym_subscriptions where member_id = ${member.id} and status = 'active' limit 1`).length > 0;
  }
  const decision = decideAccess({ gym, member, oldestOpenDue, hasPlan, today: todayDate(), settings: accessSettings(gym.settings || {}) });
  await sql`insert into opengym.gym_access_logs (gym_id, device_id, member_id, identifier, method, allowed, reason, by_user)
    values (${gym.id}, ${device?.id || null}, ${member?.id || null}, ${String(identifier).slice(0, 64)}, ${method}, ${decision.allow}, ${decision.reason}, ${byUser})`;
  return decision;
}

export async function queueCommand(sql, { device, purpose, endpoint, body = {}, memberId = null }) {
  await sql`insert into opengym.gym_device_commands (gym_id, device_id, purpose, member_id, endpoint, body)
    values (${device.gym_id}, ${device.id}, ${purpose}, ${memberId}, ${endpoint}, ${sql.json(body)})`;
}

const deviceUser = m => ({ id: m.access_id, name: String(m.name || '').slice(0, 60), registration: '' });

export async function findMember(sql, gymId, by, ident) {
  if (by === 'card') return (await sql`select * from opengym.gym_members where gym_id = ${gymId} and card_number = ${String(ident).replace(/\D/g, '')}`)[0] || null;
  if (by === 'cpf') {
    const digits = String(ident).replace(/\D/g, '');
    return (await sql`select * from opengym.gym_members where gym_id = ${gymId} and regexp_replace(document, '\\D', '', 'g') = ${digits}`)[0] || null;
  }
  const n = Number(ident);
  return Number.isInteger(n) && n > 0 && n < 2 ** 31 ? (await sql`select * from opengym.gym_members where gym_id = ${gymId} and access_id = ${n}`)[0] || null : null;
}

export function registerAccess(route, { sql, audit, rand }) {
  const getDevice = async (gymId, did) => {
    uuid(did, 'equipamento');
    const [d] = await sql`select * from opengym.gym_devices where id = ${did} and gym_id = ${gymId}`;
    if (!d) throw notFound('equipamento');
    return d;
  };
  const view = async d => {
    const { token_hash, ...rest } = d;
    const [p] = await sql`select count(*)::int n from opengym.gym_device_commands where device_id = ${d.id} and status in ('queued','sent')`;
    const online = d.last_seen_at && Date.now() - new Date(d.last_seen_at).getTime() < 2 * 60 * 1000;
    return { ...rest, hasToken: !!token_hash, pendingCommands: p.n, online: !!online };
  };

  route('GET', '/gyms/:gymId/access/devices', STAFF, async ctx => ({
    devices: await Promise.all((await sql`select * from opengym.gym_devices where gym_id = ${ctx.gym.id} order by active desc, name`).map(view)),
    releaseActions: Object.keys(RELEASE_ACTIONS)
  }));

  route('POST', '/gyms/:gymId/access/devices', ADMIN, async ctx => {
    const b = await ctx.body();
    const kind = oneOf(b.kind, 'tipo', KINDS);
    const serial = kind === 'controlid' ? str(b.serial, 'número de série', { max: 64 }) : null;
    const token = kind === 'generic' ? b64url(rand(24)) : null;
    const [d] = await sql`insert into opengym.gym_devices (gym_id, name, kind, serial, token_hash, release_action, allowed_ip)
      values (${ctx.gym.id}, ${str(b.name, 'nome', { max: 80 })}, ${kind}, ${serial}, ${token ? await sha(token) : null},
        ${oneOf(b.releaseAction, 'liberação', Object.keys(RELEASE_ACTIONS), { opt: true, def: 'catra_clockwise' })}, ${str(b.allowedIp, 'IP permitido', { opt: true, max: 64 })})
      returning *`;
    await audit(ctx, 'access.device.create', { deviceId: d.id, kind });
    return { __status: 201, body: { device: await view(d), token } };
  });

  route('PUT', '/gyms/:gymId/access/devices/:deviceId', ADMIN, async ctx => {
    const d = await getDevice(ctx.gym.id, ctx.params.deviceId);
    const b = await ctx.body();
    const [out] = await sql`update opengym.gym_devices set
      name = ${b.name !== undefined ? str(b.name, 'nome', { max: 80 }) : d.name},
      serial = ${d.kind === 'controlid' && b.serial !== undefined ? str(b.serial, 'número de série', { max: 64 }) : d.serial},
      release_action = ${b.releaseAction !== undefined ? oneOf(b.releaseAction, 'liberação', Object.keys(RELEASE_ACTIONS)) : d.release_action},
      allowed_ip = ${b.allowedIp !== undefined ? str(b.allowedIp, 'IP permitido', { opt: true, max: 64 }) : d.allowed_ip},
      active = ${b.active !== undefined ? !!b.active : d.active}
      where id = ${d.id} returning *`;
    return { device: await view(out) };
  });

  route('POST', '/gyms/:gymId/access/devices/:deviceId/token', ADMIN, async ctx => {
    const d = await getDevice(ctx.gym.id, ctx.params.deviceId);
    if (d.kind !== 'generic') throw bad('só integrações genéricas usam token');
    const token = b64url(rand(24));
    await sql`update opengym.gym_devices set token_hash = ${await sha(token)} where id = ${d.id}`;
    await audit(ctx, 'access.device.token', { deviceId: d.id });
    return { token };
  });

  route('POST', '/gyms/:gymId/access/devices/:deviceId/release', STAFF, async ctx => {
    const d = await getDevice(ctx.gym.id, ctx.params.deviceId);
    if (d.kind !== 'controlid') throw bad('a liberação remota é para equipamentos Control iD');
    const b = await ctx.body();
    let member = null;
    if (b.memberId) { uuid(b.memberId, 'pessoa'); [member] = await sql`select * from opengym.gym_members where id = ${b.memberId} and gym_id = ${ctx.gym.id}`; }
    await sql.begin(async tx => {
      await queueCommand(tx, { device: d, purpose: 'release', endpoint: 'execute_actions', body: { actions: [RELEASE_ACTIONS[d.release_action] || RELEASE_ACTIONS.catra_clockwise] }, memberId: member?.id || null });
      await tx`insert into opengym.gym_access_logs (gym_id, device_id, member_id, method, allowed, reason, by_user)
        values (${ctx.gym.id}, ${d.id}, ${member?.id || null}, 'manual', true, ${str(b.reason || 'Liberação manual', 'motivo', { max: 120 })}, ${ctx.user.id})`;
    });
    await audit(ctx, 'access.release', { deviceId: d.id, memberId: member?.id || null });
    return { ok: true, note: 'A catraca libera na próxima consulta do equipamento (alguns segundos).' };
  });

  route('POST', '/gyms/:gymId/access/devices/:deviceId/sync', ADMIN, async ctx => {
    const d = await getDevice(ctx.gym.id, ctx.params.deviceId);
    if (d.kind !== 'controlid') throw bad('a sincronização é para equipamentos Control iD');
    const people = await sql`select * from opengym.gym_members where gym_id = ${ctx.gym.id} and status = 'active' and access_id is not null order by access_id`;
    let batches = 0;
    await sql.begin(async tx => {
      for (let i = 0; i < people.length; i += 50) {
        await queueCommand(tx, { device: d, purpose: 'sync_users', endpoint: 'create_objects', body: { object: 'users', values: people.slice(i, i + 50).map(deviceUser) } });
        batches++;
      }
    });
    return { people: people.length, batches };
  });

  route('POST', '/gyms/:gymId/members/:memberId/enroll', STAFF, async ctx => {
    const [m] = await sql`select * from opengym.gym_members where id = ${ctx.params.memberId} and gym_id = ${ctx.gym.id}`;
    if (!m) throw notFound('pessoa');
    const b = await ctx.body();
    const d = await getDevice(ctx.gym.id, b.deviceId);
    if (d.kind !== 'controlid') throw bad('o cadastro de digital remoto é para equipamentos Control iD');
    const type = oneOf(b.type || 'biometry', 'tipo', ['biometry', 'card', 'face']);
    await sql.begin(async tx => {
      await queueCommand(tx, { device: d, purpose: 'sync_users', endpoint: 'create_objects', body: { object: 'users', values: [deviceUser(m)] }, memberId: m.id });
      await queueCommand(tx, { device: d, purpose: 'enroll_' + type, endpoint: 'remote_enroll', body: { type, save: true, user_id: m.access_id, sync: false }, memberId: m.id });
    });
    await audit(ctx, 'access.enroll', { memberId: m.id, deviceId: d.id, type });
    return { ok: true, accessId: m.access_id, note: `Peça para ${m.name.split(' ')[0]} ir ao equipamento "${d.name}" e seguir as instruções da tela.` };
  });

  route('PUT', '/gyms/:gymId/members/:memberId/card', STAFF, async ctx => {
    const b = await ctx.body();
    const card = str(b.cardNumber, 'cartão', { opt: true, max: 32 }).replace(/\D/g, '');
    const r = await sql`update opengym.gym_members set card_number = ${card || null} where id = ${ctx.params.memberId} and gym_id = ${ctx.gym.id} returning id`;
    if (!r.length) throw notFound('pessoa');
    return { ok: true, cardNumber: card || null };
  });

  route('POST', '/gyms/:gymId/access/checkin', STAFF, async ctx => {
    const b = await ctx.body();
    uuid(b.memberId, 'pessoa');
    const [m] = await sql`select * from opengym.gym_members where id = ${b.memberId} and gym_id = ${ctx.gym.id}`;
    if (!m) throw notFound('pessoa');
    const d = await checkAccess(sql, { gym: ctx.gym, member: m, method: 'manual', byUser: ctx.user.id });
    return { ...d, member: { id: m.id, name: m.name } };
  });

  route('GET', '/gyms/:gymId/access/logs', STAFF, async ctx => {
    const day = ctx.query.get('date') || new Date().toISOString().slice(0, 10);
    const mid = ctx.query.get('memberId');
    if (mid) uuid(mid, 'pessoa');
    const logs = await sql`select l.*, m.name as member_name, d.name as device_name from opengym.gym_access_logs l
      left join opengym.gym_members m on m.id = l.member_id left join opengym.gym_devices d on d.id = l.device_id
      where l.gym_id = ${ctx.gym.id} ${mid ? sql`and l.member_id = ${mid}` : sql`and to_char(l.at at time zone 'UTC', 'YYYY-MM-DD') = ${day}`}
      order by l.at desc limit 500`;
    const today = new Date().toISOString().slice(0, 10);
    const [t] = await sql`select count(distinct member_id) filter (where allowed)::int as present, count(*) filter (where not allowed)::int as denied
      from opengym.gym_access_logs where gym_id = ${ctx.gym.id} and to_char(at at time zone 'UTC', 'YYYY-MM-DD') = ${today}`;
    return { logs, today: t };
  });

  route('GET', '/gyms/:gymId/access/devices/:deviceId/commands', ADMIN, async ctx => {
    const d = await getDevice(ctx.gym.id, ctx.params.deviceId);
    return { commands: await sql`select c.id, c.purpose, c.endpoint, c.status, c.created_at, c.sent_at, c.done_at, c.result, m.name as member_name
      from opengym.gym_device_commands c left join opengym.gym_members m on m.id = c.member_id where c.device_id = ${d.id} order by c.created_at desc limit 100` };
  });
  route('POST', '/gyms/:gymId/access/devices/:deviceId/commands/clear', ADMIN, async ctx => {
    const d = await getDevice(ctx.gym.id, ctx.params.deviceId);
    const r = await sql`update opengym.gym_device_commands set status = 'canceled' where device_id = ${d.id} and status in ('queued','sent') returning id`;
    return { canceled: r.length };
  });

  // Generic integration: a bridge or the manufacturer's software asks with the device token.
  route('POST', '/access/check', 'public', async ctx => {
    const auth = ctx.req.headers.get('authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!token) throw new SaasError(401, 'token do equipamento ausente');
    const [d] = await sql`select * from opengym.gym_devices where token_hash = ${await sha(token)} and kind = 'generic'`;
    if (!d || !d.active) throw new SaasError(401, 'token inválido');
    const [gym] = await sql`select id, status, settings from opengym.gyms where id = ${d.gym_id}`;
    const b = await ctx.body();
    const by = oneOf(b.method || 'access_id', 'método', ['access_id', 'card', 'cpf']);
    const ident = str(b.identifier, 'identificador', { max: 64 });
    const m = await findMember(sql, gym.id, by, ident);
    await sql`update opengym.gym_devices set last_seen_at = now(), last_ip = ${(ctx.req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null} where id = ${d.id}`;
    const r = await checkAccess(sql, { gym, member: m, device: d, identifier: ident, method: by === 'access_id' ? 'fingerprint' : by });
    return { allow: r.allow, message: r.allow && m ? `Bem-vindo, ${m.name.split(' ')[0]}!` : r.reason, name: m?.name || null, accessId: m?.access_id || null };
  });
}
