/* Academies: sign-up, profile, logo, the caller's own memberships and the dashboard. */
import fs from 'node:fs';
import path from 'node:path';
import { saasConfig, ADMIN, STAFF, ROLES } from './roles.js';
import { tx } from './db.js';
import { seedCategories } from './ledger.js';
import { str, bad, notFound, slugify, SaasError } from './util.js';
import { todayDate, monthRange, monthOf } from './calc.js';

const LOGO_MAX = 1024 * 1024;
const LOGO_TYPES = [
  { ext: 'png', type: 'image/png', test: b => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { ext: 'jpg', type: 'image/jpeg', test: b => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'webp', type: 'image/webp', test: b => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' }
];
const COLOR = /^#[0-9a-fA-F]{6}$/;

export function publicGym(g) {
  if (!g) return null;
  const { settings_json, created_by, logo_file, ...rest } = g;
  let settings = {};
  try { settings = JSON.parse(settings_json || '{}'); } catch { /* keep {} */ }
  return { ...rest, settings, logoUrl: logo_file ? `/api/saas/gyms/${g.id}/logo?v=${g.logo_version}` : null };
}

export function registerGyms(route, { db, audit, newId, nowIso, dataDir }) {
  const logoDir = () => path.join(dataDir, 'saas-logos');

  route('GET', '/config', 'public', () => saasConfig());

  // Who the caller is on the platform: every academy they belong to, with their role there.
  route('GET', '/me', 'user', ctx => {
    const rows = db().prepare(`SELECT m.id AS member_id, m.role, m.status AS member_status, g.*
      FROM memberships m JOIN gyms g ON g.id = m.gym_id
      WHERE m.user_id = ? AND m.status = 'active' ORDER BY g.name`).all(ctx.user.id);
    return {
      user: { id: ctx.user.id, name: ctx.user.name },
      platformAdmin: ctx.platformAdmin,
      memberships: rows.map(r => {
        const { member_id, role, member_status, ...g } = r;
        return { memberId: member_id, role, gym: publicGym(g) };
      }),
      config: saasConfig()
    };
  });

  route('POST', '/gyms', 'user', async ctx => {
    const cfg = saasConfig();
    if (!cfg.publicGymSignup && !ctx.platformAdmin) throw new SaasError(403, 'o cadastro de novas academias está fechado nesta plataforma');
    const b = await ctx.body();
    const name = str(b.name, 'nome da academia', { max: 120 });
    const base = slugify(b.slug || name);
    let slug = base;
    for (let i = 2; db().prepare('SELECT 1 FROM gyms WHERE slug = ?').get(slug); i++) slug = `${base}-${i}`;
    const id = newId(); const now = nowIso();
    tx(db(), () => {
      db().prepare(`INSERT INTO gyms (id, name, slug, legal_name, document, email, phone, address, primary_color, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, name, slug,
        str(b.legalName, 'razão social', { opt: true, max: 160 }), str(b.document, 'CNPJ', { opt: true, max: 30 }),
        str(b.email, 'e-mail', { opt: true, max: 160 }), str(b.phone, 'telefone', { opt: true, max: 40 }),
        str(b.address, 'endereço', { opt: true, max: 300 }), COLOR.test(b.primaryColor || '') ? b.primaryColor : '#2563eb',
        ctx.user.id, now);
      db().prepare(`INSERT INTO memberships (id, gym_id, user_id, role, name, created_at, updated_at) VALUES (?, ?, ?, 'gym_admin', ?, ?, ?)`)
        .run(newId(), id, ctx.user.id, ctx.user.name || 'Administrador', now, now);
      seedCategories(db(), id);
    });
    ctx.gym = { id };
    audit(ctx, 'gym.create', { name });
    return { __status: 201, body: publicGym(db().prepare('SELECT * FROM gyms WHERE id = ?').get(id)) };
  });

  // A person who got an invite code from an academy links it to the profile they are signed in with.
  route('POST', '/join', 'user', async ctx => {
    const b = await ctx.body();
    const code = str(b.code, 'código', { max: 20 }).toUpperCase().replace(/\s+/g, '');
    const m = db().prepare('SELECT * FROM memberships WHERE invite_code = ?').get(code);
    if (!m) throw bad('código de convite inválido ou já usado');
    if (m.user_id) throw bad('este convite já foi usado');
    if (db().prepare('SELECT 1 FROM memberships WHERE gym_id = ? AND user_id = ?').get(m.gym_id, ctx.user.id)) {
      throw bad('você já faz parte desta academia');
    }
    db().prepare("UPDATE memberships SET user_id = ?, invite_code = NULL, status = 'active', updated_at = ? WHERE id = ?").run(ctx.user.id, nowIso(), m.id);
    ctx.gym = { id: m.gym_id };
    audit(ctx, 'member.join', { memberId: m.id });
    return { gym: publicGym(db().prepare('SELECT * FROM gyms WHERE id = ?').get(m.gym_id)), role: m.role, memberId: m.id };
  });

  route('GET', '/gyms/:gymId', ROLES, ctx => ({ gym: publicGym(ctx.gym), role: ctx.role, memberId: ctx.member?.id || null }));

  route('PUT', '/gyms/:gymId', ADMIN, async ctx => {
    const b = await ctx.body();
    const g = ctx.gym;
    const next = {
      name: b.name !== undefined ? str(b.name, 'nome da academia', { max: 120 }) : g.name,
      legal_name: b.legalName !== undefined ? str(b.legalName, 'razão social', { opt: true, max: 160 }) : g.legal_name,
      document: b.document !== undefined ? str(b.document, 'CNPJ', { opt: true, max: 30 }) : g.document,
      email: b.email !== undefined ? str(b.email, 'e-mail', { opt: true, max: 160 }) : g.email,
      phone: b.phone !== undefined ? str(b.phone, 'telefone', { opt: true, max: 40 }) : g.phone,
      address: b.address !== undefined ? str(b.address, 'endereço', { opt: true, max: 300 }) : g.address,
      primary_color: b.primaryColor !== undefined ? (COLOR.test(b.primaryColor) ? b.primaryColor : (() => { throw bad('cor inválida, use #RRGGBB'); })()) : g.primary_color
    };
    let settings = {};
    try { settings = JSON.parse(g.settings_json || '{}'); } catch { /* reset */ }
    if (b.settings && typeof b.settings === 'object' && !Array.isArray(b.settings)) {
      const s = b.settings;
      if (s.allowCredit !== undefined) settings.allowCredit = !!s.allowCredit;
      if (s.defaultDueDay !== undefined) {
        const d = Number(s.defaultDueDay);
        if (!Number.isInteger(d) || d < 1 || d > 28) throw bad('dia de vencimento deve ser de 1 a 28');
        settings.defaultDueDay = d;
      }
      if (s.welcomeMessage !== undefined) settings.welcomeMessage = str(s.welcomeMessage, 'mensagem', { opt: true, max: 500 });
    }
    db().prepare(`UPDATE gyms SET name = ?, legal_name = ?, document = ?, email = ?, phone = ?, address = ?, primary_color = ?, settings_json = ? WHERE id = ?`)
      .run(next.name, next.legal_name, next.document, next.email, next.phone, next.address, next.primary_color, JSON.stringify(settings), g.id);
    audit(ctx, 'gym.update', {});
    return { gym: publicGym(db().prepare('SELECT * FROM gyms WHERE id = ?').get(g.id)) };
  });

  // The logo arrives as a data URL; only PNG, JPEG and WebP are kept (never SVG: it can carry script).
  route('PUT', '/gyms/:gymId/logo', ADMIN, async ctx => {
    const b = await ctx.body();
    const m = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(b.dataUrl || ''));
    if (!m) throw bad('envie a logo como PNG, JPG ou WebP');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > LOGO_MAX) throw bad('a logo pode ter no máximo 1 MB');
    const kind = LOGO_TYPES.find(t => t.test(buf));
    if (!kind) throw bad('o arquivo não é uma imagem PNG, JPG ou WebP válida');
    fs.mkdirSync(logoDir(), { recursive: true });
    const file = `${ctx.gym.id}.${kind.ext}`;
    for (const t of LOGO_TYPES) { if (t.ext !== kind.ext) fs.rmSync(path.join(logoDir(), `${ctx.gym.id}.${t.ext}`), { force: true }); }
    const tmp = path.join(logoDir(), `.${file}.${process.pid}.tmp`);
    fs.writeFileSync(tmp, buf, { mode: 0o600 });
    fs.renameSync(tmp, path.join(logoDir(), file));
    db().prepare('UPDATE gyms SET logo_file = ?, logo_version = logo_version + 1 WHERE id = ?').run(file, ctx.gym.id);
    audit(ctx, 'gym.logo', {});
    return { gym: publicGym(db().prepare('SELECT * FROM gyms WHERE id = ?').get(ctx.gym.id)) };
  });

  route('DELETE', '/gyms/:gymId/logo', ADMIN, ctx => {
    if (ctx.gym.logo_file) fs.rmSync(path.join(logoDir(), ctx.gym.logo_file), { force: true });
    db().prepare('UPDATE gyms SET logo_file = NULL, logo_version = logo_version + 1 WHERE id = ?').run(ctx.gym.id);
    return { gym: publicGym(db().prepare('SELECT * FROM gyms WHERE id = ?').get(ctx.gym.id)) };
  });

  // Public: a logo is shown on the sign-in page of an academy, before anyone is signed in.
  route('GET', '/gyms/:gymId/logo', 'public', ctx => {
    const g = db().prepare('SELECT logo_file FROM gyms WHERE id = ?').get(ctx.params.gymId);
    if (!g?.logo_file) throw notFound('logo');
    const kind = LOGO_TYPES.find(t => g.logo_file.endsWith('.' + t.ext));
    let buf;
    try { buf = fs.readFileSync(path.join(logoDir(), path.basename(g.logo_file))); } catch { throw notFound('logo'); }
    ctx.res.writeHead(200, {
      'Content-Type': kind.type, 'Content-Length': buf.length,
      'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'"
    });
    ctx.res.end(buf);
  });

  route('GET', '/gyms/:gymId/dashboard', STAFF, ctx => {
    const gid = ctx.gym.id;
    const today = todayDate();
    const month = monthOf(today);
    const { from, to } = monthRange(month);
    const d = db();
    const count = (sql, ...a) => d.prepare(sql).get(...a).n;
    const students = count("SELECT COUNT(*) AS n FROM memberships WHERE gym_id = ? AND role = 'student' AND status = 'active'", gid);
    const staff = count("SELECT COUNT(*) AS n FROM memberships WHERE gym_id = ? AND role != 'student' AND status = 'active'", gid);
    const base = {
      gym: publicGym(ctx.gym), role: ctx.role, month,
      students, staff,
      workouts: count('SELECT COUNT(*) AS n FROM workout_templates WHERE gym_id = ? AND archived = 0', gid),
      activeAssignments: count("SELECT COUNT(*) AS n FROM workout_assignments WHERE gym_id = ? AND status = 'active'", gid),
      studentsWithoutWorkout: count(`SELECT COUNT(*) AS n FROM memberships m WHERE m.gym_id = ? AND m.role = 'student' AND m.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM workout_assignments a WHERE a.student_member_id = m.id AND a.status = 'active')`, gid)
    };
    if (ctx.role !== 'gym_admin') {
      const mine = ctx.member ? count("SELECT COUNT(*) AS n FROM memberships WHERE gym_id = ? AND trainer_member_id = ? AND status = 'active'", gid, ctx.member.id) : 0;
      return { ...base, myStudents: mine };
    }
    const sum = (sql, ...a) => d.prepare(sql).get(...a).s || 0;
    const income = sum("SELECT SUM(amount_cents) AS s FROM transactions WHERE gym_id = ? AND kind = 'income' AND status = 'active' AND date BETWEEN ? AND ?", gid, from, to);
    const expense = sum("SELECT SUM(amount_cents) AS s FROM transactions WHERE gym_id = ? AND kind = 'expense' AND status = 'active' AND date BETWEEN ? AND ?", gid, from, to);
    const overdue = d.prepare("SELECT COUNT(*) AS n, SUM(amount_cents) AS s FROM charges WHERE gym_id = ? AND status = 'open' AND due_date < ?").get(gid, today);
    const openCharges = d.prepare("SELECT COUNT(*) AS n, SUM(amount_cents) AS s FROM charges WHERE gym_id = ? AND status = 'open'").get(gid);
    const salesToday = d.prepare("SELECT COUNT(*) AS n, SUM(total_cents) AS s FROM sales WHERE gym_id = ? AND status = 'completed' AND substr(created_at, 1, 10) = ?").get(gid, new Date().toISOString().slice(0, 10));
    const salesMonth = sum("SELECT SUM(total_cents) AS s FROM sales WHERE gym_id = ? AND status = 'completed' AND substr(created_at, 1, 7) = ?", gid, month);
    const lowProducts = d.prepare('SELECT id, name, stock_qty, min_qty FROM products WHERE gym_id = ? AND active = 1 AND track_stock = 1 AND stock_qty <= min_qty ORDER BY name LIMIT 20').all(gid);
    const lowSupplies = d.prepare('SELECT id, name, unit, stock_qty, min_qty FROM supply_items WHERE gym_id = ? AND active = 1 AND stock_qty <= min_qty ORDER BY name LIMIT 20').all(gid);
    const cash = d.prepare("SELECT id, opened_at, opening_cents FROM cash_sessions WHERE gym_id = ? AND status = 'open'").get(gid) || null;
    const daily = d.prepare(`SELECT date, SUM(CASE WHEN kind = 'income' THEN amount_cents ELSE 0 END) AS income,
      SUM(CASE WHEN kind = 'expense' THEN amount_cents ELSE 0 END) AS expense
      FROM transactions WHERE gym_id = ? AND status = 'active' AND date BETWEEN ? AND ? GROUP BY date ORDER BY date`).all(gid, from, to);
    return {
      ...base,
      finance: { incomeCents: income, expenseCents: expense, balanceCents: income - expense, daily },
      charges: { overdueCount: overdue.n, overdueCents: overdue.s || 0, openCount: openCharges.n, openCents: openCharges.s || 0 },
      sales: { todayCount: salesToday.n, todayCents: salesToday.s || 0, monthCents: salesMonth },
      lowStock: { products: lowProducts, supplies: lowSupplies },
      cash
    };
  });

}
