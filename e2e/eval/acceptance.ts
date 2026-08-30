import { nearestRankPercentile } from '../../src/core/report/stats.ts'
import type { EvalReport, ScenarioResult } from './evaluator'

// Issue #128, closing #108's release acceptance; amended by #132. The
// decision judges POOLS of real-model captures — three complete passes per
// side — never a single pass: on the #130 production-weighted corpus a
// single-pass p95 is noise-dominated on both sides (the frozen old-path
// capture never exceeded 9 rounds while its sibling passes' lookups and
// clicks ran 12–20), so a one-vs-one comparison rejects a structurally
// bounded candidate against a lucky baseline. Each pool is validated for
// provenance before it can produce a decision: one source commit per side
// (the baseline side pinned to the pre-#114 tree, git 2343a3c, captured
// via worktree + eval overlay), identical scenario ids in identical order,
// one model/routing contract, and the real-model witness on every
// capture; the candidate pool must all represent one candidate commit.
//
// Pooled statistics are computed from the raw per-scenario round counts —
// nearest-rank over the pooled scenario population (93 observations at
// corpus weight), never an average of pass-level percentiles. Everything
// else #108 gates stays as amended by #128: p95 must halve against the
// pooled baseline, the median must not regress. Every candidate-side gate
// judges the pooled population too — there is no single candidate report
// to fall back on, and per-pass judgement would reintroduce the
// single-pass noise the pools exist to absorb.
//
// Gates judge recorded data only; nothing here spends model budget. The
// mandatory safety/Session regressions run separately (`pnpm test:e2e`)
// and enter as an input, so the decision artifact states exactly what it
// witnessed. Live-web canaries never gate — they are a diagnostic section
// by design (#108: variable public sites must not block a release).
//
// Runtime imports stay minimal on purpose: node runs this module directly
// via `pnpm eval:accept` type stripping (#36), so everything it pulls is
// types plus src/core/report/stats.ts — the repo's single nearest-rank
// home, a pure dependency-free module — and this file's own logic.

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

/**
 * #108 (amended 2026-08-30, see the #108 release-acceptance comment): p95
 * LLM rounds must fall ≥50% from the pooled baseline. The epic's pain was
 * tail-dominated (production p95 57, max 81) and the bounded budgets make
 * the tail a structural guarantee — tier budget + finalization + answer —
 * so the amended gate judges what the design guarantees rather than what
 * luck decides. #132 moves the statistic onto three-pass pools so neither
 * side's stochastic tail can decide the release alone.
 */
export const P95_LLM_ROUNDS_MAX_FRACTION_OF_BASELINE = 0.5

/**
 * #132: exactly how many complete captures a side's pool holds. The
 * maintainer decision (2026-08-30) fixed three passes per side — enough
 * for a pooled p95 to absorb single-pass luck, bounded model spend.
 */
export const POOL_SIZE = 3

/**
 * The old path the baseline pool is pinned to (#130's re-baseline tree).
 * A baseline pool captured from any other commit cannot produce a
 * decision — the comparison is against this path by definition.
 */
export const BASELINE_PINNED_COMMIT = '2343a3cf56deb57e745cec357e446e0255e58098'

/**
 * The Lookup-tier class: open-web Lookups and ambiguous-Candidate
 * identification. #108's completion standard for Lookups explicitly
 * includes "a clearly supported best Candidate", and both run as
 * Lookup-tier information retrieval — the corpus kinds `lookup` and
 * `candidate` are its members.
 */
const LOOKUP_KINDS: ReadonlySet<ScenarioResult['kind']> = new Set(['lookup', 'candidate'])

export type RegressionsInput = 'passed' | 'failed' | 'not-run'

/** The #108 release-acceptance criteria, kebab-cased — the decision's gate ids. */
export type GateName =
  | 'no-raw-limit-error'
  | 'direct-action-completion'
  | 'lookup-correct-or-partial'
  | 'llm-rounds'
  | 'no-action-after-runtime-refusal'
  | 'mandatory-regressions'

export interface GateResult {
  /** The #108 criterion this gate decides. */
  gate: GateName
  passed: boolean
  /** The numbers the gate judged, already human-readable. */
  detail: string
}

export interface RefusalViolation {
  /** The capture within the candidate pool (1-based pass number). */
  pass: number
  scenarioId: string
  /** The repeated action as name+args, the key the refusal was recorded under. */
  action: string
}

/** One contributing capture's identity and model witness — what the decision artifact records. */
export interface CaptureProvenance {
  commit: string
  capturedAt: string
  orchestratorModel: string
  orchestratorRequests: number
}

export interface PooledRoundsStats {
  median: number
  p95: number
}

/** One side's validated pool: three captures of one commit, corpus, and routing contract. */
export interface CapturePool {
  captures: CaptureProvenance[]
  /** The one model/routing contract every capture on this side shared. */
  routing: EvalReport['routing']
  /** The pooled scenario population — every scenario from every capture, in pass order. */
  scenarios: ScenarioResult[]
  /** One capture's scenario ids, in order — the corpus signature both sides must share. */
  scenarioIds: string[]
  /** Nearest-rank LLM-round stats over the pooled population — pass percentiles are never averaged. */
  pooledRounds: PooledRoundsStats
}

/** The per-side summary the decision artifact records — everything validation judged. */
export interface PoolWitness {
  captures: CaptureProvenance[]
  /** The one model/routing contract every capture on this side shared. */
  routing: EvalReport['routing']
  /** The corpus signature — one capture's scenario ids, in order. */
  scenarioIds: string[]
  pooledLlmRounds: PooledRoundsStats
  /** The pooled scenario population the statistics judged (93 at corpus weight). */
  scenarioObservations: number
}

export interface ReleaseDecision {
  decidedAt: string
  decision: 'accept' | 'reject'
  baseline: PoolWitness
  candidate: PoolWitness
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
 * Key-order-independent deep equality witness — routing contracts must
 * match exactly, not textually. Mirrors progressFingerprints'
 * stableStringify deliberately rather than importing it: that module
 * rides the pipeline's runtime import graph, which the node-run
 * eval:accept script must not drag behind it (#36 type stripping).
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : 1))
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`
}

function shortCommit(commit: string): string {
  return commit.slice(0, 7)
}

/**
 * The real-model witness every capture must carry (#109): the usage-ledger
 * proof that the resolved model — not any scripted double — served the
 * rounds. `scriptedModelProvenAbsent` is the frozen proof; the witness
 * fields are re-checked so a stale flag cannot vouch for a scripted pool.
 */
function carriesRealModelWitness(report: EvalReport): boolean {
  const { modelWitness } = report
  return (
    report.scriptedModelProvenAbsent === true &&
    modelWitness.scriptedEntries.length === 0 &&
    modelWitness.orchestratorModel !== null &&
    !modelWitness.orchestratorModel.startsWith('mixed:') &&
    modelWitness.orchestratorModel !== 'scripted' &&
    modelWitness.orchestratorRequests > 0
  )
}

/**
 * Validate and pool one side's captures (#132). Refuses — by throwing, for
 * the script to surface as broken input — anything that cannot honestly
 * feed a pooled decision: the wrong count, an unfinalized or malformed
 * capture, a missing git identity, mixed commits, a missing real-model
 * witness, mixed routing contracts, or scenario ids that diverge in
 * content or order.
 */
export function buildPool(role: string, reports: readonly EvalReport[]): CapturePool {
  if (reports.length !== POOL_SIZE) {
    throw new Error(`${role} pool holds ${reports.length} capture(s) — a decision needs exactly ${POOL_SIZE}`)
  }
  reports.forEach((report, index) => {
    if (report.aggregate === undefined || report.scenarios.length === 0) {
      throw new Error(`${role} pool capture ${index + 1} is not a finalized report — capture it to completion before deciding`)
    }
    const malformed = report.scenarios.findIndex((scenario) => !Number.isFinite(scenario.metrics.llmRounds))
    if (malformed !== -1) {
      throw new Error(`${role} pool capture ${index + 1} is malformed at scenario ${report.scenarios[malformed]!.id} — no finite llmRounds`)
    }
  })
  const commits = [...new Set(reports.map((report) => report.gitCommit))]
  if (commits.some((commit) => commit === 'unknown') || commits.length > 1) {
    throw new Error(
      `${role} pool must represent exactly one source commit — found ${commits.map(shortCommit).join(', ')}`,
    )
  }
  reports.forEach((report, index) => {
    if (!carriesRealModelWitness(report)) {
      throw new Error(`${role} pool capture ${index + 1} (${shortCommit(report.gitCommit)}) lacks the real-model witness`)
    }
  })
  const routingContracts = [...new Set(reports.map((report) => canonicalJson(report.routing)))]
  if (routingContracts.length > 1) {
    throw new Error(`${role} pool mixes model/routing contracts — every capture must share one contract`)
  }
  const referenceIds = reports[0]!.scenarios.map((scenario) => scenario.id)
  reports.forEach((report, index) => {
    if (index === 0) return
    const ids = report.scenarios.map((scenario) => scenario.id)
    const divergence = ids.findIndex((id, position) => id !== referenceIds[position])
    if (divergence !== -1 || ids.length !== referenceIds.length) {
      const at = divergence === -1 ? referenceIds.length : divergence
      throw new Error(
        `${role} pool capture ${index + 1} covers a different corpus — scenario ids diverge from capture 1 at index ${at} (${referenceIds[at] ?? '<missing>'} vs ${ids[at] ?? '<missing>'}); same scenarios in the same order are required`,
      )
    }
  })

  const scenarios = reports.flatMap((report) => report.scenarios)
  const sortedRounds = [...scenarios.map((scenario) => scenario.metrics.llmRounds)].sort((left, right) => left - right)
  return {
    captures: reports.map((report) => ({
      commit: report.gitCommit,
      capturedAt: report.capturedAt,
      orchestratorModel: report.modelWitness.orchestratorModel!,
      orchestratorRequests: report.modelWitness.orchestratorRequests,
    })),
    routing: reports[0]!.routing,
    scenarios,
    scenarioIds: referenceIds,
    pooledRounds: {
      median: nearestRankPercentile(sortedRounds, 50),
      p95: nearestRankPercentile(sortedRounds, 95),
    },
  }
}

/**
 * #108: no repeated identical action may execute after the runtime
 * refused it. A refusal is per action key (name+args); the first later
 * successful execution of the same key after a runtime refusal of that
 * key is a violation — the rails exist so refused work never re-executes.
 * Scans every capture in the pool; a violation in any pass is a violation.
 */
export function refusalViolations(pool: readonly EvalReport[]): RefusalViolation[] {
  const violations: RefusalViolation[] = []
  pool.forEach((report, passIndex) => {
    for (const scenario of report.scenarios) {
      const refusedKeys = new Set<string>()
      // Artifacts predate fields (the frozen baseline's actions carry no
      // error text); the scan reads what is there and never assumes. The
      // key mirrors metrics.ts's actionKey deliberately — acceptance must
      // not import metrics at runtime, or the node-run eval:accept graph
      // would drag metrics' src imports behind it (#36 type stripping).
      for (const action of scenario.metrics.actions ?? []) {
        const key = `${action.name}:${JSON.stringify(action.args)}`
        if (!action.ok && isRuntimeRefusal(action.error)) refusedKeys.add(key)
        else if (action.ok && refusedKeys.has(key)) {
          refusedKeys.delete(key)
          violations.push({ pass: passIndex + 1, scenarioId: scenario.id, action: key })
        }
      }
    }
  })
  return violations
}

/**
 * The amended #108 rounds gate over pooled captures (#132): the pooled
 * tail halves — the structural guarantee the bounded budgets make — and
 * the pooled median does not regress. Both statistics are nearest-rank
 * over the raw pooled round counts, never averages of pass percentiles.
 */
function llmRoundsGate(candidate: CapturePool, baseline: CapturePool): GateResult {
  if (baseline.pooledRounds.p95 === 0) {
    return { gate: 'llm-rounds', passed: false, detail: 'baseline pooled p95 is 0 — there is no tail to halve' }
  }
  const p95Fall = Math.round(
    (100 * (baseline.pooledRounds.p95 - candidate.pooledRounds.p95)) / baseline.pooledRounds.p95,
  )
  return {
    gate: 'llm-rounds',
    passed:
      candidate.pooledRounds.p95 <= baseline.pooledRounds.p95 * P95_LLM_ROUNDS_MAX_FRACTION_OF_BASELINE &&
      candidate.pooledRounds.median <= baseline.pooledRounds.median,
    detail:
      `p95 ${baseline.pooledRounds.p95} → ${candidate.pooledRounds.p95} LLM rounds (${p95Fall}% fall — needs ≥50%) ` +
      `pooled over ${candidate.scenarios.length} observations per side (${POOL_SIZE} captures each — pass percentiles are never averaged); ` +
      `median ${baseline.pooledRounds.median} → ${candidate.pooledRounds.median} — must not regress`,
  }
}

export function decideRelease(
  candidateReports: readonly EvalReport[],
  baselineReports: readonly EvalReport[],
  input: { regressions: RegressionsInput; decidedAt?: Date },
): ReleaseDecision {
  const candidate = buildPool('candidate', candidateReports)
  const baseline = buildPool('baseline', baselineReports)
  if (baseline.captures[0]!.commit !== BASELINE_PINNED_COMMIT) {
    throw new Error(
      `baseline pool must be pinned to ${shortCommit(BASELINE_PINNED_COMMIT)} (found ${shortCommit(baseline.captures[0]!.commit)}) — capture the old path from the pinned worktree`,
    )
  }
  if (candidate.scenarioIds.join('\n') !== baseline.scenarioIds.join('\n')) {
    throw new Error('candidate and baseline pools cover different corpora — the comparison needs the same scenarios in the same order')
  }

  const rawLimitScenarios = candidate.scenarios.filter((scenario) => scenario.metrics.rawLimitFailure !== null)
  const directActions = candidate.scenarios.filter((scenario) => scenario.kind === 'direct-action')
  const directCompletions = directActions.filter((scenario) => scenario.success)
  const lookups = candidate.scenarios.filter((scenario) => LOOKUP_KINDS.has(scenario.kind))
  const lookupAccepted = lookups.filter(lookupAcceptable)
  const violations = refusalViolations(candidateReports)

  const gates: GateResult[] = [
    {
      gate: 'no-raw-limit-error',
      passed: rawLimitScenarios.length === 0,
      detail: `${rawLimitScenarios.length} of ${candidate.scenarios.length} scenario observations across ${candidate.captures.length} captures ended with a raw round-limit error`,
    },
    {
      gate: 'direct-action-completion',
      passed:
        directActions.length > 0 && directCompletions.length / directActions.length >= DIRECT_ACTION_COMPLETION_MIN,
      detail: `${rate(directCompletions.length, directActions.length)} of deterministic Direct Actions completed across ${candidate.captures.length} captures — needs ≥95%`,
    },
    {
      gate: 'lookup-correct-or-partial',
      passed: lookups.length > 0 && lookupAccepted.length / lookups.length >= LOOKUP_CORRECT_OR_PARTIAL_MIN,
      detail: `${rate(lookupAccepted.length, lookups.length)} of Lookups completed correctly or resolved honest partial across ${candidate.captures.length} captures — needs ≥90%`,
    },
    llmRoundsGate(candidate, baseline),
    {
      gate: 'no-action-after-runtime-refusal',
      passed: violations.length === 0,
      detail:
        violations.length === 0
          ? 'no action executed after a runtime refusal of the same action'
          : violations.map((violation) => `pass ${violation.pass} ${violation.scenarioId}: ${violation.action}`).join('; '),
    },
    {
      gate: 'mandatory-regressions',
      passed: input.regressions === 'passed',
      detail: `mandatory safety and Session regressions (pnpm test:e2e): ${input.regressions}`,
    },
  ]

  const witnessOf = (pool: CapturePool): PoolWitness => ({
    captures: pool.captures,
    routing: pool.routing,
    scenarioIds: pool.scenarioIds,
    pooledLlmRounds: pool.pooledRounds,
    scenarioObservations: pool.scenarios.length,
  })

  return {
    decidedAt: (input.decidedAt ?? new Date()).toISOString(),
    decision: gates.every((gate) => gate.passed) ? 'accept' : 'reject',
    baseline: witnessOf(baseline),
    candidate: witnessOf(candidate),
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
    `release decision: ${decision.decision.toUpperCase()} ` +
      `(candidate ${shortCommit(decision.candidate.captures[0]!.commit)} vs baseline ${shortCommit(decision.baseline.captures[0]!.commit)} — ` +
      `${decision.candidate.captures.length} captures per side, ${decision.candidate.scenarioObservations} pooled scenarios each)`,
  ]
  for (const gate of decision.gates) lines.push(`  ${gate.passed ? 'PASS' : 'FAIL'} ${gate.gate} — ${gate.detail}`)
  lines.push(`  canaries: ${decision.canaries.status} — ${decision.canaries.note}`)
  return lines.join('\n')
}
