import type { BrowserPaneState, PaneRect } from '../core/browser/paneState'
import type { PipelineEvent } from '../core/pipeline/events'
import type { AppSettings } from '../core/settings/settings'
import type { VoiceErrorEvent, VoiceHeardEvent, VoicePartialEvent, VoiceState } from '../core/voice/ipcChannels'
import type { LaunchConfig } from '../core/app/launchConfig'
import type { FeedPanelMode, FeedPanelState } from '../core/panel/feedPanelState'

export type { BrowserPaneState, PaneRect }
export type { PipelineEvent }
export type { AppSettings }
export type { VoiceErrorEvent, VoiceHeardEvent, VoicePartialEvent, VoiceState }
export type { LaunchConfig }

export interface BingbongBrowserApi {
  navigate(input: string): Promise<boolean>
  goBack(): Promise<void>
  goForward(): Promise<void>
  getState(): Promise<BrowserPaneState>
  reportPaneRect(rect: PaneRect): void
  onState(listener: (state: BrowserPaneState) => void): () => void
}

export interface BingbongAssistantApi {
  /** Run one typed Command; false only when the text is blank — a Command in flight is superseded (#324). */
  submit(text: string): Promise<boolean>
  /** Abort the Command in flight; false means there was none to stop. */
  abort(): Promise<boolean>
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

export interface BingbongLearnedTermsApi {
  /** The admitted Learned Terms, admission order (ADR 0022). */
  list(): Promise<readonly string[]>
  /** Add one directly; false when invalid or already seed vocabulary. */
  add(term: string): Promise<boolean>
  /** Remove one and plant a rejection auto-proposals cannot cross. */
  remove(term: string): Promise<boolean>
  /** The admitted list changed (auto-admission or a manual edit). */
  onChanged(listener: (terms: readonly string[]) => void): () => void
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
  onError(listener: (error: VoiceErrorEvent) => void): () => void
  /** The live partial transcript while the user speaks (#324); '' clears it. */
  onPartial(listener: (partial: VoicePartialEvent) => void): () => void
}

export interface BingbongFeedPanelApi {
  /** The current folded state — pulled on mount; changes arrive via onState. */
  getState(): Promise<FeedPanelState | null>
  /** Switch overlay/docked layout mode (persisted by the dashboard). */
  setMode(mode: FeedPanelMode): void
  /** Set the panel width in px — main clamps to [320, 75% of window]. */
  setWidth(width: number): void
  /** A width drag started: cloak the view so the overlay tracks the pointer window-wide. */
  beginResize(): void
  /** The width drag ended: restore the view bounds from the folded width. */
  endResize(): void
  /** Flip the peaked/collapsed state (header button, shortcut, edge tab). */
  toggle(): void
  /** Report the panel slot's rect — drives the native overlay view's bounds. */
  reportRect(rect: PaneRect): void
  onState(listener: (state: FeedPanelState) => void): () => void
}

export interface BingbongApi {
  version: string
  /** Launch flags/env snapshot (kiosk mode, idle timeout). */
  app: LaunchConfig
  browser: BingbongBrowserApi
  assistant: BingbongAssistantApi
  settings: BingbongSettingsApi
  tts: BingbongTtsApi
  learnedTerms: BingbongLearnedTermsApi
  voice: BingbongVoiceApi
  feedPanel: BingbongFeedPanelApi
}

declare global {
  interface Window {
    bingbong: BingbongApi
  }
}

export {}
