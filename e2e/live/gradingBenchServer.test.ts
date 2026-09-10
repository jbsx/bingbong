import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { createServer, request as httpRequest, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PipelineEvent } from '../../src/core/pipeline/events'
import { digestOf } from './artifacts.ts'
import { gradesWith, type BenchEditorState, type BenchKey } from './gradingBench.ts'
import { openGradingBench, openGradingSetup, type GradingBench } from './gradingBenchServer.ts'
import {
  LIVE_GRADING_SCHEMA_VERSION,
  LIVE_KEY_MANIFEST_KIND,
  indexAttempts,
  initializeLiveGrades,
  parseLiveGrades,
  type LiveGrades,
  type LiveGradingInputs,
  type LiveKeyManifest,
} from './grades.ts'
import { attemptCapture, captureSet, notReached, sessionCapture, slotOf } from './gradingFixtures.ts'
import type { LiveAttemptCapture, LiveEventTape } from './types.ts'

// The Grading Bench server (#228) and the setup page in front of it (#229),
// exercised end to end against fixture files on disk: the real handlers on a
// real loopback socket, with no Electron, no model and no browser. The order
// of the tests in each describe is the order a reviewer works in, and later
// tests read what earlier ones wrote. The facts are invented, as in every
// grading suite.

const LIVE_REVIEW = fileURLToPath(new URL('../../scripts/live-review.ts', import.meta.url))
const LIVE_REPORT = fileURLToPath(new URL('../../scripts/live-report.ts', import.meta.url))
const PAGE = fileURLToPath(new URL('../../scripts/live-review.html', import.meta.url))
const SETUP_PAGE = fileURLToPath(new URL('../../scripts/live-review-setup.html', import.meta.url))
const [major, minor] = process.versions.node.split('.').map(Number)
const stripsTypes = major! > 22 || (major === 22 && minor! >= 18)

const manifest: LiveKeyManifest = {
  kind: LIVE_KEY_MANIFEST_KIND,
  schemaVersion: LIVE_GRADING_SCHEMA_VERSION,
  keyVersion: 'k1',
  keyDigest: digestOf('the invented key document, v1'),
  preparedAt: '2026-01-01',
  tasks: [
    {
      huntId: 'hunt-a',
      stepId: 'initial',
      promptVersion: 'p1',
      keyRef: 'fixture/keys.ts#hunt-a',
      checks: [
        { checkId: 'c1', description: 'names the invented widget code' },
        { checkId: 'c2', description: 'The Answer avoids: the superseded fixture cable' },
      ],
    },
    {
      huntId: 'hunt-b',
      stepId: 'initial',
      promptVersion: 'p1',
      keyRef: 'fixture/keys.ts#hunt-b',
      checks: [{ checkId: 'c1', description: 'gives the invented date' }],
    },
    {
      huntId: 'hunt-b',
      stepId: 'follow_up',
      promptVersion: 'p1',
      keyRef: 'fixture/keys.ts#hunt-b.followUpDelta',
      checks: [{ checkId: 'd1', description: 'keeps the invented date' }],
    },
  ],
}

/** The manifest as `pnpm live:keys` writes it, which is what `pnpm live:report` is given. */
const MANIFEST_TEXT = `${JSON.stringify(manifest, null, 2)}\n`

const keys: Record<string, BenchKey> = {
  'hunt-a': {
    huntId: 'hunt-a',
    version: 1,
    requiredFacts: ['the widget code is W-1'],
    constraints: ['grade the invented cable and the code separately'],
    pitfalls: ['the superseded fixture cable'],
    uncertainties: ['the invented spec hedges on the revision'],
    sources: [{ url: 'https://spec.invalid/a', supports: 'the code and the cable' }],
    liveFacts: [],
  },
  'hunt-b': {
    huntId: 'hunt-b',
    version: 1,
    requiredFacts: ['the invented date'],
    constraints: ['a date without its source is not enough'],
    pitfalls: [],
    uncertainties: [],
    sources: [{ url: 'https://dates.invalid/', supports: 'the date' }],
    liveFacts: [],
    followUpDelta: { requiredFacts: ['the date stands'], pitfalls: [], sources: [] },
  },
}

const TAPE_EVENTS: PipelineEvent[] = [
  { type: 'tool_call', turnId: 'turn-a1', callId: 'n1', name: 'navigate', args: { url: 'https://spec.invalid/a' }, at: 1 },
  {
    type: 'tool_result',
    turnId: 'turn-a1',
    callId: 'n1',
    name: 'navigate',
    ok: true,
    result: 'navigated: url=https://spec.invalid/a title="Widget spec"\n# Widget spec — https://spec.invalid/a\npage text:\nThe widget code is W-1.',
    at: 2,
  },
  { type: 'tool_call', turnId: 'turn-a1', callId: 'e1', name: 'record_evidence', args: { kind: 'web', observation: 'code W-1', excerpt: 'The widget code is W-1.', source_url: 'https://spec.invalid/a' }, at: 3 },
  { type: 'tool_result', turnId: 'turn-a1', callId: 'e1', name: 'record_evidence', ok: true, result: 'Session Evidence recorded: memory-1', at: 4 },
]

const REVIEWED_AT = '2026-09-10T12:00:00.000Z'

/** A complete passing judgment of a1. */
const passing: BenchEditorState = {
  status: 'pass',
  checks: { c1: { satisfied: true, note: 'second line' }, c2: { satisfied: true, note: '' } },
  support: [{ claim: 'the widget code', sourceUrl: 'https://spec.invalid/a', passageRef: 'fixture/keys.ts#hunt-a.sources[0]', equivalentTo: '' }],
  rationale: 'both checks met by the spec page',
}

/** A complete judgment of b1, which published no Answer. */
const b1Unsuccessful: BenchEditorState = { status: 'unsuccessful', checks: { c1: { satisfied: false, note: '' } }, support: [], rationale: 'it never answered' }

/**
 * The fixture capture set, written into `directory` as `setFile` beside its
 * Session captures: a1 answered, with an event tape and a failure screenshot;
 * b1 ran and published no Answer; b2 was never reached.
 */
function writeFixtureSet(directory: string, setFile: string): LiveGradingInputs {
  const tape: LiveEventTape = { attemptId: 'a1', turnId: 'turn-a1', events: TAPE_EVENTS }
  const tapeText = `${JSON.stringify(tape, null, 2)}\n`
  const screenshot = Buffer.from('not really a png')
  const a1: LiveAttemptCapture = {
    ...attemptCapture({ attemptId: 'a1', huntId: 'hunt-a', answer: { at: 20_000, text: 'The widget code is **W-1**.' } }),
    events: { path: 'events/a1.json', family: 'events', digest: digestOf(tapeText), bytes: Buffer.byteLength(tapeText), complete: true },
  }
  const b1 = attemptCapture({ attemptId: 'b1', huntId: 'hunt-b', order: 1, answer: null, terminal: null })
  const b2 = notReached({ attemptId: 'b2', huntId: 'hunt-b', order: 2, parentAttemptId: 'b1', reason: 'the Run never ended, so no follow-up was sent' })
  const screenshotName = 'logs/run-trace-run-a1-turn-x-1.png'
  const sessionA = sessionCapture({
    captureId: 'capture-hunt-a',
    huntId: 'hunt-a',
    attempts: [a1],
    setId: 'set-1',
    artifacts: [{ path: screenshotName, family: 'screenshot', digest: digestOf(screenshot), bytes: screenshot.length, complete: true }],
  })
  const sessionB = sessionCapture({ captureId: 'capture-hunt-b', huntId: 'hunt-b', attempts: [b1, b2], setId: 'set-1' })
  const set = captureSet({ slots: [a1, b1, b2].map(slotOf), sessions: [sessionA, sessionB] })

  writeFileSync(join(directory, setFile), `${JSON.stringify(set, null, 2)}\n`)
  for (const session of [sessionA, sessionB]) {
    mkdirSync(join(directory, session.captureId, 'events'), { recursive: true })
    mkdirSync(join(directory, session.captureId, 'logs'), { recursive: true })
    writeFileSync(join(directory, session.captureId, 'capture.json'), `${JSON.stringify(session, null, 2)}\n`)
  }
  writeFileSync(join(directory, 'capture-hunt-a', 'events', 'a1.json'), tapeText)
  writeFileSync(join(directory, 'capture-hunt-a', screenshotName), screenshot)
  return { set, sessions: [sessionA, sessionB], manifest }
}

/** Another reviewer's finished Grade: a1 a useful partial with the cable check failed, b1 unsuccessful. */
function reviewerBGrades(inputs: LiveGradingInputs): LiveGrades {
  const { byAttemptId } = indexAttempts(inputs.sessions)
  const slotOfId = (attemptId: string) => {
    const slot = inputs.set.slots.find((candidate) => candidate.attemptId === attemptId)!
    return { slot, dispatched: byAttemptId.get(attemptId), task: manifest.tasks.find((task) => task.huntId === slot.huntId && task.stepId === slot.stepId)! }
  }
  let other: LiveGrades = initializeLiveGrades(inputs)
  for (const [attemptId, state] of [
    ['a1', { status: 'useful_partial', checks: { c1: { satisfied: true, note: '' }, c2: { satisfied: false, note: 'mentions the old cable' } }, support: [], rationale: 'the cable slip costs the pass' }],
    ['b1', { status: 'unsuccessful', checks: { c1: { satisfied: false, note: '' } }, support: [], rationale: 'no Answer' }],
  ] as const) {
    const next = gradesWith(state as BenchEditorState, slotOfId(attemptId), other, inputs, 'reviewer-b', REVIEWED_AT)
    if (!next.ok) throw new Error(next.errors.join('\n'))
    other = next.value
  }
  return other
}

function listen(handler: GradingBench['handle']): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const created = createServer(handler)
    created.listen(0, '127.0.0.1', () => {
      const address = created.address()
      resolve({ server: created, port: typeof address === 'object' && address !== null ? address.port : 0 })
    })
  })
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()))
}

function request(
  port: number,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
  // The bodies are the page's JSON, asserted field by field below; a typed
  // mirror of every view would only restate the server.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ status: number; text: string; json: () => any }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body)
    const outgoing = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: { ...(payload === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          resolve({ status: response.statusCode ?? 0, text, json: () => JSON.parse(text) })
        })
      },
    )
    outgoing.on('error', reject)
    if (payload !== undefined) outgoing.write(payload)
    outgoing.end()
  })
}

function filesUnder(root: string): string[] {
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((name) => statSync(join(root, name)).isFile())
    .map((name) => relative(root, join(root, name)))
    .sort()
}

describe('the Grading Bench server', () => {
  let dir: string
  let paths: { capture: string; keys: string; grades: string; compare: string; drafts: string }
  let inputs: LiveGradingInputs
  let bench: GradingBench
  let server: Server
  let port: number
  let filesBefore: string[]

  function open(overrides: Partial<Parameters<typeof openGradingBench>[0]> = {}) {
    return openGradingBench({
      capturePath: paths.capture,
      manifest,
      gradesPath: paths.grades,
      comparePath: paths.compare,
      reviewer: 'reviewer-a',
      keyFor: (huntId) => keys[huntId],
      pageHtml: readFileSync(PAGE, 'utf8'),
      now: () => new Date(REVIEWED_AT),
      ...overrides,
    })
  }

  const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, onPort = port) => request(onPort, method, path, body, headers)

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'bingbong-grading-bench-'))
    inputs = writeFixtureSet(dir, 'capture-set.json')
    paths = {
      capture: join(dir, 'capture-set.json'),
      keys: join(dir, 'private', 'key-manifest.json'),
      grades: join(dir, 'private', 'set-1-grades-reviewer-a.json'),
      compare: join(dir, 'private', 'set-1-grades-reviewer-b.json'),
      drafts: join(dir, 'private', 'set-1-grades-reviewer-a.drafts.json'),
    }
    mkdirSync(join(dir, 'private'))
    writeFileSync(paths.keys, MANIFEST_TEXT)
    writeFileSync(paths.compare, `${JSON.stringify(reviewerBGrades(inputs), null, 2)}\n`)

    filesBefore = filesUnder(dir)
    const opened = open()
    if (!opened.ok) throw new Error(opened.errors.join('\n'))
    bench = opened.value
    ;({ server, port } = await listen(bench.handle))
  })

  afterAll(async () => {
    await close(server)
    rmSync(dir, { recursive: true, force: true })
  })

  it('refuses to open a grades file another reviewer has written into', () => {
    const before = readFileSync(paths.compare)
    const refused = open({ gradesPath: paths.compare, comparePath: undefined })
    expect(refused.ok ? [] : refused.errors.join(' ')).toContain('reviewer-b')
    expect(readFileSync(paths.compare)).toEqual(before)
  })

  it('refuses a comparison file holding this reviewer’s own reviews', () => {
    const refused = open({ reviewer: 'reviewer-b', gradesPath: join(dir, 'private', 'set-1-grades-reviewer-b-again.json') })
    expect(refused.ok ? [] : refused.errors.join(' ')).toContain('compare against another reviewer')
  })

  it('serves the page, and only to a request that came from this machine’s own page', async () => {
    const page = await call('GET', '/')
    expect(page.status).toBe(200)
    expect(page.text).toContain('Grading Bench')

    // A page on another origin, or a DNS-rebound hostname, is not the reviewer.
    expect((await call('GET', '/api/set', undefined, { host: 'evil.invalid' })).status).toBe(403)
    expect((await call('PUT', '/api/drafts/a1', { state: passing }, { origin: 'https://evil.invalid' })).status).toBe(403)
    // A cross-origin form post cannot send JSON without a preflight the server never answers.
    expect((await call('PUT', '/api/drafts/a1', { state: passing }, { 'content-type': 'text/plain' })).status).toBe(415)
    expect(existsSync(paths.drafts)).toBe(false)
  })

  it('lists every slot in schedule order with its state, and why a slot was not reached', async () => {
    const response = await call('GET', '/api/set')
    expect(response.status).toBe(200)
    const body = response.json()
    expect(body.reviewer).toBe('reviewer-a')
    expect(body.slots.map((slot: { attemptId: string; state: string; reason: string | null }) => [slot.attemptId, slot.state, slot.reason])).toEqual([
      ['a1', 'pending', null],
      ['b1', 'pending', null],
      ['b2', 'not_reached', 'the Run never ended, so no follow-up was sent'],
    ])
  })

  it('shows the rendered Answer, every check, the whole key and the trail — and no other Grade', async () => {
    const response = await call('GET', '/api/attempt/a1')
    expect(response.status).toBe(200)
    const view = response.json()

    expect(view.answer.text).toBe('The widget code is **W-1**.')
    expect(view.answer.html).toContain('<strong>W-1</strong>')
    expect(view.answer.digest).toBe(digestOf('The widget code is **W-1**.'))
    expect(view.checks.map((check: { description: string }) => check.description)).toEqual([
      'names the invented widget code',
      'The Answer avoids: the superseded fixture cable',
    ])
    expect(view.key.constraints).toEqual(['grade the invented cable and the code separately'])
    expect(view.key.pitfalls).toEqual(['the superseded fixture cable'])
    expect(view.key.uncertainties).toEqual(['the invented spec hedges on the revision'])
    expect(view.key.sources).toEqual([{ url: 'https://spec.invalid/a', supports: 'the code and the cable' }])
    expect(view.trail.steps[0]).toMatchObject({ tool: 'navigate', outcome: 'loaded', url: 'https://spec.invalid/a' })
    expect(view.trail.steps[0].text).toContain('The widget code is W-1.')
    expect(view.trail.evidence[0]).toMatchObject({ accepted: true, sourceUrl: 'https://spec.invalid/a' })
    expect(view.screenshots).toHaveLength(1)
    expect((await call('GET', view.screenshots[0].href)).text).toBe('not really a png')
    expect(view.editor).toEqual({ source: 'blank', state: expect.objectContaining({ status: null }) })

    // Not hidden: absent. Nothing of reviewer-b's Grade is in the response.
    expect(view.comparison).toBeNull()
    expect(response.text).not.toContain('reviewer-b')
    expect(response.text).not.toContain('the cable slip costs the pass')
  })

  it('shows a not-reached slot with its reason and nothing to grade', async () => {
    const view = (await call('GET', '/api/attempt/b2')).json()
    expect(view.slot.reason).toBe('the Run never ended, so no follow-up was sent')
    expect(view.editor).toBeNull()
    expect(view.allowedStatuses).toEqual([])
  })

  it('writes every change to the drafts sidecar, and a reopened bench restores it', async () => {
    const draft = { ...passing, rationale: 'half way' }
    const response = await call('PUT', '/api/drafts/a1', { state: draft })
    expect(response.status).toBe(200)
    expect(response.json().problems).toEqual([])
    expect(JSON.parse(readFileSync(paths.drafts, 'utf8')).drafts.a1.state).toEqual(draft)
    expect(existsSync(paths.grades)).toBe(false)

    const reopened = open()
    if (!reopened.ok) throw new Error(reopened.errors.join('\n'))
    const second = await listen(reopened.value.handle)
    try {
      const view = (await call('GET', '/api/attempt/a1', undefined, {}, second.port)).json()
      expect(view.editor).toEqual({ source: 'draft', state: draft })
    } finally {
      await close(second.server)
    }
  })

  it('answers each change with the rule a save would break, in the validator’s words', async () => {
    const unsatisfied = { ...passing, checks: { ...passing.checks, c2: { satisfied: false, note: '' } } }
    const response = await call('PUT', '/api/drafts/a1', { state: unsatisfied })
    expect(response.json().problems).toEqual(['grade for a1: graded pass with required check(s) c2 unsatisfied'])
  })

  it('saves a complete entry for an attempt with no Answer', async () => {
    const response = await call('POST', '/api/grades/b1', { state: b1Unsuccessful })
    expect(response.status, response.text).toBe(200)
    const written = JSON.parse(readFileSync(paths.grades, 'utf8'))
    expect(parseLiveGrades(written, inputs).ok).toBe(true)
  })

  it('refuses an entry the validator rejects, shows its message verbatim, and leaves the grades file unchanged', async () => {
    const before = readFileSync(paths.grades)
    const response = await call('POST', '/api/grades/a1', { state: { ...passing, checks: { ...passing.checks, c2: { satisfied: false, note: '' } } } })
    expect(response.status).toBe(422)
    expect(response.json().errors).toEqual(['grade for a1: graded pass with required check(s) c2 unsatisfied'])
    expect(readFileSync(paths.grades)).toEqual(before)
  })

  it('saves a valid entry, clears its draft, and only then shows the other Grade as a per-check diff', async () => {
    const response = await call('POST', '/api/grades/a1', { state: passing })
    expect(response.status, response.text).toBe(200)
    const view = response.json()

    const written = parseLiveGrades(JSON.parse(readFileSync(paths.grades, 'utf8')), inputs)
    expect(written.ok).toBe(true)
    expect(written.ok && written.value.entries.find((entry) => entry.attemptId === 'a1')).toMatchObject({ status: 'pass', reviewer: 'reviewer-a', reviewedAt: REVIEWED_AT })
    expect(JSON.parse(readFileSync(paths.drafts, 'utf8')).drafts.a1).toBeUndefined()

    expect(view.editor.source).toBe('saved')
    expect(view.comparison).toMatchObject({
      otherPending: false,
      reviewer: 'reviewer-b',
      status: { own: 'pass', other: 'useful_partial', agree: false },
      rationale: { own: 'both checks met by the spec page', other: 'the cable slip costs the pass' },
      agreements: 1,
      disagreements: 1,
    })
    expect(view.comparison.checks[1]).toMatchObject({ checkId: 'c2', agree: false, other: { satisfied: false, note: 'mentions the old cable' } })
  })

  it.skipIf(!stripsTypes)('shows the same counts pnpm live:report computes from the file it wrote', async () => {
    const shown = (await call('GET', '/api/set')).json()
    const stdout = execFileSync(process.execPath, [LIVE_REPORT, `--capture=${paths.capture}`, `--keys=${paths.keys}`, `--grades=${paths.grades}`, '--format=json'], {
      encoding: 'utf8',
    })
    const report = JSON.parse(stdout)
    const counts = (population: Record<string, number>) => ({
      scheduled: population.scheduled,
      reviewed: population.reviewed,
      pending: population.pending,
      verifiedSuccess: population.verifiedSuccess,
    })
    expect(shown.populations).toEqual({
      initial: counts(report.populations.initial),
      revisedObjective: counts(report.populations.revisedObjective),
      bothStep: counts(report.populations.bothStep),
    })
    expect(shown.populations.initial).toEqual({ scheduled: 2, reviewed: 2, pending: 0, verifiedSuccess: 1 })
  })

  it('wrote nothing but the grades file and its drafts sidecar', () => {
    const added = filesUnder(dir).filter((name) => !filesBefore.includes(name))
    expect(added).toEqual([relative(dir, paths.drafts), relative(dir, paths.grades)].sort())
  })
})

describe('the setup page in front of the bench', () => {
  let root: string
  let privateRoot: string
  let server: Server
  let port: number
  let filesBefore: string[]
  const started: GradingBench[] = []

  const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => request(port, method, path, body, headers)

  beforeAll(async () => {
    // The two fixed roots, in miniature: a measured set beside the preflight
    // record and a rehearsal, and another reviewer's grades already filed.
    root = mkdtempSync(join(tmpdir(), 'bingbong-grading-setup-'))
    const artifactsRoot = join(root, 'artifacts')
    privateRoot = join(root, 'private')
    mkdirSync(artifactsRoot)
    mkdirSync(privateRoot)
    const inputs = writeFixtureSet(artifactsRoot, 'set-1.json')
    writeFileSync(join(artifactsRoot, 'preflight-2026-09-10.json'), JSON.stringify({ kind: 'bingbong.live.source-preflight', observedAt: '2026-09-10T00:00:00.000Z', observations: [] }))
    writeFileSync(join(artifactsRoot, 'rehearsal.json'), JSON.stringify({ ...inputs.set, setId: 'rehearsal', mode: 'verification' }))
    writeFileSync(join(privateRoot, 'key-manifest.json'), MANIFEST_TEXT)
    writeFileSync(join(privateRoot, 'set-1-grades-reviewer-b.json'), `${JSON.stringify(reviewerBGrades(inputs), null, 2)}\n`)
    filesBefore = filesUnder(root)

    const setup = openGradingSetup({
      artifactsRoot,
      privateRoot,
      manifest,
      keyFor: (huntId) => keys[huntId],
      defaultReviewer: 'reviewer-a',
      setupHtml: readFileSync(SETUP_PAGE, 'utf8'),
      benchHtml: readFileSync(PAGE, 'utf8'),
      now: () => new Date(REVIEWED_AT),
      onStart: (bench) => started.push(bench),
    })
    ;({ server, port } = await listen(setup.handle))
  })

  afterAll(async () => {
    await close(server)
    rmSync(root, { recursive: true, force: true })
  })

  it('serves the setup page and nothing of the bench until Start, and only to this machine’s own page', async () => {
    const page = await call('GET', '/')
    expect(page.status).toBe(200)
    expect(page.text).toContain('Start')
    expect(page.text).not.toContain('Loading the capture set')

    expect((await call('GET', '/api/set')).status).toBe(409)
    expect((await call('GET', '/api/attempt/a1')).status).toBe(409)
    expect((await call('GET', '/api/setup', undefined, { host: 'evil.invalid' })).status).toBe(403)
    expect((await call('POST', '/api/start', { file: 'set-1.json', reviewer: 'reviewer-a' }, { origin: 'https://evil.invalid' })).status).toBe(403)
    expect((await call('POST', '/api/start', { file: 'set-1.json', reviewer: 'reviewer-a' }, { 'content-type': 'text/plain' })).status).toBe(415)
    expect(started).toEqual([])
  })

  it('proposes each capture set with the reviewer’s grades file and progress, preselects the one to grade, and shows the key', async () => {
    const response = await call('GET', '/api/setup')
    expect(response.status).toBe(200)
    const view = response.json()

    expect(view.started).toBeNull()
    expect(view.reviewer).toBe('reviewer-a')
    expect(view.key).toEqual({ version: 'k1', digest: manifest.keyDigest })
    expect(view.sets.map((set: { file: string }) => set.file).sort()).toEqual(['rehearsal.json', 'set-1.json'])
    expect(view.sets.find((set: { file: string }) => set.file === 'set-1.json')).toMatchObject({
      setId: 'set-1',
      mode: 'measured',
      state: 'complete',
      slots: 3,
      refusals: [],
      gradesFile: { name: 'set-1-grades-reviewer-a.json', resumed: false },
      progress: { graded: 0, drafted: 0, pending: 2, notReached: 1 },
    })
    expect(view.sets.find((set: { file: string }) => set.file === 'rehearsal.json').refusals.join(' ')).toContain('verification')
    expect(view.preselected).toBe('set-1.json')
    // reviewer-a has nothing filed while reviewer-b has: the typo guard names who does.
    expect(view.caution).toContain('reviewer-b')
  })

  it('follows the name typed on the page: another reviewer resumes their own file, found by what it holds', async () => {
    const view = (await call('GET', `/api/setup?reviewer=${encodeURIComponent('reviewer-b')}`)).json()
    expect(view.reviewer).toBe('reviewer-b')
    expect(view.caution).toBeNull()
    expect(view.sets.find((set: { file: string }) => set.file === 'set-1.json')).toMatchObject({
      gradesFile: { name: 'set-1-grades-reviewer-b.json', resumed: true },
      progress: { graded: 2, drafted: 0, pending: 0, notReached: 1 },
    })
    expect(view.preselected).toBeNull()
  })

  it('refuses to start a set it lists as unavailable, or with no reviewer, and writes nothing before Start', async () => {
    const rehearsal = await call('POST', '/api/start', { file: 'rehearsal.json', reviewer: 'reviewer-a' })
    expect(rehearsal.status).toBe(409)
    expect(rehearsal.json().errors.join(' ')).toContain('verification')
    expect((await call('POST', '/api/start', { file: 'set-1.json', reviewer: '  ' })).status).toBe(409)
    expect((await call('POST', '/api/start', { file: 'no-such-set.json', reviewer: 'reviewer-a' })).status).toBe(409)

    // Start confirms what the page showed. A grades file it did not show for this name — the page
    // still drawing an older proposal — is not opened, and neither is a Start that names none.
    const unshown = await call('POST', '/api/start', { file: 'set-1.json', reviewer: 'reviewer-a', gradesFile: 'set-1-grades-reviewer-b.json' })
    expect(unshown.status).toBe(409)
    expect(unshown.json().errors.join(' ')).toContain('set-1-grades-reviewer-a.json')
    expect((await call('POST', '/api/start', { file: 'set-1.json', reviewer: 'reviewer-a' })).status).toBe(409)

    expect(started).toEqual([])
    expect(filesUnder(root)).toEqual(filesBefore)
  })

  it.skipIf(!stripsTypes)('opens the bench on the chosen set as the reviewer named, and what it saves passes pnpm live:report', async () => {
    const response = await call('POST', '/api/start', { file: 'set-1.json', reviewer: ' reviewer-a ', gradesFile: 'set-1-grades-reviewer-a.json' })
    expect(response.status, response.text).toBe(200)
    expect(response.json()).toEqual({ setId: 'set-1', reviewer: 'reviewer-a', gradesFile: 'set-1-grades-reviewer-a.json' })
    expect(started.map((bench) => [bench.setId, bench.reviewer])).toEqual([['set-1', 'reviewer-a']])

    // The bench, unchanged, now answers — and the setup is closed: the name is fixed for this bench.
    expect((await call('GET', '/')).text).toContain('Loading the capture set')
    expect((await call('GET', '/api/set')).json()).toMatchObject({ setId: 'set-1', reviewer: 'reviewer-a', gradesFile: 'set-1-grades-reviewer-a.json' })
    expect((await call('GET', '/api/setup')).json()).toEqual({ started: { setId: 'set-1', reviewer: 'reviewer-a' } })
    expect((await call('POST', '/api/start', { file: 'set-1.json', reviewer: 'reviewer-c' })).status).toBe(409)

    expect((await call('POST', '/api/grades/b1', { state: b1Unsuccessful })).status).toBe(200)
    expect(filesUnder(root).filter((name) => !filesBefore.includes(name))).toEqual([join('private', 'set-1-grades-reviewer-a.json')])

    const gradesPath = join(privateRoot, 'set-1-grades-reviewer-a.json')
    expect(JSON.parse(readFileSync(gradesPath, 'utf8')).entries.find((entry: { attemptId: string }) => entry.attemptId === 'b1').reviewer).toBe('reviewer-a')
    const report = spawnSync(
      process.execPath,
      [LIVE_REPORT, `--capture=${join(root, 'artifacts', 'set-1.json')}`, `--keys=${join(privateRoot, 'key-manifest.json')}`, `--grades=${gradesPath}`, '--format=json'],
      { encoding: 'utf8' },
    )
    expect(report.status, report.stderr).toBe(0)
  })
})

describe.skipIf(!stripsTypes)('pnpm live:review', () => {
  it('takes a path flag as an unknown option', () => {
    const refused = spawnSync(process.execPath, [LIVE_REVIEW, '--capture=e2e/live/artifacts/pilot-2.json', '--no-open'], { encoding: 'utf8' })
    expect(refused.status).toBe(1)
    expect(refused.stderr).toContain('unknown option --capture')
  })

  it('starts on loopback with no path flags, on the port it is given, without opening a browser', async () => {
    const child = spawn(process.execPath, [LIVE_REVIEW, '--port', '0', '--no-open'], { stdio: ['ignore', 'pipe', 'pipe'] })
    try {
      const url = await new Promise<string>((resolve, reject) => {
        let stdout = ''
        let stderr = ''
        child.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk.toString('utf8')
          const match = /(http:\/\/127\.0\.0\.1:\d+\/)/.exec(stdout)
          if (match !== null) resolve(match[1])
        })
        child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')))
        child.on('exit', (code) => reject(new Error(`live:review exited ${String(code)} before listening: ${stderr}`)))
      })
      const setup = await request(Number(new URL(url).port), 'GET', '/api/setup')
      expect(setup.status).toBe(200)
      expect(setup.json().started).toBeNull()
    } finally {
      child.kill()
    }
  })
})
