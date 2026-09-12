import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { digestOf } from './artifacts.ts'
import { initializeLiveGrades, LIVE_GRADING_SCHEMA_VERSION, LIVE_KEY_MANIFEST_KIND, type LiveGradeStatus, type LiveKeyManifest } from './grades.ts'
import { attemptCapture, captureSet, sessionCapture, slotOf } from './gradingFixtures.ts'
import { buildLiveReport, LIVE_REPORT_KIND, LIVE_REPORT_VERSION, type LiveDisposition, type LivePopulation, type LiveReport, type LiveReportRow } from './report.ts'
import {
  buildLiveSummary,
  formatLiveSummary,
  LIVE_SUMMARY_KIND,
  LIVE_SUMMARY_VERSION,
  medianOf,
  parseLiveReportForSummary,
  type LiveSummary,
  type LiveSummaryInput,
} from './summary.ts'
import type { AttemptRelation, Observed } from './types.ts'

// Three reports → one summary (#233). The reports are hand-built at version
// 2 with only the parts the summary reads filled in meaningfully; the rest
// carries inert defaults. The assertions are about what the summary says:
// which inputs it refuses, which median it takes, and which missing value
// stays missing.

const SCRIPT = fileURLToPath(new URL('../../scripts/live-summary.ts', import.meta.url))
const GENERATED_AT = '2026-03-01T00:00:00.000Z'

const [major, minor] = process.versions.node.split('.').map(Number)
const stripsTypes = major! > 22 || (major === 22 && minor! >= 18)

const observed = (value: number): Observed<number> => ({ status: 'observed', value })
const notApplicable = (reason: string): Observed<number> => ({ status: 'not_applicable', reason })
const unavailable = (reason: string): Observed<number> => ({ status: 'unavailable', reason })

interface RowSpec {
  readonly huntId: string
  readonly stepId: string
  readonly relation?: AttemptRelation
  readonly parentAttemptId?: string
  readonly promptVersion?: string
  readonly disposition?: LiveDisposition
  readonly grade?: LiveGradeStatus
  readonly cause?: string | null
  /** The Answer latency; null leaves it unavailable. */
  readonly answerMs?: number | null
  readonly runMs?: number | null
  readonly flags?: readonly string[]
}

interface ReportSpec {
  readonly setId: string
  readonly createdAt: string
  readonly rows: readonly RowSpec[]
  readonly commit?: string
  readonly dirtyTree?: boolean
  readonly state?: string
  readonly keyVersion?: string
  readonly keyManifestDigest?: string
  readonly roles?: readonly string[]
  readonly reviewers?: readonly string[]
  readonly study?: string
  readonly protocolVersion?: string
  readonly mode?: string
  readonly adblock?: string
  readonly reasoningEffortOverride?: string | null
  readonly effortOverrides?: readonly string[]
  readonly gradesRevision?: number
  readonly warnings?: readonly string[]
  readonly anomalies?: readonly string[]
  readonly usageComplete?: boolean
  readonly orchestratorTokens?: number
}

function rowOf(spec: RowSpec, order: number): LiveReportRow {
  const disposition = spec.disposition ?? 'answered'
  const grade = spec.grade ?? 'unsuccessful'
  const verified = grade === 'pass'
  const dispatched = disposition !== 'not_reached' && disposition !== 'unaccounted'
  const answer = spec.answerMs === undefined ? 30_000 : spec.answerMs
  const latency: Observed<number> = !dispatched
    ? unavailable('no attempt was dispatched into this slot')
    : answer === null || disposition !== 'answered'
      ? unavailable('the Run published no final Answer')
      : observed(answer)
  const run = spec.runMs === undefined ? answer === null ? null : answer + 5_000 : spec.runMs
  return {
    attemptId: `${spec.huntId}--${spec.stepId}`,
    huntId: spec.huntId,
    stepId: spec.stepId,
    order,
    relation: spec.relation ?? 'initial',
    parentAttemptId: spec.parentAttemptId ?? null,
    promptVersion: spec.promptVersion ?? '1',
    captureId: dispatched ? `capture-${spec.huntId}` : null,
    disposition,
    dispositionReason: null,
    grade,
    reviewed: grade !== 'pending',
    verifiedSuccess: verified,
    mechanical: {
      outcome: dispatched ? 'done' : null,
      resolution: dispatched ? 'completed' : null,
      finalizationCause: (spec.cause === undefined ? (dispatched ? 'objective_met' : null) : spec.cause) as LiveReportRow['mechanical']['finalizationCause'],
      deterministicAnswer: dispatched ? false : null,
      stopReason: dispatched ? 'terminal' : null,
    },
    timing: {
      boundary: dispatched ? 'event_publication' : null,
      observedAnswerLatencyMs: latency,
      successfulTaskCompletionTimeMs: verified ? latency : notApplicable('the Answer is not independently verified'),
      runDurationMs: !dispatched || run === null ? unavailable('no terminal was observed') : observed(run),
      userWaitMs: notApplicable('no waits'),
      censoredElapsedMs: notApplicable('the Run reached its terminal'),
    },
    work: null,
    flags: spec.flags ?? [],
    artifacts: [],
  }
}

function populationOf(label: string, rows: readonly LiveReportRow[]): LivePopulation {
  const attempted = rows.filter((row) => ['answered', 'no_answer', 'acceptance_unconfirmed'].includes(row.disposition))
  const byGrade: Record<LiveGradeStatus, number> = { pending: 0, pass: 0, useful_partial: 0, help_access_blocked: 0, unsuccessful: 0 }
  for (const row of rows) byGrade[row.grade] += 1
  return {
    label,
    scheduled: rows.length,
    attempted: attempted.length,
    answered: rows.filter((row) => row.disposition === 'answered').length,
    notReached: rows.filter((row) => row.disposition === 'not_reached').length,
    unaccounted: rows.filter((row) => row.disposition === 'unaccounted').length,
    acceptanceUnconfirmed: rows.filter((row) => row.disposition === 'acceptance_unconfirmed').length,
    reviewed: rows.filter((row) => row.reviewed).length,
    pending: rows.filter((row) => row.grade === 'pending').length,
    verifiedSuccess: rows.filter((row) => row.verifiedSuccess).length,
    timedSuccess: rows.filter((row) => row.verifiedSuccess && row.timing.successfulTaskCompletionTimeMs.status === 'observed').length,
    verifiedOverReviewed: null,
    byGrade,
  }
}

/** A version-2 report with the parts the summary reads, and inert defaults elsewhere. */
function reportOf(spec: ReportSpec): LiveReport {
  const rows = spec.rows.map((row, index) => rowOf(row, index))
  const rowById = new Map(rows.map((row) => [row.attemptId, row]))
  const pairs = rows
    .filter((row) => row.relation === 'revised_objective' && row.parentAttemptId !== null)
    .map((followUp) => {
      const initial = rowById.get(followUp.parentAttemptId!)!
      const both = initial.verifiedSuccess && followUp.verifiedSuccess
      const followUpLatency = followUp.timing.observedAnswerLatencyMs
      return {
        huntId: followUp.huntId,
        initialAttemptId: initial.attemptId,
        followUpAttemptId: followUp.attemptId,
        initialVerified: initial.verifiedSuccess,
        followUpVerified: followUp.verifiedSuccess,
        bothVerified: both,
        // The fixture's follow-up is accepted 60 s after the initial.
        sequenceElapsedMs: !both
          ? notApplicable('a sequence elapsed time belongs to a pair that both steps passed')
          : followUpLatency.status === 'observed'
            ? observed(60_000 + followUpLatency.value)
            : followUpLatency,
        interCommandGapMs: unavailable('not modelled by the fixture'),
      }
    })
  const bothStepRows = pairs.map((pair) => ({ ...rowById.get(pair.followUpAttemptId)!, verifiedSuccess: pair.bothVerified, grade: pair.bothVerified ? ('pass' as const) : ('unsuccessful' as const) }))
  const empty = { observations: [], observed: 0, missing: 0, stats: null }
  const tokens = spec.orchestratorTokens ?? 1_000
  const complete = spec.usageComplete ?? true
  return {
    kind: LIVE_REPORT_KIND,
    reportVersion: LIVE_REPORT_VERSION,
    provenance: {
      setId: spec.setId,
      study: spec.study ?? 'bingbong.live-web.information-hunts',
      protocolVersion: spec.protocolVersion ?? '1',
      mode: spec.mode ?? 'measured',
      state: spec.state ?? 'complete',
      createdAt: spec.createdAt,
      commits: [spec.commit ?? 'aaaaaaaa11111111'],
      dirtyTree: spec.dirtyTree ?? false,
      promptVersions: [...new Set(rows.map((row) => row.promptVersion))].sort(),
      keyVersion: spec.keyVersion ?? '2.2.2.2',
      keyManifestDigest: spec.keyManifestDigest ?? 'sha256:faa25d04faa25d04',
      gradesRevision: spec.gradesRevision ?? 1,
      reviewers: spec.reviewers ?? ['claude-opus-5 via live:grade'],
      roles: spec.roles ?? ['orchestrator=GLM-5.3', 'subagent=GLM-5.3-flash', 'vision=GLM-4.6V'],
      reasoningEffortOverride: spec.reasoningEffortOverride === undefined ? null : spec.reasoningEffortOverride,
      effortOverrides: spec.effortOverrides ?? [],
      adblock: spec.adblock ?? 'production_default',
      generatedAt: '2026-02-01T00:00:00.000Z',
    },
    rows,
    populations: {
      initial: populationOf('initial', rows.filter((row) => row.relation === 'initial')),
      revisedObjective: populationOf('revised_objective', rows.filter((row) => row.relation === 'revised_objective')),
      corrective: populationOf('corrective', rows.filter((row) => row.relation === 'corrective')),
      bothStep: populationOf('both_step', bothStepRows),
    },
    pairs,
    latency: { successMs: empty, failureMs: empty, runDurationMs: empty, percentilesReported: ['min', 'median', 'max'] },
    cohorts: [],
    attribution: {
      clockOrigins: [],
      stages: [],
      attemptsWithSpans: 0,
      attemptsWithoutSpans: rows.length,
      retries: 0,
      toolCalls: 0,
      subagentsFinalized: 0,
      subagentStops: {},
      subagentBoundedReports: 0,
      subagentsUnobserved: 0,
      vision: { requests: 0, totalMs: null, attemptsCovered: 0 },
      userWaitMs: empty,
      speech: { synthesisMs: null, playbackMs: null, inputLatency: 'not_applicable' },
      stagesAreAdditive: false,
      note: 'fixture',
    },
    usage: {
      byRole: [
        { role: 'orchestrator', attemptsObserved: rows.length, attemptsUnavailable: 0, attemptsNotApplicable: 0, promptTokens: tokens, completionTokens: tokens / 10, rounds: 4, roundsWithUsage: complete ? 4 : 3, complete, models: ['GLM-5.3'] },
        { role: 'subagent', attemptsObserved: 0, attemptsUnavailable: 0, attemptsNotApplicable: rows.length, promptTokens: 0, completionTokens: 0, rounds: 0, roundsWithUsage: 0, complete: false, models: [] },
        { role: 'vision', attemptsObserved: 0, attemptsUnavailable: rows.length, attemptsNotApplicable: 0, promptTokens: 0, completionTokens: 0, rounds: 0, roundsWithUsage: 0, complete: false, models: [] },
      ],
      estimate: null,
      limits: [],
    },
    anomalies: spec.anomalies ?? [],
    warnings: spec.warnings ?? [],
  }
}

const input = (report: LiveReport, path = `reports/${report.provenance.setId}.json`): LiveSummaryInput => ({ path, report })

/** Two hunts, the first with a follow-up, in the shape of the pinned corpus. */
function passRows(overrides: Partial<Record<'a1' | 'a2' | 'b1', Partial<RowSpec>>> = {}): RowSpec[] {
  return [
    { huntId: 'hunt-a', stepId: 'initial', answerMs: 40_000, cause: 'budget_exhausted', ...overrides.a1 },
    { huntId: 'hunt-a', stepId: 'follow_up', relation: 'revised_objective', parentAttemptId: 'hunt-a--initial', grade: 'pass', answerMs: 288_000, ...overrides.a2 },
    { huntId: 'hunt-b', stepId: 'initial', answerMs: 20_000, cause: 'objective_met', ...overrides.b1 },
  ]
}

function threePasses(): LiveSummaryInput[] {
  return [
    input(reportOf({ setId: 'pass-1', createdAt: '2026-02-01T10:00:00.000Z', commit: 'c1c1c1c1c1c1c1c1', dirtyTree: true, rows: passRows() })),
    input(reportOf({ setId: 'pass-2', createdAt: '2026-02-01T11:00:00.000Z', commit: 'c2c2c2c2c2c2c2c2', rows: passRows({ a2: { answerMs: 297_000 }, a1: { answerMs: 50_000 } }) })),
    input(
      reportOf({
        setId: 'pass-3',
        createdAt: '2026-02-01T12:00:00.000Z',
        commit: 'c3c3c3c3c3c3c3c3',
        rows: passRows({ a2: { grade: 'unsuccessful', answerMs: 310_000, cause: 'budget_exhausted', flags: ['self_declared_completed_but_unverified'] }, b1: { answerMs: 25_000 } }),
      }),
    ),
  ]
}

function built(inputs: readonly LiveSummaryInput[]): LiveSummary {
  const result = buildLiveSummary(inputs, GENERATED_AT)
  if (!result.ok) throw new Error(`summary refused: ${result.errors.join('; ')}`)
  return result.value
}

function refused(inputs: readonly LiveSummaryInput[]): readonly string[] {
  const result = buildLiveSummary(inputs, GENERATED_AT)
  if (result.ok) throw new Error('the summary was accepted')
  return result.errors
}

function taskOf(summary: LiveSummary, huntId: string, stepId: string) {
  const task = summary.tasks.find((candidate) => candidate.huntId === huntId && candidate.stepId === stepId)
  if (task === undefined) throw new Error(`no task ${huntId}/${stepId}`)
  return task
}

describe('per-task statistics over passes', () => {
  it('takes min, median and max over the verified attempts and states n of N', () => {
    const summary = built(threePasses())
    expect(summary.kind).toBe(LIVE_SUMMARY_KIND)
    expect(summary.summaryVersion).toBe(LIVE_SUMMARY_VERSION)
    expect(summary.passes).toBe(3)

    const followUp = taskOf(summary, 'hunt-a', 'follow_up')
    expect(followUp.verified).toBe(2)
    expect(followUp.attempts).toBe(3)
    // Two verified of three passes: the third contributes nothing and is not a zero.
    expect(followUp.taskCompletionTimeMs).toEqual({ observations: [288_000, 297_000], observed: 2, passes: 3, stats: { minMs: 288_000, medianMs: 292_500, maxMs: 297_000 } })
    // The unverified third attempt keeps its latency as a measurement.
    expect(followUp.unverifiedAnswerLatencyMs).toEqual({ observations: [310_000], observed: 1, passes: 3, stats: { minMs: 310_000, medianMs: 310_000, maxMs: 310_000 } })
    expect(followUp.runDurationMs.observed).toBe(3)
    expect(followUp.finalizationCauses).toEqual({ budget_exhausted: 1, objective_met: 2 })
    expect(followUp.flags).toEqual({ self_declared_completed_but_unverified: 1 })

    const markdown = formatLiveSummary(summary)
    expect(markdown).toContain('- Task Completion Time (verified): n=2 of 3 passes: min 288000 ms | median 292500 ms | max 297000 ms')
    expect(markdown).toContain('- Answer latency (unverified): n=1 of 3 passes')
  })

  it('takes the middle value of an odd count and never a mean over three', () => {
    const summary = built(threePasses())
    const initial = taskOf(summary, 'hunt-a', 'initial')
    expect(initial.verified).toBe(0)
    expect(initial.taskCompletionTimeMs.stats).toBeNull()
    // 40 000, 50 000, 40 000 — the median is 40 000, not the mean 43 333.
    expect(initial.unverifiedAnswerLatencyMs.stats).toEqual({ minMs: 40_000, medianMs: 40_000, maxMs: 50_000 })
    expect(formatLiveSummary(summary)).toContain('- Task Completion Time (verified): no observations (n=0 of 3 passes)')
  })

  it('defines the median of an even count as the mean of the two middle values', () => {
    expect(medianOf([1, 2, 3, 4])).toBe(2.5)
    expect(medianOf([5])).toBe(5)
    expect(medianOf([1, 2, 10])).toBe(2)
  })

  it('reports the both-step sequence per hunt over pairs both steps of which verified', () => {
    const [one, two, three] = threePasses()
    const bothPass = input(reportOf({ setId: 'pass-4', createdAt: '2026-02-01T13:00:00.000Z', rows: passRows({ a1: { grade: 'pass', answerMs: 40_000 } }) }))
    const summary = built([one!, two!, three!, bothPass])
    expect(summary.sequences).toHaveLength(1)
    const sequence = summary.sequences[0]!
    expect(sequence.huntId).toBe('hunt-a')
    expect(sequence.rows.map((row) => row.bothVerified)).toEqual([false, false, false, true])
    expect(sequence.sequenceElapsedMs).toEqual({ observations: [348_000], observed: 1, passes: 4, stats: { minMs: 348_000, medianMs: 348_000, maxMs: 348_000 } })
    expect(summary.populations.bothStep.verifiedSuccess).toBe(1)

    const none = built(threePasses())
    expect(none.sequences[0]!.sequenceElapsedMs.stats).toBeNull()
    expect(formatLiveSummary(none)).toContain('- both-step sequence elapsed: no observations (n=0 of 3 passes)')
  })

  it('orders passes by createdAt whatever order the reports were named in, and labels them by set id', () => {
    const [one, two, three] = threePasses()
    const summary = built([three!, one!, two!])
    expect(summary.provenance.passes.map((pass) => pass.setId)).toEqual(['pass-1', 'pass-2', 'pass-3'])
    expect(taskOf(summary, 'hunt-b', 'initial').rows.map((row) => row.setId)).toEqual(['pass-1', 'pass-2', 'pass-3'])
    expect(formatLiveSummary(summary)).toContain('ordered by capture-set creation: pass-1, pass-2, pass-3.')
  })
})

describe('populations, usage and carried statements', () => {
  it('sums verified over scheduled across passes and lists every pass beside the sum', () => {
    const summary = built(threePasses())
    expect(summary.populations.initial.scheduled).toBe(6)
    expect(summary.populations.initial.verifiedSuccess).toBe(0)
    expect(summary.populations.initial.rate).toBe(0)
    expect(summary.populations.revisedObjective.perPass).toEqual([
      { setId: 'pass-1', verifiedSuccess: 1, scheduled: 1, rate: 1 },
      { setId: 'pass-2', verifiedSuccess: 1, scheduled: 1, rate: 1 },
      { setId: 'pass-3', verifiedSuccess: 0, scheduled: 1, rate: 0 },
    ])
    expect(summary.populations.corrective).toBeNull()
    const markdown = formatLiveSummary(summary)
    expect(markdown).toContain('| revised_objective | 2/3 (67%) | pass-1 1/1 · pass-2 1/1 · pass-3 0/1 |')
    expect(markdown).not.toContain('| corrective |')
  })

  it('reports a corrective population when any input scheduled one', () => {
    const [one, two] = threePasses()
    const withCorrective = input(
      reportOf({
        setId: 'pass-3',
        createdAt: '2026-02-01T12:00:00.000Z',
        rows: [...passRows(), { huntId: 'hunt-b', stepId: 'corrective', relation: 'corrective', parentAttemptId: 'hunt-b--initial', grade: 'pass', answerMs: 15_000 }],
      }),
    )
    // A corrective slot the other passes never scheduled is a schedule difference, refused.
    expect(refused([one!, two!, withCorrective]).join('\n')).toContain('scheduled tasks differ: pass-3 has hunt-b/corrective, which pass-1 does not')
  })

  it('sums usage per role and marks a role incomplete when any pass was', () => {
    const [one, two] = threePasses()
    const incomplete = input(reportOf({ setId: 'pass-3', createdAt: '2026-02-01T12:00:00.000Z', rows: passRows(), usageComplete: false, orchestratorTokens: 500 }))
    const summary = built([one!, two!, incomplete])
    const orchestrator = summary.usage.byRole.find((role) => role.role === 'orchestrator')!
    expect(orchestrator.promptTokens).toBe(2_500)
    expect(orchestrator.rounds).toBe(12)
    expect(orchestrator.roundsWithUsage).toBe(11)
    expect(orchestrator.complete).toBe(false)
    expect(orchestrator.incompleteIn).toEqual(['pass-3'])
    const vision = summary.usage.byRole.find((role) => role.role === 'vision')!
    expect(vision.attemptsUnavailable).toBe(9)
    expect(vision.complete).toBe(false)
    expect(summary.usage.limits.some((limit) => limit.startsWith('orchestrator: incomplete in pass-3'))).toBe(true)
    expect(summary.usage.limits.some((limit) => limit.includes('Vision usage is unavailable'))).toBe(true)
  })

  it('carries every warning and anomaly forward with its set id, and warns on an incomplete set', () => {
    const [one, two] = threePasses()
    const partial = input(
      reportOf({
        setId: 'pass-3',
        createdAt: '2026-02-01T12:00:00.000Z',
        state: 'partial',
        rows: passRows({ b1: { disposition: 'not_reached', grade: 'unsuccessful' } }),
        warnings: ['the capture set is partial — the runner stopped after hunt-a'],
        anomalies: ['Session capture capture-hunt-a holds attempt stray, which the set never scheduled'],
      }),
    )
    const summary = built([one!, two!, partial])
    expect(summary.warnings).toContainEqual({ setId: 'pass-3', message: 'the capture set is partial — the runner stopped after hunt-a' })
    expect(summary.warnings.some((warning) => warning.setId === 'pass-3' && warning.message.startsWith('the capture set is partial:'))).toBe(true)
    expect(summary.anomalies).toEqual([{ setId: 'pass-3', message: 'Session capture capture-hunt-a holds attempt stray, which the set never scheduled' }])
    expect(taskOf(summary, 'hunt-b', 'initial').rows.map((row) => row.disposition)).toEqual(['answered', 'answered', 'not_reached'])
    const markdown = formatLiveSummary(summary)
    expect(markdown).toContain('- pass-3: the capture set is partial')
    expect(markdown).toContain('- pass-3: Session capture capture-hunt-a holds attempt stray')
  })

  it('states the statistics rule with N substituted, and leaves attribution to the per-set reports', () => {
    const summary = built(threePasses())
    expect(summary.statistics.note).toBe(
      'Min, median and max only, over 3 passes. 3 repeats do not support a p95, a mean or a confidence interval, and none is offered. A median of an even count is the mean of its two middle values.',
    )
    const markdown = formatLiveSummary(summary)
    expect(markdown).toContain(summary.statistics.note)
    expect(markdown).not.toContain('## Where the time went')
    expect(markdown).toContain('the per-set reports keep the stage tables')
    expect(summary.statistics.percentilesReported).toEqual(['min', 'median', 'max'])
  })

  it('names every input by set id, path, commit and dirty-tree flag, and the shared facts once', () => {
    const summary = built(threePasses())
    expect(summary.provenance.passes[0]).toMatchObject({ setId: 'pass-1', reportPath: 'reports/pass-1.json', commits: ['c1c1c1c1c1c1c1c1'], dirtyTree: true, gradesRevision: 1 })
    expect(summary.provenance.keyVersion).toBe('2.2.2.2')
    expect(summary.provenance.reviewers).toEqual(['claude-opus-5 via live:grade'])
    const markdown = formatLiveSummary(summary)
    expect(markdown).toContain('| pass-1 | reports/pass-1.json | 2026-02-01T10:00:00.000Z | complete | c1c1c1c1 | yes | 1 |')
    expect(markdown).toContain('| pass-2 | reports/pass-2.json | 2026-02-01T11:00:00.000Z | complete | c2c2c2c2 | no | 1 |')
    expect(markdown.match(/- reviewer\(s\): claude-opus-5 via live:grade/g)).toHaveLength(1)
    expect(markdown).toContain('- routing: orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V')
  })
})

describe('refusals', () => {
  function withThird(spec: Partial<ReportSpec>): LiveSummaryInput[] {
    const [one, two] = threePasses()
    return [one!, two!, input(reportOf({ setId: 'pass-3', createdAt: '2026-02-01T12:00:00.000Z', rows: passRows(), ...spec }))]
  }

  it.each([
    ['key version', { keyVersion: '3.0.0.0' }, 'key version differs: pass-1=2.2.2.2, pass-2=2.2.2.2, pass-3=3.0.0.0'],
    ['key manifest digest', { keyManifestDigest: 'sha256:other' }, 'key manifest digest differs: pass-1=sha256:faa25d04faa25d04, pass-2=sha256:faa25d04faa25d04, pass-3=sha256:other'],
    ['routing', { roles: ['orchestrator=GLM-5.3-flash', 'subagent=GLM-5.3-flash', 'vision=GLM-4.6V'] }, 'routing differs: pass-1=orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V, pass-2=orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V, pass-3=orchestrator=GLM-5.3-flash; subagent=GLM-5.3-flash; vision=GLM-4.6V'],
    ['reviewer', { reviewers: ['evaluator-1'] }, 'reviewer differs: pass-1=claude-opus-5 via live:grade, pass-2=claude-opus-5 via live:grade, pass-3=evaluator-1'],
    ['study', { study: 'bingbong.live-web.other' }, 'study differs: pass-1=bingbong.live-web.information-hunts, pass-2=bingbong.live-web.information-hunts, pass-3=bingbong.live-web.other'],
    ['protocol version', { protocolVersion: '2' }, 'protocol version differs: pass-1=1, pass-2=1, pass-3=2'],
    ['mode', { mode: 'smoke' }, 'mode differs: pass-1=measured, pass-2=measured, pass-3=smoke'],
    ['adblock', { adblock: 'none' }, 'adblock differs: pass-1=production_default, pass-2=production_default, pass-3=none'],
    ['reasoning-effort override', { reasoningEffortOverride: 'low' }, 'reasoning-effort override differs: pass-1=none, pass-2=none, pass-3=low'],
    ['effort overrides', { effortOverrides: ['subagent=high'] }, 'effort overrides differs: pass-1=none, pass-2=none, pass-3=subagent=high'],
  ] as const)('refuses a mixed %s and names the differing values', (_name, spec, message) => {
    expect(refused(withThird(spec))).toContain(message)
  })

  it('refuses a mixed prompt version on one task', () => {
    const [one, two] = threePasses()
    const moved = input(reportOf({ setId: 'pass-3', createdAt: '2026-02-01T12:00:00.000Z', rows: passRows({ b1: { promptVersion: '2' } }) }))
    expect(refused([one!, two!, moved])).toContain('prompt version of hunt-b/initial differs: pass-1=1, pass-2=1, pass-3=2')
  })

  it('does not compare commit, dirty tree or grades revision', () => {
    const summary = built(withThird({ commit: 'ffffffffffffffff', dirtyTree: true, gradesRevision: 3 }))
    expect(summary.provenance.passes[2]).toMatchObject({ commits: ['ffffffffffffffff'], dirtyTree: true, gradesRevision: 3 })
  })

  it('refuses a capture set named twice, and two sets sharing a createdAt', () => {
    const [one, two] = threePasses()
    const twice = refused([one!, two!, input(one!.report, 'reports/copy-of-pass-1.json')])
    expect(twice).toContain('capture set pass-1 is named 2 times (reports/pass-1.json, reports/copy-of-pass-1.json): one Pass counts once')

    const sameStamp = input(reportOf({ setId: 'pass-3', createdAt: one!.report.provenance.createdAt, rows: passRows() }))
    expect(refused([one!, two!, sameStamp])).toContain('capture sets pass-1 and pass-3 share createdAt 2026-02-01T10:00:00.000Z: one Pass counts once')
  })

  it('refuses fewer than two inputs', () => {
    const [one] = threePasses()
    expect(refused([one!])).toEqual(['1 report(s) named; a summary needs at least two Passes — for one Pass, read its report'])
    expect(refused([])).toEqual(['0 report(s) named; a summary needs at least two Passes — for one Pass, read its report'])
  })

  it('refuses a report of the wrong kind or version at parse time', () => {
    const report = threePasses()[0]!.report
    const wrongKind = parseLiveReportForSummary({ ...report, kind: 'bingbong.live.grades' }, 'x.json')
    expect(wrongKind).toEqual({ ok: false, errors: ['x.json: kind is "bingbong.live.grades", not bingbong.live.report'] })
    const wrongVersion = parseLiveReportForSummary({ ...report, reportVersion: 1 }, 'x.json')
    expect(wrongVersion.ok).toBe(false)
    if (!wrongVersion.ok) expect(wrongVersion.errors[0]).toContain('reportVersion is 1, and this summary reads version 2')
    const noReviewers = parseLiveReportForSummary({ ...report, provenance: { ...report.provenance, reviewers: undefined } }, 'x.json')
    expect(noReviewers.ok).toBe(false)
    if (!noReviewers.ok) expect(noReviewers.errors).toContain('x.json: provenance.reviewers is not a list of strings')
    expect(parseLiveReportForSummary(report, 'x.json').ok).toBe(true)
  })
})

describe('nothing private reaches the summary', () => {
  function manifestFor(steps: readonly { huntId: string; stepId: string }[]): LiveKeyManifest {
    return {
      kind: LIVE_KEY_MANIFEST_KIND,
      schemaVersion: LIVE_GRADING_SCHEMA_VERSION,
      keyVersion: 'k1',
      keyDigest: digestOf('private key k1'),
      preparedAt: '2026-01-01T00:00:00.000Z',
      tasks: steps.map((step) => ({
        huntId: step.huntId,
        stepId: step.stepId,
        promptVersion: 'p1',
        keyRef: `private/keys.md#${step.huntId}-${step.stepId}`,
        checks: [{ checkId: 'c1', description: 'reaches the invented conclusion' }],
      })),
    }
  }

  /** A real capture → grades → report chain, so the sentinels enter where they would in practice. */
  function realReport(setId: string, createdAt: string, sentinel: string): LiveReport {
    const attempt = attemptCapture({ attemptId: 'a1', huntId: 'hunt-a', commandText: `${sentinel}-COMMAND`, answer: { at: 10_000, text: `${sentinel}-ANSWER` } })
    const session = sessionCapture({ captureId: 'capture-hunt-a', huntId: 'hunt-a', attempts: [attempt], setId })
    const set = { ...captureSet({ slots: [slotOf(attempt)], sessions: [session] }), setId, createdAt }
    const manifest = manifestFor([{ huntId: 'hunt-a', stepId: 'initial' }])
    const pending = initializeLiveGrades({ set, sessions: [session], manifest })
    const grades = {
      ...pending,
      entries: pending.entries.map((entry) => ({
        ...entry,
        status: 'pass' as const,
        checks: [{ checkId: 'c1', satisfied: true, note: `${sentinel}-NOTE` }],
        support: [{ claim: `${sentinel}-CLAIM`, sourceUrl: `https://example.invalid/${sentinel}-SOURCE`, passageRef: 'S1' }],
        rationale: `${sentinel}-RATIONALE`,
        reviewer: 'evaluator-1',
        reviewedAt: '2026-01-15T00:00:00.000Z',
      })),
    }
    const result = buildLiveReport({ set, sessions: [session], grades, manifest, generatedAt: GENERATED_AT })
    if (!result.ok) throw new Error(result.errors.join('; '))
    return result.value
  }

  it('carries no rationale, note, Answer text, command text or key source URL in either format', () => {
    const summary = built([
      input(realReport('set-1', '2026-02-01T10:00:00.000Z', 'SENTINEL-ONE')),
      input(realReport('set-2', '2026-02-01T11:00:00.000Z', 'SENTINEL-TWO')),
    ])
    for (const rendered of [formatLiveSummary(summary), JSON.stringify(summary)]) {
      expect(rendered).not.toContain('SENTINEL')
      expect(rendered).not.toContain('example.invalid')
      expect(rendered).not.toContain('private/keys.md')
    }
    // The Answer's identity survives as a timing.
    expect(formatLiveSummary(summary)).toContain('n=2 of 2 passes: min 10000 ms | median 10000 ms | max 10000 ms')
  })
})

describe('the live:summary CLI', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bingbong-live-summary-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function run(args: readonly string[]): { stdout: string; status: number; stderr: string } {
    try {
      const stdout = execFileSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      return { stdout, status: 0, stderr: '' }
    } catch (error) {
      const failure = error as { status?: number; stdout?: string; stderr?: string }
      return { stdout: failure.stdout ?? '', status: failure.status ?? -1, stderr: failure.stderr ?? '' }
    }
  }

  function writeReports(): string[] {
    return threePasses().map((pass) => {
      const path = join(dir, `${pass.report.provenance.setId}.json`)
      writeFileSync(path, `${JSON.stringify(pass.report, null, 2)}\n`)
      return path
    })
  }

  it.skipIf(!stripsTypes)('writes both formats, names inputs by relative path, and refuses to write twice', () => {
    const reports = writeReports()
    const before = reports.map((path) => readFileSync(path))
    const markdownOut = join(dir, 'summary.md')
    const first = run([`--reports=${reports.join(',')}`, `--out=${markdownOut}`])
    expect(first.status, first.stderr).toBe(0)
    expect(first.stdout).toContain('written: summary.md')
    expect(first.stdout).toContain('3 passes')
    const markdown = readFileSync(markdownOut, 'utf8')
    expect(markdown).toContain('# Live-web baseline summary')
    expect(markdown).toContain('| pass-1 | pass-1.json |')
    expect(markdown).not.toContain(dir)

    const jsonOut = join(dir, 'summary.json')
    const second = run([`--reports=${reports.join(',')}`, `--out=${jsonOut}`, '--format=json'])
    expect(second.status, second.stderr).toBe(0)
    const summary = JSON.parse(readFileSync(jsonOut, 'utf8')) as LiveSummary
    expect(summary.kind).toBe(LIVE_SUMMARY_KIND)
    expect(summary.summaryVersion).toBe(LIVE_SUMMARY_VERSION)
    expect(summary.provenance.passes.map((pass) => pass.reportPath)).toEqual(['pass-1.json', 'pass-2.json', 'pass-3.json'])

    const again = run([`--reports=${reports.join(',')}`, `--out=${markdownOut}`])
    expect(again.status).toBe(1)
    expect(again.stderr).toContain('refusing to overwrite')
    expect(readFileSync(markdownOut, 'utf8')).toBe(markdown)
    expect(reports.map((path) => readFileSync(path))).toEqual(before)
  })

  it.skipIf(!stripsTypes)('refuses a missing input by path, a single input, a bad format and an unknown option', () => {
    const reports = writeReports()
    const missing = run([`--reports=${reports[0]},${join(dir, 'absent.json')}`, `--out=${join(dir, 'out.md')}`])
    expect(missing.status).toBe(1)
    expect(missing.stderr).toContain('does not exist at absent.json')

    const single = run([`--reports=${reports[0]}`, `--out=${join(dir, 'out.md')}`])
    expect(single.status).toBe(1)
    expect(single.stderr).toContain('at least two Passes')

    const badFormat = run([`--reports=${reports.join(',')}`, `--out=${join(dir, 'out.md')}`, '--format=csv'])
    expect(badFormat.status).toBe(1)
    expect(badFormat.stderr).toContain('--format must be markdown or json')

    const unknown = run([`--reports=${reports.join(',')}`, `--out=${join(dir, 'out.md')}`, '--pricing=x.json'])
    expect(unknown.status).toBe(1)
    expect(unknown.stderr).toContain('does not take --pricing')

    const noOut = run([`--reports=${reports.join(',')}`])
    expect(noOut.status).toBe(1)
    expect(noOut.stderr).toContain('--out is required')
  })

  it.skipIf(!stripsTypes)('refuses mixed inputs with the differing values named, and a report of another version', () => {
    const reports = writeReports()
    const mixed = join(dir, 'mixed.json')
    writeFileSync(mixed, `${JSON.stringify(reportOf({ setId: 'pass-4', createdAt: '2026-02-01T13:00:00.000Z', rows: passRows(), keyVersion: '9.9.9.9' }), null, 2)}\n`)
    const refusedMixed = run([`--reports=${reports.join(',')},${mixed}`, `--out=${join(dir, 'out.md')}`])
    expect(refusedMixed.status).toBe(1)
    expect(refusedMixed.stderr).toContain('key version differs')
    expect(refusedMixed.stderr).toContain('pass-4=9.9.9.9')

    const old = join(dir, 'old.json')
    writeFileSync(old, `${JSON.stringify({ ...threePasses()[0]!.report, reportVersion: 1, provenance: { ...threePasses()[0]!.report.provenance, setId: 'old' } }, null, 2)}\n`)
    const refusedOld = run([`--reports=${reports.join(',')},${old}`, `--out=${join(dir, 'out.md')}`])
    expect(refusedOld.status).toBe(1)
    expect(refusedOld.stderr).toContain('old.json: reportVersion is 1')

    const notJson = join(dir, 'broken.json')
    writeFileSync(notJson, 'not json, mentioning SENTINEL-SECRET')
    const broken = run([`--reports=${reports.join(',')},${notJson}`, `--out=${join(dir, 'out.md')}`])
    expect(broken.status).toBe(1)
    expect(broken.stderr).toContain('not valid JSON')
    expect(broken.stderr).not.toContain('SENTINEL-SECRET')
  })
})
