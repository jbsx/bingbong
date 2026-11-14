import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { withinLimit } from './callLimit'

const never = new Promise<never>(() => undefined)

describe('withinLimit (#556)', () => {
  beforeEach(() => void vi.useFakeTimers())
  afterEach(() => void vi.useRealTimers())

  it('returns what the call answers inside its limit', async () => {
    await expect(withinLimit(Promise.resolve(7), 'Connect', 1_000)).resolves.toBe(7)
  })

  it('fails a call that never answers, naming it and its limit', async () => {
    const call = withinLimit(never, 'Connect', 35_000)
    const outcome = expect(call).rejects.toThrow('Connect timed out after 35 s')
    await vi.advanceTimersByTimeAsync(35_000)
    await outcome
  })

  it('passes on the call’s own failure', async () => {
    await expect(withinLimit(Promise.reject(new Error('Remote peer disconnected')), 'Connect', 1_000)).rejects.toThrow('Remote peer disconnected')
  })

  it('fails at once when the work it serves is abandoned', async () => {
    let abandon: () => void = () => undefined
    const abandoned = new Promise<void>((resolve) => (abandon = resolve))
    const call = withinLimit(never, 'StartNotify', 35_000, abandoned)
    const outcome = expect(call).rejects.toThrow('StartNotify abandoned: the session ended')
    abandon()
    await outcome
  })

  it('leaves no unhandled rejection when the call fails after its limit', async () => {
    let late: (error: Error) => void = () => undefined
    const call = new Promise<never>((_resolve, reject) => (late = reject))
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => void unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    try {
      const limited = withinLimit(call, 'GetManagedObjects', 10).catch(() => undefined)
      await vi.advanceTimersByTimeAsync(10)
      await limited
      late(new Error('Remote peer disconnected'))
      vi.useRealTimers()
      await new Promise((resolve) => setTimeout(resolve, 5))
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
    expect(unhandled).toEqual([])
  })
})
