import { describe, expect, it } from 'vitest'
import type { Clock } from '../ports/clock'
import { createPaneVisibility, FIRST_FRAME_MS, type PaneVisibility } from './paneVisibility'

function fakeClock(): Clock & { advance(ms: number): void } {
  let now = 0
  let timers: { at: number; fn: () => void; cancelled: boolean }[] = []
  return {
    now: () => now,
    setTimer: (ms, fn) => {
      const timer = { at: now + ms, fn, cancelled: false }
      timers.push(timer)
      return () => {
        timer.cancelled = true
      }
    },
    advance(ms) {
      now += ms
      const due = timers.filter((t) => !t.cancelled && t.at <= now)
      timers = timers.filter((t) => !due.includes(t))
      for (const t of due) t.fn()
    },
  }
}

function setup() {
  const clock = fakeClock()
  const changes: PaneVisibility[] = []
  const pane = createPaneVisibility({ clock, onChange: (visibility) => changes.push(visibility) })
  return { clock, changes, pane }
}

/** A pane past its first frame, out of sight and at rest. */
function atRest() {
  const s = setup()
  s.pane.hosted()
  s.clock.advance(FIRST_FRAME_MS)
  s.changes.length = 0
  return s
}

describe('paneVisibility (ADR 0079, 2026-10-25)', () => {
  it('a created pane is parked for one frame once in its window, then hidden at rest', () => {
    const { clock, changes, pane } = setup()
    expect(pane.current()).toBe('parked')
    pane.hosted()
    clock.advance(FIRST_FRAME_MS - 1)
    expect(pane.current()).toBe('parked')
    clock.advance(1)
    expect(pane.current()).toBe('hidden')
    expect(changes).toEqual(['hidden'])
    expect(FIRST_FRAME_MS).toBeGreaterThanOrEqual(16)
  })

  it('a pane the dashboard shows is shown, and hidden again once out of sight at rest', () => {
    const { changes, pane } = atRest()
    pane.inSight(true)
    expect(pane.current()).toBe('shown')
    pane.inSight(false)
    expect(pane.current()).toBe('hidden')
    expect(changes).toEqual(['shown', 'hidden'])
  })

  it('out of sight, the ear open parks it, and its close hides it again', () => {
    const { changes, pane } = atRest()
    pane.ear(true)
    expect(pane.current()).toBe('parked')
    pane.ear(false)
    expect(pane.current()).toBe('hidden')
    expect(changes).toEqual(['parked', 'hidden'])
  })

  it('the Idle Prompt open parks it as the ear does', () => {
    const { pane } = atRest()
    pane.prompt(true)
    expect(pane.current()).toBe('parked')
    pane.prompt(false)
    expect(pane.current()).toBe('hidden')
  })

  it('a Task with no ear (the CLI harness) parks it until the Task ends', async () => {
    const { changes, pane } = atRest()
    let end!: () => void
    const task = pane.task(() => new Promise<string>((resolve) => (end = () => resolve('ran'))))
    expect(pane.current()).toBe('parked')
    end()
    expect(await task).toBe('ran')
    expect(pane.current()).toBe('hidden')
    expect(changes).toEqual(['parked', 'hidden'])
  })

  it('parked from the ear opening until the Task has ended and the ear has closed, in either order', async () => {
    const { pane } = atRest()
    pane.ear(true)
    let end!: () => void
    const task = pane.task(() => new Promise<void>((resolve) => (end = resolve)))
    pane.ear(false)
    expect(pane.current()).toBe('parked')
    end()
    await task
    expect(pane.current()).toBe('hidden')

    pane.ear(true)
    const quick = pane.task(async () => {})
    await quick
    expect(pane.current()).toBe('parked')
    pane.ear(false)
    expect(pane.current()).toBe('hidden')
  })

  it('a Task that fails lets the park go too, and overlapping Tasks hold it until the last ends', async () => {
    const { pane } = atRest()
    let endFirst!: () => void
    let failSecond!: (error: Error) => void
    const first = pane.task(() => new Promise<void>((resolve) => (endFirst = resolve)))
    const second = pane.task(() => new Promise<void>((_resolve, reject) => (failSecond = reject)))
    endFirst()
    await first
    expect(pane.current()).toBe('parked')
    failSecond(new Error('boom'))
    await expect(second).rejects.toThrow('boom')
    expect(pane.current()).toBe('hidden')
  })

  it('shown wins over parked: the ear open while the dashboard shows the pane leaves it shown', () => {
    const { changes, pane } = atRest()
    pane.inSight(true)
    pane.ear(true)
    expect(pane.current()).toBe('shown')
    pane.inSight(false)
    expect(pane.current()).toBe('parked')
    expect(changes).toEqual(['shown', 'parked'])
  })

  it('a pane shown during its first frame is shown at once', () => {
    const { pane } = setup()
    pane.hosted()
    pane.inSight(true)
    expect(pane.current()).toBe('shown')
  })
})
