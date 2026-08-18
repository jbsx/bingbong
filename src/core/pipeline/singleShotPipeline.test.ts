import { describe, expect, it } from 'vitest'
import { createSingleShotPipeline } from './singleShotPipeline'
import { createCommandPipeline, type CommandPipeline } from './createCommandPipeline'
import type { AssistantTurn, LlmClient } from '../ports/llm'
import { FakeClock, RecordingTts, ScriptedLlm } from '../testing/doubles'
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

    expect(events).toContainEqual({ type: 'speak', text: 'Done.', at: 1000 })
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

    expect(events).toContainEqual({ type: 'speak', text: 'Two.', at: 0 })
  })

  it('forwards confirmation resolutions to the inner pipeline', () => {
    const calls: string[] = []
    const inner: CommandPipeline = {
      async *execute() {},
      resolveConfirmation: (id, approved) => calls.push(`${id}:${approved}`),
      resolveAsk: () => {},
      abort: () => {},
      pause: () => {},
      resume: () => {},
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
      resume: () => {},
      getState: () => 'idle',
    }
    const pipeline = createSingleShotPipeline(inner, new FakeClock())

    pipeline.resolveAsk('ask-1', 'Paris')

    expect(calls).toEqual(['ask-1:Paris'])
  })
})
