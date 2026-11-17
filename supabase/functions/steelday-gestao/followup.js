// Follow-up of a student by their trainer: physical assessments (weight, height, perimeters and
// bioimpedance readings) and nutrition (meal plans built on the TACO table, and the student's
// diary of meals eaten, with an optional photo of the plate).
import { ROLES, STAFF } from './roles.js';
import { str, date, bad, notFound, forbidden, id as uuid } from './util.js';
import { todayDate } from './calc.js';

export const PERIMETERS = ['neck', 'shoulders', 'chest', 'arm_r', 'arm_l', 'arm_r_contracted', 'arm_l_contracted', 'forearm_r', 'forearm_l',
  'waist', 'abdomen', 'hip', 'thigh_r', 'thigh_l', 'calf_r', 'calf_l'];
export const BIO = { fat_pct: [1, 75], fat_kg: [0.5, 300], lean_kg: [5, 300], muscle_kg: [5, 200], water_pct: [10, 90], bone_kg: [0.5, 10],
  visceral: [1, 60], bmr_kcal: [500, 6000], metabolic_age: [10, 110] };
const numOr = (v, lo, hi, field) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < lo || n > hi) throw bad(`${field} fora do intervalo`);
  return Math.round(n * 100) / 100;
};

export function cleanAssessment(b) {
  const perimeters = {};
  for (const k of PERIMETERS) { const v = numOr(b.perimeters?.[k], 5, 300, `perímetro ${k}`); if (v != null) perimeters[k] = v; }
  const bio = {};
  for (const [k, [lo, hi]] of Object.entries(BIO)) { const v = numOr(b.bio?.[k], lo, hi, k); if (v != null) bio[k] = v; }
  const out = {
    date: date(b.date, 'data', { opt: true }) || todayDate(),
    weight_kg: numOr(b.weightKg, 20, 400, 'peso'),
    height_cm: numOr(b.heightCm, 80, 250, 'altura'),
    perimeters, bio,
    notes: str(b.notes, 'observações', { opt: true, max: 2000 })
  };
  if (out.weight_kg == null && out.height_cm == null && !Object.keys(perimeters).length && !Object.keys(bio).length) throw bad('preencha pelo menos uma medida');
  return out;
}

/** A meal plan as stored: meals with their items, every number clamped. */
export function cleanMeals(raw) {
  if (!Array.isArray(raw) || !raw.length) throw bad('o plano precisa de pelo menos uma refeição');
  if (raw.length > 12) throw bad('no máximo 12 refeições');
  const keys = new Set();
  return raw.map((m, i) => {
    if (!m || typeof m !== 'object') throw bad(`refeição ${i + 1} inválida`);
    const key = typeof m.key === 'string' && /^[\w-]{1,24}$/.test(m.key) && !keys.has(m.key) ? m.key : `m${i + 1}`;
    keys.add(key);
    const items = (Array.isArray(m.items) ? m.items : []).slice(0, 40).map((it, j) => {
      if (!it || typeof it !== 'object') throw bad(`item ${j + 1} da refeição ${i + 1} inválido`);
      return {
        name: str(it.name, 'alimento', { max: 120 }),
        ...(Number.isInteger(it.tacoId) && it.tacoId > 0 && it.tacoId < 10000 ? { tacoId: it.tacoId } : {}),
        grams: numOr(it.grams, 0, 5000, 'quantidade') ?? 0,
        measure: str(it.measure, 'medida caseira', { opt: true, max: 60 }),
        kcal: numOr(it.kcal, 0, 10000, 'calorias') ?? 0,
        protein: numOr(it.protein, 0, 1000, 'proteína') ?? 0,
        carbs: numOr(it.carbs, 0, 1000, 'carboidrato') ?? 0,
        fat: numOr(it.fat, 0, 1000, 'gordura') ?? 0
      };
    });
    return {
      key, name: str(m.name || `Refeição ${i + 1}`, 'nome da refeição', { max: 60 }),
      time: typeof m.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(m.time) ? m.time : '',
      items, notes: str(m.notes, 'observações', { opt: true, max: 500 })
    };
  });
}
export function cleanTargets(t = {}) {
  return {
    kcal: numOr(t.kcal, 0, 10000, 'meta de calorias'), protein: numOr(t.protein, 0, 1000, 'meta de proteína'),
    carbs: numOr(t.carbs, 0, 2000, 'meta de carboidrato'), fat: numOr(t.fat, 0, 1000, 'meta de gordura'), water_ml: numOr(t.water_ml, 0, 10000, 'meta de água')
  };
}

/** Share of planned meals ticked off, per day, for `days` days ending `today`. */
export function adherence(meals, logs, today, days = 7) {
  const out = [];
  const end = new Date(today + 'T00:00:00Z');
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end); d.setUTCDate(d.getUTCDate() - i);
    const day = d.toISOString().slice(0, 10);
    const done = new Set(logs.filter(l => l.date === day && l.done).map(l => l.meal_key));
    const planned = meals.length;
    out.push({ date: day, done: meals.filter(m => done.has(m.key)).length, planned });
  }
  const totalPlanned = out.reduce((n, x) => n + x.planned, 0);
  const totalDone = out.reduce((n, x) => n + x.done, 0);
  return { days: out, pct: totalPlanned ? Math.round((totalDone / totalPlanned) * 100) : 0 };
}

const PHOTO_MAX = 600 * 1024;
const decodeImage = dataUrl => {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw bad('envie a foto como JPG, PNG ou WebP');
  const buf = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0));
  if (buf.length > PHOTO_MAX) throw bad('foto grande demais (máximo 600 KB)');
  const ok = (buf[0] === 0xff && buf[1] === 0xd8) || (buf[0] === 0x89 && buf[1] === 0x50) || String.fromCharCode(...buf.slice(8, 12)) === 'WEBP';
  if (!ok) throw bad('o arquivo não é uma imagem válida');
  return { buf, type: 'image/' + m[1] };
};

export function registerFollowup(route, { sql, audit }) {
  const student = async (gymId, mid) => {
    const [m] = await sql`select * from opengym.gym_members where id = ${mid} and gym_id = ${gymId}`;
    if (!m) throw notFound('aluno');
    return m;
  };

  /* ---- assessments ---- */
  route('GET', '/gyms/:gymId/members/:memberId/assessments', STAFF, async ctx => {
    await student(ctx.gym.id, ctx.params.memberId);
    return { assessments: await sql`select * from opengym.gym_assessments where gym_id = ${ctx.gym.id} and member_id = ${ctx.params.memberId} order by date desc, created_at desc` };
  });
  route('POST', '/gyms/:gymId/members/:memberId/assessments', STAFF, async ctx => {
    const m = await student(ctx.gym.id, ctx.params.memberId);
    const a = cleanAssessment(await ctx.body());
    const [row] = await sql`insert into opengym.gym_assessments ${sql({ ...a, perimeters: sql.json(a.perimeters), bio: sql.json(a.bio), gym_id: ctx.gym.id, member_id: m.id, created_by_member: ctx.member?.id || null })} returning *`;
    await audit(ctx, 'assessment.create', { memberId: m.id });
    return { __status: 201, body: { assessment: row } };
  });
  route('PUT', '/gyms/:gymId/assessments/:assessmentId', STAFF, async ctx => {
    const a = cleanAssessment(await ctx.body());
    const [row] = await sql`update opengym.gym_assessments set ${sql({ ...a, perimeters: sql.json(a.perimeters), bio: sql.json(a.bio) })}
      where id = ${ctx.params.assessmentId} and gym_id = ${ctx.gym.id} returning *`;
    if (!row) throw notFound('avaliação');
    return { assessment: row };
  });
  route('DELETE', '/gyms/:gymId/assessments/:assessmentId', STAFF, async ctx => {
    const r = await sql`delete from opengym.gym_assessments where id = ${ctx.params.assessmentId} and gym_id = ${ctx.gym.id} returning id`;
    if (!r.length) throw notFound('avaliação');
    await audit(ctx, 'assessment.delete', { assessmentId: ctx.params.assessmentId });
    return { ok: true };
  });

  /* ---- meal plans ---- */
  const planBody = async ctx => {
    const b = await ctx.body();
    return { name: str(b.name, 'nome do plano', { max: 120 }), notes: str(b.notes, 'orientações', { opt: true, max: 3000 }), targets: cleanTargets(b.targets || {}), meals: cleanMeals(b.meals) };
  };
  route('GET', '/gyms/:gymId/members/:memberId/meal-plans', STAFF, async ctx => {
    await student(ctx.gym.id, ctx.params.memberId);
    return { plans: await sql`select * from opengym.gym_meal_plans where gym_id = ${ctx.gym.id} and member_id = ${ctx.params.memberId} order by status, updated_at desc` };
  });
  route('POST', '/gyms/:gymId/members/:memberId/meal-plans', STAFF, async ctx => {
    const m = await student(ctx.gym.id, ctx.params.memberId);
    const p = await planBody(ctx);
    const row = await sql.begin(async tx => {
      // One plan is followed at a time: a new one retires the previous.
      await tx`update opengym.gym_meal_plans set status = 'archived', updated_at = now() where gym_id = ${ctx.gym.id} and member_id = ${m.id} and status = 'active'`;
      const [r] = await tx`insert into opengym.gym_meal_plans ${tx({ ...p, targets: tx.json(p.targets), meals: tx.json(p.meals), gym_id: ctx.gym.id, member_id: m.id, created_by_member: ctx.member?.id || null })} returning *`;
      return r;
    });
    await audit(ctx, 'mealplan.create', { memberId: m.id });
    return { __status: 201, body: { plan: row } };
  });
  route('PUT', '/gyms/:gymId/meal-plans/:planId', STAFF, async ctx => {
    const p = await planBody(ctx);
    const [row] = await sql`update opengym.gym_meal_plans set ${sql({ ...p, targets: sql.json(p.targets), meals: sql.json(p.meals) })}, updated_at = now()
      where id = ${ctx.params.planId} and gym_id = ${ctx.gym.id} returning *`;
    if (!row) throw notFound('plano alimentar');
    return { plan: row };
  });
  route('POST', '/gyms/:gymId/meal-plans/:planId/archive', STAFF, async ctx => {
    const r = await sql`update opengym.gym_meal_plans set status = 'archived', updated_at = now() where id = ${ctx.params.planId} and gym_id = ${ctx.gym.id} returning id`;
    if (!r.length) throw notFound('plano alimentar');
    return { ok: true };
  });
  // The trainer's view of the diary: what was eaten, notes, photos, adherence.
  route('GET', '/gyms/:gymId/members/:memberId/food-logs', STAFF, async ctx => {
    await student(ctx.gym.id, ctx.params.memberId);
    const [plan] = await sql`select * from opengym.gym_meal_plans where gym_id = ${ctx.gym.id} and member_id = ${ctx.params.memberId} and status = 'active' order by updated_at desc limit 1`;
    if (!plan) return { plan: null, logs: [], adherence: null };
    const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const logs = await sql`select id, date, meal_key, done, note, (photo is not null) as has_photo, updated_at from opengym.gym_food_logs
      where plan_id = ${plan.id} and date >= ${since} order by date desc`;
    return { plan, logs, adherence: adherence(plan.meals, logs, todayDate(), 7) };
  });
  route('GET', '/gyms/:gymId/food-logs/:logId/photo', ROLES, async ctx => {
    const [l] = await sql`select l.photo, l.photo_type, l.member_id from opengym.gym_food_logs l where l.id = ${ctx.params.logId} and l.gym_id = ${ctx.gym.id}`;
    if (!l?.photo) throw notFound('foto');
    if (ctx.role === 'student' && l.member_id !== ctx.member?.id) throw forbidden();
    return new Response(l.photo, { status: 200, headers: { 'Content-Type': l.photo_type, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
  });

  /* ---- the student's side ---- */
  route('GET', '/gyms/:gymId/my/assessments', ROLES, async ctx => {
    if (!ctx.member) return { assessments: [] };
    return { assessments: await sql`select * from opengym.gym_assessments where gym_id = ${ctx.gym.id} and member_id = ${ctx.member.id} order by date desc, created_at desc` };
  });
  route('GET', '/gyms/:gymId/my/meal-plan', ROLES, async ctx => {
    if (!ctx.member) return { plan: null, logs: [], adherence: null };
    const [plan] = await sql`select * from opengym.gym_meal_plans where gym_id = ${ctx.gym.id} and member_id = ${ctx.member.id} and status = 'active' order by updated_at desc limit 1`;
    if (!plan) return { plan: null, logs: [], adherence: null };
    const since = new Date(Date.now() - 8 * 86400000).toISOString().slice(0, 10);
    const logs = await sql`select id, date, meal_key, done, note, (photo is not null) as has_photo from opengym.gym_food_logs where plan_id = ${plan.id} and date >= ${since}`;
    return { plan, logs, adherence: adherence(plan.meals, logs, todayDate(), 7) };
  });
  route('PUT', '/gyms/:gymId/my/meal-plan/:planId/log', ROLES, async ctx => {
    if (!ctx.member) throw forbidden();
    const [plan] = await sql`select * from opengym.gym_meal_plans where id = ${ctx.params.planId} and gym_id = ${ctx.gym.id} and member_id = ${ctx.member.id}`;
    if (!plan) throw notFound('plano alimentar');
    const b = await ctx.body();
    const day = date(b.date, 'data', { opt: true }) || todayDate();
    if (!plan.meals.some(m => m.key === b.mealKey)) throw bad('refeição inválida');
    const photo = b.photoDataUrl ? decodeImage(b.photoDataUrl) : null;
    const row = { gym_id: ctx.gym.id, member_id: ctx.member.id, plan_id: plan.id, date: day, meal_key: b.mealKey, done: b.done !== false, note: str(b.note, 'observação', { opt: true, max: 500 }) };
    const [l] = photo
      ? await sql`insert into opengym.gym_food_logs ${sql({ ...row, photo: photo.buf, photo_type: photo.type })}
          on conflict (plan_id, date, meal_key) do update set done = excluded.done, note = excluded.note, photo = excluded.photo, photo_type = excluded.photo_type, updated_at = now()
          returning id, date, meal_key, done, note, (photo is not null) as has_photo`
      : await sql`insert into opengym.gym_food_logs ${sql(row)}
          on conflict (plan_id, date, meal_key) do update set done = excluded.done, note = excluded.note, updated_at = now()
          returning id, date, meal_key, done, note, (photo is not null) as has_photo`;
    return { log: l };
  });
}
