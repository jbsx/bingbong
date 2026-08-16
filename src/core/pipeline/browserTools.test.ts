import { describe, expect, it } from 'vitest'
import youtubeHome from '../browser/fixtures/youtube-home.json'
import { buildPageSnapshot, formatPageSnapshot, parseCollectedPage, type CollectedPage } from '../browser/snapshot'
import type { BrowserController, BrowserState } from '../ports/browser'
import { createCommandPipeline, type CommandPipeline } from './createCommandPipeline'
import { createBrowserTools } from './browserTools'
import { FakeClock, RecordingTts, ScriptedLlm } from '../testing/doubles'
import type { PipelineEvent } from './events'
import type { AssistantTurn } from '../ports/llm'

const youtubeFixture = youtubeHome as unknown as CollectedPage

// The pipeline seam should see what a real controller produces: raw collected
// DOM payload in, numbered-ref text out — parsing exercised for real.
function formatYoutubeSnapshot(): string {
  return formatPageSnapshot(buildPageSnapshot(parseCollectedPage(youtubeHome)))
}

class FixtureBrowserController implements BrowserController {
  readonly navigations: string[] = []
  readonly clicks: number[] = []
  readonly typed: { ref: number; text: string }[] = []
  readonly scrolls: ('up' | 'down')[] = []
  wentBack = 0
  screenshotBytes = new Uint8Array([1, 2, 3])

  async navigate(url: string): Promise<void> {
    this.navigations.push(url)
  }

  async readPage(): Promise<string> {
    return formatYoutubeSnapshot()
  }

  async click(ref: number): Promise<void> {
    this.clicks.push(ref)
  }

  async type(ref: number, text: string): Promise<void> {
    this.typed.push({ ref, text })
  }

  async scroll(direction: 'up' | 'down'): Promise<void> {
    this.scrolls.push(direction)
  }

  async screenshot(): Promise<Uint8Array> {
    return this.screenshotBytes
  }

  async back(): Promise<void> {
    this.wentBack += 1
  }

  state(): BrowserState {
    return { url: youtubeFixture.url, title: youtubeFixture.title }
  }
}

async function collect(pipeline: CommandPipeline, command: string): Promise<PipelineEvent[]> {
  const events: PipelineEvent[] = []
  for await (const event of pipeline.execute(command)) events.push(event)
  return events
}

function pipelineWith(browser: BrowserController, calls: AssistantTurn[]) {
  const llm = new ScriptedLlm(calls)
  const pipeline = createCommandPipeline({
    llm,
    tts: new RecordingTts(),
    clock: new FakeClock(),
    tools: createBrowserTools(browser),
  })
  return { llm, pipeline }
}

describe('browser tools through the pipeline', () => {
  it('read_page surfaces the numbered-ref snapshot as a tool result', async () => {
    const browser = new FixtureBrowserController()
    const { pipeline } = pipelineWith(browser, [
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'read_page', args: {} }] },
      { kind: 'answer', speak: 'Read it.', display: 'Detail.' },
    ])

    const events = await collect(pipeline, 'what is on the page')

    expect(events).toContainEqual({
      type: 'tool_result',
      callId: 'c1',
      name: 'read_page',
      ok: true,
      result: formatYoutubeSnapshot(),
      at: 0,
    })
  })

  it('click accepts numeric refs from the model and acts on the browser', async () => {
    const browser = new FixtureBrowserController()
    const { pipeline } = pipelineWith(browser, [
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'click', args: { ref: 7 } }] },
      { kind: 'answer', speak: 'Clicked.', display: 'Detail.' },
    ])

    await collect(pipeline, 'click the sign-in link')

    expect(browser.clicks).toEqual([7])
  })

  it('coerces string refs from the model', async () => {
    const browser = new FixtureBrowserController()
    const { pipeline } = pipelineWith(browser, [
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'click', args: { ref: '7' } }] },
      { kind: 'answer', speak: 'Clicked.', display: 'Detail.' },
    ])

    const events = await collect(pipeline, 'click the sign-in link')

    expect(browser.clicks).toEqual([7])
    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({ ok: true })
  })

  it('type forwards ref and text; navigate forwards url; scroll validates direction', async () => {
    const browser = new FixtureBrowserController()
    const { pipeline } = pipelineWith(browser, [
      {
        kind: 'tool_calls',
        calls: [
          { id: 'c1', name: 'navigate', args: { url: 'youtube.com' } },
          { id: 'c2', name: 'type', args: { ref: 3, text: 'mechanical keyboards\n' } },
          { id: 'c3', name: 'scroll', args: { direction: 'down' } },
          { id: 'c4', name: 'back', args: {} },
        ],
      },
      { kind: 'answer', speak: 'Done.', display: 'Detail.' },
    ])

    await collect(pipeline, 'search for keyboards')

    expect(browser.navigations).toEqual(['youtube.com'])
    expect(browser.typed).toEqual([{ ref: 3, text: 'mechanical keyboards\n' }])
    expect(browser.scrolls).toEqual(['down'])
    expect(browser.wentBack).toBe(1)
  })

  it('reports a screenshot as a byte-count summary', async () => {
    const browser = new FixtureBrowserController()
    const { pipeline } = pipelineWith(browser, [
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'screenshot', args: {} }] },
      { kind: 'answer', speak: 'Shot.', display: 'Detail.' },
    ])

    const events = await collect(pipeline, 'take a screenshot')

    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({
      ok: true,
      result: 'screenshot captured (3 bytes)',
    })
  })

  it('reports bad tool arguments as failed results the model can recover from', async () => {
    const browser = new FixtureBrowserController()
    const { pipeline } = pipelineWith(browser, [
      {
        kind: 'tool_calls',
        calls: [
          { id: 'c1', name: 'click', args: {} },
          { id: 'c2', name: 'type', args: { ref: 3 } },
          { id: 'c3', name: 'scroll', args: { direction: 'sideways' } },
          { id: 'c4', name: 'navigate', args: {} },
        ],
      },
      { kind: 'answer', speak: 'Recovered.', display: 'Detail.' },
    ])

    const events = await collect(pipeline, 'do things')

    const results = events.filter((e) => e.type === 'tool_result')
    expect(results.map((r) => (r as { error?: string }).error)).toEqual([
      "click: 'ref' must be a number",
      "type: 'text' must be a non-empty string",
      "scroll: 'direction' must be 'up' or 'down'",
      "navigate: 'url' must be a non-empty string",
    ])
    expect(browser.clicks).toEqual([])
  })
})
