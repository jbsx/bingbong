import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { digestOf } from './artifacts.ts'
import {
  answerBindingOf,
  initializeLiveGrades,
  keyManifestDigest,
  LIVE_GRADES_KIND,
  LIVE_GRADING_SCHEMA_VERSION,
  LIVE_KEY_MANIFEST_KIND,
  type LiveGradeEntry,
  type LiveGrades,
  type LiveGradeStatus,
  type LiveKeyManifest,
} from './grades.ts'
import { attemptCapture, captureSet, notReached, sessionCapture, slotOf, span, T0 } from './gradingFixtures.ts'
import { buildLiveReport, formatLiveReport, type LiveReport, type LiveReportInput } from './report.ts'
import type { LiveAttemptCapture, LiveAttemptRecord, LiveCaptureSet, LiveSessionCapture } from './types.ts'

// Capture → grades → report, end to end (#226). The assertions are about
// what the report says, not how it is put together: which denominators
// hold, which Answer earns a Task Completion Time, and which observation
// stays missing rather than becoming a zero. The facts are invented; a
// suite carrying the pilot's real key would be testing the key.

const SCRIPT = fileURLToPath(new URL('../../scripts/live-report.ts', import.meta.url))
const GENERATED_AT = '2026-02-01T00:00:00.000Z'

const [major, minor] = process.versions.node.split('.').map(Number)
const stripsTypes = major! > 22 || (major === 22 && minor! >= 18)

function manifestFor(steps: readonly { huntId: string; stepId: string }[], keyVersion = 'k1'): LiveKeyManifest {
  return {
    kind: LIVE_KEY_MANIFEST_KIND,
    schemaVersion: LIVE_GRADING_SCHEMA_VERSION,
    keyVersion,
    keyDigest: digestOf(`private key ${keyVersion}`),
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

/** Grade one slot, reusing the pending entry the initializer produced. */
function grade(
  grades: LiveGrades,
  attemptId: string,
  status: LiveGradeStatus,
  overrides: Partial<LiveGradeEntry> = {},
): LiveGrades {
  return {
    ...grades,
    entries: grades.entries.map((entry) =>
      entry.attemptId !== attemptId
        ? entry
        : {
            ...entry,
            status,
            checks: [{ checkId: 'c1', satisfied: status === 'pass' }],
            support: status === 'pass' ? [{ claim: 'the invented conclusion', sourceUrl: 'https://example.invalid/a', passageRef: 'S1' }] : [],
            rationale: `graded ${status} against the key`,
            reviewer: 'evaluator-1',
            reviewedAt: '2026-01-15T00:00:00.000Z',
            ...overrides,
          },
    ),
  }
}

function inputFor(
  set: LiveCaptureSet,
  sessions: readonly LiveSessionCapture[],
  manifest: LiveKeyManifest,
  gradeWith: (grades: LiveGrades) => LiveGrades = (grades) => grades,
): LiveReportInput {
  const pending = initializeLiveGrades({ set, sessions, manifest })
  return { set, sessions, grades: gradeWith(pending), manifest, generatedAt: GENERATED_AT }
}

function built(input: LiveReportInput): LiveReport {
  const result = buildLiveReport(input)
  if (!result.ok) throw new Error(`report refused: ${result.errors.join('; ')}`)
  return result.value
}

function rowOf(report: LiveReport, attemptId: string) {
  const row = report.rows.find((candidate) => candidate.attemptId === attemptId)
  if (row === undefined) throw new Error(`no row for ${attemptId}`)
  return row
}

/**
 * Two hunts, each an initial plus a scheduled revised-objective follow-up.
 * The shape the pinned 0/2, 1/2, 0/2 example is built on.
 */
function pairedFixture(options: { secondFollowUpReached: boolean }): {
  set: LiveCaptureSet
  sessions: LiveSessionCapture[]
  manifest: LiveKeyManifest
} {
  const a1 = attemptCapture({ attemptId: 'a1', huntId: 'hunt-a', stepId: 'initial', order: 0, answer: { at: 20_000, text: 'answer a1' } })
  const a2 = attemptCapture({
    attemptId: 'a2',
    huntId: 'hunt-a',
    stepId: 'follow_up',
    order: 1,
    relation: 'revised_objective',
    parentAttemptId: 'a1',
    acceptedAt: 60_000,
    answer: { at: 75_000, text: 'answer a2' },
    terminal: { at: 80_000 },
  })
  const b1 = attemptCapture({ attemptId: 'b1', huntId: 'hunt-b', stepId: 'initial', order: 2, answer: { at: 31_000, text: 'answer b1' } })
  const b2: LiveAttemptRecord = options.secondFollowUpReached
    ? attemptCapture({
        attemptId: 'b2',
        huntId: 'hunt-b',
        stepId: 'follow_up',
        order: 3,
        relation: 'revised_objective',
        parentAttemptId: 'b1',
        acceptedAt: 60_000,
        answer: { at: 70_000, text: 'answer b2' },
      })
    : notReached({ attemptId: 'b2', huntId: 'hunt-b', stepId: 'follow_up', order: 3, parentAttemptId: 'b1', reason: 'the Session was awaiting help and could not accept the follow-up' })

  const sessionA = sessionCapture({ captureId: 'capture-hunt-a', huntId: 'hunt-a', attempts: [a1, a2], setId: 'set-1' })
  const sessionB = sessionCapture({ captureId: 'capture-hunt-b', huntId: 'hunt-b', attempts: [b1, b2], setId: 'set-1' })
  return {
    set: captureSet({ slots: [slotOf(a1), slotOf(a2), slotOf(b1), slotOf(b2)], sessions: [sessionA, sessionB] }),
    sessions: [sessionA, sessionB],
    manifest: manifestFor([
      { huntId: 'hunt-a', stepId: 'initial' },
      { huntId: 'hunt-a', stepId: 'follow_up' },
      { huntId: 'hunt-b', stepId: 'initial' },
      { huntId: 'hunt-b', stepId: 'follow_up' },
    ]),
  }
}

describe('populations and denominators', () => {
  it('reports initials 0/2, follow-ups 1/2 and both-step 0/2 for the pinned example', () => {
    // Two initials fail. One fixed follow-up passes; the other is never
    // reached. A correct follow-up cannot repair the initial that failed,
    // and the unreached one is visible rather than dropped.
    const { set, sessions, manifest } = pairedFixture({ secondFollowUpReached: false })
    const report = built(
      inputFor(set, sessions, manifest, (grades) => {
        let next = grade(grades, 'a1', 'unsuccessful')
        next = grade(next, 'a2', 'pass')
        next = grade(next, 'b1', 'unsuccessful')
        return next
      }),
    )

    expect(report.populations.initial.verifiedSuccess).toBe(0)
    expect(report.populations.initial.scheduled).toBe(2)
    expect(report.populations.revisedObjective.verifiedSuccess).toBe(1)
    expect(report.populations.revisedObjective.scheduled).toBe(2)
    expect(report.populations.bothStep.verifiedSuccess).toBe(0)
    expect(report.populations.bothStep.scheduled).toBe(2)

    // The not-reached follow-up stays visible, keeps its reason, and is
    // never a pass.
    const unreached = rowOf(report, 'b2')
    expect(unreached.disposition).toBe('not_reached')
    expect(unreached.dispositionReason).toContain('awaiting help')
    expect(unreached.verifiedSuccess).toBe(false)
    expect(report.populations.revisedObjective.notReached).toBe(1)

    // Both failed initials keep their latency — a wrong Answer is still a
    // measured Answer.
    expect(rowOf(report, 'a1').timing.observedAnswerLatencyMs).toEqual({ status: 'observed', value: 20_000 })
    expect(rowOf(report, 'b1').timing.observedAnswerLatencyMs).toEqual({ status: 'observed', value: 31_000 })
    expect(report.latency.failureMs.observations).toEqual([20_000, 31_000])
  })

  it('adds an initial-only third hunt to the initial population alone', () => {
    const { set, sessions, manifest } = pairedFixture({ secondFollowUpReached: false })
    const c1 = attemptCapture({ attemptId: 'c1', huntId: 'hunt-c', stepId: 'initial', order: 4, answer: { at: 12_000, text: 'answer c1' } })
    const sessionC = sessionCapture({ captureId: 'capture-hunt-c', huntId: 'hunt-c', attempts: [c1], setId: 'set-1' })
    const widened = captureSet({ slots: [...set.slots, slotOf(c1)], sessions: [...sessions, sessionC] })
    const manifestC: LiveKeyManifest = { ...manifest, tasks: [...manifest.tasks, ...manifestFor([{ huntId: 'hunt-c', stepId: 'initial' }]).tasks] }

    const report = built(
      inputFor(widened, [...sessions, sessionC], manifestC, (grades) => {
        let next = grade(grades, 'a1', 'unsuccessful')
        next = grade(next, 'a2', 'pass')
        next = grade(next, 'b1', 'unsuccessful')
        return grade(next, 'c1', 'pass')
      }),
    )

    expect(report.populations.initial.scheduled).toBe(3)
    expect(report.populations.initial.verifiedSuccess).toBe(1)
    // The follow-up and both-step denominators are untouched by a hunt
    // that scheduled no follow-up.
    expect(report.populations.revisedObjective.scheduled).toBe(2)
    expect(report.populations.bothStep.scheduled).toBe(2)
  })

  it('passes a both-step pair only when both steps pass, and times it end to end', () => {
    const { set, sessions, manifest } = pairedFixture({ secondFollowUpReached: true })
    const report = built(
      inputFor(set, sessions, manifest, (grades) => {
        let next = grade(grades, 'a1', 'pass')
        next = grade(next, 'a2', 'pass')
        next = grade(next, 'b1', 'pass')
        return grade(next, 'b2', 'unsuccessful')
      }),
    )

    expect(report.populations.bothStep.verifiedSuccess).toBe(1)
    const passing = report.pairs.find((pair) => pair.huntId === 'hunt-a')!
    expect(passing.bothVerified).toBe(true)
    // Initial acceptance (T0) to the follow-up's Answer (T0+75s).
    expect(passing.sequenceElapsedMs).toEqual({ status: 'observed', value: 75_000 })
    // The gap between the initial's terminal and the follow-up's command.
    expect(passing.interCommandGapMs).toEqual({ status: 'observed', value: 20_000 })

    const failing = report.pairs.find((pair) => pair.huntId === 'hunt-b')!
    expect(failing.bothVerified).toBe(false)
    expect(failing.sequenceElapsedMs.status).toBe('not_applicable')
    // Each step keeps its own time regardless of the pair's verdict.
    expect(rowOf(report, 'b1').timing.successfulTaskCompletionTimeMs).toEqual({ status: 'observed', value: 31_000 })
  })
})

describe('Task Success and Task Completion Time', () => {
  const manifest = manifestFor([{ huntId: 'hunt-a', stepId: 'initial' }])

  function single(attempt: LiveAttemptCapture): { set: LiveCaptureSet; sessions: LiveSessionCapture[] } {
    const session = sessionCapture({ captureId: 'capture-hunt-a', huntId: 'hunt-a', attempts: [attempt], setId: 'set-1' })
    return { set: captureSet({ slots: [slotOf(attempt)], sessions: [session] }), sessions: [session] }
  }

  it('does not treat a self-declared completed Run as success', () => {
    const attempt = attemptCapture({
      attemptId: 'a1',
      huntId: 'hunt-a',
      answer: { at: 9_000, text: 'a confident wrong answer' },
      terminal: { at: 10_000, outcome: 'done', resolution: 'completed', finalizationCause: 'objective_met' },
    })
    const { set, sessions } = single(attempt)
    const report = built(inputFor(set, sessions, manifest, (grades) => grade(grades, 'a1', 'unsuccessful')))
    const row = rowOf(report, 'a1')

    // The mechanical facts are reported, and they are not the verdict.
    expect(row.mechanical.outcome).toBe('done')
    expect(row.mechanical.resolution).toBe('completed')
    expect(row.verifiedSuccess).toBe(false)
    expect(row.flags).toContain('self_declared_completed_but_unverified')
    expect(row.timing.successfulTaskCompletionTimeMs.status).toBe('not_applicable')
    // The latency survives the failed grade.
    expect(row.timing.observedAnswerLatencyMs).toEqual({ status: 'observed', value: 9_000 })
    expect(report.populations.initial.verifiedSuccess).toBe(0)
  })

  it('never opens a pass from a completed Run, and reports it as pending until reviewed', () => {
    const attempt = attemptCapture({
      attemptId: 'a1',
      huntId: 'hunt-a',
      terminal: { at: 10_000, outcome: 'done', resolution: 'completed', finalizationCause: 'objective_met' },
    })
    const { set, sessions } = single(attempt)
    const report = built(inputFor(set, sessions, manifest))

    expect(rowOf(report, 'a1').grade).toBe('pending')
    expect(report.populations.initial.pending).toBe(1)
    expect(report.populations.initial.verifiedSuccess).toBe(0)
    expect(report.warnings.join(' ')).toContain('grading is incomplete')
  })

  it('measures completion to the Answer, not to a much later terminal', () => {
    const attempt = attemptCapture({
      attemptId: 'a1',
      huntId: 'hunt-a',
      answer: { at: 12_000, text: 'the verified answer' },
      terminal: { at: 300_000 },
    })
    const { set, sessions } = single(attempt)
    const row = rowOf(built(inputFor(set, sessions, manifest, (grades) => grade(grades, 'a1', 'pass'))), 'a1')

    expect(row.timing.successfulTaskCompletionTimeMs).toEqual({ status: 'observed', value: 12_000 })
    expect(row.timing.runDurationMs).toEqual({ status: 'observed', value: 300_000 })
  })

  it('keeps a verified Answer whose timing is missing — correctness and timing are independent', () => {
    // The Answer was published but the command event never carried a
    // finite stamp, so no latency can be computed. The grade still stands.
    const attempt = attemptCapture({ attemptId: 'a1', huntId: 'hunt-a', acceptedAt: null, answer: { at: 12_000, text: 'the verified answer' } })
    const { set, sessions } = single(attempt)
    const report = built(inputFor(set, sessions, manifest, (grades) => grade(grades, 'a1', 'pass')))
    const row = rowOf(report, 'a1')

    expect(row.verifiedSuccess).toBe(true)
    expect(row.disposition).toBe('acceptance_unconfirmed')
    expect(row.timing.successfulTaskCompletionTimeMs.status).toBe('unavailable')
    expect(report.populations.initial.verifiedSuccess).toBe(1)
    // Verified but untimed: the two counts differ, and both are printed.
    expect(report.populations.initial.timedSuccess).toBe(0)
    expect(report.latency.successMs.stats).toBeNull()
    expect(report.latency.successMs.missing).toBe(1)
  })

  it('acknowledges a published Answer even when the Run then failed', () => {
    const attempt = attemptCapture({
      attemptId: 'a1',
      huntId: 'hunt-a',
      answer: { at: 8_000, text: 'the verified answer' },
      terminal: { at: 9_000, outcome: 'failed', resolution: null, finalizationCause: null },
    })
    const { set, sessions } = single(attempt)
    const row = rowOf(built(inputFor(set, sessions, manifest, (grades) => grade(grades, 'a1', 'pass'))), 'a1')

    expect(row.mechanical.outcome).toBe('failed')
    expect(row.verifiedSuccess).toBe(true)
    expect(row.timing.successfulTaskCompletionTimeMs).toEqual({ status: 'observed', value: 8_000 })
  })

  it('keeps a zero-millisecond observation distinct from a missing one', () => {
    const instant = attemptCapture({ attemptId: 'a1', huntId: 'hunt-a', answer: { at: 0, text: 'instant' }, terminal: { at: 0 } })
    const { set, sessions } = single(instant)
    const row = rowOf(built(inputFor(set, sessions, manifest, (grades) => grade(grades, 'a1', 'pass'))), 'a1')

    expect(row.timing.observedAnswerLatencyMs).toEqual({ status: 'observed', value: 0 })
    expect(row.timing.userWaitMs).toEqual({ status: 'observed', value: 0 })

    const answerless = single(attemptCapture({ attemptId: 'a1', huntId: 'hunt-a', answer: null }))
    const missing = rowOf(built(inputFor(answerless.set, answerless.sessions, manifest)), 'a1')
    expect(missing.timing.observedAnswerLatencyMs.status).toBe('unavailable')
    expect(missing.disposition).toBe('no_answer')
  })

  it('reports a censored elapsed time when the Run never reached a terminal, not a Run duration', () => {
    const attempt = attemptCapture({ attemptId: 'a1', huntId: 'hunt-a', answer: { at: 15_000, text: 'answer' }, terminal: null })
    const { set, sessions } = single(attempt)
    const row = rowOf(built(inputFor(set, sessions, manifest, (grades) => grade(grades, 'a1', 'pass'))), 'a1')

    expect(row.timing.runDurationMs.status).toBe('unavailable')
    // The Answer arrived at 15 s; observation ran on to 60 s. The censored
    // elapsed time is what the clock reached, not a second copy of the
    // Answer latency — both numbers are true and they are different.
    expect(row.timing.observedAnswerLatencyMs).toEqual({ status: 'observed', value: 15_000 })
    expect(row.timing.censoredElapsedMs).toEqual({ status: 'observed', value: 60_000 })
    expect(row.flags).toContain('no_terminal_observed')
  })

  it('does not clamp a negative interval into a plausible one', () => {
    const attempt = attemptCapture({ attemptId: 'a1', huntId: 'hunt-a', acceptedAt: 50_000, answer: { at: 10_000, text: 'answer' }, terminal: { at: 60_000 } })
    const { set, sessions } = single(attempt)
    const report = built(inputFor(set, sessions, manifest, (grades) => grade(grades, 'a1', 'useful_partial')))
    const row = rowOf(report, 'a1')

    expect(row.timing.observedAnswerLatencyMs.status).toBe('invalid')
    expect(row.flags).toContain('invalid_answer_latency')
    // An invalid interval is missing from the distribution, never a zero in it.
    expect(report.latency.failureMs.observations).not.toContain(0)
    expect(report.latency.failureMs.missing).toBe(1)
  })

  it('runs a corrective chain’s completion time from the command that opened it', () => {
    const first = attemptCapture({ attemptId: 'a1', huntId: 'hunt-a', answer: { at: 20_000, text: 'a wrong answer' }, terminal: { at: 25_000 } })
    const retry = attemptCapture({
      attemptId: 'a1r',
      huntId: 'hunt-a',
      stepId: 'initial',
      order: 1,
      relation: 'corrective',
      parentAttemptId: 'a1',
      acceptedAt: 40_000,
      answer: { at: 55_000, text: 'the corrected answer' },
      terminal: { at: 60_000 },
    })
    const session = sessionCapture({ captureId: 'capture-hunt-a', huntId: 'hunt-a', attempts: [first, retry], setId: 'set-1' })
    const set = captureSet({ slots: [slotOf(first), slotOf(retry)], sessions: [session] })
    const report = built(
      inputFor(set, [session], manifest, (grades) => grade(grade(grades, 'a1', 'unsuccessful'), 'a1r', 'pass')),
    )
    const corrected = rowOf(report, 'a1r')

    // Its own Answer arrived 15 s after its own command…
    expect(corrected.timing.observedAnswerLatencyMs).toEqual({ status: 'observed', value: 15_000 })
    // …but the task took 55 s, because the failed attempt is inside it.
    expect(corrected.timing.successfulTaskCompletionTimeMs).toEqual({ status: 'observed', value: 55_000 })
    // The failed work is retained as its own row, not absorbed.
    expect(rowOf(report, 'a1').timing.observedAnswerLatencyMs).toEqual({ status: 'observed', value: 20_000 })
    expect(report.populations.corrective.scheduled).toBe(1)
    // A corrective retry never joins the predefined revised-objective population.
    expect(report.populations.revisedObjective.scheduled).toBe(0)
  })
})

describe('attribution, usage and anomalies', () => {
  const manifest = manifestFor([{ huntId: 'hunt-a', stepId: 'initial' }])

  it('labels nested spans non-additive and never sums them into wall time', () => {
    // A 100 ms tool span containing browser sub-spans that total more than
    // 100 ms — the overlap fixture the plan pins.
    const attempt = attemptCapture({
      attemptId: 'a1',
      huntId: 'hunt-a',
      perfRecords: [
        span('tool', 1_000, 100),
        span('browser-settle', 960, 60),
        span('browser-recollection', 1_000, 80),
        span('llm', 500, 400),
        span('llm-retry', 505, 0),
        span('summary', 1_100, 9_999),
      ],
    })
    const session = sessionCapture({ captureId: 'capture-hunt-a', huntId: 'hunt-a', attempts: [attempt], setId: 'set-1' })
    const report = built(inputFor(captureSet({ slots: [slotOf(attempt)], sessions: [session] }), [session], manifest))
    const stages = Object.fromEntries(report.attribution.stages.map((stage) => [stage.stage, stage]))

    expect(report.attribution.stagesAreAdditive).toBe(false)
    expect(stages.tool!.totalMs).toBe(100)
    // The two browser sub-spans total 140 ms inside a 100 ms tool span:
    // reported as their own stage, never added to it.
    expect(stages['browser-settle']!.totalMs + stages['browser-recollection']!.totalMs).toBe(140)
    // Their union within the browser stages is not inflated either.
    expect(stages['browser-recollection']!.unionMs).toBe(80)
    // The synthetic summary record and the zero-length retry marker are not stages.
    expect(stages.summary).toBeUndefined()
    expect(stages['llm-retry']).toBeUndefined()
    // No total row across stages exists to be mistaken for wall time.
    expect(report.attribution.note).toContain('not additive')
    expect(Object.keys(report.attribution)).not.toContain('unexplainedMs')
    expect(report.attribution.clockOrigins).toEqual(['capture-hunt-a'])
  })

  it('says so when an attempt recorded no spans at all', () => {
    const attempt = attemptCapture({ attemptId: 'a1', huntId: 'hunt-a' })
    const session = sessionCapture({ captureId: 'capture-hunt-a', huntId: 'hunt-a', attempts: [attempt], setId: 'set-1' })
    const report = built(inputFor(captureSet({ slots: [slotOf(attempt)], sessions: [session] }), [session], manifest))

    expect(report.attribution.attemptsWithSpans).toBe(0)
    expect(report.attribution.attemptsWithoutSpans).toBe(1)
    expect(rowOf(report, 'a1').flags).toContain('no_span_coverage')
  })

  it('reports vision requests without inventing vision tokens', () => {
    const attempt = attemptCapture({
      attemptId: 'a1',
      huntId: 'hunt-a',
      traceRecords: [
        { kind: 'vision_request', capability: 'describe', reason: 'look', durationMs: 700, outcome: 'ok', v: 1, at: T0, turnId: 'turn-a1' },
        { kind: 'vision_request', capability: 'locate', reason: 'ground_visual', durationMs: 300, outcome: 'deadline', v: 1, at: T0, turnId: 'turn-a1' },
      ] as never,
    })
    const session = sessionCapture({ captureId: 'capture-hunt-a', huntId: 'hunt-a', attempts: [attempt], setId: 'set-1' })
    const report = built(inputFor(captureSet({ slots: [slotOf(attempt)], sessions: [session] }), [session], manifest))

    expect(report.attribution.vision.requests).toBe(2)
    expect(report.attribution.vision.totalMs).toBe(1_000)
    const vision = report.usage.byRole.find((role) => role.role === 'vision')!
    expect(vision.promptTokens).toBe(0)
    expect(vision.attemptsUnavailable).toBe(1)
    expect(vision.attemptsObserved).toBe(0)
  })

  it('prices only what an explicit list covers and names what it does not', () => {
    const rounds = [
      { kind: 'llm_round', role: 'orchestrator', model: 'model-o', usage: { promptTokens: 1_000_000, completionTokens: 500_000 }, v: 1, at: T0, turnId: 'turn-a1', round: 1, attempt: 1, outcome: 'completed', reasoningChars: 0, request: { toolResults: 0, chars: 10 } },
      { kind: 'llm_round', role: 'subagent', model: 'model-s', usage: { promptTokens: 200_000, completionTokens: 100_000 }, v: 1, at: T0, turnId: 'turn-a1', round: 1, attempt: 1, outcome: 'completed', reasoningChars: 0, request: { toolResults: 0, chars: 10 } },
    ]
    const attempt = attemptCapture({ attemptId: 'a1', huntId: 'hunt-a', traceRecords: rounds as never })
    const session = sessionCapture({ captureId: 'capture-hunt-a', huntId: 'hunt-a', attempts: [attempt], setId: 'set-1' })
    const base = inputFor(captureSet({ slots: [slotOf(attempt)], sessions: [session] }), [session], manifest)
    const report = built({
      ...base,
      pricing: { source: 'invented list', dated: '2026-01-01', models: { 'model-o': { inputPerMTok: 1, outputPerMTok: 2 } } },
    })

    const estimate = report.usage.estimate!
    // 1M prompt at $1 + 0.5M completion at $2 = $2.
    expect(estimate.subtotalUsd).toBe(2)
    expect(estimate.pricedModels).toEqual(['model-o'])
    expect(estimate.unpriced.map((item) => item.what)).toContain('model-s')
    expect(estimate.note).toContain('Not a billing figure')
    // Without a list there is no estimate at all — no fallback price exists.
    expect(built(base).usage.estimate).toBeNull()
  })

  it('marks a role incomplete when some rounds reported no usage', () => {
    const rounds = [
      { kind: 'llm_round', role: 'orchestrator', model: 'model-o', usage: { promptTokens: 10, completionTokens: 5 }, v: 1, at: T0, turnId: 'turn-a1', round: 1, attempt: 1, outcome: 'completed', reasoningChars: 0, request: { toolResults: 0, chars: 10 } },
      { kind: 'llm_round', role: 'orchestrator', model: 'model-o', v: 1, at: T0, turnId: 'turn-a1', round: 2, attempt: 1, outcome: 'completed', reasoningChars: 0, request: { toolResults: 0, chars: 10 } },
    ]
    const attempt = attemptCapture({ attemptId: 'a1', huntId: 'hunt-a', traceRecords: rounds as never })
    const session = sessionCapture({ captureId: 'capture-hunt-a', huntId: 'hunt-a', attempts: [attempt], setId: 'set-1' })
    const report = built(inputFor(captureSet({ slots: [slotOf(attempt)], sessions: [session] }), [session], manifest))
    const orchestrator = report.usage.byRole.find((role) => role.role === 'orchestrator')!

    expect(orchestrator.rounds).toBe(2)
    expect(orchestrator.roundsWithUsage).toBe(1)
    expect(orchestrator.complete).toBe(false)
    expect(rowOf(report, 'a1').flags).toContain('usage_incomplete')
  })

  it('counts a Subagent the parent killed, and one whose cause never reached the tape', () => {
    // Three Subagents: one finalized itself, one the Run cancelled, one
    // ended with no cause recorded. A Run that delegated three and killed
    // one must never read as a Run that delegated one.
    const attempt = attemptCapture({
      attemptId: 'a1',
      huntId: 'hunt-a',
      extraEvents: [
        { type: 'subagent_finalized', turnId: 'turn-a1', agentId: 'w1', kind: 'browse', status: 'done', cause: 'objective_met', at: T0 + 1_000 },
        { type: 'subagent_finalized', turnId: 'turn-a1', agentId: 'w2', kind: 'browse', status: 'cancelled', at: T0 + 1_100 },
        { type: 'subagent_finalized', turnId: 'turn-a1', agentId: 'w3', kind: 'browse', status: 'done', at: T0 + 1_200 },
      ] as never,
    })
    const session = sessionCapture({ captureId: 'capture-hunt-a', huntId: 'hunt-a', attempts: [attempt], setId: 'set-1' })
    const report = built(inputFor(captureSet({ slots: [slotOf(attempt)], sessions: [session] }), [session], manifest))

    expect(report.attribution.subagentsFinalized).toBe(3)
    expect(report.attribution.subagentStops).toEqual({ objective_met: 1, cancelled: 1, uncaused: 1 })
    // The cancelled one is visible rather than absorbed into the successes.
    expect(formatLiveReport(report)).toContain('cancelled 1')
  })

  it('counts a Subagent witnessed twice once — a duplicate tape witness is not a second Subagent', () => {
    // A Subagent's rounds are tapped both inside the worker loop and
    // main-side, so the same agentId can be published twice. Counting
    // witnesses would double it; counting distinct agentIds does not.
    const attempt = attemptCapture({
      attemptId: 'a1',
      huntId: 'hunt-a',
      extraEvents: [
        { type: 'subagent_finalized', turnId: 'turn-a1', agentId: 'w1', kind: 'browse', status: 'done', cause: 'objective_met', at: T0 + 1_000 },
        { type: 'subagent_finalized', turnId: 'turn-a1', agentId: 'w1', kind: 'browse', status: 'done', cause: 'objective_met', at: T0 + 1_050 },
      ] as never,
    })
    const session = sessionCapture({ captureId: 'capture-hunt-a', huntId: 'hunt-a', attempts: [attempt], setId: 'set-1' })
    const report = built(inputFor(captureSet({ slots: [slotOf(attempt)], sessions: [session] }), [session], manifest))

    expect(report.attribution.subagentsFinalized).toBe(1)
    expect(report.attribution.subagentStops).toEqual({ objective_met: 1 })
  })

  it('says an attempt delegated nothing rather than reporting an empty breakdown as a gap', () => {
    const attempt = attemptCapture({ attemptId: 'a1', huntId: 'hunt-a' })
    const session = sessionCapture({ captureId: 'capture-hunt-a', huntId: 'hunt-a', attempts: [attempt], setId: 'set-1' })
    const report = built(inputFor(captureSet({ slots: [slotOf(attempt)], sessions: [session] }), [session], manifest))

    expect(report.attribution.subagentsFinalized).toBe(0)
    expect(report.attribution.subagentStops).toEqual({})
    // Not delegating is not the same as a missing record.
    expect(report.attribution.subagentsUnobserved).toBe(0)
  })

  it('states the per-model usage limit even when no price list was supplied', () => {
    const attempt = attemptCapture({ attemptId: 'a1', huntId: 'hunt-a' })
    const session = sessionCapture({ captureId: 'capture-hunt-a', huntId: 'hunt-a', attempts: [attempt], setId: 'set-1' })
    const report = built(inputFor(captureSet({ slots: [slotOf(attempt)], sessions: [session] }), [session], manifest))

    expect(report.usage.estimate).toBeNull()
    expect(report.usage.limits.join(' ')).toContain('summed per role, not per model')
    expect(report.usage.limits.join(' ')).toContain('daily spend ledger is never read')
  })

  it('reports a reviewed-only rate as a secondary figure with its own denominator', () => {
    const { set, sessions, manifest: paired } = pairedFixture({ secondFollowUpReached: false })
    // Two initials scheduled, one reviewed and passing, one left pending.
    const report = built(inputFor(set, sessions, paired, (grades) => grade(grades, 'a1', 'pass')))

    expect(report.populations.initial.scheduled).toBe(2)
    expect(report.populations.initial.verifiedSuccess).toBe(1)
    expect(report.populations.initial.reviewed).toBe(1)
    // 1 of 1 reviewed, but still only 1 of 2 scheduled — and the headline
    // stays the scheduled one.
    expect(report.populations.initial.verifiedOverReviewed).toBe(1)
    expect(formatLiveReport(report)).toContain('| initial | 1/2 |')
  })

  it('returns no reviewed-only rate when nothing has been reviewed', () => {
    const attempt = attemptCapture({ attemptId: 'a1', huntId: 'hunt-a' })
    const session = sessionCapture({ captureId: 'capture-hunt-a', huntId: 'hunt-a', attempts: [attempt], setId: 'set-1' })
    const report = built(inputFor(captureSet({ slots: [slotOf(attempt)], sessions: [session] }), [session], manifest))

    expect(report.populations.initial.verifiedOverReviewed).toBeNull()
  })

  it('retains an unscheduled observation as an anomaly instead of counting it', () => {
    const scheduled = attemptCapture({ attemptId: 'a1', huntId: 'hunt-a' })
    const extra = attemptCapture({ attemptId: 'a-rogue', huntId: 'hunt-a', order: 5 })
    const session = sessionCapture({ captureId: 'capture-hunt-a', huntId: 'hunt-a', attempts: [scheduled, extra], setId: 'set-1' })
    const report = built(inputFor(captureSet({ slots: [slotOf(scheduled)], sessions: [session] }), [session], manifest))

    expect(report.rows).toHaveLength(1)
    expect(report.populations.initial.scheduled).toBe(1)
    expect(report.anomalies.join(' ')).toContain('a-rogue')
  })

  it('refuses a report when one attempt is captured in two Sessions', () => {
    const attempt = attemptCapture({ attemptId: 'a1', huntId: 'hunt-a' })
    const one = sessionCapture({ captureId: 'capture-1', huntId: 'hunt-a', attempts: [attempt], setId: 'set-1' })
    const two = sessionCapture({ captureId: 'capture-2', huntId: 'hunt-a', attempts: [attempt], setId: 'set-1' })
    const result = buildLiveReport({
      set: captureSet({ slots: [slotOf(attempt)], sessions: [one, two] }),
      sessions: [one, two],
      grades: initializeLiveGrades({ set: captureSet({ slots: [slotOf(attempt)], sessions: [one, two] }), sessions: [one, two], manifest }),
      manifest,
      generatedAt: GENERATED_AT,
    })

    expect(result.ok).toBe(false)
    expect(result.ok ? [] : result.errors.join(' ')).toContain('more than one Session')
  })

  it('rows a scheduled slot no Session mentions as unaccounted, not as missing', () => {
    const attempt = attemptCapture({ attemptId: 'a1', huntId: 'hunt-a' })
    const session = sessionCapture({ captureId: 'capture-hunt-a', huntId: 'hunt-a', attempts: [attempt], setId: 'set-1' })
    const ghostSlot = { ...slotOf(attempt), attemptId: 'a-ghost', order: 1 }
    const set = captureSet({ slots: [slotOf(attempt), ghostSlot], sessions: [session] })
    const report = built(inputFor(set, [session], manifest))

    expect(rowOf(report, 'a-ghost').disposition).toBe('unaccounted')
    expect(report.populations.initial.scheduled).toBe(2)
    expect(report.populations.initial.unaccounted).toBe(1)
  })

  it('separates cohorts that differ by commit rather than pooling them', () => {
    const first = attemptCapture({ attemptId: 'a1', huntId: 'hunt-a', answer: { at: 10_000, text: 'one' } })
    const second = attemptCapture({ attemptId: 'b1', huntId: 'hunt-b', order: 1, answer: { at: 20_000, text: 'two' } })
    const sessionA = sessionCapture({ captureId: 'capture-hunt-a', huntId: 'hunt-a', attempts: [first], setId: 'set-1' })
    const sessionB = sessionCapture({
      captureId: 'capture-hunt-b',
      huntId: 'hunt-b',
      attempts: [second],
      setId: 'set-1',
      launch: { ...sessionCapture({ captureId: 'x', huntId: 'y', attempts: [] }).launch, commit: 'f'.repeat(40) },
    })
    const set = captureSet({ slots: [slotOf(first), slotOf(second)], sessions: [sessionA, sessionB] })
    const report = built(
      inputFor(set, [sessionA, sessionB], manifestFor([
        { huntId: 'hunt-a', stepId: 'initial' },
        { huntId: 'hunt-b', stepId: 'initial' },
      ]), (grades) => grade(grade(grades, 'a1', 'pass'), 'b1', 'pass')),
    )

    expect(report.cohorts).toHaveLength(2)
    expect(report.warnings.join(' ')).toContain('cohorts')
    expect(report.cohorts.map((cohort) => cohort.successLatencyMs.observations)).toEqual([[10_000], [20_000]])
  })

  it('reports min, median and max only — never a p95 from a pilot', () => {
    const { set, sessions, manifest: paired } = pairedFixture({ secondFollowUpReached: true })
    const report = built(inputFor(set, sessions, paired, (grades) => grade(grades, 'a1', 'pass')))

    expect(report.latency.percentilesReported).toEqual(['min', 'median', 'max'])
    expect(JSON.stringify(report)).not.toContain('p95')
    expect(formatLiveReport(report)).toContain('does not support a p95')
  })
})

describe('the live:report CLI', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bingbong-live-report-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  /** Write a capture set and its sessions in the layout the reader expects. */
  function writeTree(set: LiveCaptureSet, sessions: readonly LiveSessionCapture[]): { setPath: string; keysPath: string } {
    const setPath = join(dir, 'capture-set.json')
    writeFileSync(setPath, `${JSON.stringify(set, null, 2)}\n`)
    for (const session of sessions) {
      const sessionDir = join(dir, session.captureId)
      mkdirSync(sessionDir, { recursive: true })
      writeFileSync(join(sessionDir, 'capture.json'), `${JSON.stringify(session, null, 2)}\n`)
    }
    const keysPath = join(dir, 'keys.json')
    return { setPath, keysPath }
  }

  function run(args: readonly string[]): { stdout: string; status: number; stderr: string } {
    try {
      const stdout = execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      return { stdout, status: 0, stderr: '' }
    } catch (error) {
      const failure = error as { status?: number; stdout?: string; stderr?: string }
      return { stdout: failure.stdout ?? '', status: failure.status ?? -1, stderr: failure.stderr ?? '' }
    }
  }

  function standardFixture(): { setPath: string; keysPath: string; set: LiveCaptureSet; sessions: LiveSessionCapture[]; manifest: LiveKeyManifest } {
    const { set, sessions, manifest } = pairedFixture({ secondFollowUpReached: false })
    const { setPath, keysPath } = writeTree(set, sessions)
    writeFileSync(keysPath, `${JSON.stringify(manifest, null, 2)}\n`)
    return { setPath, keysPath, set, sessions, manifest }
  }

  it.skipIf(!stripsTypes)('opens pending grades and refuses to write over them a second time', () => {
    const { setPath, keysPath } = standardFixture()
    const outPath = join(dir, 'grades.json')

    const first = run(['init-grades', `--capture=${setPath}`, `--keys=${keysPath}`, `--out=${outPath}`])
    expect(first.status, first.stderr).toBe(0)
    expect(first.stdout).toContain('opened 4 pending grade(s)')

    const written = JSON.parse(readFileSync(outPath, 'utf8')) as LiveGrades
    expect(written.kind).toBe(LIVE_GRADES_KIND)
    expect(written.entries).toHaveLength(4)
    expect(written.entries.every((entry) => entry.status === 'pending')).toBe(true)

    // A second initialization would discard a review that may already have
    // been written into it.
    const before = readFileSync(outPath)
    const second = run(['init-grades', `--capture=${setPath}`, `--keys=${keysPath}`, `--out=${outPath}`])
    expect(second.status).toBe(1)
    expect(second.stderr).toContain('refusing to overwrite')
    expect(readFileSync(outPath)).toEqual(before)
  })

  it.skipIf(!stripsTypes)('refuses to write a report over one of its own inputs, including through a symlink', () => {
    const { setPath, keysPath, set, sessions, manifest } = standardFixture()
    const gradesPath = join(dir, 'grades.json')
    writeFileSync(gradesPath, `${JSON.stringify(initializeLiveGrades({ set, sessions, manifest }), null, 2)}\n`)

    const direct = run([`--capture=${setPath}`, `--keys=${keysPath}`, `--grades=${gradesPath}`, `--out=${gradesPath}`])
    expect(direct.status).toBe(1)
    expect(direct.stderr).toContain('refusing to overwrite')

    // The same file reached through a symlinked directory.
    const aliasDir = join(dir, 'alias')
    symlinkSync(dir, aliasDir)
    const aliased = run([`--capture=${setPath}`, `--keys=${keysPath}`, `--grades=${gradesPath}`, `--out=${join(aliasDir, 'grades.json')}`])
    expect(aliased.status).toBe(1)
    expect(aliased.stderr).toContain('refusing to')
  })

  it.skipIf(!stripsTypes)('writes a report over failing hunts and pending grades, and leaves every input byte-identical', () => {
    const { setPath, keysPath, set, sessions, manifest } = standardFixture()
    const gradesPath = join(dir, 'grades.json')
    let grades = initializeLiveGrades({ set, sessions, manifest })
    grades = grade(grades, 'a1', 'unsuccessful')
    grades = grade(grades, 'a2', 'pass')
    grades = grade(grades, 'b1', 'unsuccessful')
    writeFileSync(gradesPath, `${JSON.stringify(grades, null, 2)}\n`)

    const inputsBefore = [setPath, keysPath, gradesPath].map((path) => readFileSync(path))
    const outPath = join(dir, 'reports', 'pilot.md')
    const result = run([`--capture=${setPath}`, `--keys=${keysPath}`, `--grades=${gradesPath}`, `--out=${outPath}`])

    // Failures and pending grades are findings, not tool errors.
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('initial hunts verified 0/2')
    expect(result.stdout).toContain('follow-ups 1/2')
    expect(result.stdout).toContain('both steps 0/2')

    const markdown = readFileSync(outPath, 'utf8')
    expect(markdown).toContain('# Live-web report')
    expect(markdown).toContain('| initial | 0/2 |')
    expect(markdown).toContain('not_reached')

    // Grading never rewrites the evidence it read.
    expect([setPath, keysPath, gradesPath].map((path) => readFileSync(path))).toEqual(inputsBefore)
  })

  it.skipIf(!stripsTypes)('keeps raw text, reviewer prose and absolute paths out of both output formats', () => {
    const secretAnswer = 'SENTINEL-ANSWER-TEXT'
    const secretCommand = 'SENTINEL-COMMAND-TEXT'
    const secretRationale = 'SENTINEL-REVIEWER-PROSE'
    const attempt = attemptCapture({
      attemptId: 'a1',
      huntId: 'hunt-a',
      commandText: secretCommand,
      answer: { at: 10_000, text: secretAnswer },
    })
    const session = sessionCapture({ captureId: 'capture-hunt-a', huntId: 'hunt-a', attempts: [attempt], setId: 'set-1' })
    const set = captureSet({ slots: [slotOf(attempt)], sessions: [session] })
    const manifest = manifestFor([{ huntId: 'hunt-a', stepId: 'initial' }])
    const { setPath, keysPath } = writeTree(set, [session])
    writeFileSync(keysPath, `${JSON.stringify(manifest, null, 2)}\n`)
    const gradesPath = join(dir, 'grades.json')
    writeFileSync(
      gradesPath,
      `${JSON.stringify(grade(initializeLiveGrades({ set, sessions: [session], manifest }), 'a1', 'pass', { rationale: secretRationale, reviewer: 'evaluator-1', reviewedAt: '2026-01-15T00:00:00.000Z', checks: [{ checkId: 'c1', satisfied: true, note: secretRationale }], support: [{ claim: secretRationale, sourceUrl: 'https://example.invalid/a', passageRef: 'S1' }] }), null, 2)}\n`,
    )

    for (const format of ['markdown', 'json'] as const) {
      const result = run([`--capture=${setPath}`, `--keys=${keysPath}`, `--grades=${gradesPath}`, `--format=${format}`])
      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout).not.toContain(secretAnswer)
      expect(result.stdout).not.toContain(secretCommand)
      expect(result.stdout).not.toContain(secretRationale)
      // The Answer's identity survives as a timing, not as text.
      expect(result.stdout).toContain('10000')
      // No absolute path into the reviewer's machine.
      expect(result.stdout).not.toContain(dir)
    }
  })

  it.skipIf(!stripsTypes)('rejects unknown options, missing inputs and a bad format without dumping the file', () => {
    const { setPath, keysPath } = standardFixture()

    const unknown = run(['init-grades', `--capture=${setPath}`, `--keys=${keysPath}`, '--out=/dev/null', '--pricing=x.json'])
    expect(unknown.status).toBe(1)
    expect(unknown.stderr).toContain('does not take --pricing')

    const missing = run([`--capture=${setPath}`, `--keys=${keysPath}`])
    expect(missing.status).toBe(1)
    expect(missing.stderr).toContain('--grades is required')

    const badFormat = run([`--capture=${setPath}`, `--keys=${keysPath}`, '--grades=x.json', '--format=csv'])
    expect(badFormat.status).toBe(1)
    expect(badFormat.stderr).toContain('--format must be markdown or json')

    const notJson = join(dir, 'broken.json')
    writeFileSync(notJson, 'this is not json, and it mentions SENTINEL-SECRET')
    const broken = run([`--capture=${setPath}`, `--keys=${notJson}`, '--grades=x.json'])
    expect(broken.status).toBe(1)
    expect(broken.stderr).toContain('not valid JSON')
    expect(broken.stderr).not.toContain('SENTINEL-SECRET')
  })

  it.skipIf(!stripsTypes)('refuses grades bound to a stale key without a documented recheck', () => {
    const { setPath, set, sessions, manifest } = standardFixture()
    const gradesPath = join(dir, 'grades.json')
    writeFileSync(gradesPath, `${JSON.stringify(grade(initializeLiveGrades({ set, sessions, manifest }), 'a1', 'pass'), null, 2)}\n`)

    // The key moves on; the grade still names k1 and explains nothing.
    const movedKeys = join(dir, 'keys-v2.json')
    const moved = manifestFor(manifest.tasks.map((task) => ({ huntId: task.huntId, stepId: task.stepId })), 'k2')
    writeFileSync(movedKeys, `${JSON.stringify(moved, null, 2)}\n`)

    const result = run([`--capture=${setPath}`, `--keys=${movedKeys}`, `--grades=${gradesPath}`])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('key manifest')
  })

  it.skipIf(!stripsTypes)('emits JSON whose grades and timings can be read back', () => {
    const { setPath, keysPath, set, sessions, manifest } = standardFixture()
    const gradesPath = join(dir, 'grades.json')
    writeFileSync(gradesPath, `${JSON.stringify(grade(initializeLiveGrades({ set, sessions, manifest }), 'a1', 'pass'), null, 2)}\n`)

    const result = run([`--capture=${setPath}`, `--keys=${keysPath}`, `--grades=${gradesPath}`, '--format=json'])
    expect(result.status, result.stderr).toBe(0)
    const report = JSON.parse(result.stdout) as LiveReport
    expect(report.populations.initial.verifiedSuccess).toBe(1)
    expect(report.rows.find((row) => row.attemptId === 'a1')!.timing.successfulTaskCompletionTimeMs).toEqual({ status: 'observed', value: 20_000 })
    expect(report.rows.find((row) => row.attemptId === 'b2')!.disposition).toBe('not_reached')
  })
})

describe('grade bindings survive the round trip', () => {
  it('binds an initialized grade to the Answer digest the capture recorded', () => {
    const attempt = attemptCapture({ attemptId: 'a1', huntId: 'hunt-a', answer: { at: 5_000, text: 'the answer' } })
    const session = sessionCapture({ captureId: 'capture-hunt-a', huntId: 'hunt-a', attempts: [attempt], setId: 'set-1' })
    const grades = initializeLiveGrades({
      set: captureSet({ slots: [slotOf(attempt)], sessions: [session] }),
      sessions: [session],
      manifest: manifestFor([{ huntId: 'hunt-a', stepId: 'initial' }]),
    })

    expect(grades.entries[0]!.answer).toEqual({ at: T0 + 5_000, digest: digestOf('the answer') })
    expect(answerBindingOf(attempt)).toEqual(grades.entries[0]!.answer)
    expect(keyManifestDigest(manifestFor([{ huntId: 'hunt-a', stepId: 'initial' }]))).toMatch(/^sha256:/)
  })
})
