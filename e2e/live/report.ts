// The compact live-web report (#226, slice 3 of #223): a projection over
// one capture set and the manual grades taken against it, small enough to
// keep in the repository and honest enough to be read without the raw
// traces beside it.
//
// The rules it exists to hold, all of them from #223:
//
//   * Task Success comes from the grade and only from the grade. A Run
//     that ended `done` proposing `completed` is a self-declaration; it is
//     reported as exactly that, next to the independent verdict.
//   * A verified Answer earns a Task Completion Time, measured from the
//     accepted command to the Answer the capture already recorded. Review
//     time never enters it. An unverified or ungraded Answer earns none —
//     and still keeps its observed latency, because a wrong Answer that
//     arrived in nine seconds is a measurement, not a blank.
//   * Every scheduled slot is a row. A hunt that was never dispatched, a
//     follow-up that could not be reached, an attempt whose acceptance was
//     never confirmed — each keeps its own disposition, and none of them
//     quietly leaves the denominator.
//   * Nested work is not wall time. Tool spans contain browser spans,
//     worker rounds overlap the tools they drive, and this report will not
//     add them up or invent the remainder.
//
// Relative imports carry `.ts` — the CLI runs this file under Node's type
// stripping — and src imports are type-only except the shared percentile.

import type { AgentRole } from '../../src/core/agent/modelRouting'
import type { FinalizationCause, RunResolution } from '../../src/core/session/runJournal'
import { nearestRankPercentile } from '../../src/core/report/stats.ts'
import type { Validation } from './artifacts.ts'
import { isVerifiedSuccess, type LiveGradeStatus, type LiveGradeEntry, type LiveGrades, type LiveKeyManifest } from './grades.ts'
import { indexAttempts } from './grades.ts'
import type {
  AttemptRelation,
  LiveArtifactReference,
  LiveAttemptCapture,
  LiveAttemptRecord,
  LiveCaptureSet,
  LiveScheduledAttempt,
  LiveSessionCapture,
  LiveStopReason,
  Observed,
} from './types.ts'

/** The `kind` a report file carries. */
export const LIVE_REPORT_KIND = 'bingbong.live.report'
export const LIVE_REPORT_VERSION = 1

const observed = <T>(value: T): Observed<T> => ({ status: 'observed', value })
const unavailable = <T>(reason: string): Observed<T> => ({ status: 'unavailable', reason })
const notApplicable = <T>(reason: string): Observed<T> => ({ status: 'not_applicable', reason })

/** The value of an observation, or null for every other status. */
function valueOf<T>(observation: Observed<T>): T | null {
  return observation.status === 'observed' ? observation.value : null
}

/**
 * How far an attempt got. The three attempted states are kept apart
 * because they fail differently: `answered` published a final Answer,
 * `no_answer` ran and published none, and `acceptance_unconfirmed` was
 * submitted without the app ever confirming it accepted a command — which
 * is a measurement failure, not a slow Run. `not_reached` was decided
 * against by the protocol; `unaccounted` is a scheduled slot no session
 * mentions at all, which is a hole in the capture rather than a result.
 */
export type LiveDisposition = 'answered' | 'no_answer' | 'acceptance_unconfirmed' | 'not_reached' | 'unaccounted'

const ATTEMPTED: readonly LiveDisposition[] = ['answered', 'no_answer', 'acceptance_unconfirmed']

/** One retained file, by identity — never its contents. */
export interface LiveArtifactIdentity {
  readonly path: string
  readonly family: LiveArtifactReference['family']
  readonly digest: string
  readonly bytes: number
  readonly complete: boolean
  readonly truncated: boolean
}

export interface LiveRowMechanical {
  readonly outcome: 'done' | 'failed' | 'cancelled' | 'reset' | null
  /** The model's own proposal. Never Task Success — the grade is beside it. */
  readonly resolution: RunResolution | null
  readonly finalizationCause: FinalizationCause | null
  readonly deterministicAnswer: boolean | null
  readonly stopReason: LiveStopReason | null
}

export interface LiveRowTiming {
  /** Which stamp the latency reads; null when nothing was observed. */
  readonly boundary: 'event_publication' | null
  /** Accepted command to the marked final Answer. Kept whatever the grade says. */
  readonly observedAnswerLatencyMs: Observed<number>
  /**
   * The Task Completion Time, present only for an independently verified
   * Answer. For a corrective chain it runs from the chain's first accepted
   * command, so the failed work before the correction is inside it.
   */
  readonly successfulTaskCompletionTimeMs: Observed<number>
  /** Accepted command to the `done` event — a different question from the Answer. */
  readonly runDurationMs: Observed<number>
  readonly userWaitMs: Observed<number>
  /**
   * What the clock had reached when observation stopped short of a
   * terminal — a censored elapsed time, not a Run duration. Not
   * applicable when the Run did reach its terminal.
   */
  readonly censoredElapsedMs: Observed<number>
}

export interface LiveRowWork {
  readonly llmSpans: number
  readonly llmRetries: number
  readonly toolCalls: number
  readonly toolSpans: number
  readonly visionRequests: number
  readonly workersFinalized: number
  readonly errors: number
}

/** One scheduled slot, whatever became of it. */
export interface LiveReportRow {
  readonly attemptId: string
  readonly huntId: string
  readonly stepId: string
  readonly order: number
  readonly relation: AttemptRelation
  readonly parentAttemptId: string | null
  readonly captureId: string | null
  readonly disposition: LiveDisposition
  readonly dispositionReason: string | null
  readonly grade: LiveGradeStatus
  readonly reviewed: boolean
  /** The independent verdict, and the only thing that counts as success. */
  readonly verifiedSuccess: boolean
  readonly mechanical: LiveRowMechanical
  readonly timing: LiveRowTiming
  readonly work: LiveRowWork | null
  readonly flags: readonly string[]
  readonly artifacts: readonly LiveArtifactIdentity[]
}

/** Counts over one population, every one of them with the same denominator: what was scheduled. */
export interface LivePopulation {
  readonly label: string
  readonly scheduled: number
  readonly attempted: number
  readonly answered: number
  readonly notReached: number
  readonly unaccounted: number
  readonly acceptanceUnconfirmed: number
  readonly reviewed: number
  readonly pending: number
  readonly verifiedSuccess: number
  /** Verified successes that also carry a Task Completion Time. */
  readonly timedSuccess: number
  readonly byGrade: Readonly<Record<LiveGradeStatus, number>>
}

/** One hunt's initial/follow-up pair, reported as its own population member. */
export interface LivePairRow {
  readonly huntId: string
  readonly initialAttemptId: string
  readonly followUpAttemptId: string
  readonly initialVerified: boolean
  readonly followUpVerified: boolean
  readonly bothVerified: boolean
  /** Initial acceptance to the follow-up's Answer; only for a pair that both passed. */
  readonly sequenceElapsedMs: Observed<number>
  /** The initial's terminal to the follow-up's accepted command. */
  readonly interCommandGapMs: Observed<number>
}

export interface LiveDistribution {
  readonly observations: readonly number[]
  readonly observed: number
  readonly missing: number
  /** Null for an empty distribution — never a zero standing in for no data. */
  readonly stats: { readonly minMs: number; readonly medianMs: number; readonly maxMs: number } | null
}

/** One stage's perf spans across the report. `totalMs` is not additive with any other stage's. */
export interface LiveStageAttribution {
  readonly stage: string
  readonly count: number
  readonly totalMs: number
  /** Per-attempt interval unions, summed — attempts are sequential, stages are not. */
  readonly unionMs: number
  readonly attemptsCovered: number
}

export interface LiveAttribution {
  /** The launches the spans came from; a union never crosses one. */
  readonly clockOrigins: readonly string[]
  readonly stages: readonly LiveStageAttribution[]
  readonly attemptsWithSpans: number
  readonly attemptsWithoutSpans: number
  readonly retries: number
  readonly toolCalls: number
  readonly workersFinalized: number
  readonly vision: { readonly requests: number; readonly totalMs: number | null; readonly attemptsCovered: number }
  readonly userWaitMs: LiveDistribution
  readonly speech: { readonly synthesisMs: number | null; readonly playbackMs: number | null; readonly inputLatency: 'not_applicable' }
  /** Always false: tool spans contain browser spans and worker rounds overlap both. */
  readonly stagesAreAdditive: false
  readonly note: string
}

export interface LiveRoleUsageSummary {
  readonly role: AgentRole
  readonly attemptsObserved: number
  readonly attemptsUnavailable: number
  readonly attemptsNotApplicable: number
  readonly promptTokens: number
  readonly completionTokens: number
  readonly rounds: number
  readonly roundsWithUsage: number
  /** False when any contributing attempt reported fewer usages than rounds. */
  readonly complete: boolean
  readonly models: readonly string[]
}

/** An explicit, dated price list. There is no default: an unknown model stays unpriced. */
export interface LivePricingInput {
  readonly source: string
  readonly dated: string
  readonly models: Readonly<Record<string, { readonly inputPerMTok: number; readonly outputPerMTok: number }>>
}

export interface LiveCostEstimate {
  readonly currency: 'USD'
  readonly subtotalUsd: number
  readonly pricedModels: readonly string[]
  /** Models with observed tokens and no price, or a role whose tokens span several models. */
  readonly unpriced: readonly { readonly what: string; readonly reason: string }[]
  readonly source: string
  readonly dated: string
  readonly note: string
}

export interface LiveUsageSection {
  readonly byRole: readonly LiveRoleUsageSummary[]
  /** Null unless an explicit price list was supplied. Never a billing figure. */
  readonly estimate: LiveCostEstimate | null
}

/** One cohort of comparable attempts: the same mode, commit and prompt version. */
export interface LiveCohort {
  readonly key: string
  readonly mode: string
  readonly commit: string
  readonly promptVersions: readonly string[]
  readonly rows: number
  readonly successLatencyMs: LiveDistribution
  readonly failureLatencyMs: LiveDistribution
  readonly runDurationMs: LiveDistribution
}

export interface LiveReportProvenance {
  readonly setId: string
  readonly study: string
  readonly protocolVersion: string
  readonly mode: string
  readonly state: string
  readonly createdAt: string
  readonly commits: readonly string[]
  readonly dirtyTree: boolean
  readonly promptVersions: readonly string[]
  readonly keyVersion: string
  readonly keyManifestDigest: string
  readonly gradesRevision: number
  readonly roles: readonly string[]
  readonly reasoningEffortOverride: string | null
  readonly effortOverrides: readonly string[]
  readonly adblock: string
  readonly generatedAt: string
}

export interface LiveReport {
  readonly kind: typeof LIVE_REPORT_KIND
  readonly reportVersion: typeof LIVE_REPORT_VERSION
  readonly provenance: LiveReportProvenance
  readonly rows: readonly LiveReportRow[]
  readonly populations: {
    readonly initial: LivePopulation
    readonly revisedObjective: LivePopulation
    readonly corrective: LivePopulation
    readonly bothStep: LivePopulation
  }
  readonly pairs: readonly LivePairRow[]
  readonly latency: {
    readonly successMs: LiveDistribution
    readonly failureMs: LiveDistribution
    readonly runDurationMs: LiveDistribution
    /** Three repeats do not support a tail estimate, and this report never prints one. */
    readonly percentilesReported: readonly ['min', 'median', 'max']
  }
  readonly cohorts: readonly LiveCohort[]
  readonly attribution: LiveAttribution
  readonly usage: LiveUsageSection
  /** Everything the capture saw that the protocol did not schedule. */
  readonly anomalies: readonly string[]
  /** Data-quality statements about the report as a whole. */
  readonly warnings: readonly string[]
}

export interface LiveReportInput {
  readonly set: LiveCaptureSet
  readonly sessions: readonly LiveSessionCapture[]
  readonly grades: LiveGrades
  readonly manifest: LiveKeyManifest
  readonly pricing?: LivePricingInput
  /** Stamped by the caller; the projection itself reads no clock. */
  readonly generatedAt: string
}

function distribution(values: readonly (number | null)[]): LiveDistribution {
  const present = values.filter((value): value is number => value !== null)
  const sorted = [...present].sort((a, b) => a - b)
  return {
    observations: sorted,
    observed: sorted.length,
    missing: values.length - sorted.length,
    // nearestRankPercentile returns 0 for an empty input, which would read
    // as an instant task. An empty distribution has no statistics at all.
    stats:
      sorted.length === 0
        ? null
        : { minMs: sorted[0]!, medianMs: nearestRankPercentile(sorted, 50), maxMs: sorted[sorted.length - 1]! },
  }
}

function emptyGradeCounts(): Record<LiveGradeStatus, number> {
  return { pending: 0, pass: 0, useful_partial: 0, help_access_blocked: 0, unsuccessful: 0 }
}

function populationOf(label: string, rows: readonly LiveReportRow[]): LivePopulation {
  const byGrade = emptyGradeCounts()
  for (const row of rows) byGrade[row.grade] += 1
  return {
    label,
    scheduled: rows.length,
    attempted: rows.filter((row) => ATTEMPTED.includes(row.disposition)).length,
    answered: rows.filter((row) => row.disposition === 'answered').length,
    notReached: rows.filter((row) => row.disposition === 'not_reached').length,
    unaccounted: rows.filter((row) => row.disposition === 'unaccounted').length,
    acceptanceUnconfirmed: rows.filter((row) => row.disposition === 'acceptance_unconfirmed').length,
    reviewed: rows.filter((row) => row.reviewed).length,
    pending: rows.filter((row) => row.grade === 'pending').length,
    verifiedSuccess: rows.filter((row) => row.verifiedSuccess).length,
    timedSuccess: rows.filter((row) => row.verifiedSuccess && row.timing.successfulTaskCompletionTimeMs.status === 'observed').length,
    byGrade,
  }
}

/** The attempt a slot was dispatched into, if it was dispatched at all. */
interface SlotView {
  readonly slot: LiveScheduledAttempt
  readonly captureId: string | null
  readonly record: LiveAttemptRecord | null
  readonly session: LiveSessionCapture | null
}

function dispositionOf(view: SlotView): { disposition: LiveDisposition; reason: string | null } {
  if (view.record === null) return { disposition: 'unaccounted', reason: 'no Session capture mentions this scheduled slot' }
  if (view.record.kind === 'not_reached') return { disposition: 'not_reached', reason: view.record.reason }
  const attempt = view.record
  if (attempt.accepted.status !== 'observed') {
    return { disposition: 'acceptance_unconfirmed', reason: reasonOf(attempt.accepted) }
  }
  if (attempt.finalAnswer.status !== 'observed') return { disposition: 'no_answer', reason: reasonOf(attempt.finalAnswer) }
  return { disposition: 'answered', reason: null }
}

function reasonOf<T>(observation: Observed<T>): string | null {
  return observation.status === 'observed' ? null : observation.reason
}

/**
 * Walk an explicitly linked corrective chain back to the command that
 * opened it. A revised objective is a new task, so the walk stops there;
 * only `corrective` links extend a Task Completion Time backwards, and
 * only because the record says so — never because two commands look alike.
 */
function chainStart(attemptId: string, byId: ReadonlyMap<string, SlotView>): SlotView | null {
  let current = byId.get(attemptId) ?? null
  const seen = new Set<string>()
  while (current !== null && current.slot.relation === 'corrective') {
    const parentId = current.slot.parentAttemptId
    if (parentId === undefined || seen.has(parentId)) break
    seen.add(parentId)
    const parent = byId.get(parentId)
    if (parent === undefined) break
    current = parent
  }
  return current
}

function acceptedAtOf(view: SlotView | null): Observed<number> {
  if (view === null || view.record === null || view.record.kind !== 'attempt') {
    return unavailable('the chain’s first command was never captured')
  }
  return view.record.metrics.acceptedAt
}

function artifactsOf(session: LiveSessionCapture | null, attempt: LiveAttemptCapture | null): LiveArtifactIdentity[] {
  const references: LiveArtifactReference[] = [...(session?.artifacts ?? [])]
  if (attempt?.events != null) references.push(attempt.events)
  return references.map((reference) => ({
    path: reference.path,
    family: reference.family,
    digest: reference.digest,
    bytes: reference.bytes,
    complete: reference.complete,
    truncated: reference.truncated === true,
  }))
}

function flagsFor(view: SlotView, entry: LiveGradeEntry, attempt: LiveAttemptCapture | null): string[] {
  const flags: string[] = []
  if (attempt === null) return flags
  const metrics = attempt.metrics
  if (metrics.deterministicAnswer) flags.push('deterministic_answer')
  if (metrics.terminalAt.status !== 'observed') flags.push('no_terminal_observed')
  for (const [name, observation] of [
    ['answer_latency', metrics.answerLatencyMs],
    ['run_duration', metrics.runDurationMs],
    ['user_wait', metrics.userWaitMs],
  ] as const) {
    if (observation.status === 'invalid') flags.push(`invalid_${name}`)
  }
  if (metrics.waits.some((wait) => wait.resolvedAt === null)) flags.push('wait_never_resolved')
  if (metrics.coverage.truncatedToolResults > 0) flags.push('truncated_tool_results')
  if (metrics.spans.status !== 'observed') flags.push('no_span_coverage')
  if (Object.values(metrics.usage).some((usage) => usage.status === 'observed' && !usage.value.complete)) {
    flags.push('usage_incomplete')
  }
  // The self-declaration the grade exists to check. Flagged only when a
  // reviewer has actually looked: an ungraded row is not a contradiction.
  if (metrics.resolution === 'completed' && entry.status !== 'pending' && !isVerifiedSuccess(entry)) {
    flags.push('self_declared_completed_but_unverified')
  }
  if (view.session?.retention.complete === false) flags.push('retention_incomplete')
  if (attempt.anomalies.length > 0) flags.push('capture_anomaly')
  if (entry.recheck !== undefined) flags.push(`key_recheck_${entry.recheck.conclusion}`)
  return flags
}

function rowFor(view: SlotView, entry: LiveGradeEntry, byId: ReadonlyMap<string, SlotView>): LiveReportRow {
  const attempt = view.record?.kind === 'attempt' ? view.record : null
  const { disposition, reason } = dispositionOf(view)
  const verified = isVerifiedSuccess(entry)
  const metrics = attempt?.metrics ?? null

  const answerLatency: Observed<number> = metrics?.answerLatencyMs ?? unavailable('no attempt was dispatched into this slot')
  let completion: Observed<number>
  if (!verified) {
    completion = notApplicable(
      entry.status === 'pending'
        ? 'the Answer is not yet independently verified'
        : 'the Answer is not independently verified — a Task Completion Time is earned, not observed',
    )
  } else if (metrics === null) {
    completion = unavailable('no attempt was dispatched into this slot')
  } else if (view.slot.relation === 'corrective') {
    // A corrective chain's completion time starts at the command that
    // opened it, so the failed work before the correction is inside it.
    completion = elapsedBetween(acceptedAtOf(chainStart(view.slot.attemptId, byId)), metrics.finalAnswerAt)
  } else {
    completion = metrics.answerLatencyMs
  }

  // Observation stopped short of a terminal: what the clock had reached is
  // a censored elapsed time, and calling it a Run duration would be a lie.
  let censored: Observed<number> = notApplicable('the Run reached its terminal')
  if (metrics !== null && metrics.terminalAt.status !== 'observed') {
    censored = metrics.finalAnswerAt.status === 'observed'
      ? elapsedBetween(metrics.acceptedAt, metrics.finalAnswerAt)
      : unavailable('the capture stopped with no Answer and no terminal to measure to')
  }

  return {
    attemptId: view.slot.attemptId,
    huntId: view.slot.huntId,
    stepId: view.slot.stepId,
    order: view.slot.order,
    relation: view.slot.relation,
    parentAttemptId: view.slot.parentAttemptId ?? null,
    captureId: view.captureId,
    disposition,
    dispositionReason: reason,
    grade: entry.status,
    reviewed: entry.status !== 'pending',
    verifiedSuccess: verified,
    mechanical: {
      outcome: metrics?.outcome ?? null,
      resolution: metrics?.resolution ?? null,
      finalizationCause: metrics?.finalizationCause ?? null,
      deterministicAnswer: metrics === null ? null : metrics.deterministicAnswer,
      stopReason: attempt?.stop.reason ?? null,
    },
    timing: {
      boundary: metrics?.answerBoundary ?? null,
      observedAnswerLatencyMs: answerLatency,
      successfulTaskCompletionTimeMs: completion,
      runDurationMs: metrics?.runDurationMs ?? unavailable('no attempt was dispatched into this slot'),
      userWaitMs: metrics?.userWaitMs ?? unavailable('no attempt was dispatched into this slot'),
      censoredElapsedMs: censored,
    },
    work:
      metrics === null
        ? null
        : {
            llmSpans: metrics.counts.llmSpans,
            llmRetries: metrics.counts.llmRetries,
            toolCalls: metrics.counts.toolCalls,
            toolSpans: metrics.counts.toolSpans,
            visionRequests: metrics.counts.visionRequests,
            workersFinalized: metrics.counts.workersFinalized,
            errors: metrics.counts.errors,
          },
    flags: flagsFor(view, entry, attempt),
    artifacts: artifactsOf(view.session, attempt),
  }
}

/** `end - start` across two observations, keeping whichever status is missing. */
function elapsedBetween(start: Observed<number>, end: Observed<number>): Observed<number> {
  if (start.status !== 'observed') return { ...start }
  if (end.status !== 'observed') return { ...end }
  // A negative interval is a fact about the clocks, not something to clamp.
  if (end.value < start.value) return { status: 'invalid', reason: `the interval ends ${start.value - end.value} ms before it starts` }
  return observed(end.value - start.value)
}

function pairsOf(rows: readonly LiveReportRow[], byId: ReadonlyMap<string, SlotView>): LivePairRow[] {
  const rowById = new Map(rows.map((row) => [row.attemptId, row]))
  return rows
    .filter((row) => row.relation === 'revised_objective' && row.parentAttemptId !== null)
    .flatMap((followUp): LivePairRow[] => {
      const initial = rowById.get(followUp.parentAttemptId!)
      if (initial === undefined) return []
      const bothVerified = initial.verifiedSuccess && followUp.verifiedSuccess
      const initialAttempt = byId.get(initial.attemptId)?.record
      const followUpAttempt = byId.get(followUp.attemptId)?.record
      const initialMetrics = initialAttempt?.kind === 'attempt' ? initialAttempt.metrics : null
      const followUpMetrics = followUpAttempt?.kind === 'attempt' ? followUpAttempt.metrics : null
      return [
        {
          huntId: followUp.huntId,
          initialAttemptId: initial.attemptId,
          followUpAttemptId: followUp.attemptId,
          initialVerified: initial.verifiedSuccess,
          followUpVerified: followUp.verifiedSuccess,
          bothVerified,
          // A sequence time is only meaningful for a pair that both passed;
          // it is reported beside the two step times, never instead of them.
          sequenceElapsedMs: !bothVerified
            ? notApplicable('a sequence elapsed time belongs to a pair that both steps passed')
            : elapsedBetween(
                initialMetrics?.acceptedAt ?? unavailable('the initial attempt was never captured'),
                followUpMetrics?.finalAnswerAt ?? unavailable('the follow-up attempt was never captured'),
              ),
          interCommandGapMs: elapsedBetween(
            initialMetrics?.terminalAt ?? unavailable('the initial attempt reached no terminal'),
            followUpMetrics?.acceptedAt ?? unavailable('the follow-up command was never accepted'),
          ),
        },
      ]
    })
}

/** The both-step population: one member per scheduled pair, passing only when both grades do. */
function bothStepPopulation(pairs: readonly LivePairRow[], rows: readonly LiveReportRow[]): LivePopulation {
  const rowById = new Map(rows.map((row) => [row.attemptId, row]))
  const byGrade = emptyGradeCounts()
  let attempted = 0
  let notReached = 0
  let pending = 0
  let reviewed = 0
  for (const pair of pairs) {
    const initial = rowById.get(pair.initialAttemptId)!
    const followUp = rowById.get(pair.followUpAttemptId)!
    const both = [initial, followUp]
    if (both.every((row) => ATTEMPTED.includes(row.disposition))) attempted += 1
    if (both.some((row) => row.disposition === 'not_reached' || row.disposition === 'unaccounted')) notReached += 1
    if (both.some((row) => row.grade === 'pending')) pending += 1
    else reviewed += 1
    // A pair's grade is the weaker of its two steps: a pass needs both.
    byGrade[pair.bothVerified ? 'pass' : both.find((row) => row.grade !== 'pass')?.grade ?? 'unsuccessful'] += 1
  }
  return {
    label: 'both_step',
    scheduled: pairs.length,
    attempted,
    answered: pairs.filter((pair) => [pair.initialAttemptId, pair.followUpAttemptId].every((id) => rowById.get(id)!.disposition === 'answered')).length,
    notReached,
    unaccounted: 0,
    acceptanceUnconfirmed: 0,
    reviewed,
    pending,
    verifiedSuccess: pairs.filter((pair) => pair.bothVerified).length,
    timedSuccess: pairs.filter((pair) => pair.bothVerified && pair.sequenceElapsedMs.status === 'observed').length,
    byGrade,
  }
}

function attributionOf(rows: readonly LiveReportRow[], byId: ReadonlyMap<string, SlotView>): LiveAttribution {
  const attempts = rows
    .map((row) => byId.get(row.attemptId)?.record)
    .filter((record): record is LiveAttemptCapture => record?.kind === 'attempt')
  const stages = new Map<string, { count: number; totalMs: number; unionMs: number; attemptsCovered: number }>()
  const clockOrigins = new Set<string>()
  let withSpans = 0
  for (const attempt of attempts) {
    const spans = attempt.metrics.spans
    if (spans.status !== 'observed') continue
    withSpans += 1
    clockOrigins.add(spans.value.clockOrigin)
    for (const [stage, aggregate] of Object.entries(spans.value.stages)) {
      const current = stages.get(stage) ?? { count: 0, totalMs: 0, unionMs: 0, attemptsCovered: 0 }
      stages.set(stage, {
        count: current.count + aggregate.count,
        totalMs: current.totalMs + aggregate.totalMs,
        // Summing per-attempt unions is safe because attempts run one after
        // another. Summing across stages is not, and never happens here.
        unionMs: current.unionMs + aggregate.unionMs,
        attemptsCovered: current.attemptsCovered + 1,
      })
    }
  }
  const visionAttempts = attempts.filter((attempt) => attempt.metrics.vision.status === 'observed')
  const speechTotal = (pick: (attempt: LiveAttemptCapture) => Observed<{ spans: number; totalMs: number }>): number | null => {
    const present = attempts.map(pick).filter((observation) => observation.status === 'observed')
    return present.length === 0 ? null : present.reduce((total, observation) => total + valueOf(observation)!.totalMs, 0)
  }
  return {
    clockOrigins: [...clockOrigins].sort(),
    stages: [...stages.entries()]
      .map(([stage, aggregate]) => ({ stage, ...aggregate }))
      .sort((left, right) => left.stage.localeCompare(right.stage)),
    attemptsWithSpans: withSpans,
    attemptsWithoutSpans: attempts.length - withSpans,
    retries: attempts.reduce((total, attempt) => total + attempt.metrics.counts.llmRetries, 0),
    toolCalls: attempts.reduce((total, attempt) => total + attempt.metrics.counts.toolCalls, 0),
    workersFinalized: attempts.reduce((total, attempt) => total + attempt.metrics.counts.workersFinalized, 0),
    vision: {
      requests: attempts.reduce((total, attempt) => total + attempt.metrics.counts.visionRequests, 0),
      totalMs:
        visionAttempts.length === 0
          ? null
          : visionAttempts.reduce((total, attempt) => total + valueOf(attempt.metrics.vision)!.totalMs, 0),
      attemptsCovered: visionAttempts.length,
    },
    userWaitMs: distribution(rows.map((row) => valueOf(row.timing.userWaitMs))),
    speech: {
      synthesisMs: speechTotal((attempt) => attempt.metrics.speech.synthesis),
      playbackMs: speechTotal((attempt) => attempt.metrics.speech.playback),
      inputLatency: 'not_applicable',
    },
    stagesAreAdditive: false,
    note:
      'Stage totals are not additive: tool spans contain browser sub-spans and worker rounds overlap the tools they drive. ' +
      'No exclusive wall-time split or unexplained remainder is derived from them.',
  }
}

const AGENT_ROLE_ORDER: readonly AgentRole[] = ['orchestrator', 'subagent', 'vision']

function usageOf(
  rows: readonly LiveReportRow[],
  byId: ReadonlyMap<string, SlotView>,
  pricing: LivePricingInput | undefined,
): LiveUsageSection {
  const attempts = rows
    .map((row) => byId.get(row.attemptId)?.record)
    .filter((record): record is LiveAttemptCapture => record?.kind === 'attempt')
  const byRole = AGENT_ROLE_ORDER.map((role): LiveRoleUsageSummary => {
    const observations = attempts.map((attempt) => attempt.metrics.usage[role])
    const present = observations.filter((observation) => observation.status === 'observed').map((observation) => valueOf(observation)!)
    return {
      role,
      attemptsObserved: present.length,
      attemptsUnavailable: observations.filter((observation) => observation.status === 'unavailable').length,
      attemptsNotApplicable: observations.filter((observation) => observation.status === 'not_applicable').length,
      promptTokens: present.reduce((total, usage) => total + usage.promptTokens, 0),
      completionTokens: present.reduce((total, usage) => total + usage.completionTokens, 0),
      rounds: present.reduce((total, usage) => total + usage.rounds, 0),
      roundsWithUsage: present.reduce((total, usage) => total + usage.roundsWithUsage, 0),
      complete: present.length > 0 && present.every((usage) => usage.complete),
      models: [...new Set(present.flatMap((usage) => usage.models))].sort(),
    }
  })

  if (pricing === undefined) return { byRole, estimate: null }

  const unpriced: { what: string; reason: string }[] = []
  const pricedModels: string[] = []
  let subtotal = 0
  for (const summary of byRole) {
    if (summary.promptTokens + summary.completionTokens === 0) continue
    if (summary.models.length !== 1) {
      // Usage is summed per role, not per model, so a role that spanned two
      // models cannot be priced without inventing the split.
      unpriced.push({
        what: `${summary.role} (${summary.models.length === 0 ? 'no model recorded' : summary.models.join(', ')})`,
        reason: summary.models.length === 0 ? 'no model was recorded on the rounds' : 'tokens are summed per role and span several models',
      })
      continue
    }
    const model = summary.models[0]!
    const price = pricing.models[model]
    if (price === undefined) {
      unpriced.push({ what: model, reason: 'the supplied price list has no row for this model' })
      continue
    }
    pricedModels.push(model)
    subtotal += (summary.promptTokens / 1_000_000) * price.inputPerMTok + (summary.completionTokens / 1_000_000) * price.outputPerMTok
    if (!summary.complete) {
      unpriced.push({ what: `${model} (rounds without reported usage)`, reason: 'some rounds reported no usage, so the priced tokens are a floor' })
    }
  }
  const visionRequests = attempts.reduce((total, attempt) => total + attempt.metrics.counts.visionRequests, 0)
  if (visionRequests > 0) unpriced.push({ what: `vision (${visionRequests} request(s))`, reason: 'vision records carry duration, never token usage' })

  return {
    byRole,
    estimate: {
      currency: 'USD',
      subtotalUsd: Math.round(subtotal * 10_000) / 10_000,
      pricedModels: [...new Set(pricedModels)].sort(),
      unpriced,
      source: pricing.source,
      dated: pricing.dated,
      note: 'An estimate over observed, priced usage only. Not a billing figure, not a spend limit, and not complete where rounds reported no usage.',
    },
  }
}

function cohortsOf(rows: readonly LiveReportRow[], byId: ReadonlyMap<string, SlotView>): LiveCohort[] {
  const groups = new Map<string, { mode: string; commit: string; promptVersions: Set<string>; rows: LiveReportRow[] }>()
  for (const row of rows) {
    const view = byId.get(row.attemptId)
    const record = view?.record
    if (record?.kind !== 'attempt') continue
    const launch = view!.session!.launch
    const key = `${launch.mode}|${launch.commit.slice(0, 8)}|${record.command.prompt.version}`
    const group = groups.get(key) ?? { mode: launch.mode, commit: launch.commit.slice(0, 8), promptVersions: new Set<string>(), rows: [] }
    group.promptVersions.add(record.command.prompt.version)
    group.rows.push(row)
    groups.set(key, group)
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, group]) => ({
      key,
      mode: group.mode,
      commit: group.commit,
      promptVersions: [...group.promptVersions].sort(),
      rows: group.rows.length,
      successLatencyMs: distribution(group.rows.filter((row) => row.verifiedSuccess).map((row) => valueOf(row.timing.successfulTaskCompletionTimeMs))),
      failureLatencyMs: distribution(
        group.rows.filter((row) => !row.verifiedSuccess && ATTEMPTED.includes(row.disposition)).map((row) => valueOf(row.timing.observedAnswerLatencyMs)),
      ),
      runDurationMs: distribution(group.rows.map((row) => valueOf(row.timing.runDurationMs))),
    }))
}

/**
 * Check the capture population before anything is projected from it.
 * Structural breakage refuses the report; everything else is recorded as
 * an anomaly or a warning, because a report of a broken protocol run is
 * exactly what a broken protocol run needs.
 */
function validatePopulation(input: LiveReportInput): { errors: string[]; anomalies: string[]; warnings: string[] } {
  const errors: string[] = []
  const anomalies: string[] = []
  const warnings: string[] = []
  const { set, sessions, grades } = input

  if (grades.setId !== set.setId) errors.push(`the grades are for capture set "${grades.setId}", the capture is "${set.setId}"`)
  const slotIds = set.slots.map((slot) => slot.attemptId)
  const repeatedSlots = slotIds.filter((id, index) => slotIds.indexOf(id) !== index)
  if (repeatedSlots.length > 0) errors.push(`the capture set schedules ${[...new Set(repeatedSlots)].join(', ')} more than once`)

  const declared = new Set(set.sessions.map((reference) => reference.captureId))
  for (const session of sessions) {
    if (!declared.has(session.captureId)) anomalies.push(`Session capture ${session.captureId} is not referenced by the capture set`)
    if (session.setId !== undefined && session.setId !== set.setId) {
      errors.push(`Session capture ${session.captureId} belongs to capture set "${session.setId}"`)
    }
    if (session.mode !== set.mode) anomalies.push(`Session capture ${session.captureId} ran in ${session.mode} mode, the set declares ${set.mode}`)
    if (!session.retention.complete) {
      warnings.push(`Session capture ${session.captureId} retained incomplete diagnostics: ${session.retention.note ?? 'no note'}`)
    }
    for (const error of session.errors) warnings.push(`Session capture ${session.captureId} recorded an error at ${error.stage}`)
  }
  for (const reference of set.sessions) {
    if (!sessions.some((session) => session.captureId === reference.captureId)) {
      errors.push(`the capture set references Session capture ${reference.captureId}, which was not supplied`)
    }
  }

  const { duplicated } = indexAttempts(sessions)
  for (const id of duplicated) errors.push(`attempt ${id} appears in more than one Session capture`)

  const scheduled = new Set(slotIds)
  for (const session of sessions) {
    for (const record of session.attempts) {
      if (!scheduled.has(record.attemptId)) {
        // Retained, never counted: work nobody authorized is a protocol
        // finding, and folding it into a denominator would hide it.
        anomalies.push(`Session capture ${session.captureId} holds attempt ${record.attemptId}, which the set never scheduled`)
      }
      if (record.kind === 'attempt') {
        for (const anomaly of record.anomalies) anomalies.push(`attempt ${record.attemptId}: ${anomaly.kind} — ${anomaly.detail}`)
      }
    }
  }
  for (const slot of set.slots) {
    if (slot.relation === 'initial') {
      if (slot.parentAttemptId !== undefined) errors.push(`slot ${slot.attemptId} is an initial attempt with a parent`)
      continue
    }
    if (slot.parentAttemptId === undefined) {
      errors.push(`slot ${slot.attemptId} is a ${slot.relation} attempt with no parent`)
    } else if (!scheduled.has(slot.parentAttemptId)) {
      errors.push(`slot ${slot.attemptId} names parent ${slot.parentAttemptId}, which the set never scheduled`)
    }
  }
  if (set.state !== 'complete') warnings.push(`the capture set is ${set.state}${set.stateReason === undefined ? '' : ` — ${set.stateReason}`}`)
  if (set.mode !== 'measured') warnings.push(`this is a ${set.mode} capture set: it proves the runner, never a baseline`)
  return { errors, anomalies, warnings }
}

/** Project one capture set and its grades into the compact report. Pure. */
export function buildLiveReport(input: LiveReportInput): Validation<LiveReport> {
  const { errors, anomalies, warnings } = validatePopulation(input)
  if (errors.length > 0) return { ok: false, errors }

  const { byAttemptId } = indexAttempts(input.sessions)
  const sessionById = new Map(input.sessions.map((session) => [session.captureId, session]))
  const byId = new Map<string, SlotView>()
  for (const slot of input.set.slots) {
    const dispatched = byAttemptId.get(slot.attemptId)
    byId.set(slot.attemptId, {
      slot,
      captureId: dispatched?.record.kind === 'attempt' ? dispatched.captureId : null,
      record: dispatched?.record ?? null,
      session: dispatched === undefined ? null : (sessionById.get(dispatched.captureId) ?? null),
    })
  }

  const entryById = new Map(input.grades.entries.map((entry) => [entry.attemptId, entry]))
  const missingGrades = input.set.slots.filter((slot) => !entryById.has(slot.attemptId))
  if (missingGrades.length > 0) {
    return { ok: false, errors: [`no grade entry for scheduled slot(s) ${missingGrades.map((slot) => slot.attemptId).join(', ')}`] }
  }
  for (const entry of input.grades.entries) {
    if (!byId.has(entry.attemptId)) return { ok: false, errors: [`the grades judge ${entry.attemptId}, which the capture set never scheduled`] }
  }

  const rows = [...input.set.slots]
    .sort((left, right) => left.order - right.order || left.attemptId.localeCompare(right.attemptId))
    .map((slot) => rowFor(byId.get(slot.attemptId)!, entryById.get(slot.attemptId)!, byId))

  const pairs = pairsOf(rows, byId)
  const attempted = rows.filter((row) => ATTEMPTED.includes(row.disposition))
  const cohorts = cohortsOf(rows, byId)
  if (cohorts.length > 1) {
    warnings.push(`${cohorts.length} cohorts differ by mode, commit or prompt version — their latencies are reported separately, never pooled silently`)
  }
  if (rows.some((row) => row.grade === 'pending')) {
    warnings.push('grading is incomplete: pending rows are counted in every denominator and never as a success')
  }

  const launches = input.sessions.map((session) => session.launch)
  const provenance: LiveReportProvenance = {
    setId: input.set.setId,
    study: input.set.study.name,
    protocolVersion: input.set.study.protocolVersion,
    mode: input.set.mode,
    state: input.set.state,
    createdAt: input.set.createdAt,
    commits: [...new Set(launches.map((launch) => launch.commit))].sort(),
    dirtyTree: launches.some((launch) => launch.dirtyTree),
    promptVersions: [...new Set(input.set.slots.map((slot) => slot.prompt.version))].sort(),
    keyVersion: input.manifest.keyVersion,
    keyManifestDigest: input.grades.keyManifestDigest,
    gradesRevision: input.grades.revision,
    roles: [
      ...new Set(
        launches.flatMap((launch) =>
          AGENT_ROLE_ORDER.map((role) => {
            const provenanceOfRole = launch.roles[role]
            return `${role}=${provenanceOfRole.configured ? provenanceOfRole.model : `unconfigured (${provenanceOfRole.reason})`}`
          }),
        ),
      ),
    ].sort(),
    reasoningEffortOverride: launches.find((launch) => launch.reasoningEffortOverride !== null)?.reasoningEffortOverride ?? null,
    effortOverrides: [...new Set(launches.flatMap((launch) => Object.keys(launch.effortOverrides)))].sort(),
    adblock: [...new Set(launches.map((launch) => launch.adblock.lists))].sort().join(', '),
    generatedAt: input.generatedAt,
  }

  return {
    ok: true,
    value: {
      kind: LIVE_REPORT_KIND,
      reportVersion: LIVE_REPORT_VERSION,
      provenance,
      rows,
      populations: {
        initial: populationOf('initial', rows.filter((row) => row.relation === 'initial')),
        revisedObjective: populationOf('revised_objective', rows.filter((row) => row.relation === 'revised_objective')),
        corrective: populationOf('corrective', rows.filter((row) => row.relation === 'corrective')),
        bothStep: bothStepPopulation(pairs, rows),
      },
      pairs,
      latency: {
        successMs: distribution(rows.filter((row) => row.verifiedSuccess).map((row) => valueOf(row.timing.successfulTaskCompletionTimeMs))),
        // Failure latency keeps every attempted row that did not verify —
        // dropping them because they earned no completion time is exactly
        // how a baseline starts flattering itself.
        failureMs: distribution(attempted.filter((row) => !row.verifiedSuccess).map((row) => valueOf(row.timing.observedAnswerLatencyMs))),
        runDurationMs: distribution(attempted.map((row) => valueOf(row.timing.runDurationMs))),
        percentilesReported: ['min', 'median', 'max'],
      },
      cohorts,
      attribution: attributionOf(rows, byId),
      usage: usageOf(rows, byId, input.pricing),
      anomalies,
      warnings,
    },
  }
}

// ---------------------------------------------------------------------------
// Formatting. Both formats carry the same facts; neither carries raw
// prompts, Answers, tool results, reviewer prose or absolute paths.

function ms(observation: Observed<number>): string {
  switch (observation.status) {
    case 'observed':
      return `${observation.value} ms`
    case 'unavailable':
      return 'unavailable'
    case 'invalid':
      return 'invalid'
    case 'not_applicable':
      return 'n/a'
  }
}

function statsLine(distributionOf: LiveDistribution): string {
  if (distributionOf.stats === null) return `no observations (missing ${distributionOf.missing})`
  const { minMs, medianMs, maxMs } = distributionOf.stats
  return `n=${distributionOf.observed} (missing ${distributionOf.missing}) min ${minMs} ms | median ${medianMs} ms | max ${maxMs} ms`
}

function populationLine(population: LivePopulation): string {
  return (
    `| ${population.label} | ${population.verifiedSuccess}/${population.scheduled} | ${population.attempted} | ` +
    `${population.answered} | ${population.notReached} | ${population.unaccounted} | ${population.acceptanceUnconfirmed} | ` +
    `${population.reviewed} | ${population.pending} | ${population.timedSuccess} |`
  )
}

/** The compact Markdown projection — the file that lives in the repository. */
export function formatLiveReport(report: LiveReport): string {
  const lines: string[] = []
  const { provenance } = report
  lines.push(`# Live-web report — ${provenance.study} (${provenance.setId})`)
  lines.push('')
  lines.push(`Generated ${provenance.generatedAt} from a capture set created ${provenance.createdAt}.`)
  lines.push('')
  lines.push('## Provenance')
  lines.push('')
  lines.push(`- mode: ${provenance.mode} | set state: ${provenance.state} | protocol ${provenance.protocolVersion}`)
  lines.push(`- commit(s): ${provenance.commits.map((commit) => commit.slice(0, 8)).join(', ')}${provenance.dirtyTree ? ' (dirty tree)' : ''}`)
  lines.push(`- prompt version(s): ${provenance.promptVersions.join(', ')}`)
  lines.push(`- key ${provenance.keyVersion}, manifest ${provenance.keyManifestDigest.slice(0, 15)}…, grades revision ${provenance.gradesRevision}`)
  lines.push(`- routing: ${provenance.roles.join('; ')}`)
  lines.push(
    `- reasoning override: ${provenance.reasoningEffortOverride ?? 'none'} | effort overrides: ${provenance.effortOverrides.length === 0 ? 'none' : provenance.effortOverrides.join(', ')} | adblock: ${provenance.adblock}`,
  )
  lines.push('')
  lines.push('## Populations')
  lines.push('')
  lines.push('Verified success is an independent review of the Answer against a private key. A Run that ended, or proposed `completed`, is not counted here.')
  lines.push('')
  lines.push('| population | verified / scheduled | attempted | answered | not reached | unaccounted | acceptance unconfirmed | reviewed | pending | timed |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const population of [report.populations.initial, report.populations.revisedObjective, report.populations.corrective, report.populations.bothStep]) {
    if (population.scheduled > 0 || population.label === 'initial') lines.push(populationLine(population))
  }
  lines.push('')
  lines.push('## Attempts')
  lines.push('')
  lines.push('| slot | hunt/step | disposition | grade | outcome | proposed | cause | answer latency | task completion | run duration | flags |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const row of report.rows) {
    lines.push(
      `| ${row.attemptId} | ${row.huntId}/${row.stepId} | ${row.disposition} | ${row.grade} | ` +
        `${row.mechanical.outcome ?? '—'} | ${row.mechanical.resolution ?? '—'} | ${row.mechanical.finalizationCause ?? '—'} | ` +
        `${ms(row.timing.observedAnswerLatencyMs)} | ${ms(row.timing.successfulTaskCompletionTimeMs)} | ${ms(row.timing.runDurationMs)} | ` +
        `${row.flags.length === 0 ? '—' : row.flags.join(' ')} |`,
    )
  }
  lines.push('')
  lines.push('## Latency')
  lines.push('')
  lines.push(`- successful Task Completion Time: ${statsLine(report.latency.successMs)}`)
  lines.push(`- unverified attempt Answer latency: ${statsLine(report.latency.failureMs)}`)
  lines.push(`- full Run duration (attempted): ${statsLine(report.latency.runDurationMs)}`)
  lines.push('')
  lines.push('Min, median and max only. A pilot of three repeats per task does not support a p95, and none is offered.')
  if (report.cohorts.length > 1) {
    lines.push('')
    lines.push('### Cohorts')
    lines.push('')
    for (const cohort of report.cohorts) {
      lines.push(`- \`${cohort.key}\` (${cohort.rows} row(s)): success ${statsLine(cohort.successLatencyMs)}; unverified ${statsLine(cohort.failureLatencyMs)}`)
    }
  }
  if (report.pairs.length > 0) {
    lines.push('')
    lines.push('## Initial and follow-up pairs')
    lines.push('')
    lines.push('| hunt | initial | follow-up | both verified | sequence elapsed | inter-command gap |')
    lines.push('| --- | --- | --- | --- | --- | --- |')
    for (const pair of report.pairs) {
      lines.push(
        `| ${pair.huntId} | ${pair.initialAttemptId} ${pair.initialVerified ? 'pass' : 'not verified'} | ` +
          `${pair.followUpAttemptId} ${pair.followUpVerified ? 'pass' : 'not verified'} | ${pair.bothVerified ? 'yes' : 'no'} | ` +
          `${ms(pair.sequenceElapsedMs)} | ${ms(pair.interCommandGapMs)} |`,
      )
    }
  }
  lines.push('')
  lines.push('## Where the time went')
  lines.push('')
  lines.push(report.attribution.note)
  lines.push('')
  lines.push(`Span coverage: ${report.attribution.attemptsWithSpans} attempt(s) with perf spans, ${report.attribution.attemptsWithoutSpans} without. Clock origin(s): ${report.attribution.clockOrigins.join(', ') || 'none'}.`)
  lines.push('')
  lines.push('| stage | spans | total (non-additive) | union | attempts |')
  lines.push('| --- | --- | --- | --- | --- |')
  for (const stage of report.attribution.stages) {
    lines.push(`| ${stage.stage} | ${stage.count} | ${stage.totalMs} ms | ${stage.unionMs} ms | ${stage.attemptsCovered} |`)
  }
  lines.push('')
  lines.push(
    `- retries observed: ${report.attribution.retries} (counted, never timed) | tool calls: ${report.attribution.toolCalls} | workers finalized: ${report.attribution.workersFinalized}`,
  )
  lines.push(
    `- vision: ${report.attribution.vision.requests} request(s), ${report.attribution.vision.totalMs === null ? 'duration unavailable' : `${report.attribution.vision.totalMs} ms`} over ${report.attribution.vision.attemptsCovered} attempt(s)`,
  )
  lines.push(`- user waiting: ${statsLine(report.attribution.userWaitMs)}`)
  lines.push(
    `- speech: synthesis ${report.attribution.speech.synthesisMs ?? 'unavailable'}${report.attribution.speech.synthesisMs === null ? '' : ' ms'}, playback ${report.attribution.speech.playbackMs ?? 'unavailable'}${report.attribution.speech.playbackMs === null ? '' : ' ms'}, voice input latency n/a (typed capture)`,
  )
  lines.push('')
  lines.push('## Usage')
  lines.push('')
  lines.push('| role | attempts observed | unavailable | n/a | prompt | completion | rounds | with usage | complete | models |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const summary of report.usage.byRole) {
    lines.push(
      `| ${summary.role} | ${summary.attemptsObserved} | ${summary.attemptsUnavailable} | ${summary.attemptsNotApplicable} | ` +
        `${summary.promptTokens} | ${summary.completionTokens} | ${summary.rounds} | ${summary.roundsWithUsage} | ` +
        `${summary.complete ? 'yes' : 'no'} | ${summary.models.join(', ') || '—'} |`,
    )
  }
  const estimate = report.usage.estimate
  lines.push('')
  if (estimate === null) {
    lines.push('No cost estimate: none is produced without an explicit dated price list.')
  } else {
    lines.push(`Estimated subtotal ${estimate.subtotalUsd} ${estimate.currency} over ${estimate.pricedModels.join(', ') || 'no priced model'} (${estimate.source}, ${estimate.dated}).`)
    lines.push('')
    lines.push(estimate.note)
    for (const item of estimate.unpriced) lines.push(`- uncovered: ${item.what} — ${item.reason}`)
  }
  if (report.anomalies.length > 0) {
    lines.push('')
    lines.push('## Protocol anomalies')
    lines.push('')
    lines.push('Retained, never counted as authorized work.')
    lines.push('')
    for (const anomaly of report.anomalies) lines.push(`- ${anomaly}`)
  }
  if (report.warnings.length > 0) {
    lines.push('')
    lines.push('## Data quality')
    lines.push('')
    for (const warning of report.warnings) lines.push(`- ${warning}`)
  }
  lines.push('')
  lines.push('## Retained artifacts')
  lines.push('')
  lines.push('Identities only; the files stay local and are never published through this report.')
  lines.push('')
  for (const row of report.rows) {
    if (row.artifacts.length === 0) continue
    const families = row.artifacts.map((artifact) => `${artifact.family}(${artifact.digest.slice(7, 15)}${artifact.complete ? '' : ', incomplete'}${artifact.truncated ? ', truncated' : ''})`)
    lines.push(`- ${row.attemptId} in ${row.captureId ?? 'no capture'}: ${families.join(', ')}`)
  }
  lines.push('')
  return lines.join('\n')
}
