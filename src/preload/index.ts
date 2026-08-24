import { contextBridge, ipcRenderer } from 'electron'
import { BROWSER_IPC } from '../core/browser/ipcChannels'
import { PIPELINE_IPC } from '../core/pipeline/ipcChannels'
import { SETTINGS_IPC } from '../core/settings/ipcChannels'
import { TTS_IPC } from '../core/tts/ipcChannels'
import { VOICE_IPC } from '../core/voice/ipcChannels'
import { SUBAGENT_IPC } from '../core/agent/subagentIpcChannels'
import { USAGE_IPC } from '../core/settings/usageIpcChannels'
import { HISTORY_IPC } from '../core/history/ipcChannels'
import { PANEL_IPC } from '../core/panel/ipcChannels'
import type { FeedPanelMode, FeedPanelState } from '../core/panel/feedPanelState'
import { resolveLaunchConfig } from '../core/app/launchConfig'
import type { BrowserPaneState, PaneRect } from '../core/browser/paneState'
import type { PipelineEvent } from '../core/pipeline/events'
import type { AppSettings } from '../core/settings/settings'
import type { RoutingStatus } from '../core/agent/modelRouting'
import type { UsageSummary } from '../core/agent/spendEstimate'
import type { VoiceErrorEvent, VoiceHeardEvent, VoiceState } from '../core/voice/ipcChannels'
import type { RecordedEntry, RunRecord, SessionRecord } from '../core/history/historyStore'
import type { SubmissionFeedback } from '../core/session/submissionFeedback'
import { SESSION_IPC, type SessionDecisionRequest } from '../core/session/ipcChannels'

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
  },
  assistant: {
    submit: (text: string): Promise<boolean> => ipcRenderer.invoke(PIPELINE_IPC.submit, text),
    resolveConfirmation: (confirmationId: string, approved: boolean): Promise<void> =>
      ipcRenderer.invoke(PIPELINE_IPC.resolveConfirmation, confirmationId, approved),
    resolveAsk: (askId: string, answer: string): Promise<void> =>
      ipcRenderer.invoke(PIPELINE_IPC.resolveAsk, askId, answer),
    abort: (): Promise<boolean> => ipcRenderer.invoke(PIPELINE_IPC.abort),
    steer: (directive: string): Promise<boolean> => ipcRenderer.invoke(PIPELINE_IPC.steer, directive),
    onEvent: (listener: (event: PipelineEvent) => void): (() => void) => {
      const wrapped = (_event: unknown, event: PipelineEvent): void => listener(event)
      ipcRenderer.on(PIPELINE_IPC.event, wrapped)
      return () => ipcRenderer.removeListener(PIPELINE_IPC.event, wrapped)
    },
    onSubmissionFeedback: (listener: (feedback: SubmissionFeedback) => void): (() => void) => {
      const wrapped = (_event: unknown, feedback: SubmissionFeedback): void => listener(feedback)
      ipcRenderer.on(PIPELINE_IPC.submissionFeedback, wrapped)
      return () => ipcRenderer.removeListener(PIPELINE_IPC.submissionFeedback, wrapped)
    },
  },
  session: {
    extend: (request: SessionDecisionRequest): Promise<boolean> => ipcRenderer.invoke(SESSION_IPC.extend, request),
    decline: (request: SessionDecisionRequest): Promise<boolean> => ipcRenderer.invoke(SESSION_IPC.decline, request),
  },
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke(SETTINGS_IPC.get),
    update: (settings: AppSettings): Promise<AppSettings> => ipcRenderer.invoke(SETTINGS_IPC.update, settings),
    onChanged: (listener: (settings: AppSettings) => void): (() => void) => {
      const wrapped = (_event: unknown, settings: AppSettings): void => listener(settings)
      ipcRenderer.on(SETTINGS_IPC.changed, wrapped)
      return () => ipcRenderer.removeListener(SETTINGS_IPC.changed, wrapped)
    },
    routingStatus: (): Promise<RoutingStatus> => ipcRenderer.invoke(SETTINGS_IPC.routingStatus),
    onRoutingStatusChanged: (listener: (status: RoutingStatus) => void): (() => void) => {
      const wrapped = (_event: unknown, status: RoutingStatus): void => listener(status)
      ipcRenderer.on(SETTINGS_IPC.routingStatusChanged, wrapped)
      return () => ipcRenderer.removeListener(SETTINGS_IPC.routingStatusChanged, wrapped)
    },
  },
  subagents: {
    reportTabRect: (agentId: string, rect: PaneRect): void => {
      ipcRenderer.send(SUBAGENT_IPC.tabRect, agentId, rect)
    },
    reopenTab: (agentId: string): Promise<boolean> => ipcRenderer.invoke(SUBAGENT_IPC.reopenTab, agentId),
    cancel: (agentId: string): Promise<boolean> => ipcRenderer.invoke(SUBAGENT_IPC.cancel, agentId),
  },
  usage: {
    getToday: (): Promise<UsageSummary> => ipcRenderer.invoke(USAGE_IPC.getToday),
  },
  history: {
    recentEntries: (): Promise<RecordedEntry[]> => ipcRenderer.invoke(HISTORY_IPC.recentEntries),
    recentRuns: (): Promise<RunRecord[]> => ipcRenderer.invoke(HISTORY_IPC.recentRuns),
    recentSessions: (): Promise<SessionRecord[]> => ipcRenderer.invoke(HISTORY_IPC.recentSessions),
    recordVoiceError: (message: string): Promise<number | null> =>
      ipcRenderer.invoke(HISTORY_IPC.recordVoiceError, message),
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
  },
})
