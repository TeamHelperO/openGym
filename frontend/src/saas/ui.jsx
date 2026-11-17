// Building blocks of the management area: a wide, desktop-first layout that still works on a phone.
import { useCallback, useEffect, useRef, useState } from 'react'
import { money, parseCents, centsInput } from './lib/format.js'

/** Load once and on `deps`; `reload()` to fetch again. */
export function useLoad(fn, deps = []) {
  const [state, setState] = useState({ loading: true, error: null, data: null })
  const seq = useRef(0)
  const run = useCallback(() => {
    const n = ++seq.current
    setState(s => ({ ...s, loading: true, error: null }))
    Promise.resolve().then(fn).then(
      data => { if (n === seq.current) setState({ loading: false, error: null, data }) },
      error => { if (n === seq.current) setState(s => ({ loading: false, error, data: s.data })) }
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => { run() }, [run])
  return { ...state, reload: run }
}

let toastFn = null
export function notify(msg, kind = 'ok') { if (toastFn) toastFn({ msg, kind, at: Date.now() }) }
export function Toaster() {
  const [t, setT] = useState(null)
  useEffect(() => { toastFn = setT; return () => { toastFn = null } }, [])
  useEffect(() => { if (!t) return; const id = setTimeout(() => setT(null), 3500); return () => clearTimeout(id) }, [t])
  if (!t) return null
  return <div className={'sa-toast ' + t.kind} role="status">{t.msg}</div>
}

/** Run an action, show its error as a toast, and say `done` when it worked. */
export async function act(fn, done) {
  try { const r = await fn(); if (done) notify(done); return r }
  catch (e) { notify(e.message || 'Algo deu errado', 'err'); return undefined }
}

export function PageHead({ title, subtitle, children }) {
  return <div className="sa-head">
    <div><h1>{title}</h1>{subtitle && <p className="sa-muted">{subtitle}</p>}</div>
    {children && <div className="sa-head-actions">{children}</div>}
  </div>
}
export const Card = ({ title, actions, children, className = '' }) => (
  <section className={'sa-card ' + className}>
    {(title || actions) && <div className="sa-card-head">{title && <h2>{title}</h2>}{actions && <div className="sa-row">{actions}</div>}</div>}
    {children}
  </section>
)
export const Stat = ({ label, value, hint, tone }) => (
  <div className={'sa-stat ' + (tone || '')}><div className="sa-stat-label">{label}</div><div className="sa-stat-value">{value}</div>{hint && <div className="sa-stat-hint">{hint}</div>}</div>
)
export const Btn = ({ kind = 'plain', className = '', ...rest }) => <button type="button" className={`sa-btn ${kind} ${className}`} {...rest} />
export const Pill = ({ tone = '', children }) => <span className={'sa-pill ' + tone}>{children}</span>
export const Empty = ({ children }) => <div className="sa-empty">{children}</div>
export const Loading = () => <div className="sa-empty">Carregando…</div>
export function LoadError({ error, retry }) {
  if (!error) return null
  return <div className="sa-error">{error.message || 'Não foi possível carregar.'} {retry && <Btn onClick={retry}>Tentar de novo</Btn>}</div>
}

// A label around one input. `group` for a row of controls (buttons beside a field): a <label>
// would name every control inside it after the label text.
export function Field({ label, hint, children, wide, group }) {
  const Tag = group ? 'div' : 'label'
  return <Tag className={'sa-field' + (wide ? ' wide' : '')} {...(group ? { role: 'group', 'aria-label': label } : {})}><span>{label}</span>{children}{hint && <small>{hint}</small>}</Tag>
}
export const Input = props => <input className="sa-input" {...props} />
export const Area = props => <textarea className="sa-input" rows={3} {...props} />
export function Select({ value, onChange, options, placeholder, ...rest }) {
  return <select className="sa-input" value={value ?? ''} onChange={e => onChange(e.target.value)} {...rest}>
    {placeholder !== undefined && <option value="">{placeholder}</option>}
    {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
  </select>
}
/** A reais field holding cents. */
export function MoneyInput({ value, onChange, ...rest }) {
  const [draft, setDraft] = useState(centsInput(value))
  useEffect(() => { if (parseCents(draft) !== value) setDraft(centsInput(value)) // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  return <div className="sa-money"><span>R$</span><input className="sa-input" inputMode="decimal" value={draft} placeholder="0,00"
    onChange={e => { setDraft(e.target.value); const c = parseCents(e.target.value); onChange(c == null ? null : c) }} {...rest} /></div>
}
export const Money = ({ cents, tone }) => <span className={'sa-money-val ' + (tone || '')}>{money(cents)}</span>

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const k = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return <div className="sa-modal-back" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
    <div className={'sa-modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={title}>
      <div className="sa-modal-head"><h2>{title}</h2><button type="button" className="sa-x" aria-label="Fechar" onClick={onClose}>×</button></div>
      <div className="sa-modal-body">{children}</div>
      {footer && <div className="sa-modal-foot">{footer}</div>}
    </div>
  </div>
}

export function Tabs({ tabs, value, onChange }) {
  return <div className="sa-tabs" role="tablist">
    {tabs.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={value === k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{label}</button>)}
  </div>
}

/** A table that turns into cards on a phone. columns: [{ key, label, render?, align? }] */
export function Table({ columns, rows, onRow, empty = 'Nada por aqui ainda.', rowKey = r => r.id }) {
  if (!rows?.length) return <Empty>{empty}</Empty>
  return <div className="sa-table-wrap"><table className="sa-table">
    <thead><tr>{columns.map(c => <th key={c.key} style={{ textAlign: c.align || 'left' }}>{c.label}</th>)}</tr></thead>
    <tbody>{rows.map(r => <tr key={rowKey(r)} onClick={onRow ? () => onRow(r) : undefined} className={onRow ? 'click' : ''}>
      {columns.map(c => <td key={c.key} data-label={c.label} style={{ textAlign: c.align || 'left' }}>{c.render ? c.render(r) : r[c.key]}</td>)}
    </tr>)}</tbody>
  </table></div>
}

export function Confirm({ title, text, confirm = 'Confirmar', danger, onYes, onClose }) {
  const [busy, setBusy] = useState(false)
  return <Modal title={title} onClose={onClose} footer={<>
    <Btn onClick={onClose}>Voltar</Btn>
    <Btn kind={danger ? 'danger' : 'primary'} disabled={busy} onClick={async () => { setBusy(true); await onYes(); setBusy(false); onClose() }}>{confirm}</Btn>
  </>}><p>{text}</p></Modal>
}
