import { describe, expect, it } from 'vitest'
import { createAssistantPipeline } from './createAssistantPipeline'
import { FakeAppControls, FakeBrowser, FakeClock, FakePanel, FakeSettings, RecordingTts, fakeSubagentManager, subagentRecord } from '../../core/testing/doubles'
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

  it('carries the pinned clock date as runtime context in every Run (#103)', async () => {
    const requests: { body: Record<string, unknown> }[] = []
    const fetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push({ body: JSON.parse(String(init?.body)) as Record<string, unknown> })
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"speak":"Hi.","display":"Detail."}' } }] }), { status: 200 })
    }) as typeof fetch

    // One minute before local midnight: a Run now, then one after the clock
    // rolls over — the long-lived pipeline sees the new date next Run.
    const clock = new FakeClock(new Date(2026, 7, 24, 23, 59).getTime())
    const pipeline = createAssistantPipeline({
      controller: new FakeBrowser(),
      env: FULL_ENV,
      fetchFn,
      tts: new RecordingTts(),
      clock,
    })

    await collect(pipeline, 'hello')
    clock.advance(2 * 60_000)
    await collect(pipeline, 'hello again')

    const systemOf = (index: number): unknown =>
      (requests[index].body.messages as { role: string; content: unknown }[]).find((message) => message.role === 'system')?.content
    expect(systemOf(0)).toEqual(expect.stringContaining('Runtime context:\n- Today is 2026-08-24'))
    expect(systemOf(1)).toEqual(expect.stringContaining('Runtime context:\n- Today is 2026-08-25'))
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

  it('exposes media tools alongside the browser verbs, and no off-screen web tool (#83)', async () => {
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
      clock: new FakeClock(),
    })

    const events = await collect(pipeline, 'skip to the next track')

    // web_search is deleted (ADR 0009): an off-screen call cannot run, and
    // the model sees a recoverable unknown-tool result instead.
    expect(events.find((e) => e.type === 'tool_result' && e.name === 'web_search')).toMatchObject({
      ok: false,
      error: "unknown tool: 'web_search'",
    })
    expect(browser.pressedKeys).toEqual([{ press: { key: 'n', shift: true }, times: 1 }])
  })

  it('registers new_session, and its success consumes the resetting run (#99)', async () => {
    const pipeline = createAssistantPipeline({
      controller: new FakeBrowser(),
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify([
          {
            kind: 'tool_calls',
            calls: [
              { id: 'c1', name: 'new_session', args: {} },
              { id: 'c2', name: 'media_control', args: { action: 'next' } },
            ],
          },
          { kind: 'answer', speak: 'Fresh start.', display: 'Fresh start.' },
        ]),
      },
      clock: new FakeClock(),
    })

    const events = await collect(pipeline, 'forget all that — different question')

    expect(events.find((e) => e.type === 'tool_result' && e.name === 'new_session')).toMatchObject({
      ok: true,
      result: expect.stringContaining('session: boundary=reset end_reason=reset'),
    })
    // The sibling call from the same response never executes and no later
    // model round happens: the run reports the reset boundary instead.
    expect(events.some((e) => e.type === 'tool_call' && e.name === 'media_control')).toBe(false)
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'reset' })
  })

  it('registers the panel tools when a panel is attached, and they drive it silently', async () => {
    const panel = new FakePanel()
    const tts = new RecordingTts()
    const pipeline = createAssistantPipeline({
      controller: new FakeBrowser(),
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify([
          {
            kind: 'tool_calls',
            calls: [
              { id: 'p1', name: 'toggle_panel', args: {} },
              { id: 'p2', name: 'set_panel_mode', args: { mode: 'docked' } },
            ],
          },
          { kind: 'answer', speak: 'Docked.', display: 'The panel is docked.' },
        ]),
      },
      clock: new FakeClock(),
      tts,
      panel,
    })

    const events = await collect(pipeline, 'dock the panel')

    expect(events.filter((e) => e.type === 'confirmation_requested')).toEqual([])
    expect(events.find((e) => e.type === 'tool_result' && e.name === 'toggle_panel')).toMatchObject({ ok: true })
    expect(events.find((e) => e.type === 'tool_result' && e.name === 'set_panel_mode')).toMatchObject({
      ok: true,
      result: 'Panel mode set to docked.',
    })
    expect(panel.state()).toMatchObject({ mode: 'docked', open: true })
    // Silent ops: nothing spoke besides the model's own answer.
    expect(events.filter((e) => e.type === 'speak').map((e) => (e as { text: string }).text)).toEqual(['Docked.'])
    expect(tts.spoken).toEqual(['Docked.'])
  })

  it('offers both panel tools to the model in the request catalog when a panel is attached', async () => {
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
      panel: new FakePanel(),
    })

    await collect(pipeline, 'hello')

    const tools = (requests[0].tools as { function: { name: string } }[]).map((t) => t.function.name)
    expect(tools).toContain('toggle_panel')
    expect(tools).toContain('set_panel_mode')
  })

  it('keeps the panel tools out of the catalog when no panel is attached', async () => {
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
    expect(tools).not.toContain('toggle_panel')
    expect(tools).not.toContain('set_panel_mode')
  })

  it('applies a set_setting call immediately through the settings seam, unconfirmed and silent', async () => {
    const settings = new FakeSettings()
    const tts = new RecordingTts()
    const pipeline = createAssistantPipeline({
      controller: new FakeBrowser(),
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify([
          {
            kind: 'tool_calls',
            calls: [{ id: 's1', name: 'set_setting', args: { setting: 'web_zoom_percent', number_value: 90 } }],
          },
          { kind: 'answer', speak: 'Ninety percent.', display: 'Zoom set to 90%.' },
        ]),
      },
      clock: new FakeClock(),
      tts,
      settings,
    })

    const events = await collect(pipeline, 'zoom the web to ninety percent')

    expect(events.filter((e) => e.type === 'confirmation_requested')).toEqual([])
    // The plan-less round carries the one corrective Run Plan nudge (#116)
    // appended to the useful result.
    expect(events.find((e) => e.type === 'tool_result' && e.name === 'set_setting')).toMatchObject({
      ok: true,
      result: expect.stringMatching(/^Web zoom set to 90%\./),
    })
    expect(
      (events.find((e) => e.type === 'tool_result' && e.name === 'set_setting') as { result?: unknown })?.result,
    ).toEqual(expect.stringContaining('report_run_plan'))
    expect(settings.get().webZoomPercent).toBe(90)
    // Silent: nothing spoke besides the model's own answer.
    expect(tts.spoken).toEqual(['Ninety percent.'])
  })

  it('holds an app_control quit on the confirmation gate and never quits when denied', async () => {
    const app = new FakeAppControls()
    const pipeline = createAssistantPipeline({
      controller: new FakeBrowser(),
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify([
          { kind: 'tool_calls', calls: [{ id: 'q1', name: 'app_control', args: { action: 'quit' } }] },
          { kind: 'answer', speak: 'Still here.', display: 'Quit cancelled.' },
        ]),
      },
      clock: new FakeClock(),
      tts: new RecordingTts(),
      app,
    })

    const events: PipelineEvent[] = []
    for await (const event of pipeline.execute('quit the app')) {
      events.push(event)
      if (event.type === 'confirmation_requested') pipeline.resolveConfirmation(event.confirmationId, false)
    }

    const requested = events.find((e) => e.type === 'confirmation_requested')
    expect(requested).toMatchObject({ toolName: 'app_control', prompt: 'Quit Bing Bong?' })
    expect(events.find((e) => e.type === 'tool_result' && e.name === 'app_control')).toMatchObject({
      ok: false,
      error: expect.stringContaining('denied by the user'),
    })
    expect(app.calls).toEqual([])
    expect(events.find((e) => e.type === 'display')).toMatchObject({ text: 'Quit cancelled.' })
  })

  it('speaks the ack before an approved app_control quit', async () => {
    const app = new FakeAppControls()
    const tts = new RecordingTts()
    const pipeline = createAssistantPipeline({
      controller: new FakeBrowser(),
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify([
          { kind: 'tool_calls', calls: [{ id: 'q1', name: 'app_control', args: { action: 'quit' } }] },
          // The app quits inside the tool; the scripted round after it only
          // exists so the loop has a turn to land on.
          { kind: 'answer', speak: 'Goodbye.', display: 'Goodbye.' },
        ]),
      },
      clock: new FakeClock(),
      tts,
      app,
    })

    const events: PipelineEvent[] = []
    for await (const event of pipeline.execute('quit the app')) {
      events.push(event)
      if (event.type === 'confirmation_requested') pipeline.resolveConfirmation(event.confirmationId, true)
    }

    expect(events.find((e) => e.type === 'tool_result' && e.name === 'app_control')).toMatchObject({
      ok: true,
      result: expect.stringMatching(/^application: lifecycle=quitting/),
    })
    // Order is the policy: the pipeline speaks the confirmation prompt, then
    // the tool speaks its ack, and only then the app quits.
    expect(app.calls).toEqual(['ack:Quitting.', 'quit'])
  })

  it('offers set_setting and app_control to the model when the seams are attached', async () => {
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
      settings: new FakeSettings(),
      app: new FakeAppControls(),
    })

    await collect(pipeline, 'hello')

    const tools = (requests[0].tools as { function: { name: string } }[]).map((t) => t.function.name)
    expect(tools).toContain('set_setting')
    expect(tools).toContain('app_control')
  })

  it('keeps set_setting and app_control out of the catalog when no seams are attached', async () => {
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
    expect(tools).not.toContain('set_setting')
    expect(tools).not.toContain('app_control')
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
