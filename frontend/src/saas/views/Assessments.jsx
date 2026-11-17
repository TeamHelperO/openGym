// Physical assessments of a student: perimeters and bioimpedance, history, comparison and charts.
// The trainer records them; the student sees the same history read-only.
import { useState } from 'react'
import { sa } from '../api.js'
import { useLoad, Card, Btn, Modal, Field, Input, Area, Table, Loading, LoadError, TrendChart, Confirm, act } from '../ui.jsx'
import { dateBR, today } from '../lib/format.js'
import { PERIMETERS, BIO, bmi, bmiLabel, waistHip, compare, series } from '../lib/assessment.js'

const n = v => (v == null || v === '' ? '' : String(v).replace('.', ','))
const parse = v => { const s = String(v ?? '').replace(',', '.').trim(); return s === '' ? null : Number(s) }

function AssessmentForm({ gym, memberId, initial, last, onDone, onClose }) {
  const [f, setF] = useState(() => {
    const a = initial || {}
    return {
      date: a.date || today(), weight: n(a.weight_kg), height: n(a.height_cm ?? last?.height_cm), notes: a.notes || '',
      per: Object.fromEntries(PERIMETERS.map(([k]) => [k, n(a.perimeters?.[k])])),
      bio: Object.fromEntries(BIO.map(([k]) => [k, n(a.bio?.[k])]))
    }
  })
  const save = async () => {
    const body = {
      date: f.date, weightKg: parse(f.weight), heightCm: parse(f.height), notes: f.notes,
      perimeters: Object.fromEntries(Object.entries(f.per).map(([k, v]) => [k, parse(v)]).filter(([, v]) => v != null)),
      bio: Object.fromEntries(Object.entries(f.bio).map(([k, v]) => [k, parse(v)]).filter(([, v]) => v != null))
    }
    const r = await act(() => (initial?.id ? sa.put(`/gyms/${gym.id}/assessments/${initial.id}`, body) : sa.post(`/gyms/${gym.id}/members/${memberId}/assessments`, body)), 'Avaliação salva')
    if (r) { onDone(); onClose() }
  }
  const b = bmi(parse(f.weight), parse(f.height))
  return <Modal wide title={initial?.id ? 'Editar avaliação' : 'Nova avaliação'} onClose={onClose} footer={<><Btn onClick={onClose}>Cancelar</Btn><Btn kind="primary" onClick={save}>Salvar avaliação</Btn></>}>
    <div className="sa-form cols">
      <Field label="Data"><Input type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></Field>
      <Field label="Peso (kg)"><Input inputMode="decimal" value={f.weight} onChange={e => setF({ ...f, weight: e.target.value })} /></Field>
      <Field label="Altura (cm)"><Input inputMode="decimal" value={f.height} onChange={e => setF({ ...f, height: e.target.value })} /></Field>
      <Field label="IMC"><Input value={b ? `${n(b)} (${bmiLabel(b)})` : '–'} readOnly /></Field>
    </div>
    <h3>Perímetros (cm)</h3>
    <div className="sa-measure-grid">
      {PERIMETERS.map(([k, l]) => <label key={k}>{l}<input className="sa-input" inputMode="decimal" value={f.per[k]} onChange={e => setF({ ...f, per: { ...f.per, [k]: e.target.value } })} /></label>)}
    </div>
    <h3>Bioimpedância</h3>
    <div className="sa-measure-grid">
      {BIO.map(([k, l, u]) => <label key={k}>{l} ({u})<input className="sa-input" inputMode="decimal" value={f.bio[k]} onChange={e => setF({ ...f, bio: { ...f.bio, [k]: e.target.value } })} /></label>)}
    </div>
    <div className="sa-form"><Field label="Observações"><Area value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></Field></div>
  </Modal>
}

export default function AssessmentsPanel({ gym, memberId, readOnly = false }) {
  const path = readOnly ? `/gyms/${gym.id}/my/assessments` : `/gyms/${gym.id}/members/${memberId}/assessments`
  const d = useLoad(() => sa.get(path), [path])
  const [edit, setEdit] = useState(null)
  const [del, setDel] = useState(null)
  const list = d.data?.assessments || []
  const last = list[0], first = list.at(-1)
  const rows = list.length > 1 ? compare(first, last) : []
  return <Card title={readOnly ? 'Minhas avaliações' : 'Avaliação física'} actions={!readOnly && <Btn kind="primary" onClick={() => setEdit({})}>Nova avaliação</Btn>}>
    {d.loading && !d.data ? <Loading /> : <LoadError error={d.error} retry={d.reload} />}
    {d.data && !list.length && <p className="sa-muted">{readOnly ? 'Seu personal ainda não registrou uma avaliação.' : 'Nenhuma avaliação ainda. Registre peso, perímetros e bioimpedância para acompanhar a evolução.'}</p>}
    {last && <div className="sa-stats">
      <div className="sa-stat"><div className="sa-stat-label">Peso ({dateBR(last.date)})</div><div className="sa-stat-value">{last.weight_kg != null ? `${n(last.weight_kg)} kg` : '–'}</div></div>
      <div className="sa-stat"><div className="sa-stat-label">IMC</div><div className="sa-stat-value">{n(bmi(last.weight_kg, last.height_cm ?? first?.height_cm)) || '–'}</div><div className="sa-stat-hint">{bmiLabel(bmi(last.weight_kg, last.height_cm ?? first?.height_cm))}</div></div>
      <div className="sa-stat"><div className="sa-stat-label">% de gordura</div><div className="sa-stat-value">{last.bio?.fat_pct != null ? `${n(last.bio.fat_pct)}%` : '–'}</div></div>
      <div className="sa-stat"><div className="sa-stat-label">Cintura / quadril</div><div className="sa-stat-value">{n(waistHip(last)) || '–'}</div></div>
    </div>}
    {list.length > 1 && <>
      <div className="sa-grid-2">
        <TrendChart label="Peso (kg)" unit="kg" points={series(list, a => a.weight_kg)} />
        <TrendChart label="Cintura (cm)" unit="cm" points={series(list, a => a.perimeters?.waist)} />
      </div>
      {series(list, a => a.bio?.fat_pct).length > 1 && <TrendChart label="% de gordura" unit="%" points={series(list, a => a.bio?.fat_pct)} />}
      <h3>Evolução: {dateBR(first.date)} até {dateBR(last.date)}</h3>
      <Table rowKey={r => r.label} columns={[
        { key: 'label', label: 'Medida' },
        { key: 'first', label: 'Primeira', align: 'right', render: r => `${n(r.first)} ${r.unit}` },
        { key: 'last', label: 'Última', align: 'right', render: r => `${n(r.last)} ${r.unit}` },
        { key: 'change', label: 'Diferença', align: 'right', render: r => <span className={'sa-change ' + (r.change < 0 ? 'down' : r.change > 0 ? 'up' : '')}>{r.change > 0 ? '+' : ''}{n(r.change)} {r.unit}</span> }
      ]} rows={rows} />
    </>}
    {list.length > 0 && <><h3>Histórico</h3>
      <Table columns={[
        { key: 'date', label: 'Data', render: a => dateBR(a.date) },
        { key: 'weight_kg', label: 'Peso', align: 'right', render: a => (a.weight_kg != null ? `${n(a.weight_kg)} kg` : '–') },
        { key: 'waist', label: 'Cintura', align: 'right', render: a => (a.perimeters?.waist != null ? `${n(a.perimeters.waist)} cm` : '–') },
        { key: 'fat', label: '% gordura', align: 'right', render: a => (a.bio?.fat_pct != null ? `${n(a.bio.fat_pct)}%` : '–') },
        { key: 'notes', label: 'Observações', render: a => a.notes || '–' },
        ...(!readOnly ? [{ key: 'x', label: '', align: 'right', render: a => <span className="sa-row end"><Btn onClick={() => setEdit(a)}>Editar</Btn><Btn kind="danger" onClick={() => setDel(a)}>Excluir</Btn></span> }] : [])
      ]} rows={list} /></>}
    {edit && <AssessmentForm gym={gym} memberId={memberId} initial={edit.id ? edit : null} last={last} onDone={d.reload} onClose={() => setEdit(null)} />}
    {del && <Confirm title="Excluir avaliação" danger confirm="Excluir" text={`A avaliação de ${dateBR(del.date)} será apagada.`} onClose={() => setDel(null)}
      onYes={() => act(() => sa.del(`/gyms/${gym.id}/assessments/${del.id}`), 'Avaliação excluída').then(d.reload)} />}
  </Card>
}
