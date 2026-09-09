// The grading records (#226, slice 3 of #223): a reviewer's manual
// judgment of one retained capture against a private source key, bound to
// the exact Answer that was observed. Two things live here and nothing
// else — the binding, and the completeness of the record.
//
// What this module deliberately cannot do is decide whether a hunt
// succeeded. Task Success is an independent verification (#223): a human
// reads the Answer against the key and says so. Code checks that the
// reviewer judged every required check exactly once, cited something for
// the claims, named themselves, and graded the Answer the capture
// actually recorded rather than one that has since been edited. It never
// checks that the reviewer was right, and it never derives a pass from
// anything the app said about itself — a `done` outcome, a `completed`
// Run Resolution, an accepted Evidence Checkpoint or a successful tool
// call are all self-declarations, and initialization yields `pending`
// over every one of them.
//
// The substantive key — the conclusions, passages and near misses —
// stays in the evaluator's private directory. What reaches a grades file
// is its version, its digest, and the ids of the checks it requires, so
// the record can prove which key was applied without carrying the key.
//
// Relative imports carry `.ts` (the Node type-stripping pattern the
// scripts run under); src imports are type-only.

import { digestOf, type Validation } from './artifacts.ts'
import type { LiveAttemptCapture, LiveAttemptRecord, LiveCaptureSet, LiveSessionCapture } from './types.ts'

/** The `kind` discriminator a key-manifest file carries. */
export const LIVE_KEY_MANIFEST_KIND = 'bingbong.live.key-manifest'
/** The `kind` discriminator a grades file carries. */
export const LIVE_GRADES_KIND = 'bingbong.live.grades'
/** The one schema version for both; a reader that meets another refuses it. */
export const LIVE_GRADING_SCHEMA_VERSION = 1

/**
 * How a reviewed attempt was classified. The four reviewed states are
 * kept apart because #223 needs them apart: a useful partial and a run
 * that hit an access wall are different findings, and neither is a
 * failure to answer. `pending` is the un-reviewed state every entry
 * starts in — never a verdict, and never counted as one.
 *
 * A slot that was never dispatched has no reviewed state at all: it stays
 * `pending` and the report carries its execution disposition instead.
 * Not-reached is a fact about the protocol, not a judgment about an
 * Answer, and grading it either way would be inventing a review.
 */
export type LiveGradeStatus = 'pending' | 'pass' | 'useful_partial' | 'help_access_blocked' | 'unsuccessful'

export const LIVE_GRADE_STATUSES = [
  'pending',
  'pass',
  'useful_partial',
  'help_access_blocked',
  'unsuccessful',
] as const satisfies readonly LiveGradeStatus[]

/** The reviewed states — everything but `pending`. */
const REVIEWED_STATUSES: readonly LiveGradeStatus[] = LIVE_GRADE_STATUSES.filter((status) => status !== 'pending')

/** One thing the key requires of an Answer, by id. The description is the evaluator's own wording. */
export interface LiveKeyCheck {
  readonly checkId: string
  readonly description: string
}

/** What the key requires of one hunt step. */
export interface LiveKeyTask {
  readonly huntId: string
  readonly stepId: string
  /** The prompt version the key was prepared against. */
  readonly promptVersion: string
  /** Where the substantive key lives, for the reviewer — never its content. */
  readonly keyRef: string
  readonly checks: readonly LiveKeyCheck[]
  /**
   * The sources the evaluator verified the key against. Advisory only: an
   * Answer citing something else is not thereby wrong, and one citing
   * these is not thereby supported (#223's equivalent-sources rule).
   */
  readonly referenceSources?: readonly string[]
}

/**
 * The public face of a private key: which key, at which version, and what
 * it requires. The conclusions and passages stay in the evaluator's own
 * document; `keyDigest` is what ties this manifest to it.
 */
export interface LiveKeyManifest {
  readonly kind: typeof LIVE_KEY_MANIFEST_KIND
  readonly schemaVersion: typeof LIVE_GRADING_SCHEMA_VERSION
  readonly keyVersion: string
  /** `sha256:<hex>` of the substantive key document this manifest describes. */
  readonly keyDigest: string
  readonly preparedAt: string
  readonly tasks: readonly LiveKeyTask[]
}

/** One required check as the reviewer judged it. */
export interface LiveCheckJudgment {
  readonly checkId: string
  readonly satisfied: boolean
  /** The reviewer's short note; kept local, never exported into a report. */
  readonly note?: string
}

/**
 * What the reviewer read to accept one claim. `equivalentTo` names the
 * key's own reference source when the Answer reached the same fact by
 * another route — the record of an accepted equivalent, which #223
 * requires and no URL comparison can decide.
 */
export interface LiveClaimSupport {
  readonly claim: string
  readonly sourceUrl: string
  /** How to find the passage again: a heading, an anchor, a key's source id. */
  readonly passageRef: string
  readonly equivalentTo?: string
}

/**
 * A documented recheck of a key whose live facts may have moved (#223).
 * The rule it encodes: a changed source triggers a recheck, never a
 * penalty against a newly correct Answer and never a key quietly rewritten
 * to agree with what the model happened to say.
 */
export interface LiveSourceRecheck {
  readonly priorKeyVersion: string
  readonly newKeyVersion: string
  readonly recheckedAt: string
  readonly evidence: string
  /**
   * `unchanged` — the sources still say what the key says, so the older
   * review stands. `revised` — they do not, so the review was made against
   * a key that no longer holds and has to be redone. `unresolved` — the
   * recheck could not settle it, which is preserved rather than rounded
   * to either, and never counts as verified success.
   */
  readonly conclusion: 'unchanged' | 'revised' | 'unresolved'
}

/**
 * Which Answer a grade is about: the publication stamp and a digest of the
 * exact text. The digest, not the text — a grades file is exportable and
 * an Answer is raw capture material. It exists so a review cannot drift
 * onto a different Answer than the one that was read.
 */
export interface LiveAnswerBinding {
  readonly at: number
  readonly digest: string
}

/** One reviewer's judgment of one scheduled slot. */
export interface LiveGradeEntry {
  readonly attemptId: string
  readonly huntId: string
  readonly stepId: string
  /** The Session capture holding the attempt; null when no attempt was dispatched. */
  readonly captureId: string | null
  /** Null when the Run published no final Answer, or nothing was dispatched. */
  readonly answer: LiveAnswerBinding | null
  /** The key version the reviewer applied — may lag the manifest only behind a recheck. */
  readonly keyVersion: string
  readonly keyDigest: string
  readonly status: LiveGradeStatus
  readonly checks: readonly LiveCheckJudgment[]
  readonly support: readonly LiveClaimSupport[]
  readonly rationale: string
  readonly reviewer: string
  readonly reviewedAt: string | null
  readonly recheck?: LiveSourceRecheck
}

/** A reviewed capture set: one entry per scheduled slot, bound to one key manifest. */
export interface LiveGrades {
  readonly kind: typeof LIVE_GRADES_KIND
  readonly schemaVersion: typeof LIVE_GRADING_SCHEMA_VERSION
  readonly setId: string
  readonly keyVersion: string
  readonly keyManifestDigest: string
  /** Bumped by the reviewer when a recheck changes a verdict; provenance, not a lock. */
  readonly revision: number
  readonly entries: readonly LiveGradeEntry[]
}

/** The immutable evidence a grading operation reads. */
export interface LiveGradingInputs {
  readonly set: LiveCaptureSet
  readonly sessions: readonly LiveSessionCapture[]
  readonly manifest: LiveKeyManifest
}

/**
 * A stable digest of what a manifest requires. Canonical by construction
 * rather than by key order: two manifests that ask the same questions of
 * the same steps under the same key digest agree here, whatever order
 * their JSON happened to be written in.
 */
export function keyManifestDigest(manifest: LiveKeyManifest): string {
  const tasks = [...manifest.tasks]
    .map((task) => `${task.huntId}/${task.stepId}@${task.promptVersion}:${[...task.checks.map((check) => check.checkId)].sort().join(',')}`)
    .sort()
  return digestOf(`${manifest.keyVersion} ${manifest.keyDigest} ${tasks.join(' ')}`)
}

/** Which Answer a dispatched attempt recorded, or null when it published none. */
export function answerBindingOf(attempt: LiveAttemptCapture): LiveAnswerBinding | null {
  const answer = attempt.finalAnswer
  if (answer.status !== 'observed') return null
  return { at: answer.value.at, digest: digestOf(answer.value.text) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isString = (value: unknown): value is string => typeof value === 'string'
const isNonEmpty = (value: unknown): value is string => isString(value) && value.trim() !== ''

/** Ids repeated in a list, in first-seen order — the shape every duplicate check reports. */
export function duplicateIds(ids: readonly string[]): string[] {
  const seen = new Set<string>()
  const repeated = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) repeated.add(id)
    seen.add(id)
  }
  return [...repeated]
}

function parseKeyCheck(value: unknown, where: string, errors: string[]): LiveKeyCheck | null {
  if (!isRecord(value) || !isNonEmpty(value.checkId) || !isNonEmpty(value.description)) {
    errors.push(`${where}: a check needs a checkId and a description`)
    return null
  }
  return { checkId: value.checkId, description: value.description }
}

function parseKeyTask(value: unknown, index: number, errors: string[]): LiveKeyTask | null {
  if (!isRecord(value)) {
    errors.push(`task ${index} is not an object`)
    return null
  }
  const { huntId, stepId, promptVersion, keyRef, checks, referenceSources } = value
  if (!isNonEmpty(huntId) || !isNonEmpty(stepId) || !isNonEmpty(promptVersion) || !isNonEmpty(keyRef)) {
    errors.push(`task ${index} needs huntId, stepId, promptVersion and keyRef`)
    return null
  }
  const where = `${huntId}/${stepId}`
  if (!Array.isArray(checks) || checks.length === 0) {
    // A key that requires nothing can never be failed, so a review against
    // it would be a formality. Refuse it at the door.
    errors.push(`${where}: a key task requires at least one check`)
    return null
  }
  const parsed = checks.map((check) => parseKeyCheck(check, where, errors)).filter((check): check is LiveKeyCheck => check !== null)
  const repeated = duplicateIds(parsed.map((check) => check.checkId))
  if (repeated.length > 0) errors.push(`${where}: check id(s) ${repeated.join(', ')} appear more than once`)
  if (referenceSources !== undefined && (!Array.isArray(referenceSources) || !referenceSources.every(isString))) {
    errors.push(`${where}: referenceSources must be a list of strings`)
    return null
  }
  return {
    huntId,
    stepId,
    promptVersion,
    keyRef,
    checks: parsed,
    ...(referenceSources === undefined ? {} : { referenceSources: referenceSources as readonly string[] }),
  }
}

/** Validate a parsed key-manifest object. Evaluator-only input; never read by a capture. */
export function parseLiveKeyManifest(raw: unknown): Validation<LiveKeyManifest> {
  const errors: string[] = []
  if (!isRecord(raw)) return { ok: false, errors: ['the key manifest is not an object'] }
  if (raw.kind !== LIVE_KEY_MANIFEST_KIND) errors.push(`kind is "${String(raw.kind)}", not ${LIVE_KEY_MANIFEST_KIND}`)
  if (raw.schemaVersion !== LIVE_GRADING_SCHEMA_VERSION) {
    errors.push(`schemaVersion is ${String(raw.schemaVersion)}, not ${LIVE_GRADING_SCHEMA_VERSION}`)
  }
  if (!isNonEmpty(raw.keyVersion)) errors.push('keyVersion is missing')
  if (!isNonEmpty(raw.keyDigest)) errors.push('keyDigest is missing')
  if (!isNonEmpty(raw.preparedAt)) errors.push('preparedAt is missing')
  if (!Array.isArray(raw.tasks) || raw.tasks.length === 0) {
    errors.push('the key manifest declares no tasks')
    return { ok: false, errors }
  }
  const tasks = raw.tasks.map((task, index) => parseKeyTask(task, index, errors)).filter((task): task is LiveKeyTask => task !== null)
  const repeated = duplicateIds(tasks.map((task) => `${task.huntId}/${task.stepId}`))
  if (repeated.length > 0) errors.push(`the key manifest declares ${repeated.join(', ')} more than once`)
  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    value: {
      kind: LIVE_KEY_MANIFEST_KIND,
      schemaVersion: LIVE_GRADING_SCHEMA_VERSION,
      keyVersion: raw.keyVersion as string,
      keyDigest: raw.keyDigest as string,
      preparedAt: raw.preparedAt as string,
      tasks,
    },
  }
}

/** Where a scheduled slot's dispatched attempt was found, if anywhere. */
export interface LiveDispatchedAttempt {
  readonly captureId: string
  readonly record: LiveAttemptRecord
}

/**
 * Index every attempt record across a set's sessions by attempt id. An id
 * that two sessions both claim is left out and reported: a slot with two
 * captures has no single Answer to grade, and picking one would be a guess.
 */
export function indexAttempts(sessions: readonly LiveSessionCapture[]): {
  readonly byAttemptId: ReadonlyMap<string, LiveDispatchedAttempt>
  readonly duplicated: readonly string[]
} {
  const byAttemptId = new Map<string, LiveDispatchedAttempt>()
  const duplicated = new Set<string>()
  for (const session of sessions) {
    for (const record of session.attempts) {
      if (byAttemptId.has(record.attemptId)) {
        duplicated.add(record.attemptId)
        continue
      }
      byAttemptId.set(record.attemptId, { captureId: session.captureId, record })
    }
  }
  for (const id of duplicated) byAttemptId.delete(id)
  return { byAttemptId, duplicated: [...duplicated] }
}

/**
 * Open a review: one `pending` entry per scheduled slot, including the
 * slots nothing was dispatched into. No entry can start anywhere but
 * pending — that is the whole point of the function, and the reason
 * grading is a separate operation from capturing.
 */
export function initializeLiveGrades(inputs: LiveGradingInputs): LiveGrades {
  const { byAttemptId } = indexAttempts(inputs.sessions)
  const entries = inputs.set.slots.map((slot): LiveGradeEntry => {
    const dispatched = byAttemptId.get(slot.attemptId)
    const attempt = dispatched?.record.kind === 'attempt' ? dispatched.record : null
    return {
      attemptId: slot.attemptId,
      huntId: slot.huntId,
      stepId: slot.stepId,
      captureId: attempt === null ? null : dispatched!.captureId,
      answer: attempt === null ? null : answerBindingOf(attempt),
      keyVersion: inputs.manifest.keyVersion,
      keyDigest: inputs.manifest.keyDigest,
      status: 'pending',
      checks: [],
      support: [],
      rationale: '',
      reviewer: '',
      reviewedAt: null,
    }
  })
  return {
    kind: LIVE_GRADES_KIND,
    schemaVersion: LIVE_GRADING_SCHEMA_VERSION,
    setId: inputs.set.setId,
    keyVersion: inputs.manifest.keyVersion,
    keyManifestDigest: keyManifestDigest(inputs.manifest),
    revision: 1,
    entries,
  }
}

function parseJudgment(value: unknown, where: string, errors: string[]): LiveCheckJudgment | null {
  if (!isRecord(value) || !isNonEmpty(value.checkId) || typeof value.satisfied !== 'boolean') {
    errors.push(`${where}: a check judgment needs a checkId and a boolean satisfied`)
    return null
  }
  return {
    checkId: value.checkId,
    satisfied: value.satisfied,
    ...(isString(value.note) ? { note: value.note } : {}),
  }
}

function parseSupport(value: unknown, where: string, errors: string[]): LiveClaimSupport | null {
  if (!isRecord(value) || !isNonEmpty(value.claim) || !isNonEmpty(value.sourceUrl) || !isNonEmpty(value.passageRef)) {
    errors.push(`${where}: a claim support needs claim, sourceUrl and passageRef`)
    return null
  }
  return {
    claim: value.claim,
    sourceUrl: value.sourceUrl,
    passageRef: value.passageRef,
    ...(isNonEmpty(value.equivalentTo) ? { equivalentTo: value.equivalentTo } : {}),
  }
}

function parseRecheck(value: unknown, where: string, errors: string[]): LiveSourceRecheck | null {
  if (!isRecord(value)) {
    errors.push(`${where}: recheck is not an object`)
    return null
  }
  const { priorKeyVersion, newKeyVersion, recheckedAt, evidence, conclusion } = value
  if (!isNonEmpty(priorKeyVersion) || !isNonEmpty(newKeyVersion) || !isNonEmpty(recheckedAt) || !isNonEmpty(evidence)) {
    errors.push(`${where}: a recheck needs priorKeyVersion, newKeyVersion, recheckedAt and evidence`)
    return null
  }
  if (conclusion !== 'unchanged' && conclusion !== 'revised' && conclusion !== 'unresolved') {
    errors.push(`${where}: recheck conclusion is "${String(conclusion)}", not unchanged, revised or unresolved`)
    return null
  }
  return { priorKeyVersion, newKeyVersion, recheckedAt, evidence, conclusion }
}

/** The key binding rules — the one place a stale review is judged. */
function checkKeyBinding(entry: LiveGradeEntry, manifest: LiveKeyManifest, where: string, errors: string[]): void {
  if (entry.keyVersion === manifest.keyVersion) {
    if (entry.keyDigest !== manifest.keyDigest) {
      errors.push(`${where}: graded under key ${entry.keyVersion} with a different digest than the manifest's`)
    }
    return
  }
  const recheck = entry.recheck
  if (recheck === undefined) {
    errors.push(
      `${where}: graded under key ${entry.keyVersion}, which the manifest has moved past (${manifest.keyVersion}) — ` +
        'document a source recheck or re-review',
    )
    return
  }
  if (recheck.priorKeyVersion !== entry.keyVersion || recheck.newKeyVersion !== manifest.keyVersion) {
    errors.push(
      `${where}: the recheck moves ${recheck.priorKeyVersion} to ${recheck.newKeyVersion}, ` +
        `but the grade is bound to ${entry.keyVersion} and the manifest to ${manifest.keyVersion}`,
    )
    return
  }
  if (recheck.conclusion === 'revised') {
    // The sources moved under the review. Letting it stand would be exactly
    // the rewrite #223 forbids — the answer is another review, not a note.
    errors.push(`${where}: the recheck found key ${recheck.priorKeyVersion} revised, so the grade needs re-review under ${manifest.keyVersion}`)
  }
}

/** The completeness rules for one reviewed entry. Never a judgment of the reviewer's judgment. */
function checkReviewShape(
  entry: LiveGradeEntry,
  task: LiveKeyTask | undefined,
  dispatched: LiveDispatchedAttempt | undefined,
  where: string,
  errors: string[],
): void {
  if (entry.status === 'pending') {
    if (entry.checks.length > 0 || entry.support.length > 0 || entry.reviewedAt !== null || entry.reviewer !== '') {
      errors.push(`${where}: a pending entry carries review material — grade it or clear it, but do not leave it half-reviewed`)
    }
    return
  }
  if (!isNonEmpty(entry.reviewer) || entry.reviewedAt === null) {
    errors.push(`${where}: a reviewed entry names no reviewer provenance (reviewer and reviewedAt)`)
  }
  if (!isNonEmpty(entry.rationale)) errors.push(`${where}: a reviewed entry records no rationale`)

  if (task === undefined) {
    errors.push(`${where}: the key manifest declares no task for this hunt step, so its required checks are unknown`)
  } else {
    const required = new Set(task.checks.map((check) => check.checkId))
    const judged = entry.checks.map((judgment) => judgment.checkId)
    const repeated = duplicateIds(judged)
    if (repeated.length > 0) errors.push(`${where}: check(s) ${repeated.join(', ')} judged more than once`)
    const unknown = judged.filter((id) => !required.has(id))
    if (unknown.length > 0) errors.push(`${where}: judged check(s) ${unknown.join(', ')} the key does not require`)
    const unjudged = [...required].filter((id) => !judged.includes(id))
    if (unjudged.length > 0) errors.push(`${where}: required check(s) ${unjudged.join(', ')} left unjudged`)
  }

  if (entry.status !== 'pass') return

  // A pass is the one status with structural preconditions, because it is
  // the one that earns a Task Completion Time.
  const unsatisfied = entry.checks.filter((judgment) => !judgment.satisfied).map((judgment) => judgment.checkId)
  if (unsatisfied.length > 0) errors.push(`${where}: graded pass with required check(s) ${unsatisfied.join(', ')} unsatisfied`)
  if (entry.support.length === 0) errors.push(`${where}: graded pass with no claim support recorded`)
  const attempt = dispatched?.record.kind === 'attempt' ? dispatched.record : null
  if (attempt === null) {
    errors.push(`${where}: graded pass with no dispatched attempt to have answered`)
    return
  }
  const binding = answerBindingOf(attempt)
  if (binding === null) {
    errors.push(`${where}: graded pass but the capture records no final Answer`)
    return
  }
  if (entry.answer === null || entry.answer.digest !== binding.digest || entry.answer.at !== binding.at) {
    errors.push(`${where}: the graded Answer is not the Answer the capture recorded`)
  }
}

function parseEntry(value: unknown, index: number, errors: string[]): LiveGradeEntry | null {
  if (!isRecord(value)) {
    errors.push(`entry ${index} is not an object`)
    return null
  }
  const { attemptId, huntId, stepId, captureId, answer, keyVersion, keyDigest, status, rationale, reviewer, reviewedAt } = value
  if (!isNonEmpty(attemptId) || !isNonEmpty(huntId) || !isNonEmpty(stepId)) {
    errors.push(`entry ${index} needs attemptId, huntId and stepId`)
    return null
  }
  const where = `grade for ${attemptId}`
  if (!LIVE_GRADE_STATUSES.includes(status as LiveGradeStatus)) {
    errors.push(`${where}: status is "${String(status)}", not one of ${LIVE_GRADE_STATUSES.join(', ')}`)
    return null
  }
  if (!isNonEmpty(keyVersion) || !isNonEmpty(keyDigest)) {
    errors.push(`${where}: names no key version and digest`)
    return null
  }
  if (captureId !== null && !isNonEmpty(captureId)) {
    errors.push(`${where}: captureId must be a capture id or null`)
    return null
  }
  let binding: LiveAnswerBinding | null = null
  if (answer !== null && answer !== undefined) {
    if (!isRecord(answer) || typeof answer.at !== 'number' || !Number.isFinite(answer.at) || !isNonEmpty(answer.digest)) {
      errors.push(`${where}: the Answer binding needs a finite at and a digest`)
      return null
    }
    binding = { at: answer.at, digest: answer.digest }
  }
  const checks = Array.isArray(value.checks)
    ? value.checks.map((check) => parseJudgment(check, where, errors)).filter((check): check is LiveCheckJudgment => check !== null)
    : []
  if (!Array.isArray(value.checks)) errors.push(`${where}: checks must be a list`)
  const support = Array.isArray(value.support)
    ? value.support.map((item) => parseSupport(item, where, errors)).filter((item): item is LiveClaimSupport => item !== null)
    : []
  if (!Array.isArray(value.support)) errors.push(`${where}: support must be a list`)
  const recheck = value.recheck === undefined ? undefined : parseRecheck(value.recheck, where, errors)
  return {
    attemptId,
    huntId,
    stepId,
    captureId: captureId === null ? null : (captureId as string),
    answer: binding,
    keyVersion,
    keyDigest,
    status: status as LiveGradeStatus,
    checks,
    support,
    rationale: isString(rationale) ? rationale : '',
    reviewer: isString(reviewer) ? reviewer : '',
    reviewedAt: isString(reviewedAt) ? reviewedAt : null,
    ...(recheck === undefined || recheck === null ? {} : { recheck }),
  }
}

/**
 * Validate a parsed grades object against the capture set and key it
 * claims to be about. Every error names the slot it belongs to and
 * carries no reviewer prose, Answer text or key content — a parse failure
 * is printed by a CLI and must stay safe to read aloud.
 */
export function parseLiveGrades(raw: unknown, inputs: LiveGradingInputs): Validation<LiveGrades> {
  const errors: string[] = []
  if (!isRecord(raw)) return { ok: false, errors: ['the grades file is not an object'] }
  if (raw.kind !== LIVE_GRADES_KIND) errors.push(`kind is "${String(raw.kind)}", not ${LIVE_GRADES_KIND}`)
  if (raw.schemaVersion !== LIVE_GRADING_SCHEMA_VERSION) {
    errors.push(`schemaVersion is ${String(raw.schemaVersion)}, not ${LIVE_GRADING_SCHEMA_VERSION}`)
  }
  if (raw.setId !== inputs.set.setId) {
    errors.push(`the grades name capture set "${String(raw.setId)}", the capture names "${inputs.set.setId}"`)
  }
  if (raw.keyVersion !== inputs.manifest.keyVersion) {
    errors.push(`the grades name key version "${String(raw.keyVersion)}", the manifest names "${inputs.manifest.keyVersion}"`)
  }
  const expectedDigest = keyManifestDigest(inputs.manifest)
  if (raw.keyManifestDigest !== expectedDigest) {
    errors.push('the grades were opened against a different key manifest than the one supplied')
  }
  if (typeof raw.revision !== 'number' || !Number.isInteger(raw.revision) || raw.revision < 1) {
    errors.push(`revision is ${String(raw.revision)}, not a positive integer`)
  }
  if (!Array.isArray(raw.entries)) {
    errors.push('entries must be a list')
    return { ok: false, errors }
  }

  const entries = raw.entries
    .map((entry, index) => parseEntry(entry, index, errors))
    .filter((entry): entry is LiveGradeEntry => entry !== null)

  const slots = new Map(inputs.set.slots.map((slot) => [slot.attemptId, slot]))
  const { byAttemptId, duplicated } = indexAttempts(inputs.sessions)
  for (const id of duplicated) errors.push(`attempt ${id} is captured in more than one Session — no single Answer to grade`)

  const repeated = duplicateIds(entries.map((entry) => entry.attemptId))
  if (repeated.length > 0) errors.push(`slot(s) ${repeated.join(', ')} are graded twice`)

  const tasks = new Map(inputs.manifest.tasks.map((task) => [`${task.huntId}/${task.stepId}`, task]))
  for (const entry of entries) {
    const where = `grade for ${entry.attemptId}`
    const slot = slots.get(entry.attemptId)
    if (slot === undefined) {
      errors.push(`${where}: the capture set never scheduled ${entry.attemptId}`)
      continue
    }
    if (slot.huntId !== entry.huntId || slot.stepId !== entry.stepId) {
      errors.push(`${where}: names ${entry.huntId}/${entry.stepId}, the slot is ${slot.huntId}/${slot.stepId}`)
    }
    const dispatched = byAttemptId.get(entry.attemptId)
    const attempt = dispatched?.record.kind === 'attempt' ? dispatched.record : null
    if (attempt === null) {
      if (entry.captureId !== null) errors.push(`${where}: names a capture, but no attempt was dispatched into this slot`)
      if (entry.answer !== null) errors.push(`${where}: binds an Answer, but no attempt was dispatched into this slot`)
    } else if (entry.captureId !== dispatched!.captureId) {
      errors.push(`${where}: names capture "${String(entry.captureId)}", the attempt was captured in "${dispatched!.captureId}"`)
    }
    checkKeyBinding(entry, inputs.manifest, where, errors)
    checkReviewShape(entry, tasks.get(`${entry.huntId}/${entry.stepId}`), dispatched, where, errors)
  }

  const missing = inputs.set.slots.filter((slot) => !entries.some((entry) => entry.attemptId === slot.attemptId))
  for (const slot of missing) errors.push(`scheduled slot ${slot.attemptId} has no grade entry — initialize before reviewing`)

  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    value: {
      kind: LIVE_GRADES_KIND,
      schemaVersion: LIVE_GRADING_SCHEMA_VERSION,
      setId: inputs.set.setId,
      keyVersion: raw.keyVersion as string,
      keyManifestDigest: expectedDigest,
      revision: raw.revision as number,
      entries,
    },
  }
}

/** Whether a reviewed status is one of the four the reviewer can record. */
export function isReviewed(status: LiveGradeStatus): boolean {
  return REVIEWED_STATUSES.includes(status)
}

/**
 * Whether an entry establishes independently verified Task Success. A
 * pass whose key recheck could not be settled does not: the review stands
 * as a record, but an unresolved source question is not verification.
 */
export function isVerifiedSuccess(entry: LiveGradeEntry): boolean {
  return entry.status === 'pass' && entry.recheck?.conclusion !== 'unresolved'
}
