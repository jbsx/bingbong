import type { KeyPress } from '../ports/browser'
import type { DecisionUnavailableReason } from '../ports/decisionModel'
import type { CommandVerb } from './command'
import type { CommandAnswers } from './jevReading'

// The per-Command decision record (#324, ADR 0076): one JSON line per
// Command beside the perf log — what was heard, what was read and by whom,
// Jev's confidence and probabilities — and the Misfire signal, recorded
// when the next Command within the window is back, clear, escape or the
// opposite scroll. A Misfire is counted, never prevented: this log is the
// dataset the accuracy work starts from once Reaction is won.

/** Where the words came from. */
export type CommandSource = 'spoken' | 'typed'

/** Who settled the reading: the Local Match, Jev's top Choices, or the best guess that fires when Jev does not answer. */
export type CommandReading = 'local_match' | 'jev' | 'best_guess'

/** Jev's answer, as the record keeps it: the confidence of each Choice and the probabilities that mattered. */
export interface JevDetail {
  readonly model: string
  readonly latencyMs: number
  readonly confidence: { readonly verb: number; readonly target: number; readonly slot: number }
  readonly probabilities: {
    readonly verb: Readonly<Record<string, number>>
    readonly target: Readonly<Record<string, number>>
    readonly slot: Readonly<Record<string, number>>
  }
}

/** Jev did not answer: the reason, and how long the wait cost. */
export interface JevUnavailable {
  readonly model: string
  readonly latencyMs: number
  readonly reason: DecisionUnavailableReason
}

export interface DecisionRecord {
  readonly type: 'decision'
  readonly turnId: string
  /** Wall-clock epoch ms when the Command fired. */
  readonly at: number
  readonly source: CommandSource
  readonly transcript: string
  readonly reading: CommandReading
  readonly verb: CommandVerb
  readonly target: number | null
  readonly targetLabel?: string
  readonly slot: string | null
  /** Whether a Jev call was made for this Command. */
  readonly jevAsked: boolean
  /** Jev's answer, or why it gave none; absent when it was not asked. */
  readonly jev?: JevDetail | JevUnavailable
}

export type MisfireSignal = 'back' | 'clear' | 'escape' | 'opposite_scroll'

export interface MisfireRecord {
  readonly type: 'misfire'
  /** The Command the signal says misfired. */
  readonly turnId: string
  readonly at: number
  readonly signal: MisfireSignal
  /** The Command that carried the signal. */
  readonly signalTurnId: string
  readonly withinMs: number
}

export type CommandLogRecord = DecisionRecord | MisfireRecord

/** The next Command this long after one reads as its recovery. */
export const MISFIRE_WINDOW_MS = 3_000

/** How many target and Slot probabilities a record keeps — the top ones; the verb's are all kept. */
const KEPT_PROBABILITIES = 5

/**
 * Whether the next Command reads as the recovery of the one before: back,
 * clear, escape or the opposite scroll, inside the window. Null for none —
 * and for a Command before that fired nothing.
 */
export function misfireSignal(
  previous: { readonly verb: CommandVerb; readonly at: number },
  next: { readonly verb: CommandVerb; readonly key?: KeyPress; readonly at: number },
): MisfireSignal | null {
  if (previous.verb === 'none' || next.at - previous.at > MISFIRE_WINDOW_MS) return null
  switch (next.verb) {
    case 'back':
      return 'back'
    case 'clear':
      return 'clear'
    case 'press':
      return next.key?.key === 'Escape' ? 'escape' : null
    case 'scroll_up':
      return previous.verb === 'scroll_down' ? 'opposite_scroll' : null
    case 'scroll_down':
      return previous.verb === 'scroll_up' ? 'opposite_scroll' : null
    default:
      return null
  }
}

function topProbabilities(probabilities: Readonly<Record<string, number>>, keep: number): Record<string, number> {
  return Object.fromEntries(
    Object.entries(probabilities)
      .sort((a, b) => b[1] - a[1])
      .slice(0, keep),
  )
}

/** Jev's answers as the record keeps them. */
export function jevDetailOf(answers: CommandAnswers, latencyMs: number, model: string): JevDetail {
  return {
    model,
    latencyMs,
    confidence: { verb: answers.verb.confidence, target: answers.target.confidence, slot: answers.slot.confidence },
    probabilities: {
      verb: { ...answers.verb.probabilities },
      target: topProbabilities(answers.target.probabilities, KEPT_PROBABILITIES),
      slot: topProbabilities(answers.slot.probabilities, KEPT_PROBABILITIES),
    },
  }
}
