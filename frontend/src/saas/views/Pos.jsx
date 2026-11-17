// PDV: the academy shop. Sell from a product grid, run the cash drawer, keep products and stock.
import { useMemo, useState } from 'react'
import { sa } from '../api.js'
import { useGym } from '../SaasApp.jsx'
import { useLoad, PageHead, Card, Table, Btn, Pill, Modal, Field, Input, Select, MoneyInput, Money, Stat, Tabs, Loading, LoadError, Confirm, act } from '../ui.jsx'
import { dateTimeBR, money, qty, PAYMENT_LABEL, today } from '../lib/format.js'
import { emptyCart, addToCart, setQty, removeLine, cartTotals, overStock } from '../lib/cart.js'
import { StockModal } from './Supplies.jsx'

const SALE_METHODS = ['cash', 'pix', 'debit', 'credit', 'account']

function OpenCash({ gym, onDone }) {
  const [c, setC] = useState(10000)
  return <Card title="Caixa fechado">
    <p className="sa-muted">Abra o caixa com o troco que está na gaveta para começar a vender.</p>
    <div className="sa-row wrap"><Field label="Troco inicial"><MoneyInput value={c} onChange={setC} /></Field>
      <Btn kind="primary" onClick={() => act(() => sa.post(`/gyms/${gym.id}/cash/open`, { openingCents: c || 0 }), 'Caixa aberto').then(onDone)}>Abrir caixa</Btn></div>
  </Card>
}

function Sell({ gym, session, reloadCash }) {
  const products = useLoad(() => sa.get(`/gyms/${gym.id}/products`), [gym.id])
  const students = useLoad(() => sa.get(`/gyms/${gym.id}/members?role=student`), [gym.id])
  const [cart, setCart] = useState(emptyCart())
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [method, setMethod] = useState('pix')
  const [paid, setPaid] = useState(null)
  const [memberId, setMemberId] = useState('')
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState(null)
  const list = products.data?.products || []
  const cats = [...new Set(list.map(p => p.category).filter(Boolean))]
  const shown = useMemo(() => list.filter(p => (!cat || p.category === cat) && (!q || p.name.toLowerCase().includes(q.toLowerCase()) || p.sku === q)), [list, q, cat])
  const t = cartTotals(cart, method === 'cash' && paid != null ? paid : null)
  const over = overStock(cart, list)
  const finish = async () => {
    setBusy(true)
    const r = await act(() => sa.post(`/gyms/${gym.id}/sales`, {
      items: cart.lines.map(l => ({ productId: l.productId, qty: l.qty })), discountCents: cart.discountCents || 0,
      paymentMethod: method, paidCents: method === 'cash' ? (paid ?? t.total) : undefined, memberId: memberId || undefined
    }), 'Venda registrada')
    setBusy(false)
    if (r) { setLast(r.sale); setCart(emptyCart()); setPaid(null); setMemberId(''); products.reload(); reloadCash() }
  }
  if (!session) return null
  return <div className="sa-pos">
    <Card className="sa-pos-products">
      <div className="sa-filters">
        <Input autoFocus placeholder="Buscar produto ou código" value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && shown.length === 1) { setCart(addToCart(cart, shown[0])); setQ('') } }} />
        <Select value={cat} onChange={setCat} placeholder="Todas as categorias" options={cats.map(c => ({ value: c, label: c }))} />
      </div>
      {products.loading && !products.data ? <Loading /> : <div className="sa-prod-grid">
        {shown.map(p => <button type="button" key={p.id} className={'sa-prod' + (p.track_stock && p.stock_qty <= 0 ? ' out' : '')} onClick={() => setCart(addToCart(cart, p))}>
          <strong>{p.name}</strong><span>{money(p.price_cents)}</span>{p.track_stock ? <small>{qty(p.stock_qty)} em estoque</small> : <small>sem controle</small>}
        </button>)}
        {!shown.length && <p className="sa-muted">Nenhum produto. Cadastre na aba Produtos.</p>}
      </div>}
    </Card>
    <Card className="sa-pos-cart" title="Venda atual">
      {!cart.lines.length && <p className="sa-muted">Toque nos produtos para adicionar.</p>}
      {cart.lines.map(l => <div key={l.productId} className={'sa-cart-line' + (over.includes(l.productId) ? ' over' : '')}>
        <span className="name">{l.name}</span>
        <span className="qty"><button type="button" className="sa-btn" onClick={() => setCart(setQty(cart, l.productId, l.qty - 1))}>−</button>{qty(l.qty)}<button type="button" className="sa-btn" onClick={() => setCart(setQty(cart, l.productId, l.qty + 1))}>+</button></span>
        <Money cents={Math.round(l.qty * l.unitPriceCents)} />
        <button type="button" className="sa-x" aria-label="Remover" onClick={() => setCart(removeLine(cart, l.productId))}>×</button>
      </div>)}
      {over.length > 0 && <p className="sa-error">Quantidade acima do estoque.</p>}
      <div className="sa-form">
        <Field label="Desconto"><MoneyInput value={cart.discountCents} onChange={v => setCart({ ...cart, discountCents: v || 0 })} /></Field>
        <Field label="Pagamento"><div className="sa-seg">{SALE_METHODS.map(m => <button type="button" key={m} className={method === m ? 'on' : ''} onClick={() => setMethod(m)}>{m === 'account' ? 'Fiado' : PAYMENT_LABEL[m]}</button>)}</div></Field>
        {method === 'cash' && <Field label="Valor recebido"><MoneyInput value={paid ?? t.total} onChange={setPaid} /></Field>}
        <Field label={method === 'account' ? 'Aluno (obrigatório)' : 'Aluno (opcional)'}><Select value={memberId} onChange={setMemberId} placeholder="Cliente avulso" options={(students.data?.members || []).map(m => ({ value: m.id, label: m.name }))} /></Field>
      </div>
      <div className="sa-totals">
        <div><span>Subtotal</span><Money cents={t.subtotal} /></div>
        {t.discount > 0 && <div><span>Desconto</span><Money cents={-t.discount} /></div>}
        <div className="big"><span>Total</span><Money cents={t.total} /></div>
        {method === 'cash' && <div><span>Troco</span><Money cents={t.change} /></div>}
      </div>
      <Btn kind="primary" className="block" disabled={busy || !cart.lines.length || over.length > 0 || t.total <= 0 || (method === 'account' && !memberId) || (method === 'cash' && t.missing > 0)} onClick={finish}>Finalizar venda · {money(t.total)}</Btn>
      {last && <p className="sa-ok">Última venda: {money(last.total_cents)} em {PAYMENT_LABEL[last.payment_method]}{last.change_cents ? `, troco ${money(last.change_cents)}` : ''}.</p>}
    </Card>
  </div>
}

function Drawer({ gym, session, reload }) {
  const [move, setMove] = useState(null)
  const [closing, setClosing] = useState(false)
  const [counted, setCounted] = useState(null)
  const [result, setResult] = useState(null)
  if (!session) return result ? <Card title="Caixa fechado"><p>Diferença na conferência: <Money cents={result} tone={result === 0 ? '' : result > 0 ? 'good' : 'bad'} /></p></Card> : null
  return <>
    <div className="sa-stats">
      <Stat label="Aberto em" value={dateTimeBR(session.opened_at)} />
      <Stat label="Troco inicial" value={money(session.opening_cents)} />
      <Stat label="Vendas" value={money(session.salesCents)} hint={`${session.salesCount} vendas`} />
      <Stat label="Dinheiro esperado na gaveta" value={money(session.expectedCashCents)} />
    </div>
    <Card title="Vendas por forma de pagamento" actions={<>
      <Btn onClick={() => setMove('deposit')}>Suprimento</Btn><Btn onClick={() => setMove('withdrawal')}>Sangria</Btn>
      <Btn kind="primary" onClick={() => { setCounted(session.expectedCashCents); setClosing(true) }}>Fechar caixa</Btn>
    </>}>
      <Table rowKey={r => r.method} columns={[{ key: 'method', label: 'Forma', render: r => PAYMENT_LABEL[r.method] }, { key: 'count', label: 'Vendas', align: 'right' }, { key: 'total', label: 'Total', align: 'right', render: r => <Money cents={r.total} /> }]} rows={session.byMethod} empty="Nenhuma venda neste caixa." />
      <h3>Movimentos</h3>
      <Table columns={[{ key: 'created_at', label: 'Quando', render: r => dateTimeBR(r.created_at) }, { key: 'kind', label: 'Tipo', render: r => (r.kind === 'withdrawal' ? 'Sangria' : 'Suprimento') }, { key: 'reason', label: 'Motivo' }, { key: 'amount_cents', label: 'Valor', align: 'right', render: r => <Money cents={r.amount_cents} /> }]} rows={session.movements} empty="Sem sangrias ou suprimentos." />
    </Card>
    {move && <MoveModal gym={gym} kind={move} onDone={reload} onClose={() => setMove(null)} />}
    {closing && <Modal title="Fechar caixa" onClose={() => setClosing(false)} footer={<><Btn onClick={() => setClosing(false)}>Cancelar</Btn><Btn kind="primary" onClick={async () => {
      const r = await act(() => sa.post(`/gyms/${gym.id}/cash/close`, { countedCents: counted || 0 }), 'Caixa fechado')
      if (r) { setResult(r.differenceCents); setClosing(false); reload() }
    }}>Fechar</Btn></>}>
      <p>Conte o dinheiro da gaveta. O sistema espera <strong>{money(session.expectedCashCents)}</strong>.</p>
      <Field label="Valor contado"><MoneyInput value={counted} onChange={setCounted} /></Field>
      {counted != null && counted !== session.expectedCashCents && <p className={counted > session.expectedCashCents ? 'sa-ok' : 'sa-error'}>{counted > session.expectedCashCents ? 'Sobra' : 'Falta'} de {money(Math.abs(counted - session.expectedCashCents))}</p>}
    </Modal>}
  </>
}

function MoveModal({ gym, kind, onDone, onClose }) {
  const [v, setV] = useState(null)
  const [reason, setReason] = useState('')
  return <Modal title={kind === 'withdrawal' ? 'Sangria (retirar dinheiro)' : 'Suprimento (colocar troco)'} onClose={onClose} footer={<><Btn onClick={onClose}>Cancelar</Btn><Btn kind="primary" disabled={!v} onClick={async () => { const r = await act(() => sa.post(`/gyms/${gym.id}/cash/movement`, { kind, amountCents: v, reason }), 'Movimento lançado'); if (r) { onDone(); onClose() } }}>Lançar</Btn></>}>
    <div className="sa-form"><Field label="Valor"><MoneyInput value={v} onChange={setV} /></Field><Field label="Motivo"><Input value={reason} onChange={e => setReason(e.target.value)} /></Field></div>
  </Modal>
}

function Products({ gym, isAdmin }) {
  const p = useLoad(() => sa.get(`/gyms/${gym.id}/products?all=1`), [gym.id])
  const [edit, setEdit] = useState(null)
  const [stock, setStock] = useState(null)
  const save = async () => {
    const body = { name: edit.name, sku: edit.sku, category: edit.category, priceCents: edit.price_cents, costCents: edit.cost_cents || 0, minQty: Number(edit.min_qty) || 0, trackStock: edit.track_stock !== 0, ...(edit.id ? { active: edit.active !== 0 } : { stockQty: Number(edit.stock_qty) || 0 }) }
    const r = await act(() => (edit.id ? sa.put(`/gyms/${gym.id}/products/${edit.id}`, body) : sa.post(`/gyms/${gym.id}/products`, body)), 'Produto salvo')
    if (r) { setEdit(null); p.reload() }
  }
  const margin = r => (r.price_cents > 0 && r.cost_cents > 0 ? `${Math.round(((r.price_cents - r.cost_cents) / r.price_cents) * 100)}%` : '–')
  return <Card title="Produtos" actions={isAdmin && <Btn kind="primary" onClick={() => setEdit({ name: '', sku: '', category: 'Bebidas', price_cents: null, cost_cents: 0, min_qty: 0, stock_qty: 0, track_stock: 1 })}>Novo produto</Btn>}>
    {p.loading && !p.data ? <Loading /> : <LoadError error={p.error} retry={p.reload} />}
    <Table columns={[
      { key: 'name', label: 'Produto', render: r => <><strong>{r.name}</strong>{!r.active && <Pill>Inativo</Pill>}{r.sku && <div className="sa-muted small">{r.sku}</div>}</> },
      { key: 'category', label: 'Categoria' },
      { key: 'price_cents', label: 'Preço', align: 'right', render: r => <Money cents={r.price_cents} /> },
      { key: 'cost_cents', label: 'Custo', align: 'right', render: r => <Money cents={r.cost_cents} /> },
      { key: 'margin', label: 'Margem', align: 'right', render: margin },
      { key: 'stock_qty', label: 'Estoque', align: 'right', render: r => (r.track_stock ? <>{qty(r.stock_qty)} {r.low ? <Pill tone="bad">baixo</Pill> : null}</> : '–') },
      ...(isAdmin ? [{ key: 'x', label: '', align: 'right', render: r => (r.track_stock ? <Btn onClick={e => { e.stopPropagation(); setStock(r) }}>Estoque</Btn> : null) }] : [])
    ]} rows={p.data?.products} onRow={isAdmin ? setEdit : undefined} empty="Nenhum produto. Ex.: Água 500 ml, Água de coco, Whey, Barra de proteína." />
    {edit && <Modal title={edit.id ? 'Editar produto' : 'Novo produto'} onClose={() => setEdit(null)} footer={<><Btn onClick={() => setEdit(null)}>Cancelar</Btn><Btn kind="primary" disabled={!edit.name.trim() || edit.price_cents == null} onClick={save}>Salvar</Btn></>}>
      <div className="sa-form cols">
        <Field label="Nome" wide><Input value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} /></Field>
        <Field label="Categoria"><Input value={edit.category} list="sa-prod-cats" onChange={e => setEdit({ ...edit, category: e.target.value })} /></Field>
        <Field label="Código / código de barras"><Input value={edit.sku} onChange={e => setEdit({ ...edit, sku: e.target.value })} /></Field>
        <Field label="Preço de venda"><MoneyInput value={edit.price_cents} onChange={v => setEdit({ ...edit, price_cents: v })} /></Field>
        <Field label="Custo"><MoneyInput value={edit.cost_cents} onChange={v => setEdit({ ...edit, cost_cents: v || 0 })} /></Field>
        <Field label="Estoque mínimo"><Input type="number" min={0} value={edit.min_qty} onChange={e => setEdit({ ...edit, min_qty: e.target.value })} /></Field>
        {!edit.id && <Field label="Estoque inicial"><Input type="number" min={0} value={edit.stock_qty} onChange={e => setEdit({ ...edit, stock_qty: e.target.value })} /></Field>}
        <label className="sa-check"><input type="checkbox" checked={edit.track_stock !== 0} onChange={e => setEdit({ ...edit, track_stock: e.target.checked ? 1 : 0 })} /> Controlar estoque</label>
        {edit.id && <label className="sa-check"><input type="checkbox" checked={edit.active !== 0} onChange={e => setEdit({ ...edit, active: e.target.checked ? 1 : 0 })} /> À venda</label>}
      </div>
      <datalist id="sa-prod-cats">{['Bebidas', 'Suplementos', 'Lanches', 'Acessórios', 'Vestuário'].map(c => <option key={c} value={c} />)}</datalist>
    </Modal>}
    {stock && <StockModal gym={gym} item={stock} kind="products" onDone={p.reload} onClose={() => setStock(null)} />}
  </Card>
}

function Sales({ gym, isAdmin }) {
  const [day, setDay] = useState(today())
  const s = useLoad(() => sa.get(`/gyms/${gym.id}/sales?date=${day}`), [gym.id, day])
  const [cancel, setCancel] = useState(null)
  const rows = s.data?.sales || []
  return <Card title="Vendas" actions={<Input type="date" value={day} onChange={e => setDay(e.target.value)} />}>
    <p className="sa-muted">Total do dia <Money cents={rows.filter(r => r.status === 'completed').reduce((n, r) => n + r.total_cents, 0)} /></p>
    <Table columns={[
      { key: 'created_at', label: 'Hora', render: r => dateTimeBR(r.created_at).slice(-5) },
      { key: 'items', label: 'Itens', render: r => r.items.map(i => `${qty(i.qty)}× ${i.name}`).join(', ') },
      { key: 'member_name', label: 'Cliente', render: r => r.member_name || 'Avulso' },
      { key: 'payment_method', label: 'Pagamento', render: r => PAYMENT_LABEL[r.payment_method] },
      { key: 'total_cents', label: 'Total', align: 'right', render: r => <Money cents={r.total_cents} /> },
      { key: 'status', label: '', align: 'right', render: r => (r.status === 'canceled' ? <Pill tone="bad">Cancelada</Pill> : isAdmin ? <Btn onClick={() => setCancel(r)}>Cancelar</Btn> : null) }
    ]} rows={rows} empty="Nenhuma venda neste dia." />
    {cancel && <Confirm title="Cancelar venda" danger confirm="Cancelar venda" text="Os produtos voltam ao estoque e a entrada é estornada." onClose={() => setCancel(null)}
      onYes={() => act(() => sa.post(`/gyms/${gym.id}/sales/${cancel.id}/cancel`, {}), 'Venda cancelada').then(s.reload)} />}
  </Card>
}

export default function Pos() {
  const { gym, isAdmin } = useGym()
  const [tab, setTab] = useState('sell')
  const cash = useLoad(() => sa.get(`/gyms/${gym.id}/cash`), [gym.id])
  const session = cash.data?.session || null
  return <>
    <PageHead title="PDV / Loja" subtitle="Venda de água, suplementos e o que mais a academia oferece.">
      {session ? <Pill tone="ok">Caixa aberto</Pill> : <Pill tone="warn">Caixa fechado</Pill>}
    </PageHead>
    <Tabs value={tab} onChange={setTab} tabs={[['sell', 'Vender'], ['drawer', 'Caixa'], ['products', 'Produtos'], ['sales', 'Vendas']]} />
    {cash.loading && !cash.data ? <Loading /> : <LoadError error={cash.error} retry={cash.reload} />}
    {(tab === 'sell' || tab === 'drawer') && cash.data && !session && <OpenCash gym={gym} onDone={cash.reload} />}
    {tab === 'sell' && <Sell gym={gym} session={session} reloadCash={cash.reload} />}
    {tab === 'drawer' && <Drawer gym={gym} session={session} reload={cash.reload} />}
    {tab === 'products' && <Products gym={gym} isAdmin={isAdmin} />}
    {tab === 'sales' && <Sales gym={gym} isAdmin={isAdmin} />}
  </>
}
