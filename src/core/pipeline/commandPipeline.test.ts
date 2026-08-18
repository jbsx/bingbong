import { describe, expect, it } from 'vitest'
import { createCommandPipeline, type CommandPipeline } from './createCommandPipeline'
import { createAskUserTool } from './askUserTools'
import { FailingTts, FakeClock, RecordingTts, ScriptedLlm } from '../testing/doubles'
import type { PipelineEvent } from './events'

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

describe('command pipeline', () => {
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
      { type: 'done', at: 1000 },
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
})
