import type { SnapshotRef } from '../browser/snapshot'

export interface BrowserState {
  url: string | null
  title: string | null
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
  navigate(url: string): Promise<void>
  readPage(): Promise<string>
  click(ref: number): Promise<void>
  type(ref: number, text: string): Promise<void>
  scroll(direction: 'up' | 'down'): Promise<void>
  screenshot(): Promise<Uint8Array>
  back(): Promise<void>
  /** Inject a shortcut key (times consecutive presses) on the focused page. */
  pressKey(press: KeyPress, times?: number): Promise<void>
  state(): BrowserState
  /** Facts about a snapshot ref for risk assessment; undefined when the ref no longer resolves. */
  describeRef(ref: number): Promise<SnapshotRef | undefined>
}
