import type { BrowserController, VisualGroundingController } from '../../core/ports/browser'
import type { BrowserSubspans } from '../../core/perf/browserSubspans'
import { authIdentityScript, resolveAuthIdentity, type AuthIdentity } from '../../core/browser/authIdentity'
import { COLLECT_PAGE_SCRIPT } from './collectPageScript'
import { createCdpBrowserController, type CdpDebugger, type CdpPageDriver } from './createCdpBrowserController'

// Electron glue: adapts webContents.debugger + the pane's navigation surface
// into the seams the controller already knows. Behavior lives in
// createCdpBrowserController (fake-CDP tested); this file is covered by e2e.

const DEBUGGER_PROTOCOL_VERSION = '1.3'
const LOAD_TIMEOUT_MS = 30_000
const HISTORY_STEP_TIMEOUT_MS = 15_000

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

export function createPaneBrowserController(
  pane: {
    view: { webContents: Electron.WebContents }
    /** Popup-block reports recorded by the pane (main pane only). */
    consumePopupBlocks?: () => string[]
    /** Auth-popup opens queued by the pane, opened here (main pane only). */
    consumeAuthPopupOpens?: () => string[]
  },
  deps?: {
    /** Verbose browser sub-spans (#32); absent — no sub-span emission. */
    subspans?: BrowserSubspans
    /** Auth-host identity (ADR 0018); defaults to the env-resolved policy. */
    authIdentity?: AuthIdentity
  },
): BrowserController & VisualGroundingController {
  const wc = pane.view.webContents
  let attached = false
  let pageEventsEnabled = false

  wc.debugger.on('detach', () => {
    attached = false
    pageEventsEnabled = false
  })

  const cdp: CdpDebugger = {
    send(method, params) {
      if (wc.isDestroyed()) return Promise.reject(new Error('pane webContents destroyed'))
      if (!attached) {
        try {
          wc.debugger.attach(DEBUGGER_PROTOCOL_VERSION)
        } catch (err) {
          return Promise.reject(err instanceof Error ? err : new Error(String(err)))
        }
        attached = true
      }
      if (!pageEventsEnabled) {
        // Page-domain events (native JS dialogs) only flow once enabled.
        // Commands queue in order behind it, so the first click's alert is
        // always observable.
        pageEventsEnabled = true
        void wc.debugger.sendCommand('Page.enable').catch(() => {})
      }
      return wc.debugger.sendCommand(method, params ?? undefined)
    },
    on(event, handler) {
      wc.debugger.on('message', (_event, method, params) => {
        if (method === event) handler(params)
      })
    },
  }

  // Auth-identity injection (ADR 0018): registered now, at construction —
  // before any navigation — so it runs ahead of page scripts on every load
  // this surface ever makes, aligning navigator.userAgent/userAgentData
  // with the header identity on auth hosts. Attaching the debugger here is
  // the same lazy seam the first tool call would take, just earlier; a
  // failure degrades to the header-only identity (still coherent to the
  // server) and never blocks the controller.
  const authIdentity = deps?.authIdentity ?? resolveAuthIdentity(process.env)
  if (authIdentity.hosts.length > 0) {
    void cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: authIdentityScript(authIdentity) }).catch(() => {})
  }

  /** One step in history ('back'/'forward'): guarded, awaited, bounded. */
  async function historyStep(canGo: boolean, go: () => void, direction: string): Promise<void> {
    if (!canGo) throw new Error(`cannot go ${direction}: no history`)
    const navigated = new Promise<void>((resolve) => {
      wc.once('did-navigate', () => resolve())
    })
    go()
    await withTimeout(navigated, HISTORY_STEP_TIMEOUT_MS, `timed out going ${direction}`)
  }

  const page: CdpPageDriver = {
    loadUrl: (url) => withTimeout(wc.loadURL(url), LOAD_TIMEOUT_MS, `timed out loading ${url}`),
    goBack: () => historyStep(wc.navigationHistory.canGoBack(), () => wc.navigationHistory.goBack(), 'back'),
    goForward: () => historyStep(wc.navigationHistory.canGoForward(), () => wc.navigationHistory.goForward(), 'forward'),
    url: () => wc.getURL(),
    title: () => wc.getTitle(),
    focus: () => {
      if (!wc.isDestroyed()) wc.focus()
    },
  }

  return createCdpBrowserController({
    cdp,
    page,
    collectScript: COLLECT_PAGE_SCRIPT,
    ...(pane.consumePopupBlocks ? { consumePopupBlocks: pane.consumePopupBlocks } : {}),
    ...(pane.consumeAuthPopupOpens ? { consumeAuthPopupOpens: pane.consumeAuthPopupOpens } : {}),
    ...(deps?.subspans ? { subspans: deps.subspans } : {}),
  })
}
