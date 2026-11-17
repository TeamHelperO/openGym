// Supplies (cleaning material and other consumables), suppliers and purchase orders.
import { useState } from 'react'
import { sa } from '../api.js'
import { useGym } from '../SaasApp.jsx'
import { useLoad, PageHead, Card, Table, Btn, Pill, Modal, Field, Input, Select, MoneyInput, Money, Tabs, Loading, LoadError, Confirm, act } from '../ui.jsx'
import { dateBR, qty, PAYMENT_LABEL, PAYMENT_METHODS, PURCHASE_STATUS, today } from '../lib/format.js'

function ItemModal({ gym, item, onDone, onClose }) {
  const [f, setF] = useState(item?.id ? { ...item } : { name: '', unit: 'un', category: 'Limpeza', min_qty: 0, cost_cents: 0, stock_qty: 0 })
  const save = async () => {
    const body = { name: f.name, unit: f.unit, category: f.category, minQty: Number(f.min_qty) || 0, costCents: f.cost_cents || 0, ...(item?.id ? { active: f.active !== 0 } : { stockQty: Number(f.stock_qty) || 0 }) }
    const r = await act(() => (item?.id ? sa.put(`/gyms/${gym.id}/supplies/${item.id}`, body) : sa.post(`/gyms/${gym.id}/supplies`, body)), 'Insumo salvo')
    if (r) { onDone(); onClose() }
  }
  return <Modal title={item?.id ? 'Editar insumo' : 'Novo insumo'} onClose={onClose} footer={<><Btn onClick={onClose}>Cancelar</Btn><Btn kind="primary" disabled={!f.name.trim()} onClick={save}>Salvar</Btn></>}>
    <div className="sa-form cols">
      <Field label="Nome" wide><Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="Ex.: Desinfetante 5 L" /></Field>
      <Field label="Categoria"><Input value={f.category} onChange={e => setF({ ...f, category: e.target.value })} list="sa-supply-cats" /></Field>
      <Field label="Unidade"><Input value={f.unit} onChange={e => setF({ ...f, unit: e.target.value })} placeholder="un, L, kg, caixa" /></Field>
      <Field label="Estoque mínimo"><Input type="number" min={0} value={f.min_qty} onChange={e => setF({ ...f, min_qty: e.target.value })} /></Field>
      <Field label="Custo unitário"><MoneyInput value={f.cost_cents} onChange={v => setF({ ...f, cost_cents: v })} /></Field>
      {!item?.id && <Field label="Estoque atual"><Input type="number" min={0} value={f.stock_qty} onChange={e => setF({ ...f, stock_qty: e.target.value })} /></Field>}
      {item?.id && <label className="sa-check"><input type="checkbox" checked={f.active !== 0} onChange={e => setF({ ...f, active: e.target.checked ? 1 : 0 })} /> Ativo</label>}
    </div>
    <datalist id="sa-supply-cats">{['Limpeza', 'Higiene', 'Escritório', 'Manutenção', 'Descartáveis'].map(c => <option key={c} value={c} />)}</datalist>
  </Modal>
}

function StockModal({ gym, item, kind = 'supplies', onDone, onClose }) {
  const [mode, setMode] = useState('out')
  const [n, setN] = useState('')
  const [reason, setReason] = useState('')
  const save = async () => {
    const delta = (mode === 'out' ? -1 : 1) * Number(String(n).replace(',', '.'))
    const r = await act(() => sa.post(`/gyms/${gym.id}/${kind}/${item.id}/stock`, { qtyDelta: delta, reason: reason || undefined }), 'Estoque atualizado')
    if (r) { onDone(); onClose() }
  }
  return <Modal title={`Estoque: ${item.name}`} onClose={onClose} footer={<><Btn onClick={onClose}>Cancelar</Btn><Btn kind="primary" disabled={!(Number(String(n).replace(',', '.')) > 0)} onClick={save}>Lançar</Btn></>}>
    <p>Estoque atual: <strong>{qty(item.stock_qty)} {item.unit || ''}</strong></p>
    <div className="sa-form">
      <Field label="Movimento"><Select value={mode} onChange={setMode} options={[{ value: 'out', label: 'Saída (uso, perda, consumo)' }, { value: 'in', label: 'Entrada (ajuste, doação)' }]} /></Field>
      <Field label="Quantidade"><Input inputMode="decimal" value={n} onChange={e => setN(e.target.value)} /></Field>
      <Field label="Motivo"><Input value={reason} onChange={e => setReason(e.target.value)} placeholder={mode === 'out' ? 'Ex.: limpeza semanal' : 'Ex.: contagem de estoque'} /></Field>
    </div>
    <p className="sa-muted small">Compras entram pelo pedido de compra, que também lança a despesa.</p>
  </Modal>
}

function Items({ gym }) {
  const s = useLoad(() => sa.get(`/gyms/${gym.id}/supplies`), [gym.id])
  const [edit, setEdit] = useState(null)
  const [stock, setStock] = useState(null)
  return <Card title="Insumos" actions={<Btn kind="primary" onClick={() => setEdit({})}>Novo insumo</Btn>}>
    {s.loading && !s.data ? <Loading /> : <LoadError error={s.error} retry={s.reload} />}
    <Table columns={[
      { key: 'name', label: 'Item', render: r => <><strong>{r.name}</strong>{!r.active && <Pill>Inativo</Pill>}</> },
      { key: 'category', label: 'Categoria' },
      { key: 'stock_qty', label: 'Estoque', align: 'right', render: r => <>{qty(r.stock_qty)} {r.unit} {r.low ? <Pill tone="bad">baixo</Pill> : null}</> },
      { key: 'min_qty', label: 'Mínimo', align: 'right', render: r => qty(r.min_qty) },
      { key: 'cost_cents', label: 'Custo', align: 'right', render: r => <Money cents={r.cost_cents} /> },
      { key: 'x', label: '', align: 'right', render: r => <span className="sa-row end"><Btn onClick={e => { e.stopPropagation(); setStock(r) }}>Movimentar</Btn></span> }
    ]} rows={s.data?.supplies} onRow={setEdit} empty="Cadastre o material de limpeza e o que mais a academia consome." />
    {edit && <ItemModal gym={gym} item={edit} onDone={s.reload} onClose={() => setEdit(null)} />}
    {stock && <StockModal gym={gym} item={stock} onDone={s.reload} onClose={() => setStock(null)} />}
  </Card>
}

function Suppliers({ gym }) {
  const s = useLoad(() => sa.get(`/gyms/${gym.id}/suppliers`), [gym.id])
  const [edit, setEdit] = useState(null)
  const save = async () => {
    const r = await act(() => (edit.id ? sa.put(`/gyms/${gym.id}/suppliers/${edit.id}`, edit) : sa.post(`/gyms/${gym.id}/suppliers`, edit)), 'Fornecedor salvo')
    if (r) { setEdit(null); s.reload() }
  }
  return <Card title="Fornecedores" actions={<Btn kind="primary" onClick={() => setEdit({ name: '', document: '', phone: '', email: '', notes: '' })}>Novo fornecedor</Btn>}>
    <Table columns={[
      { key: 'name', label: 'Fornecedor' }, { key: 'document', label: 'CNPJ/CPF' }, { key: 'phone', label: 'Telefone' }, { key: 'email', label: 'E-mail' }
    ]} rows={s.data?.suppliers} onRow={setEdit} empty="Nenhum fornecedor." />
    {edit && <Modal title={edit.id ? 'Editar fornecedor' : 'Novo fornecedor'} onClose={() => setEdit(null)} footer={<><Btn onClick={() => setEdit(null)}>Cancelar</Btn><Btn kind="primary" disabled={!edit.name?.trim()} onClick={save}>Salvar</Btn></>}>
      <div className="sa-form">
        {[['name', 'Nome'], ['document', 'CNPJ/CPF'], ['phone', 'Telefone'], ['email', 'E-mail'], ['notes', 'Observações']].map(([k, l]) =>
          <Field key={k} label={l}><Input value={edit[k] || ''} onChange={e => setEdit({ ...edit, [k]: e.target.value })} /></Field>)}
      </div>
    </Modal>}
  </Card>
}

function OrderModal({ gym, order, onDone, onClose }) {
  const supplies = useLoad(() => sa.get(`/gyms/${gym.id}/supplies`), [gym.id])
  const products = useLoad(() => sa.get(`/gyms/${gym.id}/products?all=1`), [gym.id])
  const suppliers = useLoad(() => sa.get(`/gyms/${gym.id}/suppliers`), [gym.id])
  const [supplierId, setSupplierId] = useState(order?.supplier_id || '')
  const [notes, setNotes] = useState(order?.notes || '')
  const [items, setItems] = useState(order?.items?.map(i => ({ kind: i.kind, itemId: i.item_id, qty: i.qty, unitCostCents: i.unit_cost_cents })) || [])
  const options = [
    ...(supplies.data?.supplies || []).filter(x => x.active).map(x => ({ value: 'supply:' + x.id, label: `Insumo · ${x.name}`, cost: x.cost_cents })),
    ...(products.data?.products || []).filter(x => x.active).map(x => ({ value: 'product:' + x.id, label: `Produto da loja · ${x.name}`, cost: x.cost_cents }))
  ]
  const add = v => { if (!v) return; const [kind, itemId] = v.split(':'); const o = options.find(x => x.value === v); setItems([...items, { kind, itemId, qty: 1, unitCostCents: o?.cost || 0 }]) }
  const total = items.reduce((n, i) => n + Math.round((Number(i.qty) || 0) * (i.unitCostCents || 0)), 0)
  const save = async () => {
    const body = { supplierId: supplierId || null, notes, items: items.map(i => ({ ...i, qty: Number(String(i.qty).replace(',', '.')) })) }
    const r = await act(() => (order?.id ? sa.put(`/gyms/${gym.id}/purchases/${order.id}`, body) : sa.post(`/gyms/${gym.id}/purchases`, body)), 'Pedido salvo')
    if (r) { onDone(); onClose() }
  }
  const label = i => options.find(o => o.value === `${i.kind}:${i.itemId}`)?.label || 'Item'
  return <Modal wide title={order?.id ? 'Editar pedido' : 'Novo pedido de compra'} onClose={onClose} footer={<><span className="sa-muted">Total <Money cents={total} /></span><Btn onClick={onClose}>Cancelar</Btn><Btn kind="primary" disabled={!items.length} onClick={save}>Salvar pedido</Btn></>}>
    <div className="sa-form cols">
      <Field label="Fornecedor"><Select value={supplierId} onChange={setSupplierId} placeholder="Sem fornecedor" options={(suppliers.data?.suppliers || []).map(s => ({ value: s.id, label: s.name }))} /></Field>
      <Field label="Observações"><Input value={notes} onChange={e => setNotes(e.target.value)} /></Field>
    </div>
    <Field label="Adicionar item"><Select value="" onChange={add} placeholder="Escolha um insumo ou produto" options={options} /></Field>
    {items.map((i, idx) => <div key={idx} className="sa-order-line">
      <span>{label(i)}</span>
      <label>Qtd<input className="sa-input" inputMode="decimal" value={i.qty} onChange={e => setItems(items.map((x, j) => (j === idx ? { ...x, qty: e.target.value } : x)))} /></label>
      <label>Custo un.<MoneyInput value={i.unitCostCents} onChange={v => setItems(items.map((x, j) => (j === idx ? { ...x, unitCostCents: v || 0 } : x)))} /></label>
      <button type="button" className="sa-btn danger" aria-label="Remover" onClick={() => setItems(items.filter((_, j) => j !== idx))}>×</button>
    </div>)}
  </Modal>
}

function ReceiveModal({ gym, order, onDone, onClose }) {
  const [method, setMethod] = useState('pix')
  const [date, setDate] = useState(today())
  const save = async () => { const r = await act(() => sa.post(`/gyms/${gym.id}/purchases/${order.id}/receive`, { paymentMethod: method, date }), 'Compra recebida: estoque e financeiro atualizados'); if (r) { onDone(); onClose() } }
  return <Modal title="Receber compra" onClose={onClose} footer={<><Btn onClick={onClose}>Cancelar</Btn><Btn kind="primary" onClick={save}>Confirmar recebimento</Btn></>}>
    <p>Os itens entram no estoque e a despesa de <Money cents={order.total_cents} /> é lançada no financeiro.</p>
    <div className="sa-form">
      <Field label="Forma de pagamento"><Select value={method} onChange={setMethod} options={PAYMENT_METHODS.map(v => ({ value: v, label: PAYMENT_LABEL[v] }))} /></Field>
      <Field label="Data do pagamento"><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
    </div>
  </Modal>
}

function Purchases({ gym }) {
  const p = useLoad(() => sa.get(`/gyms/${gym.id}/purchases`), [gym.id])
  const [edit, setEdit] = useState(null)
  const [receive, setReceive] = useState(null)
  const [cancel, setCancel] = useState(null)
  const open = async r => { const d = await act(() => sa.get(`/gyms/${gym.id}/purchases/${r.id}`)); if (d) setEdit(d.purchase) }
  return <Card title="Pedidos de compra" actions={<Btn kind="primary" onClick={() => setEdit({})}>Novo pedido</Btn>}>
    <Table columns={[
      { key: 'created_at', label: 'Criado', render: r => dateBR(r.created_at) },
      { key: 'supplier_name', label: 'Fornecedor', render: r => r.supplier_name || '–' },
      { key: 'total_cents', label: 'Total', align: 'right', render: r => <Money cents={r.total_cents} /> },
      { key: 'status', label: 'Situação', render: r => <Pill tone={r.status === 'received' ? 'ok' : r.status === 'canceled' ? '' : 'warn'}>{PURCHASE_STATUS[r.status]}</Pill> },
      { key: 'x', label: '', align: 'right', render: r => <span className="sa-row end" onClick={e => e.stopPropagation()}>
        {r.status === 'draft' && <Btn onClick={() => act(() => sa.post(`/gyms/${gym.id}/purchases/${r.id}/order`), 'Pedido marcado como enviado').then(p.reload)}>Marcar enviado</Btn>}
        {['draft', 'ordered'].includes(r.status) && <Btn kind="primary" onClick={() => setReceive(r)}>Receber</Btn>}
        {r.status !== 'canceled' && <Btn onClick={() => setCancel(r)}>Cancelar</Btn>}
      </span> }
    ]} rows={p.data?.purchases} onRow={r => (['draft', 'ordered'].includes(r.status) ? open(r) : null)} empty="Nenhum pedido de compra." />
    {edit && <OrderModal gym={gym} order={edit.id ? edit : null} onDone={p.reload} onClose={() => setEdit(null)} />}
    {receive && <ReceiveModal gym={gym} order={receive} onDone={p.reload} onClose={() => setReceive(null)} />}
    {cancel && <Confirm title="Cancelar pedido" danger confirm="Cancelar pedido" onClose={() => setCancel(null)}
      text={cancel.status === 'received' ? 'Os itens saem do estoque e a despesa é estornada.' : 'O pedido é cancelado.'}
      onYes={() => act(() => sa.post(`/gyms/${gym.id}/purchases/${cancel.id}/cancel`), 'Pedido cancelado').then(p.reload)} />}
  </Card>
}

export default function Supplies() {
  const { gym } = useGym()
  const [tab, setTab] = useState('items')
  return <>
    <PageHead title="Insumos e compras" subtitle="Material de limpeza e consumo, fornecedores e pedidos. Receber um pedido atualiza o estoque e lança a despesa." />
    <Tabs value={tab} onChange={setTab} tabs={[['items', 'Insumos'], ['purchases', 'Pedidos de compra'], ['suppliers', 'Fornecedores']]} />
    {tab === 'items' && <Items gym={gym} />}
    {tab === 'purchases' && <Purchases gym={gym} />}
    {tab === 'suppliers' && <Suppliers gym={gym} />}
  </>
}
export { StockModal }
