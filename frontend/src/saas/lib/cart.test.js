import { describe, it, expect } from 'vitest'
import { emptyCart, addToCart, setQty, removeLine, cartTotals, overStock } from './cart.js'

const water = { id: 'w', name: 'Água', price_cents: 300, stock_qty: 2, track_stock: 1 }
const coco = { id: 'c', name: 'Coco', price_cents: 750, stock_qty: 0, track_stock: 0 }

describe('PDV cart', () => {
  it('adds, merges and totals lines with discount and change', () => {
    let c = addToCart(emptyCart(), water)
    c = addToCart(c, water, 2)
    c = addToCart(c, coco)
    expect(c.lines).toHaveLength(2)
    expect(c.lines[0].qty).toBe(3)
    c = { ...c, discountCents: 150 }
    const t = cartTotals(c, 2000)
    expect(t).toMatchObject({ subtotal: 1650, discount: 150, total: 1500, change: 500, missing: 0, items: 4 })
    expect(cartTotals({ ...c, discountCents: 99999 }).total).toBe(0)
    expect(cartTotals(c, 1000).missing).toBe(500)
  })
  it('changes and removes lines', () => {
    let c = addToCart(addToCart(emptyCart(), water), coco)
    c = setQty(c, 'w', 5)
    expect(c.lines.find(l => l.productId === 'w').qty).toBe(5)
    c = setQty(c, 'w', 0)
    expect(c.lines.map(l => l.productId)).toEqual(['c'])
    expect(removeLine(c, 'c').lines).toEqual([])
  })
  it('flags lines beyond the stock of tracked products only', () => {
    const c = addToCart(addToCart(emptyCart(), water, 3), coco, 5)
    expect(overStock(c, [water, coco])).toEqual(['w'])
  })
})
