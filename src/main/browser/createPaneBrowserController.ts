import type { BrowserController, VisualGroundingController } from '../../core/ports/browser'
import { COLLECT_PAGE_SCRIPT } from './collectPageScript'
import { createCdpBrowserController, type CdpDebugger, type CdpPageDriver } from './createCdpBrowserController'

// Electron glue: adapts webContents.debugger + the pane's navigation surface
// into the seams the controller already knows. Behavior lives in
// createCdpBrowserController (fake-CDP tested); this file is covered by e2e.

const DEBUGGER_PROTOCOL_VERSION = '1.3'
const LOAD_TIMEOUT_MS = 30_000
const BACK_TIMEOUT_MS = 15_000

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
  pane: { view: { webContents: Electron.WebContents } },
): BrowserController & VisualGroundingController {
  const wc = pane.view.webContents
  let attached = false

  wc.debugger.on('detach', () => {
    attached = false
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
      return wc.debugger.sendCommand(method, params ?? undefined)
    },
  }

  const page: CdpPageDriver = {
    loadUrl: (url) => withTimeout(wc.loadURL(url), LOAD_TIMEOUT_MS, `timed out loading ${url}`),
    async goBack() {
      if (!wc.navigationHistory.canGoBack()) throw new Error('cannot go back: no history')
      const navigated = new Promise<void>((resolve) => {
        wc.once('did-navigate', () => resolve())
      })
      wc.navigationHistory.goBack()
      await withTimeout(navigated, BACK_TIMEOUT_MS, 'timed out going back')
    },
    url: () => wc.getURL(),
    title: () => wc.getTitle(),
    focus: () => {
      if (!wc.isDestroyed()) wc.focus()
    },
  }

  return createCdpBrowserController({ cdp, page, collectScript: COLLECT_PAGE_SCRIPT })
}
