import type { RunId } from './sessionIdentity'

export const MAX_RUN_NOTE_CHARS = 1_200

export interface RunJournalEntry {
  readonly runId: RunId
  readonly outcome: 'done' | 'failed' | 'cancelled'
  readonly text: string
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
] as const
export type FinalizationCause = (typeof FINALIZATION_CAUSES)[number]

/** The one Finalization Cause only the model can attest. */
const MODEL_FINALIZATION_CAUSE: FinalizationCause = 'objective_met'

/** Parse a proposed Run Resolution; anything but the five values is null. */
export function parseRunResolution(value: unknown): RunResolution | null {
  return typeof value === 'string' && (RUN_RESOLUTIONS as readonly string[]).includes(value)
    ? (value as RunResolution)
    : null
}

/** Parse a proposed Finalization Cause; anything but the eight values is null. */
export function parseFinalizationCause(value: unknown): FinalizationCause | null {
  return typeof value === 'string' && (FINALIZATION_CAUSES as readonly string[]).includes(value)
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
