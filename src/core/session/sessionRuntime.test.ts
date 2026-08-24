import { describe, expect, it } from 'vitest'
import { FakeClock } from '../testing/doubles'
import type { PipelineEvent } from '../pipeline/events'
import type {
  RunId,
  SessionId,
  SessionIdentitySource,
  SubmissionId,
} from './sessionIdentity'
import { createSessionRuntime } from './sessionRuntime'

class DeterministicIdentities implements SessionIdentitySource {
  readonly minted: string[] = []
  private submission = 0
  private run = 0
  private session = 0

  mintSubmissionId(): SubmissionId {
    const id = `submission-${++this.submission}` as SubmissionId
    this.minted.push(id)
    return id
  }

  mintRunId(): RunId {
    const id = `run-${++this.run}` as RunId
    this.minted.push(id)
    return id
  }

  mintSessionId(): SessionId {
    const id = `session-${++this.session}` as SessionId
    this.minted.push(id)
    return id
  }
}

function harness(start = 1_000) {
  const clock = new FakeClock(start)
  const identities = new DeterministicIdentities()
  const runtime = createSessionRuntime({ clock, identities })
  return { clock, identities, runtime }
}

function decision(runtime: ReturnType<typeof createSessionRuntime>) {
  const state = runtime.state()
  return { sessionId: state.sessionId!, generation: state.generation }
}

describe('session runtime', () => {
  it('starts absent without minting any identity', () => {
    const { identities, runtime } = harness()

    expect(runtime.state()).toEqual({
      phase: 'absent',
      sessionId: null,
      generation: 0,
      startedAt: null,
      acceptedRunIds: [],
      liveRunIds: [],
    })
    expect(identities.minted).toEqual([])
  })

  it('creates a Submission before admission and mints Run and Session identities only on acceptance', () => {
    const { clock, identities, runtime } = harness()

    const submission = runtime.submit()
    expect(submission).toEqual({ submissionId: 'submission-1', submittedAt: 1_000 })
    expect(identities.minted).toEqual(['submission-1'])

    clock.advance(25)
    const admission = runtime.accept(submission.submissionId)

    expect(admission).toEqual({
      accepted: true,
      submissionId: 'submission-1',
      runId: 'run-1',
      sessionId: 'session-1',
      generation: 0,
      acceptedAt: 1_025,
      createsSession: true,
    })
    expect(identities.minted).toEqual(['submission-1', 'session-1', 'run-1'])
    expect(runtime.state()).toEqual({
      phase: 'active',
      sessionId: 'session-1',
      generation: 0,
      startedAt: 1_025,
      acceptedRunIds: ['run-1'],
      liveRunIds: ['run-1'],
    })
  })

  it('reuses the Session across accepted Runs and finishes only known live Runs', () => {
    const { runtime } = harness()
    const first = runtime.accept(runtime.submit().submissionId)
    const second = runtime.accept(runtime.submit().submissionId)

    expect(second.sessionId).toBe(first.sessionId)
    expect(second.runId).not.toBe(first.runId)
    expect(runtime.finish(first.runId)).toBe(true)
    expect(runtime.finish(first.runId)).toBe(false)
    expect(runtime.finish('run-unknown' as RunId)).toBe(false)
    expect(runtime.state().liveRunIds).toEqual([second.runId])
    expect(runtime.state().acceptedRunIds).toEqual([first.runId, second.runId])
  })

  it('makes rejection terminal and invalidates pending submissions when a Session ends', () => {
    const { runtime } = harness()
    const rejected = runtime.submit()

    expect(runtime.reject(rejected.submissionId)).toBe(true)
    expect(runtime.reject(rejected.submissionId)).toBe(false)
    expect(() => runtime.accept(rejected.submissionId)).toThrow('unknown or already admitted')

    const admitted = runtime.accept(runtime.submit().submissionId)
    const stale = runtime.submit()
    runtime.end('reset')

    expect(() => runtime.accept(stale.submissionId)).toThrow('unknown or already admitted')
    expect(runtime.state().sessionId).not.toBe(admitted.sessionId)
  })

  it('does not expose a partial Session when identity minting fails during admission', () => {
    const clock = new FakeClock(100)
    const identities = new DeterministicIdentities()
    identities.mintRunId = () => {
      throw new Error('identity source failed')
    }
    const runtime = createSessionRuntime({ clock, identities })
    const submission = runtime.submit()

    expect(() => runtime.accept(submission.submissionId)).toThrow('identity source failed')
    expect(runtime.state()).toEqual({
      phase: 'absent',
      sessionId: null,
      generation: 0,
      startedAt: null,
      acceptedRunIds: [],
      liveRunIds: [],
    })
  })

  it('exposes deterministic expiring and extension lifecycle transitions', () => {
    const { runtime } = harness()
    const admission = runtime.accept(runtime.submit().submissionId)

    expect(runtime.beginExpiry()).toBe(false)
    runtime.finish(admission.runId)
    expect(runtime.beginExpiry()).toBe(true)
    expect(runtime.state().phase).toBe('expiring')
    expect(runtime.beginExpiry()).toBe(false)
    expect(runtime.extend(decision(runtime))).toBe(true)
    expect(runtime.state().phase).toBe('active')
    expect(runtime.extend(decision(runtime))).toBe(false)
  })

  it('ends exactly once using the injected clock and clears Session-owned state', () => {
    const { clock, runtime } = harness()
    const admission = runtime.accept(runtime.submit().submissionId)

    expect(runtime.end('lapsed')).toBeNull()
    runtime.finish(admission.runId)
    expect(runtime.end('lapsed')).toBeNull()
    runtime.beginExpiry()
    clock.advance(50)

    expect(runtime.end('lapsed')).toEqual({
      sessionId: admission.sessionId,
      generation: 0,
      reason: 'lapsed',
      startedAt: 1_000,
      endedAt: 1_050,
      acceptedRunIds: [admission.runId],
      liveRunIds: [],
    })
    expect(runtime.end('lapsed')).toBeNull()
    expect(runtime.state()).toEqual({
      phase: 'absent',
      sessionId: null,
      generation: 0,
      startedAt: null,
      acceptedRunIds: [],
      liveRunIds: [],
    })
  })

  it('advances the reset generation before accepting work into a fresh Session', () => {
    const { runtime } = harness()
    const oldRun = runtime.accept(runtime.submit().submissionId)

    const ended = runtime.end('reset')
    const replacement = runtime.accept(runtime.submit().submissionId)

    expect(ended?.generation).toBe(0)
    expect(runtime.state().generation).toBe(1)
    expect(replacement.generation).toBe(1)
    expect(replacement.sessionId).not.toBe(oldRun.sessionId)
  })

  it('returns snapshots that cannot mutate runtime state', () => {
    const { runtime } = harness()
    const admission = runtime.accept(runtime.submit().submissionId)
    const snapshot = runtime.state()

    ;(snapshot.acceptedRunIds as RunId[]).push('run-forged' as RunId)
    ;(snapshot.liveRunIds as RunId[]).length = 0

    expect(runtime.state().acceptedRunIds).toEqual([admission.runId])
    expect(runtime.state().liveRunIds).toEqual([admission.runId])
  })

  it('warns once before the original deadline and lapses exactly once while idle', () => {
    const clock = new FakeClock(1_000)
    const ended: string[] = []
    const expiring: string[] = []
    const runtime = createSessionRuntime({
      clock,
      identities: new DeterministicIdentities(),
      inactivityMs: 100,
      warningLeadMs: 20,
      onExpiring: (session) => expiring.push(`${session.sessionId}:${session.expiresAt}:${session.at}`),
      onEnded: (session) => ended.push(`${session.sessionId}:${session.reason}:${session.endedAt}`),
    })
    const first = runtime.accept(runtime.submit().submissionId)

    clock.advance(500)
    expect(runtime.state().phase).toBe('active')
    runtime.finish(first.runId)
    clock.advance(79)
    expect(runtime.state().phase).toBe('active')
    clock.advance(1)

    expect(runtime.state().phase).toBe('expiring')
    expect(expiring).toEqual(['session-1:1600:1580'])
    clock.advance(19)
    expect(runtime.state().phase).toBe('expiring')
    expect(ended).toEqual([])
    clock.advance(1)

    expect(runtime.state().phase).toBe('absent')
    expect(ended).toEqual(['session-1:lapsed:1600'])
    clock.advance(1_000)
    expect(ended).toHaveLength(1)
  })

  it('suspends an armed expiry when another Run is accepted', () => {
    const clock = new FakeClock(1_000)
    const runtime = createSessionRuntime({
      clock,
      identities: new DeterministicIdentities(),
      inactivityMs: 100,
      warningLeadMs: 20,
    })
    const first = runtime.accept(runtime.submit().submissionId)
    runtime.finish(first.runId)
    clock.advance(90)
    const second = runtime.accept(runtime.submit().submissionId)

    clock.advance(100)
    expect(runtime.state().sessionId).toBe(first.sessionId)
    expect(runtime.state().liveRunIds).toEqual([second.runId])
    runtime.finish(second.runId)
    clock.advance(80)
    expect(runtime.state().phase).toBe('expiring')
    clock.advance(20)
    expect(runtime.state().phase).toBe('absent')
  })

  it('restarts the full window on explicit extension and allows repeated extensions', () => {
    const clock = new FakeClock(1_000)
    const warnings: number[] = []
    const extensions: number[] = []
    const runtime = createSessionRuntime({
      clock,
      identities: new DeterministicIdentities(),
      inactivityMs: 100,
      warningLeadMs: 20,
      onExpiring: ({ expiresAt }) => warnings.push(expiresAt),
      onExtended: ({ expiresAt }) => extensions.push(expiresAt),
    })
    const run = runtime.accept(runtime.submit().submissionId)
    runtime.finish(run.runId)

    clock.advance(80)
    expect(runtime.extend(decision(runtime))).toBe(true)
    expect(extensions).toEqual([1_180])
    clock.advance(80)
    expect(warnings).toEqual([1_100, 1_180])
    expect(runtime.extend(decision(runtime))).toBe(true)
    expect(extensions).toEqual([1_180, 1_260])
    clock.advance(79)
    expect(runtime.state().phase).toBe('active')
    clock.advance(1)
    expect(warnings).toEqual([1_100, 1_180, 1_260])
  })

  it('declines immediately and silence preserves the original deadline', () => {
    const clock = new FakeClock(1_000)
    const runtime = createSessionRuntime({
      clock,
      identities: new DeterministicIdentities(),
      inactivityMs: 100,
      warningLeadMs: 20,
    })
    const run = runtime.accept(runtime.submit().submissionId)
    runtime.finish(run.runId)
    clock.advance(80)

    expect(runtime.decline(decision(runtime))?.endedAt).toBe(1_080)
    expect(runtime.state().phase).toBe('absent')

    const next = runtime.accept(runtime.submit().submissionId)
    runtime.finish(next.runId)
    clock.advance(80)
    clock.advance(20)
    expect(runtime.state().phase).toBe('absent')
  })

  it('accepted work during the warning cancels the old deadline and anchors a full window at finish', () => {
    const clock = new FakeClock(1_000)
    const warnings: number[] = []
    const runtime = createSessionRuntime({
      clock,
      identities: new DeterministicIdentities(),
      inactivityMs: 100,
      warningLeadMs: 20,
      onExpiring: ({ expiresAt }) => warnings.push(expiresAt),
    })
    const first = runtime.accept(runtime.submit().submissionId)
    runtime.finish(first.runId)
    clock.advance(80)

    const rejected = runtime.submit()
    runtime.reject(rejected.submissionId)
    clock.advance(10)
    const second = runtime.accept(runtime.submit().submissionId)
    clock.advance(100)
    expect(runtime.state().liveRunIds).toEqual([second.runId])

    runtime.finish(second.runId)
    clock.advance(79)
    expect(runtime.state().phase).toBe('active')
    clock.advance(1)
    expect(runtime.state().phase).toBe('expiring')
    expect(warnings).toEqual([1_100, 1_290])
  })

  it('rejects invalid timed-window configuration', () => {
    const clock = new FakeClock()
    const identities = new DeterministicIdentities()

    expect(() => createSessionRuntime({ clock, identities, inactivityMs: 100 })).toThrow('warningLeadMs')
    expect(() => createSessionRuntime({ clock, identities, inactivityMs: 100, warningLeadMs: 100 })).toThrow(
      'shorter',
    )
  })

  it('rejects stale or foreign expiry decisions inside the runtime', () => {
    const clock = new FakeClock(1_000)
    const runtime = createSessionRuntime({
      clock,
      identities: new DeterministicIdentities(),
      inactivityMs: 100,
      warningLeadMs: 20,
    })
    const run = runtime.accept(runtime.submit().submissionId)
    runtime.finish(run.runId)
    clock.advance(80)

    expect(runtime.extend({ sessionId: 'session-foreign' as SessionId, generation: 0 })).toBe(false)
    expect(runtime.decline({ sessionId: run.sessionId, generation: 1 })).toBeNull()
    expect(runtime.state().phase).toBe('expiring')
  })

  it('can add explicit ownership to shared events without replacing legacy turn correlation', () => {
    const { runtime } = harness()
    const admission = runtime.accept(runtime.submit().submissionId)
    const event: PipelineEvent = {
      type: 'command',
      turnId: 'turn-legacy-1',
      text: 'hello',
      at: admission.acceptedAt,
      submissionId: admission.submissionId,
      runId: admission.runId,
      sessionId: admission.sessionId,
      sessionGeneration: admission.generation,
    }

    expect(event.turnId).toBe('turn-legacy-1')
    expect(event.runId).toBe(admission.runId)
  })
})
