// The form for a student or a staff member, used to create and to edit.
import { useState } from 'react'
import { Field, Input, Area, Select } from '../ui.jsx'
import { ROLE_LABEL } from '../lib/format.js'

export const blankMember = role => ({ role, name: '', email: '', phone: '', document: '', birthDate: '', goal: '', healthNotes: '', notes: '', trainerMemberId: '' })
export const memberToForm = m => ({
  role: m.role, name: m.name || '', email: m.email || '', phone: m.phone || '', document: m.document || '', birthDate: m.birth_date || '',
  goal: m.goal || '', healthNotes: m.health_notes || '', notes: m.notes || '', trainerMemberId: m.trainer_member_id || ''
})

export function useMemberForm(initial) {
  const [f, setF] = useState(initial)
  const set = k => e => setF(x => ({ ...x, [k]: e?.target ? e.target.value : e }))
  return [f, set, setF]
}

export default function MemberForm({ f, set, trainers = [], canRole, plans }) {
  const student = f.role === 'student'
  return <div className="sa-form cols">
    {canRole && <Field label="Papel"><Select value={f.role} onChange={set('role')} options={Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label }))} /></Field>}
    <Field label="Nome completo"><Input value={f.name} onChange={set('name')} autoFocus /></Field>
    <Field label="E-mail"><Input type="email" value={f.email} onChange={set('email')} /></Field>
    <Field label="Telefone / WhatsApp"><Input value={f.phone} onChange={set('phone')} /></Field>
    <Field label="CPF"><Input value={f.document} onChange={set('document')} /></Field>
    <Field label="Data de nascimento"><Input type="date" value={f.birthDate} onChange={set('birthDate')} /></Field>
    {student && <>
      {trainers.length > 0 && <Field label="Instrutor responsável"><Select value={f.trainerMemberId} onChange={set('trainerMemberId')} placeholder="Sem instrutor" options={trainers.map(t => ({ value: t.id, label: t.name }))} /></Field>}
      <Field label="Objetivo" wide><Input value={f.goal} onChange={set('goal')} placeholder="Ex.: hipertrofia, emagrecimento, condicionamento" /></Field>
      <Field label="Saúde e restrições" wide hint="Lesões, medicamentos, liberação médica. Visível para a equipe e para o próprio aluno."><Area value={f.healthNotes} onChange={set('healthNotes')} /></Field>
    </>}
    <Field label="Observações internas" wide hint="Só a equipe vê."><Area value={f.notes} onChange={set('notes')} /></Field>
    {plans && student && <>
      <Field label="Plano (opcional)"><Select value={f.planId || ''} onChange={set('planId')} placeholder="Sem plano por enquanto" options={plans.filter(p => p.active).map(p => ({ value: p.id, label: `${p.name} - R$ ${(p.price_cents / 100).toFixed(2).replace('.', ',')}` }))} /></Field>
      {f.planId && <Field label="Dia de vencimento"><Input type="number" min={1} max={28} value={f.dueDay || ''} onChange={set('dueDay')} placeholder="1 a 28" /></Field>}
    </>}
  </div>
}
