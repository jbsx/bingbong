import { describe, expect, it } from 'vitest'
import { UnsettledActionError } from '../../core/browser/unsettledAction'
import { FakeClock, flushMicrotasks } from '../../core/testing/doubles'
import {
  ARRIVAL_LOAD_TIMEOUT_MS,
  HISTORY_STEP_TIMEOUT_MS,
  LOAD_TIMEOUT_MS,
  createPaneNavigation,
  type PaneNavigationTarget,
} from './paneNavigation'

/**
 * A webContents that does not cooperate: `loadURL` returns a promise
 * Chromium alone can settle. Nothing here aborts on request — an aborting
 * fake would prove the opposite of what #205 is about.
 */
function fakeWebContents(overrides: Partial<PaneNavigationTarget> = {}) {
  let settleLoad: ((outcome: { ok: true } | { ok: false; error: Error }) => void) | null = null
  let navigated: (() => void) | null = null
  const listeners: { event: string; listener: (event: unknown, url?: string, detail?: number | boolean) => void }[] = []
  const fire = (event: string, ...args: [unknown?, string?, (number | boolean)?]) => {
    for (const entry of listeners) if (entry.event === event) entry.listener(...args)
  }
  const target: PaneNavigationTarget = {
    on: ((event: string, listener: (event: unknown, url?: string, detail?: number | boolean) => void) => {
      listeners.push({ event, listener })
    }) as unknown as PaneNavigationTarget['on'],
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
    /** A main-frame navigation commits with this top-level response code. */
    commit: (url: string, httpResponseCode: number) => fire('did-navigate', {}, url, httpResponseCode),
    /** An in-page navigation — a pushState route change or an anchor — in the main frame or a subframe. */
    inPage: (url: string, isMainFrame: boolean) => fire('did-navigate-in-page', {}, url, isMainFrame),
    /** A navigation starts, in the main frame or a subframe, to another document or inside this one. */
    start: (details: { isMainFrame: boolean; isSameDocument: boolean }) =>
      fire('did-start-navigation', { url: 'https://example.com/next', ...details }),
    /** The tab stops loading: the load it was on finished, failed or was cancelled. */
    stopLoading: () => fire('did-stop-loading'),
  }
}

describe('the top-level response status (#239, ADR 0050)', () => {
  it('carries the code of the last main-frame navigation, and knows none before one', () => {
    const wc = fakeWebContents()
    const page = createPaneNavigation(wc.target, new FakeClock())

    expect(page.status?.()).toBeNull()
    wc.commit('https://www.nasa.gov/press-release/voyager-2013', 404)
    expect(page.status?.()).toBe(404)
    // A history step or a click that leaves the page fires the same event.
    wc.commit('https://www.nasa.gov/', 200)
    expect(page.status?.()).toBe(200)
    wc.commit('file:///tmp/x.html', 0)
    expect(page.status?.()).toBeNull()
  })

  it('forgets the status on a main-frame in-page navigation, and keeps it through a subframe’s', () => {
    const wc = fakeWebContents()
    const page = createPaneNavigation(wc.target, new FakeClock())

    wc.commit('https://app.example/unknown-route', 404)
    wc.inPage('https://app.example/unknown-route#details', false)
    expect(page.status?.()).toBe(404)
    // The app routed itself to a page no response was served for.
    wc.inPage('https://app.example/docs', true)
    expect(page.status?.()).toBeNull()
  })
})

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

describe('an action’s page arrival (#309, ADR 0027)', () => {
  const toAnotherDocument = { isMainFrame: true, isSameDocument: false }

  it('is none when the action started no navigation, and waits for nothing', async () => {
    const wc = fakeWebContents()
    const page = createPaneNavigation(wc.target, new FakeClock())

    const watch = page.watchArrival!()
    await expect(watch.arrival()).resolves.toBe('none')
  })

  it('is none for a change of address inside the document, and for a subframe’s navigation', async () => {
    const wc = fakeWebContents()
    const page = createPaneNavigation(wc.target, new FakeClock())

    const watch = page.watchArrival!()
    wc.start({ isMainFrame: true, isSameDocument: true })
    wc.start({ isMainFrame: false, isSameDocument: false })
    await expect(watch.arrival()).resolves.toBe('none')
  })

  it('waits for the load of a navigation to another document the action started, however late it commits', async () => {
    const wc = fakeWebContents()
    const page = createPaneNavigation(wc.target, new FakeClock())

    const watch = page.watchArrival!()
    // A link to a slow server: the navigation has started, nothing has committed.
    wc.start(toAnotherDocument)
    let arrival: string | undefined
    void watch.arrival().then((value) => (arrival = value))
    await flushMicrotasks()
    expect(arrival).toBeUndefined()

    wc.commit('https://example.com/next', 200)
    await flushMicrotasks()
    expect(arrival).toBeUndefined()

    wc.stopLoading()
    await flushMicrotasks()
    expect(arrival).toBe('loaded')
  })

  it('is loaded at once when the load finished before it was asked', async () => {
    const wc = fakeWebContents()
    const page = createPaneNavigation(wc.target, new FakeClock())

    const watch = page.watchArrival!()
    wc.start(toAnotherDocument)
    wc.commit('https://example.com/next', 200)
    wc.stopLoading()
    await expect(watch.arrival()).resolves.toBe('loaded')
  })

  it('is none when the navigation stopped without committing: a download, a 204, an aborted load', async () => {
    const wc = fakeWebContents()
    const page = createPaneNavigation(wc.target, new FakeClock())

    const watch = page.watchArrival!()
    wc.start(toAnotherDocument)
    wc.stopLoading()
    await expect(watch.arrival()).resolves.toBe('none')
  })

  it('ignores a navigation that started before the watch and a load that stopped before the navigation', async () => {
    const wc = fakeWebContents()
    const clock = new FakeClock()
    const page = createPaneNavigation(wc.target, clock)

    wc.start(toAnotherDocument)
    const watch = page.watchArrival!()
    await expect(watch.arrival()).resolves.toBe('none')

    const next = page.watchArrival!()
    wc.stopLoading()
    wc.start(toAnotherDocument)
    const arrival = next.arrival()
    clock.advance(ARRIVAL_LOAD_TIMEOUT_MS)
    await expect(arrival).resolves.toBe('unfinished')
  })

  it('ends at 10 s as an Unfinished Load when the load never finishes, and nothing is left pending', async () => {
    const wc = fakeWebContents()
    const clock = new FakeClock()
    const page = createPaneNavigation(wc.target, clock)

    const watch = page.watchArrival!()
    wc.start(toAnotherDocument)
    let arrival: string | undefined
    void watch.arrival().then((value) => (arrival = value))
    clock.advance(ARRIVAL_LOAD_TIMEOUT_MS - 1)
    await flushMicrotasks()
    expect(arrival).toBeUndefined()

    clock.advance(1)
    await flushMicrotasks()
    expect(arrival).toBe('unfinished')
    expect(ARRIVAL_LOAD_TIMEOUT_MS).toBe(10_000)

    // The load finishing afterwards changes nothing that was reported.
    wc.stopLoading()
    await flushMicrotasks()
    expect(arrival).toBe('unfinished')
  })

  it('a history step waits for the load it started, not for its commit alone', async () => {
    const wc = fakeWebContents({
      navigationHistory: {
        canGoBack: () => true,
        canGoForward: () => true,
        goBack: () => wc.start(toAnotherDocument),
        goForward: () => {},
      },
    })
    const page = createPaneNavigation(wc.target, new FakeClock())

    const watch = page.watchArrival!()
    const back = page.goBack()
    wc.fireDidNavigate()
    wc.commit('https://example.com/previous', 200)
    await back
    let arrival: string | undefined
    void watch.arrival().then((value) => (arrival = value))
    await flushMicrotasks()
    expect(arrival).toBeUndefined()
    wc.stopLoading()
    await flushMicrotasks()
    expect(arrival).toBe('loaded')
  })
})
