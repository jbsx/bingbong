import { useEffect, useRef, useState } from 'react'
import type { PipelineEvent } from '../../core/pipeline/events'
import type { VoiceHeardEvent } from '../../core/voice/ipcChannels'
import { describeHeard } from '../../core/voice/heardDisplay'
import { createFeedProjection, type FeedEntry } from '../../core/history/feedProjection'
import { hydrationSnapshot } from './hydrationSnapshot'

// The feed projection's renderer wiring (#44, #45): one projection instance,
// restart hydration (outcome entries only, dedup closing the live race),
// and the voice-half appends. Shared by the dashboard (useAssistant) and
// the panel's overlay page (useOverlayFeed) — both render the same feed
// from the same events; only the event sources differ.

export interface FeedProjection {
  feed: FeedEntry[]
  /** The run currently in flight (#55) — its expander auto-opens. */
  liveRunId: string | null
  /** Fold one pipeline event into the feed. */
  handleEvent(event: PipelineEvent): void
  /** A heard-but-not-a-command voice line. */
  appendHeard(heard: VoiceHeardEvent): void
  /** Mic/engine failures from the voice half. */
  appendVoiceError(message: string, at?: number): void
}

export function useFeedProjection(): FeedProjection {
  const [state, setState] = useState<{ feed: FeedEntry[]; liveRunId: string | null }>({ feed: [], liveRunId: null })
  const projection = useRef(createFeedProjection())
  // One sync point for every mutator: entries + the live run (#55) move
  // together, and each mutator closes over only stable things (the ref,
  // setState) so the first-render closures subscribers capture stay live.
  const sync = () => setState({ feed: projection.current.entries(), liveRunId: projection.current.liveRunId() })

  useEffect(() => {
    let cancelled = false
    void hydrationSnapshot()
      .then((snapshot) => {
        if (cancelled) return
        // Session-scoped hydration (ADR 0005): only the still-open session
        // seeds the view — a lapsed session boots blank. The projection
        // applies the scope; live entries that raced the fetch survive.
        projection.current.hydrate(snapshot)
        sync()
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  return {
    feed: state.feed,
    liveRunId: state.liveRunId,
    handleEvent(event) {
      projection.current.onEvent(event)
      sync()
    },
    appendHeard(heard) {
      // Commands are echoed by the pipeline itself; only answers and
      // undecided words land here.
      if (heard.routed === 'command') return
      projection.current.append({ kind: 'voice', text: describeHeard(heard), at: heard.at ?? Date.now() })
      sync()
    },
    appendVoiceError(message, at = Date.now()) {
      projection.current.append({ kind: 'error', text: `voice: ${message}`, at })
      sync()
    },
  }
}
