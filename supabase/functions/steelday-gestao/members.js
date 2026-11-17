// People of an academy: students, trainers and administrators. A person is a row first (name,
// contact, health notes) with an invite code; once they sign up and use the code (or come in
// through the academy's link), the row is linked to their profile.
import { ADMIN, STAFF } from './roles.js';
import { str, date, oneOf, bad, notFound, forbidden, inviteCode, id as uuid } from './util.js';
import { createSubscription } from './finance.js';

const ROLE_FIELDS = ['gym_admin', 'trainer', 'student'];

/** The next turnstile number of an academy (the person's user id on its devices). From 1001. */
export async function nextAccessId(q, gymId) {
  const [r] = await q`select coalesce(max(access_id), 1000)::int m from opengym.gym_members where gym_id = ${gymId}`;
  return r.m + 1;
}

export function memberView(m, { withCode = false } = {}) {
  if (!m) return null;
  const { invite_code, account_name, account_disabled, ...rest } = m;
  return {
    ...rest,
    linked: !!m.user_id,
    accountName: account_name ?? null,
    accountDisabled: !!account_disabled,
    ...(withCode ? { invite_code } : {})
  };
}

export function registerMembers(route, { sql, audit, rand }) {
  const newCode = async q => {
    for (;;) {
      const c = inviteCode(rand);
      if (!(await q`select 1 from opengym.gym_members where invite_code = ${c}`).length) return c;
    }
  };
  const getMember = async (gymId, mid) => {
    const [m] = await sql`select m.*, p.name as account_name, p.disabled as account_disabled
      from opengym.gym_members m left join opengym.profiles p on p.id = m.user_id where m.id = ${mid} and m.gym_id = ${gymId}`;
    if (!m) throw notFound('pessoa');
    return m;
  };
  const checkTrainer = async (gymId, tid) => {
    if (!tid) return null;
    uuid(tid, 'instrutor');
    const [t] = await sql`select id from opengym.gym_members where id = ${tid} and gym_id = ${gymId} and role in ('trainer','gym_admin')`;
    if (!t) throw bad('instrutor inválido');
    return t.id;
  };
  const mayEdit = (ctx, m) => ctx.role === 'gym_admin' || m.role === 'student';
  const lastAdminGuard = async (gymId, memberId) => {
    const [r] = await sql`select count(*)::int n from opengym.gym_members where gym_id = ${gymId} and role = 'gym_admin' and status = 'active' and id <> ${memberId}`;
    if (r.n === 0) throw bad('a academia precisa de pelo menos um administrador ativo');
  };

  route('GET', '/gyms/:gymId/members', STAFF, async ctx => {
    const q = ctx.query;
    const role = q.get('role');
    const status = q.get('status') || 'active';
    if (role && role !== 'staff') oneOf(role, 'papel', ROLE_FIELDS);
    if (status !== 'all') oneOf(status, 'situação', ['active', 'inactive']);
    const text = (q.get('q') || '').trim().toLowerCase();
    const like = `%${text}%`;
    const mine = q.get('mine') === '1' && ctx.member ? ctx.member.id : null;
    const rows = await sql`select m.*, t.name as trainer_name, p.name as account_name, p.disabled as account_disabled,
        (select count(*)::int from opengym.gym_charges c where c.member_id = m.id and c.status = 'open' and c.due_date < to_char(now(), 'YYYY-MM-DD')) as overdue_count,
        (select count(*)::int from opengym.gym_assignments a where a.student_member_id = m.id and a.status = 'active') as active_workouts
      from opengym.gym_members m left join opengym.gym_members t on t.id = m.trainer_member_id left join opengym.profiles p on p.id = m.user_id
      where m.gym_id = ${ctx.gym.id}
        ${role === 'staff' ? sql`and m.role in ('gym_admin','trainer')` : role ? sql`and m.role = ${role}` : sql``}
        ${status !== 'all' ? sql`and m.status = ${status}` : sql``}
        ${mine ? sql`and m.trainer_member_id = ${mine}` : sql``}
        ${text ? sql`and (lower(m.name) like ${like} or lower(m.email) like ${like} or m.phone like ${like})` : sql``}
      order by lower(m.name) limit 1000`;
    return { members: rows.map(r => {
      const v = memberView(r, { withCode: mayEdit(ctx, r) });
      if (ctx.role !== 'gym_admin') delete v.overdue_count;
      return v;
    }) };
  });

  route('POST', '/gyms/:gymId/members', STAFF, async ctx => {
    const b = await ctx.body();
    const role = oneOf(b.role, 'papel', ROLE_FIELDS, { opt: true, def: 'student' });
    if (role !== 'student' && ctx.role !== 'gym_admin') throw forbidden('só administradores cadastram profissionais');
    let trainerId = await checkTrainer(ctx.gym.id, b.trainerMemberId || null);
    if (!trainerId && role === 'student' && ctx.role === 'trainer') trainerId = ctx.member?.id || null;
    const row = {
      gym_id: ctx.gym.id, role,
      name: str(b.name, 'nome', { max: 120 }), email: str(b.email, 'e-mail', { opt: true, max: 160 }), phone: str(b.phone, 'telefone', { opt: true, max: 40 }),
      document: str(b.document, 'CPF', { opt: true, max: 30 }), birth_date: date(b.birthDate, 'data de nascimento', { opt: true }),
      goal: str(b.goal, 'objetivo', { opt: true, max: 300 }), health_notes: str(b.healthNotes, 'observações de saúde', { opt: true, max: 2000 }),
      notes: str(b.notes, 'observações', { opt: true, max: 2000 }), trainer_member_id: trainerId
    };
    const mid = await sql.begin(async tx => {
      await tx`select pg_advisory_xact_lock(hashtext(${'opengym.gym-access.' + ctx.gym.id}))`;
      const [m] = await tx`insert into opengym.gym_members ${tx({ ...row, invite_code: await newCode(tx), access_id: await nextAccessId(tx, ctx.gym.id) })} returning id`;
      if (role === 'student' && b.planId && ctx.role === 'gym_admin') {
        await createSubscription(tx, { gymId: ctx.gym.id, memberId: m.id, planId: b.planId, startDate: b.startDate, dueDay: b.dueDay, gym: ctx.gym });
      }
      return m.id;
    });
    await audit(ctx, 'member.create', { memberId: mid, role });
    return { __status: 201, body: { member: memberView(await getMember(ctx.gym.id, mid), { withCode: true }) } };
  });

  route('GET', '/gyms/:gymId/members/:memberId', STAFF, async ctx => {
    const m = await getMember(ctx.gym.id, ctx.params.memberId);
    const [trainer] = m.trainer_member_id ? await sql`select id, name from opengym.gym_members where id = ${m.trainer_member_id}` : [];
    const assignments = await sql`select id, name, notes, start_date, end_date, status, imported_at, created_at from opengym.gym_assignments
      where gym_id = ${ctx.gym.id} and student_member_id = ${m.id} order by created_at desc`;
    const out = { member: memberView(m, { withCode: mayEdit(ctx, m) }), trainer: trainer || null, assignments };
    if (ctx.role === 'gym_admin') {
      out.subscriptions = await sql`select s.*, p.name as plan_name from opengym.gym_subscriptions s join opengym.gym_plans p on p.id = s.plan_id
        where s.gym_id = ${ctx.gym.id} and s.member_id = ${m.id} order by s.created_at desc`;
      out.charges = await sql`select * from opengym.gym_charges where gym_id = ${ctx.gym.id} and member_id = ${m.id} order by due_date desc limit 60`;
    }
    return out;
  });

  route('PUT', '/gyms/:gymId/members/:memberId', STAFF, async ctx => {
    const m = await getMember(ctx.gym.id, ctx.params.memberId);
    if (!mayEdit(ctx, m)) throw forbidden();
    const b = await ctx.body();
    const pick = (k, col, fn) => (b[k] !== undefined ? fn() : m[col]);
    let role = m.role;
    if (b.role !== undefined && b.role !== m.role) {
      if (ctx.role !== 'gym_admin') throw forbidden('só administradores mudam o papel de alguém');
      role = oneOf(b.role, 'papel', ROLE_FIELDS);
      if (m.role === 'gym_admin') await lastAdminGuard(ctx.gym.id, m.id);
    }
    const next = {
      role,
      name: pick('name', 'name', () => str(b.name, 'nome', { max: 120 })),
      email: pick('email', 'email', () => str(b.email, 'e-mail', { opt: true, max: 160 })),
      phone: pick('phone', 'phone', () => str(b.phone, 'telefone', { opt: true, max: 40 })),
      document: pick('document', 'document', () => str(b.document, 'CPF', { opt: true, max: 30 })),
      birth_date: pick('birthDate', 'birth_date', () => date(b.birthDate, 'data de nascimento', { opt: true })),
      goal: pick('goal', 'goal', () => str(b.goal, 'objetivo', { opt: true, max: 300 })),
      health_notes: pick('healthNotes', 'health_notes', () => str(b.healthNotes, 'observações de saúde', { opt: true, max: 2000 })),
      notes: pick('notes', 'notes', () => str(b.notes, 'observações', { opt: true, max: 2000 })),
      trainer_member_id: b.trainerMemberId !== undefined ? await checkTrainer(ctx.gym.id, b.trainerMemberId || null) : m.trainer_member_id
    };
    await sql`update opengym.gym_members set ${sql(next)}, updated_at = now() where id = ${m.id}`;
    await audit(ctx, 'member.update', { memberId: m.id });
    return { member: memberView(await getMember(ctx.gym.id, m.id), { withCode: true }) };
  });

  route('POST', '/gyms/:gymId/members/:memberId/status', ADMIN, async ctx => {
    const m = await getMember(ctx.gym.id, ctx.params.memberId);
    const b = await ctx.body();
    const status = oneOf(b.status, 'situação', ['active', 'inactive']);
    if (status === 'inactive' && m.role === 'gym_admin') await lastAdminGuard(ctx.gym.id, m.id);
    await sql.begin(async tx => {
      await tx`update opengym.gym_members set status = ${status}, updated_at = now() where id = ${m.id}`;
      // An inactive student stops being billed.
      if (status === 'inactive' && b.cancelSubscriptions !== false) {
        await tx`update opengym.gym_subscriptions set status = 'canceled', canceled_at = now() where member_id = ${m.id} and status = 'active'`;
      }
    });
    await audit(ctx, 'member.status', { memberId: m.id, status });
    return { member: memberView(await getMember(ctx.gym.id, m.id), { withCode: true }) };
  });

  route('POST', '/gyms/:gymId/members/:memberId/invite', STAFF, async ctx => {
    const m = await getMember(ctx.gym.id, ctx.params.memberId);
    if (!mayEdit(ctx, m)) throw forbidden();
    const b = await ctx.body();
    if (m.user_id && b.unlink !== true) throw bad('esta pessoa já tem acesso. Para trocar a conta, desvincule primeiro.');
    if (m.user_id && m.role === 'gym_admin') await lastAdminGuard(ctx.gym.id, m.id);
    await sql`update opengym.gym_members set invite_code = ${await newCode(sql)}, user_id = null, updated_at = now() where id = ${m.id}`;
    await audit(ctx, 'member.invite', { memberId: m.id, unlinked: !!m.user_id });
    return { member: memberView(await getMember(ctx.gym.id, m.id), { withCode: true }) };
  });

  // How a student is training, read from their own training log (the synced document).
  route('GET', '/gyms/:gymId/members/:memberId/progress', STAFF, async ctx => {
    const m = await getMember(ctx.gym.id, ctx.params.memberId);
    if (m.role !== 'student') throw bad('acompanhamento é só para alunos');
    if (!m.user_id) return { linked: false, total: 0, last30: 0, lastDate: null, recent: [] };
    const [st] = await sql`select doc from opengym.state where user_id = ${m.user_id}`;
    const S = st?.doc || {};
    const ws = Array.isArray(S.workouts) ? S.workouts.filter(w => w && typeof w.d === 'string') : [];
    const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const sorted = [...ws].sort((a, b) => (a.d < b.d ? 1 : -1));
    const weights = Array.isArray(S.bodyweight) ? S.bodyweight.filter(x => x && x.d).slice(-12) : [];
    return {
      linked: true, total: ws.length, last30: ws.filter(w => w.d >= since).length, lastDate: sorted[0]?.d || null,
      recent: sorted.slice(0, 10).map(w => ({
        date: w.d, name: String(w.name || 'Treino').slice(0, 80),
        exercises: Array.isArray(w.entries) ? w.entries.length : null,
        durationMin: Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start ? Math.round((w.end - w.start) / 60000) : null
      })),
      bodyweight: weights.map(x => ({ date: x.d, kg: Number.isFinite(x.w) ? x.w : null }))
    };
  });
}
