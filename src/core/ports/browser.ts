import type { BlockerPageFacts } from '../browser/blockerNudge'
import type { PageSnapshot, SnapshotRef } from '../browser/snapshot'

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
  readPage(): Promise<string>
  click(ref: number): Promise<string>
  type(ref: number, text: string): Promise<string>
  scroll(direction: 'up' | 'down'): Promise<string>
  /** The visible viewport as a JPEG; with options, one magnified region of it. */
  screenshot(options?: ScreenshotOptions): Promise<Uint8Array>
  back(): Promise<string>
  forward(): Promise<string>
  /** Inject a shortcut key (times consecutive presses) on the focused page. */
  pressKey(press: KeyPress, times?: number): Promise<void>
  /** Read actual state from the page's active media element after controls settle. */
  mediaState(): Promise<MediaState | null>
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
