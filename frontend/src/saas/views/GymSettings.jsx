// The academy's profile: name, logo, colour, contact, and the defaults of its finance and shop.
import { useState } from 'react'
import { sa } from '../api.js'
import { useGym } from '../SaasApp.jsx'
import { PageHead, Card, Btn, Field, Input, Area, act, notify } from '../ui.jsx'
import QrCanvas from '../../components/QrCanvas.jsx'
import { appBase } from '../../lib/app-base.js'

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
    welcomeMessage: gym.settings?.welcomeMessage || '', customDomain: gym.custom_domain || '',
    publicSignup: gym.settings?.publicSignup !== false,
    blockOverdue: gym.settings?.access?.blockOverdue !== false, graceDays: gym.settings?.access?.graceDays ?? 5,
    requirePlan: gym.settings?.access?.requirePlan === true
  })
  const signupUrl = `${location.origin}${appBase().replace(/\/$/, '')}/#/a/${gym.slug}`
  const set = k => e => setF(x => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const save = async () => {
    const { defaultDueDay, allowCredit, welcomeMessage, publicSignup, blockOverdue, graceDays, requirePlan, ...rest } = f
    const settings = { defaultDueDay: Number(defaultDueDay), allowCredit, welcomeMessage, publicSignup, access: { blockOverdue, graceDays: Number(graceDays), requirePlan } }
    const r = await act(() => sa.put(`/gyms/${gym.id}`, { ...rest, settings }), 'Configurações salvas')
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
          <Field group label="Cor principal"><div className="sa-row"><input type="color" value={f.primaryColor} onChange={set('primaryColor')} /><Input value={f.primaryColor} onChange={set('primaryColor')} maxLength={7} /></div></Field>
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
      <Card title="Link de cadastro dos alunos">
        <p className="sa-muted">Quem cria a conta por este link entra direto como aluno da academia e aparece em Alunos. Divulgue no Instagram, no WhatsApp ou imprima o QR code na recepção.</p>
        <div className="sa-link-box">
          <QrCanvas value={signupUrl} size={132} />
          <div className="sa-form" style={{ flex: 1, minWidth: 220 }}>
            <code className="small-code">{signupUrl}</code>
            <div className="sa-row wrap">
              <Btn onClick={() => { Promise.resolve().then(() => navigator.clipboard?.writeText(signupUrl)).then(() => notify('Link copiado')).catch(() => {}) }}>Copiar link</Btn>
              <a className="sa-btn" href={`https://wa.me/?text=${encodeURIComponent(`Faça seu cadastro na ${gym.name}: ${signupUrl}`)}`} target="_blank" rel="noreferrer">Enviar por WhatsApp</a>
            </div>
          </div>
        </div>
        <label className="sa-check"><input type="checkbox" checked={f.publicSignup} onChange={set('publicSignup')} /> Aceitar cadastro de alunos pelo link (desligado: só com código de convite)</label>
      </Card>
      <Card title="Domínio próprio (opcional)">
        <p className="sa-muted">Ex.: <code>app.suaacademia.com.br</code>. Quem abrir esse endereço vê a logo e o nome da academia e, ao criar a conta, já entra como aluno.</p>
        <Field label="Domínio"><Input value={f.customDomain} onChange={set('customDomain')} placeholder="app.suaacademia.com.br" /></Field>
        <ol className="sa-steps sa-muted small">
          <li>No provedor do domínio, crie um registro <strong>CNAME</strong> apontando <code>{f.customDomain || 'app.suaacademia.com.br'}</code> para <code>cname.vercel-dns.com</code>.</li>
          <li>Salve aqui e avise o suporte da plataforma: o domínio também precisa ser adicionado ao site na Vercel, que emite o certificado HTTPS.</li>
          <li>Nesse endereço os alunos entram com e-mail e senha, como no endereço principal.</li>
        </ol>
      </Card>
      <Card title="Regras da catraca">
        <div className="sa-form">
          <label className="sa-check"><input type="checkbox" checked={f.blockOverdue} onChange={set('blockOverdue')} /> Bloquear aluno com mensalidade atrasada</label>
          {f.blockOverdue && <Field label="Dias de tolerância depois do vencimento"><Input type="number" min={0} max={60} value={f.graceDays} onChange={set('graceDays')} /></Field>}
          <label className="sa-check"><input type="checkbox" checked={f.requirePlan} onChange={set('requirePlan')} /> Só liberar aluno com plano ativo</label>
          <p className="sa-muted small">Instrutores e administradores sempre entram. Aluno inativo nunca entra.</p>
        </div>
      </Card>
    </div>
  </>
}
