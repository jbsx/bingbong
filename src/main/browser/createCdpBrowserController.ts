import type { BrowserController, BrowserState, KeyPress, MediaState, ViewportPoint, VisualGroundingController } from '../../core/ports/browser'
import { blockerFactsFromSnapshot } from '../../core/browser/blockerNudge'
import type { BrowserSubspans } from '../../core/perf/browserSubspans'
import { normalizeUrlInput } from '../../core/browser/urlInput'
import { chooseConsentDismissal, isConsentDialog } from '../../core/browser/dialogPolicy'
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
  /** Subscribe to a CDP domain event (e.g. Page.javascriptDialogOpening). */
  on?(event: string, handler: (params: unknown) => void): void
}

// Page-level operations the pane already knows how to do (load, history, url).
export interface CdpPageDriver {
  loadUrl(url: string): Promise<void>
  goBack(): Promise<void>
  goForward(): Promise<void>
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
  /** Drains popup-block URLs the pane recorded (window.open denied + closed). */
  consumePopupBlocks?: () => string[]
  /**
   * Verbose sub-span channel (#32): when provided (and the env flag enabled
   * it), the deliberate delays and extra round-trips inside browser actions
   * become sub-spans keyed by the turn scope the pipeline's tool gate opens.
   * Absent — no sub-spans, actions behave identically.
   */
  subspans?: BrowserSubspans
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

interface ElementState {
  checked: boolean | null
  selectedOption: string | null
  value: string | null
  ariaPressed: string | null
  className: string
}

interface PageSignature {
  url: string
  title: string
  scrollX: number
  scrollY: number
  refCount: number
  labels: string[]
  dialogOpen: boolean
}

interface ActionProbe {
  target: ElementState | null
  signature: PageSignature
}

interface PointRefResult {
  index: number
  element: import('../../core/browser/snapshot').CollectedElement
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

export function createCdpBrowserController(deps: CdpBrowserControllerDeps): BrowserController & VisualGroundingController {
  const { cdp, page, collectScript } = deps
  const pacing: ControllerPacing = { ...HUMAN_PACING, ...deps.pacing }
  const subspans = deps.subspans
  let lastSnapshot: PageSnapshot | undefined
  const visualPoints = new Map<number, ViewportPoint>()

  // Verbose sub-span instrumentation (#32). Timing-only wrappers: the sleep,
  // collect, or probe always runs exactly as before; a channel is present
  // only when main wired one, and emission inside it is gated by the env
  // flag and the pipeline's open turn scope.

  /** A deliberate delay inside a browser action — one `browser-settle` sub-span when verbose. */
  async function settle(action: string, ms: number): Promise<void> {
    if (subspans === undefined) {
      await sleep(ms)
      return
    }
    const start = subspans.now()
    await sleep(ms)
    subspans.emit('browser-settle', subspans.now() - start, { action, ms })
  }

  /** An extra snapshot round-trip inside an action — one `browser-recollection` sub-span. */
  async function recollection<T>(reason: string, collect: () => Promise<T>): Promise<T> {
    if (subspans === undefined) return collect()
    const start = subspans.now()
    try {
      return await collect()
    } finally {
      subspans.emit('browser-recollection', subspans.now() - start, { reason })
    }
  }

  /** A pre-action safety round-trip before a risky interaction — one `browser-safety` sub-span. */
  async function safety<T>(kind: string, probe: () => Promise<T>): Promise<T> {
    if (subspans === undefined) return probe()
    const start = subspans.now()
    try {
      return await probe()
    } finally {
      subspans.emit('browser-safety', subspans.now() - start, { kind })
    }
  }

  // Native JS dialogs (alert/confirm/prompt/beforeunload) freeze the page's
  // JS thread — there is nothing to deliberate with while one is open, so
  // they are dismissed deterministically (Tier 1) and their text is queued
  // for the next outcome line the model reads.
  const nativeDialogReports: string[] = []
  cdp.on?.('Page.javascriptDialogOpening', (params) => {
    const { type, message } = (params ?? {}) as { type?: unknown; message?: unknown }
    const kind = typeof type === 'string' ? type : 'dialog'
    const text = typeof message === 'string' ? message : ''
    nativeDialogReports.push(`native ${kind} dialog auto-dismissed: ${JSON.stringify(truncateOutcomeText(text, 120))}`)
    void cdp.send('Page.handleJavaScriptDialog', { accept: false }).catch(() => {})
  })

  /** Popup blocks + native dialog reports since the last outcome line. */
  function drainedReports(): string[] {
    const reports = [
      ...(deps.consumePopupBlocks?.() ?? []).map((url) => `popup blocked: ${truncateOutcomeText(url, 160)}`),
      ...nativeDialogReports.splice(0),
    ]
    return reports
  }

  /** Tier 1: deterministically dismiss a consent-classified dialog. */
  async function dismissConsentIfOpen(snapshot: PageSnapshot): Promise<string | null> {
    if (!snapshot.dialogOpen) return null
    const controls = snapshot.refs.filter((ref) => ref.layer === 'dialog')
    const labels = controls.map((ref) => ref.label)
    if (!isConsentDialog(snapshot.dialogText, labels)) return null
    const choice = chooseConsentDismissal(labels)
    if (choice === null) return null
    const target = controls[choice]
    const clicked = await evaluateInPage<boolean>(`(() => {
      const el = (window.__bingbongRefs || [])[${target.ref - 1}]
      if (!el || !el.isConnected) return false
      if (typeof el.focus === 'function') el.focus()
      el.click()
      return true
    })()`)
    lastSnapshot = undefined
    await settle('consent-dismiss', pacing.settleMs)
    return clicked
      ? `dismissed consent dialog: clicked [${target.ref}] ${JSON.stringify(truncateOutcomeText(target.label, 60))}`
      : null
  }

  function dialogDetail(snapshot: PageSnapshot): string | null {
    if (!snapshot.dialogOpen) return null
    const controls = snapshot.refs.filter((ref) => ref.layer === 'dialog')
    const shown = controls.slice(0, 4).map((control) => {
      const label = control.label === '' ? '' : ` ${JSON.stringify(truncateOutcomeText(control.label, 40))}`
      return `[${control.ref}] ${control.kind}${label}`
    })
    const text = snapshot.dialogText === ''
      ? 'dialog open'
      : `dialog open: ${JSON.stringify(truncateOutcomeText(snapshot.dialogText, 80))}`
    if (shown.length === 0) return text
    const remainder = controls.length > shown.length ? ` (+${controls.length - shown.length} more)` : ''
    return `${text}; controls: ${shown.join(', ')}${remainder}`
  }

  function dialogSuffix(snapshot: PageSnapshot): string {
    const detail = dialogDetail(snapshot)
    return detail === null ? '' : `; ${detail}`
  }

  function reportsSuffix(reports: string[]): string {
    return reports.length > 0 ? `; ${reports.join('; ')}` : ''
  }

  async function collectSnapshot(): Promise<PageSnapshot> {
    const snapshot = buildPageSnapshot(parseCollectedPage(await evaluateInPage<unknown>(collectScript)))
    visualPoints.clear()
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
    return lastSnapshot ?? recollection('no-snapshot', () => collectSnapshot())
  }

  const SCROLL_TICKS = 3
  // One wheel-notch worth per tick (~120px in Chromium). Small steps matter:
  // a step larger than element height + viewport height skips past elements
  // entirely on short viewports, so they never appear in a snapshot.
  const SCROLL_STEP_PX = 120

  function elementState(target: SnapshotRef): ElementState {
    return {
      checked: target.checked ?? null,
      selectedOption: target.selectedOption ?? null,
      value: target.value ?? null,
      ariaPressed: target.ariaPressed ?? null,
      className: target.className ?? '',
    }
  }

  function signatureOf(snapshot: PageSnapshot): PageSignature {
    return {
      url: snapshot.url,
      title: snapshot.title,
      scrollX: snapshot.viewport.scrollX ?? 0,
      scrollY: snapshot.viewport.scrollY,
      refCount: snapshot.refs.length,
      labels: snapshot.refs.map((ref) => ref.label),
      dialogOpen: snapshot.dialogOpen,
    }
  }

  async function probeAction(index: number, expectedLabel = ''): Promise<ActionProbe> {
    return evaluateInPage<ActionProbe>(`(() => {
      /* ACTION_OUTCOME */
      const index = ${index}
      const expectedLabel = ${JSON.stringify(expectedLabel)}
      const refs = window.__bingbongRefs || []
      const el = refs[index]
      const describe = window.__bingbongDescribeElement
      const described = el && el.isConnected && typeof describe === 'function' ? describe(el) : null
      const fresh = typeof window.__bingbongPageProbe === 'function'
        ? window.__bingbongPageProbe(index, expectedLabel)
        : null
      const targetDescription = described || fresh?.target
      const target = targetDescription ? {
        checked: targetDescription.checked,
        selectedOption: targetDescription.selectedOption,
        value: targetDescription.value,
        ariaPressed: targetDescription.ariaPressed,
        className: targetDescription.className
      } : null
      const signature = fresh
        ? fresh.signature
        : {
            url: location.href,
            title: document.title,
            scrollX: window.scrollX,
            scrollY: window.scrollY,
            refCount: Math.min(refs.length, 75),
            labels: [],
            dialogOpen: false
          }
      return {
        target,
        signature
      }
    })()`)
  }

  function signaturesEqual(before: PageSignature, after: PageSignature): boolean {
    return before.url === after.url &&
      before.title === after.title &&
      before.scrollX === after.scrollX &&
      before.scrollY === after.scrollY &&
      before.refCount === after.refCount &&
      before.dialogOpen === after.dialogOpen &&
      before.labels.length === after.labels.length &&
      before.labels.every((label, index) => label === after.labels[index])
  }

  function stateDeltas(before: ElementState, after: ElementState | null): string[] {
    if (!after) return []
    const fields: { key: keyof ElementState; label: string }[] = [
      { key: 'checked', label: 'checked' },
      { key: 'selectedOption', label: 'selected' },
      { key: 'value', label: 'value' },
      { key: 'ariaPressed', label: 'aria-pressed' },
      { key: 'className', label: 'class' },
    ]
    return fields.flatMap(({ key, label }) => before[key] === after[key]
      ? []
      : [`${label}=${JSON.stringify(before[key])} -> ${JSON.stringify(after[key])}`])
  }

  function truncateOutcomeText(text: string, maxLength: number): string {
    return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`
  }

  async function scroll(direction: 'up' | 'down'): Promise<string> {
    const { viewport } = await currentSnapshot()
    const deltaY = direction === 'down' ? SCROLL_STEP_PX : -SCROLL_STEP_PX
    const x = Math.floor(viewport.width / 2)
    const y = Math.floor(viewport.height / 2)
    for (let tick = 0; tick < SCROLL_TICKS; tick++) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY })
      await settle('scroll', pacing.scrollTickMs)
    }
    // Viewport-relative rects shift with the scroll; refs must be re-read.
    lastSnapshot = undefined
    const { signature } = await probeAction(-1)
    // Zoomed pages (#53) scroll on fractional CSS pixels; the outcome line
    // keeps its integer-pixel contract.
    return `scrolled ${direction}: x=${Math.round(signature.scrollX)} y=${Math.round(signature.scrollY)}`
  }

  async function navigate(input: string): Promise<string> {
    const url = normalizeUrlInput(input)
    if (!url) throw new Error(`cannot navigate to: "${input}"`)
    await page.loadUrl(url)
    lastSnapshot = undefined
    await settle('navigate', pacing.settleMs)
    return `navigated: url=${page.url()} title=${JSON.stringify(page.title())}`
  }

  async function screenshot(): Promise<Uint8Array> {
    // q60 keeps the upload ~4x smaller for the vision model; full width is
    // retained so Locate points map cleanly to viewport coordinates (ADR 0008).
    const response = await cdp.send<ScreenshotResponse>('Page.captureScreenshot', { format: 'jpeg', quality: 60 })
    return new Uint8Array(Buffer.from(response.data, 'base64'))
  }

  async function back(): Promise<string> {
    await page.goBack()
    lastSnapshot = undefined
    await settle('back', pacing.settleMs)
    return `went back: url=${page.url()} title=${JSON.stringify(page.title())}`
  }

  async function forward(): Promise<string> {
    await page.goForward()
    lastSnapshot = undefined
    await settle('forward', pacing.settleMs)
    return `went forward: url=${page.url()} title=${JSON.stringify(page.title())}`
  }

  async function readPage(): Promise<string> {
    const first = await collectSnapshot()
    const dismissal = await dismissConsentIfOpen(first)
    const reports = drainedReports()
    const snapshot = dismissal !== null ? await recollection('post-dismissal', () => collectSnapshot()) : first
    const header = dismissal !== null ? `${dismissal}\n` : ''
    const footer = reports.length > 0 ? `\n${reports.join('\n')}` : ''
    return `${header}${formatPageSnapshot(snapshot)}${footer}`
  }

  async function resolveRef(ref: number): Promise<{ snapshot: PageSnapshot; target: SnapshotRef }> {
    if (lastSnapshot) {
      const target = findSnapshotRef(lastSnapshot, ref)
      if (target) return { snapshot: lastSnapshot, target }
    }
    const snapshot = await recollection('resolve-ref', () => collectSnapshot())
    const target = findSnapshotRef(snapshot, ref)
    if (!target) {
      throw new Error(`ref ${ref} not found — the page may have changed, run read_page to refresh refs`)
    }
    return { snapshot, target }
  }

  /** What performClick did: a real (or direct) activation, or a blocked attempt. */
  type ClickAttempt =
    | { kind: 'acted'; direct: boolean; index: number; label: string; before: ElementState; signature: PageSignature }
    | { kind: 'blocked'; signature: PageSignature; snapshot: PageSnapshot }

  async function performClick(ref: number): Promise<ClickAttempt> {
    let { snapshot, target } = await resolveRef(ref)
    const visualPoint = visualPoints.get(ref)
    if (visualPoint) {
      const index = target.ref - 1
      const reachable = await safety('visual-reach', () => evaluateInPage<boolean>(`(() => {
        const el = (window.__bingbongRefs || [])[${index}]
        if (!el || !el.isConnected) return false
        const top = document.elementFromPoint(${JSON.stringify(visualPoint.x)}, ${JSON.stringify(visualPoint.y)})
        return top === el || (top !== null && el.contains(top))
      })()`))
      if (!reachable) throw new Error(`ref ${ref} no longer resolves at the visually grounded point`)
      await dispatchPointClick(visualPoint)
      visualPoints.delete(ref)
      lastSnapshot = undefined
      return { kind: 'acted', direct: false, index, label: target.label, before: elementState(target), signature: signatureOf(snapshot) }
    }
    let index = target.ref - 1
    let prep = await safety('click-prep', () => prepClick(index))
    if (!prep.ok) {
      // The element registry died with the page (navigation); re-collect.
      const fresh = await recollection('stale-registry', () => collectSnapshot())
      const freshTarget = findSnapshotRef(fresh, ref)
      if (!freshTarget) {
        throw new Error(`ref ${ref} not found — the page may have changed, run read_page to refresh refs`)
      }
      snapshot = fresh
      target = freshTarget
      index = freshTarget.ref - 1
      prep = await safety('click-prep', () => prepClick(index))
      if (!prep.ok) {
        throw new Error(`ref ${ref} not found — the page may have changed, run read_page to refresh refs`)
      }
    }

    if (prep.clickable && typeof prep.x === 'number' && typeof prep.y === 'number') {
      await dispatchPointClick({ x: prep.x, y: prep.y })
    } else if (typeof prep.x === 'number' && typeof prep.y === 'number') {
      // An overlay covers the click point. Interception is reported to the
      // model (which can dismiss the dialog, wait, or ask the user) instead
      // of silently clicking through whatever sits on top.
      return { kind: 'blocked', signature: signatureOf(snapshot), snapshot }
    } else {
      // The element cannot be brought into the viewport at all (clipped
      // away inside its own scroller); activate it directly, Vimium-style,
      // and say so in the outcome.
      await evaluateInPage(`(() => {
        const el = (window.__bingbongRefs || [])[${index}]
        if (typeof el.focus === 'function') el.focus()
        el.click()
      })()`)
    }
    // A click can navigate (link) or mutate the page; never trust old refs.
    lastSnapshot = undefined
    return { kind: 'acted', direct: !(prep.clickable), index, label: target.label, before: elementState(target), signature: signatureOf(snapshot) }
  }

  async function click(ref: number): Promise<string> {
    const attempt = await performClick(ref)
    if (attempt.kind === 'blocked') {
      return `clicked [${ref}]: not clicked — blocked by overlay${dialogSuffix(attempt.snapshot)}${reportsSuffix(drainedReports())}`
    }
    await settle('click', pacing.settleMs)
    const after = await probeAction(attempt.index, attempt.label)
    const urlChanged = attempt.signature.url !== after.signature.url
    const dialogNowOpen = after.signature.dialogOpen
    let fresh: PageSnapshot | undefined
    if (urlChanged || dialogNowOpen) fresh = await recollection('post-action', () => collectSnapshot())
    if (urlChanged && fresh) after.signature = signatureOf(fresh)
    const deltas = stateDeltas(attempt.before, after.target)
    const pageChanged = !signaturesEqual(attempt.signature, after.signature)
    const rawChanges = deltas.length > 0 ? deltas.join(', ') : pageChanged ? 'page signature changed' : 'no observable change'
    const location = urlChanged
      ? `; url=${truncateOutcomeText(after.signature.url, 100)} title=${JSON.stringify(truncateOutcomeText(after.signature.title, 50))}`
      : ''
    const prefix = `clicked [${ref}]: urlChanged=${urlChanged} dialogOpen=${after.signature.dialogOpen}; `
    const changes = truncateOutcomeText(rawChanges, Math.min(240, Math.max(30, 300 - prefix.length - location.length)))

    // Dialog escalation: consent dialogs are dismissed deterministically
    // (Tier 1); anything else has its text surfaced for the model to decide
    // (Tier 2 — dismiss, interact, or ask_user).
    const extras: string[] = []
    if (attempt.direct) extras.push('activated directly (outside viewport)')
    if (dialogNowOpen && fresh) {
      const dismissal = await dismissConsentIfOpen(fresh)
      if (dismissal !== null) extras.push(dismissal)
      else {
        const detail = dialogDetail(fresh)
        if (detail !== null) extras.push(detail)
      }
    }
    extras.push(...drainedReports())
    const suffix = extras.length > 0 ? `; ${extras.join('; ')}` : ''
    return `${prefix}${changes}${location}${suffix}`
  }

  async function dispatchPointClick(point: ViewportPoint): Promise<void> {
    const { x, y } = point
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await settle('pointer', pacing.moveMs)
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    })
    await settle('pointer', pacing.clickMs)
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    })
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

  async function type(ref: number, text: string): Promise<string> {
    const clicked = await performClick(ref)
    if (clicked.kind === 'blocked') {
      return `typed [${ref}]: not typed — blocked by overlay${dialogSuffix(clicked.snapshot)}${reportsSuffix(drainedReports())}`
    }
    await settle('type', pacing.settleMs)
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
      await settle('keystroke', pacing.keystrokeMs)
    }
    await settle('type', pacing.settleMs)
    const after = await probeAction(clicked.index, clicked.label)
    if (!after.target) {
      return `typed [${ref}]: field unavailable after page change; url=${after.signature.url} title=${JSON.stringify(after.signature.title)}`
    }
    const value = after.target.value ?? after.target.selectedOption ?? ''
    return `typed [${ref}]: value=${JSON.stringify(value)}`
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
    await settle('press-key', pacing.settleMs)
    for (let i = 0; i < times; i++) {
      await dispatchShortcut(event)
      if (i < times - 1) await settle('keystroke', pacing.keystrokeMs)
    }
  }

  async function mediaState(): Promise<MediaState | null> {
    await settle('media-state', pacing.settleMs)
    return evaluateInPage<MediaState | null>(`(() => {
      /* MEDIA_STATE */
      const media = Array.from(document.querySelectorAll('video, audio'))
      const active = media.find((el) => !el.paused) || media[0]
      if (!active) return null
      return { paused: active.paused, currentTime: active.currentTime, volume: active.volume }
    })()`)
  }

  async function describeRef(ref: number): Promise<SnapshotRef | undefined> {
    try {
      const { target } = await resolveRef(ref)
      return target
    } catch {
      return undefined
    }
  }

  async function groundingSnapshot(): Promise<PageSnapshot> {
    return collectSnapshot()
  }

  async function refAtPoint(point: ViewportPoint): Promise<number> {
    const { x, y } = point
    const snapshot = await currentSnapshot()
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= snapshot.viewport.width || y >= snapshot.viewport.height) {
      throw new Error('vision location is outside the current viewport')
    }
    const result = await evaluateInPage<PointRefResult>(`(() => {
      const x = ${JSON.stringify(x)}
      const y = ${JSON.stringify(y)}
      const hit = document.elementFromPoint(x, y)
      if (!hit) throw new Error('no element at vision location')
      const el = hit.closest('a,area,button,input,select,textarea,video,audio,[contenteditable="true"],[role], [onclick]') || hit
      const refs = window.__bingbongRefs || []
      let index = refs.indexOf(el)
      if (index < 0) {
        index = refs.length
        refs.push(el)
        window.__bingbongRefs = refs
      }
      const describe = window.__bingbongDescribeElement
      if (typeof describe !== 'function') throw new Error('page element collector is unavailable')
      return { index, element: describe(el) }
    })()`)
    if (!result || !Number.isInteger(result.index) || result.index < 0) {
      throw new Error('vision location could not be mapped to a page element')
    }
    const parsed = parseCollectedPage({
      url: snapshot.url,
      title: snapshot.title,
      viewport: snapshot.viewport,
      elements: [result.element],
    })
    const built = buildPageSnapshot(parsed, { maxRefs: 1 }).refs[0]
    if (!built) throw new Error('element at vision location is not actionable')
    const ref = result.index + 1
    const target = { ...built, ref }
    lastSnapshot = {
      ...snapshot,
      refs: [...snapshot.refs.filter((candidate) => candidate.ref !== ref), target],
      totalVisible: Math.max(snapshot.totalVisible, ref),
    }
    visualPoints.set(ref, point)
    return ref
  }

  function state(): BrowserState {
    return { url: page.url(), title: page.title() }
  }

  // ADR 0010 classifier facts off the freshest collected snapshot — free
  // right after readPage() set lastSnapshot; recollects otherwise.
  async function pageFacts() {
    return blockerFactsFromSnapshot(await currentSnapshot())
  }

  return {
    navigate,
    readPage,
    click,
    type,
    scroll,
    screenshot,
    back,
    forward,
    pressKey,
    mediaState,
    state,
    pageFacts,
    describeRef,
    groundingSnapshot,
    refAtPoint,
  }
}
