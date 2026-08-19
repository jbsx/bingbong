import type { PipelineEvent } from '../pipeline/events'
import { projectPipelineEvent } from './transcriptProjection'
import { filterHydratedDuplicates } from './mergeHistory'
import type { RecordedEntry, TranscriptEvent } from './historyStore'

// Feed projection (#44): the right-edge activity feed as a pure function —
// pipeline events in, ordered feed entries out. Outcome lines reuse the
// shared transcript projection word-for-word, so what the feed shows as
// outcomes is exactly what history records and rehydrates; retry lines are
// ephemeral detail (never recorded, trimmed beyond the cap). Session-
// scoped exactly like the transcript (ADR 0003): session_started clears.

/** The entry kinds the feed renders: transcript kinds plus detail lines. */
export type FeedEntryKind = TranscriptEvent['kind'] | 'retry'

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
  /** Restart hydration: recorded history seeds outcome entries only. */
  hydrate(recorded: RecordedEntry[]): void
  entries(): FeedEntry[]
} {
  let feed: FeedEntry[] = []
  let nextId = 0
  // A session boundary wipes the view; hydration that resolves after a
  // boundary must not resurrect the old session's outcomes — nothing older
  // is ever rendered again (ADR 0003).
  let sessionCleared = false

  const appendOutcome = (entry: TranscriptEvent): void => {
    feed = [...feed, { ...entry, id: nextId++, detail: false }]
  }

  const appendDetail = (at: number, text: string): void => {
    feed = [...feed, { id: nextId++, at, kind: 'retry', text, detail: true }]
    // Ephemeral lines are trimmed beyond the cap, oldest first; outcome
    // entries are session-scoped and unbounded, exactly like the transcript.
    let detailCount = 0
    for (let i = feed.length - 1; i >= 0; i -= 1) {
      if (!feed[i]!.detail) continue
      detailCount += 1
      if (detailCount > MAX_DETAIL_ENTRIES) feed.splice(i, 1)
    }
  }

  return {
    onEvent(event) {
      switch (event.type) {
        case 'llm_retry':
          appendDetail(event.at, `empty response — retrying ${event.attempt}/${event.maxAttempts}`)
          return
        case 'session_started':
          // The lazy session clear (ADR 0003): the boundary alone wipes the
          // view; nothing older is ever rendered again.
          feed = []
          sessionCleared = true
          return
        default: {
          const projected = projectPipelineEvent(event)
          if (projected) appendOutcome(projected)
        }
      }
    },
    append: appendOutcome,
    hydrate(recorded) {
      if (recorded.length === 0 || sessionCleared) return
      // Recorded history is older than anything live; entries that arrived
      // live while the fetch was in flight also ride the snapshot's tail,
      // so dedup closes the startup race (idempotent by the same count map).
      const live = filterHydratedDuplicates(recorded, feed)
      feed = [...recorded.map((entry) => ({ ...entry, id: nextId++, detail: false })), ...live]
    },
    entries: () => feed,
  }
}
