/* The money and date rules behind the shop, the drawer and the monthly fees (saas/calc.js). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saleTotals, cashExpected, dueDateFor, billsInMonth, monthRange, parseCents, isDate, isMonth, monthsBetween } from '../saas/calc.js';

test('saleTotals adds lines, clamps the discount and gives change', () => {
  const t = saleTotals([{ qty: 2, unitPriceCents: 500 }, { qty: 1, unitPriceCents: 1250 }], 250, 5000);
  assert.equal(t.subtotal, 2250);
  assert.equal(t.discount, 250);
  assert.equal(t.total, 2000);
  assert.equal(t.change, 3000);
  assert.equal(saleTotals([{ qty: 1, unitPriceCents: 100 }], 999).total, 0, 'a discount never takes the total below zero');
  assert.equal(saleTotals([{ qty: 1, unitPriceCents: 100 }]).change, 0);
});

test('cashExpected follows opening, cash sales, deposits and withdrawals', () => {
  assert.equal(cashExpected({ openingCents: 10000, cashSalesCents: 4500, depositsCents: 1000, withdrawalsCents: 3000 }), 12500);
});

test('monthly fee dates', () => {
  assert.equal(dueDateFor('2026-02', 10), '2026-02-10');
  assert.equal(dueDateFor('2026-02', 31), '2026-02-28');
  assert.deepEqual(monthRange('2024-02'), { from: '2024-02-01', to: '2024-02-29' });
  assert.equal(monthsBetween('2025-11', '2026-02'), 3);
  const quarterly = { start_date: '2026-01-15', interval_months: 3 };
  assert.deepEqual(['2025-12', '2026-01', '2026-02', '2026-04', '2026-07'].map(m => billsInMonth(quarterly, m)), [false, true, false, true, true]);
});

test('parseCents reads what a person types in reais', () => {
  assert.equal(parseCents('12,50'), 1250);
  assert.equal(parseCents('R$ 1.234,56'), 123456);
  assert.equal(parseCents('7.5'), 750);
  assert.equal(parseCents(3), 300);
  assert.equal(parseCents('abc'), null);
  assert.equal(parseCents(''), null);
});

test('isDate and isMonth', () => {
  assert.ok(isDate('2026-11-17'));
  assert.ok(!isDate('2026-13-01'));
  assert.ok(!isDate('17/11/2026'));
  assert.ok(isMonth('2026-11'));
  assert.ok(!isMonth('2026-13'));
});
