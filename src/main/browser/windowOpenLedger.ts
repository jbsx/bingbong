import { isNavigableAddress, judgeWindowOpens, LINK_SELECTOR } from '../../core/browser/newWindowLink'
import { reportFault } from '../../core/trace/fault'

// #299, ADR 0073: what a pane does with an open it denied. Two routes, by
// whose action made it.
//
// While the model acts on the page the controller holds the ledger: the
// open waits for the action's outcome, where a click judges it against the
// ref it clicked and either follows it or reports it. An open that arrives
// shortly after the hold is released is still the model's — a handler on a
// timer, a slow page — and is reported, never followed.
//
// Otherwise the open is the user's doing, or the page's own, and the ledger
// judges it itself: the page is asked which link was just pressed, and an
// open to that link's address navigates the pane, silently, like the
// middle-click. Every other open waits to be reported on the model's next
// outcome line, as it always has.
//
// A user's press made while the model acts is judged as the model's: the
// two cannot be told apart from here, and reporting an open is the safe
// reading of one.

/**
 * How long a press stays the press an open is judged by, and so how long
 * after the model's action an open is still the model's: the press the
 * model made has gone stale by the time the user's route is open again.
 */
export const PRESS_FRESH_MS = 2_000

export interface WindowOpenLedgerDeps {
  /** The address the link just pressed carries now; null when no link was pressed. */
  pressedLinkAddress(): Promise<string | null>
  /** Sends the pane to this address; false when it cannot go. */
  navigate(url: string): boolean
  /** Milliseconds, for the time since the model last acted; the wall clock when absent. */
  now?(): number
}

export interface WindowOpenLedger {
  /** The window-open handler's entry: an open it denied. */
  recordDenied(url: string): void
  /** The model is acting on the page until the returned release is called. */
  hold(): () => void
  /** Drains the denied opens waiting to be reported or judged. */
  consume(): string[]
  /** Drops everything waiting — Session-owned transient work (#96). */
  clear(): void
}

export function createWindowOpenLedger(deps: WindowOpenLedgerDeps): WindowOpenLedger {
  const now = deps.now ?? Date.now
  const waiting: string[] = []
  let holds = 0
  let releasedAt = Number.NEGATIVE_INFINITY
  // Bumped on clear, so an answer the page gives after it reports nothing.
  let epoch = 0

  function isModelActing(): boolean {
    return holds > 0 || now() - releasedAt < PRESS_FRESH_MS
  }

  async function isPressedLink(url: string): Promise<boolean> {
    try {
      return judgeWindowOpens([url], [await deps.pressedLinkAddress()]).followed !== null
    } catch (error) {
      reportFault('browser.windowOpenLedger.pressedLinkAddress', error)
      return false
    }
  }

  async function judgeAsUserPress(url: string): Promise<void> {
    const asked = epoch
    const followed = (await isPressedLink(url)) && asked === epoch && !isModelActing() && deps.navigate(url)
    if (!followed && asked === epoch) waiting.push(url)
  }

  return {
    recordDenied(url) {
      if (isModelActing() || !isNavigableAddress(url)) {
        waiting.push(url)
        return
      }
      void judgeAsUserPress(url)
    },
    hold() {
      holds += 1
      let released = false
      return () => {
        if (released) return
        released = true
        holds -= 1
        releasedAt = now()
      }
    },
    consume: () => waiting.splice(0),
    clear() {
      waiting.length = 0
      epoch += 1
    },
  }
}

/**
 * Installed on every document the pane loads: remembers the link a press
 * landed on — a mouse press, or Enter on a focused link — by node, so its
 * address can be asked for after the page's own handlers have run.
 */
export const PRESSED_LINK_SCRIPT = `(() => {
  if (window.__bingbongPressedLinkInstalled) return
  window.__bingbongPressedLinkInstalled = true
  const remember = (event) => {
    if (event.type === 'keydown' && event.key !== 'Enter') return
    const target = event.target
    const link = target && typeof target.closest === 'function' ? target.closest(${JSON.stringify(LINK_SELECTOR)}) : null
    window.__bingbongPressedLink = link ? { el: link, at: Date.now() } : null
  }
  document.addEventListener('mousedown', remember, true)
  document.addEventListener('click', remember, true)
  document.addEventListener('keydown', remember, true)
})()`

/** The address the link just pressed carries now; null when the last press is stale or was on no link. */
export const PRESSED_LINK_ADDRESS_SCRIPT = `(() => {
  const pressed = window.__bingbongPressedLink
  if (!pressed || !pressed.el || !pressed.el.isConnected || Date.now() - pressed.at >= ${PRESS_FRESH_MS}) return null
  return typeof pressed.el.href === 'string' ? pressed.el.href : null
})()`

/** The pane surface the ledger's Electron glue needs. */
interface LedgerWebContents {
  isDestroyed(): boolean
  executeJavaScript(code: string): Promise<unknown>
  loadURL(url: string): Promise<unknown>
  on(event: 'dom-ready', listener: () => void): unknown
}

/** A pane's ledger over its own webContents. Covered by e2e; the rule lives above. */
export function attachWindowOpenLedger(wc: LedgerWebContents): WindowOpenLedger {
  wc.on('dom-ready', () => {
    if (!wc.isDestroyed()) void wc.executeJavaScript(PRESSED_LINK_SCRIPT).catch(() => {})
  })
  return createWindowOpenLedger({
    async pressedLinkAddress() {
      if (wc.isDestroyed()) return null
      const address = await wc.executeJavaScript(PRESSED_LINK_ADDRESS_SCRIPT)
      return typeof address === 'string' ? address : null
    },
    navigate(url) {
      if (wc.isDestroyed()) return false
      void wc.loadURL(url).catch(() => {})
      return true
    },
  })
}
