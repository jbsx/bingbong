import { describe, expect, it } from 'vitest'
import { waitFor } from './waitFor'

describe('waitFor', () => {
  it('resolves immediately when the condition already holds', async () => {
    await expect(waitFor(async () => 'ready', { timeoutMs: 100, intervalMs: 5 })).resolves.toBe('ready')
  })

  it('polls until the condition produces a value', async () => {
    let attempts = 0
    const value = await waitFor(
      async () => (++attempts >= 3 ? 'ready' : undefined),
      { timeoutMs: 1000, intervalMs: 5 },
    )
    expect(value).toBe('ready')
    expect(attempts).toBe(3)
  })

  it('rejects after the timeout when the condition never holds', async () => {
    await expect(waitFor(async () => undefined, { timeoutMs: 30, intervalMs: 5 })).rejects.toThrow(
      'waitFor timed out',
    )
  })

  it('keeps polling when the condition throws', async () => {
    let attempts = 0
    const value = await waitFor(
      async () => {
        attempts += 1
        if (attempts < 2) throw new Error('not yet')
        return 'ready'
      },
      { timeoutMs: 1000, intervalMs: 5 },
    )
    expect(value).toBe('ready')
  })
})
