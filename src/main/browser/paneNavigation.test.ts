import { describe, expect, it } from 'vitest'
import { UnsettledActionError } from '../../core/browser/unsettledAction'
import { HISTORY_STEP_TIMEOUT_MS, LOAD_TIMEOUT_MS, createPaneNavigation, type PaneNavigationTarget } from './paneNavigation'

/**
 * A webContents that does not cooperate: `loadURL` returns a promise
 * Chromium alone can settle. Nothing here aborts on request — an aborting
 * fake would prove the opposite of what #205 is about.
 */
function fakeWebContents(overrides: Partial<PaneNavigationTarget> = {}) {
  let settleLoad: ((outcome: { ok: true } | { ok: false; error: Error }) => void) | null = null
  let navigated: (() => void) | null = null
  const target: PaneNavigationTarget = {
    loadURL: () =>
      new Promise<void>((resolve, reject) => {
        settleLoad = (outcome) => (outcome.ok ? resolve() : reject(outcome.error))
      }),
    navigationHistory: {
      canGoBack: () => true,
      canGoForward: () => true,
      goBack: () => {},
      goForward: () => {},
    },
    once: (_event, listener) => {
      navigated = listener
    },
    getURL: () => 'https://example.com/',
    getTitle: () => 'Example',
    isDestroyed: () => false,
    focus: () => {},
    ...overrides,
  }
  return {
    target,
    /** Chromium finally finishes the load, long after the wrapper gave up. */
    landLate: () => settleLoad?.({ ok: true }),
    failLate: (error: Error) => settleLoad?.({ ok: false, error }),
    fireDidNavigate: () => navigated?.(),
  }
}

function manualTimers() {
  const fired: (() => void)[] = []
  let cancelled = 0
  return {
    setTimer: (_ms: number, fn: () => void) => {
      fired.push(fn)
      return () => {
        cancelled += 1
      }
    },
    fire: (index = 0) => fired[index]!(),
    get scheduled() {
      return fired.length
    },
    get cancelled() {
      return cancelled
    },
  }
}

describe('createPaneNavigation', () => {
  it('reports a navigation that outlives its bounded wait as unsettled, not as an ended one', async () => {
    const wc = fakeWebContents()
    const timers = manualTimers()
    const page = createPaneNavigation(wc.target, { setTimer: timers.setTimer })

    const load = page.loadUrl('https://slow.example')
    timers.fire()

    const error = await load.catch((err: unknown) => err)
    expect(error).toBeInstanceOf(UnsettledActionError)
    expect((error as Error).message).toBe(`timed out loading https://slow.example after ${LOAD_TIMEOUT_MS}ms`)

    // The wrapper is done; Chromium is not. Only the real landing settles it.
    let settled = false
    void (error as UnsettledActionError).settlement.then(() => (settled = true))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(settled).toBe(false)

    wc.landLate()
    await (error as UnsettledActionError).settlement
    expect(settled).toBe(true)
  })

  it('resolves a load that lands in time and drops its timer', async () => {
    const wc = fakeWebContents()
    const timers = manualTimers()
    const page = createPaneNavigation(wc.target, { setTimer: timers.setTimer })

    const load = page.loadUrl('https://example.com')
    wc.landLate()
    await expect(load).resolves.toBeUndefined()
    expect(timers.cancelled).toBe(1)
  })

  it('passes a real load failure through as the ended action it is', async () => {
    const wc = fakeWebContents()
    const timers = manualTimers()
    const page = createPaneNavigation(wc.target, { setTimer: timers.setTimer })

    const load = page.loadUrl('https://gone.example')
    wc.failLate(new Error('net::ERR_NAME_NOT_RESOLVED'))
    const error = await load.catch((err: unknown) => err)
    expect(error).not.toBeInstanceOf(UnsettledActionError)
    expect((error as Error).message).toBe('net::ERR_NAME_NOT_RESOLVED')
  })

  it('reports a history step that outlives its bounded wait as unsettled too', async () => {
    const wc = fakeWebContents()
    const timers = manualTimers()
    const page = createPaneNavigation(wc.target, { setTimer: timers.setTimer })

    const back = page.goBack()
    timers.fire()
    const error = await back.catch((err: unknown) => err)
    expect(error).toBeInstanceOf(UnsettledActionError)
    expect((error as Error).message).toBe(`timed out going back after ${HISTORY_STEP_TIMEOUT_MS}ms`)

    let settled = false
    void (error as UnsettledActionError).settlement.then(() => (settled = true))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(settled).toBe(false)

    wc.fireDidNavigate()
    await (error as UnsettledActionError).settlement
    expect(settled).toBe(true)
  })

  it('refuses a history step with no history without arming a wait at all', async () => {
    const wc = fakeWebContents({
      navigationHistory: { canGoBack: () => false, canGoForward: () => true, goBack: () => {}, goForward: () => {} },
    })
    const timers = manualTimers()
    const page = createPaneNavigation(wc.target, { setTimer: timers.setTimer })

    await expect(page.goBack()).rejects.toThrow('cannot go back: no history')
    expect(timers.scheduled).toBe(0)
  })

  it('reads url and title straight from the surface and never focuses a destroyed one', () => {
    let focused = 0
    const wc = fakeWebContents({ isDestroyed: () => true, focus: () => (focused += 1) })
    const page = createPaneNavigation(wc.target)

    expect(page.url()).toBe('https://example.com/')
    expect(page.title()).toBe('Example')
    page.focus()
    expect(focused).toBe(0)
  })
})
