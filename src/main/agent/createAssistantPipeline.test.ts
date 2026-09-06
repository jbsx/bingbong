import { describe, expect, it } from 'vitest'
import { createAssistantPipeline } from './createAssistantPipeline'
import { FakeAppControls, FakeBrowser, FakeClock, FakePanel, FakeSettings, RecordingTts, StallingBrowser, fakeSubagentManager, flushMicrotasks as flush, subagentRecord, until } from '../../core/testing/doubles'
import type { CommandPipeline } from '../../core/pipeline/createCommandPipeline'
import type { PipelineEvent } from '../../core/pipeline/events'
import { createSubagentTools } from '../../core/pipeline/subagentTools'
import type { PerfTracer } from '../../core/perf/perfTracer'
import { holdBrowserCustody } from '../../core/browser/unsettledAction'
import { createCdpBrowserController } from '../browser/createCdpBrowserController'
import { createPaneNavigation, type PaneNavigationTarget } from '../browser/paneNavigation'

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
    const pipeline = createAssistantPipeline({ browser: holdBrowserCustody(browser), env: {} })

    const events = await collect(pipeline, 'open youtube')

    const error = events.find((e) => e.type === 'error')
    expect(error?.message).toMatch(/model routing for 'orchestrator' is not configured/)
    expect(events.find((e) => e.type === 'speak')).toMatchObject({ type: 'speak' })
    expect(events.at(-1)).toMatchObject({ type: 'done' })
  })

  it('runs the loop from a scripted LLM override and drives the browser', async () => {
    const browser = new FakeBrowser()
    const pipeline = createAssistantPipeline({
      browser: holdBrowserCustody(browser),
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
      browser: holdBrowserCustody(new FakeBrowser()),
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
      browser: holdBrowserCustody(new FakeBrowser()),
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
      browser: holdBrowserCustody(new FakeBrowser()),
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
      browser: holdBrowserCustody(new FakeBrowser()),
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
      browser: holdBrowserCustody(new FakeBrowser()),
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
      browser: holdBrowserCustody(new FakeBrowser()),
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
      browser: holdBrowserCustody(new FakeBrowser()),
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
      browser: holdBrowserCustody(browser),
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
      browser: holdBrowserCustody(new FakeBrowser()),
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
      browser: holdBrowserCustody(new FakeBrowser()),
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
      browser: holdBrowserCustody(new FakeBrowser()),
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
      browser: holdBrowserCustody(new FakeBrowser()),
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
      browser: holdBrowserCustody(new FakeBrowser()),
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
      browser: holdBrowserCustody(new FakeBrowser()),
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
      browser: holdBrowserCustody(new FakeBrowser()),
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
      browser: holdBrowserCustody(new FakeBrowser()),
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
      browser: holdBrowserCustody(new FakeBrowser()),
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
      browser: holdBrowserCustody(new FakeBrowser()),
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

  it('cancels running subagents when a steering directive lands (#119)', async () => {
    // Delegated work spawned under the corrected-away objective is
    // stale: the steering resume cancels it through the shared
    // subagent control instead of un-pausing it.
    const control: string[] = []
    let calls = 0
    let releaseFirst!: () => void
    const firstRound = new Promise<Response>((resolve) => {
      releaseFirst = () =>
        resolve(new Response(JSON.stringify({ choices: [{ message: { content: '{"speak":"Stale.","display":"Stale."}' } }] }), { status: 200 }))
    })
    const fetchFn = (async (_url: string | URL, _init?: RequestInit) => {
      calls += 1
      if (calls === 1) return firstRound
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"speak":"Done.","display":"Done."}' } }] }), { status: 200 })
    }) as typeof fetch
    const pipeline = createAssistantPipeline({
      browser: holdBrowserCustody(new FakeBrowser()),
      env: FULL_ENV,
      fetchFn,
      clock: new FakeClock(),
      subagentControl: {
        cancelAll: () => {
          control.push('cancelAll')
          return 0
        },
        pauseAll: () => control.push('pauseAll'),
        resumeAll: () => control.push('resumeAll'),
      },
    })

    const events: PipelineEvent[] = []
    const run = (async () => {
      for await (const event of pipeline.execute('find a mug')) events.push(event)
    })()
    for (let attempt = 0; attempt < 50 && calls < 1; attempt += 1) await Promise.resolve()
    pipeline.pause()
    releaseFirst()
    for (let attempt = 0; attempt < 50 && pipeline.getState() !== 'paused'; attempt += 1) await Promise.resolve()
    expect(pipeline.getState()).toBe('paused')
    pipeline.resume('the red one instead')
    await run

    expect(control).toEqual(['pauseAll', 'cancelAll'])
    expect(events.some((event) => event.type === 'display' && event.text === 'Stale.')).toBe(false)
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'done' })
  })

  // #205 / ADR 0038: Stop and safe reuse are two boundaries. The double
  // does not cooperate — nothing here can make `navigate` settle from
  // outside — so the Run's terminal completion is the thing being proved,
  // not a fake's willingness to be cancelled.
  describe('a Stop while a browser action is still unsettled', () => {
    const UNSETTLED_SCRIPT = JSON.stringify([
      // Run 1: a navigation that will not answer, with a sibling behind it.
      { kind: 'tool_calls', calls: [
        { id: 'c1', name: 'navigate', args: { url: 'https://slow.example' } },
        { id: 'c2', name: 'read_page', args: {} },
      ] },
      // Run 2, in the same Session: tries the pane again, then answers with
      // whatever the refusal told it.
      { kind: 'tool_calls', calls: [{ id: 'c3', name: 'navigate', args: { url: 'https://next.example' } }] },
      { kind: 'answer', speak: 'Could not browse.', display: 'The browser said: $last_tool_error' },
      // Run 3, after the abandoned navigation finally lands.
      { kind: 'tool_calls', calls: [{ id: 'c4', name: 'navigate', args: { url: 'https://after.example' } }] },
      { kind: 'answer', speak: 'Opened it.', display: 'Navigated after the pane came back.' },
    ])

    async function stoppedMidNavigation(script = UNSETTLED_SCRIPT) {
      const browser = new StallingBrowser(['navigate'])
      const pipeline = createAssistantPipeline({
        browser: holdBrowserCustody(browser),
        env: { BINGBONG_LLM_SCRIPT: script },
        clock: new FakeClock(),
      })
      const events: PipelineEvent[] = []
      const run = (async () => {
        for await (const event of pipeline.execute('open the slow page')) events.push(event)
      })()
      await until(() => browser.reached.includes('navigate'), 'the tool reaching the browser')
      pipeline.abort()
      await run
      return { browser, pipeline, events }
    }

    it('completes the Run terminally instead of waiting the action out', async () => {
      const { browser, events } = await stoppedMidNavigation()

      expect(events.some((event) => event.type === 'status' && event.status === 'cancelled')).toBe(true)
      expect(events.at(-1)).toMatchObject({ type: 'done' })
      // Still unsettled: the Run stopped waiting, the page never stopped.
      expect(browser.outstanding).toBe(1)
    })

    it('executes no sibling of the abandoned call', async () => {
      const { browser } = await stoppedMidNavigation()

      expect(browser.reached).toEqual(['navigate'])
    })

    it('refuses the next Run in the same Session the pane, rather than queueing its work', async () => {
      const { browser, pipeline } = await stoppedMidNavigation()

      const second = await collect(pipeline, 'try that again')

      expect(browser.reached).toEqual(['navigate'])
      expect(second.find((event) => event.type === 'display')).toMatchObject({
        text: expect.stringContaining('unavailable until an abandoned action settles'),
      })
      expect(second.at(-1)).toMatchObject({ type: 'done' })
    })

    // AC6 asks for an *actual browser-adapter operation* held unresolved,
    // not a port-level double: this drives the real chain — the CDP
    // controller's navigate, the pane's bounded wait, and a webContents
    // whose loadURL only Chromium could settle.
    it('stops on an unresolved adapter navigation, and neither a late resolve nor a late reject reaches the Run', async () => {
      let landLoad: ((outcome: { ok: true } | { ok: false; error: Error }) => void) | null = null
      const loads: string[] = []
      const wc: PaneNavigationTarget = {
        loadURL: (url) =>
          new Promise<void>((resolve, reject) => {
            loads.push(url)
            landLoad = (outcome) => (outcome.ok ? resolve() : reject(outcome.error))
          }),
        navigationHistory: { canGoBack: () => false, canGoForward: () => false, goBack: () => {}, goForward: () => {} },
        once: () => {},
        getURL: () => 'about:blank',
        getTitle: () => '',
        isDestroyed: () => false,
        focus: () => {},
      }
      const adapter = createCdpBrowserController({
        cdp: { send: async () => ({}) as never, on: () => {} },
        page: createPaneNavigation(wc, new FakeClock()),
        collectScript: '/* COLLECT */',
        pacing: { settleMs: 0, moveMs: 0, clickMs: 0, keystrokeMs: 0, scrollTickMs: 0 },
      })
      const custody = holdBrowserCustody(adapter)
      const pipeline = createAssistantPipeline({
        browser: custody,
        env: { BINGBONG_LLM_SCRIPT: UNSETTLED_SCRIPT },
        clock: new FakeClock(),
      })

      const events: PipelineEvent[] = []
      const run = (async () => {
        for await (const event of pipeline.execute('open the slow page')) events.push(event)
      })()
      await until(() => loads.length === 1, 'the adapter reaching loadURL')
      pipeline.abort()
      await run

      expect(events.some((event) => event.type === 'status' && event.status === 'cancelled')).toBe(true)
      expect(events.at(-1)).toMatchObject({ type: 'done' })
      expect(custody.state()).toBe('withheld')

      const second = await collect(pipeline, 'try that again')
      expect(loads).toEqual(['https://slow.example'])
      const finalized = [...events]

      // Late, and either way: the load lands, then a second custody's load
      // fails. Neither reopens the Run that let go of it.
      landLoad!({ ok: true })
      await custody.settled()
      expect(events).toEqual(finalized)
      expect(second.at(-1)).toMatchObject({ type: 'done' })
      // The whole adapter navigate — not just loadURL — has to end before
      // the pane is anyone's again.
      expect(custody.state()).toBe('available')
    })

    it('holds the pane just as hard when the abandoned adapter load fails late', async () => {
      let failLoad: ((error: Error) => void) | null = null
      const loads: string[] = []
      const wc: PaneNavigationTarget = {
        loadURL: (url) =>
          new Promise<void>((_resolve, reject) => {
            loads.push(url)
            failLoad = reject
          }),
        navigationHistory: { canGoBack: () => false, canGoForward: () => false, goBack: () => {}, goForward: () => {} },
        once: () => {},
        getURL: () => 'about:blank',
        getTitle: () => '',
        isDestroyed: () => false,
        focus: () => {},
      }
      const custody = holdBrowserCustody(
        createCdpBrowserController({
          cdp: { send: async () => ({}) as never, on: () => {} },
          page: createPaneNavigation(wc, new FakeClock()),
          collectScript: '/* COLLECT */',
          pacing: { settleMs: 0, moveMs: 0, clickMs: 0, keystrokeMs: 0, scrollTickMs: 0 },
        }),
      )
      const pipeline = createAssistantPipeline({
        browser: custody,
        env: { BINGBONG_LLM_SCRIPT: UNSETTLED_SCRIPT },
        clock: new FakeClock(),
      })

      const run = (async () => {
        for await (const _event of pipeline.execute('open the slow page')) void _event
      })()
      await until(() => loads.length === 1, 'the adapter reaching loadURL')
      pipeline.abort()
      await run
      expect(custody.state()).toBe('withheld')

      // A failure is still an ending: the pane comes back, uncertainty gone.
      failLoad!(new Error('net::ERR_CONNECTION_TIMED_OUT'))
      await custody.settled()
      expect(custody.state()).toBe('available')
    })

    it('goes on withholding the pane across a Session Reset', async () => {
      // The Session ends; the pane's unsettled action does not. A fresh
      // Session must not inherit a resource nothing has vouched for.
      const RESET_SCRIPT = JSON.stringify([
        { kind: 'tool_calls', calls: [{ id: 'c1', name: 'navigate', args: { url: 'https://slow.example' } }] },
        { kind: 'tool_calls', calls: [{ id: 'c2', name: 'new_session', args: {} }] },
        { kind: 'tool_calls', calls: [{ id: 'c3', name: 'navigate', args: { url: 'https://fresh.example' } }] },
        { kind: 'answer', speak: 'Could not browse.', display: 'The browser said: $last_tool_error' },
      ])
      const { browser, pipeline } = await stoppedMidNavigation(RESET_SCRIPT)

      const reset = await collect(pipeline, 'forget all that')
      expect(reset.at(-1)).toMatchObject({ type: 'done', outcome: 'reset' })

      const fresh = await collect(pipeline, 'now open something else')
      expect(browser.reached).toEqual(['navigate'])
      expect(fresh.find((event) => event.type === 'display')).toMatchObject({
        text: expect.stringContaining('unavailable until an abandoned action settles'),
      })
    })

    it('leaves the stopped Run untouched when its action finally lands, and only then reuses the pane', async () => {
      const { browser, pipeline, events } = await stoppedMidNavigation()
      await collect(pipeline, 'try that again')
      const finalized = [...events]

      // The page finally lands, and stops stalling the next navigation.
      browser.settleLate()
      browser.stalls.clear()
      await flush()

      // The late landing changes nothing about the Run that let it go.
      expect(events).toEqual(finalized)

      const third = await collect(pipeline, 'open it now')
      expect(browser.navigations).toEqual(['https://after.example'])
      expect(third.find((event) => event.type === 'display')).toMatchObject({
        text: 'Navigated after the pane came back.',
      })
    })
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
      browser: holdBrowserCustody(new FakeBrowser()),
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
