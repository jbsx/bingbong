import type { RunId } from './sessionIdentity'

export const MAX_RUN_NOTE_CHARS = 1_200

export interface RunJournalEntry {
  readonly runId: RunId
  readonly outcome: 'done' | 'failed' | 'cancelled'
  readonly text: string
  /**
   * Why this Run stopped (#203), retained only when there is something a
   * later Run could not otherwise answer. Continuity, not a second
   * diagnostic store: it rides the Journal the model already receives, so
   * an explicit "why did you stop?" is answered from retained Run
   * information rather than a guess — and stays silent otherwise.
   */
  readonly stop?: RunStopRecord
}

/** Bound on each worded field of a retained stop record (#203). */
export const MAX_RUN_STOP_FIELD_CHARS = 240

/**
 * What a Run retains about its own stop (#203). The three fields are
 * deliberately separate, because they answer different questions and one
 * must never overwrite another (ADR 0038): `cause` is the authoritative
 * Finalization Cause the Run *entered* Finalization under, `detail` is
 * that cause's own worded specifics (the wall a `blocker` stop kept at),
 * and `failure` is a later execution failure recorded during Finalization
 * — the reserved Answer round throwing, replying off contract, or asking
 * for tools. A failed Answer round is additional information about a Run
 * that had already stopped; it is not why the Run stopped.
 */
export interface RunStopRecord {
  /**
   * The Finalization Cause the Run entered under. Absent when no rail
   * stopped the Run at all — a Run that failed outright never entered
   * Finalization, and naming a cause it did not stop for would be the
   * substitution ADR 0038 forbids. Only `failure` is true of that Run.
   */
  readonly cause?: FinalizationCause
  readonly detail?: string
  readonly failure?: string
}

/**
 * How much of the model's Journal budget one stop record spends (#203).
 * The wire client serializes the whole entry, so a record that the
 * Journal's own measure ignored would ride every request outside the
 * high, reserve, and hard watermarks — bounded continuity has to bound
 * this too.
 */
export function runStopChars(stop: RunStopRecord | undefined): number {
  if (stop === undefined) return 0
  return (stop.cause?.length ?? 0) + (stop.detail?.length ?? 0) + (stop.failure?.length ?? 0)
}

/** Trim and bound one worded stop field; empty text records nothing. */
function boundedStopField(text: string | undefined): string | undefined {
  if (text === undefined) return undefined
  const trimmed = text.trim().replace(/\s+/g, ' ')
  if (trimmed === '') return undefined
  return trimmed.length <= MAX_RUN_STOP_FIELD_CHARS
    ? trimmed
    : `${trimmed.slice(0, MAX_RUN_STOP_FIELD_CHARS - 1)}\u2026`
}

/**
 * The stop record a Run commits (#203), or null when it has nothing worth
 * retaining: a Run that simply answered stopped for no reason a later
 * "why did you stop?" needs explaining. The cause is the authoritative
 * one — whatever entered Finalization — and a later failure is recorded
 * beside it, never as it. A Run with a failure but no cause records the
 * failure alone: it never entered Finalization, so it has no cause, and
 * inventing one would be exactly the substitution ADR 0038 rules out.
 */
export function runStopRecord(input: {
  readonly cause: FinalizationCause | null
  readonly detail?: string
  readonly failure?: string
}): RunStopRecord | null {
  const detail = boundedStopField(input.detail)
  const failure = boundedStopField(input.failure)
  // `model_answered` and `objective_met` are the model concluding on its
  // own terms: nothing stopped the Run, so nothing is retained unless a
  // failure was actually recorded against it.
  const voluntary = input.cause === null || input.cause === 'model_answered' || input.cause === 'objective_met'
  if (voluntary && failure === undefined) return null
  return {
    ...(input.cause !== null && !voluntary ? { cause: input.cause } : {}),
    ...(detail !== undefined ? { detail } : {}),
    ...(failure !== undefined ? { failure } : {}),
  }
}

export type RunJournalSnapshot = readonly Readonly<RunJournalEntry>[]

/**
 * The semantic outcome of a Run (#108/#110): what the final Answer claims
 * about the work, carried beside — never instead of — the mechanical
 * `RunOutcome`. `completed` = the objective's completion standard is met;
 * `partial` = useful verified work exists but the standard is unmet;
 * `needs_user` = only a specific user choice or action can progress;
 * `blocked` = an external barrier prevented any useful result with no
 * presently actionable clearing step; `unsuccessful` = no useful result or
 * actionable next step was established.
 */
export const RUN_RESOLUTIONS = ['completed', 'partial', 'blocked', 'needs_user', 'unsuccessful'] as const
export type RunResolution = (typeof RUN_RESOLUTIONS)[number]

/**
 * Why a Run finalized (#108/#110), recorded separately from Resolution.
 * Every value except `objective_met` is runtime-owned — mechanically
 * knowable from the application's own rails — so the model can never
 * supply one; `objective_met` is the model's own claim that the
 * objective's standard is met, and `model_answered` is the fallback when
 * the model voluntarily concludes with no other cause applying.
 *
 * `blocker` is the same-wall Blocker gate's own stop (#202, ADR 0037):
 * the run kept interacting with a wall it was told it cannot pass, and
 * the gate — not the model — attests it. It is a runtime cause like any
 * other, so a model that proposes it is still dropped below; what
 * changed is that the runtime now reaches it.
 */
export const FINALIZATION_CAUSES = [
  'objective_met',
  'budget_exhausted',
  'deadline_reached',
  'no_progress',
  'blocker',
  'user_unavailable',
  'hard_limit',
  'model_answered',
  'parent_finalized',
] as const
export type FinalizationCause = (typeof FINALIZATION_CAUSES)[number]

/** The one Finalization Cause only the model can attest. */
const MODEL_FINALIZATION_CAUSE: FinalizationCause = 'objective_met'

/**
 * The Finalization Causes a Subagent alone can carry (#199, ADR 0035).
 * `parent_finalized` is the parent Run entering Finalization: a worker
 * stops for it, a Run never does — so the Run's Answer parser treats it
 * as malformed, the way it treats a cause the model cannot attest.
 */
const SUBAGENT_ONLY_FINALIZATION_CAUSES: readonly FinalizationCause[] = ['parent_finalized']

/** Parse a proposed Run Resolution; anything but the five values is null. */
export function parseRunResolution(value: unknown): RunResolution | null {
  return typeof value === 'string' && (RUN_RESOLUTIONS as readonly string[]).includes(value)
    ? (value as RunResolution)
    : null
}

/**
 * Parse a Finalization Cause a *Run* proposed; anything else is null. The
 * Subagent-only causes are rejected here (#199): a Run that names one is
 * naming something it cannot have stopped for.
 */
export function parseFinalizationCause(value: unknown): FinalizationCause | null {
  return typeof value === 'string' &&
    (FINALIZATION_CAUSES as readonly string[]).includes(value) &&
    !(SUBAGENT_ONLY_FINALIZATION_CAUSES as readonly string[]).includes(value)
    ? (value as FinalizationCause)
    : null
}

/** The finalization semantics recorded for a Run; null means unknown/not applicable. */
export interface RunFinalization {
  readonly resolution: RunResolution | null
  readonly finalizationCause: FinalizationCause | null
}

/**
 * Merge how a Run ended with what the final Answer proposed (#110). A
 * mechanically known cause overrides any conflicting proposal — the model
 * cannot claim a runtime rail stopped it — while the model's semantic
 * `objective_met` claim stands when nothing mechanical applies, and a
 * voluntary conclusion with no surviving proposal is `model_answered`.
 * Resolution is the Answer's semantic claim, so it rides only when a model
 * Answer proposed one; a mechanical stop alone records its cause and no
 * Resolution.
 */
export function finalizeRun(input: {
  /** The runtime's mechanically known cause, when one forced the end. */
  readonly mechanicalCause: FinalizationCause | null
  /** A valid model Answer concluded the Run. */
  readonly answered: boolean
  readonly proposedResolution?: RunResolution | null
  readonly proposedCause?: FinalizationCause | null
}): RunFinalization {
  const proposedCause = input.proposedCause ?? null
  const finalizationCause =
    input.mechanicalCause ??
    (proposedCause === MODEL_FINALIZATION_CAUSE ? proposedCause : input.answered ? 'model_answered' : null)
  return {
    resolution: input.answered ? (input.proposedResolution ?? null) : null,
    finalizationCause,
  }
}
