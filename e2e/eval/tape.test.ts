import { describe, expect, it } from 'vitest'
import type { PipelineEvent, SubagentCard } from '../../src/core/pipeline/events'
import { runningAgentsSince, runningAgentsSinceSource } from './tape'

function card(id: string, status: SubagentCard['status']): PipelineEvent {
  return {
    type: 'agent_update',
    at: 0,
    agent: {
      id,
      kind: 'browse',
      task: 'look it up',
      status,
      startedAt: 0,
      finishedAt: status === 'running' ? null : 1,
      steps: 1,
      lastAction: null,
      result: null,
      error: null,
    },
  }
}

function command(turnId: string): PipelineEvent {
  return { type: 'command', turnId, text: 'do it', at: 0 }
}

describe('runningAgentsSince', () => {
  it('reports a card that is still running in the current run', () => {
    const tape = [command('t1'), card('a1', 'running')]
    expect(runningAgentsSince(tape, 0)).toEqual(['a1'])
  })

  it('is empty once every card of the run reached a terminal status', () => {
    const tape = [card('a1', 'running'), card('a2', 'running'), card('a1', 'completed'), card('a2', 'cancelled')]
    expect(runningAgentsSince(tape, 0)).toEqual([])
  })

  it('ignores a card leaked by an earlier scenario — the fold starts at the run index', () => {
    const leaked = [card('stale', 'running')]
    const tape = [...leaked, command('t2'), card('a1', 'running'), card('a1', 'completed')]
    expect(runningAgentsSince(tape, leaked.length)).toEqual([])
  })

  it('still reports a leaked card that emits a running update inside the run', () => {
    const leaked = [card('stale', 'running')]
    const tape = [...leaked, command('t2'), card('stale', 'running')]
    expect(runningAgentsSince(tape, leaked.length)).toEqual(['stale'])
  })

  it('folds each card to its last status within the slice, not its first', () => {
    const tape = [card('a1', 'completed'), card('a1', 'running')]
    expect(runningAgentsSince(tape, 0)).toEqual(['a1'])
  })

  it('ignores non-agent events', () => {
    expect(runningAgentsSince([command('t1')], 0)).toEqual([])
  })
})

describe('runningAgentsSinceSource', () => {
  // The predicate is shipped into the dashboard renderer as source text, so
  // the transpiled function has to stand alone — no imports, no helpers
  // captured from this module's scope.
  it('evaluates in a bare scope to the same answer as the function itself', () => {
    const tape = [card('stale', 'running'), card('a1', 'running'), card('a1', 'completed')]
    const evaluated = new Function('tape', 'from', `return (${runningAgentsSinceSource()})(tape, from)`) as (
      tape: PipelineEvent[],
      from: number,
    ) => string[]
    expect(evaluated(tape, 1)).toEqual([])
    expect(evaluated(tape, 0)).toEqual(['stale'])
  })
})
