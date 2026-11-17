// Supplies, suppliers and purchase orders. Receiving an order stocks the goods and books the expense
// in one transaction; an order can also restock the shop's products (kind 'product').
import { ADMIN } from './roles.js';
import { str, cents, num, oneOf, date, bad, notFound, PAYMENT_METHODS, id as uuid } from './util.js';
import { addTransaction, systemCategory, moveStock, cancelTransaction } from './ledger.js';
import { todayDate } from './calc.js';

export function registerSupplies(route, { sql, audit }) {
  /* ---- suppliers ---- */
  route('GET', '/gyms/:gymId/suppliers', ADMIN, async ctx => ({
    suppliers: await sql`select * from opengym.gym_suppliers where gym_id = ${ctx.gym.id} order by active desc, lower(name)`
  }));
  const supplierFields = (b, cur = {}) => ({
    name: b.name !== undefined ? str(b.name, 'nome', { max: 120 }) : cur.name,
    document: b.document !== undefined ? str(b.document, 'CNPJ/CPF', { opt: true, max: 30 }) : cur.document ?? '',
    phone: b.phone !== undefined ? str(b.phone, 'telefone', { opt: true, max: 40 }) : cur.phone ?? '',
    email: b.email !== undefined ? str(b.email, 'e-mail', { opt: true, max: 160 }) : cur.email ?? '',
    notes: b.notes !== undefined ? str(b.notes, 'observações', { opt: true, max: 1000 }) : cur.notes ?? ''
  });
  route('POST', '/gyms/:gymId/suppliers', ADMIN, async ctx => {
    const b = await ctx.body();
    if (b.name === undefined) throw bad('nome é obrigatório');
    const [s] = await sql`insert into opengym.gym_suppliers ${sql({ gym_id: ctx.gym.id, ...supplierFields(b) })} returning *`;
    return { __status: 201, body: { supplier: s } };
  });
  route('PUT', '/gyms/:gymId/suppliers/:supplierId', ADMIN, async ctx => {
    const [s] = await sql`select * from opengym.gym_suppliers where id = ${ctx.params.supplierId} and gym_id = ${ctx.gym.id}`;
    if (!s) throw notFound('fornecedor');
    const b = await ctx.body();
    const [out] = await sql`update opengym.gym_suppliers set ${sql({ ...supplierFields(b, s), active: b.active !== undefined ? !!b.active : s.active })} where id = ${s.id} returning *`;
    return { supplier: out };
  });

  /* ---- supply items ---- */
  route('GET', '/gyms/:gymId/supplies', ADMIN, async ctx => ({
    supplies: await sql`select *, (stock_qty <= min_qty) as low from opengym.gym_supplies where gym_id = ${ctx.gym.id} order by active desc, lower(name)`
  }));
  route('POST', '/gyms/:gymId/supplies', ADMIN, async ctx => {
    const b = await ctx.body();
    const row = {
      gym_id: ctx.gym.id, name: str(b.name, 'nome', { max: 120 }), unit: str(b.unit || 'un', 'unidade', { max: 12 }),
      category: str(b.category, 'categoria', { opt: true, max: 60 }), min_qty: num(b.minQty ?? 0, 'estoque mínimo', { min: 0 }), cost_cents: cents(b.costCents ?? 0, 'custo')
    };
    const initial = num(b.stockQty ?? 0, 'estoque inicial', { min: 0 });
    const s = await sql.begin(async tx => {
      const [s] = await tx`insert into opengym.gym_supplies ${tx(row)} returning id`;
      if (initial > 0) await moveStock(tx, { gymId: ctx.gym.id, kind: 'supply', refId: s.id, qtyDelta: initial, reason: 'estoque inicial', userId: ctx.user.id });
      return s;
    });
    const [out] = await sql`select * from opengym.gym_supplies where id = ${s.id}`;
    return { __status: 201, body: { supply: out } };
  });
  route('PUT', '/gyms/:gymId/supplies/:itemId', ADMIN, async ctx => {
    const [s] = await sql`select * from opengym.gym_supplies where id = ${ctx.params.itemId} and gym_id = ${ctx.gym.id}`;
    if (!s) throw notFound('insumo');
    const b = await ctx.body();
    const [out] = await sql`update opengym.gym_supplies set ${sql({
      name: b.name !== undefined ? str(b.name, 'nome', { max: 120 }) : s.name,
      unit: b.unit !== undefined ? str(b.unit, 'unidade', { max: 12 }) : s.unit,
      category: b.category !== undefined ? str(b.category, 'categoria', { opt: true, max: 60 }) : s.category,
      min_qty: b.minQty !== undefined ? num(b.minQty, 'estoque mínimo', { min: 0 }) : s.min_qty,
      cost_cents: b.costCents !== undefined ? cents(b.costCents, 'custo') : s.cost_cents,
      active: b.active !== undefined ? !!b.active : s.active
    })} where id = ${s.id} returning *`;
    return { supply: out };
  });
  route('POST', '/gyms/:gymId/supplies/:itemId/stock', ADMIN, async ctx => {
    const [s] = await sql`select * from opengym.gym_supplies where id = ${ctx.params.itemId} and gym_id = ${ctx.gym.id}`;
    if (!s) throw notFound('insumo');
    const b = await ctx.body();
    const delta = num(b.qtyDelta, 'quantidade', { min: -1e6, max: 1e6 });
    if (delta === 0) throw bad('quantidade não pode ser zero');
    if (s.stock_qty + delta < 0) throw bad('o estoque ficaria negativo');
    await moveStock(sql, { gymId: ctx.gym.id, kind: 'supply', refId: s.id, qtyDelta: delta, reason: str(b.reason || (delta < 0 ? 'consumo' : 'ajuste'), 'motivo', { max: 120 }), userId: ctx.user.id });
    const [out] = await sql`select * from opengym.gym_supplies where id = ${s.id}`;
    return { supply: out };
  });
  route('GET', '/gyms/:gymId/stock-movements', ADMIN, async ctx => {
    const kind = oneOf(ctx.query.get('kind') || 'supply', 'tipo', ['supply', 'product']);
    const ref = ctx.query.get('refId');
    return { movements: await sql`select * from opengym.gym_stock_moves where gym_id = ${ctx.gym.id} and kind = ${kind}
      ${ref ? sql`and ref_id = ${uuid(ref)}` : sql``} order by created_at desc limit 500` };
  });

  /* ---- purchase orders ---- */
  const getOrder = async (gymId, oid) => {
    const [o] = await sql`select o.*, s.name as supplier_name from opengym.gym_purchases o left join opengym.gym_suppliers s on s.id = o.supplier_id
      where o.id = ${oid} and o.gym_id = ${gymId}`;
    if (!o) throw notFound('pedido de compra');
    o.items = (await sql`select * from opengym.gym_purchase_items where purchase_id = ${o.id}`).map(i => ({ ...i, order_id: i.purchase_id }));
    return o;
  };
  const writeItems = async (tx, gymId, orderId, items) => {
    if (!Array.isArray(items) || !items.length) throw bad('o pedido precisa de pelo menos um item');
    if (items.length > 200) throw bad('no máximo 200 itens por pedido');
    await tx`delete from opengym.gym_purchase_items where purchase_id = ${orderId}`;
    let total = 0;
    for (const it of items) {
      const kind = oneOf(it.kind || 'supply', 'tipo do item', ['supply', 'product']);
      uuid(it.itemId, 'item');
      const [ref] = kind === 'supply'
        ? await tx`select id, name from opengym.gym_supplies where id = ${it.itemId} and gym_id = ${gymId}`
        : await tx`select id, name from opengym.gym_products where id = ${it.itemId} and gym_id = ${gymId}`;
      if (!ref) throw bad('item inválido no pedido');
      const qty = num(it.qty, 'quantidade', { min: 0.001, max: 1e6 });
      const unit = cents(it.unitCostCents, 'custo unitário');
      total += Math.round(qty * unit);
      await tx`insert into opengym.gym_purchase_items (purchase_id, kind, item_id, name, qty, unit_cost_cents) values (${orderId}, ${kind}, ${ref.id}, ${ref.name}, ${qty}, ${unit})`;
    }
    await tx`update opengym.gym_purchases set total_cents = ${total} where id = ${orderId}`;
  };
  const checkSupplier = async (gymId, sid) => {
    if (!sid) return null;
    uuid(sid, 'fornecedor');
    if (!(await sql`select 1 from opengym.gym_suppliers where id = ${sid} and gym_id = ${gymId}`).length) throw bad('fornecedor inválido');
    return sid;
  };

  route('GET', '/gyms/:gymId/purchases', ADMIN, async ctx => {
    const status = ctx.query.get('status');
    if (status) oneOf(status, 'situação', ['draft', 'ordered', 'received', 'canceled']);
    return { purchases: await sql`select o.*, s.name as supplier_name from opengym.gym_purchases o left join opengym.gym_suppliers s on s.id = o.supplier_id
      where o.gym_id = ${ctx.gym.id} ${status ? sql`and o.status = ${status}` : sql``} order by o.created_at desc limit 500` };
  });
  route('POST', '/gyms/:gymId/purchases', ADMIN, async ctx => {
    const b = await ctx.body();
    const supplier = await checkSupplier(ctx.gym.id, b.supplierId);
    const oid = await sql.begin(async tx => {
      const [o] = await tx`insert into opengym.gym_purchases (gym_id, supplier_id, notes, created_by)
        values (${ctx.gym.id}, ${supplier}, ${str(b.notes, 'observações', { opt: true, max: 1000 })}, ${ctx.user.id}) returning id`;
      await writeItems(tx, ctx.gym.id, o.id, b.items);
      return o.id;
    });
    await audit(ctx, 'purchase.create', { orderId: oid });
    return { __status: 201, body: { purchase: await getOrder(ctx.gym.id, oid) } };
  });
  route('GET', '/gyms/:gymId/purchases/:orderId', ADMIN, async ctx => ({ purchase: await getOrder(ctx.gym.id, ctx.params.orderId) }));
  route('PUT', '/gyms/:gymId/purchases/:orderId', ADMIN, async ctx => {
    const o = await getOrder(ctx.gym.id, ctx.params.orderId);
    if (!['draft', 'ordered'].includes(o.status)) throw bad('só pedidos em rascunho ou enviados podem ser alterados');
    const b = await ctx.body();
    const supplier = b.supplierId !== undefined ? await checkSupplier(ctx.gym.id, b.supplierId) : o.supplier_id;
    await sql.begin(async tx => {
      await tx`update opengym.gym_purchases set supplier_id = ${supplier}, notes = ${b.notes !== undefined ? str(b.notes, 'observações', { opt: true, max: 1000 }) : o.notes} where id = ${o.id}`;
      if (b.items !== undefined) await writeItems(tx, ctx.gym.id, o.id, b.items);
    });
    return { purchase: await getOrder(ctx.gym.id, o.id) };
  });
  route('POST', '/gyms/:gymId/purchases/:orderId/order', ADMIN, async ctx => {
    const o = await getOrder(ctx.gym.id, ctx.params.orderId);
    if (o.status !== 'draft') throw bad('só um rascunho pode ser enviado');
    await sql`update opengym.gym_purchases set status = 'ordered', ordered_at = now() where id = ${o.id}`;
    return { purchase: await getOrder(ctx.gym.id, o.id) };
  });
  route('POST', '/gyms/:gymId/purchases/:orderId/receive', ADMIN, async ctx => {
    const o = await getOrder(ctx.gym.id, ctx.params.orderId);
    if (!['draft', 'ordered'].includes(o.status)) throw bad('este pedido já foi recebido ou cancelado');
    const b = await ctx.body();
    const method = oneOf(b.paymentMethod, 'forma de pagamento', PAYMENT_METHODS, { opt: true, def: 'pix' });
    const when = date(b.date, 'data', { opt: true }) || todayDate();
    await sql.begin(async tx => {
      let supplyTotal = 0, productTotal = 0;
      for (const it of o.items) {
        await moveStock(tx, { gymId: ctx.gym.id, kind: it.kind, refId: it.item_id, qtyDelta: it.qty, reason: 'compra recebida', sourceId: o.id, userId: ctx.user.id });
        if (it.kind === 'supply') await tx`update opengym.gym_supplies set cost_cents = ${it.unit_cost_cents} where id = ${it.item_id} and gym_id = ${ctx.gym.id}`;
        else await tx`update opengym.gym_products set cost_cents = ${it.unit_cost_cents} where id = ${it.item_id} and gym_id = ${ctx.gym.id}`;
        const line = Math.round(it.qty * it.unit_cost_cents);
        if (it.kind === 'supply') supplyTotal += line; else productTotal += line;
      }
      const label = `Compra${o.supplier_name ? ' ' + o.supplier_name : ''} (pedido ${o.id.slice(0, 8)})`;
      let tid = null;
      if (supplyTotal > 0) tid = await addTransaction(tx, { gymId: ctx.gym.id, kind: 'expense', categoryId: await systemCategory(tx, ctx.gym.id, 'supplies'), description: label, amountCents: supplyTotal, date: when, paymentMethod: method, source: 'purchase', sourceId: o.id, userId: ctx.user.id });
      if (productTotal > 0) {
        const t2 = await addTransaction(tx, { gymId: ctx.gym.id, kind: 'expense', categoryId: await systemCategory(tx, ctx.gym.id, 'stock'), description: label, amountCents: productTotal, date: when, paymentMethod: method, source: 'purchase', sourceId: o.id, userId: ctx.user.id });
        tid = tid || t2;
      }
      await tx`update opengym.gym_purchases set status = 'received', received_at = now(), payment_method = ${method}, transaction_id = ${tid} where id = ${o.id}`;
    });
    await audit(ctx, 'purchase.receive', { orderId: o.id });
    return { purchase: await getOrder(ctx.gym.id, o.id) };
  });
  route('POST', '/gyms/:gymId/purchases/:orderId/cancel', ADMIN, async ctx => {
    const o = await getOrder(ctx.gym.id, ctx.params.orderId);
    if (o.status === 'canceled') throw bad('o pedido já está cancelado');
    await sql.begin(async tx => {
      if (o.status === 'received') {
        for (const it of o.items) await moveStock(tx, { gymId: ctx.gym.id, kind: it.kind, refId: it.item_id, qtyDelta: -it.qty, reason: 'compra cancelada', sourceId: o.id, userId: ctx.user.id });
        for (const t of await tx`select id from opengym.gym_transactions where gym_id = ${ctx.gym.id} and source = 'purchase' and source_id = ${o.id}`) await cancelTransaction(tx, ctx.gym.id, t.id);
      }
      await tx`update opengym.gym_purchases set status = 'canceled' where id = ${o.id}`;
    });
    await audit(ctx, 'purchase.cancel', { orderId: o.id });
    return { purchase: await getOrder(ctx.gym.id, o.id) };
  });
}
