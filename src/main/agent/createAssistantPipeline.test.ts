import { describe, expect, it } from 'vitest'
import { createAssistantPipeline } from './createAssistantPipeline'
import { FakeBrowser, FakeClock, FakeSearch, RecordingTts } from '../../core/testing/doubles'
import type { SearchResult } from '../../core/ports/search'
import type { CommandPipeline } from '../../core/pipeline/createCommandPipeline'
import type { PipelineEvent } from '../../core/pipeline/events'

const FULL_ENV = {
  BINGBONG_ORCHESTRATOR_BASE_URL: 'https://ai.z.ai/api/coding/paas/v4',
  BINGBONG_ORCHESTRATOR_MODEL: 'glm-5.3',
  BINGBONG_ORCHESTRATOR_API_KEY: 'test-key',
}

const SCRIPT = JSON.stringify([
  { kind: 'tool_calls', calls: [{ id: 'c1', name: 'navigate', args: { url: 'https://youtube.com' } }] },
  { kind: 'answer', speak: 'Opened YouTube.', display: 'Navigated to https://youtube.com.' },
])

async function collect(pipeline: CommandPipeline, command: string): Promise<PipelineEvent[]> {
  const events: PipelineEvent[] = []
  for await (const event of pipeline.execute(command)) events.push(event)
  return events
}

describe('createAssistantPipeline', () => {
  it('errors with a spoken one-liner when model routing is unconfigured', async () => {
    const browser = new FakeBrowser()
    const pipeline = createAssistantPipeline({ controller: browser, env: {} })

    const events = await collect(pipeline, 'open youtube')

    const error = events.find((e) => e.type === 'error')
    expect(error?.message).toMatch(/model routing for 'orchestrator' is not configured/)
    expect(events.find((e) => e.type === 'speak')).toMatchObject({ type: 'speak' })
    expect(events.at(-1)).toMatchObject({ type: 'done' })
  })

  it('runs the loop from a scripted LLM override and drives the browser', async () => {
    const browser = new FakeBrowser()
    const pipeline = createAssistantPipeline({
      controller: browser,
      env: { BINGBONG_LLM_SCRIPT: SCRIPT },
      clock: new FakeClock(),
    })

    const events = await collect(pipeline, 'open youtube')

    expect(browser.navigations).toEqual(['https://youtube.com'])
    expect(events.find((e) => e.type === 'tool_call')).toMatchObject({ name: 'navigate', args: { url: 'https://youtube.com' } })
    expect(events.find((e) => e.type === 'display')).toMatchObject({ text: 'Navigated to https://youtube.com.' })
    expect(events.find((e) => e.type === 'speak')).toMatchObject({ text: 'Opened YouTube.' })
    expect(events.at(-1)).toMatchObject({ type: 'done' })
  })

  it('rejects a malformed LLM script override loudly', async () => {
    const pipeline = createAssistantPipeline({
      controller: new FakeBrowser(),
      env: { BINGBONG_LLM_SCRIPT: '{not json' },
    })

    const events = await collect(pipeline, 'open youtube')

    expect(events.find((e) => e.type === 'error')?.message).toMatch(/BINGBONG_LLM_SCRIPT is not valid JSON/)
  })

  it('targets the configured endpoint and model when routing resolves', async () => {
    const requests: { url: string; body: Record<string, unknown> }[] = []
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> })
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"speak":"Hi.","display":"Detail."}' } }] }), { status: 200 })
    }) as typeof fetch

    const pipeline = createAssistantPipeline({
      controller: new FakeBrowser(),
      env: FULL_ENV,
      fetchFn,
      tts: new RecordingTts(),
    })

    const events = await collect(pipeline, 'hello')

    expect(requests).toHaveLength(1)
    expect(requests[0].url).toBe('https://ai.z.ai/api/coding/paas/v4/chat/completions')
    expect(requests[0].body.model).toBe('glm-5.3')
    expect(events.find((e) => e.type === 'speak')).toMatchObject({ text: 'Hi.' })
  })

  it('exposes search and media tools alongside the browser verbs', async () => {
    const results: SearchResult[] = [{ title: 'Hit', url: 'https://hit.test', snippet: 'snip' }]
    const browser = new FakeBrowser()
    const pipeline = createAssistantPipeline({
      controller: browser,
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify([
          {
            kind: 'tool_calls',
            calls: [
              { id: 'w1', name: 'web_search', args: { query: 'keyboards' } },
              { id: 'm1', name: 'media_control', args: { action: 'next' } },
            ],
          },
          { kind: 'answer', speak: 'Done.', display: 'Detail.' },
        ]),
      },
      search: new FakeSearch(results),
      clock: new FakeClock(),
    })

    const events = await collect(pipeline, 'search and skip to the next track')

    expect(events.find((e) => e.type === 'tool_result' && e.name === 'web_search')).toMatchObject({
      ok: true,
      result: '1. Hit — https://hit.test\n   snip',
    })
    expect(browser.pressedKeys).toEqual([{ press: { key: 'n', shift: true }, times: 1 }])
  })
})
