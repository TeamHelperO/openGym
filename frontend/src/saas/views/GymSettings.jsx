// The academy's profile: name, logo, colour, contact, and the defaults of its finance and shop.
import { useState } from 'react'
import { sa } from '../api.js'
import { useGym } from '../SaasApp.jsx'
import { PageHead, Card, Btn, Field, Input, Area, act } from '../ui.jsx'

// A logo is scaled down in the browser before upload: at most 512 px on its longest side.
function shrink(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return reject(new Error('Use uma imagem PNG, JPG ou WebP'))
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const k = Math.min(1, 512 / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k))
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      resolve(c.toDataURL('image/png'))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não foi possível ler a imagem')) }
    img.src = url
  })
}

export default function GymSettings() {
  const { gym, reloadGym } = useGym()
  const [f, setF] = useState({
    name: gym.name, legalName: gym.legal_name, document: gym.document, email: gym.email, phone: gym.phone, address: gym.address,
    primaryColor: gym.primary_color, defaultDueDay: gym.settings?.defaultDueDay || 10, allowCredit: gym.settings?.allowCredit !== false,
    welcomeMessage: gym.settings?.welcomeMessage || ''
  })
  const set = k => e => setF(x => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const save = async () => {
    const { defaultDueDay, allowCredit, welcomeMessage, ...rest } = f
    const r = await act(() => sa.put(`/gyms/${gym.id}`, { ...rest, settings: { defaultDueDay: Number(defaultDueDay), allowCredit, welcomeMessage } }), 'Configurações salvas')
    if (r) reloadGym()
  }
  const upload = async e => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const r = await act(async () => sa.put(`/gyms/${gym.id}/logo`, { dataUrl: await shrink(file) }), 'Logo atualizada')
    if (r) reloadGym()
  }
  return <>
    <PageHead title="Configurações da academia"><Btn kind="primary" onClick={save}>Salvar</Btn></PageHead>
    <div className="sa-grid-2">
      <Card title="Identidade">
        <div className="sa-logo-edit">
          {gym.logoUrl ? <img src={gym.logoUrl} alt="Logo da academia" /> : <div className="sa-brand-mark big" style={{ background: f.primaryColor }}>{gym.name.slice(0, 1)}</div>}
          <div className="sa-row wrap">
            <label className="sa-btn primary">Enviar logo<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={upload} /></label>
            {gym.logoUrl && <Btn onClick={() => act(() => sa.del(`/gyms/${gym.id}/logo`), 'Logo removida').then(reloadGym)}>Remover</Btn>}
          </div>
        </div>
        <div className="sa-form">
          <Field label="Nome da academia"><Input value={f.name} onChange={set('name')} /></Field>
          <Field label="Cor principal"><div className="sa-row"><input type="color" value={f.primaryColor} onChange={set('primaryColor')} /><Input value={f.primaryColor} onChange={set('primaryColor')} maxLength={7} /></div></Field>
          <Field label="Mensagem de boas-vindas para os alunos"><Area value={f.welcomeMessage} onChange={set('welcomeMessage')} /></Field>
        </div>
      </Card>
      <Card title="Dados da empresa">
        <div className="sa-form">
          <Field label="Razão social"><Input value={f.legalName} onChange={set('legalName')} /></Field>
          <Field label="CNPJ"><Input value={f.document} onChange={set('document')} /></Field>
          <Field label="E-mail"><Input type="email" value={f.email} onChange={set('email')} /></Field>
          <Field label="Telefone"><Input value={f.phone} onChange={set('phone')} /></Field>
          <Field label="Endereço"><Area value={f.address} onChange={set('address')} /></Field>
        </div>
      </Card>
      <Card title="Financeiro e loja">
        <div className="sa-form">
          <Field label="Dia de vencimento padrão" hint="Usado quando o plano é ativado sem um dia escolhido."><Input type="number" min={1} max={28} value={f.defaultDueDay} onChange={set('defaultDueDay')} /></Field>
          <label className="sa-check"><input type="checkbox" checked={f.allowCredit} onChange={set('allowCredit')} /> Permitir venda fiado no PDV (vira cobrança na conta do aluno)</label>
        </div>
      </Card>
      <Card title="Endereço de acesso">
        <p className="sa-muted">Identificador da academia: <strong>{gym.slug}</strong></p>
        <p className="sa-muted">Alunos e equipe entram com o código de convite gerado no cadastro de cada pessoa.</p>
      </Card>
    </div>
  </>
}
