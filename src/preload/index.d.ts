import type { BrowserPaneState, PaneRect } from '../core/browser/paneState'
import type { PipelineEvent } from '../core/pipeline/events'

export type { BrowserPaneState, PaneRect }
export type { PipelineEvent }

export interface BingbongBrowserApi {
  navigate(input: string): Promise<boolean>
  goBack(): Promise<void>
  goForward(): Promise<void>
  getState(): Promise<BrowserPaneState>
  reportPaneRect(rect: PaneRect): void
  onState(listener: (state: BrowserPaneState) => void): () => void
}

export interface BingbongAssistantApi {
  submit(text: string): Promise<boolean>
  resolveConfirmation(confirmationId: string, approved: boolean): Promise<void>
  onEvent(listener: (event: PipelineEvent) => void): () => void
}

export interface BingbongApi {
  version: string
  browser: BingbongBrowserApi
  assistant: BingbongAssistantApi
}

declare global {
  interface Window {
    bingbong: BingbongApi
  }
}

export {}
