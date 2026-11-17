// Formatting and labels for the management area (pt-BR). Pure: no React, no store.

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
export const money = cents => BRL.format((Number(cents) || 0) / 100)

/** Cents from what a person typed in reais: "12,50", "R$ 1.234,56", "7.5". null when it is not money. */
export function parseCents(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) : null
  if (typeof v !== 'string') return null
  let s = v.trim().replace(/^R\$\s*/i, '')
  if (!s) return null
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null
  return Math.round(Number(s) * 100)
}
/** Cents as an editable reais string: 1250 -> "12,50". */
export const centsInput = c => (c == null ? '' : ((Number(c) || 0) / 100).toFixed(2).replace('.', ','))

export function dateBR(iso) {
  if (!iso) return '–'
  const d = String(iso).slice(0, 10).split('-')
  return d.length === 3 ? `${d[2]}/${d[1]}/${d[0]}` : iso
}
export function dateTimeBR(iso) {
  if (!iso) return '–'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
const pad = n => String(n).padStart(2, '0')
export const today = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const thisMonth = (d = new Date()) => today(d).slice(0, 7)
export function monthRange(month) {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${month}-01`, to: `${month}-${pad(last)}` }
}
export const MONTH_NAMES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
export const monthLabel = month => { const [y, m] = month.split('-'); return `${MONTH_NAMES[Number(m) - 1]} de ${y}` }
export function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`
}

export const ROLE_LABEL = { gym_admin: 'Administrador', trainer: 'Instrutor', student: 'Aluno' }
export const PAYMENT_LABEL = { cash: 'Dinheiro', pix: 'PIX', credit: 'Cartão de crédito', debit: 'Cartão de débito', boleto: 'Boleto', transfer: 'Transferência', other: 'Outro', account: 'Fiado (conta do aluno)' }
export const PAYMENT_METHODS = ['pix', 'cash', 'debit', 'credit', 'boleto', 'transfer', 'other']
export const CHARGE_STATUS = { open: 'Em aberto', paid: 'Pago', canceled: 'Cancelado' }
export const PURCHASE_STATUS = { draft: 'Rascunho', ordered: 'Pedido enviado', received: 'Recebido', canceled: 'Cancelado' }
export const KIND_LABEL = { income: 'Entrada', expense: 'Saída' }

export const qty = n => {
  const v = Number(n) || 0
  return Number.isInteger(v) ? String(v) : v.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
}
