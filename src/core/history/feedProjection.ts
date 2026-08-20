import type { PipelineEvent } from '../pipeline/events'
import { describeToolIntent } from '../pipeline/toolCallDisplay'
import { formatRetryLine } from '../pipeline/runProgress'
import { projectPipelineEvent } from './transcriptProjection'
import { filterHydratedDuplicates } from './mergeHistory'
import type { HydrationSnapshot } from './hydrationScope'
import type { TranscriptEvent } from './historyStore'

// Feed projection (#44): the right-edge activity feed as a pure function —
// pipeline events in, ordered feed entries out. Outcome lines reuse the
// shared transcript projection word-for-word, so what the feed shows as
// outcomes is exactly what history records and rehydrates; retry lines are
// ephemeral detail (never recorded, trimmed beyond the cap). Streamed
// deltas (#47) grow live answer/reasoning runs — also ephemeral detail —
// with the answer's display entry replacing its partial at round end.
// Tool-intent lines (#48) grow the same way while call arguments stream,
// superseded by the tool's outcome line at execution. Session-scoped
// (ADR 0003, made eager by ADR 0005): session_started — fired lazily at
// the boundary command or eagerly by the lapse timer — wipes the view, and
// restart hydration seeds only the still-open session.

/** The entry kinds the feed renders: transcript kinds plus detail lines. */
export type FeedEntryKind =
  | TranscriptEvent['kind']
  | 'retry'
  | 'steer'
  | 'stage'
  | 'answer_stream'
  | 'reasoning'
  | 'intent'

export interface FeedEntry {
  /** Rising, unique across the projection's life — the renderer's React key. */
  id: number
  /** Wall-clock `at` of the source event — the rendered timestamp. */
  at: number
  kind: FeedEntryKind
  text: string
  /** Detail lines are ephemeral: never hydrated, trimmed beyond the cap. */
  detail: boolean
}

/** Detail entries are trimmed beyond this (~500, spec #42). */
export const MAX_DETAIL_ENTRIES = 500

export function createFeedProjection(): {
  onEvent(event: PipelineEvent): void
  /** Voice-half lines (heard words, mic errors) ride the same feed. */
  append(entry: TranscriptEvent): void
  /**
   * Restart hydration: recorded history seeds outcome entries only, scoped
   * to the still-open session (ADR 0005) — entries older than the
   * snapshot's `sessionStartAt` boundary stay gone, and `null` (a lapsed
   * session) seeds nothing at all.
   */
  hydrate(snapshot: HydrationSnapshot): void
  entries(): FeedEntry[]
} {
  let feed: FeedEntry[] = []
  let nextId = 0
  // A session boundary wipes the view; hydration that resolves after a
  // boundary must not resurrect the old session's outcomes — nothing older
  // is ever rendered again (ADR 0003).
  let sessionCleared = false
  // Open streamed runs (#47): the feed entry a live delta grows, if any —
  // one per kind, closed (frozen in place) by any other event so each run
  // reads as one growing line. Null after close/boundary/replacement.
  let openTextId: number | null = null
  let openReasoningId: number | null = null
  // Open intent lines (#48), keyed by the provider's call index — the
  // entry a growing snapshot replaces in place until another event closes
  // it (the tool's outcome line follows).
  let openIntentIds = new Map<number, number>()

  const closeStreaming = (): void => {
    openTextId = null
    openReasoningId = null
    openIntentIds = new Map()
  }

  /** Drops the open streamed-answer run — its final entry replaces it. */
  const dropOpenText = (): void => {
    if (openTextId === null) return
    feed = feed.filter((entry) => entry.id !== openTextId)
    openTextId = null
  }

  const appendOutcome = (entry: TranscriptEvent): void => {
    closeStreaming()
    feed = [...feed, { ...entry, id: nextId++, detail: false }]
  }

  const appendDetail = (at: number, text: string, kind: 'retry' | 'steer' | 'stage' = 'retry'): void => {
    closeStreaming()
    feed = [...feed, { id: nextId++, at, kind, text, detail: true }]
    trimDetail()
  }

  function trimDetail(): void {
    // Ephemeral lines are trimmed beyond the cap, oldest first; outcome
    // entries are session-scoped and unbounded, exactly like the transcript.
    let detailCount = 0
    for (let i = feed.length - 1; i >= 0; i -= 1) {
      if (!feed[i]!.detail) continue
      detailCount += 1
      if (detailCount > MAX_DETAIL_ENTRIES) feed.splice(i, 1)
    }
  }

  /** One streamed fragment (#47): grows the open run of its kind, or opens one. */
  const appendDelta = (kind: 'answer_stream' | 'reasoning', fragment: string, at: number): void => {
    if (fragment === '') return
    const openId = kind === 'answer_stream' ? openTextId : openReasoningId
    if (openId !== null) {
      const index = feed.findIndex((entry) => entry.id === openId)
      if (index !== -1) {
        // Same id — React re-renders the growing line, never re-keys it.
        const grown = { ...feed[index]!, text: feed[index]!.text + fragment }
        feed = [...feed.slice(0, index), grown, ...feed.slice(index + 1)]
        return
      }
    }
    const id = nextId++
    feed = [...feed, { id, at, kind, text: fragment, detail: true }]
    if (kind === 'answer_stream') openTextId = id
    else openReasoningId = id
    trimDetail()
  }

  /** One intent snapshot (#48): replaces the open line for its call index. */
  const appendIntent = (index: number, name: string, args: string, at: number): void => {
    const text = describeToolIntent(name, args)
    const openId = openIntentIds.get(index)
    if (openId !== undefined) {
      const open = feed.findIndex((entry) => entry.id === openId)
      if (open !== -1) {
        // Same id, replaced text — the phrase grows as arguments arrive.
        const grown = { ...feed[open]!, text }
        feed = [...feed.slice(0, open), grown, ...feed.slice(open + 1)]
        return
      }
    }
    const id = nextId++
    feed = [...feed, { id, at, kind: 'intent', text, detail: true }]
    openIntentIds.set(index, id)
    trimDetail()
  }

  return {
    onEvent(event) {
      switch (event.type) {
        case 'llm_delta':
          appendDelta(event.kind === 'text' ? 'answer_stream' : 'reasoning', event.text, event.at)
          return
        case 'llm_tool_intent':
          appendIntent(event.index, event.name, event.args, event.at)
          return
        case 'display':
          // The answer's final display entry supersedes its streamed
          // partial — never both on screen.
          dropOpenText()
          appendOutcome(projectPipelineEvent(event)!)
          return
        case 'llm_retry':
          appendDetail(event.at, formatRetryLine(event.attempt, event.maxAttempts))
          return
        case 'status':
          // Stage entries (#42 story 17): every stage transition lands as a
          // timestamped detail line, so consecutive lines reconstruct how
          // long each phase took. Exits are implicit — the next line's
          // timestamp closes the previous stage. Ephemeral like all detail.
          appendDetail(event.at, event.status, 'stage')
          return
        case 'steer':
          appendDetail(event.at, `steer: ${event.text}`, 'steer')
          return
        case 'session_started':
          // The eager session clear (ADR 0005, superseding ADR 0003's lazy
          // one): the boundary alone wipes the view — the lapse timer fires
          // it while idle, or the boundary command/model reset does — and
          // nothing older is ever rendered again.
          feed = []
          sessionCleared = true
          closeStreaming()
          return
        default: {
          const projected = projectPipelineEvent(event)
          if (projected) appendOutcome(projected)
          else closeStreaming()
        }
      }
    },
    append: appendOutcome,
    hydrate(snapshot) {
      // Session-scoped first (ADR 0005): the lapsed past never renders,
      // even for the entries the recorder did (and must keep) recording.
      const { sessionStartAt } = snapshot
      const inSession =
        sessionStartAt === null ? [] : snapshot.entries.filter((entry) => entry.at >= sessionStartAt)
      if (inSession.length === 0 || sessionCleared) return
      closeStreaming()
      // Recorded history is older than anything live; entries that arrived
      // live while the fetch was in flight also ride the snapshot's tail,
      // so dedup closes the startup race (idempotent by the same count map).
      const live = filterHydratedDuplicates(inSession, feed)
      feed = [...inSession.map((entry) => ({ ...entry, id: nextId++, detail: false })), ...live]
    },
    entries: () => feed,
  }
}
