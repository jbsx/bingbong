import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { commandBoxScript } from './scripts'
import { startHarness, type Harness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { waitFor } from './waitFor'

// Web zoom (#53): the webZoomPercent setting applies to the main pane and
// subagent panes on every navigation. Zoom is observed via
// window.devicePixelRatio — page zoom multiplies it in Chromium, and Xvfb
// runs at OS scale 1. Manual wheel-zoom survival between navigations is not
// asserted here: the gesture needs native input (CDP-injected ctrl+wheel
// bypasses the browser-process zoom path), and the contract is structural —
// main only writes the zoom at attach and on did-navigate.

const SUB_PATH = '/second'

function setWebZoomScript(percent: number): string {
  return `(() => {
    const input = document.querySelector('input[aria-label="Web zoom percent"]')
    if (!input) return 'no-zoom-input'
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, ${percent})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return 'edited'
  })()`
}

async function evalInPageTarget<T>(harness: Harness, targetId: string, expression: string): Promise<T> {
  const { sessionId } = await harness.cdp.send<{ sessionId: string }>('Target.attachToTarget', {
    targetId,
    flatten: true,
  })
  const response = await harness.cdp.send<{ result?: { value?: T } }>(
    'Runtime.evaluate',
    { expression, returnByValue: true },
    sessionId,
  )
  return response.result?.value as T
}

describe('web zoom e2e', () => {
  let fixture: FixtureServer
  let harness: Harness
  let userDataDir: string

  beforeAll(async () => {
    fixture = await startFixtureServer()
    userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-zoom-'))
    harness = await startHarness({
      fixture,
      userDataDir,
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify([
          { kind: 'tool_calls', calls: [{ id: 's1', name: 'spawn_agent', args: { kind: 'browse', task: 'open the fixture page' } }] },
          { kind: 'tool_calls', calls: [{ id: 's2', name: 'agent_results', args: { wait: true } }] },
          { kind: 'answer', speak: 'Done browsing.', display: 'Done browsing.' },
        ]),
        BINGBONG_SUBAGENT_LLM_SCRIPT: JSON.stringify([
          { kind: 'tool_calls', calls: [{ id: 'n1', name: 'navigate', args: { url: fixture.url(SUB_PATH) } }] },
          { kind: 'answer', speak: 'done', display: 'Browsed the fixture page.' },
        ]),
        // Keep tabs around long enough to inspect their zoom.
        BINGBONG_TAB_LINGER_MS: '20000',
      },
    })
  })

  afterAll(async () => {
    await harness?.quit()
    await fixture?.close()
    if (userDataDir) await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  async function paneZoom(): Promise<number | undefined> {
    const sid = harness.paneSessionId()
    if (!sid) return undefined
    const response = await harness.cdp.send<{ result?: { value?: number } }>(
      'Runtime.evaluate',
      { expression: 'window.devicePixelRatio', returnByValue: true },
      sid,
    )
    return response.result?.value
  }

  async function waitForPaneZoom(expected: number): Promise<number> {
    return waitFor(
      async () => {
        const zoom = await paneZoom()
        return zoom !== undefined && Math.abs(zoom - expected) < 0.01 ? zoom : undefined
      },
      { timeoutMs: 10000, intervalMs: 250 },
    )
  }

  it('applies the default 130% zoom after navigation', async () => {
    await harness.navigatePane(fixture.url('/'))
    expect(await waitForPaneZoom(1.3)).toBeCloseTo(1.3, 5)
  })

  it('applies a saved zoom setting on every navigation', async () => {
    await harness.clickDashboardElement('.settings-toggle')
    await waitFor(
      async () => {
        const open = await harness.dashboardEval<boolean>(`!!document.querySelector('.settings-page')`)
        return open ? true : undefined
      },
      { timeoutMs: 10000, intervalMs: 250 },
    )
    expect(await harness.dashboardEval<string>(setWebZoomScript(80))).toBe('edited')
    await harness.clickDashboardElement('.settings-button--primary')
    await waitFor(
      async () => {
        const raw = await readFile(join(userDataDir, 'settings.json'), 'utf8').catch(() => undefined)
        if (!raw) return undefined
        return JSON.parse(raw).webZoomPercent === 80 ? true : undefined
      },
      { timeoutMs: 10000, intervalMs: 250 },
    )
    await harness.clickDashboardElement('.settings-toggle')

    await harness.navigatePane(fixture.url(SUB_PATH))
    expect(await waitForPaneZoom(0.8)).toBeCloseTo(0.8, 5)
    await harness.navigatePane(fixture.url('/'))
    expect(await waitForPaneZoom(0.8)).toBeCloseTo(0.8, 5)
  })

  it('applies the saved zoom to subagent panes', async () => {
    // Expect whatever the profile actually says — the pane reads the same
    // store, so this stays correct regardless of test order.
    const persisted = await waitFor(
      async () => {
        const raw = await readFile(join(userDataDir, 'settings.json'), 'utf8').catch(() => undefined)
        const percent = raw ? (JSON.parse(raw).webZoomPercent as number | undefined) : undefined
        return typeof percent === 'number' ? percent : undefined
      },
      { timeoutMs: 10000, intervalMs: 250 },
    )
    expect(await harness.dashboardEval<string>(commandBoxScript('browse the fixture page'))).toBe('submitted')

    const targetId = await waitFor(
      async () => {
        const targets = await harness.cdp.send<{ targetInfos?: { targetId: string; type: string; url: string }[] }>(
          'Target.getTargets',
        )
        const sub = (targets.targetInfos ?? []).find(
          (info) => info.type === 'page' && info.url.startsWith(fixture.url(SUB_PATH)),
        )
        return sub?.targetId ?? undefined
      },
      { timeoutMs: 20000, intervalMs: 250 },
    )

    const expected = persisted / 100
    const zoom = await waitFor(
      async () => {
        const value = await evalInPageTarget<number>(harness, targetId, 'window.devicePixelRatio')
        return Math.abs(value - expected) < 0.01 ? value : undefined
      },
      { timeoutMs: 10000, intervalMs: 250 },
    )
    expect(zoom).toBeCloseTo(expected, 5)
  })
})
