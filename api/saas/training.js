/* Workout sheets ("fichas"). A trainer writes a sheet once, as a plan in the app's own share format
 * (lib/plan-share.js: { opengym_plan: 1, routines, week }), and assigns it to students. Each
 * assignment keeps its own copy, so editing the sheet later never rewrites what a student already
 * has. The student adds it to their plan from the app with the same import every shared plan uses
 * (parsePlan + mergePlan), which keeps sync stamps and units right on their side. */
import { ROLES, STAFF } from './roles.js';
import { tx } from './db.js';
import { str, date, bad, notFound, forbidden } from './util.js';
import { publicGym } from './gyms.js';
import { memberView } from './members.js';

const LIMITS = { routines: 14, exercises: 40 };
const intIn = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const numIn = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

/** A sheet as it is stored: only the fields the planner understands, every number clamped. */
export function cleanPlan(raw, name) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.routines)) throw bad('ficha inválida');
  if (!raw.routines.length) throw bad('a ficha precisa de pelo menos um treino');
  if (raw.routines.length > LIMITS.routines) throw bad(`no máximo ${LIMITS.routines} treinos por ficha`);
  const ids = new Set();
  const routines = raw.routines.map((r, i) => {
    if (!r || typeof r !== 'object' || !Array.isArray(r.ex)) throw bad(`treino ${i + 1} inválido`);
    if (r.ex.length > LIMITS.exercises) throw bad(`no máximo ${LIMITS.exercises} exercícios por treino`);
    const id = typeof r.id === 'string' && /^[\w-]{1,40}$/.test(r.id) && !ids.has(r.id) ? r.id : `r${i + 1}`;
    ids.add(id);
    const ex = r.ex.map((e, j) => {
      if (!e || typeof e.id !== 'string' || !/^[\w.:-]{1,80}$/.test(e.id)) throw bad(`exercício ${j + 1} do treino ${i + 1} inválido`);
      const o = { id: e.id, sets: intIn(e.sets, 1, 20) ? e.sets : 3 };
      if (e.mode === 'time') { o.mode = 'time'; o.sec = intIn(e.sec, 1, 3600) ? e.sec : 30; }
      else if (e.mode === 'cardio') { o.mode = 'cardio'; o.min = intIn(e.min, 1, 300) ? e.min : 20; if (numIn(e.speed, 0.1, 40)) o.speed = e.speed; }
      else { o.reps = intIn(e.reps, 1, 100) ? e.reps : 10; }
      if (numIn(e.weight, 0.01, 1000)) o.weight = Math.round(e.weight * 100) / 100;
      if (intIn(e.restSec, 0, 900) && e.restSec > 0) o.restSec = e.restSec;
      if (typeof e.note === 'string' && e.note.trim()) o.note = e.note.trim().slice(0, 300);
      return o;
    });
    return { id, name: str(r.name || `Treino ${String.fromCharCode(65 + i)}`, 'nome do treino', { max: 60 }), ...(typeof r.emoji === 'string' && r.emoji.length <= 8 ? { emoji: r.emoji } : {}), ex };
  });
  const week = {};
  if (raw.week && typeof raw.week === 'object') {
    for (const [d, v] of Object.entries(raw.week)) {
      if (!/^[0-6]$/.test(d)) continue;
      const list = [].concat(v).filter(x => ids.has(x));
      if (list.length) week[d] = [...new Set(list)];
    }
  }
  return { opengym_plan: 1, name: name || '', unit: 'kg', week, routines, customEx: [] };
}

const templateView = t => {
  if (!t) return null;
  const { plan_json, ...rest } = t;
  return { ...rest, archived: !!t.archived, plan: JSON.parse(plan_json) };
};
const assignmentView = a => {
  if (!a) return null;
  const { plan_json, ...rest } = a;
  return { ...rest, plan: plan_json ? JSON.parse(plan_json) : null };
};

export function registerTraining(route, { db, audit, newId, nowIso, userById }) {
  const getTemplate = (gymId, id) => {
    const t = db().prepare('SELECT * FROM workout_templates WHERE id = ? AND gym_id = ?').get(id, gymId);
    if (!t) throw notFound('ficha');
    return t;
  };

  route('GET', '/gyms/:gymId/workouts', STAFF, ctx => {
    const archived = ctx.query.get('archived') === '1' ? 1 : 0;
    const rows = db().prepare(`SELECT t.*, m.name AS author_name,
        (SELECT COUNT(*) FROM workout_assignments a WHERE a.template_id = t.id AND a.status = 'active') AS active_assignments
      FROM workout_templates t LEFT JOIN memberships m ON m.id = t.created_by_member
      WHERE t.gym_id = ? AND t.archived = ? ORDER BY t.updated_at DESC`).all(ctx.gym.id, archived);
    return { workouts: rows.map(templateView) };
  });

  route('POST', '/gyms/:gymId/workouts', STAFF, async ctx => {
    const b = await ctx.body();
    const name = str(b.name, 'nome da ficha', { max: 120 });
    const plan = cleanPlan(b.plan, name);
    const id = newId(); const now = nowIso();
    db().prepare('INSERT INTO workout_templates (id, gym_id, name, description, level, plan_json, created_by_member, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, ctx.gym.id, name, str(b.description, 'descrição', { opt: true, max: 2000 }), str(b.level, 'nível', { opt: true, max: 40 }), JSON.stringify(plan), ctx.member?.id || null, now, now);
    audit(ctx, 'workout.create', { workoutId: id });
    return { __status: 201, body: { workout: templateView(getTemplate(ctx.gym.id, id)) } };
  });

  route('GET', '/gyms/:gymId/workouts/:workoutId', STAFF, ctx => ({ workout: templateView(getTemplate(ctx.gym.id, ctx.params.workoutId)) }));

  route('PUT', '/gyms/:gymId/workouts/:workoutId', STAFF, async ctx => {
    const t = getTemplate(ctx.gym.id, ctx.params.workoutId);
    const b = await ctx.body();
    const name = b.name !== undefined ? str(b.name, 'nome da ficha', { max: 120 }) : t.name;
    const plan = b.plan !== undefined ? cleanPlan(b.plan, name) : { ...JSON.parse(t.plan_json), name };
    db().prepare('UPDATE workout_templates SET name = ?, description = ?, level = ?, plan_json = ?, archived = ?, updated_at = ? WHERE id = ?').run(
      name,
      b.description !== undefined ? str(b.description, 'descrição', { opt: true, max: 2000 }) : t.description,
      b.level !== undefined ? str(b.level, 'nível', { opt: true, max: 40 }) : t.level,
      JSON.stringify(plan), b.archived !== undefined ? (b.archived ? 1 : 0) : t.archived, nowIso(), t.id);
    audit(ctx, 'workout.update', { workoutId: t.id });
    return { workout: templateView(getTemplate(ctx.gym.id, t.id)) };
  });

  route('DELETE', '/gyms/:gymId/workouts/:workoutId', STAFF, ctx => {
    const t = getTemplate(ctx.gym.id, ctx.params.workoutId);
    db().prepare('UPDATE workout_templates SET archived = 1, updated_at = ? WHERE id = ?').run(nowIso(), t.id);
    audit(ctx, 'workout.archive', { workoutId: t.id });
    return { ok: true };
  });

  route('POST', '/gyms/:gymId/workouts/:workoutId/assign', STAFF, async ctx => {
    const t = getTemplate(ctx.gym.id, ctx.params.workoutId);
    const b = await ctx.body();
    const ids = Array.isArray(b.memberIds) ? [...new Set(b.memberIds.filter(x => typeof x === 'string'))] : [];
    if (!ids.length) throw bad('escolha pelo menos um aluno');
    if (ids.length > 500) throw bad('no máximo 500 alunos por vez');
    const notes = str(b.notes, 'observações', { opt: true, max: 2000 });
    const start = date(b.startDate, 'início', { opt: true });
    const end = date(b.endDate, 'fim', { opt: true });
    if (start && end && end < start) throw bad('o fim vem antes do início');
    const now = nowIso();
    const created = tx(db(), () => ids.map(mid => {
      const s = db().prepare("SELECT id FROM memberships WHERE id = ? AND gym_id = ? AND role = 'student' AND status = 'active'").get(mid, ctx.gym.id);
      if (!s) throw bad('um dos alunos escolhidos não é aluno ativo desta academia');
      if (b.replace !== false) {
        db().prepare("UPDATE workout_assignments SET status = 'archived' WHERE gym_id = ? AND student_member_id = ? AND status = 'active'").run(ctx.gym.id, mid);
      }
      // A student nobody looked after yet gets the trainer who just gave them a sheet.
      if (ctx.role === 'trainer' && ctx.member) {
        db().prepare('UPDATE memberships SET trainer_member_id = ? WHERE id = ? AND trainer_member_id IS NULL').run(ctx.member.id, mid);
      }
      const id = newId();
      db().prepare(`INSERT INTO workout_assignments (id, gym_id, template_id, student_member_id, assigned_by_member, name, plan_json, notes, start_date, end_date, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, ctx.gym.id, t.id, mid, ctx.member?.id || null, t.name, t.plan_json, notes, start, end, now);
      return id;
    }));
    audit(ctx, 'workout.assign', { workoutId: t.id, count: created.length });
    return { assigned: created.length, ids: created };
  });

  route('GET', '/gyms/:gymId/assignments', STAFF, ctx => {
    const where = ['a.gym_id = ?']; const args = [ctx.gym.id];
    const mid = ctx.query.get('memberId');
    if (mid) { where.push('a.student_member_id = ?'); args.push(mid); }
    if (ctx.query.get('status') !== 'all') where.push("a.status = 'active'");
    const rows = db().prepare(`SELECT a.id, a.name, a.notes, a.start_date, a.end_date, a.status, a.imported_at, a.created_at, a.template_id,
        a.student_member_id, s.name AS student_name, t.name AS trainer_name
      FROM workout_assignments a JOIN memberships s ON s.id = a.student_member_id LEFT JOIN memberships t ON t.id = a.assigned_by_member
      WHERE ${where.join(' AND ')} ORDER BY a.created_at DESC LIMIT 1000`).all(...args);
    return { assignments: rows };
  });

  route('POST', '/gyms/:gymId/assignments/:assignmentId/archive', STAFF, ctx => {
    const r = db().prepare("UPDATE workout_assignments SET status = 'archived' WHERE id = ? AND gym_id = ?").run(ctx.params.assignmentId, ctx.gym.id);
    if (!r.changes) throw notFound('ficha atribuída');
    audit(ctx, 'workout.unassign', { assignmentId: ctx.params.assignmentId });
    return { ok: true };
  });

  /* ---- the student's own view of their academy ---- */

  route('GET', '/gyms/:gymId/my', ROLES, ctx => {
    const m = ctx.member;
    if (!m) return { gym: publicGym(ctx.gym), role: ctx.role, member: null, assignments: [], charges: [] };
    const d = db();
    const trainer = m.trainer_member_id ? d.prepare('SELECT id, name, phone, email FROM memberships WHERE id = ?').get(m.trainer_member_id) : null;
    const assignments = d.prepare(`SELECT a.*, t.name AS trainer_name FROM workout_assignments a LEFT JOIN memberships t ON t.id = a.assigned_by_member
      WHERE a.gym_id = ? AND a.student_member_id = ? AND a.status = 'active' ORDER BY a.created_at DESC`).all(ctx.gym.id, m.id);
    const charges = d.prepare("SELECT id, description, amount_cents, due_date, status, paid_at, payment_method FROM charges WHERE gym_id = ? AND member_id = ? AND status != 'canceled' ORDER BY due_date DESC LIMIT 24").all(ctx.gym.id, m.id);
    const subscriptions = d.prepare("SELECT s.id, s.price_cents, s.due_day, s.start_date, p.name AS plan_name FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.member_id = ? AND s.status = 'active'").all(m.id);
    const { health_notes, notes, ...self } = memberView(m, { userById });
    return { gym: publicGym(ctx.gym), role: ctx.role, member: { ...self, health_notes }, trainer, assignments: assignments.map(assignmentView), charges, subscriptions };
  });

  route('POST', '/gyms/:gymId/my/assignments/:assignmentId/imported', ROLES, ctx => {
    if (!ctx.member) throw forbidden();
    const r = db().prepare('UPDATE workout_assignments SET imported_at = ? WHERE id = ? AND gym_id = ? AND student_member_id = ?')
      .run(nowIso(), ctx.params.assignmentId, ctx.gym.id, ctx.member.id);
    if (!r.changes) throw notFound('ficha');
    return { ok: true };
  });
}
