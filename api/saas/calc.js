/* Pure money and date rules of the SaaS modules, kept apart from the routes so each one has a
 * unit test (test/saas-calc.test.js). Money is always integer cents. */

/** Totals of a sale: items [{qty, unitPriceCents}], a discount in cents and what was handed over. */
export function saleTotals(items, discountCents = 0, paidCents = null) {
  const lines = items.map(i => ({ ...i, totalCents: Math.round(i.qty * i.unitPriceCents) }));
  const subtotal = lines.reduce((n, l) => n + l.totalCents, 0);
  const discount = Math.max(0, Math.min(subtotal, Math.round(discountCents || 0)));
  const total = subtotal - discount;
  const paid = paidCents == null ? total : Math.round(paidCents);
  return { lines, subtotal, discount, total, paid, change: Math.max(0, paid - total) };
}

/** What should be in the drawer: opening + cash sales + deposits - withdrawals. */
export function cashExpected({ openingCents = 0, cashSalesCents = 0, depositsCents = 0, withdrawalsCents = 0 }) {
  return openingCents + cashSalesCents + depositsCents - withdrawalsCents;
}

const pad = n => String(n).padStart(2, '0');
export const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
export const isMonth = s => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
export const todayDate = (now = new Date()) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
export const monthOf = date => date.slice(0, 7);

/** The due date of a monthly fee in `month` ('YYYY-MM') for a due day 1..28. */
export function dueDateFor(month, dueDay) {
  return `${month}-${pad(Math.min(28, Math.max(1, dueDay)))}`;
}

/** Whole months between two 'YYYY-MM' values (b - a). */
export function monthsBetween(a, b) {
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

/** Whether a subscription bills in `month`: started on or before it, on its interval. */
export function billsInMonth(sub, month) {
  const start = monthOf(sub.start_date);
  const diff = monthsBetween(start, month);
  if (diff < 0) return false;
  return diff % (sub.interval_months || 1) === 0;
}

/** First and last day of a month. */
export function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${pad(last)}` };
}

/** A charge is overdue when it is still open after its due date. */
export const isOverdue = (charge, today) => charge.status === 'open' && charge.due_date < today;

/** Cents from a reais value a person typed ("12,50", "12.50", 12.5). null when it is not money. */
export function parseCents(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) : null;
  if (typeof v !== 'string') return null;
  let s = v.trim().replace(/^R\$\s*/i, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}
