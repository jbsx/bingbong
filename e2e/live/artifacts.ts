// Durable capture files (#224): where a capture lives on disk, how it is
// written without clobbering another, how the profile's diagnostics are
// copied out before the profile is removed, and how a reader loads it
// back. Shared by the capture (writes) and the offline reporter (#226,
// reads), so it must load under plain Node with no Electron, no routing,
// no network and no import-time work — which is why every relative import
// carries a `.ts` extension (the node type-stripping pattern scripts/
// already uses) and the only src imports are the import-free file-name
// patterns.
//
// What it refuses to do is as deliberate as what it does: it never
// archives a directory recursively (a Browser Profile holds cookies and
// settings.json holds keys), it only copies files whose names match a
// known diagnostic family, and it replaces known secret values before any
// byte reaches the capture root.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PERF_FILE_PATTERN } from '../../src/main/perf/perfFiles.ts'
import {
  HOST_TRACE_FILE_PATTERN,
  RUN_TRACE_FILE_PATTERN,
  RUN_TRACE_SCREENSHOT_PATTERN,
} from '../../src/main/trace/traceFiles.ts'
import {
  LIVE_CAPTURE_SCHEMA_VERSION,
  LIVE_CAPTURE_SET_KIND,
  LIVE_SESSION_CAPTURE_KIND,
  type AttemptRelation,
  type LiveArtifactFamily,
  type LiveArtifactReference,
  type LiveCaptureSet,
  type LiveEventTape,
  type LivePromptIdentity,
  type LiveScheduledAttempt,
  type LiveSessionCapture,
} from './types.ts'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

/** Where captures land: ignored by Git, never a release-evaluation pool. */
export const LIVE_ARTIFACTS_ROOT = join(repoRoot, 'e2e', 'live', 'artifacts')
/** Where evaluator-only inputs (keys, source targets) live: ignored by Git, never read by a capture. */
export const LIVE_PRIVATE_ROOT = join(repoRoot, 'e2e', 'live', 'private')

/** The file a session capture directory is named after. */
export const SESSION_CAPTURE_FILE = 'capture.json'

/** `sha256:<hex>` of bytes or text. */
export function digestOf(data: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(data).digest('hex')}`
}

/** A prompt's identity: its version label and the digest of its exact text. */
export function promptIdentity(version: string, text: string): LivePromptIdentity {
  return { version, hash: digestOf(text) }
}

// ---------------------------------------------------------------------------
// Redaction

/**
 * The query parameters whose value is a credential wherever it appears.
 * A URL in a tool error or a stderr line is the usual carrier.
 */
const CREDENTIAL_QUERY_KEYS = /([?&](?:api[_-]?key|apikey|key|token|access[_-]?token|secret|password|auth)=)[^&#\s"']+/gi
const BEARER_PATTERN = /(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/g
const URL_USERINFO_PATTERN = /(\w+:\/\/)[^\s/@:]+:[^\s/@]+@/g

/**
 * Replace every known secret value and every credential-bearing URL
 * shape in `text`. Secret values are matched literally, longest first,
 * so a key that is a prefix of another is never half-redacted. This is
 * a sanitizer, not proof of absence: it removes what it was told about
 * and the shapes it knows.
 */
export function redactText(text: string, secrets: readonly string[] = []): string {
  let out = text
  for (const secret of [...new Set(secrets.filter((value) => value.length >= 6))].sort((a, b) => b.length - a.length)) {
    out = out.split(secret).join('[redacted]')
  }
  out = out.replace(CREDENTIAL_QUERY_KEYS, '$1[redacted]')
  out = out.replace(BEARER_PATTERN, '$1[redacted]')
  out = out.replace(URL_USERINFO_PATTERN, '$1[redacted]@')
  return out
}

/** The message of anything thrown, redacted. */
export function redactedMessage(error: unknown, secrets: readonly string[] = []): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  return redactText(message, secrets)
}

// ---------------------------------------------------------------------------
// JSONL

export interface ParsedJsonl {
  readonly records: readonly unknown[]
  /** Complete lines that failed to parse. */
  readonly malformed: number
  /** True when the final line had no newline and did not parse — a write in progress. */
  readonly tornTail: boolean
  /** The complete, parseable lines in order — what an archive keeps. */
  readonly keptLines: readonly string[]
}

/**
 * Parse a JSONL text keeping every valid record. A torn tail — the last
 * line, unterminated, failing to parse — is a sink mid-write, not a
 * corrupt file, and never discards the records before it.
 */
export function parseJsonl(text: string): ParsedJsonl {
  const records: unknown[] = []
  const keptLines: string[] = []
  let malformed = 0
  let tornTail = false
  const terminated = text.endsWith('\n')
  const lines = text.split('\n')
  if (terminated) lines.pop()
  lines.forEach((line, index) => {
    if (line.trim() === '') return
    try {
      records.push(JSON.parse(line))
      keptLines.push(line)
    } catch {
      if (index === lines.length - 1 && !terminated) tornTail = true
      else malformed += 1
    }
  })
  return { records, malformed, tornTail, keptLines }
}

// ---------------------------------------------------------------------------
// Archiving

/** Which profile files an archive may copy, by family; anything else is refused. */
const ARCHIVE_FAMILIES: readonly { readonly family: LiveArtifactFamily; readonly pattern: RegExp; readonly jsonl: boolean }[] = [
  { family: 'run_trace', pattern: RUN_TRACE_FILE_PATTERN, jsonl: true },
  { family: 'screenshot', pattern: RUN_TRACE_SCREENSHOT_PATTERN, jsonl: false },
  { family: 'host_trace', pattern: HOST_TRACE_FILE_PATTERN, jsonl: true },
  { family: 'perf', pattern: PERF_FILE_PATTERN, jsonl: true },
]

/** The family a logs-dir file name may be archived under, or null. */
export function archiveFamilyOf(name: string): LiveArtifactFamily | null {
  return ARCHIVE_FAMILIES.find((entry) => entry.pattern.test(name))?.family ?? null
}

export interface ArchiveOptions {
  /** Known secret values to strip from text files before writing. */
  readonly secrets?: readonly string[]
}

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true })
}

/** Write bytes to `path` atomically (temp file in the same directory, then rename). */
export function writeFileAtomic(path: string, data: string | Uint8Array): void {
  ensureDir(dirname(path))
  const temp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`)
  writeFileSync(temp, data)
  renameSync(temp, path)
}

/** Refuse a relative artifact path that escapes its capture directory. */
function assertRelativeInside(path: string): void {
  const normalized = normalize(path)
  if (isAbsolute(normalized) || normalized === '..' || normalized.startsWith(`..${sep}`) || normalized.split(sep).includes('..')) {
    throw new Error(`artifact path must stay inside the capture directory: ${path}`)
  }
}

/**
 * Copy one allowlisted diagnostic file out of a profile's logs dir into
 * the capture directory. JSONL families are copied line by line: every
 * complete valid record is kept, a torn tail is dropped and reported as
 * `complete: false`, and text is redacted. A screenshot is copied whole.
 * A file outside the allowlist is refused rather than copied.
 */
export function archiveLogFile(sourcePath: string, captureDir: string, options: ArchiveOptions = {}): LiveArtifactReference {
  const name = basename(sourcePath)
  const entry = ARCHIVE_FAMILIES.find((candidate) => candidate.pattern.test(name))
  if (entry === undefined) throw new Error(`refusing to archive ${name}: not a diagnostic family file`)
  const relativePath = join('logs', name)
  const destination = join(captureDir, relativePath)
  if (entry.jsonl) {
    const parsed = parseJsonl(readFileSync(sourcePath, 'utf8'))
    const redacted = parsed.keptLines.map((line) => redactText(line, options.secrets))
    const text = redacted.length === 0 ? '' : `${redacted.join('\n')}\n`
    writeFileAtomic(destination, text)
    const notes: string[] = []
    if (parsed.tornTail) notes.push('torn final line dropped')
    if (parsed.malformed > 0) notes.push(`${parsed.malformed} malformed line(s) dropped`)
    return {
      path: relativePath,
      family: entry.family,
      locator: name,
      digest: digestOf(text),
      bytes: Buffer.byteLength(text),
      complete: !parsed.tornTail && parsed.malformed === 0,
      redacted: true,
      ...(notes.length > 0 ? { note: notes.join('; ') } : {}),
    }
  }
  const bytes = readFileSync(sourcePath)
  writeFileAtomic(destination, bytes)
  return { path: relativePath, family: entry.family, locator: name, digest: digestOf(bytes), bytes: bytes.length, complete: true }
}

export interface ArchivedLogs {
  readonly artifacts: readonly LiveArtifactReference[]
  /** Files the archiver could not copy, with a redacted reason each. */
  readonly failures: readonly { readonly name: string; readonly reason: string }[]
  /** Files present in the logs dir that no family claims — listed, never copied. */
  readonly skipped: readonly string[]
}

/**
 * Archive every allowlisted file in one profile logs directory. Never
 * recursive, never anything but the named families; a missing logs dir
 * is an empty archive, and a file that fails to copy is reported rather
 * than fatal — the caller decides what an incomplete archive means.
 */
export function archiveLogsDir(logsDir: string, captureDir: string, options: ArchiveOptions = {}): ArchivedLogs {
  let names: string[]
  try {
    names = readdirSync(logsDir).sort()
  } catch {
    return { artifacts: [], failures: [], skipped: [] }
  }
  const artifacts: LiveArtifactReference[] = []
  const failures: { name: string; reason: string }[] = []
  const skipped: string[] = []
  for (const name of names) {
    const path = join(logsDir, name)
    if (archiveFamilyOf(name) === null || !statSync(path).isFile()) {
      skipped.push(name)
      continue
    }
    try {
      artifacts.push(archiveLogFile(path, captureDir, options))
    } catch (error) {
      failures.push({ name, reason: redactedMessage(error, options.secrets) })
    }
  }
  return { artifacts, failures, skipped }
}

/**
 * Archive the app's daily usage ledger (`usage.json`) if present. Kept
 * for provenance only: the ledger turns missing usage into zero, so it
 * never establishes per-attempt spend — `llm_round` records do.
 */
export function archiveUsageLedger(userDataDir: string, captureDir: string): LiveArtifactReference | null {
  const source = join(userDataDir, 'usage.json')
  if (!existsSync(source)) return null
  const text = readFileSync(source, 'utf8')
  const relativePath = 'usage.json'
  writeFileAtomic(join(captureDir, relativePath), text)
  return { path: relativePath, family: 'usage_ledger', locator: 'usage.json', digest: digestOf(text), bytes: Buffer.byteLength(text), complete: true }
}

/** Write one text artifact (stderr tail, provenance) under the capture dir, redacted. */
export function writeTextArtifact(
  captureDir: string,
  relativePath: string,
  family: LiveArtifactFamily,
  text: string,
  options: ArchiveOptions & { readonly complete?: boolean; readonly note?: string } = {},
): LiveArtifactReference {
  assertRelativeInside(relativePath)
  const redacted = redactText(text, options.secrets)
  writeFileAtomic(join(captureDir, relativePath), redacted)
  return {
    path: relativePath,
    family,
    digest: digestOf(redacted),
    bytes: Buffer.byteLength(redacted),
    complete: options.complete ?? true,
    redacted: true,
    ...(options.note !== undefined ? { note: options.note } : {}),
  }
}

/** Write an attempt's event tape beside the capture, redacted. */
export function writeEventTape(captureDir: string, tape: LiveEventTape, options: ArchiveOptions = {}): LiveArtifactReference {
  const relativePath = join('events', `${tape.attemptId}.json`)
  const text = redactText(`${JSON.stringify(tape, null, 2)}\n`, options.secrets)
  writeFileAtomic(join(captureDir, relativePath), text)
  return { path: relativePath, family: 'events', digest: digestOf(text), bytes: Buffer.byteLength(text), complete: true, redacted: true }
}

// ---------------------------------------------------------------------------
// Capture directories and files

/** A capture id safe as a directory name. */
const CAPTURE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/

/**
 * Claim a new capture directory under `root`. Refused when anything —
 * a complete capture, a partial one, an unrelated file — already holds
 * that identity: an identity is never reused, and a second run aimed at
 * an existing one fails before any launch.
 */
export function claimCaptureDir(root: string, captureId: string): string {
  if (!CAPTURE_ID_PATTERN.test(captureId)) throw new Error(`capture id is not a safe directory name: ${captureId}`)
  const dir = join(root, captureId)
  if (existsSync(dir)) throw new Error(`refusing to reuse capture identity ${captureId}: ${dir} already exists`)
  ensureDir(dir)
  return dir
}

/** Write (or re-checkpoint) the owning handle's capture file, atomically. */
export function writeSessionCapture(captureDir: string, capture: LiveSessionCapture, options: ArchiveOptions = {}): string {
  const path = join(captureDir, SESSION_CAPTURE_FILE)
  writeFileAtomic(path, redactText(`${JSON.stringify(capture, null, 2)}\n`, options.secrets))
  return path
}

/** Write a capture set file, atomically. The scheduler (#225) owns when. */
export function writeCaptureSet(path: string, set: LiveCaptureSet): string {
  writeFileAtomic(path, `${JSON.stringify(set, null, 2)}\n`)
  return path
}

// ---------------------------------------------------------------------------
// Validation and reading

export type Validation<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly string[] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

const RELATIONS: readonly AttemptRelation[] = ['initial', 'revised_objective', 'corrective']
const OBSERVED_STATUSES = ['observed', 'unavailable', 'invalid', 'not_applicable'] as const

function checkObserved(value: unknown, at: string, errors: string[]): void {
  if (!isRecord(value) || !(OBSERVED_STATUSES as readonly unknown[]).includes(value.status)) {
    errors.push(`${at}: not an Observed figure`)
    return
  }
  if (value.status === 'observed' && !('value' in value)) errors.push(`${at}: observed without a value`)
  if (value.status !== 'observed' && !nonEmptyString(value.reason)) errors.push(`${at}: ${String(value.status)} without a reason`)
}

function checkPrompt(value: unknown, at: string, errors: string[]): void {
  if (!isRecord(value) || !nonEmptyString(value.version) || !/^sha256:[0-9a-f]{64}$/.test(String(value.hash))) {
    errors.push(`${at}: prompt identity needs a version and a sha256 hash`)
  }
}

/**
 * Check the planned population of a set: unique ids, an `initial` with
 * no parent, every other relation with a parent that exists earlier in
 * the order. Shared by the set and the session readers.
 */
function checkSlots(slots: readonly LiveScheduledAttempt[], at: string, errors: string[]): void {
  const seen = new Set<string>()
  slots.forEach((slot, index) => {
    const here = `${at}[${index}]`
    if (!isRecord(slot)) {
      errors.push(`${here}: not an object`)
      return
    }
    if (!nonEmptyString(slot.attemptId)) errors.push(`${here}: attemptId missing`)
    else if (seen.has(slot.attemptId)) errors.push(`${here}: duplicate attemptId ${slot.attemptId}`)
    if (!nonEmptyString(slot.huntId)) errors.push(`${here}: huntId missing`)
    if (!nonEmptyString(slot.stepId)) errors.push(`${here}: stepId missing`)
    if (typeof slot.order !== 'number' || !Number.isInteger(slot.order) || slot.order < 0) errors.push(`${here}: order must be a non-negative integer`)
    if (!RELATIONS.includes(slot.relation)) errors.push(`${here}: unknown relation ${String(slot.relation)}`)
    checkPrompt(slot.prompt, `${here}.prompt`, errors)
    if (slot.relation === 'initial' && slot.parentAttemptId !== undefined) errors.push(`${here}: an initial attempt has no parent`)
    if (slot.relation !== 'initial') {
      if (!nonEmptyString(slot.parentAttemptId)) errors.push(`${here}: ${String(slot.relation)} needs a parentAttemptId`)
      else if (!seen.has(slot.parentAttemptId)) errors.push(`${here}: parent ${slot.parentAttemptId} is not an earlier attempt`)
    }
    if (nonEmptyString(slot.attemptId)) seen.add(slot.attemptId)
  })
}

function checkHeader(value: Record<string, unknown>, kind: string, errors: string[]): void {
  if (value.kind !== kind) errors.push(`kind is ${String(value.kind)}, expected ${kind}`)
  if (value.schemaVersion !== LIVE_CAPTURE_SCHEMA_VERSION) {
    errors.push(`schemaVersion is ${String(value.schemaVersion)}, this reader understands ${LIVE_CAPTURE_SCHEMA_VERSION} only`)
  }
  if (value.mode !== 'measured' && value.mode !== 'verification') errors.push(`mode is ${String(value.mode)}`)
}

function checkArtifacts(value: unknown, at: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${at}: not an array`)
    return
  }
  value.forEach((artifact, index) => {
    const here = `${at}[${index}]`
    if (!isRecord(artifact)) {
      errors.push(`${here}: not an object`)
      return
    }
    if (!nonEmptyString(artifact.path)) errors.push(`${here}: path missing`)
    else {
      try {
        assertRelativeInside(artifact.path)
      } catch (error) {
        errors.push(`${here}: ${(error as Error).message}`)
      }
    }
    if (!nonEmptyString(artifact.family)) errors.push(`${here}: family missing`)
    if (!/^sha256:[0-9a-f]{64}$/.test(String(artifact.digest))) errors.push(`${here}: digest is not sha256`)
    if (typeof artifact.bytes !== 'number') errors.push(`${here}: bytes missing`)
    if (typeof artifact.complete !== 'boolean') errors.push(`${here}: complete missing`)
  })
}

/** Validate a parsed capture-set object. */
export function validateCaptureSet(value: unknown): Validation<LiveCaptureSet> {
  const errors: string[] = []
  if (!isRecord(value)) return { ok: false, errors: ['not an object'] }
  checkHeader(value, LIVE_CAPTURE_SET_KIND, errors)
  if (!nonEmptyString(value.setId)) errors.push('setId missing')
  if (!isRecord(value.study) || !nonEmptyString(value.study.name) || !nonEmptyString(value.study.protocolVersion)) {
    errors.push('study needs a name and a protocolVersion')
  }
  if (!nonEmptyString(value.createdAt)) errors.push('createdAt missing')
  if (!Array.isArray(value.slots)) errors.push('slots is not an array')
  else checkSlots(value.slots as LiveScheduledAttempt[], 'slots', errors)
  if (!Array.isArray(value.sessions)) errors.push('sessions is not an array')
  else {
    ;(value.sessions as unknown[]).forEach((session, index) => {
      if (!isRecord(session) || !nonEmptyString(session.captureId) || !nonEmptyString(session.huntId) || !nonEmptyString(session.path)) {
        errors.push(`sessions[${index}]: needs captureId, huntId and path`)
      } else {
        try {
          assertRelativeInside(session.path)
        } catch (error) {
          errors.push(`sessions[${index}]: ${(error as Error).message}`)
        }
      }
    })
  }
  if (!['in_progress', 'complete', 'interrupted', 'measurement_failed'].includes(String(value.state))) errors.push(`state is ${String(value.state)}`)
  return errors.length === 0 ? { ok: true, value: value as unknown as LiveCaptureSet } : { ok: false, errors }
}

/** Validate a parsed session-capture object. */
export function validateSessionCapture(value: unknown): Validation<LiveSessionCapture> {
  const errors: string[] = []
  if (!isRecord(value)) return { ok: false, errors: ['not an object'] }
  checkHeader(value, LIVE_SESSION_CAPTURE_KIND, errors)
  if (!nonEmptyString(value.captureId)) errors.push('captureId missing')
  if (!nonEmptyString(value.huntId)) errors.push('huntId missing')
  if (!nonEmptyString(value.startedAt)) errors.push('startedAt missing')
  if (!isRecord(value.launch)) errors.push('launch provenance missing')
  else {
    const launch = value.launch
    if (!nonEmptyString(launch.commit)) errors.push('launch.commit missing')
    if (typeof launch.dirtyTree !== 'boolean') errors.push('launch.dirtyTree missing')
    if (!isRecord(launch.roles)) errors.push('launch.roles missing')
    else {
      for (const role of ['orchestrator', 'subagent', 'vision']) {
        const entry = launch.roles[role]
        if (!isRecord(entry) || typeof entry.configured !== 'boolean') errors.push(`launch.roles.${role} missing`)
        else if (entry.configured && (!nonEmptyString(entry.baseUrl) || !nonEmptyString(entry.model) || !nonEmptyString(entry.keyFingerprint))) {
          errors.push(`launch.roles.${role}: a configured role names baseUrl, model and keyFingerprint`)
        }
      }
    }
    if (launch.mode !== value.mode) errors.push('launch.mode disagrees with the capture mode')
    if (value.mode === 'measured' && Array.isArray(launch.scriptedHooks) && launch.scriptedHooks.length > 0) {
      errors.push('a measured capture carries scripted hooks')
    }
    if (value.mode === 'measured' && isRecord(launch.effortOverrides) && Object.keys(launch.effortOverrides).length > 0) {
      errors.push('a measured capture carries effort overrides')
    }
  }
  if (!Array.isArray(value.attempts)) errors.push('attempts is not an array')
  else {
    const records = value.attempts as Record<string, unknown>[]
    // An attempt record is its own slot: same identity fields, with the
    // prompt identity under `command`.
    const slots = records.filter(isRecord).map((attempt) => ({
      ...attempt,
      prompt: isRecord(attempt.command) ? attempt.command.prompt : undefined,
    })) as unknown as LiveScheduledAttempt[]
    checkSlots(slots, 'attempts', errors)
    records.forEach((attempt, index) => {
      const here = `attempts[${index}]`
      if (!isRecord(attempt)) return
      if (attempt.kind === 'attempt') {
        for (const field of ['accepted', 'finalAnswer', 'terminal', 'settlement']) checkObserved(attempt[field], `${here}.${field}`, errors)
        if (!isRecord(attempt.stop) || !nonEmptyString(attempt.stop.reason)) errors.push(`${here}.stop missing`)
        if (!isRecord(attempt.continuation) || typeof attempt.continuation.ready !== 'boolean') errors.push(`${here}.continuation missing`)
        if (!isRecord(attempt.metrics)) errors.push(`${here}.metrics missing`)
        else {
          for (const field of ['acceptedAt', 'finalAnswerAt', 'terminalAt', 'answerLatencyMs', 'runDurationMs', 'userWaitMs']) {
            checkObserved(attempt.metrics[field], `${here}.metrics.${field}`, errors)
          }
          if ('taskSuccess' in attempt.metrics || 'success' in attempt.metrics) errors.push(`${here}.metrics: a raw capture carries no Task Success`)
        }
        const accepted = attempt.accepted as Record<string, unknown> | undefined
        if (isRecord(accepted) && accepted.status === 'observed') {
          const identity = accepted.value
          if (!isRecord(identity) || !nonEmptyString(identity.runId) || !nonEmptyString(identity.sessionId) || !nonEmptyString(identity.turnId) || typeof identity.at !== 'number') {
            errors.push(`${here}.accepted: an observed acceptance names at, turnId, runId and sessionId`)
          }
        }
      } else if (attempt.kind === 'not_reached') {
        if (!nonEmptyString(attempt.reason)) errors.push(`${here}: a not-reached slot needs a reason`)
        for (const forbidden of ['accepted', 'finalAnswer', 'terminal', 'metrics']) {
          if (forbidden in attempt) errors.push(`${here}: a not-reached slot carries ${forbidden}`)
        }
      } else {
        errors.push(`${here}: kind is ${String(attempt.kind)}`)
      }
    })
  }
  checkArtifacts(value.artifacts, 'artifacts', errors)
  if (!['open', 'closed', 'interrupted', 'launch_failed'].includes(String(value.closeState))) errors.push(`closeState is ${String(value.closeState)}`)
  if (!isRecord(value.retention) || typeof value.retention.complete !== 'boolean') errors.push('retention missing')
  return errors.length === 0 ? { ok: true, value: value as unknown as LiveSessionCapture } : { ok: false, errors }
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** Load and validate one session capture from its `capture.json` or its directory. */
export function readSessionCapture(path: string): Validation<LiveSessionCapture> {
  const file = existsSync(path) && statSync(path).isDirectory() ? join(path, SESSION_CAPTURE_FILE) : path
  let parsed: unknown
  try {
    parsed = readJson(file)
  } catch (error) {
    return { ok: false, errors: [`${file}: ${(error as Error).message}`] }
  }
  return validateSessionCapture(parsed)
}

/** Load and validate one capture set, plus every session it references (relative to it). */
export function readCaptureSet(path: string): Validation<{ set: LiveCaptureSet; sessions: readonly Validation<LiveSessionCapture>[] }> {
  let parsed: unknown
  try {
    parsed = readJson(path)
  } catch (error) {
    return { ok: false, errors: [`${path}: ${(error as Error).message}`] }
  }
  const set = validateCaptureSet(parsed)
  if (!set.ok) return set
  const sessions = set.value.sessions.map((reference) => readSessionCapture(resolve(dirname(path), reference.path)))
  return { ok: true, value: { set: set.value, sessions } }
}

/** Every session capture directory under a root, by name. */
export function listSessionCaptures(root: string): string[] {
  try {
    return readdirSync(root)
      .filter((name) => existsSync(join(root, name, SESSION_CAPTURE_FILE)))
      .sort()
      .map((name) => join(root, name))
  } catch {
    return []
  }
}

/** Verify that every artifact a capture names exists beside it with the digest it recorded. */
export function verifyArtifacts(captureDir: string, capture: LiveSessionCapture): readonly string[] {
  const problems: string[] = []
  for (const artifact of capture.artifacts) {
    const path = join(captureDir, artifact.path)
    if (!existsSync(path)) {
      problems.push(`${artifact.path}: missing`)
      continue
    }
    const digest = digestOf(readFileSync(path))
    if (digest !== artifact.digest) problems.push(`${artifact.path}: digest ${digest} != recorded ${artifact.digest}`)
  }
  return problems
}

/** A path made relative to the repo root for provenance text; absolute paths never enter a capture. */
export function repoRelative(path: string): string {
  return relative(repoRoot, path)
}
