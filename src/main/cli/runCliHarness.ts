import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'
import { COMMAND_HELP_LINES } from '../../core/command/help'
import type { PipelineEvent } from '../../core/pipeline/events'
import type { CommandRunOptions } from '../run/commandRunner'

// The terminal harness (#4): a REPL over the window's Command runner. A
// typed line takes the same road as the Prompt Bar (#324, ADR 0076): the
// Local Match, else one Jev call, else the best guess — so the CLI grammar
// still works and plain words work too. The harness owns only the REPL:
// `help` and `quit` are its own, everything else is one Command, and what
// it prints is what the runner published for that Command's turn — the
// action's outcome line, a Page Read, a failure as `error: …`. The harness
// mints the turn id it submits under, so a spoken Command landing meanwhile
// is never printed as the typed line's.

export interface CliHarnessDeps {
  /** The window's Command runner: one typed line, read and performed (#324). */
  run(line: string, options: CommandRunOptions): Promise<boolean>
  /** Hears every event the runner publishes; the returned release stops hearing. */
  subscribe(listener: (event: PipelineEvent) => void): () => void
  input: Readable
  output: Writable
  exit(): void
}

const HELP_TEXT = [...COMMAND_HELP_LINES, '  quit | exit              exit the app'].join('\n')

const PROMPT = 'bingbong> '

/** The harness's own words: help and quit never reach the runner. */
function localCommand(line: string): 'help' | 'quit' | null {
  switch (line.trim()) {
    case 'help':
      return 'help'
    case 'quit':
    case 'exit':
      return 'quit'
    default:
      return null
  }
}

export function runCliHarness(deps: CliHarnessDeps): Promise<void> {
  const { run, subscribe, input, output, exit } = deps

  const write = (text: string): void => {
    if (!output.destroyed) output.write(text)
  }

  let finished = false
  let lineCount = 0
  let closeInput: () => void = () => {}

  /** Runs one line as a Command under a turn id of the harness's own, and prints what that turn published. */
  async function runCommand(line: string): Promise<void> {
    lineCount += 1
    const turnId = `cli-${lineCount}-${Date.now().toString(36)}`
    let printed = false
    let action: string | null = null
    const release = subscribe((event) => {
      if (!('turnId' in event) || event.turnId !== turnId) return
      switch (event.type) {
        case 'command':
          if (event.dropped) {
            write(`not a command: ${JSON.stringify(event.text)}\n`)
            printed = true
          } else {
            action = event.action ?? null
          }
          return
        case 'tool_result':
          if (event.ok) {
            const result = typeof event.result === 'string' ? event.result : JSON.stringify(event.result)
            write(`${result}\n`)
          } else {
            write(`error: ${event.error ?? 'failed'}\n`)
          }
          printed = true
          return
        case 'display':
          // A Page Read and a screenshot print their result line above;
          // the Card repeats it (shortened) for the Feed.
          if (!printed) {
            write(`${event.text}\n`)
            printed = true
          }
          return
        case 'error':
          write(`error: ${event.message}\n`)
          printed = true
          return
        default:
          return
      }
    })
    try {
      await run(line, { source: 'typed', turnId })
      // A Command with no tool behind it (stop) prints its action.
      if (!printed && action !== null) write(`${action}\n`)
    } finally {
      release()
    }
  }

  async function handleLine(line: string): Promise<void> {
    try {
      if (line.trim() === '') return
      switch (localCommand(line)) {
        case 'help':
          write(`${HELP_TEXT}\n`)
          return
        case 'quit':
          write('bye\n')
          finished = true
          exit()
          closeInput()
          return
        case null:
          await runCommand(line)
          return
      }
    } catch (err) {
      write(`error: ${err instanceof Error ? err.message : String(err)}\n`)
    } finally {
      if (!finished) write(PROMPT)
    }
  }

  return new Promise<void>((resolve) => {
    write(`bingbong browser harness — type 'help' for commands\n${PROMPT}`)

    const rl = createInterface({ input })
    closeInput = () => rl.close()
    let queue: Promise<void> = Promise.resolve()

    rl.on('line', (line: string) => {
      if (!finished) queue = queue.then(() => handleLine(line))
    })
    rl.on('close', () => {
      void queue.then(() => resolve())
    })
  })
}
