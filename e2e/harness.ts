import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CdpClient } from './cdpClient'
import { launchApp, pickFreeDebugPort, type LaunchedApp } from './electronApp'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { urlBarNavigationScript } from './scripts'
import { sleep, waitFor } from './waitFor'

export interface Harness {
  cdp: CdpClient
  fixture: FixtureServer
  paneSessionId(): string | undefined
  paneTargetId(): string | undefined
  dashboardTargetId(): string | undefined
  navigatePane(url: string): Promise<void>
  paneUrl(): Promise<string | undefined>
  waitForPaneUrl(url: string): Promise<string>
  paneEval<T = unknown>(expression: string): Promise<T>
  dashboardEval<T = unknown>(expression: string): Promise<T>
  clickPaneAt(x: number, y: number): Promise<void>
  typeIntoPane(text: string): Promise<void>
  clickDashboardElement(selector: string): Promise<void>
  /** Write one line to the app's CLI harness stdin (requires `pipeStdio`). */
  cliWrite(line: string): void
  /** Resolve with the first CLI harness stdout line matching. */
  waitForCliOutput(match: RegExp, options?: { since?: number }): Promise<string>
  /** Marker for `waitForCliOutput`'s `since` — only sees lines printed after this. */
  cliMark(): number
  /** Everything the CLI harness has printed so far. */
  cliOutput(): string
  /** Give the pane target OS/webContents focus so synthetic input lands. */
  focusPane(): Promise<void>
  quit(): Promise<void>
}

interface TargetInfo {
  sessionId: string
  targetId: string
  type: string
  url: string
}

type TargetKind = 'dashboard' | 'pane'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

// targetInfo.url goes stale after navigations; the predicates only rely on
// values that never change for a given target (kind of page, initial URL).
const targetPredicates: Record<TargetKind, (info: TargetInfo) => boolean> = {
  dashboard: (info) => info.url.includes('out/renderer'),
  pane: (info) => info.type === 'page' && !info.url.includes('out/renderer'),
}

async function evaluate<T>(cdp: CdpClient, sessionId: string, expression: string): Promise<T> {
  const response = await cdp.send<{
    result?: { value?: T }
    exceptionDetails?: { text: string }
  }>('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
  if (response.exceptionDetails) throw new Error(`evaluation failed: ${response.exceptionDetails.text}`)
  return response.result?.value as T
}

export async function startHarness(
  options?: {
    fixture?: FixtureServer
    userDataDir?: string
    launchArgs?: string[]
    pipeStdio?: boolean
    env?: Record<string, string | undefined>
    /**
     * The app boots into the idle screen; by default the harness wakes the
     * dashboard (synthetic keydown) so tests start on the URL bar. Pass
     * false to observe the boot-idle state itself.
     */
    wakeFromBootIdle?: boolean
  },
): Promise<Harness> {
  const ownsFixture = !options?.fixture
  const ownsUserDataDir = !options?.userDataDir
  const fixture = options?.fixture ?? (await startFixtureServer())
  const userDataDir = options?.userDataDir ?? (await mkdtemp(join(tmpdir(), 'bingbong-e2e-profile-')))
  const app: LaunchedApp = await launchApp({
    electronBinary: `${repoRoot}/node_modules/.bin/electron`,
    entry: 'out/main/index.js',
    cwd: repoRoot,
    debugPort: await pickFreeDebugPort(),
    userDataDir,
    args: options?.launchArgs,
    pipeStdio: options?.pipeStdio,
    // Wake-word monitoring keeps the mic hot from app start; tests opt in
    // explicitly (BINGBONG_WAKE_ENGINE + BINGBONG_WAKE_SCRIPT) so the default
    // suite stays hotkey-only.
    env: { BINGBONG_WAKE_ENGINE: 'off', ...options?.env },
  })
  const teardown = async () => {
    try {
      await app.quit()
    } finally {
      if (ownsFixture) await fixture.close().catch(() => {})
      if (ownsUserDataDir) await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
    }
  }
  try {
    return await buildHarness(app, fixture, teardown, options?.wakeFromBootIdle ?? true)
  } catch (error) {
    await teardown().catch(() => {})
    throw error
  }
}

async function buildHarness(
  app: LaunchedApp,
  fixture: FixtureServer,
  teardown: () => Promise<void>,
  wakeFromBootIdle: boolean,
): Promise<Harness> {
  const { cdp } = app

  const sessions = new Map<string, TargetInfo>()
  cdp.on('Target.attachedToTarget', (params) => {
    const { sessionId, targetInfo } = params as {
      sessionId: string
      targetInfo: { targetId: string; type: string; url: string }
    }
    sessions.set(sessionId, { sessionId, targetId: targetInfo.targetId, type: targetInfo.type, url: targetInfo.url })
  })
  cdp.on('Target.detachedFromTarget', (params) => {
    sessions.delete((params as { sessionId: string }).sessionId)
  })
  await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true })

  const findTarget = (kind: TargetKind) => [...sessions.values()].find(targetPredicates[kind])
  const sidOf = (kind: TargetKind) => findTarget(kind)?.sessionId
  const dashboardSid = () => sidOf('dashboard')
  const paneSid = () => sidOf('pane')

  await waitFor(async () => dashboardSid(), { timeoutMs: 15000, intervalMs: 250 })
  // Wait until React has mounted, not just until the target exists. The app
  // boots into the idle screen (T11): by default the harness wakes it — the
  // synthetic keydown is the same "any interaction wakes it" real input
  // produces, retried until the listeners exist and the dashboard shows.
  await waitFor(
    async () => {
      const sid = dashboardSid()
      if (!sid) return undefined
      const ready = await evaluate<boolean>(
        cdp,
        sid,
        wakeFromBootIdle
          ? `(window.dispatchEvent(new KeyboardEvent('keydown')), !!document.querySelector('.url-input'))`
          : `!!document.querySelector('.url-input') || !!document.querySelector('.idle-screen')`,
      )
      return ready ? sid : undefined
    },
    { timeoutMs: 15000, intervalMs: 250 },
  )

  // Synthetic input is dropped unless the OS window has focus AND the target
  // webContents is focused. Window focus follows the main webContents, so
  // activating the dashboard once covers (a); each input target then needs its
  // own activation for (b). The renderer applies activation asynchronously —
  // 300ms was empirically too short, 1000ms works — so only pay the settle on
  // an actual focus switch. (Focus emulation does NOT unlock WebContentsView
  // input; Target.activateTarget does.)
  let lastActivated: TargetKind | undefined
  const activateFor = async (kind: TargetKind) => {
    if (lastActivated === kind) return
    const target = findTarget(kind)
    if (!target) throw new Error(`${kind} target not found`)
    await cdp.send('Target.activateTarget', { targetId: target.targetId })
    await sleep(1000)
    lastActivated = kind
  }
  await activateFor('dashboard')

  const dispatchClick = async (sid: string, x: number, y: number) => {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }, sid)
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }, sid)
  }

  const harness: Harness = {
    cdp,
    fixture,

    paneSessionId: paneSid,
    paneTargetId: () => findTarget('pane')?.targetId,
    dashboardTargetId: () => findTarget('dashboard')?.targetId,

    async navigatePane(url) {
      const sid = dashboardSid()
      if (!sid) throw new Error('dashboard target not found')
      await evaluate(cdp, sid, urlBarNavigationScript(url))
      await harness.waitForPaneUrl(url)
      // A navigation may swap the pane's renderer; don't trust prior activation.
      if (lastActivated === 'pane') lastActivated = undefined
    },

    async paneUrl() {
      const sid = paneSid()
      if (!sid) return undefined
      return evaluate<string>(cdp, sid, 'location.href')
    },

    async waitForPaneUrl(url) {
      // Exact match: prefix matching returns early when the pane sits on a child
      // path of the target (e.g. waiting for '/' while on '/second').
      const matched = await waitFor(
        async () => {
          const current = await harness.paneUrl()
          return current === url ? current : undefined
        },
        { timeoutMs: 15000, intervalMs: 250 },
      )
      // The URL changes before the new renderer's input pipeline is ready;
      // clicks dispatched right after a commit are silently dropped.
      await sleep(500)
      return matched
    },

    async paneEval(expression) {
      const sid = paneSid()
      if (!sid) throw new Error('pane target not found')
      return evaluate(cdp, sid, expression)
    },

    async dashboardEval(expression) {
      const sid = dashboardSid()
      if (!sid) throw new Error('dashboard target not found')
      return evaluate(cdp, sid, expression)
    },

    async clickPaneAt(x, y) {
      const sid = paneSid()
      if (!sid) throw new Error('pane target not found')
      await activateFor('pane')
      await dispatchClick(sid, x, y)
    },

    async typeIntoPane(text) {
      const sid = paneSid()
      if (!sid) throw new Error('pane target not found')
      await activateFor('pane')
      await cdp.send('Input.insertText', { text }, sid)
    },

    async clickDashboardElement(selector) {
      const sid = dashboardSid()
      if (!sid) throw new Error('dashboard target not found')
      const center = await evaluate<{ x: number; y: number } | null>(
        cdp,
        sid,
        `(() => {
          const el = document.querySelector(${JSON.stringify(selector)})
          if (!el) return null
          const r = el.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        })()`,
      )
      if (!center) throw new Error(`element not found: ${selector}`)
      await activateFor('dashboard')
      await dispatchClick(sid, center.x, center.y)
    },

    cliWrite(line) {
      if (!app.stdin) throw new Error('app was not launched with pipeStdio')
      app.stdin.write(`${line}\n`)
    },

    waitForCliOutput: (match: RegExp, options?: { since?: number }) =>
      app.waitForStdoutLine(match, options?.since ?? 0),

    cliMark: () => app.stdoutLineCount(),

    cliOutput: () => app.stdoutText(),

    focusPane: () => activateFor('pane'),

    quit: teardown,
  }

  return harness
}
