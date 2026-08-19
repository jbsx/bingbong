import { describe, expect, it } from 'vitest'
import { createRetriable } from './retriable'

// The memoize-with-retry shape the model-loading seams share (#41 review):
// a lazily started promise that stays memoized on success (a loaded model
// never reloads) but un-memoizes on rejection so the next call retries a
// transient failure (network fetch, partial file) instead of caching it
// until restart. Pure async behavior — no ORT, no fs.

describe('createRetriable', () => {
  it('memoizes a success: the factory runs once across calls', async () => {
    let calls = 0
    const ensure = createRetriable(async () => {
      calls += 1
      return 'model'
    })
    await expect(ensure()).resolves.toBe('model')
    await expect(ensure()).resolves.toBe('model')
    expect(calls).toBe(1)
  })

  it('un-memoizes a rejection: the next call retries the factory', async () => {
    let calls = 0
    const ensure = createRetriable(async () => {
      calls += 1
      if (calls === 1) throw new Error('transient')
      return 'recovered'
    })
    await expect(ensure()).rejects.toThrow('transient')
    await expect(ensure()).resolves.toBe('recovered')
    expect(calls).toBe(2)
  })

  it('shares one in-flight call: concurrent callers reuse the same promise', async () => {
    let calls = 0
    const ensure = createRetriable(async () => {
      calls += 1
      return 'shared'
    })
    await expect(Promise.all([ensure(), ensure(), ensure()])).resolves.toEqual([
      'shared',
      'shared',
      'shared',
    ])
    expect(calls).toBe(1)
  })

  it('retries after a shared in-flight failure: every caller saw the rejection', async () => {
    let calls = 0
    const ensure = createRetriable(async () => {
      calls += 1
      if (calls === 1) throw new Error('flaky')
      return 'ok'
    })
    const first = [ensure(), ensure()]
    await expect(Promise.all(first)).rejects.toThrow('flaky')
    await expect(ensure()).resolves.toBe('ok')
    expect(calls).toBe(2)
  })
})
