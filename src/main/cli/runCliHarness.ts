import { createInterface } from 'node:readline'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import type { BrowserController } from '../../core/ports/browser'
import { parseCliCommand } from './parseCliCommand'
import type { CliCommand } from './parseCliCommand'

/** Writes a captured screenshot to disk, creating parent directories. */
export async function saveScreenshotFile(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, bytes)
}

export interface CliHarnessDeps {
  controller: BrowserController
  input: Readable
  output: Writable
  exit(): void
  screenshotDir(): string
  saveScreenshot(path: string, bytes: Uint8Array): Promise<void>
}

const HELP_TEXT = [
  'commands:',
  '  navigate <url>     open a url (or search terms) in the browser pane',
  '  read               print a numbered-ref snapshot of visible interactive elements',
  '  click <ref>        click element <ref> from the last snapshot',
  '  type <ref> <text>  click <ref> and type text (\\n sends Enter)',
  '  scroll up|down     scroll the page',
  '  press <key> [n]    inject a shortcut key n times (k, j, l, up, down, left, right, space, enter, next)',
  '  screenshot [path]  save a jpeg screenshot (default: screenshot dir)',
  '  back               go back in history',
  '  quit               exit the app',
].join('\n')

const PROMPT = 'bingbong> '

export function runCliHarness(deps: CliHarnessDeps): Promise<void> {
  const { controller, input, output, exit, screenshotDir, saveScreenshot } = deps

  const write = (text: string): void => {
    if (!output.destroyed) output.write(text)
  }

  let screenshotCount = 0
  let finished = false
  let closeInput: () => void = () => {}

  async function executeCommand(command: CliCommand): Promise<void> {
    switch (command.type) {
      case 'navigate':
        await controller.navigate(command.input)
        write(`navigated: ${controller.state().url}\n`)
        return
      case 'read':
        write(`${await controller.readPage()}\n`)
        return
      case 'click':
        await controller.click(command.ref)
        write(`clicked ref ${command.ref}\n`)
        return
      case 'type':
        await controller.type(command.ref, command.text)
        write(`typed ${command.text.length} chars into ref ${command.ref}\n`)
        return
      case 'scroll':
        await controller.scroll(command.direction)
        write(`scrolled ${command.direction}\n`)
        return
      case 'press':
        await controller.pressKey(command.press, command.times)
        write(`pressed ${command.press.key}${command.times > 1 ? ` ×${command.times}` : ''}\n`)
        return
      case 'screenshot': {
        const bytes = await controller.screenshot()
        const path = command.path ?? join(screenshotDir(), `bingbong-screenshot-${++screenshotCount}.jpg`)
        await saveScreenshot(path, bytes)
        write(`saved screenshot to ${path} (${bytes.byteLength} bytes)\n`)
        return
      }
      case 'back':
        await controller.back()
        write('went back\n')
        return
      case 'help':
        write(`${HELP_TEXT}\n`)
        return
      case 'quit':
        write('bye\n')
        finished = true
        exit()
        closeInput()
        return
    }
  }

  async function handleLine(line: string): Promise<void> {
    try {
      const parsed = parseCliCommand(line)
      if (parsed === null) return
      if (parsed.ok === false) {
        write(`error: ${parsed.error}\n`)
        return
      }
      await executeCommand(parsed.command)
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
