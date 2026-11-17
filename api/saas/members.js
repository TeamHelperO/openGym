/* People of an academy: students, trainers and administrators. A person is a membership row first
 * (name, contact, health notes) and gets an invite code; once they sign up on the platform and type
 * the code, the row is linked to their profile and they can sign in to the academy. */
import { ADMIN, STAFF } from './roles.js';
import { tx } from './db.js';
import { str, date, oneOf, bad, notFound, forbidden, inviteCode } from './util.js';
import { createSubscription } from './finance.js';

const ROLE_FIELDS = ['gym_admin', 'trainer', 'student'];

/** The next turnstile number of an academy (the person's user id on its devices). From 1001. */
export function nextAccessId(db, gymId) {
  return (db.prepare('SELECT MAX(access_id) AS m FROM memberships WHERE gym_id = ?').get(gymId).m || 1000) + 1;
}

export function memberView(m, { withCode = false, userById } = {}) {
  if (!m) return null;
  const { settings_json, invite_code, ...rest } = m;
  const u = m.user_id && userById ? userById(m.user_id) : null;
  return {
    ...rest,
    linked: !!m.user_id,
    accountName: u ? u.name : null,
    accountDisabled: u ? !!u.disabled : false,
    ...(withCode ? { invite_code } : {})
  };
}

export function registerMembers(route, { db, audit, rand, newId, nowIso, userById, readState }) {
  const newCode = () => {
    for (;;) {
      const c = inviteCode(rand);
      if (!db().prepare('SELECT 1 FROM memberships WHERE invite_code = ?').get(c)) return c;
    }
  };
  const getMember = (gymId, id) => {
    const m = db().prepare('SELECT * FROM memberships WHERE id = ? AND gym_id = ?').get(id, gymId);
    if (!m) throw notFound('pessoa');
    return m;
  };
  const checkTrainer = (gymId, id) => {
    if (!id) return null;
    const t = db().prepare("SELECT id FROM memberships WHERE id = ? AND gym_id = ? AND role IN ('trainer','gym_admin')").get(id, gymId);
    if (!t) throw bad('instrutor inválido');
    return t.id;
  };
  // A trainer manages students only; an administrator manages everyone.
  const mayEdit = (ctx, m) => ctx.role === 'gym_admin' || m.role === 'student';

  route('GET', '/gyms/:gymId/members', STAFF, ctx => {
    const q = ctx.query;
    const where = ['m.gym_id = ?']; const args = [ctx.gym.id];
    const role = q.get('role');
    if (role === 'staff') where.push("m.role IN ('gym_admin','trainer')");
    else if (role) { where.push('m.role = ?'); args.push(oneOf(role, 'papel', ROLE_FIELDS)); }
    const status = q.get('status') || 'active';
    if (status !== 'all') { where.push('m.status = ?'); args.push(oneOf(status, 'situação', ['active', 'inactive'])); }
    if (q.get('mine') === '1' && ctx.member) { where.push('m.trainer_member_id = ?'); args.push(ctx.member.id); }
    const text = (q.get('q') || '').trim().toLowerCase();
    if (text) { where.push('(lower(m.name) LIKE ? OR lower(m.email) LIKE ? OR m.phone LIKE ?)'); args.push(`%${text}%`, `%${text}%`, `%${text}%`); }
    const rows = db().prepare(`SELECT m.*, t.name AS trainer_name,
        (SELECT COUNT(*) FROM charges c WHERE c.member_id = m.id AND c.status = 'open' AND c.due_date < date('now')) AS overdue_count,
        (SELECT COUNT(*) FROM workout_assignments a WHERE a.student_member_id = m.id AND a.status = 'active') AS active_workouts
      FROM memberships m LEFT JOIN memberships t ON t.id = m.trainer_member_id
      WHERE ${where.join(' AND ')} ORDER BY m.name COLLATE NOCASE LIMIT 1000`).all(...args);
    return { members: rows.map(r => {
      const v = memberView(r, { withCode: mayEdit(ctx, r), userById });
      if (ctx.role !== 'gym_admin') delete v.overdue_count;
      return v;
    }) };
  });

  route('POST', '/gyms/:gymId/members', STAFF, async ctx => {
    const b = await ctx.body();
    const role = oneOf(b.role, 'papel', ROLE_FIELDS, { opt: true, def: 'student' });
    if (role !== 'student' && ctx.role !== 'gym_admin') throw forbidden('só administradores cadastram profissionais');
    const id = newId(); const now = nowIso();
    const code = newCode();
    let trainerId = checkTrainer(ctx.gym.id, b.trainerMemberId || null);
    if (!trainerId && role === 'student' && ctx.role === 'trainer') trainerId = ctx.member?.id || null;
    tx(db(), () => {
      db().prepare(`INSERT INTO memberships (id, gym_id, role, name, email, phone, document, birth_date, goal, health_notes, notes, trainer_member_id, invite_code, created_at, updated_at, access_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, ctx.gym.id, role,
        str(b.name, 'nome', { max: 120 }), str(b.email, 'e-mail', { opt: true, max: 160 }), str(b.phone, 'telefone', { opt: true, max: 40 }),
        str(b.document, 'CPF', { opt: true, max: 30 }), date(b.birthDate, 'data de nascimento', { opt: true }),
        str(b.goal, 'objetivo', { opt: true, max: 300 }), str(b.healthNotes, 'observações de saúde', { opt: true, max: 2000 }),
        str(b.notes, 'observações', { opt: true, max: 2000 }), trainerId, code, now, now, nextAccessId(db(), ctx.gym.id));
      if (role === 'student' && b.planId && ctx.role === 'gym_admin') {
        createSubscription(db(), { gymId: ctx.gym.id, memberId: id, planId: b.planId, startDate: b.startDate, dueDay: b.dueDay, gym: ctx.gym });
      }
    });
    audit(ctx, 'member.create', { memberId: id, role });
    return { __status: 201, body: { member: memberView(getMember(ctx.gym.id, id), { withCode: true, userById }) } };
  });

  route('GET', '/gyms/:gymId/members/:memberId', STAFF, ctx => {
    const m = getMember(ctx.gym.id, ctx.params.memberId);
    const d = db();
    const trainer = m.trainer_member_id ? d.prepare('SELECT id, name FROM memberships WHERE id = ?').get(m.trainer_member_id) : null;
    const assignments = d.prepare('SELECT id, name, notes, start_date, end_date, status, imported_at, created_at FROM workout_assignments WHERE gym_id = ? AND student_member_id = ? ORDER BY created_at DESC').all(ctx.gym.id, m.id);
    const out = { member: memberView(m, { withCode: mayEdit(ctx, m), userById }), trainer, assignments };
    if (ctx.role === 'gym_admin') {
      out.subscriptions = d.prepare('SELECT s.*, p.name AS plan_name FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.gym_id = ? AND s.member_id = ? ORDER BY s.created_at DESC').all(ctx.gym.id, m.id);
      out.charges = d.prepare('SELECT * FROM charges WHERE gym_id = ? AND member_id = ? ORDER BY due_date DESC LIMIT 60').all(ctx.gym.id, m.id);
    }
    return out;
  });

  route('PUT', '/gyms/:gymId/members/:memberId', STAFF, async ctx => {
    const m = getMember(ctx.gym.id, ctx.params.memberId);
    if (!mayEdit(ctx, m)) throw forbidden();
    const b = await ctx.body();
    const pick = (k, col, fn) => (b[k] !== undefined ? fn() : m[col]);
    let role = m.role;
    if (b.role !== undefined && b.role !== m.role) {
      if (ctx.role !== 'gym_admin') throw forbidden('só administradores mudam o papel de alguém');
      role = oneOf(b.role, 'papel', ROLE_FIELDS);
      if (m.role === 'gym_admin') lastAdminGuard(ctx.gym.id, m.id);
    }
    db().prepare(`UPDATE memberships SET role = ?, name = ?, email = ?, phone = ?, document = ?, birth_date = ?, goal = ?, health_notes = ?, notes = ?, trainer_member_id = ?, updated_at = ? WHERE id = ?`).run(
      role,
      pick('name', 'name', () => str(b.name, 'nome', { max: 120 })),
      pick('email', 'email', () => str(b.email, 'e-mail', { opt: true, max: 160 })),
      pick('phone', 'phone', () => str(b.phone, 'telefone', { opt: true, max: 40 })),
      pick('document', 'document', () => str(b.document, 'CPF', { opt: true, max: 30 })),
      pick('birthDate', 'birth_date', () => date(b.birthDate, 'data de nascimento', { opt: true })),
      pick('goal', 'goal', () => str(b.goal, 'objetivo', { opt: true, max: 300 })),
      pick('healthNotes', 'health_notes', () => str(b.healthNotes, 'observações de saúde', { opt: true, max: 2000 })),
      pick('notes', 'notes', () => str(b.notes, 'observações', { opt: true, max: 2000 })),
      pick('trainerMemberId', 'trainer_member_id', () => checkTrainer(ctx.gym.id, b.trainerMemberId || null)),
      nowIso(), m.id);
    audit(ctx, 'member.update', { memberId: m.id });
    return { member: memberView(getMember(ctx.gym.id, m.id), { withCode: true, userById }) };
  });

  function lastAdminGuard(gymId, memberId) {
    const n = db().prepare("SELECT COUNT(*) AS n FROM memberships WHERE gym_id = ? AND role = 'gym_admin' AND status = 'active' AND id != ?").get(gymId, memberId).n;
    if (n === 0) throw bad('a academia precisa de pelo menos um administrador ativo');
  }

  route('POST', '/gyms/:gymId/members/:memberId/status', ADMIN, async ctx => {
    const m = getMember(ctx.gym.id, ctx.params.memberId);
    const b = await ctx.body();
    const status = oneOf(b.status, 'situação', ['active', 'inactive']);
    if (status === 'inactive' && m.role === 'gym_admin') lastAdminGuard(ctx.gym.id, m.id);
    tx(db(), () => {
      db().prepare('UPDATE memberships SET status = ?, updated_at = ? WHERE id = ?').run(status, nowIso(), m.id);
      // An inactive student stops being billed.
      if (status === 'inactive' && b.cancelSubscriptions !== false) {
        db().prepare("UPDATE subscriptions SET status = 'canceled', canceled_at = ? WHERE member_id = ? AND status = 'active'").run(nowIso(), m.id);
      }
    });
    audit(ctx, 'member.status', { memberId: m.id, status });
    return { member: memberView(getMember(ctx.gym.id, m.id), { withCode: true, userById }) };
  });

  // A fresh code: for someone who lost theirs, or to move the record to another profile.
  route('POST', '/gyms/:gymId/members/:memberId/invite', STAFF, async ctx => {
    const m = getMember(ctx.gym.id, ctx.params.memberId);
    if (!mayEdit(ctx, m)) throw forbidden();
    const b = await ctx.body();
    if (m.user_id && b.unlink !== true) throw bad('esta pessoa já tem acesso. Para trocar a conta, desvincule primeiro.');
    if (m.user_id && m.role === 'gym_admin') lastAdminGuard(ctx.gym.id, m.id);
    db().prepare('UPDATE memberships SET invite_code = ?, user_id = NULL, updated_at = ? WHERE id = ?').run(newCode(), nowIso(), m.id);
    audit(ctx, 'member.invite', { memberId: m.id, unlinked: !!m.user_id });
    return { member: memberView(getMember(ctx.gym.id, m.id), { withCode: true, userById }) };
  });

  // How a student is training, read from their own training log (the app's state file).
  route('GET', '/gyms/:gymId/members/:memberId/progress', STAFF, ctx => {
    const m = getMember(ctx.gym.id, ctx.params.memberId);
    if (m.role !== 'student') throw bad('acompanhamento é só para alunos');
    if (!m.user_id) return { linked: false, total: 0, last30: 0, lastDate: null, recent: [] };
    const S = readState(m.user_id) || {};
    const ws = Array.isArray(S.workouts) ? S.workouts.filter(w => w && typeof w.d === 'string') : [];
    const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const sorted = [...ws].sort((a, b) => (a.d < b.d ? 1 : -1));
    const weights = Array.isArray(S.bodyweight) ? S.bodyweight.filter(x => x && x.d).slice(-12) : [];
    return {
      linked: true,
      total: ws.length,
      last30: ws.filter(w => w.d >= since).length,
      lastDate: sorted[0]?.d || null,
      recent: sorted.slice(0, 10).map(w => ({
        date: w.d,
        name: String(w.name || 'Treino').slice(0, 80),
        exercises: Array.isArray(w.entries) ? w.entries.length : null,
        durationMin: Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start ? Math.round((w.end - w.start) / 60000) : null
      })),
      bodyweight: weights.map(x => ({ date: x.d, kg: Number.isFinite(x.w) ? x.w : null }))
    };
  });
}
