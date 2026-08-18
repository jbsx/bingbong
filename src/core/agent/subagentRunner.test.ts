import { describe, expect, it } from 'vitest'
import { FakeClock, ScriptedLlm } from '../testing/doubles'
import { runSubagent, SubagentCancelledError } from './subagentRunner'
import type { Tool } from '../pipeline/tool'
import { ASK_ESCALATION_PREFIX, createSubagentAskTool } from '../pipeline/askUserTools'

// The workhorse loop behind every subagent (issue #13): a deepseek-chat LLM
// with its own tool set, no confirmations (the policy wrapper already
// downgraded those to denials), progress reported per step, cancellation
// polled at every checkpoint. The manager above it owns lifecycle rails.

function noopTools(): Tool[] {
  return []
}

describe('runSubagent', () => {
  it('runs tool calls, reports progress per step, and returns the final report', async () => {
    const search: Tool = {
      name: 'web_search',
      async execute() {
        return '1. Hit — https://hit.test'
      },
    }
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 's1', name: 'web_search', args: { query: 'keyboards' } }] },
      { kind: 'answer', speak: 'short', display: 'Full research report.' },
    ])
    const progress: { step: number; action: string }[] = []

    const result = await runSubagent(
      { llm, tools: [search], clock: new FakeClock() },
      { task: 'research keyboards', isCancelled: () => false, onProgress: (p) => progress.push(p) },
    )

    expect(result).toBe('Full research report.')
    expect(progress).toEqual([{ step: 1, action: 'search "keyboards"' }])
    // The tool result reached the next LLM round.
    expect(llm.requests[1]?.toolResults).toMatchObject([
      { call: { name: 'web_search' }, outcome: { ok: true, result: '1. Hit — https://hit.test' } },
    ])
  })

  it('feeds tool errors back to the model instead of failing the run', async () => {
    const boom: Tool = {
      name: 'boom',
      async execute() {
        throw new Error('kaboom')
      },
    }
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'b1', name: 'boom', args: {} }] },
      { kind: 'answer', speak: 's', display: 'Recovered anyway.' },
    ])

    const result = await runSubagent(
      { llm, tools: [boom], clock: new FakeClock() },
      { task: 'do work', isCancelled: () => false },
    )

    expect(result).toBe('Recovered anyway.')
    expect(llm.requests[1]?.toolResults).toMatchObject([{ outcome: { ok: false, error: 'kaboom' } }])
  })

  it('never executes tools denied by the risk gate', async () => {
    let executions = 0
    const denied: Tool = {
      name: 'type',
      assessRisk: () => ({ kind: 'deny', reason: 'credential fields are never filled by the agent' }),
      async execute() {
        executions += 1
        return 'typed'
      },
    }
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'd1', name: 'type', args: {} }] },
      { kind: 'answer', speak: 's', display: 'Denied safely.' },
    ])

    await runSubagent({ llm, tools: [denied], clock: new FakeClock() }, { task: 't', isCancelled: () => false })

    expect(executions).toBe(0)
    expect(llm.requests[1]?.toolResults).toMatchObject([
      { outcome: { ok: false, error: 'credential fields are never filled by the agent' } },
    ])
  })

  it('defensively denies confirmation verdicts even without the policy wrapper', async () => {
    let executions = 0
    const confirm: Tool = {
      name: 'download',
      assessRisk: () => ({ kind: 'confirm', prompt: 'Download it?' }),
      async execute() {
        executions += 1
        return 'downloaded'
      },
    }
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'd1', name: 'download', args: {} }] },
      { kind: 'answer', speak: 's', display: 'Skipped.' },
    ])

    await runSubagent({ llm, tools: [confirm], clock: new FakeClock() }, { task: 't', isCancelled: () => false })

    expect(executions).toBe(0)
    expect(llm.requests[1]?.toolResults[0]?.outcome).toMatchObject({ ok: false })
  })

  it('reports unknown tools as failed results the model can see', async () => {
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'x1', name: 'nope', args: {} }] },
      { kind: 'answer', speak: 's', display: 'Done.' },
    ])

    await runSubagent({ llm, tools: [], clock: new FakeClock() }, { task: 't', isCancelled: () => false })

    expect(llm.requests[1]?.toolResults).toMatchObject([{ outcome: { ok: false, error: "unknown tool: 'nope'" } }])
  })

  it('returns ask_user escalation verbatim without another model round', async () => {
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'q1', name: 'ask_user', args: { question: 'Which city?' } }] },
    ])

    const result = await runSubagent(
      { llm, tools: [createSubagentAskTool()], clock: new FakeClock() },
      { task: 'plan the trip', isCancelled: () => false },
    )

    expect(result).toContain(`${ASK_ESCALATION_PREFIX} Which city?`)
    expect(llm.requests).toHaveLength(1)
  })

  it('stops at the next checkpoint once cancelled — no further tools or model calls', async () => {
    let executions = 0
    let cancelled = false
    const slow: Tool = {
      name: 'slow',
      async execute() {
        executions += 1
        if (executions >= 1) cancelled = true
        return 'done'
      },
    }
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'a', name: 'slow', args: {} }, { id: 'b', name: 'slow', args: {} }] },
      { kind: 'answer', speak: 's', display: 'never' },
    ])

    await expect(
      runSubagent({ llm, tools: [slow], clock: new FakeClock() }, { task: 't', isCancelled: () => cancelled }),
    ).rejects.toBeInstanceOf(SubagentCancelledError)

    expect(executions).toBe(1)

    // Cancellation between rounds also stops the loop before the next call.
    cancelled = false
    executions = 0
    const llm2 = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'a', name: 'slow', args: {} }] },
      { kind: 'answer', speak: 's', display: 'never' },
    ])
    await expect(
      runSubagent({ llm: llm2, tools: [slow], clock: new FakeClock() }, { task: 't', isCancelled: () => cancelled }),
    ).rejects.toBeInstanceOf(SubagentCancelledError)
    expect(llm2.requests).toHaveLength(1)
  })

  it('throws when the workhorse exceeds its tool-round limit', async () => {
    const spin: Tool = { name: 'spin', async execute() { return 'spun' } }
    const storms = Array.from({ length: 5 }, (_, i) => ({
      kind: 'tool_calls' as const,
      calls: [{ id: `c${i}`, name: 'spin', args: {} }],
    }))
    const llm = new ScriptedLlm(storms)

    await expect(
      runSubagent(
        { llm, tools: [spin], clock: new FakeClock(), maxToolRounds: 2 },
        { task: 't', isCancelled: () => false },
      ),
    ).rejects.toThrow('subagent tool round limit (2) reached')
  })

  it('enforces the ten-call vision rail for a subagent task', async () => {
    let executions = 0
    const vision: Tool = {
      name: 'analyze_page',
      usesVision: true,
      async execute() {
        executions += 1
        return 'grounded'
      },
    }
    const llm = new ScriptedLlm([
      {
        kind: 'tool_calls',
        calls: Array.from({ length: 15 }, (_, index) => ({ id: `v${index}`, name: 'analyze_page', args: {} })),
      },
      { kind: 'answer', speak: 's', display: 'bounded' },
    ])

    await runSubagent({ llm, tools: [vision], clock: new FakeClock() }, { task: 't', isCancelled: () => false })

    expect(executions).toBe(10)
    expect(llm.requests[1]?.toolResults.filter((result) => !result.outcome.ok)).toHaveLength(5)
  })

  it('propagates model failures so the manager can mark the agent failed', async () => {
    const llm = new ScriptedLlm([])
    await expect(
      runSubagent({ llm, tools: noopTools(), clock: new FakeClock() }, { task: 't', isCancelled: () => false }),
    ).rejects.toThrow('ScriptedLlm ran out of scripted turns')
  })

  it('honours cancellation that arrives while the model answer is in flight', async () => {
    let release!: (turn: { kind: 'answer'; speak: string; display: string }) => void
    const answer = new Promise<{ kind: 'answer'; speak: string; display: string }>((resolve) => {
      release = resolve
    })
    const llm = { complete: () => answer }
    let cancelled = false
    const running = runSubagent(
      { llm, tools: [], clock: new FakeClock() },
      { task: 't', isCancelled: () => cancelled },
    )

    cancelled = true
    release({ kind: 'answer', speak: 's', display: 'too late' })

    await expect(running).rejects.toBeInstanceOf(SubagentCancelledError)
  })
})
