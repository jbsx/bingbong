// The adapter between #225's schedule and #224's capture (#225).
//
// The schedule (./schedule.ts) knows the protocol — what is submitted, in what
// order, once each, and what a follow-up that cannot happen is called. The
// capture (#224's ./capture.ts) knows Electron — launching the app on a fresh
// benchmark profile, driving the real Prompt Bar, observing pipeline
// acceptance, separating the Answer stamp from the Run's end, archiving
// diagnostics. Neither imports the other. This file is the whole of the join,
// and it is deliberately thin: two field derivations, one reason mapping, and
// the planned population a set file needs.
//
// WHY THE PORT IS SO NARROW. The schedule reads two things about a capture —
// whether the pipeline accepted the command, and whether the harness itself
// broke. Everything else #224 records (timings, usage, provenance, anomalies,
// retained artifacts) rides through untouched under `capture`, so #224's
// record can grow without the protocol noticing. The schedule cannot read an
// Answer, because a schedule that can read an Answer is a schedule that can be
// made to depend on one.
//
// WHAT "ACCEPTED" MEANS HERE. `accepted.status === 'observed'` — the app's own
// `command` event, carrying a turn id. Not the Prompt Bar's DOM submit, which
// says only that a form was requested, and not the task going well. The
// distinction matters because the schedule gates a follow-up on it: a command
// that was never accepted started no Run, so there is nothing to continue.

import { promptIdentity } from './artifacts'
import { liveWebHunts, type LiveWebHunt, type MeasuredPrompt } from './hunts'
import type { CommandRole, ContinuationState, HuntCaptureHost, HuntContext, NotReachedReason, PassRecord, ScheduledAttempt } from './schedule'
import type {
  AttemptRelation,
  LiveAttemptRecord,
  LiveCaptureMode,
  LiveCaptureSet,
  LiveCaptureSetState,
  LivePromptIdentity,
  LiveScheduledAttempt,
  LiveSessionCapture,
  LiveSessionReference,
  LiveStopReason,
} from './types'
import { LIVE_CAPTURE_SCHEMA_VERSION, LIVE_CAPTURE_SET_KIND } from './types'

/**
 * This study's identity, stamped on every set file. `protocolVersion` tracks
 * docs/liveweb-hunt-protocol.md: a change to what a pass submits or how it
 * isolates hunts bumps it, so two sets are never silently compared across a
 * protocol change.
 */
export const LIVE_WEB_STUDY = {
  name: 'bingbong.live-web.information-hunts',
  protocolVersion: '1',
} as const

// ---------------------------------------------------------------------------
// #224's capture handle
//
// Declared structurally rather than imported, because ./capture.ts is #224's
// and lands separately. The shapes mirror its published contract exactly; when
// it lands these become type-only imports and nothing else here changes.
// ---------------------------------------------------------------------------

export interface LiveCaptureCommand {
  readonly attemptId: string
  readonly huntId: string
  readonly stepId: string
  readonly order: number
  readonly relation: AttemptRelation
  readonly parentAttemptId?: string
  readonly text: string
  readonly prompt: LivePromptIdentity
}

/** #224's continuation vocabulary. `run_active` has no counterpart of its own here — see CONTINUATION_REASONS. */
export type LiveContinuationReason =
  | 'awaiting_help'
  | 'session_lost'
  | 'session_unavailable'
  | 'run_active'
  | 'capture_failed'

export type LiveContinuationState =
  | { readonly ready: true }
  | { readonly ready: false; readonly reason: LiveContinuationReason; readonly detail: string }

/** One launched app on one fresh benchmark profile: #224's `startCaptureSession` handle. */
export interface LiveCaptureSession {
  captureCommand(command: LiveCaptureCommand): Promise<LiveAttemptRecord>
  continuationState(): Promise<LiveContinuationState>
  close(): Promise<LiveSessionCapture>
}

export interface StartCaptureOptions {
  readonly mode: LiveCaptureMode
  readonly captureId: string
  readonly huntId: string
  readonly setId?: string
  readonly root?: string
  readonly verification?: { readonly env: Record<string, string | undefined>; readonly fixture?: unknown }
}

export type StartCaptureSession = (options: StartCaptureOptions) => Promise<LiveCaptureSession>

// ---------------------------------------------------------------------------
// The two derivations the schedule needs
// ---------------------------------------------------------------------------

/**
 * Stop reasons that mean the harness failed rather than the task did.
 *
 * `observer_failure` and `acceptance_timeout` are plainly instrumentation.
 * `rejected` is here because a rejected submission is not a Run at all: the
 * schedule submits into an idle Session by contract, so a busy rejection means
 * the capture's own readiness check was wrong. Reading it as a task outcome
 * would quietly convert a scheduling bug into a failed hunt.
 *
 * Absent on purpose: `attempt_timeout` and `session_lost`, which are things
 * that happened to the Run — real, retained, and graded as task outcomes.
 */
const MEASUREMENT_FAULT_STOPS: readonly LiveStopReason[] = ['observer_failure', 'acceptance_timeout', 'rejected']

/** #224's continuation reasons in #225's vocabulary. */
const CONTINUATION_REASONS: Readonly<Record<LiveContinuationReason, NotReachedReason>> = {
  awaiting_help: 'awaiting_help',
  session_lost: 'session_lost',
  session_unavailable: 'session_unavailable',
  // A Run still live at the readiness check is a Session that cannot take the
  // command now. The schedule never waits it out — waiting until it works is
  // how an unreachable continuation quietly becomes a successful one.
  run_active: 'session_unavailable',
  capture_failed: 'capture_failed',
}

/** A capture, plus the two facts the schedule reads off it. */
export interface HuntAttempt extends ScheduledAttempt {
  /** #224's record, whole and untouched. */
  readonly capture: LiveAttemptRecord
}

/** Derive the schedule's view of a capture. The only place these two rules live. */
export function scheduledView(capture: LiveAttemptRecord): HuntAttempt {
  if (capture.kind !== 'attempt') {
    // #224 declined to dispatch. No Run exists, so nothing can continue from
    // it; the reason it gives is preserved on the record itself.
    return { capture, accepted: false, measurementFault: null }
  }
  return {
    capture,
    accepted: capture.accepted.status === 'observed',
    measurementFault: MEASUREMENT_FAULT_STOPS.includes(capture.stop.reason)
      ? (capture.stop.detail ?? capture.stop.reason)
      : null,
  }
}

// ---------------------------------------------------------------------------
// The planned population
// ---------------------------------------------------------------------------

/** The step label a command is filed under. #224's `stepId`. */
export type StepId = 'initial' | 'follow_up'

/** Filename-safe and stable across passes — an attempt id names a slot, not a run. */
export function attemptIdFor(huntId: string, stepId: StepId): string {
  return `${huntId}--${stepId}`
}

function identityOf(prompt: MeasuredPrompt): LivePromptIdentity {
  return promptIdentity(String(prompt.version), prompt.text)
}

/**
 * The population a pass intends to produce, in execution order.
 *
 * A set carries this so a report can name a slot that was never reached
 * without importing the scheduler that planned it — which is what makes "a
 * follow-up that did not happen is visible" true for a reader who only ever
 * sees the artifacts.
 *
 * A follow-up is `revised_objective`, never `corrective`: it changes the
 * requirements of a task that already ran, and it goes out whether or not the
 * initial Answer was right. Nothing in this study is a retry.
 */
export function plannedSlots(hunts: readonly LiveWebHunt[] = liveWebHunts()): LiveScheduledAttempt[] {
  const slots: LiveScheduledAttempt[] = []
  for (const hunt of hunts) {
    const initialId = attemptIdFor(hunt.id, 'initial')
    slots.push({
      attemptId: initialId,
      huntId: hunt.id,
      stepId: 'initial',
      order: slots.length,
      prompt: identityOf(hunt.prompt),
      relation: 'initial',
    })
    if (hunt.followUp) {
      slots.push({
        attemptId: attemptIdFor(hunt.id, 'follow_up'),
        huntId: hunt.id,
        stepId: 'follow_up',
        order: slots.length,
        prompt: identityOf(hunt.followUp),
        relation: 'revised_objective',
        parentAttemptId: initialId,
      })
    }
  }
  return slots
}

// ---------------------------------------------------------------------------
// The host
// ---------------------------------------------------------------------------

export interface HuntCaptureHostOptions {
  readonly mode: LiveCaptureMode
  readonly setId: string
  /** Artifact root; defaults to #224's. */
  readonly root?: string
  /** Verification-mode composition — a scripted model and fixture pages. Never present in measured mode. */
  readonly verification?: StartCaptureOptions['verification']
  /** The hunts this pass will run, so slot order matches the set file. Defaults to the corpus. */
  readonly hunts?: readonly LiveWebHunt[]
}

/** A host, plus the session files it produced — the set file needs both. */
export interface LiveHuntCaptureHost extends HuntCaptureHost<HuntAttempt> {
  /** One reference per hunt that got as far as a launched app, in the order they ran. */
  readonly sessions: readonly LiveSessionReference[]
}

/**
 * Drive #224's capture from #225's schedule.
 *
 * One `startCaptureSession` per hunt is what makes independent hunts
 * independent: a new session is a new app launch on a fresh benchmark profile,
 * so no cookie, no local storage entry and no Session evidence can cross from
 * one hunt to the next. A follow-up rides the same handle, which is what
 * preserves its hunt's Session and profile — there is nowhere else to send it.
 */
export function createHuntCaptureHost(
  startCaptureSession: StartCaptureSession,
  options: HuntCaptureHostOptions,
): LiveHuntCaptureHost {
  const slots = plannedSlots(options.hunts)
  const sessions: LiveSessionReference[] = []

  function slotFor(huntId: string, stepId: StepId): LiveScheduledAttempt {
    const slot = slots.find((candidate) => candidate.huntId === huntId && candidate.stepId === stepId)
    if (!slot) {
      throw new Error(`no planned slot for ${huntId}/${stepId} — the pass and its set file disagree about the population`)
    }
    return slot
  }

  return {
    sessions,
    async beginHunt(hunt: LiveWebHunt): Promise<HuntContext<HuntAttempt>> {
      const captureId = `${options.setId}--${hunt.id}`
      const session = await startCaptureSession({
        mode: options.mode,
        captureId,
        huntId: hunt.id,
        setId: options.setId,
        root: options.root,
        verification: options.verification,
      })

      return {
        async submit(prompt: MeasuredPrompt, role: CommandRole): Promise<HuntAttempt> {
          const stepId: StepId = role === 'initial' ? 'initial' : 'follow_up'
          const slot = slotFor(hunt.id, stepId)
          return scheduledView(
            await session.captureCommand({
              attemptId: slot.attemptId,
              huntId: slot.huntId,
              stepId: slot.stepId,
              order: slot.order,
              relation: slot.relation,
              parentAttemptId: slot.parentAttemptId,
              text: prompt.text,
              prompt: slot.prompt,
            }),
          )
        },

        async continuationState(): Promise<ContinuationState> {
          const state = await session.continuationState()
          if (state.ready) {
            return { ready: true }
          }
          return { ready: false, reason: CONTINUATION_REASONS[state.reason], detail: state.detail }
        },

        async end(): Promise<void> {
          // close() archives diagnostics out of the profile and writes the
          // capture file before the disposable profile is removed, so the
          // reference below always names a file that exists.
          const capture = await session.close()
          sessions.push({ captureId: capture.captureId, huntId: capture.huntId, path: `${capture.captureId}/capture.json` })
        },
      }
    },
  }
}

// ---------------------------------------------------------------------------
// The set file
// ---------------------------------------------------------------------------

/**
 * A set is `measurement_failed` when any scheduled command could not be
 * observed, and `complete` otherwise — including when hunts simply failed.
 *
 * That asymmetry is the point #223 keeps returning to: a task the assistant
 * got wrong is a finding and the pass that recorded it is complete, while a
 * command the harness could not observe is a broken measurement and the pass
 * must say so rather than presenting a hole as a result.
 */
export function passState<TAttempt extends ScheduledAttempt>(pass: PassRecord<TAttempt>): {
  state: LiveCaptureSetState
  stateReason?: string
} {
  const broken: string[] = []
  for (const hunt of pass.hunts) {
    for (const record of [hunt.initial, hunt.followUp]) {
      if (record === null) continue
      if (record.status === 'not-reached' && record.reason === 'capture_failed') {
        broken.push(`${hunt.huntId}: ${record.detail}`)
      }
      if (record.status === 'attempted' && record.attempt.measurementFault !== null) {
        broken.push(`${hunt.huntId}: ${record.attempt.measurementFault}`)
      }
    }
  }
  return broken.length > 0
    ? { state: 'measurement_failed', stateReason: broken.join('; ') }
    : { state: 'complete' }
}

export interface CaptureSetOptions {
  readonly setId: string
  readonly mode: LiveCaptureMode
  readonly sessions: readonly LiveSessionReference[]
  readonly hunts?: readonly LiveWebHunt[]
  /** ISO-8601; defaults to now. */
  readonly createdAt?: string
}

/**
 * Build the set file for a finished pass: the population it planned, the
 * session captures it produced, and whether the measurement held.
 *
 * The slots come from the corpus rather than from the results, which is what
 * lets a reader see a command that never happened at all. A set whose slots
 * were read back off its own results could only ever describe what did.
 */
export function captureSetOf<TAttempt extends ScheduledAttempt>(
  pass: PassRecord<TAttempt>,
  options: CaptureSetOptions,
): LiveCaptureSet {
  const { state, stateReason } = passState(pass)
  return {
    kind: LIVE_CAPTURE_SET_KIND,
    schemaVersion: LIVE_CAPTURE_SCHEMA_VERSION,
    setId: options.setId,
    study: { name: LIVE_WEB_STUDY.name, protocolVersion: LIVE_WEB_STUDY.protocolVersion },
    mode: options.mode,
    createdAt: options.createdAt ?? new Date().toISOString(),
    slots: plannedSlots(options.hunts),
    sessions: options.sessions,
    state,
    ...(stateReason === undefined ? {} : { stateReason }),
  }
}
