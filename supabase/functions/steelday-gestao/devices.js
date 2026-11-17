// The paths a Control iD device calls on its own: /new_user_identified.fcgi, /new_card.fcgi,
// /new_user_id_and_password.fcgi, /device_is_alive.fcgi, GET /push, POST /result. A device is
// given a host and port only, so the web front (vercel.json) rewrites those root paths to this
// function. No session: the device is recognised by its serial number (device_id), registered in
// the panel, and optionally by the address it calls from. Parameters arrive in the query string
// or as a form or JSON body.
import { checkAccess, findMember } from './access.js';
import { controlIdAnswer } from './access-rules.js';

const MAX = 64 * 1024;
const peerIp = req => String(req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for') || '').split(',')[0].trim().slice(0, 45);

async function readParams(req, url) {
  const out = Object.fromEntries(url.searchParams);
  if (req.method === 'GET') return out;
  const buf = new Uint8Array(await req.arrayBuffer());
  if (!buf.length || buf.length > MAX) return out;
  const text = new TextDecoder().decode(buf).trim();
  try { const j = JSON.parse(text); if (j && typeof j === 'object' && !Array.isArray(j)) return { ...out, ...j, _json: j }; } catch { /* not JSON */ }
  try { for (const [k, v] of new URLSearchParams(text)) out[k] = v; } catch { /* ignore */ }
  out._raw = text.slice(0, 4000);
  return out;
}

const PATHS = ['new_user_identified.fcgi', 'new_card.fcgi', 'new_user_id_and_password.fcgi', 'device_is_alive.fcgi', 'push', 'result'];
/** The device path a request is for (by its last segment), or null. */
export function devicePath(pathname) {
  const last = pathname.split('/').pop();
  return PATHS.includes(last) ? last : null;
}

export function createDeviceGateway({ sql }) {
  const send = (status, obj) => new Response(obj === undefined ? '' : JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  const deviceFor = async (p, req) => {
    const serial = String(p.device_id ?? p.deviceId ?? '').trim();
    if (!serial) return null;
    const [d] = await sql`select * from opengym.gym_devices where serial = ${serial} and kind = 'controlid' and active`;
    if (!d) return null;
    const ip = peerIp(req);
    if (d.allowed_ip && d.allowed_ip.split(',').map(s => s.trim()).filter(Boolean).every(a => a !== ip)) return null;
    await sql`update opengym.gym_devices set last_seen_at = now(), last_ip = ${ip || null} where id = ${d.id}`;
    return d;
  };
  const identify = method => async (req, url) => {
    const p = await readParams(req, url);
    const portalId = Number(p.portal_id) || 0;
    const d = await deviceFor(p, req);
    if (!d) return send(200, controlIdAnswer({ identified: false, reason: 'Equipamento não cadastrado', portalId }));
    const [gym] = await sql`select id, status, settings from opengym.gyms where id = ${d.gym_id}`;
    let member = null, ident = '';
    if (method === 'card') { ident = String(p.card_value ?? ''); member = ident ? await findMember(sql, gym.id, 'card', ident) : null; }
    else { ident = String(p.user_id ?? ''); member = ident && ident !== '0' ? await findMember(sql, gym.id, 'access_id', ident) : null; }
    if (!member && method !== 'card' && (!ident || ident === '0')) {
      await sql`insert into opengym.gym_access_logs (gym_id, device_id, method, allowed, reason) values (${gym.id}, ${d.id}, ${method}, false, 'Digital não reconhecida')`;
      return send(200, controlIdAnswer({ identified: false, reason: 'Não identificado', portalId }));
    }
    const r = await checkAccess(sql, { gym, member, device: d, identifier: ident, method });
    return send(200, controlIdAnswer({ allow: r.allow, member, reason: r.reason, releaseAction: d.release_action, portalId }));
  };
  const handlers = {
    'POST new_user_identified.fcgi': identify('fingerprint'),
    'POST new_card.fcgi': identify('card'),
    'POST new_user_id_and_password.fcgi': identify('pin'),
    'POST device_is_alive.fcgi': async (req, url) => { await deviceFor(await readParams(req, url), req); return send(200, {}); },
    'GET push': async (req, url) => {
      const d = await deviceFor(await readParams(req, url), req);
      if (!d) return send(200);
      // One command at a time: one sent and not answered within a minute goes again.
      const [c] = await sql`select * from opengym.gym_device_commands where device_id = ${d.id}
        and (status = 'queued' or (status = 'sent' and sent_at < now() - interval '1 minute')) order by created_at limit 1`;
      if (!c) return send(200);
      await sql`update opengym.gym_device_commands set status = 'sent', sent_at = now() where id = ${c.id}`;
      return send(200, { verb: c.verb, endpoint: c.endpoint, body: c.body, contentType: 'application/json', queryString: '' });
    },
    'POST result': async (req, url) => {
      const p = await readParams(req, url);
      const d = await deviceFor(p, req);
      if (d) {
        const [c] = await sql`select id from opengym.gym_device_commands where device_id = ${d.id} and status = 'sent' order by sent_at limit 1`;
        if (c) {
          const payload = p._json ?? (p._raw ? { raw: p._raw } : null);
          const failed = !!(payload && typeof payload === 'object' && (payload.error || payload.response?.error));
          await sql`update opengym.gym_device_commands set status = ${failed ? 'failed' : 'done'}, result = ${sql.json(payload)}, done_at = now() where id = ${c.id}`;
        }
      }
      return send(200, {});
    }
  };
  return { match: (method, path) => handlers[`${method} ${path}`] || null };
}
