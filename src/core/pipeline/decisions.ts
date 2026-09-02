import type { ToolCall, ToolResultOutcome } from '../ports/llm'
import type { UnstampedEvent } from './events'

// Issue #154, step 2's prefactor (#156): the decisions seam.
//
// Vocabulary (CONTEXT.md): a Confirmation is the user's approval of one
// consequential action, reserved for exactly those (ADR 0015); an ask_user
// question is the Run asking for something only the user knows. Both are
// timed windows the Run parks on, and paused time never counts against the
// Run's effort (ADR 0024, ADR 0027). A gated tool
// execution has exactly two reasons to reach the user — it must ask a
// question (`ask_user`, Tier 3) or it must get an action approved (a
// Confirmation verdict from the risk tiers). Both used to be choreographed
// inline in the gate: mint an id, emit the request event, speak the line,
// wait through pauses on the pause-aware timed decision window, emit the
// resolution, and word the outcome the model reads. Named here, the gate
// asks for an answer and gets one back.
//
// The interface is the point: the Run's own adapter is today's pipeline
// choreography, while a delegated worker (#154, step 2) satisfies the same
// shape with a decisions adapter that simply refuses — a worker has no user
// to ask. Nothing in the gate changes when it is handed the refusing one.

/**
 * A Confirmation's verdict as the gate consumes it: approval carries
 * nothing, a denial carries the exact outcome the model reads — the
 * timeout, steered, or denied wording, each ending in "do not retry this
 * action".
 */
export type ConfirmDecision = { approved: true } | { approved: false; outcome: ToolResultOutcome }

/** The one adapter through which gated execution reaches the user. */
export interface RunDecisions {
  /**
   * Puts one question to the user and returns the tool result the model
   * sees: their answer, the "user didn't answer" line when the window
   * closed unanswered, or the steered cancellation when a directive
   * landed instead. Speaks the question before the window opens, and
   * yields the run's `ask_requested` / `ask_deadline` / `ask_resolved`
   * events on the way. Throws the run's abort error when the run is
   * stopped.
   */
  ask(question: string, call: ToolCall): AsyncGenerator<UnstampedEvent, ToolResultOutcome>
  /**
   * Puts one Confirmation prompt to the user and returns approval or the
   * denial outcome. Yields the `confirmation_requested` /
   * `confirmation_deadline` / `confirmation_resolved` events and speaks
   * the prompt. Throws the run's abort error when the run is stopped.
   */
  confirm(prompt: string, call: ToolCall): AsyncGenerator<UnstampedEvent, ConfirmDecision>
}
