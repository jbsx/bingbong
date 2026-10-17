import { BrowserWindow, ipcMain, type WebContents } from 'electron'
import { PIPELINE_IPC } from '../../core/pipeline/ipcChannels'
import type { CommandRunner, CommandRunOptions } from './commandRunner'

// Glue between the dashboard and the window's command runner: submit a
// Command (Prompt Bar or voice), abort it. The runner owns the reading and
// publication; this file owns only window routing and IPC.

const runners = new WeakMap<BrowserWindow, CommandRunner>()

export function runnerFor(win: BrowserWindow): CommandRunner | undefined {
  return runners.get(win)
}

/** Runs one Command through the window's runner; false when there is no window or the line is blank. */
export async function runCommand(win: BrowserWindow, text: string, options?: CommandRunOptions): Promise<boolean> {
  const runner = runners.get(win)
  if (!runner) return false
  return runner.run(text, options)
}

export function registerCommandRunnerIpc(): void {
  ipcMain.handle(PIPELINE_IPC.submit, async (event, text: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    if (typeof text !== 'string' || text.trim() === '') return false
    // A typed Command: its Reaction opens at submit (#324).
    return runCommand(win, text.trim(), { source: 'typed' })
  })

  ipcMain.handle(PIPELINE_IPC.abort, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const runner = win ? runners.get(win) : undefined
    return runner ? runner.abort() : false
  })
}

/**
 * `escape` is what Escape does: abort the Command, and whatever else the
 * window closes with it (a Hot Listen, #326); it answers whether anything
 * was. Absent aborts the Command alone.
 */
export function attachCommandRunnerToWindow(runner: CommandRunner, win: BrowserWindow, escape: () => boolean = () => runner.abort()): void {
  runners.set(win, runner)
  const detachAbortHotkey = attachAbortHotkey(escape, win.webContents)
  win.on('closed', () => runners.delete(win))
  win.on('closed', detachAbortHotkey)
}

/** Capture Escape when the embedded browser, rather than React, owns focus. */
export function attachAbortHotkey(escape: () => boolean, contents: WebContents): () => void {
  const onBeforeInput = (event: Electron.Event, input: Electron.Input) => {
    if (input.type === 'keyDown' && input.key === 'Escape' && escape()) {
      event.preventDefault()
    }
  }
  contents.on('before-input-event', onBeforeInput)
  return () => contents.removeListener('before-input-event', onBeforeInput)
}
