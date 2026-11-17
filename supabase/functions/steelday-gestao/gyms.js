// Academies: sign-up, profile, logo, signup link and own domain, the caller's memberships, dashboard.
import { saasConfig, ADMIN, STAFF, ROLES } from './roles.js';
import { seedCategories } from './ledger.js';
import { str, bad, notFound, slugify, SaasError, GYM_COLS } from './util.js';
import { todayDate, monthRange, monthOf } from './calc.js';
import { nextAccessId } from './members.js';

const LOGO_MAX = 1024 * 1024;
const LOGO_TYPES = [
  { ext: 'png', type: 'image/png', test: b => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { ext: 'jpg', type: 'image/jpeg', test: b => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'webp', type: 'image/webp', test: b => b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP' }
];
const COLOR = /^#[0-9a-fA-F]{6}$/;
const DOMAIN = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
export const hostOf = req => String(req.headers.get('x-forwarded-host') || req.headers.get('host') || '').split(',')[0].trim().toLowerCase().replace(/:\d+$/, '');
const settingsOf = g => (g.settings && typeof g.settings === 'object' ? g.settings : {});

export function publicGym(g) {
  if (!g) return null;
  const { created_by, logo, logo_type, ...rest } = g;
  return { ...rest, settings: settingsOf(g), logoUrl: logo_type ? `/api/saas/gyms/${g.id}/logo?v=${g.logo_version}` : null, signupPath: `#/a/${g.slug}` };
}

/** What a visitor sees of an academy before signing in: its face, never its data. */
export function brandOf(g) {
  if (!g) return null;
  const s = settingsOf(g);
  return {
    id: g.id, name: g.name, slug: g.slug, primary_color: g.primary_color, status: g.status,
    logoUrl: g.logo_type ? `/api/saas/gyms/${g.id}/logo?v=${g.logo_version}` : null,
    publicSignup: s.publicSignup !== false && g.status === 'active',
    welcomeMessage: s.welcomeMessage || ''
  };
}

const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

export function registerGyms(route, { sql, audit }) {
  const gymById = async id => (await sql`select ${sql(GYM_COLS)} from opengym.gyms where id = ${id}`)[0] || null;

  route('GET', '/config', 'public', () => saasConfig());

  route('GET', '/me', 'user', async ctx => {
    const rows = await sql`select m.id as member_id, m.role, ${sql(GYM_COLS.map(c => 'g.' + c))}
      from opengym.gym_members m join opengym.gyms g on g.id = m.gym_id
      where m.user_id = ${ctx.user.id} and m.status = 'active' order by g.name`;
    return {
      user: { id: ctx.user.id, name: ctx.user.name },
      platformAdmin: ctx.platformAdmin,
      memberships: rows.map(r => {
        const { member_id, role, ...g } = r;
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
    const row = {
      name,
      legal_name: str(b.legalName, 'razão social', { opt: true, max: 160 }), document: str(b.document, 'CNPJ', { opt: true, max: 30 }),
      email: str(b.email, 'e-mail', { opt: true, max: 160 }), phone: str(b.phone, 'telefone', { opt: true, max: 40 }),
      address: str(b.address, 'endereço', { opt: true, max: 300 }), primary_color: COLOR.test(b.primaryColor || '') ? b.primaryColor : '#2563eb'
    };
    const id = await sql.begin(async tx => {
      await tx`select pg_advisory_xact_lock(hashtext('opengym.gym-slug'))`;
      let slug = base;
      for (let i = 2; (await tx`select 1 from opengym.gyms where slug = ${slug}`).length; i++) slug = `${base}-${i}`;
      const [g] = await tx`insert into opengym.gyms ${tx({ ...row, slug, created_by: ctx.user.id })} returning id`;
      await tx`insert into opengym.gym_members (gym_id, user_id, role, name, email, access_id)
        values (${g.id}, ${ctx.user.id}, 'gym_admin', ${ctx.user.name || 'Administrador'}, ${ctx.user.email || ''}, 1001)`;
      await seedCategories(tx, g.id);
      return g.id;
    });
    ctx.gym = { id };
    await audit(ctx, 'gym.create', { name });
    return { __status: 201, body: publicGym(await gymById(id)) };
  });

  /* ---- an academy's own front door: its signup link and its own domain ---- */
  route('GET', '/public/gym', 'public', async ctx => {
    const slug = ctx.query.get('slug');
    const [g] = slug
      ? await sql`select ${sql(GYM_COLS)} from opengym.gyms where slug = ${String(slug).toLowerCase()}`
      : await sql`select ${sql(GYM_COLS)} from opengym.gyms where custom_domain = ${hostOf(ctx.req)}`;
    return { gym: brandOf(g) };
  });

  // For a proxy that issues certificates on demand: 200 only for a domain an academy claimed.
  route('GET', '/public/domain-check', 'public', async ctx => {
    const d = String(ctx.query.get('domain') || '').toLowerCase();
    const [g] = d ? await sql`select 1 from opengym.gyms where custom_domain = ${d} and status = 'active'` : [];
    if (!g) return { __status: 404, body: { ok: false } };
    return { ok: true };
  });

  // Signing up through an academy's link: the profile becomes one of its students.
  route('POST', '/public/join/:slug', 'user', async ctx => {
    const [g] = await sql`select ${sql(GYM_COLS)} from opengym.gyms where slug = ${String(ctx.params.slug).toLowerCase()}`;
    const brand = brandOf(g);
    if (!brand) throw notFound('academia');
    const [have] = await sql`select * from opengym.gym_members where gym_id = ${g.id} and user_id = ${ctx.user.id}`;
    if (have) return { gym: publicGym(g), role: have.role, memberId: have.id, already: true };
    if (!brand.publicSignup) throw new SaasError(403, 'esta academia não aceita cadastro pelo link. Peça um código de convite na recepção.');
    const m = await sql.begin(async tx => {
      await tx`select pg_advisory_xact_lock(hashtext(${'opengym.gym-access.' + g.id}))`;
      const [row] = await tx`insert into opengym.gym_members (gym_id, user_id, role, name, email, joined_via, access_id)
        values (${g.id}, ${ctx.user.id}, 'student', ${ctx.user.name || 'Aluno'}, ${ctx.user.email || ''}, 'link', ${await nextAccessId(tx, g.id)}) returning id`;
      return row;
    });
    ctx.gym = g;
    await audit(ctx, 'member.signup-link', { memberId: m.id });
    return { __status: 201, body: { gym: publicGym(g), role: 'student', memberId: m.id } };
  });

  // A person who got an invite code links it to the profile they are signed in with.
  route('POST', '/join', 'user', async ctx => {
    const b = await ctx.body();
    const code = str(b.code, 'código', { max: 20 }).toUpperCase().replace(/\s+/g, '');
    const [m] = await sql`select * from opengym.gym_members where invite_code = ${code}`;
    if (!m) throw bad('código de convite inválido ou já usado');
    if (m.user_id) throw bad('este convite já foi usado');
    if ((await sql`select 1 from opengym.gym_members where gym_id = ${m.gym_id} and user_id = ${ctx.user.id}`).length) throw bad('você já faz parte desta academia');
    await sql`update opengym.gym_members set user_id = ${ctx.user.id}, invite_code = null, status = 'active', updated_at = now() where id = ${m.id}`;
    ctx.gym = { id: m.gym_id };
    await audit(ctx, 'member.join', { memberId: m.id });
    return { gym: publicGym(await gymById(m.gym_id)), role: m.role, memberId: m.id };
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
      primary_color: g.primary_color,
      custom_domain: g.custom_domain
    };
    if (b.primaryColor !== undefined) {
      if (!COLOR.test(b.primaryColor)) throw bad('cor inválida, use #RRGGBB');
      next.primary_color = b.primaryColor;
    }
    if (b.customDomain !== undefined) {
      const d = String(b.customDomain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      if (!d) next.custom_domain = null;
      else {
        if (!DOMAIN.test(d)) throw bad('domínio inválido. Ex.: app.minhaacademia.com.br');
        if ((await sql`select 1 from opengym.gyms where custom_domain = ${d} and id <> ${g.id}`).length) throw bad('este domínio já está em uso por outra academia');
        next.custom_domain = d;
      }
    }
    const settings = { ...settingsOf(g) };
    if (b.settings && typeof b.settings === 'object' && !Array.isArray(b.settings)) {
      const s = b.settings;
      if (s.allowCredit !== undefined) settings.allowCredit = !!s.allowCredit;
      if (s.defaultDueDay !== undefined) {
        const d = Number(s.defaultDueDay);
        if (!Number.isInteger(d) || d < 1 || d > 28) throw bad('dia de vencimento deve ser de 1 a 28');
        settings.defaultDueDay = d;
      }
      if (s.welcomeMessage !== undefined) settings.welcomeMessage = str(s.welcomeMessage, 'mensagem', { opt: true, max: 500 });
      if (s.publicSignup !== undefined) settings.publicSignup = !!s.publicSignup;
      if (s.access && typeof s.access === 'object') {
        const a = s.access, cur = { ...(settings.access || {}) };
        if (a.blockOverdue !== undefined) cur.blockOverdue = !!a.blockOverdue;
        if (a.requirePlan !== undefined) cur.requirePlan = !!a.requirePlan;
        if (a.graceDays !== undefined) {
          const n = Number(a.graceDays);
          if (!Number.isInteger(n) || n < 0 || n > 60) throw bad('tolerância deve ser de 0 a 60 dias');
          cur.graceDays = n;
        }
        settings.access = cur;
      }
    }
    await sql`update opengym.gyms set ${sql(next)}, settings = ${sql.json(settings)} where id = ${g.id}`;
    await audit(ctx, 'gym.update', {});
    return { gym: publicGym(await gymById(g.id)) };
  });

  // The logo arrives as a data URL; only PNG, JPEG and WebP are kept (never SVG: it can carry script).
  route('PUT', '/gyms/:gymId/logo', ADMIN, async ctx => {
    const b = await ctx.body();
    const m = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(b.dataUrl || ''));
    if (!m) throw bad('envie a logo como PNG, JPG ou WebP');
    const buf = b64(m[2]);
    if (buf.length > LOGO_MAX) throw bad('a logo pode ter no máximo 1 MB');
    const kind = LOGO_TYPES.find(t => t.test(buf));
    if (!kind) throw bad('o arquivo não é uma imagem PNG, JPG ou WebP válida');
    await sql`update opengym.gyms set logo = ${buf}, logo_type = ${kind.type}, logo_version = logo_version + 1 where id = ${ctx.gym.id}`;
    await audit(ctx, 'gym.logo', {});
    return { gym: publicGym(await gymById(ctx.gym.id)) };
  });

  route('DELETE', '/gyms/:gymId/logo', ADMIN, async ctx => {
    await sql`update opengym.gyms set logo = null, logo_type = null, logo_version = logo_version + 1 where id = ${ctx.gym.id}`;
    return { gym: publicGym(await gymById(ctx.gym.id)) };
  });

  // Public: a logo is shown on the sign-in page of an academy, before anyone is signed in.
  route('GET', '/gyms/:gymId/logo', 'public', async ctx => {
    const [g] = await sql`select logo, logo_type from opengym.gyms where id = ${ctx.params.gymId}`;
    if (!g?.logo) throw notFound('logo');
    return new Response(g.logo, { status: 200, headers: {
      'Content-Type': g.logo_type, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'"
    } });
  });

  route('GET', '/gyms/:gymId/dashboard', STAFF, async ctx => {
    const gid = ctx.gym.id;
    const today = todayDate();
    const month = monthOf(today);
    const { from, to } = monthRange(month);
    const utcDay = new Date().toISOString().slice(0, 10);
    const n = async q => (await q)[0].n;
    const base = {
      gym: publicGym(ctx.gym), role: ctx.role, month,
      students: await n(sql`select count(*)::int n from opengym.gym_members where gym_id = ${gid} and role = 'student' and status = 'active'`),
      staff: await n(sql`select count(*)::int n from opengym.gym_members where gym_id = ${gid} and role <> 'student' and status = 'active'`),
      workouts: await n(sql`select count(*)::int n from opengym.gym_workouts where gym_id = ${gid} and not archived`),
      activeAssignments: await n(sql`select count(*)::int n from opengym.gym_assignments where gym_id = ${gid} and status = 'active'`),
      studentsWithoutWorkout: await n(sql`select count(*)::int n from opengym.gym_members m where m.gym_id = ${gid} and m.role = 'student' and m.status = 'active'
        and not exists (select 1 from opengym.gym_assignments a where a.student_member_id = m.id and a.status = 'active')`),
      presentToday: await n(sql`select count(distinct member_id)::int n from opengym.gym_access_logs where gym_id = ${gid} and allowed and to_char(at at time zone 'UTC', 'YYYY-MM-DD') = ${utcDay}`),
      setup: {
        logo: !!ctx.gym.logo_type,
        plans: (await n(sql`select count(*)::int n from opengym.gym_plans where gym_id = ${gid}`)) > 0,
        staff: (await n(sql`select count(*)::int n from opengym.gym_members where gym_id = ${gid} and role = 'trainer'`)) > 0,
        students: (await n(sql`select count(*)::int n from opengym.gym_members where gym_id = ${gid} and role = 'student'`)) > 0,
        workouts: (await n(sql`select count(*)::int n from opengym.gym_workouts where gym_id = ${gid}`)) > 0,
        devices: (await n(sql`select count(*)::int n from opengym.gym_devices where gym_id = ${gid}`)) > 0,
        products: (await n(sql`select count(*)::int n from opengym.gym_products where gym_id = ${gid}`)) > 0
      }
    };
    if (ctx.role !== 'gym_admin') {
      const mine = ctx.member ? await n(sql`select count(*)::int n from opengym.gym_members where gym_id = ${gid} and trainer_member_id = ${ctx.member.id} and status = 'active'`) : 0;
      const { setup, ...rest } = base;
      return { ...rest, myStudents: mine };
    }
    const sum = async q => (await q)[0].s || 0;
    const income = await sum(sql`select coalesce(sum(amount_cents), 0)::int s from opengym.gym_transactions where gym_id = ${gid} and kind = 'income' and status = 'active' and date between ${from} and ${to}`);
    const expense = await sum(sql`select coalesce(sum(amount_cents), 0)::int s from opengym.gym_transactions where gym_id = ${gid} and kind = 'expense' and status = 'active' and date between ${from} and ${to}`);
    const [overdue] = await sql`select count(*)::int n, coalesce(sum(amount_cents), 0)::int s from opengym.gym_charges where gym_id = ${gid} and status = 'open' and due_date < ${today}`;
    const [openCharges] = await sql`select count(*)::int n, coalesce(sum(amount_cents), 0)::int s from opengym.gym_charges where gym_id = ${gid} and status = 'open'`;
    const [salesToday] = await sql`select count(*)::int n, coalesce(sum(total_cents), 0)::int s from opengym.gym_sales where gym_id = ${gid} and status = 'completed' and to_char(created_at at time zone 'UTC', 'YYYY-MM-DD') = ${utcDay}`;
    const salesMonth = await sum(sql`select coalesce(sum(total_cents), 0)::int s from opengym.gym_sales where gym_id = ${gid} and status = 'completed' and to_char(created_at at time zone 'UTC', 'YYYY-MM') = ${month}`);
    const lowProducts = await sql`select id, name, stock_qty, min_qty from opengym.gym_products where gym_id = ${gid} and active and track_stock and stock_qty <= min_qty order by name limit 20`;
    const lowSupplies = await sql`select id, name, unit, stock_qty, min_qty from opengym.gym_supplies where gym_id = ${gid} and active and stock_qty <= min_qty order by name limit 20`;
    const [cash] = await sql`select id, opened_at, opening_cents from opengym.gym_cash_sessions where gym_id = ${gid} and status = 'open'`;
    const daily = await sql`select date, coalesce(sum(case when kind = 'income' then amount_cents else 0 end), 0)::int income,
      coalesce(sum(case when kind = 'expense' then amount_cents else 0 end), 0)::int expense
      from opengym.gym_transactions where gym_id = ${gid} and status = 'active' and date between ${from} and ${to} group by date order by date`;
    return {
      ...base,
      finance: { incomeCents: income, expenseCents: expense, balanceCents: income - expense, daily },
      charges: { overdueCount: overdue.n, overdueCents: overdue.s, openCount: openCharges.n, openCents: openCharges.s },
      sales: { todayCount: salesToday.n, todayCents: salesToday.s, monthCents: salesMonth },
      lowStock: { products: lowProducts, supplies: lowSupplies },
      cash: cash || null
    };
  });
}
