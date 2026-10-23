import { describe, expect, it } from 'vitest'
import { waitForServices } from './servicesWait'

const never = new Promise<void>(() => undefined)

describe("the wait for a scale's services (#397)", () => {
  it('returns once the services resolve', async () => {
    let polls = 0
    await waitForServices(async () => ++polls >= 3, never, { timeoutMs: 1_000, intervalMs: 1 })
    expect(polls).toBe(3)
  })

  it('throws at once when the link drops before the services resolve, without waiting out the timeout', async () => {
    let drop: () => void = () => undefined
    const dropped = new Promise<void>((resolve) => (drop = resolve))
    const started = Date.now()
    setTimeout(drop, 20)

    await expect(waitForServices(async () => false, dropped, { timeoutMs: 10_000, intervalMs: 200 })).rejects.toThrow(
      'the scale disconnected before its services resolved',
    )
    expect(Date.now() - started).toBeLessThan(150)
  })

  it('throws when a link that stays up never resolves its services in time', async () => {
    await expect(waitForServices(async () => false, never, { timeoutMs: 30, intervalMs: 5 })).rejects.toThrow(
      'the scale’s services did not resolve',
    )
  })

  it('does not throw later when the link drops after the services resolved', async () => {
    let drop: () => void = () => undefined
    const dropped = new Promise<void>((resolve) => (drop = resolve))
    await waitForServices(async () => true, dropped, { timeoutMs: 1_000, intervalMs: 1 })
    drop()
    await new Promise((resolve) => setTimeout(resolve, 5))
  })
})
