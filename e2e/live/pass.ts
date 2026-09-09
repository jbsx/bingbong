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

import { promptIdentity } from './artifacts.ts'
import { MEASUREMENT_FAULT_REASONS, type CaptureSession, type CaptureSessionOptions, type ContinuationBlock } from './capture.ts'
import { liveWebHunts, type LiveWebHunt, type MeasuredPrompt } from './hunts.ts'
import { brokenMeasurements } from './schedule.ts'
import type { CommandRole, ContinuationState, HuntCaptureHost, HuntContext, NotReachedReason, PassRecord, ScheduledAttempt } from './schedule.ts'
import type {
  LiveAttemptRecord,
  LiveCaptureMode,
  LiveCaptureSet,
  LiveCaptureSetState,
  LivePromptIdentity,
  LiveScheduledAttempt,
  LiveSessionReference,
  LiveStopReason,
} from './types.ts'
import { LIVE_CAPTURE_SCHEMA_VERSION, LIVE_CAPTURE_SET_KIND } from './types.ts'

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
// The two derivations the schedule needs
// ---------------------------------------------------------------------------

/**
 * Starting one capture session, injectable so the schedule can be driven
 * against a double. In production this is #224's `startCaptureSession`.
 */
export type StartCaptureSession = (options: CaptureSessionOptions) => Promise<CaptureSession>

/**
 * Which stop reasons mean the harness failed rather than the task did —
 * #224's own list, not a second copy of it. `observer_failure` and
 * `acceptance_timeout` are plainly instrumentation; `rejected` counts because
 * the schedule submits into an idle Session by contract, so a busy rejection
 * means the readiness check was wrong, and reading it as a task outcome would
 * quietly convert a scheduling bug into a failed hunt.
 *
 * Absent on purpose: `attempt_timeout` and `session_lost` are things that
 * happened to the Run — real, retained, and graded as task outcomes.
 */
const MEASUREMENT_FAULT_STOPS: readonly LiveStopReason[] = MEASUREMENT_FAULT_REASONS

/** #224's continuation vocabulary in #225's. Total, so a new block cannot go unmapped. */
const CONTINUATION_REASONS: Readonly<Record<ContinuationBlock, NotReachedReason>> = {
  awaiting_help: 'awaiting_help',
  session_lost: 'session_lost',
  session_unavailable: 'session_unavailable',
  initial_not_accepted: 'initial_not_accepted',
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

/** Derive the schedule's view of a capture. The only place these rules live. */
export function scheduledView(capture: LiveAttemptRecord): HuntAttempt {
  if (capture.kind !== 'attempt') {
    // The capture re-checks readiness immediately before submitting, so it can
    // refuse after the schedule's own check passed — a Session that lapsed in
    // between. Nothing was submitted, so this is a not-reached command rather
    // than a Run that went badly, and `session_unavailable` is the honest
    // reading: the Session could not take it now. The capture's own words are
    // kept as the detail rather than being re-worded here.
    return {
      capture,
      declined: { reason: 'session_unavailable', detail: capture.reason },
      accepted: false,
      measurementFault: null,
    }
  }
  return {
    capture,
    declined: null,
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

/**
 * The schedule's command roles in #224's step vocabulary. They differ by one
 * character (`follow-up` against `follow_up`), so the translation is a total
 * map rather than a conditional: a role that gained no step label would fail
 * to compile instead of dispatching under the wrong id.
 */
const STEP_IDS: Readonly<Record<CommandRole, StepId>> = {
  initial: 'initial',
  'follow-up': 'follow_up',
}

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
  readonly verification?: CaptureSessionOptions['verification']
  /** The hunts this pass will run, so slot order matches the set file. Defaults to the corpus. */
  readonly hunts?: readonly LiveWebHunt[]
  /**
   * Capture knobs forwarded to every hunt's session unchanged — attempt
   * bounds, startup budget, the access guard, the profile recipe. Forwarded
   * rather than chosen here: how long a Run may take is the capture
   * contract's business, not the protocol's.
   */
  readonly capture?: Pick<CaptureSessionOptions, 'profile' | 'accessGuard' | 'bounds' | 'startupMs'>
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
        ...options.capture,
      })

      return {
        async submit(prompt: MeasuredPrompt, role: CommandRole): Promise<HuntAttempt> {
          const slot = slotFor(hunt.id, STEP_IDS[role])
          return scheduledView(
            await session.captureCommand({
              attemptId: slot.attemptId,
              stepId: slot.stepId,
              order: slot.order,
              relation: slot.relation,
              parentAttemptId: slot.parentAttemptId,
              // The corpus stores prompts exactly as #223 approved them, and
              // corpus.test.ts pins them single-line — the capture refuses a
              // newline, because the Prompt Bar would strip it and the
              // accepted text would then never match what was dispatched.
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
  // The walk over a pass belongs to the pass; this only names the result in
  // #224's set vocabulary.
  const broken = brokenMeasurements(pass)
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
