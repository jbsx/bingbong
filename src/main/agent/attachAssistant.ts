import { BrowserWindow, ipcMain } from 'electron'
import { PIPELINE_IPC } from '../../core/pipeline/ipcChannels'
import type { CommandPipeline } from '../../core/pipeline/createCommandPipeline'

// Glue between the dashboard's text box and the command pipeline: submit a
// command, receive the event stream, resolve confirmations. Behavior (incl.
// the single-shot busy guard) lives in the pipeline (seam-tested); this file
// is covered by e2e.

const pipelines = new WeakMap<BrowserWindow, CommandPipeline>()

export function registerAssistantIpc(): void {
  ipcMain.handle(PIPELINE_IPC.submit, async (event, text: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const pipeline = win ? pipelines.get(win) : undefined
    if (!pipeline) return false
    if (typeof text !== 'string' || text.trim() === '') return false

    for await (const pipelineEvent of pipeline.execute(text.trim())) {
      if (event.sender.isDestroyed()) break
      event.sender.send(PIPELINE_IPC.event, pipelineEvent)
    }
    return true
  })

  ipcMain.handle(PIPELINE_IPC.resolveConfirmation, (event, confirmationId: unknown, approved: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const pipeline = win ? pipelines.get(win) : undefined
    if (pipeline && typeof confirmationId === 'string') {
      pipeline.resolveConfirmation(confirmationId, approved === true)
    }
  })
}

export function attachAssistantToWindow(pipeline: CommandPipeline, win: BrowserWindow): void {
  pipelines.set(win, pipeline)
  win.on('closed', () => pipelines.delete(win))
}
