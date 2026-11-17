// Write or edit a workout sheet: routines (Treino A, B, ...), their exercises and the weekdays.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { sa } from '../api.js'
import { useGym } from '../SaasApp.jsx'
import { useLoad, PageHead, Card, Btn, Field, Input, Area, Select, Modal, Loading, LoadError, Tabs, act, Confirm } from '../ui.jsx'
import { CATALOGUE, EXIDX, searchExercises } from '../../lib/exercises.js'
import { exerciseNameText } from '../../lib/format.js'
import * as S from '../lib/sheet.js'
import { AssignModal } from './Workouts.jsx'

const exName = id => (EXIDX[id] ? exerciseNameText(EXIDX[id]) : `Exercício ${id}`)
const BP_LABEL = { chest: 'Peito', back: 'Costas', shoulders: 'Ombros', 'upper arms': 'Braços', 'lower arms': 'Antebraços', 'upper legs': 'Coxas', 'lower legs': 'Panturrilhas', waist: 'Abdômen', cardio: 'Cardio', neck: 'Pescoço', 'full body': 'Corpo inteiro' }

function ExercisePicker({ onPick, onClose }) {
  const [q, setQ] = useState('')
  const [bp, setBp] = useState('')
  const results = useMemo(() => {
    const base = bp ? CATALOGUE.filter(e => e.bp === bp) : CATALOGUE
    return (q.trim() ? searchExercises(base, q) : base).slice(0, 60)
  }, [q, bp])
  return <Modal wide title="Adicionar exercício" onClose={onClose}>
    <div className="sa-filters">
      <Input autoFocus placeholder="Buscar: supino, agachamento, remada…" value={q} onChange={e => setQ(e.target.value)} />
      <Select value={bp} onChange={setBp} placeholder="Todos os grupos" options={Object.entries(BP_LABEL).map(([value, label]) => ({ value, label }))} />
    </div>
    <div className="sa-ex-results">
      {results.map(e => <button type="button" key={e.id} className="sa-ex-item" onClick={() => onPick(e.id)}>
        <strong>{exerciseNameText(e)}</strong><small>{[BP_LABEL[e.bp] || e.bp, e.eq].filter(Boolean).join(' · ')}</small>
      </button>)}
      {!results.length && <p className="sa-muted">Nada encontrado.</p>}
    </div>
  </Modal>
}

function ExerciseRow({ e, i, last, onChange, onMove, onRemove }) {
  const mode = e.mode || 'reps'
  const n = (k, v) => onChange({ [k]: v === '' ? undefined : Number(v) })
  return <div className="sa-ex-row">
    <div className="sa-ex-name"><span className="sa-ex-n">{i + 1}</span><strong>{exName(e.id)}</strong></div>
    <div className="sa-ex-fields">
      <label>Séries<input className="sa-input" type="number" min={1} max={20} value={e.sets ?? ''} onChange={x => n('sets', x.target.value)} /></label>
      <label>Tipo<select className="sa-input" value={mode} onChange={x => onChange({ mode: x.target.value === 'reps' ? undefined : x.target.value, ...(x.target.value === 'time' ? { sec: e.sec || 30 } : {}), ...(x.target.value === 'cardio' ? { min: e.min || 20 } : {}) })}>
        <option value="reps">Repetições</option><option value="time">Tempo (s)</option><option value="cardio">Cardio (min)</option>
      </select></label>
      {mode === 'reps' && <label>Reps<input className="sa-input" type="number" min={1} max={100} value={e.reps ?? ''} onChange={x => n('reps', x.target.value)} /></label>}
      {mode === 'time' && <label>Segundos<input className="sa-input" type="number" min={1} max={3600} value={e.sec ?? ''} onChange={x => n('sec', x.target.value)} /></label>}
      {mode === 'cardio' && <label>Minutos<input className="sa-input" type="number" min={1} max={300} value={e.min ?? ''} onChange={x => n('min', x.target.value)} /></label>}
      {mode !== 'cardio' && <label>Carga (kg)<input className="sa-input" type="number" min={0} step="0.5" value={e.weight ?? ''} onChange={x => n('weight', x.target.value)} /></label>}
      <label>Descanso (s)<input className="sa-input" type="number" min={0} max={900} step={15} value={e.restSec ?? ''} onChange={x => n('restSec', x.target.value)} /></label>
      <label className="grow">Observação<input className="sa-input" value={e.note || ''} maxLength={300} onChange={x => onChange({ note: x.target.value })} placeholder="Ex.: cadência 3-1-1" /></label>
    </div>
    <div className="sa-ex-actions">
      <button type="button" className="sa-btn" disabled={i === 0} aria-label="Subir" onClick={() => onMove(-1)}>↑</button>
      <button type="button" className="sa-btn" disabled={last} aria-label="Descer" onClick={() => onMove(1)}>↓</button>
      <button type="button" className="sa-btn danger" aria-label="Remover" onClick={onRemove}>×</button>
    </div>
  </div>
}

export default function WorkoutEditor() {
  const { gym, base } = useGym()
  const { workoutId } = useParams()
  const isNew = workoutId === 'nova'
  const nav = useNavigate()
  const d = useLoad(() => (isNew ? Promise.resolve(null) : sa.get(`/gyms/${gym.id}/workouts/${workoutId}`)), [gym.id, workoutId])
  const [meta, setMeta] = useState({ name: '', description: '', level: '' })
  const [plan, setPlan] = useState(S.newSheet())
  const [rid, setRid] = useState('r1')
  const [picking, setPicking] = useState(false)
  const [assign, setAssign] = useState(null)
  const [archive, setArchive] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!d.data) return
    const w = d.data.workout
    setMeta({ name: w.name, description: w.description, level: w.level })
    setPlan({ routines: w.plan.routines, week: w.plan.week || {} })
    setRid(w.plan.routines[0]?.id)
  }, [d.data])
  if (d.loading && !d.data && !isNew) return <Loading />
  if (d.error) return <LoadError error={d.error} retry={d.reload} />
  const routine = plan.routines.find(r => r.id === rid) || plan.routines[0]
  const problems = S.sheetProblems(plan)

  const save = async () => {
    if (!meta.name.trim()) return act(() => Promise.reject(new Error('Dê um nome para a ficha')))
    if (problems.length) return act(() => Promise.reject(new Error(problems[0])))
    setBusy(true)
    const body = { ...meta, plan }
    const r = await act(() => (isNew ? sa.post(`/gyms/${gym.id}/workouts`, body) : sa.put(`/gyms/${gym.id}/workouts/${workoutId}`, body)), 'Ficha salva')
    setBusy(false)
    if (r && isNew) nav(`${base}/treinos/${r.workout.id}`, { replace: true })
    return r
  }

  return <>
    <PageHead title={isNew ? 'Nova ficha' : meta.name || 'Ficha'}>
      <Btn onClick={() => nav(`${base}/treinos`)}>Voltar</Btn>
      {!isNew && <Btn onClick={() => setArchive(true)}>Arquivar</Btn>}
      {!isNew && <Btn onClick={() => setAssign(d.data.workout)}>Atribuir</Btn>}
      <Btn kind="primary" disabled={busy} onClick={save}>Salvar</Btn>
    </PageHead>
    <Card>
      <div className="sa-form cols">
        <Field label="Nome da ficha"><Input value={meta.name} onChange={e => setMeta({ ...meta, name: e.target.value })} placeholder="Ex.: Hipertrofia ABC" /></Field>
        <Field label="Nível"><Select value={meta.level} onChange={v => setMeta({ ...meta, level: v })} placeholder="Não informado" options={['Iniciante', 'Intermediário', 'Avançado'].map(v => ({ value: v, label: v }))} /></Field>
        <Field label="Descrição" wide><Area value={meta.description} onChange={e => setMeta({ ...meta, description: e.target.value })} /></Field>
      </div>
    </Card>
    <Card title="Treinos" actions={<Btn onClick={() => { const p = S.addRoutine(plan); setPlan(p); setRid(p.routines.at(-1).id) }}>+ Treino</Btn>}>
      <Tabs value={routine?.id} onChange={setRid} tabs={plan.routines.map(r => [r.id, r.name])} />
      {routine && <>
        <div className="sa-row wrap">
          <Field label="Nome do treino"><Input value={routine.name} maxLength={60} onChange={e => setPlan(S.renameRoutine(plan, routine.id, e.target.value))} /></Field>
          <div className="sa-field"><span>Dias da semana</span><div className="sa-days">
            {S.WEEKDAYS.map(([day, label]) => <button type="button" key={day} className={(plan.week[day] || []).includes(routine.id) ? 'on' : ''} onClick={() => setPlan(S.toggleDay(plan, routine.id, day))}>{label}</button>)}
          </div></div>
          {plan.routines.length > 1 && <Btn kind="danger" onClick={() => { const p = S.removeRoutine(plan, routine.id); setPlan(p); setRid(p.routines[0].id) }}>Remover treino</Btn>}
        </div>
        {routine.ex.map((e, i) => <ExerciseRow key={i + e.id} e={e} i={i} last={i === routine.ex.length - 1}
          onChange={patch => setPlan(S.updateExercise(plan, routine.id, i, patch))}
          onMove={dir => setPlan(S.moveExercise(plan, routine.id, i, dir))}
          onRemove={() => setPlan(S.removeExercise(plan, routine.id, i))} />)}
        <Btn kind="primary" onClick={() => setPicking(true)}>+ Adicionar exercício</Btn>
      </>}
    </Card>
    {picking && <ExercisePicker onClose={() => setPicking(false)} onPick={id => { setPlan(S.addExercise(plan, routine.id, id)); setPicking(false) }} />}
    {assign && <AssignModal gym={gym} sheet={assign} onClose={() => setAssign(null)} />}
    {archive && <Confirm title="Arquivar ficha" text="A ficha sai da lista. Quem já recebeu continua com a cópia." confirm="Arquivar" danger
      onYes={async () => { const r = await act(() => sa.del(`/gyms/${gym.id}/workouts/${workoutId}`), 'Ficha arquivada'); if (r) nav(`${base}/treinos`) }} onClose={() => setArchive(false)} />}
  </>
}
