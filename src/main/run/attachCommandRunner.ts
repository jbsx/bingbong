import { BrowserWindow, ipcMain, type WebContents } from 'electron'
import { PIPELINE_IPC } from '../../core/pipeline/ipcChannels'
import type { CommandRunner } from './commandRunner'

// Glue between the dashboard and the window's command runner: submit a
// command (prompt bar or voice), abort it. The runner owns admission and
// publication; this file owns only window routing and IPC.

const runners = new WeakMap<BrowserWindow, CommandRunner>()

export function runnerFor(win: BrowserWindow): CommandRunner | undefined {
  return runners.get(win)
}

/** Runs one command through the window's runner; false when there is no window or it is busy. */
export async function runCommand(win: BrowserWindow, text: string, turnId?: string, truncated?: boolean): Promise<boolean> {
  const runner = runners.get(win)
  if (!runner) return false
  return runner.run(text, turnId, truncated)
}

export function registerCommandRunnerIpc(): void {
  ipcMain.handle(PIPELINE_IPC.submit, async (event, text: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    if (typeof text !== 'string' || text.trim() === '') return false
    return runCommand(win, text.trim())
  })

  ipcMain.handle(PIPELINE_IPC.abort, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const runner = win ? runners.get(win) : undefined
    return runner ? runner.abort() : false
  })
}

export function attachCommandRunnerToWindow(runner: CommandRunner, win: BrowserWindow): void {
  runners.set(win, runner)
  const detachAbortHotkey = attachAbortHotkey(runner, win.webContents)
  win.on('closed', () => runners.delete(win))
  win.on('closed', detachAbortHotkey)
}

/** Capture Escape when the embedded browser, rather than React, owns focus. */
export function attachAbortHotkey(runner: CommandRunner, contents: WebContents): () => void {
  const onBeforeInput = (event: Electron.Event, input: Electron.Input) => {
    if (input.type === 'keyDown' && input.key === 'Escape' && runner.abort()) {
      event.preventDefault()
    }
  }
  contents.on('before-input-event', onBeforeInput)
  return () => contents.removeListener('before-input-event', onBeforeInput)
}
