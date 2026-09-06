import { describe, expect, it, vi } from 'vitest'
import { FakeBrowser, StallingBrowser } from '../testing/doubles'
import {
  AbandonedActionError,
  UnsettledActionError,
  WithheldResourceError,
  boundedWait,
  holdBrowserCustody,
} from './unsettledAction'

/** Lets the microtask queue drain so settled promises have run their handlers. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('boundedWait', () => {
  it('rejects with the underlying operation still outstanding when the wait expires', async () => {
    let settle = (): void => {}
    const underlying = new Promise<void>((resolve) => (settle = resolve))
    const timers: (() => void)[] = []
    const waited = boundedWait(underlying, 30_000, 'timed out loading https://slow.example', {
      setTimer: (_ms, fn) => {
        timers.push(fn)
        return () => {}
      },
    })

    timers[0]!()

    const error = await waited.catch((err: unknown) => err)
    expect(error).toBeInstanceOf(UnsettledActionError)
    expect((error as UnsettledActionError).message).toBe('timed out loading https://slow.example')

    let settled = false
    void (error as UnsettledActionError).settlement.then(() => (settled = true))
    await flush()
    expect(settled).toBe(false)

    settle()
    await (error as UnsettledActionError).settlement
    expect(settled).toBe(true)
  })

  it('passes a value through and cancels its timer when the operation settles in time', async () => {
    const cancel = vi.fn()
    const value = await boundedWait(Promise.resolve('landed'), 100, 'too slow', { setTimer: () => cancel })
    expect(value).toBe('landed')
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('passes a genuine failure through unwrapped — the operation ended, it just ended badly', async () => {
    const failure = new Error('cannot go back: no history')
    const error = await boundedWait(Promise.reject(failure), 100, 'too slow', {
      setTimer: () => () => {},
    }).catch((err: unknown) => err)
    expect(error).toBe(failure)
  })
})

describe('holdBrowserCustody', () => {
  it('passes calls through untouched while nothing has been abandoned', async () => {
    const browser = new FakeBrowser()
    const custody = holdBrowserCustody(browser)

    await expect(custody.controller.navigate('https://example.com')).resolves.toContain('navigated')
    expect(browser.navigations).toEqual(['https://example.com'])
    expect(custody.state()).toBe('available')
  })

  it('ends the wait on an uncooperative action the moment it is abandoned', async () => {
    const browser = new StallingBrowser(['navigate', 'readPage'])
    const custody = holdBrowserCustody(browser)

    const inFlight = custody.controller.navigate('https://slow.example')
    custody.abandon()

    const error = await inFlight.catch((err: unknown) => err)
    expect(error).toBeInstanceOf(AbandonedActionError)
    // The wording is the uncertainty itself: nothing here undid the action.
    expect((error as Error).message).toMatch(/may still be acting/)
  })

  it('withholds the resource after abandonment and refuses new work rather than queueing it', async () => {
    const browser = new StallingBrowser(['navigate', 'readPage'])
    const custody = holdBrowserCustody(browser)

    void custody.controller.navigate('https://slow.example').catch(() => {})
    custody.abandon()
    expect(custody.state()).toBe('withheld')

    await expect(custody.controller.navigate('https://next.example')).rejects.toBeInstanceOf(WithheldResourceError)
    await expect(custody.controller.readPage()).rejects.toBeInstanceOf(WithheldResourceError)
    await expect(custody.controller.click(3)).rejects.toBeInstanceOf(WithheldResourceError)
    await expect(custody.controller.settledState()).rejects.toBeInstanceOf(WithheldResourceError)
    await flush()
    // Refused, never queued: only the abandoned call ever reached the page.
    expect(browser.reached.filter((action) => action === 'navigate')).toHaveLength(1)
    expect(browser.reached).not.toContain('readPage')
    expect(browser.clicks).toEqual([])
  })

  it('reports no page at all while withheld, rather than the stale one', async () => {
    const browser = new StallingBrowser(['readPage'])
    const custody = holdBrowserCustody(browser)
    await custody.controller.navigate('https://example.com')
    expect(custody.controller.state()).toEqual({ url: 'https://example.com', title: 'Fake page: https://example.com' })

    void custody.controller.readPage().catch(() => {})
    custody.abandon()

    expect(custody.controller.state()).toEqual({ url: null, title: null })
  })

  it('releases the resource once the abandoned action actually settles', async () => {
    const browser = new StallingBrowser(['navigate', 'readPage'])
    const custody = holdBrowserCustody(browser)

    void custody.controller.navigate('https://slow.example').catch(() => {})
    custody.abandon()
    expect(custody.state()).toBe('withheld')

    browser.settleLate()
    await custody.settled()
    expect(custody.state()).toBe('available')
    void custody.controller.readPage().catch(() => {})
    expect(browser.reached).toContain('readPage')
  })

  it('keeps withholding when a bounded wait expires — that is not proof the action ended', async () => {
    let settleUnderlying = (): void => {}
    const underlying = new Promise<void>((resolve) => (settleUnderlying = resolve))
    const browser = new StallingBrowser(['navigate', 'readPage'])
    // The adapter's own bounded wait already gave up on this navigation.
    browser.navigateRejectsWith = new UnsettledActionError('timed out loading', underlying)
    const custody = holdBrowserCustody(browser)

    await expect(custody.controller.navigate('https://slow.example')).rejects.toBeInstanceOf(UnsettledActionError)
    await flush()
    // The Run's call rejected, but Chromium was never observed to stop.
    expect(custody.state()).toBe('withheld')
    await expect(custody.controller.readPage()).rejects.toBeInstanceOf(WithheldResourceError)

    settleUnderlying()
    await custody.settled()
    expect(custody.state()).toBe('available')
  })

  it('treats an ordinary rejection as settlement — the action ended, it just failed', async () => {
    const browser = new StallingBrowser(['navigate', 'readPage'])
    const custody = holdBrowserCustody(browser)

    const inFlight = custody.controller.navigate('https://gone.example')
    browser.failLate(new Error('net::ERR_NAME_NOT_RESOLVED'))

    await expect(inFlight).rejects.toThrow('net::ERR_NAME_NOT_RESOLVED')
    await custody.settled()
    expect(custody.state()).toBe('available')
  })

  it('never delivers a late result to the caller that abandoned it', async () => {
    const browser = new StallingBrowser(['navigate', 'readPage'])
    const custody = holdBrowserCustody(browser)

    const outcomes: string[] = []
    const inFlight = custody.controller.navigate('https://slow.example').then(
      (value) => outcomes.push(`resolved:${value}`),
      (error: Error) => outcomes.push(`rejected:${error.name}`),
    )
    custody.abandon()
    await inFlight
    browser.settleLate()
    await custody.settled()
    await flush()

    expect(outcomes).toEqual(['rejected:AbandonedActionError'])
  })

  it('releases a resource whose surface is provably gone without waiting for settlement', async () => {
    const browser = new StallingBrowser(['navigate', 'readPage'])
    const custody = holdBrowserCustody(browser)

    void custody.controller.navigate('https://slow.example').catch(() => {})
    custody.abandon()
    expect(custody.state()).toBe('withheld')

    custody.isolate()
    await custody.settled()
    expect(custody.state()).toBe('available')
    // The stalled navigation still never settled; isolation, not settlement,
    // is what made reuse safe.
    expect(browser.reached.filter((action) => action === 'navigate')).toHaveLength(1)
  })

  it('does not withhold for an action that is merely still running', async () => {
    const browser = new StallingBrowser(['navigate', 'readPage'])
    const custody = holdBrowserCustody(browser)

    void custody.controller.navigate('https://slow.example').catch(() => {})
    expect(custody.state()).toBe('available')
  })

  it('abandons every action in flight, so no sibling of an abandoned call survives', async () => {
    const browser = new StallingBrowser(['navigate', 'readPage'])
    const custody = holdBrowserCustody(browser)

    const first = custody.controller.navigate('https://slow.example').catch((err: Error) => err.name)
    const second = custody.controller.readPage().catch((err: Error) => err.name)
    custody.abandon()

    expect(await first).toBe('AbandonedActionError')
    expect(await second).toBe('AbandonedActionError')
    browser.settleLate()
    await custody.settled()
    expect(custody.state()).toBe('available')
  })
})
