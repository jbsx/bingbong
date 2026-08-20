import type { BrowserPaneState, PaneRect } from '../core/browser/paneState'
import type { PipelineEvent } from '../core/pipeline/events'
import type { AppSettings } from '../core/settings/settings'
import type { VoiceErrorEvent, VoiceHeardEvent, VoiceState } from '../core/voice/ipcChannels'
import type { LaunchConfig } from '../core/app/launchConfig'
import type { UsageSummary } from '../core/agent/spendEstimate'
import type { RecordedEntry, RunRecord } from '../core/history/historyStore'
import type { FeedPanelMode, FeedPanelState } from '../core/panel/feedPanelState'

export type { BrowserPaneState, PaneRect }
export type { PipelineEvent }
export type { AppSettings }
export type { VoiceErrorEvent, VoiceHeardEvent, VoiceState }
export type { LaunchConfig }
export type { UsageSummary }
export type { RecordedEntry, RunRecord }

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
  /** Answer an open ask_user window with free text (the dashboard card). */
  resolveAsk(askId: string, answer: string): Promise<void>
  /** Abort the active run; false means there was no run to stop. */
  abort(): Promise<boolean>
  /**
   * Steer the active run from the feed panel's box (#46) — the same seam
   * as spoken steering. False means nothing was taken.
   */
  steer(directive: string): Promise<boolean>
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
  onError(listener: (error: VoiceErrorEvent) => void): () => void
}

export interface BingbongHistoryApi {
  /** Persisted transcript entries, oldest first — hydrates the dashboard on launch. */
  recentEntries(): Promise<RecordedEntry[]>
  /** Persisted run records, oldest first. */
  recentRuns(): Promise<RunRecord[]>
  /** Persist a renderer-side mic/capture error and return its shared timestamp. */
  recordVoiceError(message: string): Promise<number | null>
}

export interface BingbongFeedPanelApi {
  /** The current folded state — pulled on mount; changes arrive via onState. */
  getState(): Promise<FeedPanelState | null>
  /** Switch overlay/docked layout mode (persisted by the dashboard). */
  setMode(mode: FeedPanelMode): void
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
  subagents: BingbongSubagentsApi
  usage: BingbongUsageApi
  tts: BingbongTtsApi
  voice: BingbongVoiceApi
  history: BingbongHistoryApi
  feedPanel: BingbongFeedPanelApi
}

declare global {
  interface Window {
    bingbong: BingbongApi
  }
}

export {}
