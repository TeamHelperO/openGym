/* Turnstile rules (saas/access-rules.js) and the answers a Control iD device gets. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideAccess, accessSettings, controlIdAnswer } from '../saas/access-rules.js';

const gym = { status: 'active' };
const student = { role: 'student', status: 'active', name: 'Ana Souza', access_id: 1002 };
const today = '2026-11-17';

test('students get in unless inactive, suspended or overdue past the grace days', () => {
  assert.deepEqual(decideAccess({ gym, member: student, today }), { allow: true, reason: 'Acesso liberado' });
  assert.equal(decideAccess({ gym, member: null, today }).reason, 'Pessoa não cadastrada');
  assert.equal(decideAccess({ gym, member: { ...student, status: 'inactive' }, today }).allow, false);
  assert.equal(decideAccess({ gym: { status: 'suspended' }, member: student, today }).reason, 'Academia suspensa');
  // Due on the 10th, 5 days of grace: in on the 15th, out on the 16th.
  assert.equal(decideAccess({ gym, member: student, oldestOpenDue: '2026-11-12', today }).allow, true);
  assert.equal(decideAccess({ gym, member: student, oldestOpenDue: '2026-11-11', today }).reason, 'Mensalidade em atraso');
  const lenient = accessSettings({ access: { blockOverdue: false } });
  assert.equal(decideAccess({ gym, member: student, oldestOpenDue: '2026-01-01', today, settings: lenient }).allow, true);
  const planOnly = accessSettings({ access: { requirePlan: true } });
  assert.equal(decideAccess({ gym, member: student, today, settings: planOnly }).reason, 'Sem plano ativo');
  assert.equal(decideAccess({ gym, member: student, hasPlan: true, today, settings: planOnly }).allow, true);
});

test('the team always gets in, debts or not', () => {
  assert.equal(decideAccess({ gym, member: { role: 'trainer', status: 'active' }, oldestOpenDue: '2020-01-01', today }).allow, true);
});

test('accessSettings clamps what it reads', () => {
  assert.deepEqual(accessSettings({}), { blockOverdue: true, graceDays: 5, requirePlan: false });
  assert.equal(accessSettings({ access: { graceDays: 999 } }).graceDays, 5);
});

test('Control iD answers: event 7 turns the arm, 6 refuses, 3 is not identified', () => {
  const yes = controlIdAnswer({ allow: true, member: student, reason: 'Acesso liberado', releaseAction: 'catra_anticlockwise', portalId: 1 });
  assert.deepEqual(yes.result.actions, [{ action: 'catra', parameters: 'allow=anticlockwise' }]);
  assert.equal(yes.result.event, 7);
  assert.equal(yes.result.user_id, 1002);
  assert.equal(yes.result.message, 'Bem-vindo, Ana!');
  const no = controlIdAnswer({ allow: false, member: student, reason: 'Mensalidade em atraso' });
  assert.equal(no.result.event, 6);
  assert.deepEqual(no.result.actions, []);
  assert.equal(no.result.message, 'Mensalidade em atraso');
  assert.equal(controlIdAnswer({ identified: false }).result.event, 3);
  assert.deepEqual(controlIdAnswer({ allow: true, member: student, releaseAction: 'door' }).result.actions, [{ action: 'door', parameters: 'door=1' }]);
});
