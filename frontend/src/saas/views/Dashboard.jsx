// The academy's dashboard: people, training coverage and, for administrators, money and stock.
import { Link, useNavigate } from 'react-router-dom'
import { sa } from '../api.js'
import { useGym } from '../SaasApp.jsx'
import { useLoad, PageHead, Card, Stat, Loading, LoadError, Money, Table, Empty, Btn } from '../ui.jsx'
import { money, monthLabel, qty, dateTimeBR } from '../lib/format.js'
import { isPersonal } from '../product.js'

function Bars({ daily }) {
  if (!daily?.length) return <Empty>Sem lançamentos neste mês.</Empty>
  const max = Math.max(1, ...daily.map(d => Math.max(d.income, d.expense)))
  return <div className="sa-bars" role="img" aria-label="Entradas e saídas por dia">
    {daily.map(d => <div key={d.date} className="sa-bar" title={`${d.date.slice(8)}: entradas ${money(d.income)}, saídas ${money(d.expense)}`}>
      <div className="in" style={{ height: `${(d.income / max) * 100}%` }} />
      <div className="out" style={{ height: `${(d.expense / max) * 100}%` }} />
      <small>{d.date.slice(8)}</small>
    </div>)}
  </div>
}

// The academy's first steps, until they are all done.
function FirstSteps({ setup, base, gym }) {
  const steps = isPersonal(gym) ? [
    ['logo', 'Colocar sua logo e cores', 'configuracoes'],
    ['plans', 'Cadastrar seus planos de consultoria (mensal, trimestral...)', 'financeiro'],
    ['students', 'Cadastrar seus alunos (cada um recebe um convite por e-mail)', 'alunos'],
    ['workouts', 'Montar as primeiras fichas de treino', 'treinos']
  ] : [
    ['logo', 'Colocar a logo e as cores da academia', 'configuracoes'],
    ['plans', 'Cadastrar os planos (mensal, trimestral...)', 'financeiro'],
    ['staff', 'Cadastrar os instrutores', 'equipe'],
    ['students', 'Trazer os alunos: divulgar o link de cadastro ou cadastrar na recepção', 'configuracoes'],
    ['workouts', 'Montar as primeiras fichas de treino', 'treinos'],
    ['devices', 'Conectar a catraca para a entrada pela digital', 'acesso'],
    ['products', 'Cadastrar os produtos da lojinha (água, suplementos...)', 'pdv']
  ]
  if (steps.every(([k]) => setup[k])) return null
  return <Card title={isPersonal(gym) ? 'Primeiros passos' : `Primeiros passos na ${gym.name}`}>
    <ul className="sa-checklist">
      {steps.map(([k, label, to], i) => <li key={k} className={setup[k] ? 'done' : ''}>
        <span className="dot">{setup[k] ? '✓' : i + 1}</span><span>{label}</span>
        {!setup[k] && <Link className="sa-btn" to={`${base}/${to}`}>Fazer agora</Link>}
      </li>)}
    </ul>
  </Card>
}

export default function Dashboard() {
  const { gym, base, isAdmin } = useGym()
  const nav = useNavigate()
  const d = useLoad(() => sa.get(`/gyms/${gym.id}/dashboard`), [gym.id])
  if (d.loading && !d.data) return <Loading />
  if (d.error) return <LoadError error={d.error} retry={d.reload} />
  const x = d.data
  return <>
    <PageHead title="Painel" subtitle={`Resumo de ${monthLabel(x.month)}`}>
      <Btn kind="primary" onClick={() => nav(`${base}/alunos`)}>Novo aluno</Btn>
      {!isPersonal(gym) && <Btn onClick={() => nav(`${base}/pdv`)}>Abrir PDV</Btn>}
    </PageHead>
    <div className="sa-stats">
      <Stat label="Alunos ativos" value={x.students} />
      {!isPersonal(gym) && <Stat label="Equipe" value={x.staff} />}
      <Stat label="Fichas de treino" value={x.workouts} hint={`${x.activeAssignments} atribuídas`} />
      <Stat label="Alunos sem ficha" value={x.studentsWithoutWorkout} tone={x.studentsWithoutWorkout ? 'warn' : ''} />
      {!isPersonal(gym) && <Stat label="Entraram hoje" value={x.presentToday} hint="pela catraca ou recepção" />}
      {x.myStudents !== undefined && <Stat label="Meus alunos" value={x.myStudents} />}
    </div>
    {isAdmin && x.setup && <FirstSteps setup={x.setup} base={base} gym={x.gym} />}
    {isAdmin && x.finance && <>
      <div className="sa-stats">
        <Stat label="Entradas do mês" value={money(x.finance.incomeCents)} tone="good" />
        <Stat label="Saídas do mês" value={money(x.finance.expenseCents)} tone="bad" />
        <Stat label="Resultado" value={money(x.finance.balanceCents)} tone={x.finance.balanceCents >= 0 ? 'good' : 'bad'} />
        <Stat label="Mensalidades atrasadas" value={x.charges.overdueCount} hint={money(x.charges.overdueCents)} tone={x.charges.overdueCount ? 'bad' : ''} />
        {!isPersonal(gym) && <Stat label="Vendas hoje (PDV)" value={money(x.sales.todayCents)} hint={`${x.sales.todayCount} vendas · mês ${money(x.sales.monthCents)}`} />}
      </div>
      <div className="sa-grid-2">
        <Card title="Entradas e saídas por dia" actions={<Btn onClick={() => nav(`${base}/financeiro`)}>Financeiro</Btn>}>
          <Bars daily={x.finance.daily} />
          <div className="sa-legend"><span className="in">Entradas</span><span className="out">Saídas</span></div>
        </Card>
        {!isPersonal(gym) && <Card title="Estoque baixo" actions={<Btn onClick={() => nav(`${base}/insumos`)}>Insumos</Btn>}>
          <Table rowKey={r => r.kind + r.id} columns={[
            { key: 'name', label: 'Item' },
            { key: 'kind', label: 'Tipo', render: r => (r.kind === 'p' ? 'Produto da loja' : 'Insumo') },
            { key: 'stock', label: 'Estoque', align: 'right', render: r => `${qty(r.stock_qty)} / mín. ${qty(r.min_qty)}` }
          ]} rows={[...x.lowStock.products.map(p => ({ ...p, kind: 'p' })), ...x.lowStock.supplies.map(s => ({ ...s, kind: 's' }))]} empty="Nenhum item abaixo do mínimo." />
        </Card>}
      </div>
      {!isPersonal(gym) && <Card title="Caixa">
        {x.cash ? <p>Caixa aberto desde {dateTimeBR(x.cash.opened_at)} com troco de <Money cents={x.cash.opening_cents} />.</p> : <p className="sa-muted">Nenhum caixa aberto agora.</p>}
      </Card>}
    </>}
  </>
}
