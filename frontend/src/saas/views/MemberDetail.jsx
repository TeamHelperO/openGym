// One person of the academy: profile, access, training (students) and money (administrators).
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { sa } from '../api.js'
import { useGym } from '../SaasApp.jsx'
import { useLoad, PageHead, Card, Btn, Pill, Modal, Table, Loading, LoadError, Money, Field, Input, Select, MoneyInput, Confirm, act, notify, Stat, Tabs } from '../ui.jsx'
import { ROLE_LABEL, dateBR, CHARGE_STATUS, PAYMENT_LABEL, PAYMENT_METHODS, today } from '../lib/format.js'
import MemberForm, { memberToForm, useMemberForm } from './MemberForm.jsx'
import { InviteNotice } from './Members.jsx'
import AssessmentsPanel from './Assessments.jsx'
import NutritionPanel from './Nutrition.jsx'
import { isPersonal } from '../product.js'

// Turnstile side of a person: number, card, fingerprint enrollment, entries.
function AccessCard({ gym, m }) {
  const devices = useLoad(() => sa.get(`/gyms/${gym.id}/access/devices`), [gym.id])
  const logs = useLoad(() => sa.get(`/gyms/${gym.id}/access/logs?memberId=${m.id}`), [gym.id, m.id])
  const [card, setCard] = useState(m.card_number || '')
  const [deviceId, setDeviceId] = useState('')
  const [verdict, setVerdict] = useState(null)
  const cid = (devices.data?.devices || []).filter(d => d.kind === 'controlid' && d.active)
  const enroll = async () => {
    const r = await act(() => sa.post(`/gyms/${gym.id}/members/${m.id}/enroll`, { deviceId: deviceId || cid[0]?.id, type: 'biometry' }))
    if (r) notify(r.note)
  }
  return <Card title="Catraca e acesso" actions={<Btn kind="primary" onClick={async () => { const r = await act(() => sa.post(`/gyms/${gym.id}/access/checkin`, { memberId: m.id })); if (r) { setVerdict(r); logs.reload() } }}>Registrar entrada</Btn>}>
    {verdict && <div className={verdict.allow ? 'sa-ok sa-verdict ok' : 'sa-error sa-verdict'}><strong>{verdict.allow ? 'Liberado' : 'Negado'}</strong> · {verdict.reason}</div>}
    <dl className="sa-dl">
      <dt>Nº de acesso</dt><dd><strong>{m.access_id}</strong> <span className="sa-muted small">(é o número desta pessoa nas catracas)</span></dd>
    </dl>
    <div className="sa-form cols">
      <Field group label="Cartão / chaveiro (opcional)"><div className="sa-row"><Input inputMode="numeric" value={card} onChange={e => setCard(e.target.value)} placeholder="Número impresso no cartão" /><Btn onClick={() => act(() => sa.put(`/gyms/${gym.id}/members/${m.id}/card`, { cardNumber: card }), 'Cartão salvo')}>Salvar</Btn></div></Field>
      <Field group label="Digital"><div className="sa-row">
        {cid.length > 1 && <Select value={deviceId} onChange={setDeviceId} options={cid.map(d => ({ value: d.id, label: d.name }))} />}
        <Btn kind="primary" disabled={!cid.length} onClick={enroll}>Cadastrar digital</Btn>
      </div></Field>
    </div>
    {!cid.length && <p className="sa-muted small">Cadastre uma catraca Control iD em Catracas e acesso para registrar digitais por aqui.</p>}
    <h3>Últimas entradas</h3>
    <Table columns={[
      { key: 'at', label: 'Quando', render: r => dateBR(r.at) + ' ' + new Date(r.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) },
      { key: 'device_name', label: 'Onde', render: r => r.device_name || 'Recepção' },
      { key: 'allowed', label: 'Resultado', render: r => (r.allowed ? <Pill tone="ok">Liberado</Pill> : <Pill tone="bad">Negado</Pill>) },
      { key: 'reason', label: 'Motivo' }
    ]} rows={(logs.data?.logs || []).slice(0, 15)} empty="Nenhuma entrada registrada." />
  </Card>
}

function EditMember({ gym, m, trainers, canRole, onDone, onClose }) {
  const [f, set] = useMemberForm(memberToForm(m))
  const save = async () => {
    const r = await act(() => sa.put(`/gyms/${gym.id}/members/${m.id}`, { ...f, birthDate: f.birthDate || null, trainerMemberId: f.trainerMemberId || null }), 'Dados salvos')
    if (r) { onDone(); onClose() }
  }
  return <Modal wide title={`Editar ${m.name}`} onClose={onClose} footer={<><Btn onClick={onClose}>Cancelar</Btn><Btn kind="primary" onClick={save}>Salvar</Btn></>}>
    <MemberForm f={f} set={set} trainers={trainers} canRole={canRole} />
  </Modal>
}

export function PayCharge({ gym, charge, onDone, onClose }) {
  const [method, setMethod] = useState('pix')
  const [amount, setAmount] = useState(charge.amount_cents)
  const [date, setDate] = useState(today())
  const pay = async () => {
    const r = await act(() => sa.post(`/gyms/${gym.id}/charges/${charge.id}/pay`, { paymentMethod: method, amountCents: amount, date }), 'Pagamento registrado')
    if (r) { onDone(); onClose() }
  }
  return <Modal title="Registrar pagamento" onClose={onClose} footer={<><Btn onClick={onClose}>Cancelar</Btn><Btn kind="primary" disabled={!amount} onClick={pay}>Confirmar recebimento</Btn></>}>
    <p>{charge.description}{charge.member_name ? ` · ${charge.member_name}` : ''}</p>
    <div className="sa-form">
      <Field label="Valor recebido"><MoneyInput value={amount} onChange={setAmount} /></Field>
      <Field label="Forma de pagamento"><Select value={method} onChange={setMethod} options={PAYMENT_METHODS.map(v => ({ value: v, label: PAYMENT_LABEL[v] }))} /></Field>
      <Field label="Data do pagamento"><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
    </div>
  </Modal>
}

function Subscribe({ gym, m, onDone, onClose }) {
  const plans = useLoad(() => sa.get(`/gyms/${gym.id}/plans`), [gym.id])
  const [planId, setPlanId] = useState('')
  const [dueDay, setDueDay] = useState('10')
  const [start, setStart] = useState(today())
  const plan = plans.data?.plans.find(p => p.id === planId)
  const [price, setPrice] = useState(null)
  const save = async () => {
    const r = await act(() => sa.post(`/gyms/${gym.id}/subscriptions`, { memberId: m.id, planId, dueDay: Number(dueDay), startDate: start, priceCents: price ?? undefined }), 'Plano ativado')
    if (r) { onDone(); onClose() }
  }
  return <Modal title="Ativar plano" onClose={onClose} footer={<><Btn onClick={onClose}>Cancelar</Btn><Btn kind="primary" disabled={!planId} onClick={save}>Ativar</Btn></>}>
    {plans.data && !plans.data.plans.length && <p className="sa-muted">Cadastre os planos em Financeiro &gt; Planos primeiro.</p>}
    <div className="sa-form">
      <Field label="Plano"><Select value={planId} onChange={v => { setPlanId(v); setPrice(null) }} placeholder="Escolha" options={(plans.data?.plans || []).filter(p => p.active).map(p => ({ value: p.id, label: p.name }))} /></Field>
      {plan && <Field label="Valor (pode dar desconto)"><MoneyInput value={price ?? plan.price_cents} onChange={setPrice} /></Field>}
      <Field label="Início"><Input type="date" value={start} onChange={e => setStart(e.target.value)} /></Field>
      <Field label="Dia de vencimento"><Input type="number" min={1} max={28} value={dueDay} onChange={e => setDueDay(e.target.value)} /></Field>
    </div>
    <p className="sa-muted small">A mensalidade do mês atual é gerada na hora.</p>
  </Modal>
}

export default function MemberDetail() {
  const { gym, base, isAdmin } = useGym()
  const { memberId } = useParams()
  const nav = useNavigate()
  const d = useLoad(() => sa.get(`/gyms/${gym.id}/members/${memberId}`), [gym.id, memberId])
  const trainers = useLoad(() => sa.get(`/gyms/${gym.id}/members?role=staff`), [gym.id])
  const [modal, setModal] = useState(null)
  const [tab, setTab] = useState('resumo')
  const personal = isPersonal(gym)
  const isStudent = d.data?.member.role === 'student'
  const progress = useLoad(() => (isStudent ? sa.get(`/gyms/${gym.id}/members/${memberId}/progress`) : Promise.resolve(null)), [gym.id, memberId, isStudent])
  if (d.loading && !d.data) return <Loading />
  if (d.error) return <LoadError error={d.error} retry={d.reload} />
  const { member: m, trainer, assignments, subscriptions, charges } = d.data
  const canEdit = isAdmin || m.role === 'student'
  const p = progress.data

  return <>
    <PageHead title={m.name} subtitle={`${ROLE_LABEL[m.role]} · cadastrado em ${dateBR(m.created_at)}`}>
      <Btn onClick={() => nav(-1)}>Voltar</Btn>
      {canEdit && <Btn kind="primary" onClick={() => setModal('edit')}>Editar</Btn>}
    </PageHead>
    {isStudent && <Tabs value={tab} onChange={setTab} tabs={[['resumo', 'Resumo'], ['avaliacao', 'Avaliação física'], ['nutricao', 'Nutrição'], ['treino', 'Treino'],
      ...(isAdmin ? [['financeiro', 'Financeiro']] : []), ...(!personal && m.status === 'active' ? [['acesso', 'Catraca']] : [])]} />}
    {(!isStudent || tab === 'resumo') && <div className="sa-grid-2">
      <Card title="Dados">
        <dl className="sa-dl">
          <dt>Situação</dt><dd>{m.status === 'active' ? <Pill tone="ok">Ativo</Pill> : <Pill tone="bad">Inativo</Pill>}</dd>
          <dt>E-mail</dt><dd>{m.email || '–'}</dd>
          <dt>Telefone</dt><dd>{m.phone ? <a href={`https://wa.me/${m.phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer">{m.phone}</a> : '–'}</dd>
          <dt>CPF</dt><dd>{m.document || '–'}</dd>
          <dt>Nascimento</dt><dd>{dateBR(m.birth_date)}</dd>
          {isStudent && <><dt>Instrutor</dt><dd>{trainer?.name || '–'}</dd><dt>Objetivo</dt><dd>{m.goal || '–'}</dd><dt>Saúde</dt><dd className="pre">{m.health_notes || '–'}</dd></>}
          <dt>Observações</dt><dd className="pre">{m.notes || '–'}</dd>
        </dl>
      </Card>
      <Card title="Acesso ao sistema">
        {m.linked
          ? <p>Conta ligada{m.accountName ? <> ao perfil <strong>{m.accountName}</strong></> : ''}.{m.accountDisabled ? ' O perfil está bloqueado na plataforma.' : ''}</p>
          : <><p>Ainda não entrou. Código de convite:</p><div className="sa-code">{m.invite_code}</div></>}
        <div className="sa-row">
          {!m.linked && canEdit && m.email && <Btn kind="primary" onClick={() => act(() => sa.post(`/gyms/${gym.id}/members/${m.id}/invite-email`, { redirectTo: location.origin + location.pathname }), null).then(r => { if (r) { notify(r.invite.sent ? `Convite enviado para ${m.email}` : 'Essa pessoa já tem conta: ela entra com o mesmo e-mail e já cai aqui.'); d.reload() } })}>Enviar convite por e-mail</Btn>}
          {!m.linked && canEdit && <Btn onClick={() => setModal('invite')}>Enviar código</Btn>}
          {canEdit && <Btn onClick={() => setModal('newcode')}>{m.linked ? 'Desvincular e gerar novo código' : 'Gerar novo código'}</Btn>}
          {isAdmin && <Btn kind={m.status === 'active' ? 'danger' : 'primary'} onClick={() => setModal('status')}>{m.status === 'active' ? 'Desativar' : 'Reativar'}</Btn>}
        </div>
      </Card>
    </div>}

    {!personal && m.status === 'active' && (!isStudent || tab === 'acesso') && <AccessCard gym={gym} m={m} />}
    {isStudent && tab === 'avaliacao' && <AssessmentsPanel gym={gym} memberId={m.id} />}
    {isStudent && tab === 'nutricao' && <NutritionPanel gym={gym} memberId={m.id} />}

    {isStudent && tab === 'treino' && <Card title="Treino" actions={<Btn kind="primary" onClick={() => nav(`${base}/treinos?assign=${m.id}`)}>Atribuir ficha</Btn>}>
      {p && p.linked && <div className="sa-stats">
        <Stat label="Treinos nos últimos 30 dias" value={p.last30} tone={p.last30 >= 8 ? 'good' : p.last30 ? '' : 'warn'} />
        <Stat label="Último treino" value={dateBR(p.lastDate)} />
        <Stat label="Treinos registrados" value={p.total} />
      </div>}
      {p && !p.linked && <p className="sa-muted">O acompanhamento aparece quando o aluno entrar com a conta dele.</p>}
      <h3>Fichas atribuídas</h3>
      <Table columns={[
        { key: 'name', label: 'Ficha' },
        { key: 'created_at', label: 'Atribuída em', render: a => dateBR(a.created_at) },
        { key: 'status', label: 'Situação', render: a => (a.status === 'active' ? <Pill tone="ok">Ativa</Pill> : <Pill>Arquivada</Pill>) },
        { key: 'imported_at', label: 'No app do aluno', render: a => (a.imported_at ? `Sim, ${dateBR(a.imported_at)}` : 'Ainda não') },
        { key: 'x', label: '', align: 'right', render: a => (a.status === 'active' ? <Btn onClick={e => { e.stopPropagation(); act(() => sa.post(`/gyms/${gym.id}/assignments/${a.id}/archive`), 'Ficha arquivada').then(d.reload) }}>Arquivar</Btn> : null) }
      ]} rows={assignments} empty="Nenhuma ficha atribuída." />
      {p?.recent?.length > 0 && <><h3>Treinos recentes</h3>
        <Table rowKey={r => r.date + r.name} columns={[
          { key: 'date', label: 'Data', render: r => dateBR(r.date) },
          { key: 'name', label: 'Treino' },
          { key: 'exercises', label: 'Exercícios', align: 'right', render: r => r.exercises ?? '–' },
          { key: 'durationMin', label: 'Duração', align: 'right', render: r => (r.durationMin ? `${r.durationMin} min` : '–') }
        ]} rows={p.recent} /></>}
    </Card>}

    {isStudent && isAdmin && tab === 'financeiro' && <Card title="Financeiro" actions={<Btn kind="primary" onClick={() => setModal('subscribe')}>Ativar plano</Btn>}>
      <h3>Planos</h3>
      <Table columns={[
        { key: 'plan_name', label: 'Plano' },
        { key: 'price_cents', label: 'Valor', render: s => <Money cents={s.price_cents} /> },
        { key: 'due_day', label: 'Vencimento', render: s => `todo dia ${s.due_day}` },
        { key: 'status', label: 'Situação', render: s => (s.status === 'active' ? <Pill tone="ok">Ativo</Pill> : <Pill>Cancelado</Pill>) },
        { key: 'x', label: '', align: 'right', render: s => (s.status === 'active' ? <Btn onClick={() => act(() => sa.post(`/gyms/${gym.id}/subscriptions/${s.id}/cancel`, { cancelOpenCharges: false }), 'Plano cancelado').then(d.reload)}>Cancelar</Btn> : null) }
      ]} rows={subscriptions} empty="Sem plano ativo." />
      <h3>Cobranças</h3>
      <Table columns={[
        { key: 'description', label: 'Descrição' },
        { key: 'due_date', label: 'Vencimento', render: c => dateBR(c.due_date) },
        { key: 'amount_cents', label: 'Valor', align: 'right', render: c => <Money cents={c.amount_cents} /> },
        { key: 'status', label: 'Situação', render: c => <Pill tone={c.status === 'paid' ? 'ok' : c.status === 'open' ? (c.due_date < today() ? 'bad' : 'warn') : ''}>{c.status === 'open' && c.due_date < today() ? 'Atrasada' : CHARGE_STATUS[c.status]}</Pill> },
        { key: 'x', label: '', align: 'right', render: c => (c.status === 'open' ? <Btn kind="primary" onClick={() => setModal({ pay: c })}>Receber</Btn> : c.paid_at ? `${dateBR(c.paid_at)} · ${PAYMENT_LABEL[c.payment_method] || ''}` : null) }
      ]} rows={charges} empty="Nenhuma cobrança." />
    </Card>}

    {modal === 'edit' && <EditMember gym={gym} m={m} trainers={trainers.data?.members || []} canRole={isAdmin && m.role !== 'student'} onDone={d.reload} onClose={() => setModal(null)} />}
    {modal === 'invite' && <InviteNotice member={m} onClose={() => setModal(null)} />}
    {modal === 'newcode' && <Confirm title="Novo código" danger={m.linked} confirm="Gerar código"
      text={m.linked ? 'A conta ligada perde o acesso a esta academia até usar o novo código.' : 'O código anterior deixa de funcionar.'}
      onYes={() => act(() => sa.post(`/gyms/${gym.id}/members/${m.id}/invite`, { unlink: true }), 'Novo código gerado').then(d.reload)} onClose={() => setModal(null)} />}
    {modal === 'status' && <Confirm title={m.status === 'active' ? 'Desativar' : 'Reativar'} danger={m.status === 'active'}
      text={m.status === 'active' ? `${m.name} perde o acesso à academia${isStudent ? ' e os planos ativos são cancelados' : ''}. O histórico fica guardado.` : `${m.name} volta a ter acesso.`}
      onYes={() => act(() => sa.post(`/gyms/${gym.id}/members/${m.id}/status`, { status: m.status === 'active' ? 'inactive' : 'active' }), 'Situação atualizada').then(d.reload)} onClose={() => setModal(null)} />}
    {modal === 'subscribe' && <Subscribe gym={gym} m={m} onDone={d.reload} onClose={() => setModal(null)} />}
    {modal?.pay && <PayCharge gym={gym} charge={modal.pay} onDone={d.reload} onClose={() => setModal(null)} />}
  </>
}
