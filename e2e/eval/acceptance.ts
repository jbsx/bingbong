import { nearestRankPercentile } from '../../src/core/report/stats.ts'
import {
  CEILING_RESERVED_BOOKKEEPING_ROUNDS,
  HARD_TOOL_ROUND_CEILING,
  TIER_TOOL_ROUND_BUDGETS,
} from '../../src/core/pipeline/effortBudget.ts'
import type { EffortTier } from '../../src/core/pipeline/runPlan.ts'
import { evalScenarios, type EvalScenario } from './scenarios.ts'
import type { EvalReport, ScenarioResult } from './evaluator'

// Issue #128, closing #108's release acceptance; amended by #132 and #134.
// The decision judges POOLS of real-model captures — three complete passes
// per side — never a single pass: on the #130 production-weighted corpus a
// single-pass p95 is noise-dominated on both sides (the frozen old-path
// capture never exceeded 9 rounds while its sibling passes' lookups and
// clicks ran 12–20), so a one-vs-one comparison rejects a structurally
// bounded candidate against a lucky baseline. Each pool is validated for
// provenance before it can produce a decision: one source commit per side
// (the baseline side pinned to the pre-#114 tree, git 2343a3c, captured
// via worktree + eval overlay), identical scenario ids in identical order,
// one model/routing contract, and the real-model witness on every capture;
// the candidate pool must all represent one candidate commit.
//
// Pooled statistics are computed from the raw per-scenario round counts —
// nearest-rank over the pooled scenario population (93 observations at
// corpus weight), never an average of pass-level percentiles. #134
// replaced the #128 pooled-p95-halving requirement — the re-captured
// production-weighted pools showed a 22% fall where 50% was demanded, and
// the maintainer decision (2026-08-30) re-anchored the rounds gate onto
// what the bounded design structurally guarantees: the global pooled
// median must not regress, the production-dominant Direct Action and
// Lookup-class pooled medians must strictly improve, and every candidate
// observation must stay inside the structural ceiling its corpus-declared
// expected Effort Tier grants — the tier's work budget plus at most one
// terminal bookkeeping round and one Answer round per legitimate budget
// epoch (a Run, or a Steering replan within one), capped by the hard Tool
// Round ceiling. The model's own tier declaration grants nothing: the
// ceiling comes from the corpus of record (e2e/eval/scenarios.ts), never
// from what the run happened to declare. Pooled p95 stays in the artifact
// as a reported number, never a threshold. Every candidate-side gate
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
// types, src/core/report/stats.ts (the repo's single nearest-rank home),
// src/core/pipeline/effortBudget.ts (pure policy constants — its own
// imports are type-only, so the runtime graph stays dependency-free),
// this file's own logic, and the corpus of record, whose imports are
// type-only too.

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
 * #132: exactly how many complete captures a side's pool holds. The
 * maintainer decision (2026-08-30) fixed three passes per side — enough
 * for a pooled statistic to absorb single-pass luck, bounded model spend.
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

/** The Direct Action class the rounds gate judges separately (#134). */
const DIRECT_ACTION_KINDS: ReadonlySet<ScenarioResult['kind']> = new Set(['direct-action'])

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

/** One candidate observation beyond the structural ceiling its design grants (#134). */
export interface StructuralViolation {
  /** The capture within the candidate pool (1-based pass number). */
  pass: number
  scenarioId: string
  /** The offending Run (1-based; artifacts without per-run telemetry judge one combined bucket). */
  run: number
  observedRounds: number
  allowedRounds: number
  /** The expected epochs the allowance derived from, e.g. `direct_action+steered:direct_action`. */
  expectedEpochs: string
}

/** A scenario's corpus-derived structural bound: what its design legitimately permits (#134). */
export interface StructuralCeiling {
  scenarioId: string
  /** Allowed LLM-round maxima per executed Run, in design order. */
  runAllowances: number[]
  /** The epochs each Run's allowance derives from, in run order — the violation witness. */
  runEpochs: string[]
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

/** The class-level pooled medians the #134 rounds gate judges separately. */
export interface ClassMedians {
  directAction: number | null
  lookupClass: number | null
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
  /** Nearest-rank class medians over the same pooled population (#134). */
  classMedians: ClassMedians
}

/** The per-side summary the decision artifact records — everything validation judged. */
export interface PoolWitness {
  captures: CaptureProvenance[]
  /** The one model/routing contract every capture on this side shared. */
  routing: EvalReport['routing']
  /** The corpus signature — one capture's scenario ids, in order. */
  scenarioIds: string[]
  pooledLlmRounds: PooledRoundsStats
  /** The class pooled medians the rounds gate judged (#134). */
  classMedians: ClassMedians
  /** The pooled scenario population the statistics judged (93 at corpus weight). */
  scenarioObservations: number
}

export interface ReleaseDecision {
  decidedAt: string
  decision: 'accept' | 'reject'
  baseline: PoolWitness
  candidate: PoolWitness
  gates: GateResult[]
  /**
   * The #134 rounds-gate contract this decision judged, stated in the
   * artifact so the recorded decision names its own rules, not just their
   * verdicts.
   */
  roundsGateContract: string
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
 * One budget epoch's LLM-round allowance (#134): the tier's Tool Round
 * work budget, plus the one terminal bookkeeping Tool Round a Finalizing
 * run may spend, plus the Answer round that rides outside every round
 * budget. The hard Tool Round ceiling stays authoritative per Run — a
 * many-epoch design cannot out-grant it (see structuralCeiling).
 */
export function epochRoundAllowance(tier: EffortTier): number {
  return TIER_TOOL_ROUND_BUDGETS[tier] + CEILING_RESERVED_BOOKKEEPING_ROUNDS + 1
}

/** One budget epoch: its expected tier and its witness label. */
interface Epoch {
  tier: EffortTier
  label: string
}

/** The epochs one Run's design grants — the steered epoch carries its marker (#134). */
function runEpochs(scenario: EvalScenario, run: 'first' | 'followUp'): Epoch[] {
  const effort = scenario.expectedEffort
  if (run === 'followUp') return [{ tier: effort.followUpTier ?? effort.tier, label: effort.followUpTier ?? effort.tier }]
  return scenario.steer === undefined
    ? [{ tier: effort.tier, label: effort.tier }]
    : [
        { tier: effort.tier, label: effort.tier },
        { tier: effort.steeredTier ?? effort.tier, label: `steered:${effort.steeredTier ?? effort.tier}` },
      ]
}

/**
 * Derive a scenario's structural ceiling from its corpus declaration
 * (#134): each executed command is one Run with its own budget, a Steering
 * directive re-arms the Run's budget as one more epoch, and each epoch
 * permits its tier's work budget plus one bookkeeping and one Answer
 * round. A Run's epochs are capped by the hard Tool Round ceiling plus
 * its Answer round — the ceiling stays authoritative however many epochs
 * the design grants. Model-declared tiers grant nothing: only the corpus
 * declaration above feeds the arithmetic.
 */
export function structuralCeiling(scenario: EvalScenario): StructuralCeiling {
  const runs: ('first' | 'followUp')[] = scenario.followUp === undefined ? ['first'] : ['first', 'followUp']
  const epochsWithRuns = runs.map((run) => runEpochs(scenario, run))
  return {
    scenarioId: scenario.id,
    runAllowances: epochsWithRuns.map((epochs) =>
      Math.min(
        epochs.reduce((sum, epoch) => sum + epochRoundAllowance(epoch.tier), 0),
        HARD_TOOL_ROUND_CEILING + 1,
      ),
    ),
    runEpochs: epochsWithRuns.map((epochs) => epochs.map((epoch) => epoch.label).join('+')),
  }
}

/** The corpus of record's ceilings by scenario id — the gate's only ceiling source. */
export function corpusCeilings(): Map<string, StructuralCeiling> {
  return new Map(evalScenarios().map((scenario) => [scenario.id, structuralCeiling(scenario)]))
}

/**
 * Scan a pool for observations beyond their corpus-declared ceiling
 * (#134). Each Run judges against its own allowance, which is the
 * stricter reading: a combined total inside the scenario ceiling can
 * still hide one Run blowing past its own budget (15 + 1 against 14 +
 * 14), while any total that exceeds the scenario ceiling must include a
 * Run over its allowance — so per-run judgement subsumes total judgement.
 * An artifact that predates per-run telemetry judges one combined bucket
 * against the full ceiling. A Run with no corresponding design epoch has
 * no legitimate budget and reports allowed 0.
 */
export function structuralViolations(
  reports: readonly EvalReport[],
  ceilings: ReadonlyMap<string, StructuralCeiling> = corpusCeilings(),
): StructuralViolation[] {
  const violations: StructuralViolation[] = []
  reports.forEach((report, passIndex) => {
    for (const scenario of report.scenarios) {
      const ceiling = ceilings.get(scenario.id)
      if (ceiling === undefined) continue
      const buckets: { observed: number; allowed: number; epochs: string }[] =
        scenario.runs.length > 0
          ? scenario.runs.map((run, runIndex) => ({
              observed: run.llmRounds,
              allowed: ceiling.runAllowances[runIndex] ?? 0,
              epochs: ceiling.runEpochs[runIndex] ?? 'no granted epoch',
            }))
          : [
              {
                observed: scenario.metrics.llmRounds,
                allowed: ceiling.runAllowances.reduce((sum, allowance) => sum + allowance, 0),
                epochs: ceiling.runEpochs.join('+'),
              },
            ]
      buckets.forEach((bucket, bucketIndex) => {
        if (bucket.observed > bucket.allowed) {
          violations.push({
            pass: passIndex + 1,
            scenarioId: scenario.id,
            run: bucketIndex + 1,
            observedRounds: bucket.observed,
            allowedRounds: bucket.allowed,
            expectedEpochs: bucket.epochs,
          })
        }
      })
    }
  })
  return violations
}

/** Nearest-rank median over one class's pooled round counts — null when the class is absent. */
function pooledMedianOfClass(scenarios: readonly ScenarioResult[], kinds: ReadonlySet<ScenarioResult['kind']>): number | null {
  const sorted = scenarios
    .filter((scenario) => kinds.has(scenario.kind))
    .map((scenario) => scenario.metrics.llmRounds)
    .sort((left, right) => left - right)
  return sorted.length > 0 ? nearestRankPercentile(sorted, 50) : null
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
    classMedians: {
      directAction: pooledMedianOfClass(scenarios, DIRECT_ACTION_KINDS),
      lookupClass: pooledMedianOfClass(scenarios, LOOKUP_KINDS),
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
 * The #134 rounds gate over pooled captures: the global pooled median must
 * not regress, the Direct Action and Lookup-class pooled medians must
 * strictly improve (the production-weighted classes with meaningful
 * sample counts — the rarer classes stay protected by their objective
 * gates and structural ceilings, not three-observation medians), and every
 * candidate observation must sit inside its corpus-declared structural
 * ceiling. Pooled p95 is reported, never gated. All statistics are
 * nearest-rank over the raw pooled round counts, never averages of pass
 * percentiles.
 */
/** Strict pooled-median improvement on a class — a side with no observations cannot improve (#134). */
function strictlyImproves(from: number | null, to: number | null): boolean {
  return from !== null && to !== null && to < from
}

function llmRoundsGate(candidate: CapturePool, baseline: CapturePool, violations: readonly StructuralViolation[]): GateResult {
  const globalOk = candidate.pooledRounds.median <= baseline.pooledRounds.median
  const directActionOk = strictlyImproves(baseline.classMedians.directAction, candidate.classMedians.directAction)
  const lookupClassOk = strictlyImproves(baseline.classMedians.lookupClass, candidate.classMedians.lookupClass)
  const classLine = (label: string, from: number | null, to: number | null): string =>
    `; ${label} median ${from ?? 'none'} → ${to ?? 'none'} — must improve`
  return {
    gate: 'llm-rounds',
    passed: globalOk && directActionOk && lookupClassOk && violations.length === 0,
    detail:
      `median ${baseline.pooledRounds.median} → ${candidate.pooledRounds.median} pooled over ${candidate.scenarios.length} observations per side ` +
      `(${POOL_SIZE} captures each — pass percentiles are never averaged) — must not regress` +
      classLine('Direct Action', baseline.classMedians.directAction, candidate.classMedians.directAction) +
      classLine('Lookup-class', baseline.classMedians.lookupClass, candidate.classMedians.lookupClass) +
      `; p95 ${baseline.pooledRounds.p95} → ${candidate.pooledRounds.p95} (reported, never gated #134); ` +
      (violations.length === 0
        ? `structural bounds: every observation within its corpus-declared ceiling`
        : `structural bounds: ${violations
            .map(
              (violation) =>
                `pass ${violation.pass} ${violation.scenarioId} run ${violation.run}: ${violation.observedRounds} rounds exceed the ${violation.allowedRounds} allowed by ${violation.expectedEpochs}`,
            )
            .join('; ')}`),
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
  // #134: every captured scenario must be one the corpus of record
  // defines an expected Effort Tier for — an id without a corpus
  // declaration has no derivable ceiling, so it is broken input, not a
  // failed gate.
  const ceilings = corpusCeilings()
  const outsideCorpus = candidate.scenarioIds.find((id) => !ceilings.has(id))
  if (outsideCorpus !== undefined) {
    throw new Error(
      `the corpus of record does not define ${outsideCorpus} — pools must match e2e/eval/scenarios.ts before a decision can derive ceilings`,
    )
  }

  const rawLimitScenarios = candidate.scenarios.filter((scenario) => scenario.metrics.rawLimitFailure !== null)
  const directActions = candidate.scenarios.filter((scenario) => scenario.kind === 'direct-action')
  const directCompletions = directActions.filter((scenario) => scenario.success)
  const lookups = candidate.scenarios.filter((scenario) => LOOKUP_KINDS.has(scenario.kind))
  const lookupAccepted = lookups.filter(lookupAcceptable)
  const violations = refusalViolations(candidateReports)
  const structural = structuralViolations(candidateReports, ceilings)

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
    llmRoundsGate(candidate, baseline, structural),
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
    classMedians: pool.classMedians,
    scenarioObservations: pool.scenarios.length,
  })

  return {
    decidedAt: (input.decidedAt ?? new Date()).toISOString(),
    decision: gates.every((gate) => gate.passed) ? 'accept' : 'reject',
    baseline: witnessOf(baseline),
    candidate: witnessOf(candidate),
    gates,
    roundsGateContract:
      '#134 (maintainer-approved 2026-08-30): the global pooled median must not regress; the Direct Action and Lookup-class pooled medians must strictly improve; ' +
      'every candidate observation must stay within the structural ceiling its corpus-declared expected Effort Tier grants — the tier work budget plus at most one terminal bookkeeping round and one Answer round per legitimate budget epoch (each Run, and each Steering replan within one), capped by the hard Tool Round ceiling. ' +
      'The #128 pooled-p95-halving requirement is retired: pooled p95 is reported, never gated.',
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
