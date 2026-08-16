import type { BrowserController, BrowserState } from '../../core/ports/browser'
import { normalizeUrlInput } from '../../core/browser/urlInput'
import {
  buildPageSnapshot,
  clickPoint,
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface KeyEvent {
  key: string
  code?: string
  text?: string
  keyCode: number
}

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

export function createCdpBrowserController(deps: CdpBrowserControllerDeps): BrowserController {
  const { cdp, page, collectScript } = deps
  const pacing: ControllerPacing = { ...HUMAN_PACING, ...deps.pacing }
  let lastSnapshot: PageSnapshot | undefined

  async function collectSnapshot(): Promise<PageSnapshot> {
    const response = await cdp.send<EvaluateResponse>('Runtime.evaluate', {
      expression: collectScript,
      returnByValue: true,
    })
    if (response.exceptionDetails) {
      throw new Error(`page evaluation failed: ${response.exceptionDetails.text}`)
    }
    const snapshot = buildPageSnapshot(parseCollectedPage(response.result?.value))
    lastSnapshot = snapshot
    return snapshot
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
    const { x, y } = clickPoint(target, snapshot.viewport)
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
    state,
  }
}
