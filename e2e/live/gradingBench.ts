// The Grading Bench's pure parts (#228): what `pnpm live:review` does with
// a reviewer's judgment between the page and the grades file, with no
// server, no filesystem and no React in sight — so each rule can be tested
// as a function and the server can stay a thin door.
//
// The bench is the evaluator's workplace for producing Grades (glossary).
// Four things live here:
//
//   1. The evidence trail — what the assistant navigated, read and looked
//      at, and what it recorded as evidence, pulled from the attempt's
//      event tape. It is what separates an Answer that hit an access wall
//      from one that never tried.
//   2. The reviewer's editor state and the drafts sidecar: half-done work
//      lives beside the grades file, never in it, because `grades.ts`
//      refuses a pending entry carrying review material and a reviewed one
//      with an unjudged check.
//   3. Saving: composing an entry from the editor state and running the
//      real `parseLiveGrades` over the file it would produce. The bench
//      never picks a verdict and adds only three rules of its own — a
//      status must be chosen, a slot nothing was dispatched into stays
//      pending, and an attempt that published no Answer is `unsuccessful`
//      or `help_access_blocked`. Everything else a save can break is the
//      validator's rule, reported in the validator's words.
//   4. Whose file it is, and another reviewer's Grade — invisible until
//      this reviewer's own entry is saved, so a blank start is not anchored
//      to someone else's interpretation calls.
//
// NOTHING HERE LOADS A KEY. The server is handed the keys by the CLI
// (`scripts/live-review.ts`, one of the two scripts allowed to import them)
// and this module sees only the structural `BenchKey`, the way `grades.ts`
// sees only a manifest. Relative imports carry `.ts` (the Node
// type-stripping pattern the scripts run under); src imports that are not
// type-only carry it too.

import { parseBlockerMarker, type BlockerSignal } from '../../src/core/browser/blockerNudge.ts'
import type { PipelineEvent } from '../../src/core/pipeline/events'
import { redactedMessage, type Validation } from './artifacts.ts'
import {
  answerBindingOf,
  indexAttempts,
  isReviewed,
  parseLiveGrades,
  type LiveClaimSupport,
  type LiveDispatchedAttempt,
  type LiveGradeEntry,
  type LiveGrades,
  type LiveGradeStatus,
  type LiveGradingInputs,
  type LiveKeyManifest,
  type LiveKeyTask,
} from './grades.ts'
import type { LiveAttemptCapture, LiveScheduledAttempt } from './types.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isString = (value: unknown): value is string => typeof value === 'string'

// ---------------------------------------------------------------------------
// The evidence trail

/** The tools whose calls put a page in front of the assistant. */
const TRAIL_TOOLS = ['navigate', 'read_page', 'look'] as const
export type TrailTool = (typeof TRAIL_TOOLS)[number]

/**
 * How a step ended. `walled` is a page that loaded and turned out to be a
 * Blocker — the app's own marker line said so — which is the distinction a
 * `help_access_blocked` verdict rests on. `no_result` is a call the tape
 * never answered, usually because observation stopped first.
 */
export type TrailOutcome = 'loaded' | 'walled' | 'errored' | 'no_result'

export interface TrailStep {
  readonly callId: string
  readonly tool: TrailTool
  readonly at: number
  /** What the call asked for: navigate's url argument (a search, often), look's question. */
  readonly requested: string | null
  /** The page the step concerns: where navigate landed, what read_page read, what look looked at. */
  readonly url: string | null
  readonly title: string | null
  readonly outcome: TrailOutcome
  readonly wall: { readonly signal: BlockerSignal; readonly host: string } | null
  readonly error: string | null
  /** The whole result text, for the reviewer to expand; null when there is none. */
  readonly text: string | null
}

/** One `record_evidence` call: what the assistant claimed to have observed, and whether the app accepted it. */
export interface TrailEvidence {
  readonly callId: string
  readonly at: number
  readonly kind: string | null
  readonly observation: string | null
  readonly excerpt: string | null
  readonly sourceUrl: string | null
  /** Null when the tape holds no result for the call. */
  readonly accepted: boolean | null
  /** The tool result the app returned — the recorded id, or the rejection. */
  readonly outcome: string | null
}

export interface EvidenceTrail {
  readonly steps: readonly TrailStep[]
  readonly evidence: readonly TrailEvidence[]
  /**
   * `spawn_agent` calls the Run made. A Subagent's own browsing is not on
   * the attempt's tape, so a trail with Subagents is knowingly incomplete
   * and says so rather than looking thin.
   */
  readonly subagentsSpawned: number
}

/** The first line of a navigate result: `navigated: url=<url> title="<title>"`. */
const NAVIGATED_LINE = /^navigated: url=(\S+)(?: title="(.*)")?$/m
/** The page header every page-state result carries: `# <title> — <url>`. */
const PAGE_HEADER_LINE = /^# (.*) — (\S+)$/m

function resultText(result: unknown): string | null {
  if (result === undefined || result === null) return null
  return isString(result) ? result : JSON.stringify(result)
}

function pageOf(text: string | null): { url: string; title: string | null } | null {
  if (text === null) return null
  const navigated = NAVIGATED_LINE.exec(text)
  if (navigated !== null) return { url: navigated[1], title: navigated[2] ?? null }
  const header = PAGE_HEADER_LINE.exec(text)
  return header === null ? null : { url: header[2], title: header[1] }
}

/** A string argument of a call, tolerating a tape whose args are not an object (tapes are read back from disk). */
function argOf(args: unknown, name: string): string | null {
  if (!isRecord(args)) return null
  const value = args[name]
  return isString(value) && value !== '' ? value : null
}

type ToolCall = Extract<PipelineEvent, { type: 'tool_call' }>
type ToolResult = Extract<PipelineEvent, { type: 'tool_result' }>

function stepOf(call: ToolCall & { name: TrailTool }, result: ToolResult | undefined, currentUrl: string | null): TrailStep {
  const base = {
    callId: call.callId,
    tool: call.name,
    at: call.at,
    requested: call.name === 'navigate' ? argOf(call.args, 'url') : call.name === 'look' ? argOf(call.args, 'question') : null,
  }
  // Where the step happened when its own result cannot say: a look names no
  // URL, and a failed read was still a read of the page the Run was on. A
  // navigate that failed landed nowhere.
  const fallbackUrl = call.name === 'navigate' ? null : currentUrl
  if (result === undefined) {
    return { ...base, url: fallbackUrl, title: null, outcome: 'no_result', wall: null, error: null, text: null }
  }
  if (!result.ok) {
    return { ...base, url: fallbackUrl, title: null, outcome: 'errored', wall: null, error: result.error ?? 'the tool failed without a message', text: null }
  }
  const text = resultText(result.result)
  const page = call.name === 'look' ? null : pageOf(text)
  const wall = text === null ? null : parseBlockerMarker(text)
  return {
    ...base,
    url: page?.url ?? fallbackUrl,
    title: page?.title ?? null,
    outcome: wall === null ? 'loaded' : 'walled',
    wall,
    error: null,
    text,
  }
}

/**
 * The trail an attempt left on its event tape, in call order. Only reads
 * what the app published; nothing is inferred from the Answer.
 */
export function evidenceTrailOf(events: readonly PipelineEvent[]): EvidenceTrail {
  const results = new Map<string, ToolResult>()
  for (const event of events) {
    if (event.type === 'tool_result' && !results.has(event.callId)) results.set(event.callId, event)
  }

  const steps: TrailStep[] = []
  const evidence: TrailEvidence[] = []
  let subagentsSpawned = 0
  // The page the Run is on, as the results in front of each call last said.
  let currentUrl: string | null = null
  for (const event of events) {
    if (event.type === 'tool_result') {
      if (event.ok) currentUrl = pageOf(resultText(event.result))?.url ?? currentUrl
      continue
    }
    if (event.type !== 'tool_call') continue
    const result = results.get(event.callId)
    if (event.name === 'spawn_agent') subagentsSpawned += 1
    if (event.name === 'record_evidence') {
      evidence.push({
        callId: event.callId,
        at: event.at,
        kind: argOf(event.args, 'kind'),
        observation: argOf(event.args, 'observation'),
        excerpt: argOf(event.args, 'excerpt'),
        sourceUrl: argOf(event.args, 'source_url'),
        accepted: result === undefined ? null : result.ok,
        outcome: result === undefined ? null : result.ok ? resultText(result.result) : (result.error ?? null),
      })
    }
    if ((TRAIL_TOOLS as readonly string[]).includes(event.name)) {
      steps.push(stepOf(event as ToolCall & { name: TrailTool }, result, currentUrl))
    }
  }
  return { steps, evidence, subagentsSpawned }
}

// ---------------------------------------------------------------------------
// The reviewer's editor state

/** The four statuses a reviewer can record — never `pending`, which is the absence of a review. */
export type ReviewedStatus = Exclude<LiveGradeStatus, 'pending'>

export const REVIEWED_STATUSES: readonly ReviewedStatus[] = ['pass', 'useful_partial', 'help_access_blocked', 'unsuccessful']

/** An attempt that published no Answer can have hit a wall or failed; it cannot have passed or partly succeeded. */
const NO_ANSWER_STATUSES: readonly ReviewedStatus[] = ['unsuccessful', 'help_access_blocked']

export interface BenchCheckState {
  /** Null until the reviewer judges it. */
  readonly satisfied: boolean | null
  readonly note: string
}

/** One support row as the page edits it: every field text, `equivalentTo` blank for none. */
export interface BenchSupportState {
  readonly claim: string
  readonly sourceUrl: string
  readonly passageRef: string
  readonly equivalentTo: string
}

/** What the reviewer has entered for one slot, complete or not. */
export interface BenchEditorState {
  readonly status: ReviewedStatus | null
  readonly checks: Readonly<Record<string, BenchCheckState>>
  readonly support: readonly BenchSupportState[]
  readonly rationale: string
}

/** Bounds on what the page may post — generous for prose, fatal for a runaway loop. */
const TEXT_LIMIT = 20_000
const SUPPORT_LIMIT = 50

export function blankEditorState(task: LiveKeyTask): BenchEditorState {
  return {
    status: null,
    checks: Object.fromEntries(task.checks.map((check) => [check.checkId, { satisfied: null, note: '' }])),
    support: [],
    rationale: '',
  }
}

function tooLong(value: string): boolean {
  return value.length > TEXT_LIMIT
}

/**
 * Validate an editor state the page posted for one step. A check the page
 * never touched opens unjudged; a check the step does not require, or a
 * field of the wrong type, is refused rather than dropped — a silently
 * discarded note is a note the reviewer believes was kept.
 */
export function sanitizeEditorState(raw: unknown, task: LiveKeyTask): Validation<BenchEditorState> {
  if (!isRecord(raw)) return { ok: false, errors: ['the editor state is not an object'] }
  const errors: string[] = []

  let status: ReviewedStatus | null = null
  if (raw.status !== null && raw.status !== undefined) {
    if (REVIEWED_STATUSES.includes(raw.status as ReviewedStatus)) status = raw.status as ReviewedStatus
    else errors.push(`status "${String(raw.status)}" is not one a reviewer can record (${REVIEWED_STATUSES.join(', ')})`)
  }

  const checks: Record<string, BenchCheckState> = {}
  const rawChecks = raw.checks === undefined ? {} : raw.checks
  if (!isRecord(rawChecks)) {
    errors.push('checks must be an object keyed by check id')
  } else {
    const required = new Set(task.checks.map((check) => check.checkId))
    for (const id of Object.keys(rawChecks)) {
      if (!required.has(id)) errors.push(`check ${id} is not required of ${task.huntId}/${task.stepId}`)
    }
    for (const { checkId } of task.checks) {
      const judged = Object.hasOwn(rawChecks, checkId) ? rawChecks[checkId] : undefined
      if (judged === undefined) {
        checks[checkId] = { satisfied: null, note: '' }
      } else if (
        !isRecord(judged) ||
        !(judged.satisfied === null || typeof judged.satisfied === 'boolean') ||
        !isString(judged.note) ||
        tooLong(judged.note)
      ) {
        errors.push(`check ${checkId} needs satisfied as true, false or null, and a note of text`)
      } else {
        checks[checkId] = { satisfied: judged.satisfied, note: judged.note }
      }
    }
  }

  const support: BenchSupportState[] = []
  if (!Array.isArray(raw.support)) {
    errors.push('support must be a list')
  } else if (raw.support.length > SUPPORT_LIMIT) {
    errors.push(`support holds more than ${SUPPORT_LIMIT} rows`)
  } else {
    raw.support.forEach((row: unknown, index) => {
      const fields = isRecord(row) ? [row.claim, row.sourceUrl, row.passageRef, row.equivalentTo ?? ''] : []
      if (!isRecord(row) || !fields.every(isString) || fields.some((field) => tooLong(field as string))) {
        errors.push(`support row ${index + 1} needs claim, sourceUrl, passageRef and equivalentTo as text`)
        return
      }
      const [claim, sourceUrl, passageRef, equivalentTo] = fields as string[]
      support.push({ claim, sourceUrl, passageRef, equivalentTo })
    })
  }

  if (!isString(raw.rationale) || tooLong(raw.rationale)) errors.push('rationale must be text')

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, value: { status, checks, support, rationale: raw.rationale as string } }
}

/** Where an editor state came from, so the page can say "restored draft" or "as saved". */
export type EditorSource = 'draft' | 'saved' | 'blank'

/**
 * What the reviewer sees on opening a slot: their draft if they have one,
 * else what they saved, else nothing. A pending entry is nothing — there is
 * no review in it to reopen.
 */
export function editorStateOf(
  task: LiveKeyTask,
  saved: LiveGradeEntry | undefined,
  draft: BenchDraft | undefined,
): { readonly state: BenchEditorState; readonly source: EditorSource } {
  if (draft !== undefined) return { state: draft.state, source: 'draft' }
  const blank = blankEditorState(task)
  if (saved === undefined || !isReviewed(saved.status)) return { state: blank, source: 'blank' }
  const checks = { ...blank.checks }
  for (const judgment of saved.checks) checks[judgment.checkId] = { satisfied: judgment.satisfied, note: judgment.note ?? '' }
  return {
    source: 'saved',
    state: {
      status: saved.status as ReviewedStatus,
      checks,
      support: saved.support.map((row) => ({ claim: row.claim, sourceUrl: row.sourceUrl, passageRef: row.passageRef, equivalentTo: row.equivalentTo ?? '' })),
      rationale: saved.rationale,
    },
  }
}

// ---------------------------------------------------------------------------
// The drafts sidecar

/** The `kind` discriminator a drafts sidecar carries. */
export const LIVE_GRADING_DRAFTS_KIND = 'bingbong.live.grading-drafts'
export const LIVE_GRADING_DRAFTS_SCHEMA_VERSION = 1

/** What a drafts file is bound to. Drafts from another set, manifest or reviewer are never merged in. */
export interface DraftBinding {
  readonly setId: string
  readonly keyManifestDigest: string
  readonly reviewer: string
}

export interface BenchDraft {
  readonly state: BenchEditorState
  readonly updatedAt: string
}

export interface BenchDrafts extends DraftBinding {
  readonly kind: typeof LIVE_GRADING_DRAFTS_KIND
  readonly schemaVersion: typeof LIVE_GRADING_DRAFTS_SCHEMA_VERSION
  readonly drafts: Readonly<Record<string, BenchDraft>>
}

/** `pilot-2-grades-ada.json` → `pilot-2-grades-ada.drafts.json`, in the same directory. */
export function draftsPathFor(gradesPath: string): string {
  return gradesPath.endsWith('.json') ? `${gradesPath.slice(0, -'.json'.length)}.drafts.json` : `${gradesPath}.drafts.json`
}

export function emptyDrafts(binding: DraftBinding): BenchDrafts {
  return { kind: LIVE_GRADING_DRAFTS_KIND, schemaVersion: LIVE_GRADING_DRAFTS_SCHEMA_VERSION, ...binding, drafts: {} }
}

export function withDraft(drafts: BenchDrafts, attemptId: string, state: BenchEditorState, updatedAt: string): BenchDrafts {
  return { ...drafts, drafts: { ...drafts.drafts, [attemptId]: { state, updatedAt } } }
}

export function withoutDraft(drafts: BenchDrafts, attemptId: string): BenchDrafts {
  return { ...drafts, drafts: Object.fromEntries(Object.entries(drafts.drafts).filter(([id]) => id !== attemptId)) }
}

/**
 * Validate a drafts file read back from disk. `taskFor` names the step a
 * gradeable slot is judged against, or undefined for anything else.
 */
export function parseDrafts(
  raw: unknown,
  binding: DraftBinding,
  taskFor: (attemptId: string) => LiveKeyTask | undefined,
): Validation<BenchDrafts> {
  if (!isRecord(raw)) return { ok: false, errors: ['the drafts file is not an object'] }
  const errors: string[] = []
  if (raw.kind !== LIVE_GRADING_DRAFTS_KIND) errors.push(`kind is "${String(raw.kind)}", not ${LIVE_GRADING_DRAFTS_KIND}`)
  if (raw.schemaVersion !== LIVE_GRADING_DRAFTS_SCHEMA_VERSION) {
    errors.push(`schemaVersion is ${String(raw.schemaVersion)}, not ${LIVE_GRADING_DRAFTS_SCHEMA_VERSION}`)
  }
  if (raw.reviewer !== binding.reviewer) {
    errors.push(`the drafts were written by ${String(raw.reviewer)}, not ${binding.reviewer} — one reviewer, one grades file`)
  }
  if (raw.setId !== binding.setId) errors.push(`the drafts are for capture set "${String(raw.setId)}", not "${binding.setId}"`)
  if (raw.keyManifestDigest !== binding.keyManifestDigest) errors.push('the drafts were written against a different key manifest')
  if (!isRecord(raw.drafts)) {
    errors.push('drafts must be an object keyed by attempt id')
    return { ok: false, errors }
  }

  const drafts: Record<string, BenchDraft> = {}
  for (const [attemptId, draft] of Object.entries(raw.drafts)) {
    const where = `draft for ${attemptId}`
    const task = taskFor(attemptId)
    if (task === undefined) {
      errors.push(`${where}: the capture set has no gradeable slot by that id`)
      continue
    }
    if (!isRecord(draft) || !isString(draft.updatedAt)) {
      errors.push(`${where}: needs a state and an updatedAt`)
      continue
    }
    const state = sanitizeEditorState(draft.state, task)
    if (!state.ok) {
      errors.push(...state.errors.map((error) => `${where}: ${error}`))
      continue
    }
    drafts[attemptId] = { state: state.value, updatedAt: draft.updatedAt }
  }
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, value: { ...emptyDrafts(binding), drafts } }
}

// ---------------------------------------------------------------------------
// Whose grades file this is

/** `--reviewer` when given, else `git config user.name` (asked only then), else no one. */
export function resolveReviewer(flag: string | undefined, gitUserName: () => string | null): string | null {
  const named = flag?.trim()
  if (named) return named
  const fromGit = gitUserName()?.trim()
  return fromGit ? fromGit : null
}

/**
 * Why the bench will not write into this grades file, or null when it
 * may. One grades file per reviewer: two people's judgments in one file
 * could not be compared blind, and a save would silently mix them.
 */
export function reviewerRefusal(grades: LiveGrades, reviewer: string): string | null {
  const others = [...new Set(grades.entries.map((entry) => entry.reviewer).filter((name) => name !== '' && name !== reviewer))]
  if (others.length === 0) return null
  return (
    `the grades file holds reviews by ${others.join(', ')}, and the bench writes only ${reviewer}'s — ` +
    'give --grades a file of your own, and pass theirs as --compare'
  )
}

// ---------------------------------------------------------------------------
// Saving an entry

/** One gradeable position: the scheduled slot, what (if anything) was dispatched into it, and the step it is judged against. */
export interface BenchSlot {
  readonly slot: LiveScheduledAttempt
  readonly dispatched: LiveDispatchedAttempt | undefined
  readonly task: LiveKeyTask
}

/** The attempt dispatched into a slot, or null when nothing was — a not-reached record, or no record at all. */
export function dispatchedAttemptOf(dispatched: LiveDispatchedAttempt | undefined): LiveAttemptCapture | null {
  return dispatched?.record.kind === 'attempt' ? dispatched.record : null
}

/** The statuses the page offers for a slot; none for a slot nothing was dispatched into. */
export function allowedStatusesFor(dispatched: LiveDispatchedAttempt | undefined): readonly ReviewedStatus[] {
  const attempt = dispatchedAttemptOf(dispatched)
  if (attempt === null) return []
  return answerBindingOf(attempt) === null ? NO_ANSWER_STATUSES : REVIEWED_STATUSES
}

/**
 * The grade entry an editor state describes, or the bench's own reason it
 * cannot be one yet. Unjudged checks are left out rather than guessed, so
 * the validator names them.
 */
export function composeEntry(
  state: BenchEditorState,
  bench: BenchSlot,
  binding: { readonly manifest: LiveKeyManifest; readonly reviewer: string; readonly reviewedAt: string },
): Validation<LiveGradeEntry> {
  const { slot, dispatched, task } = bench
  const where = `grade for ${slot.attemptId}`
  const attempt = dispatchedAttemptOf(dispatched)
  if (dispatched === undefined || attempt === null) {
    return {
      ok: false,
      errors: [`${where}: no attempt was dispatched into this slot, so it stays pending — not reached is a fact about the protocol, not a judgment`],
    }
  }
  if (state.status === null) return { ok: false, errors: [`${where}: choose a status — the bench never picks one`] }
  if (!allowedStatusesFor(dispatched).includes(state.status)) {
    return { ok: false, errors: [`${where}: the Run published no Answer, so its status is unsuccessful or help_access_blocked`] }
  }

  const checks = task.checks.flatMap((check) => {
    const judged = state.checks[check.checkId]
    if (judged === undefined || judged.satisfied === null) return []
    return [{ checkId: check.checkId, satisfied: judged.satisfied, ...(judged.note.trim() === '' ? {} : { note: judged.note }) }]
  })
  const support: LiveClaimSupport[] = state.support.map((row) => ({
    claim: row.claim,
    sourceUrl: row.sourceUrl,
    passageRef: row.passageRef,
    ...(row.equivalentTo.trim() === '' ? {} : { equivalentTo: row.equivalentTo }),
  }))

  return {
    ok: true,
    value: {
      attemptId: slot.attemptId,
      huntId: slot.huntId,
      stepId: slot.stepId,
      captureId: dispatched.captureId,
      answer: answerBindingOf(attempt),
      keyVersion: binding.manifest.keyVersion,
      keyDigest: binding.manifest.keyDigest,
      status: state.status,
      checks,
      support,
      rationale: state.rationale,
      reviewer: binding.reviewer,
      reviewedAt: binding.reviewedAt,
    },
  }
}

/** The grades with one entry replaced by attempt id. */
export function withEntry(grades: LiveGrades, entry: LiveGradeEntry): LiveGrades {
  return { ...grades, entries: grades.entries.map((candidate) => (candidate.attemptId === entry.attemptId ? entry : candidate)) }
}

/**
 * The grades file a save would write, as the real validator accepted it —
 * or every rule it would break, in the validator's own words. The page runs
 * this on every change to show what blocks the save; the server runs it
 * again on the save itself.
 */
export function gradesWith(
  state: BenchEditorState,
  bench: BenchSlot,
  current: LiveGrades,
  inputs: LiveGradingInputs,
  reviewer: string,
  reviewedAt: string,
): Validation<LiveGrades> {
  const binding = { manifest: inputs.manifest, reviewer, reviewedAt }
  const composed = composeEntry(state, bench, binding)
  if (composed.ok) return parseLiveGrades(withEntry(current, composed.value), inputs)
  if (state.status !== null || dispatchedAttemptOf(bench.dispatched) === null) return composed
  // No status yet. What else the record needs — every check judged, a
  // rationale — does not depend on which status is chosen, so it is shown
  // now rather than after a choice. `unsuccessful` is only the probe: every
  // dispatched attempt may hold it, and it has no rule of its own for the
  // validator to report, so no message can hint at a verdict.
  const probe = composeEntry({ ...state, status: 'unsuccessful' }, bench, binding)
  const rest = probe.ok ? parseLiveGrades(withEntry(current, probe.value), inputs) : probe
  return { ok: false, errors: [...composed.errors, ...(rest.ok ? [] : rest.errors)] }
}

// ---------------------------------------------------------------------------
// Another reviewer's Grade

export interface CheckJudgmentView {
  readonly satisfied: boolean | null
  readonly note: string
}

export interface CheckComparison {
  readonly checkId: string
  readonly description: string
  readonly own: CheckJudgmentView
  /** Null when the other Grade judged no such check. */
  readonly other: CheckJudgmentView | null
  readonly agree: boolean
}

export type GradeComparison =
  | { readonly otherPending: true; readonly reviewer: null }
  | {
      readonly otherPending: false
      readonly reviewer: string
      readonly status: { readonly own: LiveGradeStatus; readonly other: LiveGradeStatus; readonly agree: boolean }
      readonly rationale: { readonly own: string; readonly other: string }
      readonly checks: readonly CheckComparison[]
      readonly support: { readonly own: readonly LiveClaimSupport[]; readonly other: readonly LiveClaimSupport[] }
      readonly agreements: number
      readonly disagreements: number
    }

/**
 * This reviewer's saved Grade beside another's, or null while this
 * reviewer has not saved one. The null is the rule: the other Grade is not
 * dimmed or collapsed before the save, it is not produced.
 */
export function compareGrades(own: LiveGradeEntry | undefined, other: LiveGradeEntry | undefined, task: LiveKeyTask): GradeComparison | null {
  if (own === undefined || !isReviewed(own.status)) return null
  if (other === undefined || !isReviewed(other.status)) return { otherPending: true, reviewer: null }
  const checks = task.checks.map((check): CheckComparison => {
    const ownJudgment = own.checks.find((judgment) => judgment.checkId === check.checkId)
    const otherJudgment = other.checks.find((judgment) => judgment.checkId === check.checkId)
    const ownView = { satisfied: ownJudgment?.satisfied ?? null, note: ownJudgment?.note ?? '' }
    const otherView = otherJudgment === undefined ? null : { satisfied: otherJudgment.satisfied, note: otherJudgment.note ?? '' }
    return { checkId: check.checkId, description: check.description, own: ownView, other: otherView, agree: otherView !== null && otherView.satisfied === ownView.satisfied }
  })
  const agreements = checks.filter((check) => check.agree).length
  return {
    otherPending: false,
    reviewer: other.reviewer,
    status: { own: own.status, other: other.status, agree: own.status === other.status },
    rationale: { own: own.rationale, other: other.rationale },
    checks,
    support: { own: own.support, other: other.support },
    agreements,
    disagreements: checks.length - agreements,
  }
}

// ---------------------------------------------------------------------------
// The sidebar

/** Where one slot stands for this reviewer. `not_reached` is never gradeable: nothing was dispatched to grade. */
export type BenchSlotState = 'pending' | 'drafted' | 'graded' | 'not_reached'

export interface BenchSlotSummary {
  readonly attemptId: string
  readonly huntId: string
  readonly stepId: string
  readonly order: number
  readonly relation: LiveScheduledAttempt['relation']
  readonly parentAttemptId: string | null
  readonly state: BenchSlotState
  /** A draft is waiting over this slot — over a saved Grade, it is an edit not yet saved. */
  readonly unsavedDraft: boolean
  readonly status: LiveGradeStatus
  /** Why nothing was dispatched, from the capture; null for a dispatched slot. */
  readonly reason: string | null
}

/** The report's own wording for a slot no Session capture mentions (report.ts `dispositionOf`). */
const UNACCOUNTED_REASON = 'no Session capture mentions this scheduled slot'

/** Every scheduled slot in schedule order, with its state. */
export function slotSummariesOf(inputs: LiveGradingInputs, grades: LiveGrades, drafts: BenchDrafts): BenchSlotSummary[] {
  const { byAttemptId } = indexAttempts(inputs.sessions)
  return [...inputs.set.slots]
    .sort((left, right) => left.order - right.order)
    .map((slot) => {
      const dispatched = byAttemptId.get(slot.attemptId)
      const status = grades.entries.find((entry) => entry.attemptId === slot.attemptId)?.status ?? 'pending'
      const unsavedDraft = Object.hasOwn(drafts.drafts, slot.attemptId)
      const reason = dispatched === undefined ? UNACCOUNTED_REASON : dispatched.record.kind === 'not_reached' ? dispatched.record.reason : null
      const state: BenchSlotState = reason !== null ? 'not_reached' : isReviewed(status) ? 'graded' : unsavedDraft ? 'drafted' : 'pending'
      return {
        attemptId: slot.attemptId,
        huntId: slot.huntId,
        stepId: slot.stepId,
        order: slot.order,
        relation: slot.relation,
        parentAttemptId: slot.parentAttemptId ?? null,
        state,
        unsavedDraft,
        status,
        reason,
      }
    })
}

// ---------------------------------------------------------------------------
// The key beside the Answer

export interface BenchKeySource {
  readonly url: string
  readonly supports: string
}

/**
 * The substantive key as the bench reads it — structurally the corpus's
 * `GradingKey`, so the CLI can hand one over without this module importing
 * the corpus. `constraints` are here because they decide verdicts without
 * being checks: a reviewer who never opens them grades wrongly and
 * completely.
 */
export interface BenchKey {
  readonly huntId: string
  readonly version: number
  readonly requiredFacts: readonly string[]
  readonly constraints: readonly string[]
  readonly pitfalls: readonly string[]
  readonly uncertainties: readonly string[]
  readonly sources: readonly BenchKeySource[]
  readonly liveFacts: readonly string[]
  readonly followUpDelta?: {
    readonly requiredFacts: readonly string[]
    readonly pitfalls: readonly string[]
    readonly sources: readonly BenchKeySource[]
  }
}

/** A key source offered for a support row, with the reference that finds it again. */
export interface BenchPickSource extends BenchKeySource {
  readonly passageRef: string
}

export interface BenchKeyView {
  readonly huntId: string
  readonly version: number
  readonly requiredFacts: readonly string[]
  readonly constraints: readonly string[]
  readonly pitfalls: readonly string[]
  readonly uncertainties: readonly string[]
  readonly sources: readonly BenchKeySource[]
  readonly liveFacts: readonly string[]
  readonly followUpDelta: BenchKey['followUpDelta'] | null
  /** The step's own sources first: a follow-up is supported by its delta's pages before the initial's. */
  readonly pickSources: readonly BenchPickSource[]
}

/**
 * The whole key for the slot on screen. A passage reference names the
 * source inside the key (`keys.ts#<hunt>.sources[1]`) — the reviewer may
 * sharpen it to a heading, but it always starts out findable.
 */
export function keyViewFor(key: BenchKey, slot: LiveScheduledAttempt, task: LiveKeyTask): BenchKeyView {
  const module = task.keyRef.split('#')[0]
  const base = key.sources.map((source, index) => ({ ...source, passageRef: `${module}#${key.huntId}.sources[${index}]` }))
  const delta = (key.followUpDelta?.sources ?? []).map((source, index) => ({
    ...source,
    passageRef: `${module}#${key.huntId}.followUpDelta.sources[${index}]`,
  }))
  return {
    huntId: key.huntId,
    version: key.version,
    requiredFacts: key.requiredFacts,
    constraints: key.constraints,
    pitfalls: key.pitfalls,
    uncertainties: key.uncertainties,
    sources: key.sources,
    liveFacts: key.liveFacts,
    followUpDelta: key.followUpDelta ?? null,
    pickSources: slot.relation === 'initial' ? base : [...delta, ...base],
  }
}

/**
 * Where the key the bench would show has moved past the manifest the checks
 * came from. The page puts key prose beside manifest check descriptions; if
 * a key was revised after the manifest was generated the two would quietly
 * disagree, and the reviewer would judge one against the other.
 */
export function keyDriftOf(manifest: LiveKeyManifest, currentFor: (huntId: string) => LiveKeyManifest): string[] {
  const problems: string[] = []
  const regenerate = 'regenerate the manifest with pnpm live:keys'
  for (const huntId of [...new Set(manifest.tasks.map((task) => task.huntId))]) {
    let current: LiveKeyManifest
    try {
      current = currentFor(huntId)
    } catch (error) {
      problems.push(`${huntId}: ${redactedMessage(error)}`)
      continue
    }
    for (const task of manifest.tasks.filter((candidate) => candidate.huntId === huntId)) {
      const where = `${huntId}/${task.stepId}`
      const now = current.tasks.find((candidate) => candidate.stepId === task.stepId)
      if (now === undefined) {
        problems.push(`${where}: the key no longer describes this step — ${regenerate}`)
        continue
      }
      for (const check of task.checks) {
        const described = now.checks.find((candidate) => candidate.checkId === check.checkId)
        if (described === undefined) problems.push(`${where}: check ${check.checkId} is no longer required by the key — ${regenerate}`)
        else if (described.description !== check.description) {
          problems.push(`${where}: check ${check.checkId} reads differently in the key than in the manifest — ${regenerate}`)
        }
      }
      for (const check of now.checks) {
        if (!task.checks.some((candidate) => candidate.checkId === check.checkId)) {
          problems.push(`${where}: the key requires check ${check.checkId}, which the manifest lacks — ${regenerate}`)
        }
      }
    }
  }
  return problems
}
