import type { PipelineEvent, PipelineStatus } from './events'

// Progress projection: the header hint's state, as a pure function over the
// pipeline event stream. The stage and its start come from status events.
// Elapsed time is computed by the caller's clock — the renderer ticks over
// the event timestamps, so there is no per-second heartbeat IPC.

/** What the header hint renders for the active run. */
export interface RunProgress {
  stage: PipelineStatus
  /** Wall-clock `at` of the stage's status event — the elapsed anchor, so the seconds are this stage's own (#428). */
  startedAt: number
  /** What the stage is on (#428): the heard words while hop 0 thinks, the action's words while it acts. */
  detail?: string
  /** The Hop the stage is in (#428). */
  hop?: number
}

/** Folds pipeline events into the current RunProgress. Pure and renderer-agnostic. */
export function createRunProgressTracker(): {
  onEvent(event: PipelineEvent): void
  current(): RunProgress | null
} {
  let progress: RunProgress | null = null
  // The turn of the last stage entered (#428): a line thinks before its
  // `command`, and each Hop is a turn of its own, so the stage leads.
  // Only that turn's `done` clears the hint, never a late one gone by.
  let activeTurn: string | null = null

  return {
    onEvent(event) {
      switch (event.type) {
        case 'status':
          activeTurn = event.turnId
          progress = {
            stage: event.status,
            startedAt: event.at,
            ...(event.detail !== undefined ? { detail: event.detail } : {}),
            ...(event.hop !== undefined ? { hop: event.hop } : {}),
          }
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
 * How long one stage runs before the hint names the wait (#428). A guess,
 * the cheapest to reverse: a stage-length distribution from the kiosk's
 * perf logs would settle it.
 */
export const STUCK_STAGE_MS = 5_000

/** The line a stage past {@link STUCK_STAGE_MS} carries: which wait it is. */
const STUCK_LINES: Partial<Record<PipelineStatus, string>> = {
  thinking: 'still thinking',
  acting: 'still acting',
  loading: 'page still loading',
}

/**
 * The hint for an active Command, in parts (#428): the stage spelled out
 * only when the pill beside it shows another state (#331), what the stage
 * is on — the part a long line ellipsizes — and the tail: the Hop past the
 * first, a stuck stage named, and the seconds in this stage, which climb
 * as the honest-hang signal; Stop stays the only escape.
 */
export function runProgressParts(progress: RunProgress, now: number, pillStatus: CapsuleStatus): { named: string; detail: string | null; tail: string } {
  const elapsed = Math.max(0, now - progress.startedAt)
  const seconds = Math.floor(elapsed / 1000)
  const stuck = elapsed >= STUCK_STAGE_MS ? (STUCK_LINES[progress.stage] ?? null) : null
  const hop = progress.hop !== undefined && progress.hop > 0 ? `hop ${progress.hop}` : null
  const detail = progress.detail === undefined || progress.detail === '' ? null : progress.stage === 'thinking' ? `“${progress.detail}”` : progress.detail
  return {
    named: pillStatus === progress.stage ? '' : `${progress.stage} — `,
    detail,
    tail: [hop, stuck, `${seconds}s`].filter((part) => part !== null).join(' · '),
  }
}

/** The hint as one line: {@link runProgressParts} joined. */
export function describeRunProgress(progress: RunProgress, now: number, pillStatus: CapsuleStatus): string {
  const { named, detail, tail } = runProgressParts(progress, now, pillStatus)
  return `${named}${detail !== null ? `${detail} · ` : ''}${tail}`
}
