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
    expect(runtime.extend()).toBe(true)
    expect(runtime.state().phase).toBe('active')
    expect(runtime.extend()).toBe(false)
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
