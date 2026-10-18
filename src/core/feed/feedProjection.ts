import type { PipelineEvent } from '../pipeline/events'
import { projectPipelineEvent, type TranscriptEvent } from './transcriptProjection'

// Feed projection (#44): the right-edge activity feed as a pure function —
// pipeline events in, ordered feed entries out. Outcome lines reuse the
// shared transcript projection word-for-word, so the dashboard and the
// panel overlay show the same outcome line. Conversation structure (#54):
// every entry carries its role in the chat — your words (user) vs Bing
// Bong's answers (assistant) vs system detail — and a turn's spoken line is
// suppressed from the view once its Card renders, keyed on the shared turn
// id (the spoken text still reaches TTS). Run grouping (#55): run noise —
// tool lines, failed tool results, stage markers — carries the run's id so
// the renderer folds it under one per-run details expander (collapsed by
// default, auto-open while the run is live via `liveRunId`).

/** Which voice an entry speaks with — the conversation's turn structure (#54). */
export type FeedRole = 'user' | 'assistant' | 'system'

/** The entry kinds the feed renders: transcript kinds plus detail lines. */
export type FeedEntryKind = TranscriptEvent['kind'] | 'stage'

/** Commands and heard words are yours; answers (display/speak) are Bing Bong's. */
export function feedRoleForKind(kind: FeedEntryKind): FeedRole {
  if (kind === 'command' || kind === 'voice') return 'user'
  if (kind === 'display' || kind === 'speak') return 'assistant'
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
  /** A Command's action taken (#324), rendered under the words heard. */
  action?: string
  /** An Utterance read as no Command (#324): the words alone, greyed. */
  muted?: boolean
  /** A line telling what went wrong (#329): its mark takes the failure colour. */
  failure?: boolean
  /** Detail entries are ephemeral: trimmed beyond the cap. */
  detail: boolean
  /**
   * The run this entry groups under (#55): set on run noise only — tool
   * lines, failed tool results, stage markers — so the renderer folds them
   * into one per-run details expander. Absent on every conversation line
   * (bubbles, cards, pipeline errors) and on unstamped announcements.
   */
  runId?: string
  /**
   * The turn the entry came from (#329), on every line its event stamps —
   * conversation lines included, unlike `runId` — so a view can pick one
   * Command's Answer without reaching a neighbour's. Absent on unstamped
   * announcements and voice-half lines.
   */
  turnId?: string
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
   * its done — the run whose expander auto-opens.
   */
  liveRunId(): string | null
  /** Drops every entry — the dashboard's own clear control. */
  clear(): void
} {
  let feed: FeedEntry[] = []
  let nextId = 0
  // Speak-entry suppression (#54), keyed on the shared turn id: turns
  // whose Card rendered (their spoken line stays TTS-only), and the
  // rendered speak entry per turn (dropped if the display lands after it).
  // Unstamped announcements — downloads — are not turn-scoped and never
  // suppress.
  const displayedTurns = new Set<string>()
  const renderedSpeakIds = new Map<string, number>()
  let liveRunId: string | null = null

  /** Drops a turn's rendered speak entry — its display card replaces it (#54). */
  const dropRenderedSpeak = (turnId: string): void => {
    const id = renderedSpeakIds.get(turnId)
    if (id === undefined) return
    renderedSpeakIds.delete(turnId)
    feed = feed.filter((entry) => entry.id !== id)
  }

  /** Files an outcome entry at `at` (the end by default); answers its id. */
  const fileOutcome = (entry: TranscriptEvent, runId?: string, turnId?: string, at = feed.length): number => {
    const id = nextId++
    feed = [...feed.slice(0, at), { ...entry, id, role: feedRoleForKind(entry.kind), detail: false, runId, ...(turnId !== undefined ? { turnId } : {}) }, ...feed.slice(at)]
    return id
  }
  const appendOutcome = (entry: TranscriptEvent, runId?: string, turnId?: string): number => fileOutcome(entry, runId, turnId)

  /**
   * A Command's words (#330), filed where the Command was given: one whose
   * reading ended after a later Command's words were shown — abandoned
   * while a page loaded — goes before them, not after. Answers whether it
   * was filed back.
   */
  const fileCommand = (entry: TranscriptEvent, turnId: string): boolean => {
    const later = feed.findIndex((shown) => shown.kind === 'command' && shown.at > entry.at)
    fileOutcome(entry, undefined, turnId, later === -1 ? feed.length : later)
    return later !== -1
  }

  const appendDetail = (at: number, text: string, kind: 'stage', runId: string): void => {
    feed = [...feed, { id: nextId++, at, kind, role: 'system', text, detail: true, runId, turnId: runId }]
    trimDetail()
  }

  function trimDetail(): void {
    // Ephemeral lines are trimmed beyond the cap, oldest first; outcome
    // entries are unbounded, exactly like the transcript.
    let detailCount = 0
    for (let i = feed.length - 1; i >= 0; i -= 1) {
      if (!feed[i]!.detail) continue
      detailCount += 1
      if (detailCount > MAX_DETAIL_ENTRIES) feed.splice(i, 1)
    }
  }

  return {
    onEvent(event) {
      // The live run's bookkeeping (#55): a command opens its run, its
      // done closes it. Unstamped announcements and stragglers from other
      // turns leave the current run alone.
      if (event.type === 'done' && liveRunId === event.turnId) liveRunId = null
      switch (event.type) {
        case 'command': {
          // A Command filed back before a later one opens no run: the later one's stays live.
          if (!fileCommand(projectPipelineEvent(event)!, event.turnId)) liveRunId = event.turnId
          return
        }
        case 'tool_call': {
          // Tool lines are run noise (#55) — they group under the run's
          // expander, unlike the conversation lines around them.
          appendOutcome(projectPipelineEvent(event)!, event.turnId, event.turnId)
          return
        }
        case 'tool_result': {
          // Successful results render nothing; a failure renders as run
          // noise (#55), grouped — unlike a pipeline error, which stays a
          // top-level line.
          const projected = projectPipelineEvent(event)
          if (projected) appendOutcome(projected, event.turnId, event.turnId)
          return
        }
        case 'display': {
          appendOutcome(projectPipelineEvent(event)!, undefined, event.turnId)
          if (event.turnId !== undefined) {
            // Its spoken line (#54): the Card renders, so the turn's speak
            // entry stays out of the view — main still speaks it. A speak
            // that rendered first is dropped.
            displayedTurns.add(event.turnId)
            dropRenderedSpeak(event.turnId)
          }
          return
        }
        case 'speak': {
          if (event.turnId !== undefined && displayedTurns.has(event.turnId)) return
          const id = appendOutcome(projectPipelineEvent(event)!, undefined, event.turnId)
          if (event.turnId !== undefined) renderedSpeakIds.set(event.turnId, id)
          return
        }
        case 'status':
          // Stage entries (#42 story 17): every stage transition lands as a
          // timestamped detail line, so consecutive lines reconstruct how
          // long each phase took. Ephemeral like all detail.
          appendDetail(event.at, event.status, 'stage', event.turnId)
          return
        default: {
          const projected = projectPipelineEvent(event)
          if (projected) appendOutcome(projected, undefined, 'turnId' in event ? event.turnId : undefined)
        }
      }
    },
    append: (entry) => appendOutcome(entry),
    entries: () => feed,
    liveRunId: () => liveRunId,
    clear() {
      feed = []
      liveRunId = null
      displayedTurns.clear()
      renderedSpeakIds.clear()
    },
  }
}
