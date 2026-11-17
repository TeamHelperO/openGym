// The academy shop (PDV): products, the cash drawer and sales. A sale takes stock out and books its
// income in one transaction; a sale on account (fiado) opens a charge on the student instead.
import { ADMIN, STAFF } from './roles.js';
import { str, cents, num, oneOf, bad, notFound, PAYMENT_METHODS, id as uuid, isUuid } from './util.js';
import { addTransaction, systemCategory, moveStock, cancelTransaction } from './ledger.js';
import { saleTotals, cashExpected, todayDate } from './calc.js';

const SALE_METHODS = [...PAYMENT_METHODS, 'account'];

export function registerPos(route, { sql, audit }) {
  /* ---- products ---- */
  route('GET', '/gyms/:gymId/products', STAFF, async ctx => ({
    products: await sql`select *, (track_stock and stock_qty <= min_qty) as low from opengym.gym_products
      where gym_id = ${ctx.gym.id} ${ctx.query.get('all') === '1' ? sql`` : sql`and active`} order by category, lower(name)`
  }));
  route('POST', '/gyms/:gymId/products', ADMIN, async ctx => {
    const b = await ctx.body();
    const row = {
      gym_id: ctx.gym.id, name: str(b.name, 'nome', { max: 120 }), sku: str(b.sku, 'código', { opt: true, max: 40 }), category: str(b.category, 'categoria', { opt: true, max: 60 }),
      price_cents: cents(b.priceCents, 'preço'), cost_cents: cents(b.costCents ?? 0, 'custo'), min_qty: num(b.minQty ?? 0, 'estoque mínimo', { min: 0 }), track_stock: b.trackStock !== false
    };
    const initial = num(b.stockQty ?? 0, 'estoque inicial', { min: 0 });
    const p = await sql.begin(async tx => {
      const [p] = await tx`insert into opengym.gym_products ${tx(row)} returning id`;
      if (initial > 0) await moveStock(tx, { gymId: ctx.gym.id, kind: 'product', refId: p.id, qtyDelta: initial, reason: 'estoque inicial', userId: ctx.user.id });
      return p;
    });
    await audit(ctx, 'product.create', { productId: p.id });
    const [out] = await sql`select * from opengym.gym_products where id = ${p.id}`;
    return { __status: 201, body: { product: out } };
  });
  route('PUT', '/gyms/:gymId/products/:productId', ADMIN, async ctx => {
    const [p] = await sql`select * from opengym.gym_products where id = ${ctx.params.productId} and gym_id = ${ctx.gym.id}`;
    if (!p) throw notFound('produto');
    const b = await ctx.body();
    const [out] = await sql`update opengym.gym_products set ${sql({
      name: b.name !== undefined ? str(b.name, 'nome', { max: 120 }) : p.name,
      sku: b.sku !== undefined ? str(b.sku, 'código', { opt: true, max: 40 }) : p.sku,
      category: b.category !== undefined ? str(b.category, 'categoria', { opt: true, max: 60 }) : p.category,
      price_cents: b.priceCents !== undefined ? cents(b.priceCents, 'preço') : p.price_cents,
      cost_cents: b.costCents !== undefined ? cents(b.costCents, 'custo') : p.cost_cents,
      min_qty: b.minQty !== undefined ? num(b.minQty, 'estoque mínimo', { min: 0 }) : p.min_qty,
      track_stock: b.trackStock !== undefined ? !!b.trackStock : p.track_stock,
      active: b.active !== undefined ? !!b.active : p.active
    })} where id = ${p.id} returning *`;
    return { product: out };
  });
  route('POST', '/gyms/:gymId/products/:productId/stock', ADMIN, async ctx => {
    const [p] = await sql`select * from opengym.gym_products where id = ${ctx.params.productId} and gym_id = ${ctx.gym.id}`;
    if (!p) throw notFound('produto');
    const b = await ctx.body();
    const delta = num(b.qtyDelta, 'quantidade', { min: -1e6, max: 1e6 });
    if (delta === 0) throw bad('quantidade não pode ser zero');
    if (p.stock_qty + delta < 0) throw bad('o estoque ficaria negativo');
    await moveStock(sql, { gymId: ctx.gym.id, kind: 'product', refId: p.id, qtyDelta: delta, reason: str(b.reason || 'ajuste de estoque', 'motivo', { max: 120 }), userId: ctx.user.id });
    const [out] = await sql`select * from opengym.gym_products where id = ${p.id}`;
    return { product: out };
  });

  /* ---- cash drawer ---- */
  const openSession = async gymId => (await sql`select * from opengym.gym_cash_sessions where gym_id = ${gymId} and status = 'open'`)[0] || null;
  const sessionSummary = async s => {
    if (!s) return null;
    const byMethod = await sql`select payment_method as method, count(*)::int as count, sum(total_cents)::int as total from opengym.gym_sales
      where session_id = ${s.id} and status = 'completed' group by payment_method`;
    const moves = await sql`select * from opengym.gym_cash_moves where session_id = ${s.id} order by created_at`;
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

  route('GET', '/gyms/:gymId/cash', STAFF, async ctx => ({ session: await sessionSummary(await openSession(ctx.gym.id)) }));
  route('GET', '/gyms/:gymId/cash/sessions', ADMIN, async ctx => ({
    sessions: await sql`select * from opengym.gym_cash_sessions where gym_id = ${ctx.gym.id} order by opened_at desc limit 100`
  }));
  route('GET', '/gyms/:gymId/cash/sessions/:sessionId', ADMIN, async ctx => {
    const [s] = await sql`select * from opengym.gym_cash_sessions where id = ${ctx.params.sessionId} and gym_id = ${ctx.gym.id}`;
    if (!s) throw notFound('caixa');
    return { session: await sessionSummary(s) };
  });
  route('POST', '/gyms/:gymId/cash/open', STAFF, async ctx => {
    if (await openSession(ctx.gym.id)) throw bad('já existe um caixa aberto');
    const b = await ctx.body();
    const [s] = await sql`insert into opengym.gym_cash_sessions (gym_id, opening_cents, opened_by) values (${ctx.gym.id}, ${cents(b.openingCents ?? 0, 'troco inicial')}, ${ctx.user.id}) returning id`;
    await audit(ctx, 'cash.open', { sessionId: s.id });
    return { session: await sessionSummary(await openSession(ctx.gym.id)) };
  });
  route('POST', '/gyms/:gymId/cash/movement', STAFF, async ctx => {
    const s = await openSession(ctx.gym.id);
    if (!s) throw bad('abra o caixa primeiro');
    const b = await ctx.body();
    const kind = oneOf(b.kind, 'tipo', ['withdrawal', 'deposit']);
    const amount = cents(b.amountCents, 'valor', { positive: true });
    if (kind === 'withdrawal' && amount > (await sessionSummary(s)).expectedCashCents) throw bad('a sangria é maior que o dinheiro no caixa');
    await sql`insert into opengym.gym_cash_moves (gym_id, session_id, kind, amount_cents, reason, created_by)
      values (${ctx.gym.id}, ${s.id}, ${kind}, ${amount}, ${str(b.reason, 'motivo', { opt: true, max: 200 })}, ${ctx.user.id})`;
    return { session: await sessionSummary(await openSession(ctx.gym.id)) };
  });
  route('POST', '/gyms/:gymId/cash/close', STAFF, async ctx => {
    const s = await openSession(ctx.gym.id);
    if (!s) throw bad('não há caixa aberto');
    const b = await ctx.body();
    const sum = await sessionSummary(s);
    const counted = cents(b.countedCents, 'valor contado');
    await sql`update opengym.gym_cash_sessions set status = 'closed', expected_cents = ${sum.expectedCashCents}, counted_cents = ${counted},
      notes = ${str(b.notes, 'observações', { opt: true, max: 1000 })}, closed_by = ${ctx.user.id}, closed_at = now() where id = ${s.id}`;
    await audit(ctx, 'cash.close', { sessionId: s.id, difference: counted - sum.expectedCashCents });
    const [closed] = await sql`select * from opengym.gym_cash_sessions where id = ${s.id}`;
    return { session: await sessionSummary(closed), differenceCents: counted - sum.expectedCashCents };
  });

  /* ---- sales ---- */
  route('GET', '/gyms/:gymId/sales', STAFF, async ctx => {
    const q = ctx.query;
    const sid = q.get('sessionId');
    const day = q.get('date');
    const rows = await sql`select s.*, m.name as member_name from opengym.gym_sales s left join opengym.gym_members m on m.id = s.member_id
      where s.gym_id = ${ctx.gym.id}
        ${sid && isUuid(sid) ? sql`and s.session_id = ${sid}` : sql``}
        ${day ? sql`and to_char(s.created_at at time zone 'UTC', 'YYYY-MM-DD') = ${day}` : sql``}
        ${ctx.role !== 'gym_admin' ? sql`and s.created_by = ${ctx.user.id}` : sql``}
      order by s.created_at desc limit 500`;
    const items = rows.length ? await sql`select * from opengym.gym_sale_items where sale_id in ${sql(rows.map(r => r.id))}` : [];
    return { sales: rows.map(r => ({ ...r, items: items.filter(i => i.sale_id === r.id) })) };
  });

  route('POST', '/gyms/:gymId/sales', STAFF, async ctx => {
    const b = await ctx.body();
    const session = await openSession(ctx.gym.id);
    if (!session) throw bad('abra o caixa antes de vender', 'cash-closed');
    if (!Array.isArray(b.items) || !b.items.length) throw bad('adicione pelo menos um produto');
    if (b.items.length > 100) throw bad('no máximo 100 itens por venda');
    const method = oneOf(b.paymentMethod, 'forma de pagamento', SALE_METHODS);
    let member = null;
    if (b.memberId) {
      uuid(b.memberId, 'cliente');
      [member] = await sql`select id, name from opengym.gym_members where id = ${b.memberId} and gym_id = ${ctx.gym.id} and status = 'active'`;
      if (!member) throw bad('cliente inválido');
    }
    const settings = ctx.gym.settings || {};
    if (method === 'account') {
      if (!member) throw bad('venda fiado precisa de um aluno');
      if (settings.allowCredit === false) throw bad('esta academia não vende fiado');
    }
    const saleId = await sql.begin(async tx => {
      const lines = [];
      for (const it of b.items) {
        uuid(it.productId, 'produto');
        const [p] = await tx`select * from opengym.gym_products where id = ${it.productId} and gym_id = ${ctx.gym.id} and active for update`;
        if (!p) throw bad('produto inválido ou inativo');
        lines.push({ product: p, qty: num(it.qty, 'quantidade', { min: 0.001, max: 10000 }), unitPriceCents: p.price_cents });
      }
      const need = new Map();
      for (const l of lines) need.set(l.product.id, (need.get(l.product.id) || 0) + l.qty);
      for (const l of lines) if (l.product.track_stock && l.product.stock_qty < need.get(l.product.id)) throw bad(`estoque insuficiente de ${l.product.name} (tem ${l.product.stock_qty})`, 'stock');
      const t = saleTotals(lines, cents(b.discountCents ?? 0, 'desconto'), method === 'cash' && b.paidCents != null ? cents(b.paidCents, 'valor recebido') : null);
      if (t.total <= 0) throw bad('o total da venda precisa ser maior que zero');
      if (method === 'cash' && t.paid < t.total) throw bad('o valor recebido é menor que o total');
      const [sale] = await tx`insert into opengym.gym_sales (gym_id, session_id, member_id, subtotal_cents, discount_cents, total_cents, payment_method, paid_cents, change_cents, created_by)
        values (${ctx.gym.id}, ${session.id}, ${member?.id || null}, ${t.subtotal}, ${t.discount}, ${t.total}, ${method}, ${method === 'cash' ? t.paid : t.total}, ${method === 'cash' ? t.change : 0}, ${ctx.user.id})
        returning id`;
      for (const l of t.lines) {
        await tx`insert into opengym.gym_sale_items (sale_id, product_id, name, qty, unit_price_cents, total_cents) values (${sale.id}, ${l.product.id}, ${l.product.name}, ${l.qty}, ${l.unitPriceCents}, ${l.totalCents})`;
        if (l.product.track_stock) await moveStock(tx, { gymId: ctx.gym.id, kind: 'product', refId: l.product.id, qtyDelta: -l.qty, reason: 'venda', sourceId: sale.id, userId: ctx.user.id });
      }
      const label = `Venda PDV ${sale.id.slice(0, 8)}${member ? ' - ' + member.name : ''}`;
      if (method === 'account') {
        const [c] = await tx`insert into opengym.gym_charges (gym_id, member_id, sale_id, description, amount_cents, due_date)
          values (${ctx.gym.id}, ${member.id}, ${sale.id}, ${label}, ${t.total}, ${todayDate()}) returning id`;
        await tx`update opengym.gym_sales set charge_id = ${c.id} where id = ${sale.id}`;
      } else {
        const tid = await addTransaction(tx, { gymId: ctx.gym.id, kind: 'income', categoryId: await systemCategory(tx, ctx.gym.id, 'pos'), description: label, amountCents: t.total, date: todayDate(), paymentMethod: method, source: 'sale', sourceId: sale.id, userId: ctx.user.id });
        await tx`update opengym.gym_sales set transaction_id = ${tid} where id = ${sale.id}`;
      }
      return sale.id;
    });
    await audit(ctx, 'sale.create', { saleId, method });
    const [sale] = await sql`select * from opengym.gym_sales where id = ${saleId}`;
    sale.items = await sql`select * from opengym.gym_sale_items where sale_id = ${saleId}`;
    return { __status: 201, body: { sale } };
  });

  route('POST', '/gyms/:gymId/sales/:saleId/cancel', ADMIN, async ctx => {
    const [s] = await sql`select * from opengym.gym_sales where id = ${ctx.params.saleId} and gym_id = ${ctx.gym.id}`;
    if (!s) throw notFound('venda');
    if (s.status !== 'completed') throw bad('a venda já está cancelada');
    const b = await ctx.body();
    await sql.begin(async tx => {
      for (const it of await tx`select i.*, p.track_stock from opengym.gym_sale_items i left join opengym.gym_products p on p.id = i.product_id where i.sale_id = ${s.id}`) {
        if (it.track_stock) await moveStock(tx, { gymId: ctx.gym.id, kind: 'product', refId: it.product_id, qtyDelta: it.qty, reason: 'venda cancelada', sourceId: s.id, userId: ctx.user.id });
      }
      await cancelTransaction(tx, ctx.gym.id, s.transaction_id);
      if (s.charge_id) {
        const [c] = await tx`select * from opengym.gym_charges where id = ${s.charge_id}`;
        if (c?.transaction_id) await cancelTransaction(tx, ctx.gym.id, c.transaction_id);
        await tx`update opengym.gym_charges set status = 'canceled' where id = ${s.charge_id}`;
      }
      await tx`update opengym.gym_sales set status = 'canceled', canceled_at = now() where id = ${s.id}`;
    });
    await audit(ctx, 'sale.cancel', { saleId: s.id, reason: str(b.reason, 'motivo', { opt: true, max: 200 }) });
    return { ok: true };
  });
}
