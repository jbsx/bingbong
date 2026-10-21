import type { BrowserController, VisualGroundingController } from '../../core/ports/browser'
import type { BrowserSubspans } from '../../core/perf/browserSubspans'
import type { ConsentChooser } from '../../core/browser/dialogPolicy'
import { authIdentityScript, resolveAuthIdentity, type AuthIdentity } from '../../core/browser/authIdentity'
import { COLLECT_PAGE_SCRIPT, domQuietScript } from './collectPageScript'
import { systemClock } from '../../core/ports/clock'
import { LANDING_CAP_MS, createCdpBrowserController, type ActionEffects, type CdpDebugger, type PageFrame, type PageFrames } from './createCdpBrowserController'
import { createPaneNavigation } from './paneNavigation'
import { holdPageContextMenu } from './attachPageContextMenu'

// Electron glue: adapts webContents.debugger + the pane's navigation surface
// into the seams the controller already knows. Behavior lives in
// createCdpBrowserController (fake-CDP tested) and, for the bounded
// navigation waits, in paneNavigation (unit-tested); this file is covered
// by e2e.

const DEBUGGER_PROTOCOL_VERSION = '1.3'

/** A frame's key: its process and routing ids, which name its document's host for as long as it holds that process (#377). */
function frameKey(frame: Electron.WebFrameMain): string {
  return `${frame.processId}:${frame.routingId}`
}

/**
 * Every frame below the tab's top document (#377, ADR 0081), any depth,
 * any site: Electron's frame API reaches out-of-process frames as it does
 * same-process ones (the #377 spike), so each is evaluated in its own
 * context with no CDP session of its own.
 */
export function electronPageFrames(wc: Electron.WebContents): PageFrames {
  return {
    list() {
      if (wc.isDestroyed()) return []
      const top = wc.mainFrame
      return top.framesInSubtree
        .filter((frame) => frame !== top && !frame.detached && frame.parent !== null)
        .map(
          (frame): PageFrame => ({
            key: frameKey(frame),
            parentKey: frame.parent === null || frame.parent.parent === null ? null : frameKey(frame.parent),
            evaluate: <T,>(expression: string) => frame.executeJavaScript(expression) as Promise<T>,
          }),
        )
    },
  }
}

export function createPaneBrowserController(
  pane: {
    view: { webContents: Electron.WebContents }
    /** Popup-block reports recorded by the pane (main pane only). */
    consumePopupBlocks?: () => string[]
    /** Holds the pane's denied opens while the model acts on the page (ADR 0073). */
    holdWindowOpens?: () => () => void
    /** Auth-popup opens queued by the pane, opened here (main pane only). */
    consumeAuthPopupOpens?: () => string[]
  },
  deps?: {
    /** Verbose browser sub-spans (#32); absent — no sub-span emission. */
    subspans?: BrowserSubspans
    /** Hears each action's first observable effect (#324); absent — nothing is reported. */
    effects?: ActionEffects
    /** Auth-host identity (ADR 0018); defaults to the env-resolved policy. */
    authIdentity?: AuthIdentity
    /** Finds a consent wall's reject the rule cannot read (owner's rule 2026-10-19); absent — the policy accepts as before. */
    chooseConsent?: ConsentChooser
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

  // The landing wait (#328): the quiet window runs in the page over CDP —
  // Electron's executeJavaScript would wait for the very load it replaces.
  const page = createPaneNavigation(wc, systemClock, {
    async domQuiet(quietMs) {
      const response = (await cdp.send('Runtime.evaluate', { expression: domQuietScript(quietMs, LANDING_CAP_MS), awaitPromise: true, returnByValue: true })) as {
        result?: { value?: unknown }
      }
      // The page let go of the watch at the cap without going quiet: the landing's own cap ends it.
      if (response.result?.value !== true) await new Promise<void>(() => {})
    },
    ...(deps?.effects?.landed ? { onLanding: (landing) => deps.effects?.landed?.(landing) } : {}),
  })

  return createCdpBrowserController({
    cdp,
    page,
    collectScript: COLLECT_PAGE_SCRIPT,
    ...(pane.consumePopupBlocks ? { consumePopupBlocks: pane.consumePopupBlocks } : {}),
    ...(pane.holdWindowOpens ? { holdWindowOpens: pane.holdWindowOpens } : {}),
    ...(pane.consumeAuthPopupOpens ? { consumeAuthPopupOpens: pane.consumeAuthPopupOpens } : {}),
    holdContextMenu: () => holdPageContextMenu(wc),
    ...(deps?.subspans ? { subspans: deps.subspans } : {}),
    ...(deps?.effects ? { effects: deps.effects } : {}),
    ...(deps?.chooseConsent ? { chooseConsent: deps.chooseConsent } : {}),
    frames: electronPageFrames(wc),
  })
}
