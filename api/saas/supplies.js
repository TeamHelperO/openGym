/* Supplies ("insumos"): cleaning material and everything else the academy consumes, its suppliers,
 * and purchase orders. Receiving an order puts the goods in stock and books the expense in one
 * transaction. An order can also restock the shop's products (kind 'product'). */
import { ADMIN } from './roles.js';
import { tx, newId, nowIso } from './db.js';
import { str, cents, num, oneOf, date, bad, notFound, PAYMENT_METHODS } from './util.js';
import { addTransaction, systemCategory, moveStock, cancelTransaction } from './ledger.js';
import { todayDate } from './calc.js';

const ORDER_SELECT = `SELECT o.*, s.name AS supplier_name FROM purchase_orders o LEFT JOIN suppliers s ON s.id = o.supplier_id`;

export function registerSupplies(route, { db, audit }) {
  /* ---- suppliers ---- */
  route('GET', '/gyms/:gymId/suppliers', ADMIN, ctx => ({
    suppliers: db().prepare('SELECT * FROM suppliers WHERE gym_id = ? ORDER BY active DESC, name COLLATE NOCASE').all(ctx.gym.id)
  }));
  const supplierFields = (b, cur = {}) => [
    b.name !== undefined ? str(b.name, 'nome', { max: 120 }) : cur.name,
    b.document !== undefined ? str(b.document, 'CNPJ/CPF', { opt: true, max: 30 }) : cur.document ?? '',
    b.phone !== undefined ? str(b.phone, 'telefone', { opt: true, max: 40 }) : cur.phone ?? '',
    b.email !== undefined ? str(b.email, 'e-mail', { opt: true, max: 160 }) : cur.email ?? '',
    b.notes !== undefined ? str(b.notes, 'observações', { opt: true, max: 1000 }) : cur.notes ?? ''
  ];
  route('POST', '/gyms/:gymId/suppliers', ADMIN, async ctx => {
    const b = await ctx.body();
    if (b.name === undefined) throw bad('nome é obrigatório');
    const id = newId();
    db().prepare('INSERT INTO suppliers (id, gym_id, name, document, phone, email, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, ctx.gym.id, ...supplierFields(b), nowIso());
    return { __status: 201, body: { supplier: db().prepare('SELECT * FROM suppliers WHERE id = ?').get(id) } };
  });
  route('PUT', '/gyms/:gymId/suppliers/:supplierId', ADMIN, async ctx => {
    const s = db().prepare('SELECT * FROM suppliers WHERE id = ? AND gym_id = ?').get(ctx.params.supplierId, ctx.gym.id);
    if (!s) throw notFound('fornecedor');
    const b = await ctx.body();
    db().prepare('UPDATE suppliers SET name = ?, document = ?, phone = ?, email = ?, notes = ?, active = ? WHERE id = ?')
      .run(...supplierFields(b, s), b.active !== undefined ? (b.active ? 1 : 0) : s.active, s.id);
    return { supplier: db().prepare('SELECT * FROM suppliers WHERE id = ?').get(s.id) };
  });

  /* ---- supply items ---- */
  route('GET', '/gyms/:gymId/supplies', ADMIN, ctx => ({
    supplies: db().prepare('SELECT *, (stock_qty <= min_qty) AS low FROM supply_items WHERE gym_id = ? ORDER BY active DESC, name COLLATE NOCASE').all(ctx.gym.id)
  }));
  route('POST', '/gyms/:gymId/supplies', ADMIN, async ctx => {
    const b = await ctx.body();
    const id = newId();
    tx(db(), () => {
      db().prepare('INSERT INTO supply_items (id, gym_id, name, unit, category, min_qty, cost_cents, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        id, ctx.gym.id, str(b.name, 'nome', { max: 120 }), str(b.unit || 'un', 'unidade', { max: 12 }), str(b.category, 'categoria', { opt: true, max: 60 }),
        num(b.minQty ?? 0, 'estoque mínimo', { min: 0 }), cents(b.costCents ?? 0, 'custo'), nowIso());
      const initial = num(b.stockQty ?? 0, 'estoque inicial', { min: 0 });
      if (initial > 0) moveStock(db(), { gymId: ctx.gym.id, kind: 'supply', refId: id, qtyDelta: initial, reason: 'estoque inicial', userId: ctx.user.id });
    });
    return { __status: 201, body: { supply: db().prepare('SELECT * FROM supply_items WHERE id = ?').get(id) } };
  });
  route('PUT', '/gyms/:gymId/supplies/:itemId', ADMIN, async ctx => {
    const s = db().prepare('SELECT * FROM supply_items WHERE id = ? AND gym_id = ?').get(ctx.params.itemId, ctx.gym.id);
    if (!s) throw notFound('insumo');
    const b = await ctx.body();
    db().prepare('UPDATE supply_items SET name = ?, unit = ?, category = ?, min_qty = ?, cost_cents = ?, active = ? WHERE id = ?').run(
      b.name !== undefined ? str(b.name, 'nome', { max: 120 }) : s.name,
      b.unit !== undefined ? str(b.unit, 'unidade', { max: 12 }) : s.unit,
      b.category !== undefined ? str(b.category, 'categoria', { opt: true, max: 60 }) : s.category,
      b.minQty !== undefined ? num(b.minQty, 'estoque mínimo', { min: 0 }) : s.min_qty,
      b.costCents !== undefined ? cents(b.costCents, 'custo') : s.cost_cents,
      b.active !== undefined ? (b.active ? 1 : 0) : s.active, s.id);
    return { supply: db().prepare('SELECT * FROM supply_items WHERE id = ?').get(s.id) };
  });
  // Stock out (used up) or a count correction: qtyDelta negative takes out, positive puts in.
  route('POST', '/gyms/:gymId/supplies/:itemId/stock', ADMIN, async ctx => {
    const s = db().prepare('SELECT * FROM supply_items WHERE id = ? AND gym_id = ?').get(ctx.params.itemId, ctx.gym.id);
    if (!s) throw notFound('insumo');
    const b = await ctx.body();
    const delta = num(b.qtyDelta, 'quantidade', { min: -1e6, max: 1e6 });
    if (delta === 0) throw bad('quantidade não pode ser zero');
    if (s.stock_qty + delta < 0) throw bad('o estoque ficaria negativo');
    moveStock(db(), { gymId: ctx.gym.id, kind: 'supply', refId: s.id, qtyDelta: delta, reason: str(b.reason || (delta < 0 ? 'consumo' : 'ajuste'), 'motivo', { max: 120 }), userId: ctx.user.id });
    return { supply: db().prepare('SELECT * FROM supply_items WHERE id = ?').get(s.id) };
  });
  route('GET', '/gyms/:gymId/stock-movements', ADMIN, ctx => {
    const kind = oneOf(ctx.query.get('kind') || 'supply', 'tipo', ['supply', 'product']);
    const ref = ctx.query.get('refId');
    const rows = db().prepare(`SELECT * FROM stock_movements WHERE gym_id = ? AND kind = ? ${ref ? 'AND ref_id = ?' : ''} ORDER BY created_at DESC LIMIT 500`)
      .all(...[ctx.gym.id, kind, ...(ref ? [ref] : [])]);
    return { movements: rows };
  });

  /* ---- purchase orders ---- */
  const getOrder = (gymId, id) => {
    const o = db().prepare(`${ORDER_SELECT} WHERE o.id = ? AND o.gym_id = ?`).get(id, gymId);
    if (!o) throw notFound('pedido de compra');
    o.items = db().prepare('SELECT * FROM purchase_order_items WHERE order_id = ?').all(o.id);
    return o;
  };
  const writeItems = (gymId, orderId, items) => {
    if (!Array.isArray(items) || !items.length) throw bad('o pedido precisa de pelo menos um item');
    if (items.length > 200) throw bad('no máximo 200 itens por pedido');
    db().prepare('DELETE FROM purchase_order_items WHERE order_id = ?').run(orderId);
    let total = 0;
    for (const it of items) {
      const kind = oneOf(it.kind || 'supply', 'tipo do item', ['supply', 'product']);
      const ref = db().prepare(`SELECT id, name FROM ${kind === 'supply' ? 'supply_items' : 'products'} WHERE id = ? AND gym_id = ?`).get(it.itemId, gymId);
      if (!ref) throw bad('item inválido no pedido');
      const qty = num(it.qty, 'quantidade', { min: 0.001, max: 1e6 });
      const unit = cents(it.unitCostCents, 'custo unitário');
      total += Math.round(qty * unit);
      db().prepare('INSERT INTO purchase_order_items (id, order_id, kind, item_id, name, qty, unit_cost_cents) VALUES (?, ?, ?, ?, ?, ?, ?)').run(newId(), orderId, kind, ref.id, ref.name, qty, unit);
    }
    db().prepare('UPDATE purchase_orders SET total_cents = ? WHERE id = ?').run(total, orderId);
  };
  const checkSupplier = (gymId, id) => {
    if (!id) return null;
    if (!db().prepare('SELECT 1 FROM suppliers WHERE id = ? AND gym_id = ?').get(id, gymId)) throw bad('fornecedor inválido');
    return id;
  };

  route('GET', '/gyms/:gymId/purchases', ADMIN, ctx => {
    const status = ctx.query.get('status');
    const rows = db().prepare(`${ORDER_SELECT} WHERE o.gym_id = ? ${status ? 'AND o.status = ?' : ''} ORDER BY o.created_at DESC LIMIT 500`)
      .all(...[ctx.gym.id, ...(status ? [oneOf(status, 'situação', ['draft', 'ordered', 'received', 'canceled'])] : [])]);
    return { purchases: rows };
  });
  route('POST', '/gyms/:gymId/purchases', ADMIN, async ctx => {
    const b = await ctx.body();
    const id = newId();
    tx(db(), () => {
      db().prepare('INSERT INTO purchase_orders (id, gym_id, supplier_id, notes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, ctx.gym.id, checkSupplier(ctx.gym.id, b.supplierId), str(b.notes, 'observações', { opt: true, max: 1000 }), ctx.user.id, nowIso());
      writeItems(ctx.gym.id, id, b.items);
    });
    audit(ctx, 'purchase.create', { orderId: id });
    return { __status: 201, body: { purchase: getOrder(ctx.gym.id, id) } };
  });
  route('GET', '/gyms/:gymId/purchases/:orderId', ADMIN, ctx => ({ purchase: getOrder(ctx.gym.id, ctx.params.orderId) }));
  route('PUT', '/gyms/:gymId/purchases/:orderId', ADMIN, async ctx => {
    const o = getOrder(ctx.gym.id, ctx.params.orderId);
    if (!['draft', 'ordered'].includes(o.status)) throw bad('só pedidos em rascunho ou enviados podem ser alterados');
    const b = await ctx.body();
    tx(db(), () => {
      db().prepare('UPDATE purchase_orders SET supplier_id = ?, notes = ? WHERE id = ?').run(
        b.supplierId !== undefined ? checkSupplier(ctx.gym.id, b.supplierId) : o.supplier_id,
        b.notes !== undefined ? str(b.notes, 'observações', { opt: true, max: 1000 }) : o.notes, o.id);
      if (b.items !== undefined) writeItems(ctx.gym.id, o.id, b.items);
    });
    return { purchase: getOrder(ctx.gym.id, o.id) };
  });
  route('POST', '/gyms/:gymId/purchases/:orderId/order', ADMIN, ctx => {
    const o = getOrder(ctx.gym.id, ctx.params.orderId);
    if (o.status !== 'draft') throw bad('só um rascunho pode ser enviado');
    db().prepare("UPDATE purchase_orders SET status = 'ordered', ordered_at = ? WHERE id = ?").run(nowIso(), o.id);
    return { purchase: getOrder(ctx.gym.id, o.id) };
  });
  route('POST', '/gyms/:gymId/purchases/:orderId/receive', ADMIN, async ctx => {
    const o = getOrder(ctx.gym.id, ctx.params.orderId);
    if (!['draft', 'ordered'].includes(o.status)) throw bad('este pedido já foi recebido ou cancelado');
    const b = await ctx.body();
    const method = oneOf(b.paymentMethod, 'forma de pagamento', PAYMENT_METHODS, { opt: true, def: 'pix' });
    const when = date(b.date, 'data', { opt: true }) || todayDate();
    tx(db(), () => {
      let supplyTotal = 0, productTotal = 0;
      for (const it of o.items) {
        moveStock(db(), { gymId: ctx.gym.id, kind: it.kind, refId: it.item_id, qtyDelta: it.qty, reason: 'compra recebida', sourceId: o.id, userId: ctx.user.id });
        const table = it.kind === 'supply' ? 'supply_items' : 'products';
        db().prepare(`UPDATE ${table} SET cost_cents = ? WHERE id = ? AND gym_id = ?`).run(it.unit_cost_cents, it.item_id, ctx.gym.id);
        const line = Math.round(it.qty * it.unit_cost_cents);
        if (it.kind === 'supply') supplyTotal += line; else productTotal += line;
      }
      const label = `Compra${o.supplier_name ? ' ' + o.supplier_name : ''} (pedido ${o.id.slice(0, 8)})`;
      let tid = null;
      if (supplyTotal > 0) tid = addTransaction(db(), { gymId: ctx.gym.id, kind: 'expense', categoryId: systemCategory(db(), ctx.gym.id, 'supplies'), description: label, amountCents: supplyTotal, date: when, paymentMethod: method, source: 'purchase', sourceId: o.id, userId: ctx.user.id });
      if (productTotal > 0) {
        const t2 = addTransaction(db(), { gymId: ctx.gym.id, kind: 'expense', categoryId: systemCategory(db(), ctx.gym.id, 'stock'), description: label, amountCents: productTotal, date: when, paymentMethod: method, source: 'purchase', sourceId: o.id, userId: ctx.user.id });
        tid = tid || t2;
      }
      db().prepare("UPDATE purchase_orders SET status = 'received', received_at = ?, payment_method = ?, transaction_id = ? WHERE id = ?").run(nowIso(), method, tid, o.id);
    });
    audit(ctx, 'purchase.receive', { orderId: o.id });
    return { purchase: getOrder(ctx.gym.id, o.id) };
  });
  // Canceling a received order takes the goods back out of stock and cancels its expense.
  route('POST', '/gyms/:gymId/purchases/:orderId/cancel', ADMIN, ctx => {
    const o = getOrder(ctx.gym.id, ctx.params.orderId);
    if (o.status === 'canceled') throw bad('o pedido já está cancelado');
    tx(db(), () => {
      if (o.status === 'received') {
        for (const it of o.items) moveStock(db(), { gymId: ctx.gym.id, kind: it.kind, refId: it.item_id, qtyDelta: -it.qty, reason: 'compra cancelada', sourceId: o.id, userId: ctx.user.id });
        for (const t of db().prepare("SELECT id FROM transactions WHERE gym_id = ? AND source = 'purchase' AND source_id = ?").all(ctx.gym.id, o.id)) cancelTransaction(db(), ctx.gym.id, t.id);
      }
      db().prepare("UPDATE purchase_orders SET status = 'canceled' WHERE id = ?").run(o.id);
    });
    audit(ctx, 'purchase.cancel', { orderId: o.id });
    return { purchase: getOrder(ctx.gym.id, o.id) };
  });
}
