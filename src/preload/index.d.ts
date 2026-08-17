import type { BrowserPaneState, PaneRect } from '../core/browser/paneState'
import type { PipelineEvent } from '../core/pipeline/events'
import type { AppSettings } from '../core/settings/settings'
import type { VoiceHeardEvent, VoiceState } from '../core/voice/ipcChannels'
import type { LaunchConfig } from '../core/app/launchConfig'
import type { UsageSummary } from '../core/agent/spendEstimate'

export type { BrowserPaneState, PaneRect }
export type { PipelineEvent }
export type { AppSettings }
export type { VoiceHeardEvent, VoiceState }
export type { LaunchConfig }
export type { UsageSummary }

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

export interface BingbongSubagentsApi {
  /** Report a live tab viewport's rect (drives the WebContentsView bounds). */
  reportTabRect(agentId: string, rect: PaneRect): void
  /** Reopen a closed subagent tab from its retained card. */
  reopenTab(agentId: string): Promise<boolean>
  /** Cancel a running subagent (the card's Cancel button). */
  cancel(agentId: string): Promise<boolean>
}

export interface BingbongUsageApi {
  /** Today's spend estimate (warn-only) for the settings page. */
  getToday(): Promise<UsageSummary>
}

export interface BingbongTtsApi {
  /** Installed piper voice ids, for the settings picker. */
  listVoices(): Promise<string[]>
}

export interface BingbongVoiceApi {
  arm(): Promise<void>
  disarm(): Promise<void>
  /** One chunk of mono 16 kHz PCM from the mic worklet (multiple of 512 samples). */
  sendAudio(chunk: Float32Array): void
  /** Current voice state — pulled on mount since events can predate the renderer. */
  getState(): Promise<VoiceState>
  onState(listener: (state: VoiceState) => void): () => void
  onHeard(listener: (heard: VoiceHeardEvent) => void): () => void
  onError(listener: (error: { message: string }) => void): () => void
}

export interface BingbongApi {
  version: string
  /** Launch flags/env snapshot (kiosk mode, idle timeout). */
  app: LaunchConfig
  browser: BingbongBrowserApi
  assistant: BingbongAssistantApi
  settings: BingbongSettingsApi
  subagents: BingbongSubagentsApi
  usage: BingbongUsageApi
  tts: BingbongTtsApi
  voice: BingbongVoiceApi
}

declare global {
  interface Window {
    bingbong: BingbongApi
  }
}

export {}
