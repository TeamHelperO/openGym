// /gestao: the academies the person belongs to, sign up a new one, or join one with a code.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { sa } from '../api.js'
import { Btn, Card, Field, Input, act, PageHead } from '../ui.jsx'
import { ROLE_LABEL } from '../lib/format.js'
import { SourceFooter } from '../SaasApp.jsx'
import { PRODUCT } from '../product.js'

export default function GymPicker({ me, reload }) {
  const nav = useNavigate()
  const [name, setName] = useState('')
  const [doc, setDoc] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const only = me.memberships.length === 1 && !me.platformAdmin ? me.memberships[0] : null
  useEffect(() => { if (only) nav(`/gestao/a/${only.gym.id}`, { replace: true }) }, [only, nav])
  const canCreate = me.config.publicGymSignup || me.platformAdmin
  const personal = PRODUCT === 'personal'

  const create = async () => {
    setBusy(true)
    const g = await act(() => sa.post('/gyms', { name: name.trim() || undefined, document: doc, kind: personal ? 'personal' : 'academy' }), personal ? 'Sua consultoria está pronta' : 'Academia cadastrada')
    setBusy(false)
    if (g) { await reload(); nav(personal ? `/gestao/a/${g.id}` : `/gestao/a/${g.id}/configuracoes`) }
  }
  const join = async () => {
    setBusy(true)
    const r = await act(() => sa.post('/join', { code }), 'Pronto, você entrou na academia')
    setBusy(false)
    if (r) { await reload(); nav(`/gestao/a/${r.gym.id}`) }
  }

  return <div className="sa-solo">
    <PageHead title={me.config.platformName} subtitle={personal ? `Olá, ${me.user.name}. Comece criando a sua consultoria para cadastrar e acompanhar seus alunos.` : `Olá, ${me.user.name}. Escolha a academia ou cadastre a sua.`}>
      {me.platformAdmin && <Btn kind="primary" onClick={() => nav('/gestao/plataforma')}>Administração da plataforma</Btn>}
      <Btn onClick={() => nav('/home')}>App de treino</Btn>
    </PageHead>

    {me.memberships.length > 0 && <Card title={personal ? 'Seus espaços' : 'Suas academias'}>
      <div className="sa-gym-grid">
        {me.memberships.map(m => <button type="button" key={m.memberId} className="sa-gym-tile" onClick={() => nav(`/gestao/a/${m.gym.id}`)}>
          {m.gym.logoUrl ? <img src={m.gym.logoUrl} alt="" /> : <div className="sa-brand-mark" style={{ background: m.gym.primary_color }}>{m.gym.name.slice(0, 1)}</div>}
          <strong>{m.gym.name}</strong><small>{ROLE_LABEL[m.role]}{m.gym.status === 'suspended' ? ' · suspensa' : ''}</small>
        </button>)}
      </div>
    </Card>}

    <div className="sa-grid-2">
      <Card title="Recebi um código de convite">
        <p className="sa-muted">{personal ? 'Alunos recebem um convite por e-mail ou um código do personal. Se você recebeu um código, digite aqui.' : 'Alunos e profissionais recebem um código da academia. Digite aqui para ligar o código à sua conta.'}</p>
        <div className="sa-form">
          <Field label="Código"><Input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="ABCD-1234" maxLength={12} /></Field>
        </div>
        <Btn kind="primary" disabled={busy || code.trim().length < 8} onClick={join}>Entrar na academia</Btn>
      </Card>
      {canCreate && (personal ? <Card title="Sou personal trainer">
        <p className="sa-muted">Crie sua consultoria: cadastre alunos (eles recebem um convite por e-mail), monte treinos e dietas e registre as avaliações.</p>
        <div className="sa-form">
          <Field label="Nome da consultoria (opcional)"><Input value={name} onChange={e => setName(e.target.value)} placeholder={`Consultoria ${me.user.name}`} /></Field>
          <Field label="CPF ou CNPJ (opcional)"><Input value={doc} onChange={e => setDoc(e.target.value)} /></Field>
        </div>
        <Btn kind="primary" disabled={busy} onClick={create}>Criar minha consultoria</Btn>
      </Card> : <Card title="Cadastrar minha academia">
        <p className="sa-muted">Você vira administrador dela. Logo, cores e demais dados ficam em Configurações.</p>
        <div className="sa-form">
          <Field label="Nome da academia"><Input value={name} onChange={e => setName(e.target.value)} placeholder="Academia Exemplo" /></Field>
          <Field label="CNPJ (opcional)"><Input value={doc} onChange={e => setDoc(e.target.value)} /></Field>
        </div>
        <Btn kind="primary" disabled={busy || !name.trim()} onClick={create}>Cadastrar academia</Btn>
      </Card>)}
    </div>
    <SourceFooter config={me.config} />
  </div>
}
