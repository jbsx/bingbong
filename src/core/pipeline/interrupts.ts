import type { UnstampedEvent } from './events'

// Issue #154, step 2's prefactor (#156): the interrupts seam.
//
// Vocabulary (CONTEXT.md): the three things that reach a live Run from
// outside it — Pause (ADR 0024, the Wake Word parks the Run), Steering (one
// Directive bends it), and Stop (the Abort Head ends it). "Interrupts" names
// the seam all three arrive through, never Steering itself: CONTEXT.md's
// Steering entry avoids "interrupting" for the Directive path, and this
// module keeps that distinction — a Directive is what `check` returns. Between two
// tool calls, and around every model round, the Run loop must let the user
// in — a Pause parks the loop and yields `paused`/resume status events, a
// Steering Directive corrects the objective, and Stop ends the run by
// throwing. That check used to be one pipeline generator the loop called
// under a local name while also reading the active run's flags directly.
//
// Named here, the loop has exactly one door for interruption. The Run's own
// hook is today's pause-aware steering checkpoint, side effects and all
// (the replan a consumed Directive triggers); a delegated worker (#154,
// step 2) satisfies the same shape with a cancel-only hook — it yields
// nothing, never returns a Directive, and throws when its parent cancels it.

/**
 * Stop, as every seam of a Run raises it (CONTEXT.md, Stop): the Abort
 * Head ends the Run by throwing this out of whatever it was doing —
 * between two tool calls, inside a gated execution, or while parked on a
 * decision window. It lives beside the interrupts seam because Stop is
 * one of the three things that reach a live Run from outside it.
 */
export class CommandAbortedError extends Error {
  constructor() {
    super('command aborted')
    this.name = 'CommandAbortedError'
  }
}

/** One Steering Directive, as the Run loop consumes it (CONTEXT.md, Directive). */
export type Directive = string

/**
 * What a Directive cancels, in the one wording every site uses: the tool
 * result a call abandoned mid-gate reads, the answer an open ask_user
 * window returns, and the Confirmation denial a landed Directive produces.
 */
export const STEERED_CANCELLED = 'cancelled by the user\'s steering'

/** The status a parked Run resumes into: the phase the caller was in. */
export type InterruptStatus = 'thinking' | 'acting'

/** The one hook through which the Run loop is interrupted. */
export interface RunInterrupts {
  /**
   * One interruption check. Parks while the Run is paused, yielding the
   * `paused` status event and the `status` event for `status` on the way
   * out. Returns the Steering Directive it consumed, or undefined when
   * none landed. Throws the run's abort error when the run is stopped —
   * before parking, on waking, and on entry.
   */
  check(status: InterruptStatus): AsyncGenerator<UnstampedEvent, Directive | undefined>
  /**
   * The mid-execution peek (#157). Parks while the Run is paused exactly
   * like `check`, but leaves any Directive that landed for the next
   * `check` to consume — it reports only whether one is waiting. The
   * gated execution seam asks between risk assessment and the
   * Confirmation window: a call the user has just steered away from is
   * cancelled rather than put to them for approval. Throws the run's
   * abort error when the run is stopped.
   */
  peek(status: InterruptStatus): AsyncGenerator<UnstampedEvent, boolean>
  /**
   * Stop, checked at a point that yields nothing: around a tool's own
   * execution, where a parked or steered Run has nothing to emit but a
   * stopped one must not return a result. Throws the run's abort error
   * when the run is stopped; returns otherwise.
   */
  throwIfStopped(): void
}
