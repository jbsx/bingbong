import { describe, expect, it } from 'vitest'
import type { SearchResult } from '../ports/search'
import { FakeSearch } from '../testing/doubles'
import { createCommandPipeline } from './createCommandPipeline'
import { createSearchTools, formatSearchResults } from './searchTools'
import { FakeClock, RecordingTts, ScriptedLlm } from '../testing/doubles'
import type { PipelineEvent } from './events'

async function collect(pipeline: ReturnType<typeof createCommandPipeline>, command: string): Promise<PipelineEvent[]> {
  const events: PipelineEvent[] = []
  for await (const event of pipeline.execute(command)) events.push(event)
  return events
}

function pipelineWith(search: FakeSearch) {
  return createCommandPipeline({
    llm: new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 's1', name: 'web_search', args: { query: 'best keyboards' } }] },
      { kind: 'answer', speak: 'Found some.', display: 'Detail.' },
    ]),
    tts: new RecordingTts(),
    clock: new FakeClock(),
    tools: createSearchTools(search),
  })
}

describe('web_search tool', () => {
  it('forwards the query to the provider and formats results for the model', async () => {
    const search = new FakeSearch([
      { title: 'First hit', url: 'https://one.test/a', snippet: 'About keyboards' },
      { title: 'Second hit', url: 'https://two.test/b' },
    ])
    const events = await collect(pipelineWith(search), 'search for keyboards')

    expect(search.queries).toEqual(['best keyboards'])
    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({
      ok: true,
      result: [
        '1. First hit — https://one.test/a',
        '   About keyboards',
        '2. Second hit — https://two.test/b',
      ].join('\n'),
    })
  })

  it('answers plainly when the provider has no results', async () => {
    const search = new FakeSearch([])
    const events = await collect(pipelineWith(search), 'search for keyboards')

    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({
      ok: true,
      result: 'no results for "best keyboards"',
    })
  })

  it('reports provider failures as recoverable tool results', async () => {
    const search = new (class extends FakeSearch {
      async search(): Promise<SearchResult[]> {
        throw new Error('web search failed (HTTP 429)')
      }
    })()
    const events = await collect(pipelineWith(search), 'search for keyboards')

    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({
      ok: false,
      error: 'web search failed (HTTP 429)',
    })
  })

  it('validates the query argument', async () => {
    const pipeline = createCommandPipeline({
      llm: new ScriptedLlm([
        { kind: 'tool_calls', calls: [{ id: 's1', name: 'web_search', args: { query: '  ' } }] },
        { kind: 'answer', speak: 'Recovered.', display: 'Detail.' },
      ]),
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: createSearchTools(new FakeSearch()),
    })

    const events = await collect(pipeline, 'search')

    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({
      ok: false,
      error: "web_search: 'query' must be a non-empty string",
    })
  })
})

describe('formatSearchResults', () => {
  it('numbers results and always shows the url, snippet on its own line', () => {
    const results: SearchResult[] = [
      { title: 'A', url: 'https://a.test', snippet: 'sa' },
      { title: 'B', url: 'https://b.test' },
    ]

    expect(formatSearchResults(results)).toBe('1. A — https://a.test\n   sa\n2. B — https://b.test')
  })
})
