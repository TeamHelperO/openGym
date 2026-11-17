/* Who gets through the turnstile. Pure, so every rule has a test (test/saas-access.test.js). */

export const DEFAULT_ACCESS = { blockOverdue: true, graceDays: 5, requirePlan: false };

export function accessSettings(gymSettings) {
  const a = (gymSettings && gymSettings.access) || {};
  return {
    blockOverdue: a.blockOverdue !== false,
    graceDays: Number.isInteger(a.graceDays) && a.graceDays >= 0 && a.graceDays <= 60 ? a.graceDays : DEFAULT_ACCESS.graceDays,
    requirePlan: a.requirePlan === true
  };
}

const addDays = (iso, n) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * The decision for one identification.
 *   gym:     { status }
 *   member:  { role, status } or null when the id matched nobody
 *   oldestOpenDue: the earliest due date among the member's open charges, or null
 *   hasPlan: whether the member has an active subscription
 */
export function decideAccess({ gym, member, oldestOpenDue = null, hasPlan = false, today, settings = DEFAULT_ACCESS }) {
  if (!gym || gym.status !== 'active') return { allow: false, reason: 'Academia suspensa' };
  if (!member) return { allow: false, reason: 'Pessoa não cadastrada' };
  if (member.status !== 'active') return { allow: false, reason: 'Cadastro inativo' };
  // The team always gets in: the turnstile is not where their contract is checked.
  if (member.role !== 'student') return { allow: true, reason: 'Equipe' };
  if (settings.requirePlan && !hasPlan) return { allow: false, reason: 'Sem plano ativo' };
  if (settings.blockOverdue && oldestOpenDue && addDays(oldestOpenDue, settings.graceDays) < today) {
    return { allow: false, reason: 'Mensalidade em atraso' };
  }
  return { allow: true, reason: 'Acesso liberado' };
}

/** What a Control iD device does on a release (online mode answer or execute_actions). */
export const RELEASE_ACTIONS = {
  catra_clockwise: { action: 'catra', parameters: 'allow=clockwise' },
  catra_anticlockwise: { action: 'catra', parameters: 'allow=anticlockwise' },
  catra_both: { action: 'catra', parameters: 'allow=both' },
  door: { action: 'door', parameters: 'door=1' },
  sec_box: { action: 'sec_box', parameters: 'id=65793,reason=1' }
};

/** The reply a Control iD device in online (Pro) mode expects after an identification. */
export function controlIdAnswer({ allow, member, reason, releaseAction = 'catra_clockwise', portalId = 0, identified = true }) {
  if (!identified) {
    return { result: { event: 3, user_id: 0, user_name: '', user_image: false, portal_id: portalId, actions: [], message: reason || 'Não identificado' } };
  }
  const first = member?.name ? String(member.name).split(' ')[0] : '';
  return {
    result: {
      event: allow ? 7 : 6,
      user_id: member?.access_id || 0,
      user_name: member?.name || '',
      user_image: false,
      portal_id: portalId,
      actions: allow ? [RELEASE_ACTIONS[releaseAction] || RELEASE_ACTIONS.catra_clockwise] : [],
      message: allow ? (first ? `Bem-vindo, ${first}!` : 'Acesso liberado') : reason
    }
  };
}
