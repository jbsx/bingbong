import { describe, expect, it } from 'vitest'
import { VisionDeadlineError } from '../ports/vision'
import { createCommandPipeline, type CommandPipeline } from './createCommandPipeline'
import { hostFromUrl } from './blockerGate'
import { steerPipeline } from './steering'
import { createSpeechCoordinator } from '../tts/speechCoordinator'
import { createAskUserTool } from './askUserTools'
import { createReportRunPlanTool } from './runPlanTools'
import type { EffortTier } from './runPlan'
import { createHistoryRecorder } from '../history/historyRecorder'
import type { HistoryStore, RecordedEntry, RunRecord } from '../history/historyStore'
import { FailingTts, FakeClock, fakePerfHarness, fakeSubagentManager, memoryEntry, RecordingTts, ScriptedLlm, subagentRecord, withoutTurnId } from '../testing/doubles'
import type { PipelineEvent } from './events'
import type { SessionId } from '../session/sessionIdentity'
import type { ObservationRecord } from '../session/observationLedger'
import type { AssistantTurn, LlmClient, LlmRequest, ToolCall } from '../ports/llm'
import type { Tool } from './tool'
import type { WorkingMemorySnapshot } from '../session/workingMemory'
import { createSubagentTools } from './subagentTools'
import { createRecordEvidenceTool } from './evidenceTools'
import { createRecordCandidateTool } from './candidateTools'
import { webEvidenceCommit } from './evidenceCheckpoint'
import type { RunContinuityContext } from './createCommandPipeline'
import { createSessionEvidence, type SessionEvidenceSnapshot, type SessionEvidenceStore } from '../session/sessionEvidence'
import type { MemoryEntryId, MemoryPatch } from '../session/workingMemory'
import type { RunId } from '../session/sessionIdentity'
import { createPerfTracer, type PerfTracer } from '../perf/perfTracer'
import { withPerfTracing } from '../perf/perfTracing'
import { createBrowserSubspans } from '../perf/browserSubspans'
import { DELTA_FLUSH_MS } from './deltaBatcher'

async function collect(
  pipeline: CommandPipeline,
  command: string,
  onEvent?: (event: PipelineEvent, pipeline: CommandPipeline) => void,
): Promise<PipelineEvent[]> {
  const events: PipelineEvent[] = []
  for await (const raw of pipeline.execute(command)) {
    const event = withoutTurnId(raw)
    events.push(event)
    onEvent?.(event, pipeline)
  }
  return events
}

/** Raw event collection — keeps the turnId stamp (#28). */
async function collectStamped(pipeline: CommandPipeline, command: string, turnId?: string): Promise<PipelineEvent[]> {
  const events: PipelineEvent[] = []
  for await (const event of pipeline.execute(command, turnId)) events.push(event)
  return events
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20 && !predicate(); attempt += 1) await flush()
  expect(predicate()).toBe(true)
}

describe('command pipeline', () => {
  it('aborts at the next model checkpoint and speaks only the stopped acknowledgement', async () => {
    const turn = deferred<AssistantTurn>()
    const llm: LlmClient = { complete: () => turn.promise }
    const tts = new RecordingTts()
    let abortHooks = 0
    const pipeline = createCommandPipeline({
      llm,
      tts,
      clock: new FakeClock(),
      tools: [],
      onAbort: () => { abortHooks += 1 },
    })

    const run = collect(pipeline, 'keep working')
    await flush()
    expect(pipeline.getState()).toBe('running')

    pipeline.abort()
    turn.resolve({ kind: 'answer', speak: 'Finished.', display: 'Stale answer.' })
    const events = await run

    expect(tts.stopCalls).toBe(1)
    expect(abortHooks).toBe(1)
    expect(tts.spoken).toEqual(['Stopped.'])
    expect(events).toContainEqual({ type: 'status', status: 'cancelled', at: 0 })
    expect(events).toContainEqual({ type: 'speak', text: 'Stopped.', at: 0 })
    expect(events.some((event) => event.type === 'display' && event.text === 'Stale answer.')).toBe(false)
    expect(events.some((event) => event.type === 'error')).toBe(false)
    expect(events.at(-1)).toEqual({ type: 'done', outcome: 'cancelled', at: 0 })
    expect(pipeline.getState()).toBe('idle')
  })

  it('denies a pending confirmation cleanly when aborted', async () => {
    let executions = 0
    const riskyTool = {
      name: 'submit_form',
      assessRisk: () => ({ kind: 'confirm' as const, prompt: 'Submit this form?' }),
      async execute() {
        executions += 1
        return 'submitted'
      },
    }
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'submit_form', args: {} }] },
      { kind: 'answer', speak: 'Submitted.', display: 'Submitted.' },
    ])
    const tts = new RecordingTts()
    const pipeline = createCommandPipeline({ llm, tts, clock: new FakeClock(), tools: [riskyTool] })

    const events = await collect(pipeline, 'submit it', (event, activePipeline) => {
      if (event.type === 'confirmation_requested') activePipeline.abort()
    })

    expect(executions).toBe(0)
    expect(events).toContainEqual({
      type: 'confirmation_resolved',
      confirmationId: 'confirm-1',
      approved: false,
      reason: 'cancelled',
      at: 0,
    })
    expect(events).toContainEqual({ type: 'status', status: 'cancelled', at: 0 })
    expect(tts.spoken.at(-1)).toBe('Stopped.')
  })

  it('aborts during ask_user speech without opening a new answer wait', async () => {
    const holder: { pipeline?: CommandPipeline } = {}
    const tts = {
      async speak() {
        holder.pipeline?.abort()
        return { ok: true as const }
      },
      stop() {},
    }
    const pipeline = createCommandPipeline({
      llm: new ScriptedLlm([
        { kind: 'tool_calls', calls: [{ id: 'ask', name: 'ask_user', args: { question: 'Which city?' } }] },
      ]),
      tts,
      clock: new FakeClock(),
      tools: [createAskUserTool()],
    })
    holder.pipeline = pipeline

    const events = await collect(pipeline, 'book it')

    expect(events.some((event) => event.type === 'ask_requested')).toBe(false)
    expect(events).toContainEqual({ type: 'status', status: 'cancelled', at: 0 })
    expect(events.at(-1)).toEqual({ type: 'done', outcome: 'cancelled', at: 0 })
  })

  it('pauses during ask_user speech before any timed answer window is created', async () => {
    const holder: { pipeline?: CommandPipeline } = {}
    let speechCount = 0
    const tts = {
      async speak() {
        speechCount += 1
        if (speechCount === 1) holder.pipeline?.pause()
        return { ok: true as const }
      },
      stop() {},
    }
    const clock = new FakeClock()
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'ask', name: 'ask_user', args: { question: 'Which city?' } }] },
      { kind: 'answer', speak: 'Redirected.', display: 'Used steering.' },
    ])
    const pipeline = createCommandPipeline({ llm, tts, clock, tools: [createAskUserTool()] })
    holder.pipeline = pipeline

    const events = await collect(pipeline, 'book it', (event, activePipeline) => {
      if (event.type === 'status' && event.status === 'paused') {
        clock.advance(24 * 60 * 60 * 1000)
        activePipeline.resume('Use Paris instead.')
      }
    })

    expect(events.some((event) => event.type === 'ask_requested')).toBe(false)
    expect(llm.requests[1]?.steering).toBe('Use Paris instead.')
  })

  it('honours pause and steering that arrive during asynchronous risk assessment', async () => {
    const verdict = deferred<{ kind: 'confirm'; prompt: string }>()
    let riskStarted = false
    let executions = 0
    const tool = {
      name: 'risky_action',
      assessRisk: () => {
        riskStarted = true
        return verdict.promise
      },
      async execute() {
        executions += 1
        return 'executed'
      },
    }
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'risk', name: 'risky_action', args: {} }] },
      { kind: 'answer', speak: 'Redirected.', display: 'Used the correction.' },
    ])
    const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock: new FakeClock(), tools: [tool] })

    const run = collect(pipeline, 'do the risky thing')
    await waitUntil(() => riskStarted)
    pipeline.pause()
    verdict.resolve({ kind: 'confirm', prompt: 'Proceed?' })
    await waitUntil(() => pipeline.getState() === 'paused')
    pipeline.resume('Do not proceed.')
    const events = await run

    expect(executions).toBe(0)
    expect(events.some((event) => event.type === 'confirmation_requested')).toBe(false)
    expect(llm.requests[1]?.steering).toBe('Do not proceed.')
  })

  it('pauses indefinitely and injects steering into the next model call without executing stale tools', async () => {
    const firstTurn = deferred<AssistantTurn>()
    const requests: LlmRequest[] = []
    const llm: LlmClient = {
      async complete(request) {
        requests.push(request)
        if (requests.length === 1) return firstTurn.promise
        return { kind: 'answer', speak: 'Changed course.', display: 'Using the steering.' }
      },
    }
    let executions = 0
    const staleTool = {
      name: 'stale_action',
      async execute() {
        executions += 1
        return 'should not run'
      },
    }
    const clock = new FakeClock()
    const tts = new RecordingTts()
    const pipeline = createCommandPipeline({ llm, tts, clock, tools: [staleTool] })

    const run = collect(pipeline, 'original command')
    await waitUntil(() => requests.length === 1)
    pipeline.pause()
    firstTurn.resolve({ kind: 'tool_calls', calls: [{ id: 'stale', name: 'stale_action', args: {} }] })
    await flush()

    expect(pipeline.getState()).toBe('paused')
    expect(tts.stopCalls).toBe(1)
    clock.advance(24 * 60 * 60 * 1000)
    await flush()
    expect(requests).toHaveLength(1)
    expect(executions).toBe(0)

    pipeline.resume('Use Paris instead.')
    const events = await run

    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual({
      command: 'original command',
      toolResults: [],
      steering: 'Use Paris instead.',
      turnId: expect.any(String),
      // Every round carries its abort signal (#47).
      signal: expect.any(AbortSignal),
    })
    expect(executions).toBe(0)
    expect(events).toContainEqual({ type: 'status', status: 'paused', at: 0 })
    expect(events).toContainEqual({ type: 'display', text: 'Using the steering.', at: 86_400_000 })
  })

  it('resumes without steering and continues the untouched model turn', async () => {
    const firstTurn = deferred<AssistantTurn>()
    const llm = new ScriptedLlm([
      { kind: 'answer', speak: 'Finished.', display: 'Kept going.' },
    ])
    const requests: LlmRequest[] = []
    const client: LlmClient = {
      async complete(request) {
        requests.push(request)
        if (requests.length === 1) return firstTurn.promise
        return llm.complete(request)
      },
    }
    let executions = 0
    const tool = {
      name: 'continue_action',
      async execute() {
        executions += 1
        return 'continued'
      },
    }
    const pipeline = createCommandPipeline({
      llm: client,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [tool],
    })

    const run = collect(pipeline, 'original')
    await waitUntil(() => requests.length === 1)
    pipeline.pause()
    firstTurn.resolve({ kind: 'tool_calls', calls: [{ id: 'one', name: 'continue_action', args: {} }] })
    await waitUntil(() => pipeline.getState() === 'paused')

    pipeline.resume()
    await run

    expect(executions).toBe(1)
    expect(requests[1]).toEqual({
      command: 'original',
      toolResults: [{
        call: { id: 'one', name: 'continue_action', args: {} },
        outcome: { ok: true, result: 'continued' },
      }],
      turnId: expect.any(String),
      signal: expect.any(AbortSignal),
    })
  })

  it('speaks and displays a plain answer, then finishes', async () => {
    const llm = new ScriptedLlm([{ kind: 'answer', speak: 'Done.', display: 'Full detail here.' }])
    const tts = new RecordingTts()
    const clock = new FakeClock(1000)
    const pipeline = createCommandPipeline({ llm, tts, clock, tools: [] })

    const events = await collect(pipeline, 'hello')

    expect(events).toEqual([
      { type: 'command', text: 'hello', at: 1000 },
      { type: 'status', status: 'thinking', at: 1000 },
      { type: 'display', text: 'Full detail here.', at: 1000 },
      { type: 'status', status: 'speaking', at: 1000 },
      { type: 'speak', text: 'Done.', at: 1000 },
      { type: 'done', outcome: 'done', finalizationCause: 'model_answered', at: 1000 },
    ])
    expect(tts.spoken).toEqual(['Done.'])
  })

  it('carries a capped utterance\'s truncation flag to every orchestrator round (#61)', async () => {
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'noop', args: {} }] },
      { kind: 'answer', speak: 'Please finish your request.', display: 'Asked for the rest.' },
    ])
    const noop = { name: 'noop', async execute() { return 'done' } }
    const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock: new FakeClock(), tools: [noop] })

    const events: PipelineEvent[] = []
    for await (const raw of pipeline.execute('and then open the', 'turn-voice-9', true)) events.push(raw)

    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'done' })
    // The flag rides every round of the turn, not just the first.
    expect(llm.requests.map((request) => request.truncated)).toEqual([true, true])
  })

  it('leaves the truncation flag absent on uncapped commands (#61)', async () => {
    const llm = new ScriptedLlm([{ kind: 'answer', speak: 'Done.', display: 'Done.' }])
    const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock: new FakeClock(), tools: [] })

    await collect(pipeline, 'open youtube')

    expect(llm.requests[0].truncated).toBeUndefined()
  })

  it('emits an error event and speaks a one-liner when the LLM fails', async () => {
    const llm = new ScriptedLlm([])
    const tts = new RecordingTts()
    const pipeline = createCommandPipeline({ llm, tts, clock: new FakeClock(), tools: [] })

    const events = await collect(pipeline, 'hello')

    expect(events.map((e) => e.type)).toEqual(['command', 'status', 'error', 'status', 'speak', 'done'])
    const error = events.find((e) => e.type === 'error')
    expect(error).toMatchObject({ type: 'error', message: 'ScriptedLlm ran out of scripted turns' })
    expect(events.find((e) => e.type === 'speak')).toMatchObject({
      type: 'speak',
      text: 'Something went wrong: ScriptedLlm ran out of scripted turns',
    })
    expect(tts.spoken).toEqual(['Something went wrong: ScriptedLlm ran out of scripted turns'])
  })

  it('degrades to display-only with a one-liner when TTS fails', async () => {
    const llm = new ScriptedLlm([{ kind: 'answer', speak: 'Done.', display: 'Full detail here.' }])
    const pipeline = createCommandPipeline({
      llm,
      tts: new FailingTts('piper binary not found'),
      clock: new FakeClock(1000),
      tools: [],
    })

    const events = await collect(pipeline, 'hello')

    expect(events).toContainEqual({ type: 'display', text: 'Full detail here.', at: 1000 })
    expect(events).toContainEqual({ type: 'speak', text: 'Done.', at: 1000 })
    expect(events).toContainEqual({
      type: 'error',
      message: 'Something went wrong: piper binary not found',
      at: 1000,
    })
    expect(events.at(-1)).toMatchObject({ type: 'done' })
  })

  it('executes requested tools, feeds results back to the LLM, then answers', async () => {
    const clock = new FakeClock(0)
    const echo = {
      name: 'echo',
      async execute(call: { args: Record<string, unknown> }) {
        return `echo:${String(call.args.text)}`
      },
    }
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'echo', args: { text: 'hi' } }] },
      { kind: 'answer', speak: 'Echoed.', display: 'Detail.' },
    ])
    const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock, tools: [echo] })

    const events = await collect(pipeline, 'say hi')

    expect(events.map((e) => e.type)).toEqual([
      'command',
      'status',
      'status',
      'tool_call',
      'tool_result',
      'status',
      'display',
      'status',
      'speak',
      'done',
    ])
    const statuses = events.filter((e) => e.type === 'status').map((e) => e.status)
    expect(statuses).toEqual(['thinking', 'acting', 'thinking', 'speaking'])
    expect(events).toContainEqual({
      type: 'tool_call',
      callId: 'c1',
      name: 'echo',
      args: { text: 'hi' },
      at: 0,
    })
    expect(events).toContainEqual({ type: 'tool_result', callId: 'c1', name: 'echo', ok: true, result: 'echo:hi', at: 0 })
    expect(llm.requests[1]?.toolResults).toEqual([
      {
        call: { id: 'c1', name: 'echo', args: { text: 'hi' } },
        outcome: { ok: true, result: 'echo:hi' },
      },
    ])
  })

  it('reports an unknown tool as a failed result the LLM can see', async () => {
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'nope', args: {} }] },
      { kind: 'answer', speak: 'Recovered.', display: 'Detail.' },
    ])
    const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock: new FakeClock(), tools: [] })

    const events = await collect(pipeline, 'do the thing')

    const result = events.find((e) => e.type === 'tool_result')
    expect(result).toMatchObject({ type: 'tool_result', callId: 'c1', name: 'nope', ok: false, error: "unknown tool: 'nope'" })
    expect(events.at(-1)).toMatchObject({ type: 'done' })
  })

  it('reports a throwing tool as a failed result instead of failing the run', async () => {
    const boom = {
      name: 'boom',
      async execute() {
        throw new Error('kaboom')
      },
    }
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'boom', args: {} }] },
      { kind: 'answer', speak: 'Recovered.', display: 'Detail.' },
    ])
    const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock: new FakeClock(), tools: [boom] })

    const events = await collect(pipeline, 'go boom')

    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({
      type: 'tool_result',
      ok: false,
      error: 'kaboom',
    })
    expect(events.at(-1)).toMatchObject({ type: 'done' })
  })

  describe('Run Plan and Effort Tier (#116, ADR 0025/0027)', () => {
    const noop: Tool = {
      name: 'noop',
      async execute() {
        return 'ok'
      },
    }

    const plan = (
      id: string,
      objective: string,
      headline: string,
      effortTier: 'direct_action' | 'lookup' | 'investigation',
      escalationReason?: string,
    ): ToolCall => ({
      id,
      name: 'report_run_plan',
      args: {
        objective,
        headline,
        effort_tier: effortTier,
        ...(escalationReason ? { escalation_reason: escalationReason } : {}),
      },
    })

    it('accepts a Run Plan alongside the first useful Tool Round, ahead of its work', async () => {
      const llm = new ScriptedLlm([
        {
          kind: 'tool_calls',
          calls: [
            plan('p1', 'Find a blue mug under $20', 'Find a blue mug under $20', 'lookup'),
            // A duplicate report in the same round is idempotent
            // bookkeeping — acknowledged, never executed.
            plan('p1b', 'Find a blue mug under $20', 'Find a blue mug under $20', 'lookup'),
            { id: 'c1', name: 'noop', args: {} },
          ],
        },
        { kind: 'answer', speak: 'Found one.', display: 'Found a blue mug.' },
      ])
      const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock: new FakeClock(), tools: [createReportRunPlanTool(), noop] })

      const events = await collect(pipeline, 'find a blue mug')

      expect(events).toContainEqual({
        type: 'run_plan',
        objective: 'Find a blue mug under $20',
        headline: 'Find a blue mug under $20',
        effortTier: 'lookup',
        source: 'model',
        at: 0,
      })
      expect(events.find((event) => event.type === 'tool_result' && event.callId === 'p1b')).toMatchObject({
        ok: true,
        result: 'Run Plan noted.',
      })
      const headlineAt = events.findIndex((event) => event.type === 'run_headline' && event.text === 'Find a blue mug under $20')
      const workAt = events.findIndex((event) => event.type === 'tool_call' && event.name === 'noop')
      expect(headlineAt).toBeGreaterThanOrEqual(0)
      expect(workAt).toBeGreaterThan(headlineAt)
    })

    it('updates the headline at the same tier and gates escalation — one level, with a reason', async () => {
      const llm = new ScriptedLlm([
        { kind: 'tool_calls', calls: [plan('p1', 'Find a blue mug', 'Find a blue mug under $20', 'direct_action'), { id: 'c1', name: 'noop', args: {} }] },
        { kind: 'tool_calls', calls: [plan('p2', 'Find a blue mug', 'Compare every blue mug', 'investigation'), { id: 'c2', name: 'noop', args: {} }] },
        { kind: 'tool_calls', calls: [plan('p3', 'Find a blue mug', 'Find a blue mug under $10', 'lookup'), { id: 'c3', name: 'noop', args: {} }] },
        { kind: 'tool_calls', calls: [plan('p4', 'Find a blue mug', 'Compare blue mug prices', 'lookup', 'The first store had none in stock.'), { id: 'c4', name: 'noop', args: {} }] },
        { kind: 'answer', speak: 'Found one.', display: 'Found a cheaper blue mug.' },
      ])
      const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock: new FakeClock(), tools: [createReportRunPlanTool(), noop] })

      const events = await collect(pipeline, 'find a blue mug')

      const plans = events.filter((event) => event.type === 'run_plan')
      expect(plans.map((event) => (event as { effortTier: string }).effortTier)).toEqual(['direct_action', 'lookup'])
      expect(plans.at(-1)).toMatchObject({ escalationReason: 'The first store had none in stock.' })
      const headlines = events.filter((event) => event.type === 'run_headline').map((event) => (event as { text: string }).text)
      expect(headlines).toEqual(['Find a blue mug under $20', 'Compare blue mug prices'])
      // The two-level jump and the reasonless escalation were refused — the
      // useful sibling work of those rounds still ran.
      expect(events.find((event) => event.type === 'tool_result' && event.callId === 'p2')).toMatchObject({
        ok: false,
        error: expect.stringMatching(/one level/i),
      })
      expect(events.find((event) => event.type === 'tool_result' && event.callId === 'p3')).toMatchObject({
        ok: false,
        error: expect.stringMatching(/escalation_reason/i),
      })
      expect(events.filter((event) => event.type === 'tool_result' && event.name === 'noop' && event.ok)).toHaveLength(4)
    })

    it('defaults a missing first plan to Lookup, retains the Command Echo, nudges once, and runs useful work', async () => {
      const llm = new ScriptedLlm([
        { kind: 'tool_calls', calls: [{ id: 'c1', name: 'noop', args: {} }] },
        { kind: 'tool_calls', calls: [{ id: 'c2', name: 'noop', args: {} }] },
        { kind: 'answer', speak: 'Done.', display: 'Done.' },
      ])
      const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock: new FakeClock(), tools: [createReportRunPlanTool(), noop] })

      const events = await collect(pipeline, 'do the thing')

      expect(events).toContainEqual({
        type: 'run_plan',
        objective: 'do the thing',
        headline: null,
        effortTier: 'lookup',
        source: 'fallback',
        at: 0,
      })
      expect(events.filter((event) => event.type === 'run_headline')).toEqual([])
      // Exactly one corrective nudge rides a useful result; the second
      // plan-less round stays clean.
      expect(
        events.filter((event) => event.type === 'tool_result' && typeof event.result === 'string' && event.result.includes('report_run_plan')),
      ).toHaveLength(1)
      expect(events.filter((event) => event.type === 'tool_result' && event.name === 'noop' && event.ok)).toHaveLength(2)
    })

    it('degrades a malformed plan without stalling, and the next valid report establishes the plan', async () => {
      const llm = new ScriptedLlm([
        {
          kind: 'tool_calls',
          calls: [
            { id: 'p1', name: 'report_run_plan', args: { objective: '', headline: 42, effort_tier: 'huge' } },
            { id: 'p1b', name: 'report_run_plan', args: { objective: '', headline: 42, effort_tier: 'huge' } },
            { id: 'c1', name: 'noop', args: {} },
          ],
        },
        { kind: 'tool_calls', calls: [plan('p2', 'Do the thing', 'Do the thing', 'direct_action'), { id: 'c2', name: 'noop', args: {} }] },
        { kind: 'answer', speak: 'Done.', display: 'Done.' },
      ])
      const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock: new FakeClock(), tools: [createReportRunPlanTool(), noop] })

      const events = await collect(pipeline, 'do the thing')

      // The malformed round fell back to Lookup and its plan calls answered
      // with the corrective notice; the sibling work ran.
      expect(events.filter((event) => event.type === 'tool_result' && event.name === 'noop' && event.ok)).toHaveLength(2)
      expect(events.find((event) => event.type === 'tool_result' && event.callId === 'p1')).toMatchObject({
        ok: false,
        error: expect.stringMatching(/report_run_plan/),
      })
      expect(events.find((event) => event.type === 'tool_result' && event.callId === 'p1b')).toMatchObject({
        ok: false,
        error: expect.stringMatching(/report_run_plan/),
      })
      // The later valid report is an initial plan — the fallback constrains
      // nothing, so the smaller tier is accepted.
      expect(events.filter((event) => event.type === 'run_plan').map((event) => (event as { effortTier: string }).effortTier)).toEqual([
        'lookup',
        'direct_action',
      ])
      expect(events.find((event) => event.type === 'run_headline')).toMatchObject({ text: 'Do the thing' })
    })

    it('keeps the corrective nudge owed until a useful result can carry it', async () => {
      const boom: Tool = {
        name: 'boom',
        async execute() {
          throw new Error('kaboom')
        },
      }
      const llm = new ScriptedLlm([
        { kind: 'tool_calls', calls: [{ id: 'b1', name: 'boom', args: {} }] },
        { kind: 'tool_calls', calls: [{ id: 'c1', name: 'noop', args: {} }] },
        { kind: 'answer', speak: 'Done.', display: 'Done.' },
      ])
      const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock: new FakeClock(), tools: [createReportRunPlanTool(), boom, noop] })

      const events = await collect(pipeline, 'do the thing')

      // Round 1's failing sibling could not carry the nudge — round 2's
      // useful result delivers it, once.
      const nudged = events.filter(
        (event) => event.type === 'tool_result' && typeof event.result === 'string' && event.result.includes('report_run_plan'),
      )
      expect(nudged).toHaveLength(1)
      expect(nudged[0]).toMatchObject({ callId: 'c1' })
    })

    it('reopens the initial-plan slot after a steering directive — a fresh plan may redeclare its tier', async () => {
      const secondTurn = deferred<AssistantTurn>()
      const requests: LlmRequest[] = []
      const llm: LlmClient = {
        async complete(request) {
          requests.push(request)
          if (requests.length === 1) {
            return {
              kind: 'tool_calls',
              calls: [plan('p1', 'Find a mug', 'Find a mug', 'lookup'), { id: 'c1', name: 'noop', args: {} }],
            }
          }
          if (requests.length === 2) return secondTurn.promise
          if (requests.length === 3) {
            return {
              kind: 'tool_calls',
              calls: [plan('p2', 'Find a red mug', 'Find a red mug', 'direct_action'), { id: 'c2', name: 'noop', args: {} }],
            }
          }
          return { kind: 'answer', speak: 'Found a red one.', display: 'Found a red mug.' }
        },
      }
      const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock: new FakeClock(), tools: [createReportRunPlanTool(), noop] })

      const run = collect(pipeline, 'find a mug')
      // Round 1 establishes the lookup plan; steering lands while round 2's
      // model call is in flight, so round 2's stale work is discarded.
      // Round 1 emits several events, so the poll needs a longer leash than
      // the shared waitUntil.
      for (let attempt = 0; attempt < 200 && requests.length < 2; attempt += 1) await flush()
      expect(requests.length).toBeGreaterThanOrEqual(2)
      pipeline.pause()
      secondTurn.resolve({ kind: 'tool_calls', calls: [{ id: 'stale', name: 'noop', args: {} }] })
      await waitUntil(() => pipeline.getState() === 'paused')
      pipeline.resume('Find a red mug instead.')

      const events = await run

      expect(requests[2]?.steering).toBe('Find a red mug instead.')
      // The corrected objective's report is a fresh initial plan — the
      // smaller tier is accepted where a mid-run downgrade would be refused.
      expect(events.filter((event) => event.type === 'run_plan').map((event) => (event as { effortTier: string }).effortTier)).toEqual([
        'lookup',
        'direct_action',
      ])
      expect(events.filter((event) => event.type === 'run_headline').map((event) => (event as { text: string }).text)).toEqual([
        'Find a mug',
        'Find a red mug',
      ])
      expect(events.some((event) => event.type === 'tool_result' && event.name === 'report_run_plan' && !event.ok)).toBe(false)
    })
  })

  describe('risk gate', () => {
    const riskyTool = {
      name: 'submit_form',
      assessRisk: (call: { args: Record<string, unknown> }) => ({
        kind: 'confirm' as const,
        prompt: `Submit the form to ${String(call.args.url)}?`,
      }),
      async execute() {
        return 'submitted'
      },
    }

    function confirmWhenAsked(approved: boolean) {
      return (event: PipelineEvent, pipeline: CommandPipeline) => {
        if (event.type === 'confirmation_requested') {
          pipeline.resolveConfirmation(event.confirmationId, approved)
        }
      }
    }

    it('runs a risky tool only after the user approves', async () => {
      const llm = new ScriptedLlm([
        { kind: 'tool_calls', calls: [{ id: 'c1', name: 'submit_form', args: { url: 'x.test' } }] },
        { kind: 'answer', speak: 'Submitted.', display: 'Detail.' },
      ])
      const tts = new RecordingTts()
      const pipeline = createCommandPipeline({
        llm,
        tts,
        clock: new FakeClock(),
        tools: [riskyTool],
      })

      const events = await collect(pipeline, 'submit it', confirmWhenAsked(true))

      expect(events).toContainEqual({
        type: 'confirmation_requested',
        confirmationId: 'confirm-1',
        callId: 'c1',
        toolName: 'submit_form',
        prompt: 'Submit the form to x.test?',
        expiresAt: 60_000,
        at: 0,
      })
      expect(events).toContainEqual({ type: 'speak', text: 'Submit the form to x.test?', at: 0 })
      expect(tts.spoken).toContain('Submit the form to x.test?')
      expect(events).toContainEqual({ type: 'confirmation_resolved', confirmationId: 'confirm-1', approved: true, reason: 'user', at: 0 })
      expect(events).toContainEqual({ type: 'tool_result', callId: 'c1', name: 'submit_form', ok: true, result: 'submitted', at: 0 })
      expect(events.at(-1)).toMatchObject({ type: 'done' })
    })

    it('skips the tool and reports denial when the user refuses', async () => {
      const llm = new ScriptedLlm([
        { kind: 'tool_calls', calls: [{ id: 'c1', name: 'submit_form', args: { url: 'x.test' } }] },
        { kind: 'answer', speak: 'Not submitted.', display: 'Detail.' },
      ])
      const pipeline = createCommandPipeline({
        llm,
        tts: new RecordingTts(),
        clock: new FakeClock(),
        tools: [riskyTool],
      })

      const events = await collect(pipeline, 'submit it', confirmWhenAsked(false))

      expect(events).toContainEqual({ type: 'confirmation_resolved', confirmationId: 'confirm-1', approved: false, reason: 'user', at: 0 })
      expect(events).toContainEqual({ type: 'tool_result', callId: 'c1', name: 'submit_form', ok: false, error: 'denied by the user; do not retry this action', at: 0 })
    })

    it('auto-denies via the clock when no answer arrives before the timeout', async () => {
      const clock = new FakeClock(0)
      const llm = new ScriptedLlm([
        { kind: 'tool_calls', calls: [{ id: 'c1', name: 'submit_form', args: { url: 'x.test' } }] },
        { kind: 'answer', speak: 'Not submitted.', display: 'Detail.' },
      ])
      const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock, tools: [riskyTool] })

      const events = await collect(pipeline, 'submit it', (event) => {
        if (event.type === 'confirmation_requested') clock.advance(60_000)
      })

      expect(events).toContainEqual({
        type: 'confirmation_resolved',
        confirmationId: 'confirm-1',
        approved: false,
        reason: 'timeout',
        at: 60_000,
      })
      expect(events).toContainEqual({ type: 'tool_result', callId: 'c1', name: 'submit_form', ok: false, error: 'denied — the user did not respond in time; do not retry this action', at: 60_000 })
      expect(events.at(-1)).toMatchObject({ type: 'done' })
    })

    it('suspends the confirmation timeout while paused and resumes the untouched decision', async () => {
      const clock = new FakeClock()
      let executions = 0
      const tool = {
        ...riskyTool,
        async execute() {
          executions += 1
          return 'submitted'
        },
      }
      const llm = new ScriptedLlm([
        { kind: 'tool_calls', calls: [{ id: 'c1', name: 'submit_form', args: { url: 'x.test' } }] },
        { kind: 'answer', speak: 'Submitted.', display: 'Submitted.' },
      ])
      const tts = new RecordingTts()
      const pipeline = createCommandPipeline({ llm, tts, clock, tools: [tool] })
      let spokenWhilePaused: string[] = []

      const events = await collect(pipeline, 'submit it', (event, activePipeline) => {
        if (event.type === 'confirmation_requested') activePipeline.pause()
        if (event.type === 'status' && event.status === 'paused') {
          spokenWhilePaused = [...tts.spoken]
          clock.advance(60_000)
          activePipeline.resume()
        }
        if (event.type === 'confirmation_deadline' && event.expiresAt !== null) {
          activePipeline.resolveConfirmation(event.confirmationId, true)
        }
      })

      expect(executions).toBe(1)
      expect(spokenWhilePaused).toEqual([])
      expect(events).toContainEqual({
        type: 'confirmation_deadline',
        confirmationId: 'confirm-1',
        expiresAt: null,
        at: 0,
      })
      expect(events).toContainEqual({
        type: 'confirmation_deadline',
        confirmationId: 'confirm-1',
        expiresAt: 120_000,
        at: 60_000,
      })
      expect(events).toContainEqual({
        type: 'confirmation_resolved',
        confirmationId: 'confirm-1',
        approved: true,
        reason: 'user',
        at: 60_000,
      })
    })

    it('announces the countdown deadline on the request so the dashboard can tick', async () => {
      const clock = new FakeClock(1_000)
      const llm = new ScriptedLlm([
        { kind: 'tool_calls', calls: [{ id: 'c1', name: 'submit_form', args: { url: 'x.test' } }] },
        { kind: 'answer', speak: 'Submitted.', display: 'Detail.' },
      ])
      const pipeline = createCommandPipeline({
        llm,
        tts: new RecordingTts(),
        clock,
        tools: [riskyTool],
        confirmTimeoutMs: 15_000,
      })

      const events = await collect(pipeline, 'submit it', confirmWhenAsked(true))

      expect(events).toContainEqual({
        type: 'confirmation_requested',
        confirmationId: 'confirm-1',
        callId: 'c1',
        toolName: 'submit_form',
        prompt: 'Submit the form to x.test?',
        expiresAt: 16_000,
        at: 1_000,
      })
    })

    it('never executes a denied call, not even after approval would arrive', async () => {
      let executions = 0
      const paymentTool = {
        name: 'pay',
        assessRisk: () => ({ kind: 'deny' as const, reason: 'payments are never submitted by the agent' }),
        async execute() {
          executions += 1
          return 'paid'
        },
      }
      const llm = new ScriptedLlm([
        { kind: 'tool_calls', calls: [{ id: 'c1', name: 'pay', args: {} }] },
        { kind: 'answer', speak: 'I cannot do that.', display: 'Detail.' },
      ])
      const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock: new FakeClock(), tools: [paymentTool] })

      const events = await collect(pipeline, 'pay for it')

      expect(executions).toBe(0)
      expect(events.some((e) => e.type === 'confirmation_requested')).toBe(false)
      expect(events).toContainEqual({
        type: 'tool_result',
        callId: 'c1',
        name: 'pay',
        ok: false,
        error: 'payments are never submitted by the agent',
        at: 0,
      })
    })

    it('fails closed to a confirmation when the assessment itself throws', async () => {
      const flakyTool = {
        name: 'flaky',
        assessRisk: () => {
          throw new Error('page changed under assessment')
        },
        async execute() {
          return 'ran'
        },
      }
      const llm = new ScriptedLlm([
        { kind: 'tool_calls', calls: [{ id: 'c1', name: 'flaky', args: {} }] },
        { kind: 'answer', speak: 'Ran.', display: 'Detail.' },
      ])
      const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock: new FakeClock(), tools: [flakyTool] })

      const events = await collect(pipeline, 'run it', confirmWhenAsked(true))

      expect(events).toContainEqual({
        type: 'confirmation_requested',
        confirmationId: 'confirm-1',
        callId: 'c1',
        toolName: 'flaky',
        prompt: 'Run flaky?',
        expiresAt: 60_000,
        at: 0,
      })
      expect(events).toContainEqual({ type: 'tool_result', callId: 'c1', name: 'flaky', ok: true, result: 'ran', at: 0 })
    })
  })

  describe('ask_user', () => {
    it('shows and speaks the question, then returns the typed answer to the model', async () => {
      const llm = new ScriptedLlm([
        { kind: 'tool_calls', calls: [{ id: 'a1', name: 'ask_user', args: { question: 'Which city do you mean?' } }] },
        { kind: 'answer', speak: 'Booking Paris.', display: 'Detail.' },
      ])
      const tts = new RecordingTts()
      const pipeline = createCommandPipeline({ llm, tts, clock: new FakeClock(), tools: [createAskUserTool()] })

      const events = await collect(pipeline, 'book a hotel', (event, pipe) => {
        if (event.type === 'ask_requested') pipe.resolveAsk(event.askId, 'Paris, France')
      })

      expect(events).toContainEqual({
        type: 'ask_requested',
        askId: 'ask-1',
        callId: 'a1',
        question: 'Which city do you mean?',
        expiresAt: 45_000,
        at: 0,
      })
      expect(events).toContainEqual({ type: 'speak', text: 'Which city do you mean?', at: 0 })
      expect(tts.spoken[0]).toBe('Which city do you mean?')
      expect(events).toContainEqual({ type: 'ask_resolved', askId: 'ask-1', answer: 'Paris, France', reason: 'user', at: 0 })
      expect(events).toContainEqual({
        type: 'tool_result',
        callId: 'a1',
        name: 'ask_user',
        ok: true,
        result: 'Paris, France',
        at: 0,
      })
      expect(llm.requests[1]?.toolResults[0]?.outcome).toEqual({ ok: true, result: 'Paris, France' })
      expect(events.at(-1)).toMatchObject({ type: 'done' })
    })

    it('starts the full answer timeout only after the spoken question finishes', async () => {
      const clock = new FakeClock(1_000)
      const tts = {
        async speak() {
          clock.advance(2_500)
          return { ok: true as const }
        },
        stop() {},
      }
      const llm = new ScriptedLlm([
        { kind: 'tool_calls', calls: [{ id: 'a1', name: 'ask_user', args: { question: 'Which city?' } }] },
        { kind: 'answer', speak: 'Using Paris.', display: 'Detail.' },
      ])
      const pipeline = createCommandPipeline({ llm, tts, clock, tools: [createAskUserTool()] })

      const events = await collect(pipeline, 'book a hotel', (event, pipe) => {
        if (event.type === 'ask_requested') pipe.resolveAsk(event.askId, 'Paris')
      })

      expect(events).toContainEqual({
        type: 'ask_requested',
        askId: 'ask-1',
        callId: 'a1',
        question: 'Which city?',
        expiresAt: 48_500,
        at: 3_500,
      })
    })

    it('returns "user didn\'t answer" to the model when nothing arrives before the timeout', async () => {
      const clock = new FakeClock(0)
      const llm = new ScriptedLlm([
        { kind: 'tool_calls', calls: [{ id: 'a1', name: 'ask_user', args: { question: 'Which city?' } }] },
        { kind: 'answer', speak: 'Proceeding without it.', display: 'Detail.' },
      ])
      const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock, tools: [createAskUserTool()] })

      const events = await collect(pipeline, 'book a hotel', (event) => {
        if (event.type === 'ask_requested') clock.advance(45_000)
      })

      expect(events).toContainEqual({ type: 'ask_resolved', askId: 'ask-1', answer: null, reason: 'timeout', at: 45_000 })
      expect(events).toContainEqual({
        type: 'tool_result',
        callId: 'a1',
        name: 'ask_user',
        ok: true,
        result: "user didn't answer",
        at: 45_000,
      })
    })

    it('honors a custom ask timeout for the countdown deadline', async () => {
      const clock = new FakeClock(1_000)
      const llm = new ScriptedLlm([
        { kind: 'tool_calls', calls: [{ id: 'a1', name: 'ask_user', args: { question: 'Which?' } }] },
        { kind: 'answer', speak: 'Ok.', display: 'Detail.' },
      ])
      const pipeline = createCommandPipeline({
        llm,
        tts: new RecordingTts(),
        clock,
        tools: [createAskUserTool()],
        askTimeoutMs: 20_000,
      })

      const events = await collect(pipeline, 'go', (event, pipe) => {
        if (event.type === 'ask_requested') pipe.resolveAsk(event.askId, 'this')
      })

      expect(events).toContainEqual({
        type: 'ask_requested',
        askId: 'ask-1',
        callId: 'a1',
        question: 'Which?',
        expiresAt: 21_000,
        at: 1_000,
      })
    })

    it('keeps waiting when an empty answer arrives', async () => {
      const clock = new FakeClock(0)
      const llm = new ScriptedLlm([
        { kind: 'tool_calls', calls: [{ id: 'a1', name: 'ask_user', args: { question: 'Which?' } }] },
        { kind: 'answer', speak: 'Ok.', display: 'Detail.' },
      ])
      const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock, tools: [createAskUserTool()] })

      const events = await collect(pipeline, 'go', (event, pipe) => {
        if (event.type === 'ask_requested') {
          pipe.resolveAsk(event.askId, '   ')
          clock.advance(45_000)
        }
      })

      expect(events).toContainEqual({ type: 'ask_resolved', askId: 'ask-1', answer: null, reason: 'timeout', at: 45_000 })
    })

    it('reports a missing question as a failed tool result', async () => {
      const llm = new ScriptedLlm([
        { kind: 'tool_calls', calls: [{ id: 'a1', name: 'ask_user', args: {} }] },
        { kind: 'answer', speak: 'Recovered.', display: 'Detail.' },
      ])
      const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock: new FakeClock(), tools: [createAskUserTool()] })

      const events = await collect(pipeline, 'go')

      expect(events.find((e) => e.type === 'tool_result')).toMatchObject({
        type: 'tool_result',
        callId: 'a1',
        name: 'ask_user',
        ok: false,
        error: "ask_user: 'question' must be a non-empty string",
      })
    })
  })

  it('finalizes with a deterministic Answer when the LLM exceeds the hard tool-round ceiling (#117/#118)', async () => {
    let executions = 0
    const spinner = {
      name: 'spin',
      acquisition: true,
      async execute() {
        executions += 1
        return 'spun'
      },
    }
    // Round 1 spends the ceiling; round 2 is Finalization's preserved
    // bookkeeping round (acquisition refused); round 3's tool request is
    // the reserved Answer round misbehaving — the run answers
    // deterministically.
    const endlessToolCalls = Array.from({ length: 5 }, (_, i) => ({
      kind: 'tool_calls' as const,
      calls: [{ id: `c${i}`, name: 'spin', args: {} }],
    }))
    const llm = new ScriptedLlm(endlessToolCalls)
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [spinner],
      maxToolRounds: 2,
    })

    const events = await collect(pipeline, 'keep going')

    // The ceiling preserved its one bookkeeping round: acquisition ran
    // once, was refused inside the ceiling's second round, and the
    // misbehaving reserved Answer never executed a tool.
    expect(executions).toBe(1)
    expect(events.filter((e) => e.type === 'tool_result' && e.name === 'spin')).toHaveLength(2)
    expect(events.find((e) => e.type === 'tool_result' && e.callId === 'c1')).toMatchObject({
      ok: false,
      error: expect.stringMatching(/work budget is exhausted/),
    })
    expect(llm.requests).toHaveLength(3)
    // No raw round-limit error: the guaranteed Answer replaces it.
    expect(events.find((e) => e.type === 'error')).toBeUndefined()
    expect(events).toContainEqual({
      type: 'display',
      text: 'I could not finish \u201Ckeep going\u201D. The run reached its hard work limit.',
      at: 0,
    })
    expect(events.find((e) => e.type === 'speak')).toMatchObject({
      type: 'speak',
      text: 'I had to stop before finishing that request.',
    })
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'failed', finalizationCause: 'hard_limit' })
  })

  describe('bounded Direct Actions (#117, ADR 0027)', () => {
    const directPlan = (id: string, headline = 'Do the thing'): ToolCall => ({
      id,
      name: 'report_run_plan',
      args: { objective: 'Do the thing', headline, effort_tier: 'direct_action' },
    })

    const work: Tool = {
      name: 'work',
      acquisition: true,
      async execute() {
        return 'worked'
      },
    }

    const workRound = (i: number, withPlan = false) => ({
      kind: 'tool_calls' as const,
      calls: [
        ...(withPlan ? [directPlan(`p${i}`)] : []),
        { id: `w${i}`, name: 'work', args: {} },
      ],
    })

    it('counts one model response with sibling calls as one Tool Round', async () => {
      const llm = new ScriptedLlm([
        {
          kind: 'tool_calls',
          calls: [
            directPlan('p1'),
            { id: 'w1', name: 'work', args: {} },
            { id: 'w2', name: 'work', args: {} },
            { id: 'w3', name: 'work', args: {} },
          ],
        },
        { kind: 'answer', speak: 'Done.', display: 'Detail.' },
      ])
      const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock: new FakeClock(), tools: [createReportRunPlanTool(), work] })

      const events = await collect(pipeline, 'do the thing')

      // Three sibling executions, two model rounds — and no budget warning
      // yet: one round of six spent is far from the milestones.
      expect(llm.requests).toHaveLength(2)
      expect(events.filter((e) => e.type === 'tool_result' && e.name === 'work' && e.ok)).toHaveLength(3)
      expect(llm.requests[1].toolResults).toHaveLength(4) // the plan ack + three siblings
      expect(JSON.stringify(llm.requests[1].toolResults)).not.toMatch(/Work budget:/)
      expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'done', finalizationCause: 'model_answered' })
    })

    it('warns internally near 75% and 90% of the budget without user-facing counters', async () => {
      const llm = new ScriptedLlm([
        ...Array.from({ length: 6 }, (_, i) => workRound(i, i === 0)),
        // Round 7 is Finalization's one bookkeeping round: acquisition is closed.
        { kind: 'tool_calls', calls: [{ id: 'w6', name: 'work', args: {} }] },
        // Round 8 is the reserved Answer-only round.
        { kind: 'answer', speak: 'Partial.', display: 'Partial detail.', resolution: 'partial' },
      ])
      const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock: new FakeClock(), tools: [createReportRunPlanTool(), work] })

      const events = await collect(pipeline, 'do the thing')

      // Rounds 4 and 5 crossed the ~75% and ~90% milestones; each warning
      // rides its crossing round's own result — exactly two, model-facing
      // (the event stream emits each once; later requests re-carry them).
      const warned = events.filter(
        (e) => e.type === 'tool_result' && e.ok && typeof e.result === 'string' && /Work budget: .*tool rounds? remain/.test(e.result),
      )
      expect(warned).toHaveLength(2)
      expect(warned[0]).toMatchObject({ result: expect.stringContaining('2 of 6 tool rounds remain') })
      expect(warned[1]).toMatchObject({ result: expect.stringContaining('1 of 6 tool round remains') })
      expect(llm.requests[4].toolResults.some((r) => r.outcome.ok && typeof r.outcome.result === 'string' && r.outcome.result.includes('2 of 6 tool rounds remain'))).toBe(true)
      // Six Tool Rounds of acquisition ran; the seventh round's call was refused.
      expect(events.filter((e) => e.type === 'tool_result' && e.name === 'work' && e.ok)).toHaveLength(6)
      expect(events.find((e) => e.type === 'tool_result' && e.callId === 'w6')).toMatchObject({
        ok: false,
        error: expect.stringMatching(/work budget is exhausted/),
      })
      // The counters stay internal: no user-facing surface carries them.
      for (const event of events) {
        if (event.type === 'speak' || event.type === 'display') {
          expect(event.text).not.toMatch(/tool rounds? remain/)
        }
      }
      expect(events.at(-1)).toEqual({
        type: 'done',
        outcome: 'done',
        resolution: 'partial',
        finalizationCause: 'budget_exhausted',
        at: 0,
      })
    })

    it('finalizes with one bookkeeping round: acquisition and ask_user closed, plan bookkeeping open, then an Answer-only round', async () => {
      const llm = new ScriptedLlm([
        ...Array.from({ length: 6 }, (_, i) => workRound(i, i === 0)),
        {
          kind: 'tool_calls',
          calls: [
            { id: 'w6', name: 'work', args: {} },
            { id: 'ask', name: 'ask_user', args: { question: 'Which one?' } },
            directPlan('p7', 'Wrapping up'),
          ],
        },
        { kind: 'answer', speak: 'Stopped early.', display: 'Could not finish.', resolution: 'unsuccessful' },
      ])
      const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock: new FakeClock(), tools: [createReportRunPlanTool(), createAskUserTool(), work] })

      const events = await collect(pipeline, 'do the thing')

      // Acquisition and ask_user never ran; no ask window ever opened.
      expect(events.filter((e) => e.type === 'tool_result' && e.name === 'work' && e.ok)).toHaveLength(6)
      expect(events.some((e) => e.type === 'ask_requested')).toBe(false)
      expect(events.find((e) => e.type === 'tool_result' && e.callId === 'w6')).toMatchObject({
        ok: false,
        error: expect.stringMatching(/ask_user/),
      })
      expect(events.find((e) => e.type === 'tool_result' && e.callId === 'ask')).toMatchObject({
        ok: false,
        error: expect.stringMatching(/ask_user/),
      })
      // The plan bookkeeping call ran and its acknowledgement carries the
      // finalize directive; the headline revision landed.
      expect(events.find((e) => e.type === 'tool_result' && e.callId === 'p7')).toMatchObject({
        ok: true,
        result: expect.stringMatching(/Run Plan noted\.[\s\S]*final answer JSON/),
      })
      expect(events).toContainEqual({ type: 'run_headline', text: 'Wrapping up', at: 0 })
      // The reserved Answer-only round followed and concluded the run.
      expect(llm.requests).toHaveLength(8)
      expect(events.at(-1)).toEqual({
        type: 'done',
        outcome: 'done',
        resolution: 'unsuccessful',
        finalizationCause: 'budget_exhausted',
        at: 0,
      })
    })

    it('answers deterministically with a failed outcome when the reserved Answer requests tools', async () => {
      const llm = new ScriptedLlm([
        ...Array.from({ length: 6 }, (_, i) => workRound(i, i === 0)),
        { kind: 'tool_calls', calls: [{ id: 'w6', name: 'work', args: {} }] },
        // The reserved Answer round misbehaves: it asks for tools again.
        { kind: 'tool_calls', calls: [{ id: 'w7', name: 'work', args: {} }] },
      ])
      const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock: new FakeClock(), tools: [createReportRunPlanTool(), work] })

      const events = await collect(pipeline, 'do the thing')

      // The second bookkeeping round never executed its calls, and no raw
      // error surfaces — the deterministic Answer replaces it.
      expect(llm.requests).toHaveLength(8)
      expect(events.filter((e) => e.type === 'tool_result' && e.name === 'work')).toHaveLength(7)
      expect(events.find((e) => e.type === 'tool_result' && e.callId === 'w7')).toBeUndefined()
      expect(events.find((e) => e.type === 'error')).toBeUndefined()
      expect(events).toContainEqual({
        type: 'display',
        text: 'I could not finish \u201Cdo the thing\u201D. The run exhausted its planned work budget.',
        at: 0,
      })
      expect(events.find((e) => e.type === 'speak' && e.text !== 'Partial.')).toMatchObject({
        type: 'speak',
        text: 'I ran out of work budget before finishing that request.',
      })
      expect(events.at(-1)).toEqual({ type: 'done', outcome: 'failed', finalizationCause: 'budget_exhausted', at: 0 })
    })

    it('answers deterministically when the reserved Answer round itself fails', async () => {
      // The script ends after the bookkeeping round: the reserved Answer
      // round's model call rejects (script exhausted) — the run still ends
      // with the guaranteed deterministic Answer.
      const llm = new ScriptedLlm([
        ...Array.from({ length: 6 }, (_, i) => workRound(i, i === 0)),
        { kind: 'tool_calls', calls: [{ id: 'w6', name: 'work', args: {} }] },
      ])
      const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock: new FakeClock(), tools: [createReportRunPlanTool(), work] })

      const events = await collect(pipeline, 'do the thing')

      expect(llm.requests).toHaveLength(8)
      expect(events.find((e) => e.type === 'error')).toBeUndefined()
      expect(events).toContainEqual({
        type: 'display',
        text: 'I could not finish \u201Cdo the thing\u201D. The run exhausted its planned work budget.',
        at: 0,
      })
      expect(events.at(-1)).toEqual({ type: 'done', outcome: 'failed', finalizationCause: 'budget_exhausted', at: 0 })
    })

    it('builds the deterministic Answer from verified observations only', async () => {
      // A page-facing work tool: its observations carry the visible tab's
      // URL as their source. Round 6 fails — failed observations are not
      // evidence, and the repeated URL dedupes.
      const pageWork: Tool = {
        name: 'navigate',
        acquisition: true,
        async execute(call) {
          return call.id === 'w5' ? Promise.reject(new Error('kaboom')) : Promise.resolve('worked')
        },
      }
      const llm = new ScriptedLlm([
        ...Array.from({ length: 6 }, (_, i) => ({
          kind: 'tool_calls' as const,
          calls: [
            ...(i === 0 ? [directPlan('p0')] : []),
            { id: `w${i}`, name: 'navigate', args: {} },
          ],
        })),
        { kind: 'tool_calls', calls: [{ id: 'w6', name: 'navigate', args: {} }] },
        { kind: 'tool_calls', calls: [{ id: 'w7', name: 'navigate', args: {} }] },
      ])
      const pipeline = createCommandPipeline({
        llm,
        tts: new RecordingTts(),
        clock: new FakeClock(),
        tools: [createReportRunPlanTool(), pageWork],
        currentPageUrl: () => 'https://example.com/page',
      })

      const events = await collect(pipeline, 'do the thing')

      const display = events.find((e) => e.type === 'display')
      expect(display).toMatchObject({
        type: 'display',
        text:
          'I could not finish \u201Cdo the thing\u201D. The run exhausted its planned work budget.\n\n' +
          'What I managed to observe:\n' +
          '- https://example.com/page',
      })
      // The failed round's tool id (w5) is the sixth zero-indexed round's call.
      expect(events.find((e) => e.type === 'tool_result' && e.callId === 'w5')).toMatchObject({ ok: false })
    })

    it('finalizes when the Direct Action active-work deadline passes', async () => {
      const clock = new FakeClock()
      const slowWork: Tool = {
        name: 'work',
        acquisition: true,
        async execute() {
          clock.advance(46_000)
          return 'worked'
        },
      }
      const llm = new ScriptedLlm([
        workRound(0, true),
        { kind: 'tool_calls', calls: [{ id: 'w1', name: 'work', args: {} }] },
        { kind: 'answer', speak: 'Ran out of time.', display: 'Detail.', resolution: 'partial' },
      ])
      const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock, tools: [createReportRunPlanTool(), slowWork] })

      const events = await collect(pipeline, 'do the thing')

      // One round of work (46 s of active work against a 45 s deadline);
      // the next round is Finalization's bookkeeping round, then the Answer.
      expect(llm.requests).toHaveLength(3)
      expect(events.filter((e) => e.type === 'tool_result' && e.name === 'work' && e.ok)).toHaveLength(1)
      expect(events.find((e) => e.type === 'tool_result' && e.callId === 'w1')).toMatchObject({
        ok: false,
        error: expect.stringMatching(/work budget is exhausted/),
      })
      expect(events.at(-1)).toEqual({
        type: 'done',
        outcome: 'done',
        resolution: 'partial',
        finalizationCause: 'deadline_reached',
        at: 46_000,
      })
    })

    it('excludes user-dependent waiting from the active-work deadline', async () => {
      const clock = new FakeClock()
      const gatedWork: Tool = {
        name: 'work',
        acquisition: true,
        assessRisk: () => ({ kind: 'confirm', prompt: 'Proceed?' }),
        async execute() {
          return 'worked'
        },
      }
      const llm = new ScriptedLlm([
        workRound(0, true),
        { kind: 'answer', speak: 'Done.', display: 'Detail.' },
      ])
      // Park the run's speech so the test controls when the confirmation
      // window actually begins, then let the generator park in the
      // decision race (clock suspended) before advancing the clock.
      const speech = deferred<void>()
      const spoken: string[] = []
      const tts = {
        async speak(text: string) {
          spoken.push(text)
          if (spoken.length === 1) await speech.promise
          return { ok: true as const }
        },
        stop() {},
      }
      const pipeline = createCommandPipeline({ llm, tts, clock, tools: [createReportRunPlanTool(), gatedWork] })

      const run = collect(pipeline, 'do the thing')
      // Round 1 emits several events before the speech parks, so the poll
      // needs a longer leash than the shared waitUntil.
      for (let attempt = 0; attempt < 200 && spoken.length < 1; attempt += 1) await flush()
      expect(spoken.length).toBe(1)
      speech.resolve()
      for (let i = 0; i < 10; i += 1) await flush()
      // Fifty seconds of user thinking — over the 45 s Direct Action
      // deadline, but user-dependent waiting never counts as work.
      clock.advance(50_000)
      pipeline.resolveConfirmation('confirm-1', true)
      const events = await run

      expect(events.filter((e) => e.type === 'tool_result' && e.name === 'work' && e.ok)).toHaveLength(1)
      expect(events.at(-1)).toEqual({ type: 'done', outcome: 'done', finalizationCause: 'model_answered', at: 50_000 })
    })

    it('bounds a plan-less run at the fallback Lookup budget', async () => {
      // No report_run_plan in the catalog: the run defaults to Lookup and
      // its 12-round budget — the tier table applies without a declaration.
      const llm = new ScriptedLlm([
        ...Array.from({ length: 12 }, (_, i) => workRound(i)),
        { kind: 'tool_calls', calls: [{ id: 'w12', name: 'work', args: {} }] },
        { kind: 'answer', speak: 'Done.', display: 'Detail.' },
      ])
      const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock: new FakeClock(), tools: [work] })

      const events = await collect(pipeline, 'do the thing')

      expect(events.filter((e) => e.type === 'tool_result' && e.name === 'work' && e.ok)).toHaveLength(12)
      expect(events.find((e) => e.type === 'tool_result' && e.callId === 'w12')).toMatchObject({
        ok: false,
        error: expect.stringMatching(/work budget is exhausted/),
      })
      expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'done', finalizationCause: 'budget_exhausted' })
    })
  })

  describe('bounded Lookups and Investigations (#118, ADR 0027)', () => {
    const plan = (
      id: string,
      effortTier: 'direct_action' | 'lookup' | 'investigation',
      headline = 'Research the thing',
      escalationReason?: string,
    ): ToolCall => ({
      id,
      name: 'report_run_plan',
      args: {
        objective: 'Research the thing',
        headline,
        effort_tier: effortTier,
        ...(escalationReason ? { escalation_reason: escalationReason } : {}),
      },
    })

    const work: Tool = {
      name: 'work',
      acquisition: true,
      async execute() {
        return 'worked'
      },
    }

    const workRound = (i: number, planCall?: ToolCall) => ({
      kind: 'tool_calls' as const,
      calls: [...(planCall ? [planCall] : []), { id: `w${i}`, name: 'work', args: {} }],
    })

    const budgetWarnings = (events: PipelineEvent[]) =>
      events.filter(
        (e) => e.type === 'tool_result' && e.ok && typeof e.result === 'string' && /Work budget: .*tool rounds? remain/.test(e.result),
      )

    it('bounds a Lookup at its 12-Tool-Round budget, warning near 75% and 90%', async () => {
      const llm = new ScriptedLlm([
        ...Array.from({ length: 12 }, (_, i) => workRound(i, i === 0 ? plan('p0', 'lookup') : undefined)),
        { kind: 'tool_calls', calls: [{ id: 'w12', name: 'work', args: {} }] },
        { kind: 'answer', speak: 'Partial.', display: 'Partial detail.', resolution: 'partial' },
      ])
      const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock: new FakeClock(), tools: [createReportRunPlanTool(), work] })

      const events = await collect(pipeline, 'look up the widget finish guide')

      expect(events.filter((e) => e.type === 'tool_result' && e.name === 'work' && e.ok)).toHaveLength(12)
      expect(events.find((e) => e.type === 'tool_result' && e.callId === 'w12')).toMatchObject({
        ok: false,
        error: expect.stringMatching(/work budget is exhausted/),
      })
      // Milestones crossed after rounds 9 and 10 ride those rounds' own
      // results — 3 and 2 of 12 remaining.
      const warned = budgetWarnings(events)
      expect(warned.map((e) => (e as { callId: string }).callId)).toEqual(['w8', 'w9'])
      expect(warned[0]).toMatchObject({ result: expect.stringContaining('3 of 12 tool rounds remain') })
      expect(warned[1]).toMatchObject({ result: expect.stringContaining('2 of 12 tool rounds remain') })
      expect(events.at(-1)).toEqual({ type: 'done', outcome: 'done', resolution: 'partial', finalizationCause: 'budget_exhausted', at: 0 })
    })

    it('bounds an Investigation at its 24-Tool-Round budget, warning near 75% and 90%', async () => {
      const llm = new ScriptedLlm([
        ...Array.from({ length: 24 }, (_, i) => workRound(i, i === 0 ? plan('p0', 'investigation') : undefined)),
        { kind: 'tool_calls', calls: [{ id: 'w24', name: 'work', args: {} }] },
        { kind: 'answer', speak: 'Partial.', display: 'Partial detail.', resolution: 'partial' },
      ])
      const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock: new FakeClock(), tools: [createReportRunPlanTool(), work] })

      const events = await collect(pipeline, 'compare the widget vendors')

      expect(events.filter((e) => e.type === 'tool_result' && e.name === 'work' && e.ok)).toHaveLength(24)
      expect(events.find((e) => e.type === 'tool_result' && e.callId === 'w24')).toMatchObject({
        ok: false,
        error: expect.stringMatching(/work budget is exhausted/),
      })
      // Milestones crossed after rounds 18 and 21 ride those rounds' own
      // results — 6 and 3 of 24 remaining.
      const warned = budgetWarnings(events)
      expect(warned.map((e) => (e as { callId: string }).callId)).toEqual(['w17', 'w20'])
      expect(warned[0]).toMatchObject({ result: expect.stringContaining('6 of 24 tool rounds remain') })
      expect(warned[1]).toMatchObject({ result: expect.stringContaining('3 of 24 tool rounds remain') })
      expect(events.at(-1)).toEqual({ type: 'done', outcome: 'done', resolution: 'partial', finalizationCause: 'budget_exhausted', at: 0 })
    })

    it('finalizes when the Lookup active-work deadline passes', async () => {
      const clock = new FakeClock()
      const slowWork: Tool = {
        name: 'work',
        acquisition: true,
        async execute() {
          clock.advance(121_000)
          return 'worked'
        },
      }
      const llm = new ScriptedLlm([
        workRound(0, plan('p0', 'lookup')),
        { kind: 'tool_calls', calls: [{ id: 'w1', name: 'work', args: {} }] },
        { kind: 'answer', speak: 'Ran out of time.', display: 'Detail.', resolution: 'partial' },
      ])
      const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock, tools: [createReportRunPlanTool(), slowWork] })

      const events = await collect(pipeline, 'look up the widget finish guide')

      // One round of work — 121 s of active work against the 2-minute
      // Lookup deadline; then bookkeeping, then the Answer.
      expect(llm.requests).toHaveLength(3)
      expect(events.filter((e) => e.type === 'tool_result' && e.name === 'work' && e.ok)).toHaveLength(1)
      expect(events.find((e) => e.type === 'tool_result' && e.callId === 'w1')).toMatchObject({
        ok: false,
        error: expect.stringMatching(/work budget is exhausted/),
      })
      expect(events.at(-1)).toEqual({ type: 'done', outcome: 'done', resolution: 'partial', finalizationCause: 'deadline_reached', at: 121_000 })
    })

    it('finalizes when the Investigation active-work deadline passes', async () => {
      const clock = new FakeClock()
      const slowWork: Tool = {
        name: 'work',
        acquisition: true,
        async execute() {
          clock.advance(301_000)
          return 'worked'
        },
      }
      const llm = new ScriptedLlm([
        workRound(0, plan('p0', 'investigation')),
        { kind: 'tool_calls', calls: [{ id: 'w1', name: 'work', args: {} }] },
        { kind: 'answer', speak: 'Ran out of time.', display: 'Detail.', resolution: 'partial' },
      ])
      const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock, tools: [createReportRunPlanTool(), slowWork] })

      const events = await collect(pipeline, 'compare the widget vendors')

      expect(llm.requests).toHaveLength(3)
      expect(events.filter((e) => e.type === 'tool_result' && e.name === 'work' && e.ok)).toHaveLength(1)
      expect(events.at(-1)).toEqual({ type: 'done', outcome: 'done', resolution: 'partial', finalizationCause: 'deadline_reached', at: 301_000 })
    })

    it('grants an escalated tier its full fresh Tool-Round budget (#118/AC2)', async () => {
      // Five Direct Action rounds, then a reasoned one-level escalation:
      // the Lookup epoch re-arms to its full 12 rounds, so acquisition
      // stops at 17 cumulative rounds — not at the ceiling, and not at
      // the 12 a never-rearmed budget would have allowed.
      const llm = new ScriptedLlm([
        ...Array.from({ length: 5 }, (_, i) => workRound(i, i === 0 ? plan('p0', 'direct_action') : undefined)),
        workRound(5, plan('p5', 'lookup', 'Widen the search', 'The direct pages named no vendor.')),
        ...Array.from({ length: 11 }, (_, i) => workRound(i + 6)),
        { kind: 'tool_calls', calls: [{ id: 'w17', name: 'work', args: {} }] },
        { kind: 'answer', speak: 'Done.', display: 'Detail.' },
      ])
      const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock: new FakeClock(), tools: [createReportRunPlanTool(), work] })

      const events = await collect(pipeline, 'research the thing')

      expect(events.filter((e) => e.type === 'run_plan').map((e) => (e as { effortTier: string }).effortTier)).toEqual([
        'direct_action',
        'lookup',
      ])
      expect(events.filter((e) => e.type === 'run_plan').at(-1)).toMatchObject({
        escalationReason: 'The direct pages named no vendor.',
      })
      expect(events.filter((e) => e.type === 'tool_result' && e.name === 'work' && e.ok)).toHaveLength(17)
      expect(events.find((e) => e.type === 'tool_result' && e.callId === 'w17')).toMatchObject({
        ok: false,
        error: expect.stringMatching(/work budget is exhausted/),
      })
      expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'done', finalizationCause: 'budget_exhausted' })
    })

    it('re-arms the active-work deadline when escalation opens a new tier epoch', async () => {
      const clock = new FakeClock()
      const advances: Record<string, number> = { w0: 110_000, w1: 200_000, w2: 101_000 }
      const timedWork: Tool = {
        name: 'work',
        acquisition: true,
        async execute(call) {
          clock.advance(advances[call.id] ?? 0)
          return 'worked'
        },
      }
      const llm = new ScriptedLlm([
        // Round 1: 110 s — under the 2-minute Lookup deadline.
        workRound(0, plan('p0', 'lookup')),
        // Round 2 escalates (re-arm) then works 200 s of Investigation
        // time; round 3 crosses the re-armed 5-minute deadline.
        workRound(1, plan('p1', 'investigation', 'Compare vendors', 'The pages disagree on the finish.')),
        workRound(2),
        { kind: 'tool_calls', calls: [{ id: 'w3', name: 'work', args: {} }] },
        { kind: 'answer', speak: 'Ran out of time.', display: 'Detail.', resolution: 'partial' },
      ])
      const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock, tools: [createReportRunPlanTool(), timedWork] })

      const events = await collect(pipeline, 'research the thing')

      // Without the re-arm, 110 s + 200 s = 310 s would have finalized the
      // run before round 3; with it, the Investigation epoch's fresh
      // 5-minute clock bounds the run instead.
      expect(events.filter((e) => e.type === 'tool_result' && e.name === 'work' && e.ok)).toHaveLength(3)
      expect(events.find((e) => e.type === 'tool_result' && e.callId === 'w3')).toMatchObject({
        ok: false,
        error: expect.stringMatching(/work budget is exhausted/),
      })
      expect(events.at(-1)).toEqual({ type: 'done', outcome: 'done', resolution: 'partial', finalizationCause: 'deadline_reached', at: 411_000 })
    })

    it('excludes user-dependent waiting from the Lookup deadline while the interaction stays finite', async () => {
      const clock = new FakeClock()
      const gatedWork: Tool = {
        name: 'work',
        acquisition: true,
        assessRisk: () => ({ kind: 'confirm', prompt: 'Proceed?' }),
        async execute() {
          return 'worked'
        },
      }
      const llm = new ScriptedLlm([
        workRound(0, plan('p0', 'lookup')),
        { kind: 'answer', speak: 'Done.', display: 'Detail.' },
      ])
      // Park the run's speech so the test controls when the confirmation
      // window actually begins, then let the generator park in the
      // decision race (clock suspended) before advancing the clock.
      const speech = deferred<void>()
      const spoken: string[] = []
      const tts = {
        async speak(text: string) {
          spoken.push(text)
          if (spoken.length === 1) await speech.promise
          return { ok: true as const }
        },
        stop() {},
      }
      const pipeline = createCommandPipeline({
        llm,
        tts,
        clock,
        tools: [createReportRunPlanTool(), gatedWork],
        confirmTimeoutMs: 200_000,
      })

      const run = collect(pipeline, 'look up the thing')
      for (let attempt = 0; attempt < 200 && spoken.length < 1; attempt += 1) await flush()
      expect(spoken.length).toBe(1)
      speech.resolve()
      for (let i = 0; i < 10; i += 1) await flush()
      // 130 s of user thinking — past the 2-minute Lookup deadline, but
      // user-dependent waiting never counts as work; the window's own
      // finite timeout (200 s) still bounds the interaction.
      clock.advance(130_000)
      pipeline.resolveConfirmation('confirm-1', true)
      const events = await run

      expect(events.find((e) => e.type === 'confirmation_requested')).toMatchObject({ expiresAt: 200_000 })
      expect(events.filter((e) => e.type === 'tool_result' && e.name === 'work' && e.ok)).toHaveLength(1)
      expect(events.at(-1)).toEqual({ type: 'done', outcome: 'done', finalizationCause: 'model_answered', at: 130_000 })
    })

    it('records the tier budget, not the ceiling, when both bind at the same round', async () => {
      // A fresh 24-round Investigation epoch opened at cumulative round 8
      // exhausts exactly at round 31 — the same loop top the 32-round
      // ceiling guard fires on. The planned limit is the honest cause.
      const llm = new ScriptedLlm([
        ...Array.from({ length: 7 }, (_, i) => workRound(i, i === 0 ? plan('p0', 'lookup') : undefined)),
        workRound(7, plan('p7', 'investigation', 'Compare vendors', 'The catalog vendors disagree on the finish.')),
        ...Array.from({ length: 23 }, (_, i) => workRound(i + 8)),
        { kind: 'tool_calls', calls: [{ id: 'w31', name: 'work', args: {} }] },
        { kind: 'answer', speak: 'Partial.', display: 'Partial detail.', resolution: 'partial' },
      ])
      const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock: new FakeClock(), tools: [createReportRunPlanTool(), work] })

      const events = await collect(pipeline, 'compare the widget vendors')

      expect(events.filter((e) => e.type === 'tool_result' && e.name === 'work' && e.ok)).toHaveLength(31)
      expect(events.find((e) => e.type === 'tool_result' && e.callId === 'w31')).toMatchObject({
        ok: false,
        error: expect.stringMatching(/work budget is exhausted/),
      })
      expect(events.at(-1)).toEqual({ type: 'done', outcome: 'done', resolution: 'partial', finalizationCause: 'budget_exhausted', at: 0 })
    })

    it('reports an escalation accepted during Finalization without re-arming work', async () => {
      // The bookkeeping round's escalation lands as an event, but
      // Finalization is never exited: no fresh epoch, no further work,
      // the Answer round follows as always.
      const llm = new ScriptedLlm([
        ...Array.from({ length: 12 }, (_, i) => workRound(i, i === 0 ? plan('p0', 'lookup') : undefined)),
        {
          kind: 'tool_calls',
          calls: [
            { id: 'w12', name: 'work', args: {} },
            plan('p12', 'investigation', 'Compare vendors', 'The vendors disagree.'),
          ],
        },
        { kind: 'answer', speak: 'Partial.', display: 'Partial detail.', resolution: 'partial' },
      ])
      const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock: new FakeClock(), tools: [createReportRunPlanTool(), work] })

      const events = await collect(pipeline, 'compare the widget vendors')

      expect(events.filter((e) => e.type === 'run_plan').map((e) => (e as { effortTier: string }).effortTier)).toEqual([
        'lookup',
        'investigation',
      ])
      expect(events.filter((e) => e.type === 'run_plan').at(-1)).toMatchObject({ escalationReason: 'The vendors disagree.' })
      expect(events.find((e) => e.type === 'tool_result' && e.callId === 'p12')).toMatchObject({
        ok: true,
        result: expect.stringMatching(/Run Plan noted\.[\s\S]*final answer JSON/),
      })
      expect(events.filter((e) => e.type === 'tool_result' && e.name === 'work' && e.ok)).toHaveLength(12)
      expect(llm.requests).toHaveLength(14)
      expect(events.at(-1)).toEqual({ type: 'done', outcome: 'done', resolution: 'partial', finalizationCause: 'budget_exhausted', at: 0 })
    })

    it('stops escalated work at the 32-Tool-Round hard ceiling, preserving bookkeeping and the Answer (#118/AC5)', async () => {
      // Five Direct Action rounds — the escalation lands in the epoch's
      // last usable round, before the tier budget finalizes; then a full
      // 12-round Lookup epoch whose final round escalates again. The
      // Investigation epoch the ceiling cuts short at 15 of its 24
      // rounds: 31 acquisition rounds total, the 32nd preserved as
      // Finalization's bookkeeping round, and the Answer-only round
      // riding outside the ceiling.
      const llm = new ScriptedLlm([
        ...Array.from({ length: 5 }, (_, i) => workRound(i, i === 0 ? plan('p0', 'direct_action') : undefined)),
        workRound(5, plan('p5', 'lookup', 'Widen to the catalog', 'The direct pages named no vendor.')),
        ...Array.from({ length: 10 }, (_, i) => workRound(i + 6)),
        workRound(16, plan('p16', 'investigation', 'Compare vendors', 'The catalog vendors disagree on the finish.')),
        ...Array.from({ length: 14 }, (_, i) => workRound(i + 17)),
        { kind: 'tool_calls', calls: [{ id: 'w31', name: 'work', args: {} }] },
        { kind: 'answer', speak: 'Partial.', display: 'Partial detail.', resolution: 'partial' },
      ])
      const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock: new FakeClock(), tools: [createReportRunPlanTool(), work] })

      const events = await collect(pipeline, 'compare the widget vendors')

      expect(events.filter((e) => e.type === 'tool_result' && e.name === 'work' && e.ok)).toHaveLength(31)
      expect(events.find((e) => e.type === 'tool_result' && e.callId === 'w31')).toMatchObject({
        ok: false,
        error: expect.stringMatching(/work budget is exhausted[\s\S]*final answer JSON/),
      })
      // 32 Tool Rounds inside the ceiling plus the Answer-only round
      // outside it.
      expect(llm.requests).toHaveLength(33)
      expect(events.filter((e) => e.type === 'run_plan').map((e) => (e as { effortTier: string }).effortTier)).toEqual([
        'direct_action',
        'lookup',
        'investigation',
      ])
      expect(events.at(-1)).toEqual({ type: 'done', outcome: 'done', resolution: 'partial', finalizationCause: 'hard_limit', at: 0 })
    })
  })

  describe('bounded parallel delegation (#120, ADR 0027)', () => {
    const investigationPlan = (id: string): ToolCall => ({
      id,
      name: 'report_run_plan',
      args: { objective: 'Compare vendor finishes', headline: 'Comparing vendors', effort_tier: 'investigation' },
    })

    it('refuses browse delegation while the run sits below the Investigation tier', async () => {
      const spawns: unknown[][] = []
      const manager = fakeSubagentManager([], {
        spawn: (...args: unknown[]) => {
          spawns.push(args)
          return { ok: true as const, agent: { ...subagentRecord('a-1'), kind: 'browse' } }
        },
      })
      const llm = new ScriptedLlm([
        // A Lookup-tier plan in the same round — an ordinary Lookup is
        // never delegated, so the spawn still refuses.
        {
          kind: 'tool_calls',
          calls: [
            { id: 'p1', name: 'report_run_plan', args: { objective: 'Find the fact', headline: 'Finding the fact', effort_tier: 'lookup' } },
            { id: 's1', name: 'spawn_agent', args: { kind: 'browse', task: 'check the vendor' } },
          ],
        },
        { kind: 'answer', speak: 'Did it myself.', display: 'Did it myself.' },
      ])
      const pipeline = createCommandPipeline({
        llm,
        tts: new RecordingTts(),
        clock: new FakeClock(),
        tools: [createReportRunPlanTool(), ...createSubagentTools(manager)],
      })

      const events = await collect(pipeline, 'find the fact')

      expect(spawns).toEqual([])
      expect(events.find((e) => e.type === 'tool_result' && e.callId === 's1')).toMatchObject({
        ok: false,
        error: expect.stringMatching(
          /browse subagents are for genuinely independent Investigation branches[\s\S]*this run is on the Lookup tier/,
        ),
      })
      expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'done' })
    })

    it('lets the Investigation tier delegate and carries the shared active-work deadline into the spawn', async () => {
      let received: { expired(): boolean } | undefined
      const manager = fakeSubagentManager([], {
        spawn: (_kind, _task, _turnId, _memory, sharedDeadline) => {
          received = sharedDeadline
          return { ok: true as const, agent: subagentRecord('a-1') }
        },
      })
      const llm = new ScriptedLlm([
        {
          kind: 'tool_calls',
          calls: [
            investigationPlan('p1'),
            { id: 's1', name: 'spawn_agent', args: { kind: 'browse', task: 'compare the vendor pages' } },
          ],
        },
        { kind: 'answer', speak: 'Delegated.', display: 'Delegated.' },
      ])
      const pipeline = createCommandPipeline({
        llm,
        tts: new RecordingTts(),
        clock: new FakeClock(),
        tools: [createReportRunPlanTool(), ...createSubagentTools(manager)],
      })

      const events = await collect(pipeline, 'compare the vendor finishes')

      expect(events.find((e) => e.type === 'tool_result' && e.callId === 's1')).toMatchObject({ ok: true })
      // The deadline is live and shared: under the Investigation deadline
      // during the run, and frozen (not expired) once the run has ended.
      expect(received).toBeDefined()
      expect(received!.expired()).toBe(false)
    })

    it('cancels unfinished delegated acquisition once at Finalization entry (#120/AC4)', async () => {
      const work: Tool = { name: 'work', acquisition: true, async execute() { return 'worked' } }
      const llm = new ScriptedLlm([
        ...Array.from({ length: 6 }, (_, i) => ({
          kind: 'tool_calls' as const,
          calls: [
            ...(i === 0
              ? [{ id: 'p0', name: 'report_run_plan', args: { objective: 'Do the thing', headline: 'Doing', effort_tier: 'direct_action' } }]
              : []),
            { id: `w${i}`, name: 'work', args: {} },
          ],
        })),
        { kind: 'tool_calls', calls: [{ id: 'w6', name: 'work', args: {} }] },
        { kind: 'answer', speak: 'Partial.', display: 'Partial.', resolution: 'partial' },
      ])
      let finalized = 0
      const pipeline = createCommandPipeline({
        llm,
        tts: new RecordingTts(),
        clock: new FakeClock(),
        tools: [createReportRunPlanTool(), work],
        onFinalize: () => {
          finalized += 1
        },
      })

      const events = await collect(pipeline, 'do the thing')

      // The rail tripped exactly once — the bookkeeping round and the
      // reserved Answer round never re-fire the entry hook.
      expect(finalized).toBe(1)
      expect(events.at(-1)).toMatchObject({ type: 'done', finalizationCause: 'budget_exhausted' })
    })

    it('never fires Finalization for a run that answers within its budget', async () => {
      const work: Tool = { name: 'work', acquisition: true, async execute() { return 'worked' } }
      const llm = new ScriptedLlm([
        {
          kind: 'tool_calls',
          calls: [
            { id: 'p0', name: 'report_run_plan', args: { objective: 'Do the thing', headline: 'Doing', effort_tier: 'direct_action' } },
            { id: 'w0', name: 'work', args: {} },
          ],
        },
        { kind: 'answer', speak: 'Done.', display: 'Done.' },
      ])
      let finalized = 0
      const pipeline = createCommandPipeline({
        llm,
        tts: new RecordingTts(),
        clock: new FakeClock(),
        tools: [createReportRunPlanTool(), work],
        onFinalize: () => {
          finalized += 1
        },
      })

      const events = await collect(pipeline, 'do the thing')

      expect(finalized).toBe(0)
      expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'done' })
    })
  })

  describe('replan after Steering (#119, ADR 0027)', () => {
    const plan = (
      id: string,
      objective: string,
      headline: string,
      effortTier: EffortTier,
    ): ToolCall => ({
      id,
      name: 'report_run_plan',
      args: { objective, headline, effort_tier: effortTier },
    })

    const work: Tool = {
      name: 'work',
      acquisition: true,
      async execute() {
        return 'worked'
      },
    }

    const workRound = (i: number, planCall?: ToolCall) => ({
      kind: 'tool_calls' as const,
      calls: [...(planCall ? [planCall] : []), { id: `w${i}`, name: 'work', args: {} }],
    })

    /** Steers at the given tool result's yield — the next checkpoint consumes it. */
    const steerAt = (callId: string, directive: string) => (event: PipelineEvent, active: CommandPipeline) => {
      if (event.type === 'tool_result' && event.callId === callId) {
        active.pause()
        active.resume(directive)
      }
    }

    /** Steers several directives, each at its own tool result's yield. */
    const steerOns = (directives: Record<string, string>) => (event: PipelineEvent, active: CommandPipeline) => {
      const directive = event.type === 'tool_result' ? directives[event.callId] : undefined
      if (directive !== undefined) {
        active.pause()
        active.resume(directive)
      }
    }

    it('discards the stale in-flight round, exits stale tier exhaustion, and works the corrected objective (#119/AC1-3)', async () => {
      // Six Direct Action rounds exhaust the tier budget; the directive
      // lands while the would-be bookkeeping round's model call is in
      // flight, so that round is stale work the run discards. The
      // corrected objective reports a fresh plan and keeps working — the
      // exhaustion belonged to the stale objective.
      const bookkeepingTurn = deferred<AssistantTurn>()
      const requests: LlmRequest[] = []
      const llm: LlmClient = {
        async complete(request) {
          requests.push(request)
          if (requests.length <= 6) {
            return workRound(requests.length, requests.length === 1 ? plan('p1', 'Find a mug', 'Find a mug', 'direct_action') : undefined)
          }
          if (requests.length === 7) return bookkeepingTurn.promise
          if (requests.length === 8) {
            return workRound(8, plan('p8', 'Find a red mug', 'Find a red mug', 'lookup'))
          }
          return { kind: 'answer', speak: 'Found a red one.', display: 'Found a red mug.' }
        },
      }
      let executions = 0
      const countedWork: Tool = {
        ...work,
        async execute() {
          executions += 1
          return 'worked'
        },
      }
      const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock: new FakeClock(), tools: [createReportRunPlanTool(), countedWork] })

      const run = collect(pipeline, 'find a mug')
      for (let attempt = 0; attempt < 200 && requests.length < 7; attempt += 1) await flush()
      expect(requests.length).toBeGreaterThanOrEqual(7)
      pipeline.pause()
      bookkeepingTurn.resolve({ kind: 'tool_calls', calls: [{ id: 'stale', name: 'work', args: {} }] })
      await waitUntil(() => pipeline.getState() === 'paused')
      pipeline.resume('Find a red mug instead.')

      const events = await run

      // The stale round's call never executed; the corrected objective
      // did its one round of work.
      expect(executions).toBe(7)
      expect(events.filter((e) => e.type === 'tool_result' && e.callId === 'stale')).toEqual([])
      // The corrected objective's report is a fresh initial plan.
      expect(events.filter((e) => e.type === 'run_plan').map((e) => (e as { effortTier: string }).effortTier)).toEqual(['direct_action', 'lookup'])
      expect(events.filter((e) => e.type === 'run_plan').at(-1)).toMatchObject({ objective: 'Find a red mug', source: 'model' })
      // The directive rode the corrected objective's first model call.
      expect(requests[7]?.steering).toBe('Find a red mug instead.')
      expect(events.at(-1)).toEqual({ type: 'done', outcome: 'done', finalizationCause: 'model_answered', at: 0 })
    })

    it('re-arms the active-work deadline for the corrected objective (#119/AC3)', async () => {
      const clock = new FakeClock()
      const timedWork: Tool = {
        ...work,
        async execute() {
          clock.advance(70_000)
          return 'worked'
        },
      }
      const llm = new ScriptedLlm([
        workRound(0, plan('p0', 'Find a mug', 'Find a mug', 'lookup')),
        workRound(1, plan('p1', 'Find a red mug', 'Find a red mug', 'lookup')),
        workRound(2),
        { kind: 'tool_calls', calls: [{ id: 'w3', name: 'work', args: {} }] },
        { kind: 'answer', speak: 'Found a red one.', display: 'Found a red mug.' },
      ])
      const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock, tools: [createReportRunPlanTool(), timedWork] })

      const events = await collect(pipeline, 'find a mug', steerAt('w0', 'The red one instead.'))

      // Without the re-arm, 70 s + 70 s crosses the 2-minute Lookup
      // deadline before w2; with it, the corrected objective gets its
      // own two minutes and only w3 is refused.
      expect(events.filter((e) => e.type === 'tool_result' && e.name === 'work' && e.ok)).toHaveLength(3)
      expect(events.find((e) => e.type === 'tool_result' && e.callId === 'w3')).toMatchObject({
        ok: false,
        error: expect.stringMatching(/work budget is exhausted/),
      })
      expect(events.at(-1)).toMatchObject({ type: 'done', finalizationCause: 'deadline_reached' })
    })

    it('defaults a plan-less corrected objective to the fallback Lookup and owes one fresh nudge (#119/AC2)', async () => {
      const llm = new ScriptedLlm([
        { kind: 'tool_calls', calls: [{ id: 'w0', name: 'work', args: {} }] },
        { kind: 'tool_calls', calls: [{ id: 'w1', name: 'work', args: {} }] },
        { kind: 'answer', speak: 'Done.', display: 'Done.' },
      ])
      const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock: new FakeClock(), tools: [createReportRunPlanTool(), work] })

      const events = await collect(pipeline, 'find a mug', steerAt('w0', 'The red one instead.'))

      // One fallback per plan-slot opening: the run's start and the
      // corrected objective's plan-less round.
      expect(events.filter((e) => e.type === 'run_plan')).toEqual([
        { type: 'run_plan', objective: 'find a mug', headline: null, effortTier: 'lookup', source: 'fallback', at: 0 },
        { type: 'run_plan', objective: 'find a mug', headline: null, effortTier: 'lookup', source: 'fallback', at: 0 },
      ])
      // Exactly one corrective nudge per slot — the corrected objective
      // gets its own single chance to declare a plan.
      const nudged = events.filter(
        (e) => e.type === 'tool_result' && typeof e.result === 'string' && e.result.includes('report_run_plan'),
      )
      expect(nudged.map((e) => (e as { callId: string }).callId)).toEqual(['w0', 'w1'])
      expect(llm.requests[1]?.steering).toBe('The red one instead.')
    })

    it('bounds repeated Steering at the 32-Tool-Round hard ceiling (#119/AC5)', async () => {
      // Three corrections, each re-arming the tier budget, still land on
      // the cumulative hard ceiling: 31 acquisition rounds, the 32nd
      // preserved for bookkeeping, the Answer riding outside.
      const llm = new ScriptedLlm([
        ...Array.from({ length: 31 }, (_, i) => workRound(i, i === 0 ? plan('p0', 'Research the thing', 'Research the thing', 'lookup') : undefined)),
        { kind: 'tool_calls', calls: [{ id: 'w31', name: 'work', args: {} }] },
        { kind: 'answer', speak: 'Partial.', display: 'Partial detail.', resolution: 'partial' },
      ])
      const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock: new FakeClock(), tools: [createReportRunPlanTool(), work] })

      const events = await collect(pipeline, 'research the thing', steerOns({
        w4: 'Correction one.',
        w16: 'Correction two.',
        w28: 'Correction three.',
      }))

      expect(events.filter((e) => e.type === 'tool_result' && e.name === 'work' && e.ok)).toHaveLength(31)
      expect(llm.requests).toHaveLength(33)
      expect(llm.requests.filter((r) => r.steering !== undefined).map((r) => r.steering)).toEqual([
        'Correction one.',
        'Correction two.',
        'Correction three.',
      ])
      expect(events.at(-1)).toEqual({ type: 'done', outcome: 'done', resolution: 'partial', finalizationCause: 'hard_limit', at: 0 })
    })

    it('carries the corrected objective into the deterministic Answer when the reserved round fails at the ceiling (#119/AC5)', async () => {
      // An Investigation's 24-round budget plus one mid-run correction
      // reaches the hard ceiling; the second directive lands on the
      // round the ceiling preserves for bookkeeping, whose fresh plan
      // is exactly the bookkeeping it exists for. The reserved Answer
      // round then requests tools — the deterministic fallback answers
      // instead, naming the corrected objective.
      const llm = new ScriptedLlm([
        ...Array.from({ length: 24 }, (_, i) => workRound(i, i === 0 ? plan('p0', 'Research the thing', 'Research the thing', 'investigation') : undefined)),
        workRound(24, plan('p24', 'Research the red mugs', 'Research the red mugs', 'investigation')),
        ...Array.from({ length: 6 }, (_, i) => workRound(i + 25)),
        { kind: 'tool_calls', calls: [plan('p32', 'Find the red mug', 'Find the red mug', 'lookup')] },
        { kind: 'tool_calls', calls: [{ id: 'w32', name: 'work', args: {} }] },
      ])
      const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock: new FakeClock(), tools: [createReportRunPlanTool(), work] })

      const events = await collect(pipeline, 'research the thing', steerOns({
        w23: 'The red mugs instead.',
        w30: 'Just find the red mug.',
      }))

      // 31 acquisition rounds, bookkeeping, the failed reserved round.
      expect(llm.requests).toHaveLength(33)
      expect(events.filter((e) => e.type === 'tool_result' && e.name === 'work' && e.ok)).toHaveLength(31)
      // Both directives reached the model — the second on the ceiling's
      // bookkeeping round.
      expect(llm.requests.filter((r) => r.steering !== undefined).map((r) => r.steering)).toEqual([
        'The red mugs instead.',
        'Just find the red mug.',
      ])
      expect(llm.requests[31]?.steering).toBe('Just find the red mug.')
      expect(events.filter((e) => e.type === 'run_plan').map((e) => (e as { objective: string }).objective)).toEqual([
        'Research the thing',
        'Research the red mugs',
        'Find the red mug',
      ])
      const display = events.find((e) => e.type === 'display')
      expect(display).toMatchObject({ text: expect.stringContaining('Find the red mug') })
      expect((display as { text: string }).text).not.toContain('research the thing')
      expect(events.at(-1)).toEqual({ type: 'done', outcome: 'failed', finalizationCause: 'hard_limit', at: 0 })
    })

    it('names the user\u2019s correction in the deterministic Answer when the directive lands during the Answer-only round (#119/AC5)', async () => {
      // Twelve Lookup rounds exhaust the tier; the bookkeeping round
      // spends Finalization; the directive then lands while the reserved
      // Answer round is in flight. It cannot reopen tool work — the
      // answer that replaces the failing round names the correction, not
      // the stale command.
      const answerTurn = deferred<AssistantTurn>()
      const requests: LlmRequest[] = []
      const llm: LlmClient = {
        async complete(request) {
          requests.push(request)
          if (requests.length <= 12) {
            return workRound(requests.length, requests.length === 1 ? plan('p1', 'Find a mug', 'Find a mug', 'lookup') : undefined)
          }
          if (requests.length === 13) {
            return { kind: 'tool_calls', calls: [{ id: 'w13', name: 'work', args: {} }] }
          }
          if (requests.length === 14) return answerTurn.promise
          return { kind: 'tool_calls', calls: [{ id: 'w14', name: 'work', args: {} }] }
        },
      }
      const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock: new FakeClock(), tools: [createReportRunPlanTool(), work] })

      const run = collect(pipeline, 'find a mug')
      for (let attempt = 0; attempt < 200 && requests.length < 14; attempt += 1) await flush()
      expect(requests.length).toBeGreaterThanOrEqual(14)
      pipeline.pause()
      answerTurn.resolve({ kind: 'answer', speak: 'Stale.', display: 'Stale.' })
      await waitUntil(() => pipeline.getState() === 'paused')
      pipeline.resume('the red mug instead')

      const events = await run

      // The directive rode the repeated Answer round, which then
      // misbehaved — the deterministic Answer confirms the correction.
      expect(requests[14]?.steering).toBe('the red mug instead')
      const display = events.find((e) => e.type === 'display')
      expect(display).toMatchObject({ text: expect.stringContaining('the red mug instead') })
      expect((display as { text: string }).text).not.toContain('find a mug\u201D')
      expect(events.some((e) => e.type === 'display' && e.text === 'Stale.')).toBe(false)
      expect(events.at(-1)).toEqual({ type: 'done', outcome: 'failed', finalizationCause: 'budget_exhausted', at: 0 })
    })

    it('keeps every post-steering round on the same immutable continuity snapshots (#119/AC4)', async () => {
      const snapshot = Object.freeze([
        Object.freeze({ runId: 'run-1' as never, outcome: 'done' as const, text: 'Found the red mug last week.' }),
      ])
      const memory = Object.freeze([Object.freeze(memoryEntry('memory-1'))])
      const observations: string[] = []
      const llm = new ScriptedLlm([
        { kind: 'tool_calls', calls: [{ id: 'c1', name: 'spin', args: {} }] },
        { kind: 'answer', speak: 'The red one.', display: 'The red mug.', runNote: 'Chose the red mug.' },
      ])
      const spin: Tool = { name: 'spin', async execute() { return 'spun' } }
      const pipeline = createCommandPipeline({
        llm,
        tts: new RecordingTts(),
        clock: new FakeClock(),
        tools: [spin],
        onObservation: (record) => observations.push(record.producer),
      })
      const commits: { outcome: string; note: string }[] = []

      const events: PipelineEvent[] = []
      for await (const raw of pipeline.execute('which mug?', undefined, undefined, {
        snapshot,
        memory,
        commit: (outcome, note) => {
          commits.push({ outcome, note })
          return 'committed'
        },
      })) {
        const event = withoutTurnId(raw)
        events.push(event)
        if (event.type === 'tool_result' && event.callId === 'c1') {
          pipeline.pause()
          pipeline.resume('the red one')
        }
      }

      expect(llm.requests).toHaveLength(2)
      for (const request of llm.requests) {
        expect(request.journal).toBe(snapshot)
        expect(request.memory).toBe(memory)
      }
      expect(llm.requests[1]?.steering).toBe('the red one')
      // Session Evidence's substrate survives the replan: the directive
      // itself is recorded telemetry, and the Memory Commit still lands.
      expect(observations).toEqual(['command', 'action_outcome', 'steering'])
      expect(commits).toEqual([{ outcome: 'done', note: 'Chose the red mug.' }])
    })

    it('fires onSteer for a steering resume and onResume only for a plain resume (#119/AC1)', async () => {
      const hookCalls: string[] = []
      const parks: ReturnType<typeof deferred<AssistantTurn>>[] = []
      let round = 0
      const llm: LlmClient = {
        async complete() {
          round += 1
          if (round % 2 === 1) {
            const park = deferred<AssistantTurn>()
            parks.push(park)
            return park.promise
          }
          return { kind: 'answer', speak: 'Done.', display: 'Done.' }
        },
      }
      const pipeline = createCommandPipeline({
        llm,
        tts: new RecordingTts(),
        clock: new FakeClock(),
        tools: [],
        onPause: () => hookCalls.push('pause'),
        onResume: () => hookCalls.push('resume'),
        onSteer: () => hookCalls.push('steer'),
      })

      const first = collect(pipeline, 'find a mug')
      await waitUntil(() => parks.length === 1)
      pipeline.pause()
      parks[0].resolve({ kind: 'answer', speak: 'Stale.', display: 'Stale.' })
      await waitUntil(() => pipeline.getState() === 'paused')
      pipeline.resume('the red one instead')
      const firstEvents = await first

      const second = collect(pipeline, 'find another mug')
      await waitUntil(() => parks.length === 2)
      pipeline.pause()
      parks[1].resolve({ kind: 'answer', speak: 'Stale.', display: 'Stale.' })
      await waitUntil(() => pipeline.getState() === 'paused')
      pipeline.resume()
      await second

      expect(hookCalls).toEqual(['pause', 'steer', 'pause', 'resume'])
      // The stale answer the directive superseded never rendered; the
      // corrected round's answer did.
      expect(firstEvents.some((e) => e.type === 'display' && e.text === 'Stale.')).toBe(false)
      expect(firstEvents.some((e) => e.type === 'display' && e.text === 'Done.')).toBe(true)
    })
  })

  describe('run finalization semantics (#110)', () => {
    it.each(['completed', 'partial', 'blocked', 'needs_user', 'unsuccessful'] as const)(
      'completes mechanically as done for a valid Answer proposing %s',
      async (resolution) => {
        const llm = new ScriptedLlm([
          { kind: 'answer', speak: 'Done.', display: 'Detail.', resolution },
        ])
        const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock: new FakeClock(), tools: [] })

        const events = await collect(pipeline, 'do something')

        expect(events).toContainEqual({ type: 'display', text: 'Detail.', at: 0 })
        expect(events.at(-1)).toEqual({ type: 'done', outcome: 'done', resolution, finalizationCause: 'model_answered', at: 0 })
      },
    )

    it('records the model’s objective_met proposal as the Finalization Cause', async () => {
      const llm = new ScriptedLlm([
        { kind: 'answer', speak: 'Done.', display: 'Detail.', resolution: 'completed', finalizationCause: 'objective_met' },
      ])
      const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock: new FakeClock(), tools: [] })

      const events = await collect(pipeline, 'open the fixture page')

      expect(events.at(-1)).toEqual({ type: 'done', outcome: 'done', resolution: 'completed', finalizationCause: 'objective_met', at: 0 })
    })

    it('overrides a model-proposed runtime-owned cause with the mechanically known one', async () => {
      // The Answer claims a budget rail stopped the run — but the runtime
      // knows it ended because the model answered voluntarily, and a
      // mechanically knowable cause is runtime-owned.
      const llm = new ScriptedLlm([
        { kind: 'answer', speak: 'Ran out of budget.', display: 'Detail.', resolution: 'partial', finalizationCause: 'budget_exhausted' },
      ])
      const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock: new FakeClock(), tools: [] })

      const events = await collect(pipeline, 'research it')

      expect(events.at(-1)).toEqual({ type: 'done', outcome: 'done', resolution: 'partial', finalizationCause: 'model_answered', at: 0 })
    })

    it('drops malformed semantic metadata without discarding the Answer or the run', async () => {
      const llm = new ScriptedLlm([
        {
          kind: 'answer',
          speak: 'Still useful.',
          display: 'Still useful detail.',
          resolutionIssue: 'malformed',
          finalizationCauseIssue: 'malformed',
        },
      ])
      const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock: new FakeClock(), tools: [] })

      const events = await collect(pipeline, 'look something up')

      expect(events).toContainEqual({ type: 'display', text: 'Still useful detail.', at: 0 })
      expect(events.at(-1)).toEqual({ type: 'done', outcome: 'done', finalizationCause: 'model_answered', at: 0 })
    })

    it('carries no semantic fields on a cancelled run', async () => {
      const turn = deferred<AssistantTurn>()
      const llm: LlmClient = { complete: () => turn.promise }
      const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock: new FakeClock(), tools: [] })

      const run = collect(pipeline, 'stop me')
      await flush()
      pipeline.abort()
      turn.resolve({ kind: 'answer', speak: 'Finished.', display: 'Stale answer.' })
      const events = await run

      expect(events.at(-1)).toEqual({ type: 'done', outcome: 'cancelled', at: 0 })
    })

    it('records the mechanically known hard_limit cause on a round-limit failure', async () => {
      const spinner = { name: 'spin', async execute() { return 'spun' } }
      const endlessToolCalls = Array.from({ length: 5 }, (_, i) => ({
        kind: 'tool_calls' as const,
        calls: [{ id: `c${i}`, name: 'spin', args: {} }],
      }))
      const pipeline = createCommandPipeline({
        llm: new ScriptedLlm(endlessToolCalls),
        tts: new RecordingTts(),
        clock: new FakeClock(),
        tools: [spinner],
        maxToolRounds: 1,
      })

      const events = await collect(pipeline, 'keep going')

      expect(events.at(-1)).toEqual({ type: 'done', outcome: 'failed', finalizationCause: 'hard_limit', at: 0 })
    })

    it('carries no semantic fields on a reset-consumed run (#99)', async () => {
      const resetTool = { name: 'new_session', sessionReset: true, async execute() { return 'Session reset.' } }
      const llm = new ScriptedLlm([
        { kind: 'tool_calls', calls: [{ id: 'c1', name: 'new_session', args: {} }] },
      ])
      const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock: new FakeClock(), tools: [resetTool] })

      const events = await collect(pipeline, 'forget all that')

      expect(events.at(-1)).toEqual({ type: 'done', outcome: 'reset', at: 0 })
    })
  })

  it('re-reads getMaxToolRounds for each command', async () => {
    let executions = 0
    const spinner = {
      name: 'spin',
      async execute() {
        executions += 1
        return 'spun'
      },
    }
    // Each command runs tool rounds up to its ceiling, then the reserved
    // Answer round (a final tool request) ends the run deterministically:
    // 2 + 1 scripted turns for the first command, 3 + 1 for the second.
    const endlessToolCalls = Array.from({ length: 7 }, (_, i) => ({
      kind: 'tool_calls' as const,
      calls: [{ id: `c${i}`, name: 'spin', args: {} }],
    }))
    const llm = new ScriptedLlm(endlessToolCalls)
    let currentLimit = 2
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [spinner],
      maxToolRounds: 1,
      getMaxToolRounds: () => currentLimit,
    })

    const firstEvents = await collect(pipeline, 'first command')
    currentLimit = 3
    const secondEvents = await collect(pipeline, 'second command')

    // Two executed rounds then a refused reserved round for the first
    // command; three and a refusal for the second — the ceiling is live
    // per command, and the deterministic Answer closes each run.
    expect(firstEvents.filter((e) => e.type === 'tool_result' && e.ok)).toHaveLength(2)
    expect(secondEvents.filter((e) => e.type === 'tool_result' && e.ok)).toHaveLength(3)
    expect(executions).toBe(5)
    expect(firstEvents.at(-1)).toMatchObject({ type: 'done', outcome: 'failed', finalizationCause: 'hard_limit' })
    expect(secondEvents.at(-1)).toMatchObject({ type: 'done', outcome: 'failed', finalizationCause: 'hard_limit' })
  })

  it('appends an advisory nudge when a vision tool misses its deadline', async () => {
    const vision = {
      name: 'look',
      usesVision: true,
      async execute() {
        throw new VisionDeadlineError(15_000)
      },
    }
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'l1', name: 'look', args: {} }] },
      { kind: 'answer', speak: 'Proceeding by DOM.', display: 'Proceeding by DOM.' },
    ])
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [vision],
    })

    const events = await collect(pipeline, 'look at the page')

    expect(events.find((event) => event.type === 'tool_result' && !event.ok)).toMatchObject({
      error: expect.stringMatching(
        /Vision request timed out after 15000ms[\s\S]*read_page[\s\S]*ask_user/,
      ),
    })
  })

  it('enforces the thirty-call orchestrator vision rail through the real tool execution seam', async () => {
    let executions = 0
    const vision = {
      name: 'analyze_page',
      usesVision: true,
      async execute() {
        executions += 1
        return 'grounded'
      },
    }
    const calls = Array.from({ length: 35 }, (_, index) => ({
      id: `v${index}`,
      name: 'analyze_page',
      args: {},
    }))
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls },
      { kind: 'answer', speak: 'Done.', display: 'Vision bounded.' },
    ])
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [vision],
    })

    const events = await collect(pipeline, 'look at the page')

    expect(executions).toBe(30)
    expect(events.filter((event) => event.type === 'tool_result' && !event.ok)).toHaveLength(5)
    expect(events.find((event) => event.type === 'tool_result' && !event.ok)).toMatchObject({
      error: expect.stringMatching(/vision call limit \(30\)/),
    })
  })

  // The GUI search signature seam (#82): ref facts telling the rail the
  // typed text went into a search box.
  const searchBoxDescribeRef = async () => ({
    ref: 7,
    kind: 'input' as const,
    label: 'Search',
    inputType: null,
    rect: { x: 0, y: 0, width: 200, height: 32 },
    src: null,
    href: null,
    downloadsFile: false,
    submitsForm: false,
    credentialField: false,
    paymentField: false,
    inForm: false,
    formHasCredential: false,
    formHasPayment: false,
    searchField: true,
    formHasSearch: false,
  })

  it('appends the search-loop nudge to the third consecutive similar typed search result (#74/#83)', async () => {
    let executions = 0
    const type = {
      name: 'type',
      async execute() {
        executions += 1
        return 'typed [7]: value="best mechanical keyboards 2026 guide"'
      },
    }
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 't1', name: 'type', args: { ref: 7, text: 'best mechanical keyboards 2026\n' } }] },
      { kind: 'tool_calls', calls: [{ id: 't2', name: 'type', args: { ref: 7, text: 'best mechanical keyboard 2026 reddit\n' } }] },
      { kind: 'tool_calls', calls: [{ id: 't3', name: 'type', args: { ref: 7, text: 'best mechanical keyboards 2026 guide\n' } }] },
      { kind: 'answer', speak: 'Recovered.', display: 'Recovered.' },
    ])
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [type],
      describeRef: searchBoxDescribeRef,
    })

    const events = await collect(pipeline, 'find keyboards')

    expect(executions).toBe(3)
    const results = events.filter((event) => event.type === 'tool_result' && event.ok)
    expect(results[0]).toMatchObject({ result: expect.not.stringMatching(/ask_user/) })
    expect(results[2]).toMatchObject({
      result: expect.stringMatching(/typed \[7\][\s\S]*search box[\s\S]*ask_user/),
    })
    // The nudge rides the tool result into the next model round.
    const lastResult = llm.requests[3].toolResults.at(-1)
    expect(lastResult?.outcome).toMatchObject({ ok: true, result: expect.stringMatching(/ask_user/) })
  })

  it('resets the search-loop streak when another tool intervenes (#74)', async () => {
    const type = {
      name: 'type',
      async execute() {
        return 'typed [7]: value="…"'
      },
    }
    const navigate = {
      name: 'navigate',
      async execute() {
        return 'navigated'
      },
    }
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 't1', name: 'type', args: { ref: 7, text: 'best mechanical keyboards 2026\n' } }] },
      { kind: 'tool_calls', calls: [{ id: 't2', name: 'type', args: { ref: 7, text: 'best mechanical keyboards 2026 reddit\n' } }] },
      { kind: 'tool_calls', calls: [{ id: 'n1', name: 'navigate', args: { url: 'https://example.com/a' } }] },
      { kind: 'tool_calls', calls: [{ id: 't3', name: 'type', args: { ref: 7, text: 'best mechanical keyboards 2026 guide\n' } }] },
      { kind: 'answer', speak: 'Done.', display: 'Done.' },
    ])
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [type, navigate],
      describeRef: searchBoxDescribeRef,
    })

    const events = await collect(pipeline, 'find keyboards')

    expect(
      events.filter((event) => event.type === 'tool_result' && event.ok && typeof event.result === 'string' && event.result.includes('ask_user')),
    ).toHaveLength(0)
  })

  it('keeps the search-loop streak across a failed intervening tool call (#74)', async () => {
    const type = {
      name: 'type',
      async execute() {
        return 'typed [7]: value="…"'
      },
    }
    const failingNavigate = {
      name: 'navigate',
      async execute() {
        throw new Error('navigation failed')
      },
    }
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 't1', name: 'type', args: { ref: 7, text: 'best mechanical keyboards 2026\n' } }] },
      { kind: 'tool_calls', calls: [{ id: 'n1', name: 'navigate', args: { url: 'https://example.com/a' } }] },
      { kind: 'tool_calls', calls: [{ id: 't2', name: 'type', args: { ref: 7, text: 'best mechanical keyboard 2026 reddit\n' } }] },
      { kind: 'tool_calls', calls: [{ id: 't3', name: 'type', args: { ref: 7, text: 'best mechanical keyboards 2026 guide\n' } }] },
      { kind: 'answer', speak: 'Recovered.', display: 'Recovered.' },
    ])
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [type, failingNavigate],
      describeRef: searchBoxDescribeRef,
    })

    const events = await collect(pipeline, 'find keyboards')

    // The failed navigate consumed nothing — the third similar search still
    // nudges (run 46: failing tools + endless reworded searches).
    const nudged = events.filter(
      (event) => event.type === 'tool_result' && event.ok && event.name === 'type' && typeof event.result === 'string' && event.result.includes('ask_user'),
    )
    expect(nudged).toHaveLength(1)
    expect(nudged[0]).toMatchObject({ callId: 't3' })
  })

  it('refuses the search loop at the cap without executing, and the run continues (#74)', async () => {
    let executions = 0
    const type = {
      name: 'type',
      async execute() {
        executions += 1
        return 'typed [7]: value="best mechanical keyboards 2026"'
      },
    }
    const searchRound = (i: number) => ({
      kind: 'tool_calls' as const,
      calls: [{ id: `t${i}`, name: 'type', args: { ref: 7, text: 'best mechanical keyboards 2026\n' } }],
    })
    const llm = new ScriptedLlm([
      ...Array.from({ length: 6 }, (_, i) => searchRound(i)),
      { kind: 'answer', speak: 'Recovered.', display: 'Recovered.' },
    ])
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [type],
      describeRef: searchBoxDescribeRef,
    })

    const events = await collect(pipeline, 'find keyboards')

    // Five similar searches ran; the sixth was refused before execution.
    expect(executions).toBe(5)
    const refusals = events.filter((event) => event.type === 'tool_result' && !event.ok)
    expect(refusals).toHaveLength(1)
    expect(refusals[0]).toMatchObject({
      error: expect.stringMatching(/[Ss]earch loop limit \(5 consecutive similar searches/),
    })
    // A refusal redirects, it never fails the run.
    expect(events.find((event) => event.type === 'error')).toBeUndefined()
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'done' })
  })

  it('chains a q=-carrying navigate into the search streak instead of resetting it (#82)', async () => {
    const type = {
      name: 'type',
      async execute() {
        return 'typed [7]: value="…"'
      },
    }
    const navigate = {
      name: 'navigate',
      async execute() {
        return 'navigated: url=https://www.google.com/search?q=… title="Google Search"'
      },
    }
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 't1', name: 'type', args: { ref: 7, text: 'best mechanical keyboards 2026\n' } }] },
      { kind: 'tool_calls', calls: [{ id: 't2', name: 'type', args: { ref: 7, text: 'best mechanical keyboard 2026 reddit\n' } }] },
      {
        kind: 'tool_calls',
        calls: [{ id: 'n1', name: 'navigate', args: { url: 'https://www.google.com/search?q=best+mechanical+keyboards+2026+guide' } }],
      },
      { kind: 'answer', speak: 'Recovered.', display: 'Recovered.' },
    ])
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [type, navigate],
      describeRef: searchBoxDescribeRef,
    })

    const events = await collect(pipeline, 'find keyboards')

    // The third similar search — via navigate — chains (run 47's invisible
    // reset) and carries the advisory nudge on its result.
    const results = events.filter((event) => event.type === 'tool_result' && event.ok)
    expect(results[0]).toMatchObject({ result: expect.not.stringMatching(/ask_user/) })
    expect(results[2]).toMatchObject({
      callId: 'n1',
      result: expect.stringMatching(/navigated[\s\S]*reword[\s\S]*ask_user/),
    })
  })

  it('chains text typed into a search input into the search streak (#82)', async () => {
    const type = {
      name: 'type',
      async execute() {
        return 'typed [7]: value="…"'
      },
    }
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 't1', name: 'type', args: { ref: 7, text: 'reddit manhwa tier list horizon\n' } }] },
      { kind: 'tool_calls', calls: [{ id: 't2', name: 'type', args: { ref: 7, text: 'reddit manhwa tier list horizon boxer\n' } }] },
      { kind: 'tool_calls', calls: [{ id: 't3', name: 'type', args: { ref: 7, text: 'reddit manhwa tier list 2023\n' } }] },
      { kind: 'answer', speak: 'Recovered.', display: 'Recovered.' },
    ])
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [type],
      describeRef: searchBoxDescribeRef,
    })

    const events = await collect(pipeline, 'find the post')

    const results = events.filter((event) => event.type === 'tool_result' && event.ok)
    expect(results[0]).toMatchObject({ result: expect.not.stringMatching(/ask_user/) })
    expect(results[2]).toMatchObject({
      callId: 't3',
      result: expect.stringMatching(/typed[\s\S]*reword[\s\S]*ask_user/),
    })
  })

  it('refuses same-wall browser calls after a marker rides a result, and the run continues (#80)', async () => {
    const WALLED = 'navigated to https://www.reddit.com/search\nBLOCKER:challenge www.reddit.com\nThis page is a Blocker — a challenge wall.'
    let current: string | null = null
    let navigateRuns = 0
    let clickRuns = 0
    const navigate = {
      name: 'navigate',
      async execute(call: ToolCall) {
        navigateRuns += 1
        const url = typeof call.args.url === 'string' ? call.args.url : ''
        current = hostFromUrl(url) ?? current
        return WALLED
      },
    }
    const click = {
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
      { kind: 'answer', speak: 'Escalated.', display: 'Escalated.' },
    ])
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [navigate, click],
      currentHost: () => current,
    })

    const events = await collect(pipeline, 'find the post')

    // The wall-detecting interaction executed (detection never blocks); the
    // repeated same-wall navigate and click were refused pre-execution.
    expect(navigateRuns).toBe(1)
    expect(clickRuns).toBe(0)
    const refusals = events.filter((event) => event.type === 'tool_result' && !event.ok)
    expect(refusals).toHaveLength(2)
    for (const refusal of refusals) {
      expect(refusal).toMatchObject({
        error: expect.stringMatching(/www\.reddit\.com is walled for this run \(Blocker: challenge\)/),
      })
      expect((refusal as { error: string }).error).toMatch(/ask_user/)
      expect((refusal as { error: string }).error).toMatch(/genuinely different site/)
    }
    // The refusal is a redirect, never a failed run — and the marker line
    // still rides the tool result the model sees.
    expect(events.find((event) => event.type === 'error')).toBeUndefined()
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'done' })
    expect(llm.requests[1].toolResults[0]?.outcome).toMatchObject({
      ok: true,
      result: expect.stringMatching(/BLOCKER:challenge www\.reddit\.com/),
    })
    // The refusals ride the accumulated results into the final round.
    expect(llm.requests[3].toolResults.map((entry) => entry.outcome.ok)).toEqual([true, false, false])
  })

  it('never refuses read_page, look, or ask_user on the walled host (#80)', async () => {
    const WALLED = 'page\nBLOCKER:challenge www.reddit.com\nThis page is a Blocker — a challenge wall.'
    const current = 'www.reddit.com'
    let readRuns = 0
    let lookRuns = 0
    const navigate = {
      name: 'navigate',
      async execute() {
        return WALLED
      },
    }
    const readPage = {
      name: 'read_page',
      async execute() {
        readRuns += 1
        return WALLED
      },
    }
    const look = {
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
      { kind: 'answer', speak: 'Asking for help.', display: 'Asking for help.' },
    ])
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [navigate, readPage, look, createAskUserTool()],
      currentHost: () => current,
    })

    const events = await collect(pipeline, 'find the post', (event, activePipeline) => {
      if (event.type === 'ask_requested') activePipeline.resolveAsk(event.askId, 'Done, I solved it.')
    })

    expect(readRuns).toBe(1)
    expect(lookRuns).toBe(1)
    expect(events.filter((event) => event.type === 'tool_result' && !event.ok)).toHaveLength(0)
    const askResult = events.find((event) => event.type === 'tool_result' && event.name === 'ask_user')
    expect(askResult).toMatchObject({ ok: true, result: 'Done, I solved it.' })
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'done' })
  })

  it('disarms the same-wall gate after a successful different-host interaction (#80)', async () => {
    const WALLED = 'navigated to https://www.reddit.com/search\nBLOCKER:challenge www.reddit.com\nThis page is a Blocker — a challenge wall.'
    let current: string | null = null
    let clickRuns = 0
    const navigate = {
      name: 'navigate',
      async execute(call: ToolCall) {
        const url = typeof call.args.url === 'string' ? call.args.url : ''
        current = hostFromUrl(url) ?? current
        return url.includes('reddit.com') ? WALLED : `navigated to ${url}`
      },
    }
    const click = {
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
      { kind: 'answer', speak: 'Read it elsewhere.', display: 'Read it elsewhere.' },
    ])
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [navigate, click],
      currentHost: () => current,
    })

    const events = await collect(pipeline, 'find the post')

    // Moving on and interacting elsewhere lifts the refusal.
    expect(clickRuns).toBe(1)
    expect(events.filter((event) => event.type === 'tool_result' && !event.ok)).toHaveLength(0)
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'done' })
  })

  it('creates the same-wall gate fresh per run (#80)', async () => {
    const WALLED = 'navigated to https://www.reddit.com/search\nBLOCKER:challenge www.reddit.com\nThis page is a Blocker — a challenge wall.'
    const current = 'www.reddit.com'
    let clickRuns = 0
    const navigate = {
      name: 'navigate',
      async execute() {
        return WALLED
      },
    }
    const click = {
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
      { kind: 'answer', speak: 'Stopped at the wall.', display: 'Stopped at the wall.' },
      // Second run: the same click on the same host starts clear.
      { kind: 'tool_calls', calls: [{ id: 'c2', name: 'click', args: { ref: 1 } }] },
      { kind: 'answer', speak: 'Clicked.', display: 'Clicked.' },
    ])
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [navigate, click],
      currentHost: () => current,
    })

    const firstEvents = await collect(pipeline, 'first command')
    const events = await collect(pipeline, 'second command')

    // Run one refused the click; run two — same pipeline, same tab, same
    // host — executed it: one run's wall never poisons the next.
    expect(clickRuns).toBe(1)
    expect(firstEvents.filter((event) => event.type === 'tool_result' && !event.ok)).toHaveLength(1)
    expect(events.filter((event) => event.type === 'tool_result' && !event.ok)).toHaveLength(0)
  })

  it('refuses a walled-host confirm-tier call before any user-facing confirmation opens (#80)', async () => {
    const WALLED = 'navigated to https://www.reddit.com/search\nBLOCKER:challenge www.reddit.com\nThis page is a Blocker — a challenge wall.'
    const current = 'www.reddit.com'
    let executions = 0
    const navigate = {
      name: 'navigate',
      async execute() {
        return WALLED
      },
    }
    const submitClick = {
      name: 'click',
      assessRisk: () => ({ kind: 'confirm' as const, prompt: 'Click this submit button?' }),
      async execute() {
        executions += 1
        return 'clicked'
      },
    }
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'n1', name: 'navigate', args: { url: 'https://www.reddit.com/search' } }] },
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'click', args: { ref: 9 } }] },
      { kind: 'answer', speak: 'Escalated instead.', display: 'Escalated instead.' },
    ])
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [navigate, submitClick],
      currentHost: () => current,
    })

    const events = await collect(pipeline, 'post the comment')

    expect(executions).toBe(0)
    expect(events.some((event) => event.type === 'confirmation_requested')).toBe(false)
    expect(events.find((event) => event.type === 'tool_result' && !event.ok)).toMatchObject({
      error: expect.stringMatching(/www\.reddit\.com is walled for this run/),
    })
  })

  it('gives every model round the same immutable Journal and Working Memory snapshots', async () => {
    const snapshot = Object.freeze([
      Object.freeze({ runId: 'run-1' as never, outcome: 'done' as const, text: 'Found Pizza A and Pizza B.' }),
    ])
    const memory = Object.freeze([Object.freeze(memoryEntry('memory-1', { provenance: [{ runId: 'run-1' as never }] }))])
    const spinner = { name: 'spin', async execute() { return 'spun' } }
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'spin', args: {} }] },
      { kind: 'answer', speak: 'The second one.', display: 'Pizza B.', runNote: 'Selected Pizza B.' },
    ])
    const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock: new FakeClock(), tools: [spinner] })

    for await (const event of pipeline.execute('what about the second one?', undefined, undefined, {
      snapshot,
      memory,
      commit: () => 'committed',
    })) { void event }

    expect(llm.requests).toHaveLength(2)
    expect(llm.requests[0].journal).toBe(snapshot)
    expect(llm.requests[1].journal).toBe(snapshot)
    expect(llm.requests[0].memory).toBe(memory)
    expect(llm.requests[1].memory).toBe(memory)
  })

  it('resolves delegation memory_ids against this Run\'s immutable snapshot (#98)', async () => {
    const memory: WorkingMemorySnapshot = Object.freeze([Object.freeze(memoryEntry('memory-1'))])
    let seen: unknown
    const delegator: Tool = {
      name: 'delegator',
      async execute(_call, ctx) {
        seen = ctx.selectMemoryEntries?.(['memory-1'])
        return 'selected'
      },
    }
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'delegator', args: {} }] },
      { kind: 'answer', speak: 'Delegated.', display: 'Delegated.' },
    ])
    const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock: new FakeClock(), tools: [delegator] })

    for await (const event of pipeline.execute('delegate with memory', undefined, undefined, {
      snapshot: Object.freeze([]),
      memory,
      commit: () => 'committed',
    })) { void event }

    // The worker receives the run's own frozen entry — not a copy it could
    // mutate, and never entries outside the explicit selection.
    const selected = seen as WorkingMemorySnapshot
    expect(selected).toHaveLength(1)
    expect(selected[0]).toBe(memory[0])
    expect(Object.isFrozen(selected)).toBe(true)
  })

  it('reports an unknown memory id as a failed tool result the model can read (#98)', async () => {
    const memory: WorkingMemorySnapshot = Object.freeze([])
    const delegator: Tool = {
      name: 'delegator',
      async execute(_call, ctx) {
        ctx.selectMemoryEntries?.(['memory-9'])
        return 'never'
      },
    }
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'delegator', args: {} }] },
      { kind: 'answer', speak: 'Noted.', display: 'Noted.' },
    ])
    const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock: new FakeClock(), tools: [delegator] })

    for await (const event of pipeline.execute('delegate with memory', undefined, undefined, {
      snapshot: Object.freeze([]),
      memory,
      commit: () => 'committed',
    })) {
      if (event.type === 'tool_result') {
        expect(event.ok).toBe(false)
        expect(event.error).toMatch(/unknown memory id 'memory-9'/)
      }
    }
  })

  it('offers no memory selection when the run carries no continuity (#98)', async () => {
    let selector: unknown = 'unset'
    const probe: Tool = {
      name: 'probe',
      async execute(_call, ctx) {
        selector = ctx.selectMemoryEntries
        return 'probed'
      },
    }
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'probe', args: {} }] },
      { kind: 'answer', speak: 'Done.', display: 'Done.' },
    ])
    const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock: new FakeClock(), tools: [probe] })

    await collect(pipeline, 'probe')

    expect(selector).toBeUndefined()
  })

  it('commits a valid hidden Run Note immediately before done', async () => {
    const order: string[] = []
    const llm = new ScriptedLlm([
      { kind: 'answer', speak: 'Found two.', display: 'Pizza choices.', runNote: 'Pizza B remains the strongest option.' },
    ])
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [],
    })

    for await (const event of pipeline.execute('find pizza', undefined, undefined, {
      snapshot: Object.freeze([]),
      memory: Object.freeze([]),
      commit: (outcome, note) => {
        order.push(`commit:${outcome}:${note}`)
        return 'committed'
      },
    })) {
      order.push(event.type)
    }

    expect(order.at(-2)).toBe('commit:done:Pizza B remains the strongest option.')
    expect(order.at(-1)).toBe('done')
  })

  it('applies the answer\'s Mishear proposals and observes the transcript (ADR 0022)', async () => {
    const order: string[] = []
    const applied: (readonly unknown[])[] = []
    const transcripts: string[] = []
    const llm = new ScriptedLlm([
      { kind: 'answer', speak: 'Found two.', display: 'Pizza choices.', mishearProposals: [
        { op: 'add', suspect: 'pedal', repair: 'panel' },
        { op: 'remove', term: 'pannel' },
      ] },
    ])
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [],
      learnedTerms: {
        applyProposals: (proposals) => {
          applied.push(proposals)
          order.push('applied')
        },
        observeTranscript: (text) => {
          transcripts.push(text)
          order.push('observed')
        },
      },
    })

    const events: PipelineEvent[] = []
    for await (const event of pipeline.execute('open the pedal please')) events.push(event)

    // The transcript is observed at run start; proposals apply at the same
    // tail as the Memory Commit — before done.
    expect(transcripts).toEqual(['open the pedal please'])
    expect(applied).toEqual([[
      { op: 'add', suspect: 'pedal', repair: 'panel' },
      { op: 'remove', term: 'pannel' },
    ]])
    expect(order).toEqual(['observed', 'applied'])
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'done' })
  })

  it('a failed or malformed-proposal run applies nothing to the lexicon', async () => {
    const applied: number[] = []
    const runs: [string, ScriptedLlm][] = [
      ['boom', new ScriptedLlm([{ kind: 'answer', speak: 'Nope.', display: 'Nope.', mishearProposalsIssue: 'malformed' }])],
    ]
    for (const [command, llm] of runs) {
      const pipeline = createCommandPipeline({
        llm,
        tts: new RecordingTts(),
        clock: new FakeClock(),
        tools: [],
        learnedTerms: { applyProposals: () => applied.push(1), observeTranscript: () => {} },
      })
      for await (const _event of pipeline.execute(command)) void _event
    }
    expect(applied).toEqual([])
  })

  it('preserves the Answer and commits a deterministic fallback when its Run Note is malformed', async () => {
    const degraded: string[] = []
    const commits: string[] = []
    const llm = new ScriptedLlm([
      { kind: 'answer', speak: 'Useful answer.', display: 'Useful detail.', runNoteIssue: 'malformed' },
    ])
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [],
      onContinuityDegraded: (reason) => degraded.push(reason),
    })

    const events: PipelineEvent[] = []
    for await (const event of pipeline.execute('research options', undefined, undefined, {
      snapshot: Object.freeze([]),
      memory: Object.freeze([]),
      commit: (_outcome, note) => {
        commits.push(note)
        return 'committed'
      },
    })) events.push(event)

    expect(events).toContainEqual(expect.objectContaining({ type: 'display', text: 'Useful detail.' }))
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'done' })
    expect(commits).toEqual(['Completed run: research options'])
    expect(degraded).toEqual(['malformed'])
  })

  it('preserves the Answer and retries the atomic commit without an invalid memory patch', async () => {
    const degraded: string[] = []
    const commits: unknown[][] = []
    const pipeline = createCommandPipeline({
      llm: new ScriptedLlm([{
        kind: 'answer',
        speak: 'Useful answer.',
        display: 'Useful detail.',
        runNote: 'Useful note.',
        memoryPatch: [{
          op: 'update',
          id: 'memory-missing' as never,
          entry: { kind: 'decision', subject: 'Choice', detail: 'Choose A.' },
        }],
      }]),
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [],
      onContinuityDegraded: (reason) => degraded.push(reason),
    })

    const eventTypes: string[] = []
    for await (const event of pipeline.execute('choose', undefined, undefined, {
      snapshot: Object.freeze([]),
      memory: Object.freeze([]),
      commit: (outcome, note, patch) => {
        commits.push([outcome, note, patch])
        return commits.length === 1 ? 'invalid_patch' : 'committed'
      },
    })) eventTypes.push(event.type)

    // #85: only the invalid portion is rejected — the valid Run Note
    // survives the retry; the patch alone is dropped.
    expect(commits).toEqual([
      ['done', 'Useful note.', expect.arrayContaining([expect.objectContaining({ op: 'update' })])],
      ['done', 'Useful note.', []],
    ])
    expect(degraded).toEqual(['invalid_memory'])
    expect(eventTypes.at(-1)).toBe('done')
  })

  it('keeps a valid Run Note when the memory patch alone is malformed (#85)', async () => {
    const degraded: string[] = []
    const commits: unknown[][] = []
    const pipeline = createCommandPipeline({
      llm: new ScriptedLlm([{
        kind: 'answer',
        speak: 'Useful answer.',
        display: 'Useful detail.',
        runNote: 'Valid continuity note.',
        memoryPatchIssue: 'malformed',
      }]),
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [],
      onContinuityDegraded: (reason) => degraded.push(reason),
    })

    const eventTypes: string[] = []
    for await (const event of pipeline.execute('research', undefined, undefined, {
      snapshot: Object.freeze([]),
      memory: Object.freeze([]),
      commit: (outcome, note, patch) => {
        commits.push([outcome, note, patch])
        return 'committed'
      },
    })) eventTypes.push(event.type)

    expect(commits).toEqual([['done', 'Valid continuity note.', []]])
    expect(degraded).toEqual(['invalid_memory'])
    expect(eventTypes.at(-1)).toBe('done')
  })

  it('logs and falls back when a successful Answer omits its Run Note', async () => {
    const degraded: string[] = []
    const commits: string[] = []
    const events: string[] = []
    const pipeline = createCommandPipeline({
      llm: new ScriptedLlm([{ kind: 'answer', speak: 'Done.', display: 'Still useful.' }]),
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [],
      onContinuityDegraded: (reason) => {
        degraded.push(reason)
        throw new Error('diagnostic sink failed')
      },
    })

    for await (const event of pipeline.execute('do useful work', undefined, undefined, {
      snapshot: Object.freeze([]),
      memory: Object.freeze([]),
      commit: (_outcome, note) => {
        commits.push(note)
        return 'committed'
      },
    })) events.push(event.type)

    expect(commits).toEqual(['Completed run: do useful work'])
    expect(degraded).toEqual(['missing'])
    expect(events.at(-1)).toBe('done')
  })

  it.each(['failed', 'cancelled'] as const)('commits only a deterministic %s note', async (outcome) => {
    const commits: Array<{ outcome: string; note: string }> = []
    const llm = outcome === 'failed'
      ? new ScriptedLlm([])
      : new ScriptedLlm([{ kind: 'answer', speak: 'Partial.', display: 'Partial.', runNote: 'Unvalidated finding.' }])
    const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock: new FakeClock(), tools: [] })
    if (outcome === 'cancelled') pipeline.abort()

    const iterator = pipeline.execute('attempt task', undefined, undefined, {
      snapshot: Object.freeze([]),
      memory: Object.freeze([]),
      commit: (committedOutcome, note) => {
        commits.push({ outcome: committedOutcome, note })
        return 'committed'
      },
    })[Symbol.asyncIterator]()
    if (outcome === 'cancelled') {
      await iterator.next()
      pipeline.abort()
    }
    while (!(await iterator.next()).done) { /* consume */ }

    expect(commits).toEqual([{
      outcome,
      note: `${outcome === 'failed' ? 'Failed' : 'Cancelled'} run: attempt task`,
    }])
  })
})

describe('command pipeline — turn correlation (#28)', () => {
  const spinner = { name: 'spin', async execute() { return 'spun' } }

  function inMemoryHistoryStore(): HistoryStore & { entries: RecordedEntry[]; runs: RunRecord[] } {
    const entries: RecordedEntry[] = []
    const runs: RunRecord[] = []
    let nextEntryId = 1
    let nextRunId = 1
    return {
      entries,
      runs,
      startSession() {},
      finishSession() {},
      startRun(command, at, turnId, sessionId) {
        const id = nextRunId++
        runs.push({ id, turnId, sessionId, command, startedAt: at, finishedAt: null, outcome: null, effortTier: null, resolution: null, finalizationCause: null })
        return id
      },
      finishRun(runId, outcome, at, finalization) {
        const run = runs.find((candidate) => candidate.id === runId)
        if (run) {
          run.finishedAt = at
          run.outcome = outcome
          run.resolution = finalization?.resolution ?? null
          run.finalizationCause = finalization?.finalizationCause ?? null
        }
      },
      appendEntry(entry) {
        entries.push({ id: nextEntryId++, ...entry })
      },
      recentEntries(limit) {
        return [...entries].slice(-limit)
      },
      recentRuns(limit) {
        return [...runs].slice(-limit)
      },
      recentSessions() {
        return []
      },
      close() {},
    }
  }

  function fullTurnPipeline(): CommandPipeline {
    return createCommandPipeline({
      llm: new ScriptedLlm([
        { kind: 'tool_calls', calls: [{ id: 'c1', name: 'spin', args: {} }] },
        { kind: 'answer', speak: 'Done.', display: 'Done.' },
      ]),
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [spinner],
    })
  }

  /** The turn id of every event, undefined where a stamp is missing. */
  function turnIdsOf(events: PipelineEvent[]): (string | undefined)[] {
    return events.map((event) => ('turnId' in event ? event.turnId : undefined))
  }

  it('stamps the adopted voice turn id on every event of a full turn', async () => {
    const store = inMemoryHistoryStore()
    const recorder = createHistoryRecorder(store, { now: () => 0 })
    const historyRun = recorder.run()
    const events = await collectStamped(fullTurnPipeline(), 'spin it', 'turn-voice-1')

    // The same events the renderer relays and history records — every one
    // of them carries the turn's id, and (as the publisher stamps in
    // production) the Run's Session identity.
    for (const event of events) {
      historyRun.event({ ...event, sessionId: 'session-1' as SessionId })
    }

    expect(events.map((event) => event.type)).toEqual([
      'command', 'status', 'status', 'tool_call', 'tool_result', 'status', 'display', 'status', 'speak', 'done',
    ])
    expect(turnIdsOf(events)).toEqual(Array.from({ length: events.length }, () => 'turn-voice-1'))
    // The history run row adopts the id.
    expect(store.runs[0]).toMatchObject({ turnId: 'turn-voice-1', command: 'spin it', outcome: 'done' })
  })

  it('stamps the turn id on every LLM request of the turn (#29)', async () => {
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'spin', args: {} }] },
      { kind: 'answer', speak: 'Done.', display: 'Done.' },
      { kind: 'answer', speak: 'Done.', display: 'Done.' },
    ])
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [spinner],
    })

    await collectStamped(pipeline, 'spin it', 'turn-voice-1')
    expect(llm.requests.map((request) => request.turnId)).toEqual(['turn-voice-1', 'turn-voice-1'])

    const events = await collectStamped(pipeline, 'typed command')
    expect(llm.requests.map((request) => request.turnId)).toEqual([
      'turn-voice-1',
      'turn-voice-1',
      turnIdsOf(events)[0],
    ])
  })

  it('mints a fresh id for text-box commands — one per turn, stable within it', async () => {
    const pipeline = fullTurnPipeline()

    const first = await collectStamped(pipeline, 'first command')
    const second = await collectStamped(pipeline, 'second command')

    const firstIds = new Set(turnIdsOf(first))
    const secondIds = new Set(turnIdsOf(second))
    expect(firstIds.size).toBe(1)
    expect(secondIds.size).toBe(1)
    const firstId = [...firstIds][0]
    expect(firstId).toMatch(/^turn-/)
    expect([...secondIds][0]).toMatch(/^turn-/)
    expect([...secondIds][0]).not.toBe(firstId)
  })

  it('mints through the injected tracer and never mints when a turn id is adopted', async () => {
    const minted: string[] = []
    const tracer: PerfTracer = {
      mintTurnId: () => {
        minted.push(`turn-tracer-${minted.length + 1}`)
        return minted.at(-1)!
      },
      now: () => 0,
      span: () => {},
      summarize: () => null,
    }
    const pipeline = createCommandPipeline({
      llm: new ScriptedLlm([{ kind: 'answer', speak: 'Done.', display: 'Done.' }]),
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [spinner],
      tracer,
    })

    const textBox = await collectStamped(pipeline, 'typed command')
    expect(minted).toHaveLength(1)
    expect(new Set(turnIdsOf(textBox))).toEqual(new Set([`turn-tracer-1`]))

    await collectStamped(pipeline, 'spoken command', 'turn-voice-adopted')
    expect(minted).toHaveLength(1) // adoption never mints
  })
})

// Tool spans + the run-end summary (#30), observed at the seam the history
// recorder, session memory, and renderer relay use: the test runs a turn
// through the pipeline with a real tracer over an in-memory sink, consumes
// the stamped event stream, then asserts the sink holds one `tool` span per
// gated execution (tool name in detail) and a final synthetic `summary`
// record whose contents match the spans recorded for the same turn.
describe('command pipeline — tool spans and turn summary (#30)', () => {
  /** A tool whose execution costs `ms` of fake monotonic time. */
  function timedTool(name: string, ms: number, state: { monotonicMs: number }, fail = false) {
    return {
      name,
      async execute() {
        state.monotonicMs += ms
        if (fail) throw new Error(`${name} exploded`)
        return `${name} done`
      },
    }
  }

  it('records one tool span per gated execution, tool name in detail, keyed by the turn id', async () => {
    const { records, state, tracer } = fakePerfHarness()
    const pipeline = createCommandPipeline({
      llm: new ScriptedLlm([
        {
          kind: 'tool_calls',
          calls: [
            { id: 'c1', name: 'spin', args: {} },
            { id: 'c2', name: 'twirl', args: {} },
          ],
        },
        { kind: 'answer', speak: 'Done.', display: 'Done.' },
      ]),
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [timedTool('spin', 400, state), timedTool('twirl', 300, state)],
      tracer,
    })

    await collectStamped(pipeline, 'spin and twirl', 'turn-voice-1')

    expect(records.filter((record) => record.stage === 'tool')).toEqual([
      { turnId: 'turn-voice-1', stage: 'tool', durMs: 400, at: 1_700_000_000_000, t: 400, detail: { tool: 'spin' } },
      { turnId: 'turn-voice-1', stage: 'tool', durMs: 300, at: 1_700_000_000_000, t: 700, detail: { tool: 'twirl' } },
    ])
  })

  it('records the tool span even when the execution fails — the time was spent', async () => {
    const { records, state, tracer } = fakePerfHarness()
    const pipeline = createCommandPipeline({
      llm: new ScriptedLlm([
        { kind: 'tool_calls', calls: [{ id: 'c1', name: 'bang', args: {} }] },
        { kind: 'answer', speak: 'It broke.', display: 'It broke.' },
      ]),
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [timedTool('bang', 250, state, true)],
      tracer,
    })

    const events = await collectStamped(pipeline, 'try it', 'turn-voice-1')

    expect(events.find((event) => event.type === 'tool_result')).toMatchObject({ ok: false, error: 'bang exploded' })
    expect(records.filter((record) => record.stage === 'tool')).toEqual([
      { turnId: 'turn-voice-1', stage: 'tool', durMs: 250, at: 1_700_000_000_000, t: 250, detail: { tool: 'bang' } },
    ])
  })

  it('records no tool span when the call never executes — unknown or hard-denied', async () => {
    const { records, tracer } = fakePerfHarness()
    const denied = {
      name: 'wipe',
      async assessRisk() {
        return { kind: 'deny' as const, reason: 'destructive' }
      },
      async execute() {
        throw new Error('must never run')
      },
    }
    const pipeline = createCommandPipeline({
      llm: new ScriptedLlm([
        {
          kind: 'tool_calls',
          calls: [
            { id: 'c1', name: 'ghost', args: {} },
            { id: 'c2', name: 'wipe', args: {} },
          ],
        },
        { kind: 'answer', speak: 'Done.', display: 'Done.' },
      ]),
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [denied],
      tracer,
    })

    const events = await collectStamped(pipeline, 'do both', 'turn-voice-1')

    expect(events.filter((event) => event.type === 'tool_result').map((event) => event.ok)).toEqual([false, false])
    expect(records.filter((record) => record.stage === 'tool')).toEqual([])
  })

  // Verbose browser sub-spans (#32): the tool gate opens the channel's turn
  // scope around each gated execution, so a controller emitting inside a
  // browser tool keys its sub-spans to this turn's id — without the channel
  // dep, nothing changes.
  it('opens the browser sub-span turn scope around gated tool executions', async () => {
    const { records, state, tracer } = fakePerfHarness()
    const subspans = createBrowserSubspans({ tracer, enabled: true })
    const probe = {
      name: 'poke',
      async execute() {
        state.monotonicMs += 120
        subspans.emit('browser-settle', 120, { action: 'click', ms: 90 })
        return 'poked'
      },
    }
    const pipeline = createCommandPipeline({
      llm: new ScriptedLlm([
        { kind: 'tool_calls', calls: [{ id: 'c1', name: 'poke', args: {} }] },
        { kind: 'answer', speak: 'Done.', display: 'Done.' },
      ]),
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [probe],
      tracer,
      browserSubspans: subspans,
    })

    await collectStamped(pipeline, 'poke it', 'turn-voice-1')

    expect(records.filter((record) => record.stage === 'browser-settle')).toEqual([
      { turnId: 'turn-voice-1', stage: 'browser-settle', durMs: 120, at: 1_700_000_000_000, t: 120, detail: { action: 'click', ms: 90 } },
    ])
  })

  it('runs tools unchanged when no browser sub-span channel is wired', async () => {
    const { records, tracer } = fakePerfHarness()
    const probe = {
      name: 'poke',
      async execute() {
        // No scope is open without the channel; a stray emit (a controller
        // wired to some other channel instance) would record nothing anyway.
        return 'poked'
      },
    }
    const pipeline = createCommandPipeline({
      llm: new ScriptedLlm([
        { kind: 'tool_calls', calls: [{ id: 'c1', name: 'poke', args: {} }] },
        { kind: 'answer', speak: 'Done.', display: 'Done.' },
      ]),
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [probe],
      tracer,
    })

    const events = await collectStamped(pipeline, 'poke it', 'turn-voice-1')

    expect(events.find((event) => event.type === 'tool_result')).toMatchObject({ ok: true })
    expect(records.filter((record) => record.stage === 'browser-settle')).toEqual([])
  })

  it('at run end, stores a synthetic summary event matching the turn’s spans and prints the one-line summary', async () => {
    const { records, state, tracer } = fakePerfHarness()
    const printed: string[] = []
    // The voice session's half of the turn: the STT span lands before the
    // pipeline ever runs, keyed by the same adopted id.
    tracer.span('turn-voice-1', 'stt', 6_900, { speechMs: 2_000, totalMs: 2_400, truncated: false })
    state.monotonicMs = 6_900
    const rounds: AssistantTurn[] = [
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'spin', args: {} }] },
      { kind: 'answer', speak: 'Done.', display: 'Done.' },
    ]
    // llm spans arrive through the #29 wrapper — the summary composes with
    // whatever stages the turn recorded, wherever they were measured.
    const llm = withPerfTracing(
      {
        async complete() {
          state.monotonicMs += 200
          return rounds.shift()!
        },
      },
      tracer,
    )
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [timedTool('spin', 400, state)],
      tracer,
      printSummary: (line) => printed.push(line),
    })

    const events = await collectStamped(pipeline, 'spin it', 'turn-voice-1')

    expect(events.at(-1)).toMatchObject({ type: 'done', turnId: 'turn-voice-1' })
    expect(records.at(-1)).toEqual({
      turnId: 'turn-voice-1',
      stage: 'summary',
      durMs: 7_700,
      at: 1_700_000_000_000,
      t: 7_700,
      detail: {
        stages: {
          stt: { count: 1, durMs: 6_900 },
          llm: { count: 2, durMs: 400 },
          tool: { count: 1, durMs: 400 },
        },
      },
    })
    // The same data, human-readable: every stage kind and the total.
    expect(printed).toEqual(['stt 6.9s | llm(n=2) 0.4s | tool 0.4s | total 7.7s'])
  })

  it('a turn that recorded no spans stores no summary event and prints nothing', async () => {
    const { records, tracer } = fakePerfHarness()
    const printed: string[] = []
    const pipeline = createCommandPipeline({
      llm: new ScriptedLlm([{ kind: 'answer', speak: 'Hi.', display: 'Hi.' }]),
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [],
      tracer,
      printSummary: (line) => printed.push(line),
    })

    await collectStamped(pipeline, 'hello', 'turn-voice-1')

    expect(records).toEqual([])
    expect(printed).toEqual([])
  })

  it('bookkeeping never breaks a run — a throwing sink still yields the done event', async () => {
    const { state } = fakePerfHarness()
    const tracer = createPerfTracer({
      sink: {
        write() {
          throw new Error('disk full')
        },
      },
      clock: { monotonic: () => state.monotonicMs, wall: () => 0 },
    })
    const pipeline = createCommandPipeline({
      llm: new ScriptedLlm([
        { kind: 'tool_calls', calls: [{ id: 'c1', name: 'spin', args: {} }] },
        { kind: 'answer', speak: 'Done.', display: 'Done.' },
      ]),
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [timedTool('spin', 100, state)],
      tracer,
    })

    const events = await collectStamped(pipeline, 'spin it', 'turn-voice-1')

    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'done' })
  })
})

// The turn-keying half of the TTS span split (#31): spoken lines of a turn
// ride the turn id through speakLine into the shared coordinator, so the
// synthesis/playback spans land keyed by the same adopted id the rest of
// the turn's spans carry — and the run-end summary composes them.
describe('command pipeline — spoken-line tts spans (#31)', () => {
  /** Synth/player doubles over the harness clock: rendering costs `synthMs`, speaking costs `playMs`. */
  function timedCoordinator(
    state: { monotonicMs: number },
    tracer: ReturnType<typeof fakePerfHarness>['tracer'],
    synthMs: number,
    playMs: number,
  ) {
    return createSpeechCoordinator({
      synth: {
        async synthesize() {
          state.monotonicMs += synthMs
          return new Uint8Array([1])
        },
      },
      player: {
        play() {
          let resolveDone!: () => void
          const done = new Promise<void>((resolve) => {
            resolveDone = resolve
          })
          // Speaking time passes while done is pending, not inside play().
          queueMicrotask(() => {
            state.monotonicMs += playMs
            resolveDone()
          })
          return { done, stop: () => resolveDone() }
        },
      },
      tracer,
    })
  }

  it('keys the spoken answer’s synthesis and playback spans to the turn id, composed into the run summary', async () => {
    const { records, state, tracer } = fakePerfHarness()
    const pipeline = createCommandPipeline({
      llm: new ScriptedLlm([{ kind: 'answer', speak: 'Done.', display: 'Done.' }]),
      tts: timedCoordinator(state, tracer, 100, 400),
      clock: new FakeClock(),
      tools: [],
      tracer,
    })

    const events = await collectStamped(pipeline, 'hello', 'turn-voice-1')

    expect(events.at(-1)).toMatchObject({ type: 'done', turnId: 'turn-voice-1' })
    expect(records).toEqual([
      { turnId: 'turn-voice-1', stage: 'tts-synthesis', durMs: 100, at: 1_700_000_000_000, t: 100 },
      { turnId: 'turn-voice-1', stage: 'tts-playback', durMs: 400, at: 1_700_000_000_000, t: 500 },
      {
        turnId: 'turn-voice-1',
        stage: 'summary',
        durMs: 500,
        at: 1_700_000_000_000,
        t: 500,
        detail: { stages: { 'tts-synthesis': { count: 1, durMs: 100 }, 'tts-playback': { count: 1, durMs: 400 } } },
      },
    ])
  })

  it('keys the spoken error line to the turn as well', async () => {
    const { records, state, tracer } = fakePerfHarness()
    const pipeline = createCommandPipeline({
      llm: new ScriptedLlm([]), // runs dry → the failure path speaks a one-liner
      tts: timedCoordinator(state, tracer, 50, 150),
      clock: new FakeClock(),
      tools: [],
      tracer,
    })

    await collectStamped(pipeline, 'boom', 'turn-voice-1')

    const lineSpans = records.filter((record) => record.stage !== 'summary')
    expect(lineSpans.map((record) => record.stage)).toEqual(['tts-synthesis', 'tts-playback'])
    expect(lineSpans.every((record) => record.turnId === 'turn-voice-1')).toBe(true)
  })

  it('keys the stopped acknowledgement to the turn when a run is aborted', async () => {
    const { records, state, tracer } = fakePerfHarness()
    const turn = deferred<AssistantTurn>()
    const llm: LlmClient = { complete: () => turn.promise }
    const pipeline = createCommandPipeline({
      llm,
      tts: timedCoordinator(state, tracer, 50, 150),
      clock: new FakeClock(),
      tools: [],
      tracer,
    })

    const run = collectStamped(pipeline, 'keep working', 'turn-voice-1')
    await flush()
    pipeline.abort()
    turn.resolve({ kind: 'answer', speak: 'Stale answer.', display: 'Stale answer.' })
    const events = await run

    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'cancelled', turnId: 'turn-voice-1' })
    const lineSpans = records.filter((record) => record.stage !== 'summary')
    expect(lineSpans.map((record) => record.stage)).toEqual(['tts-synthesis', 'tts-playback'])
    expect(lineSpans.every((record) => record.turnId === 'turn-voice-1')).toBe(true)
  })
})

describe('progress detail (#43)', () => {
  it('surfaces an empty-completion retry on the detail channel before the next attempt starts', async () => {
    const sink: PipelineEvent[] = []
    // The double stands where the provider's retry loop stands: the hook
    // fires mid-complete(), the round is still in flight. What the sink
    // holds at that moment is what the dashboard sees before the next
    // attempt starts.
    let sinkAtHook: PipelineEvent[] = []
    const llm: LlmClient = {
      async complete(request) {
        request.onRetryAttempt?.(2, 3)
        sinkAtHook = [...sink]
        return { kind: 'answer', speak: 'Done.', display: 'Done.' }
      },
    }
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [],
      emitDetail: (event) => sink.push(event),
    })

    const events = await collectStamped(pipeline, 'work', 'turn-r')

    expect(sinkAtHook).toEqual([{ type: 'llm_retry', turnId: 'turn-r', attempt: 2, maxAttempts: 3, at: 0 }])
    // The side channel is the only transport — never duplicated into the
    // generator's own stream.
    expect(sink).toEqual(sinkAtHook)
    expect(events.some((event) => event.type === 'llm_retry')).toBe(false)
  })

  it('names what the run is waiting on while agent_results blocks', async () => {
    const sink: PipelineEvent[] = []
    let sinkAtResults: PipelineEvent[] = []
    const manager = fakeSubagentManager([subagentRecord('a-1'), subagentRecord('a-2')], {
      results: async () => {
        sinkAtResults = [...sink]
        return 'agent reports'
      },
    })
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'agent_results', args: { wait: true } }] },
      { kind: 'answer', speak: 'Done.', display: 'Done.' },
    ])
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: createSubagentTools(manager),
      emitDetail: (event) => sink.push(event),
    })

    const events = await collectStamped(pipeline, 'collect', 'turn-w')

    expect(sinkAtResults).toEqual([{ type: 'waiting_on_agents', turnId: 'turn-w', running: 2, at: 0 }])
    expect(sink).toEqual(sinkAtResults)
    expect(events.some((event) => event.type === 'waiting_on_agents')).toBe(false)
  })

  it('stays silent when agent_results waits on nothing, or does not wait', async () => {
    const sink: PipelineEvent[] = []
    const manager = fakeSubagentManager([subagentRecord('a-1', 'completed')])
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'agent_results', args: { wait: true } }] },
      { kind: 'tool_calls', calls: [{ id: 'c2', name: 'agent_results', args: {} }] },
      { kind: 'answer', speak: 'Done.', display: 'Done.' },
    ])
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: createSubagentTools(manager),
      emitDetail: (event) => sink.push(event),
    })

    await collect(pipeline, 'collect')

    expect(sink).toEqual([])
  })

  it('joins the detail channel into the stream in delivery order — FIFO, one channel', async () => {
    const merged: PipelineEvent[] = []
    const llm: LlmClient = {
      async complete(request) {
        request.onRetryAttempt?.(2, 3)
        return { kind: 'answer', speak: 'Done.', display: 'Done.' }
      },
    }
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [],
      emitDetail: (event) => merged.push(event),
    })

    // Generator events and detail events land in one log at the moment of
    // delivery: detail only fires while the generator is parked mid-await,
    // so the joined sequence is the sequence the renderer receives.
    for await (const event of pipeline.execute('work', 'turn-o')) merged.push(event)

    expect(merged.map((event) => event.type)).toEqual([
      'command',
      'status',
      'llm_retry',
      'display',
      'status',
      'speak',
      'done',
    ])
  })

  it('keeps the orb states unchanged — detail rides beside, not through, the status events', async () => {
    const sink: PipelineEvent[] = []
    const llm: LlmClient = {
      async complete(request) {
        request.onRetryAttempt?.(3, 3)
        return { kind: 'answer', speak: 'Done.', display: 'Done.' }
      },
    }
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [],
      emitDetail: (event) => sink.push(event),
    })

    const events = await collect(pipeline, 'work')

    const statuses = events.filter((event) => event.type === 'status')
    expect(statuses).toEqual([
      { type: 'status', status: 'thinking', at: 0 },
      { type: 'status', status: 'speaking', at: 0 },
    ])
    expect(sink.map((event) => event.type)).toEqual(['llm_retry'])
  })
})

describe('orchestrator streaming (#47)', () => {
  it('flushes batched answer and reasoning deltas onto the detail channel while the round is in flight', async () => {
    const clock = new FakeClock()
    const sink: PipelineEvent[] = []
    let sinkMidRound: PipelineEvent[] = []
    const release = deferred<void>()
    const llm: LlmClient = {
      async complete(request) {
        request.onDelta?.({ kind: 'reasoning', text: 'the user wants ' })
        request.onDelta?.({ kind: 'reasoning', text: 'music' })
        request.onDelta?.({ kind: 'text', text: '{"speak":"Done. ' })
        // A window closes mid-round — batched flush, not per fragment.
        clock.advance(DELTA_FLUSH_MS)
        request.onDelta?.({ kind: 'text', text: 'Playing.' })
        sinkMidRound = [...sink]
        await release.promise
        return { kind: 'answer', speak: 'Done. Playing.', display: 'Done. Playing.' }
      },
    }
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock,
      tools: [],
      emitDetail: (event) => sink.push(event),
    })

    const run = collectStamped(pipeline, 'play something', 'turn-s')
    await waitUntil(() => sinkMidRound.length > 0)
    // Window one: reasoning raw, answer as its visible part — batched
    // into one fragment per kind, stamped with the turn id.
    expect(sinkMidRound).toEqual([
      { type: 'llm_delta', turnId: 'turn-s', kind: 'reasoning', text: 'the user wants music', at: DELTA_FLUSH_MS },
      { type: 'llm_delta', turnId: 'turn-s', kind: 'text', text: 'Done. ', at: DELTA_FLUSH_MS },
    ])

    clock.advance(DELTA_FLUSH_MS)
    release.resolve(undefined)
    const events = await run

    expect(sunkTexts(sink)).toEqual(['the user wants music', 'Done. ', 'Playing.'])
    // The side channel is the only transport — never the generator's own.
    expect(events.some((event) => event.type === 'llm_delta')).toBe(false)
  })

  it('drains the tail at round end before the display event lands', async () => {
    const clock = new FakeClock()
    const merged: PipelineEvent[] = []
    const llm: LlmClient = {
      async complete(request) {
        request.onDelta?.({ kind: 'text', text: '{"speak":"Tail.' })
        // No window ever closes mid-round; only the round-end drain
        // carries the fragment.
        return { kind: 'answer', speak: 'Tail.', display: 'Tail.' }
      },
    }
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock,
      tools: [],
      emitDetail: (event) => merged.push(event),
    })

    for await (const event of pipeline.execute('work', 'turn-t')) merged.push(event)

    expect(merged.map((event) => event.type)).toEqual([
      'command',
      'status',
      'llm_delta',
      'display',
      'status',
      'speak',
      'done',
    ])
    expect(merged[2]).toMatchObject({ type: 'llm_delta', kind: 'text', text: 'Tail.', at: 0 })
  })

  it('resets the stream between rounds — each round flushes only its own fragments', async () => {
    const clock = new FakeClock()
    const sink: PipelineEvent[] = []
    const llm: LlmClient = {
      async complete(request) {
        request.onDelta?.({ kind: 'text', text: request.toolResults.length === 0 ? '{"speak":"Rou' : 'nd two.' })
        return request.toolResults.length === 0
          ? { kind: 'tool_calls', calls: [{ id: 'c1', name: 'noop_tool', args: {} }] }
          : { kind: 'answer', speak: 'Round two.', display: 'Round two.' }
      },
    }
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock,
      tools: [{ name: 'noop_tool', async execute() { return 'ok' } }],
      emitDetail: (event) => sink.push(event),
    })

    await collect(pipeline, 'two rounds')

    expect(sunkTexts(sink)).toEqual(['Rou', 'nd two.'])
  })

  it('passes an abort signal with each round; Stop aborts it and the run cancels without waiting', async () => {
    const clock = new FakeClock()
    const signals: AbortSignal[] = []
    const llm: LlmClient = {
      complete(request) {
        signals.push(request.signal!)
        return new Promise((_resolve, reject) => {
          request.signal?.addEventListener('abort', () => {
            // What a real fetch rejection looks like.
            const err = new Error('This operation was aborted')
            err.name = 'AbortError'
            reject(err)
          })
        })
      },
    }
    const tts = new RecordingTts()
    const pipeline = createCommandPipeline({
      llm,
      tts,
      clock,
      tools: [],
      emitDetail: () => {},
    })

    const run = collect(pipeline, 'long round')
    await waitUntil(() => signals.length === 1)
    expect(signals[0]!.aborted).toBe(false)

    pipeline.abort()
    // The signal flips synchronously — the in-flight request is cancelled
    // immediately, not at the next checkpoint.
    expect(signals[0]!.aborted).toBe(true)
    const events = await run

    expect(pipeline.getState()).toBe('idle')
    expect(events.filter((event) => event.type === 'status').at(-1)).toMatchObject({ status: 'cancelled' })
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'cancelled' })
    expect(events.some((event) => event.type === 'error')).toBe(false)
  })

  it('drains the failed attempt\'s partial stream before a retry — fragments never concatenate across attempts', async () => {
    const sink: PipelineEvent[] = []
    const llm: LlmClient = {
      async complete(request) {
        request.onDelta?.({ kind: 'text', text: '{"speak":"Attempt one.' })
        request.onRetryAttempt?.(2, 3)
        request.onDelta?.({ kind: 'text', text: '{"speak":"Attempt two.' })
        return { kind: 'answer', speak: 'Attempt two.', display: 'Attempt two.' }
      },
    }
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [],
      emitDetail: (event) => sink.push(event),
    })

    await collect(pipeline, 'work')

    // Attempt one's partial closes as its own run ahead of the retry line;
    // attempt two streams fresh — no cross-attempt junk fragment.
    expect(sink.map((event) => (event.type === 'llm_delta' ? `${event.kind}:${event.text}` : event.type))).toEqual([
      'text:Attempt one.',
      'llm_retry',
      'text:Attempt two.',
    ])
  })

  it('keeps the request non-streaming when no detail sink is wired', async () => {
    const seen: LlmRequest[] = []
    const llm: LlmClient = {
      async complete(request) {
        seen.push(request)
        return { kind: 'answer', speak: 'Done.', display: 'Done.' }
      },
    }
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [],
    })

    await collect(pipeline, 'work')

    expect(seen[0]!.onDelta).toBeUndefined()
    // The abort signal rides regardless — Stop must always reach the
    // in-flight request.
    expect(seen[0]!.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('tool-call intent (#48)', () => {
  it('flushes intent onto the detail channel while the round is in flight — before the tool executes', async () => {
    const clock = new FakeClock()
    const sink: PipelineEvent[] = []
    let sinkMidRound: PipelineEvent[] = []
    const release = deferred<void>()
    const llm: LlmClient = {
      async complete(request) {
        if (request.toolResults.length > 0) return { kind: 'answer', speak: 'Done.', display: 'Done.' }
        request.onDelta?.({ kind: 'reasoning', text: 'the user wants youtube' })
        request.onDelta?.({ kind: 'tool_intent', index: 0, name: 'web_search', args: '{"query":"mech' })
        request.onDelta?.({ kind: 'tool_intent', index: 0, name: 'web_search', args: '{"query":"mechanical keyboards"}' })
        clock.advance(DELTA_FLUSH_MS)
        sinkMidRound = [...sink]
        await release.promise
        return { kind: 'tool_calls', calls: [{ id: 'c1', name: 'noop_tool', args: {} }] }
      },
    }
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock,
      tools: [{ name: 'noop_tool', async execute() { return 'ok' } }],
      emitDetail: (event) => sink.push(event),
    })

    const run = collectStamped(pipeline, 'search keyboards', 'turn-i')
    await waitUntil(() => sinkMidRound.length > 0)
    // Mid-round: the latest snapshot per index, batched into one flush —
    // the tool has not executed (the round has not even finished).
    expect(sinkMidRound).toEqual([
      { type: 'llm_delta', turnId: 'turn-i', kind: 'reasoning', text: 'the user wants youtube', at: DELTA_FLUSH_MS },
      { type: 'llm_tool_intent', turnId: 'turn-i', index: 0, name: 'web_search', args: '{"query":"mechanical keyboards"}', at: DELTA_FLUSH_MS },
    ])

    release.resolve(undefined)
    const events = await run

    // The round really executed the tool; the side channel is the only
    // transport — never the generator's own.
    expect(events.some((event) => event.type === 'tool_call')).toBe(true)
    expect(events.some((event) => event.type === 'llm_tool_intent')).toBe(false)
  })

  it('drains a pending intent at round end so the feed still shows the direction before the tool line', async () => {
    const clock = new FakeClock()
    const sink: PipelineEvent[] = []
    const llm: LlmClient = {
      async complete(request) {
        if (request.toolResults.length > 0) return { kind: 'answer', speak: 'Done.', display: 'Done.' }
        request.onDelta?.({ kind: 'tool_intent', index: 0, name: 'click', args: '{"ref":"Search"}' })
        // No window closes mid-round; only the round-end drain carries it.
        return { kind: 'tool_calls', calls: [{ id: 'c1', name: 'noop_tool', args: {} }] }
      },
    }
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock,
      tools: [{ name: 'noop_tool', async execute() { return 'ok' } }],
      emitDetail: (event) => sink.push(event),
    })

    await collect(pipeline, 'click it')

    expect(sink.filter((event) => event.type === 'llm_tool_intent')).toEqual([
      { type: 'llm_tool_intent', turnId: expect.any(String), index: 0, name: 'click', args: '{"ref":"Search"}', at: 0 },
    ])
  })

  it('emits no intent events when the model streams no tool calls', async () => {
    const clock = new FakeClock()
    const sink: PipelineEvent[] = []
    const llm: LlmClient = {
      async complete(request) {
        request.onDelta?.({ kind: 'text', text: '{"speak":"Done.","display":"Done."}' })
        clock.advance(DELTA_FLUSH_MS)
        return { kind: 'answer', speak: 'Done.', display: 'Done.' }
      },
    }
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock,
      tools: [],
      emitDetail: (event) => sink.push(event),
    })

    await collect(pipeline, 'work')

    expect(sink.some((event) => event.type === 'llm_tool_intent')).toBe(false)
  })
})

function sunkTexts(sink: PipelineEvent[]): string[] {
  return sink.flatMap((event) => (event.type === 'llm_delta' ? [event.text] : []))
}

describe('typed steering (#46)', () => {
  it('steers a running run mid-round: the directive rides the next model call, stale tools never execute', async () => {
    const firstTurn = deferred<AssistantTurn>()
    const requests: LlmRequest[] = []
    const llm: LlmClient = {
      async complete(request) {
        requests.push(request)
        if (requests.length === 1) return firstTurn.promise
        return { kind: 'answer', speak: 'Changed course.', display: 'Using the typed steering.' }
      },
    }
    let executions = 0
    const staleTool = {
      name: 'stale_action',
      async execute() {
        executions += 1
        return 'should not run'
      },
    }
    const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock: new FakeClock(), tools: [staleTool] })

    const run = collect(pipeline, 'original command')
    await waitUntil(() => requests.length === 1)
    expect(pipeline.getState()).toBe('running')

    // The typed box: one submit, no spoken "hold on" first — the pause (if
    // needed) rides inside the steer.
    expect(steerPipeline(pipeline, '  Use Paris instead.  ')).toBe(true)
    firstTurn.resolve({ kind: 'tool_calls', calls: [{ id: 'stale', name: 'stale_action', args: {} }] })
    const events = await run

    expect(executions).toBe(0)
    expect(requests).toHaveLength(2)
    expect(requests[1]!.steering).toBe('Use Paris instead.')
    expect(events).toContainEqual({ type: 'display', text: 'Using the typed steering.', at: 0 })
    // The pause-and-resume is one atomic steer: no paused status surfaces.
    expect(events.some((event) => event.type === 'status' && event.status === 'paused')).toBe(false)
  })

  it('steers an already-paused run through the same seam as the spoken path', async () => {
    const firstTurn = deferred<AssistantTurn>()
    const requests: LlmRequest[] = []
    const llm: LlmClient = {
      async complete(request) {
        requests.push(request)
        if (requests.length === 1) return firstTurn.promise
        return { kind: 'answer', speak: 'Redirected.', display: 'Used the typed steering.' }
      },
    }
    let executions = 0
    const staleTool = {
      name: 'stale_action',
      async execute() {
        executions += 1
        return 'should not run'
      },
    }
    const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock: new FakeClock(), tools: [staleTool] })

    const run = collect(pipeline, 'original command')
    await waitUntil(() => requests.length === 1)
    pipeline.pause()
    firstTurn.resolve({ kind: 'tool_calls', calls: [{ id: 'stale', name: 'stale_action', args: {} }] })
    await waitUntil(() => pipeline.getState() === 'paused')

    expect(steerPipeline(pipeline, 'Use Paris instead.')).toBe(true)
    await run

    expect(executions).toBe(0)
    expect(requests[1]!.steering).toBe('Use Paris instead.')
  })

  it('settles a pending confirmation as steered and cancels the not-yet-executed call', async () => {
    let executions = 0
    const riskyTool = {
      name: 'submit_form',
      assessRisk: () => ({ kind: 'confirm' as const, prompt: 'Submit this form?' }),
      async execute() {
        executions += 1
        return 'submitted'
      },
    }
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'submit_form', args: {} }] },
      { kind: 'answer', speak: 'Redirected.', display: 'Used the typed steering.' },
    ])
    const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock: new FakeClock(), tools: [riskyTool] })

    const steered: boolean[] = []
    const events = await collect(pipeline, 'submit it', (event, activePipeline) => {
      if (event.type === 'confirmation_requested') {
        steered.push(steerPipeline(activePipeline, 'Use Paris instead.'))
      }
    })

    expect(steered).toEqual([true])
    expect(executions).toBe(0)
    expect(events).toContainEqual({
      type: 'confirmation_resolved',
      confirmationId: 'confirm-1',
      approved: false,
      reason: 'steered',
      at: 0,
    })
    expect(llm.requests[1]?.steering).toBe('Use Paris instead.')
  })

  it('refuses to steer without an active run, and drops blank directives mid-run', async () => {
    const firstTurn = deferred<AssistantTurn>()
    const requests: LlmRequest[] = []
    const llm: LlmClient = {
      async complete(request) {
        requests.push(request)
        if (requests.length === 1) return firstTurn.promise
        return { kind: 'answer', speak: 'Done.', display: 'Done.' }
      },
    }
    const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock: new FakeClock(), tools: [] })

    // Idle: never silently take input.
    expect(steerPipeline(pipeline, 'Use Paris instead.')).toBe(false)

    const run = collect(pipeline, 'go')
    await waitUntil(() => requests.length === 1)
    expect(steerPipeline(pipeline, '   ')).toBe(false)
    expect(pipeline.getState()).toBe('running')
    firstTurn.resolve({ kind: 'answer', speak: 'Done.', display: 'Done.' })
    await run

    // The refused blank never queued a directive or a re-ask.
    expect(requests).toHaveLength(1)
    expect(steerPipeline(pipeline, 'Use Paris instead.')).toBe(false)
  })

  it('refuses to steer a run that is aborting — never claims a dropped directive', async () => {
    const firstTurn = deferred<AssistantTurn>()
    const requests: LlmRequest[] = []
    const llm: LlmClient = {
      async complete(request) {
        requests.push(request)
        return firstTurn.promise
      },
    }
    const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock: new FakeClock(), tools: [] })

    const run = collect(pipeline, 'go')
    await waitUntil(() => requests.length === 1)
    // Abort winds down while the model round is still in flight: state
    // still reads 'running', but nothing may be taken anymore.
    pipeline.abort()
    expect(steerPipeline(pipeline, 'Use Paris instead.')).toBe(false)
    firstTurn.resolve({ kind: 'answer', speak: 'Stale.', display: 'Stale.' })
    await run

    expect(requests[0]!.steering).toBeUndefined()
    expect(requests).toHaveLength(1)
  })

  it('echoes the received directive on the detail channel — turn-stamped, before the steered round lands', async () => {
    const merged: PipelineEvent[] = []
    const firstTurn = deferred<AssistantTurn>()
    const requests: LlmRequest[] = []
    const llm: LlmClient = {
      async complete(request) {
        requests.push(request)
        if (requests.length === 1) return firstTurn.promise
        return { kind: 'answer', speak: 'Changed course.', display: 'Using the steering.' }
      },
    }
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [],
      emitDetail: (event) => merged.push(event),
    })

    const run = (async () => {
      for await (const event of pipeline.execute('go', 'turn-s')) merged.push(event)
    })()
    await waitUntil(() => requests.length === 1)
    steerPipeline(pipeline, 'Use Paris instead.')
    firstTurn.resolve({ kind: 'answer', speak: 'Stale answer.', display: 'Stale.' })
    await run

    // One channel, delivery order: the echo arrives after the in-flight
    // round's events and before the steered round's — exactly what the
    // renderer receives.
    expect(merged.map((event) => event.type)).toEqual([
      'command',
      'status',
      'steer',
      'display',
      'status',
      'speak',
      'done',
    ])
    expect(merged[2]).toEqual({ type: 'steer', turnId: 'turn-s', text: 'Use Paris instead.', at: 0 })
  })

  it('echoes the spoken steering path identically — one seam, both entry points', async () => {
    const sink: PipelineEvent[] = []
    const firstTurn = deferred<AssistantTurn>()
    const requests: LlmRequest[] = []
    const llm: LlmClient = {
      async complete(request) {
        requests.push(request)
        if (requests.length === 1) return firstTurn.promise
        return { kind: 'answer', speak: 'Changed course.', display: 'Using the steering.' }
      },
    }
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [],
      emitDetail: (event) => sink.push(event),
    })

    const run = collect(pipeline, 'go')
    await waitUntil(() => requests.length === 1)
    pipeline.pause()
    firstTurn.resolve({ kind: 'tool_calls', calls: [{ id: 'stale', name: 'noop', args: {} }] })
    await waitUntil(() => pipeline.getState() === 'paused')
    pipeline.resume('Use Paris instead.')
    await run

    expect(sink).toEqual([{ type: 'steer', turnId: expect.any(String), text: 'Use Paris instead.', at: 0 }])
    expect(requests[1]!.steering).toBe('Use Paris instead.')
  })
})

describe('command pipeline — session reset (#99)', () => {
  /** The model-invoked Session Reset boundary, as the real tool declares it. */
  const newSessionTool = {
    name: 'new_session',
    sessionReset: true,
    async execute() {
      return 'Session reset: previous commands and answers are gone.'
    },
  }
  let executions = 0
  const spinner = {
    name: 'spin',
    async execute() {
      executions += 1
      return 'spun'
    },
  }

  function resetPipeline(script: AssistantTurn[]): CommandPipeline {
    return createCommandPipeline({
      llm: new ScriptedLlm(script),
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [newSessionTool, spinner],
    })
  }

  it('consumes the rest of the run when the Session Reset tool succeeds', async () => {
    executions = 0
    const pipeline = resetPipeline([
      { kind: 'tool_calls', calls: [
        { id: 'c1', name: 'new_session', args: {} },
        { id: 'c2', name: 'spin', args: {} },
      ] },
      { kind: 'answer', speak: 'Fresh start.', display: 'Never reached.' },
    ])
    const commits: string[] = []

    const events: PipelineEvent[] = []
    for await (const event of pipeline.execute('forget all that — different question', undefined, false, {
      snapshot: [],
      memory: [],
      commit: (outcome, note) => {
        commits.push(`${outcome}:${note}`)
        return 'committed'
      },
    })) events.push(event)

    // The response's other calls never execute wherever they sit, and no
    // later model round happens: the discarded run ends at the boundary.
    expect(executions).toBe(0)
    expect(events.map((event) => event.type)).toEqual([
      'command', 'status', 'status', 'tool_call', 'tool_result', 'done',
    ])
    expect(events.find((event) => event.type === 'tool_result')).toMatchObject({
      name: 'new_session',
      ok: true,
    })
    // No answer, nothing spoken or displayed, and no continuity commit —
    // pre-reset work is discarded wholesale.
    expect(events.some((event) => event.type === 'display' || event.type === 'speak')).toBe(false)
    expect(commits).toEqual([])
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'reset' })
  })

  it('suppresses siblings listed before the Session Reset call too', async () => {
    executions = 0
    const pipeline = resetPipeline([
      { kind: 'tool_calls', calls: [
        { id: 'c1', name: 'spin', args: {} },
        { id: 'c2', name: 'new_session', args: {} },
        { id: 'c3', name: 'spin', args: {} },
      ] },
      { kind: 'answer', speak: 'Fresh start.', display: 'Never reached.' },
    ])

    const events = await collect(pipeline, 'forget all that — different question')

    expect(executions).toBe(0)
    expect(events.filter((event) => event.type === 'tool_call').map((event) => event.name)).toEqual(['new_session'])
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'reset' })
  })

  it('keeps a failed Session Reset tool inside its run, answering its suppressed siblings', async () => {
    executions = 0
    const failingReset = {
      name: 'new_session',
      sessionReset: true,
      async execute() {
        throw new Error('reset unavailable')
      },
    }
    const pipeline = createCommandPipeline({
      llm: new ScriptedLlm([
        { kind: 'tool_calls', calls: [
          { id: 'c1', name: 'spin', args: {} },
          { id: 'c2', name: 'new_session', args: {} },
        ] },
        { kind: 'answer', speak: 'It failed.', display: 'It failed.' },
      ]),
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [failingReset, spinner],
    })

    const events = await collect(pipeline, 'forget all that')

    // The reset call itself ran (and failed); the sibling was suppressed
    // but still answered so the next round stays protocol-consistent.
    expect(executions).toBe(0)
    expect(events.filter((event) => event.type === 'tool_result')).toEqual([
      { type: 'tool_result', callId: 'c2', name: 'new_session', ok: false, error: 'reset unavailable', at: 0 },
      { type: 'tool_result', callId: 'c1', name: 'spin', ok: false, error: 'not executed: this response carried a session reset, but it failed', at: 0 },
    ])
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'done' })
  })
})

describe('observation ledger (#111)', () => {
  function pageTool(name: string, result: string | (() => Promise<string>) = 'page state'): Tool {
    return {
      name,
      async execute() {
        return typeof result === 'function' ? await result() : result
      },
    }
  }

  function continuityWith(generation?: number) {
    return {
      snapshot: [] as never[],
      memory: [] as never[],
      ...(generation !== undefined ? { generation } : {}),
      commit: (() => 'committed') as never,
    }
  }

  it('gives the command, page reads, looks, action outcomes, and subagent reports stable identities', async () => {
    const observations: { id: string; producer: string; ok: boolean; payload: unknown; sourceUrl?: string }[] = []
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [
        { id: 'c1', name: 'read_page', args: {} },
        { id: 'c2', name: 'look', args: {} },
      ] },
      { kind: 'tool_calls', calls: [
        { id: 'c3', name: 'navigate', args: { url: 'https://example.com/next' } },
        { id: 'c4', name: 'agent_results', args: { wait: true } },
        { id: 'c5', name: 'click', args: { ref: 7 } },
      ] },
      { kind: 'answer', speak: 'Done.', display: 'Done.' },
    ])
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [
        pageTool('read_page', 'url: https://example.com\ntitle: Example\n[1] link'),
        pageTool('look', 'a search results page'),
        pageTool('navigate', 'navigated to https://example.com/next'),
        pageTool('agent_results', 'report for a-1'),
        { name: 'click', async execute() { throw new Error('ref 7 not found') } },
      ],
      currentPageUrl: () => 'https://example.com/live',
      onObservation: (record) => observations.push(record),
    })

    await collect(pipeline, 'find pizza near me')

    // Identities are stable and sequential across model rounds: the
    // command first, then every processed tool result in execution order.
    expect(observations).toEqual([
      { id: 'obs-1', at: 0, producer: 'command', ok: true, payload: 'find pizza near me' },
      { id: 'obs-2', at: 0, producer: 'page_read', ok: true, payload: 'url: https://example.com\ntitle: Example\n[1] link', sourceUrl: 'https://example.com/live' },
      { id: 'obs-3', at: 0, producer: 'look', ok: true, payload: 'a search results page', sourceUrl: 'https://example.com/live' },
      { id: 'obs-4', at: 0, producer: 'action_outcome', ok: true, payload: 'navigated to https://example.com/next', sourceUrl: 'https://example.com/live' },
      { id: 'obs-5', at: 0, producer: 'subagent_report', ok: true, payload: 'report for a-1' },
      { id: 'obs-6', at: 0, producer: 'action_outcome', ok: false, payload: 'ref 7 not found', sourceUrl: 'https://example.com/live' },
    ])
  })

  it('records the ask_user answer as a user observation', async () => {
    const observations: { producer: string; ok: boolean; payload: unknown }[] = []
    const pipeline = createCommandPipeline({
      llm: new ScriptedLlm([
        { kind: 'tool_calls', calls: [{ id: 'a1', name: 'ask_user', args: { question: 'Which city?' } }] },
        { kind: 'answer', speak: 'Booking Paris.', display: 'Detail.' },
      ]),
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [createAskUserTool()],
      onObservation: (record) => observations.push(record),
    })

    await collect(pipeline, 'book a hotel', (event, pipe) => {
      if (event.type === 'ask_requested') pipe.resolveAsk(event.askId, 'Paris, France')
    })

    expect(observations).toContainEqual({ id: 'obs-2', at: 0, producer: 'ask_user', ok: true, payload: 'Paris, France' })
  })

  it('records each steering directive once, at the checkpoint that consumes it', async () => {
    const firstTurn = deferred<AssistantTurn>()
    const requests: LlmRequest[] = []
    const llm: LlmClient = {
      async complete(request) {
        requests.push(request)
        if (requests.length === 1) return firstTurn.promise
        return { kind: 'answer', speak: 'Changed course.', display: 'Using the steering.' }
      },
    }
    const observations: { producer: string; payload: unknown }[] = []
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [pageTool('stale_action')],
      onObservation: (record) => observations.push(record),
    })

    const run = collect(pipeline, 'original command')
    await waitUntil(() => requests.length === 1)
    expect(steerPipeline(pipeline, '  Use Paris instead.  ')).toBe(true)
    firstTurn.resolve({ kind: 'answer', speak: 'Redirected.', display: 'Used the steering.' })
    await run

    expect(observations).toEqual([
      { id: 'obs-1', at: 0, producer: 'command', ok: true, payload: 'original command' },
      { id: 'obs-2', at: 0, producer: 'steering', ok: true, payload: 'Use Paris instead.' },
    ])
  })

  it('disappears when its Run ends: the next Run mints fresh identities', async () => {
    const seen: string[][] = []
    const build = (): CommandPipeline => createCommandPipeline({
      llm: new ScriptedLlm([{ kind: 'answer', speak: 'Done.', display: 'Done.' }]),
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [],
      onObservation: (record) => seen.at(-1)!.push(record.id),
    })
    const pipeline = build()

    seen.push([])
    await collect(pipeline, 'first command')
    seen.push([])
    await collect(pipeline, 'second command')

    // A per-run ledger: the second run starts from obs-1 again, carrying
    // nothing over from the first.
    expect(seen).toEqual([['obs-1'], ['obs-1']])
  })

  it('refuses to record from a stale Session generation', async () => {
    const observations: { id: string; producer: string }[] = []
    const pipeline = createCommandPipeline({
      llm: new ScriptedLlm([{ kind: 'answer', speak: 'Done.', display: 'Done.' }]),
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [],
      onObservation: (record) => observations.push(record),
    })

    const runWithGeneration = async (generation: number | undefined, command: string): Promise<void> => {
      for await (const event of pipeline.execute(command, undefined, false, continuityWith(generation))) {
        void event
      }
    }

    // A current generation records; after the pipeline has served
    // generation 1, a run arriving under the superseded generation 0 —
    // work that predates a Session Reset — records nothing.
    await runWithGeneration(1, 'current work')
    expect(observations).toEqual([expect.objectContaining({ id: 'obs-1', producer: 'command', payload: 'current work' })])

    await runWithGeneration(0, 'stale work')
    expect(observations).toHaveLength(1)

    await runWithGeneration(1, 'current again')
    expect(observations.map((observation) => observation.id)).toEqual(['obs-1', 'obs-1'])
  })
})

describe('evidence checkpoints (#121)', () => {
  const PAGE_URL = 'https://shop.example/acme-router'
  const PAGE_TEXT = 'Acme Wi-Fi Router\nPrice: $39 with free shipping over $25.'

  function storeHarness(): SessionEvidenceStore {
    let next = 0
    return createSessionEvidence({
      sessionId: 'session-1' as SessionId,
      now: () => 0,
      mintId: () => `memory-${++next}` as MemoryEntryId,
    })
  }

  /** Continuity shaped like the command runner's: admission snapshot plus the live commit seam. */
  function continuityFor(
    store: SessionEvidenceStore,
    evidence: SessionEvidenceSnapshot = store.snapshot(),
    runId = 'run-1' as RunId,
  ): RunContinuityContext {
    return {
      snapshot: [],
      memory: [],
      evidence,
      generation: 0,
      commit: () => 'committed',
      checkpointEvidence: webEvidenceCommit(() => store, runId),
    }
  }

  const readPage: Tool = { name: 'read_page', acquisition: true, async execute() { return PAGE_TEXT } }

  async function collectWithContinuity(
    pipeline: CommandPipeline,
    command: string,
    continuity: RunContinuityContext,
  ): Promise<PipelineEvent[]> {
    const events: PipelineEvent[] = []
    for await (const raw of pipeline.execute(command, undefined, false, continuity)) {
      events.push(withoutTurnId(raw))
    }
    return events
  }

  it('checkpoints a grounded web Observation immediately and returns its Memory Entry identity', async () => {
    const store = storeHarness()
    const admission = store.snapshot()
    const observations: { producer: string; ok: boolean; payload: unknown }[] = []
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'read_page', args: {} }] },
      { kind: 'tool_calls', calls: [{
        id: 'c2',
        name: 'record_evidence',
        args: { observation: 'The Acme router costs $39.', source_url: PAGE_URL, excerpt: 'Price: $39' },
      }] },
      { kind: 'answer', speak: 'It costs $39.', display: 'The Acme router costs $39.' },
    ])
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [readPage, createRecordEvidenceTool()],
      currentPageUrl: () => PAGE_URL,
      onObservation: (record) => observations.push(record),
    })

    const events = await collectWithContinuity(pipeline, 'what does the acme router cost', continuityFor(store, admission))

    // The tool result reports the identity; the Session holds the
    // Observation with the citing source and the Run's provenance.
    expect(events.find((e) => e.type === 'tool_result' && e.callId === 'c2')).toMatchObject({
      ok: true,
      result: expect.stringMatching(/memory-1[\s\S]*survives this run/),
    })
    expect(store.snapshot().observations).toEqual([{
      id: 'memory-1',
      sessionId: 'session-1',
      sourceKind: 'web',
      text: 'The Acme router costs $39.',
      observedAt: 0,
      references: [{ url: PAGE_URL }],
      provenance: [{ runId: 'run-1' }],
    }])
    // The checkpoint result joined private Run Working State: its outcome
    // is an Observation of this Run's ledger.
    expect(observations.some((observation) =>
      observation.producer === 'action_outcome' && observation.ok === true &&
      typeof observation.payload === 'string' && observation.payload.includes('memory-1'),
    )).toBe(true)
    // The accepted Session snapshot stayed immutable for the Run's
    // lifetime: the mid-Run checkpoint never rewrote its own context.
    expect(llm.requests[2]?.evidence).toBe(admission)
    expect(llm.requests[2]?.evidence?.observations).toEqual([])
  })

  it('hands checkpointed evidence to the follow-up Run after the originating Run ends done', async () => {
    const store = storeHarness()
    const first = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'read_page', args: {} }] },
      { kind: 'tool_calls', calls: [{
        id: 'c2',
        name: 'record_evidence',
        args: { observation: 'The Acme router costs $39.', source_url: PAGE_URL, excerpt: 'Price: $39' },
      }] },
      { kind: 'answer', speak: 'Noted.', display: 'Detail.' },
    ])
    const pipeline = createCommandPipeline({
      llm: first,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [readPage, createRecordEvidenceTool()],
      currentPageUrl: () => PAGE_URL,
    })
    const firstEvents = await collectWithContinuity(pipeline, 'check the price', continuityFor(store))
    expect(firstEvents.at(-1)).toMatchObject({ type: 'done', outcome: 'done' })

    // The follow-up Run is admitted against the now-updated store.
    const second = new ScriptedLlm([{ kind: 'answer', speak: 'Still $39.', display: 'Still $39.' }])
    const pipeline2 = createCommandPipeline({
      llm: second,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [readPage, createRecordEvidenceTool()],
      currentPageUrl: () => PAGE_URL,
    })
    await collectWithContinuity(pipeline2, 'the price again', continuityFor(store, store.snapshot(), 'run-2' as RunId))

    expect(second.requests[0]?.evidence?.observations).toEqual([expect.objectContaining({
      id: 'memory-1',
      text: 'The Acme router costs $39.',
      references: [{ url: PAGE_URL }],
    })])
  })

  it('keeps checkpointed evidence after the originating Run fails', async () => {
    const store = storeHarness()
    // The script ends after the checkpoint round: the next model call
    // rejects and the run fails — the checkpoint must already be stored.
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'read_page', args: {} }] },
      { kind: 'tool_calls', calls: [{
        id: 'c2',
        name: 'record_evidence',
        args: { observation: 'The Acme router costs $39.', source_url: PAGE_URL, excerpt: 'Price: $39' },
      }] },
    ])
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [readPage, createRecordEvidenceTool()],
      currentPageUrl: () => PAGE_URL,
    })

    const events = await collectWithContinuity(pipeline, 'find the price', continuityFor(store))

    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'failed' })
    expect(events.some((e) => e.type === 'error')).toBe(true)
    expect(store.snapshot().observations.map(({ id }) => id)).toEqual(['memory-1'])
  })

  it('keeps checkpointed evidence after the originating Run is cancelled', async () => {
    const store = storeHarness()
    const requests: LlmRequest[] = []
    const parked = deferred<AssistantTurn>()
    const scripted = [
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'read_page', args: {} }] } as AssistantTurn,
      { kind: 'tool_calls', calls: [{
        id: 'c2',
        name: 'record_evidence',
        args: { observation: 'The Acme router costs $39.', source_url: PAGE_URL, excerpt: 'Price: $39' },
      }] } as AssistantTurn,
    ]
    const llm: LlmClient = {
      complete(request) {
        requests.push(request)
        return requests.length <= scripted.length ? Promise.resolve(scripted[requests.length - 1]!) : parked.promise
      },
    }
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [readPage, createRecordEvidenceTool()],
      currentPageUrl: () => PAGE_URL,
    })

    const run = collectWithContinuity(pipeline, 'find the price', continuityFor(store))
    for (let attempt = 0; attempt < 200 && requests.length < 3; attempt += 1) await flush()
    expect(requests).toHaveLength(3)
    pipeline.abort()
    parked.resolve({ kind: 'answer', speak: 'Stale.', display: 'Stale.' })
    const events = await run

    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'cancelled' })
    expect(store.snapshot().observations.map(({ id }) => id)).toEqual(['memory-1'])
  })

  it('fails an unobserved source recoverably, mutating no Session state, and the Run continues', async () => {
    const store = storeHarness()
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'read_page', args: {} }] },
      { kind: 'tool_calls', calls: [{
        id: 'c2',
        name: 'record_evidence',
        args: { observation: 'Made up.', source_url: 'https://other.example/never-opened', excerpt: 'Price: $39' },
      }] },
      { kind: 'answer', speak: 'Recovered.', display: 'Recovered.' },
    ])
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [readPage, createRecordEvidenceTool()],
      currentPageUrl: () => PAGE_URL,
    })

    const events = await collectWithContinuity(pipeline, 'find the price', continuityFor(store))

    expect(events.find((e) => e.type === 'tool_result' && e.callId === 'c2')).toMatchObject({
      ok: false,
      error: expect.stringMatching(/not observed in this run/i),
    })
    expect(store.snapshot().observations).toEqual([])
    // Recoverable: the Run kept going and answered.
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'done' })
  })

  it('fails an unsupported excerpt recoverably without mutating Session state', async () => {
    const store = storeHarness()
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'read_page', args: {} }] },
      { kind: 'tool_calls', calls: [{
        id: 'c2',
        name: 'record_evidence',
        args: { observation: 'Invented price.', source_url: PAGE_URL, excerpt: 'Price: $59' },
      }] },
      { kind: 'answer', speak: 'Recovered.', display: 'Recovered.' },
    ])
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [readPage, createRecordEvidenceTool()],
      currentPageUrl: () => PAGE_URL,
    })

    const events = await collectWithContinuity(pipeline, 'find the price', continuityFor(store))

    expect(events.find((e) => e.type === 'tool_result' && e.callId === 'c2')).toMatchObject({
      ok: false,
      error: expect.stringMatching(/excerpt does not appear/i),
    })
    expect(store.snapshot().observations).toEqual([])
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'done' })
  })

  it('counts no Progress on failure: an invalid checkpoint never resets the search-loop streak, an accepted one does', async () => {
    const store = storeHarness()
    const SEARCH_URL = 'https://search.example/?q=acme+router+price'
    const navigate: Tool = {
      name: 'navigate',
      acquisition: true,
      async execute() {
        return 'Results for acme router price\nAcme Wi-Fi Router — Price: $39'
      },
    }
    const searchRound = (id: string): AssistantTurn => ({
      kind: 'tool_calls',
      calls: [{ id, name: 'navigate', args: { url: SEARCH_URL } }],
    })
    const llm = new ScriptedLlm([
      searchRound('s1'),
      searchRound('s2'),
      searchRound('s3'),
      searchRound('s4'),
      searchRound('s5'),
      // An invalid checkpoint (excerpt unsupported): recoverable, but not
      // Progress — the search streak must survive it.
      { kind: 'tool_calls', calls: [{
        id: 'bad',
        name: 'record_evidence',
        args: { observation: 'Invented.', source_url: 'https://shop.example/acme-router', excerpt: 'Price: $59' },
      }] },
      // Sixth similar search: refused, because the streak never broke.
      searchRound('s6'),
      // An accepted checkpoint is Progress (#108): the streak resets…
      { kind: 'tool_calls', calls: [{
        id: 'good',
        name: 'record_evidence',
        args: { observation: 'The Acme router costs $39.', source_url: 'https://shop.example/acme-router', excerpt: 'Price: $39' },
      }] },
      // …so the same search runs again.
      searchRound('s7'),
      { kind: 'answer', speak: 'Done.', display: 'Done.' },
    ])
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [navigate, createRecordEvidenceTool()],
      currentPageUrl: () => 'https://shop.example/acme-router',
    })

    const events = await collectWithContinuity(pipeline, 'find the price', continuityFor(store))

    expect(events.find((e) => e.type === 'tool_result' && e.callId === 'bad')).toMatchObject({ ok: false })
    expect(events.find((e) => e.type === 'tool_result' && e.callId === 's6')).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Search loop limit/),
    })
    expect(events.find((e) => e.type === 'tool_result' && e.callId === 'good')).toMatchObject({ ok: true })
    expect(events.find((e) => e.type === 'tool_result' && e.callId === 's7')).toMatchObject({ ok: true })
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'done' })
  })

  it('stays available through Finalization while acquisition closes', async () => {
    const store = storeHarness()
    const directPlan = (id: string): ToolCall => ({
      id,
      name: 'report_run_plan',
      args: { objective: 'Get the price', headline: 'Get the price', effort_tier: 'direct_action' },
    })
    const llm = new ScriptedLlm([
      // Six Direct Action work rounds consume the tier budget.
      ...Array.from({ length: 6 }, (_, i): AssistantTurn => ({
        kind: 'tool_calls',
        calls: [
          ...(i === 0 ? [directPlan(`p${i}`)] : []),
          { id: `w${i}`, name: 'read_page', args: {} },
        ],
      })),
      // Finalization's one bookkeeping round: acquisition refused,
      // record_evidence open — grounding predates the phase.
      { kind: 'tool_calls', calls: [
        { id: 'w6', name: 'read_page', args: {} },
        {
          id: 'c9',
          name: 'record_evidence',
          args: { observation: 'The Acme router costs $39.', source_url: PAGE_URL, excerpt: 'Price: $39' },
        },
      ] },
      { kind: 'answer', speak: 'Partial.', display: 'Partial.', resolution: 'partial' },
    ])
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [createReportRunPlanTool(), readPage, createRecordEvidenceTool()],
      currentPageUrl: () => PAGE_URL,
    })

    const events = await collectWithContinuity(pipeline, 'get the price', continuityFor(store))

    expect(events.find((e) => e.type === 'tool_result' && e.callId === 'w6')).toMatchObject({
      ok: false,
      error: expect.stringMatching(/final answer JSON/),
    })
    expect(events.find((e) => e.type === 'tool_result' && e.callId === 'c9')).toMatchObject({
      ok: true,
      result: expect.stringContaining('memory-1'),
    })
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'done', finalizationCause: 'budget_exhausted' })
    expect(store.snapshot().observations.map(({ id }) => id)).toEqual(['memory-1'])
  })
})

describe('grounded Candidates, user corrections, and Answers (#122)', () => {
  const PAGE_URL = 'https://shop.example/acme-router'
  const PAGE_TEXT = 'Acme Wi-Fi Router\nPrice: $39 with free shipping over $25.'

  function storeHarness(): SessionEvidenceStore {
    let next = 0
    return createSessionEvidence({
      sessionId: 'session-1' as SessionId,
      now: () => 0,
      mintId: () => `memory-${++next}` as MemoryEntryId,
    })
  }

  /** Continuity shaped like the command runner's: live store handle plus a commit-capturing seam. */
  function continuityFor(
    store: SessionEvidenceStore,
    options: {
      runId?: RunId
      evidence?: SessionEvidenceSnapshot
      committed?: MemoryPatch[]
    } = {},
  ): RunContinuityContext {
    const runId = options.runId ?? ('run-1' as RunId)
    return {
      snapshot: [],
      memory: [],
      evidence: options.evidence ?? store.snapshot(),
      generation: 0,
      commit: (_outcome, _note, patch) => {
        options.committed?.push(patch)
        return 'committed'
      },
      checkpointEvidence: webEvidenceCommit(() => store, runId),
      evidenceSession: () => ({ store, runId }),
    }
  }

  const readPage: Tool = { name: 'read_page', acquisition: true, async execute() { return PAGE_TEXT } }

  async function collectWithContinuity(
    pipeline: CommandPipeline,
    command: string,
    continuity: RunContinuityContext,
    onEvent?: (event: PipelineEvent, pipeline: CommandPipeline) => void,
  ): Promise<PipelineEvent[]> {
    const events: PipelineEvent[] = []
    for await (const raw of pipeline.execute(command, undefined, false, continuity)) {
      const event = withoutTurnId(raw)
      events.push(event)
      onEvent?.(event, pipeline)
    }
    return events
  }

  it('records the user\'s exact words — the command and an ask_user answer — as User Observations (#122)', async () => {
    const store = storeHarness()
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'a1', name: 'ask_user', args: { question: 'Which color?' } }] },
      { kind: 'tool_calls', calls: [
        { id: 'c1', name: 'record_evidence', args: { kind: 'user', observation: 'book a hotel, the blue one' } },
        { id: 'c2', name: 'record_evidence', args: { kind: 'user', observation: 'No, the blue one.' } },
      ] },
      { kind: 'answer', speak: 'The blue one.', display: 'The blue one.' },
    ])
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [createAskUserTool(), createRecordEvidenceTool()],
    })

    const events = await collectWithContinuity(pipeline, 'book a hotel, the blue one', continuityFor(store), (event, pipe) => {
      if (event.type === 'ask_requested') pipe.resolveAsk(event.askId, 'No, the blue one.')
    })

    // The command itself and the answered question both ground user
    // citations: exact text, event provenance, the Run's identity.
    expect(events.find((e) => e.type === 'tool_result' && e.callId === 'c1')).toMatchObject({ ok: true })
    expect(events.find((e) => e.type === 'tool_result' && e.callId === 'c2')).toMatchObject({ ok: true })
    expect(store.snapshot().observations).toEqual([
      expect.objectContaining({
        sourceKind: 'user',
        text: 'book a hotel, the blue one',
        references: [],
        originEvent: { producer: 'command', observationId: 'obs-1' },
        provenance: [{ runId: 'run-1' }],
      }),
      expect.objectContaining({
        sourceKind: 'user',
        text: 'No, the blue one.',
        originEvent: { producer: 'ask_user', observationId: 'obs-2' },
        provenance: [{ runId: 'run-1' }],
      }),
    ])
  })

  it('refuses a user citation that paraphrases what the user said (#122)', async () => {
    const store = storeHarness()
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [
        { id: 'c1', name: 'record_evidence', args: { kind: 'user', observation: 'the blue one, please' } },
      ] },
      { kind: 'answer', speak: 'Recovered.', display: 'Recovered.' },
    ])
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [createRecordEvidenceTool()],
    })

    const events = await collectWithContinuity(pipeline, 'book a hotel, the blue one', continuityFor(store))

    expect(events.find((e) => e.type === 'tool_result' && e.callId === 'c1')).toMatchObject({
      ok: false,
      error: expect.stringMatching(/exact words/i),
    })
    expect(store.snapshot().observations).toEqual([])
  })

  it('records a Steering Directive as a User Observation with event provenance (#122)', async () => {
    const store = storeHarness()
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'a1', name: 'ask_user', args: { question: 'Which city?' } }] },
      { kind: 'tool_calls', calls: [
        { id: 's1', name: 'record_evidence', args: { kind: 'user', observation: 'Use Paris instead.' } },
      ] },
      { kind: 'answer', speak: 'Paris.', display: 'Paris.' },
    ])
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [createAskUserTool(), createRecordEvidenceTool()],
    })

    // The directive lands while the ask window is open: the ask settles
    // steered, and the directive is consumed — observed into the ledger —
    // at the checkpoint ahead of the next round, where the model
    // checkpoints the user's exact words.
    const events = await collectWithContinuity(pipeline, 'find a mug', continuityFor(store), (event, pipe) => {
      if (event.type === 'ask_requested') {
        pipe.pause()
        pipe.resume('Use Paris instead.')
      }
    })

    expect(events.find((e) => e.type === 'ask_resolved')).toMatchObject({ reason: 'steered' })
    expect(events.find((e) => e.type === 'tool_result' && e.callId === 's1')).toMatchObject({ ok: true })
    expect(store.snapshot().observations).toEqual([
      expect.objectContaining({
        sourceKind: 'user',
        text: 'Use Paris instead.',
        originEvent: { producer: 'steering', observationId: 'obs-4' },
        provenance: [{ runId: 'run-1' }],
      }),
    ])
  })

  it('creates and decides Candidates citing live Observations, preserving provenance (#122)', async () => {
    const store = storeHarness()
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'read_page', args: {} }] },
      { kind: 'tool_calls', calls: [
        { id: 'c2', name: 'record_evidence', args: { observation: 'The Acme router costs $39.', source_url: PAGE_URL, excerpt: 'Price: $39' } },
      ] },
      { kind: 'tool_calls', calls: [
        { id: 'c3', name: 'record_candidate', args: { subject: 'Acme wifi router', detail: 'Cheapest option.', supporting_evidence: ['memory-1'] } },
      ] },
      { kind: 'tool_calls', calls: [
        { id: 'c4', name: 'record_candidate', args: { candidate_id: 'memory-2', status: 'accepted', supporting_evidence: ['memory-1'] } },
      ] },
      { kind: 'answer', speak: 'The Acme.', display: 'The Acme router.' },
    ])
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [readPage, createRecordEvidenceTool(), createRecordCandidateTool()],
      currentPageUrl: () => PAGE_URL,
    })

    const events = await collectWithContinuity(pipeline, 'find the cheapest router', continuityFor(store))

    expect(events.find((e) => e.type === 'tool_result' && e.callId === 'c3')).toMatchObject({
      ok: true,
      result: expect.stringContaining('memory-2'),
    })
    expect(events.find((e) => e.type === 'tool_result' && e.callId === 'c4')).toMatchObject({
      ok: true,
      result: expect.stringMatching(/accepted[\s\S]*provenance/i),
    })
    expect(store.snapshot().candidates).toEqual([
      expect.objectContaining({
        id: 'memory-2',
        subject: 'Acme wifi router',
        status: 'accepted',
        supportingObservationIds: ['memory-1'],
        // One Run creating and deciding: provenance accumulates per Run
        // identity, deduplicated — the decision's support union is what
        // grows, never repeated provenance.
        provenance: [{ runId: 'run-1' }],
      }),
    ])
  })

  it('refuses a Candidate whose support is not live Session Evidence (#122)', async () => {
    const store = storeHarness()
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [
        { id: 'c1', name: 'record_candidate', args: { subject: 'Ghost router', supporting_evidence: ['memory-99'] } },
      ] },
      { kind: 'answer', speak: 'Recovered.', display: 'Recovered.' },
    ])
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [createRecordCandidateTool()],
    })

    const events = await collectWithContinuity(pipeline, 'find a router', continuityFor(store))

    expect(events.find((e) => e.type === 'tool_result' && e.callId === 'c1')).toMatchObject({
      ok: false,
      error: expect.stringMatching(/memory-99/),
    })
    expect(store.snapshot().candidates).toEqual([])
  })

  it('strips Assessments without active evidence support from the terminal Memory Commit (#122)', async () => {
    const store = storeHarness()
    const committed: MemoryPatch[] = []
    const degradations: string[] = []
    const llm = new ScriptedLlm([
      { kind: 'answer', speak: 'Done.', display: 'Done.', memoryPatch: [
        { op: 'add', entry: { kind: 'assessment', subject: 'Acme is cheapest', detail: 'Verified.', references: [{ url: PAGE_URL }] } },
        { op: 'add', entry: { kind: 'finding', subject: 'Acme price seen', detail: '$39 on the page.', references: [{ url: PAGE_URL }] } },
      ] },
    ])
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [],
      onContinuityDegraded: (reason) => degradations.push(reason),
    })

    const events = await collectWithContinuity(pipeline, 'compare routers', continuityFor(store, { committed }))

    // No evidence_ids at all: the Assessment never commits; the finding —
    // not an Assessment — passes through untouched.
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'done' })
    expect(committed).toEqual([[
      { op: 'add', entry: { kind: 'finding', subject: 'Acme price seen', detail: '$39 on the page.', references: [{ url: PAGE_URL }] } },
    ]])
    expect(degradations).toContain('unsupported_assessment')
  })

  it('commits Assessments when the Answer cites active Session Evidence (#122)', async () => {
    const store = storeHarness()
    const committed: MemoryPatch[] = []
    const assessment: MemoryPatch[number] = { op: 'add', entry: { kind: 'assessment', subject: 'Acme is cheapest', detail: 'Verified.', references: [{ url: PAGE_URL }] } }
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'read_page', args: {} }] },
      { kind: 'tool_calls', calls: [
        { id: 'c2', name: 'record_evidence', args: { observation: 'The Acme router costs $39.', source_url: PAGE_URL, excerpt: 'Price: $39' } },
      ] },
      { kind: 'answer', speak: 'Done.', display: 'Done.', evidenceIds: ['memory-1' as MemoryEntryId], memoryPatch: [assessment] },
    ])
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [readPage, createRecordEvidenceTool()],
      currentPageUrl: () => PAGE_URL,
    })

    await collectWithContinuity(pipeline, 'compare routers', continuityFor(store, { committed }))

    // The mid-Run checkpoint is citable: live support carries the
    // Assessment into the terminal Memory Commit whole.
    expect(committed).toEqual([[assessment]])
  })

  it('derives display source links from cited evidence and never exposes internal ids (#122)', async () => {
    const store = storeHarness()
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'read_page', args: {} }] },
      { kind: 'tool_calls', calls: [
        { id: 'c2', name: 'record_evidence', args: { observation: 'The Acme router costs $39.', source_url: PAGE_URL, excerpt: 'Price: $39' } },
      ] },
      { kind: 'answer', speak: 'It costs $39.', display: 'Cheapest option found (memory-1, obs-2).', evidenceIds: ['memory-1' as MemoryEntryId] },
    ])
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [readPage, createRecordEvidenceTool()],
      currentPageUrl: () => PAGE_URL,
    })

    const events = await collectWithContinuity(pipeline, 'find the price', continuityFor(store))

    const display = events.find((e) => e.type === 'display')
    expect(display).toMatchObject({
      type: 'display',
      // Internal identities scrubbed (holes tidied with them); the cited
      // evidence's source link derived underneath — the user never sees
      // memory-N or obs-N.
      text: 'Cheapest option found ().\n\nSources:\n- [shop.example](https://shop.example/acme-router)',
    })
  })
})

describe('checkpointed Subagent evidence and freshness (#123)', () => {
  const PAGE_URL = 'https://shop.example/acme-router'
  const WORKER_URL = 'https://rival.example/router'
  const PAGE_TEXT = 'Acme Wi-Fi Router\nPrice: $39 with free shipping over $25.'

  function storeHarness(): SessionEvidenceStore {
    let next = 0
    return createSessionEvidence({
      sessionId: 'session-1' as SessionId,
      now: () => 0,
      mintId: () => `memory-${++next}` as MemoryEntryId,
    })
  }

  function continuityFor(
    store: SessionEvidenceStore,
    options: { runId?: RunId; evidence?: SessionEvidenceSnapshot } = {},
  ): RunContinuityContext {
    const runId = options.runId ?? ('run-1' as RunId)
    return {
      snapshot: [],
      memory: [],
      evidence: options.evidence ?? store.snapshot(),
      generation: 0,
      commit: () => 'committed',
      checkpointEvidence: webEvidenceCommit(() => store, runId),
      evidenceSession: () => ({ store, runId }),
    }
  }

  /** The hidden provenance a completed worker's report carried (#123). */
  function workerObservations(at = 0): ObservationRecord[] {
    return [{
      id: 'wobs-1' as ObservationRecord['id'],
      at,
      producer: 'page_read',
      ok: true,
      payload: 'The rival router costs $29.',
      sourceUrl: WORKER_URL,
    }]
  }

  const readPage: Tool = { name: 'read_page', acquisition: true, async execute() { return PAGE_TEXT } }

  async function collectWithContinuity(
    pipeline: CommandPipeline,
    command: string,
    continuity: RunContinuityContext,
  ): Promise<PipelineEvent[]> {
    const events: PipelineEvent[] = []
    for await (const raw of pipeline.execute(command, undefined, false, continuity)) {
      events.push(withoutTurnId(raw))
    }
    return events
  }

  it('checkpoints a selected worker finding with Run and Subagent provenance (#123)', async () => {
    const store = storeHarness()
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{
        id: 'c1',
        name: 'record_evidence',
        args: { kind: 'subagent', agent_id: 'a-2', observation: 'The rival router costs $29.', source_url: WORKER_URL },
      }] },
      { kind: 'answer', speak: 'Noted.', display: 'The rival costs $29.' },
    ])
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [createRecordEvidenceTool()],
      subagentObservations: (agentId) => (agentId === 'a-2' ? workerObservations() : null),
    })

    const events = await collectWithContinuity(pipeline, 'compare routers', continuityFor(store))

    expect(events.find((e) => e.type === 'tool_result' && e.callId === 'c1')).toMatchObject({
      ok: true,
      result: expect.stringMatching(/memory-1[\s\S]*subagent a-2[\s\S]*survives this run/),
    })
    expect(store.snapshot().observations).toEqual([expect.objectContaining({
      sourceKind: 'web',
      text: 'The rival router costs $29.',
      references: [{ url: WORKER_URL }],
      provenance: [{ runId: 'run-1', subagentId: 'a-2' }],
    })])
  })

  it('refuses a subagent citation when no worker observations back it (#123)', async () => {
    const store = storeHarness()
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{
        id: 'c1',
        name: 'record_evidence',
        args: { kind: 'subagent', agent_id: 'a-9', observation: 'x', source_url: WORKER_URL },
      }] },
      { kind: 'answer', speak: 'No.', display: 'No.' },
    ])
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [createRecordEvidenceTool()],
    })

    const events = await collectWithContinuity(pipeline, 'compare routers', continuityFor(store))

    expect(events.find((e) => e.type === 'tool_result' && e.callId === 'c1')).toMatchObject({
      ok: false,
      error: expect.stringMatching(/unknown_agent[\s\S]*a-9/),
    })
    expect(store.snapshot().observations).toEqual([])
  })

  it('reuses stable admission evidence for a completed Resolution without rereading it (#123/AC5)', async () => {
    const store = storeHarness()
    store.checkpointObservation({
      sourceKind: 'web',
      text: 'The Acme router costs $39.',
      references: [{ url: PAGE_URL }],
      runId: 'run-0' as RunId,
    })
    const admission = store.snapshot()
    const llm = new ScriptedLlm([
      // Answer-only round: the stable fact is reused from Session Evidence —
      // no tool call rereads the page.
      { kind: 'answer', speak: 'Still $39.', display: 'Still $39.', resolution: 'completed', evidenceIds: ['memory-1' as MemoryEntryId] },
    ])
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [readPage, createRecordEvidenceTool()],
      currentPageUrl: () => PAGE_URL,
    })

    const events = await collectWithContinuity(pipeline, 'the price again', continuityFor(store, { evidence: admission, runId: 'run-2' as RunId }))

    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'done', resolution: 'completed' })
  })

  it('degrades a completed Resolution to partial when only stale volatile evidence supports it (#123/AC4)', async () => {
    const store = storeHarness()
    store.checkpointObservation({
      sourceKind: 'web',
      text: 'Stock is 3 units.',
      references: [{ url: PAGE_URL }],
      runId: 'run-0' as RunId,
      volatile: true,
    })
    const admission = store.snapshot()
    const llm = new ScriptedLlm([
      { kind: 'answer', speak: 'In stock.', display: 'In stock.', resolution: 'completed', evidenceIds: ['memory-1' as MemoryEntryId] },
    ])
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [readPage, createRecordEvidenceTool()],
      currentPageUrl: () => PAGE_URL,
    })

    const events = await collectWithContinuity(pipeline, 'is it in stock', continuityFor(store, { evidence: admission, runId: 'run-2' as RunId }))

    // Volatile admission evidence, never revalidated: the honest record is
    // partial, whatever the model proposed.
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'done', resolution: 'partial' })
  })

  it('accepts completed on volatile evidence the Run revalidated by re-observing the source (#123/AC5)', async () => {
    const store = storeHarness()
    store.checkpointObservation({
      sourceKind: 'web',
      text: 'Stock is 3 units.',
      references: [{ url: PAGE_URL }],
      runId: 'run-0' as RunId,
      volatile: true,
    })
    const admission = store.snapshot()
    const llm = new ScriptedLlm([
      // The follow-up Run re-observes the changing source before relying on it.
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'read_page', args: {} }] },
      { kind: 'answer', speak: 'In stock.', display: 'In stock.', resolution: 'completed', evidenceIds: ['memory-1' as MemoryEntryId] },
    ])
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [readPage, createRecordEvidenceTool()],
      currentPageUrl: () => PAGE_URL,
    })

    const events = await collectWithContinuity(pipeline, 'is it in stock', continuityFor(store, { evidence: admission, runId: 'run-2' as RunId }))

    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'done', resolution: 'completed' })
  })

  it('accepts completed on volatile evidence checkpointed mid-Run, and on a stable companion citation (#123)', async () => {
    const store = storeHarness()
    store.checkpointObservation({
      sourceKind: 'web',
      text: 'The Acme router exists.',
      references: [{ url: PAGE_URL }],
      runId: 'run-0' as RunId,
    })
    const admission = store.snapshot()

    // Fresh volatile evidence: checkpointed this Run, cited beside a stale
    // volatile one — the mid-Run checkpoint makes the support fresh.
    const first = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'read_page', args: {} }] },
      { kind: 'tool_calls', calls: [
        { id: 'c2', name: 'record_evidence', args: { observation: 'Stock is 3 units.', source_url: PAGE_URL, excerpt: 'Price: $39', volatile: true } },
      ] },
      { kind: 'answer', speak: 'In stock.', display: 'In stock.', resolution: 'completed', evidenceIds: ['memory-2' as MemoryEntryId] },
    ])
    const pipeline = createCommandPipeline({
      llm: first,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [readPage, createRecordEvidenceTool()],
      currentPageUrl: () => PAGE_URL,
    })
    const events = await collectWithContinuity(pipeline, 'stock check', continuityFor(store, { evidence: admission }))
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'done', resolution: 'completed' })

    // A stable citation beside a stale volatile one carries completion too.
    const secondStore = storeHarness()
    secondStore.checkpointObservation({
      sourceKind: 'web',
      text: 'Stock is 3 units.',
      references: [{ url: PAGE_URL }],
      runId: 'run-0' as RunId,
      volatile: true,
    })
    secondStore.checkpointObservation({
      sourceKind: 'web',
      text: 'The Acme router exists.',
      references: [{ url: PAGE_URL }],
      runId: 'run-0' as RunId,
    })
    const second = new ScriptedLlm([
      { kind: 'answer', speak: 'Yes.', display: 'Yes.', resolution: 'completed', evidenceIds: ['memory-1' as MemoryEntryId, 'memory-2' as MemoryEntryId] },
    ])
    const pipeline2 = createCommandPipeline({
      llm: second,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [],
    })
    const events2 = await collectWithContinuity(pipeline2, 'stock check', continuityFor(secondStore, { runId: 'run-2' as RunId }))
    expect(events2.at(-1)).toMatchObject({ type: 'done', outcome: 'done', resolution: 'completed' })
  })

  it('uncertain admission evidence is volatile too — completed on it alone degrades to partial (#123)', async () => {
    const store = storeHarness()
    store.checkpointObservation({
      sourceKind: 'web',
      text: 'Price seen in a cached cart.',
      references: [{ url: PAGE_URL }],
      runId: 'run-0' as RunId,
      uncertainty: 'cache may be stale',
    })
    const admission = store.snapshot()
    const llm = new ScriptedLlm([
      { kind: 'answer', speak: '$39.', display: '$39.', resolution: 'completed', evidenceIds: ['memory-1' as MemoryEntryId] },
    ])
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [],
    })

    const events = await collectWithContinuity(pipeline, 'the price', continuityFor(store, { evidence: admission, runId: 'run-2' as RunId }))

    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'done', resolution: 'partial' })
  })

  it('a volatile worker finding predating the Run cannot be laundered fresh by checkpointing it (#123)', async () => {
    const store = storeHarness()
    const clock = new FakeClock(2_000)
    // The worker ran during an earlier Run: its observations are older
    // than this Run, whatever time the orchestrator commits them at.
    const staleWorker = workerObservations(1_000)
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{
        id: 'c1',
        name: 'record_evidence',
        args: { kind: 'subagent', agent_id: 'a-2', observation: 'Stock is 3 units.', source_url: WORKER_URL, volatile: true },
      }] },
      { kind: 'answer', speak: 'In stock.', display: 'In stock.', resolution: 'completed', evidenceIds: ['memory-1' as MemoryEntryId] },
    ])
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock,
      tools: [createRecordEvidenceTool()],
      subagentObservations: (agentId) => (agentId === 'a-2' ? staleWorker : null),
    })

    const events = await collectWithContinuity(pipeline, 'is it in stock', continuityFor(store, { runId: 'run-2' as RunId }))

    // The checkpoint itself is valid provenance-wise — it stores, with
    // the worker's observation time — but completed does not stand on it
    // alone: nobody observed the source during this Run.
    expect(events.find((e) => e.type === 'tool_result' && e.callId === 'c1')).toMatchObject({ ok: true })
    expect(store.snapshot().observations[0]).toMatchObject({ observedAt: 1_000 })
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'done', resolution: 'partial' })
  })

  it('a volatile worker finding observed during the Run carries completion (#123)', async () => {
    const store = storeHarness()
    const clock = new FakeClock(2_000)
    // This worker ran while the current Run was alive: its freshest
    // observation postdates the Run's start.
    const liveWorker = [...workerObservations(1_500), ...workerObservations(2_500)]
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{
        id: 'c1',
        name: 'record_evidence',
        args: { kind: 'subagent', agent_id: 'a-2', observation: 'Stock is 3 units.', source_url: WORKER_URL, volatile: true },
      }] },
      { kind: 'answer', speak: 'In stock.', display: 'In stock.', resolution: 'completed', evidenceIds: ['memory-1' as MemoryEntryId] },
    ])
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock,
      tools: [createRecordEvidenceTool()],
      subagentObservations: () => liveWorker,
    })

    const events = await collectWithContinuity(pipeline, 'is it in stock', continuityFor(store, { runId: 'run-2' as RunId }))

    expect(events.find((e) => e.type === 'tool_result' && e.callId === 'c1')).toMatchObject({ ok: true })
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'done', resolution: 'completed' })
  })
})

describe('run context compaction (#124)', () => {
  const PAGE_URL = 'https://shop.example/acme-router'
  const LONG_PAGE_TEXT = `Acme Wi-Fi Router\nPrice: $39 with free shipping over $25.\n${'spec line. '.repeat(400)}`

  function storeHarness(): SessionEvidenceStore {
    let next = 0
    return createSessionEvidence({
      sessionId: 'session-1' as SessionId,
      now: () => 0,
      mintId: () => `memory-${++next}` as MemoryEntryId,
    })
  }

  function continuityFor(
    store: SessionEvidenceStore,
    options: {
      runId?: RunId
      evidence?: SessionEvidenceSnapshot
      evidenceSession?: RunContinuityContext['evidenceSession']
    } = {},
  ): RunContinuityContext {
    const runId = options.runId ?? ('run-1' as RunId)
    return {
      snapshot: [],
      memory: [],
      evidence: options.evidence ?? store.snapshot(),
      generation: 0,
      commit: () => 'committed',
      checkpointEvidence: webEvidenceCommit(() => store, runId),
      evidenceSession: options.evidenceSession ?? (() => ({ store, runId })),
    }
  }

  /** c1 reads the long page a checkpoint later grounds; later calls read fresh state. */
  const readPage: Tool = {
    name: 'read_page',
    acquisition: true,
    async execute(call) {
      return call.id === 'c1' ? LONG_PAGE_TEXT : `Settled page state after ${call.id}`
    },
  }

  async function collectWithContinuity(
    pipeline: CommandPipeline,
    command: string,
    continuity: RunContinuityContext,
  ): Promise<PipelineEvent[]> {
    const events: PipelineEvent[] = []
    for await (const raw of pipeline.execute(command, undefined, false, continuity)) {
      events.push(withoutTurnId(raw))
    }
    return events
  }

  /** The long-run script: read, checkpoint, read, read, answer. */
  function longRunScript(): AssistantTurn[] {
    return [
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'read_page', args: {} }] },
      { kind: 'tool_calls', calls: [{
        id: 'c2',
        name: 'record_evidence',
        args: { observation: 'The Acme router costs $39.', source_url: PAGE_URL, excerpt: 'Price: $39' },
      }] },
      { kind: 'tool_calls', calls: [{ id: 'c3', name: 'read_page', args: {} }] },
      { kind: 'tool_calls', calls: [{ id: 'c4', name: 'read_page', args: {} }] },
      { kind: 'answer', speak: 'Done.', display: 'Done.' },
    ]
  }

  function resultTextOf(entry: { outcome: { ok: boolean; result?: unknown } }): string {
    return entry.outcome.ok && typeof entry.outcome.result === 'string' ? entry.outcome.result : ''
  }

  it('replaces an older checkpointed read with its Session Evidence reference past the threshold', async () => {
    const store = storeHarness()
    const admission = store.snapshot()
    const llm = new ScriptedLlm(longRunScript())
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [readPage, createRecordEvidenceTool()],
      currentPageUrl: () => PAGE_URL,
      runContextCompactionThresholdChars: 1,
    })

    const events = await collectWithContinuity(pipeline, 'research the router', continuityFor(store, { evidence: admission }))

    // Before the later read existed, the checkpointed read was still the
    // latest actionable page state — it stayed verbatim (request 2).
    expect(resultTextOf(llm.requests[2]!.toolResults[0]!)).toBe(LONG_PAGE_TEXT)
    // Once a newer page state exists, the older checkpointed read rides
    // as its concise Session Evidence reference (requests 3 and 4).
    const compacted = resultTextOf(llm.requests[3]!.toolResults[0]!)
    expect(compacted).toContain('[compacted] ')
    expect(compacted).toContain('memory-1')
    expect(compacted).toContain(PAGE_URL)
    expect(compacted).toContain('The Acme router costs $39.')
    // Idempotent across rounds: the next compaction pass changes nothing.
    expect(resultTextOf(llm.requests[4]!.toolResults[0]!)).toBe(compacted)
    // The checkpoint result, the uncheckpointed read, and the latest
    // actionable page state remain verbatim.
    expect(resultTextOf(llm.requests[4]!.toolResults[1]!)).toContain('Session Evidence recorded')
    expect(resultTextOf(llm.requests[4]!.toolResults[2]!)).toBe('Settled page state after c3')
    expect(resultTextOf(llm.requests[4]!.toolResults[3]!)).toBe('Settled page state after c4')
    // Provider-protocol validity: every assistant call keeps its paired
    // result, in order, with the call untouched.
    expect(llm.requests[4]!.toolResults.map(({ call }) => call.id)).toEqual(['c1', 'c2', 'c3', 'c4'])
    // The feed kept the full result: compaction bounds only model context.
    expect(events.find((e) => e.type === 'tool_result' && e.callId === 'c1')).toMatchObject({
      ok: true,
      result: LONG_PAGE_TEXT,
    })
    // The immutable admission snapshot was never mutated — compaction
    // only read the live store.
    expect(llm.requests[4]!.evidence).toBe(admission)
    expect(llm.requests[4]!.evidence?.observations).toEqual([])
  })

  it('stays verbatim while the context is under the deterministic threshold', async () => {
    const store = storeHarness()
    const llm = new ScriptedLlm(longRunScript())
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [readPage, createRecordEvidenceTool()],
      currentPageUrl: () => PAGE_URL,
    })

    await collectWithContinuity(pipeline, 'research the router', continuityFor(store))

    expect(resultTextOf(llm.requests[4]!.toolResults[0]!)).toBe(LONG_PAGE_TEXT)
  })

  it('falls back to the original context once the Session ended', async () => {
    const store = storeHarness()
    let sessionLive = true
    const llm = new ScriptedLlm(longRunScript())
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [readPage, createRecordEvidenceTool()],
      currentPageUrl: () => PAGE_URL,
      runContextCompactionThresholdChars: 1,
      // The Session ends right after the checkpoint stored its
      // Observation: the live-session seam resolves to nothing for the
      // rest of the run.
      onObservation: (record) => {
        if (typeof record.payload === 'string' && record.payload.includes('memory-1')) sessionLive = false
      },
    })

    await collectWithContinuity(
      pipeline,
      'research the router',
      continuityFor(store, { evidenceSession: () => (sessionLive ? { store, runId: 'run-1' as RunId } : null) }),
    )

    // The checkpoint itself was accepted — but its reference resolves to
    // no live Session Evidence, so the read stays verbatim.
    expect(store.snapshot().observations.map(({ id }) => id)).toEqual(['memory-1'])
    expect(resultTextOf(llm.requests[4]!.toolResults[0]!)).toBe(LONG_PAGE_TEXT)
  })
})
