/* The platform's own back office: every academy on the instance and every profile with the
 * academies it belongs to. For admins of the instance (isAdmin). Locking a profile out, granting the
 * admin role and recovery codes stay on the existing /api/admin/user/* routes, which already carry
 * the owner rules; this adds what the SaaS layer knows. */
import { oneOf, notFound } from './util.js';
import { publicGym } from './gyms.js';

export function registerPlatform(route, { db, audit, users, isAdmin }) {
  route('GET', '/platform/overview', 'platform', () => {
    const d = db();
    const n = sql => d.prepare(sql).get().n;
    const month = new Date().toISOString().slice(0, 7);
    return {
      gyms: n('SELECT COUNT(*) AS n FROM gyms'),
      activeGyms: n("SELECT COUNT(*) AS n FROM gyms WHERE status = 'active'"),
      suspendedGyms: n("SELECT COUNT(*) AS n FROM gyms WHERE status = 'suspended'"),
      students: n("SELECT COUNT(*) AS n FROM memberships WHERE role = 'student' AND status = 'active'"),
      staff: n("SELECT COUNT(*) AS n FROM memberships WHERE role != 'student' AND status = 'active'"),
      users: users().length,
      disabledUsers: users().filter(u => u.disabled).length,
      newGymsThisMonth: d.prepare('SELECT COUNT(*) AS n FROM gyms WHERE substr(created_at, 1, 7) = ?').get(month).n
    };
  });

  route('GET', '/platform/gyms', 'platform', ctx => {
    const q = (ctx.query.get('q') || '').trim().toLowerCase();
    const rows = db().prepare(`SELECT g.*,
        (SELECT COUNT(*) FROM memberships m WHERE m.gym_id = g.id AND m.role = 'student' AND m.status = 'active') AS students,
        (SELECT COUNT(*) FROM memberships m WHERE m.gym_id = g.id AND m.role != 'student' AND m.status = 'active') AS staff,
        (SELECT group_concat(m.name, ', ') FROM memberships m WHERE m.gym_id = g.id AND m.role = 'gym_admin' AND m.status = 'active') AS admins
      FROM gyms g ${q ? 'WHERE lower(g.name) LIKE ? OR g.slug LIKE ? OR g.document LIKE ?' : ''} ORDER BY g.created_at DESC`).all(...(q ? [`%${q}%`, `%${q}%`, `%${q}%`] : []));
    return { gyms: rows.map(r => ({ ...publicGym(r), students: r.students, staff: r.staff, admins: r.admins || '' })) };
  });

  route('POST', '/platform/gyms/:gymId/status', 'platform', async ctx => {
    const g = db().prepare('SELECT * FROM gyms WHERE id = ?').get(ctx.params.gymId);
    if (!g) throw notFound('academia');
    const b = await ctx.body();
    const status = oneOf(b.status, 'situação', ['active', 'suspended']);
    db().prepare('UPDATE gyms SET status = ? WHERE id = ?').run(status, g.id);
    ctx.gym = g;
    audit(ctx, status === 'active' ? 'platform.gym.activate' : 'platform.gym.suspend', { gymId: g.id });
    return { gym: publicGym(db().prepare('SELECT * FROM gyms WHERE id = ?').get(g.id)) };
  });

  route('GET', '/platform/users', 'platform', ctx => {
    const q = (ctx.query.get('q') || '').trim().toLowerCase();
    const links = db().prepare(`SELECT m.user_id, m.role, m.status, g.id AS gym_id, g.name AS gym_name FROM memberships m
      JOIN gyms g ON g.id = m.gym_id WHERE m.user_id IS NOT NULL`).all();
    const byUser = new Map();
    for (const l of links) { if (!byUser.has(l.user_id)) byUser.set(l.user_id, []); byUser.get(l.user_id).push({ gymId: l.gym_id, gymName: l.gym_name, role: l.role, status: l.status }); }
    const list = users()
      .filter(u => !q || String(u.name || '').toLowerCase().includes(q) || String(u.email || '').toLowerCase().includes(q))
      .map(u => ({ id: u.id, name: u.name, email: u.email || null, created: u.created || null, disabled: !!u.disabled, platformAdmin: isAdmin(u), gyms: byUser.get(u.id) || [] }));
    return { users: list };
  });

  route('GET', '/platform/audit', 'platform', ctx => {
    const gid = ctx.query.get('gymId');
    const rows = db().prepare(`SELECT a.*, g.name AS gym_name FROM audit_log a LEFT JOIN gyms g ON g.id = a.gym_id ${gid ? 'WHERE a.gym_id = ?' : ''} ORDER BY a.at DESC LIMIT 300`).all(...(gid ? [gid] : []));
    const names = new Map(users().map(u => [u.id, u.name]));
    return { entries: rows.map(r => ({ ...r, user_name: names.get(r.user_id) || null, detail: JSON.parse(r.detail_json || '{}'), detail_json: undefined })) };
  });
}
