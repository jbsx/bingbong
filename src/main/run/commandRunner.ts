import type { BrowserController } from '../../core/ports/browser'
import type { PipelineEvent } from '../../core/pipeline/events'
import { parseCliCommand, type CliCommand } from '../cli/parseCliCommand'

// The command seam (kachow): where a typed or spoken command lands, and the
// one place the agent that drives the browser will plug in. Today it is a
// direct runner — the CLI harness's grammar (navigate, read, click <ref>,
// type <ref> <text>, scroll, press, back, screenshot) executed straight
// against the browser controller, each step published on the same event
// stream the Feed, the Peek Card and the Status Capsule already read. A
// Jev-driven agent replaces `createDirectCommandRunner` behind the same
// interface; nothing above this seam changes.

export type CommandRunState = 'idle' | 'running' | 'paused'

export interface CommandRunner {
  /**
   * Runs one command. `turnId` is the voice turn's id, minted at utterance
   * end; without one (text box) a fresh id is minted. `truncated` is true
   * when the spoken utterance hit the 30 s cap. Resolves false when a run
   * is already active or the text is blank — nothing is published then.
   */
  run(text: string, turnId?: string, truncated?: boolean): Promise<boolean>
  getState(): CommandRunState
  /** Abort the active run. Returns whether one was active. */
  abort(): boolean
  /** Park the active run (the wake word / hotkey during a run, ADR 0024). */
  pause(): void
  /** Resume a parked run, optionally with a spoken steering directive. */
  resume(steering?: string): void
}

export interface DirectCommandRunnerDeps {
  browser: BrowserController
  publish(event: PipelineEvent): void
  now(): number
  mintTurnId(): string
  screenshotDir(): string
  saveScreenshot(path: string, bytes: Uint8Array): Promise<void>
}

/** How much of a browser result the Feed card shows; the rest is for the agent. */
const DISPLAY_LIMIT = 4_000

function toolName(command: CliCommand): string {
  switch (command.type) {
    case 'read':
      return 'read_page'
    default:
      return command.type
  }
}

function toolArgs(command: CliCommand): Record<string, unknown> {
  switch (command.type) {
    case 'navigate':
      return { url: command.input }
    case 'click':
      return { ref: command.ref }
    case 'type':
      return { ref: command.ref, text: command.text }
    case 'scroll':
      return { direction: command.direction }
    case 'press':
      return { key: command.press.key, times: command.times, ...(command.press.shift ? { shift: true } : {}) }
    case 'screenshot':
      return command.path ? { path: command.path } : {}
    default:
      return {}
  }
}

export function createDirectCommandRunner(deps: DirectCommandRunnerDeps): CommandRunner {
  let state: CommandRunState = 'idle'
  let aborted = false
  let screenshotCount = 0

  async function execute(command: CliCommand): Promise<string> {
    const { browser } = deps
    switch (command.type) {
      case 'navigate':
        return browser.navigate(command.input)
      case 'read':
        return browser.readPage()
      case 'click':
        return browser.click(command.ref)
      case 'type':
        return browser.type(command.ref, command.text)
      case 'scroll':
        return browser.scroll(command.direction)
      case 'press':
        await browser.pressKey(command.press, command.times)
        return `pressed ${command.press.shift ? 'Shift+' : ''}${command.press.key}${command.times > 1 ? ` ×${command.times}` : ''}`
      case 'screenshot': {
        const bytes = await browser.screenshot()
        screenshotCount += 1
        const path = command.path ?? `${deps.screenshotDir()}/screenshot-${screenshotCount}.jpg`
        await deps.saveScreenshot(path, bytes)
        return `screenshot saved: ${path}`
      }
      case 'back':
        return browser.back()
      case 'help':
        return 'commands: navigate <url>, read, click <ref>, type <ref> <text>, scroll up|down, press <key> [n], screenshot [path], back'
      case 'quit':
        return 'quit is a CLI-only command'
    }
  }

  return {
    getState: () => state,

    abort() {
      if (state === 'idle') return false
      aborted = true
      return true
    },

    pause() {
      if (state === 'running') state = 'paused'
    },

    resume() {
      if (state === 'paused') state = 'running'
    },

    async run(text, turnId, truncated) {
      const trimmed = text.trim()
      if (trimmed === '' || state !== 'idle') return false
      state = 'running'
      aborted = false
      const id = turnId ?? deps.mintTurnId()
      const at = () => deps.now()
      const publish = deps.publish
      publish({ type: 'command', turnId: id, text: trimmed, at: at() })
      try {
        if (truncated) {
          publish({ type: 'error', turnId: id, message: 'The utterance hit the 30 s cap; it may be cut off.', at: at() })
        }
        const parsed = parseCliCommand(trimmed)
        if (parsed === null || !parsed.ok) {
          publish({ type: 'error', turnId: id, message: parsed === null ? 'nothing to run' : parsed.error, at: at() })
          publish({ type: 'done', turnId: id, outcome: 'failed', at: at() })
          return true
        }
        publish({ type: 'status', turnId: id, status: 'acting', at: at() })
        const callId = `${id}-1`
        const name = toolName(parsed.command)
        publish({ type: 'tool_call', turnId: id, callId, name, args: toolArgs(parsed.command), at: at() })
        try {
          const result = await execute(parsed.command)
          publish({ type: 'tool_result', turnId: id, callId, name, ok: true, result, at: at() })
          if (aborted) {
            publish({ type: 'status', turnId: id, status: 'cancelled', at: at() })
            publish({ type: 'done', turnId: id, outcome: 'cancelled', at: at() })
            return true
          }
          const shown = result.length > DISPLAY_LIMIT ? `${result.slice(0, DISPLAY_LIMIT)}\n…` : result
          publish({ type: 'display', turnId: id, text: shown === '' ? 'done' : shown, at: at() })
          publish({ type: 'done', turnId: id, outcome: 'done', at: at() })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          publish({ type: 'tool_result', turnId: id, callId, name, ok: false, error: message, at: at() })
          publish({ type: 'done', turnId: id, outcome: aborted ? 'cancelled' : 'failed', at: at() })
        }
        return true
      } finally {
        state = 'idle'
        aborted = false
      }
    },
  }
}
