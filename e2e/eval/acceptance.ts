import type { EvalReport, ScenarioResult } from './evaluator'

// Issue #128, closing #108's release acceptance: the frozen real-model
// baseline (e2e/eval/baseline.json, captured by #109 before any of
// #114–#127 landed) replayed against the complete bounded progressive
// browsing path (e2e/eval/report.json, captured by `pnpm test:eval` on
// the candidate). This module turns the two reports into the release
// decision — one gate per #108 criterion, each with the numbers it
// judged, and an overall accept/reject that #129's production switch
// depends on.
//
// Gates judge recorded data only; nothing here spends model budget. The
// mandatory safety/Session regressions run separately (`pnpm test:e2e`)
// and enter as an input, so the decision artifact states exactly what it
// witnessed. Live-web canaries never gate — they are a diagnostic section
// by design (#108: variable public sites must not block a release).
//
// Runtime imports stay out on purpose: node runs this module directly via
// `pnpm eval:accept` type stripping (#36), so everything it pulls is
// types plus this file's own logic.

/**
 * The deterministic rails' pre-execution refusal shapes — what #108's "no
 * repeated identical action after runtime refusal" scans for. The
 * redundancy rail and the Finalization tool closure refuse with
 * "Not executed — …", the search-loop rail with "Search loop limit (…".
 * The same-wall Blocker gate is deliberately excluded: its refusal is
 * recoverable by design (a successful different-host interaction lifts it,
 * and the user may clear the wall meanwhile), so a later retry that
 * executes is legitimate progress, not flailing.
 */
const RUNTIME_REFUSAL_PREFIXES = ['Not executed — ', 'Search loop limit ('] as const

/** True when a failed call's error text is a runtime rail's pre-execution refusal. */
export function isRuntimeRefusal(error: string | null | undefined): boolean {
  return typeof error === 'string' && RUNTIME_REFUSAL_PREFIXES.some((prefix) => error.startsWith(prefix))
}

/** #108: deterministic Direct Actions must complete at ≥95%. */
export const DIRECT_ACTION_COMPLETION_MIN = 0.95

/** #108: Lookups must complete correctly or resolve honestly partial at ≥90%. */
export const LOOKUP_CORRECT_OR_PARTIAL_MIN = 0.9

/** #108: median LLM rounds must fall ≥50% from the frozen baseline. */
export const MEDIAN_LLM_ROUNDS_MAX_FRACTION_OF_BASELINE = 0.5

/**
 * The Lookup-tier class: open-web Lookups and ambiguous-Candidate
 * identification. #108's completion standard for Lookups explicitly
 * includes "a clearly supported best Candidate", and both run as
 * Lookup-tier information retrieval — the corpus kinds `lookup` and
 * `candidate` are its members.
 */
const LOOKUP_KINDS: ReadonlySet<ScenarioResult['kind']> = new Set(['lookup', 'candidate'])

export type RegressionsInput = 'passed' | 'failed' | 'not-run'

export interface GateResult {
  /** The #108 criterion this gate decides, kebab-cased. */
  gate: string
  passed: boolean
  /** The numbers the gate judged, already human-readable. */
  detail: string
}

export interface RefusalViolation {
  scenarioId: string
  /** The repeated action as name+args, the key the refusal was recorded under. */
  action: string
}

export interface ReleaseDecision {
  decidedAt: string
  decision: 'accept' | 'reject'
  baseline: { commit: string; capturedAt: string }
  candidate: { commit: string; capturedAt: string }
  gates: GateResult[]
  /** Live-web canaries: diagnostic-only, reported separately, never a gate. */
  canaries: { status: 'not-run'; note: string }
}

function rate(numerator: number, denominator: number): string {
  return denominator === 0 ? '0/0' : `${numerator}/${denominator} (${Math.round((100 * numerator) / denominator)}%)`
}

/** Honest Lookup acceptance (#108): objective success, or a done run that resolved `partial`. */
function lookupAcceptable(scenario: ScenarioResult): boolean {
  return scenario.success || (scenario.metrics.outcome === 'done' && scenario.metrics.resolution === 'partial')
}

/**
 * #108: no repeated identical action may execute after the runtime
 * refused it. A refusal is per action key (name+args); the first later
 * successful execution of the same key after a runtime refusal of that
 * key is a violation — the rails exist so refused work never re-executes.
 */
export function refusalViolations(report: EvalReport): RefusalViolation[] {
  const violations: RefusalViolation[] = []
  for (const scenario of report.scenarios) {
    const refusedKeys = new Set<string>()
    // Artifacts predate fields (the frozen baseline's actions carry no
    // error text); the scan reads what is there and never assumes.
    for (const action of scenario.metrics.actions ?? []) {
      const key = `${action.name}:${JSON.stringify(action.args)}`
      if (!action.ok && isRuntimeRefusal(action.error)) refusedKeys.add(key)
      else if (action.ok && refusedKeys.has(key)) {
        refusedKeys.delete(key)
        violations.push({ scenarioId: scenario.id, action: key })
      }
    }
  }
  return violations
}

export function decideRelease(
  report: EvalReport,
  baseline: EvalReport,
  input: { regressions: RegressionsInput; decidedAt?: Date },
): ReleaseDecision {
  const rawLimitScenarios = report.scenarios.filter((scenario) => scenario.metrics.rawLimitFailure !== null)
  const directActions = report.scenarios.filter((scenario) => scenario.kind === 'direct-action')
  const directCompletions = directActions.filter((scenario) => scenario.success)
  const lookups = report.scenarios.filter((scenario) => LOOKUP_KINDS.has(scenario.kind))
  const lookupAccepted = lookups.filter(lookupAcceptable)
  const candidateMedian = report.aggregate?.llmRounds.median
  const baselineMedian = baseline.aggregate?.llmRounds.median
  const violations = refusalViolations(report)

  const gates: GateResult[] = [
    {
      gate: 'no-raw-limit-error',
      passed: rawLimitScenarios.length === 0,
      detail: `${rawLimitScenarios.length} of ${report.scenarios.length} scenarios ended with a raw round-limit error`,
    },
    {
      gate: 'direct-action-completion',
      passed:
        directActions.length > 0 && directCompletions.length / directActions.length >= DIRECT_ACTION_COMPLETION_MIN,
      detail: `${rate(directCompletions.length, directActions.length)} of deterministic Direct Actions completed — needs ≥95%`,
    },
    {
      gate: 'lookup-correct-or-partial',
      passed: lookups.length > 0 && lookupAccepted.length / lookups.length >= LOOKUP_CORRECT_OR_PARTIAL_MIN,
      detail: `${rate(lookupAccepted.length, lookups.length)} of Lookups completed correctly or resolved honest partial — needs ≥90%`,
    },
    {
      gate: 'median-llm-rounds',
      passed:
        candidateMedian !== undefined &&
        baselineMedian !== undefined &&
        candidateMedian <= baselineMedian * MEDIAN_LLM_ROUNDS_MAX_FRACTION_OF_BASELINE,
      detail:
        candidateMedian !== undefined && baselineMedian !== undefined
          ? `median ${baselineMedian} → ${candidateMedian} LLM rounds (${Math.round((100 * (baselineMedian - candidateMedian)) / baselineMedian)}% fall) — needs ≥50%`
          : 'median LLM rounds missing from a report aggregate',
    },
    {
      gate: 'no-action-after-runtime-refusal',
      passed: violations.length === 0,
      detail:
        violations.length === 0
          ? 'no action executed after a runtime refusal of the same action'
          : violations.map((violation) => `${violation.scenarioId}: ${violation.action}`).join('; '),
    },
    {
      gate: 'mandatory-regressions',
      passed: input.regressions === 'passed',
      detail: `mandatory safety and Session regressions (pnpm test:e2e): ${input.regressions}`,
    },
  ]

  return {
    decidedAt: (input.decidedAt ?? new Date()).toISOString(),
    decision: gates.every((gate) => gate.passed) ? 'accept' : 'reject',
    baseline: { commit: baseline.gitCommit, capturedAt: baseline.capturedAt },
    candidate: { commit: report.gitCommit, capturedAt: report.capturedAt },
    gates,
    canaries: {
      status: 'not-run',
      note: 'live-web canaries are diagnostic-only by design (#108) and gate nothing; none ship in this repo, so none ran',
    },
  }
}

/** The one-screen summary the script prints and the issue comment carries. */
export function formatDecision(decision: ReleaseDecision): string {
  const lines = [
    `release decision: ${decision.decision.toUpperCase()} (candidate ${decision.candidate.commit.slice(0, 7)} vs baseline ${decision.baseline.commit.slice(0, 7)})`,
  ]
  for (const gate of decision.gates) lines.push(`  ${gate.passed ? 'PASS' : 'FAIL'} ${gate.gate} — ${gate.detail}`)
  lines.push(`  canaries: ${decision.canaries.status} — ${decision.canaries.note}`)
  return lines.join('\n')
}
