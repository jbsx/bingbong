import type { PerfTracer } from './perfTracer'
import { envFlagDisabled } from './envFlag'
import { reportFault } from '../trace/fault'

// Browser sub-spans (#32): one sub-span per deliberate delay and extra
// round-trip inside a browser action (settle sleeps, snapshot recollections,
// pre-action safety probes, every collect of the page). One channel object is
// shared per app: the Command runner opens the current-turn scope around each
// Command, and the browser controller emits through it. On by default since
// 2026-10-25 — the kiosk's slow lines were spent inside a collect no span showed —
// and off with the flag set to 0/false/no/off; outside any scope (CLI
// harness, detached panes) nothing is written.

/** Env opt-out for browser sub-spans (#32; on by default 2026-10-25): `BINGBONG_BROWSER_SUBSPANS=0`. */
export const BROWSER_SUBSPANS_ENV = 'BINGBONG_BROWSER_SUBSPANS'

export function browserSubspansEnabled(env: Record<string, string | undefined>): boolean {
  return !envFlagDisabled(env, BROWSER_SUBSPANS_ENV)
}

/** Sub-span stage vocabulary: the landing poll's waits, the post-action readiness waits (#324), extra snapshot round-trips, pre-action safety probes, every collect of the page and its frames (#377), the wait for a clicked dialog's sheet to leave (#417). */
export type BrowserSubspanStage = 'browser-settle' | 'browser-ready' | 'browser-recollection' | 'browser-safety' | 'browser-collect' | 'browser-dialog-wait'

export interface BrowserSubspans {
  /**
   * Opens the current-turn scope around one gated tool execution (#32).
   * Nested opens (a gated action that itself gates) join the innermost turn;
   * the outer scope is restored on the way out.
   */
  runInTurn<T>(turnId: string, action: () => Promise<T>): Promise<T>
  /** Monotonic now — measure sub-stage starts and ends with this. */
  now(): number
  /** Records one sub-span against the open turn; a no-op when the flag is off or no scope is open. */
  emit(stage: BrowserSubspanStage, durMs: number, detail?: Record<string, unknown>): void
}

export function createBrowserSubspans(deps: { tracer: PerfTracer; enabled?: boolean }): BrowserSubspans {
  const enabled = deps.enabled ?? false
  let currentTurn: string | undefined
  return {
    async runInTurn(turnId, action) {
      const outer = currentTurn
      currentTurn = turnId
      try {
        return await action()
      } finally {
        currentTurn = outer
      }
    },

    now: () => deps.tracer.now(),

    emit(stage, durMs, detail) {
      if (!enabled || currentTurn === undefined) return
      // The log is advisory; never fail a browser action over bookkeeping
      // (the same guard every other perf call site gives its tracer).
      try {
        deps.tracer.span(currentTurn, stage, durMs, detail)
      } catch (error) {
        reportFault('perf.browserSubspans.emit', error, { turnId: currentTurn })
        // swallowed — see above
      }
    },
  }
}
