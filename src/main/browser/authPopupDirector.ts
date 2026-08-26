import type { BrowserController, VisualGroundingController } from '../../core/ports/browser'

// Auth popups (ADR 0018): a sign-in flow's popup opens as a real child
// window with its opener semantics intact. While one is open, the pane's
// browser tools route to it — the newest popup is "the current page" for
// reads, clicks, typing, scrolling, vision, and screenshots — so the flow
// is voice-interactable end to end. Navigation verbs and state() stay on
// the main pane: the popup drives its own history (the provider's flow),
// and the Toolbar describes the pane, not the popup. Closing the popup
// restores the pane as the target.

type DrivenController = BrowserController & VisualGroundingController

/** The popup source the director listens to — the main pane's surface. */
export interface AuthPopupSource {
  onAuthPopup(listener: (win: Electron.BrowserWindow) => void): () => void
}

export interface AuthPopupDirector {
  /** Wrap the pane's controller: routed while an auth popup is open. */
  route(base: DrivenController): DrivenController
}

interface ActivePopup {
  controller: DrivenController
  webContents: Electron.WebContents
}

export function createAuthPopupDirector(
  source: AuthPopupSource,
  deps: {
    createController(webContents: Electron.WebContents): DrivenController
  },
): AuthPopupDirector {
  const stack: ActivePopup[] = []

  source.onAuthPopup((win) => {
    // Deferred one tick off the pane's drain call: the pane opens the
    // window itself (outside any in-flight input command), and the
    // controller's debugger attach follows on the next turn of the loop.
    setImmediate(() => {
      const webContents = win.webContents
      if (win.isDestroyed() || webContents.isDestroyed()) return
      const controller = deps.createController(webContents)
      const entry: ActivePopup = { controller, webContents }
      stack.push(entry)
      const gone = (): void => {
        const index = stack.indexOf(entry)
        if (index >= 0) stack.splice(index, 1)
      }
      win.once('closed', gone)
      webContents.once('destroyed', gone)
    })
  })

  /** The newest popup whose page is still alive — one notion of "active"
   * for both the action verbs and the readPage marker. */
  function activePopup(): ActivePopup | undefined {
    for (let index = stack.length - 1; index >= 0; index--) {
      if (!stack[index].webContents.isDestroyed()) return stack[index]
    }
    return undefined
  }

  function target(base: DrivenController): DrivenController {
    return activePopup()?.controller ?? base
  }

  return {
    route(base) {
      return {
        // Navigation verbs and observable state stay pane-owned.
        navigate: (url) => base.navigate(url),
        back: () => base.back(),
        forward: () => base.forward(),
        state: () => base.state(),
        // Everything the agent does to "the current page" routes to the
        // popup while one is open.
        readPage: async () => {
          const popup = activePopup()
          const result = await (popup ? popup.controller : base).readPage()
          return popup ? `${result}\nauth popup open: ${popup.webContents.getURL()}` : result
        },
        click: (ref) => target(base).click(ref),
        type: (ref, text) => target(base).type(ref, text),
        scroll: (direction) => target(base).scroll(direction),
        screenshot: () => target(base).screenshot(),
        pressKey: (press, times) => target(base).pressKey(press, times),
        mediaState: () => target(base).mediaState(),
        pageFacts: () => target(base).pageFacts(),
        describeRef: (ref) => target(base).describeRef(ref),
        groundingSnapshot: () => target(base).groundingSnapshot(),
        refAtPoint: (point) => target(base).refAtPoint(point),
      }
    },
  }
}
