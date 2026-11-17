import { describe, it, expect } from 'vitest'
import { slugFromHash } from './join.js'

describe('signup link', () => {
  it('reads the academy from #/a/<slug> only', () => {
    expect(slugFromHash('#/a/academia-forca-total')).toBe('academia-forca-total')
    expect(slugFromHash('#/a/forca/')).toBe('forca')
    expect(slugFromHash('#/home')).toBe(null)
    expect(slugFromHash('#/a/../admin')).toBe(null)
    expect(slugFromHash('')).toBe(null)
  })
})
