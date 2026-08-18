import { describe, expect, it } from 'vitest'
import { createCommandPipeline, type CommandPipeline } from './createCommandPipeline'
import { createAskUserTool } from './askUserTools'
import { createSessionMemory } from '../session/sessionMemory'
import { FailingTts, FakeClock, RecordingTts, ScriptedLlm } from '../testing/doubles'
import type { PipelineEvent } from './events'
import type { AssistantTurn, LlmClient, LlmRequest } from '../ports/llm'

async function collect(
  pipeline: CommandPipeline,
  command: string,
  onEvent?: (event: PipelineEvent, pipeline: CommandPipeline) => void,
): Promise<PipelineEvent[]> {
  const events: PipelineEvent[] = []
  for await (const event of pipeline.execute(command)) {
    events.push(event)
    onEvent?.(event, pipeline)
  }
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
      { type: 'done', outcome: 'done', at: 1000 },
    ])
    expect(tts.spoken).toEqual(['Done.'])
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

  it('stops with an error when the LLM exceeds the tool-round limit', async () => {
    let executions = 0
    const spinner = {
      name: 'spin',
      async execute() {
        executions += 1
        return 'spun'
      },
    }
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

    expect(executions).toBe(2)
    expect(events.filter((e) => e.type === 'tool_result')).toHaveLength(2)
    expect(events.find((e) => e.type === 'error')).toMatchObject({ type: 'error', message: 'tool round limit (2) reached' })
    expect(events.find((e) => e.type === 'speak')).toMatchObject({
      type: 'speak',
      text: 'Something went wrong: tool round limit (2) reached',
    })
    expect(events.at(-1)).toMatchObject({ type: 'done' })
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

  it('rides the session store\'s history along on every LLM round, reading it live', async () => {
    let reads = 0
    const session = {
      history() {
        reads += 1
        return [
          { role: 'user' as const, text: 'find a pizza place' },
          { role: 'assistant' as const, text: 'Found two: Pizza A and Pizza B.' },
        ]
      },
    }
    const spinner = { name: 'spin', async execute() { return 'spun' } }
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'spin', args: {} }] },
      { kind: 'answer', speak: 'The second one.', display: 'Pizza B.' },
    ])
    const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock: new FakeClock(), tools: [spinner], session })

    await collect(pipeline, 'what about the second one?')

    expect(reads).toBe(2)
    expect(llm.requests).toHaveLength(2)
    for (const request of llm.requests) {
      expect(request.history).toEqual([
        { role: 'user', text: 'find a pizza place' },
        { role: 'assistant', text: 'Found two: Pizza A and Pizza B.' },
      ])
    }
  })

  it('omits the history field entirely when the session has no prior turns', async () => {
    const spinner = { name: 'spin', async execute() { return 'spun' } }
    const answer = { kind: 'answer' as const, speak: 'Done.', display: 'Done.' }
    const withSessionLlm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'spin', args: {} }] },
      answer,
    ])
    const withoutSessionLlm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'spin', args: {} }] },
      answer,
    ])
    const withSession = createCommandPipeline({
      llm: withSessionLlm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [spinner],
      session: { history: () => [] },
    })
    const withoutSession = createCommandPipeline({
      llm: withoutSessionLlm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [spinner],
    })

    await collect(withSession, 'first command')
    await collect(withoutSession, 'first command')

    for (const request of [...withSessionLlm.requests, ...withoutSessionLlm.requests]) {
      expect(request).not.toHaveProperty('history')
    }
  })

  it('feeds a real session store from its own event stream: run two sees run one', async () => {
    const session = createSessionMemory()
    const spinner = { name: 'spin', async execute() { return 'spun' } }
    const clock = new FakeClock()
    const llm = new ScriptedLlm([
      { kind: 'answer', speak: 'Found two.', display: '1. Pizza A 2. Pizza B' },
      { kind: 'answer', speak: 'The second one.', display: 'Pizza B.' },
    ])
    const pipeline = createCommandPipeline({ llm, tts: new RecordingTts(), clock, tools: [spinner], session })
    const observe = (events: PipelineEvent[]): void => {
      const observer = session.run()
      for (const event of events) observer.event(event)
    }

    const runOne: PipelineEvent[] = []
    for await (const event of pipeline.execute('find a pizza place')) runOne.push(event)
    observe(runOne)

    const runTwo: PipelineEvent[] = []
    for await (const event of pipeline.execute('what about the second one?')) runTwo.push(event)

    expect(llm.requests[0]).not.toHaveProperty('history')
    expect(llm.requests[1].history).toEqual([
      { role: 'user', text: 'find a pizza place' },
      { role: 'assistant', text: '1. Pizza A 2. Pizza B' },
    ])
  })
})
