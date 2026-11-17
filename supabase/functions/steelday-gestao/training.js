// Workout sheets ("fichas"), in the app's own plan share format (lib/plan-share.js). Each
// assignment keeps its own copy; the student adds it to their plan from the app with the same
// import a shared plan file uses (parsePlan + mergePlan).
import { ROLES, STAFF } from './roles.js';
import { str, date, bad, notFound, forbidden, isUuid } from './util.js';
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
    const rid = typeof r.id === 'string' && /^[\w-]{1,40}$/.test(r.id) && !ids.has(r.id) ? r.id : `r${i + 1}`;
    ids.add(rid);
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
    return { id: rid, name: str(r.name || `Treino ${String.fromCharCode(65 + i)}`, 'nome do treino', { max: 60 }), ...(typeof r.emoji === 'string' && r.emoji.length <= 8 ? { emoji: r.emoji } : {}), ex };
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

export function registerTraining(route, { sql, audit }) {
  const getTemplate = async (gymId, wid) => {
    const [t] = await sql`select * from opengym.gym_workouts where id = ${wid} and gym_id = ${gymId}`;
    if (!t) throw notFound('ficha');
    return t;
  };

  route('GET', '/gyms/:gymId/workouts', STAFF, async ctx => {
    const archived = ctx.query.get('archived') === '1';
    const rows = await sql`select t.*, m.name as author_name,
        (select count(*)::int from opengym.gym_assignments a where a.template_id = t.id and a.status = 'active') as active_assignments
      from opengym.gym_workouts t left join opengym.gym_members m on m.id = t.created_by_member
      where t.gym_id = ${ctx.gym.id} and t.archived = ${archived} order by t.updated_at desc`;
    return { workouts: rows };
  });

  route('POST', '/gyms/:gymId/workouts', STAFF, async ctx => {
    const b = await ctx.body();
    const name = str(b.name, 'nome da ficha', { max: 120 });
    const plan = cleanPlan(b.plan, name);
    const [t] = await sql`insert into opengym.gym_workouts (gym_id, name, description, level, plan, created_by_member)
      values (${ctx.gym.id}, ${name}, ${str(b.description, 'descrição', { opt: true, max: 2000 })}, ${str(b.level, 'nível', { opt: true, max: 40 })}, ${sql.json(plan)}, ${ctx.member?.id || null})
      returning id`;
    await audit(ctx, 'workout.create', { workoutId: t.id });
    return { __status: 201, body: { workout: await getTemplate(ctx.gym.id, t.id) } };
  });

  route('GET', '/gyms/:gymId/workouts/:workoutId', STAFF, async ctx => ({ workout: await getTemplate(ctx.gym.id, ctx.params.workoutId) }));

  route('PUT', '/gyms/:gymId/workouts/:workoutId', STAFF, async ctx => {
    const t = await getTemplate(ctx.gym.id, ctx.params.workoutId);
    const b = await ctx.body();
    const name = b.name !== undefined ? str(b.name, 'nome da ficha', { max: 120 }) : t.name;
    const plan = b.plan !== undefined ? cleanPlan(b.plan, name) : { ...t.plan, name };
    await sql`update opengym.gym_workouts set name = ${name},
      description = ${b.description !== undefined ? str(b.description, 'descrição', { opt: true, max: 2000 }) : t.description},
      level = ${b.level !== undefined ? str(b.level, 'nível', { opt: true, max: 40 }) : t.level},
      plan = ${sql.json(plan)}, archived = ${b.archived !== undefined ? !!b.archived : t.archived}, updated_at = now()
      where id = ${t.id}`;
    await audit(ctx, 'workout.update', { workoutId: t.id });
    return { workout: await getTemplate(ctx.gym.id, t.id) };
  });

  route('DELETE', '/gyms/:gymId/workouts/:workoutId', STAFF, async ctx => {
    const t = await getTemplate(ctx.gym.id, ctx.params.workoutId);
    await sql`update opengym.gym_workouts set archived = true, updated_at = now() where id = ${t.id}`;
    await audit(ctx, 'workout.archive', { workoutId: t.id });
    return { ok: true };
  });

  route('POST', '/gyms/:gymId/workouts/:workoutId/assign', STAFF, async ctx => {
    const t = await getTemplate(ctx.gym.id, ctx.params.workoutId);
    const b = await ctx.body();
    const ids = Array.isArray(b.memberIds) ? [...new Set(b.memberIds.filter(isUuid))] : [];
    if (!ids.length) throw bad('escolha pelo menos um aluno');
    if (ids.length > 500) throw bad('no máximo 500 alunos por vez');
    const notes = str(b.notes, 'observações', { opt: true, max: 2000 });
    const start = date(b.startDate, 'início', { opt: true });
    const end = date(b.endDate, 'fim', { opt: true });
    if (start && end && end < start) throw bad('o fim vem antes do início');
    const created = await sql.begin(async tx => {
      const out = [];
      for (const mid of ids) {
        const [s] = await tx`select id from opengym.gym_members where id = ${mid} and gym_id = ${ctx.gym.id} and role = 'student' and status = 'active'`;
        if (!s) throw bad('um dos alunos escolhidos não é aluno ativo desta academia');
        if (b.replace !== false) await tx`update opengym.gym_assignments set status = 'archived' where gym_id = ${ctx.gym.id} and student_member_id = ${mid} and status = 'active'`;
        // A student nobody looked after yet gets the trainer who just gave them a sheet.
        if (ctx.role === 'trainer' && ctx.member) await tx`update opengym.gym_members set trainer_member_id = ${ctx.member.id} where id = ${mid} and trainer_member_id is null`;
        const [a] = await tx`insert into opengym.gym_assignments (gym_id, template_id, student_member_id, assigned_by_member, name, plan, notes, start_date, end_date)
          values (${ctx.gym.id}, ${t.id}, ${mid}, ${ctx.member?.id || null}, ${t.name}, ${tx.json(t.plan)}, ${notes}, ${start}, ${end}) returning id`;
        out.push(a.id);
      }
      return out;
    });
    await audit(ctx, 'workout.assign', { workoutId: t.id, count: created.length });
    return { assigned: created.length, ids: created };
  });

  route('GET', '/gyms/:gymId/assignments', STAFF, async ctx => {
    const mid = ctx.query.get('memberId');
    const all = ctx.query.get('status') === 'all';
    const rows = await sql`select a.id, a.name, a.notes, a.start_date, a.end_date, a.status, a.imported_at, a.created_at, a.template_id,
        a.student_member_id, s.name as student_name, t.name as trainer_name
      from opengym.gym_assignments a join opengym.gym_members s on s.id = a.student_member_id left join opengym.gym_members t on t.id = a.assigned_by_member
      where a.gym_id = ${ctx.gym.id} ${mid && isUuid(mid) ? sql`and a.student_member_id = ${mid}` : sql``} ${all ? sql`` : sql`and a.status = 'active'`}
      order by a.created_at desc limit 1000`;
    return { assignments: rows };
  });

  route('POST', '/gyms/:gymId/assignments/:assignmentId/archive', STAFF, async ctx => {
    const r = await sql`update opengym.gym_assignments set status = 'archived' where id = ${ctx.params.assignmentId} and gym_id = ${ctx.gym.id} returning id`;
    if (!r.length) throw notFound('ficha atribuída');
    await audit(ctx, 'workout.unassign', { assignmentId: ctx.params.assignmentId });
    return { ok: true };
  });

  /* ---- the student's own view of their academy ---- */
  route('GET', '/gyms/:gymId/my', ROLES, async ctx => {
    const m = ctx.member;
    if (!m) return { gym: publicGym(ctx.gym), role: ctx.role, member: null, assignments: [], charges: [], subscriptions: [] };
    const [trainer] = m.trainer_member_id ? await sql`select id, name, phone, email from opengym.gym_members where id = ${m.trainer_member_id}` : [];
    const assignments = await sql`select a.*, t.name as trainer_name from opengym.gym_assignments a left join opengym.gym_members t on t.id = a.assigned_by_member
      where a.gym_id = ${ctx.gym.id} and a.student_member_id = ${m.id} and a.status = 'active' order by a.created_at desc`;
    const charges = await sql`select id, description, amount_cents, due_date, status, paid_at, payment_method from opengym.gym_charges
      where gym_id = ${ctx.gym.id} and member_id = ${m.id} and status <> 'canceled' order by due_date desc limit 24`;
    const subscriptions = await sql`select s.id, s.price_cents, s.due_day, s.start_date, p.name as plan_name from opengym.gym_subscriptions s
      join opengym.gym_plans p on p.id = s.plan_id where s.member_id = ${m.id} and s.status = 'active'`;
    const { notes, ...self } = memberView(m);
    return { gym: publicGym(ctx.gym), role: ctx.role, member: self, trainer: trainer || null, assignments, charges, subscriptions };
  });

  route('POST', '/gyms/:gymId/my/assignments/:assignmentId/imported', ROLES, async ctx => {
    if (!ctx.member) throw forbidden();
    const r = await sql`update opengym.gym_assignments set imported_at = now() where id = ${ctx.params.assignmentId} and gym_id = ${ctx.gym.id} and student_member_id = ${ctx.member.id} returning id`;
    if (!r.length) throw notFound('ficha');
    return { ok: true };
  });
}
