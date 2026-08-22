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
 * A keyboard shortcut to inject on the focused page: a single character
 * ('k') or a named key ('ArrowUp'), optionally with Shift. Shortcuts never
 * carry text — they trigger page key handlers, they do not type.
 */
export interface KeyPress {
  key: string
  shift?: boolean
}

export interface BrowserController {
  navigate(url: string): Promise<string>
  readPage(): Promise<string>
  click(ref: number): Promise<string>
  type(ref: number, text: string): Promise<string>
  scroll(direction: 'up' | 'down'): Promise<string>
  screenshot(): Promise<Uint8Array>
  back(): Promise<string>
  forward(): Promise<string>
  /** Inject a shortcut key (times consecutive presses) on the focused page. */
  pressKey(press: KeyPress, times?: number): Promise<void>
  /** Read actual state from the page's active media element after controls settle. */
  mediaState(): Promise<MediaState | null>
  state(): BrowserState
  /** Facts about a snapshot ref for risk assessment; undefined when the ref no longer resolves. */
  describeRef(ref: number): Promise<SnapshotRef | undefined>
}

/** Extra browser capability required only by visual grounding. */
export interface VisualGroundingController {
  /** Structured current-page snapshot used by deterministic grounding. */
  groundingSnapshot(): Promise<PageSnapshot>
  /** Register the live element at viewport coordinates as a normal, risk-described ref. */
  refAtPoint(point: ViewportPoint): Promise<number>
}
