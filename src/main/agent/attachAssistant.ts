import { BrowserWindow, ipcMain, type WebContents } from 'electron'
import { PIPELINE_IPC } from '../../core/pipeline/ipcChannels'
import type { PipelineEvent } from '../../core/pipeline/events'
import type { CommandPipeline } from '../../core/pipeline/createCommandPipeline'

// Glue between the dashboard and the command pipeline: submit a command
// (text box or voice), receive the event stream, resolve confirmations.
// Behavior (incl. the single-shot busy guard) lives in the pipeline
// (seam-tested); this file is covered by e2e.

interface AttachedPipeline {
  pipeline: CommandPipeline
  /** Observes every event a run emits (the voice session's confirmation window). */
  onEvent?: (event: PipelineEvent) => void
}

const pipelines = new WeakMap<BrowserWindow, AttachedPipeline>()

/** Runs one command through the window's pipeline, forwarding events to the dashboard. */
export async function runAssistantCommand(win: BrowserWindow, text: string): Promise<boolean> {
  const attached = pipelines.get(win)
  if (!attached) return false
  for await (const pipelineEvent of attached.pipeline.execute(text)) {
    if (win.isDestroyed()) break
    deliver(win.webContents, attached, pipelineEvent)
  }
  return true
}

function deliver(sender: WebContents, attached: AttachedPipeline, pipelineEvent: PipelineEvent): void {
  if (!sender.isDestroyed()) sender.send(PIPELINE_IPC.event, pipelineEvent)
  attached.onEvent?.(pipelineEvent)
}

export function pipelineFor(win: BrowserWindow): CommandPipeline | undefined {
  return pipelines.get(win)?.pipeline
}

export function registerAssistantIpc(): void {
  ipcMain.handle(PIPELINE_IPC.submit, async (event, text: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    if (typeof text !== 'string' || text.trim() === '') return false

    return runAssistantCommand(win, text.trim())
  })

  ipcMain.handle(PIPELINE_IPC.resolveConfirmation, (event, confirmationId: unknown, approved: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const pipeline = win ? pipelineFor(win) : undefined
    if (pipeline && typeof confirmationId === 'string') {
      pipeline.resolveConfirmation(confirmationId, approved === true)
    }
  })
}

export function attachAssistantToWindow(
  pipeline: CommandPipeline,
  win: BrowserWindow,
  onEvent?: (event: PipelineEvent) => void,
): void {
  pipelines.set(win, { pipeline, onEvent })
  win.on('closed', () => pipelines.delete(win))
}
