import type { Clock } from '../ports/clock'
import type { AssistantTurn, LlmClient, LlmRequest } from '../ports/llm'
import type { TtsSpeaker } from '../ports/tts'
import type { BrowserController, BrowserState } from '../ports/browser'
import type { SnapshotRef } from '../browser/snapshot'
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
    return next
  }
}

export class RecordingTts implements TtsSpeaker {
  readonly spoken: string[] = []

  async speak(text: string): Promise<void> {
    this.spoken.push(text)
  }
}

export class FakeBrowser implements BrowserController {
  readonly navigations: string[] = []
  readonly clicks: number[] = []
  readonly typed: { ref: number; text: string }[] = []
  readonly scrolls: ('up' | 'down')[] = []
  /** Refs the risk gate can describe; empty means every ref is unknown. */
  readonly refs = new Map<number, SnapshotRef>()
  private pageState: BrowserState = { url: null, title: null }

  async navigate(url: string): Promise<void> {
    this.navigations.push(url)
    this.pageState = { url, title: `Fake page: ${url}` }
  }

  async readPage(): Promise<string> {
    return `<page>${this.pageState.url ?? 'blank'}</page>`
  }

  async click(ref: number): Promise<void> {
    this.clicks.push(ref)
  }

  async type(ref: number, text: string): Promise<void> {
    this.typed.push({ ref, text })
  }

  async scroll(direction: 'up' | 'down'): Promise<void> {
    this.scrolls.push(direction)
  }

  async screenshot(): Promise<Uint8Array> {
    return new Uint8Array()
  }

  async back(): Promise<void> {
    this.pageState = { url: null, title: null }
  }

  state(): BrowserState {
    return this.pageState
  }

  async describeRef(ref: number): Promise<SnapshotRef | undefined> {
    return this.refs.get(ref)
  }
}

export class FakeSearch implements SearchProvider {
  readonly queries: string[] = []
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

/** TTS output is a later ticket (Piper, T8); speak events still flow to the dashboard. */
export const silentTts: TtsSpeaker = {
  async speak() {},
}

/** An LLM that always fails — keeps the app usable when config is missing or invalid. */
export class UnavailableLlm implements LlmClient {
  constructor(private readonly reason: string) {}

  async complete(): Promise<AssistantTurn> {
    throw new Error(this.reason)
  }
}
