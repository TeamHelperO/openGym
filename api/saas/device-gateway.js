/* The paths a Control iD device calls on its own, at the root of the server (the device is given
 * host and port only, no path): /new_user_identified.fcgi, /new_card.fcgi, /device_is_alive.fcgi,
 * GET /push, POST /result. No session and no Origin: the device is recognised by its serial number
 * (device_id), registered in the panel, and optionally by the address it calls from.
 *
 * Parameters arrive in the query string or as a form or JSON body (Control iD's samples read them
 * as request parameters), so this reads all three. */
import { newId, nowIso } from './db.js';
import { checkAccess, findMember } from './access.js';
import { controlIdAnswer } from './access-rules.js';

const MAX = 64 * 1024;

function readParams(req, url) {
  return new Promise(resolve => {
    const out = Object.fromEntries(url.searchParams);
    if (req.method === 'GET') return resolve(out);
    const chunks = []; let size = 0, done = false;
    const finish = () => {
      if (done) return; done = true;
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (text) {
        try { const j = JSON.parse(text); if (j && typeof j === 'object' && !Array.isArray(j)) return resolve({ ...out, ...j, _json: j }); } catch { /* not JSON */ }
        try { for (const [k, v] of new URLSearchParams(text)) out[k] = v; } catch { /* ignore */ }
        out._raw = text.slice(0, 4000);
      }
      resolve(out);
    };
    req.on('data', d => { size += d.length; if (size > MAX) { req.destroy(); finish(); } else chunks.push(d); });
    req.on('end', finish);
    req.on('error', finish);
  });
}

// The address a device calls from, in full (the audit log's clientIp masks it by default). Behind
// the bundled web container the proxy's header is the device; a direct call has only the socket.
const peerIp = req => (String(req.headers['x-real-ip'] || '').trim()
  || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  || String(req.socket?.remoteAddress || '')).replace(/^::ffff:/, '').slice(0, 45);

export function createDeviceGateway({ db }) {
  const send = (res, code, obj) => {
    const body = obj === undefined ? '' : JSON.stringify(obj);
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(body);
  };
  const deviceFor = (params, req) => {
    const serial = String(params.device_id ?? params.deviceId ?? '').trim();
    if (!serial) return null;
    const d = db().prepare("SELECT * FROM access_devices WHERE serial = ? AND kind = 'controlid' AND active = 1").get(serial);
    if (!d) return null;
    const ip = peerIp(req);
    if (d.allowed_ip && d.allowed_ip.split(',').map(s => s.trim()).filter(Boolean).every(a => a !== ip)) return null;
    db().prepare('UPDATE access_devices SET last_seen_at = ?, last_ip = ? WHERE id = ?').run(nowIso(), ip, d.id);
    return d;
  };

  const identify = (method) => async (req, res, url) => {
    const p = await readParams(req, url);
    const portalId = Number(p.portal_id) || 0;
    const d = deviceFor(p, req);
    if (!d) return send(res, 200, controlIdAnswer({ identified: false, reason: 'Equipamento não cadastrado', portalId }));
    const gym = db().prepare('SELECT * FROM gyms WHERE id = ?').get(d.gym_id);
    let member = null, ident = '';
    if (method === 'card') { ident = String(p.card_value ?? ''); member = ident ? findMember(db(), gym.id, 'card', ident) : null; }
    else { ident = String(p.user_id ?? ''); member = ident && ident !== '0' ? findMember(db(), gym.id, 'access_id', ident) : null; }
    if (!member && method !== 'card' && (!ident || ident === '0')) {
      // The device found no matching finger: not an identification at all.
      db().prepare("INSERT INTO access_logs (id, gym_id, device_id, identifier, method, allowed, reason, at) VALUES (?, ?, ?, '', ?, 0, 'Digital não reconhecida', ?)").run(newId(), gym.id, d.id, method, nowIso());
      return send(res, 200, controlIdAnswer({ identified: false, reason: 'Não identificado', portalId }));
    }
    const r = checkAccess(db(), { gym, member, device: d, identifier: ident, method });
    send(res, 200, controlIdAnswer({ allow: r.allow, member, reason: r.reason, releaseAction: d.release_action, portalId }));
  };

  const routes = {
    'POST /new_user_identified.fcgi': identify('fingerprint'),
    'POST /new_card.fcgi': identify('card'),
    // ID + password typed on the keypad: the password is the device's to check; the server only
    // sees the id, so it answers as for a fingerprint of that id.
    'POST /new_user_id_and_password.fcgi': identify('pin'),
    'POST /device_is_alive.fcgi': async (req, res, url) => { deviceFor(await readParams(req, url), req); send(res, 200, {}); },
    'GET /push': async (req, res, url) => {
      const p = await readParams(req, url);
      const d = deviceFor(p, req);
      if (!d) return send(res, 200);
      // One command at a time: a command already sent and not answered within a minute goes again.
      const stale = new Date(Date.now() - 60000).toISOString();
      const c = db().prepare(`SELECT * FROM device_commands WHERE device_id = ? AND (status = 'queued' OR (status = 'sent' AND sent_at < ?))
        ORDER BY created_at LIMIT 1`).get(d.id, stale);
      if (!c) return send(res, 200);
      db().prepare("UPDATE device_commands SET status = 'sent', sent_at = ? WHERE id = ?").run(nowIso(), c.id);
      send(res, 200, { verb: c.verb, endpoint: c.endpoint, body: JSON.parse(c.body_json), contentType: 'application/json', queryString: '' });
    },
    'POST /result': async (req, res, url) => {
      const p = await readParams(req, url);
      const d = deviceFor(p, req);
      if (d) {
        const c = db().prepare("SELECT id FROM device_commands WHERE device_id = ? AND status = 'sent' ORDER BY sent_at LIMIT 1").get(d.id);
        if (c) {
          const payload = p._json ?? p._raw ?? null;
          const failed = !!(payload && typeof payload === 'object' && (payload.error || payload.response?.error));
          db().prepare('UPDATE device_commands SET status = ?, result_json = ?, done_at = ? WHERE id = ?')
            .run(failed ? 'failed' : 'done', JSON.stringify(payload).slice(0, 4000), nowIso(), c.id);
        }
      }
      send(res, 200, {});
    }
  };

  /** A handler for a device path, or null. */
  return {
    match(method, pathname) { const h = routes[`${method} ${pathname}`]; return h || null; },
    paths: () => Object.keys(routes)
  };
}
