// The real-model witness a capture carries (#109/#166), in a module with no
// runtime imports: `scripts/delegation-summary.ts` runs under plain node,
// which cannot resolve the extensionless relative imports the evaluator and
// its harness use, so anything a script needs at runtime lives here.

import type { ReasoningEffort } from '../../src/core/ports/llm'

export interface ModelWitness {
  orchestratorModel: string | null
  orchestratorRequests: number
  /**
   * The reasoning-effort rung this capture ran at (#166): the override in
   * force, or null when each Run's Effort Tier decided its own. The one
   * variable a pooled reading must not average over silently — like the
   * orchestrator model beside it. Absent on captures taken before #166,
   * which ran every round at the provider's default.
   */
  reasoningEffort?: ReasoningEffort | null
  /** Non-empty means a scripted model served something — fails the suite. */
  scriptedEntries: { role: string; model: string }[]
}

/**
 * How a capture's rung reads in a summary line (#166): the forced rung, the
 * tier map, or a pre-#166 capture that ran at the provider's default.
 */
export function reasoningEffortLabel(witness: ModelWitness): string {
  if (witness.reasoningEffort === undefined) return 'effort:pre-166'
  return witness.reasoningEffort === null ? 'effort:per-tier' : `effort:${witness.reasoningEffort}`
}

/**
 * The rung two captures must agree on to pool (#166). Pre-#166 captures ran
 * at the provider's default, which is the same rung `max` names, so they are
 * comparable with a forced-`max` pass and not with anything else.
 */
export function pooledEffortContract(witness: ModelWitness): string {
  if (witness.reasoningEffort === undefined) return 'pre-166-default'
  return witness.reasoningEffort === null ? 'per-tier' : witness.reasoningEffort
}
