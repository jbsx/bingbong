import type { ToolResultOutcome } from '../ports/llm'
import { reportFault } from '../trace/fault'

// Issue #154, step 1: the Notices module. Six model-facing advisory
// lines ride tool results — the search-loop nudge, the no-progress nudge,
// the Run Plan's corrective nudge, the Effort Epoch's budget warning, its
// Finalization directive, and (#158) the Browse Subagent's own
// Finalization directive. Their precedence used to be the order of
// five `if` statements in the Run loop, and the Run Plan nudge's "owed
// until it actually lands" rule was one boolean set and cleared from five
// places. This module owns all of that as data: one precedence table, one
// delivery guard, and the immediate-vs-owed distinction.
//
// Vocabulary (CONTEXT.md, Notice): a Notice rides only a successful
// string result — an error already tells the model what happened, and a
// structured result cannot carry prose. The one exception is a directive
// that closes the loop rather than advising inside it (#158, a Browse
// Subagent's Finalization directive): its next round is its last, so the
// directive must reach it however the result it rides read. An immediate
// Notice is the rail's verdict on this very call: it rides this result or
// is dropped. An owed Notice persists until some later result can carry
// it. Two kinds — the budget warning and the Run's Finalization directive
// — are owed by the Effort Epoch itself, which keeps their state and
// supersession (#117/#148); the module reaches them through a standing
// supplier consulted only when the kind's guard passes, so a warning is
// worded at delivery, never earlier.
//
// Deterministic and side-effect free apart from consulting suppliers; no
// clock, no tool names — "useful work" is the caller's judgement, passed
// in per result.

/** The six Notice kinds, named by their source. */
export type NoticeKind =
  | 'search_loop'
  | 'no_progress'
  | 'run_plan'
  | 'budget'
  | 'finalization'
  | 'subagent_finalization'

/**
 * Delivery order when several Notices ride one result (#74/#126/#116/#117):
 * rail verdicts first, the plan correction next, the epoch's warning and
 * directive last — the model reads what this call did before what the
 * run as a whole owes it. A worker's Finalization directive (#158) is
 * last of all: it is the only one that ends the loop.
 */
export const NOTICE_PRECEDENCE: readonly NoticeKind[] = [
  'search_loop',
  'no_progress',
  'run_plan',
  'budget',
  'finalization',
  'subagent_finalization',
]

interface NoticeRule {
  /** Immediate: rides this result or is dropped. Owed: persists until a result can carry it. */
  readonly persistence: 'immediate' | 'owed'
  /**
   * Success: any successful string result. Useful work: additionally not
   * bookkeeping and not a Finalization-phase result — the plan nudge and
   * the budget warning never ride a `report_run_plan` acknowledgement or
   * a result of a round whose work is already over. Always: whatever the
   * result read, error and structured results included — reserved for a
   * directive the model's last round must not miss (#158).
   */
  readonly rides: 'success' | 'useful_work' | 'always'
}

const RULES: Readonly<Record<NoticeKind, NoticeRule>> = {
  search_loop: { persistence: 'immediate', rides: 'success' },
  no_progress: { persistence: 'immediate', rides: 'success' },
  run_plan: { persistence: 'owed', rides: 'useful_work' },
  budget: { persistence: 'owed', rides: 'useful_work' },
  finalization: { persistence: 'owed', rides: 'success' },
  subagent_finalization: { persistence: 'owed', rides: 'always' },
}

export interface NoticeAttachContext {
  /**
   * Whether this result is useful work: a successful string result that
   * is neither bookkeeping nor produced in Finalization. The caller
   * decides — it knows the call and the phase; the module does not.
   */
  readonly usefulWork: boolean
}

export interface Notices {
  /**
   * Owes a text Notice of one kind, replacing any still-owed text of that
   * kind. `null` owes nothing, so a rail's `observe` verdict can be passed
   * straight through.
   */
  owe(kind: NoticeKind, text: string | null): void
  /**
   * Registers a standing source for a kind whose owner keeps its own owed
   * state (the Effort Epoch's `takeBudgetWarning` / `takeFinalizationNotice`).
   * Consulted at each attach where the kind's guard passes; a null answer
   * means nothing is owed right now.
   */
  supply(kind: NoticeKind, take: () => string | null): void
  /**
   * The one delivery site: appends every Notice this result can carry, in
   * precedence order, and drops the immediate ones it cannot. Returns the
   * outcome the model (and the Feed) sees.
   */
  attach(outcome: ToolResultOutcome, context: NoticeAttachContext): ToolResultOutcome
  /** Withdraws an owed text (a valid plan arrived; Finalization entered). Delivery history stays. */
  clear(kind: NoticeKind): void
  /** Whether a text Notice of this kind has landed on a result this epoch — through attach or markDelivered. */
  delivered(kind: NoticeKind): boolean
  /** Records a delivery made through another channel — the plan's corrective error result (#116). */
  markDelivered(kind: NoticeKind): void
  /**
   * A Steering replan (#119): the corrected objective starts with nothing
   * owed and nothing yet delivered. Suppliers stay registered — their
   * owners re-arm themselves.
   */
  replan(): void
}

/** A structured result as prose, so a must-ride directive can join it. */
function renderResult(result: unknown): string {
  try {
    return JSON.stringify(result) ?? 'tool result'
  } catch (error) {
    reportFault('pipeline.notices.renderResult', error)
    return 'tool result'
  }
}

export function createNotices(): Notices {
  const owed = new Map<NoticeKind, string>()
  const suppliers = new Map<NoticeKind, () => string | null>()
  const deliveredKinds = new Set<NoticeKind>()

  function take(kind: NoticeKind): string | null {
    const text = owed.get(kind)
    if (text !== undefined) {
      owed.delete(kind)
      return text
    }
    return suppliers.get(kind)?.() ?? null
  }

  return {
    owe(kind, text) {
      if (text === null) return
      owed.set(kind, text)
    },
    supply(kind, supplier) {
      suppliers.set(kind, supplier)
    },
    attach(outcome, context) {
      // An error or a structured result carries only the kinds whose rule
      // says they ride always: everything else is dropped when it was this
      // call's own verdict, and waits when it was owed.
      const prose = outcome.ok && typeof outcome.result === 'string'
      const carried: string[] = []
      for (const kind of NOTICE_PRECEDENCE) {
        const rule = RULES[kind]
        if (!prose && rule.rides !== 'always') {
          if (rule.persistence === 'immediate') owed.delete(kind)
          continue
        }
        if (rule.rides === 'useful_work' && !context.usefulWork) continue
        const text = take(kind)
        if (text === null) continue
        deliveredKinds.add(kind)
        carried.push(text)
      }
      if (carried.length === 0) return outcome
      if (outcome.ok) {
        // A structured result cannot carry prose on its own, so it is
        // rendered before the directive joins it — the model reads both.
        const payload = typeof outcome.result === 'string' ? outcome.result : renderResult(outcome.result)
        return { ok: true, result: [payload, ...carried].join('\n\n') }
      }
      return { ok: false, error: [outcome.error, ...carried].join('\n\n') }
    },
    clear(kind) {
      owed.delete(kind)
    },
    delivered(kind) {
      return deliveredKinds.has(kind)
    },
    markDelivered(kind) {
      deliveredKinds.add(kind)
    },
    replan() {
      owed.clear()
      deliveredKinds.clear()
    },
  }
}
