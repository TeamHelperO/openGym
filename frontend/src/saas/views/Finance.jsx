// Finance: cash flow, the book of entries and exits, monthly fees, plans and categories.
import { useState } from 'react'
import { sa } from '../api.js'
import { useGym } from '../SaasApp.jsx'
import { useLoad, PageHead, Card, Table, Btn, Pill, Modal, Field, Input, Select, MoneyInput, Money, Stat, Tabs, Loading, LoadError, Confirm, act, notify } from '../ui.jsx'
import { dateBR, money, monthLabel, monthRange, shiftMonth, thisMonth, today, PAYMENT_LABEL, PAYMENT_METHODS, CHARGE_STATUS, KIND_LABEL } from '../lib/format.js'
import { PayCharge } from './MemberDetail.jsx'

function MonthNav({ month, setMonth }) {
  return <div className="sa-row">
    <Btn onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Mês anterior">‹</Btn>
    <strong className="sa-month">{monthLabel(month)}</strong>
    <Btn onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Próximo mês">›</Btn>
  </div>
}

function Overview({ gym, month }) {
  const { from, to } = monthRange(month)
  const f = useLoad(() => sa.get(`/gyms/${gym.id}/cashflow?from=${from}&to=${to}`), [gym.id, month])
  if (f.loading && !f.data) return <Loading />
  if (f.error) return <LoadError error={f.error} retry={f.reload} />
  const x = f.data
  const cat = kind => x.byCategory.filter(c => c.kind === kind)
  return <>
    <div className="sa-stats">
      <Stat label="Saldo inicial" value={money(x.openingBalanceCents)} />
      <Stat label="Entradas" value={money(x.incomeCents)} tone="good" />
      <Stat label="Saídas" value={money(x.expenseCents)} tone="bad" />
      <Stat label="Resultado do mês" value={money(x.resultCents)} tone={x.resultCents >= 0 ? 'good' : 'bad'} />
      <Stat label="Saldo final" value={money(x.closingBalanceCents)} />
      <Stat label="A receber" value={money(x.receivable.total)} hint={`${x.receivable.count} cobranças em aberto`} />
    </div>
    <div className="sa-grid-2">
      <Card title="Entradas por categoria"><Table rowKey={r => r.category} columns={[{ key: 'category', label: 'Categoria' }, { key: 'total', label: 'Total', align: 'right', render: r => <Money cents={r.total} tone="good" /> }]} rows={cat('income')} empty="Sem entradas." /></Card>
      <Card title="Saídas por categoria"><Table rowKey={r => r.category} columns={[{ key: 'category', label: 'Categoria' }, { key: 'total', label: 'Total', align: 'right', render: r => <Money cents={r.total} tone="bad" /> }]} rows={cat('expense')} empty="Sem saídas." /></Card>
    </div>
    <Card title="Por forma de pagamento">
      <Table rowKey={r => r.method + r.kind} columns={[
        { key: 'method', label: 'Forma', render: r => PAYMENT_LABEL[r.method] || r.method },
        { key: 'kind', label: 'Tipo', render: r => KIND_LABEL[r.kind] },
        { key: 'total', label: 'Total', align: 'right', render: r => <Money cents={r.total} /> }
      ]} rows={x.byMethod} empty="Nada no período." />
    </Card>
  </>
}

function NewTransaction({ gym, categories, onDone, onClose }) {
  const [f, setF] = useState({ kind: 'expense', description: '', amountCents: null, date: today(), paymentMethod: 'pix', categoryId: '' })
  const set = k => v => setF(x => ({ ...x, [k]: v?.target ? v.target.value : v }))
  const save = async () => {
    const r = await act(() => sa.post(`/gyms/${gym.id}/transactions`, { ...f, categoryId: f.categoryId || null }), 'Lançamento salvo')
    if (r) { onDone(); onClose() }
  }
  return <Modal title="Novo lançamento" onClose={onClose} footer={<><Btn onClick={onClose}>Cancelar</Btn><Btn kind="primary" disabled={!f.description.trim() || !f.amountCents} onClick={save}>Salvar</Btn></>}>
    <div className="sa-form">
      <Field label="Tipo"><Select value={f.kind} onChange={v => setF(x => ({ ...x, kind: v, categoryId: '' }))} options={[{ value: 'income', label: 'Entrada (recebimento)' }, { value: 'expense', label: 'Saída (pagamento)' }]} /></Field>
      <Field label="Descrição"><Input value={f.description} onChange={set('description')} placeholder="Ex.: Conta de luz de outubro" /></Field>
      <Field label="Valor"><MoneyInput value={f.amountCents} onChange={set('amountCents')} /></Field>
      <Field label="Categoria"><Select value={f.categoryId} onChange={set('categoryId')} placeholder="Outras" options={categories.filter(c => c.kind === f.kind).map(c => ({ value: c.id, label: c.name }))} /></Field>
      <Field label="Data"><Input type="date" value={f.date} onChange={set('date')} /></Field>
      <Field label="Forma de pagamento"><Select value={f.paymentMethod} onChange={set('paymentMethod')} options={PAYMENT_METHODS.map(v => ({ value: v, label: PAYMENT_LABEL[v] }))} /></Field>
    </div>
  </Modal>
}

function Ledger({ gym, month }) {
  const { from, to } = monthRange(month)
  const [kind, setKind] = useState('')
  const [adding, setAdding] = useState(false)
  const [cancel, setCancel] = useState(null)
  const cats = useLoad(() => sa.get(`/gyms/${gym.id}/categories`), [gym.id])
  const t = useLoad(() => sa.get(`/gyms/${gym.id}/transactions?from=${from}&to=${to}${kind ? '&kind=' + kind : ''}`), [gym.id, month, kind])
  const SOURCE = { manual: 'Manual', charge: 'Mensalidade/cobrança', sale: 'Venda PDV', purchase: 'Compra', cash: 'Caixa' }
  const rows = t.data?.transactions || []
  const sum = k => rows.filter(r => r.kind === k).reduce((n, r) => n + r.amount_cents, 0)
  return <Card title="Lançamentos" actions={<>
    <Select value={kind} onChange={setKind} placeholder="Entradas e saídas" options={[{ value: 'income', label: 'Só entradas' }, { value: 'expense', label: 'Só saídas' }]} />
    <Btn kind="primary" onClick={() => setAdding(true)}>Novo lançamento</Btn>
  </>}>
    {t.loading && !t.data ? <Loading /> : <LoadError error={t.error} retry={t.reload} />}
    <p className="sa-muted">Entradas <Money cents={sum('income')} tone="good" /> · Saídas <Money cents={sum('expense')} tone="bad" /></p>
    <Table columns={[
      { key: 'date', label: 'Data', render: r => dateBR(r.date) },
      { key: 'description', label: 'Descrição' },
      { key: 'category_name', label: 'Categoria', render: r => r.category_name || '–' },
      { key: 'source', label: 'Origem', render: r => SOURCE[r.source] },
      { key: 'payment_method', label: 'Forma', render: r => PAYMENT_LABEL[r.payment_method] || r.payment_method },
      { key: 'amount_cents', label: 'Valor', align: 'right', render: r => <Money cents={r.kind === 'income' ? r.amount_cents : -r.amount_cents} tone={r.kind === 'income' ? 'good' : 'bad'} /> },
      { key: 'x', label: '', align: 'right', render: r => (r.source === 'manual' ? <Btn onClick={() => setCancel(r)}>Estornar</Btn> : null) }
    ]} rows={rows} empty="Nenhum lançamento no mês." />
    {adding && <NewTransaction gym={gym} categories={cats.data?.categories || []} onDone={t.reload} onClose={() => setAdding(false)} />}
    {cancel && <Confirm title="Estornar lançamento" danger confirm="Estornar" text={`"${cancel.description}" sai do caixa e dos relatórios.`}
      onYes={() => act(() => sa.post(`/gyms/${gym.id}/transactions/${cancel.id}/cancel`), 'Lançamento estornado').then(t.reload)} onClose={() => setCancel(null)} />}
  </Card>
}

function NewCharge({ gym, onDone, onClose }) {
  const people = useLoad(() => sa.get(`/gyms/${gym.id}/members?role=student`), [gym.id])
  const [f, setF] = useState({ memberId: '', description: '', amountCents: null, dueDate: today() })
  const save = async () => {
    const r = await act(() => sa.post(`/gyms/${gym.id}/charges`, f), 'Cobrança criada')
    if (r) { onDone(); onClose() }
  }
  return <Modal title="Cobrança avulsa" onClose={onClose} footer={<><Btn onClick={onClose}>Cancelar</Btn><Btn kind="primary" disabled={!f.memberId || !f.amountCents || !f.description.trim()} onClick={save}>Criar</Btn></>}>
    <div className="sa-form">
      <Field label="Aluno"><Select value={f.memberId} onChange={v => setF({ ...f, memberId: v })} placeholder="Escolha" options={(people.data?.members || []).map(m => ({ value: m.id, label: m.name }))} /></Field>
      <Field label="Descrição"><Input value={f.description} onChange={e => setF({ ...f, description: e.target.value })} placeholder="Ex.: Avaliação física, taxa de matrícula" /></Field>
      <Field label="Valor"><MoneyInput value={f.amountCents} onChange={v => setF({ ...f, amountCents: v })} /></Field>
      <Field label="Vencimento"><Input type="date" value={f.dueDate} onChange={e => setF({ ...f, dueDate: e.target.value })} /></Field>
    </div>
  </Modal>
}

function Fees({ gym, month }) {
  const [status, setStatus] = useState('all')
  const [pay, setPay] = useState(null)
  const [adding, setAdding] = useState(false)
  const c = useLoad(() => sa.get(`/gyms/${gym.id}/charges?${status === 'overdue' ? 'status=overdue' : `month=${month}&status=${status}`}`), [gym.id, month, status])
  const rows = c.data?.charges || []
  const total = s => rows.filter(r => r.status === s).reduce((n, r) => n + r.amount_cents, 0)
  const generate = async () => {
    const r = await act(() => sa.post(`/gyms/${gym.id}/charges/generate`, { month }))
    if (r) { notify(r.created ? `${r.created} mensalidades geradas` : 'Nenhuma mensalidade nova para gerar'); c.reload() }
  }
  const remind = r => `https://wa.me/${(r.member_phone || '').replace(/\D/g, '')}?text=${encodeURIComponent(`Olá, ${r.member_name}! Lembrete da ${gym.name}: ${r.description} de ${money(r.amount_cents)} vence em ${dateBR(r.due_date)}.`)}`
  return <Card title="Mensalidades e cobranças" actions={<>
    <Select value={status} onChange={setStatus} options={[{ value: 'all', label: 'Todas do mês' }, { value: 'open', label: 'Em aberto' }, { value: 'paid', label: 'Pagas' }, { value: 'overdue', label: 'Atrasadas (todos os meses)' }]} />
    <Btn onClick={() => setAdding(true)}>Cobrança avulsa</Btn>
    <Btn kind="primary" onClick={generate}>Gerar mensalidades do mês</Btn>
  </>}>
    <p className="sa-muted">Recebido <Money cents={total('paid')} tone="good" /> · Em aberto <Money cents={total('open')} /></p>
    {c.loading && !c.data ? <Loading /> : <LoadError error={c.error} retry={c.reload} />}
    <Table columns={[
      { key: 'member_name', label: 'Aluno' },
      { key: 'description', label: 'Descrição' },
      { key: 'due_date', label: 'Vencimento', render: r => dateBR(r.due_date) },
      { key: 'amount_cents', label: 'Valor', align: 'right', render: r => <Money cents={r.amount_cents} /> },
      { key: 'status', label: 'Situação', render: r => <Pill tone={r.status === 'paid' ? 'ok' : r.overdue ? 'bad' : r.status === 'open' ? 'warn' : ''}>{r.overdue ? 'Atrasada' : CHARGE_STATUS[r.status]}</Pill> },
      { key: 'x', label: '', align: 'right', render: r => (r.status === 'open'
        ? <span className="sa-row end">{r.member_phone && <a className="sa-btn" href={remind(r)} target="_blank" rel="noreferrer">Lembrar</a>}<Btn kind="primary" onClick={() => setPay(r)}>Receber</Btn><Btn onClick={() => act(() => sa.post(`/gyms/${gym.id}/charges/${r.id}/cancel`), 'Cobrança cancelada').then(c.reload)}>Cancelar</Btn></span>
        : r.status === 'paid' ? <span className="sa-row end"><small>{dateBR(r.paid_at)} · {PAYMENT_LABEL[r.payment_method]}</small><Btn onClick={() => act(() => sa.post(`/gyms/${gym.id}/charges/${r.id}/reopen`), 'Pagamento desfeito').then(c.reload)}>Desfazer</Btn></span> : null) }
    ]} rows={rows} empty="Nenhuma cobrança. Cadastre planos e ative nos alunos, depois gere as mensalidades." />
    {pay && <PayCharge gym={gym} charge={pay} onDone={c.reload} onClose={() => setPay(null)} />}
    {adding && <NewCharge gym={gym} onDone={c.reload} onClose={() => setAdding(false)} />}
  </Card>
}

function Plans({ gym }) {
  const p = useLoad(() => sa.get(`/gyms/${gym.id}/plans`), [gym.id])
  const [edit, setEdit] = useState(null)
  const save = async () => {
    const body = { name: edit.name, description: edit.description, priceCents: edit.price_cents, intervalMonths: Number(edit.interval_months), active: edit.active !== 0 }
    const r = await act(() => (edit.id ? sa.put(`/gyms/${gym.id}/plans/${edit.id}`, body) : sa.post(`/gyms/${gym.id}/plans`, body)), 'Plano salvo')
    if (r) { setEdit(null); p.reload() }
  }
  const INTERVAL = { 1: 'Mensal', 2: 'Bimestral', 3: 'Trimestral', 6: 'Semestral', 12: 'Anual' }
  return <Card title="Planos" actions={<Btn kind="primary" onClick={() => setEdit({ name: '', description: '', price_cents: null, interval_months: 1, active: 1 })}>Novo plano</Btn>}>
    {p.loading && !p.data ? <Loading /> : <Table columns={[
      { key: 'name', label: 'Plano', render: r => <><strong>{r.name}</strong>{r.description && <div className="sa-muted small">{r.description}</div>}</> },
      { key: 'price_cents', label: 'Valor', render: r => <Money cents={r.price_cents} /> },
      { key: 'interval_months', label: 'Cobrança', render: r => INTERVAL[r.interval_months] || `A cada ${r.interval_months} meses` },
      { key: 'active_subscriptions', label: 'Alunos', align: 'right' },
      { key: 'active', label: 'Situação', render: r => (r.active ? <Pill tone="ok">Ativo</Pill> : <Pill>Inativo</Pill>) }
    ]} rows={p.data?.plans} onRow={r => setEdit(r)} empty="Nenhum plano. Ex.: Mensal R$ 99,90; Trimestral; Anual." />}
    {edit && <Modal title={edit.id ? 'Editar plano' : 'Novo plano'} onClose={() => setEdit(null)} footer={<><Btn onClick={() => setEdit(null)}>Cancelar</Btn><Btn kind="primary" disabled={!edit.name.trim() || edit.price_cents == null} onClick={save}>Salvar</Btn></>}>
      <div className="sa-form">
        <Field label="Nome"><Input value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} /></Field>
        <Field label="Valor por cobrança"><MoneyInput value={edit.price_cents} onChange={v => setEdit({ ...edit, price_cents: v })} /></Field>
        <Field label="Periodicidade"><Select value={String(edit.interval_months)} onChange={v => setEdit({ ...edit, interval_months: Number(v) })} options={Object.entries(INTERVAL).map(([value, label]) => ({ value, label }))} /></Field>
        <Field label="Descrição"><Input value={edit.description} onChange={e => setEdit({ ...edit, description: e.target.value })} /></Field>
        {edit.id && <label className="sa-check"><input type="checkbox" checked={!!edit.active} onChange={e => setEdit({ ...edit, active: e.target.checked ? 1 : 0 })} /> Plano ativo (aceita novos alunos)</label>}
      </div>
    </Modal>}
  </Card>
}

function Categories({ gym }) {
  const c = useLoad(() => sa.get(`/gyms/${gym.id}/categories`), [gym.id])
  const [name, setName] = useState('')
  const [kind, setKind] = useState('expense')
  const add = async () => { const r = await act(() => sa.post(`/gyms/${gym.id}/categories`, { name, kind }), 'Categoria criada'); if (r) { setName(''); c.reload() } }
  return <Card title="Categorias">
    <div className="sa-filters">
      <Input placeholder="Nova categoria" value={name} onChange={e => setName(e.target.value)} />
      <Select value={kind} onChange={setKind} options={[{ value: 'income', label: 'Entrada' }, { value: 'expense', label: 'Saída' }]} />
      <Btn kind="primary" disabled={!name.trim()} onClick={add}>Adicionar</Btn>
    </div>
    <Table columns={[
      { key: 'name', label: 'Categoria' },
      { key: 'kind', label: 'Tipo', render: r => KIND_LABEL[r.kind] },
      { key: 'x', label: '', align: 'right', render: r => (r.system_key ? <small className="sa-muted">do sistema</small> : <Btn onClick={() => act(() => sa.del(`/gyms/${gym.id}/categories/${r.id}`), 'Categoria removida').then(c.reload)}>Remover</Btn>) }
    ]} rows={c.data?.categories} />
  </Card>
}

export default function Finance() {
  const { gym } = useGym()
  const [tab, setTab] = useState('overview')
  const [month, setMonth] = useState(thisMonth())
  return <>
    <PageHead title="Financeiro" subtitle="Entradas, saídas, mensalidades e fluxo de caixa.">
      {tab !== 'plans' && tab !== 'categories' && <MonthNav month={month} setMonth={setMonth} />}
    </PageHead>
    <Tabs value={tab} onChange={setTab} tabs={[['overview', 'Fluxo de caixa'], ['ledger', 'Lançamentos'], ['fees', 'Mensalidades'], ['plans', 'Planos'], ['categories', 'Categorias']]} />
    {tab === 'overview' && <Overview gym={gym} month={month} />}
    {tab === 'ledger' && <Ledger gym={gym} month={month} />}
    {tab === 'fees' && <Fees gym={gym} month={month} />}
    {tab === 'plans' && <Plans gym={gym} />}
    {tab === 'categories' && <Categories gym={gym} />}
  </>
}
