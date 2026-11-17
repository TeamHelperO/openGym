// Turnstiles and the entrance: who came in today, the devices, releasing the arm, and how to
// connect a Control iD device or any other brand.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { sa } from '../api.js'
import { useGym } from '../SaasApp.jsx'
import { useLoad, PageHead, Card, Table, Btn, Pill, Modal, Field, Input, Select, Stat, Tabs, Loading, LoadError, act, notify } from '../ui.jsx'
import { dateTimeBR, today } from '../lib/format.js'

const ACTION_LABEL = {
  catra_clockwise: 'Catraca: giro horário', catra_anticlockwise: 'Catraca: giro anti-horário', catra_both: 'Catraca: os dois sentidos',
  door: 'Porta / fechadura (relé 1)', sec_box: 'Módulo de acionamento externo (SecBox)'
}
const METHOD_LABEL = { fingerprint: 'Digital', card: 'Cartão', pin: 'Senha', manual: 'Recepção', cpf: 'CPF' }
const time = iso => dateTimeBR(iso).slice(-5)

function Entries({ gym }) {
  const nav = useNavigate()
  const [day, setDay] = useState(today())
  const logs = useLoad(() => sa.get(`/gyms/${gym.id}/access/logs?date=${day}`), [gym.id, day])
  // The reception screen stays open all day: it refreshes itself.
  useEffect(() => { if (day !== today()) return; const id = setInterval(logs.reload, 5000); return () => clearInterval(id) }, [day, logs.reload])
  const x = logs.data
  return <>
    {x && <div className="sa-stats">
      <Stat label="Pessoas que entraram hoje" value={x.today.present} tone="good" />
      <Stat label="Acessos negados hoje" value={x.today.denied} tone={x.today.denied ? 'bad' : ''} />
    </div>}
    <Card title="Entradas" actions={<Input type="date" value={day} onChange={e => setDay(e.target.value)} />}>
      {logs.loading && !x ? <Loading /> : <LoadError error={logs.error} retry={logs.reload} />}
      <Table columns={[
        { key: 'at', label: 'Hora', render: r => time(r.at) },
        { key: 'member_name', label: 'Pessoa', render: r => r.member_name || (r.identifier ? `Nº ${r.identifier}` : '–') },
        { key: 'method', label: 'Como', render: r => METHOD_LABEL[r.method] || r.method },
        { key: 'device_name', label: 'Onde', render: r => r.device_name || 'Recepção' },
        { key: 'allowed', label: 'Resultado', render: r => (r.allowed ? <Pill tone="ok">Liberado</Pill> : <Pill tone="bad">Negado</Pill>) },
        { key: 'reason', label: 'Motivo' }
      ]} rows={x?.logs} onRow={r => (r.member_id ? nav(`/gestao/a/${gym.id}/alunos/${r.member_id}`) : null)} empty="Nenhuma entrada registrada neste dia." />
    </Card>
  </>
}

function Reception({ gym, devices }) {
  const people = useLoad(() => sa.get(`/gyms/${gym.id}/members?status=all`), [gym.id])
  const [q, setQ] = useState('')
  const [last, setLast] = useState(null)
  const list = (people.data?.members || []).filter(m => q.length >= 2 && (m.name.toLowerCase().includes(q.toLowerCase()) || String(m.access_id) === q || (m.document || '').replace(/\D/g, '') === q.replace(/\D/g, '')))
  const checkin = async m => {
    const r = await act(() => sa.post(`/gyms/${gym.id}/access/checkin`, { memberId: m.id }))
    if (r) setLast({ ...r, member: m })
  }
  const release = async (d, m) => act(() => sa.post(`/gyms/${gym.id}/access/devices/${d.id}/release`, { memberId: m?.id, reason: m ? `Liberado pela recepção (${m.name})` : 'Liberação manual' }), 'Comando enviado para a catraca')
  const cid = devices.filter(d => d.kind === 'controlid' && d.active)
  return <Card title="Recepção">
    <p className="sa-muted">Busque pelo nome, número de acesso ou CPF para conferir a situação e registrar a entrada. Se a pessoa estiver liberada e houver catraca Control iD, dá para girar a catraca daqui.</p>
    <Input autoFocus placeholder="Nome, nº de acesso ou CPF" value={q} onChange={e => setQ(e.target.value)} />
    <div className="sa-pick-list">
      {list.slice(0, 20).map(m => <div key={m.id} className="sa-row wrap between sa-assign">
        <div><strong>{m.name}</strong> <span className="sa-muted small">nº {m.access_id}</span> {m.status !== 'active' && <Pill tone="bad">Inativo</Pill>}</div>
        <div className="sa-row"><Btn kind="primary" onClick={() => checkin(m)}>Conferir e registrar entrada</Btn></div>
      </div>)}
    </div>
    {last && <div className={last.allow ? 'sa-ok sa-verdict ok' : 'sa-error sa-verdict'}>
      <strong>{last.member.name}: {last.allow ? 'liberado' : 'negado'}</strong> · {last.reason}
      {last.allow && cid.length > 0 && <div className="sa-row wrap" style={{ marginTop: 8 }}>{cid.map(d => <Btn key={d.id} onClick={() => release(d, last.member)}>Girar {d.name}</Btn>)}</div>}
    </div>}
  </Card>
}

function Setup({ device, token, onClose }) {
  const host = location.host
  return <Modal wide title={`Como conectar: ${device.name}`} onClose={onClose}>
    {device.kind === 'controlid' ? <>
      <p>Equipamentos Control iD (iDBlock, iDAccess, iDFlex, iDFace e similares). No menu do equipamento, ou pela página web dele na rede da academia:</p>
      <ol className="sa-steps">
        <li><strong>Modo de operação:</strong> Online, modo <strong>Pro</strong> (a digital é reconhecida no próprio equipamento e o sistema decide a liberação).</li>
        <li><strong>Servidor online:</strong> endereço <code>{host}</code>. Se o equipamento não aceitar HTTPS, aponte para a porta HTTP do servidor (a mesma usada pelo site, normalmente 80 ou 8080).</li>
        <li><strong>Modo Push:</strong> ligado, com o mesmo servidor <code>{location.protocol}//{host}</code>, período de 5 segundos. É por ele que o sistema cadastra os alunos no equipamento, pede o cadastro da digital e gira a catraca pela recepção.</li>
        <li><strong>Número de série</strong> cadastrado aqui: <code>{device.serial}</code>. Precisa ser igual ao do equipamento (aparece em Informações do sistema).</li>
        <li>Depois clique em <strong>Enviar alunos para o equipamento</strong> e cadastre as digitais pela ficha de cada aluno (botão <strong>Cadastrar digital</strong>).</li>
      </ol>
      <p className="sa-muted small">O número que o equipamento usa para cada pessoa é o "nº de acesso" mostrado no cadastro dela. Se a internet cair, o equipamento segue as regras de contingência configuradas nele.</p>
    </> : <>
      <p>Para outras marcas (Henry, Topdata, Intelbras, Hikvision e outras), o software do fabricante ou um pequeno programa na academia pergunta ao sistema se a pessoa pode entrar:</p>
      <pre className="sa-pre">{`POST ${location.protocol}//${host}/api/saas/access/check
Authorization: Bearer ${token || '<token do equipamento>'}
Content-Type: application/json

{ "identifier": "1002", "method": "access_id" }   // ou "card" / "cpf"

Resposta: { "allow": true, "message": "Bem-vindo, Ana!", "name": "Ana Souza", "accessId": 1002 }`}</pre>
      {token ? <p><strong>Guarde este token agora:</strong> ele não aparece de novo. <code className="sa-code small-code">{token}</code></p> : <p className="sa-muted">O token só aparece quando é gerado. Gere outro se precisar.</p>}
    </>}
  </Modal>
}

function DeviceForm({ gym, device, onDone, onClose }) {
  const [f, setF] = useState(device?.id ? { name: device.name, serial: device.serial || '', releaseAction: device.release_action, allowedIp: device.allowed_ip || '', active: !!device.active } : { kind: 'controlid', name: '', serial: '', releaseAction: 'catra_clockwise', allowedIp: '' })
  const save = async () => {
    const r = await act(() => (device?.id ? sa.put(`/gyms/${gym.id}/access/devices/${device.id}`, f) : sa.post(`/gyms/${gym.id}/access/devices`, f)), 'Equipamento salvo')
    if (r) { onDone(r); onClose() }
  }
  const kind = device?.kind || f.kind
  return <Modal title={device?.id ? 'Editar equipamento' : 'Novo equipamento'} onClose={onClose} footer={<><Btn onClick={onClose}>Cancelar</Btn><Btn kind="primary" disabled={!f.name.trim() || (kind === 'controlid' && !f.serial.trim())} onClick={save}>Salvar</Btn></>}>
    <div className="sa-form">
      {!device?.id && <Field label="Marca / integração"><Select value={f.kind} onChange={v => setF({ ...f, kind: v })} options={[{ value: 'controlid', label: 'Control iD (direto, com digital)' }, { value: 'generic', label: 'Outra marca (integração por token)' }]} /></Field>}
      <Field label="Nome"><Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="Ex.: Catraca da entrada" /></Field>
      {kind === 'controlid' && <>
        <Field label="Número de série do equipamento"><Input value={f.serial} onChange={e => setF({ ...f, serial: e.target.value })} /></Field>
        <Field label="O que fazer ao liberar"><Select value={f.releaseAction} onChange={v => setF({ ...f, releaseAction: v })} options={Object.entries(ACTION_LABEL).map(([value, label]) => ({ value, label }))} /></Field>
        <Field label="IP público da academia (opcional)" hint="Se preenchido, só aceita chamadas vindas deste endereço."><Input value={f.allowedIp} onChange={e => setF({ ...f, allowedIp: e.target.value })} /></Field>
      </>}
      {device?.id && <label className="sa-check"><input type="checkbox" checked={f.active} onChange={e => setF({ ...f, active: e.target.checked })} /> Ativo</label>}
    </div>
  </Modal>
}

function Devices({ gym, isAdmin, devices, reload }) {
  const [edit, setEdit] = useState(null)
  const [setup, setSetup] = useState(null)
  const [cmds, setCmds] = useState(null)
  const sync = d => act(() => sa.post(`/gyms/${gym.id}/access/devices/${d.id}/sync`), null).then(r => { if (r) { notify(`${r.people} pessoas na fila de envio`); reload() } })
  const token = async d => { const r = await act(() => sa.post(`/gyms/${gym.id}/access/devices/${d.id}/token`)); if (r) setSetup({ device: d, token: r.token }) }
  return <Card title="Equipamentos" actions={isAdmin && <Btn kind="primary" onClick={() => setEdit({})}>Novo equipamento</Btn>}>
    <Table columns={[
      { key: 'name', label: 'Equipamento', render: d => <><strong>{d.name}</strong><div className="sa-muted small">{d.kind === 'controlid' ? `Control iD · série ${d.serial}` : 'Integração por token'}</div></> },
      { key: 'online', label: 'Conexão', render: d => (!d.active ? <Pill>Desativado</Pill> : d.online ? <Pill tone="ok">Conectado</Pill> : <Pill tone="warn">{d.last_seen_at ? `Visto ${dateTimeBR(d.last_seen_at)}` : 'Nunca conectou'}</Pill>) },
      { key: 'pendingCommands', label: 'Fila', align: 'right', render: d => d.pendingCommands || '–' },
      { key: 'x', label: '', align: 'right', render: d => <span className="sa-row end wrap" onClick={e => e.stopPropagation()}>
        {d.kind === 'controlid' && <Btn onClick={() => act(() => sa.post(`/gyms/${gym.id}/access/devices/${d.id}/release`, {}), 'Comando enviado').then(reload)}>Girar agora</Btn>}
        <Btn onClick={() => setSetup({ device: d })}>Como conectar</Btn>
        {isAdmin && d.kind === 'controlid' && <Btn onClick={() => sync(d)}>Enviar alunos</Btn>}
        {isAdmin && d.kind === 'controlid' && <Btn onClick={async () => { const r = await act(() => sa.get(`/gyms/${gym.id}/access/devices/${d.id}/commands`)); if (r) setCmds({ d, list: r.commands }) }}>Comandos</Btn>}
        {isAdmin && d.kind === 'generic' && <Btn onClick={() => token(d)}>Gerar token</Btn>}
      </span> }
    ]} rows={devices} onRow={isAdmin ? setEdit : undefined} empty="Nenhuma catraca cadastrada. Cadastre a primeira para liberar a entrada pela digital." />
    {edit && <DeviceForm gym={gym} device={edit.id ? edit : null} onClose={() => setEdit(null)} onDone={r => { reload(); if (r.device && !edit.id) setSetup({ device: r.device, token: r.token }) }} />}
    {setup && <Setup device={setup.device} token={setup.token} onClose={() => setSetup(null)} />}
    {cmds && <Modal wide title={`Comandos: ${cmds.d.name}`} onClose={() => setCmds(null)} footer={<Btn onClick={() => act(() => sa.post(`/gyms/${gym.id}/access/devices/${cmds.d.id}/commands/clear`), 'Fila limpa').then(() => { setCmds(null); reload() })}>Cancelar pendentes</Btn>}>
      <Table columns={[
        { key: 'created_at', label: 'Criado', render: c => dateTimeBR(c.created_at) },
        { key: 'purpose', label: 'O quê', render: c => ({ sync_users: 'Enviar pessoa(s)', enroll_biometry: 'Cadastrar digital', enroll_card: 'Cadastrar cartão', enroll_face: 'Cadastrar rosto', release: 'Girar catraca' }[c.purpose] || c.purpose) + (c.member_name ? ` · ${c.member_name}` : '') },
        { key: 'status', label: 'Situação', render: c => <Pill tone={c.status === 'done' ? 'ok' : c.status === 'failed' ? 'bad' : c.status === 'canceled' ? '' : 'warn'}>{({ queued: 'Na fila', sent: 'Enviado', done: 'Feito', failed: 'Falhou', canceled: 'Cancelado' })[c.status]}</Pill> }
      ]} rows={cmds.list} empty="Nenhum comando." />
    </Modal>}
  </Card>
}

export default function Access() {
  const { gym, isAdmin } = useGym()
  const [tab, setTab] = useState('entries')
  const dev = useLoad(() => sa.get(`/gyms/${gym.id}/access/devices`), [gym.id])
  const devices = dev.data?.devices || []
  return <>
    <PageHead title="Catracas e acesso" subtitle="A pessoa coloca o dedo no leitor, o sistema confere cadastro e mensalidade e libera a catraca." />
    <Tabs value={tab} onChange={setTab} tabs={[['entries', 'Entradas de hoje'], ['reception', 'Recepção'], ['devices', 'Equipamentos']]} />
    {dev.error && <LoadError error={dev.error} retry={dev.reload} />}
    {tab === 'entries' && <Entries gym={gym} />}
    {tab === 'reception' && <Reception gym={gym} devices={devices} />}
    {tab === 'devices' && <Devices gym={gym} isAdmin={isAdmin} devices={devices} reload={dev.reload} />}
  </>
}
