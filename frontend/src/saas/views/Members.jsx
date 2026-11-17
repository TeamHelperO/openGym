// Students (kind="student") or the team (kind="staff") of the academy.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { sa } from '../api.js'
import { useGym } from '../SaasApp.jsx'
import { useLoad, PageHead, Card, Table, Btn, Pill, Input, Select, Modal, Loading, LoadError, act } from '../ui.jsx'
import { ROLE_LABEL } from '../lib/format.js'
import MemberForm, { blankMember, useMemberForm } from './MemberForm.jsx'
import { isPersonal } from '../product.js'
import { notify } from '../ui.jsx'

export function InviteNotice({ member, onClose }) {
  const text = `Seu código de acesso à academia: ${member.invite_code}. Crie sua conta no app e toque em Gestão > "Recebi um código de convite".`
  return <Modal title="Código de convite" onClose={onClose} footer={<>
    <a className="sa-btn" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">Enviar por WhatsApp</a>
    <button type="button" className="sa-btn primary" onClick={() => { Promise.resolve().then(() => navigator.clipboard?.writeText(member.invite_code)).catch(() => {}); onClose() }}>Copiar código</button>
  </>}>
    <p>Entregue este código para <strong>{member.name}</strong>. Com ele, a pessoa cria a conta e entra na academia.</p>
    <div className="sa-code">{member.invite_code}</div>
  </Modal>
}

export default function Members({ kind }) {
  const { gym, base, role, isAdmin } = useGym()
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('active')
  const [mine, setMine] = useState(false)
  const [adding, setAdding] = useState(false)
  const [invite, setInvite] = useState(null)
  const list = useLoad(() => sa.get(`/gyms/${gym.id}/members?role=${kind === 'staff' ? 'staff' : 'student'}&status=${status}${mine ? '&mine=1' : ''}&q=${encodeURIComponent(q)}`), [gym.id, kind, status, mine, q])
  const trainers = useLoad(() => sa.get(`/gyms/${gym.id}/members?role=staff`), [gym.id])
  const plans = useLoad(() => (isAdmin ? sa.get(`/gyms/${gym.id}/plans`) : Promise.resolve({ plans: [] })), [gym.id, isAdmin])
  const [f, set, setF] = useMemberForm(blankMember(kind === 'staff' ? 'trainer' : 'student'))
  const personal = isPersonal(gym)
  const [emailInvite, setEmailInvite] = useState(true)

  const save = async () => {
    const body = { ...f, trainerMemberId: f.trainerMemberId || null, dueDay: f.dueDay ? Number(f.dueDay) : undefined, planId: f.planId || undefined,
      sendInvite: emailInvite && !!f.email.trim(), redirectTo: location.origin + location.pathname }
    const r = await act(() => sa.post(`/gyms/${gym.id}/members`, body), kind === 'staff' ? 'Profissional cadastrado' : 'Aluno cadastrado')
    if (r) {
      setAdding(false); setF(blankMember(f.role)); list.reload()
      if (r.invite?.sent) notify(`Convite enviado para ${r.member.email}. A pessoa define a senha pelo e-mail e já entra.`)
      else if (r.invite?.existing) notify('Essa pessoa já tem conta: ela entra com o mesmo e-mail e já aparece ligada.')
      else { if (r.invite?.error) notify(r.invite.error, 'err'); setInvite(r.member) }
    }
  }
  const staff = kind === 'staff'
  const columns = [
    { key: 'name', label: 'Nome', render: m => <><strong>{m.name}</strong>{m.joined_via === 'link' && <> <Pill tone="ok">pelo link</Pill></>}{m.email && <div className="sa-muted small">{m.email}</div>}</> },
    { key: 'access_id', label: 'Nº acesso', align: 'right' },
    ...(staff ? [{ key: 'role', label: 'Papel', render: m => ROLE_LABEL[m.role] }] : [
      { key: 'trainer_name', label: 'Instrutor', render: m => m.trainer_name || '–' },
      { key: 'goal', label: 'Objetivo', render: m => m.goal || '–' },
      { key: 'active_workouts', label: 'Ficha', render: m => (m.active_workouts ? <Pill tone="ok">Com ficha</Pill> : <Pill tone="warn">Sem ficha</Pill>) }
    ]),
    { key: 'phone', label: 'Telefone', render: m => m.phone || '–' },
    { key: 'linked', label: 'Acesso', render: m => (m.linked ? <Pill tone="ok">Conta ligada</Pill> : <Pill>Convite pendente{m.invite_code ? ` · ${m.invite_code}` : ''}</Pill>) },
    ...(!staff && isAdmin ? [{ key: 'overdue_count', label: 'Financeiro', render: m => (m.overdue_count ? <Pill tone="bad">{m.overdue_count} em atraso</Pill> : <Pill tone="ok">Em dia</Pill>) }] : [])
  ]
  return <>
    <PageHead title={staff ? 'Equipe' : 'Alunos'} subtitle={staff ? 'Instrutores e administradores da academia.' : 'Cadastro, instrutor, ficha e situação de cada aluno.'}>
      <Btn kind="primary" onClick={() => setAdding(true)}>{staff ? 'Novo profissional' : 'Novo aluno'}</Btn>
    </PageHead>
    <Card>
      <div className="sa-filters">
        <Input placeholder="Buscar por nome, e-mail ou telefone" value={q} onChange={e => setQ(e.target.value)} />
        <Select value={status} onChange={setStatus} options={[{ value: 'active', label: 'Ativos' }, { value: 'inactive', label: 'Inativos' }, { value: 'all', label: 'Todos' }]} />
        {!staff && role === 'trainer' && <label className="sa-check"><input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)} /> Só meus alunos</label>}
      </div>
      {list.loading && !list.data ? <Loading /> : <LoadError error={list.error} retry={list.reload} />}
      {list.data && <Table columns={columns} rows={list.data.members} onRow={m => nav(`${base}/${staff ? 'equipe' : 'alunos'}/${m.id}`)} empty={staff ? 'Nenhum profissional ainda.' : 'Nenhum aluno encontrado.'} />}
    </Card>
    {adding && <Modal wide title={staff ? 'Novo profissional' : 'Novo aluno'} onClose={() => setAdding(false)} footer={<>
      <Btn onClick={() => setAdding(false)}>Cancelar</Btn>
      <Btn kind="primary" disabled={!f.name.trim()} onClick={save}>Salvar</Btn>
    </>}>
      <MemberForm f={f} set={set} canRole={staff && isAdmin && !personal} trainers={personal ? [] : trainers.data?.members || []} plans={isAdmin ? plans.data?.plans : null} />
      <label className="sa-check"><input type="checkbox" checked={emailInvite} onChange={e => setEmailInvite(e.target.checked)} /> Enviar convite por e-mail (a pessoa define a senha e já entra ligada {personal ? 'a você' : 'à academia'})</label>
      {emailInvite && !f.email.trim() && <p className="sa-muted small">Preencha o e-mail para enviar o convite. Sem e-mail, você recebe um código para entregar.</p>}
    </Modal>}
    {invite && <InviteNotice member={invite} onClose={() => setInvite(null)} />}
  </>
}
