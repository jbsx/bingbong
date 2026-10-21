import type { KeyPress, PageLanding } from '../ports/browser'
import type { DecisionUnavailableReason } from '../ports/decisionModel'
import type { CommandVerb } from './command'
import type { Capability } from './capability'
import type { MediaOpAction } from './mediaOp'
import type { CommandAnswers, HopAnswers } from './jevReading'

// The per-Command decision record (#324, ADR 0076): one JSON line per
// Command beside the perf log — what was heard, what was read and by whom,
// Jev's confidence and probabilities — and the Misfire signal, recorded
// when the next Command within the window is back, clear, escape or the
// opposite scroll. A Misfire is counted, never prevented: this log is the
// dataset the accuracy work starts from once Reaction is won.

/** Where the words came from. */
export type CommandSource = 'spoken' | 'typed'

/** Whose spelling a Name Match carried: the page's, or the user's own Learned Terms. */
export type NameSource = 'page' | 'learned'

/** Who settled the reading: the Local Match, Jev's top Choices, or the best guess that fires when Jev does not answer. */
export type CommandReading = 'local_match' | 'jev' | 'best_guess'

/** Jev's answer, as the record keeps it: the confidence of each Choice and the probabilities that mattered; `where` only when it was asked (#340). */
export interface JevDetail {
  readonly model: string
  readonly latencyMs: number
  readonly confidence: { readonly action: number; readonly slot: number; readonly amount?: number; readonly where?: number; readonly outcome?: number; readonly dismiss?: number; readonly steps?: number }
  readonly probabilities: {
    /** The action card's (#370): its top options. */
    readonly action: Readonly<Record<string, number>>
    readonly slot: Readonly<Record<string, number>>
    /** The Amount's (#372), on an ask that offered a media ref. */
    readonly amount?: Readonly<Record<string, number>>
    readonly where?: Readonly<Record<string, number>>
    /** The Verdict's, at a hop past the first. */
    readonly outcome?: Readonly<Record<string, number>>
    /** The dismiss Choice's (#354), at a hop read over a pop-up. */
    readonly dismiss?: Readonly<Record<string, number>>
    /** The steps Choice's (#364), at hop 0 of a line with a conjunction. */
    readonly steps?: Readonly<Record<string, number>>
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
  /** For a `play` Jev read (ADR 0079): the Capability its action card named (#370); absent otherwise. */
  readonly capability?: Capability
  /** For `media` (#372, ADR 0080): the op; for a seek the Amount rung read and the seconds it asked for (the outcome line in the Feed tells where the element went, which its range may have capped); for a volume or a speed, the level set. */
  readonly mediaOp?: MediaOpAction
  readonly target: number | null
  readonly targetLabel?: string
  readonly slot: string | null
  /** The Name Match (ADR 0077): the words heard where `slot` carries a name the page shows or the user taught instead; absent when the Slot is as heard. */
  readonly slotHeard?: string
  /** Where the Slot's name came from: the Page Terms, or the Learned Terms. */
  readonly slotFrom?: NameSource
  /** Whether a Jev call was made for this Command. */
  readonly jevAsked: boolean
  /** Jev's answer, or why it gave none; absent when it was not asked. */
  readonly jev?: JevDetail | JevUnavailable
  /** The id of the ask this reading came from, in asks-*.jsonl (#338); absent when Jev was not asked. */
  readonly ask?: string
  /** The Utterance spoken over the page hit the 30 s cap. */
  readonly truncated?: boolean
  /** The Command fired on a partial transcript, before the Endpoint (#326); absent for one read at the Endpoint. */
  readonly earlyFire?: EarlyFireDetail
  /** Jev calls made on this Utterance's partials (#326), whether one fired or not; absent when none was. */
  readonly partialCalls?: number
  /** Those calls' ask ids in asks-*.jsonl (#338), whether one fired or not; absent when none was made. */
  readonly partialAsks?: readonly string[]
  /** The Task this reading is a hop of (#328): hop 0's turn id, and which hop. */
  readonly task?: TaskHop
  /** How the Task ended, on its last hop's record (#328); absent on a hop it went on from. */
  readonly ended?: TaskEnded
  /** How the hop's navigation landed (#328): DOM-quiet, at its load, or `capped` at 3 s; absent for an action that left no page. */
  readonly landing?: PageLanding
  /** For `play` (#343): the YouTube video the Player opened or queued; absent for a verb on the element. */
  readonly video?: string
  /** For a `play` search (#345): its video was remembered for its words, or searched for; absent for a verb on the element. */
  readonly pick?: PickSource
  /** The hop stepped aside (#354): Jev read the pop-up as in the way, and the runner closed it instead of ending; `verb` and `target` are the dismissal's. */
  readonly stepAside?: true
  /** The runner closed what the hop before opened (#363): a dead end's Escape, or the opener pressed again; `verb` and `target` are its own. */
  readonly undo?: true
  /** The runner opened the previous reading's runner-up target after a dead end (#363): `verb` and `target` are its own. */
  readonly runnerUp?: true
  /** The action threw: its message, so a failed Command explains itself here and not only in the Feed (post mortem 2026-10-19). */
  readonly error?: string
  /**
   * The line was read as Steps (#364), on the first Step's hop 0: the ask
   * that split it — the whole line's, with the steps Choice — Jev's answer
   * to it, each Step's words, and the line itself (absent in records before
   * 2026-10-21). The record's own `ask` and `jev` are the first Step's
   * reading.
   */
  readonly split?: { readonly ask: string; readonly jev: JevDetail; readonly steps: readonly string[]; readonly line?: string }
}

/** Where a `play` search's video came from (#345): the Remembered Songs, or YouTube's results. */
export type PickSource = 'remembered' | 'searched'

/**
 * Where a Command stands in its Task (#328, ADR 0076 amendment): the Task's
 * id is hop 0's turn id. In a line read as Steps (#364), every Step's Task
 * carries the line's id — its first Step's hop 0 turn — and which Step of
 * how many it is; each Step counts its hops from 0.
 */
export interface TaskHop {
  readonly id: string
  readonly hop: number
  readonly step?: number
  readonly of?: number
  /** At a hop past the first: the Progress Noul's probability that the last action brought the page closer to the words (#373). */
  readonly progress?: number
}

/** How many actions a Task may fire, hop 0's and scrolls included (#328): the fifth ends it where it stands (`cap`). */
export const MAX_TASK_ACTIONS = 5

/**
 * Why a Task ended: a sure Verdict that the page is what was asked for
 * (`done`); a reading with no next step and a sure yes is `done` too, and
 * with no sure Verdict it is `unsure`, said so; the cap of five actions; a wall (a failure,
 * a Blocked Action, a Blocker, consent, not-found, unavailable or empty
 * landing, or a sure Verdict that something is in the way); Jev
 * unavailable (hop 0's best guess included); superseded; a Local-Matched
 * hop 0; a terminal verb (read, stop, clear, or `none` at hop 0); two hops
 * in a row that changed nothing (#336); a dead end once the Task had
 * looked again — closed what it opened, tried the runner-up — and found
 * nothing (`not_found`, #363), said so with the words.
 */
export type TaskEnded = 'done' | 'unsure' | 'cap' | 'wall' | 'unavailable' | 'superseded' | 'local_match' | 'terminal' | 'unchanged' | 'not_found'

/** An Early Fire as the record keeps it. */
export interface EarlyFireDetail {
  /** The partial transcript the Command fired on. */
  readonly partial: string
  /** How long before the Endpoint it fired; absent when the Utterance never reached one (the Listen closed under it). */
  readonly leadMs?: number
  /** Jev's "complete command?" Noul, when Jev settled the partial. */
  readonly noul?: number
}

/**
 * `overrun` (#328): Escape, "stop" or a new Utterance soon after a Jev-read
 * hop fired — the Task went on past what the user wanted.
 */
export type MisfireSignal = 'back' | 'clear' | 'escape' | 'opposite_scroll' | 'overrun'

export interface MisfireRecord {
  readonly type: 'misfire'
  /** The Command the signal says misfired. */
  readonly turnId: string
  readonly at: number
  readonly signal: MisfireSignal
  /** The Command that carried the signal; absent for an overrun Escape or the Abort Head carried, which is no Command. */
  readonly signalTurnId?: string
  readonly withinMs: number
  /** For an overrun: the hop of its Task the signal counts against. */
  readonly hop?: number
}

export type CommandLogRecord = DecisionRecord | MisfireRecord

/** The next Command this long after one reads as its recovery. */
export const MISFIRE_WINDOW_MS = 3_000

/** How many Slot, dismiss and steps probabilities a record keeps — the top ones. */
const KEPT_PROBABILITIES = 5

/** How many of the action card's probabilities a record keeps (#370): the top ones, so a runner-up and a near miss are both in view. */
const KEPT_ACTIONS = 8

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
export function jevDetailOf(answers: CommandAnswers | HopAnswers, latencyMs: number, model: string): JevDetail {
  const amount = 'amount' in answers ? answers.amount : undefined
  const where = 'where' in answers ? answers.where : undefined
  const outcome = 'outcome' in answers ? answers.outcome : undefined
  const dismiss = 'dismiss' in answers ? answers.dismiss : undefined
  const steps = 'steps' in answers ? answers.steps : undefined
  return {
    model,
    latencyMs,
    confidence: {
      action: answers.action.confidence,
      slot: answers.slot.confidence,
      ...(amount !== undefined ? { amount: amount.confidence } : {}),
      ...(where !== undefined ? { where: where.confidence } : {}),
      ...(outcome !== undefined ? { outcome: outcome.confidence } : {}),
      ...(dismiss !== undefined ? { dismiss: dismiss.confidence } : {}),
      ...(steps !== undefined ? { steps: steps.confidence } : {}),
    },
    probabilities: {
      action: topProbabilities(answers.action.probabilities, KEPT_ACTIONS),
      slot: topProbabilities(answers.slot.probabilities, KEPT_PROBABILITIES),
      ...(amount !== undefined ? { amount: { ...amount.probabilities } } : {}),
      ...(where !== undefined ? { where: { ...where.probabilities } } : {}),
      ...(outcome !== undefined ? { outcome: { ...outcome.probabilities } } : {}),
      ...(dismiss !== undefined ? { dismiss: topProbabilities(dismiss.probabilities, KEPT_PROBABILITIES) } : {}),
      ...(steps !== undefined ? { steps: topProbabilities(steps.probabilities, KEPT_PROBABILITIES) } : {}),
    },
  }
}
