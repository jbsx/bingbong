// The Grading Bench server (#228, #229): the loopback door between the pages
// and the files. `scripts/live-review.ts` listens on 127.0.0.1 with the setup
// door (`openGradingSetup`) in front of the bench (`openGradingBench`): the
// setup page proposes a capture set, a reviewer, a grades file and another
// reviewer's Grade to compare against from the two roots, and only Start
// opens a bench on them. What the setup decides is
// in `gradingSetup.ts`, what the bench decides is in `gradingBench.ts`, and
// everything either validates is `grades.ts`'s own `parseLiveGrades`.
//
// What it guarantees, and where:
//
//   - Before Start it only reads: the two roots' top-level JSON files, and
//     each set that can be started, as a bench would open it. A bench opens
//     on one set, one reviewer and one grades file, fixed for its life.
//   - A bench reads only the capture set it was opened on (and the Session
//     captures and artifacts the set itself names), its grades file, sidecar
//     and comparison file, and writes exactly two files: the grades file,
//     and the drafts sidecar beside it. Nothing it reads — an Answer, a
//     page, the key — is ever written anywhere else, logged, or printed.
//   - The grades file is written only with a set that `parseLiveGrades`
//     accepted, so it is always one `pnpm live:report` accepts. Half-done
//     work goes to the sidecar.
//   - It refuses to open another reviewer's grades file, and it never sends
//     the comparison Grade for a slot until this reviewer's own entry for
//     that slot is saved.
//   - It answers only requests addressed to loopback, from its own pages:
//     a browser tab on another site cannot read the key or post a Grade.
//
// The Answer is rendered with the app's own `react-markdown` through
// `react-dom/server`, so the reviewer grades what the Feed would have shown.
// Only the server touches React; the pages stay plain DOM. Links open in a
// new tab. The Answer digest is always taken over the raw text.
//
// NOTHING HERE LOADS A KEY: the keys arrive as `keyFor`, and the manifest
// built from them in memory, from the CLI.

import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Markdown, { type Components } from 'react-markdown'
import type { PipelineEvent } from '../../src/core/pipeline/events'
import { digestOf, readCaptureSet, redactedMessage, writeFileAtomic, type Validation } from './artifacts.ts'
import {
  allowedStatusesFor,
  compareGrades,
  dispatchedAttemptOf,
  draftsPathFor,
  editorStateOf,
  emptyDrafts,
  evidenceTrailOf,
  gradesWith,
  keyViewFor,
  parseDrafts,
  reviewerRefusal,
  sanitizeEditorState,
  slotSummariesOf,
  withDraft,
  withoutDraft,
  type BenchDrafts,
  type BenchEditorState,
  type BenchKey,
  type BenchSlot,
  type BenchSlotSummary,
  type EvidenceTrail,
} from './gradingBench.ts'
import {
  indexAttempts,
  initializeLiveGrades,
  isReviewed,
  keyManifestDigest,
  parseLiveGrades,
  parseLiveKeyManifest,
  type LiveGrades,
  type LiveGradingInputs,
  type LiveKeyManifest,
} from './grades.ts'
import {
  captureSetsIn,
  comparisonsOfferedFor,
  preselectedComparisonFile,
  preselectedSetFile,
  progressOf,
  resolveGradesFile,
  reviewerCaution,
  type RootFile,
  type SetupSet,
} from './gradingSetup.ts'
import { buildLiveReport, type LivePopulation } from './report.ts'
import type { LiveAttemptCapture } from './types.ts'

export interface GradingBenchOptions {
  readonly capturePath: string
  /**
   * The key manifest, built in memory from the same keys `keyFor` reads —
   * so key prose and check wording cannot disagree, and there is no file
   * to name. The CLI builds it; a test passes an invented one.
   */
  readonly manifest: LiveKeyManifest
  readonly gradesPath: string
  /** Another reviewer's grades file, shown slot by slot only after this reviewer saves. */
  readonly comparePath?: string
  readonly reviewer: string
  /** The substantive key for a hunt. The CLI passes the corpus's; a test passes an invented one. */
  readonly keyFor: (huntId: string) => BenchKey | undefined
  readonly pageHtml: string
  readonly now?: () => Date
}

export interface GradingBench {
  readonly setId: string
  readonly reviewer: string
  readonly gradesPath: string
  readonly draftsPath: string
  /** The other reviewer's grades file shown beside this reviewer's, or null for none. */
  readonly comparePath: string | null
  /** Every slot with this reviewer's state on it, as the sidebar shows them. */
  readonly slots: () => readonly BenchSlotSummary[]
  readonly handle: (request: IncomingMessage, response: ServerResponse) => void
}

/** Generous for a Grade with every note typed out; fatal for anything else. */
const BODY_LIMIT_BYTES = 1_000_000

/** An attempt's evidence trail as read from its tape, or null with the reason it could not be. */
type TrailRead = { readonly trail: EvidenceTrail | null; readonly note: string | null }

/** The hostnames a request may be addressed to, and an Origin may name. */
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]'])

/**
 * The Feed's markdown (`src/renderer/src/FeedMarkdown.tsx`), minus the
 * click handler that steers the app's browser pane: here a link opens a new
 * tab. Same library, same default plugins, same default URL sanitizing.
 */
const ANSWER_COMPONENTS: Components = {
  a: ({ href, children }) => createElement('a', { href, target: '_blank', rel: 'noopener noreferrer' }, children),
}

/** An Answer as the Feed renders it, as static HTML. Raw HTML in the Answer is escaped, never rendered. */
export function renderAnswerHtml(text: string): string {
  return renderToStaticMarkup(
    createElement('div', { className: 'feed-markdown' }, createElement(Markdown, { components: ANSWER_COMPONENTS, children: text })),
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function refused(context: string, errors: readonly string[]): Validation<never> {
  return { ok: false, errors: errors.map((error) => `${context}: ${error}`) }
}

/** Read a JSON input. A parse failure names the file, never its contents: these files carry key material and Answers. */
function readJsonInput(path: string, what: string): Validation<{ text: string; value: unknown }> {
  if (!existsSync(path)) return { ok: false, errors: [`the ${what} does not exist at ${path}`] }
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    return { ok: false, errors: [`the ${what} at ${path} could not be read: ${redactedMessage(error)}`] }
  }
  try {
    return { ok: true, value: { text, value: JSON.parse(text) } }
  } catch {
    return { ok: false, errors: [`the ${what} at ${path} is not valid JSON`] }
  }
}

/** Where a path lands on disk, through symlinks, whether or not the file exists yet. */
function targetOf(path: string): string {
  if (existsSync(path)) return realpathSync(path)
  const directory = dirname(resolve(path))
  return join(existsSync(directory) ? realpathSync(directory) : directory, basename(path))
}

function hostnameOf(value: string): string | null {
  try {
    return new URL(value).hostname
  } catch {
    return null
  }
}

/**
 * Why a request is not the reviewer's own page talking to this machine, or
 * null. The Host check refuses a DNS-rebound name; the Origin check refuses
 * a page on another site. A cross-site form cannot send JSON without a
 * preflight, which this server never answers, so the content-type check on
 * writes closes the last route.
 */
function requestRefusal(request: IncomingMessage): string | null {
  const host = request.headers.host
  if (host === undefined || !LOOPBACK_HOSTNAMES.has(hostnameOf(`http://${host}`) ?? '')) {
    return 'the bench answers only requests addressed to this machine’s loopback address'
  }
  const origin = request.headers.origin
  if (origin !== undefined && !LOOPBACK_HOSTNAMES.has(hostnameOf(origin) ?? '')) return 'the bench answers only its own page'
  return null
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(body))
}

type Body = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly status: number; readonly error: string }

function readBody(request: IncomingMessage): Promise<Body> {
  return new Promise((settle) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    const finish = (body: Body): void => {
      if (settled) return
      settled = true
      settle(body)
    }
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > BODY_LIMIT_BYTES) finish({ ok: false, status: 413, error: 'the request body is too large' })
      else chunks.push(chunk)
    })
    request.on('end', () => {
      try {
        finish({ ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) })
      } catch {
        finish({ ok: false, status: 400, error: 'the request body is not valid JSON' })
      }
    })
    request.on('error', (error) => finish({ ok: false, status: 400, error: redactedMessage(error) }))
  })
}

/** A JSON write: a cross-site form cannot send one without a preflight this server never answers. */
function isJsonRequest(request: IncomingMessage): boolean {
  return (request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')
}

/** A request handler whose failure is answered, never left hanging or thrown into the server. */
function guarded(serve: (request: IncomingMessage, response: ServerResponse) => Promise<void>): (request: IncomingMessage, response: ServerResponse) => void {
  return (request, response) => {
    serve(request, response).catch((error: unknown) => {
      if (response.headersSent) response.end()
      else send(response, 500, { error: `the bench failed: ${redactedMessage(error)}` })
    })
  }
}

/** The counts `pnpm live:report` reports for a population, which the sidebar shows beside the slots. */
function countsOf(population: LivePopulation): { scheduled: number; reviewed: number; pending: number; verifiedSuccess: number } {
  return { scheduled: population.scheduled, reviewed: population.reviewed, pending: population.pending, verifiedSuccess: population.verifiedSuccess }
}

/**
 * Open a bench over one capture set, one key manifest and one reviewer's
 * grades file. Everything that could make a later save impossible or wrong
 * is refused here, before a page is served.
 */
export function openGradingBench(options: GradingBenchOptions): Validation<GradingBench> {
  const now = options.now ?? (() => new Date())
  const reviewer = options.reviewer.trim()
  if (reviewer === '') return { ok: false, errors: ['no reviewer is named, and an entry naming no one cannot be saved'] }

  if (!existsSync(options.capturePath)) return { ok: false, errors: [`the capture set does not exist at ${options.capturePath}`] }
  const capture = readCaptureSet(options.capturePath)
  if (!capture.ok) return refused('the capture set is not usable', capture.errors)
  const sessionErrors = capture.value.sessions.flatMap((session) => (session.ok ? [] : session.errors))
  if (sessionErrors.length > 0) return refused('a Session capture the set references does not validate', sessionErrors)
  const sessions = capture.value.sessions.flatMap((session) => (session.ok ? [session.value] : []))
  const set = capture.value.set

  const parsedManifest = parseLiveKeyManifest(options.manifest)
  if (!parsedManifest.ok) return refused('the key manifest is not usable', parsedManifest.errors)
  const manifest = parsedManifest.value
  const inputs: LiveGradingInputs = { set, sessions, manifest }

  // Every scheduled slot has to be judgeable: a step in the manifest to give
  // it checks, and a key for the reviewer to read those checks against.
  const tasks = new Map(manifest.tasks.map((task) => [`${task.huntId}/${task.stepId}`, task]))
  const keys = new Map<string, BenchKey>()
  const keyless = new Set<string>()
  const problems: string[] = []
  for (const slot of set.slots) {
    if (!tasks.has(`${slot.huntId}/${slot.stepId}`)) {
      problems.push(`the key manifest declares no task for ${slot.huntId}/${slot.stepId}, so slot ${slot.attemptId} has no checks to judge`)
    }
    if (keys.has(slot.huntId) || keyless.has(slot.huntId)) continue
    const key = options.keyFor(slot.huntId)
    if (key !== undefined) {
      keys.set(slot.huntId, key)
    } else {
      keyless.add(slot.huntId)
      problems.push(`there is no grading key for hunt ${slot.huntId}`)
    }
  }
  if (problems.length > 0) return refused('the bench cannot put a key beside every slot', problems)

  const gradesPath = resolve(options.gradesPath)
  const draftsPath = draftsPathFor(gradesPath)
  const comparePath = options.comparePath === undefined ? undefined : resolve(options.comparePath)
  const setDirectory = dirname(resolve(options.capturePath))
  const sessionDirectories = new Map(set.sessions.map((reference) => [reference.captureId, dirname(resolve(setDirectory, reference.path))]))

  // The two files the bench writes may never be a file it reads.
  const readPaths = [
    options.capturePath,
    ...(comparePath === undefined ? [] : [comparePath]),
    ...set.sessions.map((reference) => resolve(setDirectory, reference.path)),
    ...sessions.flatMap((session) => {
      const directory = sessionDirectories.get(session.captureId) ?? setDirectory
      return [
        ...session.artifacts.map((artifact) => join(directory, artifact.path)),
        ...session.attempts.flatMap((record) => (record.kind === 'attempt' && record.events !== null ? [join(directory, record.events.path)] : [])),
      ]
    }),
  ]
  for (const written of [gradesPath, draftsPath]) {
    if (readPaths.some((path) => existsSync(path) && targetOf(path) === targetOf(written))) {
      problems.push(`refusing to write ${written}, which is a file the bench reads`)
    }
  }
  if (problems.length > 0) return { ok: false, errors: problems }

  const opened = parseLiveGrades(initializeLiveGrades(inputs), inputs)
  if (!opened.ok) return refused('the capture set cannot be graded against this key manifest', opened.errors)
  let grades: LiveGrades = opened.value
  /** The grades file as the bench last read or wrote it; a save refuses a file that changed underneath. */
  let gradesText: string | null = null
  if (existsSync(gradesPath)) {
    const input = readJsonInput(gradesPath, 'grades file')
    if (!input.ok) return input
    const parsed = parseLiveGrades(input.value.value, inputs)
    if (!parsed.ok) return refused('the grades file does not validate against this capture set and key manifest', parsed.errors)
    const refusal = reviewerRefusal(parsed.value, reviewer)
    if (refusal !== null) return { ok: false, errors: [refusal] }
    grades = parsed.value
    gradesText = input.value.text
  }

  let other: LiveGrades | null = null
  if (comparePath !== undefined) {
    if (targetOf(comparePath) === targetOf(gradesPath)) {
      return { ok: false, errors: ['the file to compare against is the grades file itself — compare against another reviewer’s grades'] }
    }
    const input = readJsonInput(comparePath, 'grades file to compare against')
    if (!input.ok) return input
    const parsed = parseLiveGrades(input.value.value, inputs)
    if (!parsed.ok) return refused('the grades to compare against do not validate against this capture set and key manifest', parsed.errors)
    // The comparison is another reviewer's Grade: a file holding this
    // reviewer's own reviews is not a second opinion, and its per-check diff
    // would read as agreement nobody else gave.
    if (parsed.value.entries.some((entry) => entry.reviewer === reviewer)) {
      return { ok: false, errors: [`the grades to compare against hold reviews by ${reviewer}, the reviewer at this bench — compare against another reviewer's grades`] }
    }
    other = parsed.value
  }

  const { byAttemptId } = indexAttempts(sessions)
  const benchSlotOf = (attemptId: string): BenchSlot | null => {
    const slot = set.slots.find((candidate) => candidate.attemptId === attemptId)
    if (slot === undefined) return null
    return { slot, dispatched: byAttemptId.get(attemptId), task: tasks.get(`${slot.huntId}/${slot.stepId}`)! }
  }

  const binding = { setId: set.setId, keyManifestDigest: keyManifestDigest(manifest), reviewer }
  let drafts: BenchDrafts = emptyDrafts(binding)
  if (existsSync(draftsPath)) {
    const input = readJsonInput(draftsPath, 'drafts sidecar')
    if (!input.ok) return input
    const parsed = parseDrafts(input.value.value, binding, (attemptId) => {
      const bench = benchSlotOf(attemptId)
      return bench !== null && dispatchedAttemptOf(bench.dispatched) !== null ? bench.task : undefined
    })
    if (!parsed.ok) return refused(`the drafts in ${basename(draftsPath)} are not usable (move the file aside to start those slots over)`, parsed.errors)
    drafts = parsed.value
  }

  const renderedAnswers = new Map<string, string>()
  const trails = new Map<string, TrailRead>()

  function answerView(attempt: LiveAttemptCapture | null): { text: string; html: string; at: number; digest: string } | null {
    if (attempt === null || attempt.finalAnswer.status !== 'observed') return null
    const { text, at } = attempt.finalAnswer.value
    let html = renderedAnswers.get(attempt.attemptId)
    if (html === undefined) {
      html = renderAnswerHtml(text)
      renderedAnswers.set(attempt.attemptId, html)
    }
    return { text, html, at, digest: digestOf(text) }
  }

  function trailOf(attempt: LiveAttemptCapture, captureId: string): TrailRead {
    const cached = trails.get(attempt.attemptId)
    if (cached !== undefined) return cached
    const read = (): TrailRead => {
      if (attempt.events === null) return { trail: null, note: 'the capture retained no event tape for this attempt' }
      const directory = sessionDirectories.get(captureId) ?? setDirectory
      const path = resolve(directory, attempt.events.path)
      if (!path.startsWith(`${directory}${sep}`)) return { trail: null, note: 'the event tape’s path leaves its capture directory, so it was not read' }
      if (!existsSync(path)) return { trail: null, note: `the event tape ${attempt.events.path} is missing from the capture` }
      const bytes = readFileSync(path)
      let tape: unknown
      try {
        tape = JSON.parse(bytes.toString('utf8'))
      } catch {
        return { trail: null, note: `the event tape ${attempt.events.path} is not valid JSON` }
      }
      if (!isRecord(tape) || !Array.isArray(tape.events)) return { trail: null, note: `the event tape ${attempt.events.path} holds no events` }
      const trail = evidenceTrailOf((tape.events as unknown[]).filter(isRecord) as unknown as PipelineEvent[])
      const note = digestOf(bytes) === attempt.events.digest ? null : 'the event tape no longer matches the digest the capture recorded — it changed after capture'
      return { trail, note }
    }
    const result = read()
    trails.set(attempt.attemptId, result)
    return result
  }

  /** A failure screenshot belongs to the attempt whose Run id its file name carries. */
  function screenshotsOf(attempt: LiveAttemptCapture, captureId: string): { name: string; path: string }[] {
    if (attempt.accepted.status !== 'observed') return []
    const runId = attempt.accepted.value.runId
    const session = sessions.find((candidate) => candidate.captureId === captureId)
    const directory = sessionDirectories.get(captureId) ?? setDirectory
    return (session?.artifacts ?? [])
      .filter((artifact) => artifact.family === 'screenshot' && basename(artifact.path).includes(runId))
      .map((artifact) => ({ name: basename(artifact.path), path: resolve(directory, artifact.path) }))
  }

  function problemsOf(state: BenchEditorState, bench: BenchSlot): readonly string[] {
    const result = gradesWith(state, bench, grades, inputs, reviewer, now().toISOString())
    return result.ok ? [] : result.errors
  }

  function draftOf(attemptId: string) {
    return Object.hasOwn(drafts.drafts, attemptId) ? drafts.drafts[attemptId] : undefined
  }

  function summaryOf(attemptId: string) {
    return slotSummariesOf(inputs, grades, drafts).find((summary) => summary.attemptId === attemptId)!
  }

  function setView() {
    const report = buildLiveReport({ set, sessions, grades, manifest, generatedAt: now().toISOString() })
    return {
      setId: set.setId,
      reviewer,
      gradesFile: basename(gradesPath),
      draftsFile: basename(draftsPath),
      comparing: other !== null,
      slots: slotSummariesOf(inputs, grades, drafts),
      populations: report.ok
        ? {
            initial: countsOf(report.value.populations.initial),
            revisedObjective: countsOf(report.value.populations.revisedObjective),
            bothStep: countsOf(report.value.populations.bothStep),
          }
        : null,
    }
  }

  function attemptView(bench: BenchSlot) {
    const { slot, dispatched, task } = bench
    const attempt = dispatchedAttemptOf(dispatched)
    const entry = grades.entries.find((candidate) => candidate.attemptId === slot.attemptId)
    const editor = attempt === null ? null : editorStateOf(task, entry, draftOf(slot.attemptId))
    const parent = slot.parentAttemptId === undefined ? null : benchSlotOf(slot.parentAttemptId)
    const trail = attempt === null || dispatched === undefined ? { trail: null, note: null } : trailOf(attempt, dispatched.captureId)
    const screenshots = attempt === null || dispatched === undefined ? [] : screenshotsOf(attempt, dispatched.captureId)
    return {
      slot: summaryOf(slot.attemptId),
      command: dispatched?.record.command.text ?? null,
      answer: answerView(attempt),
      noAnswerReason: attempt !== null && attempt.finalAnswer.status !== 'observed' ? attempt.finalAnswer.reason : null,
      parent: parent === null ? null : { attemptId: parent.slot.attemptId, answer: answerView(dispatchedAttemptOf(parent.dispatched)) },
      checks: task.checks,
      key: keyViewFor(keys.get(slot.huntId)!, slot, task),
      trail: trail.trail,
      trailNote: trail.note,
      screenshots: screenshots.map((shot, index) => ({ name: shot.name, href: `/api/screenshot/${encodeURIComponent(slot.attemptId)}/${index}` })),
      allowedStatuses: allowedStatusesFor(dispatched),
      editor,
      problems: editor === null ? [] : problemsOf(editor.state, bench),
      saved: entry !== undefined && isReviewed(entry.status),
      // Null until this reviewer's own entry is saved — see compareGrades.
      comparison: other === null ? null : compareGrades(entry, other.entries.find((candidate) => candidate.attemptId === slot.attemptId), task),
    }
  }

  function writeDrafts(): void {
    writeFileAtomic(draftsPath, `${JSON.stringify(drafts, null, 2)}\n`)
  }

  /** The posted editor state for a slot that can be graded, or the response already sent. */
  async function postedState(request: IncomingMessage, response: ServerResponse, bench: BenchSlot): Promise<BenchEditorState | null> {
    if (!isJsonRequest(request)) {
      send(response, 415, { error: 'the bench accepts JSON only' })
      return null
    }
    const body = await readBody(request)
    if (!body.ok) {
      send(response, body.status, { error: body.error })
      return null
    }
    if (dispatchedAttemptOf(bench.dispatched) === null) {
      send(response, 409, { errors: [`nothing was dispatched into slot ${bench.slot.attemptId}, so there is nothing to grade — it stays pending`] })
      return null
    }
    const state = sanitizeEditorState(isRecord(body.value) ? body.value.state : undefined, bench.task)
    if (!state.ok) {
      send(response, 400, { errors: state.errors })
      return null
    }
    return state.value
  }

  async function serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const refusal = requestRefusal(request)
    if (refusal !== null) return send(response, 403, { error: refusal })
    const method = request.method ?? 'GET'
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')

    if (url.pathname === '/' || url.pathname === '/api/set') {
      if (method !== 'GET') return send(response, 405, { error: `${method} is not accepted here` })
      if (url.pathname === '/api/set') return send(response, 200, setView())
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      response.end(options.pageHtml)
      return
    }

    const match = /^\/api\/(attempt|drafts|grades|screenshot)\/([^/]+)(?:\/(\d+))?$/.exec(url.pathname)
    if (match === null || (match[3] !== undefined) !== (match[1] === 'screenshot')) return send(response, 404, { error: 'not found' })
    let attemptId: string
    try {
      attemptId = decodeURIComponent(match[2])
    } catch {
      return send(response, 400, { error: 'the attempt id is not a valid URL component' })
    }
    const bench = benchSlotOf(attemptId)
    if (bench === null) return send(response, 404, { error: `the capture set schedules no slot ${attemptId}` })

    switch (`${method} ${match[1]}`) {
      case 'GET attempt':
        return send(response, 200, attemptView(bench))

      case 'GET screenshot': {
        const attempt = dispatchedAttemptOf(bench.dispatched)
        const shot = attempt === null ? undefined : screenshotsOf(attempt, bench.dispatched!.captureId)[Number(match[3])]
        if (shot === undefined || !existsSync(shot.path)) return send(response, 404, { error: 'no such screenshot' })
        response.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' })
        response.end(readFileSync(shot.path))
        return
      }

      case 'PUT drafts': {
        const state = await postedState(request, response, bench)
        if (state === null) return
        drafts = withDraft(drafts, attemptId, state, now().toISOString())
        writeDrafts()
        return send(response, 200, { problems: problemsOf(state, bench), slot: summaryOf(attemptId) })
      }

      case 'DELETE drafts': {
        if (draftOf(attemptId) !== undefined) {
          drafts = withoutDraft(drafts, attemptId)
          writeDrafts()
        }
        return send(response, 200, attemptView(bench))
      }

      case 'POST grades': {
        const state = await postedState(request, response, bench)
        if (state === null) return
        const next = gradesWith(state, bench, grades, inputs, reviewer, now().toISOString())
        if (!next.ok) return send(response, 422, { errors: next.errors })
        const onDisk = existsSync(gradesPath) ? readFileSync(gradesPath, 'utf8') : null
        if (onDisk !== gradesText) {
          return send(response, 409, { errors: ['the grades file changed on disk after the bench opened it — follow change set and start this set again before saving, so nothing written there is lost'] })
        }
        const text = `${JSON.stringify(next.value, null, 2)}\n`
        writeFileAtomic(gradesPath, text)
        grades = next.value
        gradesText = text
        if (draftOf(attemptId) !== undefined) {
          drafts = withoutDraft(drafts, attemptId)
          writeDrafts()
        }
        return send(response, 200, attemptView(bench))
      }

      default:
        return send(response, 405, { error: `${method} is not accepted on ${match[1]}` })
    }
  }

  return {
    ok: true,
    value: {
      setId: set.setId,
      reviewer,
      gradesPath,
      draftsPath,
      comparePath: comparePath ?? null,
      slots: () => slotSummariesOf(inputs, grades, drafts),
      handle: guarded(serve),
    },
  }
}

// ---------------------------------------------------------------------------
// The setup door

export interface GradingSetupOptions {
  /** Where capture sets are listed from: `LIVE_ARTIFACTS_ROOT` for the CLI, a fixture root for a test. */
  readonly artifactsRoot: string
  /** Where grades files are found and written: `LIVE_PRIVATE_ROOT` for the CLI. */
  readonly privateRoot: string
  readonly manifest: LiveKeyManifest
  readonly keyFor: (huntId: string) => BenchKey | undefined
  /** What the reviewer field starts as — `git config user.name` — or null. */
  readonly defaultReviewer: string | null
  readonly setupHtml: string
  readonly benchHtml: string
  readonly now?: () => Date
  /** Told once, when Start opens the bench. */
  readonly onStart?: (bench: GradingBench) => void
}

export interface GradingSetup {
  readonly handle: (request: IncomingMessage, response: ServerResponse) => void
}

/** A root's top-level JSON files, parsed; a file that does not parse is kept with no value. A missing root holds nothing. */
function readRoot(root: string): RootFile[] {
  let names: string[]
  try {
    names = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
  return names.map((name) => {
    try {
      return { name, value: JSON.parse(readFileSync(join(root, name), 'utf8')) as unknown }
    } catch {
      return { name, value: undefined }
    }
  })
}

/**
 * The header the bench page names its set in. Sets switch within one process
 * (#231), and two sets can schedule the same attempt ids, so a page still open
 * on a set that was left must never be served by the bench open now.
 */
const SET_HEADER = 'x-grading-set'

/** Why a request is not for the set whose bench is open, or null. A page names its set once it knows it; a change must name one. */
function otherSetRefusal(request: IncomingMessage, method: string, setId: string): string | null {
  const named = request.headers[SET_HEADER]
  if (typeof named === 'string') return named === setId ? null : `this page is on set ${named}, and the bench is now open on set ${setId} — reload the page`
  return method === 'GET' ? null : `a change has to name its set, and this page names none while the bench is open on set ${setId} — reload the page`
}

/**
 * The setup door: a page that proposes, from the two roots, every capture
 * set with the grades file this reviewer's work goes into, and an open bench
 * only once the reviewer presses Start. Until then it reads and never writes;
 * after, it hands every request for that set to that bench. Change set (#231)
 * closes the bench and brings the setup back, read afresh, so the next Start
 * opens another set in the same process. The set is fixed while its bench is
 * open; the reviewer from the first Start until the process ends.
 */
export function openGradingSetup(options: GradingSetupOptions): GradingSetup {
  let bench: GradingBench | null = null
  /** The name the first Start opened a bench under, which every later Start keeps. */
  let fixedReviewer: string | null = null

  function openOn(setFile: string, reviewer: string, gradesFile: string, comparisonFile: string | null): Validation<GradingBench> {
    return openGradingBench({
      capturePath: join(options.artifactsRoot, setFile),
      manifest: options.manifest,
      gradesPath: join(options.privateRoot, gradesFile),
      ...(comparisonFile === null ? {} : { comparePath: join(options.privateRoot, comparisonFile) }),
      reviewer,
      keyFor: options.keyFor,
      pageHtml: options.benchHtml,
      ...(options.now === undefined ? {} : { now: options.now }),
    })
  }

  /**
   * Every listed set with what Start would open it on. A set is only offered
   * when a bench really opens on it — opening reads, and writes nothing — so
   * a set that can be chosen is a set Start can open. So is each comparison
   * beside it: a file that does not validate against the set is not offered,
   * rather than offered and then refused on Start.
   */
  function survey(reviewer: string): { sets: SetupSet[]; privateFiles: RootFile[] } {
    const privateFiles = readRoot(options.privateRoot)
    const sets = captureSetsIn(readRoot(options.artifactsRoot)).map((listing): SetupSet => {
      const unopened = { ...listing, gradesFile: null, progress: null, comparisons: [], preselectedComparison: null }
      if (listing.refusals.length > 0 || reviewer === '') return unopened
      const query = { setId: listing.setId!, reviewer, manifest: options.manifest, privateFiles }
      const choice = resolveGradesFile(query)
      if (!choice.ok) return { ...unopened, refusals: choice.errors }
      const opened = openOn(listing.file, reviewer, choice.value.name, null)
      if (!opened.ok) return { ...unopened, refusals: opened.errors }
      const comparisons = comparisonsOfferedFor(query).filter((candidate) => openOn(listing.file, reviewer, choice.value.name, candidate.file).ok)
      return {
        ...listing,
        gradesFile: choice.value,
        progress: progressOf(opened.value.slots()),
        comparisons,
        preselectedComparison: preselectedComparisonFile(comparisons),
      }
    })
    return { sets, privateFiles }
  }

  function setupView(reviewer: string) {
    const { sets, privateFiles } = survey(reviewer)
    return {
      started: null,
      reviewer,
      reviewerFixed: fixedReviewer !== null,
      defaultReviewer: options.defaultReviewer,
      caution: reviewer === '' ? null : reviewerCaution(reviewer, privateFiles),
      key: { version: options.manifest.keyVersion, digest: options.manifest.keyDigest },
      roots: { artifacts: options.artifactsRoot, private: options.privateRoot },
      sets,
      preselected: preselectedSetFile(sets),
    }
  }

  async function start(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!isJsonRequest(request)) return send(response, 415, { error: 'the bench accepts JSON only' })
    const body = await readBody(request)
    if (!body.ok) return send(response, body.status, { error: body.error })
    // Everything from here to the assignment is synchronous, so two Starts cannot both open a bench.
    if (bench !== null) {
      return send(response, 409, { errors: [`the bench is already open on set ${bench.setId} as ${bench.reviewer} — follow change set on the bench to grade another set`] })
    }
    const posted = isRecord(body.value) ? body.value : {}
    const file = typeof posted.file === 'string' ? posted.file : ''
    const reviewer = typeof posted.reviewer === 'string' ? posted.reviewer.trim() : ''
    if (reviewer === '') return send(response, 409, { errors: ['no reviewer is named, and an entry naming no one cannot be saved'] })
    if (fixedReviewer !== null && reviewer !== fixedReviewer) {
      return send(response, 409, { errors: [`the reviewer has been ${fixedReviewer} since the first Start, for every set — restart live:review to grade as ${reviewer}`] })
    }
    const set = survey(reviewer).sets.find((candidate) => candidate.file === file)
    if (set === undefined) return send(response, 409, { errors: [`the artifacts root holds no capture set ${file}`] })
    if (set.gradesFile === null) return send(response, 409, { errors: set.refusals })
    // Start confirms what the page showed. A grades file it did not show for this name — the page
    // drawing an older proposal, or the private root changing since — is not opened.
    const shown = typeof posted.gradesFile === 'string' ? posted.gradesFile : null
    if (shown !== set.gradesFile.name) {
      return send(response, 409, {
        errors: [`${reviewer}’s grades file for set ${set.setId} is ${set.gradesFile.name}, not ${shown ?? 'one the page named'} — check the setup page, then Start again`],
      })
    }
    // So is the comparison: one of the files the page offered for this set and name, or none.
    const comparisonFile = posted.comparisonFile === undefined || posted.comparisonFile === null ? null : String(posted.comparisonFile)
    if (comparisonFile !== null && !set.comparisons.some((candidate) => candidate.file === comparisonFile)) {
      return send(response, 409, {
        errors: [`${comparisonFile} is not a grades file the setup page offers to compare against on set ${set.setId} for ${reviewer} — check the setup page, then Start again`],
      })
    }
    const opened = openOn(set.file, reviewer, set.gradesFile.name, comparisonFile)
    if (!opened.ok) return send(response, 409, { errors: opened.errors })
    bench = opened.value
    fixedReviewer = bench.reviewer
    options.onStart?.(bench)
    return send(response, 200, {
      setId: bench.setId,
      reviewer: bench.reviewer,
      gradesFile: basename(bench.gradesPath),
      comparisonFile: bench.comparePath === null ? null : basename(bench.comparePath),
    })
  }

  async function serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const refusal = requestRefusal(request)
    if (refusal !== null) return send(response, 403, { error: refusal })
    const method = request.method ?? 'GET'
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')

    if (url.pathname === '/api/setup') {
      if (method !== 'GET') return send(response, 405, { error: `${method} is not accepted here` })
      if (bench !== null) return send(response, 200, { started: { setId: bench.setId, reviewer: bench.reviewer } })
      return send(response, 200, setupView(fixedReviewer ?? (url.searchParams.get('reviewer') ?? options.defaultReviewer ?? '').trim()))
    }
    if (url.pathname === '/api/start') {
      if (method !== 'POST') return send(response, 405, { error: `${method} is not accepted here` })
      return start(request, response)
    }
    // Everything from here on is for the open bench's set: a page on another set is refused, not served.
    const otherSet = bench === null ? null : otherSetRefusal(request, method, bench.setId)
    if (otherSet !== null) return send(response, 409, { error: otherSet })
    if (url.pathname === '/api/change-set') {
      if (method !== 'POST') return send(response, 405, { error: `${method} is not accepted here` })
      if (!isJsonRequest(request)) return send(response, 415, { error: 'the bench accepts JSON only' })
      if (bench === null) return send(response, 409, { error: 'no bench is open to leave — choose a set on the setup page, then Start' })
      // Nothing is written on the way out: every change is already in the sidecar, and the next Start reads it afresh.
      const left = bench
      bench = null
      return send(response, 200, { left: { setId: left.setId } })
    }
    if (bench !== null) return bench.handle(request, response)
    if (url.pathname === '/') {
      if (method !== 'GET') return send(response, 405, { error: `${method} is not accepted here` })
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      response.end(options.setupHtml)
      return
    }
    return send(response, 409, { error: 'the bench has not started — choose a set and a reviewer on the setup page, then Start' })
  }

  return { handle: guarded(serve) }
}
