import type { Clock } from '../ports/clock'
import type { AssistantTurn, LlmClient, LlmRequest } from '../ports/llm'
import type { TtsSpeaker } from '../ports/tts'
import type { Transcriber, VadScorer } from '../ports/stt'
import type { WakeWordDetector } from '../ports/wake'
import type { BrowserController, BrowserState, KeyPress, MediaState, ViewportPoint, VisualGroundingController } from '../ports/browser'
import type { PageSnapshot, SnapshotRef } from '../browser/snapshot'
import type { SearchProvider, SearchResult } from '../ports/search'

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

export class ScriptedLlm implements LlmClient {
  private readonly script: AssistantTurn[]
  readonly requests: LlmRequest[] = []

  constructor(script: AssistantTurn[]) {
    this.script = [...script]
  }

  async complete(request: LlmRequest): Promise<AssistantTurn> {
    this.requests.push(request)
    const next = this.script.shift()
    if (!next) throw new Error('ScriptedLlm ran out of scripted turns')
    if (next.kind !== 'tool_calls') return next
    const groundedRef = [...request.toolResults]
      .reverse()
      .find((result) => result.outcome.ok && typeof result.outcome.result === 'string' && /\buse ref \d+\b/.test(result.outcome.result))
    const ref = groundedRef?.outcome.ok && typeof groundedRef.outcome.result === 'string'
      ? Number(/\buse ref (\d+)\b/.exec(groundedRef.outcome.result)?.[1])
      : undefined
    return {
      ...next,
      calls: next.calls.map((call) => ({
        ...call,
        args: Object.fromEntries(
          Object.entries(call.args).map(([name, value]) => [
            name,
            name === 'ref' && value === '$grounded_ref' && ref !== undefined ? ref : value,
          ]),
        ),
      })),
    }
  }
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
    textDigest: '',
    refs: [],
    totalVisible: 0,
    truncated: false,
  }
  screenshotBytes = new Uint8Array()
  screenshotCalls = 0
  pointRef = 1
  readonly refPoints: { x: number; y: number }[] = []
  media: MediaState | null = { paused: true, currentTime: 0, volume: 1 }

  async navigate(url: string): Promise<string> {
    this.navigations.push(url)
    this.pageState = { url, title: `Fake page: ${url}` }
    return `navigated: url=${url} title=${JSON.stringify(this.pageState.title)}`
  }

  async readPage(): Promise<string> {
    return `<page>${this.pageState.url ?? 'blank'}</page>`
  }

  async click(ref: number): Promise<string> {
    this.clicks.push(ref)
    return `clicked [${ref}]: urlChanged=false dialogOpen=false; no observable change`
  }

  async type(ref: number, text: string): Promise<string> {
    this.typed.push({ ref, text })
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

  async screenshot(): Promise<Uint8Array> {
    this.screenshotCalls += 1
    return this.screenshotBytes
  }

  async back(): Promise<string> {
    this.pageState = { url: null, title: null }
    return 'went back: url= title=""'
  }

  state(): BrowserState {
    return this.pageState
  }

  async describeRef(ref: number): Promise<SnapshotRef | undefined> {
    return this.refs.get(ref)
  }

  async groundingSnapshot(): Promise<PageSnapshot> {
    return this.snapshot
  }

  async refAtPoint(point: ViewportPoint): Promise<number> {
    this.refPoints.push(point)
    return this.pointRef
  }
}

/** Queue-driven VAD: one probability per frame, last value repeats. */
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

/** Queue-driven transcriber: one transcript per utterance, then ''. */
export class FakeTranscriber implements Transcriber {
  private queue: string[]
  readonly audio: Float32Array[] = []
  rejectWith: Error | null = null

  constructor(script: string[] = []) {
    this.queue = [...script]
  }

  async transcribe(pcm: Float32Array): Promise<string> {
    this.audio.push(pcm)
    if (this.rejectWith) throw this.rejectWith
    return this.queue.shift() ?? ''
  }
}

/** Queue-driven wake detector: one score per 1280-sample chunk, last value repeats. */
export class FakeWakeDetector implements WakeWordDetector {
  queue: number[]
  private last = 0
  readonly chunks: Float32Array[] = []
  resets = 0
  failWith: Error | null = null

  constructor(scores: number[] = []) {
    this.queue = [...scores]
  }

  async score(chunk: Float32Array): Promise<number> {
    this.chunks.push(chunk)
    if (this.failWith) throw this.failWith
    if (this.queue.length > 0) this.last = this.queue.shift() ?? this.last
    return this.last
  }

  reset(): void {
    this.resets += 1
  }
}

export class FakeSearch implements SearchProvider {  readonly queries: string[] = []
  private readonly results: SearchResult[]

  constructor(results: SearchResult[] = []) {
    this.results = results
  }

  async search(query: string): Promise<SearchResult[]> {
    this.queries.push(query)
    return this.results
  }
}

// Production stand-ins used below the seam until real adapters land:

/** No-speaker stand-in; speak events still flow to the dashboard. */
export const silentTts: TtsSpeaker = {
  async speak() {
    return { ok: true as const }
  },
  stop() {},
}

/** An LLM that always fails — keeps the app usable when config is missing or invalid. */
export class UnavailableLlm implements LlmClient {
  constructor(private readonly reason: string) {}

  async complete(): Promise<AssistantTurn> {
    throw new Error(this.reason)
  }
}
