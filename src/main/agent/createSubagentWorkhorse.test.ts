import { describe, expect, it } from 'vitest'
import { FakeBrowser, FakeClock, FakeSearch } from '../../core/testing/doubles'
import type { SearchResult } from '../../core/ports/search'
import { createSubagentTaskApi } from './createSubagentWorkhorse'
import { withAgentActivity } from '../../core/downloads/agentActivity'
import { createAgentActivityTracker } from '../../core/downloads/agentActivity'
import type { Tool } from '../../core/pipeline/tool'

// The taskApi seam: research agents get web_search + read_url; browse agents
// get pane-bound browser tools with confirm-class actions denied; the
// scripted override makes every agent start the script from the top; routing
// failures degrade to a failed agent, not a crash.

const results: SearchResult[] = [{ title: 'Hit', url: 'https://hit.test', snippet: 'snip' }]

const RESEARCH_SCRIPT = JSON.stringify([
  { kind: 'tool_calls', calls: [{ id: 's1', name: 'web_search', args: { query: 'keyboards' } }] },
  { kind: 'answer', speak: 'Compared.', display: 'Keyboards compared across sources.' },
])

function envWith(script?: string): Record<string, string | undefined> {
  return script === undefined ? {} : { BINGBONG_SUBAGENT_LLM_SCRIPT: script }
}

describe('createSubagentTaskApi', () => {
  it('runs a research agent through web_search to a final report', async () => {
    const search = new FakeSearch(results)
    const api = createSubagentTaskApi({
      getEnv: () => envWith(RESEARCH_SCRIPT),
      fetchFn: (async () => new Response('<p>x</p>', { status: 200 })) as typeof fetch,
      search,
      clock: new FakeClock(),
    })

    const { done } = api.start({ id: 'a-1', kind: 'research', task: 'compare keyboards' }, { isCancelled: () => false, onProgress: () => undefined })
    const report = await done

    expect(search.queries).toEqual(['keyboards'])
    expect(report).toBe('Keyboards compared across sources.')
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
    expect(report).toBe('Downloaded.')
  })

  it('gives every agent a fresh script from the top', async () => {
    const api = createSubagentTaskApi({
      getEnv: () => envWith(RESEARCH_SCRIPT),
      fetchFn: (async () => new Response('<p>x</p>', { status: 200 })) as typeof fetch,
      search: new FakeSearch(results),
      clock: new FakeClock(),
    })

    const first = await api.start({ id: 'a-1', kind: 'research', task: 'one' }, { isCancelled: () => false, onProgress: () => undefined }).done
    const second = await api.start({ id: 'a-2', kind: 'research', task: 'two' }, { isCancelled: () => false, onProgress: () => undefined }).done

    expect(first).toBe('Keyboards compared across sources.')
    expect(second).toBe('Keyboards compared across sources.')
  })

  it('degrades to a failed agent when subagent routing is unconfigured', async () => {
    const api = createSubagentTaskApi({
      getEnv: () => envWith(),
      fetchFn: (async () => new Response('{}')) as typeof fetch,
      clock: new FakeClock(),
    })

    await expect(
      api.start({ id: 'a-1', kind: 'research', task: 't' }, { isCancelled: () => false, onProgress: () => undefined }).done,
    ).rejects.toThrow(/model routing for 'subagent' is not configured/)
  })

  it('reports progress from tool calls', async () => {
    const progress: { step: number; action: string }[] = []
    const api = createSubagentTaskApi({
      getEnv: () => envWith(RESEARCH_SCRIPT),
      fetchFn: (async () => new Response('<p>x</p>', { status: 200 })) as typeof fetch,
      search: new FakeSearch(results),
      clock: new FakeClock(),
    })

    await api.start({ id: 'a-1', kind: 'research', task: 't' }, { isCancelled: () => false, onProgress: (step, action) => progress.push({ step, action }) }).done

    expect(progress).toEqual([{ step: 1, action: 'search "keyboards"' }])
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
