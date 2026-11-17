/* The one way money enters the books. Monthly fees, shop sales, supply purchases and manual
 * entries all write their transaction through here, inside the caller's own transaction, so a
 * sale and its income (or a received order and its expense) can never land one without the other. */
import { newId, nowIso } from './db.js';

export const DEFAULT_CATEGORIES = [
  { kind: 'income', name: 'Mensalidades', key: 'fees' },
  { kind: 'income', name: 'Vendas da loja (PDV)', key: 'pos' },
  { kind: 'income', name: 'Outras receitas', key: 'other_income' },
  { kind: 'expense', name: 'Insumos e material de limpeza', key: 'supplies' },
  { kind: 'expense', name: 'Compra de produtos para revenda', key: 'stock' },
  { kind: 'expense', name: 'Aluguel', key: null },
  { kind: 'expense', name: 'Salários e comissões', key: null },
  { kind: 'expense', name: 'Água, luz e internet', key: null },
  { kind: 'expense', name: 'Manutenção de equipamentos', key: null },
  { kind: 'expense', name: 'Outras despesas', key: 'other_expense' }
];

export function seedCategories(db, gymId) {
  const ins = db.prepare('INSERT INTO finance_categories (id, gym_id, name, kind, system_key) VALUES (?, ?, ?, ?, ?)');
  for (const c of DEFAULT_CATEGORIES) ins.run(newId(), gymId, c.name, c.kind, c.key);
}

/** The id of a built-in category, recreated if someone deleted it. */
export function systemCategory(db, gymId, key) {
  const row = db.prepare('SELECT id FROM finance_categories WHERE gym_id = ? AND system_key = ?').get(gymId, key);
  if (row) return row.id;
  const c = DEFAULT_CATEGORIES.find(x => x.key === key);
  const id = newId();
  db.prepare('INSERT INTO finance_categories (id, gym_id, name, kind, system_key) VALUES (?, ?, ?, ?, ?)')
    .run(id, gymId, c.name + (db.prepare('SELECT 1 FROM finance_categories WHERE gym_id = ? AND kind = ? AND name = ?').get(gymId, c.kind, c.name) ? ' (sistema)' : ''), c.kind, key);
  return id;
}

export function addTransaction(db, { gymId, kind, categoryId, description, amountCents, date, paymentMethod = 'cash', source = 'manual', sourceId = null, userId = null }) {
  const id = newId();
  db.prepare(`INSERT INTO transactions (id, gym_id, kind, category_id, description, amount_cents, date, payment_method, source, source_id, created_by, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, gymId, kind, categoryId || null, description || '', amountCents, date, paymentMethod, source, sourceId, userId, nowIso());
  return id;
}

export function cancelTransaction(db, gymId, id) {
  if (!id) return;
  db.prepare("UPDATE transactions SET status = 'canceled', canceled_at = ? WHERE id = ? AND gym_id = ? AND status = 'active'").run(nowIso(), id, gymId);
}

/** Move stock of a product or supply item and keep the trail of why. */
export function moveStock(db, { gymId, kind, refId, qtyDelta, reason, sourceId = null, userId = null }) {
  const table = kind === 'product' ? 'products' : 'supply_items';
  db.prepare(`UPDATE ${table} SET stock_qty = stock_qty + ? WHERE id = ? AND gym_id = ?`).run(qtyDelta, refId, gymId);
  db.prepare('INSERT INTO stock_movements (id, gym_id, kind, ref_id, qty_delta, reason, source_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(newId(), gymId, kind, refId, qtyDelta, reason, sourceId, userId, nowIso());
}
