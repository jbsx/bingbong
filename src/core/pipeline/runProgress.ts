import type { PipelineEvent, PipelineStatus } from './events'

// Progress projection: the header hint's state, as a pure function over the
// pipeline event stream. The stage and its start come from status events.
// Elapsed time is computed by the caller's clock — the renderer ticks over
// the event timestamps, so there is no per-second heartbeat IPC.

/** What the header hint renders for the active run. */
export interface RunProgress {
  stage: PipelineStatus
  /** Wall-clock `at` of the stage's status event — the elapsed anchor. */
  startedAt: number
}

/** Folds pipeline events into the current RunProgress. Pure and renderer-agnostic. */
export function createRunProgressTracker(): {
  onEvent(event: PipelineEvent): void
  current(): RunProgress | null
} {
  let progress: RunProgress | null = null
  // Turn-scoped by check, not convention: status events from a turn other
  // than the active one cannot corrupt the live hint.
  let activeTurn: string | null = null

  return {
    onEvent(event) {
      switch (event.type) {
        case 'command':
          activeTurn = event.turnId
          progress = null
          return
        case 'status':
          if (event.turnId !== activeTurn) return
          progress = { stage: event.status, startedAt: event.at }
          return
        case 'done':
          if (event.turnId !== activeTurn) return
          activeTurn = null
          progress = null
          return
        default:
          return
      }
    },
    current: () => progress,
  }
}

/** The state the Status Capsule's pill names: the voice states outrank the Command's stage. */
export type CapsuleStatus = 'idle' | 'listening' | 'transcribing' | PipelineStatus

/**
 * The hint line for an active Command: a climbing elapsed counter — the
 * honest-hang signal; Stop stays the only escape. The Status Capsule names
 * each state once (#331): the stage is spelled out only when the pill
 * beside it shows another state (the mic opened while the Command acts).
 */
export function describeRunProgress(progress: RunProgress, now: number, pillStatus: CapsuleStatus): string {
  const seconds = Math.max(0, Math.floor((now - progress.startedAt) / 1000))
  return pillStatus === progress.stage ? `${seconds}s` : `${progress.stage} — ${seconds}s`
}
