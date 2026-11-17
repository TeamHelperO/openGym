import { describe, it, expect } from 'vitest'
import { BRAND, UPSTREAM_NAME, rebranded, branded } from './brand.js'

describe('brand', () => {
  it('keeps the upstream name in tests (no VITE_BRAND_NAME outside a build)', () => {
    expect(BRAND).toBe(UPSTREAM_NAME)
    expect(rebranded).toBe(false)
    expect(branded('Welcome to openGym')).toBe('Welcome to openGym')
  })
  it('passes non-strings through', () => {
    expect(branded(undefined)).toBe(undefined)
  })
})
