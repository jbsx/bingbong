import { describe, expect, it } from 'vitest'
import { COLLECT_PAGE_SCRIPT } from './collectPageScript'

describe('COLLECT_PAGE_SCRIPT', () => {
  it('is valid JavaScript after template-literal escaping', () => {
    expect(() => new Function(COLLECT_PAGE_SCRIPT)).not.toThrow()
  })
})
