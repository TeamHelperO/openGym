/* Input checks shared by the SaaS route modules. A bad field is the caller's mistake: it throws a
 * SaasError, which the router answers with its status and message (never a logged 500). */
import { isDate } from './calc.js';

export const isUuid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
/** An id from the caller: a uuid, or a 400 (Postgres would refuse it with a server error). */
export function id(v, field = 'identificador', { opt = false } = {}) {
  if (v == null || v === '') { if (opt) return null; throw bad(`${field} é obrigatório`); }
  if (!isUuid(v)) throw bad(`${field} inválido`);
  return v;
}

export class SaasError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}
export const bad = (msg, code) => new SaasError(400, msg, code);
export const notFound = (what = 'registro') => new SaasError(404, `${what} não encontrado`);
export const forbidden = (msg = 'sem permissão para esta ação') => new SaasError(403, msg);

/** Trimmed text, at most `max` characters. Required unless `opt`. */
export function str(v, field, { max = 200, opt = false } = {}) {
  if (v == null || v === '') { if (opt) return ''; throw bad(`${field} é obrigatório`); }
  if (typeof v !== 'string' && typeof v !== 'number') throw bad(`${field} inválido`);
  const s = String(v).trim();
  if (!s && !opt) throw bad(`${field} é obrigatório`);
  if (s.length > max) throw bad(`${field} passa de ${max} caracteres`);
  return s;
}
/** A non-negative integer amount of cents. */
export function cents(v, field, { opt = false, positive = false } = {}) {
  if (v == null || v === '') { if (opt) return null; throw bad(`${field} é obrigatório`); }
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 1e11) throw bad(`${field} inválido`);
  if (positive && n === 0) throw bad(`${field} precisa ser maior que zero`);
  return n;
}
export function num(v, field, { min = -1e9, max = 1e9, opt = false, int = false } = {}) {
  if (v == null || v === '') { if (opt) return null; throw bad(`${field} é obrigatório`); }
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) throw bad(`${field} inválido`);
  return n;
}
export function date(v, field, { opt = false } = {}) {
  if (v == null || v === '') { if (opt) return null; throw bad(`${field} é obrigatório`); }
  if (!isDate(v)) throw bad(`${field} precisa ser uma data AAAA-MM-DD`);
  return v;
}
export function oneOf(v, field, allowed, { opt = false, def } = {}) {
  if (v == null || v === '') { if (opt) return def ?? null; throw bad(`${field} é obrigatório`); }
  if (!allowed.includes(v)) throw bad(`${field} inválido`);
  return v;
}
export const bool = v => v === true || v === 1 || v === '1' || v === 'true';

export const PAYMENT_METHODS = ['cash', 'pix', 'credit', 'debit', 'boleto', 'transfer', 'other'];

/** A URL-safe slug from a name. */
export function slugify(name) {
  return String(name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'academia';
}

/** A short code people can type: no 0/O, 1/I/L. */
export function inviteCode(rand) {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  const bytes = rand(8);
  for (let i = 0; i < 8; i++) s += A[bytes[i] % A.length];
  return s.slice(0, 4) + '-' + s.slice(4);
}

/** The columns of a gym row the routes read (the logo bytes stay behind). */
export const GYM_COLS = ['id', 'name', 'slug', 'legal_name', 'document', 'email', 'phone', 'address', 'primary_color',
  'custom_domain', 'kind', 'logo_type', 'logo_version', 'status', 'settings', 'created_by', 'created_at'];
