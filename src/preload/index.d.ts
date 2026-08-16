import type { BrowserPaneState, PaneRect } from '../core/browser/paneState'

export type { BrowserPaneState, PaneRect }

export interface BingbongBrowserApi {
  navigate(input: string): Promise<boolean>
  goBack(): Promise<void>
  goForward(): Promise<void>
  getState(): Promise<BrowserPaneState>
  reportPaneRect(rect: PaneRect): void
  onState(listener: (state: BrowserPaneState) => void): () => void
}

export interface BingbongApi {
  version: string
  browser: BingbongBrowserApi
}

declare global {
  interface Window {
    bingbong: BingbongApi
  }
}

export {}
