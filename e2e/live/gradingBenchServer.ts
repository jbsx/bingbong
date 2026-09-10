// The Grading Bench server (#228): the loopback door between the bench page
// and the files. `scripts/live-review.ts` opens it with explicit paths and
// listens on 127.0.0.1; everything it decides is in `gradingBench.ts`, and
// everything it validates is `grades.ts`'s own `parseLiveGrades`.
//
// What it guarantees, and where:
//
//   - It reads only the paths it was given (and the Session captures and
//     artifacts the capture set itself names), and writes exactly two files:
//     the grades file, and the drafts sidecar beside it. Nothing it reads —
//     an Answer, a page, the key — is ever written anywhere else, logged, or
//     printed.
//   - The grades file is written only with a set that `parseLiveGrades`
//     accepted, so it is always one `pnpm live:report` accepts. Half-done
//     work goes to the sidecar.
//   - It refuses to open another reviewer's grades file, and it never sends
//     the `--compare` Grade for a slot until this reviewer's own entry for
//     that slot is saved.
//   - It answers only requests addressed to loopback, from its own page:
//     a browser tab on another site cannot read the key or post a Grade.
//
// The Answer is rendered with the app's own `react-markdown` through
// `react-dom/server`, so the reviewer grades what the Feed would have shown.
// Only the server touches React; the page stays plain DOM. Links open in a
// new tab. The Answer digest is always taken over the raw text.
//
// NOTHING HERE LOADS A KEY: the keys arrive as `keyFor`, from the CLI.

import { existsSync, readFileSync, realpathSync } from 'node:fs'
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
  draftsPathFor,
  editorStateOf,
  emptyDrafts,
  evidenceTrailOf,
  gradesWith,
  keyDriftOf,
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
  type EvidenceTrail,
} from './gradingBench.ts'
import {
  indexAttempts,
  initializeLiveGrades,
  isReviewed,
  keyManifestDigest,
  parseLiveGrades,
  parseLiveKeyManifest,
  type LiveDispatchedAttempt,
  type LiveGrades,
  type LiveGradingInputs,
  type LiveKeyManifest,
} from './grades.ts'
import { buildLiveReport, type LivePopulation } from './report.ts'
import type { LiveAttemptCapture } from './types.ts'

export interface GradingBenchOptions {
  readonly capturePath: string
  readonly keysPath: string
  readonly gradesPath: string
  /** Another reviewer's grades file, shown slot by slot only after this reviewer saves. */
  readonly comparePath?: string
  readonly reviewer: string
  /** The substantive key for a hunt. The CLI passes the corpus's; a test passes an invented one. */
  readonly keyFor: (huntId: string) => BenchKey | undefined
  /** The key's own manifest for a hunt, when available, to refuse a key that moved past the manifest file. */
  readonly keyManifestFor?: (huntId: string) => LiveKeyManifest
  readonly pageHtml: string
  readonly now?: () => Date
}

export interface GradingBench {
  readonly setId: string
  readonly reviewer: string
  readonly gradesPath: string
  readonly draftsPath: string
  readonly handle: (request: IncomingMessage, response: ServerResponse) => void
}

/** Generous for a Grade with every note typed out; fatal for anything else. */
const BODY_LIMIT_BYTES = 1_000_000

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

function attemptOf(dispatched: LiveDispatchedAttempt | undefined): LiveAttemptCapture | null {
  return dispatched?.record.kind === 'attempt' ? dispatched.record : null
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

  const manifestInput = readJsonInput(options.keysPath, 'key manifest')
  if (!manifestInput.ok) return manifestInput
  const parsedManifest = parseLiveKeyManifest(manifestInput.value.value)
  if (!parsedManifest.ok) return refused('the key manifest is not usable', parsedManifest.errors)
  const manifest = parsedManifest.value
  const inputs: LiveGradingInputs = { set, sessions, manifest }

  // Every scheduled slot has to be judgeable: a step in the manifest to give
  // it checks, and a key for the reviewer to read those checks against.
  const tasks = new Map(manifest.tasks.map((task) => [`${task.huntId}/${task.stepId}`, task]))
  const keys = new Map<string, BenchKey>()
  const problems: string[] = []
  for (const slot of set.slots) {
    if (!tasks.has(`${slot.huntId}/${slot.stepId}`)) {
      problems.push(`the key manifest declares no task for ${slot.huntId}/${slot.stepId}, so slot ${slot.attemptId} has no checks to judge`)
    }
    if (keys.has(slot.huntId) || problems.some((problem) => problem.endsWith(`hunt ${slot.huntId}`))) continue
    const key = options.keyFor(slot.huntId)
    if (key === undefined) problems.push(`there is no grading key for hunt ${slot.huntId}`)
    else keys.set(slot.huntId, key)
  }
  if (options.keyManifestFor !== undefined) problems.push(...keyDriftOf(manifest, options.keyManifestFor))
  if (problems.length > 0) return refused('the bench cannot put a key beside every slot', problems)

  const gradesPath = resolve(options.gradesPath)
  const draftsPath = draftsPathFor(gradesPath)
  const comparePath = options.comparePath === undefined ? undefined : resolve(options.comparePath)
  const setDirectory = dirname(resolve(options.capturePath))
  const sessionDirectories = new Map(set.sessions.map((reference) => [reference.captureId, dirname(resolve(setDirectory, reference.path))]))

  // The two files the bench writes may never be a file it reads.
  const readPaths = [
    options.capturePath,
    options.keysPath,
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
      return { ok: false, errors: ['--compare and --grades name the same file — compare against another reviewer’s grades'] }
    }
    const input = readJsonInput(comparePath, 'grades file to compare against')
    if (!input.ok) return input
    const parsed = parseLiveGrades(input.value.value, inputs)
    if (!parsed.ok) return refused('the --compare grades do not validate against this capture set and key manifest', parsed.errors)
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
      return bench !== null && attemptOf(bench.dispatched) !== null ? bench.task : undefined
    })
    if (!parsed.ok) return refused(`the drafts in ${basename(draftsPath)} are not usable (move the file aside to start those slots over)`, parsed.errors)
    drafts = parsed.value
  }

  const renderedAnswers = new Map<string, string>()
  const trails = new Map<string, { trail: EvidenceTrail | null; note: string | null }>()

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

  function trailOf(attempt: LiveAttemptCapture, captureId: string): { trail: EvidenceTrail | null; note: string | null } {
    const cached = trails.get(attempt.attemptId)
    if (cached !== undefined) return cached
    const read = (): { trail: EvidenceTrail | null; note: string | null } => {
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
    const attempt = attemptOf(dispatched)
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
      parent: parent === null ? null : { attemptId: parent.slot.attemptId, answer: answerView(attemptOf(parent.dispatched)) },
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
    if (!(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
      send(response, 415, { error: 'the bench accepts JSON only' })
      return null
    }
    const body = await readBody(request)
    if (!body.ok) {
      send(response, body.status, { error: body.error })
      return null
    }
    if (attemptOf(bench.dispatched) === null) {
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
        const attempt = attemptOf(bench.dispatched)
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
          return send(response, 409, { errors: ['the grades file changed on disk after the bench opened it — restart the bench before saving, so nothing written there is lost'] })
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
      handle: (request, response) => {
        serve(request, response).catch((error: unknown) => {
          if (response.headersSent) response.end()
          else send(response, 500, { error: `the bench failed: ${redactedMessage(error)}` })
        })
      },
    },
  }
}
