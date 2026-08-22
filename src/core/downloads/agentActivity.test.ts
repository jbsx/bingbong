import { describe, expect, it } from 'vitest'
import type { BrowserController, VisualGroundingController } from '../ports/browser'
import { FakeBrowser, FakeClock } from '../testing/doubles'
import { createAgentActivityTracker, withAgentActivity } from './agentActivity'

function trackerWithClock() {
  const clock = new FakeClock()
  return { clock, tracker: createAgentActivityTracker({ clock }) }
}

describe('createAgentActivityTracker', () => {
  it('is inactive before any agent action', () => {
    const { tracker } = trackerWithClock()
    expect(tracker.isActive()).toBe(false)
  })

  it('is active while an agent action is in flight', async () => {
    const { tracker } = trackerWithClock()
    let observed = false
    await tracker.run(async () => {
      observed = tracker.isActive()
    })
    expect(observed).toBe(true)
  })

  it('stays active for a grace window after the action ends', async () => {
    const { clock, tracker } = trackerWithClock()

    await tracker.run(async () => {})
    expect(tracker.isActive()).toBe(true)

    clock.advance(4_999)
    expect(tracker.isActive()).toBe(true)

    clock.advance(1)
    expect(tracker.isActive()).toBe(false)
  })

  it('stays active until overlapping actions finish', async () => {
    const { tracker } = trackerWithClock()
    const release = (() => {
      let resolve!: () => void
      const done = new Promise<void>((r) => {
        resolve = r
      })
      return { done, resolve }
    })()

    const first = tracker.run(() => release.done)
    const second = tracker.run(async () => {})
    await second
    expect(tracker.isActive()).toBe(true)

    release.resolve()
    await first
    expect(tracker.isActive()).toBe(true) // inside the grace window
  })

  it('does not swallow action failures', async () => {
    const { tracker } = trackerWithClock()
    await expect(tracker.run(async () => {
      throw new Error('boom')
    })).rejects.toThrow('boom')
  })
})

describe('withAgentActivity', () => {
  it('marks download-capable verbs as agent activity', async () => {
    const { clock, tracker } = trackerWithClock()
    const browser = new FakeBrowser()
    const tracked = withAgentActivity(browser, tracker)

    expect(tracker.isActive()).toBe(false)
    await tracked.click(3)
    expect(browser.clicks).toEqual([3])
    expect(tracker.isActive()).toBe(true)

    clock.advance(10_000)
    expect(tracker.isActive()).toBe(false)
  })

  it('leaves read-only verbs untracked', async () => {
    const { tracker } = trackerWithClock()
    const tracked = withAgentActivity(new FakeBrowser(), tracker)

    await tracked.readPage()
    await tracked.describeRef(1)

    expect(tracker.isActive()).toBe(false)
  })

  it('keeps the controller surface intact', () => {
    const tracked = withAgentActivity(new FakeBrowser(), trackerWithClock().tracker)
    const verbs: Array<keyof (BrowserController & VisualGroundingController)> = [
      'navigate',
      'readPage',
      'click',
      'type',
      'scroll',
      'screenshot',
      'back',
      'forward',
      'pressKey',
      'state',
      'describeRef',
      'groundingSnapshot',
      'refAtPoint',
    ]
    for (const verb of verbs) {
      expect(typeof tracked[verb]).toBe('function')
    }
  })
})
