import type { ConsentChooser } from '../../core/browser/dialogPolicy'
import { createSiteQuestionDesk, type SiteQuestionDesk, type SiteQuestionEvent } from '../../core/browser/siteQuestionDesk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import challengeIframe from '../../core/browser/fixtures/challenge-iframe.json'
import youtubeHome from '../../core/browser/fixtures/youtube-home.json'
import type { CollectedElement, CollectedPage } from '../../core/browser/snapshot'
import { buildPageSnapshot, clickPoint, formatPageSnapshot, formatRefLine } from '../../core/browser/snapshot'
import { ARRIVED_CLAUSE, UNFINISHED_LOAD_CLAUSE, arrivedAtAnotherDocument, blockedOrInertAction, isUnfinishedLoad, PAGE_NOT_READ } from '../../core/browser/actionOutcome'
import { setFaultSink, type FaultReport } from '../../core/trace/fault'
import type { BrowserSubspans } from '../../core/perf/browserSubspans'
import { createBrowserSubspans } from '../../core/perf/browserSubspans'
import type { PerfSpanRecord } from '../../core/perf/perfTracer'
import { fakePerfHarness } from '../../core/testing/doubles'
import type { Clock } from '../../core/ports/clock'
import { FakeClock, flushMicrotasks } from '../../core/testing/doubles'
import type { ActionEffect, ActionEffects, ArrivalWatch, CdpDebugger, CdpPageDriver, PageArrival, PageFrame, PageFrames } from './createCdpBrowserController'
import { createCdpBrowserController, READINESS_CAP_MS, SUBMIT_START_MS } from './createCdpBrowserController'
import type { ClickPrep } from './collectPageScript'
import type { AxNode } from '../../core/browser/refStates'

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

/** The registry index an in-page probe aims at: `(window.__bingbongRefs || [])[2]` → 2; -1 for none. */
function registryIndexOf(expression: string): number {
  return Number(/\)\[(\d+)\]/.exec(expression)?.[1] ?? -1)
}

class FakeCdp implements CdpDebugger {
  readonly calls: { method: string; params?: Record<string, unknown> }[] = []
  evaluateException: string | null = null
  /** When set, only the collector script fails — probes still answer. */
  collectException: string | null = null
  /** How many collects from here throw before the rest answer (#308): a page the tab is leaving. */
  collectFailures = 0
  /** When set, click-prep reports the element as covered (blocked path). */
  prepCovered = false
  /** How many click-preps from here report a cover before the rest land (a wall that goes). */
  prepCoveredTimes = 0
  /** What a blocked click-prep says blocked it (ADR 0062): a Cover probe, or Not Shown. */
  prepBlocked: ClickPrep['blocked'] = { fact: 'covered', cover: { tag: 'div', contains: [] } }
  /** When set, another text field holds the focus and its popup is the cover: the blur takes the cover away. */
  focusedFieldPopup = false
  /** The blur probes the controller sent, by registry index. */
  readonly blurs: number[] = []
  /** Runs on every DOM `.click()` the controller evaluates — a dismissal taking the wall away. */
  onDomClick: (() => void) | null = null
  /** The node the controller kept across a consent dismissal (ADR 0061). */
  private keptNode: unknown = undefined
  /** When set, the in-place dialog-labels probe throws (a page mid-navigation). */
  dialogLabelsException: string | null = null
  /** When set, click-prep reports the element as offscreen (no coordinates). */
  prepOffscreen = false
  /** When set, click-prep reports the element wholly under covers that paint nothing (ADR 0062's Blank Cover). */
  prepBlankCover = false
  /** When set, the next click-prep reports a stale registry once (re-collect path). */
  prepStaleOnce = false
  actionProbe: unknown = undefined
  /** The address the clicked link carries right after the click (#299); undefined answers the element's own href. */
  linkAddress: string | null | undefined = undefined
  mediaProbe: unknown = { paused: true, currentTime: 12.5, volume: 0.4 }
  /** What a Media Op's evaluate answers (#372): the element's facts before and after, or null for an element that is no media. */
  mediaOpResult: unknown = null
  /** What the Search Op's submit check answers (#398): `enter`, or `form` for a form it submitted itself. */
  searchSubmit: 'enter' | 'form' = 'enter'
  /** What the in-place links helper answers (#303); null is a page that holds no helper. */
  pageLinks: unknown = null
  collectValues: unknown[] = []
  /** What the in-place dialog-open probe answers, in turn; empty answers false (no dialog). */
  dialogOpenValues: boolean[] = []
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
  /** Where the iframe's frame starts in the page (#377): what the frame-box probe answers. */
  frameBox: { x: number; y: number } | null = null
  /** What Page.getLayoutMetrics reports as the visual viewport (a region screenshot's frame, #195). */
  layoutMetrics = { pageX: 0, pageY: 0, clientWidth: 1280, clientHeight: 800 }
  private readonly handlers = new Map<string, ((params: unknown) => void)[]>()
  /** The file field a chooser names (#424), as the field-facts read answers it; null for a node gone. */
  fileField: { multiple: boolean; accept: string; label: string } | null = { multiple: false, accept: '', label: '' }

  constructor(private evaluateValue: unknown = youtubeFixture) {}

  /** Test helper: the page now serves this collect by default — a wall arriving, or going. */
  serve(page: unknown): void {
    this.evaluateValue = page
  }

  on(event: string, handler: (params: unknown) => void): void {
    const existing = this.handlers.get(event) ?? []
    existing.push(handler)
    this.handlers.set(event, existing)
  }

  /** Test helper: fire a CDP domain event at the registered handlers. */
  emit(event: string, params: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) handler(params)
  }

  /**
   * What the armed readiness watch answers (#324): an effect, or the page's
   * own cap. A test that sets `readyHangs` gets a wait that never answers —
   * the controller's cap on its clock is what ends it.
   */
  readyOutcome: ActionEffect | 'timeout' = 'mutation'
  readyHangs = false
  /** How many readiness watches were armed and waited on. */
  readyArmed = 0
  readyWaited = 0

  /** What the accessibility tree answers for each registry index (Ref State); an index it lacks answers no node. */
  readonly axNodes = new Map<number, AxNode>()
  /** When set, the tree's answer fails for every ref (a page mid-navigation). */
  axException: string | null = null
  /** The registry indices whose node is gone by the time the tree is asked. */
  readonly axGone = new Set<number>()
  /** When set, the page holds no registry to take handles on. */
  noRegistry = false

  async send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    this.calls.push({ method, params })
    if (method === 'Page.handleJavaScriptDialog') return {} as T
    if (method === 'DOM.setFileInputFiles') return {} as T
    if (method === 'DOM.resolveNode') {
      if (this.fileField === null) throw new Error('No node with given id found')
      return { object: { type: 'object', objectId: 'file-field' } } as T
    }
    if (method === 'Runtime.callFunctionOn' && params?.objectId === 'file-field') return { result: { value: this.fileField } } as T
    if (method === 'Runtime.getProperties') {
      return { result: this.collectedElements.map((_, index) => ({ name: String(index), value: { type: 'object', objectId: `ref:${index}` } })) } as T
    }
    if (method === 'Accessibility.getPartialAXTree') {
      const index = Number(String(params?.objectId).slice('ref:'.length))
      if (this.axException !== null) throw new Error(this.axException)
      if (this.axGone.has(index)) throw new Error('Could not find object with given id')
      const node = this.axNodes.get(index)
      return { nodes: node === undefined ? [] : [node] } as T
    }
    if (method === 'Runtime.releaseObjectGroup') return {} as T
    if (method === 'Runtime.evaluate') {
      const expression = typeof params?.expression === 'string' ? params.expression : ''
      if (expression.includes('/* REF_HANDLES */')) return { result: this.noRegistry ? { type: 'undefined' } : { type: 'object', objectId: 'registry' } } as T
      if (expression.includes('/* READY_ARM */')) {
        this.readyArmed += 1
        return { result: { value: true } } as T
      }
      if (expression.includes('/* READY_WAIT */')) {
        this.readyWaited += 1
        if (this.readyHangs) return new Promise<T>(() => {})
        return { result: { value: this.readyOutcome } } as T
      }
      if (expression.includes('/* FLASH_REF */')) return { result: { value: true } } as T
      if (expression.includes('/* FRAME_BOX */')) return { result: { value: this.frameBox } } as T
      if (expression.includes('__bingbongDialogOpen')) return { result: { value: this.dialogOpenValues.length > 0 ? this.dialogOpenValues.shift() : false } } as T
      if (expression.includes('/* CLEAR_FOCUSED */')) return { result: { value: 'input[text]' } } as T
      if (expression.includes('/* SELECT_FIELD */')) return { result: { value: true } } as T
      if (expression.includes('/* SEARCH_SUBMIT */')) return { result: { value: this.searchSubmit } } as T
      if (this.evaluateException) return { exceptionDetails: { text: this.evaluateException } } as T
      if (expression === COLLECT_EXPRESSION && this.collectException) {
        return { exceptionDetails: { text: this.collectException } } as T
      }
      if (expression === COLLECT_EXPRESSION && this.collectFailures > 0) {
        this.collectFailures -= 1
        return {
          exceptionDetails: {
            text: 'Uncaught',
            exception: { description: 'TypeError: Cannot read properties of null (reading \'getBoundingClientRect\')' },
          },
        } as T
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
      if (expression.includes('__bingbongMarkShownAt')) {
        const indices = JSON.parse(/__bingbongMarkShownAt\((\[[^)]*\])\)/.exec(expression)?.[1] ?? '[]') as number[]
        this.shownElements = []
        for (const index of indices) this.shownElements[index] = this.collectedElements[index]
        return { result: { value: true } } as T
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
      if (expression.includes('/* MEDIA_OP */')) return { result: { value: this.mediaOpResult } } as T
      if (expression.includes('/* PAGE_LINKS */')) return { result: { value: this.pageLinks } } as T
      if (expression.includes('/* DIALOG_LABELS */')) {
        if (this.dialogLabelsException) return { exceptionDetails: { text: this.dialogLabelsException } } as T
        const page = this.evaluateValue as CollectedPage
        const labels = page.dialogOpen ? page.elements.filter((element) => element.layer === 'dialog').map((element) => element.label) : null
        return { result: { value: labels } } as T
      }
      // Before the grounding probe below: the blur's own hit test reads the same way.
      if (expression.includes('/* BLUR_FOCUSED_FIELD */')) {
        this.blurs.push(registryIndexOf(expression))
        if (!this.focusedFieldPopup) return { result: { value: false } } as T
        this.focusedFieldPopup = false
        this.prepCovered = false
        return { result: { value: true } } as T
      }
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
      if (expression.includes('/* LINK_ADDRESS */')) {
        if (this.linkAddress !== undefined) return { result: { value: this.linkAddress } } as T
        const element = this.collectedElements[registryIndexOf(expression)] as { href?: string | null } | undefined
        return { result: { value: element?.href ?? null } } as T
      }
      if (expression.includes('/* CONSENT_RETRY_KEEP */')) {
        this.keptNode = this.collectedElements[registryIndexOf(expression)]
        return { result: { value: true } } as T
      }
      if (expression.includes('/* CONSENT_RETRY_FIND */')) {
        const index = this.keptNode === undefined ? -1 : this.collectedElements.indexOf(this.keptNode)
        this.keptNode = undefined
        return { result: { value: index } } as T
      }
      if (expression.includes('__bingbongRefs')) {
        if (expression.includes('.click()')) {
          this.onDomClick?.()
          return { result: { value: { clicked: true } } } as T
        }
        if (this.prepStaleOnce) {
          this.prepStaleOnce = false
          return { result: { value: { ok: false } } } as T
        }
        const index = registryIndexOf(expression)
        if (index === 20) {
          return { result: { value: { ok: true, clickable: true, x: 350, y: 230 } } } as T
        }
        const snapshot = buildPageSnapshot(this.evaluateValue as CollectedPage)
        const target = snapshot.refs[index]
        if (!target) return { result: { value: { ok: false } } } as T
        // Offscreen: scrollIntoView could not bring the element into the
        // viewport at all — no coordinates, no hit-test.
        if (this.prepOffscreen) return { result: { value: { ok: true, clickable: false } } } as T
        if (this.prepBlankCover) {
          const centre = clickPoint(target, snapshot.viewport)
          return { result: { value: { ok: true, clickable: false, blankCover: true, coveredCentre: centre, ...centre } } } as T
        }
        // Mirror the in-page prep math: fresh clickPoint, hit-test result set by the test.
        const covered = this.prepCovered || this.prepCoveredTimes > 0
        if (this.prepCoveredTimes > 0) this.prepCoveredTimes -= 1
        const point = clickPoint(target, snapshot.viewport)
        return { result: { value: { ok: true, clickable: !covered, ...(covered ? { blocked: this.prepBlocked, coveredCentre: point } : {}), ...point } } } as T
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
    // The real collector returns exactly its registry (#377): an element no ref can name is never in the payload.
    const elements = page.elements.filter((element) => refable(element, page.viewport)).map((element) => {
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
  /** Runs on every load — the page the tab lands on starts being served. */
  onLoad: ((url: string) => void) | null = null
  /**
   * What the next watch an action takes will see (#309): an answer, or a
   * pending one the test settles. Null: the driver cannot watch, as a
   * driver without `watchArrival` cannot.
   */
  nextArrival: Promise<PageArrival> | PageArrival | null = null
  watches = 0
  arrivalsAsked = 0

  async loadUrl(url: string): Promise<void> {
    this.loadedUrls.push(url)
    this.onLoad?.(url)
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

  reloaded = 0

  async reload(): Promise<void> {
    this.reloaded += 1
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

  /** Who hears a commit (#324). */
  private readonly commitHandlers = new Set<() => void>()
  get commitListeners(): number {
    return this.commitHandlers.size
  }

  onNavigationCommitted(listener: () => void): () => void {
    this.commitHandlers.add(listener)
    return () => this.commitHandlers.delete(listener)
  }

  /** The next load commits: every listener hears it as the load starts. */
  commit(): void {
    const previous = this.onLoad
    this.onLoad = (url) => {
      for (const handler of [...this.commitHandlers]) handler()
      this.onLoad = previous
      previous?.(url)
    }
  }

  watchArrival(): ArrivalWatch {
    this.watches += 1
    const next = this.nextArrival
    return {
      arrival: async () => {
        this.arrivalsAsked += 1
        return next ?? 'none'
      },
    }
  }
}

/** A pending page arrival the test settles (#309). */
function pendingArrival(): { promise: Promise<PageArrival>; settle: (arrival: PageArrival) => void } {
  let settle: (arrival: PageArrival) => void = () => {}
  const promise = new Promise<PageArrival>((resolve) => (settle = resolve))
  return { promise, settle }
}

/** A clock whose every timer fires on the next tick: waits cost nothing, order is kept. */
function instantClock(): Clock {
  return {
    now: () => 0,
    setTimer: (_ms, fn) => {
      const handle = setTimeout(fn, 0)
      return () => clearTimeout(handle)
    },
  }
}

function makeController(options?: {
  cdp?: FakeCdp
  page?: FakePage
  popupBlocks?: string[]
  authPopupOpens?: string[]
  subspans?: BrowserSubspans
  clock?: Clock
  effects?: ActionEffects
  chooseConsent?: ConsentChooser
  frames?: PageFrames
  siteQuestions?: SiteQuestionDesk
  leaving?: () => boolean
}) {
  const cdp = options?.cdp ?? new FakeCdp()
  const page = options?.page ?? new FakePage()
  const popupQueue = options?.popupBlocks ? [...options.popupBlocks] : []
  const authQueue = options?.authPopupOpens ? [...options.authPopupOpens] : []
  /** What the pane's hold saw: taken at a click's start, released at its end. */
  const holds = { taken: 0, released: 0 }
  /** What the native context menu's hold saw (#363): taken around a right-click, released after it. */
  const menuHolds = { taken: 0, released: 0 }
  const controller = createCdpBrowserController({
    cdp,
    page,
    collectScript: '/* COLLECT */',
    // The readiness cap and the landing poll run on an instant clock unless
    // a test brings its own (the cap is pinned on a FakeClock, #324).
    clock: options?.clock ?? instantClock(),
    ...(options?.effects ? { effects: options.effects } : {}),
    ...(options?.frames ? { frames: options.frames } : {}),
    consumePopupBlocks: () => popupQueue.splice(0),
    consumeAuthPopupOpens: () => authQueue.splice(0),
    holdWindowOpens: () => {
      holds.taken += 1
      return () => {
        holds.released += 1
      }
    },
    holdContextMenu: () => {
      menuHolds.taken += 1
      return () => {
        menuHolds.released += 1
      }
    },
    ...(options?.subspans ? { subspans: options.subspans } : {}),
    ...(options?.chooseConsent ? { chooseConsent: options.chooseConsent } : {}),
    ...(options?.siteQuestions ? { siteQuestions: options.siteQuestions } : {}),
    ...(options?.leaving ? { leaving: options.leaving } : {}),
  })
  return { cdp, page, controller, popupQueue, holds, menuHolds }
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

describe('a page still loading (#330)', () => {
  /** A driver whose navigation is under way, from each `start` until the test lands or fails it. */
  function loadingPage(): { page: FakePage; land: () => void; fail: (error: Error) => void; stops: () => number; start: () => void } {
    const page = new FakePage()
    let pending: Promise<void> | null = null
    let land: () => void = () => {}
    let fail: (error: Error) => void = () => {}
    let stops = 0
    const start = (): void => {
      pending = new Promise<void>((resolve, reject) => {
        land = () => {
          pending = null
          resolve()
        }
        fail = reject
      })
    }
    start()
    Object.assign(page, {
      untilLanded: () => pending ?? Promise.resolve(),
      stop: () => {
        stops += 1
      },
    })
    return { page, land: () => land(), fail: (error) => fail(error), stops: () => stops, start }
  }

  it('aims a click given during a navigation at the page it lands on: nothing reaches the page before', async () => {
    const { page, land, start } = loadingPage()
    const { cdp, controller } = makeController({ page })
    land()
    await showRefs(controller)
    start()
    const sent = cdp.calls.length
    const clicked = controller.click(3)
    await flushMicrotasks()
    expect(cdp.calls.slice(sent).some((call) => call.method === 'Runtime.evaluate')).toBe(false)
    land()
    await expect(clicked).resolves.toMatch(/^clicked \[3\]/)
  })

  it('reads the page once its navigation has landed, and touches nothing before', async () => {
    const { page, land } = loadingPage()
    const { cdp, controller } = makeController({ page })
    let read: string | undefined
    void controller.readPage().then((text) => (read = text))
    await flushMicrotasks()
    expect(cdp.calls.some((call) => call.method === 'Runtime.evaluate')).toBe(false)
    land()
    await flushMicrotasks()
    expect(read).toContain('# YouTube — https://www.youtube.com/')
  })

  it('collects the page a Command is read against the same way', async () => {
    const { page, land } = loadingPage()
    const { cdp, controller } = makeController({ page })
    const collected = controller.collectPage()
    await flushMicrotasks()
    expect(cdp.calls.some((call) => call.method === 'Runtime.evaluate')).toBe(false)
    land()
    await expect(collected).resolves.toMatchObject({ url: 'https://www.youtube.com/' })
  })

  it('fails a read with the reason when the navigation never commits', async () => {
    const { page, fail } = loadingPage()
    const { controller } = makeController({ page })
    const read = controller.readPage()
    fail(new Error('the page is still loading: it has not answered in 30 s'))
    await expect(read).rejects.toThrow('the page is still loading')
  })

  it('stops the tab loading', async () => {
    const { page, stops } = loadingPage()
    const { controller } = makeController({ page })
    await controller.stop()
    expect(stops()).toBe(1)
  })
})

describe('createCdpBrowserController Ref State', () => {
  afterEach(() => setFaultSink(null))

  const page: CollectedPage = {
    url: 'https://www.youtube.com/watch?v=PCXpGeKKW1k',
    title: 'Highs and Lows',
    viewport: { width: 1280, height: 800, scrollY: 0, scrollHeight: 800 },
    elements: [
      { tag: 'button', role: null, inputType: null, label: 'Pause (k)', rect: { x: 10, y: 10, width: 40, height: 40 } },
      { tag: 'button', role: null, inputType: null, label: 'Subtitles/closed captions unavailable', rect: { x: 60, y: 10, width: 40, height: 40 } },
      // Below the fold: never a ref, so never asked of the tree.
      { tag: 'button', role: null, inputType: null, label: 'Show more', rect: { x: 10, y: 2000, width: 40, height: 40 } },
    ],
  }
  const pressed: AxNode = { role: { type: 'role', value: 'button' }, properties: [{ name: 'pressed', value: { type: 'tristate', value: 'true' } }] }

  it("puts what the accessibility tree says of each ref on that ref, asking only of the refs, and lets the handles go", async () => {
    const cdp = new FakeCdp(page)
    cdp.axNodes.set(1, pressed)
    const { controller } = makeController({ cdp })
    const snapshot = await controller.collectPage()
    expect(snapshot.refs.map((ref) => [ref.label, ref.states])).toEqual([
      ['Pause (k)', undefined],
      ['Subtitles/closed captions unavailable', ['pressed=true']],
    ])
    expect(cdp.calls.filter((call) => call.method === 'Accessibility.getPartialAXTree').map((call) => call.params?.objectId)).toEqual(['ref:0', 'ref:1'])
    const methods = cdp.calls.map((call) => call.method)
    expect(methods.lastIndexOf('Runtime.releaseObjectGroup')).toBeGreaterThan(methods.lastIndexOf('Accessibility.getPartialAXTree'))
  })

  it('collects the page all the same when the tree cannot be read, and reports why', async () => {
    const faults: FaultReport[] = []
    setFaultSink((report) => faults.push(report))
    const cdp = new FakeCdp(page)
    cdp.axException = 'Cannot find context with specified id'
    const { controller } = makeController({ cdp })
    const snapshot = await controller.collectPage()
    expect(snapshot.refs.map((ref) => ref.label)).toEqual(['Pause (k)', 'Subtitles/closed captions unavailable'])
    expect(snapshot.refs.every((ref) => ref.states === undefined)).toBe(true)
    expect(faults.map((fault) => [fault.site, fault.message])).toEqual([['browser.readRefStates.refs', '2 of 2 refs unread: Cannot find context with specified id']])
  })

  it("keeps every other ref's state when one ref's node is gone, and says how many went unread", async () => {
    const faults: FaultReport[] = []
    setFaultSink((report) => faults.push(report))
    const cdp = new FakeCdp(page)
    cdp.axNodes.set(1, pressed)
    cdp.axGone.add(0)
    const { controller } = makeController({ cdp })
    const snapshot = await controller.collectPage()
    expect(snapshot.refs.map((ref) => ref.states)).toEqual([undefined, ['pressed=true']])
    expect(faults.map((fault) => [fault.site, fault.message])).toEqual([['browser.readRefStates.refs', '1 of 2 refs unread: Could not find object with given id']])
  })

  it('reports a page that holds no registry to read states for', async () => {
    const faults: FaultReport[] = []
    setFaultSink((report) => faults.push(report))
    const cdp = new FakeCdp(page)
    cdp.noRegistry = true
    const { controller } = makeController({ cdp })
    const snapshot = await controller.collectPage()
    expect(snapshot.refs).toHaveLength(2)
    expect(faults.map((fault) => fault.site)).toEqual(['browser.createCdpBrowserController.refStates'])
  })

})

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

  it('reads a long page in parts cut at block boundaries, counts them, and refuses one past the end (#235)', async () => {
    const textBlocks = Array.from({ length: 30 }, (_, index) => ({
      kind: 'text' as const,
      text: `${String(index).padStart(3, '0')} ${'w'.repeat(996)}`,
    }))
    const { controller } = makeController({ cdp: new FakeCdp({ ...youtubeFixture, textBlocks }) })

    // The navigate outcome carries the preview, and says it was cut.
    const landing = await controller.navigate('https://www.youtube.com/')
    expect(landing.endsWith("page text: first 1,800 of 30,029 characters — read_page returns the page's whole text in 3 parts")).toBe(true)

    expect(await controller.pageReadParts()).toBe(3)
    const first = await controller.readPage()
    expect(first).toContain('[3] input[search] "Search"')
    expect(first).toContain(`page text:\n${textBlocks[0]!.text}\n`)
    expect(first.endsWith(`${textBlocks[10]!.text}\npage text: part 1 of 3 — read_page part=2 continues`)).toBe(true)
    expect(await controller.readPage(2)).toContain(`page text:\n${textBlocks[11]!.text}\n`)
    await expect(controller.readPage(4)).rejects.toThrow("read_page: part 4 is past the end — this page's text has 3 parts, part=1 to part=3")
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

describe('createCdpBrowserController linkHrefs (#258)', () => {
  const LONG = `https://example.com/${'long-result-address-'.repeat(15)}`

  it('lists the link refs’ whole hrefs off the snapshot the last result printed, without re-collecting', async () => {
    const cdp = new FakeCdp({ ...youtubeFixture, elements: [link('short'), { ...link('long'), href: LONG }] })
    const { controller } = makeController({ cdp })
    const printed = await controller.readPage()
    const collectsBefore = cdp.collectCalls().length

    const hrefs = await controller.linkHrefs()

    expect(printed).not.toContain(LONG)
    expect(hrefs).toEqual(['https://example.com/short', LONG])
    expect(cdp.collectCalls()).toHaveLength(collectsBefore)
  })

  it('re-collects after an action invalidated the snapshot', async () => {
    const { cdp, controller } = makeController()
    await showRefs(controller)
    await controller.click(1)
    const collectsBefore = cdp.collectCalls().length

    const hrefs = await controller.linkHrefs()

    expect(cdp.collectCalls()).toHaveLength(collectsBefore + 1)
    expect(hrefs).not.toBeNull()
  })
})

describe('createCdpBrowserController pageLinks (#303)', () => {
  const LONG = `https://example.com/${'long-result-address-'.repeat(15)}`

  it('lists the links of the whole page in place: hrefs whole, labels cut as a ref’s are, and no collect', async () => {
    const { cdp, controller } = makeController()
    await controller.readPage()
    const collectsBefore = cdp.collectCalls().length
    cdp.pageLinks = {
      url: youtubeFixture.url,
      links: [{ label: 'Objects', href: 'https://example.com/collections/object' }, { label: 'x'.repeat(120), href: LONG }, { label: 'no address', href: '' }, 'not a link'],
    }

    const links = await controller.pageLinks()

    expect(links).toEqual([
      { label: 'Objects', href: 'https://example.com/collections/object' },
      { label: `${'x'.repeat(79)}…`, href: LONG },
    ])
    expect(cdp.collectCalls()).toHaveLength(collectsBefore)
  })

  it('answers null for a page that cannot be read: no helper, links that are no list, an evaluation that throws', async () => {
    const { cdp, controller } = makeController()
    await controller.readPage()
    expect(await controller.pageLinks()).toBeNull()
    cdp.pageLinks = { url: youtubeFixture.url, links: 'none' }
    expect(await controller.pageLinks()).toBeNull()
    cdp.evaluateException = 'Execution context was destroyed'
    expect(await controller.pageLinks()).toBeNull()
  })

  it('answers null for a page that is not the one the last result printed: its links are another page’s', async () => {
    const { cdp, controller } = makeController()
    const links = [{ label: 'Objects', href: 'https://example.com/collections/object' }]
    // No page was printed yet.
    cdp.pageLinks = { url: youtubeFixture.url, links }
    expect(await controller.pageLinks()).toBeNull()
    await controller.readPage()
    expect(await controller.pageLinks()).toEqual(links)
    // The tab moved on since, by a redirect or a route change.
    cdp.pageLinks = { url: 'https://example.com/elsewhere', links }
    expect(await controller.pageLinks()).toBeNull()
  })

  it('answers an empty list for a page that holds no link', async () => {
    const { cdp, controller } = makeController()
    await controller.readPage()
    cdp.pageLinks = { url: youtubeFixture.url, links: [] }
    expect(await controller.pageLinks()).toEqual([])
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

  it('opens a ref\'s menu with the right button at its centre, the native menu held back for it (#363)', async () => {
    const { cdp, controller, menuHolds } = makeController()
    await controller.readPage()

    const outcome = await controller.openMenu(3)

    const input = cdp.inputCalls()
    expect(input.map((call) => call.params?.type)).toEqual(['mouseMoved', 'mousePressed', 'mouseReleased'])
    expect(input[1]?.params).toMatchObject({ x: 654, y: 32, button: 'right', buttons: 2, clickCount: 1 })
    expect(input[2]?.params).toMatchObject({ x: 654, y: 32, button: 'right', buttons: 0 })
    expect(menuHolds).toEqual({ taken: 1, released: 1 })
    // Nothing drawn: the right-click consumed nothing, as an inert click.
    expect(outcome).toBe('menu [3]: urlChanged=false dialogOpen=false; no observable change')
    expect(blockedOrInertAction(outcome)).toBe('inert')
  })

  it('reports a menu that drew options as a changed page, and a covered target as blocked (#363)', async () => {
    const cdp = new FakeCdp()
    const target = buildPageSnapshot(youtubeFixture).refs[2]!
    const probe = probeFor(youtubeFixture, { checked: target.checked ?? null, selectedOption: target.selectedOption ?? null, value: target.value ?? null, ariaPressed: target.ariaPressed ?? null, className: target.className ?? '' }) as { target: unknown; signature: { refCount: number } }
    cdp.actionProbe = { ...probe, signature: { ...probe.signature, refCount: probe.signature.refCount + 2 } }
    const { controller } = makeController({ cdp })
    await showRefs(controller)
    const opened = await controller.openMenu(3)
    expect(opened.split('\n')[0]).toBe('menu [3]: urlChanged=false dialogOpen=false; page signature changed')
    expect(blockedOrInertAction(opened)).toBeNull()

    const covered = new FakeCdp()
    covered.prepCovered = true
    const blocked = makeController({ cdp: covered })
    await showRefs(blocked.controller)
    expect(blockedOrInertAction(await blocked.controller.openMenu(3))).toBe('covered')
    expect(covered.inputCalls().filter((call) => call.params?.type === 'mousePressed')).toEqual([])
  })

  describe('a Media Op (#372, ADR 0080): one evaluate on the media ref\'s own element', () => {
    const facts = { paused: false, ended: false, currentTime: 16.2, duration: 111, volume: 1, muted: false, loop: false, rate: 1, seekable: { start: 0, end: 111 }, tracks: 0, captions: null, hiddenTrack: false, buffering: false, failed: false }

    it('evaluates the op on the registry node the number names — no mouse, no collect — and tells what changed from the element\'s facts before and after', async () => {
      const { cdp, controller } = makeController()
      await showRefs(controller)
      cdp.mediaOpResult = { before: facts, after: { ...facts, currentTime: 26.2 } }
      const collects = cdp.collectCalls().length

      const outcome = await controller.mediaOp(14, { op: 'forward', seconds: 10 })

      const evaluates = cdp.calls.filter((call) => call.method === 'Runtime.evaluate' && String(call.params?.expression ?? '').includes('/* MEDIA_OP */'))
      expect(evaluates).toHaveLength(1)
      // The fixture's video is ref 14: registry index 13, and the op as given.
      expect(String(evaluates[0]!.params?.expression)).toContain('[13]')
      expect(String(evaluates[0]!.params?.expression)).toContain('{"op":"forward","seconds":10}')
      expect(cdp.inputCalls()).toHaveLength(0)
      expect(cdp.collectCalls()).toHaveLength(collects)
      expect(outcome).toBe('forward [14]: 0:16 → 0:26')
      expect(blockedOrInertAction(outcome)).toBeNull()
    })

    it('says an op that changed nothing changed nothing, as an inert click does: mute on a muted element', async () => {
      const { cdp, controller } = makeController()
      await showRefs(controller)
      cdp.mediaOpResult = { before: { ...facts, muted: true }, after: { ...facts, muted: true } }
      const outcome = await controller.mediaOp(14, { op: 'mute' })
      expect(outcome).toBe('mute [14]: no observable change')
      expect(blockedOrInertAction(outcome)).toBe('inert')
    })

    it('refuses a number the model was never shown, and an element that is no video or audio', async () => {
      const { cdp, controller } = makeController()
      await showRefs(controller)
      await expect(controller.mediaOp(999, { op: 'pause' })).rejects.toThrow(/ref 999 refused/)
      cdp.mediaOpResult = null
      await expect(controller.mediaOp(3, { op: 'pause' })).rejects.toThrow('ref 3 is no video or audio element')
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

  it('reports a Covered click instead of clicking through', async () => {
    const cdp = new FakeCdp()
    cdp.prepCovered = true
    const { controller } = makeController({ cdp })
    await controller.readPage()

    const outcome = await controller.click(3)

    // Nothing reaches the page: no synthetic input, no direct activation —
    // the interception is reported for the model to decide.
    expect(outcome).toBe('clicked [3]: not clicked — covered by an unlabelled <div>')
    expect(cdp.inputCalls()).toHaveLength(0)
    expect(
      cdp.calls.some(
        (call) => call.method === 'Runtime.evaluate' && typeof call.params?.expression === 'string' && call.params.expression.includes('.click()'),
      ),
    ).toBe(false)
  })

  it('blurs a focused field whose popup covers the target, re-arms the watch, and clicks it (DuckDuckGo\'s suggestions, 2026-10-18)', async () => {
    const cdp = new FakeCdp()
    cdp.prepCovered = true
    cdp.focusedFieldPopup = true
    const { controller } = makeController({ cdp })
    await controller.readPage()
    const evaluates = (marker: string): number[] =>
      cdp.calls.flatMap((call, i) => (call.method === 'Runtime.evaluate' && String(call.params?.expression ?? '').includes(marker) ? [i] : []))
    const armsBefore = evaluates('/* READY_ARM */').length

    const outcome = await controller.click(3)

    expect(outcome).toMatch(/^clicked \[3\]/)
    expect(outcome).not.toContain('covered')
    expect(cdp.blurs).toEqual([2])
    expect(cdp.inputCalls().length).toBeGreaterThan(0)
    // Armed again after the blur, so the popup closing is never read as the click's effect.
    const blurAt = evaluates('/* BLUR_FOCUSED_FIELD */')[0]!
    expect(evaluates('/* READY_ARM */').slice(armsBefore).some((at) => at > blurAt)).toBe(true)
  })

  it('reports the Covered click as before when no field\'s popup was the cover', async () => {
    const cdp = new FakeCdp()
    cdp.prepCovered = true
    const { controller } = makeController({ cdp })
    await controller.readPage()

    expect(await controller.click(3)).toBe('clicked [3]: not clicked — covered by an unlabelled <div>')
    expect(cdp.blurs).toEqual([2])
    expect(cdp.inputCalls()).toHaveLength(0)
  })

  it('reports the open dialog alongside a Covered click', async () => {
    const wall = { ...signInDialogPage(), elements: [...signInDialogPage().elements, consentWallPage().elements[2]!] }
    const cdp = new FakeCdp(wall)
    cdp.prepCovered = true
    const { controller } = makeController({ cdp })
    await showRefs(controller)

    // The covered target is the page-level button behind a Tier-2 dialog,
    // which no dismissal touches.
    const outcome = await controller.click(3)

    expect(outcome).toBe(
      'clicked [3]: not clicked — covered by an unlabelled <div>; dialog open: "Opened dialog"; controls: [1] button "Sign in", [2] button "Not now"',
    )
    expect(outcome).not.toContain('dismissed consent dialog')
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

  it('activates directly, no mouse pressed, when what covers the whole target paints nothing (a Blank Cover)', async () => {
    const cdp = new FakeCdp()
    cdp.prepBlankCover = true
    const { controller } = makeController({ cdp })
    await controller.readPage()

    const outcome = await controller.click(3)

    expect(outcome).toBe(
      'clicked [3]: urlChanged=false dialogOpen=false; no observable change; activated directly (what covers it paints nothing)',
    )
    expect(outcome).not.toContain('not clicked')
    const domClick = cdp.calls.find(
      (call) => call.method === 'Runtime.evaluate' && typeof call.params?.expression === 'string' && call.params.expression.includes('.click()'),
    )
    expect(domClick?.params?.expression).toContain('__bingbongRefs')
    expect(cdp.calls.some((call) => call.method === 'Input.dispatchMouseEvent')).toBe(false)
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

  it('focuses the ref with a click, then inserts the text whole with Input.insertText (#324)', async () => {
    const { cdp, controller } = makeController()
    await showRefs(controller)

    await controller.type(3, 'hi there')

    expect(cdp.calls.filter((call) => call.method === 'Input.insertText').map((call) => call.params)).toEqual([{ text: 'hi there' }])
    expect(cdp.calls.filter((call) => call.method === 'Input.dispatchKeyEvent')).toEqual([])
  })

  it('focuses the target before typing', async () => {
    const { cdp, controller } = makeController()
    await showRefs(controller)

    await controller.type(3, 'hi')

    const mouse = cdp.inputCalls()
    expect(mouse[0]?.params).toMatchObject({ type: 'mouseMoved', x: 654, y: 32 })
    expect(mouse[1]?.params).toMatchObject({ type: 'mousePressed' })
    expect(mouse[2]?.params).toMatchObject({ type: 'mouseReleased' })
    // Focus click happens before the insert.
    expect(cdp.calls.findIndex((call) => call.method === 'Input.insertText')).toBeGreaterThan(
      cdp.calls.findIndex((call) => call.params?.type === 'mouseReleased'),
    )
  })

  it('maps newline to an Enter key event between the inserted runs', async () => {
    const { cdp, controller } = makeController()
    await showRefs(controller)

    await controller.type(3, 'a\nb')

    const input = cdp.inputCalls().filter((call) => call.method !== 'Input.dispatchMouseEvent')
    expect(input.map((call) => [call.method, call.params?.text ?? call.params?.key])).toEqual([
      ['Input.insertText', 'a'],
      ['Input.dispatchKeyEvent', '\r'],
      ['Input.dispatchKeyEvent', 'Enter'],
      ['Input.insertText', 'b'],
    ])
    expect(input[1]?.params).toMatchObject({ type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
  })

  it('refuses a number the model was never shown', async () => {
    const { controller } = makeController()
    await showRefs(controller)

    await expect(controller.type(999, 'nope')).rejects.toThrow(/ref 999 refused/)
  })

  /** The inputs after the focusing click, as method and text or key. */
  const keyedAfterClick = (cdp: FakeCdp) => cdp.inputCalls().filter((call) => call.method !== 'Input.dispatchMouseEvent').map((call) => [call.method, call.params?.text ?? call.params?.key])

  it('selects what the field holds before inserting, so typing replaces it and never appends (#398)', async () => {
    const { cdp, controller } = makeController()
    await showRefs(controller)

    await controller.type(3, 'cats')

    const select = cdp.calls.findIndex((call) => call.method === 'Runtime.evaluate' && String(call.params?.expression ?? '').includes('/* SELECT_FIELD */'))
    expect(select).toBeGreaterThan(cdp.calls.findIndex((call) => call.params?.type === 'mouseReleased'))
    expect(select).toBeLessThan(cdp.calls.findIndex((call) => call.method === 'Input.insertText'))
  })

  it('submits a Search Op with Enter after the words (#398): the one submit every kind of box honours', async () => {
    const { cdp, controller } = makeController()
    await showRefs(controller)

    await controller.type(3, 'MKBHD', { submit: true })

    expect(keyedAfterClick(cdp)).toEqual([
      ['Input.insertText', 'MKBHD'],
      ['Input.dispatchKeyEvent', '\r'],
      ['Input.dispatchKeyEvent', 'Enter'],
    ])
  })

  it("waits past the words' own effect for the navigation a Search Op's Enter starts (#398)", async () => {
    // The watch sees no navigation started on its first asks — the suggestions the words drew ended the readiness wait — then the landing.
    const page = new FakePage()
    let asks = 0
    page.watchArrival = () => ({ arrival: async () => (++asks < 3 ? 'none' : 'loaded') })
    const { controller } = makeController({ page })
    await showRefs(controller)

    const outcome = await controller.type(3, 'MKBHD', { submit: true })

    expect(asks).toBe(3)
    expect(outcome).toContain(ARRIVED_CLAUSE)
  })

  it('ends the wait at its bound for a box that searches in place, and a plain type never waits on it (#398)', async () => {
    const page = new FakePage()
    const { controller } = makeController({ page })
    await showRefs(controller)

    await controller.type(3, 'MKBHD', { submit: true })
    expect(page.arrivalsAsked).toBe(1 + SUBMIT_START_MS / 50 + 1)

    page.arrivalsAsked = 0
    await controller.type(3, 'cats')
    expect(page.arrivalsAsked).toBe(1)
  })

  it('presses no Enter when the box\'s form would ignore it and the page submitted the form itself (#398)', async () => {
    const { cdp, controller } = makeController()
    cdp.searchSubmit = 'form'
    await showRefs(controller)

    await controller.type(3, 'MKBHD', { submit: true })

    expect(keyedAfterClick(cdp)).toEqual([['Input.insertText', 'MKBHD']])
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
  /** A wall whose reject the rule cannot read: Accept all beside Continue without accepting. */
  function unreadRejectWall(): CollectedPage {
    const wall = consentWallPage()
    return { ...wall, elements: [wall.elements[0]!, { ...dialogButton('Continue without accepting') } as CollectedElement, wall.elements[2]!] }
  }

  it('asks Jev for the reject when the rule reads none as declining, and clicks the one it finds (owner\'s rule 2026-10-19)', async () => {
    const wall = unreadRejectWall()
    const cleared = { ...wall, dialogOpen: false, dialogText: '', elements: wall.elements.slice(2) }
    const cdp = new FakeCdp(cleared)
    cdp.collectValues = [wall, cleared]
    const asked: (readonly string[])[] = []
    const { controller } = makeController({
      cdp,
      chooseConsent: async (_text, labels) => {
        asked.push(labels)
        return 1
      },
    })
    const text = await controller.readPage()
    expect(asked).toEqual([['Accept all', 'Continue without accepting']])
    expect(text.startsWith('dismissed consent dialog: clicked [2] "Continue without accepting"')).toBe(true)
  })

  it('accepts as before when Jev finds no reject; a wall the rule reads still asks Jev first, its reject the fallback (ADR 0089)', async () => {
    const wall = unreadRejectWall()
    const cleared = { ...wall, dialogOpen: false, dialogText: '', elements: wall.elements.slice(2) }
    const cdp = new FakeCdp(cleared)
    cdp.collectValues = [wall, cleared]
    const { controller } = makeController({ cdp, chooseConsent: async () => null })
    expect((await controller.readPage()).startsWith('dismissed consent dialog: clicked [1] "Accept all"')).toBe(true)

    const ruled = consentWallPage()
    const ruledCleared = { ...ruled, dialogOpen: false, dialogText: '', elements: ruled.elements.slice(2) }
    const ruledCdp = new FakeCdp(ruledCleared)
    ruledCdp.collectValues = [ruled, ruledCleared]
    let asks = 0
    const { controller: ruledController } = makeController({
      cdp: ruledCdp,
      chooseConsent: async () => {
        asks += 1
        return null
      },
    })
    expect((await ruledController.readPage()).startsWith('dismissed consent dialog: clicked [2] "Reject all"')).toBe(true)
    expect(asks).toBe(1)
  })

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

  it('dismisses a consent wall met on navigate before the listing, and classifies Blockers behind it (#263, ADR 0061)', async () => {
    const wall = consentWallPage()
    const cleared = { ...wall, dialogOpen: false, dialogText: '', elements: wall.elements.slice(2) }
    const cdp = new FakeCdp(cleared)
    cdp.collectValues = [wall, cleared]
    const { controller } = makeController({ cdp })

    const outcome = await controller.navigate('youtube.com')

    expect(outcome).toBe(
      `navigated: url=https://www.youtube.com/ title="YouTube"\ndismissed consent dialog: clicked [2] "Reject all"\n${settledBlock(cleared)}`,
    )
    expect(cdp.collectCalls()).toHaveLength(2)
    // The Blocker classifier reads the page behind the wall, with no second collect.
    expect((await controller.pageFacts()).dialogText).toBe('')
    expect(cdp.collectCalls()).toHaveLength(2)
  })

  it('collects the page behind a dismissed wall as a landing, and says so when it cannot be read (#308)', async () => {
    const wall = consentWallPage()
    const cleared = { ...wall, dialogOpen: false, dialogText: '', elements: wall.elements.slice(2) }
    const cdp = new FakeCdp(cleared)
    cdp.collectValues = [wall]
    // The dismissal sends the page on: the next two collections throw.
    cdp.onDomClick = () => {
      cdp.collectFailures = 2
    }
    const { controller } = makeController({ cdp })

    const outcome = await controller.navigate('youtube.com')

    expect(outcome).toBe(
      `navigated: url=https://www.youtube.com/ title="YouTube"\ndismissed consent dialog: clicked [2] "Reject all"\n${PAGE_NOT_READ}`,
    )
    expect(cdp.collectCalls()).toHaveLength(3)
  })

  it('leaves a Tier-2 dialog met on navigate open and listed', async () => {
    const cdp = new FakeCdp(signInDialogPage())
    const { controller } = makeController({ cdp })

    const outcome = await controller.navigate('youtube.com')

    expect(outcome).not.toContain('dismissed consent dialog')
    expect(outcome).toContain('dialog open: "Opened dialog"')
    expect((await controller.pageFacts()).dialogText).toBe('Opened dialog')
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

/**
 * A consent wall that arrives over a shown page (ADR 0061): its two controls
 * first, then the very element objects of the page — the same DOM nodes,
 * renumbered by the wall's controls above them.
 */
function walledOver(page: CollectedPage): CollectedPage {
  const wall = consentWallPage()
  return { ...page, dialogOpen: true, dialogText: wall.dialogText, elements: [...wall.elements.slice(0, 2), ...page.elements] }
}

describe('createCdpBrowserController a blocked action under a consent wall (#263, ADR 0061)', () => {
  /** The shown page, then a wall arriving over it that its dismissal takes away. */
  function wallArrives() {
    const cdp = new FakeCdp(youtubeFixture)
    const { controller } = makeController({ cdp })
    return {
      cdp,
      controller,
      async arrive() {
        await showRefs(controller)
        cdp.serve(walledOver(youtubeFixture))
        cdp.onDomClick = () => cdp.serve(youtubeFixture)
      },
    }
  }

  const domClicks = (cdp: FakeCdp) =>
    cdp.calls.filter((call) => call.method === 'Runtime.evaluate' && typeof call.params?.expression === 'string' && call.params.expression.includes('.click()'))
  const preps = (cdp: FakeCdp) =>
    cdp.calls.filter((call) => call.method === 'Runtime.evaluate' && typeof call.params?.expression === 'string' && call.params.expression.includes('scrollIntoView'))

  it('dismisses once and retries the click on the same node, under the ref the model named', async () => {
    const { cdp, controller, arrive } = wallArrives()
    await arrive()
    cdp.prepCoveredTimes = 1

    const outcome = await controller.click(3)

    expect(outcome.split('\n')[0]).toBe(
      'clicked [3]: urlChanged=false dialogOpen=false; no observable change; dismissed consent dialog: clicked [2] "Reject all" (it covered [3]; retried)',
    )
    expect(blockedOrInertAction(outcome)).toBeNull()
    // The dismissal pressed the wall's reject control in the walled collect.
    expect(domClicks(cdp)).toHaveLength(1)
    expect(domClicks(cdp)[0]!.params?.expression).toContain('(window.__bingbongRefs || [])[1]')
    // The first attempt aimed at index 2; the retry aimed at the same node,
    // wherever the post-dismissal collect put it.
    expect(preps(cdp).map((call) => registryIndexOf(String(call.params?.expression)))).toEqual([2, 2])
    expect(cdp.inputCalls().filter((call) => call.params?.type === 'mousePressed')).toHaveLength(1)
    // The post-dismissal listing rides the outcome.
    expect(outcome).toContain(settledBlock(youtubeFixture))
  })

  it('retries the node, not the number, when the page behind the wall renumbered', async () => {
    const { cdp, controller, arrive } = wallArrives()
    await arrive()
    const promo = link('Newly shown promo link')
    cdp.onDomClick = () => cdp.serve({ ...youtubeFixture, elements: [promo, ...youtubeFixture.elements] })
    cdp.prepCoveredTimes = 1

    await controller.click(3)

    expect(preps(cdp).map((call) => registryIndexOf(String(call.params?.expression)))).toEqual([2, 3])
  })

  it('dismisses once and retries the typing, reporting both steps in one line', async () => {
    const { cdp, controller, arrive } = wallArrives()
    await arrive()
    cdp.prepCoveredTimes = 1

    const outcome = await controller.type(3, 'longitude')

    expect(outcome.split('\n')[0]).toMatch(/^typed \[3\]: value=".*"; dismissed consent dialog: clicked \[2\] "Reject all" \(it covered \[3\]; retried\)$/)
    expect(outcome).toContain(settledBlock(youtubeFixture))
    expect(cdp.calls.filter((call) => call.method === 'Input.insertText').map((call) => call.params?.text)).toEqual(['longitude'])
    expect(domClicks(cdp)).toHaveLength(1)
  })

  it('reports a second block with the dismissal noted, and never dismisses twice', async () => {
    const { cdp, controller, arrive } = wallArrives()
    await arrive()
    cdp.prepCovered = true

    const outcome = await controller.type(3, 'longitude')

    expect(outcome.split('\n')[0]).toBe(
      'typed [3]: not typed — covered by an unlabelled <div>; dismissed consent dialog: clicked [2] "Reject all" (it covered [3]; retried, still blocked)',
    )
    expect(blockedOrInertAction(outcome)).toBe('covered')
    // The first prep names covers only by numbers still shown; the retry's,
    // whose outcome carries the post-dismissal listing, by any it lists.
    expect(preps(cdp).map((call) => /\(\w+ \|\| shown\[i\] === refs\[i\]\)/.exec(String(call.params?.expression))?.[0])).toEqual([
      '(false || shown[i] === refs[i])',
      '(true || shown[i] === refs[i])',
    ])
    expect(domClicks(cdp)).toHaveLength(1)
    expect(preps(cdp)).toHaveLength(2)
    expect(cdp.inputCalls()).toHaveLength(0)
    expect(outcome).toContain(settledBlock(youtubeFixture))
  })

  it('leaves a block under a Tier-2 dialog as it was: no collect renumbers the refs the model holds', async () => {
    const cdp = new FakeCdp(youtubeFixture)
    const { controller } = makeController({ cdp })
    await showRefs(controller)
    cdp.serve({ ...signInDialogPage(), elements: [...signInDialogPage().elements, ...youtubeFixture.elements] })
    cdp.prepCovered = true
    const collects = cdp.collectCalls().length

    const outcome = await controller.click(3)

    expect(outcome).toBe('clicked [3]: not clicked — covered by an unlabelled <div>')
    expect(cdp.collectCalls()).toHaveLength(collects)
    expect(domClicks(cdp)).toHaveLength(0)
  })

  it('keeps the block when clearing the wall fails, rather than failing the call', async () => {
    const { cdp, controller, arrive } = wallArrives()
    await arrive()
    cdp.prepCovered = true
    cdp.dialogLabelsException = 'Execution context was destroyed.'

    const outcome = await controller.type(3, 'longitude')

    expect(outcome).toBe('typed [3]: not typed — covered by an unlabelled <div>')
    expect(domClicks(cdp)).toHaveLength(0)
  })

  it('dismisses for a Not Shown target but never retries it, reporting both in one line (ADR 0062)', async () => {
    const { cdp, controller, arrive } = wallArrives()
    await arrive()
    cdp.prepCovered = true
    cdp.prepBlocked = { fact: 'notShown' }

    const outcome = await controller.click(3)

    expect(outcome.split('\n')[0]).toBe(
      'clicked [3]: not clicked — [3] is not shown: inside a hidden or inert container; dismissed consent dialog: clicked [2] "Reject all" (not retried)',
    )
    expect(blockedOrInertAction(outcome)).toBe('notShown')
    expect(domClicks(cdp)).toHaveLength(1)
    expect(preps(cdp)).toHaveLength(1)
    expect(cdp.inputCalls()).toHaveLength(0)
    // The wall left, so the page behind it rides the outcome.
    expect(outcome).toContain(settledBlock(youtubeFixture))
  })

  it('types into nothing for a Not Shown target under the wall, and says so the same way', async () => {
    const { cdp, controller, arrive } = wallArrives()
    await arrive()
    cdp.prepCovered = true
    cdp.prepBlocked = { fact: 'notShown' }

    const outcome = await controller.type(3, 'longitude')

    expect(outcome.split('\n')[0]).toBe(
      'typed [3]: not typed — [3] is not shown: inside a hidden or inert container; dismissed consent dialog: clicked [2] "Reject all" (not retried)',
    )
    expect(domClicks(cdp)).toHaveLength(1)
    expect(cdp.inputCalls()).toHaveLength(0)
  })

  it('leaves a block with no dialog open as it was: no collect, no dismissal', async () => {
    const cdp = new FakeCdp(youtubeFixture)
    const { controller } = makeController({ cdp })
    await showRefs(controller)
    cdp.prepCovered = true
    const collects = cdp.collectCalls().length

    const outcome = await controller.click(3)

    expect(outcome).toBe('clicked [3]: not clicked — covered by an unlabelled <div>')
    expect(cdp.collectCalls()).toHaveLength(collects)
    expect(domClicks(cdp)).toHaveLength(0)
  })
})

describe('createCdpBrowserController file choosers (#424)', () => {
  it('holds the chooser the page opened, its field read, until one take forgets it', async () => {
    const cdp = new FakeCdp()
    cdp.fileField = { multiple: true, accept: 'image/*', label: 'Photos' }
    const { controller } = makeController({ cdp })

    expect(await controller.takeFileChooser!()).toBeNull()
    cdp.emit('Page.fileChooserOpened', { backendNodeId: 42, frameId: 'top', mode: 'selectMultiple' })

    expect(await controller.takeFileChooser!()).toEqual({ node: 42, multiple: true, accept: 'image/*', label: 'Photos' })
    expect(cdp.calls).toContainEqual({ method: 'DOM.resolveNode', params: { backendNodeId: 42 } })
    expect(await controller.takeFileChooser!()).toBeNull()
  })

  it('reads the chooser\'s mode alone when its field is gone', async () => {
    const cdp = new FakeCdp()
    cdp.fileField = null
    const { controller } = makeController({ cdp })
    cdp.emit('Page.fileChooserOpened', { backendNodeId: 7, frameId: 'top', mode: 'selectSingle' })

    expect(await controller.takeFileChooser!()).toEqual({ node: 7, multiple: false, accept: '', label: '' })
  })

  it('sets the files on the field by its node, and nothing else is sent', async () => {
    const cdp = new FakeCdp()
    const { controller } = makeController({ cdp })
    const before = cdp.calls.length

    await controller.attachFiles!({ node: 42, multiple: false, accept: '', label: '' }, ['/shelf/invoice.pdf'])

    expect(cdp.calls.slice(before)).toEqual([{ method: 'DOM.setFileInputFiles', params: { files: ['/shelf/invoice.pdf'], backendNodeId: 42 } }])
  })
})

describe('createCdpBrowserController native dialogs and popups', () => {
  it('accepts an alert, tells its text for saying, and reports it on the next outcome (#423)', async () => {
    const cdp = new FakeCdp()
    const siteQuestions = createSiteQuestionDesk()
    const told: SiteQuestionEvent[] = []
    siteQuestions.subscribe((event) => told.push(event))
    const { controller } = makeController({ cdp, siteQuestions })
    await controller.readPage()

    cdp.emit('Page.javascriptDialogOpening', { type: 'alert', message: 'hello from alert' })

    const outcome = await controller.click(3)

    expect(outcome).toBe('clicked [3]: urlChanged=false dialogOpen=false; no observable change; native alert dialog accepted: "hello from alert"')
    expect(cdp.calls).toContainEqual({ method: 'Page.handleJavaScriptDialog', params: { accept: true } })
    expect(told).toEqual([{ type: 'alert', text: 'hello from alert' }])
  })

  it('raises a confirm as a Site Question and leaves it open until the user answers it (#423)', async () => {
    const cdp = new FakeCdp()
    const siteQuestions = createSiteQuestionDesk()
    const { controller } = makeController({ cdp, siteQuestions })
    await controller.readPage()

    cdp.emit('Page.javascriptDialogOpening', { type: 'confirm', message: 'Delete this video?' })

    expect(siteQuestions.open()).toEqual({ kind: 'confirm', text: 'Delete this video?' })
    expect(cdp.calls.filter((call) => call.method === 'Page.handleJavaScriptDialog')).toEqual([])
    await siteQuestions.answer(true)
    expect(cdp.calls).toContainEqual({ method: 'Page.handleJavaScriptDialog', params: { accept: true } })
    expect(await controller.click(3)).toContain('native confirm dialog answered OK by the user: "Delete this video?"')
  })

  it('closes the Site Question when the page closes its confirm itself', async () => {
    const cdp = new FakeCdp()
    const siteQuestions = createSiteQuestionDesk()
    makeController({ cdp, siteQuestions })

    cdp.emit('Page.javascriptDialogOpening', { type: 'confirm', message: 'Delete this video?' })
    cdp.emit('Page.javascriptDialogClosed', { result: false })

    expect(siteQuestions.open()).toBeNull()
  })

  it('refuses a confirm when no one can be asked, and reports native dialogs in order', async () => {
    const cdp = new FakeCdp()
    const { controller } = makeController({ cdp })
    await controller.readPage()

    cdp.emit('Page.javascriptDialogOpening', { type: 'confirm', message: 'first' })
    cdp.emit('Page.javascriptDialogOpening', { type: 'beforeunload', message: '' })

    const outcome = await controller.click(3)

    expect(cdp.calls).toContainEqual({ method: 'Page.handleJavaScriptDialog', params: { accept: false } })
    expect(outcome).toContain('native confirm dialog refused: "first"')
    expect(outcome).toContain('leave-page warning: the page stayed')
  })

  it('reports a leave-page warning met while a Command leaves the page as accepted (#423)', async () => {
    const cdp = new FakeCdp()
    const { controller } = makeController({ cdp, leaving: () => true })
    await controller.readPage()

    cdp.emit('Page.javascriptDialogOpening', { type: 'beforeunload', message: '' })

    expect(cdp.calls).toContainEqual({ method: 'Page.handleJavaScriptDialog', params: { accept: true } })
    expect(await controller.click(3)).toContain('leave-page warning accepted: left as asked')
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

// #299, ADR 0073: a link that asks for a new window opens in the pane; a
// window a script opens stays denied and reported.
describe('createCdpBrowserController New-window Links', () => {
  const FOLLOWED = 'the link asked for a new window; opened here'

  /** A page of links on one site. */
  function linksPage(): CollectedPage {
    return { ...youtubeFixture, elements: [link('one'), link('two')] }
  }

  /** The page a followed link lands on. */
  function landingPage(url: string): CollectedPage {
    return { ...youtubeFixture, url, title: 'Landed', elements: [link('onward')] }
  }

  function makeLinksController(options?: { popupBlocks?: string[]; authPopupOpens?: string[] }) {
    return makeController({ cdp: new FakeCdp(linksPage()), page: new FakePage(), ...options })
  }

  /** From here a load lands on a page of that address. */
  function landOnLoad(cdp: FakeCdp, page: FakePage): void {
    page.onLoad = (url) => cdp.serve(landingPage(url))
  }

  it('opens a New-window Link in the pane, as a navigating click with its landing and settled page', async () => {
    const { cdp, page, controller, popupQueue } = makeLinksController()
    await showRefs(controller)
    landOnLoad(cdp, page)
    popupQueue.push('https://example.com/one')

    const outcome = await controller.click(1)

    expect(page.loadedUrls.at(-1)).toBe('https://example.com/one')
    expect(outcome).toBe(
      `clicked [1]: urlChanged=true dialogOpen=false; page signature changed; url=https://example.com/one title="Landed"; ${ARRIVED_CLAUSE}; ${FOLLOWED}\n` +
        settledBlock(landingPage('https://example.com/one')),
    )
    expect(outcome).not.toContain('popup blocked')
  })

  it('follows a link rewritten as it is clicked to the rewritten address', async () => {
    const { cdp, page, controller, popupQueue } = makeLinksController()
    await showRefs(controller)
    landOnLoad(cdp, page)
    const rewritten = 'https://example.com/redirect?to=one'
    cdp.linkAddress = rewritten
    popupQueue.push(rewritten)

    const outcome = await controller.click(1)

    expect(page.loadedUrls.at(-1)).toBe(rewritten)
    expect(outcome).toContain(`urlChanged=true dialogOpen=false; page signature changed; url=${rewritten} title="Landed"; ${ARRIVED_CLAUSE}; ${FOLLOWED}`)
  })

  it('follows the address the snapshot showed when the link carries another after the click', async () => {
    const { cdp, page, controller, popupQueue } = makeLinksController()
    await showRefs(controller)
    landOnLoad(cdp, page)
    cdp.linkAddress = 'https://example.com/tracked'
    popupQueue.push('https://example.com/one')

    await controller.click(1)

    expect(page.loadedUrls.at(-1)).toBe('https://example.com/one')
  })

  it('denies a link click that opens some other address, and does not navigate', async () => {
    const { page, controller, popupQueue } = makeLinksController()
    await showRefs(controller)
    const loadsBefore = page.loadedUrls.length
    popupQueue.push('https://ads.test/window')

    const outcome = await controller.click(1)

    expect(page.loadedUrls).toHaveLength(loadsBefore)
    expect(outcome).toBe('clicked [1]: urlChanged=false dialogOpen=false; no observable change; popup blocked: https://ads.test/window')
  })

  it('denies a window a button opens, whatever its address', async () => {
    const cdp = new FakeCdp()
    const page = new FakePage()
    const { controller, popupQueue } = makeController({ cdp, page })
    await showRefs(controller)
    const loadsBefore = page.loadedUrls.length
    // A button carries no address, and the probe of the node finds no link.
    cdp.linkAddress = null
    popupQueue.push('https://www.youtube.com/second')

    const outcome = await controller.click(3)

    expect(page.loadedUrls).toHaveLength(loadsBefore)
    expect(outcome).toBe('clicked [3]: urlChanged=false dialogOpen=false; no observable change; popup blocked: https://www.youtube.com/second')
  })

  it('follows the open that matches and reports the other on the same outcome', async () => {
    const { cdp, page, controller, popupQueue } = makeLinksController()
    await showRefs(controller)
    landOnLoad(cdp, page)
    popupQueue.push('https://ads.test/window', 'https://example.com/one')

    const outcome = await controller.click(1)

    expect(page.loadedUrls.at(-1)).toBe('https://example.com/one')
    expect(outcome.split('\n')[0]).toBe(
      `clicked [1]: urlChanged=true dialogOpen=false; page signature changed; url=https://example.com/one title="Landed"; ${ARRIVED_CLAUSE}; ${FOLLOWED}; popup blocked: https://ads.test/window`,
    )
  })

  it('asks the page for the link’s address only when the click opened something', async () => {
    const { cdp, controller } = makeLinksController()
    await showRefs(controller)

    await controller.click(1)

    expect(cdp.calls.some((call) => String(call.params?.expression ?? '').includes('/* LINK_ADDRESS */'))).toBe(false)
  })

  it('holds the pane’s opens for the length of the click, a refused one included', async () => {
    const { controller, holds } = makeLinksController()
    await showRefs(controller)

    await controller.click(1)
    expect(holds).toEqual({ taken: 1, released: 1 })

    await expect(controller.click(99)).rejects.toThrow(/ref 99 refused/)
    expect(holds).toEqual({ taken: 2, released: 2 })
  })

  it('holds them for a type and a key press too, and reports what they opened on the next outcome', async () => {
    const { page, controller, popupQueue, holds } = makeController()
    await showRefs(controller)
    const loadsBefore = page.loadedUrls.length

    await controller.type(3, 'longitude')
    await controller.pressKey({ key: 'Enter' })
    expect(holds).toEqual({ taken: 2, released: 2 })

    popupQueue.push('https://www.youtube.com/opened-by-enter')
    const text = await controller.readPage()

    expect(page.loadedUrls).toHaveLength(loadsBefore)
    expect(text.endsWith('\npopup blocked: https://www.youtube.com/opened-by-enter')).toBe(true)
  })

  it('cuts the address in the failure it throws, as every outcome does', async () => {
    const { page, controller, popupQueue } = makeLinksController()
    await showRefs(controller)
    page.failLoad = true
    const over = `https://example.com/one#${'f'.repeat(2_000)}`
    popupQueue.push(over)

    await expect(controller.click(1)).rejects.toThrow(`opening ${over.slice(0, 1_999)}… here failed: ERR_NAME_NOT_RESOLVED`)
  })

  it('says the address when opening it here failed', async () => {
    const { page, controller, popupQueue } = makeLinksController()
    await showRefs(controller)
    page.failLoad = true
    popupQueue.push('https://example.com/one')

    await expect(controller.click(1)).rejects.toThrow(
      'the link asked for a new window; opening https://example.com/one here failed: ERR_NAME_NOT_RESOLVED',
    )
  })

  it('follows through a load the site aborted by navigating on', async () => {
    const { cdp, page, controller, popupQueue } = makeLinksController()
    await showRefs(controller)
    page.abortLoad = true
    page.landingHops = [{ url: 'https://example.com/final', title: 'Landed' }]
    page.onLoad = () => cdp.serve(landingPage('https://example.com/final'))
    popupQueue.push('https://example.com/one')

    const outcome = await controller.click(1)

    expect(outcome).toContain(`url=https://example.com/final title="Landed"; ${ARRIVED_CLAUSE}; ${FOLLOWED}`)
  })

  it('prints a denied address of 1,000 characters whole and cuts one over 2,000', async () => {
    const whole = `https://ads.test/${'p'.repeat(983)}`
    const over = `https://ads.test/${'p'.repeat(2_000)}`
    expect(whole).toHaveLength(1_000)
    const { controller } = makeLinksController({ popupBlocks: [whole, over] })
    await showRefs(controller)

    const outcome = await controller.click(2)

    expect(outcome).toBe(
      `clicked [2]: urlChanged=false dialogOpen=false; no observable change; popup blocked: ${whole}; popup blocked: ${over.slice(0, 1_999)}…`,
    )
  })

  it('prints a data: target as its scheme and a short cut', async () => {
    const data = `data:text/html,${'<b>x</b>'.repeat(100)}`
    const { controller } = makeLinksController({ popupBlocks: [data] })
    await showRefs(controller)

    const outcome = await controller.click(2)

    expect(outcome).toBe(`clicked [2]: urlChanged=false dialogOpen=false; no observable change; popup blocked: ${data.slice(0, 39)}…`)
  })

  it('prints an auth popup’s address by the same rule', async () => {
    const whole = `https://accounts.test/${'p'.repeat(978)}`
    const over = `https://accounts.test/${'p'.repeat(2_000)}`
    expect(whole).toHaveLength(1_000)
    const { controller } = makeLinksController({ authPopupOpens: [whole, over] })
    await showRefs(controller)

    const outcome = await controller.click(2)

    expect(outcome).toBe(
      `clicked [2]: urlChanged=false dialogOpen=false; no observable change; auth popup opened: ${whole}; auth popup opened: ${over.slice(0, 1_999)}…`,
    )
  })

  it('reports an open a page read finds waiting as denied, never following it', async () => {
    const { page, controller, popupQueue } = makeLinksController()
    await showRefs(controller)
    const loadsBefore = page.loadedUrls.length
    popupQueue.push('https://example.com/one')

    const text = await controller.readPage()

    expect(page.loadedUrls).toHaveLength(loadsBefore)
    expect(text.endsWith('\npopup blocked: https://example.com/one')).toBe(true)
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

  it('says the page could not be read when the landing cannot be collected (#308)', async () => {
    const cdp = new FakeCdp({ nonsense: true })
    const { controller } = makeController({ cdp })

    await expect(controller.navigate('youtube.com')).resolves.toBe(`navigated: url=https://www.youtube.com/ title="YouTube"\n${PAGE_NOT_READ}`)
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

// #308 (note on ADR 0027): a landing's line is written from the page it
// carries. The tab can move between the settle and the collect — the
// collection then fails, and the line named the page the tab was leaving.
describe('createCdpBrowserController a landing names the page it carries (#308)', () => {
  afterEach(() => setFaultSink(null))

  const landed = { ...youtubeFixture, url: 'https://www.rmg.co.uk/collections/objects/rmgc-object-79142', title: 'H4 | Royal Museums Greenwich' }

  it('writes the line from the collected page, not from the tab read before it', async () => {
    // The tab still reports the listing it was leaving; the collection is of the object page.
    const cdp = new FakeCdp(landed)
    const { controller } = makeController({ cdp })

    const outcome = await controller.navigate('https://www.rmg.co.uk/collections/objects/rmgc-object-79142')

    expect(outcome).toBe(`navigated: url=${landed.url} title="${landed.title}"\n${settledBlock(landed)}`)
  })

  it('writes back and go_forward the same way', async () => {
    const cdp = new FakeCdp(landed)
    const { controller } = makeController({ cdp })

    expect((await controller.back()).split('\n')[0]).toBe(`went back: url=${landed.url} title="${landed.title}"`)
    expect((await controller.forward()).split('\n')[0]).toBe(`went forward: url=${landed.url} title="${landed.title}"`)
  })

  it('waits for the tab to stop changing and collects once more when the first collection throws', async () => {
    const { records, tracer } = fakePerfHarness()
    const subspans = createBrowserSubspans({ tracer, enabled: true })
    const cdp = new FakeCdp(landed)
    cdp.collectFailures = 1
    const { controller } = makeController({ cdp, subspans })

    const outcome = await subspans.runInTurn('turn-1', () => controller.navigate(landed.url))

    expect(outcome).toBe(`navigated: url=${landed.url} title="${landed.title}"\n${settledBlock(landed)}`)
    expect(cdp.collectCalls()).toHaveLength(2)
    expect(records.map((record) => [record.stage, record.detail])).toEqual([
      ['browser-recollection', { reason: 'settled-state' }],
      // The tab reads the same twice running: one poll settles it.
      ['browser-settle', { action: 'landing-retry', ms: 100 }],
      // The first collect threw and was never timed; the retry's is.
      ['browser-collect', { refs: 20, frames: 0, unread: 0 }],
      ['browser-recollection', { reason: 'landing-retry' }],
    ])
  })

  it('retries back and go_forward the same way', async () => {
    const cdp = new FakeCdp(landed)
    const { controller } = makeController({ cdp })

    cdp.collectFailures = 1
    expect(await controller.back()).toBe(`went back: url=${landed.url} title="${landed.title}"\n${settledBlock(landed)}`)
    cdp.collectFailures = 1
    expect(await controller.forward()).toBe(`went forward: url=${landed.url} title="${landed.title}"\n${settledBlock(landed)}`)
  })

  it('says the page could not be read when the second collection throws too, naming the address read after the failure', async () => {
    const page = new FakePage()
    page.landingHops = [{ url: 'https://www.rmg.co.uk/collections/objects/rmgc-object-79142', title: 'H4 | Royal Museums Greenwich' }]
    const cdp = new FakeCdp(landed)
    cdp.collectFailures = 2
    const { controller } = makeController({ cdp, page })

    const outcome = await controller.navigate(landed.url)

    expect(outcome).toBe(`navigated: url=${landed.url} title="${landed.title}"\n${PAGE_NOT_READ}`)
    expect(outcome).not.toContain('signature ')
    expect(cdp.collectCalls()).toHaveLength(2)
  })

  it('says so for back and go_forward too', async () => {
    const cdp = new FakeCdp(landed)
    const { controller } = makeController({ cdp })

    cdp.collectFailures = 2
    expect(await controller.back()).toBe(`went back: url=https://www.youtube.com/ title="YouTube"\n${PAGE_NOT_READ}`)
    cdp.collectFailures = 2
    expect(await controller.forward()).toBe(`went forward: url=https://www.youtube.com/ title="YouTube"\n${PAGE_NOT_READ}`)
  })

  it('runs no extra wait when the first collection succeeds — and no sleep at all around a landing (#324)', async () => {
    const { records, tracer } = fakePerfHarness()
    const subspans = createBrowserSubspans({ tracer, enabled: true })
    const { controller } = makeController({ subspans })

    await subspans.runInTurn('turn-1', async () => {
      await controller.navigate('youtube.com')
      await controller.back()
      await controller.forward()
    })

    expect(records.map((record) => [record.stage, record.detail])).toEqual([
      ['browser-collect', { refs: 20, frames: 0, unread: 0 }],
      ['browser-recollection', { reason: 'settled-state' }],
      ['browser-collect', { refs: 20, frames: 0, unread: 0 }],
      ['browser-recollection', { reason: 'settled-state' }],
      ['browser-collect', { refs: 20, frames: 0, unread: 0 }],
      ['browser-recollection', { reason: 'settled-state' }],
    ])
  })

  it("records the exception's description on the collector's fault", async () => {
    const faults: FaultReport[] = []
    setFaultSink((report) => faults.push(report))
    const cdp = new FakeCdp(landed)
    cdp.collectFailures = 1
    const { controller } = makeController({ cdp })

    await controller.navigate(landed.url)

    expect(faults).toEqual([
      expect.objectContaining({
        site: 'browser.createCdpBrowserController.landingOutcome',
        message: "page evaluation failed: Uncaught TypeError: Cannot read properties of null (reading 'getBoundingClientRect')",
      }),
    ])
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
    const { records, tracer } = fakePerfHarness()
    const subspans = createBrowserSubspans({ tracer, enabled: true })
    // The line is the collected page's (#308); the tab serves the landing it settles on.
    const cdp = new FakeCdp({ ...youtubeFixture, url: 'http://127.0.0.1:1/landed', title: 'Landed page' })
    const { controller } = makeController({ cdp, page, subspans })

    const outcome = await subspans.runInTurn('turn-1', () => controller.navigate('http://127.0.0.1:1/original'))

    expect(outcome.split('\n')[0]).toBe('navigated: url=http://127.0.0.1:1/landed title="Landed page"')
    // One poll per hop the tab moved through, then one that saw it still.
    expect(records.filter((record) => record.detail?.action === 'navigate-abort')).toHaveLength(2)
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

  it('emits only the collect and its recollection for a navigate, keyed by the open turn — the load is its own wait (#324, #377)', async () => {
    const { records, subspans } = subspanHarness(true)
    const { controller } = makeController({ subspans })

    await subspans.runInTurn('turn-1', () => controller.navigate('youtube.com'))

    expect(records).toEqual([
      { turnId: 'turn-1', stage: 'browser-collect', durMs: 0, at: 1_700_000_000_000, t: 0, detail: { refs: 20, frames: 0, unread: 0 } },
      { turnId: 'turn-1', stage: 'browser-recollection', durMs: 0, at: 1_700_000_000_000, t: 0, detail: { reason: 'settled-state' } },
    ])
  })

  it('emits recollection, safety, and the readiness wait in order for a cold click', async () => {
    const { records, subspans } = subspanHarness(true)
    const { controller } = makeController({ subspans })
    // Outside the turn scope, so nothing they emit lands in the records:
    // the page the model was shown, and an action that leaves its numbers
    // valid but its snapshot cold.
    await showRefs(controller)
    await controller.click(1)

    await subspans.runInTurn('turn-1', () => controller.click(3))

    expect(records.map((record) => [record.turnId, record.stage, record.detail])).toEqual([
      ['turn-1', 'browser-collect', { refs: 20, frames: 0, unread: 0 }],
      ['turn-1', 'browser-recollection', { reason: 'resolve-ref' }],
      ['turn-1', 'browser-safety', { kind: 'click-prep' }],
      ['turn-1', 'browser-ready', { action: 'click', outcome: 'mutation' }],
    ])
  })

  it('emits one readiness wait for a type — no pointer, keystroke or focus settle (#324)', async () => {
    const { records, subspans } = subspanHarness(true)
    const { controller } = makeController({ subspans })
    await showRefs(controller)

    await subspans.runInTurn('turn-1', () => controller.type(3, 'hi'))

    expect(records.filter((record) => record.stage === 'browser-settle')).toEqual([])
    expect(records.filter((record) => record.stage === 'browser-ready').map((record) => record.detail)).toEqual([{ action: 'type', outcome: 'mutation' }])
  })

  it('emits one readiness wait for a scroll — no tick is paced — beside the missing-snapshot collect and the delta collect', async () => {
    const { records, subspans } = subspanHarness(true)
    const { controller } = makeController({ subspans })

    await subspans.runInTurn('turn-1', () => controller.scroll('down'))

    expect(records.filter((record) => record.stage === 'browser-recollection').map((record) => record.detail)).toEqual([
      { reason: 'no-snapshot' },
      { reason: 'scroll-delta' },
    ])
    expect(records.filter((record) => record.stage === 'browser-settle')).toEqual([])
    expect(records.filter((record) => record.stage === 'browser-ready').map((record) => record.detail)).toEqual([{ action: 'scroll', outcome: 'mutation' }])
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
      expect.objectContaining({ stage: 'browser-ready', detail: { action: 'consent-dismiss', outcome: 'mutation' } }),
    )
  })

  it('a consent dismissal waits for its sheet to leave before the post-dismissal recollection (post mortem 2026-10-19)', async () => {
    const { records, subspans } = subspanHarness(true)
    const wall = consentWallPage()
    const cleared = { ...wall, dialogOpen: false, dialogText: '', elements: wall.elements.slice(2) }
    const cdp = new FakeCdp(cleared)
    cdp.collectValues = [wall, cleared]
    // The sheet closes with an animation: still there on two polls, gone on the third.
    cdp.dialogOpenValues = [true, true, false]
    const { controller } = makeController({ cdp, subspans })

    await subspans.runInTurn('turn-1', () => controller.readPage())

    const stages = records.filter((record) => record.stage === 'browser-settle' || record.stage === 'browser-recollection').map((record) => record.detail)
    expect(stages).toEqual([{ action: 'consent-gone', ms: 100 }, { action: 'consent-gone', ms: 100 }, { reason: 'post-dismissal' }])
  })

  it('a consent dismissal gives up waiting at its bound when the sheet stays', async () => {
    const { records, subspans } = subspanHarness(true)
    const wall = consentWallPage()
    const cdp = new FakeCdp(wall)
    cdp.dialogOpenValues = Array.from({ length: 40 }, () => true)
    const { controller } = makeController({ cdp, subspans })

    await subspans.runInTurn('turn-1', () => controller.readPage())

    expect(records.filter((record) => record.stage === 'browser-settle')).toHaveLength(10)
    expect(cdp.dialogOpenValues).toHaveLength(30)
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
    expect(blockedOrInertAction(outcome)).toBeNull()
  })
})

describe('createCdpBrowserController a Blocked Action names its Cover (#264, ADR 0062)', () => {
  const refs = buildPageSnapshot(youtubeFixture).refs

  async function blockedBy(blocked: ClickPrep['blocked']): Promise<{ click: string; type: string }> {
    const cdp = new FakeCdp(youtubeFixture)
    cdp.prepCovered = true
    cdp.prepBlocked = blocked
    const { controller } = makeController({ cdp })
    await showRefs(controller)
    return { click: await controller.click(3), type: await controller.type(3, 'longitude') }
  }

  it('names the first ref above the target by its listing line', async () => {
    const { click, type } = await blockedBy({ fact: 'covered', cover: { ref: 1 } })
    expect(click).toBe(`clicked [3]: not clicked — covered by ${formatRefLine(refs[0]!)}`)
    expect(type).toBe(`typed [3]: not typed — covered by ${formatRefLine(refs[0]!)}`)
  })

  it('names a labelled cover by kind and name with at most three refs it contains', async () => {
    const { click } = await blockedBy({ fact: 'covered', cover: { role: 'region', name: 'Cookie consent', contains: [1, 2, 4, 5] } })
    expect(click).toBe(
      `clicked [3]: not clicked — covered by region "Cookie consent" with ${[refs[0]!, refs[1]!, refs[3]!].map(formatRefLine).join(', ')}`,
    )
  })

  it('names an unlabelled cover by its tag', async () => {
    const { click } = await blockedBy({ fact: 'covered', cover: { tag: 'section', contains: [] } })
    expect(click).toBe('clicked [3]: not clicked — covered by an unlabelled <section>')
  })

  it('says a target absent from the hit test is not shown, for a click and a type alike', async () => {
    const { click, type } = await blockedBy({ fact: 'notShown' })
    expect(click).toBe('clicked [3]: not clicked — [3] is not shown: inside a hidden or inert container')
    expect(type).toBe('typed [3]: not typed — [3] is not shown: inside a hidden or inert container')
  })

  it('carries no listing and never says overlay', async () => {
    for (const blocked of [{ fact: 'covered', cover: { ref: 1 } }, { fact: 'notShown' }] as const) {
      const { click, type } = await blockedBy(blocked)
      for (const outcome of [click, type]) {
        expect(outcome).not.toContain('\n')
        expect(outcome).not.toMatch(/overlay/i)
      }
    }
  })
})

describe('createCdpBrowserController outcome heads the Search Loop rail reads (#261)', () => {
  it('an inert click, a blocked click and a blocked type read as consuming nothing', async () => {
    const inert = makeController()
    await showRefs(inert.controller)
    expect(blockedOrInertAction(await inert.controller.click(3))).toBe('inert')

    const cdp = new FakeCdp()
    cdp.prepCovered = true
    const { controller } = makeController({ cdp })
    await showRefs(controller)
    expect(blockedOrInertAction(await controller.click(3))).toBe('covered')
    expect(blockedOrInertAction(await controller.type(3, 'Harrison longitude watch'))).toBe('covered')
    cdp.prepBlocked = { fact: 'notShown' }
    expect(blockedOrInertAction(await controller.click(3))).toBe('notShown')
    expect(blockedOrInertAction(await controller.type(3, 'Harrison longitude watch'))).toBe('notShown')
  })


  it('a click that only ticked the video\'s loop changed the page: the media flags are in the signature (#363)', async () => {
    const song = { title: 'Fixture Song', paused: false, currentTime: 10, duration: 200, loop: false, muted: false }
    const cdp = new FakeCdp({ ...youtubeFixture, media: song })
    const target = buildPageSnapshot(youtubeFixture).refs[2]!
    const probe = probeFor(youtubeFixture, { checked: target.checked ?? null, selectedOption: target.selectedOption ?? null, value: target.value ?? null, ariaPressed: target.ariaPressed ?? null, className: target.className ?? '' }) as { target: unknown; signature: Record<string, unknown> }
    const { controller } = makeController({ cdp })
    await showRefs(controller)

    // The same flags, time run on: nothing a person would call a change.
    cdp.actionProbe = { ...probe, signature: { ...probe.signature, media: { paused: false, loop: false, muted: false } } }
    expect(blockedOrInertAction(await controller.click(3))).toBe('inert')
    cdp.actionProbe = { ...probe, signature: { ...probe.signature, media: { paused: false, loop: true, muted: false } } }
    const outcome = await controller.click(3)
    expect(outcome.split('\n')[0]).toBe('clicked [3]: urlChanged=false dialogOpen=false; page signature changed')
  })

  it('a click that only took the page into full screen changed the page: full screen is in the signature (#387)', async () => {
    const cdp = new FakeCdp({ ...youtubeFixture, fullScreen: false })
    const target = buildPageSnapshot(youtubeFixture).refs[2]!
    const probe = probeFor(youtubeFixture, { checked: target.checked ?? null, selectedOption: target.selectedOption ?? null, value: target.value ?? null, ariaPressed: target.ariaPressed ?? null, className: target.className ?? '' }) as { target: unknown; signature: Record<string, unknown> }
    const { controller } = makeController({ cdp })
    await showRefs(controller)

    cdp.actionProbe = { ...probe, signature: { ...probe.signature, fullScreen: false } }
    expect(blockedOrInertAction(await controller.click(3))).toBe('inert')
    cdp.actionProbe = { ...probe, signature: { ...probe.signature, fullScreen: true } }
    expect((await controller.click(3)).split('\n')[0]).toBe('clicked [3]: urlChanged=false dialogOpen=false; page signature changed')
  })

  it('a click that changed only the page signature carries settled state and consumed something (fix-258-259 pass 2 round 3)', async () => {
    const cdp = new FakeCdp()
    const target = buildPageSnapshot(youtubeFixture).refs[2]!
    const probe = probeFor(youtubeFixture, {
      checked: target.checked ?? null,
      selectedOption: target.selectedOption ?? null,
      value: target.value ?? null,
      ariaPressed: target.ariaPressed ?? null,
      className: target.className ?? '',
    }) as { target: unknown; signature: { refCount: number } }
    cdp.actionProbe = { ...probe, signature: { ...probe.signature, refCount: probe.signature.refCount - 1 } }
    const { controller } = makeController({ cdp })
    await showRefs(controller)

    const outcome = await controller.click(3)

    expect(outcome.split('\n')[0]).toBe('clicked [3]: urlChanged=false dialogOpen=false; page signature changed')
    expect(blockedOrInertAction(outcome)).toBeNull()
  })
})

describe('createCdpBrowserController an action’s page arrival (#309, ADR 0027)', () => {
  const landed = {
    ...youtubeFixture,
    url: 'https://www.rmg.co.uk/collections/objects/rmgc-object-79142',
    title: 'H4 | Royal Museums Greenwich',
  }
  const leftProbe = {
    target: null,
    signature: { url: landed.url, title: landed.title, scrollX: 0, scrollY: 0, refCount: 0, labels: [], dialogOpen: false },
  }

  it('a click that started a navigation to another document collects the page only once its load finished', async () => {
    const cdp = new FakeCdp(youtubeFixture)
    const page = new FakePage()
    const { controller } = makeController({ cdp, page })
    await showRefs(controller)
    const load = pendingArrival()
    page.nextArrival = load.promise
    cdp.serve(landed)
    cdp.actionProbe = leftProbe

    const collectsBefore = cdp.collectCalls().length
    const clicked = controller.click(3)
    // Waiting on the load: nothing of the page it left for is read yet.
    await vi.waitFor(() => expect(page.arrivalsAsked).toBe(1))
    expect(cdp.collectCalls().length).toBe(collectsBefore)
    expect(cdp.calls.some((call) => String(call.params?.expression ?? '').includes('/* ACTION_OUTCOME */'))).toBe(false)

    load.settle('loaded')
    const outcome = await clicked

    expect(outcome.split('\n')[0]).toBe(
      `clicked [3]: urlChanged=true dialogOpen=false; page signature changed; url=${landed.url} title=${JSON.stringify(landed.title)}; ${ARRIVED_CLAUSE}`,
    )
    expect(outcome).toContain(settledBlock(landed))
    expect(arrivedAtAnotherDocument(outcome)).toBe(true)
    expect(isUnfinishedLoad(outcome)).toBe(false)
  })

  it('a click that reached a page whose URL did not change yet is still an arrival once its load is waited for', async () => {
    const cdp = new FakeCdp(youtubeFixture)
    const page = new FakePage()
    const { controller } = makeController({ cdp, page })
    await showRefs(controller)
    page.nextArrival = 'loaded'
    cdp.serve(landed)
    cdp.actionProbe = leftProbe

    const outcome = await controller.click(3)

    expect(outcome).toContain(`url=${landed.url}`)
    expect(arrivedAtAnotherDocument(outcome)).toBe(true)
  })

  it('a click that started no navigation carries no arrival, as before', async () => {
    const { page, controller } = makeController()
    await showRefs(controller)

    const outcome = await controller.click(3)

    expect(page.watches).toBeGreaterThan(0)
    expect(outcome).toBe('clicked [3]: urlChanged=false dialogOpen=false; no observable change')
  })

  it('a click inside one document that changed the address is no arrival', async () => {
    const cdp = new FakeCdp(youtubeFixture)
    const { page, controller } = makeController({ cdp })
    await showRefs(controller)
    page.nextArrival = 'none'
    const routed = { ...youtubeFixture, url: 'https://www.youtube.com/feed/trending' }
    cdp.serve(routed)
    cdp.actionProbe = { ...leftProbe, signature: { ...leftProbe.signature, url: routed.url, title: routed.title } }

    const outcome = await controller.click(3)

    expect(outcome.split('\n')[0]).toContain('urlChanged=true')
    expect(arrivedAtAnotherDocument(outcome)).toBe(false)
  })

  it('an Unfinished Load carries the page as it stood and says so; the call succeeds', async () => {
    const cdp = new FakeCdp(youtubeFixture)
    const { page, controller } = makeController({ cdp })
    await showRefs(controller)
    page.nextArrival = 'unfinished'
    cdp.serve(landed)
    cdp.actionProbe = leftProbe

    const outcome = await controller.click(3)

    expect(outcome.split('\n')[0]).toMatch(new RegExp(`; ${ARRIVED_CLAUSE}; ${UNFINISHED_LOAD_CLAUSE}$`))
    expect(outcome).toContain(settledBlock(landed))
    expect(isUnfinishedLoad(outcome)).toBe(true)
  })

  it('typing the page left under waits for the load and says it arrived', async () => {
    const cdp = new FakeCdp(youtubeFixture)
    const { page, controller } = makeController({ cdp })
    await showRefs(controller)
    page.nextArrival = 'loaded'
    cdp.collectValues = [youtubeFixture, landed]
    cdp.actionProbe = leftProbe

    const outcome = await controller.type(3, 'H4\n')

    expect(outcome.split('\n')[0]).toBe(
      `typed [3]: field unavailable after page change; url=${landed.url} title=${JSON.stringify(landed.title)}; ${ARRIVED_CLAUSE}`,
    )
    expect(page.arrivalsAsked).toBe(1)
  })

  it('a step through history says when its load was unfinished, and nothing when it finished', async () => {
    const { page, controller } = makeController()

    page.nextArrival = 'loaded'
    expect(await controller.back()).toBe(`went back: url=https://www.youtube.com/ title="YouTube"\n${settledBlock(youtubeFixture)}`)
    page.nextArrival = 'unfinished'
    const forward = await controller.forward()
    expect(forward.split('\n')[0]).toBe(`went forward: url=https://www.youtube.com/ title="YouTube"; ${UNFINISHED_LOAD_CLAUSE}`)
    expect(page.arrivalsAsked).toBe(2)
  })

  it('a key press that started a navigation waits for its load', async () => {
    const { page, controller } = makeController()
    const load = pendingArrival()
    page.nextArrival = load.promise

    let done = false
    const pressed = controller.pressKey({ key: 'n', shift: true }).then(() => (done = true))
    await vi.waitFor(() => expect(page.arrivalsAsked).toBe(1))
    expect(done).toBe(false)
    load.settle('loaded')
    await pressed
    expect(done).toBe(true)
  })

  it('a navigate takes no watch: its load is the action', async () => {
    const { page, controller } = makeController()

    await controller.navigate('youtube.com')

    expect(page.watches).toBe(0)
  })
})

// The post-action wait (#324, ADR 0076): the page's first observable
// effect, or a 150 ms cap on the controller's clock — never a pacing
// sleep. The effect is reported the moment it is seen: it is what closes
// the Reaction span.
describe('createCdpBrowserController readiness wait and effects (#324)', () => {
  function effectsRecorder(): { observed: ActionEffect[]; effects: ActionEffects } {
    const observed: ActionEffect[] = []
    return { observed, effects: { observed: (effect) => observed.push(effect) } }
  }

  it('arms the watch before the click lands and waits on it once after — no timer is asked of the clock', async () => {
    const timers: number[] = []
    const clock: Clock = {
      now: () => 0,
      setTimer: (ms, fn) => {
        timers.push(ms)
        const handle = setTimeout(fn, 0)
        return () => clearTimeout(handle)
      },
    }
    const { cdp, controller } = makeController({ clock })
    await showRefs(controller)

    await controller.click(3)

    expect(cdp.readyArmed).toBe(1)
    expect(cdp.readyWaited).toBe(1)
    const armedAt = cdp.calls.findIndex((call) => String(call.params?.expression ?? '').includes('/* READY_ARM */'))
    const pressedAt = cdp.calls.findIndex((call) => call.params?.type === 'mousePressed')
    const waitedAt = cdp.calls.findIndex((call) => String(call.params?.expression ?? '').includes('/* READY_WAIT */'))
    expect(armedAt).toBeLessThan(pressedAt)
    expect(pressedAt).toBeLessThan(waitedAt)
    // The one timer is the cap, cancelled when the effect lands first.
    expect(timers).toEqual([READINESS_CAP_MS])
  })

  it('ends the wait at the cap on its own clock when the page never answers', async () => {
    const clock = new FakeClock()
    const cdp = new FakeCdp()
    cdp.readyHangs = true
    const { observed, effects } = effectsRecorder()
    const { controller } = makeController({ cdp, clock, effects })
    await showRefs(controller)

    let settled = false
    const click = controller.click(3).then((outcome) => {
      settled = true
      return outcome
    })
    for (let i = 0; i < 60; i += 1) await Promise.resolve()
    clock.advance(READINESS_CAP_MS - 1)
    for (let i = 0; i < 60; i += 1) await Promise.resolve()
    expect(settled).toBe(false)
    clock.advance(1)
    await click
    expect(settled).toBe(true)
    // Nothing was observed: the cap is not an effect.
    expect(observed).toEqual([])
  })

  it('reports the first observable effect of a click, a type, a scroll and a key press', async () => {
    const cdp = new FakeCdp()
    const { observed, effects } = effectsRecorder()
    const { controller } = makeController({ cdp, effects })
    await showRefs(controller)

    cdp.readyOutcome = 'mutation'
    await controller.click(1)
    cdp.readyOutcome = 'input'
    await controller.type(3, 'hi')
    cdp.readyOutcome = 'scroll'
    await controller.scroll('down')
    cdp.readyOutcome = 'timeout'
    await controller.pressKey({ key: 'k' })

    expect(observed).toEqual(['mutation', 'input', 'scroll'])
  })

  it('reads a wait the document left behind as a navigation, and hears a landing commit as one', async () => {
    const cdp = new FakeCdp()
    const page = new FakePage()
    const { observed, effects } = effectsRecorder()
    const { controller } = makeController({ cdp, page, effects })
    await showRefs(controller)

    cdp.readyOutcome = 'none' as unknown as ActionEffect
    await controller.click(1)
    page.commit()
    await controller.navigate('youtube.com')
    expect(page.commitListeners).toBe(0)

    expect(observed).toEqual(['navigation', 'navigation'])
  })

  it('collects the page as data and marks those numbers shown, so the click that follows is not refused', async () => {
    const cdp = new FakeCdp()
    const { controller } = makeController({ cdp })

    const snapshot = await controller.collectPage()

    expect(snapshot.refs.map((ref) => ref.ref).slice(0, 3)).toEqual([1, 2, 3])
    expect(cdp.calls.some((call) => String(call.params?.expression ?? '').includes('__bingbongMarkShown'))).toBe(true)
    await expect(controller.click(3)).resolves.toMatch(/^clicked \[3\]/)
  })

  it('clears the focused field and says what it cleared', async () => {
    const { controller } = makeController()

    expect(await controller.clearFocused()).toBe('cleared input[text]')
  })

  it('flashes the shown ref in the page', async () => {
    const cdp = new FakeCdp()
    const { controller } = makeController({ cdp })
    await showRefs(controller)

    await controller.showRef(2)

    const flash = cdp.calls.find((call) => String(call.params?.expression ?? '').includes('/* FLASH_REF */'))
    expect(String(flash?.params?.expression)).toContain('(window.__bingbongRefs || [])[1]')
  })
})

// The page is the top document and every Reachable Frame (#377, ADR 0081):
// each frame is collected in its own context beside the top, its refs take
// its iframe's place in one numbering, and every action on a frame's ref
// runs in that frame — a click at its point plus the iframe's origin.
describe('frames (#377, ADR 0081)', () => {
  const FACTS = { paused: false, ended: false, currentTime: 16.2, duration: 111, volume: 1, muted: false, loop: false, rate: 1, seekable: { start: 0, end: 111 }, tracks: 0, captions: null, hiddenTrack: false, buffering: false, failed: false }
  const button = (label: string, y: number): CollectedElement => ({ tag: 'button', role: null, inputType: null, label, rect: { x: 10, y, width: 80, height: 30 }, layer: 'page' })
  /** A news page: a button, the embed's iframe (window.frames[0]), a button below it. */
  const TOP: CollectedPage = {
    url: 'https://news.example/story',
    title: 'Story',
    viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, scrollHeight: 800 },
    elements: [button('Share', 10), { tag: 'iframe', role: null, inputType: null, label: '', rect: { x: 100, y: 200, width: 400, height: 300 }, layer: 'page', src: 'https://www.youtube.com/embed/x', frameIndex: 0, frameBox: { x: 102, y: 202 } }, button('Comments', 600)],
  }
  const EMBED: CollectedPage = {
    url: 'https://www.youtube.com/embed/x',
    title: 'Embed',
    viewport: { width: 396, height: 296, scrollX: 0, scrollY: 0, scrollHeight: 296 },
    frameIndex: 0,
    elements: [{ tag: 'video', role: null, inputType: null, label: '', rect: { x: 0, y: 0, width: 396, height: 296 }, layer: 'page', media: FACTS }, button('Pause', 250)],
  }

  /** One frame below the top, answering as the collector's helpers would in it. */
  class FakeFrame implements PageFrame {
    readonly expressions: string[] = []
    private shown: number[] = []
    hangs = false
    gone = false
    mediaOpResult: unknown = null
    /** Its slot in the page's window.frames now: an iframe added before it since moves it on. */
    slot = 0
    /** Its collects never answer, while everything else does. */
    collectHangs = false
    constructor(
      readonly key: string,
      readonly parentKey: string | null,
      private readonly page: CollectedPage,
    ) {}

    async evaluate<T>(expression: string): Promise<T> {
      if (this.gone) throw new Error('Render frame was disposed before WebFrameMain could be accessed')
      this.expressions.push(expression)
      if (this.hangs) return new Promise<T>(() => {})
      const answer = (value: unknown): T => value as T
      if (expression === COLLECT_EXPRESSION) return this.collectHangs ? new Promise<T>(() => {}) : answer(this.page)
      if (expression.includes('__bingbongMarkShownAt')) {
        this.shown = JSON.parse(/__bingbongMarkShownAt\((\[[^)]*\])\)/.exec(expression)?.[1] ?? '[]') as number[]
        return answer(true)
      }
      if (expression.includes('__bingbongRefShown')) return answer(this.shown.includes(Number(/__bingbongRefShown\((\d+)\)/.exec(expression)?.[1])))
      if (expression.includes('/* READY_ARM */')) return answer(true)
      if (expression.includes('/* READY_WAIT */')) return answer('mutation')
      if (expression.includes('window.parent.frames')) return answer(this.slot)
      if (expression.includes('/* MEDIA_OP */')) return answer(this.mediaOpResult)
      if (expression.includes('/* ACTION_OUTCOME */')) {
        return answer({ target: null, signature: { url: this.page.url, title: this.page.title, scrollX: 0, scrollY: 0, refCount: 2, labels: ['', 'Pause'], dialogOpen: false, media: null } })
      }
      if (expression.includes('__bingbongRefs')) return answer({ ok: true, clickable: true, x: 30, y: 265 })
      return answer(undefined)
    }
  }

  function framed(embed = new FakeFrame('7:3', null, EMBED)) {
    const cdp = new FakeCdp(TOP)
    cdp.frameBox = { x: 102, y: 202 }
    const made = makeController({ cdp, frames: { list: () => (embed.gone ? [] : [embed]) } })
    return { ...made, cdp, embed }
  }

  it("reads the frame beside the top and puts its refs at its iframe's place, named by its host", async () => {
    const { controller } = framed()

    const page = await controller.readPage()

    expect(page).toContain('[1] button "Share"\n[2] media in youtube.com\n[3] button "Pause" in youtube.com\n[4] button "Comments"')
    expect(page).not.toContain('iframe')
  })

  it('leaves a frame that has not answered within the grace as its opaque iframe ref, and the read is not held up', async () => {
    const embed = new FakeFrame('7:3', null, EMBED)
    embed.hangs = true
    const { controller } = framed(embed)

    const page = await controller.readPage()

    expect(page).toContain('[2] iframe src="https://www.youtube.com/embed/x"\n[3] button "Comments"')
  })

  it("clicks a frame's ref at its own point plus the iframe's content-box origin, one mouse press on the page", async () => {
    const { controller, cdp, embed } = framed()
    await controller.readPage()

    await controller.click(3)

    const pressed = cdp.inputCalls().filter((call) => call.params?.type === 'mousePressed')
    expect(pressed.map((call) => [call.params?.x, call.params?.y])).toEqual([[132, 467]])
    expect(embed.expressions.some((expression) => expression.includes('__bingbongRefs || [])[1]'))).toBe(true)
  })

  it('finds the iframe by the slot its frame holds at click time, not the one it held at the collect', async () => {
    const { controller, cdp, embed } = framed()
    await controller.readPage()
    // An ad's iframe was created before it since: the embed is window.frames[1] now.
    embed.slot = 1

    await controller.click(3)

    const boxes = cdp.calls.map((call) => String(call.params?.expression ?? '')).filter((expression) => expression.includes('/* FRAME_BOX */'))
    expect(boxes.at(-1)).toContain('=== 1)')
  })

  it('empties the shown registry of a frame the next numbering leaves out, so its old numbers are refused', async () => {
    const { controller, embed } = framed()
    await controller.readPage()
    embed.collectHangs = true

    await controller.readPage()

    expect(embed.expressions.at(-1)).toContain('__bingbongMarkShownAt([])')
  })

  it("aims a top ref after the frame's refs at its own registry index", async () => {
    const { controller, cdp } = framed()
    await controller.readPage()

    await controller.click(4)

    const aimed = cdp.calls.map((call) => String(call.params?.expression ?? '')).filter((expression) => expression.includes('elementsFromPoint'))
    expect(aimed.at(-1)).toContain('(window.__bingbongRefs || [])[2]')
  })

  it('refuses a frame ref as stale once its frame is gone', async () => {
    const { controller, embed, cdp } = framed()
    await controller.readPage()
    embed.gone = true

    await expect(controller.click(3)).rejects.toThrow(/ref 3 refused/)
    expect(cdp.inputCalls().filter((call) => call.params?.type === 'mousePressed')).toEqual([])
  })

  it("fires a Media Op on a frame's media ref in that frame, and none in the top", async () => {
    const { controller, cdp, embed } = framed()
    await controller.readPage()
    embed.mediaOpResult = { before: FACTS, after: { ...FACTS, paused: true } }

    const outcome = await controller.mediaOp(2, { op: 'pause' })

    expect(outcome).toMatch(/paused/)
    expect(embed.expressions.find((expression) => expression.includes('/* MEDIA_OP */'))).toContain('(window.__bingbongRefs || [])[0]')
    expect(cdp.calls.some((call) => String(call.params?.expression ?? '').includes('/* MEDIA_OP */'))).toBe(false)
  })

  it('evaluates a script in every frame and takes the answers that came within the grace', async () => {
    const quick = new FakeFrame('7:3', null, EMBED)
    const slow = new FakeFrame('9:1', null, EMBED)
    slow.hangs = true
    const { controller } = makeController({ cdp: new FakeCdp(TOP), frames: { list: () => [quick, slow] } })

    expect(await controller.evaluateInFrames?.('/* COLLECT */')).toEqual([EMBED])
  })
})
