import { describe, expect, it } from 'vitest'
import { isPaneRect } from './paneState'

describe('isPaneRect', () => {
  it('accepts an object with four finite numbers', () => {
    expect(isPaneRect({ x: 0, y: 12.5, width: 100, height: -0.1 })).toBe(true)
  })

  it('rejects non-object values', () => {
    expect(isPaneRect(null)).toBe(false)
    expect(isPaneRect('10,10,100,50')).toBe(false)
    expect(isPaneRect(undefined)).toBe(false)
  })

  it('rejects objects with missing or non-numeric fields', () => {
    expect(isPaneRect({ x: 0, y: 0, width: 100 })).toBe(false)
    expect(isPaneRect({ x: 0, y: 0, width: 100, height: '50' })).toBe(false)
    expect(isPaneRect({ x: 0, y: 0, width: 100, height: NaN })).toBe(false)
    expect(isPaneRect({ x: 0, y: 0, width: 100, height: 50, extra: 1 })).toBe(false)
  })
})
