// The cross-pass summary (#233): what N Passes of the live-web protocol say
// together, read from their compact reports and from nothing else.
//
// The rules it holds, all of them from #223 and ADR 0044:
//
//   * The input is the JSON report `live:report` wrote, never the capture
//     sets and grades. Every disposition, grade binding, timing and usage
//     question was settled once there; a summary that re-derived them would
//     be a second implementation of the same rules, and the two would
//     diverge. This module reads what the reports say and counts it.
//   * It merges nothing it cannot check. A Baseline is the Passes on one
//     route under one Grading Key version and one reviewer, so inputs that
//     differ in anything the protocol fixes are refused with the differing
//     values named. Commit, dirty tree and grades revision are listed per
//     input and never compared: they are what a Pass records about itself.
//   * Min, median and max only. N repeats support no p95, no mean and no
//     confidence interval, and the output says so with N substituted.
//   * Missing stays missing. A Pass with no verified attempt contributes
//     nothing to a Task Completion Time, the row says `n=k of N passes`, and
//     the Pass is never a zero and never leaves the denominator.
//
// Relative imports carry `.ts` — the CLI runs this file under Node's type
// stripping — and no key module is on its graph.

import type { AgentRole } from '../../src/core/agent/modelRouting'
import { allowedDifferenceLine, type AllowedDifference, type AllowedDifferenceRecord } from './allowedDifference.ts'
import type { Validation } from './artifacts.ts'
import type { LiveGradeStatus } from './grades.ts'
import {
  LIVE_REPORT_KIND,
  LIVE_REPORT_VERSION,
  ms,
  rateOver,
  type LiveDisposition,
  type LivePopulation,
  type LiveReport,
  type LiveReportRow,
  type LiveRoleUsageSummary,
} from './report.ts'
import type { AttemptRelation, Observed } from './types.ts'

/** The `kind` a summary file carries. */
export const LIVE_SUMMARY_KIND = 'bingbong.live.summary'
export const LIVE_SUMMARY_VERSION = 1

const ATTEMPTED: readonly LiveDisposition[] = ['answered', 'no_answer', 'acceptance_unconfirmed']

/** One report as the CLI read it: the parsed report and the path it came from, for provenance. */
export interface LiveSummaryInput {
  readonly path: string
  readonly report: LiveReport
}

/** One Pass, as its report described itself. Listed, never compared. */
export interface LiveSummaryPass {
  readonly setId: string
  readonly reportPath: string
  readonly createdAt: string
  readonly state: string
  readonly commits: readonly string[]
  readonly dirtyTree: boolean
  readonly gradesRevision: number
  readonly reportGeneratedAt: string
}

/**
 * Min, median and max over the observations that exist, against the number
 * of Passes that could have supplied one. `stats` is null for an empty
 * spread — never a zero standing in for no data.
 */
export interface LiveSummarySpread {
  readonly observations: readonly number[]
  readonly observed: number
  /**
   * Attempts that qualified for this spread and carried no observation —
   * a verified Answer whose Task Completion Time is unavailable or invalid.
   * Kept apart from a Pass that had no qualifying attempt at all, which is
   * the gap between `observed + missing` and `passes`.
   */
  readonly missing: number
  readonly passes: number
  readonly stats: { readonly minMs: number; readonly medianMs: number; readonly maxMs: number } | null
}

/** One Pass's row for one task, as the report had it. */
export interface LiveSummaryTaskRow {
  readonly setId: string
  readonly attemptId: string
  readonly disposition: LiveDisposition
  readonly grade: LiveGradeStatus
  readonly verifiedSuccess: boolean
  readonly finalizationCause: string | null
  readonly observedAnswerLatencyMs: Observed<number>
  readonly successfulTaskCompletionTimeMs: Observed<number>
  readonly runDurationMs: Observed<number>
  readonly flags: readonly string[]
}

/** One task — a Hunt's step — over every Pass. */
export interface LiveSummaryTask {
  readonly huntId: string
  readonly stepId: string
  readonly relation: AttemptRelation
  readonly promptVersion: string
  readonly rows: readonly LiveSummaryTaskRow[]
  readonly attempts: number
  readonly answered: number
  readonly verified: number
  /** Over verified attempts only: a Task Completion Time is earned, not observed. */
  readonly taskCompletionTimeMs: LiveSummarySpread
  /** Over attempted, unverified rows: a wrong Answer's latency is a measurement. */
  readonly unverifiedAnswerLatencyMs: LiveSummarySpread
  readonly runDurationMs: LiveSummarySpread
  readonly finalizationCauses: Readonly<Record<string, number>>
  readonly flags: Readonly<Record<string, number>>
}

export interface LiveSummarySequenceRow {
  readonly setId: string
  readonly initialAttemptId: string
  readonly followUpAttemptId: string
  readonly initialVerified: boolean
  readonly followUpVerified: boolean
  readonly bothVerified: boolean
  readonly sequenceElapsedMs: Observed<number>
}

/** One Hunt with a follow-up: its both-step sequence over every Pass. */
export interface LiveSummarySequence {
  readonly huntId: string
  readonly rows: readonly LiveSummarySequenceRow[]
  readonly bothVerified: number
  readonly sequenceElapsedMs: LiveSummarySpread
}

export interface LiveSummaryPassRate {
  readonly setId: string
  readonly verifiedSuccess: number
  readonly scheduled: number
  readonly rate: number | null
}

/** One population summed across Passes, with each Pass's own rate beside the sum. */
export interface LiveSummaryPopulation {
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
  readonly timedSuccess: number
  readonly rate: number | null
  readonly perPass: readonly LiveSummaryPassRate[]
}

export interface LiveSummaryRoleUsage {
  readonly role: AgentRole
  readonly attemptsObserved: number
  readonly attemptsUnavailable: number
  readonly attemptsNotApplicable: number
  readonly promptTokens: number
  readonly completionTokens: number
  readonly rounds: number
  readonly roundsWithUsage: number
  /** False when the role was incomplete in any Pass; the Passes are named. */
  readonly complete: boolean
  readonly incompleteIn: readonly string[]
  readonly models: readonly string[]
}

export interface LiveSummaryProvenance {
  readonly study: string
  readonly protocolVersion: string
  readonly mode: string
  readonly adblock: string
  readonly reasoningEffortOverride: string | null
  /** The `BINGBONG_DECISION_SEAMS` list the Passes forwarded (#279): shared, compared; null when none did. */
  readonly decisionSeams: string | null
  readonly effortOverrides: readonly string[]
  /** Whether the Passes retained the verbose browser sub-spans (#247): shared, compared, timing records only. */
  readonly browserSubspans: boolean
  readonly keyVersion: string
  readonly keyManifestDigest: string
  readonly roles: readonly string[]
  readonly reviewers: readonly string[]
  readonly promptVersions: readonly string[]
  readonly passes: readonly LiveSummaryPass[]
  readonly generatedAt: string
  /**
   * The one fixed field the caller let differ (#279, `--allow-differs`),
   * with what each Pass held, or null when every field was held fixed. The
   * Decision Model experiment pools its arms this way: a configured versus
   * unconfigured `decision` role is a routing difference.
   */
  readonly allowedDifference: AllowedDifferenceRecord | null
}

/** A statement carried forward from one input's report, with the Pass it belongs to. */
export interface LiveSummaryCarried {
  readonly setId: string
  readonly message: string
}

export interface LiveSummary {
  readonly kind: typeof LIVE_SUMMARY_KIND
  readonly summaryVersion: typeof LIVE_SUMMARY_VERSION
  readonly provenance: LiveSummaryProvenance
  readonly passes: number
  readonly tasks: readonly LiveSummaryTask[]
  readonly sequences: readonly LiveSummarySequence[]
  readonly populations: {
    readonly initial: LiveSummaryPopulation
    readonly revisedObjective: LiveSummaryPopulation
    /** Null unless a corrective slot was scheduled in any input. */
    readonly corrective: LiveSummaryPopulation | null
    readonly bothStep: LiveSummaryPopulation
  }
  readonly usage: {
    readonly byRole: readonly LiveSummaryRoleUsage[]
    readonly limits: readonly string[]
  }
  readonly statistics: {
    readonly percentilesReported: readonly ['min', 'median', 'max']
    readonly note: string
  }
  readonly attributionNote: string
  readonly anomalies: readonly LiveSummaryCarried[]
  readonly warnings: readonly LiveSummaryCarried[]
}

// ---------------------------------------------------------------------------
// Reading a report file. Shape checks over what this module reads — enough
// to refuse a file of the wrong kind or version, or one missing the fields
// the refusal rules depend on, before anything is counted.

const isString = (value: unknown): value is string => typeof value === 'string'
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString)
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'
/** An `Observed<number>` as the report writes one: a finite value when observed, a reason otherwise. */
const isObservedNumber = (value: unknown): boolean =>
  isRecord(value) &&
  (value.status === 'observed'
    ? isNumber(value.value)
    : (value.status === 'unavailable' || value.status === 'invalid' || value.status === 'not_applicable') && isString(value.reason))

const RELATIONS: readonly string[] = ['initial', 'revised_objective', 'corrective']
const DISPOSITIONS: readonly string[] = ['answered', 'no_answer', 'acceptance_unconfirmed', 'not_reached', 'unaccounted']
const GRADES: readonly string[] = ['pending', 'pass', 'useful_partial', 'help_access_blocked', 'unsuccessful']
const POPULATION_COUNTS = ['scheduled', 'attempted', 'answered', 'notReached', 'unaccounted', 'acceptanceUnconfirmed', 'reviewed', 'pending', 'verifiedSuccess', 'timedSuccess'] as const
const USAGE_COUNTS = ['attemptsObserved', 'attemptsUnavailable', 'attemptsNotApplicable', 'promptTokens', 'completionTokens', 'rounds', 'roundsWithUsage'] as const

function checkAll(value: unknown, where: string, check: (item: Record<string, unknown>, at: string) => void, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${where} is not a list`)
    return
  }
  value.forEach((item: unknown, index: number) => {
    if (isRecord(item)) check(item, `${where}[${index}]`)
    else errors.push(`${where}[${index}] is not an object`)
  })
}

/** Validate one parsed JSON value as a version-2 report. Names the file, never its contents. */
export function parseLiveReportForSummary(raw: unknown, label: string): Validation<LiveReport> {
  const errors: string[] = []
  if (!isRecord(raw)) return { ok: false, errors: [`${label}: not a JSON object`] }
  if (raw.kind !== LIVE_REPORT_KIND) {
    return { ok: false, errors: [`${label}: kind is ${isString(raw.kind) ? `"${raw.kind}"` : 'missing'}, not ${LIVE_REPORT_KIND}`] }
  }
  if (raw.reportVersion !== LIVE_REPORT_VERSION) {
    return {
      ok: false,
      errors: [
        `${label}: reportVersion is ${typeof raw.reportVersion === 'number' ? raw.reportVersion : 'missing'}, and this summary reads version ${LIVE_REPORT_VERSION} — regenerate it with live:report --format=json`,
      ],
    }
  }

  const provenance = raw.provenance
  if (!isRecord(provenance)) {
    errors.push(`${label}: provenance is missing`)
  } else {
    for (const field of ['setId', 'study', 'protocolVersion', 'mode', 'state', 'createdAt', 'keyVersion', 'keyManifestDigest', 'adblock', 'generatedAt']) {
      if (!isString(provenance[field])) errors.push(`${label}: provenance.${field} is not a string`)
    }
    for (const field of ['commits', 'promptVersions', 'reviewers', 'roles', 'effortOverrides']) {
      if (!isStringArray(provenance[field])) errors.push(`${label}: provenance.${field} is not a list of strings`)
    }
    if (typeof provenance.dirtyTree !== 'boolean') errors.push(`${label}: provenance.dirtyTree is not a boolean`)
    if (typeof provenance.gradesRevision !== 'number') errors.push(`${label}: provenance.gradesRevision is not a number`)
    if (provenance.reasoningEffortOverride !== null && !isString(provenance.reasoningEffortOverride)) {
      errors.push(`${label}: provenance.reasoningEffortOverride is neither a string nor null`)
    }
    // Absent on reports written before #279, which read as no seam list.
    if (provenance.decisionSeams !== undefined && provenance.decisionSeams !== null && !isString(provenance.decisionSeams)) {
      errors.push(`${label}: provenance.decisionSeams is neither a string nor null`)
    }
    // Recorded since #247; a report written before then was captured with the flag off.
    if (provenance.browserSubspans !== undefined && !isBoolean(provenance.browserSubspans)) {
      errors.push(`${label}: provenance.browserSubspans is not a boolean`)
    }
  }

  checkAll(
    raw.rows,
    `${label}: rows`,
    (row, where) => {
      for (const field of ['attemptId', 'huntId', 'stepId', 'promptVersion']) {
        if (!isString(row[field])) errors.push(`${where}.${field} is not a string`)
      }
      if (!isString(row.relation) || !RELATIONS.includes(row.relation)) errors.push(`${where}.relation is not an attempt relation`)
      if (!isString(row.disposition) || !DISPOSITIONS.includes(row.disposition)) errors.push(`${where}.disposition is not a disposition`)
      if (!isString(row.grade) || !GRADES.includes(row.grade)) errors.push(`${where}.grade is not a grade status`)
      if (!isBoolean(row.verifiedSuccess)) errors.push(`${where}.verifiedSuccess is not a boolean`)
      if (!isStringArray(row.flags)) errors.push(`${where}.flags is not a list of strings`)
      if (!isRecord(row.mechanical) || (row.mechanical.finalizationCause !== null && !isString(row.mechanical.finalizationCause))) {
        errors.push(`${where}.mechanical.finalizationCause is neither a string nor null`)
      }
      const timing = row.timing
      if (!isRecord(timing)) {
        errors.push(`${where}.timing is missing`)
      } else {
        for (const field of ['observedAnswerLatencyMs', 'successfulTaskCompletionTimeMs', 'runDurationMs']) {
          if (!isObservedNumber(timing[field])) errors.push(`${where}.timing.${field} is not an observation of a number`)
        }
      }
    },
    errors,
  )

  const populations = raw.populations
  if (!isRecord(populations)) {
    errors.push(`${label}: populations is missing`)
  } else {
    for (const field of ['initial', 'revisedObjective', 'corrective', 'bothStep']) {
      const population = populations[field]
      if (!isRecord(population)) {
        errors.push(`${label}: populations.${field} is missing`)
        continue
      }
      if (!isString(population.label)) errors.push(`${label}: populations.${field}.label is not a string`)
      for (const count of POPULATION_COUNTS) {
        if (!isNumber(population[count])) errors.push(`${label}: populations.${field}.${count} is not a number`)
      }
    }
  }
  checkAll(
    raw.pairs,
    `${label}: pairs`,
    (pair, where) => {
      for (const field of ['huntId', 'initialAttemptId', 'followUpAttemptId']) {
        if (!isString(pair[field])) errors.push(`${where}.${field} is not a string`)
      }
      for (const field of ['initialVerified', 'followUpVerified', 'bothVerified']) {
        if (!isBoolean(pair[field])) errors.push(`${where}.${field} is not a boolean`)
      }
      if (!isObservedNumber(pair.sequenceElapsedMs)) errors.push(`${where}.sequenceElapsedMs is not an observation of a number`)
    },
    errors,
  )
  checkAll(
    isRecord(raw.usage) ? raw.usage.byRole : undefined,
    `${label}: usage.byRole`,
    (summary, where) => {
      if (!isString(summary.role)) errors.push(`${where}.role is not a string`)
      for (const count of USAGE_COUNTS) {
        if (!isNumber(summary[count])) errors.push(`${where}.${count} is not a number`)
      }
      if (!isBoolean(summary.complete)) errors.push(`${where}.complete is not a boolean`)
      if (!isStringArray(summary.models)) errors.push(`${where}.models is not a list of strings`)
    },
    errors,
  )
  if (!isStringArray(raw.anomalies)) errors.push(`${label}: anomalies is not a list of strings`)
  if (!isStringArray(raw.warnings)) errors.push(`${label}: warnings is not a list of strings`)

  if (errors.length > 0) return { ok: false, errors }
  const report = raw as unknown as LiveReport
  return { ok: true, value: { ...report, provenance: { ...report.provenance, browserSubspans: report.provenance.browserSubspans === true } } }
}

// ---------------------------------------------------------------------------
// Statistics. The one place a number is computed from other numbers.

/** The median as this summary defines it: an even count takes the mean of its two middle values. */
export function medianOf(sorted: readonly number[]): number {
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

function spread(observations: readonly Observed<number>[], passes: number): LiveSummarySpread {
  const sorted = observations
    .filter((observation): observation is { status: 'observed'; value: number } => observation.status === 'observed')
    .map((observation) => observation.value)
    .sort((left, right) => left - right)
  return {
    observations: sorted,
    observed: sorted.length,
    missing: observations.length - sorted.length,
    passes,
    stats: sorted.length === 0 ? null : { minMs: sorted[0]!, medianMs: medianOf(sorted), maxMs: sorted[sorted.length - 1]! },
  }
}

function counted(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)))
}

// ---------------------------------------------------------------------------
// The refusals. Everything the protocol fixes must agree across inputs.

/**
 * A task's identity: the Hunt, the step and the relation. The relation is
 * part of it because a corrective retry may carry its parent's step id (the
 * capture contract leaves step ids free), and a retry is not the step it
 * corrects.
 */
const taskKey = (row: { huntId: string; stepId: string; relation: AttemptRelation }): string => `${row.huntId}/${row.stepId} (${row.relation})`

/** Which fields a Baseline holds fixed, and how each reads from a report. */
const FIXED_FIELDS: readonly { readonly name: string; readonly allowable?: AllowedDifference; readonly of: (report: LiveReport) => string }[] = [
  { name: 'key version', of: (report) => report.provenance.keyVersion },
  { name: 'key manifest digest', of: (report) => report.provenance.keyManifestDigest },
  { name: 'routing', allowable: 'routing', of: (report) => report.provenance.roles.join('; ') },
  { name: 'reviewer', of: (report) => report.provenance.reviewers.join('; ') },
  { name: 'study', of: (report) => report.provenance.study },
  { name: 'protocol version', of: (report) => report.provenance.protocolVersion },
  { name: 'mode', of: (report) => report.provenance.mode },
  { name: 'adblock', of: (report) => report.provenance.adblock },
  { name: 'reasoning-effort override', of: (report) => report.provenance.reasoningEffortOverride ?? 'none' },
  { name: 'decision seams', of: (report) => report.provenance.decisionSeams ?? 'none' },
  { name: 'effort overrides', of: (report) => report.provenance.effortOverrides.join(', ') || 'none' },
  { name: 'browser sub-spans', of: (report) => (report.provenance.browserSubspans ? 'on' : 'off') },
]

function refusals(ordered: readonly LiveSummaryInput[], allowDiffers: AllowedDifference | undefined): string[] {
  const errors: string[] = []
  const label = (input: LiveSummaryInput): string => input.report.provenance.setId

  // A Pass nobody has graded has no reviewer to agree with the others: it is
  // not yet part of a Baseline, and comparing an empty reviewer list would
  // report a disagreement that is really an absence.
  for (const input of ordered) {
    if (input.report.provenance.reviewers.length === 0) {
      errors.push(`${label(input)}: no entry has been reviewed — a Pass without a Grade is not part of a Baseline yet`)
    }
  }
  if (errors.length > 0) return errors

  for (const field of FIXED_FIELDS) {
    if (field.allowable !== undefined && field.allowable === allowDiffers) continue
    const values = ordered.map((input) => field.of(input.report))
    if (new Set(values).size > 1) {
      errors.push(`${field.name} differs: ${ordered.map((input, index) => `${label(input)}=${values[index]}`).join(', ')}`)
    }
  }

  // The schedule: every Pass runs the same tasks, each once, each under one
  // prompt. A Pass with two rows for one task would count twice against N
  // in every per-task figure, so it is refused rather than folded in.
  const taskVersionsOf = (input: LiveSummaryInput): Map<string, string> => {
    const versions = new Map<string, string[]>()
    for (const row of input.report.rows) {
      const key = taskKey(row)
      versions.set(key, [...(versions.get(key) ?? []), row.promptVersion])
    }
    for (const [key, rows] of versions) {
      if (rows.length > 1) errors.push(`${label(input)}: ${key} has ${rows.length} rows, and a Pass has one row per task`)
    }
    return new Map([...versions.entries()].map(([key, rows]) => [key, rows[0]!]))
  }
  const first = ordered[0]!
  const tasksByInput = new Map(ordered.map((input) => [input, taskVersionsOf(input)]))
  const firstTasks = tasksByInput.get(first)!
  for (const input of ordered.slice(1)) {
    const tasks = tasksByInput.get(input)!
    const missing = [...firstTasks.keys()].filter((key) => !tasks.has(key))
    const extra = [...tasks.keys()].filter((key) => !firstTasks.has(key))
    if (missing.length > 0) errors.push(`scheduled tasks differ: ${label(first)} has ${missing.join(', ')}, which ${label(input)} does not`)
    if (extra.length > 0) errors.push(`scheduled tasks differ: ${label(input)} has ${extra.join(', ')}, which ${label(first)} does not`)
  }
  for (const key of firstTasks.keys()) {
    const values = ordered.map((input) => tasksByInput.get(input)!.get(key))
    if (new Set(values).size > 1) {
      errors.push(
        `prompt version of ${key} differs: ${ordered.map((input, index) => `${label(input)}=${values[index] ?? 'not scheduled'}`).join(', ')}`,
      )
    }
  }
  return errors
}

// ---------------------------------------------------------------------------
// Counting.

function taskRowOf(setId: string, row: LiveReportRow): LiveSummaryTaskRow {
  return {
    setId,
    attemptId: row.attemptId,
    disposition: row.disposition,
    grade: row.grade,
    verifiedSuccess: row.verifiedSuccess,
    finalizationCause: row.mechanical.finalizationCause,
    observedAnswerLatencyMs: row.timing.observedAnswerLatencyMs,
    successfulTaskCompletionTimeMs: row.timing.successfulTaskCompletionTimeMs,
    runDurationMs: row.timing.runDurationMs,
    flags: row.flags,
  }
}

function tasksOf(ordered: readonly LiveSummaryInput[]): LiveSummaryTask[] {
  const passes = ordered.length
  // Task order is the first Pass's slot order; every Pass has the same tasks
  // by the time this runs.
  const seen = new Map<string, { huntId: string; stepId: string; relation: AttemptRelation; promptVersion: string }>()
  for (const row of ordered[0]!.report.rows) {
    if (!seen.has(taskKey(row))) seen.set(taskKey(row), { huntId: row.huntId, stepId: row.stepId, relation: row.relation, promptVersion: row.promptVersion })
  }
  return [...seen.entries()].map(([key, task]) => {
    const rows = ordered.flatMap((input) =>
      input.report.rows.filter((row) => taskKey(row) === key).map((row) => taskRowOf(input.report.provenance.setId, row)),
    )
    const attempted = rows.filter((row) => ATTEMPTED.includes(row.disposition))
    const verified = rows.filter((row) => row.verifiedSuccess)
    return {
      ...task,
      rows,
      attempts: attempted.length,
      answered: rows.filter((row) => row.disposition === 'answered').length,
      verified: verified.length,
      taskCompletionTimeMs: spread(verified.map((row) => row.successfulTaskCompletionTimeMs), passes),
      unverifiedAnswerLatencyMs: spread(attempted.filter((row) => !row.verifiedSuccess).map((row) => row.observedAnswerLatencyMs), passes),
      runDurationMs: spread(attempted.map((row) => row.runDurationMs), passes),
      finalizationCauses: counted(rows.map((row) => row.finalizationCause).filter((cause): cause is string => cause !== null)),
      flags: counted(rows.flatMap((row) => row.flags)),
    }
  })
}

function sequencesOf(ordered: readonly LiveSummaryInput[]): LiveSummarySequence[] {
  const huntIds = [...new Set(ordered.flatMap((input) => input.report.pairs.map((pair) => pair.huntId)))]
  return huntIds.map((huntId) => {
    const rows = ordered.flatMap((input) =>
      input.report.pairs
        .filter((pair) => pair.huntId === huntId)
        .map((pair): LiveSummarySequenceRow => ({
          setId: input.report.provenance.setId,
          initialAttemptId: pair.initialAttemptId,
          followUpAttemptId: pair.followUpAttemptId,
          initialVerified: pair.initialVerified,
          followUpVerified: pair.followUpVerified,
          bothVerified: pair.bothVerified,
          sequenceElapsedMs: pair.sequenceElapsedMs,
        })),
    )
    const bothVerified = rows.filter((row) => row.bothVerified)
    return {
      huntId,
      rows,
      bothVerified: bothVerified.length,
      sequenceElapsedMs: spread(bothVerified.map((row) => row.sequenceElapsedMs), ordered.length),
    }
  })
}

function populationOf(ordered: readonly LiveSummaryInput[], pick: (report: LiveReport) => LivePopulation): LiveSummaryPopulation {
  const parts = ordered.map((input) => ({ setId: input.report.provenance.setId, population: pick(input.report) }))
  const sum = (field: keyof Omit<LivePopulation, 'label' | 'verifiedOverReviewed' | 'byGrade'>): number =>
    parts.reduce((total, part) => total + part.population[field], 0)
  const verifiedSuccess = sum('verifiedSuccess')
  const scheduled = sum('scheduled')
  return {
    label: parts[0]!.population.label,
    scheduled,
    attempted: sum('attempted'),
    answered: sum('answered'),
    notReached: sum('notReached'),
    unaccounted: sum('unaccounted'),
    acceptanceUnconfirmed: sum('acceptanceUnconfirmed'),
    reviewed: sum('reviewed'),
    pending: sum('pending'),
    verifiedSuccess,
    timedSuccess: sum('timedSuccess'),
    rate: rateOver(verifiedSuccess, scheduled),
    perPass: parts.map((part) => ({
      setId: part.setId,
      verifiedSuccess: part.population.verifiedSuccess,
      scheduled: part.population.scheduled,
      rate: rateOver(part.population.verifiedSuccess, part.population.scheduled),
    })),
  }
}

function usageOf(ordered: readonly LiveSummaryInput[]): { byRole: LiveSummaryRoleUsage[]; limits: string[] } {
  const roles = [...new Set(ordered.flatMap((input) => input.report.usage.byRole.map((summary) => summary.role)))]
  const byRole = roles.map((role): LiveSummaryRoleUsage => {
    const parts = ordered.map((input) => ({
      setId: input.report.provenance.setId,
      summary: input.report.usage.byRole.find((summary) => summary.role === role) ?? null,
    }))
    const present = parts.filter((part): part is { setId: string; summary: LiveRoleUsageSummary } => part.summary !== null)
    const sum = (field: 'attemptsObserved' | 'attemptsUnavailable' | 'attemptsNotApplicable' | 'promptTokens' | 'completionTokens' | 'rounds' | 'roundsWithUsage'): number =>
      present.reduce((total, part) => total + part.summary[field], 0)
    // The same semantics as one report: complete only when every Pass was.
    // A Pass whose report has no row for the role is incomplete for it.
    const incompleteIn = parts.filter((part) => part.summary === null || !part.summary.complete).map((part) => part.setId)
    return {
      role,
      attemptsObserved: sum('attemptsObserved'),
      attemptsUnavailable: sum('attemptsUnavailable'),
      attemptsNotApplicable: sum('attemptsNotApplicable'),
      promptTokens: sum('promptTokens'),
      completionTokens: sum('completionTokens'),
      rounds: sum('rounds'),
      roundsWithUsage: sum('roundsWithUsage'),
      complete: incompleteIn.length === 0,
      incompleteIn,
      models: [...new Set(present.flatMap((part) => part.summary.models))].sort(),
    }
  })
  const limits = [
    'Tokens are summed per role across Passes, not per model: a role that used several models has no per-model split, and none is inferred.',
    'Vision usage is unavailable by construction — vision records carry request duration and never tokens.',
    'No cost estimate is produced here; a priced estimate belongs to a single report with an explicit dated price list.',
    ...byRole
      .filter((summary) => summary.rounds > 0 && !summary.complete)
      .map((summary) => `${summary.role}: incomplete in ${summary.incompleteIn.join(', ')}, so its tokens are a floor.`),
  ]
  return { byRole, limits }
}

function statisticsNote(passes: number): string {
  return (
    `Min, median and max only, over ${passes} passes. ${passes} repeats do not support a p95, a mean or a confidence interval, and none is offered. ` +
    'A median of an even count is the mean of its two middle values.'
  )
}

const ATTRIBUTION_NOTE = 'No attribution here: the per-set reports keep the stage tables, and nothing about where the time went is derived across Passes.'

/** Read N reports together. Pure: the caller stamps `generatedAt`. */
/** How a summary may be told to pool across one fixed field (#279). */
export interface LiveSummaryOptions {
  /** The one field allowed to differ between Passes; every other stays refused. */
  readonly allowDiffers?: AllowedDifference
}

export function buildLiveSummary(inputs: readonly LiveSummaryInput[], generatedAt: string, options: LiveSummaryOptions = {}): Validation<LiveSummary> {
  if (inputs.length < 2) {
    return { ok: false, errors: [`${inputs.length} report(s) named; a summary needs at least two Passes — for one Pass, read its report`] }
  }

  const errors: string[] = []
  const bySetId = new Map<string, LiveSummaryInput[]>()
  for (const input of inputs) {
    const id = input.report.provenance.setId
    bySetId.set(id, [...(bySetId.get(id) ?? []), input])
  }
  for (const [setId, named] of bySetId) {
    if (named.length > 1) errors.push(`capture set ${setId} is named ${named.length} times (${named.map((input) => input.path).join(', ')}): one Pass counts once`)
  }
  const byCreatedAt = new Map<string, LiveSummaryInput[]>()
  for (const input of inputs) {
    const at = input.report.provenance.createdAt
    if (!Number.isFinite(Date.parse(at))) errors.push(`${input.report.provenance.setId}: createdAt "${at}" is not a parseable stamp, so the Passes cannot be ordered`)
    byCreatedAt.set(at, [...(byCreatedAt.get(at) ?? []), input])
  }
  for (const [at, named] of byCreatedAt) {
    if (named.length > 1 && new Set(named.map((input) => input.report.provenance.setId)).size > 1) {
      errors.push(`capture sets ${named.map((input) => input.report.provenance.setId).join(' and ')} share createdAt ${at}: one Pass counts once`)
    }
  }
  if (errors.length > 0) return { ok: false, errors }

  const ordered = [...inputs].sort(
    (left, right) => Date.parse(left.report.provenance.createdAt) - Date.parse(right.report.provenance.createdAt),
  )
  const refused = refusals(ordered, options.allowDiffers)
  if (refused.length > 0) return { ok: false, errors: refused }

  const shared = ordered[0]!.report.provenance
  const warnings: LiveSummaryCarried[] = []
  const anomalies: LiveSummaryCarried[] = []
  for (const input of ordered) {
    const { setId } = input.report.provenance
    // A set whose state is not complete arrives with its report's own
    // warning saying so; it is carried like every other, never re-derived.
    for (const warning of input.report.warnings) warnings.push({ setId, message: warning })
    for (const anomaly of input.report.anomalies) anomalies.push({ setId, message: anomaly })
  }

  const correctiveScheduled = ordered.some((input) => input.report.populations.corrective.scheduled > 0)
  return {
    ok: true,
    value: {
      kind: LIVE_SUMMARY_KIND,
      summaryVersion: LIVE_SUMMARY_VERSION,
      provenance: {
        study: shared.study,
        protocolVersion: shared.protocolVersion,
        mode: shared.mode,
        adblock: shared.adblock,
        reasoningEffortOverride: shared.reasoningEffortOverride,
        decisionSeams: shared.decisionSeams ?? null,
        effortOverrides: shared.effortOverrides,
        browserSubspans: shared.browserSubspans,
        keyVersion: shared.keyVersion,
        keyManifestDigest: shared.keyManifestDigest,
        roles: shared.roles,
        reviewers: shared.reviewers,
        promptVersions: [...new Set(ordered.flatMap((input) => input.report.provenance.promptVersions))].sort(),
        passes: ordered.map((input) => ({
          setId: input.report.provenance.setId,
          reportPath: input.path,
          createdAt: input.report.provenance.createdAt,
          state: input.report.provenance.state,
          commits: input.report.provenance.commits,
          dirtyTree: input.report.provenance.dirtyTree,
          gradesRevision: input.report.provenance.gradesRevision,
          reportGeneratedAt: input.report.provenance.generatedAt,
        })),
        generatedAt,
        allowedDifference:
          options.allowDiffers === undefined
            ? null
            : {
                field: options.allowDiffers,
                values: ordered.map((input) => ({
                  setId: input.report.provenance.setId,
                  value: FIXED_FIELDS.find((field) => field.allowable === options.allowDiffers)!.of(input.report),
                })),
              },
      },
      passes: ordered.length,
      tasks: tasksOf(ordered),
      sequences: sequencesOf(ordered),
      populations: {
        initial: populationOf(ordered, (report) => report.populations.initial),
        revisedObjective: populationOf(ordered, (report) => report.populations.revisedObjective),
        corrective: correctiveScheduled ? populationOf(ordered, (report) => report.populations.corrective) : null,
        bothStep: populationOf(ordered, (report) => report.populations.bothStep),
      },
      usage: usageOf(ordered),
      statistics: { percentilesReported: ['min', 'median', 'max'], note: statisticsNote(ordered.length) },
      attributionNote: ATTRIBUTION_NOTE,
      anomalies,
      warnings,
    },
  }
}

// ---------------------------------------------------------------------------
// Formatting. The same facts as the JSON; no Answer text, reviewer prose or
// key material can appear because none reaches this module.

function spreadLine(spread: LiveSummarySpread): string {
  const missing = spread.missing === 0 ? '' : `, ${spread.missing} qualifying attempt(s) without an observation`
  if (spread.stats === null) return `no observations (n=0 of ${spread.passes} passes${missing})`
  const { minMs, medianMs, maxMs } = spread.stats
  return `n=${spread.observed} of ${spread.passes} passes${missing}: min ${minMs} ms | median ${medianMs} ms | max ${maxMs} ms`
}

function countsLine(counts: Readonly<Record<string, number>>): string {
  const entries = Object.entries(counts)
  return entries.length === 0 ? 'none' : entries.map(([name, count]) => `${name} ${count}`).join(', ')
}

function rateText(rate: number | null): string {
  return rate === null ? 'n/a' : `${Math.round(rate * 100)}%`
}

function populationLine(population: LiveSummaryPopulation): string {
  const perPass = population.perPass.map((pass) => `${pass.setId} ${pass.verifiedSuccess}/${pass.scheduled}`).join(' · ')
  return (
    `| ${population.label} | ${population.verifiedSuccess}/${population.scheduled} (${rateText(population.rate)}) | ${perPass} | ` +
    `${population.attempted} | ${population.answered} | ${population.notReached} | ${population.unaccounted} | ` +
    `${population.acceptanceUnconfirmed} | ${population.reviewed} | ${population.pending} | ${population.timedSuccess} |`
  )
}

/** The compact Markdown projection — the file that lives beside the per-set reports. */
export function formatLiveSummary(summary: LiveSummary): string {
  const lines: string[] = []
  const { provenance } = summary
  lines.push(`# Live-web baseline summary — ${provenance.study} (${summary.passes} passes)`)
  lines.push('')
  lines.push(
    `Generated ${provenance.generatedAt} over ${summary.passes} passes, ordered by capture-set creation: ${provenance.passes.map((pass) => pass.setId).join(', ')}.`,
  )
  lines.push('')
  lines.push('## Provenance')
  lines.push('')
  lines.push('Shared by every input, and checked before anything was counted:')
  lines.push('')
  lines.push(`- key ${provenance.keyVersion}, manifest ${provenance.keyManifestDigest.slice(0, 15)}…`)
  lines.push(provenance.allowedDifference?.field === 'routing' ? allowedDifferenceLine(provenance.allowedDifference) : `- routing: ${provenance.roles.join('; ')}`)
  lines.push(`- reviewer(s): ${provenance.reviewers.join('; ')}`)
  lines.push(`- study ${provenance.study}, protocol ${provenance.protocolVersion}, mode ${provenance.mode}, prompt version(s) ${provenance.promptVersions.join(', ')}`)
  lines.push(
    `- reasoning override: ${provenance.reasoningEffortOverride ?? 'none'} | decision seams: ${provenance.decisionSeams ?? 'none'} | effort overrides: ${provenance.effortOverrides.length === 0 ? 'none' : provenance.effortOverrides.join(', ')} | adblock: ${provenance.adblock} | browser sub-spans: ${provenance.browserSubspans ? 'on' : 'off'}`,
  )
  lines.push('')
  lines.push('Per input, listed and never compared:')
  lines.push('')
  lines.push('| pass | report | created | set state | commit(s) | dirty tree | grades revision |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- |')
  for (const pass of provenance.passes) {
    lines.push(
      `| ${pass.setId} | ${pass.reportPath} | ${pass.createdAt} | ${pass.state} | ${pass.commits.map((commit) => commit.slice(0, 8)).join(', ')} | ${pass.dirtyTree ? 'yes' : 'no'} | ${pass.gradesRevision} |`,
    )
  }
  lines.push('')
  lines.push('## Populations')
  lines.push('')
  lines.push('Verified over scheduled, summed across passes, with each pass beside the sum. Verified success is the independent review, never the Run’s own claim.')
  lines.push('')
  lines.push('| population | verified / scheduled | per pass | attempted | answered | not reached | unaccounted | acceptance unconfirmed | reviewed | pending | timed |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  const populations = [summary.populations.initial, summary.populations.revisedObjective, summary.populations.corrective, summary.populations.bothStep]
  for (const population of populations) {
    if (population === null) continue
    if (population.scheduled > 0 || population.label === 'initial') lines.push(populationLine(population))
  }
  lines.push('')
  lines.push('## Tasks')
  lines.push('')
  lines.push('One section per task (hunt × step), one row per pass. A Task Completion Time belongs to a verified Answer only; an unverified Answer keeps its latency as a measurement.')
  for (const task of summary.tasks) {
    lines.push('')
    lines.push(`### ${task.huntId} / ${task.stepId} (${task.relation}, prompt ${task.promptVersion})`)
    lines.push('')
    lines.push('| pass | slot | disposition | grade | cause | answer latency | task completion | run duration | flags |')
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |')
    for (const row of task.rows) {
      lines.push(
        `| ${row.setId} | ${row.attemptId} | ${row.disposition} | ${row.grade} | ${row.finalizationCause ?? '—'} | ` +
          `${ms(row.observedAnswerLatencyMs)} | ${ms(row.successfulTaskCompletionTimeMs)} | ${ms(row.runDurationMs)} | ` +
          `${row.flags.length === 0 ? '—' : row.flags.join(' ')} |`,
      )
    }
    lines.push('')
    lines.push(`- attempts ${task.attempts}, answered ${task.answered}, verified ${task.verified} over ${summary.passes} passes`)
    lines.push(`- Task Completion Time (verified): ${spreadLine(task.taskCompletionTimeMs)}`)
    lines.push(`- Answer latency (unverified): ${spreadLine(task.unverifiedAnswerLatencyMs)}`)
    lines.push(`- full Run duration: ${spreadLine(task.runDurationMs)}`)
    lines.push(`- finalization causes: ${countsLine(task.finalizationCauses)}`)
    lines.push(`- flags: ${countsLine(task.flags)}`)
  }
  if (summary.sequences.length > 0) {
    lines.push('')
    lines.push('## Both-step sequences')
    lines.push('')
    lines.push('Per hunt with a follow-up: initial acceptance to the follow-up’s Answer, over the pairs both steps of which verified.')
    for (const sequence of summary.sequences) {
      lines.push('')
      lines.push(`### ${sequence.huntId}`)
      lines.push('')
      lines.push('| pass | initial | follow-up | both verified | sequence elapsed |')
      lines.push('| --- | --- | --- | --- | --- |')
      for (const row of sequence.rows) {
        lines.push(
          `| ${row.setId} | ${row.initialAttemptId} ${row.initialVerified ? 'pass' : 'not verified'} | ` +
            `${row.followUpAttemptId} ${row.followUpVerified ? 'pass' : 'not verified'} | ${row.bothVerified ? 'yes' : 'no'} | ${ms(row.sequenceElapsedMs)} |`,
        )
      }
      lines.push('')
      lines.push(`- both-step sequence elapsed: ${spreadLine(sequence.sequenceElapsedMs)}`)
    }
  }
  lines.push('')
  lines.push('## Statistics')
  lines.push('')
  lines.push(summary.statistics.note)
  lines.push('')
  lines.push(summary.attributionNote)
  lines.push('')
  lines.push('## Usage')
  lines.push('')
  lines.push('Summed across passes per role. A role incomplete in any pass is incomplete here.')
  lines.push('')
  lines.push('| role | attempts observed | unavailable | n/a | prompt | completion | rounds | with usage | complete | models |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const summaryOfRole of summary.usage.byRole) {
    lines.push(
      `| ${summaryOfRole.role} | ${summaryOfRole.attemptsObserved} | ${summaryOfRole.attemptsUnavailable} | ${summaryOfRole.attemptsNotApplicable} | ` +
        `${summaryOfRole.promptTokens} | ${summaryOfRole.completionTokens} | ${summaryOfRole.rounds} | ${summaryOfRole.roundsWithUsage} | ` +
        `${summaryOfRole.complete ? 'yes' : `no (${summaryOfRole.incompleteIn.join(', ')})`} | ${summaryOfRole.models.join(', ') || '—'} |`,
    )
  }
  lines.push('')
  for (const limit of summary.usage.limits) lines.push(`- ${limit}`)
  if (summary.anomalies.length > 0) {
    lines.push('')
    lines.push('## Protocol anomalies')
    lines.push('')
    lines.push('Carried from every input with its set id; retained, never counted as authorized work.')
    lines.push('')
    for (const anomaly of summary.anomalies) lines.push(`- ${anomaly.setId}: ${anomaly.message}`)
  }
  if (summary.warnings.length > 0) {
    lines.push('')
    lines.push('## Data quality')
    lines.push('')
    lines.push('Carried from every input with its set id.')
    lines.push('')
    for (const warning of summary.warnings) lines.push(`- ${warning.setId}: ${warning.message}`)
  }
  lines.push('')
  return lines.join('\n')
}
