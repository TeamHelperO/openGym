// Nutrition follow-up: the trainer builds the meal plan on the TACO table; the student ticks off
// what was eaten (with a note and a photo of the plate) and the trainer sees the adherence.
import { useEffect, useMemo, useState } from 'react'
import { sa } from '../api.js'
import { useLoad, Card, Btn, Modal, Field, Input, Area, Loading, LoadError, Pill, act, notify } from '../ui.jsx'
import { dateBR, today } from '../lib/format.js'
import { TACO } from '../lib/taco.js'
import { portion, regram, sum, dayTotals, macroSplit, searchFoods, newMeal, DEFAULT_MEALS } from '../lib/nutrition.js'

const n1 = v => (Math.round((Number(v) || 0) * 10) / 10).toLocaleString('pt-BR')
const parse = v => { const s = String(v ?? '').replace(',', '.').trim(); return s === '' ? null : Number(s) }

export function AuthImage({ path, alt = '', className = 'sa-thumb' }) {
  const [src, setSrc] = useState(null)
  const [big, setBig] = useState(false)
  useEffect(() => {
    let url = null, alive = true
    sa.blobUrl(path).then(u => { url = u; if (alive) setSrc(u) }).catch(() => {})
    return () => { alive = false; if (url) URL.revokeObjectURL(url) }
  }, [path])
  if (!src) return null
  return <>
    <img src={src} alt={alt} className={className} onClick={() => setBig(true)} />
    {big && <div className="sa-modal-back" onClick={() => setBig(false)}><img src={src} alt={alt} style={{ maxWidth: '94vw', maxHeight: '90vh', borderRadius: 12 }} /></div>}
  </>
}

function MacroBoxes({ totals, targets }) {
  const split = macroSplit(totals)
  const box = (label, v, unit, target, pct) => <div className="sa-macro">{label}<strong>{n1(v)} {unit}</strong>{target ? `meta ${n1(target)} ${unit}` : pct != null ? `${pct}% das calorias` : ''}</div>
  return <div className="sa-macros">
    {box('Calorias', totals.kcal, 'kcal', targets?.kcal)}
    {box('Proteína', totals.protein, 'g', targets?.protein, split.protein)}
    {box('Carboidrato', totals.carbs, 'g', targets?.carbs, split.carbs)}
    {box('Gordura', totals.fat, 'g', targets?.fat, split.fat)}
  </div>
}

function FoodPicker({ onPick, onClose }) {
  const [q, setQ] = useState('')
  const [grams, setGrams] = useState('100')
  const [custom, setCustom] = useState(null)
  const results = useMemo(() => searchFoods(TACO, q), [q])
  if (custom) return <Modal title="Alimento fora da tabela" onClose={onClose} footer={<><Btn onClick={() => setCustom(null)}>Voltar</Btn><Btn kind="primary" disabled={!custom.name.trim()} onClick={() => onPick({
    name: custom.name.trim(), grams: parse(custom.grams) || 0, measure: custom.measure, kcal: parse(custom.kcal) || 0, protein: parse(custom.protein) || 0, carbs: parse(custom.carbs) || 0, fat: parse(custom.fat) || 0
  })}>Adicionar</Btn></>}>
    <div className="sa-form cols">
      <Field label="Nome" wide><Input autoFocus value={custom.name} onChange={e => setCustom({ ...custom, name: e.target.value })} placeholder="Ex.: Whey protein (1 scoop)" /></Field>
      {[['grams', 'Quantidade (g)'], ['measure', 'Medida caseira'], ['kcal', 'Calorias'], ['protein', 'Proteína (g)'], ['carbs', 'Carboidrato (g)'], ['fat', 'Gordura (g)']].map(([k, l]) =>
        <Field key={k} label={l}><Input inputMode={k === 'measure' ? 'text' : 'decimal'} value={custom[k]} onChange={e => setCustom({ ...custom, [k]: e.target.value })} /></Field>)}
    </div>
  </Modal>
  return <Modal wide title="Adicionar alimento" onClose={onClose}>
    <div className="sa-filters">
      <Input autoFocus placeholder="Buscar na tabela TACO: arroz, frango grelhado, banana..." value={q} onChange={e => setQ(e.target.value)} />
      <Input style={{ maxWidth: 140 }} inputMode="decimal" value={grams} onChange={e => setGrams(e.target.value)} aria-label="Gramas" />
      <Btn onClick={() => setCustom({ name: q, grams: '', measure: '', kcal: '', protein: '', carbs: '', fat: '' })}>Não achei na tabela</Btn>
    </div>
    <p className="sa-muted small">Valores da TACO (Unicamp) por 100 g, calculados para {grams || 0} g.</p>
    <div className="sa-food-results">
      {results.map(f => <button type="button" key={f.id} className="sa-food" onClick={() => onPick(portion(f, parse(grams) || 0))}>
        <span>{f.name}<br /><small>{f.category}</small></span>
        <small>{n1((f.kcal || 0) * (parse(grams) || 0) / 100)} kcal · P {n1((f.protein || 0) * (parse(grams) || 0) / 100)} · C {n1((f.carbs || 0) * (parse(grams) || 0) / 100)} · G {n1((f.fat || 0) * (parse(grams) || 0) / 100)}</small>
      </button>)}
      {q && !results.length && <p className="sa-muted">Nada encontrado. Use "Não achei na tabela".</p>}
    </div>
  </Modal>
}

export function MealPlanEditor({ gym, memberId, plan, onDone, onClose }) {
  const [name, setName] = useState(plan?.name || 'Plano alimentar')
  const [notes, setNotes] = useState(plan?.notes || '')
  const [targets, setTargets] = useState(() => Object.fromEntries(['kcal', 'protein', 'carbs', 'fat', 'water_ml'].map(k => [k, plan?.targets?.[k] != null ? String(plan.targets[k]) : ''])))
  const [meals, setMeals] = useState(plan?.meals?.length ? plan.meals : DEFAULT_MEALS())
  const [picking, setPicking] = useState(null)
  const setMeal = (i, patch) => setMeals(ms => ms.map((m, j) => (j === i ? { ...m, ...patch } : m)))
  const totals = dayTotals(meals)
  const save = async () => {
    const body = { name, notes, targets: Object.fromEntries(Object.entries(targets).map(([k, v]) => [k, parse(v)])), meals: meals.filter(m => m.name.trim()) }
    const r = await act(() => (plan?.id && plan.status === 'active' ? sa.put(`/gyms/${gym.id}/meal-plans/${plan.id}`, body) : sa.post(`/gyms/${gym.id}/members/${memberId}/meal-plans`, body)), 'Plano alimentar salvo')
    if (r) { onDone(); onClose() }
  }
  return <Modal wide title={plan?.id ? 'Editar plano alimentar' : 'Novo plano alimentar'} onClose={onClose} footer={<><Btn onClick={onClose}>Cancelar</Btn><Btn kind="primary" onClick={save}>Salvar e enviar ao aluno</Btn></>}>
    <div className="sa-form cols">
      <Field label="Nome do plano" wide><Input value={name} onChange={e => setName(e.target.value)} /></Field>
      {[['kcal', 'Meta de calorias'], ['protein', 'Meta de proteína (g)'], ['carbs', 'Meta de carboidrato (g)'], ['fat', 'Meta de gordura (g)'], ['water_ml', 'Água por dia (ml)']].map(([k, l]) =>
        <Field key={k} label={l}><Input inputMode="decimal" value={targets[k]} onChange={e => setTargets({ ...targets, [k]: e.target.value })} /></Field>)}
    </div>
    <h3>Total do dia</h3>
    <MacroBoxes totals={totals} targets={{ kcal: parse(targets.kcal), protein: parse(targets.protein), carbs: parse(targets.carbs), fat: parse(targets.fat) }} />
    {meals.map((m, i) => {
      const t = sum(m.items)
      return <div key={m.key} className="sa-meal">
        <div className="sa-meal-head">
          <input className="sa-input" value={m.name} onChange={e => setMeal(i, { name: e.target.value })} aria-label="Nome da refeição" />
          <input className="sa-input" type="time" value={m.time} onChange={e => setMeal(i, { time: e.target.value })} aria-label="Horário" />
          <Btn onClick={() => setPicking(i)}>+ Alimento</Btn>
          <Btn kind="danger" onClick={() => setMeals(meals.filter((_, j) => j !== i))}>Remover refeição</Btn>
        </div>
        {m.items.map((it, j) => <div key={j} className="sa-meal-item">
          <span>{it.name}{it.measure ? <small className="sa-muted"> ({it.measure})</small> : null}</span>
          <input className="sa-input" inputMode="decimal" value={it.grams} aria-label={`Gramas de ${it.name}`} onChange={e => setMeal(i, { items: m.items.map((x, k) => (k === j ? regram(x, parse(e.target.value) || 0) : x)) })} />
          <span className="hide-sm">{n1(it.kcal)} kcal</span>
          <span className="hide-sm">P {n1(it.protein)}</span>
          <span className="hide-sm">C {n1(it.carbs)}</span>
          <span className="hide-sm">G {n1(it.fat)}</span>
          <button type="button" className="sa-x" aria-label="Remover" onClick={() => setMeal(i, { items: m.items.filter((_, k) => k !== j) })}>×</button>
        </div>)}
        {!m.items.length && <p className="sa-muted small">Sem alimentos ainda.</p>}
        <div className="sa-meal-total"><strong>{n1(t.kcal)} kcal</strong><span>P {n1(t.protein)} g</span><span>C {n1(t.carbs)} g</span><span>G {n1(t.fat)} g</span></div>
        <input className="sa-input" style={{ marginTop: 8 }} placeholder="Observação da refeição (substituições, temperos...)" value={m.notes || ''} onChange={e => setMeal(i, { notes: e.target.value })} />
      </div>
    })}
    <Btn onClick={() => setMeals([...meals, newMeal('Nova refeição')])}>+ Refeição</Btn>
    <div className="sa-form"><Field label="Orientações gerais"><Area value={notes} onChange={e => setNotes(e.target.value)} placeholder="Hidratação, suplementos, o que evitar..." /></Field></div>
    {picking != null && <FoodPicker onClose={() => setPicking(null)} onPick={item => { setMeal(picking, { items: [...meals[picking].items, item] }); setPicking(null) }} />}
  </Modal>
}

function Adherence({ adherence }) {
  if (!adherence) return null
  return <>
    <p>Adesão nos últimos 7 dias: <strong>{adherence.pct}%</strong></p>
    <div className="sa-diet-days">{adherence.days.map(d => <span key={d.date} className={d.planned && d.done === d.planned ? 'full' : ''}>{d.date.slice(8)}/{d.date.slice(5, 7)}: {d.done}/{d.planned}</span>)}</div>
  </>
}

/** The trainer's side, on the student's page. */
export default function NutritionPanel({ gym, memberId }) {
  const d = useLoad(() => sa.get(`/gyms/${gym.id}/members/${memberId}/food-logs`), [gym.id, memberId])
  const [edit, setEdit] = useState(null)
  const plan = d.data?.plan
  const mealName = k => plan?.meals.find(m => m.key === k)?.name || k
  return <Card title="Nutrição" actions={<>
    {plan && <Btn onClick={() => setEdit(plan)}>Editar plano</Btn>}
    <Btn kind="primary" onClick={() => setEdit({ copyFrom: plan })}>{plan ? 'Novo plano' : 'Montar plano alimentar'}</Btn>
  </>}>
    {d.loading && !d.data ? <Loading /> : <LoadError error={d.error} retry={d.reload} />}
    {d.data && !plan && <p className="sa-muted">Nenhum plano alimentar ativo. Monte um com os alimentos da tabela TACO; o aluno recebe no celular e marca o que comeu.</p>}
    {plan && <>
      <p><strong>{plan.name}</strong> · atualizado em {dateBR(String(plan.updated_at).slice(0, 10))}</p>
      <MacroBoxes totals={dayTotals(plan.meals)} targets={plan.targets} />
      <Adherence adherence={d.data.adherence} />
      <h3>Diário do aluno</h3>
      {!d.data.logs.length && <p className="sa-muted">O aluno ainda não marcou nenhuma refeição.</p>}
      {d.data.logs.slice(0, 30).map(l => <div key={l.id} className="sa-diet-meal">
        {l.has_photo && <AuthImage path={`/gyms/${gym.id}/food-logs/${l.id}/photo`} alt={`Foto: ${mealName(l.meal_key)}`} />}
        <div><strong>{dateBR(l.date)} · {mealName(l.meal_key)}</strong> {l.done ? <Pill tone="ok">feita</Pill> : <Pill tone="warn">não feita</Pill>}{l.note && <div className="sa-muted small">{l.note}</div>}</div>
      </div>)}
    </>}
    {edit && <MealPlanEditor gym={gym} memberId={memberId} plan={edit.copyFrom ? { ...edit.copyFrom, id: undefined, status: undefined, name: 'Plano alimentar' } : edit.id ? edit : null} onDone={d.reload} onClose={() => setEdit(null)} />}
  </Card>
}

// A photo from the phone, scaled to at most 1000 px and saved as JPEG so it stays well under the
// 600 KB the server takes.
function shrinkPhoto(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const k = Math.min(1, 1000 / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k)
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      resolve(c.toDataURL('image/jpeg', 0.78))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não foi possível ler a foto')) }
    img.src = url
  })
}

/** The student's side: today's meals to tick off. */
export function StudentDiet({ gym }) {
  const d = useLoad(() => sa.get(`/gyms/${gym.id}/my/meal-plan`), [gym.id])
  const [busy, setBusy] = useState(null)
  const [open, setOpen] = useState(null)
  const day = today()
  const plan = d.data?.plan
  if (d.loading && !d.data) return <Card title="Minha dieta"><Loading /></Card>
  if (!plan) return <Card title="Minha dieta"><p className="sa-muted">Seu personal ainda não enviou um plano alimentar.</p></Card>
  const logOf = k => d.data.logs.find(l => l.date === day && l.meal_key === k)
  const mark = async (m, patch) => {
    setBusy(m.key)
    const cur = logOf(m.key)
    const r = await act(() => sa.put(`/gyms/${gym.id}/my/meal-plan/${plan.id}/log`, { date: day, mealKey: m.key, done: cur ? !!cur.done : true, note: cur?.note || '', ...patch }))
    setBusy(null)
    if (r) d.reload()
  }
  const photo = async (m, e) => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    try { await mark(m, { done: true, photoDataUrl: await shrinkPhoto(file) }); notify('Foto enviada') } catch (err) { notify(err.message, 'err') }
  }
  const doneCount = plan.meals.filter(m => logOf(m.key)?.done).length
  return <Card title="Minha dieta de hoje" actions={<Pill tone={doneCount === plan.meals.length ? 'ok' : 'warn'}>{doneCount} de {plan.meals.length} refeições</Pill>}>
    <MacroBoxes totals={dayTotals(plan.meals)} targets={plan.targets} />
    {plan.targets?.water_ml ? <p className="sa-muted">Água: {n1(plan.targets.water_ml / 1000)} litros por dia.</p> : null}
    {plan.meals.map(m => {
      const l = logOf(m.key)
      return <div key={m.key} className="sa-diet-meal">
        <button type="button" className={'tick' + (l?.done ? ' on' : '')} disabled={busy === m.key} aria-label={l?.done ? 'Desmarcar' : 'Marcar como feita'} onClick={() => mark(m, { done: !l?.done })}>{l?.done ? '✓' : ''}</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong>{m.time ? `${m.time} · ` : ''}{m.name}</strong>
          <ul>{m.items.map((it, i) => <li key={i}>{it.name}{it.grams ? ` · ${n1(it.grams)} g` : ''}{it.measure ? ` (${it.measure})` : ''}</li>)}</ul>
          {m.notes && <div className="sa-muted small">{m.notes}</div>}
          <div className="sa-row wrap" style={{ marginTop: 6 }}>
            <label className="sa-btn">Foto do prato<input type="file" accept="image/*" capture="environment" hidden onChange={e => photo(m, e)} /></label>
            <Btn onClick={() => setOpen(m)}>Comentário</Btn>
            {l?.has_photo && <AuthImage path={`/gyms/${gym.id}/food-logs/${l.id}/photo`} alt="Foto do prato" />}
          </div>
          {l?.note && <div className="sa-muted small">Você: {l.note}</div>}
        </div>
      </div>
    })}
    {plan.notes && <><h3>Orientações</h3><p className="pre">{plan.notes}</p></>}
    <Adherence adherence={d.data.adherence} />
    {open && <NoteModal meal={open} initial={logOf(open.key)?.note || ''} onClose={() => setOpen(null)} onSave={note => mark(open, { note }).then(() => setOpen(null))} />}
  </Card>
}

function NoteModal({ meal, initial, onSave, onClose }) {
  const [v, setV] = useState(initial)
  return <Modal title={`Comentário: ${meal.name}`} onClose={onClose} footer={<><Btn onClick={onClose}>Cancelar</Btn><Btn kind="primary" onClick={() => onSave(v)}>Salvar</Btn></>}>
    <Area autoFocus value={v} onChange={e => setV(e.target.value)} placeholder="Ex.: troquei o arroz por batata doce" />
  </Modal>
}
