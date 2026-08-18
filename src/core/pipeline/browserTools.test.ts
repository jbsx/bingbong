import { describe, expect, it } from 'vitest'
import youtubeHome from '../browser/fixtures/youtube-home.json'
import {
  buildPageSnapshot,
  findSnapshotRef,
  formatPageSnapshot,
  parseCollectedPage,
  type CollectedPage,
  type SnapshotRef,
} from '../browser/snapshot'
import type { BrowserController, BrowserState, KeyPress, MediaState } from '../ports/browser'
import { createCommandPipeline, type CommandPipeline } from './createCommandPipeline'
import { createBrowserTools } from './browserTools'
import { FakeClock, RecordingTts, ScriptedLlm } from '../testing/doubles'
import type { PipelineEvent } from './events'
import type { AssistantTurn } from '../ports/llm'

const youtubeFixture = youtubeHome as unknown as CollectedPage

// The pipeline seam should see what a real controller produces: raw collected
// DOM payload in, numbered-ref text out — parsing exercised for real.
function formatYoutubeSnapshot(): string {
  return formatPageSnapshot(buildPageSnapshot(parseCollectedPage(youtubeHome)))
}

class FixtureBrowserController implements BrowserController {
  readonly navigations: string[] = []
  readonly clicks: number[] = []
  readonly typed: { ref: number; text: string }[] = []
  readonly scrolls: ('up' | 'down')[] = []
  wentBack = 0
  screenshotBytes = new Uint8Array([1, 2, 3])
  private readonly snapshot = buildPageSnapshot(parseCollectedPage(youtubeHome))
  private readonly overrides = new Map<number, SnapshotRef>()

  setRefFacts(ref: SnapshotRef): void {
    this.overrides.set(ref.ref, ref)
  }

  async navigate(url: string): Promise<string> {
    this.navigations.push(url)
    return 'navigated outcome'
  }

  async readPage(): Promise<string> {
    return formatYoutubeSnapshot()
  }

  async click(ref: number): Promise<string> {
    this.clicks.push(ref)
    return 'click outcome'
  }

  async type(ref: number, text: string): Promise<string> {
    this.typed.push({ ref, text })
    return 'type outcome'
  }

  async scroll(direction: 'up' | 'down'): Promise<string> {
    this.scrolls.push(direction)
    return 'scroll outcome'
  }

  async pressKey(press: KeyPress): Promise<void> {
    this.pressed.push(press)
  }

  async mediaState(): Promise<MediaState | null> {
    return { paused: true, currentTime: 0, volume: 1 }
  }

  readonly pressed: KeyPress[] = []

  async screenshot(): Promise<Uint8Array> {
    return this.screenshotBytes
  }

  async back(): Promise<string> {
    this.wentBack += 1
    return 'back outcome'
  }

  state(): BrowserState {
    return { url: youtubeFixture.url, title: youtubeFixture.title }
  }

  async describeRef(ref: number): Promise<SnapshotRef | undefined> {
    return this.overrides.get(ref) ?? findSnapshotRef(this.snapshot, ref)
  }

}

async function collect(pipeline: CommandPipeline, command: string): Promise<PipelineEvent[]> {
  const events: PipelineEvent[] = []
  for await (const event of pipeline.execute(command)) events.push(event)
  return events
}

function pipelineWith(browser: BrowserController, calls: AssistantTurn[]) {
  const llm = new ScriptedLlm(calls)
  const pipeline = createCommandPipeline({
    llm,
    tts: new RecordingTts(),
    clock: new FakeClock(),
    tools: createBrowserTools(browser),
  })
  return { llm, pipeline }
}

describe('browser tools through the pipeline', () => {
  it('read_page surfaces the numbered-ref snapshot as a tool result', async () => {
    const browser = new FixtureBrowserController()
    const { pipeline } = pipelineWith(browser, [
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'read_page', args: {} }] },
      { kind: 'answer', speak: 'Read it.', display: 'Detail.' },
    ])

    const events = await collect(pipeline, 'what is on the page')

    expect(events).toContainEqual({
      type: 'tool_result',
      callId: 'c1',
      name: 'read_page',
      ok: true,
      result: formatYoutubeSnapshot(),
      at: 0,
    })
  })

  it('click accepts numeric refs from the model and acts on the browser', async () => {
    const browser = new FixtureBrowserController()
    const { pipeline } = pipelineWith(browser, [
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'click', args: { ref: 7 } }] },
      { kind: 'answer', speak: 'Clicked.', display: 'Detail.' },
    ])

    await collect(pipeline, 'click the sign-in link')

    expect(browser.clicks).toEqual([7])
  })

  it('coerces string refs from the model', async () => {
    const browser = new FixtureBrowserController()
    const { pipeline } = pipelineWith(browser, [
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'click', args: { ref: '7' } }] },
      { kind: 'answer', speak: 'Clicked.', display: 'Detail.' },
    ])

    const events = await collect(pipeline, 'click the sign-in link')

    expect(browser.clicks).toEqual([7])
    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({ ok: true })
  })

  it('type forwards ref and text; navigate forwards url; scroll validates direction', async () => {
    const browser = new FixtureBrowserController()
    const { pipeline } = pipelineWith(browser, [
      {
        kind: 'tool_calls',
        calls: [
          { id: 'c1', name: 'navigate', args: { url: 'youtube.com' } },
          { id: 'c2', name: 'type', args: { ref: 3, text: 'mechanical keyboards\n' } },
          { id: 'c3', name: 'scroll', args: { direction: 'down' } },
          { id: 'c4', name: 'back', args: {} },
        ],
      },
      { kind: 'answer', speak: 'Done.', display: 'Detail.' },
    ])

    await collect(pipeline, 'search for keyboards')

    expect(browser.navigations).toEqual(['youtube.com'])
    expect(browser.typed).toEqual([{ ref: 3, text: 'mechanical keyboards\n' }])
    expect(browser.scrolls).toEqual(['down'])
    expect(browser.wentBack).toBe(1)
  })

  it('surfaces a non-empty observable outcome for every mutating browser tool', async () => {
    const browser = new FixtureBrowserController()
    const { pipeline } = pipelineWith(browser, [
      {
        kind: 'tool_calls',
        calls: [
          { id: 'c1', name: 'navigate', args: { url: 'youtube.com' } },
          { id: 'c2', name: 'click', args: { ref: 7 } },
          { id: 'c3', name: 'type', args: { ref: 3, text: 'query' } },
          { id: 'c4', name: 'scroll', args: { direction: 'down' } },
          { id: 'c5', name: 'back', args: {} },
        ],
      },
      { kind: 'answer', speak: 'Done.', display: 'Detail.' },
    ])

    const events = await collect(pipeline, 'act and report')

    expect(events.filter((event) => event.type === 'tool_result').map((event) => event.result)).toEqual([
      'navigated outcome',
      'click outcome',
      'type outcome',
      'scroll outcome',
      'back outcome',
    ])
  })

  it('describes the outcomes each browser tool actually returns', () => {
    const descriptions = Object.fromEntries(createBrowserTools(new FixtureBrowserController()).map((tool) => [tool.name, tool.description]))

    expect(descriptions.read_page).toMatch(/text digest/i)
    expect(descriptions.click).toMatch(/URL-change.*dialog.*state delta/i)
    expect(descriptions.type).toMatch(/actual.*value/i)
    expect(descriptions.scroll).toMatch(/scroll position/i)
    expect(descriptions.back).toMatch(/URL.*title/i)
  })

  it('reports a screenshot as a byte-count summary', async () => {
    const browser = new FixtureBrowserController()
    const { pipeline } = pipelineWith(browser, [
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'screenshot', args: {} }] },
      { kind: 'answer', speak: 'Shot.', display: 'Detail.' },
    ])

    const events = await collect(pipeline, 'take a screenshot')

    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({
      ok: true,
      result: 'screenshot captured (3 bytes)',
    })
  })

  it('reports bad tool arguments as failed results the model can recover from', async () => {
    const browser = new FixtureBrowserController()
    const { pipeline } = pipelineWith(browser, [
      {
        kind: 'tool_calls',
        calls: [
          { id: 'c1', name: 'click', args: {} },
          { id: 'c2', name: 'type', args: { ref: 3 } },
          { id: 'c3', name: 'scroll', args: { direction: 'sideways' } },
          { id: 'c4', name: 'navigate', args: {} },
        ],
      },
      { kind: 'answer', speak: 'Recovered.', display: 'Detail.' },
    ])

    const events = await collect(pipeline, 'do things')

    const results = events.filter((e) => e.type === 'tool_result')
    expect(results.map((r) => (r as { error?: string }).error)).toEqual([
      "click: 'ref' must be a number",
      "type: 'text' must be a non-empty string",
      "scroll: 'direction' must be 'up' or 'down'",
      "navigate: 'url' must be a non-empty string",
    ])
    expect(browser.clicks).toEqual([])
    expect(events.some((e) => e.type === 'confirmation_requested')).toBe(false)
  })

  describe('risk gate', () => {
    function refWith(ref: number, overrides: Partial<SnapshotRef>): SnapshotRef {
      return {
        ref,
        kind: 'input',
        label: '',
        inputType: null,
        rect: { x: 0, y: 0, width: 10, height: 10 },
        href: null,
        downloadsFile: false,
        submitsForm: false,
        credentialField: false,
        paymentField: false,
        inForm: false,
        formHasCredential: false,
        formHasPayment: false,
        ...overrides,
      }
    }

    it('hard-denies typing into a credential field; nothing is typed', async () => {
      const browser = new FixtureBrowserController()
      browser.setRefFacts(refWith(3, { inputType: 'password', credentialField: true, inForm: true, formHasCredential: true }))
      const { pipeline } = pipelineWith(browser, [
        { kind: 'tool_calls', calls: [{ id: 'c1', name: 'type', args: { ref: 3, text: 'hunter2' } }] },
        { kind: 'answer', speak: 'I cannot type passwords.', display: 'Detail.' },
      ])

      const events = await collect(pipeline, 'log me in')

      expect(browser.typed).toEqual([])
      expect(events.some((e) => e.type === 'confirmation_requested')).toBe(false)
      expect(events.find((e) => e.type === 'tool_result')).toMatchObject({
        ok: false,
        error: 'credential fields are never filled by the agent — the user can type it themselves',
      })
    })

    it('hard-denies clicking the submit control of a payment form', async () => {
      const browser = new FixtureBrowserController()
      browser.setRefFacts(refWith(4, { kind: 'button', label: 'Pay now', submitsForm: true, inForm: true, formHasPayment: true }))
      const { pipeline } = pipelineWith(browser, [
        { kind: 'tool_calls', calls: [{ id: 'c1', name: 'click', args: { ref: 4 } }] },
        { kind: 'answer', speak: 'I cannot pay.', display: 'Detail.' },
      ])

      const events = await collect(pipeline, 'pay for it')

      expect(browser.clicks).toEqual([])
      expect(events.find((e) => e.type === 'tool_result')).toMatchObject({
        ok: false,
        error: 'payments are never submitted by the agent',
      })
    })

    it('asks before submitting a form and clicks once approved', async () => {
      const browser = new FixtureBrowserController()
      browser.setRefFacts(refWith(7, { kind: 'button', label: 'Send', submitsForm: true, inForm: true }))
      const { pipeline } = pipelineWith(browser, [
        { kind: 'tool_calls', calls: [{ id: 'c1', name: 'click', args: { ref: 7 } }] },
        { kind: 'answer', speak: 'Sent.', display: 'Detail.' },
      ])

      const events: PipelineEvent[] = []
      for await (const event of pipeline.execute('send the form')) {
        events.push(event)
        if (event.type === 'confirmation_requested') pipeline.resolveConfirmation(event.confirmationId, true)
      }

      expect(events).toContainEqual({
        type: 'confirmation_requested',
        confirmationId: 'confirm-1',
        callId: 'c1',
        toolName: 'click',
        prompt: 'Submit the form via "Send"?',
        expiresAt: 60_000,
        at: 0,
      })
      expect(browser.clicks).toEqual([7])
    })

    it('reports denial when a form submission is refused', async () => {
      const browser = new FixtureBrowserController()
      browser.setRefFacts(refWith(8, { kind: 'link', label: 'Download probe', href: 'http://x.test/dl/probe.bin', downloadsFile: true }))
      const { pipeline } = pipelineWith(browser, [
        { kind: 'tool_calls', calls: [{ id: 'c1', name: 'click', args: { ref: 8 } }] },
        { kind: 'answer', speak: 'Skipped.', display: 'Detail.' },
      ])

      const events: PipelineEvent[] = []
      for await (const event of pipeline.execute('download it')) {
        events.push(event)
        if (event.type === 'confirmation_requested') pipeline.resolveConfirmation(event.confirmationId, false)
      }

      expect(browser.clicks).toEqual([])
      expect(events.find((e) => e.type === 'tool_result')).toMatchObject({ ok: false, error: 'denied by the user; do not retry this action' })
    })
  })
})
