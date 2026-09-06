import { describe, expect, it } from 'vitest'
import challengeIframe from '../../core/browser/fixtures/challenge-iframe.json'
import youtubeHome from '../../core/browser/fixtures/youtube-home.json'
import type { CollectedElement, CollectedPage } from '../../core/browser/snapshot'
import { buildPageSnapshot, clickPoint, formatPageSnapshot } from '../../core/browser/snapshot'
import type { BrowserSubspans } from '../../core/perf/browserSubspans'
import { createBrowserSubspans } from '../../core/perf/browserSubspans'
import type { PerfSpanRecord } from '../../core/perf/perfTracer'
import { fakePerfHarness } from '../../core/testing/doubles'
import type { CdpDebugger, CdpPageDriver } from './createCdpBrowserController'
import { createCdpBrowserController } from './createCdpBrowserController'

const youtubeFixture = youtubeHome as unknown as CollectedPage
const challengeFixture = challengeIframe as unknown as CollectedPage
const COLLECT_EXPRESSION = '/* COLLECT */'

/** What the in-page collector keeps: dialog controls, and anything whose
 * rect meets the viewport. Exactly the elements a ref number can name, so
 * the fake's registry is indexed by ref - 1 like the page's. */
function refable(element: CollectedElement, viewport: CollectedPage['viewport']): boolean {
  if (element.layer === 'dialog') return true
  const { x, y, width, height } = element.rect
  return width >= 1 && height >= 1 && y + height > 0 && x + width > 0 && y < viewport.height && x < viewport.width
}

function dialogButton(label: string): Partial<CollectedElement> {
  return {
    tag: 'button',
    role: null,
    inputType: null,
    label,
    layer: 'dialog',
    // Below the fold inside the dialog's own scroller — dialog-layer refs
    // bypass the viewport bound.
    rect: { x: 500, y: 2100, width: 140, height: 40 },
  }
}

/** A consent wall shaped like the e2e fixture: dialog over a covered page. */
function consentWallPage(): CollectedPage {
  return {
    ...youtubeFixture,
    dialogOpen: true,
    dialogText: 'Before you continue to this fixture',
    elements: [
      { ...dialogButton('Accept all') } as CollectedElement,
      { ...dialogButton('Reject all') } as CollectedElement,
      {
        tag: 'button',
        role: null,
        inputType: null,
        label: 'Background button',
        rect: { x: 10, y: 10, width: 160, height: 40 },
      },
    ],
  }
}

/** A Tier-2 dialog: no consent labels, the model must decide. */
function signInDialogPage(): CollectedPage {
  return {
    ...youtubeFixture,
    dialogOpen: true,
    dialogText: 'Opened dialog',
    elements: [
      { ...dialogButton('Sign in') } as CollectedElement,
      { ...dialogButton('Not now') } as CollectedElement,
    ],
  }
}

class FakeCdp implements CdpDebugger {
  readonly calls: { method: string; params?: Record<string, unknown> }[] = []
  evaluateException: string | null = null
  /** When set, only the collector script fails — probes still answer. */
  collectException: string | null = null
  /** When set, click-prep reports the element as covered (blocked path). */
  prepCovered = false
  /** When set, click-prep reports the element as offscreen (no coordinates). */
  prepOffscreen = false
  /** When set, the next click-prep reports a stale registry once (re-collect path). */
  prepStaleOnce = false
  actionProbe: unknown = undefined
  mediaProbe: unknown = { paused: true, currentTime: 12.5, volume: 0.4 }
  collectValues: unknown[] = []
  /**
   * The page's two registries (ADR 0033), modelled by object identity over
   * the fixture's elements: what the last collect left in the page, and the
   * nodes behind the numbers the controller last marked shown. A fixture
   * collected twice is the same page — the same element objects — so every
   * shown number still names its element; `reRender()` makes it a different
   * page wearing the same labels.
   */
  private collectedElements: unknown[] = []
  private shownElements: unknown[] = []
  private nodes = new Map<unknown, unknown>()
  private reRendered = false
  /** What Page.getLayoutMetrics reports as the visual viewport (a region screenshot's frame, #195). */
  layoutMetrics = { pageX: 0, pageY: 0, clientWidth: 1280, clientHeight: 800 }
  private readonly handlers = new Map<string, ((params: unknown) => void)[]>()

  constructor(private evaluateValue: unknown = youtubeFixture) {}

  on(event: string, handler: (params: unknown) => void): void {
    const existing = this.handlers.get(event) ?? []
    existing.push(handler)
    this.handlers.set(event, existing)
  }

  /** Test helper: fire a CDP domain event at the registered handlers. */
  emit(event: string, params: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) handler(params)
  }

  async send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    this.calls.push({ method, params })
    if (method === 'Page.handleJavaScriptDialog') return {} as T
    if (method === 'Runtime.evaluate') {
      if (this.evaluateException) return { exceptionDetails: { text: this.evaluateException } } as T
      const expression = typeof params?.expression === 'string' ? params.expression : ''
      if (expression === COLLECT_EXPRESSION && this.collectException) {
        return { exceptionDetails: { text: this.collectException } } as T
      }
      if (expression === COLLECT_EXPRESSION) {
        const collected = this.collectValues.length > 0 ? this.collectValues.shift() : this.evaluateValue
        return { result: { value: this.collect(collected as CollectedPage) } } as T
      }
      if (expression.includes('/* ACTION_OUTCOME */')) {
        if (this.actionProbe !== undefined) return { result: { value: this.actionProbe } } as T
        const snapshot = buildPageSnapshot(this.evaluateValue as CollectedPage)
        const index = Number(/const index = (\d+)/.exec(expression)?.[1] ?? -1)
        const target = snapshot.refs[index]
        return {
          result: {
            value: {
              target: target
                ? {
                    checked: target.checked ?? null,
                    selectedOption: target.selectedOption ?? null,
                    value: target.value ?? null,
                    ariaPressed: target.ariaPressed ?? null,
                    className: target.className ?? '',
                  }
                : null,
              signature: {
                url: snapshot.url,
                title: snapshot.title,
                scrollX: snapshot.viewport.scrollX ?? 0,
                scrollY: snapshot.viewport.scrollY,
                refCount: snapshot.refs.length,
                labels: snapshot.refs.map((ref) => ref.label),
                dialogOpen: snapshot.dialogOpen,
              },
            },
          },
        } as T
      }
      if (expression.includes('__bingbongMarkShown')) {
        const count = Number(/__bingbongMarkShown\((\d+)\)/.exec(expression)?.[1] ?? 0)
        this.shownElements = this.collectedElements.slice(0, count)
        return { result: { value: true } } as T
      }
      if (expression.includes('__bingbongOverlayShown')) {
        const indices = JSON.parse(/__bingbongOverlayShown\((\[[^)]*\])\)/.exec(expression)?.[1] ?? '[]') as number[]
        for (const index of indices) this.shownElements[index] = this.collectedElements[index]
        return { result: { value: true } } as T
      }
      if (expression.includes('__bingbongRefShown')) {
        const index = Number(/__bingbongRefShown\((\d+)\)/.exec(expression)?.[1] ?? -1)
        const shown = this.shownElements[index]
        return { result: { value: shown !== undefined && shown === this.collectedElements[index] } } as T
      }
      if (expression.includes('/* MEDIA_STATE */')) return { result: { value: this.mediaProbe } } as T
      if (expression.includes('const hit = document.elementFromPoint')) {
        this.collectedElements[20] = this.collectedElements[20] ?? { groundedNode: true }
        return {
          result: {
            value: {
              index: 20,
              element: {
                tag: 'div',
                role: 'button',
                inputType: null,
                label: '',
                rect: { x: 300, y: 180, width: 100, height: 100 },
                href: null,
                downloadsFile: false,
                submitsForm: false,
                credentialField: false,
                paymentField: false,
                inForm: false,
                formHasCredential: false,
                formHasPayment: false,
                layer: 'page',
              },
            },
          },
        } as T
      }
      if (expression.includes('/* SELECT_FOCUS */')) {
        // When set, the next focus probe reports a stale registry once
        // (the re-collect path).
        if (this.prepStaleOnce) {
          this.prepStaleOnce = false
          return { result: { value: false } } as T
        }
        return { result: { value: true } } as T
      }
      if (expression.includes('__bingbongRefs')) {
        if (expression.includes('.click()')) return { result: { value: { clicked: true } } } as T
        if (this.prepStaleOnce) {
          this.prepStaleOnce = false
          return { result: { value: { ok: false } } } as T
        }
        const index = Number(/\)\[(\d+)\]/.exec(expression)?.[1] ?? -1)
        if (index === 20) {
          return { result: { value: { ok: true, clickable: true, x: 350, y: 230 } } } as T
        }
        const snapshot = buildPageSnapshot(this.evaluateValue as CollectedPage)
        const target = snapshot.refs[index]
        if (!target) return { result: { value: { ok: false } } } as T
        // Offscreen: scrollIntoView could not bring the element into the
        // viewport at all — no coordinates, no hit-test.
        if (this.prepOffscreen) return { result: { value: { ok: true, clickable: false } } } as T
        // Mirror the in-page prep math: fresh clickPoint, hit-test result set by the test.
        return { result: { value: { ok: true, clickable: !this.prepCovered, ...clickPoint(target, snapshot.viewport) } } } as T
      }
      return { result: { value: this.evaluateValue } } as T
    }
    if (method === 'Page.captureScreenshot') return { data: Buffer.from('fake-jpeg-bytes').toString('base64') } as T
    if (method === 'Page.getLayoutMetrics') return { visualViewport: { ...this.layoutMetrics, scale: 1, zoom: 1 } } as T
    if (method.startsWith('Input.')) return {} as T
    throw new Error(`unexpected CDP method: ${method}`)
  }

  /**
   * One collect. The page's registry holds exactly the elements a ref
   * number can name, in ref order, and each of them reports where it sat in
   * the registry before — the previous-index mapping the real collector
   * returns.
   */
  private collect(page: CollectedPage): CollectedPage {
    // A malformed payload is the parser's business, not the registry's.
    if (page === null || typeof page !== 'object' || !Array.isArray(page.elements)) return page
    const prior = new Map(this.collectedElements.map((node, index) => [node, index]))
    const registry: unknown[] = []
    const elements = page.elements.map((element) => {
      if (!refable(element, page.viewport)) return { ...element, previousIndex: -1 }
      const node = this.nodeFor(element)
      registry.push(node)
      return { ...element, previousIndex: prior.get(node) ?? -1 }
    })
    this.collectedElements = registry
    return { ...page, elements }
  }

  /** The node this fixture element stands for: itself, or the stand-in a
   * re-render replaced it with. */
  private nodeFor(element: unknown): unknown {
    if (!this.reRendered) return element
    const existing = this.nodes.get(element)
    if (existing) return existing
    const node = { ...(element as object) }
    this.nodes.set(element, node)
    return node
  }

  /** Test helper: the page re-renders under the model — same fixture, same
   * labels, every element a different node from here on. */
  reRender(): void {
    this.reRendered = true
    this.nodes = new Map()
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
  wentForward = 0
  focusCount = 0
  failLoad = false
  /** When set, loadUrl rejects with this exact error (timeout shapes). */
  failLoadError: Error | null = null
  /** When set, loadUrl rejects with ERR_ABORTED — the site self-navigated mid-load. */
  abortLoad = false
  /** Landing hops an aborted load settles through: url() advances one hop
   * per read, then sticks on the last (the settled landing). */
  landingHops: { url: string; title: string }[] = []
  private hops: { url: string; title: string }[] | null = null
  failBack = false
  failForward = false

  async loadUrl(url: string): Promise<void> {
    this.loadedUrls.push(url)
    this.hops = this.landingHops.length > 0 ? [...this.landingHops] : null
    if (this.abortLoad) throw new Error('net::ERR_ABORTED')
    if (this.failLoadError) throw this.failLoadError
    if (this.failLoad) throw new Error('ERR_NAME_NOT_RESOLVED')
  }

  async goBack(): Promise<void> {
    this.wentBack += 1
    if (this.failBack) throw new Error('cannot go back: no history')
  }

  async goForward(): Promise<void> {
    this.wentForward += 1
    if (this.failForward) throw new Error('cannot go forward: no history')
  }

  url(): string {
    if (this.hops && this.hops.length > 1) this.hops.shift()
    return this.hops ? this.hops[0].url : 'https://www.youtube.com/'
  }

  title(): string {
    return this.hops ? this.hops[0].title : 'YouTube'
  }

  focus(): void {
    this.focusCount += 1
  }
}

function makeController(options?: { cdp?: FakeCdp; page?: FakePage; popupBlocks?: string[]; subspans?: BrowserSubspans }) {
  const cdp = options?.cdp ?? new FakeCdp()
  const page = options?.page ?? new FakePage()
  const popupQueue = options?.popupBlocks ? [...options.popupBlocks] : []
  const controller = createCdpBrowserController({
    cdp,
    page,
    collectScript: '/* COLLECT */',
    // Real pacing is policy for the live page; tests only care about the
    // sequence of CDP messages, so don't pay the human-paced sleeps.
    pacing: { settleMs: 0, moveMs: 0, clickMs: 0, keystrokeMs: 0, scrollTickMs: 0 },
    consumePopupBlocks: () => popupQueue.splice(0),
    ...(options?.subspans ? { subspans: options.subspans } : {}),
  })
  return { cdp, page, controller }
}

/** A distinct link element — a distinct DOM node, which is what a ref
 * number names (ADR 0033). */
function link(label: string): CollectedElement {
  return {
    tag: 'a',
    role: null,
    inputType: null,
    label,
    href: `https://example.com/${label}`,
    rect: { x: 10, y: 10, width: 100, height: 40 },
  }
}

/**
 * Show the model this page's numbers, the way every run does before it acts
 * on a ref (ADR 0033). A navigate rather than a read, so a page carrying a
 * consent wall keeps it — read_page dismisses one deterministically.
 */
async function showRefs(controller: { navigate(url: string): Promise<string> }): Promise<void> {
  await controller.navigate('https://www.youtube.com/')
}

/** The settled-state block an Action Outcome appends for this page. */
function settledBlock(collected: CollectedPage): string {
  return formatPageSnapshot(buildPageSnapshot(collected))
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

describe('createCdpBrowserController iframe refs', () => {
  it('lists a cross-origin challenge iframe as a ref with its src on read_page', async () => {
    const { controller } = makeController({ cdp: new FakeCdp(challengeFixture) })

    const text = await controller.readPage()

    expect(text).toContain(
      '[1] iframe "Widget containing a Cloudflare security challenge" src="https://challenges.cloudflare.com/cdn-cgi/challenge-platform"',
    )
    expect(text).toContain('[2] button "Continue"')
  })
})

describe('createCdpBrowserController describeRef', () => {
  it('returns the snapshot facts for a ref, collecting on demand', async () => {
    const { cdp, controller } = makeController()
    await showRefs(controller)
    // An action invalidates the snapshot without changing the page.
    await controller.click(1)
    const collectsBefore = cdp.collectCalls().length

    const target = await controller.describeRef(3)

    expect(cdp.collectCalls()).toHaveLength(collectsBefore + 1)
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

describe('createCdpBrowserController visual point mapping', () => {
  it('registers a hit-tested element as a normal ref that click can use', async () => {
    const { cdp, controller } = makeController()
    await controller.readPage()

    const ref = await controller.refAtPoint({ x: 315, y: 195 })

    expect(ref).toBe(21)
    expect(await controller.describeRef(ref)).toMatchObject({
      ref: 21,
      kind: 'button',
      rect: { x: 300, y: 180, width: 100, height: 100 },
      credentialField: false,
      paymentField: false,
    })
    await controller.click(ref)
    expect(cdp.inputCalls()[1]?.params).toMatchObject({ type: 'mousePressed', x: 315, y: 195 })
  })

  it('rejects a vision point outside the captured viewport', async () => {
    const { controller } = makeController()

    await expect(controller.refAtPoint({ x: 1_500, y: 900 })).rejects.toThrow(/outside the current viewport/)
  })
})

describe('createCdpBrowserController click', () => {
  it('reports flags and no observable change when the click changes nothing', async () => {
    const { controller } = makeController()
    await showRefs(controller)

    const outcome = await controller.click(3)

    expect(outcome).toBe('clicked [3]: urlChanged=false dialogOpen=false; no observable change')
  })

  it('reports clicked-element state deltas and coarse page changes', async () => {
    const changed = {
      ...youtubeFixture,
      elements: [
        {
          tag: 'button',
          role: 'button',
          inputType: null,
          label: 'Toggle captions',
          rect: { x: 10, y: 10, width: 100, height: 40 },
          ariaPressed: 'false',
          className: 'toggle off',
        },
      ],
    }
    const cdp = new FakeCdp(changed)
    cdp.collectValues = [
      changed,
      {
        ...changed,
        url: 'https://www.youtube.com/watch?v=abc',
        title: 'Playing video',
        dialogOpen: true,
      },
    ]
    cdp.actionProbe = {
      target: {
        checked: null,
        selectedOption: null,
        value: null,
        ariaPressed: 'true',
        className: 'toggle on',
      },
      signature: {
        url: 'https://www.youtube.com/watch?v=abc',
        title: 'Playing video',
        scrollX: 0,
        scrollY: 0,
        refCount: 1,
        labels: ['Toggle captions'],
        dialogOpen: true,
      },
    }
    const { controller } = makeController({ cdp })
    await showRefs(controller)

    const outcome = await controller.click(1)

    const postClick = {
      ...changed,
      url: 'https://www.youtube.com/watch?v=abc',
      title: 'Playing video',
      dialogOpen: true,
    }
    expect(outcome).toBe(
      `clicked [1]: urlChanged=true dialogOpen=true; aria-pressed="false" -> "true", class="toggle off" -> "toggle on"; url=https://www.youtube.com/watch?v=abc title="Playing video"; dialog open\n${settledBlock(postClick)}`,
    )
  })

  it('caps verbose clicked-element deltas in the outcome line', async () => {
    const changed = {
      ...youtubeFixture,
      elements: [
        {
          tag: 'button',
          role: 'button',
          inputType: null,
          label: 'Verbose toggle',
          rect: { x: 10, y: 10, width: 100, height: 40 },
          value: 'a'.repeat(160),
          className: 'before '.repeat(20),
        },
      ],
    }
    const cdp = new FakeCdp(changed)
    cdp.actionProbe = {
      target: {
        checked: null,
        selectedOption: null,
        value: 'b'.repeat(160),
        ariaPressed: null,
        className: 'after '.repeat(20),
      },
      signature: {
        url: changed.url,
        title: changed.title,
        scrollX: 0,
        scrollY: 0,
        refCount: 1,
        labels: ['Verbose toggle'],
        dialogOpen: false,
      },
    }
    const { controller } = makeController({ cdp })
    await showRefs(controller)

    const outcome = await controller.click(1)

    // The cap bounds the first line; the meaningful click's settled-state
    // block follows beneath it.
    const [line, ...rest] = outcome.split('\n')
    expect(line.length).toBeLessThanOrEqual(320)
    expect(line).toMatch(/…$/)
    expect(rest.join('\n')).toBe(settledBlock(changed))
  })

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

  it('refreshes the snapshot the last action invalidated, without costing the model a round', async () => {
    const { cdp, controller } = makeController()
    await showRefs(controller)
    await controller.click(1)
    const collectsBefore = cdp.collectCalls().length

    await controller.click(1)

    expect(cdp.collectCalls()).toHaveLength(collectsBefore + 1)
    expect(cdp.inputCalls().at(-2)?.params).toMatchObject({ type: 'mousePressed', x: 36, y: 32 })
  })

  it('refuses a number the model was never shown, and answers with the page (ADR 0033)', async () => {
    const { cdp, controller } = makeController()
    await showRefs(controller)

    await expect(controller.click(999)).rejects.toThrow(
      `ref 999 refused: it no longer names the element you were shown. Continue from the page below\n${settledBlock(youtubeFixture)}`,
    )
    expect(cdp.inputCalls()).toHaveLength(0)
  })

  it('refuses a number whose element the page replaced, rather than clicking its successor', async () => {
    const { cdp, controller } = makeController()
    await showRefs(controller)
    // The page re-renders: same labels, every element a different node.
    await controller.click(1)
    cdp.reRender()

    await expect(controller.click(3)).rejects.toThrow(/ref 3 refused/)
    expect(cdp.inputCalls()).toHaveLength(3)
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
    await showRefs(controller)

    await controller.click(1)

    expect(cdp.inputCalls()[0]?.params).toMatchObject({ type: 'mouseMoved', x: 60, y: 799 })
  })

  it('reports an overlay-blocked click instead of clicking through', async () => {
    const cdp = new FakeCdp()
    cdp.prepCovered = true
    const { controller } = makeController({ cdp })
    await controller.readPage()

    const outcome = await controller.click(3)

    // Nothing reaches the page: no synthetic input, no direct activation —
    // the interception is reported for the model to decide.
    expect(outcome).toBe('clicked [3]: not clicked — blocked by overlay')
    expect(cdp.inputCalls()).toHaveLength(0)
    expect(
      cdp.calls.some(
        (call) => call.method === 'Runtime.evaluate' && typeof call.params?.expression === 'string' && call.params.expression.includes('.click()'),
      ),
    ).toBe(false)
  })

  it('reports the open dialog alongside an overlay-blocked click', async () => {
    const wall = consentWallPage()
    const cdp = new FakeCdp(wall)
    cdp.prepCovered = true
    const { controller } = makeController({ cdp })
    await showRefs(controller)

    // The covered target is the page-level button behind the wall.
    const outcome = await controller.click(3)

    expect(outcome).toBe(
      'clicked [3]: not clicked — blocked by overlay; dialog open: "Before you continue to this fixture"; controls: [1] button "Accept all", [2] button "Reject all"',
    )
  })

  it('still activates directly when the element sits outside the viewport', async () => {
    const cdp = new FakeCdp()
    cdp.prepOffscreen = true
    const { controller } = makeController({ cdp })
    await controller.readPage()

    const outcome = await controller.click(3)

    expect(outcome).toBe(
      'clicked [3]: urlChanged=false dialogOpen=false; no observable change; activated directly (outside viewport)',
    )
    const domClick = cdp.calls.find(
      (call) => call.method === 'Runtime.evaluate' && typeof call.params?.expression === 'string' && call.params.expression.includes('.click()'),
    )
    expect(domClick?.params?.expression).toContain('__bingbongRefs')
  })

  it('refuses instead of re-collecting and retrying when the registry died with the page', async () => {
    const cdp = new FakeCdp()
    cdp.prepStaleOnce = true
    const { controller } = makeController({ cdp })
    await showRefs(controller)

    // The prep reports a registry that died with a navigation. Retrying
    // against the rebuilt one would aim [3] at whoever now holds the
    // number, so the click is refused (ADR 0033).
    await expect(controller.click(3)).rejects.toThrow(/ref 3 refused/)
    expect(cdp.inputCalls()).toHaveLength(0)
  })

  it('answers a refusal with the page as it stands, not the one the number came from', async () => {
    const stale = { ...youtubeFixture, url: 'https://stale.example/' }
    const fresh = { ...youtubeFixture, url: 'https://fresh.example/' }
    const cdp = new FakeCdp(fresh)
    cdp.collectValues = [stale, fresh]
    cdp.prepStaleOnce = true
    const { controller } = makeController({ cdp })
    await showRefs(controller)

    await expect(controller.click(3)).rejects.toThrow(
      `ref 3 refused: it no longer names the element you were shown. Continue from the page below\n${settledBlock(fresh)}`,
    )
  })
})

describe('createCdpBrowserController type', () => {
  it('reads back the field actual value after typing', async () => {
    const cdp = new FakeCdp()
    cdp.actionProbe = {
      target: { checked: null, selectedOption: null, value: 'hello', ariaPressed: null, className: '' },
      signature: {
        url: youtubeFixture.url,
        title: youtubeFixture.title,
        scrollX: 0,
        scrollY: 0,
        refCount: 20,
        labels: buildPageSnapshot(youtubeFixture).refs.map((ref) => ref.label),
        dialogOpen: false,
      },
    }
    const { controller } = makeController({ cdp })
    await showRefs(controller)

    const outcome = await controller.type(3, 'hello')

    expect(outcome).toBe('typed [3]: value="hello"')
  })

  it('focuses the ref with a click, then sends keyDown/keyUp per character', async () => {
    const { cdp, controller } = makeController()
    await showRefs(controller)

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
    await showRefs(controller)

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
    await showRefs(controller)

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

  it('refuses a number the model was never shown', async () => {
    const { controller } = makeController()
    await showRefs(controller)

    await expect(controller.type(999, 'nope')).rejects.toThrow(/ref 999 refused/)
  })

  it('returns the settled page state when the typing navigates (#113)', async () => {
    const submitted = {
      ...youtubeFixture,
      url: 'https://www.youtube.com/results?search_query=keyboards',
      title: 'keyboards - YouTube',
    }
    const cdp = new FakeCdp(youtubeFixture)
    // resolveRef collect, then the post-navigation collect; the probe runs
    // on the new document, where the registry (and the field) is gone.
    cdp.collectValues = [youtubeFixture, submitted]
    cdp.actionProbe = {
      target: null,
      signature: {
        url: submitted.url,
        title: submitted.title,
        scrollX: 0,
        scrollY: 0,
        refCount: 0,
        labels: [],
        dialogOpen: false,
      },
    }
    const { controller } = makeController({ cdp })
    await showRefs(controller)

    const outcome = await controller.type(3, 'keyboards\n')

    expect(outcome).toBe(
      `typed [3]: field unavailable after page change; url=${submitted.url} title=${JSON.stringify(submitted.title)}\n${settledBlock(submitted)}`,
    )
  })

  it('returns the settled page state when typing changes the page in place (#113)', async () => {
    const cdp = new FakeCdp()
    cdp.actionProbe = {
      target: { checked: null, selectedOption: null, value: 'hello', ariaPressed: null, className: 'filled' },
      signature: {
        url: youtubeFixture.url,
        title: youtubeFixture.title,
        scrollX: 0,
        scrollY: 0,
        refCount: 20,
        labels: buildPageSnapshot(youtubeFixture).refs.map((ref) => `${ref.label} `),
        dialogOpen: false,
      },
    }
    const { controller } = makeController({ cdp })
    await showRefs(controller)

    const outcome = await controller.type(3, 'hello')

    expect(outcome).toBe(`typed [3]: value="hello"; page changed\n${settledBlock(youtubeFixture)}`)
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
    // shifts every viewport-relative rect. A scroll re-reads the page it
    // scrolled off and the one it landed on — the second is what it reports
    // as newly in view (#194) — so the refs it hands back are already fresh
    // and the click after it spends no collect of its own.
    await controller.scroll('down')
    expect(collects()).toBe(3)
    await controller.click(2)
    expect(collects()).toBe(3)
    await controller.type(3, 'query\n')
    expect(collects()).toBe(4)
    await controller.click(4)
    expect(collects()).toBe(5)
  })
})

describe('createCdpBrowserController ref identity (ADR 0033)', () => {
  it('resolves a number the scroll printed, and refuses a pre-scroll number the scroll moved', async () => {
    // [1] leaves the viewport, [2] survives it as [1], and a new element
    // arrives as [2] — the only number the delta printed.
    const leaving = link('Leaving')
    const kept = link('Kept')
    const entered = link('Entered')
    const after = { ...youtubeFixture, elements: [kept, entered] }
    const cdp = new FakeCdp(after)
    cdp.collectValues = [{ ...youtubeFixture, elements: [leaving, kept] }, after]
    const { controller } = makeController({ cdp })
    await showRefs(controller)

    expect(await controller.scroll('down')).toContain('new in view:\n[2] link "Entered"')

    await expect(controller.click(2)).resolves.toContain('clicked [2]')
    // [1] was shown as "Leaving"; it now names "Kept".
    await expect(controller.click(1)).rejects.toThrow(/ref 1 refused/)
  })

  it('resolves a pre-scroll number whose element kept it', async () => {
    const kept = link('Kept')
    const after = { ...youtubeFixture, elements: [kept, link('Entered')] }
    const cdp = new FakeCdp(after)
    cdp.collectValues = [{ ...youtubeFixture, elements: [kept, link('Leaving')] }, after]
    const { controller } = makeController({ cdp })
    await showRefs(controller)

    await controller.scroll('down')

    await expect(controller.click(1)).resolves.toContain('clicked [1]')
  })

  it('describes nothing for a replaced element, so the risk gate never assesses a stand-in', async () => {
    const { cdp, controller } = makeController()
    await showRefs(controller)
    await controller.click(1)
    cdp.reRender()

    expect(await controller.describeRef(3)).toBeUndefined()
  })

  it('shows the numbers a refusal carried, so the model continues in the same round', async () => {
    const { cdp, controller } = makeController()
    await showRefs(controller)
    await controller.click(1)
    cdp.reRender()

    await expect(controller.click(3)).rejects.toThrow(/ref 3 refused/)
    await expect(controller.click(3)).resolves.toContain('clicked [3]')
  })
})

describe('createCdpBrowserController scroll', () => {
  /** A page whose viewport holds `text`, with the given elements in view. */
  function scrolledPage(
    overrides: { scrollX?: number; scrollY?: number; viewportText?: string[]; elements?: CollectedElement[] } = {},
  ): CollectedPage {
    return {
      url: 'https://example.com/article',
      title: 'Article',
      viewport: {
        width: 1280,
        height: 800,
        scrollX: overrides.scrollX ?? 0,
        scrollY: overrides.scrollY ?? 0,
        scrollHeight: 4000,
      },
      dialogOpen: false,
      textDigest: 'Article heading',
      viewportText: overrides.viewportText ?? [],
      elements: overrides.elements ?? [],
    }
  }

  function paragraph(label: string): CollectedElement {
    return {
      tag: 'a',
      role: null,
      inputType: null,
      label,
      href: `https://example.com/${label}`,
      rect: { x: 10, y: 10, width: 100, height: 40 },
    }
  }

  it('reports the new scroll position and what the scroll brought into view', async () => {
    const before = scrolledPage({ viewportText: ['The opening paragraph.'], elements: [paragraph('top')] })
    const after = scrolledPage({
      scrollX: 12,
      scrollY: 360,
      viewportText: ['The second paragraph.'],
      elements: [paragraph('next')],
    })
    const cdp = new FakeCdp(before)
    cdp.collectValues = [before, after]
    const { controller } = makeController({ cdp })
    await controller.readPage()

    const outcome = await controller.scroll('down')

    expect(outcome).toBe(
      [
        'scrolled down: x=12 y=360',
        'new in view:',
        '[1] link "next" href="https://example.com/next"',
        'page text:',
        'The second paragraph.',
      ].join('\n'),
    )
  })

  it('says end of page when the scroll brought nothing new in', async () => {
    const stuck = scrolledPage({ scrollY: 3200, viewportText: ['The last paragraph.'], elements: [paragraph('footer')] })
    const cdp = new FakeCdp(stuck)
    cdp.collectValues = [stuck, stuck]
    const { controller } = makeController({ cdp })
    await controller.readPage()

    expect(await controller.scroll('down')).toBe('scrolled down: x=0 y=3200\nend of page')
  })

  it('falls back to the probed position when the settled collect fails', async () => {
    const cdp = new FakeCdp()
    cdp.actionProbe = {
      target: null,
      signature: {
        url: youtubeFixture.url,
        title: youtubeFixture.title,
        scrollX: 12,
        scrollY: 360,
        refCount: 20,
        labels: buildPageSnapshot(youtubeFixture).refs.map((ref) => ref.label),
        dialogOpen: false,
      },
    }
    const { controller } = makeController({ cdp })
    await controller.readPage()
    cdp.collectException = 'collector blew up'

    expect(await controller.scroll('down')).toBe('scrolled down: x=12 y=360')
  })

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

  it('collects a snapshot first when none exists yet, then again for the delta', async () => {
    const { cdp, controller } = makeController()

    await controller.scroll('down')

    expect(cdp.collectCalls()).toHaveLength(2)
    expect(cdp.inputCalls()[0]?.params).toMatchObject({ type: 'mouseWheel' })
  })
})

describe('createCdpBrowserController screenshot', () => {
  it('captures a jpeg and returns the decoded bytes', async () => {
    const { cdp, controller } = makeController()

    const bytes = await controller.screenshot()

    expect(cdp.calls.find((call) => call.method === 'Page.captureScreenshot')?.params).toMatchObject({
      format: 'jpeg',
      quality: 60,
    })
    expect(bytes).toEqual(new Uint8Array(Buffer.from('fake-jpeg-bytes')))
  })

  it('captures one magnified region of the viewport as a clip in page coordinates (#195)', async () => {
    const { cdp, controller } = makeController()
    cdp.layoutMetrics = { pageX: 0, pageY: 300, clientWidth: 1000, clientHeight: 700 }

    const bytes = await controller.screenshot({ region: { left: 0.1, top: 0, width: 0.8, height: 0.2 }, scale: 3 })

    expect(cdp.calls.find((call) => call.method === 'Page.captureScreenshot')?.params).toEqual({
      format: 'jpeg',
      quality: 60,
      clip: { x: 100, y: 300, width: 800, height: 140, scale: 3 },
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

describe('createCdpBrowserController mediaState', () => {
  it('reports actual playback state from the page after controls settle', async () => {
    const { controller } = makeController()

    expect(await controller.mediaState()).toEqual({ paused: true, currentTime: 12.5, volume: 0.4 })
  })
})

describe('createCdpBrowserController dialog tiers', () => {
  it('auto-dismisses a consent dialog on read_page and reports it in one line', async () => {
    const wall = consentWallPage()
    const cleared = { ...wall, dialogOpen: false, dialogText: '', elements: wall.elements.slice(2) }
    const cdp = new FakeCdp(cleared)
    // First collect returns the wall; the post-dismissal re-collect returns
    // the cleared page.
    cdp.collectValues = [wall, cleared]
    const { controller } = makeController({ cdp })

    const text = await controller.readPage()

    expect(text.startsWith('dismissed consent dialog: clicked [2] "Reject all"\n# YouTube — ')).toBe(true)
    expect(text).not.toContain('dialog open:')
    // The dismissal clicked the real registry element (prefer reject).
    const domClick = cdp.calls.find(
      (call) => call.method === 'Runtime.evaluate' && typeof call.params?.expression === 'string' && call.params.expression.includes('.click()'),
    )
    expect(domClick?.params?.expression).toContain('(window.__bingbongRefs || [])[1]')
  })

  it('leaves a non-consent dialog open and surfaces text + controls for the model', async () => {
    const cdp = new FakeCdp(signInDialogPage())
    const { controller } = makeController({ cdp })

    const text = await controller.readPage()

    expect(text).toContain('dialog open: "Opened dialog"')
    expect(text).toContain('[1] button "Sign in" (dialog)')
    expect(text).toContain('[2] button "Not now" (dialog)')
    expect(text).not.toContain('dismissed consent dialog')
  })

  it('dismisses a consent dialog a click opened, appending the one-liner', async () => {
    const cdp = new FakeCdp(youtubeFixture)
    // resolveRef collects the base page first; the post-click collect sees
    // the consent wall the click opened.
    cdp.collectValues = [youtubeFixture, consentWallPage()]
    cdp.actionProbe = {
      target: null,
      signature: {
        url: youtubeFixture.url,
        title: youtubeFixture.title,
        scrollX: 0,
        scrollY: 0,
        refCount: 20,
        labels: buildPageSnapshot(youtubeFixture).refs.map((ref) => ref.label),
        dialogOpen: true,
      },
    }
    const { controller } = makeController({ cdp })
    await showRefs(controller)

    const outcome = await controller.click(3)

    // The consent wall was cleared; the appended block is the re-collected,
    // dialog-free page (the fixture's base evaluateValue).
    expect(outcome).toBe(
      `clicked [3]: urlChanged=false dialogOpen=true; page signature changed; dismissed consent dialog: clicked [2] "Reject all"\n${settledBlock(youtubeFixture)}`,
    )
  })

  it('surfaces the text of a non-consent dialog a click opened (Tier 2)', async () => {
    const cdp = new FakeCdp(youtubeFixture)
    cdp.collectValues = [youtubeFixture, signInDialogPage()]
    cdp.actionProbe = {
      target: null,
      signature: {
        url: youtubeFixture.url,
        title: youtubeFixture.title,
        scrollX: 0,
        scrollY: 0,
        refCount: 20,
        labels: buildPageSnapshot(youtubeFixture).refs.map((ref) => ref.label),
        dialogOpen: true,
      },
    }
    const { controller } = makeController({ cdp })
    await showRefs(controller)

    const outcome = await controller.click(3)

    expect(outcome).toBe(
      `clicked [3]: urlChanged=false dialogOpen=true; page signature changed; dialog open: "Opened dialog"; controls: [1] button "Sign in", [2] button "Not now"\n${settledBlock(signInDialogPage())}`,
    )
  })

  it('does not treat dialogs without consent labels as auto-dismissable', async () => {
    const cdp = new FakeCdp(signInDialogPage())
    const { controller } = makeController({ cdp })

    const text = await controller.readPage()

    expect(cdp.calls.some((call) => call.method === 'Runtime.evaluate' && typeof call.params?.expression === 'string' && call.params.expression.includes('.click()'))).toBe(false)
    expect(text).toContain('dialog open:')
  })
})

describe('createCdpBrowserController native dialogs and popups', () => {
  it('auto-dismisses native JS dialogs and reports them on the next outcome', async () => {
    const cdp = new FakeCdp()
    const { controller } = makeController({ cdp })
    await controller.readPage()

    cdp.emit('Page.javascriptDialogOpening', { type: 'alert', message: 'hello from alert' })

    const outcome = await controller.click(3)

    expect(outcome).toBe(
      'clicked [3]: urlChanged=false dialogOpen=false; no observable change; native alert dialog auto-dismissed: "hello from alert"',
    )
    expect(cdp.calls).toContainEqual({ method: 'Page.handleJavaScriptDialog', params: { accept: false } })
  })

  it('reports multiple native dialogs in order', async () => {
    const cdp = new FakeCdp()
    const { controller } = makeController({ cdp })
    await controller.readPage()

    cdp.emit('Page.javascriptDialogOpening', { type: 'confirm', message: 'first' })
    cdp.emit('Page.javascriptDialogOpening', { type: 'beforeunload', message: 'second' })

    const outcome = await controller.click(3)

    expect(outcome).toContain('native confirm dialog auto-dismissed: "first"')
    expect(outcome).toContain('native beforeunload dialog auto-dismissed: "second"')
  })

  it('reports blocked window.open popups with their URL on the next outcome', async () => {
    const cdp = new FakeCdp()
    const { controller } = makeController({ cdp, popupBlocks: ['http://x.test/popup'] })
    await showRefs(controller)

    const outcome = await controller.click(3)

    expect(outcome).toBe(
      'clicked [3]: urlChanged=false dialogOpen=false; no observable change; popup blocked: http://x.test/popup',
    )
  })

  it('reports blocked popups and native dialogs on read_page too', async () => {
    const cdp = new FakeCdp()
    const { controller } = makeController({ cdp, popupBlocks: ['http://x.test/popup'] })

    const text = await controller.readPage()

    expect(text.endsWith('\npopup blocked: http://x.test/popup')).toBe(true)
  })
})

describe('createCdpBrowserController navigate and back', () => {
  it('returns the settled page state — signature, refs, digest — with the outcome line', async () => {
    const { controller } = makeController()

    const navigated = await controller.navigate('youtube.com')
    expect(navigated).toBe(`navigated: url=https://www.youtube.com/ title="YouTube"\n${settledBlock(youtubeFixture)}`)
    expect(navigated).toContain('signature ')
    expect(await controller.back()).toBe(`went back: url=https://www.youtube.com/ title="YouTube"\n${settledBlock(youtubeFixture)}`)
    expect(await controller.forward()).toBe(`went forward: url=https://www.youtube.com/ title="YouTube"\n${settledBlock(youtubeFixture)}`)
  })

  it('collects the landing page it reports, proving the block is the settled state', async () => {
    const landing = { ...youtubeFixture, title: 'The real landing', textDigest: 'landed here' }
    const cdp = new FakeCdp(youtubeFixture)
    cdp.collectValues = [landing]
    const { controller } = makeController({ cdp })

    const outcome = await controller.navigate('youtube.com')

    expect(outcome).toContain('# The real landing — https://www.youtube.com/')
    expect(outcome).toContain('landed here')
  })

  it('normalizes input, loads the url, and refreshes the ref mapping', async () => {
    const { cdp, page, controller } = makeController()
    await controller.readPage()

    await controller.navigate('youtube.com')

    expect(page.loadedUrls).toEqual(['https://youtube.com'])
    // #113: the navigate outcome's refs are the latest valid snapshot —
    // the following click resolves from them without re-collecting.
    const collectsBefore = cdp.collectCalls().length
    await controller.click(1)
    expect(cdp.collectCalls().length).toBe(collectsBefore)
  })

  it('degrades to the concise outcome line when the landing cannot be collected', async () => {
    const cdp = new FakeCdp({ nonsense: true })
    const { controller } = makeController({ cdp })

    await expect(controller.navigate('youtube.com')).resolves.toBe('navigated: url=https://www.youtube.com/ title="YouTube"')
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

  it('goes back and refreshes the ref mapping', async () => {
    const { cdp, page, controller } = makeController()
    await controller.readPage()

    await controller.back()

    expect(page.wentBack).toBe(1)
    const collectsBefore = cdp.collectCalls().length
    await controller.click(1)
    expect(cdp.collectCalls().length).toBe(collectsBefore)
  })

  it('goes forward and refreshes the ref mapping', async () => {
    const { cdp, page, controller } = makeController()
    await controller.readPage()

    await controller.forward()

    expect(page.wentForward).toBe(1)
    const collectsBefore = cdp.collectCalls().length
    await controller.click(1)
    expect(cdp.collectCalls().length).toBe(collectsBefore)
  })

  it('propagates go-forward failures', async () => {
    const page = new FakePage()
    page.failForward = true
    const { controller } = makeController({ page })

    await expect(controller.forward()).rejects.toThrow(/cannot go forward/)
  })

  it('propagates go-back failures', async () => {
    const page = new FakePage()
    page.failBack = true
    const { controller } = makeController({ page })

    await expect(controller.back()).rejects.toThrow(/cannot go back/)
  })
})

// #79: a site's own mid-load redirect (Google's consent jump, Reddit's
// challenge reload) aborts the requested load with ERR_ABORTED while the
// tab lands somewhere readable. Navigate waits for the landing and reports
// it as a normal outcome; timeouts and real load errors stay hard errors.
describe('createCdpBrowserController navigate abort recovery (#79)', () => {
  it('reports the settled landing as a normal navigate outcome', async () => {
    const page = new FakePage()
    page.abortLoad = true
    page.landingHops = [
      { url: 'https://consent.google.com/m?continue=%2Fsearch', title: 'Before you continue' },
      {
        url: 'https://www.google.com/sorry/index?continue=https%3A%2F%2Fwww.google.com%2Fsearch%3Fq%3Dtest',
        title: 'Unusual traffic from your computer',
      },
    ]
    const landing = {
      ...youtubeFixture,
      url: 'https://www.google.com/sorry/index?continue=https%3A%2F%2Fwww.google.com%2Fsearch%3Fq%3Dtest',
      title: 'Unusual traffic from your computer',
    }
    const cdp = new FakeCdp(youtubeFixture)
    cdp.collectValues = [landing]
    const { controller } = makeController({ cdp, page })

    await expect(controller.navigate('https://www.google.com/search?q=test')).resolves.toBe(
      `navigated: url=https://www.google.com/sorry/index?continue=https%3A%2F%2Fwww.google.com%2Fsearch%3Fq%3Dtest title="Unusual traffic from your computer"\n${settledBlock(landing)}`,
    )
    expect(page.loadedUrls).toEqual(['https://www.google.com/search?q=test'])
  })

  it('waits for a redirect chain to finish landing before reporting', async () => {
    const page = new FakePage()
    page.abortLoad = true
    page.landingHops = [
      { url: 'http://127.0.0.1:1/hop-1', title: 'First hop' },
      { url: 'http://127.0.0.1:1/hop-2', title: 'Second hop' },
      { url: 'http://127.0.0.1:1/landed', title: 'Landed page' },
    ]
    const { controller } = makeController({ page })

    const outcome = await controller.navigate('http://127.0.0.1:1/original')

    expect(outcome.split('\n')[0]).toBe('navigated: url=http://127.0.0.1:1/landed title="Landed page"')
  })

  it('reports the current page when an abort leaves the tab where it was', async () => {
    const page = new FakePage()
    page.abortLoad = true
    const { controller } = makeController({ page })

    const outcome = await controller.navigate('https://www.youtube.com/watch?v=abc')

    expect(outcome.split('\n')[0]).toBe('navigated: url=https://www.youtube.com/ title="YouTube"')
  })

  it('refreshes the ref mapping after a recovered landing', async () => {
    const { cdp, page, controller } = makeController()
    await controller.readPage()
    page.abortLoad = true
    page.landingHops = [{ url: 'https://www.google.com/sorry/', title: 'Unusual traffic' }]

    await controller.navigate('https://www.google.com/search?q=test')

    // The recovered landing's refs are the latest valid snapshot.
    const collectsBefore = cdp.collectCalls().length
    await controller.click(1)
    expect(cdp.collectCalls().length).toBe(collectsBefore)
  })

  it('keeps load timeouts hard errors', async () => {
    const page = new FakePage()
    page.failLoadError = new Error('timed out loading https://slow.test/')
    const { controller } = makeController({ page })

    await expect(controller.navigate('https://slow.test/')).rejects.toThrow(/timed out loading/)
  })
})

// Verbose browser sub-spans (#32): behind the env flag, the controller's
// internal delays and extra round-trips become sub-spans keyed by the turn
// scope the pipeline's tool gate opens. Flag off (or no scope open) — the
// fake sink below stays empty, i.e. the default log is byte-identical to
// whole-action tool spans.
describe('createCdpBrowserController verbose sub-spans (#32)', () => {
  function subspanHarness(enabled: boolean): { records: PerfSpanRecord[]; subspans: BrowserSubspans } {
    const { records, tracer } = fakePerfHarness()
    return { records, subspans: createBrowserSubspans({ tracer, enabled }) }
  }

  it('emits a settle sub-span for the navigate sleep, keyed by the open turn', async () => {
    const { records, subspans } = subspanHarness(true)
    const { controller } = makeController({ subspans })

    await subspans.runInTurn('turn-1', () => controller.navigate('youtube.com'))

    expect(records).toEqual([
      { turnId: 'turn-1', stage: 'browser-settle', durMs: 0, at: 1_700_000_000_000, t: 0, detail: { action: 'navigate', ms: 0 } },
      { turnId: 'turn-1', stage: 'browser-recollection', durMs: 0, at: 1_700_000_000_000, t: 0, detail: { reason: 'settled-state' } },
    ])
  })

  it('emits recollection, safety, and settle sub-spans in order for a cold click', async () => {
    const { records, subspans } = subspanHarness(true)
    const { controller } = makeController({ subspans })
    // Outside the turn scope, so nothing they emit lands in the records:
    // the page the model was shown, and an action that leaves its numbers
    // valid but its snapshot cold.
    await showRefs(controller)
    await controller.click(1)

    await subspans.runInTurn('turn-1', () => controller.click(3))

    expect(records.map((record) => [record.turnId, record.stage, record.detail])).toEqual([
      ['turn-1', 'browser-recollection', { reason: 'resolve-ref' }],
      ['turn-1', 'browser-safety', { kind: 'click-prep' }],
      ['turn-1', 'browser-settle', { action: 'pointer', ms: 0 }],
      ['turn-1', 'browser-settle', { action: 'pointer', ms: 0 }],
      ['turn-1', 'browser-settle', { action: 'click', ms: 0 }],
    ])
  })

  it('emits a keystroke settle per typed character plus the focus/settle waits', async () => {
    const { records, subspans } = subspanHarness(true)
    const { controller } = makeController({ subspans })
    await showRefs(controller)

    await subspans.runInTurn('turn-1', () => controller.type(3, 'hi'))

    const settles = records.filter((record) => record.stage === 'browser-settle').map((record) => record.detail?.action)
    expect(settles).toEqual(['pointer', 'pointer', 'type', 'keystroke', 'keystroke', 'type'])
  })

  it('emits a settle per scroll tick, the missing-snapshot collect, and the delta collect', async () => {
    const { records, subspans } = subspanHarness(true)
    const { controller } = makeController({ subspans })

    await subspans.runInTurn('turn-1', () => controller.scroll('down'))

    expect(records.filter((record) => record.stage === 'browser-recollection').map((record) => record.detail)).toEqual([
      { reason: 'no-snapshot' },
      { reason: 'scroll-delta' },
    ])
    expect(records.filter((record) => record.stage === 'browser-settle').map((record) => record.detail?.action)).toEqual([
      'scroll',
      'scroll',
      'scroll',
    ])
  })

  it('emits the stale-ref recollection when a click is refused', async () => {
    const { records, subspans } = subspanHarness(true)
    const cdp = new FakeCdp()
    cdp.prepStaleOnce = true
    const { controller } = makeController({ cdp, subspans })
    await showRefs(controller)

    await subspans.runInTurn('turn-1', async () => {
      await expect(controller.click(3)).rejects.toThrow(/ref 3 refused/)
    })

    expect(records.filter((record) => record.stage === 'browser-recollection').map((record) => record.detail)).toEqual([
      { reason: 'stale-ref' },
    ])
  })

  it('emits the post-dismissal recollection when read_page clears a consent wall', async () => {
    const { records, subspans } = subspanHarness(true)
    const wall = consentWallPage()
    const cleared = { ...wall, dialogOpen: false, dialogText: '', elements: wall.elements.slice(2) }
    const cdp = new FakeCdp(cleared)
    cdp.collectValues = [wall, cleared]
    const { controller } = makeController({ cdp, subspans })

    await subspans.runInTurn('turn-1', () => controller.readPage())

    expect(records.filter((record) => record.stage === 'browser-recollection').map((record) => record.detail)).toEqual([
      { reason: 'post-dismissal' },
    ])
    expect(records).toContainEqual(
      expect.objectContaining({ stage: 'browser-settle', detail: { action: 'consent-dismiss', ms: 0 } }),
    )
  })

  it('emits nothing when the flag is off — the default log stays byte-identical', async () => {
    const { records, subspans } = subspanHarness(false)
    const { controller } = makeController({ subspans })

    await subspans.runInTurn('turn-1', async () => {
      await controller.navigate('youtube.com')
      await controller.click(3)
      await controller.type(3, 'hi')
    })

    expect(records).toEqual([])
  })

  it('emits nothing outside a turn scope (CLI harness, detached panes)', async () => {
    const { records, subspans } = subspanHarness(true)
    const { controller } = makeController({ subspans })

    await controller.navigate('youtube.com')
    await controller.click(3)

    expect(records).toEqual([])
  })

  it('keeps acting normally without a channel — the no-subspans default', async () => {
    const { controller } = makeController()

    await expect(controller.navigate('youtube.com')).resolves.toBe(
      `navigated: url=https://www.youtube.com/ title="YouTube"\n${settledBlock(youtubeFixture)}`,
    )
    await expect(controller.click(3)).resolves.toBe('clicked [3]: urlChanged=false dialogOpen=false; no observable change')
  })
})

// #133: native controls. A synthetic click on a <select> opens Chromium's
// select popup, which no DOM click can reach — so the type path focuses a
// select instead of clicking it and picks the option with real keyboard
// type-ahead. And a click on a state-bearing control names its post-action
// state even when unchanged, so an ineffective click is visible.
function nativeControlsPage(): CollectedPage {
  return {
    ...youtubeFixture,
    elements: [
      {
        tag: 'select',
        role: null,
        inputType: null,
        label: 'Choice',
        rect: { x: 10, y: 10, width: 120, height: 24 },
        selectedOption: 'Alpha',
        value: 'a',
      },
      {
        tag: 'input',
        role: null,
        inputType: 'checkbox',
        label: 'Agree',
        rect: { x: 10, y: 60, width: 13, height: 13 },
        checked: false,
      },
    ],
  }
}

/** An ACTION_OUTCOME probe whose signature matches the page, so only the target state varies. */
function probeFor(page: CollectedPage, target: Record<string, unknown>): unknown {
  const snapshot = buildPageSnapshot(page)
  return {
    target,
    signature: {
      url: snapshot.url,
      title: snapshot.title,
      scrollX: 0,
      scrollY: snapshot.viewport.scrollY,
      refCount: snapshot.refs.length,
      labels: snapshot.refs.map((ref) => ref.label),
      dialogOpen: snapshot.dialogOpen,
    },
  }
}

describe('createCdpBrowserController native select typing (#133)', () => {
  it('focuses the select instead of clicking, then sends letters as real keys', async () => {
    const cdp = new FakeCdp(nativeControlsPage())
    cdp.actionProbe = probeFor(nativeControlsPage(), { checked: null, selectedOption: 'Beta', value: 'b', ariaPressed: null, className: '' })
    const { controller } = makeController({ cdp })
    await showRefs(controller)

    const outcome = await controller.type(1, 'Beta')

    expect(outcome).toBe('typed [1]: selected="Beta"')
    // The popup never opens: no mouse input at all, only the letters.
    expect(cdp.calls.filter((call) => call.method === 'Input.dispatchMouseEvent')).toHaveLength(0)
    const keys = cdp.calls.filter((call) => call.method === 'Input.dispatchKeyEvent')
    expect(keys.map((call) => call.params?.key)).toEqual(['B', 'B', 'e', 'e', 't', 't', 'a', 'a'])
  })

  it('strips newlines so Enter never opens the select popup', async () => {
    const cdp = new FakeCdp(nativeControlsPage())
    cdp.actionProbe = probeFor(nativeControlsPage(), { checked: null, selectedOption: 'Beta', value: 'b', ariaPressed: null, className: '' })
    const { controller } = makeController({ cdp })
    await showRefs(controller)

    await controller.type(1, 'Beta\n')

    const keys = cdp.calls.filter((call) => call.method === 'Input.dispatchKeyEvent')
    expect(keys.map((call) => call.params?.key)).toEqual(['B', 'B', 'e', 'e', 't', 't', 'a', 'a'])
  })

  it('reports the unchanged selection when no option matches the typed text', async () => {
    const cdp = new FakeCdp(nativeControlsPage())
    cdp.actionProbe = probeFor(nativeControlsPage(), { checked: null, selectedOption: 'Alpha', value: 'a', ariaPressed: null, className: '' })
    const { controller } = makeController({ cdp })
    await showRefs(controller)

    const outcome = await controller.type(1, 'Zeta')

    expect(outcome).toBe('typed [1]: selected="Alpha"')
  })

  it('refuses instead of retrying when the registry died between the check and the focus', async () => {
    const cdp = new FakeCdp(nativeControlsPage())
    cdp.prepStaleOnce = true
    const { controller } = makeController({ cdp })
    await showRefs(controller)

    await expect(controller.type(1, 'Beta')).rejects.toThrow(/ref 1 refused/)
    expect(cdp.calls.filter((call) => call.method === 'Input.dispatchKeyEvent')).toHaveLength(0)
  })

  it('refuses an unshown number like the click path', async () => {
    const { controller } = makeController({ cdp: new FakeCdp(nativeControlsPage()) })
    await showRefs(controller)

    await expect(controller.type(999, 'Beta')).rejects.toThrow(/ref 999 refused/)
  })
})

describe('createCdpBrowserController control-state honesty (#133)', () => {
  it('names the post-action checked state when a checkbox click does not change it', async () => {
    const cdp = new FakeCdp(nativeControlsPage())
    cdp.actionProbe = probeFor(nativeControlsPage(), { checked: false, selectedOption: null, value: null, ariaPressed: null, className: '' })
    const { controller } = makeController({ cdp })
    await showRefs(controller)

    const outcome = await controller.click(2)

    expect(outcome).toBe('clicked [2]: urlChanged=false dialogOpen=false; checked=false')
  })

  it('names the post-action selected option when a select click does not change it', async () => {
    const cdp = new FakeCdp(nativeControlsPage())
    cdp.actionProbe = probeFor(nativeControlsPage(), { checked: null, selectedOption: 'Alpha', value: 'a', ariaPressed: null, className: '' })
    const { controller } = makeController({ cdp })
    await showRefs(controller)

    const outcome = await controller.click(1)

    expect(outcome).toBe('clicked [1]: urlChanged=false dialogOpen=false; selected="Alpha"')
  })

  it('keeps the delta-only clause when the checked state actually changes', async () => {
    const cdp = new FakeCdp(nativeControlsPage())
    cdp.actionProbe = probeFor(nativeControlsPage(), { checked: true, selectedOption: null, value: null, ariaPressed: null, className: '' })
    const { controller } = makeController({ cdp })
    await showRefs(controller)

    const outcome = await controller.click(2)

    expect(outcome.split('\n')[0]).toBe('clicked [2]: urlChanged=false dialogOpen=false; checked=false -> true')
  })
})
