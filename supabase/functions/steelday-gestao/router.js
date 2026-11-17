// The management API (/api/saas/*) on Postgres. Every route declares who may call it:
//   'public'    anyone
//   'user'      any signed-in profile
//   'platform'  an admin of the platform (opengym.profiles.admin)
//   [roles]     a member of the academy in :gymId holding one of the roles; a platform admin
//               passes as gym_admin, so support can always get in.
import { SaasError, isUuid, GYM_COLS } from './util.js';
import { saasConfig } from './roles.js';
import { registerGyms } from './gyms.js';
import { registerMembers } from './members.js';
import { registerTraining } from './training.js';
import { registerFinance } from './finance.js';
import { registerSupplies } from './supplies.js';
import { registerPos } from './pos.js';
import { registerPlatform } from './platform.js';
import { registerAccess } from './access.js';
import { registerFollowup } from './followup.js';

export function createSaas(deps) {
  const { sql, session } = deps;
  const table = [];
  const route = (method, pattern, access, fn) => {
    const names = [];
    const rx = new RegExp('^/api/saas' + pattern.replace(/:([a-zA-Z]+)/g, (_, n) => { names.push(n); return '([A-Za-z0-9_-]{1,64})'; }) + '$');
    table.push({ method, pattern, rx, names, access, fn });
  };
  const audit = async (ctx, action, detail = {}) => {
    try {
      await sql`insert into opengym.gym_audit (gym_id, user_id, action, detail) values (${ctx.gym?.id || null}, ${ctx.user?.id || null}, ${action}, ${sql.json(detail)})`;
    } catch (e) { console.error('gym audit failed', e.message); }
  };
  const rand = n => crypto.getRandomValues(new Uint8Array(n));
  const shared = { ...deps, audit, rand };
  for (const reg of [registerGyms, registerMembers, registerTraining, registerFinance, registerSupplies, registerPos, registerPlatform, registerAccess, registerFollowup]) reg(route, shared);

  async function run(entry, params, req, url) {
    const ctx = { req, url, params, query: url.searchParams, user: null, gym: null, member: null, role: null, platformAdmin: false };
    let bodyP = null;
    ctx.body = () => (bodyP ||= (async () => {
      if (req.method === 'GET') return {};
      const t = await req.text();
      if (!t) return {};
      let v; try { v = JSON.parse(t); } catch { throw new SaasError(400, 'invalid json'); }
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new SaasError(400, 'invalid json');
      return v;
    })());
    // An id in the path that is not a uuid names nothing.
    for (const [k, v] of Object.entries(params)) if (k.endsWith('Id') && !isUuid(v)) throw new SaasError(404, 'não encontrado');
    if (entry.access !== 'public') {
      const user = await session(req);
      if (!user) throw new SaasError(401, 'not signed in');
      ctx.user = user;
      ctx.platformAdmin = user.admin === true;
      if (entry.access === 'platform' && !ctx.platformAdmin) throw new SaasError(403, 'apenas administradores da plataforma');
      if (Array.isArray(entry.access)) {
        const [gym] = await sql`select ${sql(GYM_COLS)} from opengym.gyms where id = ${params.gymId}`;
        if (!gym) throw new SaasError(404, 'academia não encontrada');
        const [member] = await sql`select * from opengym.gym_members where gym_id = ${gym.id} and user_id = ${user.id} and status = 'active'`;
        const role = member ? member.role : ctx.platformAdmin ? 'gym_admin' : null;
        if (!role) throw new SaasError(403, 'você não faz parte desta academia');
        if (gym.status !== 'active' && !ctx.platformAdmin) throw new SaasError(423, 'esta academia está suspensa. Fale com o suporte da plataforma.', 'suspended');
        if (!entry.access.includes(role)) throw new SaasError(403, 'sem permissão para esta área');
        Object.assign(ctx, { gym, member: member || null, role });
      }
    }
    return entry.fn(ctx);
  }

  /** The handler for a request, or null when no route matches its path. */
  function match(method, path) {
    if (!path.startsWith('/api/saas/')) return null;
    if (!saasConfig().saasMode) return null;
    let pathHit = false;
    for (const entry of table) {
      const m = entry.rx.exec(path);
      if (!m) continue;
      pathHit = true;
      if (entry.method !== method) continue;
      const params = Object.fromEntries(entry.names.map((n, i) => [n, m[i + 1]]));
      return (req, url) => run(entry, params, req, url);
    }
    return pathHit ? () => { throw new SaasError(405, 'method not allowed'); } : null;
  }
  return { match, routes: () => table.map(e => `${e.method} /api/saas${e.pattern}`) };
}
