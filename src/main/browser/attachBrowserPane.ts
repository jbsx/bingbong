import { BrowserWindow, ipcMain } from 'electron'
import { BROWSER_IPC } from '../../core/browser/ipcChannels'
import { isPaneRect } from '../../core/browser/paneState'
import type { BrowserPane } from './createBrowserPane'
import type { WindowEventPublisher } from '../session/windowEventPublisher'

const panes = new WeakMap<BrowserWindow, BrowserPane>()

function paneFor(webContents: Electron.WebContents): BrowserPane | undefined {
  const win = BrowserWindow.fromWebContents(webContents)
  return win ? panes.get(win) : undefined
}

export function registerBrowserIpc(): void {
  ipcMain.handle(BROWSER_IPC.navigate, (event, input: unknown) => {
    const pane = paneFor(event.sender)
    return pane !== undefined && typeof input === 'string' && pane.navigate(input)
  })
  ipcMain.handle(BROWSER_IPC.goBack, (event) => {
    paneFor(event.sender)?.goBack()
  })
  ipcMain.handle(BROWSER_IPC.goForward, (event) => {
    paneFor(event.sender)?.goForward()
  })
  ipcMain.handle(BROWSER_IPC.getState, (event) => paneFor(event.sender)?.state())
  ipcMain.on(BROWSER_IPC.paneBounds, (event, rect: unknown) => {
    if (isPaneRect(rect)) paneFor(event.sender)?.setPaneRect(rect)
  })
}

export function attachBrowserPaneToWindow(
  pane: BrowserPane,
  win: BrowserWindow,
  publisher: Pick<WindowEventPublisher, 'publish'>,
): void {
  panes.set(win, pane)
  win.contentView.addChildView(pane.view)
  // A pane no dashboard has shown yet is laid out off the window at its size, so a Command typed over the Idle Screen reads a real page (ADR 0079).
  pane.setHost(win)

  const unsubscribe = pane.onState((state) => {
    publisher.publish({ source: 'browser', state })
  })
  win.on('closed', () => {
    unsubscribe()
    panes.delete(win)
  })
}
