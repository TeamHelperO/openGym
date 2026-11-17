// The platform's back office: every academy and every user on the instance.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { sa, adminApi } from '../api.js'
import { useLoad, PageHead, Card, Table, Btn, Pill, Stat, Tabs, Input, Loading, LoadError, Modal, Confirm, act } from '../ui.jsx'
import { dateBR, dateTimeBR, ROLE_LABEL } from '../lib/format.js'
import { SourceFooter } from '../SaasApp.jsx'

function Gyms() {
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const g = useLoad(() => sa.get(`/platform/gyms?q=${encodeURIComponent(q)}`), [q])
  const [toggle, setToggle] = useState(null)
  return <Card title="Academias">
    <Input placeholder="Buscar por nome, identificador ou CNPJ" value={q} onChange={e => setQ(e.target.value)} />
    {g.loading && !g.data ? <Loading /> : <LoadError error={g.error} retry={g.reload} />}
    <Table columns={[
      { key: 'name', label: 'Academia', render: r => <div className="sa-row">{r.logoUrl && <img className="sa-mini-logo" src={r.logoUrl} alt="" />}<div><strong>{r.name}</strong><div className="sa-muted small">{r.document || r.slug}</div></div></div> },
      { key: 'admins', label: 'Administradores', render: r => r.admins || '–' },
      { key: 'students', label: 'Alunos', align: 'right' },
      { key: 'staff', label: 'Equipe', align: 'right' },
      { key: 'created_at', label: 'Desde', render: r => dateBR(r.created_at) },
      { key: 'status', label: 'Situação', render: r => (r.status === 'active' ? <Pill tone="ok">Ativa</Pill> : <Pill tone="bad">Suspensa</Pill>) },
      { key: 'x', label: '', align: 'right', render: r => <span className="sa-row end" onClick={e => e.stopPropagation()}>
        <Btn onClick={() => nav(`/gestao/a/${r.id}`)}>Entrar</Btn>
        <Btn kind={r.status === 'active' ? 'danger' : 'primary'} onClick={() => setToggle(r)}>{r.status === 'active' ? 'Suspender' : 'Reativar'}</Btn>
      </span> }
    ]} rows={g.data?.gyms} empty="Nenhuma academia cadastrada." />
    {toggle && <Confirm title={toggle.status === 'active' ? 'Suspender academia' : 'Reativar academia'} danger={toggle.status === 'active'} onClose={() => setToggle(null)}
      text={toggle.status === 'active' ? `Ninguém da ${toggle.name} consegue usar a gestão até a reativação. Os dados ficam guardados.` : `${toggle.name} volta a funcionar.`}
      onYes={() => act(() => sa.post(`/platform/gyms/${toggle.id}/status`, { status: toggle.status === 'active' ? 'suspended' : 'active' }), 'Situação atualizada').then(g.reload)} />}
  </Card>
}

function Users() {
  const [q, setQ] = useState('')
  const u = useLoad(() => sa.get(`/platform/users?q=${encodeURIComponent(q)}`), [q])
  const [code, setCode] = useState(null)
  const [confirm, setConfirm] = useState(null)
  return <Card title="Usuários">
    <Input placeholder="Buscar por nome ou e-mail" value={q} onChange={e => setQ(e.target.value)} />
    {u.loading && !u.data ? <Loading /> : <LoadError error={u.error} retry={u.reload} />}
    <Table columns={[
      { key: 'name', label: 'Usuário', render: r => <><strong>{r.name}</strong>{r.email && <div className="sa-muted small">{r.email}</div>}</> },
      { key: 'gyms', label: 'Academias', render: r => (r.gyms.length ? r.gyms.map(g => `${g.gymName} (${ROLE_LABEL[g.role]}${g.status === 'inactive' ? ', inativo' : ''})`).join('; ') : '–') },
      { key: 'created', label: 'Criado', render: r => dateBR(r.created) },
      { key: 'flags', label: 'Situação', render: r => <span className="sa-row">{r.platformAdmin && <Pill tone="ok">Admin da plataforma</Pill>}{r.disabled ? <Pill tone="bad">Bloqueado</Pill> : <Pill>Ativo</Pill>}</span> },
      { key: 'x', label: '', align: 'right', render: r => <span className="sa-row end">
        {!r.platformAdmin && <Btn kind={r.disabled ? 'primary' : 'danger'} onClick={() => setConfirm({ kind: 'disable', r })}>{r.disabled ? 'Desbloquear' : 'Bloquear'}</Btn>}
        <Btn onClick={() => setConfirm({ kind: 'role', r })}>{r.platformAdmin ? 'Tirar admin' : 'Tornar admin'}</Btn>
        {!r.disabled && <Btn onClick={async () => { const x = await act(() => adminApi.recovery(r.id)); if (x) setCode(x) }}>Código de recuperação</Btn>}
      </span> }
    ]} rows={u.data?.users} empty="Nenhum usuário." />
    {confirm?.kind === 'disable' && <Confirm title={confirm.r.disabled ? 'Desbloquear usuário' : 'Bloquear usuário'} danger={!confirm.r.disabled} onClose={() => setConfirm(null)}
      text={confirm.r.disabled ? `${confirm.r.name} volta a entrar.` : `${confirm.r.name} não consegue mais entrar em nada da plataforma.`}
      onYes={() => act(() => adminApi.disable(confirm.r.id, !confirm.r.disabled), 'Usuário atualizado').then(u.reload)} />}
    {confirm?.kind === 'role' && <Confirm title="Administrador da plataforma" onClose={() => setConfirm(null)}
      text={confirm.r.platformAdmin ? `${confirm.r.name} deixa de administrar a plataforma.` : `${confirm.r.name} passa a ver e administrar todas as academias e usuários. Só o dono da instância pode fazer isso.`}
      onYes={() => act(() => adminApi.role(confirm.r.id, !confirm.r.platformAdmin), 'Papel atualizado').then(u.reload)} />}
    {code && <Modal title="Código de recuperação" onClose={() => setCode(null)}>
      <p>Entregue a <strong>{code.name}</strong>. Na tela de entrada, a pessoa escolhe recuperar o acesso e digita o código. Vale até {dateTimeBR(code.expires)}.</p>
      <div className="sa-code">{code.code}</div>
    </Modal>}
  </Card>
}

function Audit() {
  const a = useLoad(() => sa.get('/platform/audit'), [])
  return <Card title="Registro de atividades">
    <Table columns={[
      { key: 'at', label: 'Quando', render: r => dateTimeBR(r.at) },
      { key: 'gym_name', label: 'Academia', render: r => r.gym_name || '–' },
      { key: 'user_name', label: 'Quem', render: r => r.user_name || '–' },
      { key: 'action', label: 'Ação' }
    ]} rows={a.data?.entries} empty="Nada registrado ainda." />
  </Card>
}

export default function Platform({ me }) {
  const nav = useNavigate()
  const [tab, setTab] = useState('gyms')
  const o = useLoad(() => sa.get('/platform/overview'), [])
  return <div className="sa-solo">
    <PageHead title="Administração da plataforma" subtitle={me.config.platformName}>
      <Btn onClick={() => nav('/gestao')}>Academias</Btn>
      <Btn onClick={() => nav('/admin')}>Painel técnico</Btn>
    </PageHead>
    {o.data && <div className="sa-stats">
      <Stat label="Academias ativas" value={o.data.activeGyms} hint={`${o.data.suspendedGyms} suspensas · ${o.data.newGymsThisMonth} novas no mês`} />
      <Stat label="Alunos ativos" value={o.data.students} />
      <Stat label="Profissionais" value={o.data.staff} />
      <Stat label="Usuários" value={o.data.users} hint={`${o.data.disabledUsers} bloqueados`} />
    </div>}
    <Tabs value={tab} onChange={setTab} tabs={[['gyms', 'Academias'], ['users', 'Usuários'], ['audit', 'Atividades']]} />
    {tab === 'gyms' && <Gyms />}
    {tab === 'users' && <Users />}
    {tab === 'audit' && <Audit />}
    <SourceFooter config={me.config} />
  </div>
}
