import { BrowserWindow, ipcMain, type WebContents } from 'electron'
import { PIPELINE_IPC } from '../../core/pipeline/ipcChannels'
import type { CommandPipeline } from '../../core/pipeline/createCommandPipeline'
import { steerPipeline } from '../../core/pipeline/steering'
import type { WindowRunPublisher } from '../session/windowEventPublisher'

// Glue between the dashboard and the command pipeline: submit a command
// (text box or voice), receive the event stream, resolve confirmations.
// Behavior (incl. the single-shot busy guard) lives in the pipeline
// (seam-tested); this file is covered by e2e.

interface AttachedPipeline {
  pipeline: CommandPipeline
  /** Creates the per-execution publication context before execute() starts. */
  createRunPublisher: () => WindowRunPublisher
}

const pipelines = new WeakMap<BrowserWindow, AttachedPipeline>()

/**
 * Runs one command through the window's pipeline, forwarding events to the
 * dashboard. `turnId` is the voice turn's id, minted at utterance end (#27)
 * — the pipeline adopts it and stamps every event of the turn with it;
 * without one (text box) the pipeline mints a fresh id (#28). `truncated`
 * (#61) is true when the spoken utterance hit the 30 s cap — the pipeline
 * flags the request in-band so the model asks the user to finish.
 */
export async function runAssistantCommand(win: BrowserWindow, text: string, turnId?: string, truncated?: boolean): Promise<boolean> {
  const attached = pipelines.get(win)
  if (!attached) return false
  const publisher = attached.createRunPublisher()
  for await (const pipelineEvent of attached.pipeline.execute(text, turnId, truncated)) {
    if (win.isDestroyed()) break
    publisher.publish(pipelineEvent)
  }
  return true
}

export function pipelineFor(win: BrowserWindow): CommandPipeline | undefined {
  return pipelines.get(win)?.pipeline
}

/** Abort the run if one is active. Returns whether an abort happened. */
export function abortActiveRun(pipeline: CommandPipeline): boolean {
  if (pipeline.getState() === 'idle') return false
  pipeline.abort()
  return true
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

  ipcMain.handle(PIPELINE_IPC.resolveAsk, (event, askId: unknown, answer: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const pipeline = win ? pipelineFor(win) : undefined
    if (pipeline && typeof askId === 'string' && typeof answer === 'string') {
      pipeline.resolveAsk(askId, answer)
    }
  })

  ipcMain.handle(PIPELINE_IPC.abort, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const pipeline = win ? pipelineFor(win) : undefined
    return pipeline ? abortActiveRun(pipeline) : false
  })

  // The typed steer box (#46) lives in the panel's overlay webContents;
  // fromWebContents resolves its owning window, exactly like the panel's
  // own IPC does. False means nothing was taken (no run, blank directive).
  ipcMain.handle(PIPELINE_IPC.steer, (event, directive: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const pipeline = win ? pipelineFor(win) : undefined
    if (!pipeline || typeof directive !== 'string') return false
    return steerPipeline(pipeline, directive)
  })
}

export function attachAssistantToWindow(
  pipeline: CommandPipeline,
  win: BrowserWindow,
  createRunPublisher: () => WindowRunPublisher,
): void {
  pipelines.set(win, { pipeline, createRunPublisher })
  const contents = win.webContents
  const detachAbortHotkey = attachAssistantAbortHotkey(pipeline, contents)
  win.on('closed', () => pipelines.delete(win))
  win.on('closed', detachAbortHotkey)
}

/** Capture Escape when the embedded browser, rather than React, owns focus. */
export function attachAssistantAbortHotkey(pipeline: CommandPipeline, contents: WebContents): () => void {
  const onBeforeInput = (event: Electron.Event, input: Electron.Input) => {
    if (input.type === 'keyDown' && input.key === 'Escape' && abortActiveRun(pipeline)) {
      event.preventDefault()
    }
  }
  contents.on('before-input-event', onBeforeInput)
  return () => contents.removeListener('before-input-event', onBeforeInput)
}
