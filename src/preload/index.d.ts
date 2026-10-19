import type { BrowserPaneState, PaneRect } from '../core/browser/paneState'
import type { LastPage } from '../core/browser/lastPage'
import type { TimerState } from '../core/timer/timer'
import type { NowPlaying } from '../core/music/nowPlaying'
import type { UsageSnapshot } from '../core/usage/usage'
import type { CalendarEvent, CalendarRange } from '../core/calendar/calendar'
import type { NewsHorizons } from '../core/news/newsDesk'
import type { ScaleStatus } from '../core/scale/ipcChannels'
import type { WeighIn } from '../core/scale/weighIns'
import type { WeighInPopupState } from '../core/scale/weighInPopup'
import type { PipelineEvent } from '../core/pipeline/events'
import type { AppSettings } from '../core/settings/settings'
import type { VoiceErrorEvent, VoiceHeardEvent, VoicePartialEvent, VoiceState } from '../core/voice/ipcChannels'
import type { LaunchConfig } from '../core/app/launchConfig'
import type { FeedPanelMode, FeedPanelState } from '../core/panel/feedPanelState'

export type { BrowserPaneState, PaneRect }
export type { LastPage }
export type { TimerState }
export type { NowPlaying }
export type { UsageSnapshot }
export type { CalendarEvent, CalendarRange }
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
  /** The Last Page (CONTEXT.md): the page the pane last showed, kept across restarts; null before any. */
  getLastPage(): Promise<LastPage | null>
  onLastPage(listener: (page: LastPage | null) => void): () => void
}

export interface BingbongIdleApi {
  /** The idle shortcut (Ctrl/Cmd+Shift+L) was pressed: enter the Idle Screen now. */
  onEnter(listener: () => void): () => void
  /** Tell main whether the Idle Screen is up — while it is, a typed key goes to the Prompt Bar. */
  reportShown(shown: boolean): void
  /** A key typed on the Idle Screen went to the Prompt Bar: wake the dashboard. */
  onWake(listener: () => void): () => void
}

export interface BingbongTimerApi {
  /** The Timer (CONTEXT.md): off, running to `endsAt`, or ringing. */
  get(): Promise<TimerState>
  onChange(listener: (state: TimerState) => void): () => void
}

export interface BingbongMusicApi {
  /** The Player's Now Playing (#344); null when it holds no song. */
  get(): Promise<NowPlaying | null>
  onChange(listener: (nowPlaying: NowPlaying | null) => void): () => void
}

export interface BingbongUsageApi {
  /** The AI usage dashboard's Codex and Claude gauges and history; null when no dashboard URL is set. Rejects when it is unreachable. */
  get(): Promise<UsageSnapshot | null>
}

export interface BingbongCalendarApi {
  /** The Calendar (CONTEXT.md): every source's events overlapping `range`, by start. */
  events(range: CalendarRange): Promise<CalendarEvent[]>
}

export interface BingbongNewsApi {
  /** The News card's Today's Highlight and Big News, each with its Story Image (CONTEXT.md); null when there has never been a highlight or the Interest Profile is empty. Main fetches at most hourly. */
  horizons(): Promise<NewsHorizons | null>
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
  /** Text typed on the Idle Screen, for the Prompt Bar (overlay only). */
  onTyped(listener: (text: string) => void): () => void
}

export interface BingbongWeightApi {
  /** Every Weigh-in (CONTEXT.md), oldest first. */
  list(): Promise<WeighIn[]>
  /** Deletes the Weigh-in at that time (a mis-weigh, a guest); answers the rest. */
  remove(at: number): Promise<WeighIn[]>
  /** Gives the Weigh-in at that time to another Person (a wrong guess fixed); answers them all. */
  move(at: number, person: string): Promise<WeighIn[]>
  /** Removes a Person from settings with every Weigh-in of theirs (never Jaish); answers the rest. */
  removePerson(person: string): Promise<WeighIn[]>
  onChange(listener: (weighIns: WeighIn[]) => void): () => void
  /** The Weigh-in pop-up's state, which main folds from the scale's readings. */
  popup(): Promise<WeighInPopupState>
  onPopup(listener: (state: WeighInPopupState) => void): () => void
  /** The Scale Listener's state, for the settings Weight section. */
  status(): Promise<ScaleStatus>
  onStatus(listener: (status: ScaleStatus) => void): () => void
}

export interface BingbongApi {
  version: string
  /** Launch flags/env snapshot (kiosk mode, idle timeout). */
  app: LaunchConfig
  browser: BingbongBrowserApi
  idle: BingbongIdleApi
  timer: BingbongTimerApi
  music: BingbongMusicApi
  usage: BingbongUsageApi
  calendar: BingbongCalendarApi
  news: BingbongNewsApi
  weight: BingbongWeightApi
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
