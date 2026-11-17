import { describe, it, expect } from 'vitest'
import { parseCents, centsInput, dateBR, monthRange, shiftMonth } from './format.js'

describe('management formatting', () => {
  it('reads and writes reais', () => {
    expect(parseCents('12,50')).toBe(1250)
    expect(parseCents('R$ 1.234,56')).toBe(123456)
    expect(parseCents('x')).toBe(null)
    expect(centsInput(1250)).toBe('12,50')
  })
  it('dates and months', () => {
    expect(dateBR('2026-11-17')).toBe('17/11/2026')
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
  })
})
