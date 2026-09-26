import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AGREEMENT_NOTE, comparePools, formatComparison } from './compare'
import type { EvalReport, ScenarioResult } from './evaluator'
import { decisionRecordsOf, type ScenarioMetrics } from './metrics'
import type { RoleRouting } from './routing'

// `eval:compare` (#279): two pools of three captures from one commit,
// compared on their shared corpus in the #274 gate's order, with pooled
// nearest-rank statistics and a Run's tier taken from the corpus of record.

const COMMIT = 'd'.repeat(40)
const JEV: RoleRouting = { configured: true, baseUrl: 'https://api.typesafe.ai', model: 'jev-1.13.0', keyFingerprint: 'sha256:j' }

function metrics(overrides: Partial<ScenarioMetrics> = {}): ScenarioMetrics {
  return {
    llmRounds: 2,
    attemptedTools: 2,
    executedTools: 2,
    elapsedMs: 10_000,
    secondsPerLlmRound: 5,
    repeatedActions: 0,
    deadlineTierEscalations: 0,
    budgetTierEscalations: 0,
    outcome: 'done',
    resolution: null,
    finalizationCause: null,
    effortTier: 'lookup',
    rawLimitFailure: null,
    askTimedOut: false,
    deterministicAnswer: false,
    subagentFinalizations: {},
    subagentBoundedReports: 0,
    actions: [],
    answerText: 'answer',
    timedOut: false,
    ...overrides,
  }
}

function scenario(id: string, kind: ScenarioResult['kind'], success: boolean, run: Partial<ScenarioMetrics>): ScenarioResult {
  const one = metrics(run)
  return { id, kind, command: id, success, failureReason: null, metrics: one, runs: [one] }
}

/** One pass: a Direct Action, a Lookup and an Investigation, timed as given. */
function pass(
  index: number,
  times: { da: number; lookup: number; investigation: number },
  options: { decision?: RoleRouting; commit?: string; orchestrator?: string; run?: Partial<ScenarioMetrics>; lookupSuccess?: boolean } = {},
): EvalReport {
  const scenarios = [
    scenario('direct-action-open-page', 'direct-action', true, { elapsedMs: times.da, effortTier: 'direct_action', llmRounds: 2, ...options.run }),
    // The model declared Investigation here; the corpus says Lookup, and the corpus wins.
    scenario('lookup-widgets-guide', 'lookup', options.lookupSuccess ?? true, { elapsedMs: times.lookup, effortTier: 'investigation', llmRounds: 5, ...options.run }),
    scenario('investigation-material-finish', 'investigation', true, { elapsedMs: times.investigation, effortTier: 'investigation', llmRounds: 12, ...options.run }),
  ]
  return {
    capturedAt: `2026-09-27T0${index}:00:00.000Z`,
    gitCommit: options.commit ?? COMMIT,
    scenarioTimeoutMs: 900_000,
    routing: {
      orchestrator: { configured: true, baseUrl: 'https://api', model: options.orchestrator ?? 'GLM-5.3', keyFingerprint: 'sha256:x' },
      subagent: { configured: true, baseUrl: 'https://api', model: 'GLM-5.3-flash', keyFingerprint: 'sha256:x' },
      vision: { configured: false },
      ...(options.decision === undefined ? {} : { decision: options.decision }),
    },
    scriptedModelProvenAbsent: true,
    modelWitness: { orchestratorModel: 'GLM-5.3', orchestratorRequests: 10, scriptedEntries: [], reasoningEffort: null, ...(options.decision === undefined ? {} : { decisionSeams: null }) },
    scenarios,
    aggregate: {
      scenarioCount: 3,
      objectiveSuccesses: 3,
      rawLimitFailures: 0,
      timedOutScenarios: 0,
      llmRounds: { median: 0, p95: 0 },
      attemptedTools: { median: 0, p95: 0 },
      executedTools: { median: 0, p95: 0 },
      elapsedMs: { median: 0, p95: 0 },
      repeatedActions: { median: 0, p95: 0 },
      secondsPerLlmRound: {},
      deterministicAnswers: 0,
      measuredRuns: 3,
    },
  }
}

const OFF_TIMES = [
  { da: 10_000, lookup: 40_000, investigation: 200_000 },
  { da: 20_000, lookup: 50_000, investigation: 210_000 },
  { da: 30_000, lookup: 60_000, investigation: 220_000 },
]
const ON_TIMES = [
  { da: 5_000, lookup: 35_000, investigation: 230_000 },
  { da: 15_000, lookup: 45_000, investigation: 240_000 },
  { da: 25_000, lookup: 55_000, investigation: 250_000 },
]

const onRun = { decisions: decisionRecordsOf([
  { kind: 'decision', seam: 'result', acted: 'acted', latencyMs: 100 },
  { kind: 'decision', seam: 'passage', acted: 'under_threshold', latencyMs: 300 },
]) }
const offRun = { decisions: decisionRecordsOf([]) }

const offArm = () => ({ source: 'e2e/eval/jev/off', reports: OFF_TIMES.map((times, index) => pass(index + 1, times, { decision: { configured: false }, run: offRun })) })
const onArm = () => ({ source: 'e2e/eval/jev/on', reports: ON_TIMES.map((times, index) => pass(index + 1, times, { decision: JEV, run: onRun })) })
const AT = new Date('2026-09-27T12:00:00.000Z')

describe('comparePools refusals', () => {
  it('refuses two commits', () => {
    const mixed = { source: 'b', reports: ON_TIMES.map((times, index) => pass(index + 1, times, { decision: JEV, commit: 'e'.repeat(40) })) }
    expect(() => comparePools(offArm(), mixed, AT)).toThrow(/two commits \(a ddddddd, b eeeeeee\)/)
  })

  it('refuses mixed commits inside one side, as eval:accept does', () => {
    const inside = onArm()
    inside.reports[2] = pass(3, ON_TIMES[2]!, { decision: JEV, commit: 'e'.repeat(40) })
    expect(() => comparePools(offArm(), inside, AT)).toThrow(/b pool must represent exactly one source commit/)
  })

  it('refuses unequal pool sizes, and a pair of pools that is not three and three', () => {
    const short = onArm()
    short.reports.pop()
    expect(() => comparePools(offArm(), short, AT)).toThrow('the pools hold 3 and 2 capture(s) — a comparison needs 3 on each side, from one commit')
    const bothShort = offArm()
    bothShort.reports.pop()
    expect(() => comparePools(bothShort, short, AT)).toThrow(/hold 2 and 2/)
  })

  it('refuses a difference in anything but the decision role', () => {
    const otherModel = { source: 'b', reports: ON_TIMES.map((times, index) => pass(index + 1, times, { decision: JEV, orchestrator: 'GLM-5.3-flash' })) }
    expect(() => comparePools(offArm(), otherModel, AT)).toThrow(/differ in orchestrator, subagent or vision routing/)
  })
})

describe('comparePools', () => {
  const comparison = comparePools(offArm(), onArm(), AT)

  it('pools nearest-rank over every Run of the three captures, per corpus-declared tier', () => {
    // Off, Direct Action + Lookup: 10 20 30 40 50 60 → nearest-rank p50 is the 3rd, p95 the 6th.
    expect(comparison.commandToAnswerMs.gated.a).toEqual({ n: 6, missing: 0, median: 30_000, p95: 60_000 })
    expect(comparison.commandToAnswerMs.gated.b).toEqual({ n: 6, missing: 0, median: 25_000, p95: 55_000 })
    expect(comparison.commandToAnswerMs.perTier.direct_action.a.median).toBe(20_000)
    // Every Lookup Run declared Investigation; it still counts as Lookup.
    expect(comparison.commandToAnswerMs.perTier.lookup.b).toEqual({ n: 3, missing: 0, median: 45_000, p95: 55_000 })
    expect(comparison.commandToAnswerMs.perTier.investigation.b.median).toBe(240_000)
    expect(comparison.roundsPerRun.lookup.a).toEqual({ n: 3, missing: 0, median: 5, p95: 5 })
  })

  it('tells the on arm by its configured decision role and judges the gate in order', () => {
    expect(comparison.onArm).toBe('b')
    expect(comparison.gate.map((line) => [line.gated, line.passed])).toEqual([
      [true, true],
      [true, true],
      [true, true],
      [false, null],
      [false, null],
      [false, null],
    ])
    expect(comparison.gate[0]!.detail).toBe('on (b) 25000 ms over 6 timed Run(s), off (a) 30000 ms over 6 timed Run(s)')
    expect(comparison.successes.gated).toEqual({ a: { succeeded: 6, scenarios: 6 }, b: { succeeded: 6, scenarios: 6 } })
  })

  it('fails the correctness veto on a lost Lookup, whatever the time says', () => {
    const lossy = onArm()
    lossy.reports[0] = pass(1, ON_TIMES[0]!, { decision: JEV, run: onRun, lookupSuccess: false })
    const vetoed = comparePools(offArm(), lossy, AT)
    expect(vetoed.gate[0]!.passed).toBe(true)
    expect(vetoed.gate[1]!.passed).toBe(false)
  })

  it('pools the Decision Records per seam and says agreement is not derivable here', () => {
    expect(comparison.decisions.b).toMatchObject({
      runs: 9,
      records: 18,
      byActed: { acted: 9, under_threshold: 9, unavailable: 0, shadow: 0 },
      latencyMs: { median: 100, p95: 300 },
      bySeam: { result: { records: 9, latencyMs: { median: 100, p95: 100 } }, passage: { records: 9 } },
    })
    expect(comparison.decisions.a).toMatchObject({ runs: 9, records: 0, latencyMs: null })
    expect(comparison.agreement).toBe(AGREEMENT_NOTE)
  })

  it('prints the gate first and in the #274 order, then the tables', () => {
    const markdown = formatComparison(comparison)
    const at = (text: string) => markdown.indexOf(text)
    const order = [
      'PASS time: pooled median command-to-Answer',
      'PASS correctness veto: Direct Action and Lookup scenario successes',
      'PASS correctness veto: deterministicAnswer',
      'REPORTED reported: rounds per Run per tier',
      'REPORTED reported: Decision Records per Run',
      'REPORTED reported: agreement',
      '## Command-to-Answer per tier',
      '## Decision Records',
    ]
    for (const text of order) expect(at(text), text).toBeGreaterThan(-1)
    expect(order.map(at)).toEqual([...order.map(at)].sort((left, right) => left - right))
    expect(markdown).toContain('| b | result | 9 | 1.00 | 9 | 0 | 0 | 0 | 100 / 100 ms |')
    expect(markdown).toContain('- b (on): decision=jev-1.13.0; seams unset (every seam)')
  })

  it('gives no verdict when both sides leave the role unconfigured, and reads captures before #279 as not recorded', () => {
    const before = { source: 'old', reports: OFF_TIMES.map((times, index) => pass(index + 1, times)) }
    const neither = comparePools(before, offArm(), AT)
    expect(neither.onArm).toBeNull()
    expect(neither.gate[0]!.passed).toBeNull()
    expect(neither.arms.a.decision).toBe('not recorded')
    expect(neither.decisions.a).toBeNull()
    expect(formatComparison(neither)).toContain('NO VERDICT time:')
  })
})

const [major, minor] = process.versions.node.split('.').map(Number)
const stripsTypes = major! > 22 || (major === 22 && minor! >= 18)

describe('the eval:compare CLI', () => {
  const SCRIPT = fileURLToPath(new URL('../../scripts/eval-compare.ts', import.meta.url))
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bingbong-eval-compare-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function run(args: readonly string[]): { status: number; stdout: string; stderr: string } {
    try {
      return { status: 0, stdout: execFileSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), stderr: '' }
    } catch (error) {
      const failure = error as { status?: number; stdout?: string; stderr?: string }
      return { status: failure.status ?? -1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' }
    }
  }

  function writePool(name: string, reports: readonly EvalReport[]): string {
    const pool = join(dir, name)
    mkdirSync(pool)
    reports.forEach((report, index) => writeFileSync(join(pool, `pass-${index + 1}-dddddddd.json`), JSON.stringify(report)))
    return pool
  }

  it.skipIf(!stripsTypes)('writes the comparison once as JSON and Markdown, and refuses broken input', () => {
    const off = writePool('off', offArm().reports)
    const on = writePool('on', onArm().reports)
    const first = run([`--a=${off}`, `--b=${on}`, `--out=${join(dir, 'out', 'compare')}`])
    expect(first.status, first.stderr).toBe(0)
    expect(first.stdout).toContain('PASS time: pooled median command-to-Answer')
    expect(JSON.parse(readFileSync(join(dir, 'out', 'compare.json'), 'utf8'))).toMatchObject({ kind: 'bingbong.eval.compare', onArm: 'b' })
    expect(readFileSync(join(dir, 'out', 'compare.md'), 'utf8')).toContain('## Gate (#274)')

    const again = run([`--a=${off}`, `--b=${on}`, `--out=${join(dir, 'out', 'compare')}`])
    expect(again.status).toBe(1)
    expect(again.stderr).toContain('refusing to overwrite')

    const short = writePool('short', onArm().reports.slice(0, 2))
    const unequal = run([`--a=${off}`, `--b=${short}`, `--out=${join(dir, 'x')}`])
    expect(unequal.status).toBe(1)
    expect(unequal.stderr).toContain('the pools hold 3 and 2 capture(s)')
    expect(run([`--a=${off}`, `--out=${join(dir, 'y')}`]).stderr).toContain('--b=<dir> is required')
  })
})
