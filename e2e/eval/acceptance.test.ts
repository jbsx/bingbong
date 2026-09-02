import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { finalizationToolRefusal } from '../../src/core/pipeline/effortEpoch'
import {
  buildPool,
  decideRelease,
  isRuntimeRefusal,
  refusalViolations,
  structuralCeiling,
  structuralViolations,
  type GateResult,
} from './acceptance'
import type { EvalReport, ScenarioResult } from './evaluator'
import type { ScenarioMetrics } from './metrics'
import { evalScenarios, type EvalScenario } from './scenarios'

// The #128/#132/#134 release-decision gates over pooled captures: three
// complete passes per side, pooled nearest-rank statistics from raw
// scenario round counts (never averages of pass percentiles), provenance
// refusal for anything but a clean pool, plus the interaction cases that
// matter (an honest partial Lookup counts; a runtime-refused action never
// executes again; the regressions input is a gate, not a footnote). The
// #134 rounds gate judges global and class pooled medians plus
// corpus-declared structural ceilings — pooled p95 is reported, never
// gated.

/** The pinned pre-#114 old path (#130): every baseline capture's commit. */
const OLD_COMMIT = '2343a3cf56deb57e745cec357e446e0255e58098'
const CANDIDATE_COMMIT = 'c'.repeat(40)

function metrics(overrides: Partial<ScenarioMetrics> = {}): ScenarioMetrics {
  return {
    llmRounds: 2,
    attemptedTools: 2,
    executedTools: 2,
    elapsedMs: 10_000,
    repeatedActions: 0,
    outcome: 'done',
    resolution: null,
    finalizationCause: null,
    effortTier: 'lookup',
    rawLimitFailure: null,
    askTimedOut: false,
    actions: [],
    answerText: 'answer',
    timedOut: false,
    ...overrides,
  }
}

function scenario(
  id: string,
  kind: EvalScenario['kind'],
  overrides: { success?: boolean; metrics?: Partial<ScenarioMetrics> } = {},
): ScenarioResult {
  const run = metrics(overrides.metrics)
  return {
    id,
    kind,
    command: id,
    success: overrides.success ?? true,
    failureReason: null,
    metrics: run,
    runs: [run],
  }
}

function passReport(
  commit: string,
  capturedAt: string,
  scenarios: ScenarioResult[],
  overrides: Partial<EvalReport> = {},
): EvalReport {
  return {
    capturedAt,
    gitCommit: commit,
    scenarioTimeoutMs: 900_000,
    routing: {
      orchestrator: { configured: true, baseUrl: 'https://api', model: 'GLM-5.3-flash', keyFingerprint: 'sha256:x' },
      subagent: { configured: true, baseUrl: 'https://api', model: 'GLM-5.3-flash', keyFingerprint: 'sha256:x' },
      vision: { configured: false },
    },
    scriptedModelProvenAbsent: true,
    modelWitness: { orchestratorModel: 'GLM-5.3-flash', orchestratorRequests: 10, scriptedEntries: [] },
    scenarios,
    // Finality marker only — the pooled gates read raw scenario metrics.
    aggregate: {
      scenarioCount: scenarios.length,
      objectiveSuccesses: scenarios.filter((entry) => entry.success).length,
      rawLimitFailures: 0,
      timedOutScenarios: 0,
      llmRounds: { median: 0, p95: 0 },
      attemptedTools: { median: 0, p95: 0 },
      executedTools: { median: 0, p95: 0 },
      elapsedMs: { median: 0, p95: 0 },
      repeatedActions: { median: 0, p95: 0 },
    },
    ...overrides,
  }
}

/** The #130 corpus: kind-by-kind, in evaluator order — one line per scenario id. */
const CORPUS: { id: string; kind: EvalScenario['kind'] }[] = [
  { id: 'direct-action-open-page', kind: 'direct-action' },
  { id: 'direct-action-open-article', kind: 'direct-action' },
  { id: 'direct-action-open-alt-host', kind: 'direct-action' },
  { id: 'direct-action-open-results', kind: 'direct-action' },
  { id: 'direct-action-click-button', kind: 'direct-action' },
  { id: 'direct-action-check-checkbox', kind: 'direct-action' },
  { id: 'direct-action-select-option', kind: 'direct-action' },
  { id: 'direct-action-click-link', kind: 'direct-action' },
  { id: 'direct-action-type-submit', kind: 'direct-action' },
  { id: 'direct-action-dismiss-dialog', kind: 'direct-action' },
  { id: 'direct-action-scroll-down', kind: 'direct-action' },
  { id: 'direct-action-media-pause', kind: 'direct-action' },
  { id: 'unanswered-earlier-bulletin', kind: 'unanswered' },
  { id: 'lookup-widgets-guide', kind: 'lookup' },
  { id: 'lookup-open-web-answer', kind: 'lookup' },
  { id: 'lookup-open-web-review', kind: 'lookup' },
  { id: 'lookup-known-page-weight', kind: 'lookup' },
  { id: 'lookup-known-page-care', kind: 'lookup' },
  { id: 'lookup-depot-bulletin', kind: 'lookup' },
  { id: 'candidate-polished-widgets', kind: 'candidate' },
  { id: 'candidate-vintage-synonym', kind: 'candidate' },
  { id: 'candidate-anodized-synonym', kind: 'candidate' },
  { id: 'candidate-search-polished', kind: 'candidate' },
  { id: 'investigation-material-finish', kind: 'investigation' },
  { id: 'contradiction-widget-weight', kind: 'contradiction' },
  { id: 'subagent-widget-facts', kind: 'subagent' },
  { id: 'steering-correct-objective', kind: 'steering' },
  { id: 'cancelled-warranty-reuse', kind: 'cancelled-evidence' },
  { id: 'stale-status-board', kind: 'stale-evidence' },
  { id: 'near-identical-depot-bulletins', kind: 'near-identical' },
  { id: 'blocker-challenge-page', kind: 'blocker' },
  { id: 'unresolvable-mercury-dampeners', kind: 'unresolvable' },
]

/** Kind-shaped round counts: an unbounded old-path pass (median 6, p95 12 pooled). */
const OLD_PATH_ROUNDS: Record<EvalScenario['kind'], number> = {
  'direct-action': 4,
  unanswered: 3,
  lookup: 6,
  candidate: 6,
  investigation: 12,
  contradiction: 10,
  subagent: 9,
  steering: 7,
  'cancelled-evidence': 8,
  'stale-evidence': 6,
  'near-identical': 5,
  blocker: 7,
  unresolvable: 20,
}

/** The bounded candidate's shape (median 3, p95 6 pooled — the tail exactly halves). */
const CANDIDATE_ROUNDS: Record<EvalScenario['kind'], number> = {
  'direct-action': 2,
  unanswered: 2,
  lookup: 3,
  candidate: 3,
  investigation: 6,
  contradiction: 5,
  subagent: 5,
  steering: 4,
  'cancelled-evidence': 4,
  'stale-evidence': 3,
  'near-identical': 3,
  blocker: 4,
  unresolvable: 8,
}

function corpusPass(
  commit: string,
  passNumber: number,
  rounds: Record<EvalScenario['kind'], number>,
  mutate?: (scenario: ScenarioResult) => void,
): EvalReport {
  return passReport(
    commit,
    `2026-08-30T0${passNumber}:00:00.000Z`,
    CORPUS.map(({ id, kind }) => {
      const entry = scenario(id, kind, { metrics: { llmRounds: rounds[kind] } })
      mutate?.(entry)
      return entry
    }),
  )
}

/** A pass whose 32 round counts come from an explicit [value, count] vector. */
function vectorPass(commit: string, passNumber: number, spec: [number, number][]): EvalReport {
  const values = spec.flatMap(([value, count]) => Array.from({ length: count }, () => value))
  if (values.length !== CORPUS.length) {
    throw new Error(`vector holds ${values.length} values — the corpus needs ${CORPUS.length}`)
  }
  return passReport(
    commit,
    `2026-08-30T0${passNumber}:00:00.000Z`,
    CORPUS.map(({ id, kind }, index) => scenario(id, kind, { metrics: { llmRounds: values[index]! } })),
  )
}

const baselinePool = (): EvalReport[] => [1, 2, 3].map((n) => corpusPass(OLD_COMMIT, n, OLD_PATH_ROUNDS))

const candidatePool = (): EvalReport[] => [1, 2, 3].map((n) => corpusPass(CANDIDATE_COMMIT, n, CANDIDATE_ROUNDS))

function decide(
  candidate: EvalReport[],
  baseline: EvalReport[] = baselinePool(),
  regressions: 'passed' | 'failed' | 'not-run' = 'passed',
) {
  return decideRelease(candidate, baseline, { regressions })
}

function gateOf(decision: ReturnType<typeof decide>, name: string): GateResult {
  const gate = decision.gates.find((entry) => entry.gate === name)
  if (gate === undefined) throw new Error(`no gate named ${name}`)
  return gate
}

describe('decideRelease over pooled captures', () => {
  it('accepts a candidate that meets every gate, reporting all three judged medians', () => {
    const decision = decide(candidatePool())
    expect(decision.decision).toBe('accept')
    expect(decision.gates.map((gate) => gate.gate)).toEqual([
      'no-raw-limit-error',
      'direct-action-completion',
      'lookup-correct-or-partial',
      'llm-rounds',
      'no-action-after-runtime-refusal',
      'mandatory-regressions',
    ])
    // The pooled statistics the rounds gate judged: 96 observations per side.
    expect(gateOf(decision, 'llm-rounds').detail).toContain('median 6 → 3')
    expect(gateOf(decision, 'llm-rounds').detail).toContain('Direct Action median 4 → 2')
    expect(gateOf(decision, 'llm-rounds').detail).toContain('Lookup-class median 6 → 3')
    // p95 rides along as a reported number, never a threshold (#134).
    expect(gateOf(decision, 'llm-rounds').detail).toContain('p95 12 → 6')
  })

  it('states the amended rounds-gate contract in the decision artifact', () => {
    const decision = decide(candidatePool())
    expect(decision.roundsGateContract).toMatch(/median must not regress/)
    expect(decision.roundsGateContract).toMatch(/Direct Action and Lookup-class pooled medians must strictly improve/)
    expect(decision.roundsGateContract).toMatch(/structural ceiling/)
  })

  it('witnesses all six capture identities, the shared contract, and the pooled statistics', () => {
    const decision = decide(candidatePool())
    expect(decision.baseline.captures).toHaveLength(3)
    expect(decision.candidate.captures).toHaveLength(3)
    expect(decision.candidate.captures.every((capture) => capture.commit === CANDIDATE_COMMIT)).toBe(true)
    expect(decision.baseline.captures.every((capture) => capture.commit === OLD_COMMIT)).toBe(true)
    expect(decision.candidate.captures.map((capture) => capture.capturedAt)).toEqual([
      '2026-08-30T01:00:00.000Z',
      '2026-08-30T02:00:00.000Z',
      '2026-08-30T03:00:00.000Z',
    ])
    expect(decision.candidate.captures.every((capture) => capture.orchestratorModel === 'GLM-5.3-flash')).toBe(true)
    expect(decision.candidate.routing).toEqual(candidatePool()[0]!.routing)
    expect(decision.candidate.scenarioIds).toEqual(CORPUS.map(({ id }) => id))
    expect(decision.candidate.scenarioObservations).toBe(96)
    expect(decision.baseline.scenarioObservations).toBe(96)
    expect(decision.candidate.pooledLlmRounds).toEqual({ median: 3, p95: 6 })
    expect(decision.baseline.pooledLlmRounds).toEqual({ median: 6, p95: 12 })
    expect(decision.candidate.classMedians).toEqual({ directAction: 2, lookupClass: 3 })
    expect(decision.baseline.classMedians).toEqual({ directAction: 4, lookupClass: 6 })
    expect(decision.canaries.status).toBe('not-run')
  })

  it('refuses a baseline pool captured from a commit other than the pinned old path', () => {
    const unpinned = baselinePool()
    for (const pass of unpinned) pass.gitCommit = 'e'.repeat(40)
    expect(() => decide(candidatePool(), unpinned)).toThrow(
      /baseline pool must be pinned to 2343a3c \(found eeeeeee\)/,
    )
  })

  it('no longer gates on the pooled p95 — a sub-halving tail with improving medians accepts (#134)', () => {
    // Uniform pools: baseline p95 12, candidate p95 8 — a 33% fall the old
    // halving gate rejected. Every median improves, every observation sits
    // inside its ceiling, so the amended contract accepts.
    const uniform = (commit: string, value: number): EvalReport[] =>
      [1, 2, 3].map((n) => vectorPass(commit, n, [[value, 32]]))
    const decision = decide(uniform(CANDIDATE_COMMIT, 8), uniform(OLD_COMMIT, 12))
    expect(gateOf(decision, 'llm-rounds').passed).toBe(true)
    expect(decision.decision).toBe('accept')
    expect(gateOf(decision, 'llm-rounds').detail).toContain('p95 12 → 8')
  })

  it('fails the rounds gate when the pooled median regresses', () => {
    // Per pass 17 low + 15 high pools to 51 low + 45 high: baseline median 6
    // p95 14; candidate median 7 (regression).
    const perPass = (commit: string, spec: [number, number][]) => [1, 2, 3].map((n) => vectorPass(commit, n, spec))
    const gate = gateOf(
      decide(perPass(CANDIDATE_COMMIT, [[7, 17], [2, 15]]), perPass(OLD_COMMIT, [[6, 17], [14, 15]])),
      'llm-rounds',
    )
    expect(gate.passed).toBe(false)
    expect(gate.detail).toContain('median 6 → 7')
  })

  it('fails the rounds gate when the Direct Action pooled median does not improve', () => {
    // First 12 slots are the Direct Actions: 4 → 4 while the global median
    // improves 6 → 3 and the Lookup-class median improves 6 → 3.
    const perPass = (commit: string, spec: [number, number][]) => [1, 2, 3].map((n) => vectorPass(commit, n, spec))
    const gate = gateOf(
      decide(perPass(CANDIDATE_COMMIT, [[4, 12], [3, 20]]), perPass(OLD_COMMIT, [[4, 12], [6, 20]])),
      'llm-rounds',
    )
    expect(gate.passed).toBe(false)
    expect(gate.detail).toContain('Direct Action median 4 → 4')
  })

  it('fails the rounds gate when the Lookup-class pooled median does not improve', () => {
    // The Lookup-class slots all sit in the high bucket: 6 → 6 while the
    // global median holds 6 → 6 (non-regressing) and Direct Action improves.
    const perPass = (commit: string, spec: [number, number][]) => [1, 2, 3].map((n) => vectorPass(commit, n, spec))
    const gate = gateOf(
      decide(perPass(CANDIDATE_COMMIT, [[2, 12], [6, 20]]), perPass(OLD_COMMIT, [[4, 12], [6, 20]])),
      'llm-rounds',
    )
    expect(gate.passed).toBe(false)
    expect(gate.detail).toContain('Lookup-class median 6 → 6')
  })

  it('judges pooled raw counts, never averages of pass percentiles', () => {
    // Pass p95s 8, 12, 14 average to ~11.3; the pooled population's p95 is
    // 14. The candidate's pooled p95 of 6 is judged (reported) against the
    // pooled number — and every class median improves pooled: the Direct
    // Action and Lookup-class slots all sit in the low bucket.
    const baseline = [
      vectorPass(OLD_COMMIT, 1, [[5, 25], [8, 7]]),
      vectorPass(OLD_COMMIT, 2, [[5, 25], [12, 7]]),
      vectorPass(OLD_COMMIT, 3, [[5, 25], [14, 7]]),
    ]
    const candidate = [1, 2, 3].map((n) => vectorPass(CANDIDATE_COMMIT, n, [[4, 23], [6, 9]]))
    const gate = gateOf(decide(candidate, baseline), 'llm-rounds')
    expect(gate.passed).toBe(true)
    expect(gate.detail).toContain('p95 14 → 6')
    expect(gate.detail).toContain('96 observations per side')
  })

  it('fails the rounds gate on a structural-bound violation, naming pass, scenario, epochs, and allowance', () => {
    const pool = candidatePool()
    const overflow = pool[0]!.scenarios.find((entry) => entry.id === 'direct-action-type-submit')!
    overflow.metrics.llmRounds = 9
    overflow.runs[0]!.llmRounds = 9
    const gate = gateOf(decide(pool), 'llm-rounds')
    expect(gate.passed).toBe(false)
    expect(gate.detail).toContain('pass 1 direct-action-type-submit run 1: 9 rounds exceed the 8 allowed by direct_action')
    expect(decide(pool).decision).toBe('reject')
  })

  it('passes the exact structural boundary — a Direct Action at its full epoch allowance', () => {
    const pool = candidatePool()
    for (const pass of pool) {
      const atTheLine = pass.scenarios.find((entry) => entry.id === 'direct-action-type-submit')!
      atTheLine.metrics.llmRounds = 8
      atTheLine.runs[0]!.llmRounds = 8
    }
    const decision = decide(pool)
    expect(gateOf(decision, 'llm-rounds').passed).toBe(true)
    expect(decision.decision).toBe('accept')
  })

  it('derives ceilings from the corpus, never the model-declared tier', () => {
    // A Direct Action that declares investigation earns no headroom…
    const pool = candidatePool()
    const misclassified = pool[0]!.scenarios.find((entry) => entry.id === 'direct-action-type-submit')!
    misclassified.metrics.llmRounds = 9
    misclassified.metrics.effortTier = 'investigation'
    misclassified.runs[0]!.llmRounds = 9
    misclassified.runs[0]!.effortTier = 'investigation'
    expect(gateOf(decide(pool), 'llm-rounds').passed).toBe(false)

    // …and an Investigation that declares direct_action keeps its full ceiling.
    const humble = candidatePool()
    for (const pass of humble) {
      const investigation = pass.scenarios.find((entry) => entry.id === 'investigation-material-finish')!
      investigation.metrics.llmRounds = 26
      investigation.metrics.effortTier = 'direct_action'
      investigation.runs[0]!.llmRounds = 26
      investigation.runs[0]!.effortTier = 'direct_action'
    }
    expect(gateOf(decide(humble), 'llm-rounds').passed).toBe(true)
  })

  it('bounds each Run of a multi-command scenario by its own epoch budget, not a shared bucket', () => {
    // Stale-evidence design: two Lookup Runs, 14 each — [14, 13] fits both.
    const within = candidatePool()
    const stale = within[0]!.scenarios.find((entry) => entry.id === 'stale-status-board')!
    stale.runs = [metrics({ llmRounds: 14 }), metrics({ llmRounds: 13 })]
    stale.metrics.llmRounds = 27
    expect(gateOf(decide(within), 'llm-rounds').passed).toBe(true)

    // A combined total inside 28 cannot hide one Run blowing past its own 14.
    const overflowing = candidatePool()
    const overRun = overflowing[1]!.scenarios.find((entry) => entry.id === 'stale-status-board')!
    overRun.runs = [metrics({ llmRounds: 15 }), metrics({ llmRounds: 1 })]
    overRun.metrics.llmRounds = 16
    const gate = gateOf(decide(overflowing), 'llm-rounds')
    expect(gate.passed).toBe(false)
    expect(gate.detail).toContain('pass 2 stale-status-board run 1: 15 rounds exceed the 14 allowed by lookup')
  })

  it('grants Steering scenarios the steered epoch’s fresh budget', () => {
    // The steering design grants two Direct Action epochs: 8 + 8 = 16.
    const atTheLine = candidatePool()
    const steering = atTheLine[0]!.scenarios.find((entry) => entry.id === 'steering-correct-objective')!
    steering.metrics.llmRounds = 16
    steering.runs[0]!.llmRounds = 16
    expect(gateOf(decide(atTheLine), 'llm-rounds').passed).toBe(true)

    const overflowing = candidatePool()
    const overSteer = overflowing[0]!.scenarios.find((entry) => entry.id === 'steering-correct-objective')!
    overSteer.metrics.llmRounds = 17
    overSteer.runs[0]!.llmRounds = 17
    const gate = gateOf(decide(overflowing), 'llm-rounds')
    expect(gate.passed).toBe(false)
    expect(gate.detail).toContain(
      'pass 1 steering-correct-objective run 1: 17 rounds exceed the 16 allowed by direct_action+steered:direct_action',
    )
  })

  it('judges artifacts without per-run telemetry by their combined total against the full ceiling', () => {
    // A capture that predates per-run recording still judges honestly: the
    // combined 28 of a two-Lookup design fits; 29 does not.
    const within = candidatePool()
    const stale = within[0]!.scenarios.find((entry) => entry.id === 'stale-status-board')!
    stale.runs = []
    stale.metrics.llmRounds = 28
    expect(gateOf(decide(within), 'llm-rounds').passed).toBe(true)

    const overflowing = candidatePool()
    const over = overflowing[0]!.scenarios.find((entry) => entry.id === 'stale-status-board')!
    over.runs = []
    over.metrics.llmRounds = 29
    const gate = gateOf(decide(overflowing), 'llm-rounds')
    expect(gate.passed).toBe(false)
    expect(gate.detail).toContain('pass 1 stale-status-board run 1: 29 rounds exceed the 28 allowed by lookup+lookup')
  })

  it('fails the raw round-limit gate on a single violation in any pass', () => {
    const pool = candidatePool()
    const blocker = pool[1]!.scenarios.find((entry) => entry.id === 'blocker-challenge-page')!
    blocker.metrics.rawLimitFailure = 'tool round limit (32) reached'
    const gate = gateOf(decide(pool), 'no-raw-limit-error')
    expect(gate.passed).toBe(false)
    expect(gate.detail).toContain('1 of 96')
  })

  it('pools Direct Action completion across passes — one miss in one pass tolerated, two reject', () => {
    const oneMiss = candidatePool()
    oneMiss[0]!.scenarios[0]!.success = false
    // 35/36 = 97% across the pool; the single-pass gate would have failed 11/12.
    expect(gateOf(decide(oneMiss), 'direct-action-completion').passed).toBe(true)
    expect(gateOf(decide(oneMiss), 'direct-action-completion').detail).toContain('35/36')

    const twoMisses = candidatePool()
    twoMisses[0]!.scenarios[0]!.success = false
    twoMisses[2]!.scenarios[5]!.success = false
    const gate = gateOf(decide(twoMisses), 'direct-action-completion')
    expect(gate.passed).toBe(false)
    expect(gate.detail).toContain('34/36')
  })

  it('pools Lookup acceptance — an honest partial counts, four plain failures reject', () => {
    const partial = candidatePool()
    const lookup = partial[0]!.scenarios.find((entry) => entry.id === 'lookup-widgets-guide')!
    lookup.success = false
    lookup.metrics.resolution = 'partial'
    lookup.metrics.outcome = 'done'
    const objectiveFailures = candidatePool()
    // Four plain objective failures spread across the pool — 26/30 = 87%.
    const failings: [number, string][] = [
      [0, 'lookup-widgets-guide'],
      [0, 'lookup-open-web-answer'],
      [1, 'lookup-open-web-review'],
      [2, 'candidate-polished-widgets'],
    ]
    for (const [passNumber, id] of failings) {
      objectiveFailures[passNumber]!.scenarios.find((entry) => entry.id === id)!.success = false
    }
    expect(gateOf(decide(partial), 'lookup-correct-or-partial').detail).toContain('30/30')
    const gate = gateOf(decide(objectiveFailures), 'lookup-correct-or-partial')
    expect(gate.passed).toBe(false)
    expect(gate.detail).toContain('26/30')
  })

  it('rejects when an identical action executed after the runtime refused it, naming the pass', () => {
    const pool = candidatePool()
    const key = JSON.stringify({ url: 'http://fixture/wall' })
    const unresolvable = pool[1]!.scenarios.find((entry) => entry.id === 'unresolvable-mercury-dampeners')!
    unresolvable.metrics.actions = [
      { name: 'navigate', args: { url: 'http://fixture/wall' }, ok: true, repeated: false, error: null },
      { name: 'navigate', args: { url: 'http://fixture/wall' }, ok: false, repeated: true, error: 'Not executed — this action repeats an equivalent action against unchanged page state.' },
      { name: 'navigate', args: { url: 'http://fixture/wall' }, ok: true, repeated: true, error: null },
    ]
    const decision = decide(pool)
    const gate = gateOf(decision, 'no-action-after-runtime-refusal')
    expect(gate.passed).toBe(false)
    expect(gate.detail).toContain(`pass 2 unresolvable-mercury-dampeners: navigate:${key}`)
    expect(decision.decision).toBe('reject')
  })

  it('treats a post-refusal different-args action and an ordinary-error retry as no violation', () => {
    const pool = candidatePool()
    const unresolvable = pool[0]!.scenarios.find((entry) => entry.id === 'unresolvable-mercury-dampeners')!
    unresolvable.metrics.actions = [
      { name: 'navigate', args: { url: 'http://fixture/a' }, ok: false, repeated: false, error: 'Not executed — this action repeats an equivalent action against unchanged page state.' },
      { name: 'navigate', args: { url: 'http://fixture/b' }, ok: true, repeated: false, error: null },
      // An ordinary timeout retried successfully is legitimate work, not flailing.
      { name: 'navigate', args: { url: 'http://fixture/c' }, ok: false, repeated: false, error: 'navigation timed out' },
      { name: 'navigate', args: { url: 'http://fixture/c' }, ok: true, repeated: true, error: null },
    ]
    expect(gateOf(decide(pool), 'no-action-after-runtime-refusal').passed).toBe(true)
  })

  it('gates on the mandatory regressions input — not-run is not an accept', () => {
    expect(gateOf(decide(candidatePool(), baselinePool(), 'not-run'), 'mandatory-regressions').passed).toBe(false)
    expect(decide(candidatePool(), baselinePool(), 'not-run').decision).toBe('reject')
    expect(decide(candidatePool(), baselinePool(), 'failed').decision).toBe('reject')
  })
})

describe('pool provenance (#132: refusal, not judgement)', () => {
  it('refuses pools that do not hold exactly three captures', () => {
    expect(() => decide(candidatePool().slice(0, 2))).toThrow(/candidate pool holds 2 capture/)
    expect(() => decide([...candidatePool(), candidatePool()[0]!])).toThrow(/candidate pool holds 4 capture/)
  })

  it('refuses unfinalized captures', () => {
    const pool = candidatePool()
    delete pool[2]!.aggregate
    expect(() => decide(pool)).toThrow(/candidate pool capture 3 is not a finalized report/)
  })

  it('refuses pools that mix source commits or carry no git identity', () => {
    const mixed = candidatePool()
    mixed[1]!.gitCommit = 'd'.repeat(40)
    expect(() => decide(mixed)).toThrow(/candidate pool must represent exactly one source commit/)
    expect(() => decide(mixed)).toThrow(/ccccccc, ddddddd/)

    const unknown = candidatePool()
    unknown[0]!.gitCommit = 'unknown'
    expect(() => decide(unknown)).toThrow(/exactly one source commit/)
  })

  it('refuses captures without the real-model witness', () => {
    const noProof = candidatePool()
    delete noProof[0]!.scriptedModelProvenAbsent
    expect(() => decide(noProof)).toThrow(/candidate pool capture 1 .* lacks the real-model witness/)

    const scripted = candidatePool()
    scripted[1]!.modelWitness.scriptedEntries = [{ role: 'orchestrator', model: 'scripted' }]
    expect(() => decide(scripted)).toThrow(/capture 2 .* lacks the real-model witness/)

    const silent = candidatePool()
    silent[2]!.modelWitness.orchestratorRequests = 0
    expect(() => decide(silent)).toThrow(/capture 3 .* lacks the real-model witness/)
  })

  it('refuses pools that mix model/routing contracts', () => {
    const mixed = candidatePool()
    mixed[1]!.routing = {
      ...mixed[1]!.routing,
      orchestrator: { configured: true, baseUrl: 'https://other', model: 'GLM-4.6', keyFingerprint: 'sha256:y' },
    }
    expect(() => decide(mixed)).toThrow(/candidate pool mixes model\/routing contracts/)
  })

  it('refuses pools whose scenario ids diverge in content or order', () => {
    const renamed = candidatePool()
    renamed[2]!.scenarios[5]!.id = 'direct-action-other'
    expect(() => decide(renamed)).toThrow(/capture 3 covers a different corpus.*index 5/)

    const reordered = candidatePool()
    const ids = reordered[1]!.scenarios
    const first = ids[0]!
    ids[0] = ids[1]!
    ids[1] = first
    expect(() => decide(reordered)).toThrow(/capture 2 covers a different corpus.*index 0/)
  })

  it('refuses a decision over different corpora on the two sides', () => {
    const otherCorpus = candidatePool()
    for (const pass of otherCorpus) pass.scenarios.push(scenario('lookup-extra', 'lookup'))
    expect(() => decide(otherCorpus)).toThrow(/candidate and baseline pools cover different corpora/)
  })

  it('refuses pools holding scenarios the corpus of record does not define', () => {
    // Both sides agree on the unknown id, so the pool and cross-side checks
    // pass — but no corpus-declared ceiling exists to judge it against.
    const candidate = candidatePool()
    const baseline = baselinePool()
    for (const pass of candidate) pass.scenarios.push(scenario('lookup-extra', 'lookup'))
    for (const pass of baseline) pass.scenarios.push(scenario('lookup-extra', 'lookup'))
    expect(() => decide(candidate, baseline)).toThrow(
      /corpus of record does not define lookup-extra — pools must match e2e\/eval\/scenarios/,
    )
  })

  it('surfaces the baseline side under its own role name', () => {
    const bad = baselinePool()
    bad[0]!.gitCommit = 'e'.repeat(40)
    expect(() => decide(candidatePool(), bad)).toThrow(/baseline pool must represent exactly one source commit/)
  })
})

describe('structural ceilings (#134: corpus-declared, epoch-derived)', () => {
  const byId = new Map(evalScenarios().map((entry) => [entry.id, entry]))

  it('grants one epoch its tier budget plus one bookkeeping and one Answer round', () => {
    expect(structuralCeiling(byId.get('direct-action-open-page')!)).toMatchObject({
      scenarioId: 'direct-action-open-page',
      runAllowances: [8],
      runEpochs: ['direct_action'],
    })
    expect(structuralCeiling(byId.get('lookup-widgets-guide')!).runAllowances).toEqual([14])
    expect(structuralCeiling(byId.get('investigation-material-finish')!).runAllowances).toEqual([26])
  })

  it('sums the epochs a design grants — Steering re-arms, each Run budgets fresh', () => {
    expect(structuralCeiling(byId.get('steering-correct-objective')!)).toMatchObject({
      runAllowances: [16],
      runEpochs: ['direct_action+steered:direct_action'],
    })
    expect(structuralCeiling(byId.get('stale-status-board')!)).toMatchObject({
      runAllowances: [14, 14],
      runEpochs: ['lookup', 'lookup'],
    })
    expect(structuralCeiling(byId.get('cancelled-warranty-reuse')!).runAllowances).toEqual([14, 14])
  })

  it('caps a Run’s epochs at the hard Tool Round ceiling plus its Answer round', () => {
    // A hypothetical many-epoch design cannot out-grant the hard ceiling:
    // 32 Tool Rounds per Run, the Answer round riding outside it. The
    // first Run would want 8 + 14 + a follow-up epoch it cannot have — 26
    // from two epochs — while a 24-round Investigation epoch plus steering
    // re-arm also lands at the 33 cap, never above.
    const steeredAndFollowed: EvalScenario = {
      ...byId.get('investigation-material-finish')!,
      steer: () => 'narrow it down',
      followUp: undefined,
      expectedEffort: {
        tier: 'investigation',
        steeredTier: 'investigation',
        followUpTier: 'direct_action',
      },
    }
    expect(structuralCeiling(steeredAndFollowed).runAllowances).toEqual([33])
  })
})

describe('structuralViolations', () => {
  it('reports every offending run with its capture, ceiling inputs, and allowance', () => {
    const pool = candidatePool()
    const overflow = pool[2]!.scenarios.find((entry) => entry.id === 'direct-action-click-button')!
    overflow.runs = [metrics({ llmRounds: 9 })]
    overflow.metrics.llmRounds = 9
    const violations = structuralViolations(pool)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({
      pass: 3,
      scenarioId: 'direct-action-click-button',
      run: 1,
      observedRounds: 9,
      allowedRounds: 8,
      expectedEpochs: 'direct_action',
    })
  })

  it('clears the whole corpus-shaped candidate pool — every observation inside its ceiling', () => {
    expect(structuralViolations(candidatePool())).toEqual([])
  })
})

describe('the recorded #132 pools (#134: existing-pool compatibility)', () => {
  const evalDir = fileURLToPath(new URL('.', import.meta.url))

  /** The immutable captures on disk — three finalized reports per side, pass-named. */
  function recordedPool(side: 'baseline' | 'candidate'): EvalReport[] {
    const dir = join(evalDir, 'pools', side)
    return readdirSync(dir)
      .filter((entry) => entry.endsWith('.json'))
      .sort()
      .map((entry) => JSON.parse(readFileSync(join(dir, entry), 'utf8')) as EvalReport)
  }

  it('regenerates the recorded accept from the six immutable captures, with no structural violation', () => {
    // The artifacts predate the corpus's expected-Effort metadata (31
    // scenarios, model-declared tiers, no select-option id) — the gate
    // must judge them from the corpus of record alone, never new
    // telemetry, and never by mutating the captures.
    const decision = decideRelease(recordedPool('candidate'), recordedPool('baseline'), {
      regressions: 'passed',
      decidedAt: new Date('2026-08-30T00:00:00.000Z'),
    })
    expect(decision.decision).toBe('accept')
    expect(decision.baseline.pooledLlmRounds).toEqual({ median: 5, p95: 9 })
    expect(decision.candidate.pooledLlmRounds).toEqual({ median: 3, p95: 7 })
    expect(decision.baseline.classMedians).toEqual({ directAction: 4, lookupClass: 5 })
    expect(decision.candidate.classMedians).toEqual({ directAction: 3, lookupClass: 3 })
    expect(decision.baseline.scenarioObservations).toBe(93)
    expect(decision.candidate.scenarioObservations).toBe(93)
    const gate = gateOf(decision, 'llm-rounds')
    expect(gate.passed).toBe(true)
    expect(gate.detail).toContain('structural bounds: every observation within its corpus-declared ceiling')
  })
})

describe('buildPool pooled statistics', () => {
  it('pools nearest-rank median and p95 over all raw scenario round counts', () => {
    const pool = buildPool('candidate', candidatePool())
    expect(pool.scenarios).toHaveLength(96)
    expect(pool.pooledRounds).toEqual({ median: 3, p95: 6 })
    expect(pool.scenarioIds).toEqual(CORPUS.map(({ id }) => id))
  })

  it('computes nearest-rank positions over the pooled population, not per pass', () => {
    // 96 pooled values: 75×5, 7×8, 7×12, 7×14 → median rank 48 = 5, p95 rank 92 = 14.
    const pool = buildPool('baseline', [
      vectorPass(OLD_COMMIT, 1, [[5, 25], [8, 7]]),
      vectorPass(OLD_COMMIT, 2, [[5, 25], [12, 7]]),
      vectorPass(OLD_COMMIT, 3, [[5, 25], [14, 7]]),
    ])
    expect(pool.pooledRounds).toEqual({ median: 5, p95: 14 })
  })
})

describe('the #130 corpus', () => {
  const scenarios = evalScenarios()

  it('weights the gated classes like production: ≥10 Direct Actions and ≥10 Lookups', () => {
    expect(scenarios.filter((entry) => entry.kind === 'direct-action')).toHaveLength(12)
    expect(scenarios.filter((entry) => entry.kind === 'lookup' || entry.kind === 'candidate')).toHaveLength(10)
  })

  it('covers every class #108’s Testing Decisions list names', () => {
    const kinds = new Set(scenarios.map((entry) => entry.kind))
    expect([...kinds].sort()).toEqual(
      [
        'direct-action',
        'lookup',
        'candidate',
        'investigation',
        'contradiction',
        'blocker',
        'unanswered',
        'near-identical',
        'steering',
        'subagent',
        'cancelled-evidence',
        'stale-evidence',
        'unresolvable',
      ].sort(),
    )
  })

  it('matches this file’s CORPUS mirror — the gate fixtures judge the real scenario list', () => {
    expect(scenarios.map((entry) => ({ id: entry.id, kind: entry.kind }))).toEqual(CORPUS)
  })

  it('carries unique ids', () => {
    expect(new Set(scenarios.map((entry) => entry.id)).size).toBe(scenarios.length)
  })

  it('declares a durable expected Effort Tier for every scenario (#134)', () => {
    const tiers = ['direct_action', 'lookup', 'investigation']
    for (const entry of scenarios) {
      expect(tiers).toContain(entry.expectedEffort.tier)
      if (entry.steer === undefined) expect(entry.expectedEffort.steeredTier).toBeUndefined()
      if (entry.followUp === undefined) expect(entry.expectedEffort.followUpTier).toBeUndefined()
    }
  })
})

describe('isRuntimeRefusal', () => {
  it('recognizes the rails’ pre-execution refusals and rejects ordinary errors', () => {
    expect(isRuntimeRefusal('Not executed — this action repeats an equivalent action against unchanged page state.')).toBe(true)
    // Pinned against the real Finalization closure refusal, so wording drift in src fails here.
    expect(isRuntimeRefusal(finalizationToolRefusal)).toBe(true)
    expect(isRuntimeRefusal('Search loop limit (5 consecutive similar searches — q= navigate) reached for this run.')).toBe(true)
    // The Blocker gate's refusal is recoverable by design — not a violation to retry after.
    expect(isRuntimeRefusal('navigate refused before execution: example.com is walled for this run')).toBe(false)
    expect(isRuntimeRefusal('navigation timed out')).toBe(false)
    expect(isRuntimeRefusal(null)).toBe(false)
  })
})

describe('refusalViolations', () => {
  it('reports the first re-execution after each refusal, per scenario, tagged with its capture', () => {
    const refusal = 'Not executed — this action repeats an equivalent action against unchanged page state.'
    const flailing: ScenarioResult = scenario('s', 'lookup', {
      metrics: {
        actions: [
          { name: 'type', args: { ref: 1, text: 'x\n' }, ok: false, repeated: false, error: refusal },
          { name: 'type', args: { ref: 1, text: 'x\n' }, ok: true, repeated: true, error: null },
          { name: 'type', args: { ref: 1, text: 'x\n' }, ok: true, repeated: true, error: null },
        ],
      },
    })
    const clean = passReport(CANDIDATE_COMMIT, '2026-08-30T01:00:00.000Z', [scenario('t', 'lookup')])
    const violations = refusalViolations([
      clean,
      passReport(CANDIDATE_COMMIT, '2026-08-30T02:00:00.000Z', [flailing]),
    ])
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ pass: 2, scenarioId: 's', action: `type:${JSON.stringify({ ref: 1, text: 'x\n' })}` })
  })
})
