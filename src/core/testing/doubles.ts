import type { Clock } from '../ports/clock'
import type { TtsSpeaker } from '../ports/tts'
import type { Transcriber, VadScorer } from '../ports/stt'
import { WAKE_HEADS, type WakeScores, type WakeWordDetector } from '../ports/wake'
import type {
  BrowserController,
  BrowserState,
  KeyPress,
  MediaState,
  ScreenshotOptions,
  ViewportPoint,
  VisualGroundingController,
} from '../ports/browser'
import { settledStateFromSnapshot } from '../browser/pageFingerprints'
import { blockerFactsFromSnapshot } from '../browser/blockerNudge'
import { linkHrefsOf, type PageLink, type PageSnapshot, type SnapshotRef } from '../browser/snapshot'
import { blockedActionHead, clickFlagsHead, mediaOpHead, menuFlagsHead, NO_OBSERVABLE_CHANGE, PAGE_SIGNATURE_CHANGED, type BlockedAction } from '../browser/actionOutcome'
import type { MediaOpAction } from '../command/mediaOp'
import { createPerfTracer, type PerfSpanRecord, type PerfTracer } from '../perf/perfTracer'

/**
 * A snapshot's link refs as the links of its page (#303): a double's page,
 * whose every link is in view. The live tab's refs are the links in view
 * only, which is why a Result Pick reads the page instead.
 */
export function pageLinksOf(snapshot: PageSnapshot): PageLink[] {
  return snapshot.refs.flatMap((ref) => (ref.kind === 'link' && ref.href !== null && ref.layer !== 'dialog' ? [{ label: ref.label, href: ref.href }] : []))
}

export class FakeClock implements Clock {
  private nowMs: number
  private timers: { due: number; fn: () => void; cancelled: boolean }[] = []

  constructor(start = 0) {
    this.nowMs = start
  }

  now(): number {
    return this.nowMs
  }

  setTimer(ms: number, fn: () => void): () => void {
    const timer = { due: this.nowMs + ms, fn, cancelled: false }
    this.timers.push(timer)
    return () => {
      timer.cancelled = true
    }
  }

  advance(ms: number): void {
    const target = this.nowMs + ms
    for (;;) {
      const next = this.timers
        .filter((t) => !t.cancelled && t.due <= target)
        .sort((a, b) => a.due - b.due)[0]
      if (!next) break
      this.nowMs = next.due
      next.cancelled = true
      next.fn()
    }
    this.nowMs = target
  }
}

/**
 * Lets the microtask queue drain, so promises settled during the last step
 * have run their handlers. The one way a test says "let everything that was
 * already going to happen, happen".
 */
export function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Wait for something a live loop is about to do — a tool reaching the
 * browser, an agent recording a step. Bounded so a condition that never
 * holds fails the test loudly instead of hanging it out to the runner's
 * timeout.
 */
export async function until(condition: () => boolean, what = 'condition'): Promise<void> {
  for (let attempt = 0; attempt < 200 && !condition(); attempt++) await flushMicrotasks()
  if (!condition()) throw new Error(`${what} never held`)
}

/**
 * In-memory perf harness (#27-#30): a real tracer over a sink that captures
 * records, on a scriptable monotonic/wall clock — the shared seam for
 * tracer, wrapper, and pipeline perf tests.
 */
export function fakePerfHarness(): {
  records: PerfSpanRecord[]
  state: { monotonicMs: number; wallMs: number }
  tracer: PerfTracer
} {
  const records: PerfSpanRecord[] = []
  const state = { monotonicMs: 0, wallMs: 1_700_000_000_000 }
  const tracer = createPerfTracer({
    sink: { write: (record) => records.push(record) },
    clock: { monotonic: () => state.monotonicMs, wall: () => state.wallMs },
  })
  return { records, state, tracer }
}

export class RecordingTts implements TtsSpeaker {
  readonly spoken: string[] = []
  stopCalls = 0

  async speak(text: string) {
    this.spoken.push(text)
    return { ok: true as const }
  }

  stop(): void {
    this.stopCalls += 1
  }
}

/** TTS that always fails — exercises the display-only degradation path. */
export class FailingTts implements TtsSpeaker {
  constructor(private readonly error: string) {}

  async speak() {
    return { ok: false as const, error: this.error }
  }

  stop(): void {}
}

export class FakeBrowser implements BrowserController, VisualGroundingController {
  readonly navigations: string[] = []
  readonly clicks: number[] = []
  /** The refs whose right-click menu was opened (#363), in order. */
  readonly menus: number[] = []
  readonly typed: { ref: number; text: string }[] = []
  readonly scrolls: ('up' | 'down')[] = []
  readonly pressedKeys: { press: KeyPress; times: number }[] = []
  /** Refs the risk gate can describe; empty means every ref is unknown. */
  readonly refs = new Map<number, SnapshotRef>()
  private pageState: BrowserState = { url: null, title: null }
  snapshot: PageSnapshot = {
    url: 'about:blank',
    title: '',
    viewport: { width: 800, height: 600, scrollX: 0, scrollY: 0, scrollHeight: 600 },
    dialogOpen: false,
    dialogText: '',
    textDigest: '',
    textBlocks: [],
    textLength: 0,
    textCut: false,
    viewportText: [],
    refs: [],
    totalVisible: 0,
    truncated: false,
  }
  screenshotBytes = new Uint8Array()
  screenshotCalls = 0
  /** Every capture's options as requested; undefined for a whole-viewport screenshot. */
  readonly screenshotRequests: (ScreenshotOptions | undefined)[] = []
  pointRef = 1
  readonly refPoints: { x: number; y: number }[] = []
  /** Ref numbers recorded as shown to the model (ADR 0033). */
  readonly shownRefs: number[] = []
  media: MediaState | null = { paused: true, currentTime: 0, volume: 1 }

  async navigate(url: string): Promise<string> {
    this.navigations.push(url)
    this.pageState = { url, title: `Fake page: ${url}` }
    // #113: navigation outcomes settle the page, so the fake's snapshot —
    // and the classifier facts off it — follows the landing.
    this.snapshot = { ...this.snapshot, url, title: `Fake page: ${url}` }
    return `navigated: url=${url} title=${JSON.stringify(this.pageState.title)}`
  }
  /** The part of every Page Read, in order (ADR 0047). */
  readonly pageReads: number[] = []
  /** How many parts the fake page's text reads in. */
  readParts = 1

  async readPage(part = 1): Promise<string> {
    this.pageReads.push(part)
    const url = this.pageState.url ?? 'blank'
    return part === 1 ? `<page>${url}</page>` : `<page part=${part}>${url}</page>`
  }

  async pageReadParts(): Promise<number> {
    return this.readParts
  }

  /** Refs a cover sits over: a click or a type on one is a Covered Blocked Action (#261, #264). */
  readonly coveredRefs = new Set<number>()
  /** Refs inside a hidden or inert container: a click or a type on one is Not Shown (#264). */
  readonly notShownRefs = new Set<number>()

  /** The Blocked Action a click or type on this ref meets, or null when it reaches the target. */
  private blockedAt(ref: number): BlockedAction | null {
    if (this.notShownRefs.has(ref)) return { fact: 'notShown' }
    if (this.coveredRefs.has(ref)) return { fact: 'covered', cover: { kind: 'unlabelled', tag: 'div', contains: [] } }
    return null
  }

  async click(ref: number): Promise<string> {
    this.clicks.push(ref)
    const blocked = this.blockedAt(ref)
    if (blocked !== null) return blockedActionHead('click', ref, blocked)
    return `${clickFlagsHead(ref, false, false)}${NO_OBSERVABLE_CHANGE}`
  }

  async openMenu(ref: number): Promise<string> {
    this.menus.push(ref)
    const blocked = this.blockedAt(ref)
    if (blocked !== null) return blockedActionHead('menu', ref, blocked)
    return `${menuFlagsHead(ref, false, false)}${PAGE_SIGNATURE_CHANGED}`
  }

  /** Every Media Op fired (#372), in order. */
  readonly mediaOps: { ref: number; op: MediaOpAction }[] = []
  /** What a Media Op's outcome says changed; a test scripts it, and the default says nothing did. */
  mediaOpChanges: string = NO_OBSERVABLE_CHANGE

  async mediaOp(ref: number, op: MediaOpAction): Promise<string> {
    this.mediaOps.push({ ref, op })
    return `${mediaOpHead(op.op, ref)}${this.mediaOpChanges}`
  }

  async type(ref: number, text: string): Promise<string> {
    this.typed.push({ ref, text })
    const blocked = this.blockedAt(ref)
    if (blocked !== null) return blockedActionHead('type', ref, blocked)
    return `typed [${ref}]: value=${JSON.stringify(text)}`
  }

  async scroll(direction: 'up' | 'down'): Promise<string> {
    this.scrolls.push(direction)
    return `scrolled ${direction}: x=0 y=0`
  }

  async pressKey(press: KeyPress, times = 1): Promise<void> {
    this.pressedKeys.push({ press, times })
  }

  async mediaState(): Promise<MediaState | null> {
    return this.media
  }

  /** Every script evaluated in the page (#343), in order. */
  readonly evaluations: string[] = []
  /** What an evaluation answers: the test scripts the page; undefined by default. */
  evaluator: (expression: string) => unknown = () => undefined

  async evaluate<T>(expression: string): Promise<T> {
    this.evaluations.push(expression)
    return this.evaluator(expression) as T
  }

  async screenshot(options?: ScreenshotOptions): Promise<Uint8Array> {
    this.screenshotCalls += 1
    this.screenshotRequests.push(options)
    return this.screenshotBytes
  }

  async back(): Promise<string> {
    this.pageState = { url: null, title: null }
    this.snapshot = { ...this.snapshot, url: '', title: '' }
    return 'went back: url= title=""'
  }

  async forward(): Promise<string> {
    this.pageState = { url: null, title: null }
    this.snapshot = { ...this.snapshot, url: '', title: '' }
    return 'went forward: url= title=""'
  }

  /** Every reload (#328). */
  reloads = 0

  async reload(): Promise<string> {
    this.reloads += 1
    return `reloaded: url=${this.snapshot.url} title=${JSON.stringify(this.snapshot.title)}`
  }

  /** Every stop of the tab's load (#330). */
  stops = 0

  async stop(): Promise<void> {
    this.stops += 1
  }

  state(): BrowserState {
    // A page a test set as the snapshot is the page the pane is on, as a real pane's would be.
    if (this.pageState.url === null && this.snapshot.url !== '' && this.snapshot.url !== 'about:blank') return { url: this.snapshot.url, title: this.snapshot.title || null }
    return this.pageState
  }

  /** The top-level response status the fake page answered with (#239); null — unknown — by default. */
  status: number | null = null

  // ADR 0010 classifier facts, off the overridable snapshot.
  async pageFacts() {
    return { ...blockerFactsFromSnapshot(this.snapshot), ...(this.status !== null ? { status: this.status } : {}) }
  }

  // The Progress rails' comparison input (#126): the overridable snapshot
  // plus the fake's media state.
  async settledState() {
    return settledStateFromSnapshot(this.snapshot, this.media, this.status)
  }

  async describeRef(ref: number): Promise<SnapshotRef | undefined> {
    return this.refs.get(ref)
  }

  // The Composed Address rail's Offered Addresses (#258), off the overridable snapshot.
  async linkHrefs(): Promise<readonly string[] | null> {
    return linkHrefsOf(this.snapshot)
  }

  // A Result Pick's candidates (#303): a page whose every link is in view.
  async pageLinks(): Promise<readonly PageLink[] | null> {
    return pageLinksOf(this.snapshot)
  }

  /** Every collect of the page's refs (#324), in order. */
  collects = 0
  /** Every clear of the focused field (#324). */
  clears = 0

  async collectPage(): Promise<PageSnapshot> {
    this.collects += 1
    return this.snapshot
  }

  async clearFocused(): Promise<string> {
    this.clears += 1
    return 'cleared input[text]'
  }

  async groundingSnapshot(): Promise<PageSnapshot> {
    return this.snapshot
  }

  async refAtPoint(point: ViewportPoint): Promise<number> {
    this.refPoints.push(point)
    return this.pointRef
  }

  async showRef(ref: number): Promise<void> {
    this.shownRefs.push(ref)
  }
}

/**
 * A browser that will not answer (#205): the named actions return promises
 * only `settleLate`/`failLate` can settle. Deliberately not an aborting
 * double — an Unsettled Action is precisely one that does not cooperate, so
 * a fake that quietly resolves when cancelled would prove the opposite.
 */
export class StallingBrowser extends FakeBrowser {
  /** Which actions hang; the rest behave like FakeBrowser's. */
  readonly stalls: Set<string>
  /** Set to answer `navigate` the way an adapter that gave up its own wait does. */
  navigateRejectsWith: Error | null = null
  readonly reached: string[] = []
  private readonly releases: ((outcome: { ok: true } | { ok: false; error: Error }) => void)[] = []

  constructor(stalls: readonly string[] = ['navigate']) {
    super()
    this.stalls = new Set(stalls)
  }

  /** How many stalled actions are still waiting on the page. */
  get outstanding(): number {
    return this.releases.length
  }

  private hang<T>(value: T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.releases.push((outcome) => (outcome.ok ? resolve(value) : reject(outcome.error)))
    })
  }

  private act<T>(action: string, value: T, real: () => Promise<T>): Promise<T> {
    this.reached.push(action)
    if (!this.stalls.has(action)) return real()
    return this.hang(value)
  }

  override navigate(url: string): Promise<string> {
    if (this.navigateRejectsWith) {
      this.reached.push('navigate')
      return Promise.reject(this.navigateRejectsWith)
    }
    return this.act('navigate', `navigated: url=${url}`, () => super.navigate(url))
  }

  override readPage(part?: number): Promise<string> {
    return this.act('readPage', '<page>stalled</page>', () => super.readPage(part))
  }

  override click(ref: number): Promise<string> {
    return this.act('click', `clicked [${ref}]`, () => super.click(ref))
  }

  override scroll(direction: 'up' | 'down'): Promise<string> {
    return this.act('scroll', `scrolled ${direction}`, () => super.scroll(direction))
  }

  /** Every stalled action finally lands, long after anyone waited for it. */
  settleLate(): void {
    for (const release of this.releases.splice(0)) release({ ok: true })
  }

  /** Every stalled action finally fails — an end, just not a happy one. */
  failLate(error = new Error('net::ERR_ABORTED')): void {
    for (const release of this.releases.splice(0)) release({ ok: false, error })
  }
}

export class FakeVad implements VadScorer {
  queue: number[]
  private last = 0.01
  readonly frames: Float32Array[] = []
  resets = 0
  failWith: Error | null = null

  constructor(probs: number[] = []) {
    this.queue = [...probs]
  }

  async score(frame: Float32Array): Promise<number> {
    this.frames.push(frame)
    if (this.failWith) throw this.failWith
    if (this.queue.length > 0) this.last = this.queue.shift() ?? this.last
    return this.last
  }

  reset(): void {
    this.resets += 1
  }
}

/**
 * Queue-driven transcriber: one transcript per finish(), then ''. Records the
 * streaming lifecycle (#40) in `events` so tests can assert what the session
 * fed the engine and in which order.
 */
export class FakeTranscriber implements Transcriber {
  private queue: string[]
  /** The complete utterance pcm of every finish() call. */
  readonly audio: Float32Array[] = []
  /** Every frame pushed during speech. */
  readonly pushedFrames: Float32Array[] = []
  /** Lifecycle record: 'begin', 'push' ×n, then 'finish' or 'cancel'. */
  readonly events: string[] = []
  private readonly partialListeners = new Set<(text: string) => void>()
  rejectWith: Error | null = null
  /** The engine name the `stt` span carries; unset like a fake that names none. */
  engine?: string

  constructor(script: string[] = []) {
    this.queue = [...script]
  }

  begin(): void {
    this.events.push('begin')
  }

  push(frame: Float32Array): void {
    this.pushedFrames.push(frame)
    this.events.push('push')
  }

  onPartial(listener: (text: string) => void): () => void {
    this.partialListeners.add(listener)
    return () => {
      this.partialListeners.delete(listener)
    }
  }

  /** Test hook: broadcast a partial transcript to subscribers. */
  emitPartial(text: string): void {
    for (const listener of this.partialListeners) listener(text)
  }

  async finish(pcm: Float32Array): Promise<string> {
    this.audio.push(pcm)
    this.events.push('finish')
    if (this.rejectWith) throw this.rejectWith
    return this.queue.shift() ?? ''
  }

  cancel(): void {
    this.events.push('cancel')
  }
}

/**
 * Queue-driven wake detector: one score per head per 1280-sample chunk, each
 * head's last value repeating. A plain number[] scripts the wake head only.
 */
export class FakeWakeDetector implements WakeWordDetector {
  private readonly queues: Record<keyof WakeScores, number[]>
  private readonly lasts: Record<keyof WakeScores, number> = { wake: 0, abort: 0, holdOn: 0 }
  readonly chunks: Float32Array[] = []
  resets = 0
  failWith: Error | null = null

  constructor(scores: number[] | Partial<Record<keyof WakeScores, number[]>> = []) {
    const heads = Array.isArray(scores) ? { wake: scores } : scores
    this.queues = {
      wake: [...(heads.wake ?? [])],
      abort: [...(heads.abort ?? [])],
      holdOn: [...(heads.holdOn ?? [])],
    }
  }

  score(chunk: Float32Array): Promise<WakeScores> {
    this.chunks.push(chunk)
    if (this.failWith) return Promise.reject(this.failWith)
    const scores = { ...this.lasts }
    for (const head of WAKE_HEADS) {
      const queue = this.queues[head]
      if (queue.length > 0) this.lasts[head] = queue.shift() ?? this.lasts[head]
      scores[head] = this.lasts[head]
    }
    return Promise.resolve(scores)
  }

  reset(): void {
    this.resets += 1
  }

  /** Appends scores to a head's queue mid-test. */
  push(head: keyof WakeScores, ...scores: number[]): void {
    this.queues[head].push(...scores)
  }
}

export const silentTts: TtsSpeaker = {
  async speak() {
    return { ok: true as const }
  },
  stop() {},
}
