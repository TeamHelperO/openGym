// The platform's back office: every academy and every profile with its academies. Locking a
// profile, the admin role and recovery stay on opengym-api's /api/admin/user/* routes.
import { oneOf, notFound, GYM_COLS } from './util.js';
import { publicGym } from './gyms.js';

export function registerPlatform(route, { sql, audit }) {
  route('GET', '/platform/overview', 'platform', async () => {
    const [r] = await sql`select
      (select count(*)::int from opengym.gyms) as gyms,
      (select count(*)::int from opengym.gyms where status = 'active') as "activeGyms",
      (select count(*)::int from opengym.gyms where status = 'suspended') as "suspendedGyms",
      (select count(*)::int from opengym.gym_members where role = 'student' and status = 'active') as students,
      (select count(*)::int from opengym.gym_members where role <> 'student' and status = 'active') as staff,
      (select count(*)::int from opengym.profiles) as users,
      (select count(*)::int from opengym.profiles where disabled) as "disabledUsers",
      (select count(*)::int from opengym.gyms where date_trunc('month', created_at) = date_trunc('month', now())) as "newGymsThisMonth"`;
    return r;
  });

  route('GET', '/platform/gyms', 'platform', async ctx => {
    const q = (ctx.query.get('q') || '').trim().toLowerCase();
    const like = `%${q}%`;
    const rows = await sql`select ${sql(GYM_COLS.map(c => 'g.' + c))},
        (select count(*)::int from opengym.gym_members m where m.gym_id = g.id and m.role = 'student' and m.status = 'active') as students,
        (select count(*)::int from opengym.gym_members m where m.gym_id = g.id and m.role <> 'student' and m.status = 'active') as staff,
        (select string_agg(m.name, ', ') from opengym.gym_members m where m.gym_id = g.id and m.role = 'gym_admin' and m.status = 'active') as admins
      from opengym.gyms g ${q ? sql`where lower(g.name) like ${like} or g.slug like ${like} or g.document like ${like}` : sql``}
      order by g.created_at desc`;
    return { gyms: rows.map(r => { const { students, staff, admins, ...g } = r; return { ...publicGym(g), students, staff, admins: admins || '' }; }) };
  });

  route('POST', '/platform/gyms/:gymId/status', 'platform', async ctx => {
    const b = await ctx.body();
    const status = oneOf(b.status, 'situação', ['active', 'suspended']);
    const [g] = await sql`update opengym.gyms set status = ${status} where id = ${ctx.params.gymId} returning ${sql(GYM_COLS)}`;
    if (!g) throw notFound('academia');
    ctx.gym = g;
    await audit(ctx, status === 'active' ? 'platform.gym.activate' : 'platform.gym.suspend', { gymId: g.id });
    return { gym: publicGym(g) };
  });

  route('GET', '/platform/users', 'platform', async ctx => {
    const q = (ctx.query.get('q') || '').trim().toLowerCase();
    const like = `%${q}%`;
    const users = await sql`select id, name, email, created_at, disabled, admin from opengym.profiles
      ${q ? sql`where lower(name) like ${like} or lower(coalesce(email, '')) like ${like}` : sql``} order by created_at`;
    const links = await sql`select m.user_id, m.role, m.status, g.id as gym_id, g.name as gym_name from opengym.gym_members m
      join opengym.gyms g on g.id = m.gym_id where m.user_id is not null`;
    return { users: users.map(u => ({
      id: u.id, name: u.name, email: u.email, created: u.created_at, disabled: u.disabled, platformAdmin: u.admin,
      gyms: links.filter(l => l.user_id === u.id).map(l => ({ gymId: l.gym_id, gymName: l.gym_name, role: l.role, status: l.status }))
    })) };
  });

  route('GET', '/platform/audit', 'platform', async ctx => {
    const gid = ctx.query.get('gymId');
    const rows = await sql`select a.*, g.name as gym_name, p.name as user_name from opengym.gym_audit a
      left join opengym.gyms g on g.id = a.gym_id left join opengym.profiles p on p.id = a.user_id
      ${gid ? sql`where a.gym_id = ${gid}` : sql``} order by a.at desc limit 300`;
    return { entries: rows };
  });
}
