import { describe, expect, it } from 'vitest'
import { finalizationToolRefusal } from '../../src/core/pipeline/effortBudget'
import { buildPool, decideRelease, isRuntimeRefusal, refusalViolations, type GateResult } from './acceptance'
import type { EvalReport, ScenarioResult } from './evaluator'
import type { ScenarioMetrics } from './metrics'
import { evalScenarios, type EvalScenario } from './scenarios'

// The #128/#132 release-decision gates over pooled captures: three
// complete passes per side, pooled nearest-rank statistics from raw
// scenario round counts (never averages of pass percentiles), provenance
// refusal for anything but a clean pool, plus the interaction cases that
// matter (an honest partial Lookup counts; a runtime-refused action never
// executes again; the regressions input is a gate, not a footnote).

/** The pinned pre-#114 old path (#130): every baseline capture's commit. */
const OLD_COMMIT = `2343a3c${'f'.repeat(33)}`
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

/** A pass whose 31 round counts come from an explicit [value, count] vector. */
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
  it('accepts a candidate that meets every #108 gate', () => {
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
    // The pooled statistics the rounds gate judged: 93 observations per side.
    expect(gateOf(decision, 'llm-rounds').detail).toContain('p95 12 → 6')
    expect(gateOf(decision, 'llm-rounds').detail).toContain('median 6 → 3')
  })

  it('witnesses all six capture identities and the pooled statistics', () => {
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
    expect(decision.candidate.scenarioObservations).toBe(93)
    expect(decision.baseline.scenarioObservations).toBe(93)
    expect(decision.candidate.pooledLlmRounds).toEqual({ median: 3, p95: 6 })
    expect(decision.baseline.pooledLlmRounds).toEqual({ median: 6, p95: 12 })
    expect(decision.canaries.status).toBe('not-run')
  })

  it('passes the rounds gate exactly at the 50% pooled-p95 fall, fails one round above it', () => {
    const uniform = (commit: string, value: number): EvalReport[] =>
      [1, 2, 3].map((n) => vectorPass(commit, n, [[value, 31]]))
    const baseline = uniform(OLD_COMMIT, 12)

    const atTheLine = decide(uniform(CANDIDATE_COMMIT, 6), baseline)
    expect(gateOf(atTheLine, 'llm-rounds').passed).toBe(true)
    expect(atTheLine.decision).toBe('accept')

    const aboveTheLine = decide(uniform(CANDIDATE_COMMIT, 7), baseline)
    expect(gateOf(aboveTheLine, 'llm-rounds').passed).toBe(false)
    expect(gateOf(aboveTheLine, 'llm-rounds').detail).toContain('42% fall')
  })

  it('fails the rounds gate when the pooled median regresses, even with a halved tail', () => {
    // Per pass 16 low + 15 high pools to 48 low + 45 high: baseline median 6
    // p95 14; candidate median 7 (regression) with p95 7 (exactly half).
    const perPass = (commit: string, spec: [number, number][]) => [1, 2, 3].map((n) => vectorPass(commit, n, spec))
    const gate = gateOf(
      decide(perPass(CANDIDATE_COMMIT, [[7, 16], [2, 15]]), perPass(OLD_COMMIT, [[6, 16], [14, 15]])),
      'llm-rounds',
    )
    expect(gate.passed).toBe(false)
    expect(gate.detail).toContain('median 6 → 7')
  })

  it('judges pooled raw counts, never averages of pass percentiles', () => {
    // Pass p95s 8, 12, 14 average to ~11.3 (threshold ~5.7); the pooled
    // population's p95 is 14 (threshold 7). A candidate pooled p95 of 6
    // passes pooled judgment but would fail averaged judgment.
    const baseline = [
      vectorPass(OLD_COMMIT, 1, [[5, 24], [8, 7]]),
      vectorPass(OLD_COMMIT, 2, [[5, 24], [12, 7]]),
      vectorPass(OLD_COMMIT, 3, [[5, 24], [14, 7]]),
    ]
    const candidate = [1, 2, 3].map((n) => vectorPass(CANDIDATE_COMMIT, n, [[4, 16], [6, 15]]))
    const gate = gateOf(decide(candidate, baseline), 'llm-rounds')
    expect(gate.passed).toBe(true)
    expect(gate.detail).toContain('p95 14 → 6')
    expect(gate.detail).toContain('93 observations per side')
  })

  it('fails the rounds gate when the pooled tail does not halve, even with a healthy median', () => {
    // Baseline pooled: 48×6 + 45×12 → median 6, p95 12. Candidate: median 3,
    // p95 7 — the median improves but 7 > 12 × 0.5.
    const perPass = (commit: string, spec: [number, number][]) => [1, 2, 3].map((n) => vectorPass(commit, n, spec))
    const gate = gateOf(decide(perPass(CANDIDATE_COMMIT, [[3, 16], [7, 15]]), perPass(OLD_COMMIT, [[6, 16], [12, 15]])), 'llm-rounds')
    expect(gate.passed).toBe(false)
    expect(gate.detail).toContain('42% fall')
  })

  it('fails the raw round-limit gate on a single violation in any pass', () => {
    const pool = candidatePool()
    const blocker = pool[1]!.scenarios.find((entry) => entry.id === 'blocker-challenge-page')!
    blocker.metrics.rawLimitFailure = 'tool round limit (32) reached'
    const gate = gateOf(decide(pool), 'no-raw-limit-error')
    expect(gate.passed).toBe(false)
    expect(gate.detail).toContain('1 of 93')
  })

  it('pools Direct Action completion across passes — one miss in one pass tolerated, two reject', () => {
    const oneMiss = candidatePool()
    oneMiss[0]!.scenarios[0]!.success = false
    // 32/33 = 97% across the pool; the single-pass gate would have failed 10/11.
    expect(gateOf(decide(oneMiss), 'direct-action-completion').passed).toBe(true)
    expect(gateOf(decide(oneMiss), 'direct-action-completion').detail).toContain('32/33')

    const twoMisses = candidatePool()
    twoMisses[0]!.scenarios[0]!.success = false
    twoMisses[2]!.scenarios[5]!.success = false
    const gate = gateOf(decide(twoMisses), 'direct-action-completion')
    expect(gate.passed).toBe(false)
    expect(gate.detail).toContain('31/33')
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

  it('surfaces the baseline side under its own role name', () => {
    const bad = baselinePool()
    bad[0]!.gitCommit = 'e'.repeat(40)
    expect(() => decide(candidatePool(), bad)).toThrow(/baseline pool must represent exactly one source commit/)
  })
})

describe('buildPool pooled statistics', () => {
  it('pools nearest-rank median and p95 over all raw scenario round counts', () => {
    const pool = buildPool('candidate', candidatePool())
    expect(pool.scenarios).toHaveLength(93)
    expect(pool.pooledRounds).toEqual({ median: 3, p95: 6 })
    expect(pool.scenarioIds).toEqual(CORPUS.map(({ id }) => id))
  })

  it('computes nearest-rank positions over the pooled population, not per pass', () => {
    // 93 pooled values: 72×5, 7×8, 7×12, 7×14 → median rank 47 = 5, p95 rank 89 = 14.
    const pool = buildPool('baseline', [
      vectorPass(OLD_COMMIT, 1, [[5, 24], [8, 7]]),
      vectorPass(OLD_COMMIT, 2, [[5, 24], [12, 7]]),
      vectorPass(OLD_COMMIT, 3, [[5, 24], [14, 7]]),
    ])
    expect(pool.pooledRounds).toEqual({ median: 5, p95: 14 })
  })
})

describe('the #130 corpus', () => {
  const scenarios = evalScenarios()

  it('weights the gated classes like production: ≥10 Direct Actions and ≥10 Lookups', () => {
    expect(scenarios.filter((entry) => entry.kind === 'direct-action')).toHaveLength(11)
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
    expect(violations[0]).toMatchObject({ capture: 2, scenarioId: 's', action: `type:${JSON.stringify({ ref: 1, text: 'x\n' })}` })
  })
})
