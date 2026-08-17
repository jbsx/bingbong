import { describe, expect, it } from 'vitest'
import { createCommandPipeline } from './createCommandPipeline'
import { createMediaTools } from './mediaTools'
import { FakeBrowser, FakeClock, RecordingTts, ScriptedLlm } from '../testing/doubles'
import type { PipelineEvent } from './events'
import type { CommandPipeline } from './createCommandPipeline'

async function collect(pipeline: CommandPipeline, command: string): Promise<PipelineEvent[]> {
  const events: PipelineEvent[] = []
  for await (const event of pipeline.execute(command)) events.push(event)
  return events
}

function run(
  browser: FakeBrowser,
  calls: { id: string; args: Record<string, unknown> }[],
): Promise<PipelineEvent[]> {
  const pipeline = createCommandPipeline({
    llm: new ScriptedLlm([
      { kind: 'tool_calls', calls: calls.map(({ id, args }) => ({ id, name: 'media_control', args })) },
      { kind: 'answer', speak: 'Done.', display: 'Detail.' },
    ]),
    tts: new RecordingTts(),
    clock: new FakeClock(),
    tools: createMediaTools(browser),
  })
  return collect(pipeline, 'control the media')
}

describe('media_control tool', () => {
  it.each([
    ['play_pause', { key: 'k' }, 1],
    ['volume_up', { key: 'ArrowUp' }, 1],
    ['volume_down', { key: 'ArrowDown' }, 1],
    ['next', { key: 'n', shift: true }, 1],
  ] as const)('%s injects the right key on the focused page', async (action, press, times) => {
    const browser = new FakeBrowser()

    await run(browser, [{ id: 'm1', args: { action } }])

    expect(browser.pressedKeys).toEqual([{ press, times }])
  })

  it('seek presses l/j once per full 10-second step, rounded up', async () => {
    const browser = new FakeBrowser()

    const events = await run(browser, [{ id: 'm1', args: { action: 'seek', offset: 30 } }])

    expect(browser.pressedKeys).toEqual([{ press: { key: 'l' }, times: 3 }])
    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({
      ok: true,
      result: 'seeked forward 30s (3 presses)',
    })
  })

  it('seek backwards presses j', async () => {
    const browser = new FakeBrowser()

    await run(browser, [{ id: 'm1', args: { action: 'seek', offset: -10 } }])

    expect(browser.pressedKeys).toEqual([{ press: { key: 'j' }, times: 1 }])
  })

  it('caps long seeks at 5 minutes of presses', async () => {
    const browser = new FakeBrowser()

    await run(browser, [{ id: 'm1', args: { action: 'seek', offset: 900 } }])

    expect(browser.pressedKeys).toEqual([{ press: { key: 'l' }, times: 30 }])
  })

  it.each([
    [{ action: 'seek', offset: 5 }, 1],
    [{ action: 'seek', offset: 15 }, 2],
    [{ action: 'seek', offset: -25 }, 3],
  ] as const)('seek %j rounds partial steps up', async (args, presses) => {
    const browser = new FakeBrowser()

    await run(browser, [{ id: 'm1', args }])

    expect(browser.pressedKeys).toEqual([{ press: { key: args.offset > 0 ? 'l' : 'j' }, times: presses }])
  })

  it('reports bad arguments as recoverable failures without pressing anything', async () => {
    const browser = new FakeBrowser()

    const events = await run(browser, [
      { id: 'm1', args: { action: 'dance' } },
      { id: 'm2', args: {} },
      { id: 'm3', args: { action: 'seek' } },
      { id: 'm4', args: { action: 'seek', offset: 0 } },
      { id: 'm5', args: { action: 'seek', offset: 'soon' } },
    ])

    const errors = events
      .filter((e) => e.type === 'tool_result')
      .map((e) => (e as { error?: string }).error)
    expect(errors).toEqual([
      "media_control: 'action' must be one of play_pause, volume_up, volume_down, next, seek",
      "media_control: 'action' must be one of play_pause, volume_up, volume_down, next, seek",
      "media_control: 'offset' must be a non-zero number of seconds for action 'seek'",
      "media_control: 'offset' must be a non-zero number of seconds for action 'seek'",
      "media_control: 'offset' must be a non-zero number of seconds for action 'seek'",
    ])
    expect(browser.pressedKeys).toEqual([])
  })

  it('coerces string offsets from the model', async () => {
    const browser = new FakeBrowser()

    await run(browser, [{ id: 'm1', args: { action: 'seek', offset: '20' } }])

    expect(browser.pressedKeys).toEqual([{ press: { key: 'l' }, times: 2 }])
  })

  it('ignores offset for non-seek actions', async () => {
    const browser = new FakeBrowser()

    const events = await run(browser, [{ id: 'm1', args: { action: 'play_pause', offset: 30 } }])

    expect(browser.pressedKeys).toEqual([{ press: { key: 'k' }, times: 1 }])
    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({ ok: true })
  })

  it('summarizes simple actions for the model', async () => {
    const browser = new FakeBrowser()

    const events = await run(browser, [
      { id: 'm1', args: { action: 'play_pause' } },
      { id: 'm2', args: { action: 'volume_up' } },
      { id: 'm3', args: { action: 'next' } },
    ])

    const results = events
      .filter((e) => e.type === 'tool_result')
      .map((e) => (e as { result?: unknown }).result)
    expect(results).toEqual(['toggled play/pause', 'volume up (5%)', 'next track'])
  })
})

describe('media_control tool surface', () => {
  it('exposes exactly the playback verbs — nothing ad-related', () => {
    const actionParam = createMediaTools(new FakeBrowser())[0].parameters?.['action']
    expect(actionParam?.enum).toEqual(['play_pause', 'volume_up', 'volume_down', 'next', 'seek'])
  })

  it('is ungated: media verbs are not risk-gated actions', () => {
    const tool = createMediaTools(new FakeBrowser())[0]
    expect(tool.assessRisk).toBeUndefined()
  })
})
