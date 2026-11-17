// What a student sees of their academy: their trainer, the sheets assigned to them (one tap adds a
// sheet to the training app's plan, through the same import a shared plan file uses), their fees.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { sa } from '../api.js'
import { useGym } from '../SaasApp.jsx'
import { useLoad, PageHead, Card, Btn, Pill, Table, Money, Loading, LoadError, act, notify } from '../ui.jsx'
import { dateBR, CHARGE_STATUS, today } from '../lib/format.js'
import { parsePlan, mergePlan } from '../../lib/plan-share.js'
import { useStore } from '../../store/useStore.js'
import { EXIDX } from '../../lib/exercises.js'
import { exerciseNameText } from '../../lib/format.js'

const exLine = e => {
  const name = EXIDX[e.id] ? exerciseNameText(EXIDX[e.id]) : e.id
  const scheme = e.mode === 'time' ? `${e.sets} × ${e.sec}s` : e.mode === 'cardio' ? `${e.min} min` : `${e.sets} × ${e.reps}`
  return `${name} · ${scheme}${e.weight ? ` · ${e.weight} kg` : ''}${e.restSec ? ` · descanso ${e.restSec}s` : ''}`
}

export default function StudentHome() {
  const { gym } = useGym()
  const nav = useNavigate()
  const d = useLoad(() => sa.get(`/gyms/${gym.id}/my`), [gym.id])
  const [open, setOpen] = useState(null)
  if (d.loading && !d.data) return <Loading />
  if (d.error) return <LoadError error={d.error} retry={d.reload} />
  const { member, trainer, assignments, charges, subscriptions } = d.data

  const addToPlan = async (a, schedule) => {
    const S = useStore.getState().S
    let bundle
    try { bundle = parsePlan(a.plan, S.unit || 'kg') } catch (e) { return notify(e.message, 'err') }
    useStore.getState().update(s => mergePlan(s, bundle, { schedule }))
    await act(() => sa.post(`/gyms/${gym.id}/my/assignments/${a.id}/imported`), `Ficha adicionada ao seu plano (${bundle.routineCount} treinos)`)
    d.reload()
    nav('/plan')
  }

  return <>
    <PageHead title={`Olá, ${member?.name?.split(' ')[0] || ''}`} subtitle={gym.settings?.welcomeMessage || `Bem-vindo à ${gym.name}.`}>
      <Btn kind="primary" onClick={() => nav('/home')}>Ir treinar</Btn>
    </PageHead>
    <div className="sa-grid-2">
      <Card title="Seu instrutor">
        {trainer ? <><p><strong>{trainer.name}</strong></p>{trainer.phone && <a className="sa-btn" href={`https://wa.me/${trainer.phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer">Falar no WhatsApp</a>}</> : <p className="sa-muted">A academia ainda não definiu seu instrutor.</p>}
        {member?.goal && <p>Objetivo: {member.goal}</p>}
        {member?.health_notes && <p className="sa-muted pre">Saúde: {member.health_notes}</p>}
      </Card>
      <Card title="Seu plano">
        {subscriptions?.length ? subscriptions.map(s => <p key={s.id}><strong>{s.plan_name}</strong> · <Money cents={s.price_cents} /> · vence todo dia {s.due_day}</p>) : <p className="sa-muted">Nenhum plano ativo.</p>}
      </Card>
    </div>
    <Card title="Suas fichas de treino">
      {!assignments.length && <p className="sa-muted">Seu instrutor ainda não passou uma ficha.</p>}
      {assignments.map(a => <div key={a.id} className="sa-assign">
        <div className="sa-row wrap between">
          <div><strong>{a.name}</strong><div className="sa-muted small">Por {a.trainer_name || 'sua academia'} em {dateBR(a.created_at)}{a.end_date ? ` · trocar em ${dateBR(a.end_date)}` : ''}</div></div>
          <div className="sa-row wrap">
            {a.imported_at ? <Pill tone="ok">No seu plano</Pill> : <Pill tone="warn">Nova</Pill>}
            <Btn onClick={() => setOpen(open === a.id ? null : a.id)}>{open === a.id ? 'Fechar' : 'Ver ficha'}</Btn>
            <Btn kind="primary" onClick={() => addToPlan(a, Object.keys(a.plan.week || {}).length > 0)}>{a.imported_at ? 'Adicionar de novo' : 'Adicionar ao meu plano'}</Btn>
          </div>
        </div>
        {a.notes && <p className="pre">{a.notes}</p>}
        {open === a.id && a.plan.routines.map(r => <div key={r.id} className="sa-routine">
          <h3>{r.name}</h3>
          <ol>{r.ex.map((e, i) => <li key={i}>{exLine(e)}{e.note && <div className="sa-muted small">{e.note}</div>}</li>)}</ol>
        </div>)}
      </div>)}
      <p className="sa-muted small">Ao adicionar, os treinos entram como rotinas novas no app (nada do que você já tem é apagado). Se a ficha tiver dias da semana, sua agenda passa a seguir a ficha.</p>
    </Card>
    <Card title="Mensalidades">
      <Table columns={[
        { key: 'description', label: 'Descrição' },
        { key: 'due_date', label: 'Vencimento', render: c => dateBR(c.due_date) },
        { key: 'amount_cents', label: 'Valor', align: 'right', render: c => <Money cents={c.amount_cents} /> },
        { key: 'status', label: 'Situação', render: c => <Pill tone={c.status === 'paid' ? 'ok' : c.due_date < today() ? 'bad' : 'warn'}>{c.status === 'open' && c.due_date < today() ? 'Atrasada' : CHARGE_STATUS[c.status]}</Pill> }
      ]} rows={charges} empty="Nenhuma cobrança." />
    </Card>
  </>
}
