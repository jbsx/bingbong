import type { BrowserController, BrowserState, KeyPress } from '../../core/ports/browser'
import { normalizeUrlInput } from '../../core/browser/urlInput'
import {
  buildPageSnapshot,
  findSnapshotRef,
  formatPageSnapshot,
  parseCollectedPage,
  type PageSnapshot,
  type SnapshotRef,
} from '../../core/browser/snapshot'

// Minimal CDP surface the controller needs, so tests can drive it with a fake
// and the Electron glue (webContents.debugger) stays a thin adapter.
export interface CdpDebugger {
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>
}

// Page-level operations the pane already knows how to do (load, history, url).
export interface CdpPageDriver {
  loadUrl(url: string): Promise<void>
  goBack(): Promise<void>
  url(): string
  title(): string
  /** Makes the page the focused webContents — synthetic keys are dropped otherwise. */
  focus(): void
}

export interface ControllerPacing {
  settleMs: number
  moveMs: number
  clickMs: number
  keystrokeMs: number
  scrollTickMs: number
}

export const HUMAN_PACING: ControllerPacing = {
  settleMs: 300,
  moveMs: 60,
  clickMs: 90,
  keystrokeMs: 45,
  scrollTickMs: 70,
}

export interface CdpBrowserControllerDeps {
  cdp: CdpDebugger
  page: CdpPageDriver
  collectScript: string
  pacing?: Partial<ControllerPacing>
}

interface EvaluateResponse {
  result?: { value?: unknown }
  exceptionDetails?: { text: string }
}

interface ScreenshotResponse {
  data: string
}

/** Result of the in-page click-preparation probe. */
interface ClickPrep {
  ok: boolean
  x?: number
  y?: number
  clickable?: boolean
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface KeyEvent {
  key: string
  code?: string
  text?: string
  keyCode: number
}

/** CDP Input modifier bit for Shift. */
const SHIFT_MODIFIER = 8

const SPECIAL_KEYS: Record<string, KeyEvent> = {
  '\n': { key: 'Enter', code: 'Enter', text: '\r', keyCode: 13 },
  '\r': { key: 'Enter', code: 'Enter', text: '\r', keyCode: 13 },
  '\t': { key: 'Tab', code: 'Tab', keyCode: 9 },
  '\b': { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  '\x1b': { key: 'Escape', code: 'Escape', keyCode: 27 },
}

function keyEventFor(ch: string): KeyEvent {
  const special = SPECIAL_KEYS[ch]
  if (special) return special
  return { key: ch, text: ch, keyCode: ch.toUpperCase().charCodeAt(0) }
}

// Virtual key codes for named (non-character) keys the agent may inject.
const NAMED_KEY_CODES: Record<string, number> = {
  Enter: 13,
  Tab: 9,
  Backspace: 8,
  Escape: 27,
  Space: 32,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  PageUp: 33,
  PageDown: 34,
  Home: 36,
  End: 35,
}

// Shortcut events carry no `text`: they drive page key handlers (media
// players, players' global shortcuts) without typing into focused inputs.
function shortcutEventFor(press: KeyPress): { key: string; code: string; keyCode: number; modifiers?: number } {
  const shift = press.shift === true
  if (press.key.length === 1) {
    if (!/^[a-z0-9]$/i.test(press.key)) {
      throw new Error(`pressKey: unsupported key '${press.key}'`)
    }
    const upper = press.key.toUpperCase()
    const code = /^[0-9]$/.test(press.key) ? `Digit${press.key}` : `Key${upper}`
    return {
      key: shift ? upper : press.key,
      code,
      keyCode: upper.charCodeAt(0),
      ...(shift ? { modifiers: SHIFT_MODIFIER } : {}),
    }
  }
  const keyCode = NAMED_KEY_CODES[press.key]
  if (keyCode === undefined) {
    throw new Error(`pressKey: unsupported key '${press.key}'`)
  }
  return {
    key: press.key,
    code: press.key,
    keyCode,
    ...(shift ? { modifiers: SHIFT_MODIFIER } : {}),
  }
}

export function createCdpBrowserController(deps: CdpBrowserControllerDeps): BrowserController {
  const { cdp, page, collectScript } = deps
  const pacing: ControllerPacing = { ...HUMAN_PACING, ...deps.pacing }
  let lastSnapshot: PageSnapshot | undefined

  async function collectSnapshot(): Promise<PageSnapshot> {
    const snapshot = buildPageSnapshot(parseCollectedPage(await evaluateInPage<unknown>(collectScript)))
    lastSnapshot = snapshot
    return snapshot
  }

  async function evaluateInPage<T>(expression: string): Promise<T> {
    const response = await cdp.send<EvaluateResponse>('Runtime.evaluate', {
      expression,
      returnByValue: true,
    })
    if (response.exceptionDetails) {
      throw new Error(`page evaluation failed: ${response.exceptionDetails.text}`)
    }
    return (response.result?.value ?? undefined) as T
  }

  async function currentSnapshot(): Promise<PageSnapshot> {
    return lastSnapshot ?? collectSnapshot()
  }

  const SCROLL_TICKS = 3
  // One wheel-notch worth per tick (~120px in Chromium). Small steps matter:
  // a step larger than element height + viewport height skips past elements
  // entirely on short viewports, so they never appear in a snapshot.
  const SCROLL_STEP_PX = 120

  async function scroll(direction: 'up' | 'down'): Promise<void> {
    const { viewport } = await currentSnapshot()
    const deltaY = direction === 'down' ? SCROLL_STEP_PX : -SCROLL_STEP_PX
    const x = Math.floor(viewport.width / 2)
    const y = Math.floor(viewport.height / 2)
    for (let tick = 0; tick < SCROLL_TICKS; tick++) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY })
      await sleep(pacing.scrollTickMs)
    }
    // Viewport-relative rects shift with the scroll; refs must be re-read.
    lastSnapshot = undefined
  }

  async function navigate(input: string): Promise<void> {
    const url = normalizeUrlInput(input)
    if (!url) throw new Error(`cannot navigate to: "${input}"`)
    await page.loadUrl(url)
    lastSnapshot = undefined
    await sleep(pacing.settleMs)
  }

  async function screenshot(): Promise<Uint8Array> {
    const response = await cdp.send<ScreenshotResponse>('Page.captureScreenshot', { format: 'jpeg' })
    return new Uint8Array(Buffer.from(response.data, 'base64'))
  }

  async function back(): Promise<void> {
    await page.goBack()
    lastSnapshot = undefined
    await sleep(pacing.settleMs)
  }

  async function readPage(): Promise<string> {
    return formatPageSnapshot(await collectSnapshot())
  }

  async function resolveRef(ref: number): Promise<{ snapshot: PageSnapshot; target: SnapshotRef }> {
    if (lastSnapshot) {
      const target = findSnapshotRef(lastSnapshot, ref)
      if (target) return { snapshot: lastSnapshot, target }
    }
    const snapshot = await collectSnapshot()
    const target = findSnapshotRef(snapshot, ref)
    if (!target) {
      throw new Error(`ref ${ref} not found — the page may have changed, run read_page to refresh refs`)
    }
    return { snapshot, target }
  }

  async function dispatchClick(ref: number): Promise<void> {
    const { snapshot, target } = await resolveRef(ref)
    let index = snapshot.refs.indexOf(target)
    let prep = await prepClick(index)
    if (!prep.ok) {
      // The element registry died with the page (navigation); re-collect.
      const fresh = await collectSnapshot()
      const freshTarget = findSnapshotRef(fresh, ref)
      if (!freshTarget) {
        throw new Error(`ref ${ref} not found — the page may have changed, run read_page to refresh refs`)
      }
      index = fresh.refs.indexOf(freshTarget)
      prep = await prepClick(index)
      if (!prep.ok) {
        throw new Error(`ref ${ref} not found — the page may have changed, run read_page to refresh refs`)
      }
    }

    if (prep.clickable && typeof prep.x === 'number' && typeof prep.y === 'number') {
      const { x, y } = prep
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
      await sleep(pacing.moveMs)
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x,
        y,
        button: 'left',
        buttons: 1,
        clickCount: 1,
      })
      await sleep(pacing.clickMs)
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x,
        y,
        button: 'left',
        buttons: 0,
        clickCount: 1,
      })
    } else {
      // Coordinates can't reach the element (overlay on top, clipped away):
      // activate it directly, Vimium-style, so nothing can swallow the click.
      await evaluateInPage(`(window.__bingbongRefs || [])[${index}].click()`)
    }
    // A click can navigate (link) or mutate the page; never trust old refs.
    lastSnapshot = undefined
  }

  /** Scroll the ref's element into view, then report fresh click coordinates
   * and whether a coordinate click would actually land on it. */
  async function prepClick(index: number): Promise<ClickPrep> {
    return evaluateInPage<ClickPrep>(`(() => {
      const el = (window.__bingbongRefs || [])[${index}]
      if (!el || !el.isConnected) return { ok: false }
      el.scrollIntoView({ block: 'center', inline: 'nearest' })
      const vw = window.innerWidth
      const vh = window.innerHeight
      const rect = el.getBoundingClientRect()
      const clamp = (value, low, high) => Math.min(Math.max(value, low), high)
      const visibleLeft = Math.max(rect.x, 0)
      const visibleRight = Math.min(rect.x + rect.width, vw)
      const visibleTop = Math.max(rect.y, 0)
      const visibleBottom = Math.min(rect.y + rect.height, vh)
      const x = Math.round(clamp(rect.x + rect.width / 2, visibleLeft, Math.max(visibleLeft, visibleRight - 1)))
      const y = Math.round(clamp(rect.y + rect.height / 2, visibleTop, Math.max(visibleTop, visibleBottom - 1)))
      if (x < 0 || y < 0 || x >= vw || y >= vh) return { ok: true, clickable: false }
      const top = document.elementFromPoint(x, y)
      return { ok: true, x, y, clickable: top === el || (top !== null && el.contains(top)) }
    })()`)
  }

  async function type(ref: number, text: string): Promise<void> {
    await dispatchClick(ref)
    await sleep(pacing.settleMs)
    for (const ch of text) {
      const key = keyEventFor(ch)
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: key.key,
        ...(key.code ? { code: key.code } : {}),
        ...(key.text ? { text: key.text } : {}),
        windowsVirtualKeyCode: key.keyCode,
      })
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: key.key,
        ...(key.code ? { code: key.code } : {}),
        windowsVirtualKeyCode: key.keyCode,
      })
      await sleep(pacing.keystrokeMs)
    }
  }

  async function dispatchShortcut(key: { key: string; code: string; keyCode: number; modifiers?: number }): Promise<void> {
    const params = {
      key: key.key,
      code: key.code,
      windowsVirtualKeyCode: key.keyCode,
      ...(key.modifiers !== undefined ? { modifiers: key.modifiers } : {}),
    }
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...params })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...params })
  }

  async function pressKey(press: KeyPress, times = 1): Promise<void> {
    if (!Number.isInteger(times) || times < 1) {
      throw new Error(`pressKey: 'times' must be a positive integer (got ${times})`)
    }
    const event = shortcutEventFor(press)
    // Keys only land on the focused webContents — after a text-box command
    // the dashboard holds focus, so claim it for the page first.
    page.focus()
    await sleep(pacing.settleMs)
    for (let i = 0; i < times; i++) {
      await dispatchShortcut(event)
      if (i < times - 1) await sleep(pacing.keystrokeMs)
    }
  }

  async function describeRef(ref: number): Promise<SnapshotRef | undefined> {
    try {
      const { target } = await resolveRef(ref)
      return target
    } catch {
      return undefined
    }
  }

  function state(): BrowserState {
    return { url: page.url(), title: page.title() }
  }

  return {
    navigate,
    readPage,
    click: dispatchClick,
    type,
    scroll,
    screenshot,
    back,
    pressKey,
    state,
    describeRef,
  }
}
