import { describe, expect, it } from 'vitest'
import youtubeHome from '../../core/browser/fixtures/youtube-home.json'
import type { CollectedPage } from '../../core/browser/snapshot'
import type { CdpDebugger, CdpPageDriver } from './createCdpBrowserController'
import { createCdpBrowserController } from './createCdpBrowserController'

const youtubeFixture = youtubeHome as unknown as CollectedPage

class FakeCdp implements CdpDebugger {
  readonly calls: { method: string; params?: Record<string, unknown> }[] = []
  evaluateException: string | null = null

  constructor(private evaluateValue: unknown = youtubeFixture) {}

  async send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    this.calls.push({ method, params })
    if (method === 'Runtime.evaluate') {
      if (this.evaluateException) return { exceptionDetails: { text: this.evaluateException } } as T
      return { result: { value: this.evaluateValue } } as T
    }
    if (method === 'Page.captureScreenshot') return { data: Buffer.from('fake-jpeg-bytes').toString('base64') } as T
    if (method.startsWith('Input.')) return {} as T
    throw new Error(`unexpected CDP method: ${method}`)
  }

  inputCalls(): { method: string; params?: Record<string, unknown> }[] {
    return this.calls.filter((call) => call.method.startsWith('Input.'))
  }
}

class FakePage implements CdpPageDriver {
  readonly loadedUrls: string[] = []
  wentBack = 0
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
    const evaluatesBefore = cdp.calls.filter((call) => call.method === 'Runtime.evaluate').length

    await controller.describeRef(7)

    expect(cdp.calls.filter((call) => call.method === 'Runtime.evaluate')).toHaveLength(evaluatesBefore)
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

    expect(cdp.calls.filter((call) => call.method === 'Runtime.evaluate')).toHaveLength(1)
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
    const evaluates = () => cdp.calls.filter((call) => call.method === 'Runtime.evaluate').length

    await controller.readPage()
    expect(evaluates()).toBe(1)

    // First action after a read uses the cached refs...
    await controller.click(1)
    expect(evaluates()).toBe(1)

    // ...but acting invalidates them: a click may navigate, and scrolling
    // shifts every viewport-relative rect.
    await controller.scroll('down')
    expect(evaluates()).toBe(2)
    await controller.click(2)
    expect(evaluates()).toBe(3)
    await controller.type(3, 'query\n')
    expect(evaluates()).toBe(4)
    await controller.click(4)
    expect(evaluates()).toBe(5)
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

    expect(cdp.calls.filter((call) => call.method === 'Runtime.evaluate')).toHaveLength(1)
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

describe('createCdpBrowserController navigate and back', () => {
  it('normalizes input, loads the url, and invalidates the ref mapping', async () => {
    const { cdp, page, controller } = makeController()
    await controller.readPage()

    await controller.navigate('youtube.com')

    expect(page.loadedUrls).toEqual(['https://youtube.com'])
    // Refs are stale after a navigation: the next click must re-collect.
    const evaluatesBefore = cdp.calls.filter((call) => call.method === 'Runtime.evaluate').length
    await controller.click(1)
    expect(cdp.calls.filter((call) => call.method === 'Runtime.evaluate').length).toBe(evaluatesBefore + 1)
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
    const evaluatesBefore = cdp.calls.filter((call) => call.method === 'Runtime.evaluate').length
    await controller.click(1)
    expect(cdp.calls.filter((call) => call.method === 'Runtime.evaluate').length).toBe(evaluatesBefore + 1)
  })

  it('propagates go-back failures', async () => {
    const page = new FakePage()
    page.failBack = true
    const { controller } = makeController({ page })

    await expect(controller.back()).rejects.toThrow(/cannot go back/)
  })
})
