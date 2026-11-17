// Finance: plans, subscriptions, monthly charges, entries and exits, cash flow. Administrators only.
import { ADMIN } from './roles.js';
import { str, cents, date, oneOf, num, bad, notFound, PAYMENT_METHODS, id as uuid, isUuid } from './util.js';
import { addTransaction, systemCategory, cancelTransaction } from './ledger.js';
import { todayDate, monthOf, isMonth, dueDateFor, billsInMonth, monthRange } from './calc.js';

/** A plan subscription for a student (q is sql or a transaction). */
export async function createSubscription(q, { gymId, memberId, planId, startDate, dueDay, priceCents, gym }) {
  uuid(planId, 'plano'); uuid(memberId, 'aluno');
  const [plan] = await q`select * from opengym.gym_plans where id = ${planId} and gym_id = ${gymId} and active`;
  if (!plan) throw bad('plano inválido');
  const [m] = await q`select id from opengym.gym_members where id = ${memberId} and gym_id = ${gymId} and role = 'student'`;
  if (!m) throw bad('aluno inválido');
  const settings = gym?.settings || {};
  const start = date(startDate, 'início', { opt: true }) || todayDate();
  const day = dueDay != null && dueDay !== '' ? num(dueDay, 'dia de vencimento', { min: 1, max: 28, int: true }) : (settings.defaultDueDay || Math.min(28, Number(start.slice(8, 10))));
  const price = priceCents != null && priceCents !== '' ? cents(priceCents, 'valor') : plan.price_cents;
  const [s] = await q`insert into opengym.gym_subscriptions (gym_id, member_id, plan_id, price_cents, start_date, due_day)
    values (${gymId}, ${memberId}, ${plan.id}, ${price}, ${start}, ${day}) returning id`;
  return s.id;
}

/** Charges of `month` for every active subscription that bills in it. Idempotent per month. */
export async function generateCharges(q, gymId, month) {
  const subs = await q`select s.*, p.name as plan_name, p.interval_months from opengym.gym_subscriptions s
    join opengym.gym_plans p on p.id = s.plan_id join opengym.gym_members m on m.id = s.member_id
    where s.gym_id = ${gymId} and s.status = 'active' and m.status = 'active'`;
  let created = 0;
  for (const s of subs) {
    if (!billsInMonth(s, month) || s.price_cents <= 0) continue;
    const [y, mm] = month.split('-');
    const r = await q`insert into opengym.gym_charges (gym_id, member_id, subscription_id, description, amount_cents, due_date, reference_month)
      values (${gymId}, ${s.member_id}, ${s.id}, ${`${s.plan_name} (${mm}/${y})`}, ${s.price_cents}, ${dueDateFor(month, s.due_day)}, ${month})
      on conflict (subscription_id, reference_month) where subscription_id is not null do nothing returning id`;
    created += r.length;
  }
  return created;
}

export async function payCharge(q, { gymId, charge, method, amountCents, paidDate, userId }) {
  const amount = amountCents ?? charge.amount_cents;
  const cat = await systemCategory(q, gymId, charge.subscription_id ? 'fees' : charge.sale_id ? 'pos' : 'other_income');
  const tid = await addTransaction(q, { gymId, kind: 'income', categoryId: cat, description: charge.description, amountCents: amount, date: paidDate, paymentMethod: method, source: 'charge', sourceId: charge.id, userId });
  await q`update opengym.gym_charges set status = 'paid', paid_at = ${paidDate}, paid_amount_cents = ${amount}, payment_method = ${method}, transaction_id = ${tid} where id = ${charge.id}`;
  return tid;
}

export function registerFinance(route, { sql, audit }) {
  /* ---- plans ---- */
  route('GET', '/gyms/:gymId/plans', ADMIN, async ctx => ({
    plans: await sql`select p.*, (select count(*)::int from opengym.gym_subscriptions s where s.plan_id = p.id and s.status = 'active') as active_subscriptions
      from opengym.gym_plans p where p.gym_id = ${ctx.gym.id} order by p.active desc, p.price_cents`
  }));
  route('POST', '/gyms/:gymId/plans', ADMIN, async ctx => {
    const b = await ctx.body();
    const [p] = await sql`insert into opengym.gym_plans (gym_id, name, description, price_cents, interval_months)
      values (${ctx.gym.id}, ${str(b.name, 'nome do plano', { max: 80 })}, ${str(b.description, 'descrição', { opt: true, max: 500 })},
        ${cents(b.priceCents, 'valor')}, ${num(b.intervalMonths ?? 1, 'periodicidade', { min: 1, max: 24, int: true })}) returning *`;
    await audit(ctx, 'plan.create', { planId: p.id });
    return { __status: 201, body: { plan: p } };
  });
  route('PUT', '/gyms/:gymId/plans/:planId', ADMIN, async ctx => {
    const [p] = await sql`select * from opengym.gym_plans where id = ${ctx.params.planId} and gym_id = ${ctx.gym.id}`;
    if (!p) throw notFound('plano');
    const b = await ctx.body();
    const [out] = await sql`update opengym.gym_plans set
      name = ${b.name !== undefined ? str(b.name, 'nome do plano', { max: 80 }) : p.name},
      description = ${b.description !== undefined ? str(b.description, 'descrição', { opt: true, max: 500 }) : p.description},
      price_cents = ${b.priceCents !== undefined ? cents(b.priceCents, 'valor') : p.price_cents},
      interval_months = ${b.intervalMonths !== undefined ? num(b.intervalMonths, 'periodicidade', { min: 1, max: 24, int: true }) : p.interval_months},
      active = ${b.active !== undefined ? !!b.active : p.active}
      where id = ${p.id} returning *`;
    return { plan: out };
  });

  /* ---- subscriptions ---- */
  route('GET', '/gyms/:gymId/subscriptions', ADMIN, async ctx => ({
    subscriptions: await sql`select s.*, p.name as plan_name, m.name as member_name from opengym.gym_subscriptions s
      join opengym.gym_plans p on p.id = s.plan_id join opengym.gym_members m on m.id = s.member_id
      where s.gym_id = ${ctx.gym.id} ${ctx.query.get('status') === 'all' ? sql`` : sql`and s.status = 'active'`} order by lower(m.name)`
  }));
  route('POST', '/gyms/:gymId/subscriptions', ADMIN, async ctx => {
    const b = await ctx.body();
    const sid = await sql.begin(async tx => {
      const s = await createSubscription(tx, { gymId: ctx.gym.id, memberId: b.memberId, planId: b.planId, startDate: b.startDate, dueDay: b.dueDay, priceCents: b.priceCents, gym: ctx.gym });
      // The month it starts in is billed right away, so a new student shows up as owing today.
      if (b.chargeNow !== false) await generateCharges(tx, ctx.gym.id, monthOf(todayDate()));
      return s;
    });
    await audit(ctx, 'subscription.create', { subscriptionId: sid });
    const [s] = await sql`select * from opengym.gym_subscriptions where id = ${sid}`;
    return { __status: 201, body: { subscription: s } };
  });
  route('POST', '/gyms/:gymId/subscriptions/:subId/cancel', ADMIN, async ctx => {
    const b = await ctx.body();
    await sql.begin(async tx => {
      const r = await tx`update opengym.gym_subscriptions set status = 'canceled', canceled_at = now() where id = ${ctx.params.subId} and gym_id = ${ctx.gym.id} and status = 'active' returning id`;
      if (!r.length) throw notFound('assinatura');
      if (b.cancelOpenCharges) await tx`update opengym.gym_charges set status = 'canceled' where subscription_id = ${ctx.params.subId} and status = 'open'`;
    });
    await audit(ctx, 'subscription.cancel', { subscriptionId: ctx.params.subId });
    return { ok: true };
  });

  /* ---- charges ---- */
  route('GET', '/gyms/:gymId/charges', ADMIN, async ctx => {
    const q = ctx.query;
    const today = todayDate();
    const status = q.get('status');
    if (status && !['all', 'overdue'].includes(status)) oneOf(status, 'situação', ['open', 'paid', 'canceled']);
    const month = q.get('month');
    if (month && !isMonth(month)) throw bad('mês inválido');
    const r = month ? monthRange(month) : null;
    const mid = q.get('memberId');
    const rows = await sql`select c.*, m.name as member_name, m.phone as member_phone from opengym.gym_charges c join opengym.gym_members m on m.id = c.member_id
      where c.gym_id = ${ctx.gym.id}
        ${status === 'overdue' ? sql`and c.status = 'open' and c.due_date < ${today}` : status && status !== 'all' ? sql`and c.status = ${status}` : sql``}
        ${r ? sql`and c.due_date between ${r.from} and ${r.to}` : sql``}
        ${mid && isUuid(mid) ? sql`and c.member_id = ${mid}` : sql``}
      order by c.due_date, lower(m.name) limit 2000`;
    return { charges: rows.map(c => ({ ...c, overdue: c.status === 'open' && c.due_date < today })) };
  });
  route('POST', '/gyms/:gymId/charges', ADMIN, async ctx => {
    const b = await ctx.body();
    uuid(b.memberId, 'pessoa');
    const [m] = await sql`select id from opengym.gym_members where id = ${b.memberId} and gym_id = ${ctx.gym.id}`;
    if (!m) throw bad('pessoa inválida');
    const [c] = await sql`insert into opengym.gym_charges (gym_id, member_id, description, amount_cents, due_date)
      values (${ctx.gym.id}, ${m.id}, ${str(b.description, 'descrição', { max: 200 })}, ${cents(b.amountCents, 'valor', { positive: true })}, ${date(b.dueDate, 'vencimento')}) returning *`;
    await audit(ctx, 'charge.create', { chargeId: c.id });
    return { __status: 201, body: { charge: c } };
  });
  route('POST', '/gyms/:gymId/charges/generate', ADMIN, async ctx => {
    const b = await ctx.body();
    const month = b.month || monthOf(todayDate());
    if (!isMonth(month)) throw bad('mês inválido');
    const created = await sql.begin(tx => generateCharges(tx, ctx.gym.id, month));
    await audit(ctx, 'charge.generate', { month, created });
    return { created, month };
  });
  route('POST', '/gyms/:gymId/charges/:chargeId/pay', ADMIN, async ctx => {
    const b = await ctx.body();
    const [c] = await sql`select * from opengym.gym_charges where id = ${ctx.params.chargeId} and gym_id = ${ctx.gym.id}`;
    if (!c) throw notFound('cobrança');
    if (c.status !== 'open') throw bad('esta cobrança não está em aberto');
    const method = oneOf(b.paymentMethod, 'forma de pagamento', PAYMENT_METHODS, { opt: true, def: 'pix' });
    const amount = b.amountCents != null ? cents(b.amountCents, 'valor', { positive: true }) : c.amount_cents;
    const when = date(b.date, 'data do pagamento', { opt: true }) || todayDate();
    await sql.begin(tx => payCharge(tx, { gymId: ctx.gym.id, charge: c, method, amountCents: amount, paidDate: when, userId: ctx.user.id }));
    await audit(ctx, 'charge.pay', { chargeId: c.id, amount });
    const [out] = await sql`select * from opengym.gym_charges where id = ${c.id}`;
    return { charge: out };
  });
  route('POST', '/gyms/:gymId/charges/:chargeId/reopen', ADMIN, async ctx => {
    const [c] = await sql`select * from opengym.gym_charges where id = ${ctx.params.chargeId} and gym_id = ${ctx.gym.id}`;
    if (!c) throw notFound('cobrança');
    if (c.status === 'open') throw bad('a cobrança já está em aberto');
    await sql.begin(async tx => {
      await cancelTransaction(tx, ctx.gym.id, c.transaction_id);
      await tx`update opengym.gym_charges set status = 'open', paid_at = null, paid_amount_cents = null, payment_method = null, transaction_id = null where id = ${c.id}`;
    });
    await audit(ctx, 'charge.reopen', { chargeId: c.id });
    const [out] = await sql`select * from opengym.gym_charges where id = ${c.id}`;
    return { charge: out };
  });
  route('POST', '/gyms/:gymId/charges/:chargeId/cancel', ADMIN, async ctx => {
    const r = await sql`update opengym.gym_charges set status = 'canceled' where id = ${ctx.params.chargeId} and gym_id = ${ctx.gym.id} and status = 'open' returning id`;
    if (!r.length) throw bad('só cobranças em aberto podem ser canceladas');
    await audit(ctx, 'charge.cancel', { chargeId: ctx.params.chargeId });
    return { ok: true };
  });

  /* ---- categories and transactions ---- */
  route('GET', '/gyms/:gymId/categories', ADMIN, async ctx => ({
    categories: await sql`select * from opengym.gym_categories where gym_id = ${ctx.gym.id} order by kind, lower(name)`
  }));
  route('POST', '/gyms/:gymId/categories', ADMIN, async ctx => {
    const b = await ctx.body();
    const [c] = await sql`insert into opengym.gym_categories (gym_id, name, kind) values (${ctx.gym.id}, ${str(b.name, 'nome', { max: 80 })}, ${oneOf(b.kind, 'tipo', ['income', 'expense'])}) returning *`;
    return { __status: 201, body: { category: c } };
  });
  route('DELETE', '/gyms/:gymId/categories/:categoryId', ADMIN, async ctx => {
    const [c] = await sql`select * from opengym.gym_categories where id = ${ctx.params.categoryId} and gym_id = ${ctx.gym.id}`;
    if (!c) throw notFound('categoria');
    if (c.system_key) throw bad('categorias do sistema não podem ser removidas');
    await sql`delete from opengym.gym_categories where id = ${c.id}`;
    return { ok: true };
  });

  const period = q => {
    const today = todayDate();
    return {
      from: date(q.get('from'), 'de', { opt: true }) || monthRange(monthOf(today)).from,
      to: date(q.get('to'), 'até', { opt: true }) || monthRange(monthOf(today)).to
    };
  };
  route('GET', '/gyms/:gymId/transactions', ADMIN, async ctx => {
    const q = ctx.query;
    const { from, to } = period(q);
    const kind = q.get('kind') ? oneOf(q.get('kind'), 'tipo', ['income', 'expense']) : null;
    const cat = q.get('categoryId');
    const rows = await sql`select t.*, c.name as category_name from opengym.gym_transactions t left join opengym.gym_categories c on c.id = t.category_id
      where t.gym_id = ${ctx.gym.id} and t.date between ${from} and ${to}
        ${kind ? sql`and t.kind = ${kind}` : sql``} ${cat && isUuid(cat) ? sql`and t.category_id = ${cat}` : sql``}
        ${q.get('includeCanceled') === '1' ? sql`` : sql`and t.status = 'active'`}
      order by t.date desc, t.created_at desc limit 5000`;
    return { from, to, transactions: rows };
  });
  route('POST', '/gyms/:gymId/transactions', ADMIN, async ctx => {
    const b = await ctx.body();
    const kind = oneOf(b.kind, 'tipo', ['income', 'expense']);
    let categoryId = b.categoryId || null;
    if (categoryId) {
      uuid(categoryId, 'categoria');
      if (!(await sql`select 1 from opengym.gym_categories where id = ${categoryId} and gym_id = ${ctx.gym.id} and kind = ${kind}`).length) throw bad('categoria inválida para este tipo');
    } else categoryId = await systemCategory(sql, ctx.gym.id, kind === 'income' ? 'other_income' : 'other_expense');
    const tid = await addTransaction(sql, {
      gymId: ctx.gym.id, kind, categoryId, description: str(b.description, 'descrição', { max: 200 }),
      amountCents: cents(b.amountCents, 'valor', { positive: true }), date: date(b.date, 'data', { opt: true }) || todayDate(),
      paymentMethod: oneOf(b.paymentMethod, 'forma de pagamento', PAYMENT_METHODS, { opt: true, def: 'pix' }), userId: ctx.user.id
    });
    await audit(ctx, 'transaction.create', { transactionId: tid, kind });
    const [t] = await sql`select * from opengym.gym_transactions where id = ${tid}`;
    return { __status: 201, body: { transaction: t } };
  });
  route('POST', '/gyms/:gymId/transactions/:txId/cancel', ADMIN, async ctx => {
    const [t] = await sql`select * from opengym.gym_transactions where id = ${ctx.params.txId} and gym_id = ${ctx.gym.id}`;
    if (!t) throw notFound('lançamento');
    if (t.source !== 'manual') throw bad('este lançamento veio de uma cobrança, venda ou compra: estorne por lá');
    await cancelTransaction(sql, ctx.gym.id, t.id);
    await audit(ctx, 'transaction.cancel', { transactionId: t.id });
    return { ok: true };
  });

  route('GET', '/gyms/:gymId/cashflow', ADMIN, async ctx => {
    const { from, to } = period(ctx.query);
    const g = ctx.gym.id;
    const totals = await sql`select kind, coalesce(sum(amount_cents), 0)::int total from opengym.gym_transactions
      where gym_id = ${g} and status = 'active' and date between ${from} and ${to} group by kind`;
    const income = totals.find(x => x.kind === 'income')?.total || 0;
    const expense = totals.find(x => x.kind === 'expense')?.total || 0;
    const [before] = await sql`select coalesce(sum(case when kind = 'income' then amount_cents else -amount_cents end), 0)::int s
      from opengym.gym_transactions where gym_id = ${g} and status = 'active' and date < ${from}`;
    const [receivable] = await sql`select count(*)::int as count, coalesce(sum(amount_cents), 0)::int as total from opengym.gym_charges where gym_id = ${g} and status = 'open'`;
    return {
      from, to,
      openingBalanceCents: before.s, incomeCents: income, expenseCents: expense, resultCents: income - expense,
      closingBalanceCents: before.s + income - expense,
      byCategory: await sql`select t.kind, coalesce(c.name, 'Sem categoria') as category, sum(t.amount_cents)::int total
        from opengym.gym_transactions t left join opengym.gym_categories c on c.id = t.category_id
        where t.gym_id = ${g} and t.status = 'active' and t.date between ${from} and ${to} group by t.kind, 2 order by t.kind, total desc`,
      byDay: await sql`select date, coalesce(sum(case when kind = 'income' then amount_cents else 0 end), 0)::int income,
        coalesce(sum(case when kind = 'expense' then amount_cents else 0 end), 0)::int expense
        from opengym.gym_transactions where gym_id = ${g} and status = 'active' and date between ${from} and ${to} group by date order by date`,
      byMethod: await sql`select payment_method as method, kind, sum(amount_cents)::int total from opengym.gym_transactions
        where gym_id = ${g} and status = 'active' and date between ${from} and ${to} group by payment_method, kind order by total desc`,
      receivable
    };
  });
}
