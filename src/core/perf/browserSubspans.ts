import type { PerfTracer } from './perfTracer'
import { envFlagEnabled } from './envFlag'

// Verbose browser sub-spans (#32): browser actions already appear as whole
// `tool` spans at the pipeline's gated-execution choke point (#30). Behind an
// env flag, this channel adds drill-down below that choke point — one sub-span
// per deliberate delay and extra round-trip inside a browser action (settle
// sleeps, snapshot recollections, pre-action safety probes). One channel
// object is shared per app: the pipeline's tool gate opens the current-turn
// scope around each gated execution, and the browser controller emits through
// it. With the flag off (the default) or outside any scope (CLI harness,
// detached subagent panes) nothing is written, so the default log stays
// byte-identical to whole-action spans.

/** Env opt-in for verbose browser sub-spans (#32): `BINGBONG_BROWSER_SUBSPANS=1`. */
export const BROWSER_SUBSPANS_ENV = 'BINGBONG_BROWSER_SUBSPANS'

export function browserSubspansEnabled(env: Record<string, string | undefined>): boolean {
  return envFlagEnabled(env, BROWSER_SUBSPANS_ENV)
}

/** Sub-span stage vocabulary: deliberate delays, extra snapshot round-trips, pre-action safety probes. */
export type BrowserSubspanStage = 'browser-settle' | 'browser-recollection' | 'browser-safety'

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
      } catch {
        // swallowed — see above
      }
    },
  }
}
