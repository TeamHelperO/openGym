/* The academy shop (PDV): products, the cash drawer and sales. A sale takes stock out and books its
 * income in the same transaction; a sale "on account" (fiado) instead opens a charge on the
 * student, which books the income when it is paid. */
import { ADMIN, STAFF } from './roles.js';
import { tx, newId, nowIso } from './db.js';
import { str, cents, num, oneOf, bad, notFound, PAYMENT_METHODS } from './util.js';
import { addTransaction, systemCategory, moveStock, cancelTransaction } from './ledger.js';
import { saleTotals, cashExpected, todayDate } from './calc.js';

const SALE_METHODS = [...PAYMENT_METHODS, 'account'];

export function registerPos(route, { db, audit }) {
  /* ---- products ---- */
  route('GET', '/gyms/:gymId/products', STAFF, ctx => {
    const all = ctx.query.get('all') === '1';
    return { products: db().prepare(`SELECT *, (track_stock = 1 AND stock_qty <= min_qty) AS low FROM products WHERE gym_id = ? ${all ? '' : 'AND active = 1'} ORDER BY category, name COLLATE NOCASE`).all(ctx.gym.id) };
  });
  route('POST', '/gyms/:gymId/products', ADMIN, async ctx => {
    const b = await ctx.body();
    const id = newId();
    tx(db(), () => {
      db().prepare('INSERT INTO products (id, gym_id, name, sku, category, price_cents, cost_cents, min_qty, track_stock, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        id, ctx.gym.id, str(b.name, 'nome', { max: 120 }), str(b.sku, 'código', { opt: true, max: 40 }), str(b.category, 'categoria', { opt: true, max: 60 }),
        cents(b.priceCents, 'preço'), cents(b.costCents ?? 0, 'custo'), num(b.minQty ?? 0, 'estoque mínimo', { min: 0 }), b.trackStock === false ? 0 : 1, nowIso());
      const initial = num(b.stockQty ?? 0, 'estoque inicial', { min: 0 });
      if (initial > 0) moveStock(db(), { gymId: ctx.gym.id, kind: 'product', refId: id, qtyDelta: initial, reason: 'estoque inicial', userId: ctx.user.id });
    });
    audit(ctx, 'product.create', { productId: id });
    return { __status: 201, body: { product: db().prepare('SELECT * FROM products WHERE id = ?').get(id) } };
  });
  route('PUT', '/gyms/:gymId/products/:productId', ADMIN, async ctx => {
    const p = db().prepare('SELECT * FROM products WHERE id = ? AND gym_id = ?').get(ctx.params.productId, ctx.gym.id);
    if (!p) throw notFound('produto');
    const b = await ctx.body();
    db().prepare('UPDATE products SET name = ?, sku = ?, category = ?, price_cents = ?, cost_cents = ?, min_qty = ?, track_stock = ?, active = ? WHERE id = ?').run(
      b.name !== undefined ? str(b.name, 'nome', { max: 120 }) : p.name,
      b.sku !== undefined ? str(b.sku, 'código', { opt: true, max: 40 }) : p.sku,
      b.category !== undefined ? str(b.category, 'categoria', { opt: true, max: 60 }) : p.category,
      b.priceCents !== undefined ? cents(b.priceCents, 'preço') : p.price_cents,
      b.costCents !== undefined ? cents(b.costCents, 'custo') : p.cost_cents,
      b.minQty !== undefined ? num(b.minQty, 'estoque mínimo', { min: 0 }) : p.min_qty,
      b.trackStock !== undefined ? (b.trackStock ? 1 : 0) : p.track_stock,
      b.active !== undefined ? (b.active ? 1 : 0) : p.active, p.id);
    return { product: db().prepare('SELECT * FROM products WHERE id = ?').get(p.id) };
  });
  route('POST', '/gyms/:gymId/products/:productId/stock', ADMIN, async ctx => {
    const p = db().prepare('SELECT * FROM products WHERE id = ? AND gym_id = ?').get(ctx.params.productId, ctx.gym.id);
    if (!p) throw notFound('produto');
    const b = await ctx.body();
    const delta = num(b.qtyDelta, 'quantidade', { min: -1e6, max: 1e6 });
    if (delta === 0) throw bad('quantidade não pode ser zero');
    if (p.stock_qty + delta < 0) throw bad('o estoque ficaria negativo');
    moveStock(db(), { gymId: ctx.gym.id, kind: 'product', refId: p.id, qtyDelta: delta, reason: str(b.reason || 'ajuste de estoque', 'motivo', { max: 120 }), userId: ctx.user.id });
    return { product: db().prepare('SELECT * FROM products WHERE id = ?').get(p.id) };
  });

  /* ---- cash drawer ---- */
  const openSession = gymId => db().prepare("SELECT * FROM cash_sessions WHERE gym_id = ? AND status = 'open'").get(gymId) || null;
  const sessionSummary = s => {
    if (!s) return null;
    const d = db();
    const byMethod = d.prepare("SELECT payment_method AS method, COUNT(*) AS count, SUM(total_cents) AS total FROM sales WHERE session_id = ? AND status = 'completed' GROUP BY payment_method").all(s.id);
    const moves = d.prepare('SELECT * FROM cash_movements WHERE session_id = ? ORDER BY created_at').all(s.id);
    const cashSales = byMethod.find(x => x.method === 'cash')?.total || 0;
    const deposits = moves.filter(m => m.kind === 'deposit').reduce((n, m) => n + m.amount_cents, 0);
    const withdrawals = moves.filter(m => m.kind === 'withdrawal').reduce((n, m) => n + m.amount_cents, 0);
    return {
      ...s, byMethod, movements: moves,
      salesCents: byMethod.reduce((n, x) => n + (x.total || 0), 0),
      salesCount: byMethod.reduce((n, x) => n + x.count, 0),
      expectedCashCents: cashExpected({ openingCents: s.opening_cents, cashSalesCents: cashSales, depositsCents: deposits, withdrawalsCents: withdrawals })
    };
  };

  route('GET', '/gyms/:gymId/cash', STAFF, ctx => ({ session: sessionSummary(openSession(ctx.gym.id)) }));
  route('GET', '/gyms/:gymId/cash/sessions', ADMIN, ctx => ({
    sessions: db().prepare('SELECT * FROM cash_sessions WHERE gym_id = ? ORDER BY opened_at DESC LIMIT 100').all(ctx.gym.id)
  }));
  route('GET', '/gyms/:gymId/cash/sessions/:sessionId', ADMIN, ctx => {
    const s = db().prepare('SELECT * FROM cash_sessions WHERE id = ? AND gym_id = ?').get(ctx.params.sessionId, ctx.gym.id);
    if (!s) throw notFound('caixa');
    return { session: sessionSummary(s) };
  });
  route('POST', '/gyms/:gymId/cash/open', STAFF, async ctx => {
    if (openSession(ctx.gym.id)) throw bad('já existe um caixa aberto');
    const b = await ctx.body();
    const id = newId();
    db().prepare('INSERT INTO cash_sessions (id, gym_id, opening_cents, opened_by, opened_at) VALUES (?, ?, ?, ?, ?)').run(id, ctx.gym.id, cents(b.openingCents ?? 0, 'troco inicial'), ctx.user.id, nowIso());
    audit(ctx, 'cash.open', { sessionId: id });
    return { session: sessionSummary(openSession(ctx.gym.id)) };
  });
  // Sangria (withdrawal: money taken to the safe) or suprimento (deposit: change put in).
  route('POST', '/gyms/:gymId/cash/movement', STAFF, async ctx => {
    const s = openSession(ctx.gym.id);
    if (!s) throw bad('abra o caixa primeiro');
    const b = await ctx.body();
    const kind = oneOf(b.kind, 'tipo', ['withdrawal', 'deposit']);
    const amount = cents(b.amountCents, 'valor', { positive: true });
    if (kind === 'withdrawal' && amount > sessionSummary(s).expectedCashCents) throw bad('a sangria é maior que o dinheiro no caixa');
    db().prepare('INSERT INTO cash_movements (id, gym_id, session_id, kind, amount_cents, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(newId(), ctx.gym.id, s.id, kind, amount, str(b.reason, 'motivo', { opt: true, max: 200 }), ctx.user.id, nowIso());
    return { session: sessionSummary(openSession(ctx.gym.id)) };
  });
  route('POST', '/gyms/:gymId/cash/close', STAFF, async ctx => {
    const s = openSession(ctx.gym.id);
    if (!s) throw bad('não há caixa aberto');
    const b = await ctx.body();
    const sum = sessionSummary(s);
    const counted = cents(b.countedCents, 'valor contado');
    db().prepare("UPDATE cash_sessions SET status = 'closed', expected_cents = ?, counted_cents = ?, notes = ?, closed_by = ?, closed_at = ? WHERE id = ?")
      .run(sum.expectedCashCents, counted, str(b.notes, 'observações', { opt: true, max: 1000 }), ctx.user.id, nowIso(), s.id);
    audit(ctx, 'cash.close', { sessionId: s.id, difference: counted - sum.expectedCashCents });
    const closed = sessionSummary(db().prepare('SELECT * FROM cash_sessions WHERE id = ?').get(s.id));
    return { session: closed, differenceCents: counted - sum.expectedCashCents };
  });

  /* ---- sales ---- */
  route('GET', '/gyms/:gymId/sales', STAFF, ctx => {
    const q = ctx.query;
    const where = ['s.gym_id = ?']; const args = [ctx.gym.id];
    if (q.get('sessionId')) { where.push('s.session_id = ?'); args.push(q.get('sessionId')); }
    const day = q.get('date');
    if (day) { where.push('substr(s.created_at, 1, 10) = ?'); args.push(day); }
    if (ctx.role !== 'gym_admin') { where.push('s.created_by = ?'); args.push(ctx.user.id); }
    const rows = db().prepare(`SELECT s.*, m.name AS member_name FROM sales s LEFT JOIN memberships m ON m.id = s.member_id
      WHERE ${where.join(' AND ')} ORDER BY s.created_at DESC LIMIT 500`).all(...args);
    const items = db().prepare('SELECT * FROM sale_items WHERE sale_id = ?');
    return { sales: rows.map(r => ({ ...r, items: items.all(r.id) })) };
  });

  route('POST', '/gyms/:gymId/sales', STAFF, async ctx => {
    const b = await ctx.body();
    const session = openSession(ctx.gym.id);
    if (!session) throw bad('abra o caixa antes de vender', 'cash-closed');
    if (!Array.isArray(b.items) || !b.items.length) throw bad('adicione pelo menos um produto');
    if (b.items.length > 100) throw bad('no máximo 100 itens por venda');
    const method = oneOf(b.paymentMethod, 'forma de pagamento', SALE_METHODS);
    let member = null;
    if (b.memberId) {
      member = db().prepare("SELECT id, name FROM memberships WHERE id = ? AND gym_id = ? AND status = 'active'").get(b.memberId, ctx.gym.id);
      if (!member) throw bad('cliente inválido');
    }
    let settings = {};
    try { settings = JSON.parse(ctx.gym.settings_json || '{}'); } catch { /* defaults */ }
    if (method === 'account') {
      if (!member) throw bad('venda fiado precisa de um aluno');
      if (settings.allowCredit === false) throw bad('esta academia não vende fiado');
    }
    const saleId = newId();
    const result = tx(db(), () => {
      const lines = b.items.map(it => {
        const p = db().prepare('SELECT * FROM products WHERE id = ? AND gym_id = ? AND active = 1').get(it.productId, ctx.gym.id);
        if (!p) throw bad('produto inválido ou inativo');
        const qty = num(it.qty, 'quantidade', { min: 0.001, max: 10000 });
        return { product: p, qty, unitPriceCents: p.price_cents };
      });
      // The same product twice is one demand on its stock.
      const need = new Map();
      for (const l of lines) need.set(l.product.id, (need.get(l.product.id) || 0) + l.qty);
      for (const l of lines) {
        if (l.product.track_stock && l.product.stock_qty < need.get(l.product.id)) throw bad(`estoque insuficiente de ${l.product.name} (tem ${l.product.stock_qty})`, 'stock');
      }
      const t = saleTotals(lines, cents(b.discountCents ?? 0, 'desconto'), method === 'cash' && b.paidCents != null ? cents(b.paidCents, 'valor recebido') : null);
      if (t.total <= 0) throw bad('o total da venda precisa ser maior que zero');
      if (method === 'cash' && t.paid < t.total) throw bad('o valor recebido é menor que o total');
      db().prepare(`INSERT INTO sales (id, gym_id, session_id, member_id, subtotal_cents, discount_cents, total_cents, payment_method, paid_cents, change_cents, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(saleId, ctx.gym.id, session.id, member?.id || null, t.subtotal, t.discount, t.total, method, method === 'cash' ? t.paid : t.total, method === 'cash' ? t.change : 0, ctx.user.id, nowIso());
      const insItem = db().prepare('INSERT INTO sale_items (id, sale_id, product_id, name, qty, unit_price_cents, total_cents) VALUES (?, ?, ?, ?, ?, ?, ?)');
      t.lines.forEach(l => {
        insItem.run(newId(), saleId, l.product.id, l.product.name, l.qty, l.unitPriceCents, l.totalCents);
        if (l.product.track_stock) moveStock(db(), { gymId: ctx.gym.id, kind: 'product', refId: l.product.id, qtyDelta: -l.qty, reason: 'venda', sourceId: saleId, userId: ctx.user.id });
      });
      const label = `Venda PDV ${saleId.slice(0, 8)}${member ? ' - ' + member.name : ''}`;
      if (method === 'account') {
        const chargeId = newId();
        db().prepare('INSERT INTO charges (id, gym_id, member_id, sale_id, description, amount_cents, due_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(chargeId, ctx.gym.id, member.id, saleId, label, t.total, todayDate(), nowIso());
        db().prepare('UPDATE sales SET charge_id = ? WHERE id = ?').run(chargeId, saleId);
      } else {
        const tid = addTransaction(db(), { gymId: ctx.gym.id, kind: 'income', categoryId: systemCategory(db(), ctx.gym.id, 'pos'), description: label, amountCents: t.total, date: todayDate(), paymentMethod: method, source: 'sale', sourceId: saleId, userId: ctx.user.id });
        db().prepare('UPDATE sales SET transaction_id = ? WHERE id = ?').run(tid, saleId);
      }
      return t;
    });
    audit(ctx, 'sale.create', { saleId, total: result.total, method });
    const sale = db().prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
    sale.items = db().prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(saleId);
    return { __status: 201, body: { sale } };
  });

  route('POST', '/gyms/:gymId/sales/:saleId/cancel', ADMIN, async ctx => {
    const s = db().prepare('SELECT * FROM sales WHERE id = ? AND gym_id = ?').get(ctx.params.saleId, ctx.gym.id);
    if (!s) throw notFound('venda');
    if (s.status !== 'completed') throw bad('a venda já está cancelada');
    const b = await ctx.body();
    tx(db(), () => {
      for (const it of db().prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(s.id)) {
        const p = it.product_id && db().prepare('SELECT track_stock FROM products WHERE id = ?').get(it.product_id);
        if (p?.track_stock) moveStock(db(), { gymId: ctx.gym.id, kind: 'product', refId: it.product_id, qtyDelta: it.qty, reason: 'venda cancelada', sourceId: s.id, userId: ctx.user.id });
      }
      cancelTransaction(db(), ctx.gym.id, s.transaction_id);
      if (s.charge_id) {
        const c = db().prepare('SELECT * FROM charges WHERE id = ?').get(s.charge_id);
        if (c?.transaction_id) cancelTransaction(db(), ctx.gym.id, c.transaction_id);
        db().prepare("UPDATE charges SET status = 'canceled' WHERE id = ?").run(s.charge_id);
      }
      db().prepare("UPDATE sales SET status = 'canceled', canceled_at = ? WHERE id = ?").run(nowIso(), s.id);
    });
    audit(ctx, 'sale.cancel', { saleId: s.id, reason: str(b.reason, 'motivo', { opt: true, max: 200 }) });
    return { ok: true };
  });
}
