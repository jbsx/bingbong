import { describe, expect, it } from 'vitest'
import { FakeBrowser, FakeClock, FakeVision, fakePerfHarness } from '../../core/testing/doubles'
import { createSubagentTaskApi, toolsForKind } from './createSubagentWorkhorse'
import { withAgentActivity } from '../../core/downloads/agentActivity'
import { createAgentActivityTracker } from '../../core/downloads/agentActivity'
import type { SnapshotRef } from '../../core/browser/snapshot'
import type { Tool } from '../../core/pipeline/tool'

// The taskApi seam (#83, ADR 0009): kinds are browse (pane-bound browser
// tools, confirm-class actions denied — searching happens on screen in the
// agent's own tab) and background (approved download/file tools). The old
// research kind and its off-screen web_search/read_url toolbox are gone;
// the scripted override makes every agent start the script from the top;
// routing failures degrade to a failed agent, not a crash.

const BROWSE_SCRIPT = JSON.stringify([
  { kind: 'tool_calls', calls: [{ id: 'n1', name: 'navigate', args: { url: 'https://engine.test' } }] },
  { kind: 'answer', speak: 'Compared.', display: 'Keyboards compared on screen.' },
])

function envWith(script?: string): Record<string, string | undefined> {
  return script === undefined ? {} : { BINGBONG_SUBAGENT_LLM_SCRIPT: script }
}

describe('createSubagentTaskApi', () => {
  it('drives a browse agent through its own tab to a final report', async () => {
    const browser = new FakeBrowser()
    const api = createSubagentTaskApi({
      getEnv: () => envWith(BROWSE_SCRIPT),
      fetchFn: (async () => new Response('<p>x</p>', { status: 200 })) as typeof fetch,
      controllerFor: () => browser,
      clock: new FakeClock(),
    })

    const { done } = api.start({ id: 'a-1', kind: 'browse', task: 'search keyboards' }, { isCancelled: () => false, onProgress: () => undefined })
    const report = await done

    expect(browser.navigations).toEqual(['https://engine.test'])
    expect(report.text).toBe('Keyboards compared on screen.')
  })

  it('binds browse agents to their own pane controller, confirm actions denied', async () => {
    const browser = new FakeBrowser()
    const script = JSON.stringify([
      { kind: 'tool_calls', calls: [{ id: 'n1', name: 'navigate', args: { url: 'https://shop.test' } }] },
      { kind: 'answer', speak: 's', display: 'Browsed the shop.' },
    ])
    const api = createSubagentTaskApi({
      getEnv: () => envWith(script),
      fetchFn: (async () => new Response('{}')) as typeof fetch,
      controllerFor: () => browser,
      clock: new FakeClock(),
    })

    const { done } = api.start({ id: 'a-1', kind: 'browse', task: 'open the shop' }, { isCancelled: () => false, onProgress: () => undefined })
    await done

    expect(browser.navigations).toEqual(['https://shop.test'])
  })

  it('runs the same-wall Blocker gate inside browse agents against their own tab (#81)', async () => {
    // The login-wall classifier fires on the accounts.* host at the
    // navigate-settle choke point, so the marker rides the real navigate
    // tool result through the FakeBrowser.
    const browser = new FakeBrowser()
    const script = JSON.stringify([
      { kind: 'tool_calls', calls: [{ id: 'n1', name: 'navigate', args: { url: 'https://accounts.shop.test/' } }] },
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'click', args: { ref: 2 } }] },
      { kind: 'tool_calls', calls: [{ id: 'n2', name: 'navigate', args: { url: 'https://shop.test/' } }] },
      { kind: 'tool_calls', calls: [{ id: 'c2', name: 'click', args: { ref: 3 } }] },
      { kind: 'answer', speak: 's', display: 'Worked a different site.' },
    ])
    const api = createSubagentTaskApi({
      getEnv: () => envWith(script),
      fetchFn: (async () => new Response('{}')) as typeof fetch,
      controllerFor: () => browser,
      clock: new FakeClock(),
    })

    const report = await api.start(
      { id: 'a-1', kind: 'browse', task: 'open the shop' },
      { isCancelled: () => false, onProgress: () => undefined },
    ).done

    // The walled navigate executed (detection never blocks) and armed the
    // gate; the same-host click was refused — never reached the controller.
    // Moving to a different host disarmed it, so the second click ran.
    expect(browser.navigations).toEqual(['https://accounts.shop.test/', 'https://shop.test/'])
    expect(browser.clicks).toEqual([3])
    expect(report.text).toBe('Worked a different site.')
  })

  it('ends a walled browse agent with the ASK_USER relay as its report (#81)', async () => {
    const browser = new FakeBrowser()
    const script = JSON.stringify([
      { kind: 'tool_calls', calls: [{ id: 'n1', name: 'navigate', args: { url: 'https://accounts.shop.test/' } }] },
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'click', args: { ref: 2 } }] },
      { kind: 'tool_calls', calls: [{ id: 'q1', name: 'ask_user', args: { question: 'Can you sign in to this site once in the browser tab?' } }] },
    ])
    const api = createSubagentTaskApi({
      getEnv: () => envWith(script),
      fetchFn: (async () => new Response('{}')) as typeof fetch,
      controllerFor: () => browser,
      clock: new FakeClock(),
    })

    const report = await api.start(
      { id: 'a-1', kind: 'browse', task: 'open the account page' },
      { isCancelled: () => false, onProgress: () => undefined },
    ).done

    // The refused click never reached the controller, and the run ended
    // with the relay directive — not rounds of failed hammering.
    expect(browser.clicks).toEqual([])
    expect(report.text).toContain('ASK_USER: Can you sign in to this site once in the browser tab?')
  })

  it('gives browse agents screenshot descriptions through look', async () => {
    const browser = new FakeBrowser()
    browser.screenshotBytes = new Uint8Array([1, 2, 3])
    const vision = new FakeVision()
    vision.description = 'A modal covers the page.'
    const script = JSON.stringify([
      { kind: 'tool_calls', calls: [{ id: 'l1', name: 'look', args: {} }] },
      { kind: 'answer', speak: 's', display: 'The modal is blocking progress.' },
    ])
    const api = createSubagentTaskApi({
      getEnv: () => envWith(script),
      fetchFn: fetch,
      controllerFor: () => browser,
      vision,
      clock: new FakeClock(),
    })

    const report = await api.start(
      { id: 'a-1', kind: 'browse', task: 'inspect the page' },
      { isCancelled: () => false, onProgress: () => undefined },
    ).done

    expect(vision.describeRequests.map((request) => request.image)).toEqual([new Uint8Array([1, 2, 3])])
    expect(report.text).toBe('The modal is blocking progress.')
  })

  it('gives background agents the dedicated download/file toolbox without a tab', async () => {
    let downloads = 0
    const backgroundTools: Tool[] = [
      {
        name: 'download_url',
        async execute() {
          downloads += 1
          return 'downloaded'
        },
      },
    ]
    const script = JSON.stringify([
      { kind: 'tool_calls', calls: [{ id: 'd1', name: 'download_url', args: { url: 'https://x.test/a' } }] },
      { kind: 'answer', speak: 's', display: 'Downloaded.' },
    ])
    const api = createSubagentTaskApi({
      getEnv: () => envWith(script),
      fetchFn: fetch,
      controllerFor: () => {
        throw new Error('background agents must not claim a browser tab')
      },
      backgroundTools,
      clock: new FakeClock(),
    })

    const report = await api.start(
      { id: 'a-1', kind: 'background', task: 'download it' },
      { isCancelled: () => false, onProgress: () => undefined },
    ).done

    expect(downloads).toBe(1)
    expect(report.text).toBe('Downloaded.')
  })

  it('exposes no off-screen web tool to any kind (#83, ADR 0009)', () => {
    // web_search and read_url died with the research kind: every subagent
    // web read happens in its own visible tab now.
    const deps = { getEnv: () => ({}) as Record<string, string | undefined>, fetchFn: fetch, vision: new FakeVision() }
    for (const kind of ['browse', 'background'] as const) {
      const tools = toolsForKind(kind, deps, kind === 'browse' ? new FakeBrowser() : null)
      const names = tools.map((tool) => tool.name)
      expect(names).not.toContain('web_search')
      expect(names).not.toContain('read_url')
      expect(names).toContain('ask_user')
    }
    // The browse catalog is exactly the pane-bound browser verbs plus look.
    const browseNames = toolsForKind('browse', deps, new FakeBrowser()).map((tool) => tool.name)
    expect(browseNames.sort()).toEqual(['ask_user', 'back', 'click', 'go_forward', 'look', 'navigate', 'read_page', 'screenshot', 'scroll', 'type'].sort())
  })

  it('passes search submits through the confirm downgrade — browse agents can GUI-search (#102, ADR 0015)', async () => {
    // The composition the acceptance criterion names: real gate verdicts
    // under the subagent policy. A search-flavored submit is allow (never
    // downgraded); a newsletter signup stays confirm-class and is denied
    // for the subagent as before.
    const browser = new FakeBrowser()
    const base: SnapshotRef = {
      ref: 1,
      kind: 'input',
      label: '',
      inputType: null,
      rect: { x: 0, y: 0, width: 10, height: 10 },
      src: null,
      href: null,
      downloadsFile: false,
      submitsForm: false,
      credentialField: false,
      paymentField: false,
      inForm: false,
      formHasCredential: false,
      formHasPayment: false,
      searchField: false,
      formHasSearch: false,
    }
    browser.refs.set(1, { ...base, label: 'Search', inForm: true, searchField: true, formHasSearch: true })
    browser.refs.set(2, { ...base, ref: 2, inputType: 'email', label: 'Your email', inForm: true })
    const deps = { getEnv: () => ({}) as Record<string, string | undefined>, fetchFn: fetch }
    const type = toolsForKind('browse', deps, browser).find((tool) => tool.name === 'type') as Tool

    await expect(type.assessRisk!({ id: 'c1', name: 'type', args: { ref: 1, text: 'weather tomorrow\n' } })).resolves.toEqual({
      kind: 'allow',
    })
    await expect(type.assessRisk!({ id: 'c2', name: 'type', args: { ref: 2, text: 'me@example.com\n' } })).resolves.toEqual({
      kind: 'deny',
      reason: 'subagents cannot ask the user for confirmation — skip this action and continue without it',
    })
  })

  it('gives every kind the escalation-only ask_user (never an interactive ask)', async () => {
    for (const kind of ['browse', 'background'] as const) {
      const script = JSON.stringify([
        { kind: 'tool_calls', calls: [{ id: 'q1', name: 'ask_user', args: { question: 'Which one?' } }] },
        { kind: 'answer', speak: 's', display: 'Escalated.' },
      ])
      const reports: string[] = []
      const api = createSubagentTaskApi({
        getEnv: () => envWith(script),
        fetchFn: fetch,
        ...(kind === 'browse' ? { controllerFor: () => new FakeBrowser() } : {}),
        ...(kind === 'background' ? { backgroundTools: [] } : {}),
        clock: new FakeClock(),
      })

      const { done } = api.start(
        { id: 'a-1', kind, task: 'do it' },
        { isCancelled: () => false, onProgress: (_step, action) => reports.push(action) },
      )
      const report = await done

      // The ask tool is wired into every kind's catalog (the directive it
      // returns is asserted in askUserTools.test.ts).
      expect(report.text).toContain('ASK_USER: Which one?')
      expect(reports.join(' ')).toContain('ask you: Which one?')
    }
  })

  it('gives every agent a fresh script from the top', async () => {
    const api = createSubagentTaskApi({
      getEnv: () => envWith(BROWSE_SCRIPT),
      fetchFn: (async () => new Response('<p>x</p>', { status: 200 })) as typeof fetch,
      controllerFor: () => new FakeBrowser(),
      clock: new FakeClock(),
    })

    const first = await api.start({ id: 'a-1', kind: 'browse', task: 'one' }, { isCancelled: () => false, onProgress: () => undefined }).done
    const second = await api.start({ id: 'a-2', kind: 'browse', task: 'two' }, { isCancelled: () => false, onProgress: () => undefined }).done

    expect(first.text).toBe('Keyboards compared on screen.')
    expect(second.text).toBe('Keyboards compared on screen.')
  })

  it('keys subagent-llm spans to the spawning turn when the spec carries one', async () => {
    const { records, tracer } = fakePerfHarness()
    const api = createSubagentTaskApi({
      getEnv: () => envWith(BROWSE_SCRIPT),
      fetchFn: (async () => new Response('<p>x</p>', { status: 200 })) as typeof fetch,
      controllerFor: () => new FakeBrowser(),
      clock: new FakeClock(),
      tracer,
    })

    await api.start(
      { id: 'a-1', kind: 'browse', task: 'compare keyboards', turnId: 'turn-voice-2' },
      { isCancelled: () => false, onProgress: () => undefined },
    ).done

    expect(records).toEqual([
      expect.objectContaining({ turnId: 'turn-voice-2', stage: 'subagent-llm' }),
      expect.objectContaining({ turnId: 'turn-voice-2', stage: 'subagent-llm' }),
    ])
  })

  it('records no subagent spans when the spec carries no turn id', async () => {
    const { records, tracer } = fakePerfHarness()
    const api = createSubagentTaskApi({
      getEnv: () => envWith(BROWSE_SCRIPT),
      fetchFn: (async () => new Response('<p>x</p>', { status: 200 })) as typeof fetch,
      controllerFor: () => new FakeBrowser(),
      clock: new FakeClock(),
      tracer,
    })

    await api.start({ id: 'a-1', kind: 'browse', task: 'compare keyboards' }, { isCancelled: () => false, onProgress: () => undefined }).done

    expect(records).toEqual([])
  })

  it('degrades to a failed agent when subagent routing is unconfigured', async () => {
    const api = createSubagentTaskApi({
      getEnv: () => envWith(),
      fetchFn: (async () => new Response('{}')) as typeof fetch,
      clock: new FakeClock(),
    })

    await expect(
      api.start({ id: 'a-1', kind: 'background', task: 't' }, { isCancelled: () => false, onProgress: () => undefined }).done,
    ).rejects.toThrow(/model routing for 'subagent' is not configured/)
  })

  it('carries the pinned clock date as runtime context in every spawn (#103)', async () => {
    // Routed subagent (no script override), so the real OpenAI client posts
    // the wire messages — one spawn before local midnight, one after.
    const ROUTED_ENV = {
      BINGBONG_SUBAGENT_BASE_URL: 'https://api.deepseek.test/v1',
      BINGBONG_SUBAGENT_MODEL: 'deepseek-chat',
      BINGBONG_SUBAGENT_API_KEY: 'test-key',
    }
    const bodies: Record<string, unknown>[] = []
    const fetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"speak":"s","display":"Done."}' } }] }), { status: 200 })
    }) as typeof fetch
    const clock = new FakeClock(new Date(2026, 7, 24, 23, 59).getTime())
    const api = createSubagentTaskApi({ getEnv: () => ROUTED_ENV, fetchFn, clock })

    await api.start({ id: 'a-1', kind: 'background', task: 'one' }, { isCancelled: () => false, onProgress: () => undefined }).done
    clock.advance(2 * 60_000)
    await api.start({ id: 'a-2', kind: 'background', task: 'two' }, { isCancelled: () => false, onProgress: () => undefined }).done

    const systemOf = (index: number): unknown =>
      (bodies[index].messages as { role: string; content: unknown }[]).find((message) => message.role === 'system')?.content
    expect(systemOf(0)).toEqual(expect.stringContaining('Runtime context:\n- Today is 2026-08-24'))
    expect(systemOf(1)).toEqual(expect.stringContaining('Runtime context:\n- Today is 2026-08-25'))
  })

  it('reports progress from tool calls', async () => {
    const progress: { step: number; action: string }[] = []
    const api = createSubagentTaskApi({
      getEnv: () => envWith(BROWSE_SCRIPT),
      fetchFn: (async () => new Response('<p>x</p>', { status: 200 })) as typeof fetch,
      controllerFor: () => new FakeBrowser(),
      clock: new FakeClock(),
    })

    await api.start({ id: 'a-1', kind: 'browse', task: 't' }, { isCancelled: () => false, onProgress: (step, action) => progress.push({ step, action }) }).done

    expect(progress).toEqual([{ step: 1, action: '→ https://engine.test' }])
  })

  it('routes browse agents through the agent-activity tracker when wrapped outside', async () => {
    // Sanity: the taskApi accepts any BrowserController, including an
    // activity-wrapped one — downloads from agent panes stay agent-attributed.
    const inner = new FakeBrowser()
    const tracker = createAgentActivityTracker({ clock: new FakeClock() })
    const controller = withAgentActivity(inner, tracker)
    const script = JSON.stringify([
      { kind: 'tool_calls', calls: [{ id: 'n1', name: 'navigate', args: { url: 'https://x.test' } }] },
      { kind: 'answer', speak: 's', display: 'ok' },
    ])
    const api = createSubagentTaskApi({
      getEnv: () => envWith(script),
      fetchFn: (async () => new Response('{}')) as typeof fetch,
      controllerFor: () => controller,
      clock: new FakeClock(),
    })

    await api.start({ id: 'a-1', kind: 'browse', task: 't' }, { isCancelled: () => false, onProgress: () => undefined }).done
    expect(inner.navigations).toEqual(['https://x.test'])
  })
})
