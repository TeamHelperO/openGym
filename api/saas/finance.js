/* Finance of an academy: membership plans, subscriptions, monthly charges, the book of income and
 * expenses, and the cash-flow report. Administrators only: a trainer never sees money. */
import { ADMIN } from './roles.js';
import { tx, newId, nowIso } from './db.js';
import { str, cents, date, oneOf, num, bad, notFound, PAYMENT_METHODS } from './util.js';
import { addTransaction, systemCategory, cancelTransaction } from './ledger.js';
import { todayDate, monthOf, isMonth, dueDateFor, billsInMonth, monthRange } from './calc.js';

/** A plan subscription for a student. Shared with members.js (sign a student up on creation). */
export function createSubscription(db, { gymId, memberId, planId, startDate, dueDay, priceCents, gym }) {
  const plan = db.prepare('SELECT * FROM plans WHERE id = ? AND gym_id = ? AND active = 1').get(planId, gymId);
  if (!plan) throw bad('plano inválido');
  const m = db.prepare("SELECT id FROM memberships WHERE id = ? AND gym_id = ? AND role = 'student'").get(memberId, gymId);
  if (!m) throw bad('aluno inválido');
  let settings = {};
  try { settings = JSON.parse(gym?.settings_json || '{}'); } catch { /* defaults */ }
  const start = date(startDate, 'início', { opt: true }) || todayDate();
  const day = dueDay != null && dueDay !== '' ? num(dueDay, 'dia de vencimento', { min: 1, max: 28, int: true }) : (settings.defaultDueDay || Math.min(28, Number(start.slice(8, 10))));
  const price = priceCents != null && priceCents !== '' ? cents(priceCents, 'valor') : plan.price_cents;
  const id = newId();
  db.prepare('INSERT INTO subscriptions (id, gym_id, member_id, plan_id, price_cents, start_date, due_day, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, gymId, memberId, plan.id, price, start, day, nowIso());
  return id;
}

/** Charges of `month` for every active subscription that bills in it. Idempotent per month. */
export function generateCharges(db, gymId, month) {
  const subs = db.prepare(`SELECT s.*, p.name AS plan_name, p.interval_months FROM subscriptions s JOIN plans p ON p.id = s.plan_id
    JOIN memberships m ON m.id = s.member_id WHERE s.gym_id = ? AND s.status = 'active' AND m.status = 'active'`).all(gymId);
  const ins = db.prepare(`INSERT OR IGNORE INTO charges (id, gym_id, member_id, subscription_id, description, amount_cents, due_date, reference_month, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  let created = 0;
  for (const s of subs) {
    if (!billsInMonth(s, month) || s.price_cents <= 0) continue;
    const [y, m] = month.split('-');
    const r = ins.run(newId(), gymId, s.member_id, s.id, `${s.plan_name} (${m}/${y})`, s.price_cents, dueDateFor(month, s.due_day), month, nowIso());
    created += r.changes;
  }
  return created;
}

/** Mark a charge paid and book its income. */
export function payCharge(db, { gymId, charge, method, amountCents, paidDate, userId }) {
  const amount = amountCents ?? charge.amount_cents;
  const cat = systemCategory(db, gymId, charge.subscription_id ? 'fees' : charge.sale_id ? 'pos' : 'other_income');
  const tid = addTransaction(db, { gymId, kind: 'income', categoryId: cat, description: charge.description, amountCents: amount, date: paidDate, paymentMethod: method, source: 'charge', sourceId: charge.id, userId });
  db.prepare("UPDATE charges SET status = 'paid', paid_at = ?, paid_amount_cents = ?, payment_method = ?, transaction_id = ? WHERE id = ?")
    .run(paidDate, amount, method, tid, charge.id);
  return tid;
}

export function registerFinance(route, { db, audit }) {
  /* ---- plans ---- */
  route('GET', '/gyms/:gymId/plans', ADMIN, ctx => ({
    plans: db().prepare(`SELECT p.*, (SELECT COUNT(*) FROM subscriptions s WHERE s.plan_id = p.id AND s.status = 'active') AS active_subscriptions
      FROM plans p WHERE p.gym_id = ? ORDER BY p.active DESC, p.price_cents`).all(ctx.gym.id)
  }));
  route('POST', '/gyms/:gymId/plans', ADMIN, async ctx => {
    const b = await ctx.body();
    const id = newId();
    db().prepare('INSERT INTO plans (id, gym_id, name, description, price_cents, interval_months, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      id, ctx.gym.id, str(b.name, 'nome do plano', { max: 80 }), str(b.description, 'descrição', { opt: true, max: 500 }),
      cents(b.priceCents, 'valor'), num(b.intervalMonths ?? 1, 'periodicidade', { min: 1, max: 24, int: true }), nowIso());
    audit(ctx, 'plan.create', { planId: id });
    return { __status: 201, body: { plan: db().prepare('SELECT * FROM plans WHERE id = ?').get(id) } };
  });
  route('PUT', '/gyms/:gymId/plans/:planId', ADMIN, async ctx => {
    const p = db().prepare('SELECT * FROM plans WHERE id = ? AND gym_id = ?').get(ctx.params.planId, ctx.gym.id);
    if (!p) throw notFound('plano');
    const b = await ctx.body();
    db().prepare('UPDATE plans SET name = ?, description = ?, price_cents = ?, interval_months = ?, active = ? WHERE id = ?').run(
      b.name !== undefined ? str(b.name, 'nome do plano', { max: 80 }) : p.name,
      b.description !== undefined ? str(b.description, 'descrição', { opt: true, max: 500 }) : p.description,
      b.priceCents !== undefined ? cents(b.priceCents, 'valor') : p.price_cents,
      b.intervalMonths !== undefined ? num(b.intervalMonths, 'periodicidade', { min: 1, max: 24, int: true }) : p.interval_months,
      b.active !== undefined ? (b.active ? 1 : 0) : p.active, p.id);
    return { plan: db().prepare('SELECT * FROM plans WHERE id = ?').get(p.id) };
  });

  /* ---- subscriptions ---- */
  route('GET', '/gyms/:gymId/subscriptions', ADMIN, ctx => ({
    subscriptions: db().prepare(`SELECT s.*, p.name AS plan_name, m.name AS member_name FROM subscriptions s
      JOIN plans p ON p.id = s.plan_id JOIN memberships m ON m.id = s.member_id
      WHERE s.gym_id = ? AND (? = 'all' OR s.status = 'active') ORDER BY m.name COLLATE NOCASE`).all(ctx.gym.id, ctx.query.get('status') || 'active')
  }));
  route('POST', '/gyms/:gymId/subscriptions', ADMIN, async ctx => {
    const b = await ctx.body();
    const id = tx(db(), () => createSubscription(db(), { gymId: ctx.gym.id, memberId: b.memberId, planId: b.planId, startDate: b.startDate, dueDay: b.dueDay, priceCents: b.priceCents, gym: ctx.gym }));
    // The month it starts in is billed right away, so a new student shows up as owing today.
    if (b.chargeNow !== false) generateCharges(db(), ctx.gym.id, monthOf(todayDate()));
    audit(ctx, 'subscription.create', { subscriptionId: id });
    return { __status: 201, body: { subscription: db().prepare('SELECT * FROM subscriptions WHERE id = ?').get(id) } };
  });
  route('POST', '/gyms/:gymId/subscriptions/:subId/cancel', ADMIN, async ctx => {
    const b = await ctx.body();
    tx(db(), () => {
      const r = db().prepare("UPDATE subscriptions SET status = 'canceled', canceled_at = ? WHERE id = ? AND gym_id = ? AND status = 'active'").run(nowIso(), ctx.params.subId, ctx.gym.id);
      if (!r.changes) throw notFound('assinatura');
      if (b.cancelOpenCharges) db().prepare("UPDATE charges SET status = 'canceled' WHERE subscription_id = ? AND status = 'open'").run(ctx.params.subId);
    });
    audit(ctx, 'subscription.cancel', { subscriptionId: ctx.params.subId });
    return { ok: true };
  });

  /* ---- charges ---- */
  route('GET', '/gyms/:gymId/charges', ADMIN, ctx => {
    const q = ctx.query;
    const where = ['c.gym_id = ?']; const args = [ctx.gym.id];
    const status = q.get('status');
    const today = todayDate();
    if (status === 'overdue') { where.push("c.status = 'open' AND c.due_date < ?"); args.push(today); }
    else if (status && status !== 'all') { where.push('c.status = ?'); args.push(oneOf(status, 'situação', ['open', 'paid', 'canceled'])); }
    const month = q.get('month');
    if (month) { if (!isMonth(month)) throw bad('mês inválido'); const r = monthRange(month); where.push('c.due_date BETWEEN ? AND ?'); args.push(r.from, r.to); }
    if (q.get('memberId')) { where.push('c.member_id = ?'); args.push(q.get('memberId')); }
    const rows = db().prepare(`SELECT c.*, m.name AS member_name, m.phone AS member_phone FROM charges c JOIN memberships m ON m.id = c.member_id
      WHERE ${where.join(' AND ')} ORDER BY c.due_date, m.name COLLATE NOCASE LIMIT 2000`).all(...args);
    return { charges: rows.map(c => ({ ...c, overdue: c.status === 'open' && c.due_date < today })) };
  });
  route('POST', '/gyms/:gymId/charges', ADMIN, async ctx => {
    const b = await ctx.body();
    const m = db().prepare('SELECT id FROM memberships WHERE id = ? AND gym_id = ?').get(b.memberId, ctx.gym.id);
    if (!m) throw bad('pessoa inválida');
    const id = newId();
    db().prepare('INSERT INTO charges (id, gym_id, member_id, description, amount_cents, due_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      id, ctx.gym.id, m.id, str(b.description, 'descrição', { max: 200 }), cents(b.amountCents, 'valor', { positive: true }), date(b.dueDate, 'vencimento'), nowIso());
    audit(ctx, 'charge.create', { chargeId: id });
    return { __status: 201, body: { charge: db().prepare('SELECT * FROM charges WHERE id = ?').get(id) } };
  });
  route('POST', '/gyms/:gymId/charges/generate', ADMIN, async ctx => {
    const b = await ctx.body();
    const month = b.month || monthOf(todayDate());
    if (!isMonth(month)) throw bad('mês inválido');
    const created = tx(db(), () => generateCharges(db(), ctx.gym.id, month));
    audit(ctx, 'charge.generate', { month, created });
    return { created, month };
  });
  route('POST', '/gyms/:gymId/charges/:chargeId/pay', ADMIN, async ctx => {
    const b = await ctx.body();
    const c = db().prepare('SELECT * FROM charges WHERE id = ? AND gym_id = ?').get(ctx.params.chargeId, ctx.gym.id);
    if (!c) throw notFound('cobrança');
    if (c.status !== 'open') throw bad('esta cobrança não está em aberto');
    const method = oneOf(b.paymentMethod, 'forma de pagamento', PAYMENT_METHODS, { opt: true, def: 'pix' });
    const amount = b.amountCents != null ? cents(b.amountCents, 'valor', { positive: true }) : c.amount_cents;
    const when = date(b.date, 'data do pagamento', { opt: true }) || todayDate();
    tx(db(), () => payCharge(db(), { gymId: ctx.gym.id, charge: c, method, amountCents: amount, paidDate: when, userId: ctx.user.id }));
    audit(ctx, 'charge.pay', { chargeId: c.id, amount });
    return { charge: db().prepare('SELECT * FROM charges WHERE id = ?').get(c.id) };
  });
  // Undo a payment booked by mistake: the charge is open again and its income is canceled.
  route('POST', '/gyms/:gymId/charges/:chargeId/reopen', ADMIN, ctx => {
    const c = db().prepare('SELECT * FROM charges WHERE id = ? AND gym_id = ?').get(ctx.params.chargeId, ctx.gym.id);
    if (!c) throw notFound('cobrança');
    if (c.status === 'open') throw bad('a cobrança já está em aberto');
    tx(db(), () => {
      cancelTransaction(db(), ctx.gym.id, c.transaction_id);
      db().prepare("UPDATE charges SET status = 'open', paid_at = NULL, paid_amount_cents = NULL, payment_method = NULL, transaction_id = NULL WHERE id = ?").run(c.id);
    });
    audit(ctx, 'charge.reopen', { chargeId: c.id });
    return { charge: db().prepare('SELECT * FROM charges WHERE id = ?').get(c.id) };
  });
  route('POST', '/gyms/:gymId/charges/:chargeId/cancel', ADMIN, ctx => {
    const r = db().prepare("UPDATE charges SET status = 'canceled' WHERE id = ? AND gym_id = ? AND status = 'open'").run(ctx.params.chargeId, ctx.gym.id);
    if (!r.changes) throw bad('só cobranças em aberto podem ser canceladas');
    audit(ctx, 'charge.cancel', { chargeId: ctx.params.chargeId });
    return { ok: true };
  });

  /* ---- categories and transactions ---- */
  route('GET', '/gyms/:gymId/categories', ADMIN, ctx => ({
    categories: db().prepare('SELECT * FROM finance_categories WHERE gym_id = ? ORDER BY kind, name COLLATE NOCASE').all(ctx.gym.id)
  }));
  route('POST', '/gyms/:gymId/categories', ADMIN, async ctx => {
    const b = await ctx.body();
    const id = newId();
    db().prepare('INSERT INTO finance_categories (id, gym_id, name, kind) VALUES (?, ?, ?, ?)').run(id, ctx.gym.id, str(b.name, 'nome', { max: 80 }), oneOf(b.kind, 'tipo', ['income', 'expense']));
    return { __status: 201, body: { category: db().prepare('SELECT * FROM finance_categories WHERE id = ?').get(id) } };
  });
  route('DELETE', '/gyms/:gymId/categories/:categoryId', ADMIN, ctx => {
    const c = db().prepare('SELECT * FROM finance_categories WHERE id = ? AND gym_id = ?').get(ctx.params.categoryId, ctx.gym.id);
    if (!c) throw notFound('categoria');
    if (c.system_key) throw bad('categorias do sistema não podem ser removidas');
    db().prepare('DELETE FROM finance_categories WHERE id = ?').run(c.id);
    return { ok: true };
  });

  route('GET', '/gyms/:gymId/transactions', ADMIN, ctx => {
    const q = ctx.query;
    const today = todayDate();
    const from = date(q.get('from'), 'de', { opt: true }) || monthRange(monthOf(today)).from;
    const to = date(q.get('to'), 'até', { opt: true }) || monthRange(monthOf(today)).to;
    const where = ['t.gym_id = ?', 't.date BETWEEN ? AND ?']; const args = [ctx.gym.id, from, to];
    if (q.get('kind')) { where.push('t.kind = ?'); args.push(oneOf(q.get('kind'), 'tipo', ['income', 'expense'])); }
    if (q.get('categoryId')) { where.push('t.category_id = ?'); args.push(q.get('categoryId')); }
    if (q.get('includeCanceled') !== '1') where.push("t.status = 'active'");
    const rows = db().prepare(`SELECT t.*, c.name AS category_name FROM transactions t LEFT JOIN finance_categories c ON c.id = t.category_id
      WHERE ${where.join(' AND ')} ORDER BY t.date DESC, t.created_at DESC LIMIT 5000`).all(...args);
    return { from, to, transactions: rows };
  });
  route('POST', '/gyms/:gymId/transactions', ADMIN, async ctx => {
    const b = await ctx.body();
    const kind = oneOf(b.kind, 'tipo', ['income', 'expense']);
    let categoryId = b.categoryId || null;
    if (categoryId && !db().prepare('SELECT 1 FROM finance_categories WHERE id = ? AND gym_id = ? AND kind = ?').get(categoryId, ctx.gym.id, kind)) throw bad('categoria inválida para este tipo');
    if (!categoryId) categoryId = systemCategory(db(), ctx.gym.id, kind === 'income' ? 'other_income' : 'other_expense');
    const id = addTransaction(db(), {
      gymId: ctx.gym.id, kind, categoryId, description: str(b.description, 'descrição', { max: 200 }),
      amountCents: cents(b.amountCents, 'valor', { positive: true }), date: date(b.date, 'data', { opt: true }) || todayDate(),
      paymentMethod: oneOf(b.paymentMethod, 'forma de pagamento', PAYMENT_METHODS, { opt: true, def: 'pix' }), userId: ctx.user.id
    });
    audit(ctx, 'transaction.create', { transactionId: id, kind });
    return { __status: 201, body: { transaction: db().prepare('SELECT * FROM transactions WHERE id = ?').get(id) } };
  });
  route('POST', '/gyms/:gymId/transactions/:txId/cancel', ADMIN, ctx => {
    const t = db().prepare('SELECT * FROM transactions WHERE id = ? AND gym_id = ?').get(ctx.params.txId, ctx.gym.id);
    if (!t) throw notFound('lançamento');
    // A fee, sale or purchase is undone where it was made, so the two records never disagree.
    if (t.source !== 'manual') throw bad('este lançamento veio de uma cobrança, venda ou compra: estorne por lá');
    cancelTransaction(db(), ctx.gym.id, t.id);
    audit(ctx, 'transaction.cancel', { transactionId: t.id });
    return { ok: true };
  });

  // Cash flow of a period: totals, per category, per day, and per payment method.
  route('GET', '/gyms/:gymId/cashflow', ADMIN, ctx => {
    const q = ctx.query;
    const today = todayDate();
    const from = date(q.get('from'), 'de', { opt: true }) || monthRange(monthOf(today)).from;
    const to = date(q.get('to'), 'até', { opt: true }) || monthRange(monthOf(today)).to;
    const d = db(); const g = ctx.gym.id;
    const base = "FROM transactions t LEFT JOIN finance_categories c ON c.id = t.category_id WHERE t.gym_id = ? AND t.status = 'active' AND t.date BETWEEN ? AND ?";
    const totals = d.prepare(`SELECT t.kind, SUM(t.amount_cents) AS total ${base} GROUP BY t.kind`).all(g, from, to);
    const income = totals.find(x => x.kind === 'income')?.total || 0;
    const expense = totals.find(x => x.kind === 'expense')?.total || 0;
    const before = d.prepare(`SELECT SUM(CASE WHEN kind = 'income' THEN amount_cents ELSE -amount_cents END) AS s FROM transactions WHERE gym_id = ? AND status = 'active' AND date < ?`).get(g, from).s || 0;
    return {
      from, to,
      openingBalanceCents: before,
      incomeCents: income, expenseCents: expense, resultCents: income - expense,
      closingBalanceCents: before + income - expense,
      byCategory: d.prepare(`SELECT t.kind, COALESCE(c.name, 'Sem categoria') AS category, SUM(t.amount_cents) AS total ${base} GROUP BY t.kind, category ORDER BY t.kind, total DESC`).all(g, from, to),
      byDay: d.prepare(`SELECT t.date, SUM(CASE WHEN t.kind = 'income' THEN t.amount_cents ELSE 0 END) AS income, SUM(CASE WHEN t.kind = 'expense' THEN t.amount_cents ELSE 0 END) AS expense ${base} GROUP BY t.date ORDER BY t.date`).all(g, from, to),
      byMethod: d.prepare(`SELECT t.payment_method AS method, t.kind, SUM(t.amount_cents) AS total ${base} GROUP BY method, t.kind ORDER BY total DESC`).all(g, from, to),
      receivable: d.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(amount_cents), 0) AS total FROM charges WHERE gym_id = ? AND status = 'open'").get(g)
    };
  });
}
