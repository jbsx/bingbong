import type {
  BrowserController,
  BrowserState,
  KeyPress,
  MarkedScreenshot,
  MediaState,
  PageLanding,
  ScreenshotOptions,
  ViewportPoint,
  VisualGroundingController,
} from '../../core/ports/browser'
import { settledStateFromSnapshot, type SettledPageState } from '../../core/browser/pageFingerprints'
import { systemClock, withDeadline, type Clock } from '../../core/ports/clock'
import { blockerFactsFromSnapshot } from '../../core/browser/blockerNudge'
import type { Mark } from '../../core/browser/marks'
import type { BrowserSubspans } from '../../core/perf/browserSubspans'
import { normalizeUrlInput } from '../../core/browser/urlInput'
import {
  ARRIVED_CLAUSE,
  blockedActionHead,
  clickFlagsHead,
  mediaOpHead,
  scrollOpHead,
  menuFlagsHead,
  NO_OBSERVABLE_CHANGE,
  PAGE_NOT_READ,
  PAGE_SIGNATURE_CHANGED,
  STATE_DELTA,
  UNFINISHED_LOAD_CLAUSE,
  type BlockedAction,
  type CoverProbe,
  type RefAction,
} from '../../core/browser/actionOutcome'
import { chooseConsentDismissal, consentAcceptOf, consentDismissalLine, consentRejectOf, consentRetryNote, isConsentDialog, type ConsentChooser } from '../../core/browser/dialogPolicy'
import {
  buildPageSnapshot,
  coverOf,
  findSnapshotRef,
  formatPageRead,
  formatPageSnapshot,
  linkHrefsOf,
  pageReadPartCount,
  parseCollectedPage,
  parsePageLinks,
  parseMediaFacts,
  parseRegionFacts,
  type CollectedPage,
  type PageLink,
  type PageSnapshot,
  type SnapshotRef,
} from '../../core/browser/snapshot'
import type { MediaOpAction } from '../../core/browser/mediaOp'
import { notchesFor, regionChangeOf, SCROLL_END_OF_REGION, type ScrollExtent } from '../../core/browser/scrollOp'
import { mediaChangesOf } from '../../core/command/mediaOp'
import { MEDIA_FACTS_FN } from './pageMediaScript'
import { SCROLL_END_OF_PAGE, formatNewInView } from '../../core/browser/scrollDelta'
import { authPopupOpenedLine, formatOpenAddress, judgeWindowOpens, LINK_SELECTOR, NEW_WINDOW_FOLLOWED_CLAUSE, popupBlockedLine } from '../../core/browser/newWindowLink'
import {
  clearFocusedScript,
  blurFocusedFieldScript,
  clickPrepScript,
  flashRefScript,
  markShownAtScript,
  markShownRefsScript,
  overlayShownRefsScript,
  readinessArmScript,
  readinessWaitScript,
  scrollSettledScript,
  refIsShownScript,
  type ClickPrep,
  type CoverNaming,
  frameBoxScript,
  OWN_SLOT_SCRIPT,
} from './collectPageScript'
import { readRefStates } from './readRefStates'
import { mergeFrames, type CollectedFrame, type FrameAddress } from '../../core/browser/frames'
import { reportFault } from '../../core/trace/fault'

// Minimal CDP surface the controller needs, so tests can drive it with a fake
// and the Electron glue (webContents.debugger) stays a thin adapter.
export interface CdpDebugger {
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>
  /** Subscribe to a CDP domain event (e.g. Page.javascriptDialogOpening). */
  on?(event: string, handler: (params: unknown) => void): void
}

/**
 * One frame below the top document (#377, ADR 0081), reached in its own
 * context: Electron's `WebFrameMain` in the app, an auto-attached target
 * in a test. `key` names this frame for as long as it holds its document's
 * process; `parentKey` is its parent's, null when its parent is the top.
 */
export interface PageFrame {
  readonly key: string
  readonly parentKey: string | null
  /** One evaluation in the frame, a promise awaited; rejects when the frame is gone. */
  evaluate<T>(expression: string): Promise<T>
}

/** Every frame below the top document, at any depth, from any site (#377). */
export interface PageFrames {
  list(): readonly PageFrame[]
}

/**
 * How long a collect waits for its frames after the top document has
 * answered (#377, ADR 0081: 50 ms to start, set by measurement): a frame
 * that has not answered by then stays its opaque iframe for that read, so
 * no frame ever holds up the read.
 */
export const FRAME_GRACE_MS = 50

/**
 * What an action's watch saw of the page it left for (#309, ADR 0027): no
 * main-frame navigation to another document, one whose load finished, or
 * one whose load had not finished when the bounded wait for it ended — an
 * Unfinished Load.
 */
export type PageArrival = 'none' | 'loaded' | 'unfinished'

/** Taken before an action; asked after it whether the action left for another document, and waits for that load. */
export interface ArrivalWatch {
  arrival(): Promise<PageArrival>
}

// Page-level operations the pane already knows how to do (load, history, url).
export interface CdpPageDriver {
  /** Sends the tab to the address; resolves at its landing (#328), or at the load's end for a driver that cannot see one. */
  loadUrl(url: string): Promise<PageLanding | void>
  goBack(): Promise<void>
  goForward(): Promise<void>
  /** Load the page again (#328), resolved at its commit. */
  reload(): Promise<void>
  /**
   * Resolves once the page may be touched (#330): at once when no
   * navigation is under way, else at its landing or the tab stopping;
   * rejects with the reason when it never commits. Optional: a driver
   * that cannot see navigations touches the page as it stands.
   */
  untilLanded?(): Promise<void>
  /** Stops the tab's load where it stands (#330). Optional: a driver without one leaves the load running. */
  stop?(): void
  /**
   * Starts watching for a main-frame navigation to another document (#309).
   * Optional: a driver that cannot see navigations start leaves every
   * action to its fixed settle.
   */
  watchArrival?(): ArrivalWatch
  url(): string
  title(): string
  /**
   * HTTP status of the top-level response the tab is on (#239, ADR 0050);
   * null when unknown. Optional: a driver that cannot see responses leaves
   * the Not-found classification to the title.
   */
  status?(): number | null
  /** Makes the page the focused webContents — synthetic keys are dropped otherwise. */
  focus(): void
  /**
   * Hears every main-frame commit from now until the returned release is
   * called (#324): the moment a navigate, a back or a forward has visibly
   * left — the Reaction's first observable effect. Optional: a driver that
   * cannot see commits leaves the effect to the load's end.
   */
  onNavigationCommitted?(listener: () => void): () => void
}

/**
 * An action's first observable effect (#324, ADR 0076): what closes the
 * Reaction span. A DOM mutation or an input event the action caused, the
 * page scrolling, or the document going — a navigation committed.
 */
export type ActionEffect = 'mutation' | 'input' | 'scroll' | 'navigation'

/** Where the controller reports an action's first observable effect, the moment it sees it. */
export interface ActionEffects {
  observed(effect: ActionEffect): void
  /** A navigation's landing ended (#328): quiet, at its load, or at the cap. */
  landed?(landing: PageLanding): void
}

/**
 * The most the post-action wait may cost (#324, ADR 0076): the page is
 * watched for the action's first effect — a mutation, an input, a scroll,
 * the document leaving — and the wait ends at that effect or at this cap,
 * whichever is first. No pacing sleep remains: every delay the controller
 * had (`HUMAN_PACING`: 300 ms settles, 60/90 ms pointer gaps, 45 ms per
 * keystroke, 70 ms per scroll tick) is gone, and text is inserted whole.
 */
export const READINESS_CAP_MS = 150

/**
 * A landing (#328, ADR 0076 amendment) is the page gone DOM-quiet, not the
 * load event: from a navigation's commit, `dom-ready` and then this long
 * with no mutation in the main document — or the load event, if it comes
 * first. One wait for navigate, back, forward, reload and a click that
 * leaves the page; in-page actions keep {@link READINESS_CAP_MS}.
 */
export const LANDING_QUIET_MS = 250

/** The most a landing waits from its commit (#328): the page is taken as it stands then, and the landing is `capped`. */
export const LANDING_CAP_MS = 3_000

/** The poll between reads of a tab still landing after an aborted load (#308) — a wait on the tab, not pacing. */
const STILL_POLL_MS = 100

/**
 * The most a consent dismissal waits, after its click, for the sheet to
 * leave the page (post mortem 2026-10-19): Truth Social's TCF sheet closed
 * with an animation that outlasted the readiness wait's first mutation, so
 * the recollection still carried it and a Task was read over a wall that
 * was already going. Polled in place at {@link STILL_POLL_MS}.
 */
export const DISMISSAL_GONE_MS = 1_000

/**
 * The most the Mark Ask's capture may take (#382, ADR 0084): the rects
 * read again, the capture and the painting. A capture runs well under a
 * tenth of this; past it the pane is taken as giving none.
 */
export const MARK_CAPTURE_CAP_MS = 1_500

export interface CdpBrowserControllerDeps {
  cdp: CdpDebugger
  page: CdpPageDriver
  collectScript: string
  /** The clock the readiness cap and the landing poll run on; tests fake it. */
  clock?: Clock
  /** Hears each action's first observable effect (#324); absent, nothing is reported. */
  effects?: ActionEffects
  /** Drains popup-block URLs the pane recorded (window.open denied + closed). */
  consumePopupBlocks?: () => string[]
  /**
   * Drains auth-popup URLs the pane queued and opens their windows (ADR
   * 0018) — called at outcome time, when no input command is in flight, so
   * window creation never wedges the debugger channel. The returned URLs
   * ride the outcome line so the model knows where the sign-in went.
   */
  consumeAuthPopupOpens?: () => string[]
  /**
   * Holds the pane's denied opens for this controller until the returned
   * release is called (#299, ADR 0073): a click, a type or a key press is
   * in flight, and an open it causes is the model's. A click judges
   * whether the open is the clicked link's, against the ref. Outside a
   * hold the pane judges an open as the user's own press.
   */
  holdWindowOpens?: () => () => void
  /**
   * Holds the appliance's own right-click menu back until the returned
   * release is called (#363, ADR 0079): a right-click the controller
   * dispatches opens the page's menu, never Electron's native one.
   */
  holdContextMenu?: () => () => void
  /**
   * Verbose sub-span channel (#32): when provided (and the env flag enabled
   * it), the deliberate delays and extra round-trips inside browser actions
   * become sub-spans keyed by the turn scope the pipeline's tool gate opens.
   * Absent — no sub-spans, actions behave identically.
   */
  subspans?: BrowserSubspans
  /**
   * Finds a consent wall's reject when the rule reads none as declining
   * (owner's rule 2026-10-19): Jev, over the wall's controls. Absent, or
   * answering null, the privacy-first policy accepts as before.
   */
  chooseConsent?: ConsentChooser
  /** The frames below the top document (#377, ADR 0081); absent, the page is the top document alone. */
  frames?: PageFrames
  /**
   * Paints the Mark Ask's marks on a PNG capture and encodes it as a JPEG
   * (#382, ADR 0084); null when it cannot. Absent, no marked screenshot is
   * made, and so no Mark Ask.
   */
  drawMarks?: (png: Uint8Array, marks: readonly Mark[], cell: number) => Uint8Array | null
}

interface EvaluateResponse {
  result?: { value?: unknown }
  /** `text` is the bare `Uncaught`; the thrown value's own description rides on `exception` (#308). */
  exceptionDetails?: { text: string; exception?: { description?: string } }
}

interface ScreenshotResponse {
  data: string
}

/** A rect as getBoundingClientRect gives it, in the CSS pixels of the document it was read in. */
interface CssRect {
  x: number
  y: number
  width: number
  height: number
}

/** A PNG's width, from its IHDR chunk: the four bytes after the signature, the chunk length and its type. */
function pngWidth(png: Uint8Array): number {
  return png.length < 24 ? 0 : new DataView(png.buffer, png.byteOffset, png.byteLength).getUint32(16)
}

/** Each of these registry elements' rect now, null for one gone. */
function markRectsScript(indices: readonly number[]): string {
  return `(() => {
    /* MARK_RECTS */
    const refs = window.__bingbongRefs || []
    return ${JSON.stringify(indices)}.map((index) => {
      const el = refs[index]
      if (!el || !el.isConnected) return null
      const box = el.getBoundingClientRect()
      return { x: box.left, y: box.top, width: box.width, height: box.height }
    })
  })()`
}

/**
 * The one viewport of Page.getLayoutMetrics a region clip needs: position
 * on the page and size. The protocol marks `visualViewport` deprecated in
 * favour of `cssVisualViewport`, but the two differ by the page zoom
 * factor, and a capture clip is in the deprecated field's units
 * (device-independent pixels): the #195 probe ran with the pane at zoom
 * 1.3 and the clip computed from this field landed exactly where the
 * math said, which the CSS-pixel field would have missed by 30%.
 */
interface LayoutMetricsResponse {
  visualViewport: { pageX: number; pageY: number; clientWidth: number; clientHeight: number }
}

/** A Page.captureScreenshot clip: a page-coordinate rectangle and the scale it is rasterized at. */
interface ScreenshotClip {
  x: number
  y: number
  width: number
  height: number
  scale: number
}

/** The mouse button a ref action presses: left for a click, right for a menu (#363). */
type MouseButton = 'left' | 'right'

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
  /** The media element's flags (#363): a Loop ticked in a right-click menu changes nothing else. Null or absent with none; its time is left out, as it runs on by itself. */
  media?: MediaFlags | null
}

/** The flags of a media element a control can toggle (#363). */
interface MediaFlags {
  paused: boolean
  loop: boolean
  muted: boolean
}

interface ActionProbe {
  target: ElementState | null
  signature: PageSignature
}

interface PointRefResult {
  index: number
  element: import('../../core/browser/snapshot').CollectedElement
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

// Chromium's net code for a load aborted mid-flight — most commonly the
// site re-navigating the tab itself (Google's consent jump, Reddit's
// challenge reload) while the requested load was still pending (#79).
// Electron rejects loadURL with the code on the message and/or as `code`.
const ABORT_ERROR_CODE = 'ERR_ABORTED'

// How many settle intervals a recovered landing may take to stop moving
// before the outcome reports whatever page is current anyway.
const ABORT_SETTLE_POLLS = 50

/** The verb a landing's outcome line opens with: a navigate, or a step through history. */
type LandingVerb = 'navigated' | 'went back' | 'went forward' | 'reloaded'

function isAbortedLoad(error: unknown): boolean {
  if ((error as { code?: unknown } | null)?.code === ABORT_ERROR_CODE) return true
  return error instanceof Error && error.message.includes(ABORT_ERROR_CODE)
}

/**
 * ADR 0033: the number no longer names the element the model was shown, so
 * the action is refused rather than aimed at whatever now sits there.
 * `page` is the page as it stood at the moment of refusal — the caller that
 * hands the refusal to the model hands these numbers over with it, so the
 * next decision happens in the same round. Null only when even that collect
 * failed.
 */
class StaleRefError extends Error {
  constructor(readonly ref: number, readonly page: PageSnapshot | null) {
    super(
      `ref ${ref} refused: it no longer names the element you were shown` +
        (page === null ? '; the page could not be re-read' : '. Continue from the page below'),
    )
    this.name = 'StaleRefError'
  }
}

export function createCdpBrowserController(deps: CdpBrowserControllerDeps): BrowserController & VisualGroundingController {
  const { cdp, page, collectScript } = deps
  const clock = deps.clock ?? systemClock
  const subspans = deps.subspans
  let lastSnapshot: PageSnapshot | undefined
  const visualPoints = new Map<number, ViewportPoint>()
  // Where each element of the last collect lives (#377): its frame and its
  // index in that frame's registry, element for element — so a ref, its
  // number less one, has an address. The shown addresses are those of the
  // numbers last handed to the model (ADR 0033): a number resolves only
  // while it names the same address it was shown at.
  let addresses: readonly FrameAddress[] = []
  let shownAddresses: (FrameAddress | undefined)[] = []
  // Each frame's own slot in its parent's `window.frames`, from the last collect: what its iframe is found by.
  let frameSlots = new Map<string, { parentKey: string | null; slot: number }>()
  // The frames whose registries hold shown numbers: a marking that leaves one out empties it, as the top's empties past its count.
  let markedFrames = new Set<string>()

  // Verbose sub-span instrumentation (#32). Timing-only wrappers: the wait,
  // collect, or probe always runs exactly as before; a channel is present
  // only when main wired one, and emission inside it is gated by the env
  // flag and the pipeline's open turn scope.

  /** A wait on the clock — the landing poll's only; one `browser-settle` sub-span when verbose. */
  async function settle(action: string, ms: number): Promise<void> {
    const start = subspans?.now()
    await new Promise<void>((resolve) => clock.setTimer(ms, resolve))
    if (subspans !== undefined && start !== undefined) subspans.emit('browser-settle', subspans.now() - start, { action, ms })
  }

  /**
   * Arm the page's readiness watch before an action sends it input (#324):
   * from here the page records its first mutation, input event or scroll.
   * A page that cannot be armed is waited for by the cap alone.
   */
  async function armReadiness(frame: string | null = null): Promise<void> {
    try {
      await evaluateInPage(readinessArmScript())
    } catch (error) {
      reportFault('browser.createCdpBrowserController.armReadiness', error)
    }
    // An action on a frame's element (#377) acts in that frame: its watch is armed there too.
    if (frame !== null) await evaluateInFrame(frame, readinessArmScript()).catch((error: unknown) => reportFault('browser.createCdpBrowserController.armReadiness.frame', error))
  }

  /** What the armed watch saw: an effect, the cap, or no watch at all — the document went. */
  async function readinessOutcome(frame: string | null = null): Promise<ActionEffect | 'timeout'> {
    if (frame !== null) return Promise.race([readinessOutcome(null), frameEffect(frame)])
    try {
      const outcome = await evaluateInPage<unknown>(readinessWaitScript(READINESS_CAP_MS), { awaitPromise: true, duringAction: true })
      if (outcome === 'mutation' || outcome === 'input' || outcome === 'scroll' || outcome === 'timeout') return outcome
      return 'navigation'
    } catch (error) {
      // The context the watch lived in is gone: the action left the page.
      reportFault('browser.createCdpBrowserController.readinessOutcome', error)
      return 'navigation'
    }
  }

  /** The first effect the watch armed in a frame saw (#377); never answers for a cap or a frame gone, which the top's own wait ends. */
  async function frameEffect(frame: string): Promise<ActionEffect> {
    try {
      const outcome = await evaluateInFrame<unknown>(frame, readinessWaitScript(READINESS_CAP_MS))
      if (outcome === 'mutation' || outcome === 'input' || outcome === 'scroll') return outcome
    } catch (error) {
      // The frame went: the top's watch tells what that did.
      reportFault('browser.createCdpBrowserController.frameEffect', error)
    }
    return new Promise<ActionEffect>(() => {})
  }

  /**
   * The post-action wait (#324, ADR 0076): the action's first observable
   * effect, or the cap — never a fixed sleep. The effect is reported the
   * moment it is seen, so the Reaction span closes on it. One
   * `browser-ready` sub-span when verbose.
   */
  async function awaitReadiness(action: string, frame: string | null = null): Promise<ActionEffect | 'timeout'> {
    const start = subspans?.now()
    const outcome = (await withDeadline(readinessOutcome(frame), clock, READINESS_CAP_MS)) ?? 'timeout'
    if (subspans !== undefined && start !== undefined) subspans.emit('browser-ready', subspans.now() - start, { action, outcome })
    if (outcome !== 'timeout') deps.effects?.observed(outcome)
    return outcome
  }

  /** Hear the next main-frame commit as the action's first effect (#324); released when the action's wait ends. */
  function observingCommits(): () => void {
    return page.onNavigationCommitted?.(() => deps.effects?.observed('navigation')) ?? (() => {})
  }

  /**
   * #309, ADR 0027: the wait after an action that sends input. The
   * readiness wait (#324) in place of the fixed settle it had; then, when
   * the action started a main-frame navigation to another document, that
   * document's load, bounded — an Unfinished Load when the bound ends it.
   * Content is not waited for, and a change of address inside one document
   * is no arrival.
   */
  async function settleArrival(action: string, watch: ArrivalWatch | undefined, frame: string | null = null): Promise<PageArrival> {
    await awaitReadiness(action, frame)
    const arrival = watch === undefined ? 'none' : await watch.arrival()
    if (arrival !== 'none') lastSnapshot = undefined
    return arrival
  }

  /** The clause an Unfinished Load rides its outcome line with; empty for any other arrival. */
  function unfinishedClause(arrival: PageArrival): string {
    return arrival === 'unfinished' ? `; ${UNFINISHED_LOAD_CLAUSE}` : ''
  }

  /** The clauses a click or a type that arrived at another document rides its outcome line with. */
  function arrivalClauses(arrival: PageArrival): string {
    return arrival === 'none' ? '' : `; ${ARRIVED_CLAUSE}${unfinishedClause(arrival)}`
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

  // The opens a click judged and denied (#299), waiting for the outcome
  // line that reports them.
  const judgedDenied: string[] = []

  /** Popup blocks, auth-popup opens, and native dialog reports since the last outcome line. */
  function drainedReports(): string[] {
    const authPopupOpens = deps.consumeAuthPopupOpens?.() ?? []
    const reports = [
      ...authPopupOpens.map(authPopupOpenedLine),
      ...[...judgedDenied.splice(0), ...(deps.consumePopupBlocks?.() ?? [])].map(popupBlockedLine),
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
    // Privacy first (ADR 0061): the rule's reject, else the one Jev finds declining, else the accept.
    const choice = consentRejectOf(labels) ?? (await chosenConsent(snapshot.dialogText, labels)) ?? consentAcceptOf(labels)
    if (choice === null) return null
    const target = controls[choice]
    const at = addressOfRef(target.ref)
    await armReadiness()
    const clicked = await evaluateInFrame<boolean>(at.frame, `(() => {
      const el = (window.__bingbongRefs || [])[${at.index}]
      if (!el || !el.isConnected) return false
      if (typeof el.focus === 'function') el.focus()
      el.click()
      return true
    })()`)
    lastSnapshot = undefined
    await awaitReadiness('consent-dismiss')
    if (clicked) await awaitDialogGone()
    return clicked ? consentDismissalLine(target.ref, truncateOutcomeText(target.label, 60)) : null
  }

  /** The control Jev finds declining the wall's optional cookies; null when it finds none, or none is wired. */
  async function chosenConsent(dialogText: string, labels: readonly string[]): Promise<number | null> {
    if (deps.chooseConsent === undefined) return null
    try {
      return await deps.chooseConsent(dialogText, labels)
    } catch (error) {
      reportFault('browser.createCdpBrowserController.chooseConsent', error)
      return null
    }
  }

  /** Wait, bounded by {@link DISMISSAL_GONE_MS}, until no dialog root is open: the dismissed sheet has left, and a recollection reads the page behind it. */
  async function awaitDialogGone(): Promise<void> {
    for (let waited = 0; waited < DISMISSAL_GONE_MS; waited += STILL_POLL_MS) {
      if (!(await dialogOpenInPlace())) return
      await settle('consent-gone', STILL_POLL_MS)
    }
  }

  /** Whether a dialog root is open, read in place; a page that cannot be asked is taken as clear. */
  async function dialogOpenInPlace(): Promise<boolean> {
    try {
      return (await evaluateInPage<unknown>(`(() => typeof window.__bingbongDialogOpen === 'function' ? window.__bingbongDialogOpen() : false)()`)) === true
    } catch (error) {
      reportFault('browser.createCdpBrowserController.dialogOpenInPlace', error)
      return false
    }
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

  /** The collect with each ref's Ref State, or as it was when the tree cannot be read. */
  async function withRefStates(page: CollectedPage): Promise<CollectedPage> {
    try {
      // The tree is read over the top document's session: a frame's refs keep no Ref State (#377).
      return await readRefStates(cdp, page, (index) => (addresses[index]?.frame === null ? addresses[index].index : null))
    } catch (error) {
      reportFault('browser.createCdpBrowserController.refStates', error)
      return page
    }
  }

  /**
   * Start reading every frame below the top (#377, ADR 0081), each in its
   * own context, all at once; the returned wait hands over those that have
   * answered by the grace after it is called. A frame that throws, or
   * answers what is no page, is a frame not read.
   */
  function fanOut<T>(read: (frame: PageFrame) => Promise<T>): { listed: number; answered: () => Promise<T[]> } {
    let listed: readonly PageFrame[] = []
    try {
      listed = deps.frames?.list() ?? []
    } catch (error) {
      reportFault('browser.createCdpBrowserController.listFrames', error)
    }
    const answers: T[] = []
    const all = Promise.all(
      listed.map(async (frame) => {
        try {
          answers.push(await read(frame))
        } catch (error) {
          // A frame gone, still loading, or holding no page: it has no answer, and a collect leaves it its opaque iframe.
          reportFault('browser.createCdpBrowserController.frameAnswer', error)
        }
      }),
    )
    return {
      listed: listed.length,
      async answered() {
        if (listed.length > 0) await Promise.race([all, new Promise<void>((resolve) => clock.setTimer(FRAME_GRACE_MS, resolve))])
        return [...answers]
      },
    }
  }

  /** Every frame's own collect, started now (#377). */
  function readFrames(): { listed: number; answered: () => Promise<CollectedFrame[]> } {
    return fanOut(async (frame) => ({ key: frame.key, parentKey: frame.parentKey, page: parseCollectedPage(await frame.evaluate<unknown>(collectScript)) }))
  }

  async function collectSnapshot(): Promise<PageSnapshot> {
    const start = subspans?.now()
    // The frames are read beside the top, never after it (ADR 0081), once a navigation under way has landed.
    await page.untilLanded?.()
    const frames = readFrames()
    const top = parseCollectedPage(await evaluateInPage<unknown>(collectScript))
    const answered = await frames.answered()
    const merged = mergeFrames(top, answered, addresses)
    addresses = merged.addresses
    frameSlots = new Map(answered.map((frame) => [frame.key, { parentKey: frame.parentKey, slot: frame.page.frameIndex ?? -1 }]))
    const snapshot = buildPageSnapshot(await withRefStates(merged.page))
    // Every collect, timed (#377): what the frames' fan-out costs is read off these.
    if (subspans !== undefined && start !== undefined) subspans.emit('browser-collect', subspans.now() - start, { refs: snapshot.refs.length, frames: answered.length, unread: frames.listed - answered.length })
    visualPoints.clear()
    lastSnapshot = snapshot
    return snapshot
  }

  /**
   * One evaluation in the page. A navigation under way is waited for first
   * (#330): sent now, the evaluation would be held until its commit and then
   * run on a document not yet parsed. `duringAction` is the readiness watch
   * an action itself started, which hears the navigation it caused and must
   * not wait on it.
   */
  async function evaluateInPage<T>(expression: string, options?: { awaitPromise?: boolean; duringAction?: boolean }): Promise<T> {
    if (options?.duringAction !== true) await page.untilLanded?.()
    const response = await cdp.send<EvaluateResponse>('Runtime.evaluate', {
      expression,
      returnByValue: true,
      ...(options?.awaitPromise ? { awaitPromise: true } : {}),
    })
    if (response.exceptionDetails) {
      const { text, exception } = response.exceptionDetails
      const description = exception?.description
      throw new Error(`page evaluation failed: ${description === undefined ? text : `${text} ${description}`}`)
    }
    return (response.result?.value ?? undefined) as T
  }

  /**
   * One evaluation in a frame (#377): the top document's (null) over CDP,
   * a frame's in its own context. A frame no longer listed — gone, or
   * navigated to another process — throws, as a stale ref is refused.
   */
  async function evaluateInFrame<T>(frame: string | null, expression: string, options?: { awaitPromise?: boolean; duringAction?: boolean }): Promise<T> {
    if (frame === null) return evaluateInPage<T>(expression, options)
    const found = deps.frames?.list().find((candidate) => candidate.key === frame)
    if (found === undefined) throw new Error(`the frame ${frame} is gone`)
    return (await found.evaluate<T>(expression)) ?? (undefined as T)
  }

  /** The address a number names in the last collect; a number past it, the top document's index as it always was. */
  function addressOfRef(ref: number): FrameAddress {
    return addresses[ref - 1] ?? { frame: null, index: ref - 1 }
  }

  /** These addresses' indices, grouped by their frame, the top's first. */
  function byFrame(at: readonly FrameAddress[]): Map<string | null, number[]> {
    const groups = new Map<string | null, number[]>([[null, []]])
    for (const address of at) groups.set(address.frame, [...(groups.get(address.frame) ?? []), address.index])
    return groups
  }

  async function currentSnapshot(): Promise<PageSnapshot> {
    return lastSnapshot ?? recollection('no-snapshot', () => collectSnapshot())
  }

  /**
   * The shown registry (ADR 0033): the node behind each number the model was
   * last shown. Replaced wherever a whole numbering goes to the model — a
   * page read, the settled page an Action Outcome carries, the page a
   * refusal carries. A marking that fails leaves the previous registry
   * standing, which refuses the next ref instead of mis-aiming it.
   */
  async function markShown(count: number): Promise<void> {
    shownAddresses = Array.from({ length: count }, (_, index) => addressOfRef(index + 1))
    const groups = byFrame(shownAddresses.filter((address): address is FrameAddress => address !== undefined))
    for (const frame of markedFrames) if (!groups.has(frame)) groups.set(frame, [])
    markedFrames = new Set([...groups.keys()].filter((frame): frame is string => frame !== null && (groups.get(frame)?.length ?? 0) > 0))
    // Each frame marks its own registry (#377); the top's numbers from one up are its own first `count`.
    await Promise.all(
      [...groups].map(async ([frame, indices]) => {
        const leading = frame === null && indices.every((index, position) => index === position)
        try {
          await evaluateInFrame(frame, leading ? markShownRefsScript(indices.length) : markShownAtScript(indices))
        } catch (error) {
          reportFault('browser.createCdpBrowserController.markShown', error)
        }
      }),
    )
  }

  /** Overlay just these numbers: a scroll prints only the refs that entered
   * view, so every other number keeps the node it was shown as. */
  async function overlayShown(refs: number[]): Promise<void> {
    if (refs.length === 0) return
    const at = refs.map(addressOfRef)
    refs.forEach((ref, position) => {
      shownAddresses[ref - 1] = at[position]
    })
    for (const address of at) if (address.frame !== null) markedFrames.add(address.frame)
    await Promise.all(
      [...byFrame(at)].filter(([, indices]) => indices.length > 0).map(async ([frame, indices]) => {
        try {
          await evaluateInFrame(frame, overlayShownRefsScript(indices))
        } catch (error) {
          reportFault('browser.createCdpBrowserController.overlayShown', error)
        }
      }),
    )
  }

  /** Is this number still the element it was shown as? A number with no
   * shown node — past what a read printed, or a guess — answers false. */
  async function refIsShown(ref: number): Promise<boolean> {
    const at = addressOfRef(ref)
    const shown = shownAddresses[ref - 1]
    // The number now names another frame's element, or another place, than it was shown at (#377).
    if (shown !== undefined && (shown.frame !== at.frame || shown.index !== at.index)) return false
    try {
      return (await evaluateInFrame<boolean>(at.frame, refIsShownScript(at.index))) === true
    } catch (error) {
      reportFault('browser.createCdpBrowserController.refIsShown', error)
      return false
    }
  }

  /**
   * ADR 0027 Action Outcomes: append the settled page state — signature,
   * numbered refs, digest — to a page-changing action's outcome line. The
   * collected snapshot becomes the latest valid snapshot, so the model can
   * continue from these refs without a follow-up read_page. A caller that
   * already collected (post-action, post-dismissal) passes that snapshot.
   * A collector hiccup must not fail an action that succeeded: the outcome
   * degrades to its concise first line.
   */
  async function withSettledState(line: string, collected?: PageSnapshot): Promise<string> {
    try {
      const snapshot = collected ?? (await recollection('settled-state', () => collectSnapshot()))
      const formatted = formatPageSnapshot(snapshot)
      // These numbers are now the ones the model holds (ADR 0033).
      await markShown(snapshot.refs.length)
      return `${line}\n${formatted}`
    } catch (error) {
      reportFault('browser.createCdpBrowserController.withSettledState', error)
      return line
    }
  }

  const SCROLL_TICKS = 3
  /** Blur an editable element, or a frame, holding the page's focus (#383), so an End or Home key reaches the scroller. */
  const BLUR_FOCUSED_FIELD_JS = `(() => {
    const el = document.activeElement
    if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'IFRAME'].includes(el.tagName))) el.blur()
    return true
  })()`
  /** How long no scroll event says an Extent's page scroll has stopped (#383), and how long it is waited for at most. */
  const SCROLL_STILL_MS = 150
  const SCROLL_SETTLE_CAP_MS = 1000
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

  /** A ref's label as the page's own script reads it: empty for one the browser named (#382, ADR 0084). */
  function pageLabelOf(ref: SnapshotRef): string {
    return ref.named === true ? '' : ref.label
  }

  function signatureOf(snapshot: PageSnapshot): PageSignature {
    return {
      url: snapshot.url,
      title: snapshot.title,
      scrollX: snapshot.viewport.scrollX ?? 0,
      scrollY: snapshot.viewport.scrollY,
      refCount: snapshot.refs.length,
      // The page's own script reads a label from the tree as empty (#382), as the probe it is compared with does.
      labels: snapshot.refs.map(pageLabelOf),
      dialogOpen: snapshot.dialogOpen,
      media: snapshot.media != null ? { paused: snapshot.media.paused, loop: snapshot.media.loop, muted: snapshot.media.muted } : null,
    }
  }

  /** Whether two reads show the media element's flags the same (#363); a page with none matches only one with none, absent and null alike. */
  function mediaFlagsEqual(before: MediaFlags | null | undefined, after: MediaFlags | null | undefined): boolean {
    if (before == null || after == null) return (before ?? null) === (after ?? null)
    return before.paused === after.paused && before.loop === after.loop && before.muted === after.muted
  }

  /**
   * The target's state and the page's signature, read in place. A target in
   * a frame (#377) is read in its frame, and its frame's refs join the top
   * document's in the signature, so what the action did there is a change.
   */
  async function probeAction(at: FrameAddress | null, expectedLabel = ''): Promise<ActionProbe> {
    if (at === null || at.frame === null) return probeInFrame(null, at?.index ?? -1, expectedLabel)
    const [top, framed] = await Promise.all([probeInFrame(null, -1), probeInFrame(at.frame, at.index, expectedLabel)])
    return {
      target: framed.target,
      signature: {
        ...top.signature,
        refCount: top.signature.refCount + framed.signature.refCount,
        labels: [...top.signature.labels, ...framed.signature.labels],
        media: framed.signature.media ?? top.signature.media ?? null,
      },
    }
  }

  async function probeInFrame(frame: string | null, index: number, expectedLabel = ''): Promise<ActionProbe> {
    return evaluateInFrame<ActionProbe>(frame, `(() => {
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
            dialogOpen: false,
            media: null
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
      mediaFlagsEqual(before.media, after.media) &&
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
      : [`${label}=${JSON.stringify(before[key])}${STATE_DELTA}${JSON.stringify(after[key])}`])
  }

  /** #133 honest verification: a click on a state-bearing control (checkbox,
   * radio, select) names the control's post-action state even when the click
   * did not change it — a wrong-element or ineffective click must surface as
   * `checked=false`, never as a bare "no observable change". Deltas already
   * carry changed fields, so only unchanged ones get the absolute clause. */
  function unchangedControlState(before: ElementState, after: ElementState | null): string[] {
    if (!after) return []
    const clauses: string[] = []
    if (before.checked === after.checked && (before.checked !== null || after.checked !== null)) {
      clauses.push(`checked=${after.checked}`)
    }
    if (
      before.selectedOption === after.selectedOption &&
      (before.selectedOption !== null || after.selectedOption !== null)
    ) {
      clauses.push(`selected=${JSON.stringify(after.selectedOption)}`)
    }
    return clauses
  }

  function truncateOutcomeText(text: string, maxLength: number): string {
    return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`
  }

  /** The landing identity a page-changing action's outcome names:
   * `url=<url> title="<title>"`, capped like every other outcome text. */
  function urlTitleSuffix(signature: PageSignature): string {
    return `url=${truncateOutcomeText(signature.url, 100)} title=${JSON.stringify(truncateOutcomeText(signature.title, 50))}`
  }

  /** Zoomed pages (#53) scroll on fractional CSS pixels; the outcome line
   * keeps its integer-pixel contract. */
  function scrollHeader(direction: 'up' | 'down', scrollX: number, scrollY: number): string {
    return `scrolled ${direction}: x=${Math.round(scrollX)} y=${Math.round(scrollY)}`
  }

  /**
   * Scroll, then say what scrolled in (#194). The position alone left the
   * model blind — it had to spend a whole round on read_page to see the
   * new viewport — so the outcome carries the refs and text that entered
   * it, and `end of page` when nothing did.
   */
  async function scroll(direction: 'up' | 'down', extent?: ScrollExtent): Promise<string> {
    const before = await currentSnapshot()
    const deltaY = direction === 'down' ? SCROLL_STEP_PX : -SCROLL_STEP_PX
    const x = Math.floor(before.viewport.width / 2)
    const y = Math.floor(before.viewport.height / 2)
    await armReadiness()
    if (extent !== undefined && extent.screens === undefined) {
      // All the way (#383, ADR 0085): the browser's own End or Home key, which reaches the document's scroller — or, in an app shell whose body does not scroll, the focused region.
      page.focus()
      // A field or a frame holding the focus would take the key for its own (a caret to the line's end): the page is given it back.
      await evaluateInPage(BLUR_FOCUSED_FIELD_JS).catch((error: unknown) => reportFault('browser.createCdpBrowserController.blurForEnd', error))
      await dispatchShortcut(shortcutEventFor({ key: direction === 'down' ? 'End' : 'Home' }))
    } else {
      // The Extent's screens in wheel notches (#383); the grammar's line, with none, its fixed three.
      const ticks = extent?.screens !== undefined ? notchesFor(extent.screens, before.viewport.height) : SCROLL_TICKS
      for (let tick = 0; tick < ticks; tick++) {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY })
      }
    }
    // The scroll's first effect, or the cap (#324); no tick is paced.
    if ((await awaitReadiness('scroll')) === 'scroll' && extent !== undefined) {
      // An Extent's scroll is long, and Chromium animates it (#383): it is read where it stops, not on its first frame.
      await evaluateInPage(scrollSettledScript(SCROLL_STILL_MS, SCROLL_SETTLE_CAP_MS), { awaitPromise: true }).catch((error: unknown) => reportFault('browser.createCdpBrowserController.scrollSettled', error))
    }
    // Viewport-relative rects shift with the scroll; refs must be re-read.
    lastSnapshot = undefined
    try {
      const after = await recollection('scroll-delta', () => collectSnapshot())
      const header = scrollHeader(direction, after.viewport.scrollX ?? 0, after.viewport.scrollY)
      const delta = formatNewInView(before, after)
      // Only the delta's numbers were shown; the rest keep the nodes the
      // last full read gave them, so a ref the scroll shifted is refused
      // rather than silently retargeted (ADR 0033).
      if (delta) await overlayShown(delta.shownRefs)
      return `${header}\n${delta?.block ?? SCROLL_END_OF_PAGE}`
    } catch (error) {
      // A collector hiccup must not fail a scroll that happened: the
      // outcome degrades to the position line, the way withSettledState
      // degrades a navigation.
      reportFault('browser.createCdpBrowserController.scroll', error)
      const { signature } = await probeAction(null)
      return scrollHeader(direction, signature.scrollX, signature.scrollY)
    }
  }

  /**
   * A landing's page (#308, note on ADR 0027): the collection its line is
   * written from. The tab can move between the settle and the collect — a
   * site sending it on after its load — and the collection then throws; it
   * is collected once more when the tab has stopped changing. Null when
   * that fails too. A first collection that succeeds pays no wait.
   */
  async function collectLanding(): Promise<PageSnapshot | null> {
    try {
      return await recollection('settled-state', () => collectSnapshot())
    } catch (error) {
      reportFault('browser.createCdpBrowserController.landingOutcome', error)
    }
    await settleUntilStill('landing-retry')
    try {
      return await recollection('landing-retry', () => collectSnapshot())
    } catch (error) {
      reportFault('browser.createCdpBrowserController.landingOutcome.retry', error)
      return null
    }
  }

  /** A landing's line: the verb, then the address and title of the page it carries. */
  function landingLine(verb: LandingVerb, url: string, title: string): string {
    return `${verb}: url=${url} title=${JSON.stringify(title)}`
  }

  /** A landing no collection could read: the address the tab reports now, and that the page could not be read. */
  function unreadLanding(verb: LandingVerb, clause = ''): string {
    return `${landingLine(verb, page.url(), page.title())}${clause}\n${PAGE_NOT_READ}`
  }

  /**
   * Navigation outcome (ADR 0027): the settled page state — signature,
   * refs, digest — under a line naming that same page, so the next
   * decision continues from the landing itself.
   *
   * ADR 0061: a landing is where a consent wall is met. A Tier-1 consent root
   * on the settled page is dismissed before the model sees its refs, the
   * one-line report rides above the listing, and the listing is the page
   * behind the wall — the snapshot the Blocker classifier then reads, so a
   * login wall behind a consent wall is judged only once the wall is gone.
   */
  async function navigationOutcome(): Promise<string> {
    const landed = await collectLanding()
    if (landed === null) return unreadLanding('navigated')
    const line = landingLine('navigated', landed.url, landed.title)
    let dismissal: string | null = null
    try {
      dismissal = await dismissConsentIfOpen(landed)
    } catch (error) {
      reportFault('browser.createCdpBrowserController.landingOutcome', error)
    }
    if (dismissal === null) return withSettledState(line, landed)
    // The page behind the wall is collected the way the landing was.
    const behind = await collectLanding()
    return behind === null ? `${line}\n${dismissal}\n${PAGE_NOT_READ}` : withSettledState(`${line}\n${dismissal}`, behind)
  }

  /** A step through history's outcome: written as a navigate's, with no
   * consent dismissal, its line carrying the Unfinished Load clause (#309). */
  async function historyOutcome(verb: Exclude<LandingVerb, 'navigated'>, clause: string): Promise<string> {
    const landed = await collectLanding()
    return landed === null ? unreadLanding(verb, clause) : withSettledState(`${landingLine(verb, landed.url, landed.title)}${clause}`, landed)
  }

  /** Poll until the tab's address and title stop changing (or the poll
   * budget runs out): a mid-load abort's landing, or a landing whose
   * collection failed (#308). */
  async function settleUntilStill(action: 'navigate-abort' | 'landing-retry'): Promise<void> {
    let previous = `${page.url()}\u0000${page.title()}`
    for (let poll = 0; poll < ABORT_SETTLE_POLLS; poll++) {
      await settle(action, STILL_POLL_MS)
      const current = `${page.url()}\u0000${page.title()}`
      if (current === previous && page.url() !== '') return
      previous = current
    }
  }

  /** Send the tab to this address and wait for the landing to settle. */
  async function loadAndSettle(url: string): Promise<void> {
    try {
      await page.loadUrl(url)
    } catch (error) {
      // A mid-load abort usually means the site re-navigated the tab itself:
      // the load we asked for died, but the tab is landing somewhere
      // readable. Wait out the landing and report it as a normal outcome —
      // the navigate-settle Blocker classifier then judges the landed page
      // (ADR 0010 choke point 1). Timeouts and genuine load errors stay
      // hard errors.
      if (!isAbortedLoad(error)) throw error
      lastSnapshot = undefined
      await settleUntilStill('navigate-abort')
      return
    }
    // The landing is the wait (#328): the driver resolves once the page has
    // gone DOM-quiet after dom-ready, its load came first, or the 3 s cap
    // from the commit took it as it stood. Nothing is slept after it.
    lastSnapshot = undefined
  }

  async function navigate(input: string): Promise<string> {
    const url = normalizeUrlInput(input)
    if (!url) throw new Error(`cannot navigate to: "${input}"`)
    const release = observingCommits()
    try {
      await loadAndSettle(url)
    } finally {
      release()
    }
    return navigationOutcome()
  }

  /**
   * A region Look's clip (#195): the fractions resolved against the visual
   * viewport, offset by its page position because a capture clip is in
   * page coordinates — both in the same device-independent pixels, so page
   * zoom cannot skew one against the other. The scale re-rasterizes the
   * region from the page at that many pixels per CSS pixel.
   */
  async function regionClip(options: ScreenshotOptions): Promise<ScreenshotClip> {
    const { visualViewport } = await cdp.send<LayoutMetricsResponse>('Page.getLayoutMetrics')
    const { region, scale } = options
    return {
      x: Math.round(visualViewport.pageX + region.left * visualViewport.clientWidth),
      y: Math.round(visualViewport.pageY + region.top * visualViewport.clientHeight),
      width: Math.max(1, Math.round(region.width * visualViewport.clientWidth)),
      height: Math.max(1, Math.round(region.height * visualViewport.clientHeight)),
      scale,
    }
  }

  async function screenshot(options?: ScreenshotOptions): Promise<Uint8Array> {
    // q60 keeps the upload ~4x smaller for the vision model; full width is
    // retained so Locate points map cleanly to viewport coordinates (ADR 0008).
    const clip = options === undefined ? {} : { clip: await regionClip(options) }
    const response = await cdp.send<ScreenshotResponse>('Page.captureScreenshot', { format: 'jpeg', quality: 60, ...clip })
    return new Uint8Array(Buffer.from(response.data, 'base64'))
  }

  /**
   * The Mark Ask's image (#382, ADR 0084). The refs' rects are read again
   * now, each in its own frame with that frame's offset on the page added,
   * since the page may have moved since the collect; a rect is cut to the
   * viewport, and one wholly out of it gets no mark. The capture is a PNG
   * so the marks are painted on lossless pixels, scaled from CSS pixels to
   * the bitmap's (the pane runs zoomed), and encoded once as a JPEG.
   */
  async function markedScreenshot(refs: readonly number[]): Promise<MarkedScreenshot | null> {
    const draw = deps.drawMarks
    if (draw === undefined || refs.length === 0) return null
    // A capture that hangs (a pane that stopped painting) is no capture: the line ends as it would have.
    return withDeadline(paintedCapture(refs, draw), clock, MARK_CAPTURE_CAP_MS)
  }

  async function paintedCapture(refs: readonly number[], draw: NonNullable<CdpBrowserControllerDeps['drawMarks']>): Promise<MarkedScreenshot | null> {
    try {
      const view = await evaluateInPage<{ width: number; height: number }>('({ width: window.innerWidth, height: window.innerHeight })')
      const groups = new Map<string | null, number[]>()
      for (const ref of refs) {
        const at = addressOfRef(ref)
        groups.set(at.frame, [...(groups.get(at.frame) ?? []), ref])
      }
      const read = await Promise.all(
        [...groups].map(async ([frame, numbered]): Promise<{ ref: number; rect: CssRect }[]> => {
          const offset = frame === null ? { x: 0, y: 0 } : await frameOffset(frame)
          if (offset === null) return []
          const rects = await evaluateInFrame<(CssRect | null)[]>(frame, markRectsScript(numbered.map((ref) => addressOfRef(ref).index)))
          return numbered.flatMap((ref, position) => {
            const rect = rects?.[position]
            return rect == null ? [] : [{ ref, rect: { ...rect, x: rect.x + offset.x, y: rect.y + offset.y } }]
          })
        }),
      )
      const shown = read.flat().flatMap(({ ref, rect }) => {
        const left = Math.max(0, rect.x)
        const top = Math.max(0, rect.y)
        const right = Math.min(view.width, rect.x + rect.width)
        const bottom = Math.min(view.height, rect.y + rect.height)
        return right - left < 1 || bottom - top < 1 ? [] : [{ ref, rect: { x: left, y: top, width: right - left, height: bottom - top } }]
      })
      if (shown.length === 0) return null
      const capture = await cdp.send<ScreenshotResponse>('Page.captureScreenshot', { format: 'png' })
      const png = new Uint8Array(Buffer.from(capture.data, 'base64'))
      const scale = pngWidth(png) / view.width
      if (!(scale > 0)) return null
      const marks = shown.map(({ ref, rect }) => ({ ref, box: { x: rect.x * scale, y: rect.y * scale, width: rect.width * scale, height: rect.height * scale } }))
      const jpeg = draw(png, marks, Math.max(2, Math.round(2 * scale)))
      return jpeg === null ? null : { jpeg, marks }
    } catch (error) {
      // No capture means no Mark Ask: the line ends as it would have without one.
      reportFault('browser.createCdpBrowserController.markedScreenshot', error)
      return null
    }
  }

  // A step through history waits for its commit (paneNavigation), then for
  // the load it started, not for the commit alone (#309). The commit is the
  // step's first effect (#324); nothing is slept around it.
  async function historyStep(verb: Exclude<LandingVerb, 'navigated'>, go: () => Promise<void>): Promise<string> {
    const watch = page.watchArrival?.()
    const release = observingCommits()
    try {
      await go()
    } finally {
      release()
    }
    lastSnapshot = undefined
    const arrival = watch === undefined ? 'none' : await watch.arrival()
    return historyOutcome(verb, unfinishedClause(arrival))
  }

  const back = (): Promise<string> => historyStep('went back', () => page.goBack())
  const forward = (): Promise<string> => historyStep('went forward', () => page.goForward())
  // A reload lands where it stands (#328): waited for and written as a step through history is.
  const reload = (): Promise<string> => historyStep('reloaded', () => page.reload())

  /** A Page Read (ADR 0047): the refs and one part of the page's whole text. */
  async function readPage(part = 1): Promise<string> {
    const first = await collectSnapshot()
    const dismissal = await dismissConsentIfOpen(first)
    const reports = drainedReports()
    const snapshot = dismissal !== null ? await recollection('post-dismissal', () => collectSnapshot()) : first
    const header = dismissal !== null ? `${dismissal}\n` : ''
    const footer = reports.length > 0 ? `\n${reports.join('\n')}` : ''
    const formatted = formatPageRead(snapshot, part)
    await markShown(snapshot.refs.length)
    return `${header}${formatted}${footer}`
  }

  /** The part count read_page's admission checks against — off a fresh
   * collect, because the read it admits collects fresh too. */
  async function pageReadParts(): Promise<number> {
    return pageReadPartCount(await recollection('page-read-parts', () => collectSnapshot()))
  }

  /**
   * The one resolver every ref-taking path goes through — click, type, the
   * risk gate's describe, visual grounding (ADR 0033). A number resolves
   * only when the node it was shown as is the node at that number now;
   * a renumbering the model did not see, a number past what a read printed,
   * and a guess all land in the same refusal. Nothing the model read
   * correctly costs a round: an unchanged page answers from the registry
   * it was already shown.
   */
  async function resolveRef(
    ref: number,
    options?: { carryPage?: boolean },
  ): Promise<{ snapshot: PageSnapshot; target: SnapshotRef }> {
    const snapshot = lastSnapshot ?? (await recollection('resolve-ref', () => collectSnapshot()))
    const target = findSnapshotRef(snapshot, ref)
    if (target && (await refIsShown(ref))) return { snapshot, target }
    throw await staleRef(ref, options?.carryPage !== false)
  }

  /** The refusal, holding the page as it stands at this moment — the model
   * reads the stale-ref line and continues from these numbers. The risk
   * gate asks for no page: its refusal is discarded, and a page collected
   * for it would never reach the model to be shown. */
  async function staleRef(ref: number, carryPage: boolean): Promise<StaleRefError> {
    if (!carryPage) return new StaleRefError(ref, null)
    try {
      return new StaleRefError(ref, await recollection('stale-ref', () => collectSnapshot()))
    } catch (error) {
      reportFault('browser.createCdpBrowserController.staleRef', error)
      return new StaleRefError(ref, null)
    }
  }

  /** A refusal carries the page: the stale-ref line, then the settled page
   * in the `navigate` shape, and those numbers become the shown ones. */
  async function withRefusedStaleRef<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run()
    } catch (error) {
      if (!(error instanceof StaleRefError)) throw error
      if (error.page === null) throw new Error(error.message)
      const formatted = formatPageSnapshot(error.page)
      await markShown(error.page.refs.length)
      throw new Error(`${error.message}\n${formatted}`)
    }
  }

  /**
   * What performClick did: a real (or direct) activation, or a blocked
   * attempt and why (ADR 0062). `dismissal` is the consent wall a blocked
   * first attempt cleared (ADR 0061), null when there was none; a Covered
   * target was then retried once, a Not Shown one never.
   */
  type ClickAttempt =
    | { kind: 'acted'; direct: DirectActivation | null; at: FrameAddress; label: string; href: string | null; before: ElementState; signature: PageSignature; dismissal: string | null }
    | { kind: 'blocked'; blocked: BlockedAction; signature: PageSignature; snapshot: PageSnapshot; dismissal: string | null; retried: boolean }

  /** The element a click aims at: the ref the model named, the registry index that holds it now, and what it looked like when shown. */
  interface ClickTarget {
    ref: number
    /** Where the element lives (#377): its frame and its index in that frame's registry. */
    at: FrameAddress
    /** Its label as the page reads it (pageLabelOf), which the after-probe matches the element by. */
    label: string
    /** The address the snapshot showed for it; null when it is no link. */
    href: string | null
    before: ElementState
    /** The mouse button pressed: left for a click, right for a menu (#363). */
    button: MouseButton
  }

  async function performClick(ref: number, button: MouseButton = 'left'): Promise<ClickAttempt> {
    const { snapshot, target } = await resolveRef(ref)
    const visualPoint = visualPoints.get(ref)
    if (visualPoint) {
      const at = addressOfRef(target.ref)
      const reachable = await safety('visual-reach', () => evaluateInFrame<boolean>(at.frame, `(() => {
        const el = (window.__bingbongRefs || [])[${at.index}]
        if (!el || !el.isConnected) return false
        const top = document.elementFromPoint(${JSON.stringify(visualPoint.x)}, ${JSON.stringify(visualPoint.y)})
        return top === el || (top !== null && el.contains(top))
      })()`))
      if (!reachable) throw new Error(`ref ${ref} no longer resolves at the visually grounded point`)
      await dispatchPointClick(visualPoint, button)
      visualPoints.delete(ref)
      lastSnapshot = undefined
      return { kind: 'acted', direct: null, at, label: pageLabelOf(target), href: target.href, before: elementState(target), signature: signatureOf(snapshot), dismissal: null }
    }
    const aim: ClickTarget = { ref, at: addressOfRef(target.ref), label: pageLabelOf(target), href: target.href, before: elementState(target), button }
    const attempt = await clickAtIndex(aim, snapshot, null)
    if (attempt.kind === 'acted') return attempt
    return (await clearConsentWall(aim, attempt.blocked)) ?? attempt
  }

  /**
   * Why a click activated its target directly instead of pressing a mouse on
   * it: the target could not be brought into the viewport, or what covers it
   * paints nothing (a Blank Cover, ADR 0062), so a person sees the target.
   */
  type DirectActivation = 'offscreen' | 'blankCover'

  /**
   * Click the registry node at this index: a real click where a click can
   * land on it, a direct activation where it cannot be brought into view or
   * where its cover paints nothing, and nothing where a cover sits over it.
   * `snapshot` is the page the attempt is measured against.
   */
  async function clickAtIndex(aim: ClickTarget, snapshot: PageSnapshot, dismissal: string | null, blurred = false): Promise<ClickAttempt> {
    const { ref, at, label, href, before, button } = aim
    // A Cover is named by a ref the model holds: any number of the listing
    // this outcome carries after a dismissal, else only a number still shown.
    const naming = { listed: snapshot.refs.length, shownOnly: dismissal === null }
    const prep = await safety('click-prep', () => prepClick(at, naming))
    if (!prep.ok) {
      // The node the identity check just matched died between the two
      // probes — the registry went with a navigation. Refuse (ADR 0033):
      // re-collecting and retrying would aim the number at whoever now
      // holds it.
      throw await staleRef(ref, true)
    }

    if (prep.coveredCentre !== undefined && !blurred && (await blurFocusedField(at, prep.coveredCentre.x, prep.coveredCentre.y))) {
      // Covered at its centre by the popup of a field an earlier click focused
      // (DuckDuckGo's suggestions, 2026-10-18): blurred first, as a person's
      // click elsewhere would blur it, so no point of the target is chosen
      // while the popup is still open. The watch is armed anew, so the popup
      // closing is never the click's effect.
      await armReadiness()
      return clickAtIndex(aim, snapshot, dismissal, true)
    }
    let direct: DirectActivation | null = null
    // A frame's element is clicked where it shows on the page (#377): its own point plus every ancestor iframe's content-box origin.
    const offset = at.frame === null ? { x: 0, y: 0 } : await frameOffset(at.frame)
    if (prep.clickable && typeof prep.x === 'number' && typeof prep.y === 'number' && offset !== null) {
      await dispatchPointClick({ x: prep.x + offset.x, y: prep.y + offset.y }, button)
    } else if (prep.clickable && offset === null) {
      direct = 'offscreen'
    } else if (prep.blankCover === true) {
      // No part of the target shows, but nothing over it paints anything
      // there (DuckDuckGo's empty header aside over its Search button at the
      // zoomed pane, 2026-10-18): a person sees the target, so it is
      // activated directly, as a Vimium hint is, and the outcome says so.
      direct = 'blankCover'
    } else if (typeof prep.x === 'number' && typeof prep.y === 'number') {
      // The click point does not reach the target: something covers it, or
      // the target is not shown there at all (ADR 0062). Reported to the
      // model with what covers it instead of clicking through whatever sits
      // on top.
      return { kind: 'blocked', blocked: blockedActionOf(prep, snapshot), signature: signatureOf(snapshot), snapshot, dismissal, retried: dismissal !== null }
    } else {
      // The element cannot be brought into the viewport at all (clipped
      // away inside its own scroller); activate it directly, Vimium-style,
      // and say so in the outcome.
      direct = 'offscreen'
    }
    if (direct !== null) await activateDirectly(at, button)
    // A click can navigate (link) or mutate the page; never trust old refs.
    lastSnapshot = undefined
    return { kind: 'acted', direct, at, label, href, before, signature: signatureOf(snapshot), dismissal }
  }

  /** Activate the registry node at this index with a DOM click, no mouse pressed: what a Vimium hint does. A right button sends the node a `contextmenu` event instead (#363). */
  async function activateDirectly(at: FrameAddress, button: MouseButton = 'left'): Promise<void> {
    await evaluateInFrame(at.frame, `(() => {
      const el = (window.__bingbongRefs || [])[${at.index}]
      // No scroll of ours here, or it would be the click's effect (#335).
      if (typeof el.focus === 'function') el.focus({ preventScroll: true })
      if (${JSON.stringify(button)} === 'right') {
        const box = el.getBoundingClientRect()
        el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, buttons: 2, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 }))
      } else el.click()
    })()`)
  }

  /** The address the link at this index carries now — the node itself or
   * the link it sits in; null when it is no link, or went with the page. */
  async function linkAddressAt(at: FrameAddress): Promise<string | null> {
    try {
      const address = await evaluateInFrame<unknown>(at.frame, `(() => {
        /* LINK_ADDRESS */
        const el = (window.__bingbongRefs || [])[${at.index}]
        if (!el || !el.isConnected || typeof el.closest !== 'function') return null
        const link = el.closest(${JSON.stringify(LINK_SELECTOR)})
        return link && typeof link.href === 'string' ? link.href : null
      })()`)
      return typeof address === 'string' ? address : null
    } catch (error) {
      reportFault('browser.createCdpBrowserController.linkAddressAt', error)
      return null
    }
  }

  /**
   * ADR 0073: the opens this click caused, judged against the link it
   * landed on. The one that is the link's own address is followed — the
   * pane navigates there, since the window itself can never be allowed
   * (ADR 0018) — and the rest wait for the outcome line as denied popups.
   * True when an open was followed.
   */
  async function followNewWindowLink(attempt: Extract<ClickAttempt, { kind: 'acted' }>): Promise<boolean> {
    const opens = deps.consumePopupBlocks?.() ?? []
    if (opens.length === 0) return false
    const { followed, denied } = judgeWindowOpens(opens, [attempt.href, await linkAddressAt(attempt.at)])
    judgedDenied.push(...denied)
    if (followed === null) return false
    try {
      await loadAndSettle(followed)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(`the link asked for a new window; opening ${formatOpenAddress(followed)} here failed: ${reason}`)
    }
    return true
  }

  /**
   * ADR 0061: a click or type blocked while a Tier-1 consent root is open
   * dismisses the wall once and retries the node the model named. The
   * trigger is the open root — a wall that arrived after the page was shown
   * included — never containment of the cover, since Cookiebot's underlay is
   * the root's sibling. The node is kept by identity across the collects the
   * dismissal needs, because the wall's controls leaving renumbers the page.
   * Null when no Tier-1 consent root is open — asked of the page's dialog
   * labels in place, so a block under no dialog or a Tier-2 one collects
   * nothing and leaves the numbers the model holds as they were — and when
   * the clearing itself fails: the block then stands as it was.
   *
   * ADR 0062: only a Covered target earns the retry. A Not Shown one is
   * still dismissed for — the wall is met where it stands — but its retry's
   * result is known, so the attempt stays Not Shown behind the cleared page.
   */
  async function clearConsentWall(aim: ClickTarget, blocked: BlockedAction): Promise<ClickAttempt | null> {
    try {
      const labels = await evaluateInPage<string[] | null>(`(() => {
        /* DIALOG_LABELS */
        return typeof window.__bingbongDialogLabels === 'function' ? window.__bingbongDialogLabels() : null
      })()`)
      if (!Array.isArray(labels) || !isConsentDialog('', labels) || chooseConsentDismissal(labels) === null) return null
      if (blocked.fact === 'notShown') return await dismissWithoutRetry()
      return await retryPastConsent(aim)
    } catch (error) {
      if (error instanceof StaleRefError) throw error
      reportFault('browser.createCdpBrowserController.clearConsentWall', error)
      return null
    }
  }

  /** Collect the walled page, dismiss, and hand back the page behind with the target still Not Shown. */
  async function dismissWithoutRetry(): Promise<ClickAttempt | null> {
    const walled = await recollection('blocked-consent', () => collectSnapshot())
    const dismissal = await dismissConsentIfOpen(walled)
    if (dismissal === null) return null
    const cleared = await recollection('post-dismissal', () => collectSnapshot())
    return { kind: 'blocked', blocked: { fact: 'notShown' }, signature: signatureOf(cleared), snapshot: cleared, dismissal, retried: false }
  }

  /** Keep the node, collect the walled page, dismiss, collect the page behind, and click the node wherever it now sits. */
  async function retryPastConsent(aim: ClickTarget): Promise<ClickAttempt | null> {
    const { ref, at } = aim
    await evaluateInFrame(at.frame, `(() => {
      /* CONSENT_RETRY_KEEP */
      window.__bingbongConsentRetry = (window.__bingbongRefs || [])[${at.index}] || null
      return true
    })()`)
    const walled = await recollection('blocked-consent', () => collectSnapshot())
    const dismissal = await dismissConsentIfOpen(walled)
    if (dismissal === null) return null
    const cleared = await recollection('post-dismissal', () => collectSnapshot())
    const retryIndex = await evaluateInFrame<number>(at.frame, `(() => {
      /* CONSENT_RETRY_FIND */
      const el = window.__bingbongConsentRetry
      window.__bingbongConsentRetry = null
      if (!el || !el.isConnected) return -1
      const refs = window.__bingbongRefs || []
      let index = refs.indexOf(el)
      if (index < 0) {
        index = refs.length
        refs.push(el)
        window.__bingbongRefs = refs
      }
      return index
    })()`)
    // The node went with the wall (a dismissal that reloaded the page):
    // refuse with the page as it now stands, as any dead ref is.
    if (!Number.isInteger(retryIndex) || retryIndex < 0) throw await staleRef(ref, true)
    return clickAtIndex({ ...aim, at: { frame: at.frame, index: retryIndex } }, cleared, dismissal)
  }

  /** The dismissal a blocked first attempt ran and the retry it earned, in the one wording every outcome uses; null when there was none. */
  function consentNote(attempt: ClickAttempt, ref: number): string | null {
    if (attempt.dismissal === null) return null
    const retry = attempt.kind === 'acted' ? 'landed' : attempt.retried ? 'stillBlocked' : 'notRetried'
    return `${attempt.dismissal} ${consentRetryNote(ref, retry)}`
  }

  /** The same, as a clause riding an outcome line; empty when there was none. */
  function consentClause(attempt: ClickAttempt, ref: number): string {
    const note = consentNote(attempt, ref)
    return note === null ? '' : `; ${note}`
  }

  /** A blocked click, type or menu: its Cover or that it is Not Shown, any dialog, the dismissal the wall cost, and — when the wall was cleared — the page behind it. */
  async function blockedOutcome(action: RefAction, ref: number, attempt: Extract<ClickAttempt, { kind: 'blocked' }>): Promise<string> {
    const line = `${blockedActionHead(action, ref, attempt.blocked)}${dialogSuffix(attempt.snapshot)}${consentClause(attempt, ref)}${reportsSuffix(drainedReports())}`
    return attempt.dismissal === null ? line : withSettledState(line, attempt.snapshot)
  }

  /**
   * An action that sends input to the page, with the pane's denied opens
   * held for the length of it (ADR 0073): an open it causes is the model's,
   * judged by a click against its ref and reported by everything else.
   */
  async function holdingWindowOpens<T>(act: () => Promise<T>): Promise<T> {
    const release = deps.holdWindowOpens?.()
    try {
      return await act()
    } finally {
      release?.()
    }
  }

  /** A click on a ref; with the right button, the ref's menu opened (#363), told under a `menu [N]` head. */
  async function clickRef(ref: number, button: MouseButton = 'left'): Promise<string> {
    const watch = page.watchArrival?.()
    const frame = addressOfRef(ref).frame
    await armReadiness(frame)
    const attempt = await performClick(ref, button)
    if (attempt.kind === 'blocked') return blockedOutcome(button === 'right' ? 'menu' : 'click', ref, attempt)
    const arrival = await settleArrival('click', watch, attempt.at.frame)
    // A right-click opens no link: an open in its wake is the page's, reported with the rest.
    const openedHere = button === 'left' && (await followNewWindowLink(attempt))
    // A New-window Link followed here is a navigate's arrival, load and all.
    const arrived = arrival !== 'none' || openedHere
    const after = await probeAction(attempt.at, attempt.label)
    const urlChanged = attempt.signature.url !== after.signature.url
    const dialogNowOpen = after.signature.dialogOpen
    let fresh: PageSnapshot | undefined
    if (urlChanged || arrived || dialogNowOpen) fresh = await recollection('post-action', () => collectSnapshot())
    if ((urlChanged || arrived) && fresh) after.signature = signatureOf(fresh)
    const deltas = stateDeltas(attempt.before, after.target)
    const controls = unchangedControlState(attempt.before, after.target)
    const pageChanged = !signaturesEqual(attempt.signature, after.signature)
    const rawChanges = deltas.length > 0 || controls.length > 0
      ? [...deltas, ...controls].join(', ')
      : pageChanged ? PAGE_SIGNATURE_CHANGED : NO_OBSERVABLE_CHANGE
    const location = urlChanged || arrived ? `; ${urlTitleSuffix(after.signature)}` : ''
    const prefix = (button === 'right' ? menuFlagsHead : clickFlagsHead)(ref, urlChanged, after.signature.dialogOpen)
    const changes = truncateOutcomeText(rawChanges, Math.min(240, Math.max(30, 300 - prefix.length - location.length)))

    // Dialog escalation: consent dialogs are dismissed deterministically
    // (Tier 1); anything else has its text surfaced for the model to decide
    // (Tier 2 — dismiss, interact, or ask_user).
    const extras: string[] = []
    if (arrived) extras.push(ARRIVED_CLAUSE)
    if (arrival === 'unfinished') extras.push(UNFINISHED_LOAD_CLAUSE)
    const cleared = consentNote(attempt, ref)
    if (cleared !== null) extras.push(cleared)
    if (attempt.direct === 'offscreen') extras.push('activated directly (outside viewport)')
    if (attempt.direct === 'blankCover') extras.push('activated directly (what covers it paints nothing)')
    if (openedHere) extras.push(NEW_WINDOW_FOLLOWED_CLAUSE)
    /** The snapshot whose state rides the outcome (post-dismissal when a
     * consent wall was cleared, the post-action collect otherwise). */
    let settled: PageSnapshot | undefined = fresh
    if (dialogNowOpen && fresh) {
      const dismissal = await dismissConsentIfOpen(fresh)
      if (dismissal !== null) {
        extras.push(dismissal)
        settled = await recollection('post-dismissal', () => collectSnapshot())
      } else {
        const detail = dialogDetail(fresh)
        if (detail !== null) extras.push(detail)
      }
    }
    extras.push(...drainedReports())
    const suffix = extras.length > 0 ? `; ${extras.join('; ')}` : ''
    const line = `${prefix}${changes}${location}${suffix}`

    // ADR 0027: a meaningful click (navigation, dialog, element state, or
    // page change) returns the settled page state so the next decision
    // continues from the result; an inert click stays concise.
    // A click that first cleared a consent wall hands over the page behind it.
    const meaningful = urlChanged || arrived || dialogNowOpen || deltas.length > 0 || pageChanged || attempt.dismissal !== null
    if (!meaningful) return line
    return withSettledState(line, settled)
  }

  async function dispatchPointClick(point: ViewportPoint, button: MouseButton = 'left'): Promise<void> {
    const { x, y } = point
    // Move, press, release back to back (#324): no pointer pacing.
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button,
      buttons: button === 'right' ? 2 : 1,
      clickCount: 1,
    })
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button,
      buttons: 0,
      clickCount: 1,
    })
  }

  /** Scroll the ref's element into view, then report fresh click coordinates,
   * whether a coordinate click would land on it, and — when it would not —
   * whether it is Covered or Not Shown (ADR 0062). */
  /** Blur another text field holding the focus, for a target its popup covers at (x, y); whether the target shows there again. */
  async function blurFocusedField(at: FrameAddress, x: number, y: number): Promise<boolean> {
    try {
      return (await evaluateInFrame<boolean>(at.frame, blurFocusedFieldScript(at.index, x, y), { awaitPromise: true })) === true
    } catch (error) {
      reportFault('browser.createCdpBrowserController.blurFocusedField', error)
      return false
    }
  }

  /**
   * The click prep, in the element's own frame (#377). The numbers a Cover
   * is named by come back as that frame's registry indices, and are told
   * here as the whole page's numbers, any the listing does not hold dropped.
   */
  async function prepClick(at: FrameAddress, naming: CoverNaming): Promise<ClickPrep> {
    const held = addresses.slice(0, naming.listed).filter((address) => address.frame === at.frame)
    const listed = addresses.length === 0 ? naming.listed : held.reduce((most, address) => Math.max(most, address.index + 1), 0)
    const prep = await evaluateInFrame<ClickPrep>(at.frame, clickPrepScript(at.index, { ...naming, listed }))
    if (prep?.blocked?.fact !== 'covered' || addresses.length === 0) return prep
    const number = (local: number): number => {
      const flat = addresses.findIndex((address) => address.frame === at.frame && address.index === local - 1) + 1
      return flat > naming.listed ? 0 : flat
    }
    const cover = prep.blocked.cover
    const named: CoverProbe = 'ref' in cover
      ? number(cover.ref) > 0 ? { ref: number(cover.ref) } : { tag: 'element', contains: [] }
      : { ...cover, contains: cover.contains.map(number).filter((ref) => ref > 0) }
    return { ...prep, blocked: { fact: 'covered', cover: named } }
  }

  /**
   * Where a frame starts on the page (#377): every ancestor iframe's
   * content-box origin, read after the click prep scrolled, summed. Null
   * when an ancestor no longer holds the frame.
   */
  async function frameOffset(frame: string): Promise<{ x: number; y: number } | null> {
    let x = 0
    let y = 0
    for (let key: string | null = frame; key !== null; ) {
      const hung = frameSlots.get(key)
      if (hung === undefined) return null
      // The frame's slot asked of the frame now, not taken from the collect: an iframe added before it since would hold the old one.
      const slot = await evaluateInFrame<number>(key, OWN_SLOT_SCRIPT)
      if (typeof slot !== 'number' || slot < 0) return null
      const box = await evaluateInFrame<{ x: number; y: number } | null>(hung.parentKey, frameBoxScript(slot))
      if (box == null) return null
      x += box.x
      y += box.y
      key = hung.parentKey
    }
    return { x, y }
  }

  /** The prep's hit-test verdict, its Cover named against the snapshot whose numbers the outcome speaks. */
  function blockedActionOf(prep: ClickPrep, snapshot: PageSnapshot): BlockedAction {
    if (prep.blocked?.fact === 'notShown') return { fact: 'notShown' }
    return { fact: 'covered', cover: coverOf(prep.blocked?.cover ?? { tag: 'element', contains: [] }, snapshot.refs) }
  }

  /** Focus the registry element for keyboard selection. #133: a synthetic
   * click on a <select> opens Chromium's select popup, which no DOM click
   * can reach — the type path focuses the element instead (focus scrolls it
   * into view) and never opens the popup. */
  async function focusSelect(at: FrameAddress): Promise<boolean> {
    return evaluateInFrame<boolean>(at.frame, `(() => {
      /* SELECT_FOCUS */
      const el = (window.__bingbongRefs || [])[${at.index}]
      if (!el || !el.isConnected) return false
      if (typeof el.focus === 'function') el.focus()
      return true
    })()`)
  }

  /** One keyDown/keyUp pair for a character or a special key. */
  async function dispatchKey(key: KeyEvent): Promise<void> {
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
  }

  /** Send text as real key events, one keyDown/keyUp pair per character, back to back — what a select's type-ahead needs. */
  async function dispatchKeys(text: string): Promise<void> {
    for (const ch of text) await dispatchKey(keyEventFor(ch))
  }

  /**
   * Insert text whole (#324, ADR 0076): `Input.insertText` in place of a
   * paced key event per character. The specials — a newline (Enter), a
   * tab, a backspace, an escape — stay key events, since inserting them
   * types nothing.
   */
  async function insertText(text: string): Promise<void> {
    let run = ''
    const flush = async (): Promise<void> => {
      if (run === '') return
      const chunk = run
      run = ''
      await cdp.send('Input.insertText', { text: chunk })
    }
    for (const ch of text) {
      const special = SPECIAL_KEYS[ch]
      if (special === undefined) {
        run += ch
        continue
      }
      await flush()
      await dispatchKey(special)
    }
    await flush()
  }

  /** #133: choose a native select option by typing its label at the focused
   * select — closed-select type-ahead commits the matching option through
   * the real keyboard path. The outcome reports the now-selected option,
   * changed or not, so a non-matching pick is visible to the model. */
  async function typeIntoSelect(
    ref: number,
    target: SnapshotRef,
    before: PageSignature,
    text: string,
  ): Promise<string> {
    const at = addressOfRef(target.ref)
    const focused = await safety('select-focus', () => focusSelect(at))
    // The registry died with the page between the identity check and the
    // focus: refuse rather than re-collect and retry (ADR 0033).
    if (!focused) throw await staleRef(ref, true)
    // Synthetic keys only land on the focused webContents (pressKey's
    // rule): the click path buys focus with its opening click, the select
    // path claims it here — DOM focus() moved element focus only.
    page.focus()
    lastSnapshot = undefined
    // Newlines would send Enter, which opens the select popup — a dead end
    // for synthetic input. Letters carry the whole choice.
    const watch = page.watchArrival?.()
    await armReadiness(at.frame)
    await dispatchKeys(text.replace(/[\r\n]+/g, ''))
    const arrival = await settleArrival('type', watch, at.frame)
    const after = await probeAction(at, pageLabelOf(target))
    if (!after.target) {
      const head = `typed [${ref}]: field unavailable after page change; ${urlTitleSuffix(after.signature)}${arrivalClauses(arrival)}`
      return withSettledState(head)
    }
    const selected = after.target.selectedOption ?? after.target.value ?? ''
    const urlChanged = before.url !== after.signature.url
    const pageChanged = !signaturesEqual(before, after.signature)
    if (urlChanged || pageChanged || arrival !== 'none') {
      return withSettledState(`typed [${ref}]: selected=${JSON.stringify(selected)}; page changed${arrivalClauses(arrival)}`)
    }
    return `typed [${ref}]: selected=${JSON.stringify(selected)}`
  }

  async function typeIntoRef(ref: number, text: string): Promise<string> {
    const { snapshot, target } = await resolveRef(ref)
    if (target.selectedOption != null) {
      return typeIntoSelect(ref, target, signatureOf(snapshot), text)
    }
    // The focusing click can leave the page as well as the typing can.
    const watch = page.watchArrival?.()
    const clicked = await performClick(ref)
    if (clicked.kind === 'blocked') return blockedOutcome('type', ref, clicked)
    const cleared = consentClause(clicked, ref)
    // The click's focus lands before the insert: input events are processed
    // in order (#324), so nothing is slept between them.
    await armReadiness(clicked.at.frame)
    await insertText(text)
    const arrival = await settleArrival('type', watch, clicked.at.frame)
    const after = await probeAction(clicked.at, clicked.label)
    if (!after.target) {
      // The typing navigated (e.g. a submitted search): the resulting page
      // state and refs ride the outcome (ADR 0027).
      const head = `typed [${ref}]: field unavailable after page change; ${urlTitleSuffix(after.signature)}${arrivalClauses(arrival)}${cleared}`
      return withSettledState(head)
    }
    const value = after.target.value ?? after.target.selectedOption ?? ''
    const urlChanged = clicked.signature.url !== after.signature.url
    const pageChanged = !signaturesEqual(clicked.signature, after.signature)
    if (urlChanged || pageChanged || arrival !== 'none') {
      return withSettledState(`typed [${ref}]: value=${JSON.stringify(value)}; page changed${arrivalClauses(arrival)}${cleared}`)
    }
    // Typing that first cleared a consent wall hands over the page behind it.
    if (clicked.dismissal !== null) return withSettledState(`typed [${ref}]: value=${JSON.stringify(value)}${cleared}`)
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
    const watch = page.watchArrival?.()
    await armReadiness()
    for (let i = 0; i < times; i++) await dispatchShortcut(event)
    // The key's first effect, or the cap (#324); then a key that left the
    // page (#309) waits for the load it started. No outcome carries a page here.
    await awaitReadiness('press-key')
    if (watch !== undefined && (await watch.arrival()) !== 'none') lastSnapshot = undefined
  }

  function readMediaState(): Promise<MediaState | null> {
    return evaluateInPage<MediaState | null>(`(() => {
      /* MEDIA_STATE */
      const media = Array.from(document.querySelectorAll('video, audio'))
      const active = media.find((el) => !el.paused) || media[0]
      if (!active) return null
      return { paused: active.paused, currentTime: active.currentTime, volume: active.volume }
    })()`)
  }

  async function mediaState(): Promise<MediaState | null> {
    return readMediaState()
  }

  /**
   * A Media Op (#372, ADR 0080): one evaluate on the registry node the
   * number names — the element Jev was shown, never another — the op
   * applied to it, and its facts read before and after in the same tick,
   * so the outcome tells what the op itself changed and nothing time
   * running on did. Volume and mute are told to YouTube's player too when
   * the element is its (as the Player does, #343), so its own slider and
   * remembered volume agree. No mouse, no collect: nothing renumbers.
   */
  async function mediaOpOn(ref: number, op: MediaOpAction): Promise<string> {
    const { target } = await resolveRef(ref)
    // One evaluate in the ref's own frame (#377): an embedded player's element is its frame's.
    const at = addressOfRef(target.ref)
    const read = await evaluateInFrame<{ before: unknown; after: unknown } | null>(at.frame, `((op) => {
      /* MEDIA_OP */
      const el = (window.__bingbongRefs || [])[${at.index}]
      if (!el || !el.isConnected || !(el instanceof HTMLMediaElement)) return null
      const facts = ${MEDIA_FACTS_FN}
      const player = typeof el.closest === 'function' ? el.closest('#movie_player') : null
      const before = facts(el)
      // The seeks are offered only with a seekable range (ADR 0080): the bounds are the facts' own.
      const start = before.seekable ? before.seekable.start : 0
      const end = before.seekable ? before.seekable.end : el.currentTime
      const tracks = el.textTracks ? Array.from(el.textTracks) : []
      switch (op.op) {
        case 'play': el.play().catch(() => {}); break
        case 'pause': el.pause(); break
        case 'forward': el.currentTime = Math.min(end, el.currentTime + (op.seconds || 0)); break
        case 'back': el.currentTime = Math.max(start, el.currentTime - (op.seconds || 0)); break
        case 'restart': el.currentTime = start; el.play().catch(() => {}); break
        case 'volume': {
          const level = Math.max(0, Math.min(100, Math.round(op.to || 0)))
          el.volume = level / 100
          if (player && typeof player.setVolume === 'function') player.setVolume(level)
          break
        }
        case 'mute':
        case 'unmute':
          el.muted = op.op === 'mute'
          if (player && typeof player.mute === 'function' && typeof player.unMute === 'function') op.op === 'mute' ? player.mute() : player.unMute()
          break
        case 'loop':
        case 'unloop': el.loop = op.op === 'loop'; break
        case 'rate': el.playbackRate = op.to || 1; break
        case 'captions': {
          const track = tracks.find((t) => t.kind === 'subtitles' || t.kind === 'captions') || tracks[0]
          for (const t of tracks) t.mode = t === track ? 'showing' : 'disabled'
          break
        }
        case 'uncaptions': for (const t of tracks) t.mode = 'disabled'; break
      }
      // A play() flips the paused flag in the call and a seek lands in the same tick, so the facts read after tell what the op did — a play the policy refuses flips back later, and the next read says so.
      return { before, after: facts(el) }
    })(${JSON.stringify(op)})`)
    // A null comes back as undefined (`evaluateInPage`): either is no media element.
    if (read == null) throw new Error(`ref ${ref} is no video or audio element`)
    const [before, after] = [parseMediaFacts(read.before), parseMediaFacts(read.after)]
    if (before === undefined || after === undefined) throw new Error(`ref ${ref}: the element's media facts could not be read`)
    // The facts on the page's refs moved: the next collect reads them anew.
    lastSnapshot = undefined
    const changes = mediaChangesOf(before, after)
    return `${mediaOpHead(op.op, ref)}${changes.length > 0 ? changes.join(', ') : NO_OBSERVABLE_CHANGE}`
  }


  /**
   * A Scroll Op (#383, ADR 0085): one evaluate in the ref's own frame on
   * the registry node the number names, scrolling that element — never the
   * page, since an explicit scroll on an element never chains — by the
   * Extent's screens of its own view, instantly, or to its end or top. Its
   * facts are read before and after in the same tick; a region that moved
   * is waited for through the readiness watch, so its scroll event is the
   * op's own, then read again to say what entered the view.
   */
  async function scrollRegionOn(ref: number, direction: 'up' | 'down', extent: ScrollExtent): Promise<string> {
    const { snapshot: before, target } = await resolveRef(ref)
    if (target.kind !== 'region') throw new Error(`ref ${ref} is no scroll region`)
    const at = addressOfRef(target.ref)
    const head = scrollOpHead(direction, ref)
    await armReadiness(at.frame)
    const read = await evaluateInFrame<{ before: unknown; after: unknown } | null>(at.frame, `((op) => {
      /* SCROLL_REGION */
      const el = (window.__bingbongRefs || [])[${at.index}]
      if (!el || !el.isConnected || !(el instanceof Element)) return null
      const facts = () => ({ top: el.scrollTop, height: el.scrollHeight, view: el.clientHeight })
      const before = facts()
      const sign = op.direction === 'down' ? 1 : -1
      if (op.screens === null) el.scrollTo({ top: sign > 0 ? el.scrollHeight : 0, behavior: 'instant' })
      else el.scrollBy({ top: sign * op.screens * el.clientHeight, behavior: 'instant' })
      return { before, after: facts() }
    })(${JSON.stringify({ direction, screens: extent.screens ?? null })})`)
    // A null comes back as undefined (`evaluateInPage`): either is no element.
    if (read == null) throw new Error(`ref ${ref} is no scroll region`)
    const [was, now] = [parseRegionFacts(read.before), parseRegionFacts(read.after)]
    if (was === undefined || now === undefined) throw new Error(`ref ${ref}: the region's facts could not be read`)
    const change = regionChangeOf(was, now)
    if (change === null) return `${head}${SCROLL_END_OF_REGION}`
    await awaitReadiness('scroll-region', at.frame)
    // Rects inside the region moved, and its own facts: the refs are read anew.
    lastSnapshot = undefined
    try {
      const after = await recollection('scroll-delta', () => collectSnapshot())
      const delta = formatNewInView(before, after)
      // Only the delta's numbers were shown (ADR 0033), as after a page scroll.
      if (delta) await overlayShown(delta.shownRefs)
      return `${head}${change}${delta !== null ? `\n${delta.block}` : ''}`
    } catch (error) {
      // A collector hiccup must not fail a scroll that happened: the outcome is the position line.
      reportFault('browser.createCdpBrowserController.scrollRegion', error)
      return `${head}${change}`
    }
  }

  async function describeRef(ref: number): Promise<SnapshotRef | undefined> {
    try {
      const { target } = await resolveRef(ref, { carryPage: false })
      return target
    } catch (error) {
      reportFault('browser.createCdpBrowserController.describeRef', error)
      return undefined
    }
  }

  // The Composed Address rail's Offered Addresses (#258): the whole hrefs the
  // freshest snapshot's link refs carry — the same snapshot the last result
  // printed, re-collected only where an action invalidated it.
  async function linkHrefs(): Promise<readonly string[] | null> {
    try {
      return linkHrefsOf(await currentSnapshot())
    } catch (error) {
      reportFault('browser.createCdpBrowserController.linkHrefs', error)
      return null
    }
  }

  // A Result Pick's candidates (#303): the links of the whole page, read in
  // place by the helper the last collect left there. A page that holds no
  // helper was never collected, and is a page that cannot be read; so is a
  // page at another address than the snapshot the last result printed — a
  // redirect or a route change since — whose links are not that listing's.
  async function pageLinks(): Promise<readonly PageLink[] | null> {
    try {
      const read = await evaluateInPage<unknown>(`(() => {
        /* PAGE_LINKS */
        return typeof window.__bingbongPageLinks === 'function' ? window.__bingbongPageLinks() : null
      })()`)
      if (typeof read !== 'object' || read === null) return null
      const { url, links } = read as Record<string, unknown>
      if (lastSnapshot === undefined || url !== lastSnapshot.url) return null
      return parsePageLinks(links)
    } catch (error) {
      reportFault('browser.createCdpBrowserController.pageLinks', error)
      return null
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
    // The grounded node is the top document's, numbered after the whole page's (#377).
    const ref = addresses.length + 1
    addresses = [...addresses, { frame: null, index: result.index }]
    const target = { ...built, ref }
    lastSnapshot = {
      ...snapshot,
      refs: [...snapshot.refs.filter((candidate) => candidate.ref !== ref), target],
      totalVisible: Math.max(snapshot.totalVisible, ref),
    }
    visualPoints.set(ref, point)
    // The one number this round hands the model (ADR 0033).
    await overlayShown([ref])
    return ref
  }

  /** A number handed to the model outside a page read — the DOM match
   * `ground_visual` answers with — is a shown number too, or the click that
   * follows it would be refused (ADR 0033). On this branch it also flashes
   * the element (#324): the Command's chosen ref, lit as the click lands. */
  async function showRef(ref: number): Promise<void> {
    await overlayShown([ref])
    try {
      const at = addressOfRef(ref)
      await evaluateInFrame(at.frame, flashRefScript(at.index))
    } catch (error) {
      reportFault('browser.createCdpBrowserController.flashRef', error)
    }
  }

  /**
   * The page's refs as data, those numbers shown (ADR 0033): what a Command
   * is read against (#324) — collected at speech start so the list is in
   * hand at the Endpoint, and the click that follows is not refused.
   *
   * A Tier-1 consent wall open over the page is dismissed first, as a
   * landing's is (ADR 0061): a cookie banner that drew after the landing
   * settled — Truth Social's TCF sheet, 2026-10-19 — is cleared before any
   * reading sees it, instead of costing a Task a hop and a Jev call (#354).
   */
  async function collectPage(): Promise<PageSnapshot> {
    let snapshot = await collectSnapshot()
    try {
      const dismissal = await dismissConsentIfOpen(snapshot)
      if (dismissal !== null) snapshot = await recollection('post-dismissal', () => collectSnapshot())
    } catch (error) {
      reportFault('browser.createCdpBrowserController.collectPage', error)
    }
    await markShown(snapshot.refs.length)
    return snapshot
  }

  /** Clear the focused editable element (#324): the `clear` verb, one of the four a Misfire is recovered by. */
  async function clearFocused(): Promise<string> {
    await armReadiness()
    const cleared = await evaluateInPage<string | null>(clearFocusedScript())
    await awaitReadiness('clear')
    return cleared === null ? 'nothing to clear: no text field has focus' : `cleared ${cleared}`
  }

  /** One script in every frame below the top, all at once (#377): the answers within the grace, a frame gone or slow left out. */
  async function evaluateInFrames<T>(expression: string): Promise<T[]> {
    await page.untilLanded?.()
    return fanOut((frame) => frame.evaluate<T>(expression)).answered()
  }

  function state(): BrowserState {
    return { url: page.url(), title: page.title() }
  }

  // ADR 0010 classifier facts off the freshest collected snapshot — free
  // right after readPage() set lastSnapshot; recollects otherwise.
  async function pageFacts() {
    // The status rides beside the snapshot's facts (#239): the collector
    // runs in the page and never sees the response the tab was served.
    const status = page.status?.() ?? null
    return { ...blockerFactsFromSnapshot(await currentSnapshot()), ...(status !== null ? { status } : {}) }
  }

  // The Progress rails' comparison input (#126, ADR 0027): the settled
  // page state off the freshest collected snapshot plus a settle-free
  // media read — the rails fingerprint whole-second playback buckets, so
  // the media tools' own settle already covered precision by the time
  // this runs after an action. A page that cannot be read is null, never
  // an error: the rails stay inert for that action.
  async function settledState(): Promise<SettledPageState | null> {
    try {
      const snapshot = await currentSnapshot()
      let media: MediaState | null = null
      try {
        media = await readMediaState()
      } catch (error) {
        reportFault('browser.createCdpBrowserController.readMediaState', error)
        media = null
      }
      return settledStateFromSnapshot(snapshot, media, page.status?.() ?? null)
    } catch (error) {
      reportFault('browser.createCdpBrowserController.settledState', error)
      return null
    }
  }

  const click = (ref: number) => holdingWindowOpens(() => withRefusedStaleRef(() => clickRef(ref)))
  const mediaOp = (ref: number, op: MediaOpAction) => withRefusedStaleRef(() => mediaOpOn(ref, op))
  const scrollRegion = (ref: number, direction: 'up' | 'down', extent: ScrollExtent) => withRefusedStaleRef(() => scrollRegionOn(ref, direction, extent))
  // A right-click (#363): the page's own menu, with the appliance's native one held back for the length of it.
  const openMenu = async (ref: number): Promise<string> => {
    const release = deps.holdContextMenu?.()
    try {
      return await holdingWindowOpens(() => withRefusedStaleRef(() => clickRef(ref, 'right')))
    } finally {
      release?.()
    }
  }
  const type = (ref: number, text: string) => holdingWindowOpens(() => withRefusedStaleRef(() => typeIntoRef(ref, text)))

  return {
    navigate,
    readPage,
    pageReadParts,
    click,
    openMenu,
    mediaOp,
    type,
    scroll,
    scrollRegion,
    screenshot,
    markedScreenshot,
    back,
    forward,
    reload,
    async stop() {
      page.stop?.()
    },
    pressKey: (press, times) => holdingWindowOpens(() => pressKey(press, times)),
    mediaState,
    evaluate: (expression) => evaluateInPage(expression),
    evaluateInFrames,
    state,
    pageFacts,
    settledState,
    describeRef,
    linkHrefs,
    pageLinks,
    collectPage,
    dialogOpen: dialogOpenInPlace,
    clearFocused,
    groundingSnapshot,
    refAtPoint,
    showRef,
  }
}
