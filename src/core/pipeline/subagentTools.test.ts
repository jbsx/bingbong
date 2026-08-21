import { describe, expect, it } from 'vitest'
import type { SubagentManager } from '../agent/subagentManager'
import { createSubagentTools } from './subagentTools'

// The delegation surface the orchestrator model sees (issue #13):
// spawn_agent / cancel_agent / agent_results over the manager. Rail refusals
// surface as thrown errors — the command pipeline reports those as failed
// tool results the model reads and recovers from.

function fakeManager(overrides: Partial<SubagentManager> = {}): SubagentManager {
  return {
    spawn: () => ({ ok: true, agent: { id: 'a-1', kind: 'research', task: 't', status: 'running', startedAt: 0, finishedAt: null, steps: 0, lastAction: null, result: null, error: null } }),
    cancel: () => ({ ok: true }),
    cancelAll: () => 0,
    pauseAll: () => {},
    resumeAll: () => {},
    results: async () => 'merged results',
    list: () => [],
    isRunning: () => false,
    ...overrides,
  }
}

describe('subagent tools', () => {
  it('exposes exactly spawn_agent, cancel_agent and agent_results', () => {
    const names = createSubagentTools(fakeManager()).map((tool) => tool.name)
    expect(names.sort()).toEqual(['agent_results', 'cancel_agent', 'spawn_agent'])
  })

  it('spawn_agent forwards kind and task, returning the agent id', async () => {
    const seen: { kind: string; task: string }[] = []
    const tools = createSubagentTools(fakeManager({
      spawn: (kind, task) => {
        seen.push({ kind, task })
        return { ok: true, agent: { id: 'a-7', kind, task, status: 'running', startedAt: 0, finishedAt: null, steps: 0, lastAction: null, result: null, error: null } }
      },
    }))
    const spawn = tools.find((tool) => tool.name === 'spawn_agent')!

    const result = await spawn.execute({ id: 'c1', name: 'spawn_agent', args: { kind: 'browse', task: 'compare prices' } }, { clock: { now: () => 0, setTimer: () => () => {} } })

    expect(seen).toEqual([{ kind: 'browse', task: 'compare prices' }])
    expect(result).toContain('a-7')
    expect(result).toContain('browse')
  })

  it('spawn_agent hands the orchestrator turn id to the manager', async () => {
    const seenTurnIds: (string | undefined)[] = []
    const tools = createSubagentTools(fakeManager({
      spawn: (kind, task, turnId) => {
        seenTurnIds.push(turnId)
        return { ok: true, agent: { id: 'a-1', kind, task, status: 'running', startedAt: 0, finishedAt: null, steps: 0, lastAction: null, result: null, error: null } }
      },
    }))
    const spawn = tools.find((tool) => tool.name === 'spawn_agent')!

    await spawn.execute(
      { id: 'c1', name: 'spawn_agent', args: { kind: 'research', task: 'x' } },
      { clock: { now: () => 0, setTimer: () => () => {} }, turnId: 'turn-voice-8' },
    )

    expect(seenTurnIds).toEqual(['turn-voice-8'])
  })

  it('spawn_agent rejects invalid kinds and empty tasks', async () => {
    const tools = createSubagentTools(fakeManager())
    const spawn = tools.find((tool) => tool.name === 'spawn_agent')!
    const ctx = { clock: { now: () => 0, setTimer: () => () => {} } }

    await expect(spawn.execute({ id: 'c1', name: 'spawn_agent', args: { kind: 'vibes', task: 'x' } }, ctx)).rejects.toThrow(/kind/)
    await expect(spawn.execute({ id: 'c2', name: 'spawn_agent', args: { kind: 'research', task: '  ' } }, ctx)).rejects.toThrow(/task/)
    expect(spawn.parameters?.kind?.enum).toEqual(['research', 'browse', 'background'])
  })

  it('confirmation-gates background file/download work at spawn', async () => {
    const spawn = createSubagentTools(fakeManager()).find((tool) => tool.name === 'spawn_agent')!

    expect(
      await spawn.assessRisk!({ id: 'c1', name: 'spawn_agent', args: { kind: 'research', task: 'read' } }),
    ).toEqual({ kind: 'allow' })
    expect(
      await spawn.assessRisk!({ id: 'c2', name: 'spawn_agent', args: { kind: 'background', task: 'download report' } }),
    ).toMatchObject({ kind: 'confirm', prompt: expect.stringMatching(/download report/) })
  })

  it('spawn_agent surfaces a rail refusal as a thrown, readable error', async () => {
    const tools = createSubagentTools(fakeManager({
      spawn: () => ({ ok: false, reason: 'subagent limit (4) reached — wait for a running agent to finish' }),
    }))
    const spawn = tools.find((tool) => tool.name === 'spawn_agent')!

    await expect(
      spawn.execute({ id: 'c1', name: 'spawn_agent', args: { kind: 'research', task: 'x' } }, { clock: { now: () => 0, setTimer: () => () => {} } }),
    ).rejects.toThrow('subagent limit (4) reached')
  })

  it('cancel_agent cancels one id or all running agents', async () => {
    const cancelled: string[] = []
    const tools = createSubagentTools(fakeManager({
      cancelAll: () => 2,
      cancel: (id) => {
        cancelled.push(id)
        return { ok: true }
      },
    }))
    const cancel = tools.find((tool) => tool.name === 'cancel_agent')!
    const ctx = { clock: { now: () => 0, setTimer: () => () => {} } }

    expect(await cancel.execute({ id: 'c1', name: 'cancel_agent', args: { agent_id: 'a-1' } }, ctx)).toContain('a-1')
    expect(await cancel.execute({ id: 'c2', name: 'cancel_agent', args: { agent_id: 'all' } }, ctx)).toContain('2')
    expect(cancelled).toEqual(['a-1'])
  })

  it('cancel_agent reports unknown ids and refuses an empty one', async () => {
    const tools = createSubagentTools(fakeManager({
      cancel: (id) => (id === 'ghost' ? { ok: false, reason: `no such subagent: 'ghost'` } : { ok: true }),
    }))
    const cancel = tools.find((tool) => tool.name === 'cancel_agent')!
    const ctx = { clock: { now: () => 0, setTimer: () => () => {} } }

    await expect(cancel.execute({ id: 'c1', name: 'cancel_agent', args: { agent_id: 'ghost' } }, ctx)).rejects.toThrow(/ghost/)
    await expect(cancel.execute({ id: 'c2', name: 'cancel_agent', args: {} }, ctx)).rejects.toThrow(/agent_id/)
  })

  it('agent_results merges the manager report and forwards wait + single-id filters', async () => {
    const calls: { ids?: string[]; wait?: boolean }[] = []
    const tools = createSubagentTools(fakeManager({
      results: async (options) => {
        calls.push({ ids: options.ids, wait: options.wait })
        return `report for ${options.ids?.join(',') ?? 'all'}${options.wait ? ' (waited)' : ''}`
      },
    }))
    const results = tools.find((tool) => tool.name === 'agent_results')!
    const ctx = { clock: { now: () => 0, setTimer: () => () => {} } }

    expect(await results.execute({ id: 'c1', name: 'agent_results', args: {} }, ctx)).toBe('report for all')
    expect(await results.execute({ id: 'c2', name: 'agent_results', args: { agent_id: 'a-2', wait: true } }, ctx)).toBe('report for a-2 (waited)')
    expect(calls).toEqual([{ ids: undefined, wait: false }, { ids: ['a-2'], wait: true }])
  })
})
