import { contextBridge, ipcRenderer } from 'electron'
import { BROWSER_IPC } from '../core/browser/ipcChannels'
import { PIPELINE_IPC } from '../core/pipeline/ipcChannels'
import type { BrowserPaneState, PaneRect } from '../core/browser/paneState'
import type { PipelineEvent } from '../core/pipeline/events'

contextBridge.exposeInMainWorld('bingbong', {
  version: '0.1.0',
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
    onEvent: (listener: (event: PipelineEvent) => void): (() => void) => {
      const wrapped = (_event: unknown, event: PipelineEvent): void => listener(event)
      ipcRenderer.on(PIPELINE_IPC.event, wrapped)
      return () => ipcRenderer.removeListener(PIPELINE_IPC.event, wrapped)
    },
  },
})
