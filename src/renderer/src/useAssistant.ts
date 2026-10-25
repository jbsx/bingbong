import { useCallback, useEffect, useRef, useState } from 'react'
import type { PipelineEvent } from '../../core/pipeline/events'
import type { VoiceHeardEvent } from '../../core/voice/ipcChannels'
import type { FeedEntry } from '../../core/feed/feedProjection'
import { useFeedProjection } from './useFeedProjection'
import { createRunProgressTracker, type CapsuleStatus, type RunProgress } from '../../core/pipeline/runProgress'
import { createTaskProgressTracker, type TaskProgress } from '../../core/pipeline/taskProgress'

export type OrbStatus = CapsuleStatus

/**
 * How long the Capsule holds a stage past its turn's `done` before it says
 * Ready (#428): a hop's `done` is followed at once by the next hop's stage,
 * and the pill never blinks Ready between them.
 */
const READY_HOLD_MS = 300

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
  /**
   * The Task's progress bar (#375): where the per-hop Progress Noul has
   * brought it, folded from the event stream; null until a Task has a
   * reading, and again at the next Command.
   */
  taskProgress: TaskProgress | null
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
  const [taskProgress, setTaskProgress] = useState<TaskProgress | null>(null)
  const lastStatus = useRef<OrbStatus>('idle')
  // The turn whose stage the pill shows (#428): a line thinks before its `command`, and only that turn's `done` returns it to Ready — never a late one gone by.
  const statusTurn = useRef<string | null>(null)
  const readyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const progressTracker = useRef(createRunProgressTracker())
  const taskProgressTracker = useRef(createTaskProgressTracker())
  // The feed's projection wiring (#44) is shared with the panel's overlay
  // page (#45): same events in, same entries out.
  const feedProjection = useFeedProjection()
  const feed = feedProjection.feed
  const liveRunId = feedProjection.liveRunId

  useEffect(() => {
    const unsubscribe = window.bingbong.assistant.onEvent((event: PipelineEvent) => {
      feedProjection.handleEvent(event)
      progressTracker.current.onEvent(event)
      taskProgressTracker.current.onEvent(event)
      setTaskProgress(taskProgressTracker.current.current())
      // The hint and the pill go quiet together, once the hold has passed with no stage after it.
      const progressNow = progressTracker.current.current()
      switch (event.type) {
        case 'status':
          if (readyTimer.current !== null) clearTimeout(readyTimer.current)
          readyTimer.current = null
          setProgress(progressNow)
          lastStatus.current = event.status
          statusTurn.current = event.turnId
          setStatus(event.status)
          return
        case 'done':
          if (event.turnId !== statusTurn.current || lastStatus.current === 'cancelled') {
            if (readyTimer.current === null) setProgress(progressNow)
            return
          }
          if (readyTimer.current !== null) clearTimeout(readyTimer.current)
          readyTimer.current = setTimeout(() => {
            readyTimer.current = null
            setProgress(progressTracker.current.current())
            setStatus('idle')
          }, READY_HOLD_MS)
          return
        default:
          if (readyTimer.current === null) setProgress(progressNow)
          return
      }
    })
    return () => {
      unsubscribe()
      if (readyTimer.current !== null) clearTimeout(readyTimer.current)
    }
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

  return { status, feed, liveRunId, progress, taskProgress, submit, abort, appendVoiceHeard, appendVoiceError }
}
