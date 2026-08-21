import { describe, expect, it } from 'vitest'
import { createAssistantPipeline } from './createAssistantPipeline'
import { createSessionMemory } from '../../core/session/sessionMemory'
import { FakeBrowser, FakeClock, FakeSearch, RecordingTts, fakeSubagentManager, subagentRecord } from '../../core/testing/doubles'
import type { SearchResult } from '../../core/ports/search'
import type { CommandPipeline } from '../../core/pipeline/createCommandPipeline'
import type { PipelineEvent } from '../../core/pipeline/events'
import { createSubagentTools } from '../../core/pipeline/subagentTools'
import type { PerfTracer } from '../../core/perf/perfTracer'

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

  it('uses the configured ask timeout for dashboard and voice test windows', async () => {
    const clock = new FakeClock()
    const pipeline = createAssistantPipeline({
      controller: new FakeBrowser(),
      env: {
        BINGBONG_ASK_TIMEOUT_MS: '1500',
        BINGBONG_LLM_SCRIPT: JSON.stringify([
          { kind: 'tool_calls', calls: [{ id: 'a1', name: 'ask_user', args: { question: 'Which city?' } }] },
          { kind: 'answer', speak: 'Stopped.', display: 'No answer.' },
        ]),
      },
      clock,
    })

    const events: PipelineEvent[] = []
    for await (const event of pipeline.execute('book a hotel')) {
      events.push(event)
      if (event.type === 'ask_requested') clock.advance(1500)
    }

    expect(events).toContainEqual({
      type: 'ask_resolved',
      turnId: expect.any(String),
      askId: 'ask-1',
      answer: null,
      reason: 'timeout',
      at: 1500,
    })
  })

  it('mints turn ids through the injected tracer, stamped on every event (#28)', async () => {
    const minted: string[] = []
    const tracer = {
      mintTurnId: () => {
        minted.push(`turn-tr-${minted.length + 1}`)
        return minted.at(-1)!
      },
      now: () => 0,
      span: () => {},
      summarize: () => null,
    }
    const pipeline = createAssistantPipeline({
      controller: new FakeBrowser(),
      env: { BINGBONG_LLM_SCRIPT: SCRIPT },
      clock: new FakeClock(),
      tracer,
    })

    const events = await collect(pipeline, 'open youtube')

    expect(minted).toEqual(['turn-tr-1'])
    expect(events.length).toBeGreaterThan(0)
    for (const event of events) {
      expect('turnId' in event && event.turnId).toBe('turn-tr-1')
    }
  })

  it('records an llm span per orchestrator round through the injected tracer (#29)', async () => {
    const records: { turnId: string; stage: string; durMs: number; detail?: Record<string, unknown> }[] = []
    const monotonicMs = 0
    const tracer: PerfTracer = {
      mintTurnId: () => 'turn-tr-1',
      now: () => monotonicMs,
      span: (turnId, stage, durMs, detail) => {
        records.push({ turnId, stage, durMs, ...(detail ? { detail } : {}) })
      },
      summarize: () => null,
    }
    const pipeline = createAssistantPipeline({
      controller: new FakeBrowser(),
      env: { BINGBONG_LLM_SCRIPT: SCRIPT },
      clock: new FakeClock(),
      tracer,
    })

    const events = await collect(pipeline, 'open youtube')

    // Two orchestrator rounds (tool_calls, then the answer), both keyed to
    // the turn's id.
    expect(records.filter((r) => r.stage === 'llm').map((r) => r.turnId)).toEqual(['turn-tr-1', 'turn-tr-1'])
    expect(events.at(-1)).toMatchObject({ type: 'done', turnId: 'turn-tr-1' })
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

  it('re-resolves the LLM when live env changes, so settings apply without restart', async () => {
    const requests: { url: string; headers: Record<string, string> }[] = []
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), headers: Object.fromEntries(new Headers(init?.headers).entries()) })
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"speak":"Hi.","display":"Detail."}' } }] }), { status: 200 })
    }) as typeof fetch

    let env: Record<string, string | undefined> = {}
    const pipeline = createAssistantPipeline({
      controller: new FakeBrowser(),
      env: {},
      getEnv: () => env,
      fetchFn,
      tts: new RecordingTts(),
    })

    const before = await collect(pipeline, 'hello')
    expect(before.find((e) => e.type === 'error')?.message).toMatch(/model routing for 'orchestrator' is not configured/)
    expect(requests).toHaveLength(0)

    env = FULL_ENV
    const after = await collect(pipeline, 'hello again')

    expect(after.find((e) => e.type === 'error')).toBeUndefined()
    expect(requests).toHaveLength(1)
    expect(requests[0].headers.authorization).toBe('Bearer test-key')
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

  it('registers new_session when a session store is attached, and the reset clears it', async () => {
    const session = createSessionMemory()
    for (const event of [
      { type: 'command', text: 'find a pizza place', at: 0 },
      { type: 'display', text: '1. Pizza A 2. Pizza B', at: 1 },
      { type: 'done', outcome: 'done', at: 2 },
    ] as PipelineEvent[]) session.run().event(event)
    const pipeline = createAssistantPipeline({
      controller: new FakeBrowser(),
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify([
          { kind: 'tool_calls', calls: [{ id: 'c1', name: 'new_session', args: {} }] },
          { kind: 'answer', speak: 'Fresh start.', display: 'Fresh start.' },
        ]),
      },
      clock: new FakeClock(),
      session,
    })

    const events: PipelineEvent[] = []
    const observer = session.run()
    for await (const event of pipeline.execute('forget all that — different question')) {
      events.push(event)
      observer.event(event)
    }

    expect(events.find((e) => e.type === 'tool_result' && e.name === 'new_session')).toMatchObject({
      ok: true,
      result: expect.stringContaining('Session cleared'),
    })
    expect(session.history()).toEqual([])
  })

  it('keeps the tool catalog unchanged when no session store is attached', async () => {
    const requests: Record<string, unknown>[] = []
    const fetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"speak":"Hi.","display":"Detail."}' } }] }), { status: 200 })
    }) as typeof fetch

    const pipeline = createAssistantPipeline({
      controller: new FakeBrowser(),
      env: FULL_ENV,
      fetchFn,
      tts: new RecordingTts(),
    })

    await collect(pipeline, 'hello')

    const tools = (requests[0].tools as { function: { name: string } }[]).map((t) => t.function.name)
    expect(tools).not.toContain('new_session')
  })

  it('wires the detail sink through to blocking tools, turn-stamped (#43)', async () => {
    const detail: PipelineEvent[] = []
    const manager = fakeSubagentManager([subagentRecord('a-1'), subagentRecord('a-2')])
    const pipeline = createAssistantPipeline({
      controller: new FakeBrowser(),
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify([
          { kind: 'tool_calls', calls: [{ id: 'c1', name: 'agent_results', args: { wait: true } }] },
          { kind: 'answer', speak: 'Collected.', display: 'Collected.' },
        ]),
      },
      clock: new FakeClock(),
      subagentTools: createSubagentTools(manager),
      emitDetail: (event) => detail.push(event),
    })

    const events = await collect(pipeline, 'collect the reports')

    expect(detail).toEqual([
      { type: 'waiting_on_agents', turnId: expect.any(String), running: 2, at: 0 },
    ])
    expect(events.some((event) => event.type === 'waiting_on_agents')).toBe(false)
  })

  it('streams a scripted answer through onDelta as llm_delta detail events (#56)', async () => {
    // e2e's markdown-streaming seam: streamChunks on a scripted answer
    // flow through the round's onDelta — the delta batcher derives the
    // visible text (prose passes raw) and the detail channel carries the
    // llm_delta fragments ahead of the final display entry. The fake clock
    // never advances, so the batcher's whole window drains at round end
    // as one merged fragment.
    const detail: PipelineEvent[] = []
    const pipeline = createAssistantPipeline({
      controller: new FakeBrowser(),
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify([
          {
            kind: 'answer',
            speak: 'Done.',
            display: 'Final display.',
            streamChunks: ['## Part one\n\n', 'and **two**.'],
          },
        ]),
      },
      clock: new FakeClock(),
      emitDetail: (event) => detail.push(event),
    })

    const events = await collect(pipeline, 'explain streaming')

    expect(detail.filter((event) => event.type === 'llm_delta')).toEqual([
      { type: 'llm_delta', turnId: expect.any(String), kind: 'text', text: '## Part one\n\nand **two**.', at: 0 },
    ])
    expect(events.find((event) => event.type === 'display')).toMatchObject({ text: 'Final display.' })
  })
})
