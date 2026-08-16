import { contextBridge, ipcRenderer } from 'electron'
import { BROWSER_IPC } from '../core/browser/ipcChannels'
import type { BrowserPaneState, PaneRect } from '../core/browser/paneState'

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
})
