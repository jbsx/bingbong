import { describe, expect, it } from 'vitest'
import { FakeClock } from '../testing/doubles'
import { createTaskActivityTracker, routesDownload } from './taskActivity'

// Which downloads are routed (#423): every one on the kiosk; on the
// desktop, one a Task started — while it was under way, in a short tail
// after it, or on a navigation it started that a slow server answered
// later. Any other keeps the OS Save dialog.

function trackerWithClock() {
  const clock = new FakeClock()
  return { clock, tracker: createTaskActivityTracker({ clock }) }
}

function deferred(): { done: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const done = new Promise<void>((r) => {
    resolve = r
  })
  return { done, resolve }
}

describe('createTaskActivityTracker', () => {
  it('is inactive before any Task', () => {
    expect(trackerWithClock().tracker.isActive()).toBe(false)
  })

  it('is active while a Task is under way, however long it takes', async () => {
    const { clock, tracker } = trackerWithClock()
    const task = deferred()
    const running = tracker.run(() => task.done)
    clock.advance(60_000)
    expect(tracker.isActive()).toBe(true)
    task.resolve()
    await running
  })

  it('stays active for a short tail after the Task ends', async () => {
    const { clock, tracker } = trackerWithClock()
    await tracker.run(async () => {})
    clock.advance(4_999)
    expect(tracker.isActive()).toBe(true)
    clock.advance(1)
    expect(tracker.isActive()).toBe(false)
  })

  it('stays active until overlapping Tasks finish', async () => {
    const { tracker } = trackerWithClock()
    const first = deferred()
    const running = tracker.run(() => first.done)
    await tracker.run(async () => {})
    expect(tracker.isActive()).toBe(true)
    first.resolve()
    await running
  })

  it('does not swallow a Task failure', async () => {
    const { tracker } = trackerWithClock()
    await expect(
      tracker.run(async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
  })

  it('remembers a navigation a Task started, so a slow server answering after the tail still counts', async () => {
    const { clock, tracker } = trackerWithClock()
    await tracker.run(async () => {
      tracker.navigationStarted('https://files.example/report.pdf')
    })
    clock.advance(30_000)
    expect(tracker.isActive()).toBe(false)
    expect(tracker.startedByTask(['https://files.example/report.pdf'])).toBe(true)
    expect(tracker.startedByTask(['https://files.example/other.pdf'])).toBe(false)
  })

  it('forgets a navigation started with no Task under way', () => {
    const { tracker } = trackerWithClock()
    tracker.navigationStarted('https://files.example/report.pdf')
    expect(tracker.startedByTask(['https://files.example/report.pdf'])).toBe(false)
  })
})

describe('routesDownload', () => {
  it('routes every download on the kiosk', () => {
    expect(routesDownload({ kiosk: true, byTask: false })).toBe(true)
  })

  it('routes a desktop download a Task started, and leaves a mouse download its Save dialog', () => {
    expect(routesDownload({ kiosk: false, byTask: true })).toBe(true)
    expect(routesDownload({ kiosk: false, byTask: false })).toBe(false)
  })
})
