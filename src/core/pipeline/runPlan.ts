// The Run Plan (#116/#118, ADR 0027): the orchestrator's declaration of a
// Run's objective, Run Headline, and smallest sufficient Effort Tier —
// plus the tier completion standards (#118) every model-facing surface
// sources. Pure validation and vocabulary only — the pipeline owns the
// state machine, the tool (runPlanTools) only acknowledges. Missing or
// malformed plans never fail a Run: the fallback is a Lookup plan that
// keeps the Command Echo as the Peek Card's title.

import type { ToolCall } from '../ports/llm'

/** The bounded classes of autonomous work a Run may spend (glossary). */
export type EffortTier = 'direct_action' | 'lookup' | 'investigation'

export const EFFORT_TIERS: readonly EffortTier[] = ['direct_action', 'lookup', 'investigation']

/**
 * The tier a run without a declared plan runs under (#116): the one place
 * the default lives, so the pipeline, the history recorder, and telemetry
 * cannot drift apart.
 */
export const DEFAULT_EFFORT_TIER: EffortTier = 'lookup'

function isEffortTier(value: unknown): value is EffortTier {
  return typeof value === 'string' && (EFFORT_TIERS as readonly string[]).includes(value)
}

/**
 * What `completed` honestly demands per tier (#118, ADR 0027): the
 * completion standard each tier's final Answer is judged against —
 * Direct Actions by their returned state, Lookups by an authoritative
 * page or supported Candidate, Investigations by independent sources
 * that disclose disagreement.
 */
export const TIER_COMPLETION_STANDARDS: Readonly<Record<EffortTier, string>> = {
  direct_action: 'the action\u2019s returned state confirms the requested change',
  lookup: 'an authoritative page or a clearly supported best Candidate supports the result',
  investigation: 'multiple independent relevant sources support the result and any disagreement is disclosed',
}

/** The glossary label for each tier. */
const TIER_LABELS: Readonly<Record<EffortTier, string>> = {
  direct_action: 'Direct Action',
  lookup: 'Lookup',
  investigation: 'Investigation',
}

/** The one-line scope summary for each tier. */
const TIER_SUMMARIES: Readonly<Record<EffortTier, string>> = {
  direct_action: 'one immediate action',
  lookup: 'one page or one search for a fact',
  investigation: 'comparing multiple sources',
}

/**
 * The one tier vocabulary (#118): labels, ids, scopes, and completion
 * standards in a single string. The Run Plan tool description and the
 * orchestrator prompt both embed it, so the model-facing contract cannot
 * drift — and the shared bounded-browsing policy (#127) will source it
 * the same way.
 */
export function effortTierVocabulary(): string {
  const parts = EFFORT_TIERS.map(
    (tier) =>
      `${TIER_LABELS[tier]} (${tier}, ${TIER_SUMMARIES[tier]} — completed only when ${TIER_COMPLETION_STANDARDS[tier]})`,
  )
  return `${parts.slice(0, -1).join(', ')}, or ${parts.at(-1)}`
}

/** The Run's current plan — `headline: null` means the Command Echo stands. */
export interface RunPlan {
  objective: string
  headline: string | null
  effortTier: EffortTier
}

/** A parsed, well-formed report_run_plan call. */
export interface PlanReport {
  objective: string
  headline: string
  effortTier: EffortTier
  escalationReason?: string
}

/** The one corrective nudge a Run without a valid plan receives (#116). */
export const RUN_PLAN_NUDGE =
  'Every run declares a Run Plan: call report_run_plan alongside your useful work with ' +
  'objective (the task as you now understand it), headline (one short line in task terms — ' +
  'the run\u2019s live title on screen), and effort_tier (the smallest sufficient of ' +
  'direct_action, lookup, investigation). This run continues under the default Lookup plan.'

/** The per-call validation error once the corrective nudge has been spent. */
export const RUN_PLAN_INVALID =
  'Run Plan rejected: objective and headline must be non-empty strings and effort_tier one of ' +
  'direct_action, lookup, or investigation.'

export function lookupFallbackPlan(command: string): RunPlan {
  return { objective: command.trim(), headline: null, effortTier: DEFAULT_EFFORT_TIER }
}

/** Parses a report_run_plan call; null when any field is missing or malformed. */
export function parsePlanReport(call: ToolCall): PlanReport | null {
  const objective = typeof call.args.objective === 'string' ? call.args.objective.trim() : ''
  const headline = typeof call.args.headline === 'string' ? call.args.headline.trim() : ''
  const tier = call.args.effort_tier
  if (objective === '' || headline === '' || !isEffortTier(tier)) return null
  const reason = typeof call.args.escalation_reason === 'string' ? call.args.escalation_reason.trim() : ''
  return { objective, headline, effortTier: tier, ...(reason !== '' ? { escalationReason: reason } : {}) }
}

const TIER_LEVELS: Record<EffortTier, number> = { direct_action: 0, lookup: 1, investigation: 2 }

/** What a review of one plan report decided. */
export type PlanReview =
  | { kind: 'accepted'; plan: RunPlan }
  | { kind: 'escalation'; plan: RunPlan; reason: string }
  | { kind: 'rejected'; reason: string }

/**
 * Reviews a well-formed report against the Run's current plan. The first
 * model declaration is always accepted — the fallback Lookup plan is a
 * default, not a declaration, so it constrains nothing. Later reports
 * refresh the headline at the same tier or escalate exactly one level with
 * a reason; downgrades arrive only through a fresh Steering plan, which
 * the pipeline signals by clearing `modelDeclared`.
 */
export function reviewPlanReport(current: RunPlan | null, modelDeclared: boolean, report: PlanReport): PlanReview {
  const plan: RunPlan = { objective: report.objective, headline: report.headline, effortTier: report.effortTier }
  if (current === null || !modelDeclared) return { kind: 'accepted', plan }
  const level = TIER_LEVELS[report.effortTier] - TIER_LEVELS[current.effortTier]
  if (level === 0) return { kind: 'accepted', plan }
  if (level === 1) {
    if (report.escalationReason === undefined) {
      return { kind: 'rejected', reason: 'Run Plan rejected: escalating effort_tier requires escalation_reason stating the new evidence.' }
    }
    return { kind: 'escalation', plan, reason: report.escalationReason }
  }
  return {
    kind: 'rejected',
    reason:
      'Run Plan rejected: effort_tier changes one level at a time and never downgrades mid-run — ' +
      'continue at the current tier, or report a fresh plan after a Steering correction.',
  }
}
