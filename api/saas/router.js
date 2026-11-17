/* The SaaS surface (/api/saas/*): academies, their people, training, finance, supplies and shop.
 *
 * Mounted by server.js the way coach/routes.js is: a factory handed the server's own helpers
 * (session, body, json), so this module has no import cycle and the tests can drive it with fakes.
 * Unlike the main route table, these paths carry parameters (/gyms/:gymId/...), so the factory
 * returns a matcher rather than a flat object.
 *
 * Every route declares who may call it:
 *   'public'    anyone
 *   'user'      any signed-in profile
 *   'platform'  an admin of the instance (the existing isAdmin), who runs the platform
 *   [roles]     a member of the academy in :gymId holding one of the roles. A platform admin
 *               passes as gym_admin, so support can always get in.
 */
import crypto from 'node:crypto';
import { openDb, newId, nowIso } from './db.js';
import { SaasError, forbidden, notFound } from './util.js';
import { registerGyms } from './gyms.js';
import { registerMembers } from './members.js';
import { registerTraining } from './training.js';
import { registerFinance } from './finance.js';
import { registerSupplies } from './supplies.js';
import { registerPos } from './pos.js';
import { registerPlatform } from './platform.js';
import { registerAccess } from './access.js';

import { saasConfig } from './roles.js';
export { ROLES, STAFF, ADMIN, saasConfig } from './roles.js';

export function createSaas(deps) {
  const { json, readBody, readSession, isAdmin, dataDir } = deps;
  const table = [];
  const db = () => openDb(dataDir);

  const route = (method, pattern, access, fn) => {
    const names = [];
    const rx = new RegExp('^/api/saas' + pattern.replace(/:([a-zA-Z]+)/g, (_, n) => { names.push(n); return '([A-Za-z0-9_-]{1,64})'; }) + '$');
    table.push({ method, pattern, rx, names, access, fn });
  };

  const audit = (ctx, action, detail = {}) => {
    try {
      db().prepare('INSERT INTO audit_log (id, gym_id, user_id, action, detail_json, at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(newId(), ctx.gym?.id || detail.gymId || null, ctx.user?.id || null, action, JSON.stringify(detail), nowIso());
    } catch (e) { console.error('saas audit failed', e.message); }
  };

  const shared = {
    ...deps, db, audit, newId, nowIso,
    rand: n => crypto.randomBytes(n),
    userById: id => deps.users().find(u => u.id === id) || null
  };

  registerGyms(route, shared);
  registerMembers(route, shared);
  registerTraining(route, shared);
  registerFinance(route, shared);
  registerSupplies(route, shared);
  registerPos(route, shared);
  registerPlatform(route, shared);
  registerAccess(route, shared);

  async function run(entry, params, req, res, url) {
    const ctx = { req, res, params, query: url.searchParams, user: null, gym: null, member: null, role: null, platformAdmin: false };
    if (entry.access !== 'public') {
      const user = readSession(req);
      if (!user) return json(res, 401, { error: 'not signed in' });
      ctx.user = user;
      ctx.platformAdmin = isAdmin(user);
      if (entry.access === 'platform' && !ctx.platformAdmin) return json(res, 403, { error: 'apenas administradores da plataforma' });
      if (Array.isArray(entry.access)) {
        const gym = db().prepare('SELECT * FROM gyms WHERE id = ?').get(params.gymId);
        if (!gym) return json(res, 404, { error: 'academia não encontrada' });
        const member = db().prepare("SELECT * FROM memberships WHERE gym_id = ? AND user_id = ? AND status = 'active'").get(gym.id, user.id) || null;
        const role = member ? member.role : ctx.platformAdmin ? 'gym_admin' : null;
        if (!role) return json(res, 403, { error: 'você não faz parte desta academia' });
        if (gym.status !== 'active' && !ctx.platformAdmin) return json(res, 423, { error: 'esta academia está suspensa. Fale com o suporte da plataforma.', code: 'suspended' });
        if (!entry.access.includes(role)) return json(res, 403, { error: 'sem permissão para esta área' });
        Object.assign(ctx, { gym, member, role });
      }
    }
    let bodyP = null;
    ctx.body = () => (bodyP ||= (req.method === 'GET' ? Promise.resolve({}) : readBody(req)));
    try {
      const out = await entry.fn(ctx);
      if (res.headersSent) return;
      if (out && out.__status) return json(res, out.__status, out.body);
      json(res, 200, out ?? { ok: true });
    } catch (e) {
      if (e instanceof SaasError) return json(res, e.status, { error: e.message, ...(e.code ? { code: e.code } : {}) });
      // A unique index refusing a duplicate is the caller's to fix, not a crash.
      if (/UNIQUE constraint failed/.test(e?.message || '')) return json(res, 409, { error: 'já existe um registro com esses dados' });
      throw e;
    }
  }

  /** The handler for a request, or null when no SaaS route matches its path. */
  function match(method, pathname) {
    if (!pathname.startsWith('/api/saas/')) return null;
    if (!saasConfig().saasMode) return null;   // SAAS_MODE=off: the area answers 404 like any unknown path
    let pathHit = false;
    for (const entry of table) {
      const m = entry.rx.exec(pathname);
      if (!m) continue;
      pathHit = true;
      if (entry.method !== method) continue;
      const params = Object.fromEntries(entry.names.map((n, i) => [n, m[i + 1]]));
      return (req, res, url) => run(entry, params, req, res, url);
    }
    return pathHit ? (req, res) => json(res, 405, { error: 'method not allowed' }) : null;
  }

  return { match, routes: () => table.map(e => `${e.method} /api/saas${e.pattern}`) };
}

export { SaasError, forbidden, notFound };
