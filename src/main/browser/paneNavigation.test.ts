import { describe, expect, it } from 'vitest'
import { UnsettledActionError } from '../../core/browser/unsettledAction'
import { FakeClock, flushMicrotasks } from '../../core/testing/doubles'
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

describe('createPaneNavigation', () => {
  it('reports a navigation that outlives its bounded wait as unsettled, not as an ended one', async () => {
    const wc = fakeWebContents()
    const clock = new FakeClock()
    const page = createPaneNavigation(wc.target, clock)

    const load = page.loadUrl('https://slow.example')
    clock.advance(LOAD_TIMEOUT_MS)

    const error = await load.catch((err: unknown) => err)
    expect(error).toBeInstanceOf(UnsettledActionError)
    expect((error as Error).message).toBe('stopped waiting for https://slow.example to load; it may still be loading')

    // The wrapper is done; Chromium is not. Only the real landing settles it.
    let settled = false
    void (error as UnsettledActionError).settlement.then(() => (settled = true))
    await flushMicrotasks()
    expect(settled).toBe(false)

    wc.landLate()
    await (error as UnsettledActionError).settlement
    expect(settled).toBe(true)
  })

  it('resolves a load that lands in time and drops its timer', async () => {
    const wc = fakeWebContents()
    const clock = new FakeClock()
    const page = createPaneNavigation(wc.target, clock)

    const load = page.loadUrl('https://example.com')
    wc.landLate()
    await expect(load).resolves.toBeUndefined()

    // The wait is over; advancing past it must not raise a late rejection.
    clock.advance(LOAD_TIMEOUT_MS * 2)
    await flushMicrotasks()
  })

  it('passes a real load failure through as the ended action it is', async () => {
    const wc = fakeWebContents()
    const page = createPaneNavigation(wc.target, new FakeClock())

    const load = page.loadUrl('https://gone.example')
    wc.failLate(new Error('net::ERR_NAME_NOT_RESOLVED'))
    const error = await load.catch((err: unknown) => err)
    expect(error).not.toBeInstanceOf(UnsettledActionError)
    expect((error as Error).message).toBe('net::ERR_NAME_NOT_RESOLVED')
  })

  it('reports a history step that outlives its bounded wait as unsettled too', async () => {
    const wc = fakeWebContents()
    const clock = new FakeClock()
    const page = createPaneNavigation(wc.target, clock)

    const back = page.goBack()
    clock.advance(HISTORY_STEP_TIMEOUT_MS)
    const error = await back.catch((err: unknown) => err)
    expect(error).toBeInstanceOf(UnsettledActionError)
    expect((error as Error).message).toBe('stopped waiting for the page to go back; it may still be navigating')

    let settled = false
    void (error as UnsettledActionError).settlement.then(() => (settled = true))
    await flushMicrotasks()
    expect(settled).toBe(false)

    wc.fireDidNavigate()
    await (error as UnsettledActionError).settlement
    expect(settled).toBe(true)
  })

  it('refuses a history step with no history without arming a wait at all', async () => {
    const wc = fakeWebContents({
      navigationHistory: { canGoBack: () => false, canGoForward: () => true, goBack: () => {}, goForward: () => {} },
    })
    const clock = new FakeClock()
    const page = createPaneNavigation(wc.target, clock)

    await expect(page.goBack()).rejects.toThrow('cannot go back: no history')
    // Nothing was armed, so nothing can expire: a refusal is an ended action.
    clock.advance(HISTORY_STEP_TIMEOUT_MS * 2)
    await flushMicrotasks()
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
