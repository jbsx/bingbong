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

/**
 * The hint line for an active run: stage and a climbing elapsed counter —
 * the honest-hang signal; Stop stays the only escape.
 */
export function describeRunProgress(progress: RunProgress, now: number): string {
  const seconds = Math.max(0, Math.floor((now - progress.startedAt) / 1000))
  return `${progress.stage} — ${seconds}s`
}
