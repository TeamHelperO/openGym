// The one way money and stock move. Fees, shop sales, purchases and manual entries all write
// through here, inside the caller's transaction (q is sql or a transaction), so a sale and its
// income, or a received order and its expense, never land one without the other.

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

export async function seedCategories(q, gymId) {
  for (const c of DEFAULT_CATEGORIES) {
    await q`insert into opengym.gym_categories (gym_id, name, kind, system_key) values (${gymId}, ${c.name}, ${c.kind}, ${c.key})`;
  }
}

/** The id of a built-in category, recreated if someone deleted it. */
export async function systemCategory(q, gymId, key) {
  const [row] = await q`select id from opengym.gym_categories where gym_id = ${gymId} and system_key = ${key}`;
  if (row) return row.id;
  const c = DEFAULT_CATEGORIES.find(x => x.key === key);
  const [taken] = await q`select 1 from opengym.gym_categories where gym_id = ${gymId} and kind = ${c.kind} and name = ${c.name}`;
  const [made] = await q`insert into opengym.gym_categories (gym_id, name, kind, system_key)
    values (${gymId}, ${c.name + (taken ? ' (sistema)' : '')}, ${c.kind}, ${key}) returning id`;
  return made.id;
}

export async function addTransaction(q, { gymId, kind, categoryId, description, amountCents, date, paymentMethod = 'cash', source = 'manual', sourceId = null, userId = null }) {
  const [t] = await q`insert into opengym.gym_transactions (gym_id, kind, category_id, description, amount_cents, date, payment_method, source, source_id, created_by)
    values (${gymId}, ${kind}, ${categoryId || null}, ${description || ''}, ${amountCents}, ${date}, ${paymentMethod}, ${source}, ${sourceId}, ${userId}) returning id`;
  return t.id;
}

export async function cancelTransaction(q, gymId, id) {
  if (!id) return;
  await q`update opengym.gym_transactions set status = 'canceled', canceled_at = now() where id = ${id} and gym_id = ${gymId} and status = 'active'`;
}

/** Move stock of a product or supply item and keep the trail of why. */
export async function moveStock(q, { gymId, kind, refId, qtyDelta, reason, sourceId = null, userId = null }) {
  if (kind === 'product') await q`update opengym.gym_products set stock_qty = stock_qty + ${qtyDelta} where id = ${refId} and gym_id = ${gymId}`;
  else await q`update opengym.gym_supplies set stock_qty = stock_qty + ${qtyDelta} where id = ${refId} and gym_id = ${gymId}`;
  await q`insert into opengym.gym_stock_moves (gym_id, kind, ref_id, qty_delta, reason, source_id, created_by)
    values (${gymId}, ${kind}, ${refId}, ${qtyDelta}, ${reason}, ${sourceId}, ${userId})`;
}
