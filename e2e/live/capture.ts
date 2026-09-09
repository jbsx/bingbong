// The capture Session lifecycle (#224): one launch of the real app in a
// fresh benchmark profile, one command at a time through the real Prompt
// Bar, and a durable record of what the app itself published about each.
//
//   const session = await startCaptureSession({ mode, captureId, huntId, … })
//   try {
//     const initial = await session.captureCommand({ … })
//     if ((await session.continuationState()).ready) await session.captureCommand({ … follow-up })
//   } finally {
//     await session.close()
//   }
//
// Nothing here browses, steers, answers an Ask or approves a
// confirmation, and nothing retries: a command is submitted exactly
// once, and what happens next is observed and written down. The
// observation rides the app's own event subscription, taped verbatim in
// the dashboard from a fresh cursor per attempt, so acceptance is the
// app's `command` event with its Session/Run/turn identities — never the
// DOM having accepted a form submit — and the final Answer is the
// display the pipeline marked, never the last display seen.
//
// Every wait is bounded and every bound is recorded. An observer failure
// keeps its own reason; one bounded abort follows, and no `done` and no
// Finalization Cause is ever invented for it.

import { join } from 'node:path'
import type { PipelineEvent } from '../../src/core/pipeline/events'
import type { PerfSpanRecord } from '../../src/core/perf/perfTracer'
import { collectPerfRecords } from '../../src/main/perf/collectPerfRecords'
import type { TraceRecord } from '../../src/core/trace/runTrace'
import { startFixtureServer, type FixtureServer } from '../fixtureServer'
import { startHarness, type Harness } from '../harness'
import { readRunTrace } from '../runTrace'
import { sleep } from '../waitFor'
import {
  archiveLogsDir,
  archiveUsageLedger,
  claimCaptureDir,
  LIVE_ARTIFACTS_ROOT,
  redactedMessage,
  verifyArtifacts,
  writeEventTape,
  writeSessionCapture,
  writeTextArtifact,
} from './artifacts.ts'
import { composeMeasuredLaunch, composeVerificationLaunch, gitProvenance, loadEnvFile, type ComposedLaunch } from './launch.ts'
import { extractLiveMetrics } from './metrics.ts'
import { createBenchmarkProfile, type BenchmarkProfile, type BenchmarkProfileOptions } from './profile.ts'
import {
  LIVE_CAPTURE_SCHEMA_VERSION,
  LIVE_SESSION_CAPTURE_KIND,
  type AttemptRelation,
  type LiveAcceptedCommand,
  type LiveAnomaly,
  type LiveArtifactReference,
  type LiveAttemptBounds,
  type LiveAttemptCapture,
  type LiveAttemptRecord,
  type LiveCaptureError,
  type LiveCaptureMode,
  type LiveNotReachedAttempt,
  type LivePromptIdentity,
  type LiveSessionCapture,
  type LiveStopReason,
  type Observed,
} from './types.ts'

/**
 * The default bounds. The attempt bound is the release evaluator's
 * twenty-minute scenario budget — prior art for "a stuck Run", not a
 * product deadline. Acceptance, drain and abort are the observer's own.
 */
export const DEFAULT_ATTEMPT_BOUNDS: LiveAttemptBounds = {
  acceptanceMs: 30_000,
  attemptMs: 20 * 60_000,
  drainMs: 15_000,
  abortMs: 60_000,
}

/** How long a launch may take: a measured launch downloads its filter lists on a cold cache. */
export const DEFAULT_STARTUP_MS = 60_000

/** One CDP round trip may hang on a dead renderer; every one is bounded. */
const CDP_OP_MS = 10_000

const POLL_MS = 250

export interface CaptureSessionOptions {
  readonly mode: LiveCaptureMode
  readonly captureId: string
  readonly huntId: string
  readonly setId?: string
  /** Where the capture directory is claimed; `e2e/live/artifacts` by default. */
  readonly root?: string
  readonly profile?: BenchmarkProfileOptions
  /** Required in verification mode: the scripted env, and optionally a fixture server the caller owns. */
  readonly verification?: { readonly env: Record<string, string | undefined>; readonly fixture?: FixtureServer }
  /** Measured mode reads the process env by default; a caller may substitute one. */
  readonly processEnv?: Record<string, string | undefined>
  readonly accessGuard?: boolean
  readonly bounds?: Partial<LiveAttemptBounds>
  readonly startupMs?: number
}

export interface CaptureCommandInput {
  readonly attemptId: string
  readonly stepId: string
  readonly order: number
  readonly relation: AttemptRelation
  readonly parentAttemptId?: string
  readonly text: string
  readonly prompt: LivePromptIdentity
}

/** Why the same Session cannot take a follow-up right now. */
export type ContinuationBlock = 'awaiting_help' | 'run_active' | 'session_lost' | 'session_unavailable' | 'initial_not_accepted' | 'capture_failed'

export type ContinuationState = { readonly ready: true } | { readonly ready: false; readonly reason: ContinuationBlock; readonly detail: string }

export interface CaptureSession {
  readonly captureId: string
  readonly captureDir: string
  readonly mode: LiveCaptureMode
  /**
   * The real harness, exposed for verification code that needs to
   * observe the app (a DOM read, a storage probe). Null in measured
   * mode: measured scheduling never browses or steers through it.
   */
  readonly harness: Harness | null
  /** Submit exactly one command and observe it to its terminal or bound. Never throws on an app failure. */
  captureCommand(input: CaptureCommandInput): Promise<LiveAttemptRecord>
  /** A bounded check of whether the same Session can take a follow-up now. Never waits for one. */
  continuationState(): Promise<ContinuationState>
  /** Archive diagnostics, quit the app, write the capture, remove the profile. */
  close(): Promise<LiveSessionCapture>
}

/** A tape entry: a published event, or the submission feedback the bar was shown. */
type TapeEntry = PipelineEvent | { type: 'submission_feedback'; reason: string; message: string; at: number }

const TAPE_INSTALL = `
  (() => {
    if (!window.__liveTapeInstalled) {
      window.__liveTapeInstalled = true
      window.__liveTape = []
      window.bingbong.assistant.onEvent((event) => { window.__liveTape.push(event) })
      window.bingbong.assistant.onSubmissionFeedback((feedback) => { window.__liveTape.push({ ...feedback, type: 'submission_feedback' }) })
    }
    return window.__liveTape.length
  })()
`

const observed = <T>(value: T): Observed<T> => ({ status: 'observed', value })
const unavailable = <T>(reason: string): Observed<T> => ({ status: 'unavailable', reason })

function nowIso(): string {
  return new Date().toISOString()
}

/** Bound one operation; a hung CDP Promise is otherwise unbounded. */
async function bounded<T>(operation: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not settle within ${ms} ms`)), ms)
  })
  try {
    return await Promise.race([operation, timeout])
  } finally {
    clearTimeout(timer)
  }
}

function isCommand(entry: TapeEntry): entry is Extract<PipelineEvent, { type: 'command' }> {
  return entry.type === 'command'
}

export async function startCaptureSession(options: CaptureSessionOptions): Promise<CaptureSession> {
  const bounds: LiveAttemptBounds = { ...DEFAULT_ATTEMPT_BOUNDS, ...options.bounds }
  const startupMs = options.startupMs ?? DEFAULT_STARTUP_MS
  // Identity first: a reused capture id fails here, before a profile
  // exists or an app launches.
  const captureDir = claimCaptureDir(options.root ?? LIVE_ARTIFACTS_ROOT, options.captureId)
  const startedAt = nowIso()
  const errors: LiveCaptureError[] = []
  const attempts: LiveAttemptRecord[] = []
  let artifacts: LiveArtifactReference[] = []

  const profile: BenchmarkProfile = createBenchmarkProfile(options.profile)
  let ownedFixture: FixtureServer | null = null
  let composed: ComposedLaunch
  try {
    if (options.mode === 'measured') {
      composed = composeMeasuredLaunch({
        profile,
        envFile: loadEnvFile(options.processEnv ?? process.env),
        processEnv: options.processEnv ?? process.env,
        git: gitProvenance(),
        ...(options.accessGuard !== undefined ? { accessGuard: options.accessGuard } : {}),
      })
    } else {
      if (options.verification === undefined) throw new Error('verification mode needs a scripted env')
      const fixture = options.verification.fixture ?? (ownedFixture = await startFixtureServer())
      composed = composeVerificationLaunch({
        profile,
        env: options.verification.env,
        fixture,
        git: gitProvenance(),
        ...(options.accessGuard !== undefined ? { accessGuard: options.accessGuard } : {}),
      })
    }
  } catch (error) {
    profile.dispose()
    await ownedFixture?.close().catch(() => {})
    throw error
  }
  const { secrets } = composed

  const capture = (closeState: LiveSessionCapture['closeState'], retention: LiveSessionCapture['retention'], closedAt: string | null): LiveSessionCapture => ({
    kind: LIVE_SESSION_CAPTURE_KIND,
    schemaVersion: LIVE_CAPTURE_SCHEMA_VERSION,
    captureId: options.captureId,
    ...(options.setId !== undefined ? { setId: options.setId } : {}),
    huntId: options.huntId,
    mode: options.mode,
    startedAt,
    closedAt,
    launch: composed.provenance,
    attempts: [...attempts],
    artifacts: [...artifacts],
    closeState,
    errors: [...errors],
    retention,
  })

  const recordError = (stage: string, error: unknown): void => {
    errors.push({ at: nowIso(), stage, message: redactedMessage(error, secrets) })
  }

  /** Copy every diagnostic family out of the profile now; later copies overwrite with more. */
  const archive = (stage: string): { complete: boolean; note: string | null } => {
    const archived = archiveLogsDir(profile.logsDir, captureDir, { secrets })
    const byPath = new Map(artifacts.map((artifact) => [artifact.path, artifact]))
    for (const artifact of archived.artifacts) byPath.set(artifact.path, artifact)
    const ledger = archiveUsageLedger(profile.userDataDir, captureDir)
    if (ledger !== null) byPath.set(ledger.path, ledger)
    artifacts = [...byPath.values()]
    for (const failure of archived.failures) recordError(`${stage}.archive`, `${failure.name}: ${failure.reason}`)
    const incomplete = archived.artifacts.filter((artifact) => !artifact.complete)
    const notes = [
      ...archived.failures.map((failure) => `${failure.name} could not be copied`),
      ...incomplete.map((artifact) => `${artifact.locator ?? artifact.path}: ${artifact.note ?? 'incomplete'}`),
    ]
    return { complete: archived.failures.length === 0 && incomplete.length === 0, note: notes.length > 0 ? notes.join('; ') : null }
  }

  const checkpoint = (closeState: LiveSessionCapture['closeState'], closedAt: string | null = null): void => {
    const retention = archive('checkpoint')
    writeSessionCapture(captureDir, capture(closeState, retention, closedAt), { secrets })
  }

  // The capture exists on disk before the app does.
  checkpoint('open')

  let harness: Harness
  try {
    harness = await startHarness({
      userDataDir: profile.userDataDir,
      env: composed.env,
      productionDefaults: composed.productionDefaults,
      startupTimeoutMs: startupMs,
      ...(options.mode === 'verification' ? { fixture: options.verification!.fixture ?? ownedFixture! } : {}),
    })
    await bounded(harness.dashboardEval<number>(TAPE_INSTALL), CDP_OP_MS, 'installing the event tape')
  } catch (error) {
    recordError('launch', error)
    const retention = archive('launch_failed')
    writeSessionCapture(captureDir, capture('launch_failed', retention, nowIso()), { secrets })
    profile.dispose()
    await ownedFixture?.close().catch(() => {})
    throw error
  }

  let busy = false
  let closed = false
  let lastAccepted: LiveAcceptedCommand | null = null
  let lastCursor = 0
  let failed: string | null = null

  const readTape = (): Promise<TapeEntry[]> => bounded(harness.dashboardEval<TapeEntry[]>('window.__liveTape ?? []'), CDP_OP_MS, 'reading the event tape')
  const tapeLength = (): Promise<number> => bounded(harness.dashboardEval<number>('(window.__liveTape ?? []).length'), CDP_OP_MS, 'reading the tape length')
  const submitBusy = (): Promise<boolean> =>
    bounded(harness.overlayEval<boolean>(`document.querySelector('.prompt-form')?.getAttribute('aria-busy') === 'true'`), CDP_OP_MS, 'reading the Prompt Bar')
  const promptVerb = (): Promise<string> =>
    bounded(harness.overlayEval<string>(`document.querySelector('.prompt-verb')?.textContent ?? ''`), CDP_OP_MS, 'reading the Prompt Bar verb')
  const liveSession = (): Promise<{ sessionId: string; generation: number } | null> =>
    bounded(harness.dashboardEval<{ sessionId: string; generation: number } | null>('window.bingbong.session.current()'), CDP_OP_MS, 'reading the live Session')
  const helpCardsShown = (): Promise<boolean> =>
    bounded(harness.dashboardEval<boolean>(`!!document.querySelector('.ask-card') || !!document.querySelector('.confirmation-card')`), CDP_OP_MS, 'reading the help cards')

  /** Asks and confirmations raised since `cursor` that no resolution followed. */
  const openWaits = (tape: readonly TapeEntry[], cursor: number): string[] => {
    const since = tape.slice(cursor)
    const open: string[] = []
    for (const entry of since) {
      if (entry.type === 'ask_requested' && !since.some((other) => other.type === 'ask_resolved' && other.askId === entry.askId)) open.push(`ask ${entry.askId}`)
      if (entry.type === 'confirmation_requested' && !since.some((other) => other.type === 'confirmation_resolved' && other.confirmationId === entry.confirmationId)) {
        open.push(`confirmation ${entry.confirmationId}`)
      }
    }
    return open
  }

  async function continuationState(): Promise<ContinuationState> {
    if (closed || failed !== null) return { ready: false, reason: 'capture_failed', detail: failed ?? 'the capture is closed' }
    try {
      const tape = await readTape()
      const open = openWaits(tape, lastCursor)
      if (open.length > 0 || (await helpCardsShown())) {
        return { ready: false, reason: 'awaiting_help', detail: open.length > 0 ? `unresolved ${open.join(', ')}` : 'a help card is showing' }
      }
      if (busy) return { ready: false, reason: 'run_active', detail: 'a captureCommand is still observing its attempt' }
      const last = attempts.at(-1)
      if (last !== undefined) {
        if (last.kind === 'not_reached') return { ready: false, reason: 'session_unavailable', detail: `the previous slot was not reached: ${last.reason}` }
        if (last.accepted.status !== 'observed') return { ready: false, reason: 'initial_not_accepted', detail: last.accepted.reason }
        if (last.terminal.status !== 'observed') return { ready: false, reason: 'run_active', detail: `no terminal event was observed: ${last.terminal.reason}` }
      }
      if (await submitBusy()) return { ready: false, reason: 'run_active', detail: 'the initial submit has not settled' }
      if ((await promptVerb()) !== 'run') return { ready: false, reason: 'run_active', detail: 'the Prompt Bar is still steering a live Run' }
      const session = await liveSession()
      if (session === null) return { ready: false, reason: 'session_unavailable', detail: 'no live Session' }
      if (lastAccepted !== null && (session.sessionId !== lastAccepted.sessionId || session.generation !== lastAccepted.sessionGeneration)) {
        return { ready: false, reason: 'session_lost', detail: `the live Session ${session.sessionId}/${session.generation} is not the accepted ${lastAccepted.sessionId}/${lastAccepted.sessionGeneration}` }
      }
      return { ready: true }
    } catch (error) {
      return { ready: false, reason: 'capture_failed', detail: redactedMessage(error, secrets) }
    }
  }

  const notReached = (input: CaptureCommandInput, reason: string): LiveNotReachedAttempt => ({
    kind: 'not_reached',
    attemptId: input.attemptId,
    huntId: options.huntId,
    stepId: input.stepId,
    order: input.order,
    relation: input.relation,
    ...(input.parentAttemptId !== undefined ? { parentAttemptId: input.parentAttemptId } : {}),
    command: { text: input.text, prompt: input.prompt },
    reason,
    decidedAt: nowIso(),
  })

  async function captureCommand(input: CaptureCommandInput): Promise<LiveAttemptRecord> {
    if (closed) throw new Error('the capture Session is closed')
    if (busy) throw new Error('a captureCommand is already in flight — one command at a time')
    if (attempts.some((attempt) => attempt.attemptId === input.attemptId)) throw new Error(`attempt id ${input.attemptId} was already used in this capture`)
    if (input.relation !== 'initial' && input.parentAttemptId === undefined) throw new Error(`${input.relation} needs a parentAttemptId`)
    busy = true
    try {
      // A follow-up is dispatched only into a Session that can take it —
      // checked here, and verified again by the accepted identity.
      if (attempts.length > 0) {
        busy = false
        const state = await continuationState()
        busy = true
        if (!state.ready) {
          const record = notReached(input, `${state.reason}: ${state.detail}`)
          attempts.push(record)
          checkpoint('open')
          return record
        }
      }
      const record = await observeAttempt(input)
      attempts.push(record)
      checkpoint('open')
      return record
    } finally {
      busy = false
    }
  }

  async function observeAttempt(input: CaptureCommandInput): Promise<LiveAttemptCapture> {
    const anomalies: LiveAnomaly[] = []
    let accepted: Observed<LiveAcceptedCommand> = unavailable('the command was not submitted')
    // Held in one object: the tape projection below assigns these from a
    // closure, which a narrowed `let` would not survive.
    const seen: { finalAnswer: LiveAttemptCapture['finalAnswer']; terminal: LiveAttemptCapture['terminal'] } = {
      finalAnswer: unavailable('no final Answer was observed'),
      terminal: unavailable('no terminal event was observed'),
    }
    // Read through a call: a property narrowed once would stay narrowed
    // past the closure that reassigns it.
    const terminalSeen = (): boolean => seen.terminal.status === 'observed'
    let settlement: Observed<string> = unavailable('the submit never settled')
    let stop: LiveAttemptCapture['stop'] = { at: nowIso(), reason: 'observer_failure', detail: 'the attempt did not run' }
    let events: PipelineEvent[] = []
    let turnId: string | null = null
    const cursor = await tapeLength()
    lastCursor = cursor
    const requestedAt = nowIso()
    let submitResult = 'not submitted'

    const projectAttempt = (tape: readonly TapeEntry[]): void => {
      const since = tape.slice(cursor)
      if (turnId === null) return
      const own = turnId
      events = since.filter((entry): entry is PipelineEvent => entry.type !== 'submission_feedback' && 'turnId' in entry && entry.turnId === own)
      const marked = events.filter((event): event is Extract<PipelineEvent, { type: 'display' }> => event.type === 'display' && event.finalAnswer === true)
      if (marked.length === 1) {
        seen.finalAnswer = observed({ at: marked[0]!.at, text: marked[0]!.text, turnId: own, deterministic: marked[0]!.deterministicAnswer === true })
      } else if (marked.length > 1) {
        seen.finalAnswer = { status: 'invalid', reason: `${marked.length} displays were marked as the final Answer` }
      }
      const done = events.find((event): event is Extract<PipelineEvent, { type: 'done' }> => event.type === 'done')
      if (done !== undefined) {
        seen.terminal = observed({ at: done.at, turnId: own, outcome: done.outcome ?? null, resolution: done.resolution ?? null, finalizationCause: done.finalizationCause ?? null })
      }
      // A second accepted command of the same text after ours, in another
      // Session, is the app's own reset replay (#99): recorded, never merged.
      for (const entry of since.filter(isCommand)) {
        if (entry.turnId !== own && entry.text === input.text && !anomalies.some((anomaly) => anomaly.detail.includes(entry.turnId))) {
          anomalies.push({ kind: 'session_reset_replay', at: entry.at, detail: `command replayed as turn ${entry.turnId} in Session ${String(entry.sessionId)}/${String(entry.sessionGeneration)}` })
        }
      }
    }

    try {
      submitResult = await bounded(harness.submitCommand(input.text), CDP_OP_MS, 'driving the Prompt Bar')
      if (submitResult !== 'submitted') {
        stop = { at: nowIso(), reason: 'rejected', detail: `the Prompt Bar reported ${submitResult}` }
        accepted = unavailable(`the Prompt Bar reported ${submitResult}`)
      } else {
        // Acceptance: the app's own command event, after the cursor, with
        // its identities — not the form having submitted.
        const acceptanceDeadline = Date.now() + bounds.acceptanceMs
        let rejection: string | null = null
        while (Date.now() < acceptanceDeadline && turnId === null && rejection === null) {
          const tape = await readTape()
          const since = tape.slice(cursor)
          const command = since.find((entry): entry is Extract<PipelineEvent, { type: 'command' }> => isCommand(entry) && entry.text === input.text)
          if (command !== undefined) {
            if (command.runId === undefined || command.sessionId === undefined || command.sessionGeneration === undefined || command.submissionId === undefined) {
              accepted = { status: 'invalid', reason: 'the command event carries no Run/Session identity' }
              rejection = 'unstamped command event'
            } else {
              turnId = command.turnId
              lastAccepted = {
                at: command.at,
                text: command.text,
                turnId: command.turnId,
                runId: String(command.runId),
                sessionId: String(command.sessionId),
                sessionGeneration: Number(command.sessionGeneration),
                submissionId: String(command.submissionId),
              }
              accepted = observed(lastAccepted)
            }
            break
          }
          const feedback = since.find((entry) => entry.type === 'submission_feedback')
          if (feedback !== undefined && feedback.type === 'submission_feedback') {
            rejection = `${feedback.reason}: ${feedback.message}`
            anomalies.push({ kind: 'busy_rejection', at: feedback.at, detail: rejection })
            accepted = unavailable(`the submission was rejected — ${rejection}`)
          }
          if (turnId === null && rejection === null) await sleep(POLL_MS)
        }
        if (turnId === null) {
          stop = rejection !== null ? { at: nowIso(), reason: 'rejected', detail: rejection } : { at: nowIso(), reason: 'acceptance_timeout', detail: `no accepted command within ${bounds.acceptanceMs} ms` }
          if (rejection === null) accepted = unavailable(`no accepted command event within ${bounds.acceptanceMs} ms of submission`)
        } else {
          // The Run, to its terminal or to the bound.
          const attemptDeadline = Date.now() + bounds.attemptMs
          for (;;) {
            projectAttempt(await readTape())
            if (terminalSeen()) break
            if (Date.now() >= attemptDeadline) {
              stop = { at: nowIso(), reason: 'attempt_timeout', detail: `no terminal event within ${bounds.attemptMs} ms; one abort was sent` }
              await bounded(harness.dashboardEval('window.bingbong.assistant.abort()'), CDP_OP_MS, 'aborting the Run').catch((error: unknown) => recordError('abort', error))
              const abortDeadline = Date.now() + bounds.abortMs
              while (Date.now() < abortDeadline) {
                projectAttempt(await readTape())
                if (terminalSeen()) break
                await sleep(POLL_MS)
              }
              break
            }
            await sleep(POLL_MS)
          }
          if (stop.reason === 'observer_failure') stop = { at: nowIso(), reason: 'terminal' }
          // Drain: the submit's own settlement (the runner has unwound —
          // failure screenshot included) and any post-terminal events.
          const drainDeadline = Date.now() + bounds.drainMs
          while (Date.now() < drainDeadline) {
            if (!(await submitBusy())) {
              settlement = observed(nowIso())
              break
            }
            await sleep(POLL_MS)
          }
          if (settlement.status !== 'observed') settlement = unavailable(`the submit had not settled ${bounds.drainMs} ms after the terminal`)
          projectAttempt(await readTape())
        }
      }
    } catch (error) {
      // The observer failed: its reason stands, one bounded abort follows,
      // and nothing is invented for the Run.
      const detail = redactedMessage(error, secrets)
      recordError('observe', error)
      stop = { at: nowIso(), reason: 'observer_failure', detail }
      failed = detail
      await bounded(harness.dashboardEval('window.bingbong.assistant.abort()'), CDP_OP_MS, 'aborting after an observer failure').catch(() => {})
    }

    const stoppedAt = nowIso()
    const waits = waitsOf(events)
    const perfRecords: PerfSpanRecord[] = turnId === null ? [] : collectPerfRecords(profile.logsDir).records.filter((record) => record.turnId === turnId)
    const traceRecords: TraceRecord[] = turnId === null ? [] : readRunTrace(profile.userDataDir).filter((record) => 'turnId' in record && record.turnId === turnId)
    const metrics = extractLiveMetrics({ events, perfRecords, traceRecords, input: 'typed', clockOrigin: options.captureId })
    const tape = turnId === null ? null : writeEventTape(captureDir, { attemptId: input.attemptId, turnId, events }, { secrets })
    if (tape !== null) artifacts = [...artifacts.filter((artifact) => artifact.path !== tape.path), tape]
    const continuation = await continuationStateAfter()
    return {
      kind: 'attempt',
      attemptId: input.attemptId,
      huntId: options.huntId,
      stepId: input.stepId,
      order: input.order,
      relation: input.relation,
      ...(input.parentAttemptId !== undefined ? { parentAttemptId: input.parentAttemptId } : {}),
      command: { text: input.text, prompt: input.prompt },
      dispatch: { requestedAt, submitResult, cursor },
      accepted,
      finalAnswer: seen.finalAnswer,
      terminal: seen.terminal,
      settlement,
      stop: { ...stop, at: stop.reason === 'terminal' ? stoppedAt : stop.at },
      waits,
      anomalies,
      continuation,
      bounds,
      metrics,
      events: tape,
    }
  }

  /** The readiness verdict recorded on the attempt itself, evaluated with the attempt's own observation over. */
  async function continuationStateAfter(): Promise<LiveAttemptCapture['continuation']> {
    const wasBusy = busy
    busy = false
    try {
      const state = await continuationState()
      return { ready: state.ready, reason: state.ready ? 'terminal seen, submit settled, no open wait, Session live' : `${state.reason}: ${state.detail}`, checkedAt: nowIso() }
    } finally {
      busy = wasBusy
    }
  }

  async function close(): Promise<LiveSessionCapture> {
    if (closed) throw new Error('the capture Session is already closed')
    if (busy) throw new Error('close() while a captureCommand is in flight — await it first')
    closed = true
    // Archive before anything can purge or the app can be gone.
    archive('close.before_quit')
    let closeState: LiveSessionCapture['closeState'] = 'closed'
    try {
      await bounded(harness.quit(), 30_000, 'quitting the app')
    } catch (error) {
      recordError('quit', error)
      closeState = 'interrupted'
    }
    const stderr = harness.stderrTail()
    if (stderr !== '') {
      const ref = writeTextArtifact(captureDir, 'stderr.txt', 'stderr', stderr, { secrets, note: 'bounded tail of the app process stderr' })
      artifacts = [...artifacts.filter((artifact) => artifact.path !== ref.path), ref]
    }
    // Archive again: the graceful quit wrote its Session end records.
    const retention = archive('close.after_quit')
    const closedAt = nowIso()
    const problems = verifyArtifacts(captureDir, capture(closeState, retention, closedAt))
    for (const problem of problems) recordError('verify', problem)
    const finalRetention =
      problems.length === 0 ? retention : { complete: false, note: [retention.note, ...problems].filter((note) => note !== null).join('; ') }
    const finalCapture = capture(closeState, finalRetention, closedAt)
    writeSessionCapture(captureDir, finalCapture, { secrets })
    await ownedFixture?.close().catch(() => {})
    // The disposable profile goes only once its diagnostics are safely
    // out; an incomplete archive keeps it, and says so.
    if (finalRetention.complete) {
      profile.dispose()
    } else {
      const kept = capture(closeState, { complete: false, note: `${finalRetention.note ?? 'incomplete archive'}; profile retained at ${profile.userDataDir}` }, closedAt)
      writeSessionCapture(captureDir, kept, { secrets })
      return kept
    }
    return finalCapture
  }

  return {
    captureId: options.captureId,
    captureDir,
    mode: options.mode,
    harness: options.mode === 'verification' ? harness : null,
    captureCommand,
    continuationState,
    close,
  }
}

/** Every ask and confirmation of the attempt, with its resolution when one came. */
function waitsOf(events: readonly PipelineEvent[]): LiveAttemptCapture['waits'] {
  const waits: LiveAttemptCapture['waits'][number][] = []
  for (const event of events) {
    if (event.type === 'ask_requested') {
      const resolved = events.find((other) => other.type === 'ask_resolved' && other.askId === event.askId)
      waits.push({ kind: 'ask', id: event.askId, requestedAt: event.at, resolvedAt: resolved?.at ?? null, ...(resolved?.type === 'ask_resolved' ? { reason: resolved.reason } : {}) })
    }
    if (event.type === 'confirmation_requested') {
      const resolved = events.find((other) => other.type === 'confirmation_resolved' && other.confirmationId === event.confirmationId)
      waits.push({
        kind: 'confirmation',
        id: event.confirmationId,
        requestedAt: event.at,
        resolvedAt: resolved?.at ?? null,
        ...(resolved?.type === 'confirmation_resolved' ? { reason: resolved.reason } : {}),
      })
    }
  }
  return waits
}

/** The path of a capture's `capture.json` under a root — for callers that only hold the id. */
export function captureFilePath(captureId: string, root: string = LIVE_ARTIFACTS_ROOT): string {
  return join(root, captureId, 'capture.json')
}

/** The stop reasons that mean the measurement, not the task, broke. */
export const MEASUREMENT_FAULT_REASONS: readonly LiveStopReason[] = ['observer_failure', 'acceptance_timeout', 'rejected']
