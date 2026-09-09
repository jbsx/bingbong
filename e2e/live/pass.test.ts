import { describe, expect, it } from 'vitest'
import { validateCaptureSet } from './artifacts'
import { liveWebHunts, type LiveWebHunt } from './hunts'
import { extractLiveMetrics } from './metrics'
import {
  attemptIdFor,
  captureSetOf,
  createHuntCaptureHost,
  passState,
  plannedSlots,
  scheduledView,
  type HuntAttempt,
  type LiveCaptureCommand,
  type LiveCaptureSession,
  type LiveContinuationState,
  type StartCaptureOptions,
} from './pass'
import { runLiveWebPass } from './schedule'
import type { LiveAttemptCapture, LiveAttemptRecord, LiveSessionCapture, LiveStopReason } from './types'

// The join between #225's schedule and #224's capture. Two derivations, one
// reason mapping, and the planned population — all of which decide what a
// downstream grader is able to see, and none of which a paid Electron run is
// a sensible way to check.
//
// The doubles below are built against #224's real types (and its real metric
// projection), so a contract change breaks this file loudly rather than
// letting the adapter drift out of shape.

const CORPUS = liveWebHunts()
const [PI, WATCH, EUROSTAR, VOYAGER] = CORPUS

const EMPTY_METRICS = extractLiveMetrics({ events: [], perfRecords: [], traceRecords: [], input: 'typed' })

function attempt(overrides: {
  huntId?: string
  stepId?: string
  acceptedAt?: number | null
  stop?: LiveStopReason
  detail?: string
}): LiveAttemptCapture {
  const acceptedAt = overrides.acceptedAt ?? 1_000
  return {
    kind: 'attempt',
    attemptId: attemptIdFor(overrides.huntId ?? PI.id, 'initial'),
    huntId: overrides.huntId ?? PI.id,
    stepId: overrides.stepId ?? 'initial',
    order: 0,
    relation: 'initial',
    command: { text: 'a command', prompt: { version: '1', hash: 'sha256:abc' } },
    dispatch: { requestedAt: '2026-09-09T00:00:00.000Z', submitResult: 'submitted', cursor: 0 },
    accepted:
      overrides.acceptedAt === null
        ? { status: 'unavailable', reason: 'no command event carried this text' }
        : {
            status: 'observed',
            value: {
              at: acceptedAt,
              text: 'a command',
              turnId: 't1',
              runId: 'r1',
              sessionId: 's1',
              sessionGeneration: 0,
              submissionId: 'sub1',
            },
          },
    finalAnswer: { status: 'unavailable', reason: 'no marked final display' },
    terminal: { status: 'unavailable', reason: 'no done event' },
    settlement: { status: 'unavailable', reason: 'not observed' },
    stop: { at: '2026-09-09T00:01:00.000Z', reason: overrides.stop ?? 'terminal', detail: overrides.detail },
    waits: [],
    anomalies: [],
    continuation: { ready: true, reason: '', checkedAt: '2026-09-09T00:01:00.000Z' },
    bounds: { acceptanceMs: 30_000, attemptMs: 1_200_000, drainMs: 500, abortMs: 60_000 },
    metrics: EMPTY_METRICS,
    events: null,
  }
}

interface SessionScript {
  /** What each step returns, by stepId. */
  results?: Record<string, LiveAttemptRecord>
  continuation?: LiveContinuationState
}

class FakeCaptures {
  readonly started: StartCaptureOptions[] = []
  readonly commands: LiveCaptureCommand[] = []
  readonly closed: string[] = []
  /** Which session handle each step was submitted through. */
  readonly handles = new Map<string, object>()

  constructor(private readonly script: Record<string, SessionScript> = {}) {}

  start = async (options: StartCaptureOptions): Promise<LiveCaptureSession> => {
    this.started.push(options)
    const scripted = this.script[options.huntId] ?? {}
    const session: LiveCaptureSession = {
      captureCommand: async (command: LiveCaptureCommand): Promise<LiveAttemptRecord> => {
        this.commands.push(command)
        this.handles.set(`${command.huntId}:${command.stepId}`, session)
        return scripted.results?.[command.stepId] ?? attempt({ huntId: command.huntId, stepId: command.stepId })
      },
      continuationState: async (): Promise<LiveContinuationState> => scripted.continuation ?? { ready: true },
      close: async (): Promise<LiveSessionCapture> => {
        this.closed.push(options.captureId)
        return { captureId: options.captureId, huntId: options.huntId } as unknown as LiveSessionCapture
      },
    }
    return session
  }
}

describe('the schedule’s view of a capture', () => {
  it('reads acceptance from the app’s own command event', () => {
    expect(scheduledView(attempt({})).accepted).toBe(true)
    expect(scheduledView(attempt({ acceptedAt: null })).accepted).toBe(false)
  })

  it('treats a slot #224 declined to dispatch as unaccepted, not as a fault', () => {
    const notReached: LiveAttemptRecord = {
      kind: 'not_reached',
      attemptId: 'x',
      huntId: PI.id,
      stepId: 'follow_up',
      order: 1,
      relation: 'revised_objective',
      parentAttemptId: 'y',
      command: { text: 't', prompt: { version: '1', hash: 'sha256:abc' } },
      reason: 'the Session was gone',
      decidedAt: '2026-09-09T00:00:00.000Z',
    }
    expect(scheduledView(notReached)).toMatchObject({ accepted: false, measurementFault: null })
  })

  it.each<LiveStopReason>(['observer_failure', 'acceptance_timeout', 'rejected'])(
    'calls %s broken measurement',
    (reason) => {
      expect(scheduledView(attempt({ stop: reason, detail: 'the tape was lost' })).measurementFault).toBe(
        'the tape was lost',
      )
    },
  )

  it('falls back to the stop reason when a fault carries no detail', () => {
    expect(scheduledView(attempt({ stop: 'observer_failure' })).measurementFault).toBe('observer_failure')
  })

  it.each<LiveStopReason>(['terminal', 'attempt_timeout', 'session_lost'])(
    'leaves %s as a task outcome, not a fault',
    (reason) => {
      expect(scheduledView(attempt({ stop: reason, detail: 'the Run ran out of time' })).measurementFault).toBeNull()
    },
  )
})

describe('the planned population', () => {
  it('plans six slots in execution order', () => {
    const slots = plannedSlots()
    expect(slots).toHaveLength(6)
    expect(slots.map((slot) => slot.order)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('files a follow-up as a revised objective under its own initial', () => {
    const slots = plannedSlots()
    const followUp = slots.find((slot) => slot.huntId === PI.id && slot.stepId === 'follow_up')!

    expect(followUp.relation).toBe('revised_objective')
    expect(followUp.parentAttemptId).toBe(attemptIdFor(PI.id, 'initial'))
  })

  it('gives an initial no parent', () => {
    for (const slot of plannedSlots().filter((candidate) => candidate.relation === 'initial')) {
      expect(slot.parentAttemptId).toBeUndefined()
    }
  })

  it('carries each prompt’s version and the hash of its exact text', () => {
    const initial = plannedSlots().find((slot) => slot.huntId === WATCH.id)!
    expect(initial.prompt.version).toBe(String(WATCH.prompt.version))
    expect(initial.prompt.hash).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('plans nothing for a hunt the corpus gives no follow-up', () => {
    const steps = plannedSlots().filter((slot) => slot.huntId === VOYAGER.id)
    expect(steps.map((slot) => slot.stepId)).toEqual(['initial'])
  })
})

describe('driving a capture from the schedule', () => {
  it('starts one capture session per hunt, so no hunt inherits another’s profile', async () => {
    const captures = new FakeCaptures()
    await runLiveWebPass(createHuntCaptureHost(captures.start, { mode: 'verification', setId: 'set-1' }))

    expect(captures.started.map((options) => options.huntId)).toEqual(CORPUS.map((hunt) => hunt.id))
    expect(new Set(captures.started.map((options) => options.captureId)).size).toBe(4)
  })

  it('sends a follow-up through the same session handle as its initial', async () => {
    const captures = new FakeCaptures()
    await runLiveWebPass(createHuntCaptureHost(captures.start, { mode: 'verification', setId: 'set-1' }), {
      hunts: [PI],
    })

    expect(captures.handles.get(`${PI.id}:follow_up`)).toBe(captures.handles.get(`${PI.id}:initial`))
    expect(captures.started).toHaveLength(1)
  })

  it('dispatches each command under its planned slot identity', async () => {
    const captures = new FakeCaptures()
    await runLiveWebPass(createHuntCaptureHost(captures.start, { mode: 'verification', setId: 'set-1' }))

    expect(captures.commands.map((command) => [command.attemptId, command.order])).toEqual(
      plannedSlots().map((slot) => [slot.attemptId, slot.order]),
    )
  })

  it('sends the corpus text, with its own prompt identity', async () => {
    const captures = new FakeCaptures()
    await runLiveWebPass(createHuntCaptureHost(captures.start, { mode: 'verification', setId: 'set-1' }), {
      hunts: [EUROSTAR],
    })

    expect(captures.commands.map((command) => command.text)).toEqual([EUROSTAR.prompt.text, EUROSTAR.followUp!.text])
    expect(captures.commands[1].prompt.hash).not.toBe(captures.commands[0].prompt.hash)
  })

  it('closes every session it opened, so diagnostics are archived', async () => {
    const captures = new FakeCaptures()
    const host = createHuntCaptureHost(captures.start, { mode: 'verification', setId: 'set-1' })
    await runLiveWebPass(host)

    expect(captures.closed).toHaveLength(4)
    expect(host.sessions.map((session) => session.huntId)).toEqual(CORPUS.map((hunt) => hunt.id))
    expect(host.sessions[0].path).toBe(`${captures.started[0].captureId}/capture.json`)
  })

  it('maps a live Run at the readiness check to an unavailable Session', async () => {
    const captures = new FakeCaptures({
      [PI.id]: { continuation: { ready: false, reason: 'run_active', detail: 'a Run is still live' } },
    })
    const pass = await runLiveWebPass(createHuntCaptureHost(captures.start, { mode: 'verification', setId: 'set-1' }), {
      hunts: [PI],
    })

    expect(pass.hunts[0].followUp).toMatchObject({ status: 'not-reached', reason: 'session_unavailable' })
    // Not waited out: only the initial went to the capture.
    expect(captures.commands).toHaveLength(1)
  })

  it('maps a Run that ended asking for help to a not-reached follow-up', async () => {
    const captures = new FakeCaptures({
      [PI.id]: { continuation: { ready: false, reason: 'awaiting_help', detail: 'the Run asked the user to sign in' } },
    })
    const pass = await runLiveWebPass(createHuntCaptureHost(captures.start, { mode: 'verification', setId: 'set-1' }), {
      hunts: [PI],
    })

    expect(pass.hunts[0].followUp).toMatchObject({
      status: 'not-reached',
      reason: 'awaiting_help',
      detail: 'the Run asked the user to sign in',
    })
  })
})

describe('the set file a pass writes', () => {
  async function passOver(hunts: readonly LiveWebHunt[], script: Record<string, SessionScript> = {}) {
    const captures = new FakeCaptures(script)
    const host = createHuntCaptureHost(captures.start, { mode: 'verification', setId: 'set-1' })
    const pass = await runLiveWebPass(host, { hunts })
    return { captures, host, pass }
  }

  it('validates against #224’s own reader', async () => {
    const { host, pass } = await passOver(CORPUS)
    const set = captureSetOf(pass, { setId: 'set-1', mode: 'verification', sessions: host.sessions })

    const validation = validateCaptureSet(JSON.parse(JSON.stringify(set)))
    expect(validation.ok ? [] : validation.errors).toEqual([])
  })

  it('carries the whole planned population, including a hunt that never ran', async () => {
    // Only one hunt runs, but the set still describes all six scheduled
    // commands — a reader can name what did not happen.
    const { host, pass } = await passOver([PI])
    const set = captureSetOf(pass, { setId: 'set-1', mode: 'verification', sessions: host.sessions })

    expect(set.slots).toHaveLength(6)
    expect(set.sessions).toHaveLength(1)
  })

  it('is complete when hunts merely failed', async () => {
    const { pass } = await passOver([WATCH])
    expect(passState(pass)).toEqual({ state: 'complete' })
  })

  it('is measurement_failed when a command could not be observed', async () => {
    const { pass } = await passOver([WATCH], {
      [WATCH.id]: {
        results: { initial: attempt({ huntId: WATCH.id, stop: 'observer_failure', detail: 'the tape was lost' }) },
      },
    })

    expect(passState(pass)).toMatchObject({ state: 'measurement_failed' })
    expect(passState(pass).stateReason).toContain('the tape was lost')
  })

  it('stamps the study and its protocol version', async () => {
    const { host, pass } = await passOver([VOYAGER])
    const set = captureSetOf(pass, { setId: 'set-1', mode: 'verification', sessions: host.sessions })

    expect(set.study.name).toBe('bingbong.live-web.information-hunts')
    expect(set.study.protocolVersion).toBe('1')
    expect(set.mode).toBe('verification')
  })
})

describe('what the schedule can never read', () => {
  it('has no way to reach an Answer', async () => {
    const captures = new FakeCaptures()
    const pass = await runLiveWebPass(createHuntCaptureHost(captures.start, { mode: 'verification', setId: 'set-1' }), {
      hunts: [PI],
    })

    // The capture rides through whole — a grader gets everything — but the
    // two fields the schedule itself acted on carry no answer text.
    const initial = pass.hunts[0].initial
    expect(initial.status).toBe('attempted')
    const view: HuntAttempt = (initial as { attempt: HuntAttempt }).attempt
    expect(Object.keys(view).sort()).toEqual(['accepted', 'capture', 'measurementFault'])
  })
})
