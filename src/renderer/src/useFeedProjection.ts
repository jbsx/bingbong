import { useEffect, useRef, useState } from 'react'
import type { PipelineEvent } from '../../core/pipeline/events'
import type { VoiceHeardEvent } from '../../core/voice/ipcChannels'
import { describeHeard } from '../../core/voice/heardDisplay'
import { createFeedProjection, type FeedEntry } from '../../core/history/feedProjection'
import type { SessionAdoptionPayload } from '../../core/session/ipcChannels'
import { reportFeedCleared } from './diagnostics'

// The feed projection's renderer wiring (#44, #45): one launch-local
// projection instance plus the voice-half appends. Shared by the dashboard
// (useAssistant) and the panel's overlay page (useOverlayFeed) — both render
// the same live feed from the same events; Recorded History is review-only.

export interface FeedProjection {
  feed: FeedEntry[]
  /** The run currently in flight (#55) — its expander auto-opens. */
  liveRunId: string | null
  /** Fold one pipeline event into the feed. */
  handleEvent(event: PipelineEvent): void
  /** Re-adopt the live Session by identity (ADR 0017) — forward-only. */
  adoptSession(identity: SessionAdoptionPayload): void
  /** A heard-but-not-a-command voice line. */
  appendHeard(heard: VoiceHeardEvent): void
  /** Mic/engine failures from the voice half. */
  appendVoiceError(message: string, at?: number): void
}

export function useFeedProjection(): FeedProjection {
  const [state, setState] = useState<{ feed: FeedEntry[]; liveRunId: string | null }>({ feed: [], liveRunId: null })
  // The Session boundary's wipe is recorded where it happens (#187); the
  // fresh projection itself is recorded below, because a reloaded page
  // and a wiped one look identical to whoever is looking at the feed.
  const projection = useRef(createFeedProjection({ onCleared: (entries) => reportFeedCleared('session_ended', entries) }))
  const reportedLoad = useRef(false)
  useEffect(() => {
    // Once per page, not once per effect run: the projection outlives a
    // StrictMode remount, so a second record would describe nothing.
    if (reportedLoad.current) return
    reportedLoad.current = true
    reportFeedCleared('page_load', projection.current.entries().length)
  }, [])
  // One sync point for every mutator: entries + the live run (#55) move
  // together, and each mutator closes over only stable things (the ref,
  // setState) so the first-render closures subscribers capture stay live.
  const sync = () => setState({ feed: projection.current.entries(), liveRunId: projection.current.liveRunId() })

  return {
    feed: state.feed,
    liveRunId: state.liveRunId,
    handleEvent(event) {
      projection.current.onEvent(event)
      sync()
    },
    adoptSession(identity) {
      projection.current.adopt(identity)
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
