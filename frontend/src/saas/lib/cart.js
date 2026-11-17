// The shop cart (PDV). Pure, so the totals the cashier sees are tested the same way the server's
// saleTotals is (api/saas/calc.js); the server recomputes everything and is the one that counts.

export const emptyCart = () => ({ lines: [], discountCents: 0 })

export function addToCart(cart, product, qty = 1) {
  const lines = cart.lines.slice()
  const i = lines.findIndex(l => l.productId === product.id)
  if (i >= 0) lines[i] = { ...lines[i], qty: lines[i].qty + qty }
  else lines.push({ productId: product.id, name: product.name, unitPriceCents: product.price_cents, qty })
  return { ...cart, lines: lines.filter(l => l.qty > 0) }
}
export function setQty(cart, productId, qty) {
  return { ...cart, lines: cart.lines.map(l => (l.productId === productId ? { ...l, qty } : l)).filter(l => l.qty > 0) }
}
export const removeLine = (cart, productId) => ({ ...cart, lines: cart.lines.filter(l => l.productId !== productId) })

export function cartTotals(cart, paidCents = null) {
  const subtotal = cart.lines.reduce((n, l) => n + Math.round(l.qty * l.unitPriceCents), 0)
  const discount = Math.max(0, Math.min(subtotal, Math.round(cart.discountCents || 0)))
  const total = subtotal - discount
  const paid = paidCents == null ? total : paidCents
  return { subtotal, discount, total, paid, change: Math.max(0, paid - total), missing: Math.max(0, total - paid), items: cart.lines.reduce((n, l) => n + l.qty, 0) }
}

/** Whether the cart asks for more of a product than is in stock. */
export function overStock(cart, products) {
  return cart.lines.filter(l => {
    const p = products.find(x => x.id === l.productId)
    return p && p.track_stock && l.qty > p.stock_qty
  }).map(l => l.productId)
}
