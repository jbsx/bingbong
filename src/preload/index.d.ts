import type { BrowserPaneState, PaneRect } from '../core/browser/paneState'
import type { LastPage } from '../core/browser/lastPage'
import type { TimerState } from '../core/timer/timer'
import type { WeatherReport } from '../core/weather/weather'
import type { NowPlaying } from '../core/music/nowPlaying'
import type { UsageSnapshot } from '../core/usage/usage'
import type { CalendarEvent, CalendarRange } from '../core/calendar/calendar'
import type { TopRepo } from '../core/news/topRepos'
import type { ScaleStatus } from '../core/scale/ipcChannels'
import type { WeighIn } from '../core/scale/weighIns'
import type { WeighInPopupState } from '../core/scale/weighInPopup'
import type { PipelineEvent } from '../core/pipeline/events'
import type { AppSettings } from '../core/settings/settings'
import type { EnvFileView } from '../core/settings/envEntries'
import type { HostFinding } from '../core/settings/hostFindings'
import type { VoiceErrorEvent, VoiceHeardEvent, VoicePartialEvent, VoiceState } from '../core/voice/ipcChannels'
import type { LaunchConfig } from '../core/app/launchConfig'
import type { FeedPanelMode, FeedPanelState } from '../core/panel/feedPanelState'
import type { IdleShown } from '../core/idle/ipcChannels'
import type { AppViewShown } from '../core/app/ipcChannels'

export type { BrowserPaneState, PaneRect }
export type { LastPage }
export type { TimerState }
export type { NowPlaying }
export type { UsageSnapshot }
export type { CalendarEvent, CalendarRange }
export type { PipelineEvent }
export type { AppSettings }
export type { EnvFileView, HostFinding }
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

/** The app's full-window views (#420): a Command shows one, and the dashboard says which shows. */
export interface BingbongViewApi {
  /** A Command asked for this view, Settings at this section. */
  onShow(listener: (shown: AppViewShown) => void): () => void
  /** Tell main the view showing now. */
  reportShown(shown: AppViewShown): void
}

export interface BingbongIdleApi {
  /** The idle shortcut (Ctrl/Cmd+Shift+L) was pressed: enter the Idle Screen now. */
  onEnter(listener: () => void): () => void
  /** Tell main whether the Idle Screen is up and its Prompt open — while it is up and closed, a typed key opens the Idle Prompt (#361). */
  reportShown(shown: IdleShown): void
  /** A key typed on the Idle Screen: open the Idle Prompt with this text in it ('' for Space). */
  onTyped(listener: (text: string) => void): () => void
}

export interface BingbongTimerApi {
  /** The Timer (CONTEXT.md): off, running to `endsAt`, or ringing. */
  get(): Promise<TimerState>
  onChange(listener: (state: TimerState) => void): () => void
}

export interface BingbongWeatherApi {
  /** Hands main the report the Idle Screen shows (#402), null when it shows none: a spoken answer says the same. */
  report(report: WeatherReport | null): void
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
  /** The News card's Top Repos (CONTEXT.md): the month's three most-starred trending repositories, each with GLM's one-line summary where written; null when GitHub has never been read. Main reads it at most hourly. */
  repos(): Promise<TopRepo[] | null>
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
  /** The `.env`'s keys; a secret's value is only its last four characters. */
  envFile(): Promise<EnvFileView>
  /** Set one key in the `.env`, or remove it with null; answers the file after. */
  setEnv(key: string, value: string | null): Promise<EnvFileView>
  /** Open the `.env` in the system's editor, creating it if missing; answers an error message, empty on success. */
  openEnvFile(): Promise<string>
  /** What the host checks found missing at boot (#419): aplay, a microphone, a display. */
  hostChecks(): Promise<HostFinding[]>
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
  /** Sizes the pop-up's own view over the browsing pane (0×0 hides it). */
  reportPopupRect(rect: PaneRect): void
  /** The Scale Listener's state, for the settings Weight section. */
  status(): Promise<ScaleStatus>
  onStatus(listener: (status: ScaleStatus) => void): () => void
}

export interface BingbongApi {
  version: string
  /** Launch flags/env snapshot (kiosk mode, idle timeout). */
  app: LaunchConfig
  browser: BingbongBrowserApi
  view: BingbongViewApi
  idle: BingbongIdleApi
  timer: BingbongTimerApi
  weather: BingbongWeatherApi
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
