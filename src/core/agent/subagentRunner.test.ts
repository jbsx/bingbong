import { describe, expect, it } from 'vitest'
import { FakeClock, ScriptedLlm, memoryEntry } from '../testing/doubles'
import { runSubagent, SubagentCancelledError } from './subagentRunner'
import type { Tool } from '../pipeline/tool'
import type { WorkingMemorySnapshot } from '../session/workingMemory'
import { VisionDeadlineError } from '../ports/vision'
import { ASK_ESCALATION_PREFIX, createAskUserTool, createSubagentAskTool } from '../pipeline/askUserTools'
import { SEARCH_LOOP_NUDGE_AFTER, SEARCH_LOOP_REFUSE_AFTER } from '../pipeline/searchLoopRail'
import type { SettledPageState } from '../pipeline/progressFingerprints'
import { hostFromUrl } from '../pipeline/blockerGate'

// The workhorse loop behind every subagent (issue #13): a deepseek-chat LLM
// with its own tool set, no confirmations (the policy wrapper already
// downgraded those to denials), progress reported per step, cancellation
// polled at every checkpoint. The manager above it owns lifecycle rails.

function noopTools(): Tool[] {
  return []
}

describe('runSubagent', () => {
  it('stamps the spawning turn id on every model round', async () => {
    const noop: Tool = {
      name: 'noop',
      async execute() {
        return 'ok'
      },
    }
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 's1', name: 'noop', args: {} }] },
      { kind: 'answer', speak: 's', display: 'Done.' },
    ])

    await runSubagent(
      { llm, tools: [noop], clock: new FakeClock() },
      { task: 'do work', turnId: 'turn-voice-31', isCancelled: () => false },
    )

    expect(llm.requests.map((request) => request.turnId)).toEqual(['turn-voice-31', 'turn-voice-31'])
  })

  it('rides the delegated Memory Entries on every model round as untrusted data (#98)', async () => {
    const noop: Tool = {
      name: 'noop',
      async execute() {
        return 'ok'
      },
    }
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 's1', name: 'noop', args: {} }] },
      { kind: 'answer', speak: 's', display: 'Done.' },
    ])
    const selection: WorkingMemorySnapshot = Object.freeze([Object.freeze(memoryEntry('memory-1'))])

    await runSubagent(
      { llm, tools: [noop], clock: new FakeClock() },
      { task: 'compare within budget', agentId: 'a-1', memory: selection, isCancelled: () => false },
    )

    // The same frozen slice reaches every round — the loop cannot lose it
    // between rounds, and never mutates it.
    expect(llm.requests.map((request) => request.memory)).toEqual([selection, selection])
  })

  it('returns a structured report: prose text plus validated findings and unresolved items (#98)', async () => {
    const navigate: Tool = {
      name: 'navigate',
      async execute() {
        return 'navigated: url=https://reviews.test/x title="Reviews"'
      },
    }
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'n1', name: 'navigate', args: { url: 'https://reviews.test/x' } }] },
      {
        kind: 'answer',
        speak: 'Found it.',
        display: 'Model X leads; stock unknown.',
        findings: [{ subject: 'Winner', detail: 'Model X leads.', references: [{ url: 'https://reviews.test/x' }] }],
        unresolved: ['Stock check pending'],
      },
    ])

    const report = await runSubagent(
      { llm, tools: [navigate], clock: new FakeClock(), currentPageUrl: () => 'https://reviews.test/x' },
      { task: 't', isCancelled: () => false },
    )

    expect(report).toEqual({
      text: 'Model X leads; stock unknown.',
      findings: [{ subject: 'Winner', detail: 'Model X leads.', references: [{ url: 'https://reviews.test/x' }] }],
      unresolved: ['Stock check pending'],
      // The worker's own observation of the cited source rides the report
      // as hidden provenance (#123).
      observations: [expect.objectContaining({ producer: 'action_outcome', ok: true, sourceUrl: 'https://reviews.test/x' })],
    })
  })

  it('stamps its own id on the report as provenance (#98)', async () => {
    const llm = new ScriptedLlm([{ kind: 'answer', speak: 's', display: 'Done.' }])

    const report = await runSubagent(
      { llm, tools: [], clock: new FakeClock() },
      { task: 't', agentId: 'a-7', isCancelled: () => false },
    )

    expect(report.agentId).toBe('a-7')
  })

  it('keeps the report structured-but-empty when the answer carries no sections (#98)', async () => {
    const llm = new ScriptedLlm([{ kind: 'answer', speak: 'short', display: 'Plain prose report.' }])

    const report = await runSubagent({ llm, tools: [], clock: new FakeClock() }, { task: 't', isCancelled: () => false })

    expect(report).toEqual({ text: 'Plain prose report.', findings: [], unresolved: [] })
  })

  it('runs tool calls, reports progress per step, and returns the final report', async () => {
    const navigate: Tool = {
      name: 'navigate',
      async execute() {
        return 'navigated: url=https://hit.test title="Hit"'
      },
    }
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'n1', name: 'navigate', args: { url: 'https://hit.test' } }] },
      { kind: 'answer', speak: 'short', display: 'Full research report.' },
    ])
    const progress: { step: number; action: string }[] = []

    const result = await runSubagent(
      { llm, tools: [navigate], clock: new FakeClock() },
      { task: 'open the hit page', isCancelled: () => false, onProgress: (p) => progress.push(p) },
    )

    expect(result.text).toBe('Full research report.')
    expect(progress).toEqual([{ step: 1, action: '→ https://hit.test' }])
    // The tool result reached the next LLM round.
    expect(llm.requests[1]?.toolResults).toMatchObject([
      { call: { name: 'navigate' }, outcome: { ok: true, result: 'navigated: url=https://hit.test title="Hit"' } },
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

    expect(result.text).toBe('Recovered anyway.')
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

    expect(result.text).toContain(`${ASK_ESCALATION_PREFIX} Which city?`)
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

  it('finalizes at its tool-round limit with a reserved answer round — no raw limit failure (#120)', async () => {
    let executions = 0
    const spin: Tool = { name: 'spin', async execute() { executions += 1; return 'spun' } }
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'c0', name: 'spin', args: {} }] },
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'spin', args: {} }] },
      // The reserved Answer round consumes this turn.
      { kind: 'answer', speak: 'partial', display: 'Bounded but useful report.', findings: [{ subject: 'S', detail: 'D.', references: [] }] },
    ])

    const report = await runSubagent(
      { llm, tools: [spin], clock: new FakeClock(), maxToolRounds: 2 },
      { task: 't', isCancelled: () => false },
    )

    // Exactly two acquisition rounds executed; the third scripted tool
    // round never ran — the reserved Answer round took its place.
    expect(executions).toBe(2)
    expect(llm.requests).toHaveLength(3)
    expect(report.text).toBe('Bounded but useful report.')
    // A reference-less finding grounds nothing — it is dropped before the
    // report completes and the drop is disclosed (#123).
    expect(report.findings).toEqual([])
    expect(report.unresolved).toEqual([expect.stringMatching(/^1 finding dropped — the cited source was not observed/)])
    // The directive rode the last tool result the reserved round saw.
    const reserved = llm.requests[2]?.toolResults
    expect(reserved).toHaveLength(2)
    const lastOutcome = reserved?.[1]?.outcome
    expect(lastOutcome).toMatchObject({
      ok: true,
      result: expect.stringMatching(/delegated work budget \(2 tool rounds\) is spent[\s\S]*final report JSON/),
    })
  })

  it('answers deterministically when the reserved round demands tools anyway (#120)', async () => {
    let executions = 0
    const spin: Tool = { name: 'spin', async execute() { executions += 1; return 'spun' } }
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'c0', name: 'spin', args: {} }] },
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'spin', args: {} }] },
      { kind: 'tool_calls', calls: [{ id: 'c2', name: 'spin', args: {} }] },
      { kind: 'answer', speak: 'never', display: 'never' },
    ])

    const report = await runSubagent(
      { llm, tools: [spin], clock: new FakeClock(), maxToolRounds: 2 },
      { task: 't', agentId: 'a-3', isCancelled: () => false },
    )

    // The refused third round executed nothing and produced no further
    // model rounds — the bounded report is deterministic.
    expect(executions).toBe(2)
    expect(llm.requests).toHaveLength(3)
    expect(report.agentId).toBe('a-3')
    expect(report.text).toMatch(/Stopped at the delegated work limit after 2 tool rounds — the delegated work budget \(2 tool rounds\) was spent, and no final report was produced\. The last action was: spin/)
    expect(report.findings).toEqual([])
    expect(report.unresolved).toEqual(['Cut short at the delegated work limit — the task is incomplete.'])
  })

  it('answers deterministically when the reserved round itself fails (#120)', async () => {
    let executions = 0
    const spin: Tool = { name: 'spin', async execute() { executions += 1; return 'spun' } }
    let calls = 0
    const llm = {
      async complete() {
        calls += 1
        if (calls <= 2) {
          return { kind: 'tool_calls' as const, calls: [{ id: `c${calls}`, name: 'spin', args: {} }] }
        }
        throw new Error('provider exploded')
      },
    }

    const report = await runSubagent(
      { llm, tools: [spin], clock: new FakeClock(), maxToolRounds: 2 },
      { task: 't', isCancelled: () => false },
    )

    expect(calls).toBe(3)
    expect(executions).toBe(2)
    expect(report.text).toMatch(/Stopped at the delegated work limit after 2 tool rounds/)
    expect(report.unresolved).toEqual(['Cut short at the delegated work limit — the task is incomplete.'])
  })

  it('records its own Observations with the tab URL as source, classified like the orchestrator\'s (#123)', async () => {
    const navigate: Tool = { name: 'navigate', async execute() { return 'navigated' } }
    const boom: Tool = { name: 'boom', async execute() { throw new Error('nope') } }
    const llm = new ScriptedLlm([
      {
        kind: 'tool_calls',
        calls: [
          { id: 'n1', name: 'navigate', args: { url: 'https://a.test/1' } },
          { id: 'b1', name: 'boom', args: {} },
        ],
      },
      { kind: 'answer', speak: 's', display: 'Done.' },
    ])

    const report = await runSubagent(
      { llm, tools: [navigate, boom], clock: new FakeClock(), currentPageUrl: () => 'https://a.test/1' },
      { task: 't', isCancelled: () => false },
    )

    // Page-facing successes carry the source URL; a non-page tool's
    // failure is retained as a failure without one; the ledger itself
    // never reaches any model round.
    expect(report.observations).toEqual([
      expect.objectContaining({ producer: 'action_outcome', ok: true, payload: 'navigated', sourceUrl: 'https://a.test/1' }),
      expect.objectContaining({ producer: 'action_outcome', ok: false, payload: 'nope' }),
    ])
    expect(llm.requests[1]?.toolResults).toHaveLength(2)
  })

  it('carries its observations on the bounded stop report — a cut-off worker\'s work is still checkpointable (#123)', async () => {
    const spin: Tool = { name: 'navigate', async execute() { return 'spun' } }
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'c0', name: 'navigate', args: {} }] },
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'navigate', args: {} }] },
      // The reserved round demands tools anyway: the bounded report answers.
      { kind: 'tool_calls', calls: [{ id: 'c2', name: 'navigate', args: {} }] },
    ])

    const report = await runSubagent(
      { llm, tools: [spin], clock: new FakeClock(), maxToolRounds: 2, currentPageUrl: () => 'https://seen.test/page' },
      { task: 't', agentId: 'a-4', isCancelled: () => false },
    )

    expect(report.findings).toEqual([])
    expect(report.observations).toEqual([
      expect.objectContaining({ ok: true, payload: 'spun', sourceUrl: 'https://seen.test/page' }),
      expect.objectContaining({ ok: true, payload: 'spun', sourceUrl: 'https://seen.test/page' }),
    ])
  })

  it('honours the parent\'s shared active-work deadline with a reserved answer round (#120)', async () => {
    let expired = false
    const spin: Tool = { name: 'spin', async execute() { expired = true; return 'spun' } }
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'c0', name: 'spin', args: {} }] },
      { kind: 'answer', speak: 's', display: 'Report under the deadline.' },
    ])

    const report = await runSubagent(
      { llm, tools: [spin], clock: new FakeClock(), maxToolRounds: 12 },
      { task: 't', isCancelled: () => false, isWorkExpired: () => expired },
    )

    // One acquisition round ran; the deadline — not the worker's own
    // budget — stopped the second, and the model's reserved answer became
    // the report.
    expect(llm.requests).toHaveLength(2)
    expect(report.text).toBe('Report under the deadline.')
    const outcome = llm.requests[1]?.toolResults[0]?.outcome
    expect(outcome).toMatchObject({
      ok: true,
      result: expect.stringMatching(/active-work deadline has passed[\s\S]*final report JSON/),
    })
  })

  it('shares the parent deadline live — expiry mid-run finalizes instead of executing further rounds (#120)', async () => {
    let expired = false
    let executions = 0
    const spin: Tool = { name: 'spin', async execute() { executions += 1; expired = executions >= 2; return 'spun' } }
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'c0', name: 'spin', args: {} }] },
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'spin', args: {} }] },
      { kind: 'tool_calls', calls: [{ id: 'c2', name: 'spin', args: {} }] },
      { kind: 'answer', speak: 'never', display: 'never' },
    ])

    const report = await runSubagent(
      { llm, tools: [spin], clock: new FakeClock(), maxToolRounds: 12 },
      { task: 't', isCancelled: () => false, isWorkExpired: () => expired },
    )

    // Two rounds executed; the third never did — the shared deadline, not
    // the worker's own budget, stopped acquisition, and the reserved round
    // (scripted as a tool round) fell through to the bounded report.
    expect(executions).toBe(2)
    expect(report.text).toMatch(/parent run reached its active-work deadline/)
  })

  it('reports the parent deadline, not its spent budget, when both end the run (#149)', async () => {
    let expired = false
    const spin: Tool = { name: 'spin', async execute() { expired = true; return 'spun' } }
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'c0', name: 'spin', args: {} }] },
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'spin', args: {} }] },
    ])

    const report = await runSubagent(
      { llm, tools: [spin], clock: new FakeClock(), maxToolRounds: 1 },
      { task: 't', isCancelled: () => false, isWorkExpired: () => expired },
    )

    // The single round spent the budget and the parent's deadline passed
    // in the same round: the report and the reserved round's directive
    // both name the deadline.
    const outcome = llm.requests[1]?.toolResults[0]?.outcome
    expect(outcome).toMatchObject({
      ok: true,
      result: expect.stringMatching(/active-work deadline has passed/),
    })
    expect(report.text).toMatch(/parent run reached its active-work deadline/)
  })

  it('answers deterministically without a model round when the deadline passes before any work (#120)', async () => {
    const llm = new ScriptedLlm([
      { kind: 'answer', speak: 'never', display: 'never' },
    ])

    const report = await runSubagent(
      { llm, tools: [], clock: new FakeClock(), maxToolRounds: 2 },
      { task: 't', agentId: 'a-9', isCancelled: () => false, isWorkExpired: () => true },
    )

    // No tool result exists to carry the directive, so there is no
    // reserved round at all — the bounded report is the whole answer.
    expect(llm.requests).toHaveLength(0)
    expect(report.agentId).toBe('a-9')
    expect(report.text).toMatch(/Stopped at the delegated work limit after 0 tool rounds — the parent run reached its active-work deadline/)
    expect(report.unresolved).toEqual(['Cut short at the delegated work limit — the task is incomplete.'])
  })

  it('enforces the fifteen-call vision rail for a subagent task', async () => {
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
        calls: Array.from({ length: 20 }, (_, index) => ({ id: `v${index}`, name: 'analyze_page', args: {} })),
      },
      { kind: 'answer', speak: 's', display: 'bounded' },
    ])

    await runSubagent({ llm, tools: [vision], clock: new FakeClock() }, { task: 't', isCancelled: () => false })

    expect(executions).toBe(15)
    expect(llm.requests[1]?.toolResults.filter((result) => !result.outcome.ok)).toHaveLength(5)
  })

  it('nudges a Look that missed the Vision Deadline toward read_page/ask_user instead of a bare error', async () => {
    const look: Tool = {
      name: 'look',
      usesVision: true,
      async execute() {
        throw new VisionDeadlineError(8_000, 'first-token')
      },
    }
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'l1', name: 'look', args: {} }] },
      { kind: 'answer', speak: 's', display: 'fell back to the DOM' },
    ])

    await runSubagent({ llm, tools: [look], clock: new FakeClock() }, { task: 't', isCancelled: () => false })

    const outcome = llm.requests[1]?.toolResults[0]?.outcome
    expect(outcome).toMatchObject({
      ok: false,
      error: expect.stringMatching(
        /did not begin answering within 8000ms[\s\S]*read_page[\s\S]*ask_user[\s\S]*do not keep retrying look/,
      ),
    })
  })

  it('refuses the second same-host browser call with the ASK_USER relay (#81)', async () => {
    const WALLED = 'navigated to https://www.reddit.com/search\nBLOCKER:challenge www.reddit.com\nThis page is a Blocker — a challenge wall.'
    let current: string | null = null
    let navigateRuns = 0
    let clickRuns = 0
    const navigate: Tool = {
      name: 'navigate',
      async execute(call) {
        navigateRuns += 1
        const url = typeof call.args.url === 'string' ? call.args.url : ''
        current = hostFromUrl(url) ?? current
        return WALLED
      },
    }
    const click: Tool = {
      name: 'click',
      async execute() {
        clickRuns += 1
        return 'clicked'
      },
    }
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'n1', name: 'navigate', args: { url: 'https://www.reddit.com/search' } }] },
      { kind: 'tool_calls', calls: [{ id: 'n2', name: 'navigate', args: { url: 'https://www.reddit.com/r/other' } }] },
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'click', args: { ref: 7 } }] },
      { kind: 'answer', speak: 's', display: 'Escalated in the report.' },
    ])

    const report = await runSubagent(
      { llm, tools: [navigate, click], clock: new FakeClock(), currentHost: () => current },
      { task: 'find the post', isCancelled: () => false },
    )

    // The wall-detecting interaction executed (detection never blocks); the
    // repeated same-wall navigate and click were refused pre-execution.
    expect(navigateRuns).toBe(1)
    expect(clickRuns).toBe(0)
    const refusals = llm.requests[3]?.toolResults.filter((entry) => !entry.outcome.ok) ?? []
    expect(refusals).toHaveLength(2)
    for (const refusal of refusals) {
      expect(refusal.outcome).toMatchObject({
        ok: false,
        error: expect.stringMatching(/www\.reddit\.com is walled for this run \(Blocker: challenge\)/),
      })
      // Subagents cannot ask the user directly: the refusal names the
      // ASK_USER relay, not the orchestrator's direct ask.
      expect((refusal.outcome as { error: string }).error).toMatch(/ASK_USER: <question>/)
      expect((refusal.outcome as { error: string }).error).toMatch(/genuinely different site/)
    }
    // The marker line still rides the wall-detecting tool result the model sees.
    expect(llm.requests[1]?.toolResults[0]?.outcome).toMatchObject({
      ok: true,
      result: expect.stringMatching(/BLOCKER:challenge www\.reddit\.com/),
    })
    expect(report.text).toBe('Escalated in the report.')
  })

  it('never refuses read_page, look, or ask_user on the walled host (#81)', async () => {
    const WALLED = 'page\nBLOCKER:challenge www.reddit.com\nThis page is a Blocker — a challenge wall.'
    const current = 'www.reddit.com'
    let readRuns = 0
    let lookRuns = 0
    const navigate: Tool = {
      name: 'navigate',
      async execute() {
        return WALLED
      },
    }
    const readPage: Tool = {
      name: 'read_page',
      async execute() {
        readRuns += 1
        return WALLED
      },
    }
    const look: Tool = {
      name: 'look',
      usesVision: true,
      async execute() {
        lookRuns += 1
        return 'a challenge wall fills the page'
      },
    }
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'n1', name: 'navigate', args: { url: 'https://www.reddit.com/search' } }] },
      { kind: 'tool_calls', calls: [{ id: 'r1', name: 'read_page', args: {} }] },
      { kind: 'tool_calls', calls: [{ id: 'l1', name: 'look', args: {} }] },
      { kind: 'tool_calls', calls: [{ id: 'a1', name: 'ask_user', args: { question: 'Can you complete the challenge in the browser tab?' } }] },
    ])

    const report = await runSubagent(
      { llm, tools: [navigate, readPage, look, createSubagentAskTool()], clock: new FakeClock(), currentHost: () => current },
      { task: 'find the post', isCancelled: () => false },
    )

    expect(readRuns).toBe(1)
    expect(lookRuns).toBe(1)
    expect(llm.requests.filter((request) => request.toolResults.some((entry) => !entry.outcome.ok))).toHaveLength(0)
    // The ask directive ends the run and becomes the report the
    // orchestrator relays — the escalation itself, untouched by the gate.
    expect(report.text).toContain(`${ASK_ESCALATION_PREFIX} Can you complete the challenge in the browser tab?`)
  })

  it('disarms the same-wall gate after a successful different-host interaction (#81)', async () => {
    const WALLED = 'navigated to https://www.reddit.com/search\nBLOCKER:challenge www.reddit.com\nThis page is a Blocker — a challenge wall.'
    let current: string | null = null
    let clickRuns = 0
    const navigate: Tool = {
      name: 'navigate',
      async execute(call) {
        const url = typeof call.args.url === 'string' ? call.args.url : ''
        current = hostFromUrl(url) ?? current
        return url.includes('reddit.com') ? WALLED : `navigated to ${url}`
      },
    }
    const click: Tool = {
      name: 'click',
      async execute() {
        clickRuns += 1
        return 'clicked'
      },
    }
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'n1', name: 'navigate', args: { url: 'https://www.reddit.com/search' } }] },
      { kind: 'tool_calls', calls: [{ id: 'n2', name: 'navigate', args: { url: 'https://example.com/article' } }] },
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'click', args: { ref: 3 } }] },
      { kind: 'answer', speak: 's', display: 'Read it elsewhere.' },
    ])

    const report = await runSubagent(
      { llm, tools: [navigate, click], clock: new FakeClock(), currentHost: () => current },
      { task: 'find the post', isCancelled: () => false },
    )

    // Moving on and interacting elsewhere lifts the refusal.
    expect(clickRuns).toBe(1)
    expect(llm.requests.filter((request) => request.toolResults.some((entry) => !entry.outcome.ok))).toHaveLength(0)
    expect(report.text).toBe('Read it elsewhere.')
  })

  it('refuses a walled-host call ahead of the risk tiers — before the confirm downgrade (#81)', async () => {
    const WALLED = 'navigated to https://www.reddit.com/search\nBLOCKER:challenge www.reddit.com\nThis page is a Blocker — a challenge wall.'
    const current = 'www.reddit.com'
    let executions = 0
    const navigate: Tool = {
      name: 'navigate',
      async execute() {
        return WALLED
      },
    }
    const submitClick: Tool = {
      name: 'click',
      assessRisk: () => ({ kind: 'confirm', prompt: 'Click this submit button?' }),
      async execute() {
        executions += 1
        return 'clicked'
      },
    }
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'n1', name: 'navigate', args: { url: 'https://www.reddit.com/search' } }] },
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'click', args: { ref: 9 } }] },
      { kind: 'answer', speak: 's', display: 'Escalated instead.' },
    ])

    await runSubagent(
      { llm, tools: [navigate, submitClick], clock: new FakeClock(), currentHost: () => current },
      { task: 'post the comment', isCancelled: () => false },
    )

    // The gate refusal, not the confirmation downgrade, is what the model
    // sees — same ordering as the orchestrator pipeline.
    expect(executions).toBe(0)
    expect(llm.requests[2]?.toolResults[1]?.outcome).toMatchObject({
      ok: false,
      error: expect.stringMatching(/www\.reddit\.com is walled for this run/),
    })
  })

  it('creates the same-wall gate fresh per run (#81)', async () => {
    const WALLED = 'navigated to https://www.reddit.com/search\nBLOCKER:challenge www.reddit.com\nThis page is a Blocker — a challenge wall.'
    const current = 'www.reddit.com'
    let clickRuns = 0
    const navigate: Tool = {
      name: 'navigate',
      async execute() {
        return WALLED
      },
    }
    const click: Tool = {
      name: 'click',
      async execute() {
        clickRuns += 1
        return 'clicked'
      },
    }
    const llm = new ScriptedLlm([
      // First run: the wall is detected, then the same-host click refuses.
      { kind: 'tool_calls', calls: [{ id: 'n1', name: 'navigate', args: { url: 'https://www.reddit.com/search' } }] },
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'click', args: { ref: 1 } }] },
      { kind: 'answer', speak: 's', display: 'Stopped at the wall.' },
      // Second run: the same click on the same host starts clear.
      { kind: 'tool_calls', calls: [{ id: 'c2', name: 'click', args: { ref: 1 } }] },
      { kind: 'answer', speak: 's', display: 'Clicked.' },
    ])
    const deps = { llm, tools: [navigate, click], clock: new FakeClock(), currentHost: () => current }

    await runSubagent(deps, { task: 'first task', isCancelled: () => false })
    await runSubagent(deps, { task: 'second task', isCancelled: () => false })

    // Run one refused the click; run two — same tools, same tab host —
    // executed it: one run's wall never poisons the next.
    expect(clickRuns).toBe(1)
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

  it('waits at checkpoints while paused and resumes with completed tool context intact', async () => {
    let paused = false
    let releasePause!: () => void
    const pauseGate = new Promise<void>((resolve) => {
      releasePause = resolve
    })
    const tool: Tool = {
      name: 'step',
      async execute() {
        paused = true
        return 'first result'
      },
    }
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'one', name: 'step', args: {} }] },
      { kind: 'answer', speak: 'done', display: 'Finished with context.' },
    ])

    const running = runSubagent(
      { llm, tools: [tool], clock: new FakeClock() },
      {
        task: 'do both steps',
        isCancelled: () => false,
        waitIfPaused: () => (paused ? pauseGate : Promise.resolve()),
      },
    )
    await Promise.resolve()
    await Promise.resolve()

    expect(llm.requests).toHaveLength(1)
    releasePause()
    const result = await running

    expect(result.text).toBe('Finished with context.')
    expect(llm.requests[1]?.toolResults).toMatchObject([
      { call: { id: 'one' }, outcome: { ok: true, result: 'first result' } },
    ])
  })

  // #159: the Tool Round executor runs in a worker with all three
  // capability flags on — the ADR 0027 promise that a Browse Subagent runs
  // the Run's Progress and Finalization discipline. One test per rail,
  // plus the deadline gate; the rails observe the worker's own tab.

  /** The worker's tab, settled and never moving — the rails' worst case. */
  const STUCK: SettledPageState = {
    url: 'https://example.com/',
    title: 'Example',
    textDigest: 'Nothing new here.',
    scrollX: 0,
    scrollY: 0,
    dialogOpen: false,
    dialogText: '',
  }

  it('refuses a search that rewords one intent past the cap (#159)', async () => {
    let executions = 0
    const navigate: Tool = {
      name: 'navigate',
      acquisition: true,
      async execute() {
        executions += 1
        return 'search results'
      },
    }
    const llm = new ScriptedLlm([
      {
        kind: 'tool_calls',
        calls: Array.from({ length: 6 }, (_, index) => ({
          id: `q${index}`,
          name: 'navigate',
          args: { url: 'https://example.com/search?q=best+noise+cancelling+headphones' },
        })),
      },
      { kind: 'answer', speak: 's', display: 'Searched.' },
    ])

    await runSubagent({ llm, tools: [navigate], clock: new FakeClock() }, { task: 't', isCancelled: () => false })

    // Five consecutive q= searches reach the cap; the sixth is refused
    // before it executes, exactly as it would be in a Run.
    expect(executions).toBe(SEARCH_LOOP_REFUSE_AFTER)
    const results = llm.requests[1]?.toolResults ?? []
    expect(results).toHaveLength(6)
    expect(results[5]?.outcome).toMatchObject({
      ok: false,
      error: expect.stringContaining('Search loop limit'),
    })
    // The advisory nudge rides the result that reached the nudge tier.
    expect(results[SEARCH_LOOP_NUDGE_AFTER - 1]?.outcome).toMatchObject({
      ok: true,
      result: expect.stringContaining('reword one intent'),
    })
  })

  it('nudges then refuses an objectively redundant action (#159)', async () => {
    let executions = 0
    const click: Tool = {
      name: 'click',
      acquisition: true,
      async execute() {
        executions += 1
        return 'clicked'
      },
    }
    const llm = new ScriptedLlm([
      {
        kind: 'tool_calls',
        calls: Array.from({ length: 3 }, (_, index) => ({ id: `c${index}`, name: 'click', args: { ref: 4 } })),
      },
      { kind: 'answer', speak: 's', display: 'Clicked.' },
    ])

    await runSubagent(
      { llm, tools: [click], clock: new FakeClock(), settledPageState: () => STUCK },
      { task: 't', isCancelled: () => false },
    )

    // The repeat against unchanged state is nudged and still runs; the one
    // after it is refused pre-execution.
    expect(executions).toBe(2)
    const results = llm.requests[1]?.toolResults ?? []
    expect(results[1]?.outcome).toMatchObject({
      ok: true,
      result: expect.stringContaining('repeats an equivalent action against unchanged page state'),
    })
    expect(results[2]?.outcome).toMatchObject({
      ok: false,
      error: expect.stringContaining('Not executed — this action repeats an equivalent action'),
    })
  })

  it('finalizes for no_progress after two exhausted Approaches, with a bounded report (#159)', async () => {
    let executions = 0
    const click: Tool = {
      name: 'click',
      acquisition: true,
      async execute() {
        executions += 1
        return 'clicked'
      },
    }
    // Six distinct targets, so the redundancy gate never fires — every
    // action is new, and none of them moves the page.
    const llm = new ScriptedLlm([
      {
        kind: 'tool_calls',
        calls: Array.from({ length: 6 }, (_, index) => ({ id: `c${index}`, name: 'click', args: { ref: index + 1 } })),
      },
      // The reserved Answer round demands tools anyway: the report is the
      // worker's own deterministic bounded one.
      { kind: 'tool_calls', calls: [{ id: 'c9', name: 'click', args: { ref: 9 } }] },
      { kind: 'answer', speak: 'never', display: 'never' },
    ])

    const report = await runSubagent(
      { llm, tools: [click], clock: new FakeClock(), settledPageState: () => STUCK, maxToolRounds: 12 },
      { task: 't', agentId: 'a-159', isCancelled: () => false },
    )

    // Baseline plus four no-progress actions exhaust two Approaches and
    // trip Finalization mid-round; the sixth sibling is an acquisition
    // call in Finalization, so it is refused with the finalize directive.
    expect(executions).toBe(5)
    const results = llm.requests[1]?.toolResults ?? []
    expect(results).toHaveLength(6)
    // The refusal is the worker's own (#159), not the Run's: no spent
    // budget, no Run Plan bookkeeping, and a report rather than an answer.
    expect(results[5]?.outcome).toMatchObject({
      ok: false,
      error: expect.stringContaining('Not executed — The delegated work is over'),
    })
    expect(results[5]?.outcome).toMatchObject({
      ok: false,
      error: expect.stringContaining('ONLY your final report JSON'),
    })
    expect(results[5]?.outcome.ok === false ? results[5].outcome.error : '').not.toContain('Run Plan')
    // The action that exhausted the second Approach is told the same
    // thing, so the trip round carries one instruction, not three.
    expect(results[4]?.outcome).toMatchObject({
      ok: true,
      result: expect.stringContaining('A second Approach has made no progress. The delegated work is over'),
    })
    // Budget was never the reason: the worker had 11 of its 12 rounds left.
    expect(llm.requests).toHaveLength(2)
    expect(report.agentId).toBe('a-159')
    expect(report.text).toMatch(
      /Stopped without progress after 1 tool round — two Approaches in a row made no progress, and no final report was produced\./,
    )
    expect(report.unresolved).toEqual(['Cut short with no progress left to make — the task is incomplete.'])
  })

  it('runs the per-call deadline gate — no sibling executes past the shared deadline (#159)', async () => {
    let expired = false
    let executions = 0
    const spin: Tool = {
      name: 'spin',
      acquisition: true,
      async execute() {
        executions += 1
        expired = true
        return 'spun'
      },
    }
    const llm = new ScriptedLlm([
      {
        kind: 'tool_calls',
        calls: [
          { id: 'a', name: 'spin', args: {} },
          { id: 'b', name: 'spin', args: {} },
          { id: 'c', name: 'spin', args: {} },
        ],
      },
      { kind: 'answer', speak: 's', display: 'Bounded report.' },
    ])

    const report = await runSubagent(
      { llm, tools: [spin], clock: new FakeClock(), maxToolRounds: 12 },
      { task: 't', isCancelled: () => false, isWorkExpired: () => expired },
    )

    // The first call crossed the deadline; the two siblings behind it never
    // begin — the gate trips Finalization and the closed-tool check refuses
    // them, each carrying the finalize directive.
    expect(executions).toBe(1)
    const results = llm.requests[1]?.toolResults ?? []
    expect(results).toHaveLength(3)
    expect(results[1]?.outcome).toMatchObject({
      ok: false,
      error: expect.stringContaining('Not executed — The delegated work is over'),
    })
    expect(results[2]?.outcome).toMatchObject({
      ok: false,
      error: expect.stringMatching(/active-work deadline has passed[\s\S]*final report JSON/),
    })
    expect(report.text).toBe('Bounded report.')
  })

  it('answers an interactive ask_user as an unknown tool — a worker has no user to ask (#158)', async () => {
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'q1', name: 'ask_user', args: { question: 'Which city?' } }] },
      { kind: 'answer', speak: 's', display: 'Reported instead.' },
    ])

    // The orchestrator's ask_user, handed to a worker by mistake: the
    // decisions seam cannot open a window nobody can close.
    await runSubagent(
      { llm, tools: [createAskUserTool()], clock: new FakeClock() },
      { task: 't', isCancelled: () => false },
    )

    expect(llm.requests[1]?.toolResults).toMatchObject([
      { outcome: { ok: false, error: "unknown tool: 'ask_user'" } },
    ])
  })
})
