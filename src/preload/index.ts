import { contextBridge, ipcRenderer } from 'electron'
import { BROWSER_IPC } from '../core/browser/ipcChannels'
import { PIPELINE_IPC } from '../core/pipeline/ipcChannels'
import { SETTINGS_IPC } from '../core/settings/ipcChannels'
import { TTS_IPC } from '../core/tts/ipcChannels'
import { VOICE_IPC } from '../core/voice/ipcChannels'
import { LEARNED_TERMS_IPC } from '../core/voice/learnedTermsIpcChannels'
import { PANEL_IPC } from '../core/panel/ipcChannels'
import type { FeedPanelMode, FeedPanelState } from '../core/panel/feedPanelState'
import { resolveLaunchConfig } from '../core/app/launchConfig'
import type { BrowserPaneState, PaneRect } from '../core/browser/paneState'
import type { LastPage } from '../core/browser/lastPage'
import { TIMER_IPC } from '../core/timer/ipcChannels'
import { WEATHER_IPC } from '../core/weather/ipcChannels'
import type { WeatherReport } from '../core/weather/weather'
import { MUSIC_IPC } from '../core/music/ipcChannels'
import type { NowPlaying } from '../core/music/nowPlaying'
import { CALENDAR_IPC } from '../core/calendar/ipcChannels'
import { NEWS_IPC } from '../core/news/ipcChannels'
import type { TopRepo } from '../core/news/topRepos'
import { WEIGHT_IPC, type ScaleStatus } from '../core/scale/ipcChannels'
import type { WeighIn } from '../core/scale/weighIns'
import type { WeighInPopupState } from '../core/scale/weighInPopup'
import type { CalendarEvent, CalendarRange } from '../core/calendar/calendar'
import { IDLE_IPC, type IdleShown } from '../core/idle/ipcChannels'
import { APP_VIEW_IPC, type AppViewShown } from '../core/app/ipcChannels'
import type { TimerState } from '../core/timer/timer'
import { USAGE_IPC } from '../core/usage/ipcChannels'
import type { UsageSnapshot } from '../core/usage/usage'
import type { PipelineEvent } from '../core/pipeline/events'
import type { AppSettings } from '../core/settings/settings'
import type { EnvFileView } from '../core/settings/envEntries'
import type { HostFinding } from '../core/settings/hostFindings'
import type { VoiceErrorEvent, VoiceHeardEvent, VoicePartialEvent, VoiceState } from '../core/voice/ipcChannels'

// Launch config is a snapshot: the flags and env can't change after start.
const launch = resolveLaunchConfig(process.argv, process.env)

contextBridge.exposeInMainWorld('bingbong', {
  version: '0.1.0',
  app: launch,
  browser: {
    navigate: (input: string): Promise<boolean> => ipcRenderer.invoke(BROWSER_IPC.navigate, input),
    goBack: (): Promise<void> => ipcRenderer.invoke(BROWSER_IPC.goBack),
    goForward: (): Promise<void> => ipcRenderer.invoke(BROWSER_IPC.goForward),
    getState: (): Promise<BrowserPaneState> => ipcRenderer.invoke(BROWSER_IPC.getState),
    reportPaneRect: (rect: PaneRect): void => {
      ipcRenderer.send(BROWSER_IPC.paneBounds, rect)
    },
    onState: (listener: (state: BrowserPaneState) => void): (() => void) => {
      const wrapped = (_event: unknown, state: BrowserPaneState): void => listener(state)
      ipcRenderer.on(BROWSER_IPC.stateChanged, wrapped)
      return () => ipcRenderer.removeListener(BROWSER_IPC.stateChanged, wrapped)
    },
    getLastPage: (): Promise<LastPage | null> => ipcRenderer.invoke(BROWSER_IPC.getLastPage),
    onLastPage: (listener: (page: LastPage | null) => void): (() => void) => {
      const wrapped = (_event: unknown, page: LastPage | null): void => listener(page)
      ipcRenderer.on(BROWSER_IPC.lastPageChanged, wrapped)
      return () => ipcRenderer.removeListener(BROWSER_IPC.lastPageChanged, wrapped)
    },
  },
  view: {
    onShow: (listener: (shown: AppViewShown) => void): (() => void) => {
      const wrapped = (_event: unknown, shown: AppViewShown): void => listener(shown)
      ipcRenderer.on(APP_VIEW_IPC.show, wrapped)
      return () => ipcRenderer.removeListener(APP_VIEW_IPC.show, wrapped)
    },
    reportShown: (shown: AppViewShown): void => {
      ipcRenderer.send(APP_VIEW_IPC.shown, shown)
    },
  },
  idle: {
    onEnter: (listener: () => void): (() => void) => {
      const wrapped = (): void => listener()
      ipcRenderer.on(IDLE_IPC.enter, wrapped)
      return () => ipcRenderer.removeListener(IDLE_IPC.enter, wrapped)
    },
    reportShown: (shown: IdleShown): void => {
      ipcRenderer.send(IDLE_IPC.shown, shown)
    },
    onTyped: (listener: (text: string) => void): (() => void) => {
      const wrapped = (_event: unknown, text: string): void => listener(text)
      ipcRenderer.on(IDLE_IPC.typed, wrapped)
      return () => ipcRenderer.removeListener(IDLE_IPC.typed, wrapped)
    },
  },
  timer: {
    get: (): Promise<TimerState> => ipcRenderer.invoke(TIMER_IPC.get),
    onChange: (listener: (state: TimerState) => void): (() => void) => {
      const wrapped = (_event: unknown, state: TimerState): void => listener(state)
      ipcRenderer.on(TIMER_IPC.changed, wrapped)
      return () => ipcRenderer.removeListener(TIMER_IPC.changed, wrapped)
    },
  },
  weather: {
    report: (report: WeatherReport | null): void => {
      ipcRenderer.send(WEATHER_IPC.report, report)
    },
  },
  music: {
    get: (): Promise<NowPlaying | null> => ipcRenderer.invoke(MUSIC_IPC.get),
    onChange: (listener: (nowPlaying: NowPlaying | null) => void): (() => void) => {
      const wrapped = (_event: unknown, nowPlaying: NowPlaying | null): void => listener(nowPlaying)
      ipcRenderer.on(MUSIC_IPC.changed, wrapped)
      return () => ipcRenderer.removeListener(MUSIC_IPC.changed, wrapped)
    },
  },
  usage: {
    get: (): Promise<UsageSnapshot | null> => ipcRenderer.invoke(USAGE_IPC.get),
  },
  calendar: {
    events: (range: CalendarRange): Promise<CalendarEvent[]> => ipcRenderer.invoke(CALENDAR_IPC.events, range),
  },
  news: {
    repos: (): Promise<TopRepo[] | null> => ipcRenderer.invoke(NEWS_IPC.repos),
  },
  weight: {
    list: (): Promise<WeighIn[]> => ipcRenderer.invoke(WEIGHT_IPC.list),
    remove: (at: number): Promise<WeighIn[]> => ipcRenderer.invoke(WEIGHT_IPC.remove, at),
    move: (at: number, person: string): Promise<WeighIn[]> => ipcRenderer.invoke(WEIGHT_IPC.move, at, person),
    removePerson: (person: string): Promise<WeighIn[]> => ipcRenderer.invoke(WEIGHT_IPC.removePerson, person),
    onChange: (listener: (weighIns: WeighIn[]) => void): (() => void) => {
      const wrapped = (_event: unknown, weighIns: WeighIn[]): void => listener(weighIns)
      ipcRenderer.on(WEIGHT_IPC.changed, wrapped)
      return () => ipcRenderer.removeListener(WEIGHT_IPC.changed, wrapped)
    },
    popup: (): Promise<WeighInPopupState> => ipcRenderer.invoke(WEIGHT_IPC.popup),
    onPopup: (listener: (state: WeighInPopupState) => void): (() => void) => {
      const wrapped = (_event: unknown, state: WeighInPopupState): void => listener(state)
      ipcRenderer.on(WEIGHT_IPC.popupChanged, wrapped)
      return () => ipcRenderer.removeListener(WEIGHT_IPC.popupChanged, wrapped)
    },
    reportPopupRect: (rect: PaneRect): void => {
      ipcRenderer.send(WEIGHT_IPC.popupRect, { rect })
    },
    status: (): Promise<ScaleStatus> => ipcRenderer.invoke(WEIGHT_IPC.status),
    onStatus: (listener: (status: ScaleStatus) => void): (() => void) => {
      const wrapped = (_event: unknown, status: ScaleStatus): void => listener(status)
      ipcRenderer.on(WEIGHT_IPC.statusChanged, wrapped)
      return () => ipcRenderer.removeListener(WEIGHT_IPC.statusChanged, wrapped)
    },
  },
  assistant: {
    submit: (text: string): Promise<boolean> => ipcRenderer.invoke(PIPELINE_IPC.submit, text),
    abort: (): Promise<boolean> => ipcRenderer.invoke(PIPELINE_IPC.abort),
    onEvent: (listener: (event: PipelineEvent) => void): (() => void) => {
      const wrapped = (_event: unknown, event: PipelineEvent): void => listener(event)
      ipcRenderer.on(PIPELINE_IPC.event, wrapped)
      return () => ipcRenderer.removeListener(PIPELINE_IPC.event, wrapped)
    },
  },
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke(SETTINGS_IPC.get),
    update: (settings: AppSettings): Promise<AppSettings> => ipcRenderer.invoke(SETTINGS_IPC.update, settings),
    onChanged: (listener: (settings: AppSettings) => void): (() => void) => {
      const wrapped = (_event: unknown, settings: AppSettings): void => listener(settings)
      ipcRenderer.on(SETTINGS_IPC.changed, wrapped)
      return () => ipcRenderer.removeListener(SETTINGS_IPC.changed, wrapped)
    },
    envFile: (): Promise<EnvFileView> => ipcRenderer.invoke(SETTINGS_IPC.envList),
    setEnv: (key: string, value: string | null): Promise<EnvFileView> => ipcRenderer.invoke(SETTINGS_IPC.envSet, key, value),
    openEnvFile: (): Promise<string> => ipcRenderer.invoke(SETTINGS_IPC.envOpen),
    hostChecks: (): Promise<HostFinding[]> => ipcRenderer.invoke(SETTINGS_IPC.hostChecks),
  },
  feedPanel: {
    getState: (): Promise<FeedPanelState | null> => ipcRenderer.invoke(PANEL_IPC.get),
    setMode: (mode: FeedPanelMode): void => {
      ipcRenderer.send(PANEL_IPC.setMode, { mode })
    },
    setWidth: (width: number): void => {
      ipcRenderer.send(PANEL_IPC.setWidth, { width })
    },
    beginResize: (): void => {
      ipcRenderer.send(PANEL_IPC.beginResize)
    },
    endResize: (): void => {
      ipcRenderer.send(PANEL_IPC.endResize)
    },
    toggle: (): void => {
      ipcRenderer.send(PANEL_IPC.toggle)
    },
    reportRect: (rect: PaneRect): void => {
      ipcRenderer.send(PANEL_IPC.rect, { rect })
    },
    onState: (listener: (state: FeedPanelState) => void): (() => void) => {
      const wrapped = (_event: unknown, state: FeedPanelState): void => listener(state)
      ipcRenderer.on(PANEL_IPC.state, wrapped)
      return () => ipcRenderer.removeListener(PANEL_IPC.state, wrapped)
    },
  },
  tts: {
    listVoices: (): Promise<string[]> => ipcRenderer.invoke(TTS_IPC.listVoices),
  },
  learnedTerms: {
    list: (): Promise<readonly string[]> => ipcRenderer.invoke(LEARNED_TERMS_IPC.list),
    add: (term: string): Promise<boolean> => ipcRenderer.invoke(LEARNED_TERMS_IPC.add, term),
    remove: (term: string): Promise<boolean> => ipcRenderer.invoke(LEARNED_TERMS_IPC.remove, term),
    onChanged: (listener: (terms: readonly string[]) => void): (() => void) => {
      const wrapped = (_event: unknown, terms: readonly string[]): void => listener(terms)
      ipcRenderer.on(LEARNED_TERMS_IPC.changed, wrapped)
      return () => ipcRenderer.removeListener(LEARNED_TERMS_IPC.changed, wrapped)
    },
  },
  voice: {
    arm: (): Promise<void> => ipcRenderer.invoke(VOICE_IPC.arm),
    disarm: (): Promise<void> => ipcRenderer.invoke(VOICE_IPC.disarm),
    sendAudio: (chunk: Float32Array): void => {
      ipcRenderer.send(VOICE_IPC.audio, chunk)
    },
    getState: (): Promise<VoiceState> => ipcRenderer.invoke(VOICE_IPC.getState),
    onState: (listener: (state: VoiceState) => void): (() => void) => {
      const wrapped = (_event: unknown, state: VoiceState): void => listener(state)
      ipcRenderer.on(VOICE_IPC.stateChanged, wrapped)
      return () => ipcRenderer.removeListener(VOICE_IPC.stateChanged, wrapped)
    },
    onHeard: (listener: (heard: VoiceHeardEvent) => void): (() => void) => {
      const wrapped = (_event: unknown, heard: VoiceHeardEvent): void => listener(heard)
      ipcRenderer.on(VOICE_IPC.heard, wrapped)
      return () => ipcRenderer.removeListener(VOICE_IPC.heard, wrapped)
    },
    onError: (listener: (error: VoiceErrorEvent) => void): (() => void) => {
      const wrapped = (_event: unknown, error: VoiceErrorEvent): void => listener(error)
      ipcRenderer.on(VOICE_IPC.error, wrapped)
      return () => ipcRenderer.removeListener(VOICE_IPC.error, wrapped)
    },
    onPartial: (listener: (partial: VoicePartialEvent) => void): (() => void) => {
      const wrapped = (_event: unknown, partial: VoicePartialEvent): void => listener(partial)
      ipcRenderer.on(VOICE_IPC.partial, wrapped)
      return () => ipcRenderer.removeListener(VOICE_IPC.partial, wrapped)
    },
  },
})
