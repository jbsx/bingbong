import { describe, expect, it } from 'vitest'
import type { PipelineEvent } from '../../core/pipeline/events'
import type { SessionGeneration, SessionId } from '../../core/session/sessionIdentity'
import { createPipelineAcceptanceGate, type PipelineAcceptanceInputs } from './pipelineAcceptance'

// The ownership gate #97 hangs late asynchronous work on: whatever Session
// is live decides what may render, record, or speak. Deterministic proof
// that a late subagent completion — the same stamped speak event the TTS
// path checks — is rejected once its Session ended, even with a new Session
// already running.

const SESSION_ONE = { sessionId: 'session-1' as SessionId, generation: 2 }
const SESSION_TWO = { sessionId: 'session-2' as SessionId, generation: 3 }

function gate(options?: {
  live?: { sessionId: SessionId | null; generation: SessionGeneration }
  ended?: { sessionId: SessionId; generation: SessionGeneration } | null
}) {
  const inputs: PipelineAcceptanceInputs = {
    liveSession: () => (options?.live === undefined ? undefined : options.live),
    lastEndedSession: () => options?.ended ?? null,
  }
  return createPipelineAcceptanceGate(inputs)
}

const agentUpdate = (owner: { sessionId: SessionId; generation: SessionGeneration }, status: 'completed' | 'running' = 'completed'): PipelineEvent => ({
  type: 'agent_update',
  at: 40,
  sessionId: owner.sessionId,
  sessionGeneration: owner.generation,
  agent: {
    id: 'a-1',
    kind: 'browse',
    task: 'research',
    status,
    startedAt: 0,
    finishedAt: status === 'completed' ? 40 : null,
    steps: 3,
    lastAction: status === 'running' ? 'reading page 2' : null,
    result: status === 'completed' ? 'late report' : null,
    error: null,
  },
})

const speak = (text: string, owner: { sessionId: SessionId; generation: SessionGeneration }): PipelineEvent => ({
  type: 'speak',
  text,
  at: 41,
  sessionId: owner.sessionId,
  sessionGeneration: owner.generation,
})

describe('pipeline acceptance gate', () => {
  it('accepts work stamped with the live Session', () => {
    const accepted = gate({ live: SESSION_TWO })
    expect(accepted(agentUpdate(SESSION_TWO))).toBe(true)
    expect(accepted(speak('The browsing agent finished.', SESSION_TWO))).toBe(true)
    expect(
      accepted({ type: 'display', text: 'answer', at: 1, sessionId: SESSION_TWO.sessionId, sessionGeneration: SESSION_TWO.generation }),
    ).toBe(true)
  })

  it('rejects late progress, completion, and TTS lines from an ended Session — even with a later Session live', () => {
    const accepted = gate({ live: SESSION_TWO, ended: SESSION_ONE })
    expect(accepted(agentUpdate(SESSION_ONE))).toBe(false)
    expect(accepted(speak('The browsing agent finished: late report.', SESSION_ONE))).toBe(false)
    expect(accepted(agentUpdate(SESSION_ONE, 'running'))).toBe(false)
  })

  it('rejects unstamped work while a Session is live', () => {
    const accepted = gate({ live: SESSION_TWO })
    expect(accepted({ type: 'display', text: 'orphan', at: 1 })).toBe(false)
    expect(accepted(speak('orphan line', SESSION_ONE))).toBe(false)
  })

  it('rejects everything, including unowned boundaries, when no Session is live', () => {
    const accepted = gate({ live: { sessionId: null, generation: 0 }, ended: SESSION_ONE })
    // The legacy clear-only boundary is gone (#99): every event needs a
    // live or just-ended Session behind it.
    expect(accepted({ type: 'session_started', at: 1 })).toBe(false)
    expect(accepted(agentUpdate(SESSION_ONE))).toBe(false)
  })

  it('accepts an identity-bearing session_started of the live Session', () => {
    const accepted = gate({ live: SESSION_TWO })
    expect(
      accepted({ type: 'session_started', at: 1, sessionId: SESSION_TWO.sessionId, sessionGeneration: SESSION_TWO.generation }),
    ).toBe(true)
    expect(
      accepted({ type: 'session_started', at: 1, sessionId: SESSION_ONE.sessionId, sessionGeneration: SESSION_ONE.generation }),
    ).toBe(false)
  })

  it('accepts only the session_ended of the Session that just ended', () => {
    const accepted = gate({ live: { sessionId: null, generation: 0 }, ended: SESSION_ONE })
    expect(
      accepted({ type: 'session_ended', reason: 'lapsed', at: 2, sessionId: SESSION_ONE.sessionId, sessionGeneration: SESSION_ONE.generation }),
    ).toBe(true)
    expect(
      accepted({ type: 'session_ended', reason: 'lapsed', at: 2, sessionId: SESSION_TWO.sessionId, sessionGeneration: SESSION_TWO.generation }),
    ).toBe(false)
    expect(accepted({ type: 'session_ended', reason: 'lapsed', at: 2 })).toBe(false)
  })

  it('rejects run output stamped with a stale generation of the same Session id', () => {
    const accepted = gate({ live: SESSION_TWO })
    expect(accepted(agentUpdate({ sessionId: SESSION_TWO.sessionId, generation: SESSION_TWO.generation - 1 }))).toBe(false)
  })
})
