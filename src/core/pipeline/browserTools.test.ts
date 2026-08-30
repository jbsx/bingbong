import { describe, expect, it } from 'vitest'
import youtubeHome from '../browser/fixtures/youtube-home.json'
import redditHumanity from '../browser/fixtures/reddit-humanity.json'
import redditNetworkBlock from '../browser/fixtures/reddit-network-block.json'
import { blockerFactsFromSnapshot, type BlockerPageFacts } from '../browser/blockerNudge'
import {
  buildPageSnapshot,
  findSnapshotRef,
  formatPageSnapshot,
  parseCollectedPage,
  type CollectedPage,
  type SnapshotRef,
} from '../browser/snapshot'
import type { BrowserController, BrowserState, KeyPress, MediaState } from '../ports/browser'
import { settledStateFromSnapshot } from './progressFingerprints'
import { createCommandPipeline, type CommandPipeline } from './createCommandPipeline'
import { createBrowserTools } from './browserTools'
import { FakeClock, RecordingTts, ScriptedLlm, withoutTurnId } from '../testing/doubles'
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
  /** state() override; null falls back to the benign fixture page. */
  browserState: BrowserState | null = null
  /** ADR 0010 classifier facts override; null falls back to the benign fixture page. */
  facts: BlockerPageFacts | null = null
  /** When set, pageFacts() rejects — the navigate-settle classification falls back to state(). */
  pageFactsError: Error | null = null
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

  wentForward = 0
  forwardError: Error | null = null

  async forward(): Promise<string> {
    this.wentForward += 1
    if (this.forwardError) throw this.forwardError
    return 'forward outcome'
  }

  state(): BrowserState {
    return this.browserState ?? { url: youtubeFixture.url, title: youtubeFixture.title }
  }

  async pageFacts(): Promise<BlockerPageFacts> {
    if (this.pageFactsError) throw this.pageFactsError
    return this.facts ?? blockerFactsFromSnapshot(this.snapshot)
  }

  async settledState() {
    return settledStateFromSnapshot(this.snapshot, await this.mediaState())
  }

  async describeRef(ref: number): Promise<SnapshotRef | undefined> {
    return this.overrides.get(ref) ?? findSnapshotRef(this.snapshot, ref)
  }

}

async function collect(pipeline: CommandPipeline, command: string): Promise<PipelineEvent[]> {
  const events: PipelineEvent[] = []
  for await (const raw of pipeline.execute(command)) {
    events.push(withoutTurnId(raw))
  }
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

    expect(descriptions.navigate).toMatch(/settled page state/i)
    expect(descriptions.navigate).toMatch(/refs/i)
    expect(descriptions.navigate).toMatch(/not a required follow-up/)
    expect(descriptions.read_page).toMatch(/text digest/i)
    expect(descriptions.click).toMatch(/URL-change.*dialog.*state delta/i)
    expect(descriptions.click).toMatch(/settled page state/i)
    // The overlay retry sequence lives here, not in the shared prompt
    // policy (#127/AC2): mechanical call sequences are tool-description
    // guidance.
    expect(descriptions.click).toMatch(/blocked by overlay.*read the page, handle the dialog, then retry/i)
    expect(descriptions.type).toMatch(/actual.*value/i)
    expect(descriptions.type).toMatch(/settled page state/i)
    expect(descriptions.type).toMatch(/focus/i)
    expect(descriptions.type).toMatch(/no separate click/i)
    expect(descriptions.scroll).toMatch(/scroll position/i)
    expect(descriptions.back).toMatch(/URL.*title/i)
    expect(descriptions.go_forward).toMatch(/URL.*title/i)
  })

  it('go_forward drives browser forward at parity with back', async () => {
    const browser = new FixtureBrowserController()
    const { pipeline } = pipelineWith(browser, [
      {
        kind: 'tool_calls',
        calls: [
          { id: 'c1', name: 'back', args: {} },
          { id: 'c2', name: 'go_forward', args: {} },
        ],
      },
      { kind: 'answer', speak: 'Done.', display: 'Detail.' },
    ])

    const events = await collect(pipeline, 'go back then forward')

    expect(browser.wentBack).toBe(1)
    expect(browser.wentForward).toBe(1)
    expect(events.filter((event) => event.type === 'tool_result').map((event) => (event as { result: string }).result)).toEqual([
      'back outcome',
      'forward outcome',
    ])
  })

  it('reports end-of-history forward as a failed result the model can recover from', async () => {
    const browser = new FixtureBrowserController()
    browser.forwardError = new Error('cannot go forward: no history')
    const { pipeline } = pipelineWith(browser, [
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'go_forward', args: {} }] },
      { kind: 'answer', speak: 'Nowhere to go.', display: 'Detail.' },
    ])

    const events = await collect(pipeline, 'go forward')

    expect(browser.wentForward).toBe(1)
    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({
      ok: false,
      error: 'cannot go forward: no history',
    })
  })

  it('does not expose the byte-count-only screenshot capability to the model', () => {
    const names = createBrowserTools(new FixtureBrowserController()).map((tool) => tool.name)

    expect(names).not.toContain('screenshot')
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

  describe('blocker nudge on navigation (ADR 0007)', () => {
    it('appends the authoritative marker and escalation nudge when navigation lands on a challenge', async () => {
      const browser = new FixtureBrowserController()
      browser.facts = { url: 'https://shop.example.com/', title: 'Just a moment...' }
      const { pipeline } = pipelineWith(browser, [
        { kind: 'tool_calls', calls: [{ id: 'c1', name: 'navigate', args: { url: 'https://shop.example.com/' } }] },
        { kind: 'answer', speak: 'Blocked.', display: 'Detail.' },
      ])

      const events = await collect(pipeline, 'open the shop')

      expect(events.find((e) => e.type === 'tool_result')).toMatchObject({
        ok: true,
        result: `navigated outcome\nBLOCKER:challenge shop.example.com\nThis page is a Blocker — a challenge wall (CAPTCHA or human verification). The marker is authoritative; say so and ask_user: what helps is the user completing the challenge on screen in the browser tab, or picking a different site. Never attempt to get past it yourself.`,
      })
    })

    it('classifies the landing from its full page facts — a network-block body nudges on navigate (#113)', async () => {
      const browser = new FixtureBrowserController()
      browser.facts = {
        url: 'https://news.example.com/article',
        title: 'news',
        textDigest: 'You are blocked by network security from viewing this page.',
      }
      const { pipeline } = pipelineWith(browser, [
        { kind: 'tool_calls', calls: [{ id: 'c1', name: 'navigate', args: { url: 'https://news.example.com/article' } }] },
        { kind: 'answer', speak: 'Blocked.', display: 'Detail.' },
      ])

      const events = await collect(pipeline, 'read the article')

      const result = events.find((e) => e.type === 'tool_result')
      expect(result?.result).toContain('\nBLOCKER:network-block news.example.com\n')
      expect(result?.result).toContain('signing in')
      expect(result?.result).toContain('different route')
    })

    it('nudges on sign-in wall landings through every navigation verb', async () => {
      const browser = new FixtureBrowserController()
      browser.facts = { url: 'https://news.example.com/signin?returnUrl=%2Farticle', title: 'Sign in' }
      const { pipeline } = pipelineWith(browser, [
        {
          kind: 'tool_calls',
          calls: [
            { id: 'c1', name: 'navigate', args: { url: 'https://news.example.com/article' } },
            { id: 'c2', name: 'back', args: {} },
            { id: 'c3', name: 'go_forward', args: {} },
          ],
        },
        { kind: 'answer', speak: 'Walls everywhere.', display: 'Detail.' },
      ])

      const events = await collect(pipeline, 'read the article')

      const results = events.filter((event) => event.type === 'tool_result')
      for (const result of results) {
        expect(result.result).toContain('This page is a Blocker — a login wall')
        expect(result.result).toContain('ask_user')
      }
    })

    it('leaves ordinary navigations — including consent walls — unnudged', async () => {
      const browser = new FixtureBrowserController()
      browser.facts = { url: 'https://news.example.com/', title: 'Welcome — choose your cookies' }
      const { pipeline } = pipelineWith(browser, [
        { kind: 'tool_calls', calls: [{ id: 'c1', name: 'navigate', args: { url: 'https://news.example.com/' } }] },
        { kind: 'answer', speak: 'Read it.', display: 'Detail.' },
      ])

      const events = await collect(pipeline, 'open the news')

      // Consent stays the auto-clear class: no Blocker nudge, ever.
      expect(events.find((e) => e.type === 'tool_result')).toMatchObject({ ok: true, result: 'navigated outcome' })
    })

    it('falls back to URL/title classification when the landing facts are unavailable', async () => {
      const browser = new FixtureBrowserController()
      browser.pageFactsError = new Error('collected page payload malformed')
      browser.browserState = { url: null, title: null }
      const { pipeline } = pipelineWith(browser, [
        { kind: 'tool_calls', calls: [{ id: 'c1', name: 'navigate', args: { url: 'https://x.test/' } }] },
        { kind: 'answer', speak: 'Went there.', display: 'Detail.' },
      ])

      const events = await collect(pipeline, 'open the site')

      expect(events.find((e) => e.type === 'tool_result')).toMatchObject({ ok: true, result: 'navigated outcome' })
    })
  })

  describe('blocker marker lines at both choke points (ADR 0010)', () => {
    it('navigate-settle emits the machine marker + flavored nudge for a Google /sorry landing', async () => {
      const browser = new FixtureBrowserController()
      browser.facts = {
        url: 'https://www.google.com/sorry/index?continue=https%3A%2F%2Fwww.google.com%2Fsearch%3Fq%3Dtest&q=test',
        title: 'https://www.google.com/search?q=test',
      }
      const { pipeline } = pipelineWith(browser, [
        { kind: 'tool_calls', calls: [{ id: 'c1', name: 'navigate', args: { url: 'https://www.google.com/search?q=test' } }] },
        { kind: 'answer', speak: 'Walled.', display: 'Detail.' },
      ])

      const events = await collect(pipeline, 'search for it')

      const result = events.find((e) => e.type === 'tool_result')
      expect(result?.ok).toBe(true)
      expect(result?.result).toContain('\nBLOCKER:challenge www.google.com\n')
      expect(result?.result).toContain('completing the challenge on screen')
    })

    it('read_page classifies the page facts and rides the marker + nudge on the tool result', async () => {
      const browser = new FixtureBrowserController()
      browser.facts = blockerFactsFromSnapshot(buildPageSnapshot(parseCollectedPage(redditHumanity)))
      const { pipeline } = pipelineWith(browser, [
        { kind: 'tool_calls', calls: [{ id: 'c1', name: 'read_page', args: {} }] },
        { kind: 'answer', speak: 'Walled.', display: 'Detail.' },
      ])

      const events = await collect(pipeline, 'what is on the page')

      const result = events.find((e) => e.type === 'tool_result')
      expect(result?.ok).toBe(true)
      expect(result?.result).toContain(`\nBLOCKER:challenge www.reddit.com\n`)
      expect(result?.result).toContain('ask_user')
    })

    it('read_page names the network-block flavor with its different help (sign in / different route)', async () => {
      const browser = new FixtureBrowserController()
      browser.facts = blockerFactsFromSnapshot(buildPageSnapshot(parseCollectedPage(redditNetworkBlock)))
      const { pipeline } = pipelineWith(browser, [
        { kind: 'tool_calls', calls: [{ id: 'c1', name: 'read_page', args: {} }] },
        { kind: 'answer', speak: 'Blocked.', display: 'Detail.' },
      ])

      const events = await collect(pipeline, 'read the post')

      const result = events.find((e) => e.type === 'tool_result')
      expect(result?.result).toContain('\nBLOCKER:network-block www.reddit.com\n')
      expect(result?.result).toContain('network block')
      expect(result?.result).toContain('signing in')
      expect(result?.result).toContain('different route')
      expect(result?.result).not.toContain('completing the challenge on screen')
    })

    it('leaves ordinary pages marker-free at both choke points', async () => {
      const browser = new FixtureBrowserController()
      const { pipeline } = pipelineWith(browser, [
        {
          kind: 'tool_calls',
          calls: [
            { id: 'c1', name: 'navigate', args: { url: 'https://www.youtube.com/' } },
            { id: 'c2', name: 'read_page', args: {} },
          ],
        },
        { kind: 'answer', speak: 'All clear.', display: 'Detail.' },
      ])

      const events = await collect(pipeline, 'open and read')

      const results = events.filter((event) => event.type === 'tool_result')
      expect(results[0]?.result).toBe('navigated outcome')
      expect(results[1]?.result).toBe(formatYoutubeSnapshot())
    })
  })

  describe('risk gate', () => {
    function refWith(ref: number, overrides: Partial<SnapshotRef>): SnapshotRef {
      return {
        ref,
        kind: 'input',
        label: '',
        inputType: null,
        rect: { x: 0, y: 0, width: 10, height: 10 },
        src: null,
        href: null,
        downloadsFile: false,
        submitsForm: false,
        credentialField: false,
        paymentField: false,
        inForm: false,
        formHasCredential: false,
        formHasPayment: false,
        searchField: false,
        formHasSearch: false,
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
        turnId: expect.any(String),
        confirmationId: 'confirm-1',
        callId: 'c1',
        toolName: 'click',
        prompt: 'Submit the form via "Send"?',
        expiresAt: 60_000,
        at: 0,
      })
      expect(browser.clicks).toEqual([7])
    })

    it('runs an Enter-submit into a form-wrapped search box with no confirmation (#102)', async () => {
      const browser = new FixtureBrowserController()
      browser.setRefFacts(refWith(3, { kind: 'input', label: 'Search', inForm: true, searchField: true, formHasSearch: true }))
      const { pipeline } = pipelineWith(browser, [
        { kind: 'tool_calls', calls: [{ id: 'c1', name: 'type', args: { ref: 3, text: 'weather tomorrow\n' } }] },
        { kind: 'answer', speak: 'Searched.', display: 'Detail.' },
      ])

      const events = await collect(pipeline, 'search the weather')

      expect(browser.typed).toEqual([{ ref: 3, text: 'weather tomorrow\n' }])
      expect(events.some((e) => e.type === 'confirmation_requested')).toBe(false)
    })

    it('runs a click on a search form submit control with no confirmation (#102)', async () => {
      const browser = new FixtureBrowserController()
      browser.setRefFacts(refWith(4, { kind: 'button', label: 'Google Search', submitsForm: true, inForm: true, formHasSearch: true }))
      const { pipeline } = pipelineWith(browser, [
        { kind: 'tool_calls', calls: [{ id: 'c1', name: 'click', args: { ref: 4 } }] },
        { kind: 'answer', speak: 'Searched.', display: 'Detail.' },
      ])

      const events = await collect(pipeline, 'run that search')

      expect(browser.clicks).toEqual([4])
      expect(events.some((e) => e.type === 'confirmation_requested')).toBe(false)
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
