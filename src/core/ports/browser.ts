import type { SnapshotRef } from '../browser/snapshot'

export interface BrowserState {
  url: string | null
  title: string | null
}

export interface BrowserController {
  navigate(url: string): Promise<void>
  readPage(): Promise<string>
  click(ref: number): Promise<void>
  type(ref: number, text: string): Promise<void>
  scroll(direction: 'up' | 'down'): Promise<void>
  screenshot(): Promise<Uint8Array>
  back(): Promise<void>
  state(): BrowserState
  /** Facts about a snapshot ref for risk assessment; undefined when the ref no longer resolves. */
  describeRef(ref: number): Promise<SnapshotRef | undefined>
}
