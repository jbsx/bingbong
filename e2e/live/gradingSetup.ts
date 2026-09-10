// The Grading Bench's setup page, its pure parts (#229): what the bench
// proposes from its two fixed roots before the reviewer confirms.
//
// #228 opened the bench from three path flags so it would never grade a set,
// or write a file, the reviewer did not choose. The rule now reads: *the
// bench proposes and the reviewer confirms; it never opens anything
// silently.* Nothing here reads a file or opens a bench — every function is
// a decision over files already read, so the server stays a thin door and
// each rule can be tested as a function.
//
// NOTHING HERE LOADS A KEY. Relative imports carry `.ts` (the Node
// type-stripping pattern the scripts run under).

import { digestOf, validateCaptureSet, type Validation } from './artifacts.ts'
import { LIVE_GRADING_DRAFTS_KIND, draftsPathFor, gradesPathOfDrafts, type BenchSlotState } from './gradingBench.ts'
import { LIVE_GRADES_KIND, keyManifestDigest, type LiveKeyManifest } from './grades.ts'
import { LIVE_CAPTURE_SET_KIND } from './types.ts'

/** A JSON file read from one of the two roots: its name in the root, and its parsed value. */
export interface RootFile {
  readonly name: string
  /** Undefined when the file did not parse. */
  readonly value: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// ---------------------------------------------------------------------------
// The capture sets on offer

/** One capture set in the artifacts root, as the setup page lists it. */
export interface SetListing {
  /** The set file's name in the artifacts root. */
  readonly file: string
  readonly setId: string | null
  readonly createdAt: string | null
  readonly mode: string | null
  readonly state: string | null
  /** Null for a set record that does not validate. */
  readonly slots: number | null
  /** Why the set cannot be started; empty when it can. */
  readonly refusals: readonly string[]
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function listingOf(file: string, record: Record<string, unknown>): SetListing {
  const base = { file, setId: textOrNull(record.setId), createdAt: textOrNull(record.createdAt), mode: textOrNull(record.mode), state: textOrNull(record.state) }
  const validated = validateCaptureSet(record)
  if (!validated.ok) return { ...base, slots: null, refusals: [`the capture set does not validate: ${validated.errors.join('; ')}`] }
  const set = validated.value
  const refusals: string[] = []
  if (set.mode !== 'measured') refusals.push('a verification-mode set: a scripted model answered it, so there is no measured Answer to grade')
  if (set.state !== 'complete') {
    refusals.push(`incomplete: the pass ended ${set.state}${set.stateReason === undefined ? '' : ` (${set.stateReason})`}, and only a complete set is graded`)
  }
  return { ...base, slots: set.slots.length, refusals }
}

/**
 * Every capture set among the artifacts root's files, newest first. A set is
 * recognised by its `kind`, so the preflight record beside them — and
 * anything else — is skipped. A set that cannot be started is still listed,
 * with the reason: a set that silently vanished would read as never captured.
 */
export function captureSetsIn(artifactFiles: readonly RootFile[]): SetListing[] {
  const listed = artifactFiles.flatMap(({ name, value }) => (isRecord(value) && value.kind === LIVE_CAPTURE_SET_KIND ? [listingOf(name, value)] : []))
  const claims = new Map<string, number>()
  for (const { setId } of listed) if (setId !== null) claims.set(setId, (claims.get(setId) ?? 0) + 1)
  return listed
    .map((set) =>
      set.setId !== null && claims.get(set.setId)! > 1
        ? { ...set, refusals: [...set.refusals, `more than one file in the artifacts root claims set id ${set.setId}, and a grades file names its set only by id`] }
        : set,
    )
    .sort((left, right) => {
      const [newer, older] = [right.createdAt ?? '', left.createdAt ?? '']
      if (newer !== older) return newer < older ? -1 : 1
      return left.file < right.file ? -1 : left.file > right.file ? 1 : 0
    })
}

// ---------------------------------------------------------------------------
// The grades file's name

/** Characters a slug keeps; every run of anything else becomes one dash. */
const OUTSIDE_SLUG = /[^a-z0-9]+/g

/**
 * A reviewer's name as a file-name fragment: lowercase, each run outside
 * `[a-z0-9]` one dash, none at either end. A name with nothing a slug keeps
 * (a name in a script other than Latin) is given one from its digest, so two
 * such reviewers are never handed the same file name. The file itself keeps
 * the exact name; the slug only names it.
 */
export function reviewerSlug(reviewer: string): string {
  const slug = reviewer.toLowerCase().replace(OUTSIDE_SLUG, '-').replace(/^-|-$/g, '')
  return slug === '' ? `reviewer-${digestOf(reviewer).slice('sha256:'.length, 'sha256:'.length + 12)}` : slug
}

/** The grades file a reviewer starts on a set: `<setId>-grades-<reviewer slug>.json`, in the private root. */
export function gradesFileNameFor(setId: string, reviewer: string): string {
  return `${setId}-grades-${reviewerSlug(reviewer)}.json`
}

// ---------------------------------------------------------------------------
// Which grades file the reviewer resumes

/** Every name on a reviewed entry of a grades file. A pending entry names no one. */
function reviewersOf(grades: Record<string, unknown>): string[] {
  const entries = Array.isArray(grades.entries) ? grades.entries : []
  const names = entries.filter(isRecord).map((entry) => entry.reviewer)
  return [...new Set(names.filter((name): name is string => typeof name === 'string' && name !== ''))]
}

export interface GradesFileChoice {
  /** The grades file's name in the private root. */
  readonly name: string
  /** True when the bench would reopen work already there — a grades file or a drafts sidecar. */
  readonly resumed: boolean
}

export interface GradesFileQuery {
  readonly setId: string
  readonly reviewer: string
  /** The key the bench grades against, as built in memory. */
  readonly manifest: LiveKeyManifest
  readonly privateFiles: readonly RootFile[]
}

const RECHECK_ROUTE = 'resolve it through live:report’s documented recheck (docs/live-web-reporting.md, “When live facts change”)'

/** Why the bench will not write into the grades file at `name`, if it exists. */
function gradesFileRefusals(name: string, value: unknown, query: GradesFileQuery): string[] {
  const { setId, reviewer, manifest } = query
  if (!isRecord(value) || value.kind !== LIVE_GRADES_KIND) return [`${name} is in the private root and is not a grades file, so the bench will not write over it`]
  if (value.setId !== setId) return [`${name} holds grades for set "${String(value.setId)}", not ${setId}, so the bench will not write over it`]
  const refusals: string[] = []
  const reviewers = reviewersOf(value)
  const others = reviewers.filter((name) => name !== reviewer)
  if (others.length > 0) {
    refusals.push(
      reviewers.includes(reviewer)
        ? `${name} mixes ${reviewer}’s reviews with ${others.join(', ')}’s — one reviewer, one grades file, so the bench will not write into it`
        : `${name} already holds reviews by ${others.join(', ')}, so it cannot be ${reviewer}’s file`,
    )
  }
  if (value.keyManifestDigest !== keyManifestDigest(manifest)) {
    refusals.push(
      value.keyVersion === manifest.keyVersion
        ? `${name} is bound to another manifest of key ${manifest.keyVersion} than the current one — ${RECHECK_ROUTE}`
        : `${name} is bound to key ${String(value.keyVersion)}, and the current key is ${manifest.keyVersion} — ${RECHECK_ROUTE}`,
    )
  }
  return refusals
}

/** Why the bench will not reopen the drafts sidecar at `name`, if it exists. */
function draftsRefusals(name: string, value: unknown, query: GradesFileQuery): string[] {
  const { setId, reviewer, manifest } = query
  if (!isRecord(value) || value.kind !== LIVE_GRADING_DRAFTS_KIND) return [`${name} is in the private root and is not a drafts sidecar, so the bench will not write over it`]
  if (value.reviewer !== reviewer) return [`${name} holds drafts by ${String(value.reviewer)}, so it cannot be ${reviewer}’s sidecar`]
  if (value.setId !== setId) return [`${name} holds drafts for set "${String(value.setId)}", not ${setId}`]
  if (value.keyManifestDigest !== keyManifestDigest(manifest)) {
    return [`${name} holds drafts written against another key than the current one (${manifest.keyVersion}) — a draft is not a Grade and has no recheck, so move it aside`]
  }
  return []
}

/**
 * The grades file this reviewer's work on a set goes into. A file already
 * holding it is found by content — a grades file for the set with an entry
 * by this reviewer, or a drafts sidecar bound to them — whatever it is
 * called; otherwise it is the derived name.
 *
 * Refused, so that no second file is ever started: when two files hold the
 * work; when the file mixes reviewers; when it or its sidecar is bound to
 * another key than the current one; and when the derived name is already
 * taken by something that is not this reviewer's.
 */
export function resolveGradesFile(query: GradesFileQuery): Validation<GradesFileChoice> {
  const { setId, reviewer, privateFiles } = query
  const matches = new Set<string>()
  for (const { name, value } of privateFiles) {
    if (!isRecord(value) || value.setId !== setId) continue
    if (value.kind === LIVE_GRADES_KIND && reviewersOf(value).includes(reviewer)) matches.add(name)
    // A drafts file named otherwise than as a sidecar sits beside no grades file.
    const beside = value.kind === LIVE_GRADING_DRAFTS_KIND && value.reviewer === reviewer ? gradesPathOfDrafts(name) : null
    if (beside !== null) matches.add(beside)
  }
  if (matches.size > 1) {
    return { ok: false, errors: [`${[...matches].sort().join(', ')} each hold ${reviewer}’s work on set ${setId} — the bench will not pick one; move all but one aside`] }
  }

  const name = [...matches][0] ?? gradesFileNameFor(setId, reviewer)
  const draftsName = draftsPathFor(name)
  const byName = new Map(privateFiles.map((candidate) => [candidate.name, candidate.value]))
  const errors = [
    ...(byName.has(name) ? gradesFileRefusals(name, byName.get(name), query) : []),
    ...(byName.has(draftsName) ? draftsRefusals(draftsName, byName.get(draftsName), query) : []),
  ]
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, value: { name, resumed: byName.has(name) || byName.has(draftsName) } }
}

// ---------------------------------------------------------------------------
// The reviewer

/**
 * The typo guard: a caution for a name nothing in the private root was
 * written by, while other names have grades or drafts there. Null when the
 * name has some, and when nobody has any yet — the first reviewer is not a
 * typo. It cautions, and never refuses: a second reviewer is new too.
 */
export function reviewerCaution(reviewer: string, privateFiles: readonly RootFile[]): string | null {
  const known = new Set<string>()
  for (const { value } of privateFiles) {
    if (!isRecord(value)) continue
    if (value.kind === LIVE_GRADES_KIND) for (const name of reviewersOf(value)) known.add(name)
    if (value.kind === LIVE_GRADING_DRAFTS_KIND && typeof value.reviewer === 'string' && value.reviewer !== '') known.add(value.reviewer)
  }
  if (known.size === 0 || known.has(reviewer)) return null
  return `nothing in the private root was graded or drafted by “${reviewer}”, and these names have work there: ${[...known].sort().join(', ')} — check the spelling before Start`
}

// ---------------------------------------------------------------------------
// Another reviewer's Grade

/** A grades file the setup page offers to show beside this reviewer's — blind, slot by slot, until each of theirs is saved. */
export interface OfferedComparison {
  /** The grades file's name in the private root. */
  readonly file: string
  /** The one reviewer whose Grades it holds, exactly as the file names them: a model-graded file reads as that model. */
  readonly reviewer: string
}

/**
 * The grades files that can be shown as another reviewer's Grade on a set,
 * whatever they are called. A file is offered when it is bound to the set
 * and to the current key, and its reviews are one other reviewer's: a file
 * with none has nothing to show, a file with this reviewer's in it is not a
 * second opinion, and a file mixing two others has no one name to label it.
 */
export function comparisonsOfferedFor(query: GradesFileQuery): OfferedComparison[] {
  const { setId, reviewer, manifest, privateFiles } = query
  const digest = keyManifestDigest(manifest)
  return privateFiles
    .flatMap(({ name, value }): OfferedComparison[] => {
      if (!isRecord(value) || value.kind !== LIVE_GRADES_KIND || value.setId !== setId) return []
      if (value.keyVersion !== manifest.keyVersion || value.keyManifestDigest !== digest) return []
      const reviewers = reviewersOf(value)
      return reviewers.length === 1 && reviewers[0] !== reviewer ? [{ file: name, reviewer: reviewers[0] }] : []
    })
    .sort((left, right) => (left.file < right.file ? -1 : left.file > right.file ? 1 : 0))
}

/**
 * The comparison proposed: the one offered file when there is exactly one, else
 * none. A default is safe here, as it was not for the reviewer's own file,
 * because the bench keeps the other Grade blind until each save — and "none"
 * stays on offer beside it.
 */
export function preselectedComparisonFile(offered: readonly OfferedComparison[]): string | null {
  return offered.length === 1 ? offered[0].file : null
}

// ---------------------------------------------------------------------------
// The list, and the set it preselects

/** Where this reviewer stands on a set, counted as the bench's sidebar counts it. */
export interface SetProgress {
  readonly graded: number
  readonly drafted: number
  readonly pending: number
  /** Never gradeable: nothing was dispatched into these slots. */
  readonly notReached: number
}

export function progressOf(slots: readonly { readonly state: BenchSlotState }[]): SetProgress {
  const count = (state: BenchSlotState) => slots.filter((slot) => slot.state === state).length
  return { graded: count('graded'), drafted: count('drafted'), pending: count('pending'), notReached: count('not_reached') }
}

/** A listed set, with what Start would open it on — no grades file, no progress and no comparison while it cannot be started. */
export interface SetupSet extends SetListing {
  readonly gradesFile: GradesFileChoice | null
  readonly progress: SetProgress | null
  /** Other reviewers' grades files a bench really opens beside this reviewer's on the set. "None" is always on offer too. */
  readonly comparisons: readonly OfferedComparison[]
  /** The comparison proposed, by file — see `preselectedComparisonFile`. */
  readonly preselectedComparison: string | null
}

/**
 * The newest set that can be started where this reviewer still has an
 * ungraded slot — pending or drafted — or null. Only a proposal: nothing is
 * opened until the reviewer presses Start.
 */
export function preselectedSetFile(sets: readonly SetupSet[]): string | null {
  const candidates = sets.filter((set) => set.refusals.length === 0 && set.progress !== null && set.progress.pending + set.progress.drafted > 0)
  const newest = candidates.reduce<SetupSet | null>((best, set) => (best === null || (set.createdAt ?? '') > (best.createdAt ?? '') ? set : best), null)
  return newest?.file ?? null
}
