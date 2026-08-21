import { describe, expect, it } from 'vitest'
import { FakeClock } from '../testing/doubles'
import { withDeadline } from './clock'

// The capture guard (#57): a hanging capturePage resolves null at its
// deadline instead of wedging the loop; a settling one passes through.

describe('withDeadline', () => {
  it('passes through a value that settles in time', async () => {
    const clock = new FakeClock(0)
    const result = await withDeadline(Promise.resolve('frame'), clock, 2_000)
    expect(result).toBe('frame')
  })

  it('resolves null when the work outlasts the deadline', async () => {
    const clock = new FakeClock(0)
    let settle: (value: string) => void = () => {}
    const pending = new Promise<string>((resolve) => {
      settle = resolve
    })

    let observed: string | null | undefined
    void withDeadline(pending, clock, 2_000).then((value) => {
      observed = value
    })
    clock.advance(2_000)
    await Promise.resolve()
    expect(observed).toBeNull()

    // A late result is stale by definition — nothing changes.
    settle('too late')
    await Promise.resolve()
    expect(observed).toBeNull()
  })

  it('resolves null when the work rejects', async () => {
    const clock = new FakeClock(0)
    const result = await withDeadline(Promise.reject(new Error('dying renderer')), clock, 2_000)
    expect(result).toBeNull()
  })
})
