import { describe, expect, it } from 'vitest'
import { finalizationToolRefusal } from '../../src/core/pipeline/effortBudget'
import { decideRelease, isRuntimeRefusal, refusalViolations, type GateResult } from './acceptance'
import type { EvalReport, ScenarioResult } from './evaluator'
import type { ScenarioMetrics } from './metrics'
import type { EvalScenario } from './scenarios'

// The #128 release-decision gates over the frozen #109 baseline shape.
// Reports are synthetic but structurally exact: every gate gets a passing
// and a failing case judged on its own criterion, plus the interaction
// cases that matter (an honest partial Lookup counts; a runtime-refused
// action never executes again; the regressions input is a gate, not a
// footnote).

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
  return {
    id,
    kind,
    command: id,
    success: overrides.success ?? true,
    failureReason: null,
    metrics: metrics(overrides.metrics),
  }
}

function report(scenarios: ScenarioResult[], llmRounds: { median: number; p95: number }): EvalReport {
  return {
    capturedAt: '2026-08-30T00:00:00.000Z',
    gitCommit: 'c'.repeat(40),
    scenarioTimeoutMs: 900_000,
    routing: {} as EvalReport['routing'],
    modelWitness: { orchestratorModel: 'GLM-5.3-flash', orchestratorRequests: 10, scriptedEntries: [] },
    scenarios,
    aggregate: {
      scenarioCount: scenarios.length,
      objectiveSuccesses: scenarios.filter((entry) => entry.success).length,
      rawLimitFailures: scenarios.filter((entry) => entry.metrics.rawLimitFailure !== null).length,
      timedOutScenarios: scenarios.filter((entry) => entry.metrics.timedOut).length,
      llmRounds,
      attemptedTools: { median: 2, p95: 2 },
      executedTools: { median: 2, p95: 2 },
      elapsedMs: { median: 10_000, p95: 10_000 },
      repeatedActions: { median: 0, p95: 0 },
    },
  }
}

/** Mirrors the frozen #109 baseline's own aggregates. */
const BASELINE = report(
  [
    scenario('direct-action-open-page', 'direct-action', { success: true }),
    scenario('lookup-widgets-guide', 'lookup', { success: false }),
    scenario('candidate-polished-widgets', 'candidate', { success: true }),
    scenario('investigation-widget-weight', 'investigation', { success: true }),
    scenario('blocker-challenge-page', 'blocker', { success: true }),
    scenario('unresolvable-mercury-dampeners', 'unresolvable', { success: true }),
  ],
  { median: 5, p95: 36 },
)

function decide(candidate: EvalReport, regressions: 'passed' | 'failed' | 'not-run' = 'passed') {
  return decideRelease(candidate, BASELINE, { regressions })
}

function gateOf(decision: ReturnType<typeof decide>, name: string): GateResult {
  const gate = decision.gates.find((entry) => entry.gate === name)
  if (gate === undefined) throw new Error(`no gate named ${name}`)
  return gate
}

/** The candidate every passing test starts from: the replay's own shape — p95 14 vs baseline 36, median 2 vs 5. */
function passingCandidate(): EvalReport {
  return report(
    [
      scenario('direct-action-open-page', 'direct-action'),
      scenario('lookup-widgets-guide', 'lookup'),
      scenario('candidate-polished-widgets', 'candidate'),
      scenario('investigation-widget-weight', 'investigation'),
      scenario('blocker-challenge-page', 'blocker'),
      scenario('unresolvable-mercury-dampeners', 'unresolvable'),
    ],
    { median: 2, p95: 14 },
  )
}

describe('decideRelease', () => {
  it('accepts a candidate that meets every #108 gate', () => {
    const decision = decide(passingCandidate())
    expect(decision.decision).toBe('accept')
    expect(decision.gates.map((gate) => gate.gate)).toEqual([
      'no-raw-limit-error',
      'direct-action-completion',
      'lookup-correct-or-partial',
      'llm-rounds',
      'no-action-after-runtime-refusal',
      'mandatory-regressions',
    ])
  })

  it('fails the raw round-limit gate when any scenario ended in a raw limit error', () => {
    const candidate = passingCandidate()
    candidate.scenarios[4]!.metrics.rawLimitFailure = 'tool round limit (32) reached'
    const gate = gateOf(decide(candidate), 'no-raw-limit-error')
    expect(gate.passed).toBe(false)
    expect(gate.detail).toContain('1 of 6')
  })

  it('fails Direct Action completion below 95%', () => {
    const candidate = passingCandidate()
    candidate.scenarios[0]!.success = false
    expect(gateOf(decide(candidate), 'direct-action-completion').passed).toBe(false)
    expect(decide(candidate).decision).toBe('reject')
  })

  it('counts an honest partial Resolution as Lookup acceptance, but not a failed objective alone', () => {
    const partial = decide(
      report(
        [
          scenario('direct-action-open-page', 'direct-action'),
          scenario('lookup-widgets-guide', 'lookup', {
            success: false,
            metrics: { outcome: 'done', resolution: 'partial' },
          }),
          scenario('candidate-polished-widgets', 'candidate'),
        ],
        { median: 2, p95: 14 },
      ),
    )
    expect(gateOf(partial, 'lookup-correct-or-partial').passed).toBe(true)
    expect(gateOf(partial, 'lookup-correct-or-partial').detail).toContain('2/2')

    const plainFailure = passingCandidate()
    plainFailure.scenarios[1]!.success = false
    plainFailure.scenarios[1]!.metrics.resolution = null
    const rejected = gateOf(decide(plainFailure), 'lookup-correct-or-partial')
    expect(rejected.passed).toBe(false)
  })

  it('fails the rounds gate when the p95 tail does not halve, even with a healthy median (#108 amendment)', () => {
    // Median 4 ≤ 5 is no regression — but p95 20 > 36 × 0.5 = 18.
    const gate = gateOf(decide(report(passingCandidate().scenarios, { median: 4, p95: 20 })), 'llm-rounds')
    expect(gate.passed).toBe(false)
    expect(gate.detail).toContain('p95 36 → 20')
    expect(gate.detail).toContain('median 5 → 4')
  })

  it('fails the rounds gate when the median regresses, even with a halved tail (#108 amendment)', () => {
    const gate = gateOf(decide(report(passingCandidate().scenarios, { median: 6, p95: 14 })), 'llm-rounds')
    expect(gate.passed).toBe(false)
  })

  it('fails the rounds gate when a report aggregate is missing', () => {
    const partial = passingCandidate()
    delete partial.aggregate
    expect(gateOf(decide(partial), 'llm-rounds').passed).toBe(false)
  })

  it('rejects when an identical action executed after the runtime refused it', () => {
    const candidate = passingCandidate()
    const key = JSON.stringify({ url: 'http://fixture/wall' })
    candidate.scenarios[5]!.metrics.actions = [
      { name: 'navigate', args: { url: 'http://fixture/wall' }, ok: true, repeated: false, error: null },
      { name: 'navigate', args: { url: 'http://fixture/wall' }, ok: false, repeated: true, error: 'Not executed — this action repeats an equivalent action against unchanged page state.' },
      { name: 'navigate', args: { url: 'http://fixture/wall' }, ok: true, repeated: true, error: null },
    ]
    const decision = decide(candidate)
    const gate = gateOf(decision, 'no-action-after-runtime-refusal')
    expect(gate.passed).toBe(false)
    expect(gate.detail).toContain(`unresolvable-mercury-dampeners: navigate:${key}`)
    expect(decision.decision).toBe('reject')
  })

  it('treats a post-refusal different-args action and an ordinary-error retry as no violation', () => {
    const candidate = passingCandidate()
    candidate.scenarios[5]!.metrics.actions = [
      { name: 'navigate', args: { url: 'http://fixture/a' }, ok: false, repeated: false, error: 'Not executed — this action repeats an equivalent action against unchanged page state.' },
      { name: 'navigate', args: { url: 'http://fixture/b' }, ok: true, repeated: false, error: null },
      // An ordinary timeout retried successfully is legitimate work, not flailing.
      { name: 'navigate', args: { url: 'http://fixture/c' }, ok: false, repeated: false, error: 'navigation timed out' },
      { name: 'navigate', args: { url: 'http://fixture/c' }, ok: true, repeated: true, error: null },
    ]
    expect(gateOf(decide(candidate), 'no-action-after-runtime-refusal').passed).toBe(true)
  })

  it('gates on the mandatory regressions input — not-run is not an accept', () => {
    expect(gateOf(decide(passingCandidate(), 'not-run'), 'mandatory-regressions').passed).toBe(false)
    expect(decide(passingCandidate(), 'not-run').decision).toBe('reject')
    expect(decide(passingCandidate(), 'failed').decision).toBe('reject')
  })

  it('carries provenance of both reports and keeps canaries diagnostic-only', () => {
    const decision = decide(passingCandidate())
    expect(decision.baseline.commit).toBe(BASELINE.gitCommit)
    expect(decision.candidate.commit).toBe('c'.repeat(40))
    expect(decision.canaries.status).toBe('not-run')
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
  it('reports the first re-execution after each refusal, per scenario', () => {
    const refusal = 'Not executed — this action repeats an equivalent action against unchanged page state.'
    const scenarios: ScenarioResult[] = [
      scenario('s', 'lookup', {
        metrics: {
          actions: [
            { name: 'type', args: { ref: 1, text: 'x\n' }, ok: false, repeated: false, error: refusal },
            { name: 'type', args: { ref: 1, text: 'x\n' }, ok: true, repeated: true, error: null },
            { name: 'type', args: { ref: 1, text: 'x\n' }, ok: true, repeated: true, error: null },
          ],
        },
      }),
    ]
    const violations = refusalViolations(report(scenarios, { median: 2, p95: 2 }))
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ scenarioId: 's', action: `type:${JSON.stringify({ ref: 1, text: 'x\n' })}` })
  })
})
