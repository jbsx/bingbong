import type { PipelineEvent } from '../pipeline/events'
import { describeToolIntent } from '../pipeline/toolCallDisplay'
import { formatRetryLine } from '../pipeline/runProgress'
import { projectPipelineEvent } from './transcriptProjection'
import type { TranscriptEvent } from './historyStore'

// Feed projection (#44): the right-edge activity feed as a pure function —
// pipeline events in, ordered feed entries out. Outcome lines reuse the
// shared transcript projection word-for-word, so what the feed shows as
// outcomes is exactly what Recorded History stores; retry lines are
// ephemeral detail (never recorded, trimmed beyond the cap). Streamed
// deltas (#47) grow live answer/reasoning runs — also ephemeral detail —
// with the answer's display entry replacing its partial at round end.
// Tool-intent lines (#48) grow the same way while call arguments stream,
// superseded by the tool's outcome line at execution. Session-scoped
// (ADR 0003, made eager by ADR 0005): session_started — fired lazily at
// the boundary command or eagerly by the lapse timer — wipes the view.
// Production launches always create this projection empty. Conversation
// structure (#54): every entry carries its role in the chat — your words
// (user) vs Bing Bong's answers (assistant) vs system detail — and a
// turn's Spoken Rendering is suppressed from the view once its Card
// renders, keyed on the shared turn id (the spoken text still reaches
// TTS: the pipeline speaks it regardless of the feed). Run grouping
// (#55): run noise — tool lines, failed tool results, intents, reasoning
// runs, stage markers, retries, steer echoes — carries the run's id so
// the renderer folds it under one per-run details expander (collapsed by
// default, auto-open while the run is live via `liveRunId`); content is
// unchanged, only grouped.

/** Which voice an entry speaks with — the conversation's turn structure (#54). */
export type FeedRole = 'user' | 'assistant' | 'system'

/** The entry kinds the feed renders: transcript kinds plus detail lines. */
export type FeedEntryKind =
  | TranscriptEvent['kind']
  | 'retry'
  | 'steer'
  | 'stage'
  | 'answer_stream'
  | 'reasoning'
  | 'intent'

/** Commands and heard words are yours; answers (display/speak/stream) are Bing Bong's. */
export function feedRoleForKind(kind: FeedEntryKind): FeedRole {
  if (kind === 'command' || kind === 'voice') return 'user'
  if (kind === 'display' || kind === 'speak' || kind === 'answer_stream') return 'assistant'
  return 'system'
}

export interface FeedEntry {
  /** Rising, unique across the projection's life — the renderer's React key. */
  id: number
  /** Wall-clock `at` of the source event — the rendered timestamp. */
  at: number
  kind: FeedEntryKind
  /** The conversation role (#54): bubble (user) vs railed card (assistant). */
  role: FeedRole
  text: string
  /** Detail entries are ephemeral: never recorded, trimmed beyond the cap. */
  detail: boolean
  /**
   * The run this entry groups under (#55): set on run noise only — tool
   * lines, failed tool results, intents, reasoning runs, stage markers,
   * retries, steer echoes — so the renderer folds them into one per-run
   * details expander. Absent on every conversation line (bubbles, cards,
   * pipeline errors) and on unstamped announcements.
   */
  runId?: string
}

/** Detail entries are trimmed beyond this (~500, spec #42). */
export const MAX_DETAIL_ENTRIES = 500

export function createFeedProjection(): {
  onEvent(event: PipelineEvent): void
  /** Voice-half lines (heard words, mic errors) ride the same feed. */
  append(entry: TranscriptEvent): void
  entries(): FeedEntry[]
  /**
   * The run currently in flight (#55): opened by its command, closed by
   * its done or a session boundary — the run whose expander auto-opens.
   */
  liveRunId(): string | null
} {
  let feed: FeedEntry[] = []
  let nextId = 0
  // Open streamed runs (#47): the feed entry a live delta grows, if any —
  // one per kind, closed (frozen in place) by any other event so each run
  // reads as one growing line. Null after close/boundary/replacement.
  // The answer stream's entry is the typing indicator (ADR 0013): when
  // anything else happens it resolves — dropped, never frozen — so no
  // indicator outlives the moment it stood for.
  let openTextId: number | null = null
  let openReasoningId: number | null = null
  // Open intent lines (#48), keyed by the provider's call index — the
  // entry a growing snapshot replaces in place until another event closes
  // it (the tool's outcome line follows).
  let openIntentIds = new Map<number, number>()
  // Speak-entry suppression (#54), keyed on the shared turn id: turns
  // whose Card rendered (their Spoken Rendering stays TTS-only), and
  // the rendered speak entry per turn (dropped if the display lands after
  // it). Unstamped announcements — downloads, subagent cards — are not
  // turn-scoped and never suppress.
  const displayedTurns = new Set<string>()
  const renderedSpeakIds = new Map<string, number>()
  // The live run (#55): opened by its command, closed by its done or a
  // session boundary — the run whose expander auto-opens while it runs.
  let liveRunId: string | null = null
  let activeSessionId: string | null = null
  let activeSessionGeneration: number | null = null
  let explicitLifecycle = false

  const closeStreaming = (): void => {
    // The typing indicator resolves here: any other event means the
    // answer is no longer forming (ADR 0013) — drop it, never freeze it.
    dropOpenText()
    openReasoningId = null
    openIntentIds = new Map()
  }

  /** Drops the open streamed-answer run — its final entry replaces it. */
  const dropOpenText = (): void => {
    if (openTextId === null) return
    feed = feed.filter((entry) => entry.id !== openTextId)
    openTextId = null
  }

  /** Drops a turn's rendered speak entry — its display card replaces it (#54). */
  const dropRenderedSpeak = (turnId: string): void => {
    const id = renderedSpeakIds.get(turnId)
    if (id === undefined) return
    renderedSpeakIds.delete(turnId)
    feed = feed.filter((entry) => entry.id !== id)
  }

  const appendOutcome = (entry: TranscriptEvent, runId?: string): number => {
    closeStreaming()
    const id = nextId++
    feed = [...feed, { ...entry, id, role: feedRoleForKind(entry.kind), detail: false, runId }]
    return id
  }

  const appendDetail = (
    at: number,
    text: string,
    kind: 'retry' | 'steer' | 'stage' = 'retry',
    runId?: string,
  ): void => {
    closeStreaming()
    feed = [...feed, { id: nextId++, at, kind, role: 'system', text, detail: true, runId }]
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
  const appendDelta = (kind: 'answer_stream' | 'reasoning', fragment: string, at: number, runId?: string): void => {
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
    // Reasoning is run noise (#55) — it groups under the run's expander;
    // the answer stream is a conversation card (#54) and never groups.
    feed = [...feed, { id, at, kind, role: feedRoleForKind(kind), text: fragment, detail: true, runId: kind === 'reasoning' ? runId : undefined }]
    if (kind === 'answer_stream') openTextId = id
    else openReasoningId = id
    trimDetail()
  }

  /** One intent snapshot (#48): replaces the open line for its call index. */
  const appendIntent = (index: number, name: string, args: string, at: number, runId?: string): void => {
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
    feed = [...feed, { id, at, kind: 'intent', role: 'system', text, detail: true, runId }]
    openIntentIds.set(index, id)
    trimDetail()
  }

  const clearSession = (): void => {
    feed = []
    liveRunId = null
    displayedTurns.clear()
    renderedSpeakIds.clear()
    closeStreaming()
  }

  return {
    onEvent(event) {
      if (event.type === 'session_started') {
        if (event.sessionId === undefined || event.sessionGeneration === undefined) {
          clearSession()
          return
        }
        if (activeSessionGeneration !== null && event.sessionGeneration < activeSessionGeneration) return
        if (activeSessionId !== null && event.sessionId !== activeSessionId) return
        explicitLifecycle = true
        activeSessionId = event.sessionId
        activeSessionGeneration = event.sessionGeneration
        return
      }
      if (event.type === 'session_ended') {
        if (
          explicitLifecycle &&
          (event.sessionId !== activeSessionId || event.sessionGeneration !== activeSessionGeneration)
        ) return
        clearSession()
        activeSessionId = null
        if (event.sessionGeneration !== undefined) activeSessionGeneration = event.sessionGeneration
        return
      }
      if (
        explicitLifecycle &&
        (activeSessionId === null ||
          event.sessionId !== activeSessionId ||
          event.sessionGeneration !== activeSessionGeneration)
      ) return

      // The live run's bookkeeping (#55): a command opens its run, its
      // done (or a session boundary) closes it. Unstamped announcements
      // and stragglers from other turns leave the current run alone.
      if (event.type === 'command') liveRunId = event.turnId
      else if (event.type === 'done' && liveRunId === event.turnId) {
        liveRunId = null
        // The run ended without its display (cancelled or failed): the
        // open streamed answer — the typing indicator (ADR 0013) — dies
        // with the run; the turn's trace is whatever else it rendered.
        dropOpenText()
      }
      switch (event.type) {
        case 'llm_delta':
          appendDelta(event.kind === 'text' ? 'answer_stream' : 'reasoning', event.text, event.at, event.turnId)
          return
        case 'llm_tool_intent':
          // Tool intent means the model is acting, not still forming an
          // Answer: resolve the typing indicator before the intent grows.
          dropOpenText()
          appendIntent(event.index, event.name, event.args, event.at, event.turnId)
          return
        case 'tool_call': {
          // Tool lines are run noise (#55) — they group under the run's
          // expander, unlike the conversation lines around them.
          appendOutcome(projectPipelineEvent(event)!, event.turnId)
          return
        }
        case 'tool_result': {
          // Successful results render nothing (and still close the open
          // streams); a failure renders as run noise (#55), grouped —
          // unlike a pipeline error, which stays a top-level line.
          const projected = projectPipelineEvent(event)
          if (projected) appendOutcome(projected, event.turnId)
          else closeStreaming()
          return
        }
        case 'display': {
          // The answer's final display entry supersedes its streamed
          // partial — never both on screen.
          dropOpenText()
          appendOutcome(projectPipelineEvent(event)!)
          if (event.turnId !== undefined) {
            // And its Spoken Rendering (#54): the Card renders, so the
            // turn's speak entry stays out of the view — the pipeline
            // still speaks it. A speak that rendered first is dropped.
            displayedTurns.add(event.turnId)
            dropRenderedSpeak(event.turnId)
          }
          return
        }
        case 'speak': {
          // The Spoken Rendering appears only when its turn has no Card
          // (#54); TTS is unaffected — it happens in main,
          // upstream of the feed.
          if (event.turnId !== undefined && displayedTurns.has(event.turnId)) return
          const id = appendOutcome(projectPipelineEvent(event)!)
          if (event.turnId !== undefined) renderedSpeakIds.set(event.turnId, id)
          return
        }
        case 'llm_retry':
          appendDetail(event.at, formatRetryLine(event.attempt, event.maxAttempts), 'retry', event.turnId)
          return
        case 'status':
          // Stage entries (#42 story 17): every stage transition lands as a
          // timestamped detail line, so consecutive lines reconstruct how
          // long each phase took. Exits are implicit — the next line's
          // timestamp closes the previous stage. Ephemeral like all detail.
          appendDetail(event.at, event.status, 'stage', event.turnId)
          return
        case 'steer':
          appendDetail(event.at, `steer: ${event.text}`, 'steer', event.turnId)
          return
        default: {
          const projected = projectPipelineEvent(event)
          if (projected) appendOutcome(projected)
          else closeStreaming()
        }
      }
    },
    append: appendOutcome,
    entries: () => feed,
    liveRunId: () => liveRunId,
  }
}
