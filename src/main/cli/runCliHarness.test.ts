import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { PipelineEvent } from '../../core/pipeline/events'
import type { SnapshotRef } from '../../core/browser/snapshot'
import { FakeBrowser } from '../../core/testing/doubles'
import { createCommandRunner } from '../run/commandRunner'
import { runCliHarness, type CliHarnessDeps } from './runCliHarness'

// The terminal harness over the Command runner (#4, #324): a typed line
// takes the Prompt Bar's road — the Local Match, else the best guess here,
// with no Decision Model configured — and the harness prints what the
// runner published for the Command's turn. Help and quit stay its own.

function ref(ref: number, kind: SnapshotRef['kind'], label: string, extra?: Partial<SnapshotRef>): SnapshotRef {
  return {
    ref,
    kind,
    label,
    inputType: kind === 'input' ? 'text' : null,
    rect: { x: 0, y: ref * 10, width: 100, height: 10 },
    src: null,
    href: kind === 'link' ? `https://example.com/${ref}` : null,
    downloadsFile: false,
    submitsForm: false,
    credentialField: false,
    paymentField: false,
    inForm: false,
    formHasCredential: false,
    formHasPayment: false,
    searchField: false,
    formHasSearch: false,
    ...extra,
  }
}

class HarnessBrowser extends FakeBrowser {
  failRead = false

  override async readPage(part = 1): Promise<string> {
    if (this.failRead) throw new Error('page evaluation failed: boom')
    return super.readPage(part)
  }
}

function harnessWith(overrides?: Partial<CliHarnessDeps>) {
  const browser = new HarnessBrowser()
  browser.snapshot = {
    ...browser.snapshot,
    url: 'https://www.youtube.com/',
    title: 'YouTube',
    refs: [ref(1, 'button', 'Guide'), ref(2, 'button', 'Sign in'), ref(3, 'input', 'Search', { inputType: 'search' })],
  }
  const listeners = new Set<(event: PipelineEvent) => void>()
  const saved: { path: string; bytes: Uint8Array }[] = []
  const runner = createCommandRunner({
    browser,
    decisionModel: () => null,
    publish: (event) => {
      for (const listener of [...listeners]) listener(event)
    },
    now: () => Date.now(),
    screenshotDir: () => '/tmp/shots',
    saveScreenshot: async (path, bytes) => {
      saved.push({ path, bytes })
    },
  })
  const input = new PassThrough()
  const output = new PassThrough()
  let out = ''
  output.on('data', (chunk: Buffer) => {
    out += chunk.toString()
  })
  let exited = false
  const deps: CliHarnessDeps = {
    run: (line, options) => runner.run(line, options),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    input,
    output,
    exit: () => {
      exited = true
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

  return { browser, saved, input, done, expectOutput, hasExited: () => exited, readOutput: () => out }
}

describe('runCliHarness', () => {
  it('prints a banner and prompt, then the Page Read a `read` line produces', async () => {
    const cli = harnessWith()
    await cli.expectOutput("bingbong browser harness — type 'help' for commands")

    cli.input.write('read\n')
    await cli.expectOutput('<page>blank</page>')

    cli.input.write('quit\n')
    await cli.done
    expect(cli.hasExited()).toBe(true)
  })

  it('navigates through the runner and prints the outcome line', async () => {
    const cli = harnessWith()
    await cli.expectOutput('bingbong> ')

    cli.input.write('navigate youtube.com\n')
    await cli.expectOutput('navigated: url=https://youtube.com title="Fake page: https://youtube.com"')
    expect(cli.browser.navigations).toEqual(['https://youtube.com'])

    cli.input.write('quit\n')
    await cli.done
  })

  it('reads plain words as a Command: a bare word opens its .com, a label clicks the ref that carries it', async () => {
    const cli = harnessWith()
    await cli.expectOutput('bingbong> ')

    cli.input.write('open youtube\n')
    await cli.expectOutput('navigated: url=https://youtube.com')

    cli.input.write('click sign in\n')
    await cli.expectOutput('clicked [2]:')
    expect(cli.browser.clicks).toEqual([2])

    cli.input.write('quit\n')
    await cli.done
  })

  it('clicks refs and types text with newline unescaping, the grammar way', async () => {
    const cli = harnessWith()
    await cli.expectOutput('bingbong> ')

    cli.input.write('click 3\n')
    await cli.expectOutput('clicked [3]:')
    expect(cli.browser.clicks).toEqual([3])

    cli.input.write('type 3 mechanical keyboards\\n\n')
    await cli.expectOutput('typed [3]: value="mechanical keyboards\\n"')
    expect(cli.browser.typed).toEqual([{ ref: 3, text: 'mechanical keyboards\n' }])

    cli.input.write('scroll down\n')
    await cli.expectOutput('scrolled down: x=0 y=0')

    cli.input.write('back\n')
    await cli.expectOutput('went back: url=')

    cli.input.write('quit\n')
    await cli.done
  })

  it('saves screenshots under the screenshot dir with a numbered name, printing the path once', async () => {
    const cli = harnessWith()
    await cli.expectOutput('bingbong> ')

    cli.input.write('screenshot\n')
    await cli.expectOutput('screenshot saved: /tmp/shots/screenshot-1.jpg')
    expect(cli.saved.map((shot) => shot.path)).toEqual(['/tmp/shots/screenshot-1.jpg'])

    cli.input.write('screenshot /tmp/other.jpg\n')
    await cli.expectOutput('screenshot saved: /tmp/other.jpg')
    expect(cli.readOutput().match(/screenshot saved: \/tmp\/other\.jpg/g)).toHaveLength(1)

    cli.input.write('quit\n')
    await cli.done
  })

  it('presses keys on the page', async () => {
    const cli = harnessWith()
    await cli.expectOutput('bingbong> ')

    cli.input.write('press enter\n')
    await cli.expectOutput('pressed Enter')

    cli.input.write('press down 3\n')
    await cli.expectOutput('pressed ArrowDown ×3')
    expect(cli.browser.pressedKeys).toEqual([
      { press: { key: 'Enter' }, times: 1 },
      { press: { key: 'ArrowDown' }, times: 3 },
    ])

    cli.input.write('quit\n')
    await cli.done
  })

  it('fires the best guess for words no grammar knows, and prints a failure as an error without stopping the loop', async () => {
    const cli = harnessWith()
    await cli.expectOutput('bingbong> ')

    // No Decision Model here: a verb-less line is searched (ADR 0076), never refused.
    cli.input.write('frobnicate\n')
    await cli.expectOutput('navigated: url=https://duckduckgo.com/?q=frobnicate')

    cli.browser.failRead = true
    cli.input.write('read\n')
    await cli.expectOutput('error: page evaluation failed: boom')

    cli.input.write('read\n')
    await cli.expectOutput('error: page evaluation failed: boom')

    cli.input.write('help\n')
    await cli.expectOutput('open <site or words>')

    cli.input.write('quit\n')
    await cli.done
  })

  it('lists commands on help without asking the runner', async () => {
    const cli = harnessWith()
    await cli.expectOutput('bingbong> ')

    cli.input.write('help\n')
    await cli.expectOutput('read')
    await cli.expectOutput('click <label or ref>')
    await cli.expectOutput('type <text> in <field>')
    await cli.expectOutput('scroll up|down')
    await cli.expectOutput('screenshot [path]')
    await cli.expectOutput('back | forward')
    await cli.expectOutput('quit')
    expect(cli.browser.navigations).toEqual([])

    cli.input.write('quit\n')
    await cli.done
  })

  it('prints only its own turn: a spoken Command landing mid-line is not mistaken for the typed one', async () => {
    const listeners = new Set<(event: PipelineEvent) => void>()
    const publish = (event: PipelineEvent): void => {
      for (const listener of [...listeners]) listener(event)
    }
    const cli = harnessWith({
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      run: async (line, options) => {
        const turnId = options.turnId!
        expect(turnId).toMatch(/^cli-1-/)
        // A spoken Command's turn, published while the typed line runs.
        publish({ type: 'command', turnId: 'voice-7', text: 'scroll down', action: 'scroll down', at: 1 })
        publish({ type: 'tool_result', turnId: 'voice-7', callId: 'voice-7-1', name: 'scroll', ok: true, result: 'scrolled down: x=0 y=360', at: 2 })
        publish({ type: 'command', turnId, text: line, action: 'click [2] "Sign in"', at: 3 })
        publish({ type: 'tool_result', turnId, callId: `${turnId}-1`, name: 'click', ok: true, result: 'clicked [2]: urlChanged=false', at: 4 })
        publish({ type: 'done', turnId, outcome: 'done', at: 5 })
        return true
      },
    })
    await cli.expectOutput('bingbong> ')

    cli.input.write('click sign in\n')
    await cli.expectOutput('clicked [2]: urlChanged=false')
    expect(cli.readOutput()).not.toContain('scrolled down')

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
