import { describe, expect, it } from 'vitest'
import youtubeHome from '../../core/browser/fixtures/youtube-home.json'
import type { CollectedPage } from '../../core/browser/snapshot'
import { buildPageSnapshot, clickPoint } from '../../core/browser/snapshot'
import type { CdpDebugger, CdpPageDriver } from './createCdpBrowserController'
import { createCdpBrowserController } from './createCdpBrowserController'

const youtubeFixture = youtubeHome as unknown as CollectedPage
const COLLECT_EXPRESSION = '/* COLLECT */'

class FakeCdp implements CdpDebugger {
  readonly calls: { method: string; params?: Record<string, unknown> }[] = []
  evaluateException: string | null = null
  /** When set, click-prep reports the element as covered (DOM fallback path). */
  prepCovered = false
  /** When set, the next click-prep reports a stale registry once (re-collect path). */
  prepStaleOnce = false

  constructor(private evaluateValue: unknown = youtubeFixture) {}

  async send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    this.calls.push({ method, params })
    if (method === 'Runtime.evaluate') {
      if (this.evaluateException) return { exceptionDetails: { text: this.evaluateException } } as T
      const expression = typeof params?.expression === 'string' ? params.expression : ''
      if (expression.includes('__bingbongRefs')) {
        if (expression.includes('.click()')) return { result: { value: { clicked: true } } } as T
        if (this.prepStaleOnce) {
          this.prepStaleOnce = false
          return { result: { value: { ok: false } } } as T
        }
        const index = Number(/\)\[(\d+)\]/.exec(expression)?.[1] ?? -1)
        const snapshot = buildPageSnapshot(this.evaluateValue as CollectedPage)
        const target = snapshot.refs[index]
        if (!target) return { result: { value: { ok: false } } } as T
        // Mirror the in-page prep math: fresh clickPoint, hit-test result set by the test.
        return { result: { value: { ok: true, clickable: !this.prepCovered, ...clickPoint(target, snapshot.viewport) } } } as T
      }
      return { result: { value: this.evaluateValue } } as T
    }
    if (method === 'Page.captureScreenshot') return { data: Buffer.from('fake-jpeg-bytes').toString('base64') } as T
    if (method.startsWith('Input.')) return {} as T
    throw new Error(`unexpected CDP method: ${method}`)
  }

  inputCalls(): { method: string; params?: Record<string, unknown> }[] {
    return this.calls.filter((call) => call.method.startsWith('Input.'))
  }

  /** Collector-script invocations only (click-prep probes evaluate too). */
  collectCalls(): { method: string; params?: Record<string, unknown> }[] {
    return this.calls.filter(
      (call) => call.method === 'Runtime.evaluate' && call.params?.expression === COLLECT_EXPRESSION,
    )
  }
}

class FakePage implements CdpPageDriver {
  readonly loadedUrls: string[] = []
  wentBack = 0
  focusCount = 0
  failLoad = false
  failBack = false

  async loadUrl(url: string): Promise<void> {
    this.loadedUrls.push(url)
    if (this.failLoad) throw new Error('ERR_NAME_NOT_RESOLVED')
  }

  async goBack(): Promise<void> {
    this.wentBack += 1
    if (this.failBack) throw new Error('cannot go back: no history')
  }

  url(): string {
    return 'https://www.youtube.com/'
  }

  title(): string {
    return 'YouTube'
  }

  focus(): void {
    this.focusCount += 1
  }
}

function makeController(options?: { cdp?: FakeCdp; page?: FakePage }) {
  const cdp = options?.cdp ?? new FakeCdp()
  const page = options?.page ?? new FakePage()
  const controller = createCdpBrowserController({
    cdp,
    page,
    collectScript: '/* COLLECT */',
    // Real pacing is policy for the live page; tests only care about the
    // sequence of CDP messages, so don't pay the human-paced sleeps.
    pacing: { settleMs: 0, moveMs: 0, clickMs: 0, keystrokeMs: 0, scrollTickMs: 0 },
  })
  return { cdp, page, controller }
}

describe('createCdpBrowserController readPage', () => {
  it('returns a numbered-ref snapshot built from the collected page', async () => {
    const { controller } = makeController()

    const text = await controller.readPage()

    expect(text).toContain('# YouTube — https://www.youtube.com/')
    expect(text).toContain('[3] input[search] "Search"')
    expect(text).toContain('[14] media "Featured preview player"')
    expect(text).not.toContain('Footer link')
  })

  it('evaluates the collector script in the page with returnByValue', async () => {
    const { cdp, controller } = makeController()

    await controller.readPage()

    const evaluate = cdp.calls.find((call) => call.method === 'Runtime.evaluate')
    expect(evaluate?.params).toMatchObject({ expression: '/* COLLECT */', returnByValue: true })
  })

  it('rejects when the page payload is malformed', async () => {
    const { controller } = makeController({ cdp: new FakeCdp({ nonsense: true }) })

    await expect(controller.readPage()).rejects.toThrow(/collected page payload malformed/)
  })

  it('rejects when evaluation throws inside the page', async () => {
    const cdp = new FakeCdp(youtubeFixture)
    cdp.evaluateException = 'ReferenceError: ytd is not defined'
    const { controller } = makeController({ cdp })

    await expect(controller.readPage()).rejects.toThrow(/page evaluation failed/)
  })

  it('exposes url and title as browser state', () => {
    const { controller } = makeController()

    expect(controller.state()).toEqual({ url: 'https://www.youtube.com/', title: 'YouTube' })
  })
})

describe('createCdpBrowserController describeRef', () => {
  it('returns the snapshot facts for a ref, collecting on demand', async () => {
    const { controller } = makeController()

    const target = await controller.describeRef(3)

    expect(target).toMatchObject({ ref: 3, kind: 'input', inputType: 'search', label: 'Search' })
  })

  it('returns undefined when the ref does not resolve', async () => {
    const { controller } = makeController()

    expect(await controller.describeRef(999)).toBeUndefined()
  })

  it('reuses an existing snapshot instead of re-collecting', async () => {
    const { cdp, controller } = makeController()
    await controller.readPage()
    const collectsBefore = cdp.collectCalls().length

    await controller.describeRef(7)

    expect(cdp.collectCalls()).toHaveLength(collectsBefore)
  })
})

describe('createCdpBrowserController click', () => {
  it('dispatches paced mouse move/press/release at the ref center', async () => {
    const { cdp, controller } = makeController()
    await controller.readPage()

    // [3] input[search] "Search" — rect 384,12 540x40 → center (654, 32)
    await controller.click(3)

    const input = cdp.inputCalls()
    expect(input.map((call) => call.method)).toEqual([
      'Input.dispatchMouseEvent',
      'Input.dispatchMouseEvent',
      'Input.dispatchMouseEvent',
    ])
    expect(input[0]?.params).toMatchObject({ type: 'mouseMoved', x: 654, y: 32 })
    expect(input[1]?.params).toMatchObject({
      type: 'mousePressed',
      x: 654,
      y: 32,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    })
    expect(input[2]?.params).toMatchObject({
      type: 'mouseReleased',
      x: 654,
      y: 32,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    })
  })

  it('refreshes the snapshot when no ref mapping exists yet', async () => {
    const { cdp, controller } = makeController()

    await controller.click(1)

    expect(cdp.collectCalls()).toHaveLength(1)
    expect(cdp.inputCalls()[1]?.params).toMatchObject({ type: 'mousePressed', x: 36, y: 32 })
  })

  it('rejects with a refresh hint for an unknown ref', async () => {
    const { controller } = makeController()

    await expect(controller.click(999)).rejects.toThrow(/ref 999 not found/)
  })

  it('clicks the visible part of an element crossing the viewport edge', async () => {
    const crossing = {
      ...youtubeFixture,
      elements: [
        {
          tag: 'a',
          role: null,
          inputType: null,
          label: 'Half-hidden link',
          rect: { x: 10, y: 780, width: 100, height: 100 },
        },
      ],
    }
    const { cdp, controller } = makeController({ cdp: new FakeCdp(crossing) })

    await controller.click(1)

    expect(cdp.inputCalls()[0]?.params).toMatchObject({ type: 'mouseMoved', x: 60, y: 799 })
  })

  it('activates the element directly when an overlay covers the click point', async () => {
    const cdp = new FakeCdp()
    cdp.prepCovered = true
    const { controller } = makeController({ cdp })
    await controller.readPage()

    await controller.click(3)

    // No synthetic mouse input can reach a covered element — the click is
    // dispatched on the element itself instead.
    expect(cdp.inputCalls()).toHaveLength(0)
    const domClick = cdp.calls.find(
      (call) => call.method === 'Runtime.evaluate' && typeof call.params?.expression === 'string' && call.params.expression.includes('.click()'),
    )
    expect(domClick?.params?.expression).toContain('__bingbongRefs')
  })

  it('re-collects once when the element registry went stale, then clicks', async () => {
    const cdp = new FakeCdp()
    cdp.prepStaleOnce = true
    const { controller } = makeController({ cdp })

    // The first prep reports a stale registry (the page navigated without
    // the snapshot being invalidated); re-collecting rebuilds it and the
    // retried prep succeeds.
    await controller.click(3)

    expect(cdp.collectCalls()).toHaveLength(2)
    expect(cdp.inputCalls()[0]?.params).toMatchObject({ type: 'mouseMoved', x: 654, y: 32 })
  })
})

describe('createCdpBrowserController type', () => {
  it('focuses the ref with a click, then sends keyDown/keyUp per character', async () => {
    const { cdp, controller } = makeController()

    await controller.type(3, 'hi')

    const keys = cdp.calls.filter((call) => call.method === 'Input.dispatchKeyEvent')
    expect(keys.map((call) => call.params)).toEqual([
      { type: 'keyDown', key: 'h', text: 'h', windowsVirtualKeyCode: 72 },
      { type: 'keyUp', key: 'h', windowsVirtualKeyCode: 72 },
      { type: 'keyDown', key: 'i', text: 'i', windowsVirtualKeyCode: 73 },
      { type: 'keyUp', key: 'i', windowsVirtualKeyCode: 73 },
    ])
  })

  it('focuses the target before typing', async () => {
    const { cdp, controller } = makeController()

    await controller.type(3, 'hi')

    const mouse = cdp.inputCalls()
    expect(mouse[0]?.params).toMatchObject({ type: 'mouseMoved', x: 654, y: 32 })
    expect(mouse[1]?.params).toMatchObject({ type: 'mousePressed' })
    expect(mouse[2]?.params).toMatchObject({ type: 'mouseReleased' })
    // Focus click happens before any key event.
    expect(cdp.calls.findIndex((call) => call.method === 'Input.dispatchKeyEvent')).toBeGreaterThan(
      cdp.calls.findIndex((call) => call.params?.type === 'mouseReleased'),
    )
  })

  it('maps newline to Enter with the Enter key code', async () => {
    const { cdp, controller } = makeController()

    await controller.type(3, 'a\n')

    const keys = cdp.calls.filter((call) => call.method === 'Input.dispatchKeyEvent')
    expect(keys.map((call) => call.params?.key)).toEqual(['a', 'a', 'Enter', 'Enter'])
    expect(keys[2]?.params).toMatchObject({
      type: 'keyDown',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      text: '\r',
    })
  })

  it('rejects for an unknown ref', async () => {
    const { controller } = makeController()

    await expect(controller.type(999, 'nope')).rejects.toThrow(/ref 999 not found/)
  })
})

describe('createCdpBrowserController ref staleness', () => {
  it('invalidates refs after acting, so the next action re-reads the page', async () => {
    const { cdp, controller } = makeController()
    const collects = () => cdp.collectCalls().length

    await controller.readPage()
    expect(collects()).toBe(1)

    // First action after a read uses the cached refs...
    await controller.click(1)
    expect(collects()).toBe(1)

    // ...but acting invalidates them: a click may navigate, and scrolling
    // shifts every viewport-relative rect.
    await controller.scroll('down')
    expect(collects()).toBe(2)
    await controller.click(2)
    expect(collects()).toBe(3)
    await controller.type(3, 'query\n')
    expect(collects()).toBe(4)
    await controller.click(4)
    expect(collects()).toBe(5)
  })
})

describe('createCdpBrowserController scroll', () => {
  it('sends paced wheel ticks downward from the viewport center', async () => {
    const { cdp, controller } = makeController()
    await controller.readPage()

    await controller.scroll('down')

    const wheels = cdp.inputCalls().filter((call) => call.params?.type === 'mouseWheel')
    expect(wheels).toHaveLength(3)
    for (const wheel of wheels) {
      expect(wheel.params).toMatchObject({ x: 640, y: 400, deltaX: 0, deltaY: 120 })
    }
  })

  it('scrolls up with negative deltas', async () => {
    const { cdp, controller } = makeController()
    await controller.readPage()

    await controller.scroll('up')

    expect(cdp.inputCalls().filter((call) => call.params?.type === 'mouseWheel')).toHaveLength(3)
    expect(cdp.inputCalls()[0]?.params).toMatchObject({ deltaY: -120 })
  })

  it('collects a snapshot first when none exists yet', async () => {
    const { cdp, controller } = makeController()

    await controller.scroll('down')

    expect(cdp.collectCalls()).toHaveLength(1)
    expect(cdp.inputCalls()[0]?.params).toMatchObject({ type: 'mouseWheel' })
  })
})

describe('createCdpBrowserController screenshot', () => {
  it('captures a jpeg and returns the decoded bytes', async () => {
    const { cdp, controller } = makeController()

    const bytes = await controller.screenshot()

    expect(cdp.calls.find((call) => call.method === 'Page.captureScreenshot')?.params).toMatchObject({
      format: 'jpeg',
    })
    expect(bytes).toEqual(new Uint8Array(Buffer.from('fake-jpeg-bytes')))
  })
})

describe('createCdpBrowserController pressKey', () => {
  it('focuses the page once before dispatching, then sends keyDown/keyUp without text', async () => {
    const { cdp, page, controller } = makeController()

    await controller.pressKey({ key: 'k' }, 3)

    // Synthetic keys are dropped unless the page is the focused webContents;
    // focus is claimed once per call, not per repeat.
    expect(page.focusCount).toBe(1)
    const firstKeyIndex = cdp.calls.findIndex((call) => call.method === 'Input.dispatchKeyEvent')
    expect(firstKeyIndex).toBeGreaterThan(-1)

    const keys = cdp.calls.filter((call) => call.method === 'Input.dispatchKeyEvent')
    expect(keys.map((call) => call.params)).toHaveLength(6)
    expect(keys[0]?.params).toEqual({ type: 'keyDown', key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75 })
    expect(keys[1]?.params).toEqual({ type: 'keyUp', key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75 })
  })

  it('maps named keys like the arrows with their virtual key codes', async () => {
    const { cdp, controller } = makeController()

    await controller.pressKey({ key: 'ArrowUp' })

    const keys = cdp.calls.filter((call) => call.method === 'Input.dispatchKeyEvent')
    expect(keys.map((call) => call.params)).toEqual([
      { type: 'keyDown', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
      { type: 'keyUp', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
    ])
  })

  it('applies the Shift modifier for shifted shortcuts', async () => {
    const { cdp, controller } = makeController()

    await controller.pressKey({ key: 'n', shift: true })

    const keys = cdp.calls.filter((call) => call.method === 'Input.dispatchKeyEvent')
    expect(keys.map((call) => call.params)).toEqual([
      { type: 'keyDown', key: 'N', code: 'KeyN', windowsVirtualKeyCode: 78, modifiers: 8 },
      { type: 'keyUp', key: 'N', code: 'KeyN', windowsVirtualKeyCode: 78, modifiers: 8 },
    ])
  })

  it('rejects unsupported keys and invalid repeat counts', async () => {
    const { controller } = makeController()

    await expect(controller.pressKey({ key: 'NotAKey' })).rejects.toThrow(/unsupported key/)
    await expect(controller.pressKey({ key: '' })).rejects.toThrow(/unsupported key/)
    await expect(controller.pressKey({ key: 'k' }, 0)).rejects.toThrow(/times/)
  })
})

describe('createCdpBrowserController navigate and back', () => {
  it('normalizes input, loads the url, and invalidates the ref mapping', async () => {
    const { cdp, page, controller } = makeController()
    await controller.readPage()

    await controller.navigate('youtube.com')

    expect(page.loadedUrls).toEqual(['https://youtube.com'])
    // Refs are stale after a navigation: the next click must re-collect.
    const collectsBefore = cdp.collectCalls().length
    await controller.click(1)
    expect(cdp.collectCalls().length).toBe(collectsBefore + 1)
  })

  it('rejects input that is not navigable', async () => {
    const { page, controller } = makeController()

    await expect(controller.navigate('   ')).rejects.toThrow(/cannot navigate/)
    expect(page.loadedUrls).toEqual([])
  })

  it('propagates load failures', async () => {
    const page = new FakePage()
    page.failLoad = true
    const { controller } = makeController({ page })

    await expect(controller.navigate('https://unresolvable.invalid')).rejects.toThrow(/ERR_NAME_NOT_RESOLVED/)
  })

  it('goes back and invalidates the ref mapping', async () => {
    const { cdp, page, controller } = makeController()
    await controller.readPage()

    await controller.back()

    expect(page.wentBack).toBe(1)
    const collectsBefore = cdp.collectCalls().length
    await controller.click(1)
    expect(cdp.collectCalls().length).toBe(collectsBefore + 1)
  })

  it('propagates go-back failures', async () => {
    const page = new FakePage()
    page.failBack = true
    const { controller } = makeController({ page })

    await expect(controller.back()).rejects.toThrow(/cannot go back/)
  })
})
