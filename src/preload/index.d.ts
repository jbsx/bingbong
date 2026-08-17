import type { BrowserPaneState, PaneRect } from '../core/browser/paneState'
import type { PipelineEvent } from '../core/pipeline/events'
import type { AppSettings } from '../core/settings/settings'

export type { BrowserPaneState, PaneRect }
export type { PipelineEvent }
export type { AppSettings }

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

export interface BingbongSettingsApi {
  get(): Promise<AppSettings>
  update(settings: AppSettings): Promise<AppSettings>
  onChanged(listener: (settings: AppSettings) => void): () => void
}

export interface BingbongTtsApi {
  /** Installed piper voice ids, for the settings picker. */
  listVoices(): Promise<string[]>
}

export interface BingbongApi {
  version: string
  browser: BingbongBrowserApi
  assistant: BingbongAssistantApi
  settings: BingbongSettingsApi
  tts: BingbongTtsApi
}

declare global {
  interface Window {
    bingbong: BingbongApi
  }
}

export {}
