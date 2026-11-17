// Workout sheets of the academy, and assigning them to students.
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { sa } from '../api.js'
import { useGym } from '../SaasApp.jsx'
import { useLoad, PageHead, Card, Table, Btn, Modal, Field, Input, Area, Loading, LoadError, Tabs, Pill, act } from '../ui.jsx'
import { dateBR } from '../lib/format.js'

export function AssignModal({ gym, sheet, preselect = [], onClose, onDone }) {
  const students = useLoad(() => sa.get(`/gyms/${gym.id}/members?role=student`), [gym.id])
  const [picked, setPicked] = useState(new Set(preselect))
  const [q, setQ] = useState('')
  const [notes, setNotes] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const list = (students.data?.members || []).filter(m => !q || m.name.toLowerCase().includes(q.toLowerCase()))
  const toggle = id => setPicked(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const save = async () => {
    const r = await act(() => sa.post(`/gyms/${gym.id}/workouts/${sheet.id}/assign`, { memberIds: [...picked], notes, startDate: start || null, endDate: end || null }), 'Ficha atribuída')
    if (r) { onDone?.(); onClose() }
  }
  return <Modal wide title={`Atribuir "${sheet.name}"`} onClose={onClose} footer={<><Btn onClick={onClose}>Cancelar</Btn><Btn kind="primary" disabled={!picked.size} onClick={save}>Atribuir a {picked.size} aluno(s)</Btn></>}>
    <p className="sa-muted">A ficha ativa anterior de cada aluno é arquivada. O aluno recebe a ficha na área "Minha academia" e adiciona ao plano dele com um toque.</p>
    <div className="sa-form cols">
      <Field label="Início (opcional)"><Input type="date" value={start} onChange={e => setStart(e.target.value)} /></Field>
      <Field label="Trocar em (opcional)"><Input type="date" value={end} onChange={e => setEnd(e.target.value)} /></Field>
      <Field label="Orientações para o aluno" wide><Area value={notes} onChange={e => setNotes(e.target.value)} placeholder="Ex.: 3 vezes por semana, aquecer 10 minutos antes" /></Field>
    </div>
    <Input placeholder="Buscar aluno" value={q} onChange={e => setQ(e.target.value)} />
    {students.loading ? <p>Carregando…</p> : <div className="sa-pick-list">
      {list.map(m => <label key={m.id} className="sa-check"><input type="checkbox" checked={picked.has(m.id)} onChange={() => toggle(m.id)} /> {m.name} {m.active_workouts ? <Pill tone="ok">tem ficha</Pill> : <Pill tone="warn">sem ficha</Pill>}</label>)}
      {!list.length && <p className="sa-muted">Nenhum aluno ativo.</p>}
    </div>}
  </Modal>
}

export default function Workouts() {
  const { gym, base } = useGym()
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const assignFor = params.get('assign')
  const [tab, setTab] = useState('sheets')
  const [assign, setAssign] = useState(null)
  const sheets = useLoad(() => sa.get(`/gyms/${gym.id}/workouts`), [gym.id])
  const assigned = useLoad(() => (tab === 'assigned' ? sa.get(`/gyms/${gym.id}/assignments`) : Promise.resolve(null)), [gym.id, tab])
  const [pickFor, setPickFor] = useState('')
  const pickList = useMemo(() => (sheets.data?.workouts || []).filter(w => !pickFor || w.name.toLowerCase().includes(pickFor.toLowerCase())), [sheets.data, pickFor])

  return <>
    <PageHead title="Fichas de treino" subtitle="Monte a ficha uma vez e atribua para quantos alunos quiser. Os exercícios vêm da biblioteca do app.">
      <Btn kind="primary" onClick={() => nav(`${base}/treinos/nova`)}>Nova ficha</Btn>
    </PageHead>
    {assignFor && <Card title="Escolha a ficha para atribuir" actions={<Btn onClick={() => setParams({})}>Cancelar</Btn>}>
      <Input placeholder="Buscar ficha" value={pickFor} onChange={e => setPickFor(e.target.value)} />
      <div className="sa-pick-list">{pickList.map(w => <button type="button" key={w.id} className="sa-btn" onClick={() => setAssign(w)}>{w.name}</button>)}</div>
    </Card>}
    <Tabs value={tab} onChange={setTab} tabs={[['sheets', 'Fichas'], ['assigned', 'Atribuições ativas']]} />
    <Card>
      {tab === 'sheets' && <>
        {sheets.loading && !sheets.data ? <Loading /> : <LoadError error={sheets.error} retry={sheets.reload} />}
        {sheets.data && <Table columns={[
          { key: 'name', label: 'Ficha', render: w => <><strong>{w.name}</strong>{w.description && <div className="sa-muted small">{w.description}</div>}</> },
          { key: 'level', label: 'Nível', render: w => w.level || '–' },
          { key: 'routines', label: 'Treinos', render: w => w.plan.routines.map(r => r.name).join(', ') },
          { key: 'author_name', label: 'Autor', render: w => w.author_name || '–' },
          { key: 'active_assignments', label: 'Alunos', align: 'right' },
          { key: 'x', label: '', align: 'right', render: w => <Btn kind="primary" onClick={e => { e.stopPropagation(); setAssign(w) }}>Atribuir</Btn> }
        ]} rows={sheets.data.workouts} onRow={w => nav(`${base}/treinos/${w.id}`)} empty="Nenhuma ficha ainda. Crie a primeira." />}
      </>}
      {tab === 'assigned' && (assigned.loading ? <Loading /> : <Table columns={[
        { key: 'student_name', label: 'Aluno' },
        { key: 'name', label: 'Ficha' },
        { key: 'trainer_name', label: 'Por', render: a => a.trainer_name || '–' },
        { key: 'created_at', label: 'Em', render: a => dateBR(a.created_at) },
        { key: 'end_date', label: 'Trocar em', render: a => dateBR(a.end_date) },
        { key: 'imported_at', label: 'No app', render: a => (a.imported_at ? <Pill tone="ok">Sim</Pill> : <Pill tone="warn">Ainda não</Pill>) }
      ]} rows={assigned.data?.assignments} onRow={a => nav(`${base}/alunos/${a.student_member_id}`)} empty="Nenhuma ficha atribuída." />)}
    </Card>
    {assign && <AssignModal gym={gym} sheet={assign} preselect={assignFor ? [assignFor] : []} onClose={() => setAssign(null)} onDone={() => { sheets.reload(); if (assignFor) nav(`${base}/alunos/${assignFor}`) }} />}
  </>
}
