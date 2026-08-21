import { describe, expect, it } from 'vitest'
import { createSingleShotPipeline } from './singleShotPipeline'
import { createCommandPipeline, type CommandPipeline } from './createCommandPipeline'
import type { AssistantTurn, LlmClient } from '../ports/llm'
import { FakeClock, RecordingTts, ScriptedLlm, fakePerfHarness } from '../testing/doubles'
import type { PipelineEvent } from './events'

async function collect(pipeline: CommandPipeline, command: string): Promise<PipelineEvent[]> {
  const events: PipelineEvent[] = []
  for await (const event of pipeline.execute(command)) events.push(event)
  return events
}

function answerPipeline(clock: FakeClock, turns: AssistantTurn[]): CommandPipeline {
  return createCommandPipeline({ llm: new ScriptedLlm(turns), tts: new RecordingTts(), clock, tools: [] })
}

describe('createSingleShotPipeline', () => {
  it('passes commands through when idle', async () => {
    const clock = new FakeClock(1000)
    const pipeline = createSingleShotPipeline(answerPipeline(clock, [{ kind: 'answer', speak: 'Done.', display: 'Detail.' }]), clock)

    const events = await collect(pipeline, 'hello')

    expect(events).toContainEqual({ type: 'speak', turnId: expect.any(String), text: 'Done.', at: 1000 })
    expect(events.at(-1)).toMatchObject({ type: 'done' })
  })

  it('rejects a second command while one is running, as an error event with clock time', async () => {
    const clock = new FakeClock(0)
    const neverResolves = new Promise<AssistantTurn>(() => {})
    const llm: LlmClient = { complete: () => neverResolves }
    const inner = createCommandPipeline({ llm, tts: new RecordingTts(), clock, tools: [] })
    const pipeline = createSingleShotPipeline(inner, clock)

    void (async () => {
      for await (const event of pipeline.execute('first command')) void event
    })()

    const events = await collect(pipeline, 'second command')

    expect(events.map((e) => e.type)).toEqual(['command', 'error', 'speak', 'done'])
    expect(events[0]).toMatchObject({ type: 'command', text: 'second command', at: 0 })
    expect(events[1]).toMatchObject({ type: 'error', message: expect.stringContaining('already running'), at: 0 })
    expect(events[2]).toMatchObject({ type: 'speak', text: expect.stringContaining('Something went wrong'), at: 0 })
    expect(events[3]).toMatchObject({ type: 'done', outcome: 'failed', at: 0 })
  })

  it('frees up once the running command finishes', async () => {
    const clock = new FakeClock()
    const pipeline = createSingleShotPipeline(
      answerPipeline(clock, [
        { kind: 'answer', speak: 'One.', display: 'D1' },
        { kind: 'answer', speak: 'Two.', display: 'D2' },
      ]),
      clock,
    )

    await collect(pipeline, 'first')
    const events = await collect(pipeline, 'second')

    expect(events).toContainEqual({ type: 'speak', turnId: expect.any(String), text: 'Two.', at: 0 })
  })

  it('forwards the submitted turn id to the inner pipeline and stamps it on every event', async () => {
    const clock = new FakeClock(0)
    const pipeline = createSingleShotPipeline(
      answerPipeline(clock, [{ kind: 'answer', speak: 'Done.', display: 'Detail.' }]),
      clock,
    )

    const events: PipelineEvent[] = []
    for await (const event of pipeline.execute('spoken command', 'turn-voice-7')) events.push(event)

    expect(events.length).toBeGreaterThan(0)
    for (const event of events) {
      expect('turnId' in event && event.turnId).toBe('turn-voice-7')
    }
  })

  it('forwards a capped utterance\'s truncation flag to the inner pipeline (#61)', async () => {
    const clock = new FakeClock(0)
    const llm = new ScriptedLlm([{ kind: 'answer', speak: 'Finish your request?', display: 'Asked.' }])
    const inner = createCommandPipeline({ llm, tts: new RecordingTts(), clock, tools: [] })
    const pipeline = createSingleShotPipeline(inner, clock)

    for await (const event of pipeline.execute('and then open the', 'turn-voice-8', true)) void event

    expect(llm.requests[0].truncated).toBe(true)
  })

  it('gives a busy-rejected submission its own minted turn id', async () => {
    const clock = new FakeClock(0)
    const neverResolves = new Promise<AssistantTurn>(() => {})
    const llm: LlmClient = { complete: () => neverResolves }
    const inner = createCommandPipeline({ llm, tts: new RecordingTts(), clock, tools: [] })
    const pipeline = createSingleShotPipeline(inner, clock)

    void (async () => {
      for await (const event of pipeline.execute('first command')) void event
    })()

    const rejected: PipelineEvent[] = []
    for await (const event of pipeline.execute('second command')) rejected.push(event)

    const ids = new Set(rejected.map((event) => ('turnId' in event ? event.turnId : undefined)))
    expect(ids.size).toBe(1)
    expect([...ids][0]).toMatch(/^turn-/)
    // The running turn keeps its own id — the rejection never leaks onto it.
    expect([...ids][0]).not.toBe(undefined)
  })

  it('closes out a busy-rejected turn that recorded spans: summary event + console line', async () => {
    const { records, tracer } = fakePerfHarness()
    // The voice session already recorded this turn's stt span at utterance end.
    tracer.span('turn-voice-5', 'stt', 700, { speechMs: 4_000 })
    const clock = new FakeClock(0)
    const neverResolves = new Promise<AssistantTurn>(() => {})
    const llm: LlmClient = { complete: () => neverResolves }
    const inner = createCommandPipeline({ llm, tts: new RecordingTts(), clock, tools: [] })
    const lines: string[] = []
    const pipeline = createSingleShotPipeline(inner, clock, { tracer, printSummary: (line) => lines.push(line) })

    void (async () => {
      for await (const event of pipeline.execute('first command')) void event
    })()

    const rejected: PipelineEvent[] = []
    for await (const event of pipeline.execute('spoken command', 'turn-voice-5')) rejected.push(event)

    expect(rejected.at(-1)).toMatchObject({ type: 'done', outcome: 'failed' })
    expect(records.at(-1)).toMatchObject({ turnId: 'turn-voice-5', stage: 'summary', durMs: 700 })
    expect(lines).toEqual(['stt 0.7s | total 0.7s'])
  })

  it('a busy-rejected text-box turn with no spans prints nothing', async () => {
    const { records, tracer } = fakePerfHarness()
    const clock = new FakeClock(0)
    const neverResolves = new Promise<AssistantTurn>(() => {})
    const llm: LlmClient = { complete: () => neverResolves }
    const inner = createCommandPipeline({ llm, tts: new RecordingTts(), clock, tools: [] })
    const lines: string[] = []
    const pipeline = createSingleShotPipeline(inner, clock, { tracer, printSummary: (line) => lines.push(line) })

    void (async () => {
      for await (const event of pipeline.execute('first command')) void event
    })()

    for await (const event of pipeline.execute('second command')) void event

    expect(records.filter((record) => record.stage === 'summary')).toEqual([])
    expect(lines).toEqual([])
  })

  it('forwards confirmation resolutions to the inner pipeline', () => {
    const calls: string[] = []
    const inner: CommandPipeline = {
      async *execute() {},
      resolveConfirmation: (id, approved) => calls.push(`${id}:${approved}`),
      resolveAsk: () => {},
      abort: () => {},
      pause: () => {},
      resume: () => false,
      getState: () => 'idle',
    }
    const pipeline = createSingleShotPipeline(inner, new FakeClock())

    pipeline.resolveConfirmation('confirm-9', true)

    expect(calls).toEqual(['confirm-9:true'])
  })

  it('forwards ask answers to the inner pipeline', () => {
    const calls: string[] = []
    const inner: CommandPipeline = {
      async *execute() {},
      resolveConfirmation: () => {},
      resolveAsk: (id, answer) => calls.push(`${id}:${answer}`),
      abort: () => {},
      pause: () => {},
      resume: () => false,
      getState: () => 'idle',
    }
    const pipeline = createSingleShotPipeline(inner, new FakeClock())

    pipeline.resolveAsk('ask-1', 'Paris')

    expect(calls).toEqual(['ask-1:Paris'])
  })
})
