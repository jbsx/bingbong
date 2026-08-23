import { describe, expect, it } from 'vitest'
import { createRunProgressTracker, describeRunProgress } from './runProgress'
import type { PipelineEvent, PipelineStatus } from './events'

// Progress projection (#43): the renderer's hint state as a pure function
// over the pipeline event stream — stage + started-at from status events
// (the renderer ticks elapsed itself, no per-second IPC), retry and
// agent-wait details from the new detail variants, live agent counts from
// agent_update cards. Table-driven like the transcript projection's suite.

const T = 'turn-1'

function command(at: number, turnId = T): PipelineEvent {
  return { type: 'command', turnId, text: 'go', at }
}

function status(stage: PipelineStatus, at: number, turnId = T): PipelineEvent {
  return { type: 'status', turnId, status: stage, at }
}

function agentCard(id: string, agentStatus: 'running' | 'completed', at = 0): PipelineEvent {
  return {
    type: 'agent_update',
    at,
    agent: {
      id,
      kind: 'background',
      task: 't',
      status: agentStatus,
      startedAt: at,
      finishedAt: agentStatus === 'running' ? null : at,
      steps: 0,
      lastAction: null,
      result: null,
      error: null,
    },
  }
}

describe('run progress tracker', () => {
  it('tracks the stage and its start from status events', () => {
    const tracker = createRunProgressTracker()

    tracker.onEvent(command(1_000))
    tracker.onEvent(status('thinking', 1_000))

    expect(tracker.current()).toEqual({
      stage: 'thinking',
      startedAt: 1_000,
      retry: null,
      waitingOnAgents: null,
    })
  })

  it('a stage transition restarts the clock and clears detail signals', () => {
    const tracker = createRunProgressTracker()
    tracker.onEvent(command(1_000))
    tracker.onEvent(status('thinking', 1_000))
    tracker.onEvent({ type: 'llm_retry', turnId: T, attempt: 2, maxAttempts: 3, at: 61_000 })
    tracker.onEvent(status('acting', 70_000))

    expect(tracker.current()).toEqual({
      stage: 'acting',
      startedAt: 70_000,
      retry: null,
      waitingOnAgents: null,
    })
  })

  it('ignores detail before any turn starts, records it once one has', () => {
    const tracker = createRunProgressTracker()

    tracker.onEvent({ type: 'llm_retry', turnId: T, attempt: 2, maxAttempts: 3, at: 0 })
    expect(tracker.current()).toBeNull()

    tracker.onEvent(command(1_000))
    tracker.onEvent(status('thinking', 1_000))
    tracker.onEvent({ type: 'llm_retry', turnId: T, attempt: 3, maxAttempts: 3, at: 120_000 })
    expect(tracker.current()?.retry).toEqual({ attempt: 3, maxAttempts: 3 })
  })

  it('a stray detail event from another turn cannot corrupt the live hint', () => {
    const tracker = createRunProgressTracker()
    tracker.onEvent(command(1_000))
    tracker.onEvent(status('thinking', 1_000))

    tracker.onEvent({ type: 'llm_retry', turnId: 'turn-other', attempt: 2, maxAttempts: 3, at: 2_000 })
    tracker.onEvent({ type: 'waiting_on_agents', turnId: 'turn-other', running: 4, at: 2_001 })

    expect(tracker.current()).toEqual({
      stage: 'thinking',
      startedAt: 1_000,
      retry: null,
      waitingOnAgents: null,
    })
  })

  it('a straggler retry after done cannot revive the hint', () => {
    const tracker = createRunProgressTracker()
    tracker.onEvent(command(1_000))
    tracker.onEvent(status('thinking', 1_000))
    tracker.onEvent({ type: 'done', turnId: T, outcome: 'done', at: 9_000 })
    tracker.onEvent({ type: 'llm_retry', turnId: T, attempt: 2, maxAttempts: 3, at: 9_100 })

    expect(tracker.current()).toBeNull()
  })

  it('keeps the snapshot running count when no agent cards have been seen', () => {
    const tracker = createRunProgressTracker()
    tracker.onEvent(command(1_000))
    tracker.onEvent(status('acting', 1_000))
    tracker.onEvent({ type: 'waiting_on_agents', turnId: T, running: 2, at: 2_000 })

    expect(tracker.current()?.waitingOnAgents).toEqual({ running: 2 })
  })

  it('refines the waiting count live as agent cards update', () => {
    const tracker = createRunProgressTracker()
    tracker.onEvent(agentCard('a-1', 'running'))
    tracker.onEvent(agentCard('a-2', 'running'))
    tracker.onEvent(command(1_000))
    tracker.onEvent(status('acting', 1_000))
    tracker.onEvent({ type: 'waiting_on_agents', turnId: T, running: 2, at: 2_000 })
    tracker.onEvent(agentCard('a-2', 'completed', 9_000))

    expect(tracker.current()?.waitingOnAgents).toEqual({ running: 1 })
  })

  it('prefers the live card count over the snapshot when both exist', () => {
    const tracker = createRunProgressTracker()
    tracker.onEvent(agentCard('a-1', 'running'))
    tracker.onEvent(command(1_000))
    tracker.onEvent(status('acting', 1_000))
    tracker.onEvent({ type: 'waiting_on_agents', turnId: T, running: 2, at: 2_000 })

    expect(tracker.current()?.waitingOnAgents).toEqual({ running: 1 })
  })

  it('clears progress when the run is done; a new command resets until its first status', () => {
    const tracker = createRunProgressTracker()
    tracker.onEvent(command(1_000))
    tracker.onEvent(status('thinking', 1_000))
    tracker.onEvent({ type: 'done', turnId: T, outcome: 'done', at: 9_000 })
    expect(tracker.current()).toBeNull()

    tracker.onEvent(command(20_000))
    expect(tracker.current()).toBeNull()
  })

  it('a session boundary does not clear an active run\'s progress', () => {
    const tracker = createRunProgressTracker()
    tracker.onEvent(command(1_000))
    tracker.onEvent(status('thinking', 1_000))
    tracker.onEvent({ type: 'session_started', at: 2_000 })

    expect(tracker.current()?.stage).toBe('thinking')
  })
})

describe('describeRunProgress', () => {
  it.each([
    [
      'plain stage with climbing elapsed',
      { stage: 'thinking' as const, startedAt: 1_000, retry: null, waitingOnAgents: null },
      15_100,
      'thinking — 14s',
    ],
    [
      'sub-second elapsed floors to 0s and never goes negative',
      { stage: 'acting' as const, startedAt: 10_000, retry: null, waitingOnAgents: null },
      10_999,
      'acting — 0s',
    ],
    [
      'waiting on agents names the count',
      { stage: 'acting' as const, startedAt: 10_000, retry: null, waitingOnAgents: { running: 2 } },
      22_000,
      'acting — 12s · waiting on agents (2 running)',
    ],
    [
      'a retry reads as activity, not a dead app',
      { stage: 'thinking' as const, startedAt: 1_000, retry: { attempt: 2, maxAttempts: 3 }, waitingOnAgents: null },
      76_000,
      'thinking — 75s · empty response — retrying 2/3',
    ],
    [
      'a hang is an honestly climbing counter',
      { stage: 'thinking' as const, startedAt: 0, retry: null, waitingOnAgents: null },
      119_000,
      'thinking — 119s',
    ],
  ])('%s', (_name, progress, now, expected) => {
    expect(describeRunProgress(progress, now)).toBe(expected)
  })
})
