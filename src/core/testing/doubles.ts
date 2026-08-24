import type { Clock } from '../ports/clock'
import type { AssistantTurn, LlmClient, LlmRequest, LlmStreamDelta } from '../ports/llm'
import type { TtsSpeaker } from '../ports/tts'
import type { Transcriber, VadScorer } from '../ports/stt'
import { WAKE_HEADS, type WakeScores, type WakeWordDetector } from '../ports/wake'
import type { BrowserController, BrowserState, KeyPress, MediaState, ViewportPoint, VisualGroundingController } from '../ports/browser'
import { blockerFactsFromSnapshot } from '../browser/blockerNudge'
import type { PageSnapshot, SnapshotRef } from '../browser/snapshot'
import type {
  VisionDescribeRequest,
  VisionLocateRequest,
  VisionLocation,
  VisionModel,
} from '../ports/vision'
import type { PipelineEvent } from '../pipeline/events'
import type { SubagentManager, SubagentRecord, SubagentStatus } from '../agent/subagentManager'
import type { PanelControls } from '../pipeline/panelTools'
import type { AppControls, SettingsControls } from '../pipeline/settingsTools'
import { FEED_PANEL_WIDTH_DEFAULT, clampFeedPanelWidth, type FeedPanelMode, type FeedPanelState } from '../panel/feedPanelState'
import { defaultSettings, sanitizeSettings, type AppSettings } from '../settings/settings'
import { createPerfTracer, type PerfSpanRecord, type PerfTracer } from '../perf/perfTracer'

/**
 * Drops the #28 turn-id stamp — behavior tests written before turn
 * correlation keep asserting the exact pre-#28 event shape; stamping itself
 * is covered by the turn-correlation tests.
 */
export function withoutTurnId(event: PipelineEvent): PipelineEvent {
  const rest = { ...event } as { turnId?: string }
  delete rest.turnId
  return rest as PipelineEvent
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

/**
 * A scripted answer turn may opt into streaming (#56 e2e): `streamChunks`
 * are emitted through the round's onDelta before the final turn resolves.
 */
export type ScriptedAnswerTurn = Extract<AssistantTurn, { kind: 'answer' }> & {
  streamChunks?: string[]
}

/**
 * Inter-chunk pause (#56): longer than the delta batcher's flush window
 * (120ms), so e2e observes mid-stream renders — formatting appears while
 * the run is still live, before the final display entry replaces it.
 */
export const SCRIPTED_STREAM_CHUNK_DELAY_MS = 150

/** The turn's streamed chunks when it opted in (and they parse as a list). */
function scriptedChunks(turn: AssistantTurn): string[] | undefined {
  if (turn.kind !== 'answer') return undefined
  const chunks = (turn as ScriptedAnswerTurn).streamChunks
  return Array.isArray(chunks) ? chunks : undefined
}

async function streamScriptedChunks(
  turn: AssistantTurn,
  onDelta: ((delta: LlmStreamDelta) => void) | undefined,
): Promise<void> {
  if (!onDelta) return
  const chunks = scriptedChunks(turn)
  if (!chunks) return
  for (const chunk of chunks) {
    if (chunk !== '') onDelta({ kind: 'text', text: chunk })
    await new Promise((resolve) => setTimeout(resolve, SCRIPTED_STREAM_CHUNK_DELAY_MS))
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
    await streamScriptedChunks(next, request.onDelta)
    // Renders continuity fields into scripted text so E2E can prove what the
    // current Run received without exposing private request objects.
    const substitutions: [string, string][] = [
      ['$journal', (request.journal ?? []).map((entry) => `[${entry.runId}] ${entry.text}`).join('\n')],
      ['$steering', request.steering ?? ''],
    ]
    if (next.kind !== 'tool_calls') {
      const lastError = [...request.toolResults]
        .reverse()
        .find((result) => !result.outcome.ok)?.outcome
      const lastErrorText = lastError && !lastError.ok ? lastError.error : null
      const apply = (text: string): string =>
        [...substitutions, ['$last_tool_error', lastErrorText ?? '$last_tool_error']]
          .reduce((rendered, [token, value]) => rendered.replaceAll(token, value), text)
      return {
        ...next,
        speak: apply(next.speak),
        display: apply(next.display),
        ...(next.runNote !== undefined ? { runNote: apply(next.runNote) } : {}),
      }
    }
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
    dialogText: '',
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

  async forward(): Promise<string> {
    this.pageState = { url: null, title: null }
    return 'went forward: url= title=""'
  }

  state(): BrowserState {
    return this.pageState
  }

  // ADR 0010 classifier facts, off the overridable snapshot.
  async pageFacts() {
    return blockerFactsFromSnapshot(this.snapshot)
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

export class FakeVision implements VisionModel {
  readonly locateRequests: VisionLocateRequest[] = []
  readonly describeRequests: VisionDescribeRequest[] = []
  location: VisionLocation = { x: 0, y: 0 }
  description = 'A cookie popup covers the page.'
  descriptions: string[] = []

  async locate(request: VisionLocateRequest): Promise<VisionLocation> {
    this.locateRequests.push(request)
    return this.location
  }

  async describe(request: VisionDescribeRequest): Promise<string> {
    this.describeRequests.push(request)
    return this.descriptions.shift() ?? this.description
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

/**
 * Recording stand-in for the window's feed panel overlay (#64/#71): folds
 * toggle/setMode/setWidth exactly like the real panel-state fold — widths
 * clamp against the configured window just as the overlay clamps against
 * the live one — remembering every call so tests can assert what the
 * model-invoked tools drove.
 */
export class FakePanel implements PanelControls {
  readonly toggles: boolean[] = []
  readonly modes: FeedPanelMode[] = []
  readonly widths: number[] = []
  private current: FeedPanelState

  constructor(
    initial: FeedPanelState = { mode: 'overlay', open: false, width: FEED_PANEL_WIDTH_DEFAULT },
    private readonly windowWidthValue = 1280,
  ) {
    this.current = initial
  }

  toggle(): void {
    this.toggles.push(true)
    this.current = { ...this.current, open: !this.current.open }
  }

  setMode(mode: FeedPanelMode): void {
    this.modes.push(mode)
    this.current = { ...this.current, mode }
  }

  setWidth(width: number): void {
    this.widths.push(width)
    this.current = { ...this.current, width: clampFeedPanelWidth(width, this.windowWidthValue) }
  }

  windowWidth(): number {
    return this.windowWidthValue
  }

  state(): FeedPanelState {
    return this.current
  }
}

/**
 * Recording stand-in for the settings store (#67): update() sanitizes with
 * the real fold, so clamped read-backs (zoom bounds, threshold bounds) are
 * assertable at the tool seam; every raw payload is remembered.
 */
export class FakeSettings implements SettingsControls {
  readonly updates: unknown[] = []
  private current: AppSettings

  constructor(initial: AppSettings = defaultSettings()) {
    this.current = initial
  }

  get(): AppSettings {
    return this.current
  }

  update(raw: unknown): AppSettings {
    this.updates.push(raw)
    this.current = sanitizeSettings(raw)
    return this.current
  }
}

/**
 * Recording stand-in for the app controls (#67): quit/reload/speakAck calls
 * land in order, so tests can assert the destructive-op policy — ack spoken
 * before the action, never after.
 */
export class FakeAppControls implements AppControls {
  /** Ordered ops — 'ack:<line>' entries prove the ack preceded the action. */
  readonly calls: string[] = []

  quit(): void {
    this.calls.push('quit')
  }

  reload(): void {
    this.calls.push('reload')
  }

  async speakAck(text: string): Promise<void> {
    this.calls.push(`ack:${text}`)
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

/** One subagent record in the given lifecycle state. */
export function subagentRecord(id: string, status: SubagentStatus = 'running'): SubagentRecord {
  return {
    id,
    kind: 'background',
    task: 't',
    status,
    startedAt: 0,
    finishedAt: status === 'running' ? null : 0,
    steps: 0,
    lastAction: null,
    result: null,
    error: null,
  }
}

/**
 * A subagent manager double: spawns succeed, results merge to a fixed
 * string, and `list()` returns the given records — the seam the delegation
 * tools and the progress-detail tests drive.
 */
export function fakeSubagentManager(
  records: SubagentRecord[] = [],
  overrides: Partial<SubagentManager> = {},
): SubagentManager {
  return {
    spawn: (kind, task) => ({ ok: true as const, agent: { ...subagentRecord('a-1'), kind, task } }),
    cancel: () => ({ ok: true as const }),
    cancelAll: () => 0,
    retire: () => 0,
    pauseAll: () => {},
    resumeAll: () => {},
    list: () => records.map((record) => ({ ...record })),
    isRunning: (agentId) => records.some((record) => record.id === agentId && record.status === 'running'),
    results: async () => 'merged results',
    ...overrides,
  }
}
