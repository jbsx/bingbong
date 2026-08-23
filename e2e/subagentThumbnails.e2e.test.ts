import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { commandBoxScript } from './scripts'
import { startHarness, type Harness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { sleep, waitFor } from './waitFor'
import type { AssistantTurn } from '../src/core/ports/llm'

// Subagent desktop thumbnails (#57): live browse agents' pages live hidden
// at a 1280x800 desktop viewport, the card shows a captured in-memory
// thumbnail (~1fps while the agent runs and the card is visible) riding
// the existing agent_update payload, capture stops when the agent
// finishes, and Reopen moves the pane into the main browsing area where
// real input works. The /slow fixture (3 s) holds the agent running long
// enough for captures to land mid-run.

const SLOW_PATH = '/slow'
const INTERACTIVE_PATH = '/interactive'

function orchestratorScript(): AssistantTurn[] {
  return [
    {
      kind: 'tool_calls',
      calls: [
        // Two concurrent browse agents: both views park edge-on at once,
        // exercising the per-view column staggering (an occluded parked
        // view never produces frames).
        { id: 's1', name: 'spawn_agent', args: { kind: 'browse', task: 'open the slow page then the interactive one' } },
        { id: 's2', name: 'spawn_agent', args: { kind: 'background', task: 'think without a browser' } },
        { id: 's3', name: 'spawn_agent', args: { kind: 'browse', task: 'visit the interactive page too' } },
      ],
    },
    { kind: 'tool_calls', calls: [{ id: 's4', name: 'agent_results', args: { wait: true } }] },
    { kind: 'answer', speak: 'All agents finished.', display: 'All agents finished.' },
  ]
}

function browseScript(slowUrl: string, interactiveUrl: string): AssistantTurn[] {
  return [
    // Paint first: the interactive page commits in ~200 ms, so captures
    // have a live surface almost immediately…
    { kind: 'tool_calls', calls: [{ id: 'n1', name: 'navigate', args: { url: interactiveUrl } }] },
    { kind: 'tool_calls', calls: [{ id: 'r1', name: 'read_page', args: {} }] },
    // …then the slow page (3 s) holds the agent running — its pending
    // navigation keeps the committed interactive page on screen, so the
    // ~1fps captures demonstrably ship mid-run.
    { kind: 'tool_calls', calls: [{ id: 'n2', name: 'navigate', args: { url: slowUrl } }] },
    { kind: 'tool_calls', calls: [{ id: 'n3', name: 'navigate', args: { url: interactiveUrl } }] },
    { kind: 'answer', speak: 'done', display: 'Visited both fixture pages.' },
  ]
}

/** One CDP session bound to a page target — attach once, evaluate many. */
class PageSession {
  private constructor(
    private readonly harness: Harness,
    readonly targetId: string,
    private readonly sessionId: string,
  ) {}

  static async attach(harness: Harness, targetId: string): Promise<PageSession> {
    const { sessionId } = await harness.cdp.send<{ sessionId: string }>('Target.attachToTarget', {
      targetId,
      flatten: true,
    })
    return new PageSession(harness, targetId, sessionId)
  }

  async eval<T>(expression: string): Promise<T> {
    const response = await this.harness.cdp.send<{ result?: { value?: T } }>(
      'Runtime.evaluate',
      { expression, returnByValue: true },
      this.sessionId,
    )
    return response.result?.value as T
  }

  async clickAt(x: number, y: number): Promise<void> {
    await this.harness.cdp.send(
      'Input.dispatchMouseEvent',
      { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 },
      this.sessionId,
    )
    await this.harness.cdp.send(
      'Input.dispatchMouseEvent',
      { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 },
      this.sessionId,
    )
  }
}

async function findPageTarget(harness: Harness, urlPrefix: string): Promise<string | undefined> {
  const targets = await harness.cdp.send<{ targetInfos?: { targetId: string; type: string; url: string }[] }>(
    'Target.getTargets',
  )
  return (targets.targetInfos ?? []).find((info) => info.type === 'page' && info.url.startsWith(urlPrefix))?.targetId
}

/** The first matching card thumbnail's src, '' when absent — the capture loop's observable. */
async function thumbnailSrc(harness: Harness, cardSelector: string): Promise<string> {
  return harness.dashboardEval<string>(
    `document.querySelector('${cardSelector} .subagent-thumbnail')?.getAttribute('src') ?? ''`,
  )
}

describe('subagent thumbnails e2e', () => {
  let fixture: FixtureServer
  let harness: Harness

  beforeAll(async () => {
    fixture = await startFixtureServer()
    harness = await startHarness({
      fixture,
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify(orchestratorScript()),
        BINGBONG_SUBAGENT_LLM_SCRIPT: JSON.stringify(
          browseScript(fixture.url(SLOW_PATH), fixture.url(INTERACTIVE_PATH)),
        ),
        // Long enough that the reopen test runs against a lingering tab.
        BINGBONG_TAB_LINGER_MS: '60000',
      },
    })
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close()
  })

  it('shows live thumbnails while the agents run, laid out at a desktop viewport', async () => {
    expect(await harness.dashboardEval<string>(commandBoxScript('browse then summarize'))).toBe('submitted')

    // The background agent's spawn is confirm-gated (approved download/file
    // work) — approve it so all three agents run.
    await waitFor(
      () => harness.dashboardEval<boolean>(`!!document.querySelector('.confirmation-card')`),
      { timeoutMs: 20_000, intervalMs: 250 },
    )
    await harness.clickDashboardElement('.confirmation-actions button')

    // While the browse agents are still running (the slow page holds them
    // for ~3 s), BOTH cards show captured frames — two views parked edge-on
    // at once, each keeping its own unoccluded capture column. Frames are
    // in-memory JPEG data URLs.
    const runningSrcs = await waitFor(
      async () => {
        const srcs = await harness.dashboardEval<string[]>(
          `Array.from(document.querySelectorAll('.subagent-card--running .subagent-thumbnail')).map((img) => img.getAttribute('src') ?? '')`,
        )
        return srcs.length >= 2 && srcs.every((src) => src.startsWith('data:image/jpeg')) ? srcs : undefined
      },
      { timeoutMs: 20000, intervalMs: 250 },
    )
    for (const src of runningSrcs) expect(src.length).toBeGreaterThan(100)

    // The pages behind the cards lay out at a real desktop viewport: 1280x800
    // device pixels (CSS size divides by the zoom factor; fractional zoom
    // costs a rounding pixel).
    const slowTargetId = await findPageTarget(harness, fixture.url(SLOW_PATH))
    const targetId = slowTargetId ?? (await findPageTarget(harness, fixture.url(INTERACTIVE_PATH)))
    expect(targetId).toBeDefined()
    const page = await PageSession.attach(harness, targetId!)
    const layout = await page.eval<{ width: number; height: number; dpr: number }>(
      '({ width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio })',
    )
    expect(Math.round(layout.width * layout.dpr)).toBeGreaterThanOrEqual(1278)
    expect(Math.round(layout.height * layout.dpr)).toBeGreaterThanOrEqual(798)

    // Cards without a tab (the background agent) never show a frame — no
    // capture, no placeholder.
    const thumbnails = await waitFor(
      async () => {
        const count = await harness.dashboardEval<number>(`document.querySelectorAll('.subagent-thumbnail').length`)
        const cards = await harness.dashboardEval<number>(`document.querySelectorAll('.subagent-card').length`)
        return cards >= 3 && count === 2 ? count : undefined
      },
      { timeoutMs: 20000, intervalMs: 250 },
    )
    expect(thumbnails).toBe(2)
  })

  it('stops capturing when the agents finish and keeps the last frame', async () => {
    await waitFor(
      async () => {
        const completed = await harness.dashboardEval<number>(`document.querySelectorAll('.subagent-card--completed').length`)
        return completed >= 3 ? completed : undefined
      },
      { timeoutMs: 20000, intervalMs: 250 },
    )

    const settledSrc = await waitFor(
      async () => {
        const src = await thumbnailSrc(harness, '.subagent-card--completed')
        return src.startsWith('data:image/jpeg') ? src : undefined
      },
      { timeoutMs: 20000, intervalMs: 250 },
    )

    // Conclusive stop check: visibly change EVERY finished browse page
    // after the finish — a still-running capture loop would ship a new
    // frame within two ticks, a stopped one cannot. (Waiting on unchanged
    // pages would pass even with capture alive, thanks to identical-frame
    // dedup.)
    const targets = await harness.cdp.send<{ targetInfos?: { targetId: string; type: string; url: string }[] }>(
      'Target.getTargets',
    )
    const interactiveIds = (targets.targetInfos ?? [])
      .filter((info) => info.type === 'page' && info.url.startsWith(fixture.url(INTERACTIVE_PATH)))
      .map((info) => info.targetId)
    expect(interactiveIds.length).toBeGreaterThanOrEqual(2)
    for (const id of interactiveIds) {
      // The interactive page is 3000px tall with content far below the fold.
      await (await PageSession.attach(harness, id)).eval(`window.scrollTo(0, document.body.scrollHeight)`)
    }

    await sleep(2600)
    expect(await thumbnailSrc(harness, '.subagent-card--completed')).toBe(settledSrc)
  })

  it('reopen moves the pane into the main browsing area and real input works there', async () => {
    // The feed panel's auto-peek may cover the cards rail — make sure the
    // Reopen control is actually clickable.
    const panel = await harness.dashboardEval<{ open: boolean } | null>(`window.bingbong.feedPanel.getState()`)
    if (panel?.open) await harness.dashboardEval(`(window.bingbong.feedPanel.toggle(), 'closed')`)

    await harness.clickDashboardElement('.subagent-card[aria-label="subagent a-1"] .subagent-reopen')

    // The pane now sizes to the main browsing area: its device-pixel width
    // (CSS width x zoom) equals the dashboard's browser viewport width.
    // Two browse agents sit on the interactive page — only the reopened
    // one resizes, so the width itself identifies the moved target.
    const expectedWidth = await harness.dashboardEval<number>(
      `document.querySelector('.browser-viewport').getBoundingClientRect().width`,
    )
    const { page, targetId } = await waitFor(async () => {
      const targets = await harness.cdp.send<{ targetInfos?: { targetId: string; type: string; url: string }[] }>(
        'Target.getTargets',
      )
      for (const info of targets.targetInfos ?? []) {
        if (info.type !== 'page' || !info.url.startsWith(fixture.url(INTERACTIVE_PATH))) continue
        const candidate = await PageSession.attach(harness, info.targetId)
        const layout = await candidate.eval<{ width: number; dpr: number }>(
          '({ width: window.innerWidth, dpr: window.devicePixelRatio })',
        )
        if (Math.abs(layout.width * layout.dpr - expectedWidth) <= 2) {
          return { page: candidate, targetId: info.targetId }
        }
      }
      return undefined
    }, { timeoutMs: 20000, intervalMs: 250 })

    // Real (input-pipeline) interaction in the reopened pane: a click on
    // the fixture's button lands and the page records it. (The previous
    // test scrolled this page to its bottom — bring the button back into
    // the viewport first.)
    await page.eval(`window.scrollTo(0, 0)`)
    const center = await page.eval<{ x: number; y: number }>(
      `(() => { const r = document.getElementById('btn-hello').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`,
    )
    await harness.cdp.send('Target.activateTarget', { targetId })
    await sleep(1000)
    await page.clickAt(center.x, center.y)

    const title = await waitFor(
      async () => {
        const current = await page.eval<string>('document.title')
        return current === 'clicked:btn-hello' ? current : undefined
      },
      { timeoutMs: 10000, intervalMs: 250 },
    )
    expect(title).toBe('clicked:btn-hello')
  })
})
