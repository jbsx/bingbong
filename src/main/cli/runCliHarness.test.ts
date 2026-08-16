import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import youtubeHome from '../../core/browser/fixtures/youtube-home.json'
import { buildPageSnapshot, findSnapshotRef, formatPageSnapshot, type CollectedPage, type SnapshotRef } from '../../core/browser/snapshot'
import type { BrowserController, BrowserState } from '../../core/ports/browser'
import { runCliHarness, type CliHarnessDeps } from './runCliHarness'

const youtubeFixture = youtubeHome as unknown as CollectedPage

class FakeController implements BrowserController {
  url = 'https://www.youtube.com/'
  readonly clicks: number[] = []
  readonly typed: { ref: number; text: string }[] = []
  readonly scrolls: ('up' | 'down')[] = []
  readonly backs: number[] = []
  failRead = false
  saved: { path: string; bytes: Uint8Array }[] = []

  async navigate(url: string): Promise<void> {
    this.url = url
  }

  async readPage(): Promise<string> {
    if (this.failRead) throw new Error('page evaluation failed: boom')
    return formatPageSnapshot(buildPageSnapshot(youtubeFixture))
  }

  async click(ref: number): Promise<void> {
    this.clicks.push(ref)
  }

  async type(ref: number, text: string): Promise<void> {
    this.typed.push({ ref, text })
  }

  async scroll(direction: 'up' | 'down'): Promise<void> {
    this.scrolls.push(direction)
  }

  async screenshot(): Promise<Uint8Array> {
    return new Uint8Array([1, 2, 3, 4])
  }

  async back(): Promise<void> {
    this.backs.push(1)
  }

  state(): BrowserState {
    return { url: this.url, title: 'YouTube' }
  }

  async describeRef(ref: number): Promise<SnapshotRef | undefined> {
    return findSnapshotRef(buildPageSnapshot(youtubeFixture), ref)
  }
}

function harnessWith(overrides?: Partial<CliHarnessDeps>) {
  const controller = new FakeController()
  const input = new PassThrough()
  const output = new PassThrough()
  let out = ''
  output.on('data', (chunk: Buffer) => {
    out += chunk.toString()
  })
  let exited = false
  const deps: CliHarnessDeps = {
    controller,
    input,
    output,
    exit: () => {
      exited = true
    },
    screenshotDir: () => '/tmp/shots',
    saveScreenshot: async (path, bytes) => {
      controller.saved.push({ path, bytes })
    },
    ...overrides,
  }
  const done = runCliHarness(deps)

  async function expectOutput(includes: string, timeoutMs = 2000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (!out.includes(includes)) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for output: ${JSON.stringify(includes)}\noutput so far:\n${out}`)
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }

  return { controller, input, done, expectOutput, hasExited: () => exited, readOutput: () => out }
}

describe('runCliHarness', () => {
  it('prints a banner and prompt, then echoes command results', async () => {
    const cli = harnessWith()
    await cli.expectOutput("bingbong browser harness — type 'help' for commands")

    cli.input.write('read\n')
    await cli.expectOutput('[1] button "Guide"')
    await cli.expectOutput('[3] input[search] "Search"')

    cli.input.write('quit\n')
    await cli.done
    expect(cli.hasExited()).toBe(true)
  })

  it('navigates and reports the resulting url', async () => {
    const cli = harnessWith()
    await cli.expectOutput('bingbong> ')

    cli.input.write('navigate youtube.com\n')
    await cli.expectOutput('navigated: youtube.com')
    expect(cli.controller.url).toBe('youtube.com')

    cli.input.write('quit\n')
    await cli.done
  })

  it('clicks refs and types text with newline unescaping', async () => {
    const cli = harnessWith()
    await cli.expectOutput('bingbong> ')

    cli.input.write('read\n')
    await cli.expectOutput('[1] button "Guide"')

    cli.input.write('click 3\n')
    await cli.expectOutput('clicked ref 3')
    expect(cli.controller.clicks).toEqual([3])

    cli.input.write('type 3 mechanical keyboards\\n\n')
    await cli.expectOutput('typed 21 chars into ref 3')
    expect(cli.controller.typed).toEqual([{ ref: 3, text: 'mechanical keyboards\n' }])

    cli.input.write('scroll down\n')
    await cli.expectOutput('scrolled down')

    cli.input.write('back\n')
    await cli.expectOutput('went back')

    cli.input.write('quit\n')
    await cli.done
  })

  it('saves screenshots under the screenshot dir with a numbered name', async () => {
    const cli = harnessWith()
    await cli.expectOutput('bingbong> ')

    cli.input.write('screenshot\n')
    await cli.expectOutput('saved screenshot to /tmp/shots/bingbong-screenshot-1.jpg (4 bytes)')
    expect(cli.controller.saved).toEqual([{ path: '/tmp/shots/bingbong-screenshot-1.jpg', bytes: new Uint8Array([1, 2, 3, 4]) }])

    cli.input.write('screenshot /tmp/other.jpg\n')
    await cli.expectOutput('saved screenshot to /tmp/other.jpg (4 bytes)')

    cli.input.write('quit\n')
    await cli.done
  })

  it('surfaces parse and controller errors without stopping the loop', async () => {
    const cli = harnessWith()
    await cli.expectOutput('bingbong> ')

    cli.input.write('frobnicate\n')
    await cli.expectOutput("error: unknown command: 'frobnicate' — try 'help'")

    cli.controller.failRead = true
    cli.input.write('read\n')
    await cli.expectOutput('error: page evaluation failed: boom')

    cli.input.write('read\n')
    await cli.expectOutput('error: page evaluation failed: boom')

    cli.input.write('help\n')
    await cli.expectOutput('navigate <url>')

    cli.input.write('quit\n')
    await cli.done
  })

  it('lists commands on help', async () => {
    const cli = harnessWith()
    await cli.expectOutput('bingbong> ')

    cli.input.write('help\n')
    await cli.expectOutput('read')
    await cli.expectOutput('click <ref>')
    await cli.expectOutput('type <ref> <text>')
    await cli.expectOutput('scroll up|down')
    await cli.expectOutput('screenshot [path]')
    await cli.expectOutput('back')
    await cli.expectOutput('quit')

    cli.input.write('quit\n')
    await cli.done
  })

  it('resolves when stdin closes without quit', async () => {
    const cli = harnessWith()
    await cli.expectOutput('bingbong> ')

    cli.input.end()

    await cli.done
    expect(cli.hasExited()).toBe(false)
  })
})
