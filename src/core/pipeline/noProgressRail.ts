import type { ToolCall, ToolResultOutcome } from '../ports/llm'
import type { ObservationProducer } from '../session/observationLedger'
import { actionFingerprint, pageFingerprint, type SettledPageState } from './progressFingerprints'
import { classifyToolObservation } from './toolObservations'

// Issue #126, ADR 0027: the no-progress rails. The #125 fingerprints
// (query intent, URL, targeted action, settled page state) become
// behavior here, at two scales:
//
// — Objective repetition: the same action fingerprint attempted again
//   while the page sits where the previous attempt found it is
//   redundant — nudged first, refused pre-execution next. Meaningful
//   progression (scroll, pagination, dialog, content, media — anything
//   the settled-state fingerprint sees) makes the next attempt a fresh
//   pair, and a first-party alternate representation of one source
//   (its print/JSON/AMP rendering) folds to the same state, so a
//   URL-only jump is not Progress.
//
// — Approach exhaustion: Progress means new decision-relevant material
//   arrived — the settled state moved, or a producer that had not yet
//   observed the state it sits in observed it (#161) — or the run made a
//   requested state change, or an Evidence Checkpoint was accepted. Two
//   consecutive successful actions with none of those exhaust an
//   Approach; the model is instructed to change it. A second exhausted
//   Approach trips Finalization (mechanical cause `no_progress`) — the pipeline
//   enters the same terminal phase budget exhaustion does.
//
//   The producer clause (#161) is Progress in full, not a weaker tier:
//   material is material, and the accounting starts over the way a moved
//   page starts it over. What bounds it is the ledger — one settled
//   state grants each Observation Producer exactly one first
//   observation, so a run that never moves the page can restart the
//   accounting at most as many times as it has page-facing producers,
//   and a run that does move it made Progress anyway.
//
// The rail is deterministic and side-effect free apart from reading the
// settled state through the injected source; without one (tests, lean
// pipelines) it is inert. It never judges prose, only fingerprints.

/** Successful actions without Progress that exhaust one Approach (#126/AC4). */
export const NO_PROGRESS_ACTIONS_PER_APPROACH = 2

/** Exhausted Approaches after which the run finalizes for `no_progress` (#126/AC4). */
export const EXHAUSTED_APPROACHES_BEFORE_FINALIZATION = 2

/** Bookkeeping whose acceptance is decision-relevant evidence (#126/AC3). */
const CHECKPOINT_TOOLS: ReadonlySet<string> = new Set(['record_evidence', 'record_candidate'])

/** Successful calls that are themselves the requested state change (#126/AC3). */
const STATE_CHANGE_TOOLS: ReadonlySet<string> = new Set([
  'set_setting',
  'app_control',
  'toggle_panel',
  'set_panel_mode',
  'set_panel_width',
])

/** The advisory nudge riding the first equivalent action against equivalent state. */
const REDUNDANCY_NUDGE =
  'That action repeats an equivalent action against unchanged page state — it will not produce anything new. ' +
  'Change what you do next: a different target, query, or source — or answer from the evidence you already have.'

/** The pre-execution refusal for the next equivalent action against equivalent state. */
const REDUNDANCY_REFUSAL =
  'Not executed — this action repeats an equivalent action against unchanged page state. Change strategy: ' +
  'a different target, query, or source — or answer from the evidence you already have. ' +
  'A page change or a different action clears this.'

/** The instruction riding the result that exhausts an Approach (#126/AC4). */
const APPROACH_CHANGE_INSTRUCTION =
  'Two consecutive actions made no progress — no new decision-relevant evidence, no requested state change. ' +
  'Change your Approach: a genuinely different strategy, not a rephrasing of this one. ' +
  'If you cannot proceed differently, answer with what you have.'

/**
 * The Finalization directive riding the action that exhausts the second
 * Approach — parallel to FINALIZATION_ANSWER_DIRECTIVE's vocabulary, for
 * the no_progress cause. The Run's wording; a caller whose Finalization
 * reads differently injects its own (#159: a Browse Subagent finalizes
 * into a report, not an answer, and has no bookkeeping to do).
 */
export const ORCHESTRATOR_APPROACH_EXHAUSTED_DIRECTIVE =
  'A second Approach has made no progress — the run is finalizing. Acquisition, vision, media, delegation, and ' +
  'ask_user tools are closed. Finalize now: reply with your final answer JSON and state honestly what was and ' +
  'was not completed.'

export interface NoProgressRailDeps {
  /**
   * What the action exhausting the second Approach tells the model
   * (#159). Defaults to the Run's; a Browse Subagent injects its own, the
   * way the Blocker gate's escalation already is.
   */
  approachExhaustedDirective?: string
  /**
   * The visible tab's settled page state (#125's SettledPageState): read
   * at gate time (the state an attempt starts from) and after each
   * successful page-facing action (the state it left). Absent — the rail
   * is inert; it never judges actions it cannot observe.
   */
  settledState?: () => Promise<SettledPageState | null> | SettledPageState | null
}

export interface NoProgressRail {
  /**
   * Pre-execution gate (blocker/vision-budget pattern): refuses an
   * action fingerprint already attempted — and nudged — against the
   * state the page currently sits in. Every other call passes.
   */
  gate(call: ToolCall): Promise<{ ok: true } | { ok: false; reason: string }>
  /**
   * Post-execution observation of every processed call: the no-progress
   * accounting and the nudges that ride results. Failures and non-page
   * calls other than checkpoints and state changes are neutral. Returns
   * the advisory for this call's result, null for none.
   */
  observe(call: ToolCall, outcome: ToolResultOutcome): Promise<string | null>
  /** A Steering replan: fresh objective, fresh approach accounting. */
  reset(): void
  /** True once two Approaches exhausted — the run must finalize for `no_progress`. */
  finalizationDue(): boolean
}

/** One action fingerprint's last attempt: the state it started from, and whether its repeat was nudged. */
interface AttemptRecord {
  preState: string | null
  nudged: boolean
}

export function createNoProgressRail(deps: NoProgressRailDeps = {}): NoProgressRail {
  const settledState = deps.settledState
  const approachExhaustedDirective = deps.approachExhaustedDirective ?? ORCHESTRATOR_APPROACH_EXHAUSTED_DIRECTIVE
  // The settled state as of the last successful page-facing read — the
  // Progress baseline. Null before the first read: the baseline cannot
  // itself be no-progress.
  let lastState: string | null = null
  const attempts = new Map<string, AttemptRecord>()
  // Which Observation Producers have already observed each settled state
  // (#161). A state a Producer has not observed yet still holds material
  // for it — the first read_page of a page and the first look at it are
  // different evidence; the second of either is inspection. Keyed by
  // state, so returning to a page already studied re-earns nothing.
  const observedBy = new Map<string, Set<ObservationProducer>>()
  // The gate's nudge rides the observed result of the call it nudged —
  // single-slot between one call's gate and observe, like the search-loop
  // rail's type memo.
  let pendingNudge: ToolCall | null = null
  let noProgress = 0
  let exhaustedApproaches = 0
  let tripped = false

  function isPageFacing(name: string): boolean {
    return classifyToolObservation(name).pageFacing
  }

  function producerOf(name: string): ObservationProducer {
    return classifyToolObservation(name).producer
  }

  /**
   * Records that `producer` has now observed `fingerprint`; true when it
   * had not before — the first observation of that state by that
   * producer, which is new decision-relevant material (#161).
   */
  function markObserved(fingerprint: string, producer: ObservationProducer): boolean {
    const producers = observedBy.get(fingerprint)
    if (producers === undefined) {
      observedBy.set(fingerprint, new Set([producer]))
      return true
    }
    if (producers.has(producer)) return false
    producers.add(producer)
    return true
  }

  async function currentStateFingerprint(): Promise<string | null> {
    if (settledState === undefined) return null
    try {
      const state = await settledState()
      return state === null ? null : pageFingerprint(state).state
    } catch {
      return null
    }
  }

  /** Progress resets: the applicable rail and the Approach accounting both start over (#126/AC3). */
  function progress(): void {
    noProgress = 0
    exhaustedApproaches = 0
  }

  /** What a successful no-progress action escalates to, if any. */
  function escalate(): string | null {
    noProgress += 1
    if (noProgress < NO_PROGRESS_ACTIONS_PER_APPROACH) return null
    exhaustedApproaches += 1
    noProgress = 0
    if (exhaustedApproaches >= EXHAUSTED_APPROACHES_BEFORE_FINALIZATION) {
      tripped = true
      return approachExhaustedDirective
    }
    return APPROACH_CHANGE_INSTRUCTION
  }

  return {
    async gate(call) {
      if (settledState === undefined || tripped || !isPageFacing(call.name)) return { ok: true }
      const live = await currentStateFingerprint()
      if (live === null) return { ok: true }
      const key = actionFingerprint(call)
      const prior = attempts.get(key)
      // A remembered pair means the previous attempt faced exactly this
      // state and left it unchanged (an attempt that moves the page
      // forgets its pair in observe) — so a repeat is objectively
      // redundant: nudged first, refused next.
      if (prior !== undefined && prior.preState === live) {
        if (prior.nudged) return { ok: false, reason: REDUNDANCY_REFUSAL }
        prior.nudged = true
        pendingNudge = call
      } else {
        attempts.set(key, { preState: live, nudged: false })
      }
      return { ok: true }
    },

    async observe(call, outcome) {
      if (settledState === undefined || tripped) return null
      // Accepted Evidence Checkpoints are decision-relevant evidence;
      // rejected ones contribute to no-progress handling (#121/#126/AC3).
      if (CHECKPOINT_TOOLS.has(call.name)) {
        if (!outcome.ok) return escalate()
        progress()
        return null
      }
      // A successful requested state change is Progress by definition; a
      // failed one changed nothing and stays neutral.
      if (STATE_CHANGE_TOOLS.has(call.name)) {
        if (outcome.ok) progress()
        return null
      }
      if (!isPageFacing(call.name)) return null
      const nudged = pendingNudge === call
      if (nudged) pendingNudge = null
      if (!outcome.ok) {
        // A nudged attempt that never executed — the risk tier denied it,
        // or the tool failed — never showed the model its nudge: replay
        // it on the next equivalent attempt instead of refusing blind.
        if (nudged) {
          const entry = attempts.get(actionFingerprint(call))
          if (entry !== undefined) entry.nudged = false
        }
        return null
      }
      const nudge = nudged ? REDUNDANCY_NUDGE : null
      const fingerprint = await currentStateFingerprint()
      if (fingerprint === null) return nudge
      const key = actionFingerprint(call)
      const entry = attempts.get(key)
      if (entry !== undefined && entry.preState !== fingerprint) {
        // The action moved the page, so its pair is spent: the next
        // attempt of this same fingerprint starts from the state this
        // one produced — a fresh equivalence. Scrolling, pagination, and
        // media toggles continue instead of reading as repeats.
        attempts.delete(key)
      }
      const firstByThisProducer = markObserved(fingerprint, producerOf(call.name))
      if (lastState === null) {
        // The baseline read: the state Progress is measured from, not
        // itself an action that failed to make it (#126/AC1 — the first
        // attempt is never redundant or no-progress).
        lastState = fingerprint
        return nudge
      }
      if (fingerprint !== lastState) {
        // The action moved the page — or observed it move: either way new
        // material arrived.
        lastState = fingerprint
        progress()
        return nudge
      }
      lastState = fingerprint
      if (firstByThisProducer) {
        // The page sits where it was, but this Observation Producer had
        // not observed it: reading a page that has only been looked at,
        // or looking at one that has only been read, is new material
        // rather than a repeat (#161). A loop whose catalog holds no
        // checkpoint or state-change tool has no other way to say so.
        progress()
        return nudge
      }
      const escalated = escalate()
      return escalated === null ? nudge : nudge === null ? escalated : `${nudge}\n\n${escalated}`
    },

    reset() {
      attempts.clear()
      observedBy.clear()
      pendingNudge = null
      noProgress = 0
      exhaustedApproaches = 0
      // A corrected objective reopens work (#119): the no_progress trip
      // belonged to the stale one, and so did what each producer had
      // already learned — the same page read against a new question is
      // material again. The page state survives — it is where it is,
      // whatever the run now plans to do there.
      tripped = false
    },

    finalizationDue: () => tripped,
  }
}
