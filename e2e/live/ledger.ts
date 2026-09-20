// The Fix Ledger's pure half (#251): what a capture set changed against its
// Reference, read from Round Audits and nothing else. The owner's ask was
// one page for "the improvements from baseline reports"; before this, every
// fix issue was judged by opening two aggregate audits and reading both
// numbers by hand.
//
// It is a function of the audit JSON files: discovery groups them into
// families by stripping the Pass suffix (`fix-240-1..3` → `fix-240`), the
// Reference rule picks the most recent Baseline captured before the Subject,
// and each headline metric is read with the direction that is better, so a
// delta knows its colour. The whole-set value is the aggregate audit's when
// one exists (the number the Markdown prints) and summed from the Passes
// when none does; the per-attempt metrics the aggregate does not carry
// (verified attempts, checks, run durations) are always read from the
// Passes. A metric whose two sides were judged under different conditions
// carries a marker naming the axis — never a refusal (the cross-pass summary
// and the aggregate audit refuse mixed sets; a ledger row reads across them
// and says so).
//
// A family is a Baseline when its id begins with `baseline`: provenance
// carries nothing that says so, and this convention is the one assumption
// the grill added (#251, Decision 2).
//
// NOTHING HERE LOADS A KEY, reads a capture, or touches the app: it imports
// the audit's types and its `populationOf` (so a summed family counts
// exactly as the audit would), and the summary's median (so a duration here
// is the one the summary would print). `scripts/live-ledger.ts` serves it on
// loopback; nothing under `src/` reaches it.

import {
  AUDIT_VERDICTS,
  LIVE_AUDIT_AGGREGATE_KIND,
  LIVE_AUDIT_KIND,
  populationOf,
  ROUND_KINDS,
  type AuditAggregate,
  type AuditAttempt,
  type AuditPopulation,
  type AuditProvenance,
  type AuditSetOutput,
  type RoundKind,
} from './audit.ts'
import { medianOf } from './summary.ts'
import type { AttemptRelation } from './types.ts'

export interface LedgerFile {
  readonly name: string
  readonly json: unknown
  /** Why the file could not be read, when it could not; the ledger lists it as ignored. */
  readonly error?: string
}

export interface LedgerPass {
  readonly setId: string
  /** The Pass number from the id suffix; null for an id with none. */
  readonly ordinal: number | null
  /** The per-Pass audit file, or null when only the aggregate names this Pass. */
  readonly fileName: string | null
  /** The capture's `state` (`complete`, `measurement_failed`, …), or `missing` when no per-Pass audit holds it. */
  readonly state: string
  readonly audit: AuditSetOutput | null
}

/** The conditions a row's markers read (#251, Decision 7). */
export interface LedgerConditions {
  readonly reviewerPromptVersion: string
  readonly keyVersion: string
  readonly gradesReviewers: readonly string[]
  readonly roles: readonly string[]
  /** Recorded since #247; an audit written before then reads as captured with it off (docs/live-web-reporting.md). */
  readonly browserSubspans: boolean
}

export interface LedgerFamily {
  readonly id: string
  readonly baseline: boolean
  /** The earliest Pass's `createdAt`: the capture order. */
  readonly createdAt: string
  readonly passes: readonly LedgerPass[]
  readonly aggregate: { readonly fileName: string; readonly audit: AuditAggregate } | null
  /** The aggregate's shared conditions, else the first audited Pass's; null when no audit was read. */
  readonly conditions: LedgerConditions | null
  readonly notes: readonly string[]
}

export interface Ledger {
  /** In capture order. */
  readonly families: readonly LedgerFamily[]
  readonly ignored: readonly { readonly name: string; readonly reason: string }[]
}

export type MetricDirection = 'higher' | 'lower'

export interface LedgerMetric {
  readonly id: string
  readonly label: string
  readonly direction: MetricDirection
  /** Read from the reviewer's judgement: marked when the reviewer prompt differs. */
  readonly judgement: boolean
  /** What the delta and its colour follow: the share of the denominator, or the count itself. */
  readonly compare: 'value' | 'share'
  readonly unit: 'attempts' | 'checks' | 'rounds' | 'seconds'
}

/** A count and its denominator; `over` is null where the metric has none (a median), `value` where nothing was observed. */
export interface Reading {
  readonly value: number | null
  readonly over: number | null
}

export interface Delta {
  /** Subject minus Reference, on the value. */
  readonly value: number | null
  /** Subject minus Reference, in points of the share; null where either side has no denominator. */
  readonly share: number | null
  /** By the metric's direction; null when unchanged or unreadable. */
  readonly better: boolean | null
}

export interface Marker {
  readonly axis: string
  readonly reference: string
  readonly subject: string
}

export interface Markers {
  readonly every: readonly Marker[]
  readonly judgement: readonly Marker[]
}

export type CellState = 'value' | 'missing' | 'measurement_failed'

export interface LedgerCell {
  readonly state: CellState
  readonly reading: Reading | null
}

export interface HeadlineSide {
  readonly aggregate: Reading
  readonly passes: readonly LedgerCell[]
}

export interface HeadlinePopulation {
  readonly reference: HeadlineSide | null
  readonly subject: HeadlineSide
  readonly delta: Delta | null
}

export type PopulationKey = 'initial' | 'followUp'

export interface HeadlineEntry {
  readonly metric: LedgerMetric
  readonly populations: Readonly<Record<PopulationKey, HeadlinePopulation>>
  readonly markers: readonly Marker[]
}

export interface CounterEntry {
  readonly label: string
  readonly judgement: boolean
  /** Each side as a count with its per-round denominator where one exists; the delta is the raw count. */
  readonly populations: Readonly<Record<PopulationKey, { readonly reference: Reading | null; readonly subject: Reading | null; readonly delta: number | null }>>
  readonly markers: readonly Marker[]
}

export interface DrillDownEntry {
  readonly huntId: string
  readonly stepId: string
  readonly relation: AttemptRelation
  readonly metrics: Readonly<Record<string, { readonly reference: readonly LedgerCell[]; readonly subject: readonly LedgerCell[] }>>
}

export interface LedgerRow {
  readonly subject: string
  readonly reference: string | null
  readonly passes: { readonly reference: readonly string[]; readonly subject: readonly string[] }
  readonly headline: readonly HeadlineEntry[]
  readonly counters: readonly CounterEntry[]
  readonly markers: Markers
  readonly drillDown: readonly DrillDownEntry[]
}

export const HEADLINE_METRICS: readonly LedgerMetric[] = [
  { id: 'verified', label: 'Verified attempts', direction: 'higher', judgement: false, compare: 'share', unit: 'attempts' },
  { id: 'checks', label: 'Checks satisfied', direction: 'higher', judgement: false, compare: 'share', unit: 'checks' },
  { id: 'rounds_wasted_primary', label: 'rounds_wasted primary verdicts', direction: 'lower', judgement: true, compare: 'value', unit: 'attempts' },
  { id: 'answer_omitted_primary', label: 'answer_omitted primary verdicts', direction: 'lower', judgement: true, compare: 'value', unit: 'attempts' },
  { id: 'off_key', label: 'Off-key rounds', direction: 'lower', judgement: true, compare: 'share', unit: 'rounds' },
  { id: 'failed_rounds', label: 'Failed rounds', direction: 'lower', judgement: false, compare: 'share', unit: 'rounds' },
  { id: 'attempts_at_budget', label: 'Attempts at budget', direction: 'lower', judgement: false, compare: 'value', unit: 'attempts' },
  { id: 'median_run_duration', label: 'Median run duration', direction: 'lower', judgement: false, compare: 'value', unit: 'seconds' },
]

/** The relation each population reads and the label the audit gives it, as the audit builds them. */
const POPULATIONS: Readonly<Record<PopulationKey, { readonly relation: AttemptRelation; readonly label: string }>> = {
  initial: { relation: 'initial', label: 'initial' },
  followUp: { relation: 'revised_objective', label: 'follow_up' },
}
const POPULATION_KEYS: readonly PopulationKey[] = ['initial', 'followUp']

/** One value per population, keyed. */
function byPopulation<T>(of: (key: PopulationKey) => T): Record<PopulationKey, T> {
  return { initial: of('initial'), followUp: of('followUp') }
}

const KIND_LABELS: Readonly<Record<RoundKind, string>> = {
  acquisition_with_progress: 'Acquisition with Progress',
  acquisition_without_progress: 'Acquisition without Progress',
  collection: 'Collection',
  bookkeeping: 'Bookkeeping',
  failed_round: 'Failed round',
  finalization: 'Finalization',
}

// ---------------------------------------------------------------------------
// Discovery

/** `fix-240-1` → `fix-240` and 1; `fix-242r-3` → `fix-242r` and 3; an id with no numeric suffix is its own family. */
export function familyIdOf(setId: string): { family: string; ordinal: number | null } {
  const match = /^(.+)-(\d+)$/.exec(setId)
  if (match === null) return { family: setId, ordinal: null }
  return { family: match[1]!, ordinal: Number(match[2]) }
}

export function isBaselineFamily(id: string): boolean {
  return id.startsWith('baseline')
}

/** The fields a marker reads: a per-Pass provenance, an aggregate's shared block, or a family's conditions. */
type ConditionSource = Pick<AuditProvenance, 'reviewerPromptVersion' | 'keyVersion' | 'gradesReviewers' | 'roles'> & {
  readonly browserSubspans?: boolean
}

export function conditionsOf(source: ConditionSource): LedgerConditions {
  return {
    reviewerPromptVersion: source.reviewerPromptVersion,
    keyVersion: source.keyVersion,
    gradesReviewers: [...source.gradesReviewers],
    roles: [...source.roles],
    browserSubspans: source.browserSubspans === true,
  }
}

const CONDITION_AXES: readonly { readonly axis: string; readonly judgement: boolean; readonly of: (conditions: LedgerConditions) => string }[] = [
  { axis: 'reviewer prompt', judgement: true, of: (conditions) => conditions.reviewerPromptVersion },
  { axis: 'key version', judgement: false, of: (conditions) => conditions.keyVersion },
  { axis: 'grades reviewers', judgement: false, of: (conditions) => conditions.gradesReviewers.join('; ') },
  { axis: 'routing', judgement: false, of: (conditions) => conditions.roles.join('; ') },
  { axis: 'browser sub-spans', judgement: false, of: (conditions) => (conditions.browserSubspans ? 'on' : 'off') },
]

/**
 * The markers a row carries (#251, Decision 7): judgement metrics are
 * marked when the reviewer prompt differs; every metric when the key, the
 * grades reviewers, the routing or the browser sub-spans flag differs. The
 * app commit never marks — it is what a Subject is measured for.
 */
export function markersOf(reference: ConditionSource, subject: ConditionSource): Markers {
  const left = conditionsOf(reference)
  const right = conditionsOf(subject)
  const every: Marker[] = []
  const judgement: Marker[] = []
  for (const axis of CONDITION_AXES) {
    const a = axis.of(left)
    const b = axis.of(right)
    if (a === b) continue
    ;(axis.judgement ? judgement : every).push({ axis: axis.axis, reference: a, subject: b })
  }
  return { every, judgement }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface PassFile {
  readonly name: string
  readonly audit: AuditSetOutput
}

interface AggregateFile {
  readonly name: string
  readonly audit: AuditAggregate
}

/**
 * Every `audit-*.json` read into families, in capture order. A file that is
 * not a Round Audit, a second audit for a set already read, or an aggregate
 * naming sets of more than one family is listed as ignored with its reason.
 */
export function buildLedger(files: readonly LedgerFile[]): Ledger {
  const ignored: { name: string; reason: string }[] = []
  const passFiles: PassFile[] = []
  const aggregateFiles: AggregateFile[] = []
  for (const file of [...files].sort((left, right) => left.name.localeCompare(right.name))) {
    if (file.error !== undefined) {
      ignored.push({ name: file.name, reason: `unreadable: ${file.error}` })
      continue
    }
    if (!isRecord(file.json) || typeof file.json.kind !== 'string') {
      ignored.push({ name: file.name, reason: 'not a Round Audit: no kind field' })
      continue
    }
    if (file.json.kind === LIVE_AUDIT_KIND) passFiles.push({ name: file.name, audit: file.json as unknown as AuditSetOutput })
    else if (file.json.kind === LIVE_AUDIT_AGGREGATE_KIND) aggregateFiles.push({ name: file.name, audit: file.json as unknown as AuditAggregate })
    else ignored.push({ name: file.name, reason: `not a Round Audit: kind ${JSON.stringify(file.json.kind)}` })
  }

  // Per-Pass audits by set id, one file per set.
  const passBySet = new Map<string, PassFile>()
  for (const file of passFiles) {
    const setId = file.audit.provenance.setId
    const first = passBySet.get(setId)
    if (first !== undefined) {
      ignored.push({ name: file.name, reason: `capture set ${setId} is already read from ${first.name}` })
      continue
    }
    passBySet.set(setId, file)
  }

  // Aggregates by family, one per family; an aggregate names its Passes.
  const aggregateByFamily = new Map<string, AggregateFile>()
  for (const file of aggregateFiles) {
    const families = new Set(file.audit.provenance.sets.map((set) => familyIdOf(set.setId).family))
    if (families.size !== 1) {
      ignored.push({ name: file.name, reason: `an aggregate over ${families.size === 0 ? 'no sets' : `more than one family (${[...families].join(', ')})`}` })
      continue
    }
    const family = [...families][0]!
    const first = aggregateByFamily.get(family)
    if (first !== undefined) {
      ignored.push({ name: file.name, reason: `family ${family} already has an aggregate audit: ${first.name}` })
      continue
    }
    aggregateByFamily.set(family, file)
  }

  // Every set id either side names, grouped.
  const setsByFamily = new Map<string, Map<string, { file: PassFile | null; createdAt: string | null; state: string | null }>>()
  const claim = (setId: string) => {
    const family = familyIdOf(setId).family
    let sets = setsByFamily.get(family)
    if (sets === undefined) {
      sets = new Map()
      setsByFamily.set(family, sets)
    }
    let entry = sets.get(setId)
    if (entry === undefined) {
      entry = { file: null, createdAt: null, state: null }
      sets.set(setId, entry)
    }
    return entry
  }
  for (const [setId, file] of passBySet) {
    const entry = claim(setId)
    entry.file = file
    entry.createdAt = file.audit.provenance.createdAt
    entry.state = file.audit.provenance.state
  }
  for (const file of aggregateByFamily.values()) {
    for (const set of file.audit.provenance.sets) {
      const entry = claim(set.setId)
      entry.createdAt ??= set.createdAt
      entry.state ??= set.state
    }
  }

  const families: LedgerFamily[] = []
  for (const [id, sets] of setsByFamily) {
    const passes: LedgerPass[] = [...sets.entries()]
      .map(([setId, entry]) => ({
        setId,
        ordinal: familyIdOf(setId).ordinal,
        fileName: entry.file?.name ?? null,
        state: entry.file === null ? 'missing' : entry.file.audit.provenance.state,
        audit: entry.file?.audit ?? null,
      }))
      .sort((left, right) => (left.ordinal ?? -1) - (right.ordinal ?? -1) || left.setId.localeCompare(right.setId))
    const createdAts = [...sets.values()].map((entry) => entry.createdAt).filter((at): at is string => at !== null)
    const createdAt = createdAts.sort((left, right) => Date.parse(left) - Date.parse(right))[0] ?? ''
    const aggregate = aggregateByFamily.get(id) ?? null
    const notes: string[] = []
    if (aggregate === null) notes.push('no aggregate audit: the whole-set values are summed from the Passes')
    for (const pass of passes) {
      if (pass.audit === null) notes.push(`${pass.setId} has no per-Pass audit: verified attempts, checks and run durations are read from the Passes that have one`)
    }
    const audited = passes.filter((pass): pass is LedgerPass & { audit: AuditSetOutput } => pass.audit !== null)
    for (const axis of CONDITION_AXES) {
      const values = audited.map((pass) => axis.of(conditionsOf(pass.audit.provenance)))
      if (new Set(values).size > 1) notes.push(`the Passes differ on ${axis.axis}: ${audited.map((pass, index) => `${pass.setId}=${values[index]}`).join(', ')}`)
    }
    const conditions = aggregate !== null ? conditionsOf(aggregate.audit.provenance.shared) : audited.length > 0 ? conditionsOf(audited[0]!.audit.provenance) : null
    families.push({
      id,
      baseline: isBaselineFamily(id),
      createdAt,
      passes,
      aggregate: aggregate === null ? null : { fileName: aggregate.name, audit: aggregate.audit },
      conditions,
      notes,
    })
  }
  families.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id.localeCompare(right.id))
  ignored.sort((left, right) => left.name.localeCompare(right.name))
  return { families, ignored }
}

/**
 * The default Reference (#251, Decision 3): the most recent Baseline captured
 * before the Subject. A Baseline's is the Baseline before it; the first has
 * none.
 */
export function defaultReferenceOf(subject: LedgerFamily, ledger: Ledger): LedgerFamily | null {
  const index = ledger.families.findIndex((family) => family.id === subject.id)
  for (let position = index - 1; position >= 0; position -= 1) {
    const family = ledger.families[position]!
    if (family.baseline) return family
  }
  return null
}

// ---------------------------------------------------------------------------
// Readings

function round(value: number, decimals: number): number {
  const scale = 10 ** decimals
  return Math.round(value * scale) / scale
}

/** An audit judged before #244 (reviewer prompt `audit-p1`) names the unsatisfied checks `checksNotReached`; the docs keep both names. */
function checksSatisfiedOf(mechanical: AuditAttempt['mechanical']): Reading {
  const unsatisfied = mechanical.checksUnsatisfied ?? (mechanical as { readonly checksNotReached?: readonly string[] | null }).checksNotReached ?? null
  if (mechanical.checksTotal === null || unsatisfied === null) return { value: null, over: null }
  return { value: mechanical.checksTotal - unsatisfied.length, over: mechanical.checksTotal }
}

/** Checks satisfied over checks total, summed over the attempts that carry checks. */
function checksSummed(attempts: readonly AuditAttempt[]): Reading {
  const checks = attempts.map((attempt) => checksSatisfiedOf(attempt.mechanical)).filter((reading) => reading.over !== null)
  return {
    value: checks.reduce((sum, reading) => sum + (reading.value ?? 0), 0),
    over: checks.reduce((sum, reading) => sum + (reading.over ?? 0), 0),
  }
}

/** A counter an older audit did not record reads as nothing, never as zero. */
function recorded(value: number | undefined): number | null {
  return typeof value === 'number' ? value : null
}

function atBudget(mechanical: AuditAttempt['mechanical']): boolean {
  return mechanical.toolRoundBudget !== null && mechanical.toolRoundsUsed >= mechanical.toolRoundBudget
}

function observedSeconds(mechanical: AuditAttempt['mechanical']): number | null {
  return mechanical.runDurationMs.status === 'observed' ? mechanical.runDurationMs.value / 1000 : null
}

/** The headline readings of one population: the audit's population for the counters, its attempts for the rest. */
export function populationReadings(population: AuditPopulation, attempts: readonly AuditAttempt[]): Record<string, Reading> {
  const seconds = attempts.map((attempt) => observedSeconds(attempt.mechanical)).filter((value): value is number => value !== null)
  return {
    verified: { value: attempts.filter((attempt) => attempt.mechanical.grade?.status === 'pass').length, over: attempts.length },
    checks: checksSummed(attempts),
    rounds_wasted_primary: { value: recorded(population.verdictsPrimary.rounds_wasted), over: population.judged },
    answer_omitted_primary: { value: recorded(population.verdictsPrimary.answer_omitted), over: population.judged },
    off_key: { value: population.offKeyRounds, over: population.budgetedRounds },
    failed_rounds: { value: population.counts.failed_round, over: population.budgetedRounds },
    attempts_at_budget: { value: population.attemptsAtBudget, over: population.attempts },
    median_run_duration: { value: seconds.length === 0 ? null : round(medianOf([...seconds].sort((left, right) => left - right)), 1), over: null },
  }
}

/** The same metrics for one attempt: a yes/no reads as 1 or 0 of 1, an unjudged attempt's verdicts as nothing. */
export function attemptReadings(attempt: AuditAttempt): Record<string, Reading> {
  const { mechanical } = attempt
  const judgement = attempt.review?.judgement ?? null
  const flag = (value: boolean): Reading => ({ value: value ? 1 : 0, over: 1 })
  const none: Reading = { value: null, over: null }
  const seconds = observedSeconds(mechanical)
  return {
    verified: flag(mechanical.grade?.status === 'pass'),
    checks: checksSatisfiedOf(mechanical),
    rounds_wasted_primary: judgement === null ? none : flag(judgement.verdict.primary === 'rounds_wasted'),
    answer_omitted_primary: judgement === null ? none : flag(judgement.verdict.primary === 'answer_omitted'),
    off_key: { value: judgement === null ? null : judgement.offKey.length, over: mechanical.budgetedRounds },
    failed_rounds: { value: mechanical.counts.failed_round, over: mechanical.budgetedRounds },
    attempts_at_budget: flag(atBudget(mechanical)),
    median_run_duration: { value: seconds === null ? null : round(seconds, 1), over: null },
  }
}

interface Counter {
  readonly label: string
  readonly judgement: boolean
  /** null where this audit predates the counter. */
  readonly value: number | null
  /** The per-round denominator where one exists (#251, Decision 5): the budgeted rounds, or every round for Finalization. */
  readonly over: number | null
}

const GRADE_COUNTERS: readonly { readonly label: string; readonly status: string }[] = [
  { label: 'Verified attempts', status: 'pass' },
  { label: 'Useful partial attempts', status: 'useful_partial' },
  { label: 'Help-blocked attempts', status: 'help_access_blocked' },
  { label: 'Unsuccessful attempts', status: 'unsuccessful' },
  { label: 'Pending attempts', status: 'pending' },
]

/** Every counter of a population, in a fixed order, for the all-counters expander (#251, Decision 4). */
export function countersOf(population: AuditPopulation, attempts: readonly AuditAttempt[]): readonly Counter[] {
  const mechanical = (label: string, value: number | undefined, over: number | null = null): Counter => ({ label, judgement: false, value: recorded(value), over })
  const judged = (label: string, value: number | undefined, over: number | null = null): Counter => ({ label, judgement: true, value: recorded(value), over })
  const checks = checksSummed(attempts)
  const budgeted = population.budgetedRounds
  const roundsOf = (kind: RoundKind): number => (kind === 'finalization' ? population.rounds : budgeted)
  // Read as written: an audit from before a counter existed has no field for it.
  const older = population as Partial<AuditPopulation>
  // #256, ADR 0057: the streaming-or-silent split reads as nothing on an
  // audit written before it, and on a population none of whose cut rounds'
  // traces could say — a fresh audit of old traces counts every cut as not
  // recorded, and "0 after a first token" would be a claim nobody made.
  const cuts = older.allowanceFinalizationRounds ?? 0
  const splitUnrecorded = older.allowanceFinalizationRoundsNotRecorded === undefined || (cuts > 0 && older.allowanceFinalizationRoundsNotRecorded === cuts)
  return [
    mechanical('Attempts', population.attempts),
    judged('Judged attempts', population.judged),
    ...GRADE_COUNTERS.map((grade) =>
      mechanical(grade.label, attempts.filter((attempt) => (attempt.mechanical.grade?.status ?? 'pending') === grade.status).length),
    ),
    mechanical('Checks satisfied', checks.value ?? undefined),
    mechanical('Checks total', checks.over ?? undefined),
    mechanical('Rounds', population.rounds),
    mechanical('Budgeted rounds', population.budgetedRounds),
    mechanical('Tool rounds used', population.toolRoundsUsed),
    mechanical('Attempts at budget', population.attemptsAtBudget),
    ...ROUND_KINDS.map((kind) => mechanical(`Rounds: ${KIND_LABELS[kind]}`, population.counts[kind], roundsOf(kind))),
    ...ROUND_KINDS.map((kind) => judged(`Rounds after overrules: ${KIND_LABELS[kind]}`, population.countsAfterOverrules[kind], roundsOf(kind))),
    ...AUDIT_VERDICTS.map((verdict) => judged(`Primary verdict: ${verdict}`, population.verdictsPrimary[verdict])),
    ...AUDIT_VERDICTS.map((verdict) => judged(`Secondary verdict: ${verdict}`, population.verdictsSecondary[verdict])),
    judged('Off-key rounds', population.offKeyRounds, budgeted),
    judged('Search Loop rounds', population.searchLoopRounds, budgeted),
    mechanical('Search Loop rounds by the streak rule', population.mechanicalSearchRounds, budgeted),
    // #259, ADR 0058: the streak by the consecutive rule, two counts beside
    // the one above; an audit written before them reads as nothing.
    mechanical('Search rounds at streak 2 or beyond', older.searchRoundsAtStreak2, budgeted),
    mechanical('Search rounds at streak 3 or beyond', older.searchRoundsAtStreak3, budgeted),
    mechanical('Attempts with search source: rail', older.searchSources?.rail),
    mechanical('Attempts with search source: replay', older.searchSources?.replay),
    mechanical('Attempts with search source: none', older.searchSources?.none),
    mechanical('Inherited rounds', population.inheritedRounds, budgeted),
    mechanical('Merged Evidence Checkpoints', older.mergedCheckpoints),
    mechanical('Bundled checkpoint rounds', older.bundledCheckpoints, budgeted),
    mechanical('Same-source unsupported rounds', older.sameSourceUnsupportedRounds, budgeted),
    mechanical('Held Page rounds without Progress', older.heldPageRoundsWithoutProgress, budgeted),
    mechanical('Rejected Evidence Checkpoints', population.rejectedCheckpoints),
    mechanical('Walled rounds', population.walledRounds, budgeted),
    mechanical('Not-found landings', older.notFoundNavigates),
    judged('Not-found landings judged Off-key', older.notFoundOffKey),
    mechanical('Rewritten Composed Addresses', older.rewrittenComposedAddresses),
    judged('Rewritten Composed Addresses judged Off-key', older.rewrittenComposedAddressesOffKey),
    mechanical('Rewritten navigates to a shown address', older.rewrittenShownAddresses),
    mechanical('Identity Slip Answers', older.identitySlipAnswers),
    mechanical('Identity Slip ids', older.identitySlipIds),
    mechanical('Attempts with Identity Slips not recorded', older.identitySlipsNotRecorded),
    mechanical('Malformed Answers', older.malformedAnswers),
    mechanical('Answer Retries', older.answerRetries),
    // #256: a population none of whose traces could record a skip reads as nothing, never as zero.
    mechanical(
      'Skipped bookkeeping rounds',
      older.skippedBookkeepingNotRecorded === undefined || older.skippedBookkeepingNotRecorded === population.attempts ? undefined : older.skippedBookkeepingRounds,
    ),
    mechanical('Finalization rounds cut by the Allowance', older.allowanceFinalizationRounds, population.rounds),
    mechanical('Finalization rounds cut after a first token', splitUnrecorded ? undefined : older.allowanceFinalizationRoundsStreaming, population.rounds),
    mechanical('Finalization rounds cut silent', splitUnrecorded ? undefined : older.allowanceFinalizationRoundsSilent, population.rounds),
    mechanical('First-token latency p50 (ms)', older.firstToken?.p50 ?? undefined),
    mechanical('First-token latency p90 (ms)', older.firstToken?.p90 ?? undefined),
    mechanical('Subagent rounds', population.subagentRounds, budgeted),
    judged('Stopped early', population.stoppedEarly),
    judged('Answer omitted', older.answerOmitted),
    judged('Overrules', population.overrules),
    judged('Flags', population.flags),
    ...Object.entries(population.finalizationCauses).map(([cause, count]) => mechanical(`Finalization cause: ${cause}`, count)),
    ...(older.toolRounds ?? []).map((tool) => mechanical(`Tool rounds: ${tool.tool}`, tool.rounds, population.toolRoundsUsed)),
  ]
}

// ---------------------------------------------------------------------------
// Rows

/** One population of one family: the whole-set population and the attempts behind it. */
interface FamilySide {
  readonly population: AuditPopulation
  readonly attempts: readonly AuditAttempt[]
}

function familySide(family: LedgerFamily, key: PopulationKey): FamilySide {
  const { relation, label } = POPULATIONS[key]
  const attempts = family.passes.flatMap((pass) => pass.audit?.attempts ?? []).filter((attempt) => attempt.mechanical.relation === relation)
  const population = family.aggregate?.audit.populations[key] ?? populationOf(label, attempts)
  return { population, attempts }
}

function passCell(pass: LedgerPass, reading: () => Reading | null): LedgerCell {
  if (pass.audit === null) return { state: 'missing', reading: null }
  if (pass.state === 'measurement_failed') return { state: 'measurement_failed', reading: null }
  const value = reading()
  return value === null ? { state: 'missing', reading: null } : { state: 'value', reading: value }
}

function passReadings(pass: LedgerPass, key: PopulationKey): Record<string, Reading> | null {
  if (pass.audit === null) return null
  const { relation } = POPULATIONS[key]
  return populationReadings(
    pass.audit.populations[key],
    pass.audit.attempts.filter((attempt) => attempt.mechanical.relation === relation),
  )
}

function headlineSide(family: LedgerFamily, key: PopulationKey, side: FamilySide): Record<string, HeadlineSide> {
  const aggregate = populationReadings(side.population, side.attempts)
  const perPass = family.passes.map((pass) => ({ pass, readings: passReadings(pass, key) }))
  return Object.fromEntries(
    HEADLINE_METRICS.map((metric) => [
      metric.id,
      {
        aggregate: aggregate[metric.id]!,
        passes: perPass.map(({ pass, readings }) => passCell(pass, () => readings?.[metric.id] ?? null)),
      },
    ]),
  )
}

function shareOf(reading: Reading): number | null {
  return reading.value === null || reading.over === null || reading.over === 0 ? null : (reading.value / reading.over) * 100
}

export function deltaOf(metric: LedgerMetric, reference: Reading, subject: Reading): Delta {
  const value = reference.value === null || subject.value === null ? null : subject.value - reference.value
  const referenceShare = shareOf(reference)
  const subjectShare = shareOf(subject)
  const share = referenceShare === null || subjectShare === null ? null : round(subjectShare - referenceShare, 1)
  const comparable = metric.compare === 'share' ? share : value
  const better = comparable === null || comparable === 0 ? null : comparable > 0 === (metric.direction === 'higher')
  return { value, share, better }
}

function attemptKeyOf(attempt: AuditAttempt): string {
  return `${attempt.mechanical.huntId} ${attempt.mechanical.stepId}`
}

function drillDownOf(subject: LedgerFamily, reference: LedgerFamily | null): DrillDownEntry[] {
  const rows = new Map<string, { huntId: string; stepId: string; relation: AttemptRelation }>()
  const families = reference === null ? [subject] : [reference, subject]
  for (const family of families) {
    for (const pass of family.passes) {
      for (const attempt of pass.audit?.attempts ?? []) {
        const key = attemptKeyOf(attempt)
        if (!rows.has(key)) rows.set(key, { huntId: attempt.mechanical.huntId, stepId: attempt.mechanical.stepId, relation: attempt.mechanical.relation })
      }
    }
  }
  const cellsOf = (family: LedgerFamily | null, key: string, metric: LedgerMetric): LedgerCell[] =>
    family === null
      ? []
      : family.passes.map((pass) =>
          passCell(pass, () => {
            const attempt = pass.audit?.attempts.find((listed) => attemptKeyOf(listed) === key)
            return attempt === undefined ? null : attemptReadings(attempt)[metric.id]!
          }),
        )
  return [...rows.entries()]
    .sort(([, left], [, right]) => left.huntId.localeCompare(right.huntId) || Number(left.relation !== 'initial') - Number(right.relation !== 'initial') || left.stepId.localeCompare(right.stepId))
    .map(([key, row]) => ({
      ...row,
      metrics: Object.fromEntries(HEADLINE_METRICS.map((metric) => [metric.id, { reference: cellsOf(reference, key, metric), subject: cellsOf(subject, key, metric) }])),
    }))
}

/**
 * One Fix Ledger row: the Subject against its Reference — the headline per
 * population with the whole-set delta beside the per-Pass values, every
 * counter with its raw delta, the markers, and the Hunt × step drill-down.
 * With no Reference the Subject's values stand alone.
 */
export function compareFamilies(subject: LedgerFamily, reference: LedgerFamily | null): LedgerRow {
  const markers: Markers = reference === null || reference.conditions === null || subject.conditions === null ? { every: [], judgement: [] } : markersOf(reference.conditions, subject.conditions)
  const markersFor = (judgement: boolean): Marker[] => [...markers.every, ...(judgement ? markers.judgement : [])]

  const subjectSides = byPopulation((key) => familySide(subject, key))
  const referenceSides = reference === null ? null : byPopulation((key) => familySide(reference, key))
  const subjectHeadline = byPopulation((key) => headlineSide(subject, key, subjectSides[key]))
  const referenceHeadline = reference === null || referenceSides === null ? null : byPopulation((key) => headlineSide(reference, key, referenceSides[key]))

  const headline: HeadlineEntry[] = HEADLINE_METRICS.map((metric) => ({
    metric,
    populations: byPopulation((key) => {
      const own = subjectHeadline[key][metric.id]!
      const other = referenceHeadline?.[key][metric.id] ?? null
      return { reference: other, subject: own, delta: other === null ? null : deltaOf(metric, other.aggregate, own.aggregate) }
    }),
    markers: markersFor(metric.judgement),
  }))

  const counters = countersRow(subjectSides, referenceSides, markersFor)

  return {
    subject: subject.id,
    reference: reference?.id ?? null,
    passes: { reference: reference?.passes.map((pass) => pass.setId) ?? [], subject: subject.passes.map((pass) => pass.setId) },
    headline,
    counters,
    markers,
    drillDown: drillDownOf(subject, reference),
  }
}

function countersRow(
  subjectSides: Record<PopulationKey, FamilySide>,
  referenceSides: Record<PopulationKey, FamilySide> | null,
  markersFor: (judgement: boolean) => Marker[],
): CounterEntry[] {
  const own = byPopulation((key) => countersOf(subjectSides[key].population, subjectSides[key].attempts))
  const other = referenceSides === null ? null : byPopulation((key) => countersOf(referenceSides[key].population, referenceSides[key].attempts))
  // Labels in first-seen order: the Subject's initial counters, then anything only another side has (a Finalization Cause or a tool one side never saw).
  const labels = new Map<string, boolean>()
  for (const key of POPULATION_KEYS) {
    for (const list of [own[key], other?.[key] ?? []]) for (const counter of list) if (!labels.has(counter.label)) labels.set(counter.label, counter.judgement)
  }
  const readingOf = (list: readonly Counter[] | null, label: string): Reading | null => {
    const counter = list?.find((listed) => listed.label === label)
    return counter === undefined ? null : { value: counter.value, over: counter.over }
  }
  return [...labels.entries()].map(([label, judgement]) => ({
    label,
    judgement,
    populations: byPopulation((key) => {
      const subject = readingOf(own[key], label)
      const reference = readingOf(other?.[key] ?? null, label)
      return { reference, subject, delta: reference?.value == null || subject?.value == null ? null : subject.value - reference.value }
    }),
    markers: markersFor(judgement),
  }))
}
