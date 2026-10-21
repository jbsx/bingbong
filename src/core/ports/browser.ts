import type { BlockerPageFacts } from '../browser/blockerNudge'
import type { PageLink, PageSnapshot, SnapshotRef } from '../browser/snapshot'
import type { MediaOpAction } from '../browser/mediaOp'

/**
 * How a navigation's landing ended (#328, ADR 0076 amendment): the page
 * went DOM-quiet after `dom-ready`, its load event came first, or the 3 s
 * cap from the commit took it as it stood.
 */
export type PageLanding = 'quiet' | 'loaded' | 'capped'

export interface BrowserState {
  url: string | null
  title: string | null
}

export interface MediaState {
  paused: boolean
  currentTime: number
  volume: number
}

export interface ViewportPoint {
  x: number
  y: number
}

/**
 * The settled page state one Action Outcome reports (#113/#125) — the
 * input the no-progress rails (#126) compare. The optional fields fold
 * deterministically: absent and no-element media are identical, and an
 * absent interactive digest reads as "no form state reported".
 */
export interface SettledPageState {
  url: string
  title?: string
  scrollX?: number
  scrollY?: number
  dialogOpen?: boolean
  dialogText?: string
  textDigest?: string
  /**
   * Identity of the page's interactive-element state (#126): a sorted
   * digest of the form-bearing refs' checked/value/selection/pressed
   * facts, so a requested element state change — a toggled checkbox, a
   * typed field value — is observable Progress even when the page's text
   * and URL stand still. Absent when the page reports no such facts.
   */
  interactiveDigest?: string
  /** The focused page's media state, when one was read; null when the page has no media element. */
  media?: MediaState | null
  /**
   * HTTP status of the top-level response the tab settled on (#239, ADR
   * 0050), when the surface knows it. Carried, never fingerprinted: a
   * page's identity is its content, and the Not-found classification reads
   * the status off the page facts.
   */
  status?: number
}

/**
 * A keyboard shortcut to inject on the focused page: a single character
 * ('k') or a named key ('ArrowUp'), optionally with Shift. Shortcuts never
 * carry text — they trigger page key handlers, they do not type.
 */
export interface KeyPress {
  key: string
  shift?: boolean
}

/**
 * A part of the viewport as fractions of its size (#195): every value in
 * [0, 1], `left + width` and `top + height` at most 1. Fractions rather
 * than pixels because the caller (a Look) never holds the viewport size —
 * the browser resolves them against the live one.
 */
export interface ViewportRegion {
  left: number
  top: number
  width: number
  height: number
}

/**
 * A bounded, magnified capture (#195): the region is re-rendered at
 * `scale` device pixels per CSS pixel, so text the screen shows too small
 * to read is rasterized larger from the page itself — never upscaled from
 * the full screenshot's bitmap.
 */
export interface ScreenshotOptions {
  region: ViewportRegion
  scale: number
}

export interface BrowserController {
  navigate(url: string): Promise<string>
  /**
   * A Page Read (ADR 0047): the page's refs and one part of its whole text,
   * part 1 — from the top — when none is named. Rejects for a part the
   * page does not have.
   */
  readPage(part?: number): Promise<string>
  /**
   * How many parts a Page Read of the current page's text takes, at least
   * one (ADR 0047): what read_page's admission step checks a part past the
   * first against.
   */
  pageReadParts(): Promise<number>
  click(ref: number): Promise<string>
  /**
   * Open a ref's right-click menu (#363, ADR 0079): a right button pressed
   * at its point, the appliance's own native menu held back. The outcome
   * reads as a click's does, under a `menu [N]` head: what the page drew
   * is the next collect's refs, and nothing drawn is `no observable change`.
   */
  openMenu(ref: number): Promise<string>
  type(ref: number, text: string): Promise<string>
  /**
   * A Media Op on a media ref's own element (#372, ADR 0080): one evaluate
   * on the node the number names, beside click and type, on any site. The
   * outcome reads as a click's does, under an `<op> [N]` head: what the
   * element's facts changed from and to, and `no observable change` for an
   * op that changed nothing (mute on a muted element). Rejects for a number
   * not shown, and for an element that is no video or audio.
   */
  mediaOp(ref: number, op: MediaOpAction): Promise<string>
  scroll(direction: 'up' | 'down'): Promise<string>
  /** The visible viewport as a JPEG; with options, one magnified region of it. */
  screenshot(options?: ScreenshotOptions): Promise<Uint8Array>
  back(): Promise<string>
  forward(): Promise<string>
  /** Load the page again (#328): a landing like a navigate's, its line opening `reloaded:`. */
  reload(): Promise<string>
  /** Stop the tab's load where it stands (#330): Stop ends the page's loading, not only the Command's wait on it. */
  stop(): Promise<void>
  /** Inject a shortcut key (times consecutive presses) on the focused page. */
  pressKey(press: KeyPress, times?: number): Promise<void>
  /** Read actual state from the page's active media element after controls settle. */
  mediaState(): Promise<MediaState | null>
  /**
   * One script evaluated in the page, its value returned (#343): the Player
   * reads YouTube's results and drives the watch page's video through it.
   * A navigation under way is waited for first, as every page read is.
   */
  evaluate<T>(expression: string): Promise<T>
  /**
   * One script evaluated in every frame below the top document (#377, ADR
   * 0081), each in its own context, all at once: the answers of the frames
   * that answered within the collect's grace, never waiting on the rest.
   * Optional: a controller that reaches no frames answers none.
   */
  evaluateInFrames?<T>(expression: string): Promise<T[]>
  state(): BrowserState
  /**
   * Facts for the mechanical Blocker classifier (ADR 0010): URL, title,
   * leading body text, dialog text, and ref kinds/srcs of the current page.
   * Cheap right after readPage(); may re-collect if the snapshot went stale.
   */
  pageFacts(): Promise<BlockerPageFacts>
  /**
   * The visible tab's settled page state for the Progress rails (#126,
   * ADR 0027): URL, title, scroll position, dialog, text digest, and the
   * active media element's state, off the freshest collected snapshot.
   * Read after page-facing actions; null when the page cannot be read.
   */
  settledState(): Promise<SettledPageState | null>
  /** Facts about a snapshot ref for risk assessment; undefined when the ref no longer resolves. */
  describeRef(ref: number): Promise<SnapshotRef | undefined>
  /**
   * Every link ref's whole href off the freshest collected snapshot, in ref
   * order (#258, ADR 0050): what the Composed Address rail offers from a
   * page, because the formatted ref line cuts an href over the snapshot's
   * cap. Read after page-facing actions; null when the page cannot be read.
   */
  linkHrefs(): Promise<readonly string[] | null>
  /**
   * Every link of the whole page, in document order (#303, note on ADR
   * 0070): what a Result Pick's candidates are made from, because the refs
   * are the links in view and a listing's results often begin below the
   * fold. A link that has no size, is hidden, inert or inside a dialog is
   * left out. Read in place, so no ref is renumbered; null when the page
   * cannot be read, or is no longer the page the last result printed.
   */
  pageLinks(): Promise<readonly PageLink[] | null>
  /**
   * The page's refs as data, those numbers shown (ADR 0033): what a
   * Command is read against (#324). Collected at speech start so the list
   * is in hand at the Endpoint; the click that follows is not refused. A
   * Tier-1 consent wall open over the page is dismissed first, as on a
   * landing (ADR 0061), so no reading is asked over one.
   */
  collectPage(): Promise<PageSnapshot>
  /** Whether a dialog is open over the page, read in place — no collect, no consent dismissal; absent, a collect answers. */
  dialogOpen?(): Promise<boolean>
  /** Clear the focused editable element (#324): the `clear` verb. Answers what was cleared. */
  clearFocused(): Promise<string>
}

/** Extra browser capability required only by visual grounding. */
export interface VisualGroundingController {
  /** Structured current-page snapshot used by deterministic grounding. */
  groundingSnapshot(): Promise<PageSnapshot>
  /** Register the live element at viewport coordinates as a normal, risk-described ref. */
  refAtPoint(point: ViewportPoint): Promise<number>
  /**
   * Record that this number was handed to the model (ADR 0033). A grounding
   * round answers with one ref out of a collect the model never read as a
   * page, so that number has to become a shown number or the click after it
   * would be refused. `refAtPoint` records its own.
   */
  showRef(ref: number): Promise<void>
}
