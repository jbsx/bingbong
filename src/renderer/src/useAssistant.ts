import { useCallback, useEffect, useRef, useState } from 'react'
import type { PipelineEvent } from '../../core/pipeline/events'
import type { VoiceHeardEvent } from '../../core/voice/ipcChannels'
import type { FeedEntry } from '../../core/feed/feedProjection'
import { useFeedProjection } from './useFeedProjection'
import { createRunProgressTracker, type CapsuleStatus, type RunProgress } from '../../core/pipeline/runProgress'

export type OrbStatus = CapsuleStatus

export interface Assistant {
  status: OrbStatus
  /**
   * The right-edge activity feed (#44): timestamped outcome lines plus
   * ephemeral detail, folded from the event stream by the pure feed
   * projection. Every launch starts with an empty projection.
   */
  feed: FeedEntry[]
  /** The run currently in flight (#55) — its expander auto-opens. */
  liveRunId: string | null
  /**
   * The active run's progress (#43): stage + elapsed anchor, folded from
   * the event stream. The hint ticks elapsed in the renderer — no
   * per-second IPC.
   */
  progress: RunProgress | null
  submit(text: string): void
  abort(): void
  /** A heard-but-not-a-command line (control words, undecided transcripts). */
  appendVoiceHeard(heard: VoiceHeardEvent): void
  /** Mic/engine failures from the voice half. */
  appendVoiceError(message: string, at?: number): void
}

export function useAssistant(): Assistant {
  const [status, setStatus] = useState<OrbStatus>('idle')
  const [progress, setProgress] = useState<RunProgress | null>(null)
  const lastStatus = useRef<OrbStatus>('idle')
  const progressTracker = useRef(createRunProgressTracker())
  // The feed's projection wiring (#44) is shared with the panel's overlay
  // page (#45): same events in, same entries out.
  const feedProjection = useFeedProjection()
  const feed = feedProjection.feed
  const liveRunId = feedProjection.liveRunId

  useEffect(() => {
    const unsubscribe = window.bingbong.assistant.onEvent((event: PipelineEvent) => {
      feedProjection.handleEvent(event)
      progressTracker.current.onEvent(event)
      setProgress(progressTracker.current.current())
      switch (event.type) {
        case 'status':
          lastStatus.current = event.status
          setStatus(event.status)
          return
        case 'done':
          if (lastStatus.current !== 'cancelled') setStatus('idle')
          return
        default:
          return
      }
    })
    return unsubscribe
  }, [])

  const submit = useCallback((text: string) => {
    void window.bingbong.assistant.submit(text)
  }, [])

  const abort = useCallback(() => {
    void window.bingbong.assistant.abort()
  }, [])

  const appendVoiceHeard = useCallback(
    (heard: VoiceHeardEvent) => {
      feedProjection.appendHeard(heard)
    },
    [feedProjection],
  )

  const appendVoiceError = useCallback(
    (message: string, at?: number) => {
      feedProjection.appendVoiceError(message, at)
    },
    [feedProjection],
  )

  return { status, feed, liveRunId, progress, submit, abort, appendVoiceHeard, appendVoiceError }
}
