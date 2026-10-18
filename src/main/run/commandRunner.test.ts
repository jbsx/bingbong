import { describe, expect, it } from 'vitest'
import type { PipelineEvent } from '../../core/pipeline/events'
import type { SnapshotRef } from '../../core/browser/snapshot'
import type { PageLanding } from '../../core/ports/browser'
import type { CommandLogRecord } from '../../core/command/decisionRecord'
import type { DecisionAnswer, DecisionChoiceQuestion, DecisionModel, DecisionQuestions, DecisionRequest, DecisionResult, DecisionUnavailableReason } from '../../core/ports/decisionModel'
import { FakeBrowser, fakePerfHarness, flushMicrotasks } from '../../core/testing/doubles'
import type { ActionEffect } from '../browser/createCdpBrowserController'
import { JEV_VERBS } from '../../core/command/command'
import type { AudioStream, SpeakOptions, SpeakOutcome, TtsSpeaker } from '../../core/ports/tts'
import { pageReadPartLine } from '../../core/browser/pageText'
import { blockedActionHead } from '../../core/browser/actionOutcome'
import { SPOKEN_FAILURES } from '../../core/command/spokenFailure'
import { createSpeechCoordinator } from '../../core/tts/speechCoordinator'
import { createCommandRunner, type CommandRunner } from './commandRunner'

// The Command runner (#324, ADR 0076): a typed or spoken line becomes one
// Command — the Local Match first, else one Jev call, else the best guess
// — and acts at once, with no confirmation and no spoken line. One Feed
// entry per Command; a `reaction` span and one decision record each.

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

const PAGE_REFS: SnapshotRef[] = [ref(1, 'link', 'Home'), ref(2, 'button', 'Sign in'), ref(3, 'input', 'Search', { inputType: 'search' })]

/** A Decision Model that counts its asks and answers a script, like the stand-in main serves. */
class CountingDecisionModel implements DecisionModel {
  readonly model = 'jev-1.14.0'
  readonly requests: DecisionRequest<DecisionQuestions>[] = []
  readonly script: ({ answers: Record<string, DecisionAnswer> } | { unavailable: DecisionUnavailableReason })[] = []
  latencyMs = 212
  private readonly gates = new Map<number, Promise<void>>()

  /** The ask at this index (0 the first) waits until the returned release is called. */
  hold(index: number): () => void {
    let release: () => void = () => {}
    this.gates.set(index, new Promise<void>((resolve) => (release = resolve)))
    return () => release()
  }

  async ask<const Q extends DecisionQuestions>(request: DecisionRequest<Q>): Promise<DecisionResult<Q>> {
    const index = this.requests.length
    this.requests.push(request as DecisionRequest<DecisionQuestions>)
    const gate = this.gates.get(index)
    if (gate !== undefined) await gate
    const next = this.script.shift()
    if (next === undefined || 'unavailable' in next) {
      return { status: 'unavailable', reason: next?.unavailable ?? 'failed', message: 'scripted', latencyMs: this.latencyMs, model: this.model }
    }
    return { status: 'answered', answers: next.answers as never, latencyMs: this.latencyMs, model: this.model }
  }
}

function choice(label: string, confidence = 0.9, probabilities: Record<string, number> = { [label]: confidence }): DecisionAnswer {
  return { type: 'choice', choice: label, confidence, probabilities }
}

/** A speaker double (#327): records each text, sounds its first sample and finishes it on demand. */
class FakeSpeech {
  readonly spoken: { text: string; turnId?: string }[] = []
  stops = 0
  private pending: { onFirstSound?: () => void; resolve: (outcome: SpeakOutcome) => void }[] = []

  speak = (text: string, options?: SpeakOptions): Promise<SpeakOutcome> => {
    this.spoken.push({ text, ...(options?.turnId !== undefined ? { turnId: options.turnId } : {}) })
    return new Promise((resolve) => this.pending.push({ ...(options?.onFirstSound ? { onFirstSound: options.onFirstSound } : {}), resolve }))
  }

  stop = (): void => {
    this.stops += 1
    for (const item of this.pending.splice(0)) item.resolve({ ok: true })
  }

  /** The text in flight hands its first sample to the player. */
  sound(): void {
    this.pending[0]?.onFirstSound?.()
  }

  finish(outcome: SpeakOutcome = { ok: true }): void {
    this.pending.shift()?.resolve(outcome)
  }
}

/** A Page Read as the controller writes one: the head, the refs, then the page's text and its part line. */
const PAGE_READ = [
  '# Example — https://example.com/',
  'viewport 985x575 scroll 0/2000',
  'signature 1a2b3c4d',
  '[1] link "Home"',
  'page text:',
  'Welcome to the example. It has two sentences.',
  'A second block.',
  pageReadPartLine(1, 1),
].join('\n')

function harness(options?: { decision?: null; learned?: string[]; speech?: Pick<TtsSpeaker, 'speak' | 'stop'> }) {
  const browser = new FakeBrowser()
  browser.snapshot = { ...browser.snapshot, url: 'https://example.com/', title: 'Example', refs: PAGE_REFS }
  const events: PipelineEvent[] = []
  const records: CommandLogRecord[] = []
  const screenshots: string[] = []
  const admitted: string[] = []
  const proposed: string[] = []
  const observed: string[] = []
  const learned = options?.learned ?? []
  const perf = fakePerfHarness()
  const effectListeners = new Set<(effect: ActionEffect) => void>()
  const landingListeners = new Set<(landing: PageLanding) => void>()
  const decision = new CountingDecisionModel()
  const configured = options?.decision !== null
  let wall = 1_700_000_000_000
  const runner: CommandRunner = createCommandRunner({
    browser,
    decisionModel: () => (configured ? decision : null),
    publish: (event) => events.push(event),
    now: () => wall++,
    tracer: perf.tracer,
    decisionLog: { write: (record) => records.push(record) },
    onLanding: (listener) => {
      landingListeners.add(listener)
      return () => landingListeners.delete(listener)
    },
    onEffect: (listener) => {
      effectListeners.add(listener)
      return () => effectListeners.delete(listener)
    },
    ...(options?.speech ? { speech: options.speech } : {}),
    screenshotDir: () => '/shots',
    saveScreenshot: async (path) => {
      screenshots.push(path)
    },
    terms: {
      learned: () => learned,
      admit: (term) => {
        admitted.push(term)
        if (!learned.includes(term)) learned.push(term)
      },
      propose: (term) => proposed.push(term),
      observe: (text) => observed.push(text),
    },
  })
  const observe = (effect: ActionEffect): void => {
    for (const listener of effectListeners) listener(effect)
  }
  const land = (landing: PageLanding): void => {
    for (const listener of landingListeners) listener(landing)
  }
  return { browser, events, records, screenshots, perf, decision, runner, observe, land, admitted, proposed, observed, setWall: (at: number) => (wall = at) }
}

const types = (events: PipelineEvent[]): string[] => events.map((event) => event.type)

describe('a Command the Local Match settles', () => {
  it('fires at once with no Jev call: the CLI grammar', async () => {
    const { browser, events, decision, runner } = harness()
    expect(await runner.run('navigate youtube.com')).toBe(true)
    expect(browser.navigations).toEqual(['https://youtube.com'])
    expect(decision.requests).toEqual([])
    expect(types(events)).toEqual(['command', 'status', 'tool_call', 'tool_result', 'display', 'done'])
    expect(events[0]).toMatchObject({ type: 'command', text: 'navigate youtube.com', action: 'open youtube.com' })
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'done' })
    expect(events.some((event) => event.type === 'speak')).toBe(false)
  })

  it('fires at once with no Jev call: a plain verb and the one ref its label names, flashing the ref as the click lands and never before it', async () => {
    const { browser, events, decision, runner } = harness()
    let release: () => void = () => {}
    const click = browser.click.bind(browser)
    browser.click = (ref) => new Promise((resolve) => (release = () => void click(ref).then(resolve)))
    const run = runner.run('click sign in', { source: 'spoken' })
    await flushMicrotasks()
    // The flash is a DOM change of the browser's own making: it must not be
    // the first effect the Reaction closes on, so it follows the click.
    expect(browser.shownRefs).toEqual([])
    release()
    await run
    expect(browser.clicks).toEqual([2])
    expect(browser.shownRefs).toEqual([2])
    expect(decision.requests).toEqual([])
    expect(events[0]).toMatchObject({ type: 'command', text: 'click sign in', action: 'click [2] "Sign in"' })
    expect(events[2]).toMatchObject({ type: 'tool_call', name: 'click', args: { ref: 2 } })
  })

  it('opens the Nth result on a search page by clicking it, with no Jev call (the AC8 capture\'s Misfire)', async () => {
    const { browser, events, decision, runner } = harness()
    browser.snapshot = {
      ...browser.snapshot,
      url: 'https://duckduckgo.com/?q=elon+musk+profile',
      title: 'elon musk profile at DuckDuckGo',
      refs: [
        ref(1, 'link', 'DuckDuckGo home', { href: 'https://duckduckgo.com/' }),
        ref(2, 'input', 'Search', { inputType: 'search' }),
        ref(3, 'link', 'Elon Musk (@elonmusk) / X', { href: 'https://x.com/elonmusk' }),
      ],
    }
    await runner.run('open the first result', { source: 'spoken' })
    expect(browser.clicks).toEqual([3])
    expect(browser.navigations).toEqual([])
    expect(decision.requests).toEqual([])
    expect(events[0]).toMatchObject({ type: 'command', action: 'click [3] "Elon Musk (@elonmusk) / X"' })
  })

  it('asks Jev for an open whose words are about the page rather than an address', async () => {
    const { browser, decision, runner } = harness()
    decision.script.push({ answers: { verb: choice('open'), target: choice('ref-1', 0.64), slot: choice('none') } }, { answers: { verb: choice('done'), target: choice('none'), slot: choice('none') } })
    await runner.run("open elon musk's profile", { source: 'spoken' })
    // The Command's call, and its Task's next hop saying done (#328).
    expect(decision.requests).toHaveLength(2)
    expect(browser.clicks).toEqual([1])
    expect(browser.navigations).toEqual([])
  })

  it('opens a bare word at its .com, search phrasing as a search, and an address as itself', async () => {
    const { browser, runner } = harness()
    await runner.run('open youtube')
    await runner.run('search for rust async book')
    await runner.run('go to news.ycombinator.com')
    expect(browser.navigations).toEqual(['https://youtube.com', 'https://duckduckgo.com/?q=rust%20async%20book', 'https://news.ycombinator.com'])
  })

  it('reads the seven spoken commands of AC1 into their browser actions', async () => {
    const { browser, runner } = harness()
    await runner.run('open youtube', { source: 'spoken' })
    await runner.run('click sign in', { source: 'spoken' })
    await runner.run('scroll down', { source: 'spoken' })
    await runner.run('search for rust async book', { source: 'spoken' })
    await runner.run('type hello in the search box', { source: 'spoken' })
    await runner.run('back', { source: 'spoken' })
    await runner.run('read', { source: 'spoken' })
    expect(browser.navigations).toEqual(['https://youtube.com', 'https://duckduckgo.com/?q=rust%20async%20book'])
    expect(browser.clicks).toEqual([2])
    expect(browser.scrolls).toEqual(['down'])
    expect(browser.typed).toEqual([{ ref: 3, text: 'hello' }])
    expect(browser.pageReads).toEqual([1])
  })

  it('reloads typed and spoken from the Local Match, and offers reload to Jev (#328 AC9)', async () => {
    const { browser, events, decision, runner } = harness()
    await runner.run('reload')
    await runner.run('refresh the page', { source: 'spoken' })
    expect(browser.reloads).toBe(2)
    expect(decision.requests).toEqual([])
    expect(events.find((event) => event.type === 'tool_call')).toMatchObject({ name: 'reload' })
    decision.script.push({ answers: { verb: choice('reload'), target: choice('none'), slot: choice('none') } })
    await runner.run('give me that page again', { source: 'spoken' })
    expect(browser.reloads).toBe(3)
    const verbs = (decision.requests[0]!.questions as { verb: DecisionChoiceQuestion }).verb
    expect(Object.keys(verbs.options)).toContain('reload')
  })

  it('shows a read as a Card and an action as its one-line Answer (#333) — actions stay silent', async () => {
    const { events, runner } = harness()
    await runner.run('read')
    await runner.run('scroll down')
    const displays = events.filter((event) => event.type === 'display')
    expect(displays.map((display) => display.text)).toEqual([SPOKEN_FAILURES.empty, 'Scrolled down.'])
    expect(events.filter((event) => event.type === 'speak')).toEqual([])
  })

  it('collects the page once per Command that needs it, and not for one that does not', async () => {
    const { browser, runner } = harness()
    await runner.run('scroll down')
    expect(browser.collects).toBe(0)
    await runner.run('click sign in')
    expect(browser.collects).toBe(1)
  })

  it('uses the page collected at speech start instead of collecting again at the Endpoint', async () => {
    const { browser, runner } = harness()
    runner.prepare()
    await flushMicrotasks()
    expect(browser.collects).toBe(1)
    await runner.run('click sign in', { source: 'spoken' })
    expect(browser.collects).toBe(1)
    expect(browser.clicks).toEqual([2])
    // Consumed: the next Command collects afresh.
    await runner.run('click sign in', { source: 'spoken' })
    expect(browser.collects).toBe(2)
  })
})

describe('a Command the Local Match cannot settle', () => {
  it('makes one Jev call with the three questions over the transcript, the page and its refs — and its Task one more per hop', async () => {
    const { browser, decision, runner, events } = harness()
    decision.script.push({ answers: { verb: choice('click'), target: choice('ref-1'), slot: choice('none') } }, { answers: { verb: choice('done'), target: choice('none'), slot: choice('none') } })

    await runner.run('take me home', { source: 'spoken' })

    expect(decision.requests).toHaveLength(2)
    const request = decision.requests[0]!
    expect(Object.keys(request.questions)).toEqual(['verb', 'target', 'slot'])
    expect(request.state).toContain('"take me home"')
    expect(request.state).toContain('Page: https://example.com/ — "Example"')
    expect(request.state).toContain('[1] link "Home" https://example.com/1')
    expect(request.state).toContain('[3] input[search] "Search"')
    expect(request.state).not.toContain('<page>')
    expect(Object.keys((request.questions.verb as DecisionChoiceQuestion).options)).toEqual([...JEV_VERBS])
    expect(Object.keys((request.questions.target as DecisionChoiceQuestion).options)).toEqual(['none', 'ref-1', 'ref-2', 'ref-3'])
    expect(Object.keys((request.questions.slot as DecisionChoiceQuestion).options)).toContain('s0-2')
    expect(browser.clicks).toEqual([1])
    expect(events[0]).toMatchObject({ type: 'command', text: 'take me home', action: 'click [1] "Home"' })
  })

  it('fires the best guess and publishes no error when Jev is unavailable', async () => {
    const { browser, decision, runner, events, records } = harness()
    decision.script.push({ unavailable: 'timeout' })

    await runner.run('tap on the sign thing', { source: 'spoken' })

    expect(decision.requests).toHaveLength(1)
    expect(browser.clicks).toEqual([2])
    expect(events.some((event) => event.type === 'error')).toBe(false)
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'done' })
    expect(records[0]).toMatchObject({ type: 'decision', reading: 'best_guess', jevAsked: true, jev: { reason: 'timeout', latencyMs: 212 } })
  })

  it('names the web search the best guess fired, as its Answer, when Jev is unavailable (#329)', async () => {
    const speech = new FakeSpeech()
    const { browser, decision, events, runner } = harness({ speech })
    decision.script.push({ unavailable: 'failed' })
    await runner.run('lovely weather in lisbon', { source: 'spoken' })
    expect(browser.navigations).toHaveLength(1)
    expect(events.filter((event) => event.type === 'display')).toEqual([expect.objectContaining({ type: 'display', text: 'Searched the web for “lovely weather in lisbon”.' })])
    expect(events.some((event) => event.type === 'speak' || event.type === 'error')).toBe(false)
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'done' })
    expect(speech.spoken).toEqual([])
  })

  it('a best guess that meets a wall answers with the wall, not the guess (#329)', async () => {
    const speech = new FakeSpeech()
    const { browser, events, runner } = harness({ decision: null, speech })
    browser.navigate = async () => {
      throw new Error("ERR_INTERNET_DISCONNECTED (-106) loading 'https://duckduckgo.com/'")
    }
    await runner.run('lovely weather in lisbon')
    expect(events.filter((event) => event.type === 'display')).toEqual([expect.objectContaining({ text: "There's no internet connection.", failure: true })])
    expect(speech.spoken.map((line) => line.text)).toEqual(["There's no internet connection."])
  })

  it('fires the best guess with no Jev configured', async () => {
    const { browser, runner, records } = harness({ decision: null })
    await runner.run('tap on the sign thing')
    expect(browser.clicks).toEqual([2])
    expect(records[0]).toMatchObject({ reading: 'best_guess', jevAsked: false })
    expect(records[0]).not.toHaveProperty('jev')
  })

  it('a none verb publishes one greyed Feed Entry and no speak, error or tool_call', async () => {
    const { browser, decision, runner, events, records } = harness()
    decision.script.push({ answers: { verb: choice('none', 0.7), target: choice('none'), slot: choice('none') } })

    expect(await runner.run('what a lovely day', { source: 'spoken' })).toBe(true)

    expect(types(events)).toEqual(['command', 'done'])
    expect(events[0]).toMatchObject({ type: 'command', text: 'what a lovely day', dropped: true })
    expect(events[0]).not.toHaveProperty('action')
    expect(browser.clicks).toEqual([])
    expect(browser.navigations).toEqual([])
    expect(records[0]).toMatchObject({ type: 'decision', verb: 'none', reading: 'jev', jev: { confidence: { verb: 0.7 } } })
    expect(runner.getState()).toBe('idle')
  })
})

describe('Stop during a page load (#330)', () => {
  /** A browser whose navigate never answers: the page is still loading. */
  function loading() {
    const h = harness()
    h.browser.navigate = () => new Promise<string>(() => {})
    return h
  }

  it.each([
    ['Escape, the Stop button or the Abort Head', (runner: CommandRunner) => void runner.abort()],
    ['the spoken or typed "stop"', (runner: CommandRunner) => void runner.run('stop')],
  ])('ends the page load too, on %s', async (_name, stop) => {
    const { browser, runner } = loading()
    void runner.run('navigate https://slow.example')
    await flushMicrotasks()
    expect(browser.stops).toBe(0)
    stop(runner)
    await flushMicrotasks()
    expect(browser.stops).toBe(1)
    expect(runner.getState()).toBe('idle')
  })

  it('leaves the page alone when nothing is in flight', async () => {
    const { browser, runner } = harness()
    expect(runner.abort()).toBe(false)
    expect(browser.stops).toBe(0)
  })
})

describe('a Command still being read', () => {
  /** A Jev that answers only when released. */
  function slowJev(decision: CountingDecisionModel): () => void {
    let release: () => void = () => {}
    const ask = decision.ask.bind(decision)
    decision.ask = ((request) => new Promise((resolve) => (release = () => void ask(request).then(resolve)))) as typeof decision.ask
    return () => release()
  }

  it('is superseded by a later Command that fires first: its reading is abandoned, the later Command stands', async () => {
    const { browser, events, decision, runner, records, perf } = harness()
    const release = slowJev(decision)
    decision.script.push({ answers: { verb: choice('click'), target: choice('ref-1'), slot: choice('none') } })
    const first = runner.run('take me home', { source: 'spoken' })
    await flushMicrotasks()
    expect(runner.getState()).toBe('running')

    expect(await runner.run('scroll down', { source: 'spoken' })).toBe(true)
    release()
    expect(await first).toBe(true)

    // The later Command acted; the earlier one never did, and did not cancel it.
    expect(browser.scrolls).toEqual(['down'])
    expect(browser.clicks).toEqual([])
    const scrollTurn = (events.find((event) => event.type === 'command' && event.text === 'scroll down') as { turnId: string }).turnId
    expect(events.filter((event) => 'turnId' in event && event.turnId === scrollTurn).at(-1)).toMatchObject({ type: 'done', outcome: 'done' })
    const abandoned = events.filter((event) => event.type === 'command' && event.text === 'take me home')
    expect(abandoned).toHaveLength(1)
    expect(abandoned[0]).toMatchObject({ dropped: true, action: 'abandoned: a later Command came first' })
    const abandonedTurn = (abandoned[0] as { turnId: string }).turnId
    expect(types(events.filter((event) => 'turnId' in event && event.turnId === abandonedTurn))).toEqual(['command', 'done'])
    expect(events.filter((event) => 'turnId' in event && event.turnId === abandonedTurn).at(-1)).toMatchObject({ outcome: 'cancelled' })
    // The reading is still recorded — it is data — but no Reaction was measured for it.
    expect(records.filter((record) => record.type === 'decision' && record.turnId === abandonedTurn)).toHaveLength(1)
    expect(perf.records.filter((record) => record.stage === 'reaction' && record.turnId === abandonedTurn)).toEqual([])
  })

  it('is interrupted by abort while it waits on Jev: nothing fires when the answer comes', async () => {
    const { browser, events, decision, runner } = harness()
    const release = slowJev(decision)
    decision.script.push({ answers: { verb: choice('click'), target: choice('ref-1'), slot: choice('none') } })
    const run = runner.run('take me home', { source: 'spoken' })
    await flushMicrotasks()

    expect(runner.abort()).toBe(true)
    expect(runner.getState()).toBe('idle')
    release()
    await run
    expect(browser.clicks).toEqual([])
    expect(types(events)).toEqual(['command', 'done'])
    expect(events[0]).toMatchObject({ dropped: true, action: 'abandoned: stopped' })
    expect(events[1]).toMatchObject({ outcome: 'cancelled' })
  })

  it.each([
    ['Escape, then a new Command before its answer comes', async (runner: CommandRunner) => {
      runner.abort()
      await runner.run('scroll down')
    }],
    ['a spoken or typed "stop"', async (runner: CommandRunner) => {
      await runner.run('stop')
    }],
  ])('says it was stopped when %s ended it (#330)', async (_name, stop) => {
    const { browser, events, decision, runner } = harness()
    const release = slowJev(decision)
    decision.script.push({ answers: { verb: choice('click'), target: choice('ref-1'), slot: choice('none') } })
    const first = runner.run('take me home', { source: 'spoken' })
    await flushMicrotasks()
    await stop(runner)
    release()
    await first
    expect(events.find((event) => event.type === 'command' && event.text === 'take me home')).toMatchObject({ dropped: true, action: 'abandoned: stopped' })
    // Whatever the reading waited on — a page still loading among it — the load ends with it.
    expect(browser.stops).toBeGreaterThanOrEqual(1)
  })

  it('is filed where it was given, and says a later Command came first (#330)', async () => {
    const { events, decision, runner } = harness()
    const release = slowJev(decision)
    decision.script.push({ answers: { verb: choice('click'), target: choice('ref-1'), slot: choice('none') } })
    const first = runner.run('take me home', { source: 'spoken' })
    await flushMicrotasks()
    await runner.run('scroll down', { source: 'spoken' })
    release()
    await first
    const commands = events.filter((event) => event.type === 'command')
    const abandoned = commands.find((event) => event.text === 'take me home')!
    const later = commands.find((event) => event.text === 'scroll down')!
    // Published after the later Command, but stamped when it was given — before it.
    expect(commands.indexOf(abandoned)).toBeGreaterThan(commands.indexOf(later))
    expect(abandoned.at).toBeLessThan(later.at)
    expect(abandoned).toMatchObject({ dropped: true, action: 'abandoned: a later Command came first' })
  })

  it('reads against the page prepared at speech start once, and a page-free Command lets a prepared page go', async () => {
    const { browser, decision, runner } = harness()
    runner.prepare()
    await flushMicrotasks()
    // The page moved on after the prepared collect: only "Later" is on it now.
    browser.snapshot = { ...browser.snapshot, refs: [ref(5, 'button', 'Later')] }
    await runner.run('scroll down', { source: 'spoken' })
    await runner.run('click later', { source: 'spoken' })
    expect(browser.clicks).toEqual([5])
    expect(decision.requests).toEqual([])
  })

  it('lets a prepared page go once it is older than an Utterance can be', async () => {
    const { browser, decision, runner, perf } = harness()
    runner.prepare()
    await flushMicrotasks()
    browser.snapshot = { ...browser.snapshot, refs: [ref(5, 'button', 'Later')] }
    perf.state.monotonicMs += 31_000
    await runner.run('click later', { source: 'spoken' })
    expect(browser.clicks).toEqual([5])
    expect(decision.requests).toEqual([])
  })
})

describe('the Misfire signal', () => {
  it('reads past a dropped Utterance: the recovery counts against the Command that fired', async () => {
    const { decision, runner, records } = harness()
    await runner.run('scroll down', { source: 'spoken' })
    decision.script.push({ answers: { verb: choice('none'), target: choice('none'), slot: choice('none') } })
    await runner.run('um never mind', { source: 'spoken' })
    await runner.run('back', { source: 'spoken' })
    const scrollTurn = records.find((record) => record.type === 'decision' && record.verb === 'scroll_down')!.turnId
    expect(records.filter((record) => record.type === 'misfire')).toEqual([expect.objectContaining({ turnId: scrollTurn, signal: 'back' })])
  })
})

describe('a Command in flight', () => {
  it('is superseded by the next Command: its late result reaches nothing', async () => {
    const { browser, events, runner } = harness()
    let release: () => void = () => {}
    browser.scroll = () => new Promise((resolve) => (release = () => resolve('scrolled down: x=0 y=360')))
    const first = runner.run('scroll down')
    await flushMicrotasks()
    expect(runner.getState()).toBe('running')

    expect(await runner.run('back')).toBe(true)
    release()
    expect(await first).toBe(true)

    const firstTurn = (events[0] as { turnId: string }).turnId
    const firstTurnEvents = events.filter((event) => 'turnId' in event && event.turnId === firstTurn)
    expect(types(firstTurnEvents)).toEqual(['command', 'status', 'tool_call', 'status', 'display', 'done'])
    expect(firstTurnEvents.at(-1)).toMatchObject({ type: 'done', outcome: 'cancelled' })
    expect(events.filter((event) => event.type === 'tool_result')).toHaveLength(1)
    expect(events.filter((event) => event.type === 'tool_result')[0]).toMatchObject({ name: 'back' })
  })

  it('is interrupted by abort: the turn ends cancelled now and the late result reaches nothing', async () => {
    const { browser, events, runner } = harness()
    let release: () => void = () => {}
    browser.scroll = () => new Promise((resolve) => (release = () => resolve('scrolled down')))
    const run = runner.run('scroll down')
    await flushMicrotasks()
    expect(runner.abort()).toBe(true)
    expect(runner.getState()).toBe('idle')
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'cancelled' })
    release()
    await run
    expect(types(events)).toEqual(['command', 'status', 'tool_call', 'status', 'display', 'done'])
    expect(runner.abort()).toBe(false)
  })

  it('stop as a Command interrupts what is in flight and is one entry', async () => {
    const { browser, events, runner } = harness()
    let release: () => void = () => {}
    browser.scroll = () => new Promise((resolve) => (release = () => resolve('scrolled down')))
    const run = runner.run('scroll down')
    await flushMicrotasks()
    await runner.run('stop', { source: 'spoken' })
    release()
    await run
    const stop = events.find((event) => event.type === 'command' && event.text === 'stop')
    expect(stop).toMatchObject({ action: 'stop' })
    expect(events.filter((event) => event.type === 'done').map((event) => (event as { outcome?: string }).outcome)).toEqual(['cancelled', 'done'])
  })

  it('reports a browser failure as a failed tool result and a failed turn, with no error event', async () => {
    const { browser, events, runner } = harness()
    browser.click = async () => {
      throw new Error('ref 9 refused')
    }
    await runner.run('click 9')
    expect(types(events)).toEqual(['command', 'status', 'tool_call', 'tool_result', 'display', 'done'])
    expect(events[3]).toMatchObject({ type: 'tool_result', ok: false, error: 'ref 9 refused' })
    expect(events[5]).toMatchObject({ type: 'done', outcome: 'failed' })
  })

  it('refuses a blank line and publishes nothing', async () => {
    const { events, runner } = harness()
    expect(await runner.run('   ')).toBe(false)
    expect(events).toEqual([])
  })
})

describe('what every Command records', () => {
  it('a reaction span from the Endpoint to the first observable effect, by verb', async () => {
    const { browser, perf, runner, observe } = harness()
    let release: () => void = () => {}
    browser.click = () =>
      new Promise((resolve) => {
        perf.state.monotonicMs = 900
        observe('mutation')
        release = () => resolve('clicked [2]: no observable change')
      })
    perf.state.monotonicMs = 500
    const run = runner.run('click sign in', { source: 'spoken', turnId: 'voice-1', endpointAt: 400 })
    await flushMicrotasks()
    release()
    await run

    const reaction = perf.records.find((record) => record.stage === 'reaction')
    expect(reaction).toMatchObject({ turnId: 'voice-1', durMs: 500, detail: { verb: 'click', effect: 'mutation', reading: 'local_match', source: 'spoken' } })
  })

  it('closes the span at the action\'s end when no effect was observed, and at submit for a typed Command', async () => {
    const { perf, runner } = harness()
    perf.state.monotonicMs = 100
    const original = perf.tracer.now
    let calls = 0
    perf.tracer.now = () => {
      calls += 1
      return original() + (calls > 1 ? 40 : 0)
    }
    await runner.run('scroll down')
    const reaction = perf.records.find((record) => record.stage === 'reaction')
    expect(reaction).toMatchObject({ durMs: 40, detail: { verb: 'scroll_down', effect: 'settled', source: 'typed' } })
  })

  it('one decision record per Command — transcript, verb, target, Slot, reading, Jev — and no span for a dropped Utterance', async () => {
    const { decision, runner, records, perf } = harness()
    decision.script.push({ answers: { verb: choice('type', 0.6), target: choice('ref-3', 0.5, { 'ref-3': 0.5, none: 0.3, 'ref-1': 0.2 }), slot: choice('s0-1', 0.8) } })
    // The type's Task goes on one hop, which says done (#328).
    decision.script.push({ answers: { verb: choice('done', 0.9), target: choice('none'), slot: choice('none') } })
    decision.script.push({ answers: { verb: choice('none', 0.9), target: choice('none'), slot: choice('none') } })

    // No plain verb heads the words: the Local Match settles nothing, Jev reads them.
    await runner.run('hello there into search', { source: 'spoken', turnId: 'voice-1' })
    await runner.run('nothing at all', { source: 'spoken', turnId: 'voice-2' })
    await runner.run('scroll down', { turnId: 'typed-1' })

    // A new Utterance within 3 s of a Jev-read hop is an overrun of it (#328).
    expect(records.map((record) => record.type)).toEqual(['decision', 'decision', 'misfire', 'decision', 'decision'])
    expect(records[1]).toMatchObject({ verb: 'done', ended: 'done', task: { id: 'voice-1', hop: 1 } })
    expect(records[2]).toMatchObject({ signal: 'overrun', turnId: 'voice-1', signalTurnId: 'voice-2', hop: 0 })
    records.splice(1, 2)
    expect(records[0]).toEqual({
      type: 'decision',
      turnId: 'voice-1',
      at: 1_700_000_000_001,
      source: 'spoken',
      transcript: 'hello there into search',
      reading: 'jev',
      verb: 'type',
      target: 3,
      targetLabel: 'Search',
      slot: 'hello there',
      jevAsked: true,
      jev: {
        model: 'jev-1.14.0',
        latencyMs: 212,
        confidence: { verb: 0.6, target: 0.5, slot: 0.8 },
        probabilities: { verb: { type: 0.6 }, target: { 'ref-3': 0.5, none: 0.3, 'ref-1': 0.2 }, slot: { 's0-1': 0.8 } },
      },
      task: { id: 'voice-1', hop: 0 },
    })
    expect(records[1]).toMatchObject({ turnId: 'voice-2', verb: 'none', reading: 'jev', ended: 'terminal' })
    expect(records[2]).toMatchObject({ turnId: 'typed-1', source: 'typed', verb: 'scroll_down', reading: 'local_match', jevAsked: false, ended: 'local_match' })
    expect(perf.records.filter((record) => record.stage === 'reaction').map((record) => record.turnId)).toEqual(['voice-1', 'typed-1'])
  })

  it('a Misfire signal when the next Command within 3 s is back, clear, escape or the opposite scroll', async () => {
    const { runner, records, setWall } = harness()
    setWall(10_000)
    await runner.run('scroll down', { turnId: 't1' })
    setWall(11_000)
    await runner.run('scroll up', { turnId: 't2' })
    setWall(20_000)
    await runner.run('click sign in', { turnId: 't3' })
    setWall(21_000)
    await runner.run('back', { turnId: 't4' })
    setWall(30_000)
    await runner.run('press escape', { turnId: 't5' })

    const misfires = records.filter((record) => record.type === 'misfire')
    expect(misfires).toEqual([
      // Each Command reads the clock once when given (#330), then when it fires.
      { type: 'misfire', turnId: 't1', at: 11_001, signal: 'opposite_scroll', signalTurnId: 't2', withinMs: 1_000 },
      { type: 'misfire', turnId: 't3', at: 21_001, signal: 'back', signalTurnId: 't4', withinMs: 1_000 },
    ])
  })

  it('saves a screenshot under the screenshot dir and names the file in the Card', async () => {
    const { events, screenshots, runner } = harness()
    await runner.run('screenshot')
    expect(screenshots).toEqual(['/shots/screenshot-1.jpg'])
    expect(events.find((event) => event.type === 'display')).toMatchObject({ text: 'screenshot saved: /shots/screenshot-1.jpg' })
  })
})

describe('the Name Match (ADR 0077)', () => {
  /** A YouTube-shaped page: the channel's name on a link, in a suggestion, and in the title. */
  const NAMED_REFS: SnapshotRef[] = [
    ...PAGE_REFS,
    ref(4, 'link', 'Linus Tech Tips'),
    ref(5, 'button', 'linus tech tips', { className: 'suggestion' }),
    ref(6, 'link', 'The $5000 Gaming PC - Linus Tech Tips'),
  ]
  const decision = (record: CommandLogRecord): Extract<CommandLogRecord, { type: 'decision' }> => {
    if (record.type !== 'decision') throw new Error('not a decision record')
    return record
  }

  it('carries a spoken search whose words sound like a name on the page as that name, records what was heard, and admits the name', async () => {
    const { browser, events, records, admitted, runner } = harness()
    browser.snapshot = { ...browser.snapshot, title: 'Linus Tech Tips - YouTube', refs: NAMED_REFS }
    expect(await runner.run('search line stack tips', { source: 'spoken' })).toBe(true)
    expect(browser.navigations[0]).toContain('linus')
    expect(browser.navigations[0]).not.toContain('stack')
    expect(events[0]).toMatchObject({ type: 'command', text: 'search line stack tips', action: 'open linus tech tips' })
    expect(decision(records[0])).toMatchObject({ slot: 'linus tech tips', slotHeard: 'line stack tips', slotFrom: 'page', reading: 'local_match' })
    expect(admitted).toEqual(['linus tech tips'])
  })

  it('types the page\'s spelling into the field named, keeping the words around the name', async () => {
    const { browser, records, runner } = harness()
    browser.snapshot = { ...browser.snapshot, refs: NAMED_REFS }
    await runner.run('type Linus Tech dips laptop in search', { source: 'spoken' })
    expect(browser.typed).toEqual([{ ref: 3, text: 'linus tech tips laptop' }])
    expect(decision(records[0])).toMatchObject({ slotHeard: 'Linus Tech dips', slotFrom: 'page' })
  })

  it('reads a typed line as typed: a name is matched only in speech', async () => {
    const { browser, records, admitted, runner } = harness()
    browser.snapshot = { ...browser.snapshot, refs: NAMED_REFS }
    await runner.run('search line stack tips')
    expect(browser.navigations[0]).toContain('stack')
    expect(decision(records[0]).slotHeard).toBeUndefined()
    expect(admitted).toEqual([])
  })

  it('leaves a Slot alone that already carries the name, and one that sounds like no name', async () => {
    const { browser, records, admitted, runner } = harness()
    browser.snapshot = { ...browser.snapshot, refs: NAMED_REFS }
    await runner.run('search linus tech tips', { source: 'spoken' })
    await runner.run('search rust async book', { source: 'spoken' })
    expect(records.filter((record) => record.type === 'decision').map((record) => decision(record).slotHeard)).toEqual([undefined, undefined])
    expect(browser.navigations[1]).toContain('rust')
    expect(admitted).toEqual([])
  })

  it('matches a Learned Term the page does not show, after the Page Terms, without admitting it again', async () => {
    const { browser, records, admitted, runner } = harness({ learned: ['elon musk'] })
    await runner.run('type elon mask in search', { source: 'spoken' })
    expect(browser.typed).toEqual([{ ref: 3, text: 'elon musk' }])
    expect(decision(records[0])).toMatchObject({ slotHeard: 'elon mask', slotFrom: 'learned' })
    expect(admitted).toEqual([])
  })

  it('never rewrites an address or a key: "open youtube" opens youtube', async () => {
    const { browser, records, runner } = harness({ learned: ['you tube music'] })
    await runner.run('open youtube', { source: 'spoken' })
    expect(browser.navigations).toEqual(['https://youtube.com'])
    expect(decision(records[0]).slotHeard).toBeUndefined()
  })

  it('waits for the page collected at speech start before reading a spoken search, so the Page Terms are in hand', async () => {
    const { browser, records, runner } = harness()
    browser.snapshot = { ...browser.snapshot, refs: NAMED_REFS }
    void runner.prepare()
    // The page moves on after speech start; the Command reads against the page spoken over.
    browser.snapshot = { ...browser.snapshot, refs: PAGE_REFS }
    await runner.run('search liner stack tips', { source: 'spoken' })
    expect(decision(records[0])).toMatchObject({ slot: 'linus tech tips', slotFrom: 'page' })
  })

  it('tells the Learned Terms every spoken transcript, so the terms it carries stay in use', async () => {
    const { observed, runner } = harness()
    await runner.run('scroll down', { source: 'spoken' })
    await runner.run('scroll down')
    expect(observed).toEqual(['scroll down'])
  })
})

describe('learning from a retry chain (ADR 0077)', () => {
  it('proposes the last Slot of a chain of similar-sounding Slots once the user moves on', async () => {
    const { proposed, runner } = harness()
    await runner.run('search line of factors', { source: 'spoken' })
    await runner.run('back', { source: 'spoken' })
    await runner.run('search line of tactics', { source: 'spoken' })
    expect(proposed).toEqual([])
    await runner.run('click sign in', { source: 'spoken' })
    expect(proposed).toEqual(['line of tactics'])
    // The chain is spent: moving on again proposes nothing more.
    await runner.run('scroll down', { source: 'spoken' })
    expect(proposed).toEqual(['line of tactics'])
  })

  it('proposes nothing for a single search, or for two that sound nothing alike', async () => {
    const { proposed, runner } = harness()
    await runner.run('search cats', { source: 'spoken' })
    await runner.run('click sign in', { source: 'spoken' })
    await runner.run('search rust async book', { source: 'spoken' })
    await runner.run('search linus tech tips', { source: 'spoken' })
    await runner.run('click sign in', { source: 'spoken' })
    expect(proposed).toEqual([])
  })

  it('lets a chain lapse after a minute', async () => {
    const { proposed, runner, setWall } = harness()
    await runner.run('search line of factors', { source: 'spoken' })
    setWall(1_700_000_000_000 + 120_000)
    await runner.run('search line of tactics', { source: 'spoken' })
    await runner.run('click sign in', { source: 'spoken' })
    expect(proposed).toEqual([])
  })
})

describe('Early Fire (#326)', () => {
  it('fires a partial the Local Match settles without a Slot before the Endpoint, with no Jev call; the Endpoint makes no second Command', async () => {
    const { browser, events, records, perf, decision, runner } = harness()
    perf.state.monotonicMs = 1_000
    void runner.prepare()
    await runner.consider('scroll down')
    expect(browser.scrolls).toEqual(['down'])
    expect(decision.requests).toEqual([])
    expect(events.filter((event) => event.type === 'command')).toHaveLength(1)

    perf.state.monotonicMs = 1_400
    expect(await runner.run('scroll down.', { source: 'spoken', turnId: 'voice-1', endpointAt: 1_400 })).toBe(true)
    expect(browser.scrolls).toEqual(['down'])
    expect(events.filter((event) => event.type === 'command')).toHaveLength(1)
    const decisions = records.filter((record) => record.type === 'decision')
    expect(decisions).toHaveLength(1)
    expect(decisions[0]).toMatchObject({ verb: 'scroll_down', reading: 'local_match', jevAsked: false, transcript: 'scroll down.', earlyFire: { partial: 'scroll down', leadMs: 400 } })
    const reaction = perf.records.find((record) => record.stage === 'reaction')
    expect(reaction).toMatchObject({ durMs: 0, detail: { verb: 'scroll_down', earlyFire: true, leadMs: 400 } })
  })

  const noul = (value: number): DecisionAnswer => ({ type: 'noul', noul: value })
  const openYoutube = (complete: number): Record<string, DecisionAnswer> => ({ verb: choice('open'), target: choice('none'), slot: choice('s1-1'), complete: noul(complete) })

  it('never fires a Slot-carrying partial on the Local Match; asks Jev the three Choices and one Noul, and fires only when the Noul clears 0.7', async () => {
    const { browser, events, records, decision, runner } = harness()
    void runner.prepare()
    decision.script.push({ answers: openYoutube(0.3) })
    await runner.consider('open you')
    expect(browser.navigations).toEqual([])
    expect(decision.requests).toHaveLength(1)
    const questions = decision.requests[0]!.questions
    expect(Object.keys(questions).sort()).toEqual(['complete', 'slot', 'target', 'verb'])
    expect(questions.complete).toEqual({ type: 'noul', instructions: 'Is this a complete command, with nothing still to be said?' })
    expect([questions.verb, questions.target, questions.slot].map((question) => question.type)).toEqual(['choice', 'choice', 'choice'])

    decision.script.push({ answers: openYoutube(0.9) })
    await runner.consider('open youtube')
    expect(browser.navigations).toEqual(['https://youtube.com'])
    expect(decision.requests).toHaveLength(2)

    // The Endpoint's transcript is not read for hop 0 again: no second navigation. Its Task's next hop reads it (#328).
    decision.script.push({ answers: { verb: choice('done'), target: choice('none'), slot: choice('none') } })
    await runner.run('open youtube please', { source: 'spoken', endpointAt: 0 })
    expect(decision.requests).toHaveLength(3)
    expect(decision.requests[2]!.state).toContain('"open youtube please"')
    expect(browser.navigations).toEqual(['https://youtube.com'])
    expect(events.filter((event) => event.type === 'command')).toHaveLength(2)
    const decisions = records.filter((record) => record.type === 'decision')
    expect(decisions).toHaveLength(2)
    expect(decisions[0]).toMatchObject({ verb: 'open', slot: 'youtube', reading: 'jev', jevAsked: true, partialCalls: 2, earlyFire: { partial: 'open youtube', noul: 0.9 } })
  })

  it('holds a bare verb that may still become another Command: "scroll" waits for "scroll up"', async () => {
    const { browser, decision, runner } = harness()
    void runner.prepare()
    decision.script.push({ unavailable: 'timeout' })
    await runner.consider('scroll')
    expect(browser.scrolls).toEqual([])
    await runner.consider('scroll up')
    expect(browser.scrolls).toEqual(['up'])
  })

  it('makes no call for a partial identical to the last one considered', async () => {
    const { decision, runner } = harness()
    void runner.prepare()
    decision.script.push({ answers: openYoutube(0.3) }, { answers: openYoutube(0.3) })
    await runner.consider('open you')
    await runner.consider('open you ')
    expect(decision.requests).toHaveLength(1)
  })

  it('fires nothing for a partial still being read at the Endpoint, and reads the final transcript as before', async () => {
    const { browser, events, decision, runner } = harness()
    void runner.prepare()
    let answer: (result: DecisionResult<DecisionQuestions>) => void = () => {}
    const ask = decision.ask.bind(decision)
    decision.ask = ((request: DecisionRequest<DecisionQuestions>) => {
      if (decision.requests.length > 0) return ask(request)
      decision.requests.push(request)
      return new Promise<DecisionResult<DecisionQuestions>>((resolve) => (answer = resolve))
    }) as typeof decision.ask
    const partial = runner.consider('open you')
    await flushMicrotasks()
    decision.script.push({ answers: { verb: choice('open'), target: choice('none'), slot: choice('s1-1') } })
    const endpoint = runner.run('open youtube', { source: 'spoken' })
    await flushMicrotasks()
    answer({ status: 'answered', answers: openYoutube(0.95) as never, latencyMs: 1, model: 'jev-1.14.0' })
    await partial
    await endpoint
    expect(browser.navigations).toEqual(['https://youtube.com'])
    expect(events.filter((event) => event.type === 'command')).toHaveLength(1)
    expect(events.find((event) => event.type === 'command')).toMatchObject({ text: 'open youtube' })
  })

  it('fires nothing and publishes no error when Jev is unavailable on a partial; the Endpoint reads as before', async () => {
    const { browser, events, decision, runner } = harness()
    void runner.prepare()
    decision.script.push({ unavailable: 'transport' })
    await runner.consider('open you')
    expect(browser.navigations).toEqual([])
    expect(events).toEqual([])
    decision.script.push({ answers: { verb: choice('open'), target: choice('none'), slot: choice('s1-1') } })
    await runner.run('open youtube', { source: 'spoken' })
    expect(browser.navigations).toEqual(['https://youtube.com'])
    expect(events.some((event) => event.type === 'error')).toBe(false)
  })

  it('keeps one partial call in flight: a partial heard meanwhile waits, and only the newest is read next', async () => {
    const { decision, runner } = harness()
    void runner.prepare()
    decision.script.push({ answers: openYoutube(0.3) }, { answers: openYoutube(0.3) })
    const first = runner.consider('open you')
    void runner.consider('open yout')
    void runner.consider('open youtu')
    await first
    expect(decision.requests.map((request) => request.state.split('\n')[0])).toEqual(['The user spoke to a web browser: "open you"', 'The user spoke to a web browser: "open youtu"'])
  })

  /** A decision model whose first ask parks until `answer`. */
  function parkFirstAsk(decision: CountingDecisionModel): { answer(result: DecisionResult<DecisionQuestions>): void } {
    let answer: (result: DecisionResult<DecisionQuestions>) => void = () => {}
    const ask = decision.ask.bind(decision)
    decision.ask = ((request: DecisionRequest<DecisionQuestions>) => {
      if (decision.requests.length > 0) return ask(request)
      decision.requests.push(request)
      return new Promise<DecisionResult<DecisionQuestions>>((resolve) => (answer = resolve))
    }) as typeof decision.ask
    return { answer: (result) => answer(result) }
  }

  it('fires nothing for a partial still being read when its Utterance is let go (disarm, the abort head)', async () => {
    const { browser, decision, runner } = harness()
    void runner.prepare()
    const parked = parkFirstAsk(decision)
    const partial = runner.consider('open you')
    await flushMicrotasks()
    runner.dropPartials()
    parked.answer({ status: 'answered', answers: openYoutube(0.95) as never, latencyMs: 1, model: 'jev-1.14.0' })
    await partial
    expect(browser.navigations).toEqual([])
  })

  it('frees the one call in flight once a partial fires: the next Utterance\'s partials are read while the action still runs', async () => {
    const { browser, decision, runner } = harness()
    let land: () => void = () => {}
    browser.navigate = (url) =>
      new Promise((resolve) => {
        browser.navigations.push(url)
        land = () => resolve(`navigated to ${url}`)
      })
    void runner.prepare()
    decision.script.push({ answers: openYoutube(0.95) })
    const first = runner.consider('open youtube')
    await flushMicrotasks()
    expect(browser.navigations).toEqual(['https://youtube.com'])
    // The Endpoint's Task waits for hop 0 to land before it goes on (#328).
    const endpoint = runner.run('open youtube', { source: 'spoken' })
    await flushMicrotasks()
    void runner.prepare()
    await runner.consider('scroll down')
    expect(browser.scrolls).toEqual(['down'])
    land()
    await first
    await endpoint
  })

  it('keeps an Early Fire for its Endpoint across a typed line: the Endpoint still makes no second Command', async () => {
    const { browser, runner } = harness()
    let backs = 0
    browser.back = async () => {
      backs += 1
      return 'went back'
    }
    void runner.prepare()
    await runner.consider('go back')
    await runner.run('scroll down')
    await runner.run('go back', { source: 'spoken' })
    expect(backs).toBe(1)
  })

  it('records an Early Fire whose Utterance never reached an Endpoint at the next speech start, without a lead', async () => {
    const { records, runner } = harness()
    void runner.prepare()
    await runner.consider('go back')
    void runner.prepare()
    expect(records.filter((record) => record.type === 'decision')).toEqual([expect.objectContaining({ verb: 'back', earlyFire: { partial: 'go back' } })])
  })
})

// Increment 3 (#327, ADR 0076): `read` speaks the Page Read, sentence by
// sentence, and a failure speaks one line; actions that succeed stay silent.
// The Reaction of a Command whose output is speech closes on its first
// spoken sample.
describe('a Command whose output is speech', () => {
  it('reads the page aloud: the Card of its title and words, one speak of the page text, the Reaction on the first spoken sample (AC3)', async () => {
    const speech = new FakeSpeech()
    const { browser, events, perf, runner } = harness({ speech })
    browser.readPage = async () => PAGE_READ
    perf.state.monotonicMs = 500
    const run = runner.run('read', { source: 'spoken', turnId: 'voice-1', endpointAt: 400 })
    await flushMicrotasks()

    // The Card is shown when the text is in hand, before a word is spoken.
    expect(events.find((event) => event.type === 'display')).toMatchObject({ text: '## Example\n\nWelcome to the example. It has two sentences.\n\nA second block.' })
    expect(speech.spoken).toEqual([{ text: 'Welcome to the example. It has two sentences.\nA second block.', turnId: 'voice-1' }])
    expect(events.filter((event) => event.type === 'speak')).toEqual([
      { type: 'speak', turnId: 'voice-1', text: 'Welcome to the example. It has two sentences.\nA second block.', at: expect.any(Number) },
    ])
    expect(types(events).indexOf('display')).toBeLessThan(types(events).indexOf('speak'))
    expect(perf.records.filter((record) => record.stage === 'reaction')).toEqual([])
    // Still the Command in flight while it speaks: the Abort Head reaches it.
    expect(runner.getState()).toBe('running')
    expect(events).toContainEqual(expect.objectContaining({ type: 'status', turnId: 'voice-1', status: 'speaking' }))

    perf.state.monotonicMs = 1_150
    speech.sound()
    expect(perf.records.find((record) => record.stage === 'reaction')).toMatchObject({ durMs: 750, detail: { verb: 'read', effect: 'spoken' } })
    speech.finish()
    await run
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'done' })
    expect(runner.getState()).toBe('idle')
  })

  it('reads on to the end of a page longer than one part, each part read once the one before has been spoken', async () => {
    const speech = new FakeSpeech()
    const { browser, events, runner } = harness({ speech })
    const parts = (part: number): string => ['# Long — https://example.com/', 'page text:', `Part ${part} words.`, pageReadPartLine(part, 2)].join('\n')
    const reads: number[] = []
    browser.readPage = async (part = 1) => {
      reads.push(part)
      return parts(part)
    }
    const run = runner.run('read')
    await flushMicrotasks()
    expect(reads).toEqual([1])
    speech.finish()
    await flushMicrotasks()
    expect(reads).toEqual([1, 2])
    expect(speech.spoken.map((line) => line.text)).toEqual(['Part 1 words.', 'Part 2 words.'])
    speech.finish()
    await run
    // One Card, the Page Read's first part, as today.
    expect(events.filter((event) => event.type === 'display')).toHaveLength(1)
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'done' })
  })

  it('reads no further part once the speech was cut — the wake word stops the speaker without the runner', async () => {
    const speech = new FakeSpeech()
    const { browser, runner } = harness({ speech })
    const reads: number[] = []
    browser.readPage = async (part = 1) => {
      reads.push(part)
      return ['page text:', `Part ${part} words.`, pageReadPartLine(part, 2)].join('\n')
    }
    const run = runner.run('read')
    await flushMicrotasks()
    speech.finish({ ok: true, stopped: true })
    await run
    expect(reads).toEqual([1])
  })

  it('closes the Reaction on the Card when no sample was ever spoken', async () => {
    const speech = new FakeSpeech()
    const { browser, perf, runner } = harness({ speech })
    browser.readPage = async () => PAGE_READ
    perf.state.monotonicMs = 500
    const run = runner.run('read', { source: 'spoken', turnId: 'voice-1', endpointAt: 400 })
    await flushMicrotasks()
    perf.state.monotonicMs = 2_000
    speech.finish({ ok: false, error: 'piper missing' })
    await run
    expect(perf.records.find((record) => record.stage === 'reaction')).toMatchObject({ durMs: 100, detail: { verb: 'read', effect: 'display' } })
  })

  it('speaks that the page has no text when a read finds none', async () => {
    const speech = new FakeSpeech()
    const { runner } = harness({ speech })
    const run = runner.run('read')
    await flushMicrotasks()
    expect(speech.spoken.map((line) => line.text)).toEqual([SPOKEN_FAILURES.empty])
    speech.finish()
    await run
  })

  it('a later Command silences the reading, ends its turn cancelled, and the reading\'s remaining sentences are never synthesized (AC3)', async () => {
    const synthesized: string[] = []
    const renders: (() => void)[] = []
    const streams: { stopped: boolean }[] = []
    const speech = createSpeechCoordinator({
      synth: {
        synthesize: (text) => {
          synthesized.push(text)
          return new Promise((resolve) => renders.push(() => resolve(new Uint8Array([1]))))
        },
      },
      player: {
        open(): AudioStream {
          const state = { stopped: false }
          streams.push(state)
          let resolveDone!: () => void
          const done = new Promise<void>((resolve) => (resolveDone = resolve))
          return { done, write: () => {}, end: () => {}, stop: () => ((state.stopped = true), resolveDone()) }
        },
      },
    })
    const { browser, events, runner } = harness({ speech })
    browser.readPage = async () => PAGE_READ
    const reading = runner.run('read', { turnId: 'read-1' })
    await flushMicrotasks()
    renders.shift()!()
    await new Promise((resolve) => setImmediate(resolve))
    expect(synthesized).toEqual(['Welcome to the example.', 'It has two sentences.'])

    await runner.run('scroll down')
    expect(streams[0]!.stopped).toBe(true)
    renders.shift()!()
    await reading
    await new Promise((resolve) => setImmediate(resolve))
    expect(synthesized).toEqual(['Welcome to the example.', 'It has two sentences.'])
    const readTurn = events.filter((event) => 'turnId' in event && event.turnId === 'read-1')
    expect(readTurn.at(-1)).toMatchObject({ type: 'done', outcome: 'cancelled' })
  })

  it('abort silences the reading', async () => {
    const speech = new FakeSpeech()
    const { browser, runner } = harness({ speech })
    browser.readPage = async () => PAGE_READ
    const run = runner.run('read')
    await flushMicrotasks()
    expect(runner.abort()).toBe(true)
    expect(speech.stops).toBe(1)
    await run
    expect(runner.getState()).toBe('idle')
  })

  it('a failed open speaks its one line, and the turn still ends failed at once (AC4)', async () => {
    const speech = new FakeSpeech()
    const { browser, events, runner } = harness({ speech })
    browser.navigate = async () => {
      throw new Error('net::ERR_NAME_NOT_RESOLVED at https://nope.example/')
    }
    await runner.run('open nope.example')
    // Told in plain words (#329), marked a failure for the Feed and the Peek Card; the raw error stays on the tool result.
    expect(speech.spoken.map((line) => line.text)).toEqual(["That site can't be found."])
    expect(events.find((event) => event.type === 'speak')).toMatchObject({ text: "That site can't be found.", failure: true })
    expect(events.find((event) => event.type === 'tool_result')).toMatchObject({ ok: false, error: 'net::ERR_NAME_NOT_RESOLVED at https://nope.example/' })
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'failed' })
    // The line still sounding counts as the runner's: the Abort Head reaches it, and the next Command silences it.
    expect(runner.getState()).toBe('running')
    await runner.run('scroll down')
    expect(speech.stops).toBe(1)
  })

  it('a landing on an Action Outcome class speaks that class\'s line (AC4)', async () => {
    const landings: [string, string, string][] = [
      ['https://example.com/missing', 'Page Not Found', SPOKEN_FAILURES.notFound],
      ['https://example.com/down', '503 Service Unavailable', SPOKEN_FAILURES.unavailable],
      ['https://accounts.example.com/signin', 'Sign in', SPOKEN_FAILURES.blocker],
    ]
    for (const [url, title, line] of landings) {
      const speech = new FakeSpeech()
      const { browser, runner } = harness({ speech })
      browser.navigate = async () => `navigated: url=${url} title=${JSON.stringify(title)}\nsignature 1a2b3c4d\npage text:\nsome text`
      await runner.run(`open ${url}`)
      expect(speech.spoken.map((spoken) => spoken.text)).toEqual([line])
    }
    const speech = new FakeSpeech()
    const { browser, runner } = harness({ speech })
    browser.navigate = async () => 'navigated: url=https://example.com/ title="Home"\nsignature 1a2b3c4d'
    await runner.run('open example.com')
    browser.click = async () => blockedActionHead('click', 2, { fact: 'notShown' })
    await runner.run('click 2')
    expect(speech.spoken.map((spoken) => spoken.text)).toEqual([SPOKEN_FAILURES.empty, SPOKEN_FAILURES.blocked])
  })

  it('a successful click, type, scroll, back and a none publish no speak (AC4)', async () => {
    const speech = new FakeSpeech()
    const { decision, events, runner } = harness({ speech })
    await runner.run('click 2')
    await runner.run('type 3 hello')
    await runner.run('scroll down')
    await runner.run('back')
    await runner.run('open example.com')
    decision.script.push({ answers: { verb: choice('none', 0.7), target: choice('none'), slot: choice('none') } })
    await runner.run('what a lovely day', { source: 'spoken' })
    expect(events.some((event) => event.type === 'command' && event.dropped === true)).toBe(true)
    expect(speech.spoken).toEqual([])
    expect(events.filter((event) => event.type === 'speak')).toEqual([])
  })
})

describe('a Task: one Utterance, one or more Commands (#328, ADR 0076 amendment)', () => {
  const SEARCH = 'https://duckduckgo.com/?q=latest%20elon%20musk%20tweet'
  const POST = 'https://x.com/elonmusk/status/latest'
  const SEARCH_REFS: SnapshotRef[] = [
    ref(1, 'link', 'DuckDuckGo home', { href: 'https://duckduckgo.com/' }),
    ref(2, 'input', 'Search', { inputType: 'search' }),
    ref(3, 'link', 'Elon Musk (@elonmusk) / X', { href: 'https://x.com/elonmusk' }),
  ]
  /** The whole results page: the refs in view, the engine's own links, and a result below the fold. */
  const SEARCH_LINKS = [
    { label: 'DuckDuckGo home', href: 'https://duckduckgo.com/' },
    { label: 'Elon Musk (@elonmusk) / X', href: 'https://x.com/elonmusk' },
    { label: 'Settings', href: 'https://duckduckgo.com/settings' },
    { label: 'Elon Musk on X: the latest post', href: POST },
  ]
  const POST_REFS: SnapshotRef[] = [ref(1, 'link', 'Elon Musk', { href: 'https://x.com/elonmusk' }), ref(2, 'button', 'Show the post')]

  const answer = (verb: string, target = 'none', slot = 'none'): { answers: Record<string, DecisionAnswer> } => ({ answers: { verb: choice(verb), target: choice(target), slot: choice(slot) } })
  const decisions = (records: CommandLogRecord[]) => records.flatMap((record) => (record.type === 'decision' ? [record] : []))
  const commands = (events: PipelineEvent[]) => events.flatMap((event) => (event.type === 'command' ? [event] : []))

  /** A browser whose landings change the page: each address has its refs, and a results page its whole links. */
  function taskHarness(start = 'about:blank') {
    const h = harness()
    h.browser.snapshot = { ...h.browser.snapshot, url: start, title: '', refs: [] }
    const pages: Record<string, SnapshotRef[]> = { [SEARCH]: SEARCH_REFS, [POST]: POST_REFS }
    const navigate = h.browser.navigate.bind(h.browser)
    h.browser.navigate = async (url) => {
      const line = await navigate(url)
      h.browser.snapshot = { ...h.browser.snapshot, refs: pages[url] ?? [] }
      return line
    }
    h.browser.pageLinks = async () => (h.browser.snapshot.url === SEARCH ? SEARCH_LINKS : [])
    return h
  }

  it('AC1: searches, opens a result from the whole page, clicks a ref on the landing and ends done — silent, one event and one record per hop', async () => {
    const { browser, events, records, decision, perf, runner } = taskHarness()
    decision.script.push(answer('open', 'none', 's3-6'), answer('click', 'link-1'), answer('click', 'ref-2'), answer('done'))
    await runner.run('pull up the latest elon musk tweet', { source: 'spoken' })

    expect(browser.navigations).toEqual([SEARCH, POST])
    expect(browser.clicks).toEqual([2])
    expect(events.filter((event) => event.type === 'speak')).toEqual([])
    // Hop 1 was offered the results, not the engine's own links, and not a ref's link twice.
    const hop1 = (decision.requests[1]!.questions as { target: DecisionChoiceQuestion }).target
    expect(Object.keys(hop1.options)).toEqual(['none', 'ref-1', 'ref-2', 'ref-3', 'link-1'])
    expect(hop1.options['link-1']).toContain(POST)
    // Every hop read the whole transcript.
    for (const request of decision.requests) expect(request.state).toContain('"pull up the latest elon musk tweet"')

    const fired = commands(events)
    const taskId = fired[0]!.task!.id
    expect(fired.map((event) => event.task)).toEqual([0, 1, 2, 3].map((hop) => ({ id: taskId, hop })))
    expect(fired.map((event) => event.action)).toEqual([`open latest elon musk tweet`, `open ${POST}`, 'click [2] "Show the post"', 'done'])
    expect(fired[3]).toMatchObject({ dropped: true })

    const read = decisions(records)
    expect(read.map((record) => record.task)).toEqual([0, 1, 2, 3].map((hop) => ({ id: taskId, hop })))
    expect(read.map((record) => record.ended)).toEqual([undefined, undefined, undefined, 'done'])
    expect(new Set(read.map((record) => record.turnId)).size).toBe(4)
    // The Reaction is hop 0's alone; the task span is the Task's.
    expect(perf.records.filter((record) => record.stage === 'reaction').map((record) => record.turnId)).toEqual([taskId])
    expect(perf.records.filter((record) => record.stage === 'task')).toEqual([expect.objectContaining({ turnId: taskId, detail: expect.objectContaining({ ended: 'done', hops: 4, actions: 3 }) })])
  })

  it('AC10: a navigation the cap took as it stood says landing capped on its record', async () => {
    const { browser, records, land, runner } = harness()
    const navigate = browser.navigate.bind(browser)
    browser.navigate = async (url) => {
      land('capped')
      return navigate(url)
    }
    await runner.run('open youtube', { source: 'spoken' })
    await runner.run('scroll down', { source: 'spoken' })
    expect(decisions(records)).toEqual([expect.objectContaining({ verb: 'open', landing: 'capped', ended: 'local_match' }), expect.objectContaining({ verb: 'scroll_down' })])
    expect(decisions(records)[1]!.landing).toBeUndefined()
  })

  it('AC2: a Local-Matched hop 0 makes no continuation call and ends local_match', async () => {
    const { decision, records, runner } = harness()
    for (const line of ['scroll down', 'click 3', 'open youtube', 'press enter']) await runner.run(line, { source: 'spoken' })
    expect(decision.requests).toEqual([])
    expect(decisions(records).map((record) => record.ended)).toEqual(['local_match', 'local_match', 'local_match', 'local_match'])
  })

  it('AC2: a Jev-read read, stop or clear ends terminal with no continuation call', async () => {
    const { decision, records, runner } = harness()
    decision.script.push(answer('read'), answer('stop'), answer('clear'))
    await runner.run('what does this say', { source: 'spoken' })
    await runner.run('hold it right there', { source: 'spoken' })
    await runner.run('wipe that field', { source: 'spoken' })
    expect(decision.requests).toHaveLength(3)
    expect(decisions(records).map((record) => record.ended)).toEqual(['terminal', 'terminal', 'terminal'])
  })

  it('AC3: done at hop 0 fires nothing, writes a record, shows the words as already here, and has no Reaction', async () => {
    const { browser, events, records, decision, perf, runner } = harness()
    decision.script.push(answer('done'))
    await runner.run('pull up the example page', { source: 'spoken' })
    expect(browser.navigations).toEqual([])
    expect(browser.clicks).toEqual([])
    expect(decision.requests).toHaveLength(1)
    expect(commands(events)).toEqual([expect.objectContaining({ action: 'already here', dropped: true, task: expect.objectContaining({ hop: 0 }) })])
    expect(decisions(records)).toEqual([expect.objectContaining({ verb: 'done', ended: 'done' })])
    expect(perf.records.filter((record) => record.stage === 'reaction')).toEqual([])
  })

  it('AC3: none at hop 1 is a dead end — the page stays, nothing is spoken, the Feed says no next step', async () => {
    const { browser, events, records, decision, runner } = taskHarness()
    decision.script.push(answer('open', 'none', 's3-6'), answer('none'))
    await runner.run('pull up the latest elon musk tweet', { source: 'spoken' })
    expect(browser.navigations).toEqual([SEARCH])
    expect(events.filter((event) => event.type === 'speak')).toEqual([])
    expect(commands(events)[1]).toMatchObject({ action: 'no next step', dropped: true, task: { hop: 1 } })
    expect(decisions(records).map((record) => record.ended)).toEqual([undefined, 'none'])
  })

  it('#332: a later hop reading open on the same words opens the most probable result instead of searching again', async () => {
    const { browser, records, decision, runner } = taskHarness()
    // The logged Task's shape: every hop read open with the words, target none on top; on hop 1 a result close behind.
    // The result here is below the fold (a link-N), so the hop opens it; jevReading.test.ts covers a ref clicked.
    const again = (probabilities: Record<string, number>) => ({ answers: { verb: choice('open'), target: choice('none', probabilities.none, probabilities), slot: choice('s3-6') } })
    decision.script.push(again({ none: 1 }), again({ none: 0.63, 'link-1': 0.17, 'ref-1': 0.16 }), again({ none: 0.93 }))
    await runner.run('pull up the latest elon musk tweet', { source: 'spoken' })
    expect(browser.navigations).toEqual([SEARCH, POST])
    expect(decisions(records).map((record) => [record.verb, record.ended])).toEqual([
      ['open', undefined],
      ['open', undefined],
      ['none', 'none'],
    ])
  })

  it('AC4: the fifth action ends the Task as cap', async () => {
    const { browser, records, decision, runner } = harness()
    for (let hop = 0; hop < 6; hop += 1) decision.script.push(answer('scroll_down'))
    await runner.run('keep going down the page', { source: 'spoken' })
    expect(browser.scrolls).toHaveLength(5)
    expect(decision.requests).toHaveLength(5)
    expect(decisions(records).map((record) => record.ended)).toEqual([undefined, undefined, undefined, undefined, 'cap'])
  })

  it('AC4: an address the Task has visited is not among the next hop\'s targets', async () => {
    const { decision, runner } = taskHarness('https://x.com/elonmusk')
    decision.script.push(answer('open', 'none', 's3-6'), answer('done'))
    await runner.run('pull up the latest elon musk tweet', { source: 'spoken' })
    const hop1 = (decision.requests[1]!.questions as { target: DecisionChoiceQuestion }).target
    // ref 3 links back to where the Task started.
    expect(Object.keys(hop1.options)).toEqual(['none', 'ref-1', 'ref-2', 'link-1'])
    expect(decision.requests[1]!.state).toContain(`Pages visited: https://x.com/elonmusk ${SEARCH}`)
  })

  it('AC4: a Jev call unavailable at hop 1 ends the Task unavailable, with no best guess fired', async () => {
    const { browser, records, decision, runner } = taskHarness()
    decision.script.push(answer('open', 'none', 's3-6'), { unavailable: 'timeout' })
    await runner.run('pull up the latest elon musk tweet and open the first result', { source: 'spoken' })
    expect(browser.navigations).toEqual([SEARCH])
    expect(browser.clicks).toEqual([])
    expect(decisions(records).map((record) => record.ended)).toEqual([undefined, 'unavailable'])
  })

  it('AC4: a best guess at hop 0 ends the Task: a hop never guesses', async () => {
    const { browser, records, decision, runner } = taskHarness()
    decision.script.push({ unavailable: 'timeout' })
    await runner.run('pull up the latest elon musk tweet', { source: 'spoken' })
    expect(decision.requests).toHaveLength(1)
    expect(browser.navigations).toHaveLength(1)
    expect(decisions(records).map((record) => record.ended)).toEqual(['unavailable'])
  })

  it.each([
    ['a new Utterance', (runner: CommandRunner) => runner.run('scroll down', { source: 'spoken' }), 'abandoned: a later Command came first'],
    ['Escape or the Abort Head', (runner: CommandRunner) => runner.abort(), 'abandoned: stopped'],
  ])('AC5: %s during hop 1\'s read abandons it: its record is written, nothing fires', async (_name, supersede, action) => {
    const { browser, events, records, decision, runner } = taskHarness()
    decision.script.push(answer('open', 'none', 's3-6'), answer('click', 'ref-3'))
    const release = decision.hold(1)
    const task = runner.run('pull up the latest elon musk tweet', { source: 'spoken' })
    await flushMicrotasks()
    expect(decision.requests).toHaveLength(2)
    expect(runner.getState()).toBe('running')
    await supersede(runner)
    release()
    await task
    expect(browser.clicks).toEqual([])
    const hop1 = decisions(records).find((record) => record.task?.hop === 1)
    expect(hop1).toMatchObject({ verb: 'click', ended: 'superseded' })
    expect(commands(events).find((event) => event.task?.hop === 1)).toMatchObject({ action, dropped: true })
  })

  it('AC5: an Escape within 3 s of hop 1 firing is the Misfire signal overrun against hop 1; one later is not', async () => {
    for (const [after, counted] of [[1_000, true], [5_000, false]] as const) {
      const { records, decision, runner, setWall } = taskHarness()
      decision.script.push(answer('open', 'none', 's3-6'), answer('click', 'ref-3'), answer('done'))
      const release = decision.hold(2)
      setWall(10_000)
      const task = runner.run('pull up the latest elon musk tweet', { source: 'spoken' })
      await flushMicrotasks()
      expect(decision.requests).toHaveLength(3)
      const hop1 = decisions(records).find((record) => record.task?.hop === 1)!
      setWall(hop1.at + after)
      runner.abort()
      release()
      await task
      const overruns = records.filter((record) => record.type === 'misfire' && record.signal === 'overrun')
      expect(overruns).toEqual(counted ? [expect.objectContaining({ turnId: hop1.turnId, hop: 1, withinMs: after })] : [])
    }
  })

  it('AC5: an overrun counts against the hop that fired even after the Task ended done: the user wanted less than it did', async () => {
    const { records, decision, runner, setWall } = taskHarness()
    decision.script.push(answer('open', 'none', 's3-6'), answer('click', 'ref-3'), answer('done'))
    setWall(10_000)
    await runner.run('pull up the latest elon musk tweet', { source: 'spoken' })
    const hop1 = decisions(records).find((record) => record.task?.hop === 1)!
    setWall(hop1.at + 2_000)
    runner.abort()
    expect(records.filter((record) => record.type === 'misfire')).toEqual([expect.objectContaining({ signal: 'overrun', turnId: hop1.turnId, hop: 1, withinMs: 2_000 })])
  })

  it('AC7: a type hop\'s Slot is read against the landing\'s Page Terms, and what was heard stays on the record', async () => {
    const { browser, records, decision, runner } = taskHarness()
    const navigate = browser.navigate.bind(browser)
    browser.navigate = async (url) => {
      const line = await navigate(url)
      browser.snapshot = { ...browser.snapshot, title: 'YouTube', refs: [ref(1, 'input', 'Search', { inputType: 'search' }), ref(2, 'link', 'Linus Tech Tips')] }
      return line
    }
    // "open youtube and search for line stack tips": Jev reads hop 0 as open youtube, hop 1 as a type.
    decision.script.push(answer('open', 'none', 's1-1'), answer('type', 'ref-1', 's5-7'), answer('done'))
    await runner.run('open youtube and search for line stack tips', { source: 'spoken' })
    expect(browser.navigations).toEqual(['https://youtube.com'])
    expect(browser.typed).toEqual([{ ref: 1, text: 'linus tech tips' }])
    expect(decisions(records)[1]).toMatchObject({ verb: 'type', slot: 'linus tech tips', slotHeard: 'line stack tips', slotFrom: 'page', task: { hop: 1 } })
  })
})

describe('the one Answer every Command leaves (#333)', () => {
  const displays = (events: PipelineEvent[]) => events.filter((event): event is Extract<PipelineEvent, { type: 'display' }> => event.type === 'display')

  it('a navigate, a click, a type, a scroll, a press and a Stop each end with their verb’s sentence, no model asked', async () => {
    const { decision, events, runner } = harness()
    await runner.run('navigate example.com')
    await runner.run('click 2')
    await runner.run('type 3 hello')
    await runner.run('scroll down')
    await runner.run('press enter')
    await runner.run('stop')
    expect(decision.requests).toEqual([])
    expect(displays(events).map((event) => event.text)).toEqual([
      'Opened Fake page: https://example.com.',
      'Clicked “Sign in”.',
      'Typed into “Search”.',
      'Scrolled down.',
      'Pressed Enter.',
      'Stopped.',
    ])
    // Exactly one Answer per Command, before its turn closes.
    for (const display of displays(events)) {
      const done = events.findIndex((event) => event.type === 'done' && event.turnId === display.turnId)
      expect(events.indexOf(display)).toBeLessThan(done)
    }
  })

  it('a `read` shows a Card of the page title and its words alone — what is spoken', async () => {
    const speech = new FakeSpeech()
    const { browser, events, runner } = harness({ speech })
    browser.readPage = async () => PAGE_READ
    const run = runner.run('read')
    await flushMicrotasks()
    speech.finish()
    await run
    expect(displays(events).map((event) => event.text)).toEqual(['## Example\n\nWelcome to the example. It has two sentences.\n\nA second block.'])
    expect(speech.spoken.map((spoken) => spoken.text)).toEqual(['Welcome to the example. It has two sentences.\nA second block.'])
  })

  it('a thrown failure’s line is the Answer, marked a failure, with or without a voice', async () => {
    for (const speech of [undefined, new FakeSpeech()]) {
      const { browser, events, runner } = harness(speech ? { speech } : {})
      browser.click = async () => {
        throw new Error('ref 9 refused')
      }
      await runner.run('click 9')
      expect(displays(events)).toEqual([expect.objectContaining({ text: "There's no item 9 on this page.", failure: true })])
      expect(speech?.spoken.map((spoken) => spoken.text) ?? []).toEqual(speech ? ["There's no item 9 on this page."] : [])
    }
  })

  it('a Command the Stop button, Escape or the Abort Head ends is answered "Stopped."; one a later Command ends says so', async () => {
    const { browser, events, runner } = harness()
    browser.navigate = () => new Promise<string>(() => {})
    void runner.run('navigate slow.example')
    await flushMicrotasks()
    const stopped = events.find((event) => event.type === 'command')!.turnId
    runner.abort()
    void runner.run('navigate slower.example')
    await flushMicrotasks()
    const superseded = events.filter((event) => event.type === 'command')[1]!.turnId
    await runner.run('scroll down')
    const answers = displays(events).map((event) => [event.turnId, event.text])
    expect(answers).toEqual([
      [stopped, 'Stopped.'],
      [superseded, 'Stopped: a later Command came first.'],
      [expect.any(String), 'Scrolled down.'],
    ])
  })

  it('a `read` stopped while it is spoken keeps its Card as its one Answer', async () => {
    const speech = new FakeSpeech()
    const { browser, events, runner } = harness({ speech })
    browser.readPage = async () => PAGE_READ
    const run = runner.run('read')
    await flushMicrotasks()
    runner.abort()
    await run
    expect(displays(events)).toHaveLength(1)
    expect(displays(events)[0]!.text).toMatch(/^## Example/)
  })

  it('an empty Page Read’s Card is marked a failure, as its spoken line is', async () => {
    const { events, runner } = harness()
    await runner.run('read')
    expect(displays(events)).toEqual([expect.objectContaining({ text: SPOKEN_FAILURES.empty, failure: true })])
  })

  it('a Page Read’s Card carries its whole part, uncut', async () => {
    const { browser, events, runner } = harness()
    const long = Array.from({ length: 300 }, (_, index) => `Sentence number ${index} of the page.`)
    browser.readPage = async () => ['# Long — https://example.com/', 'page text:', ...long, pageReadPartLine(1, 1)].join('\n')
    await runner.run('read')
    expect(displays(events)[0]!.text).toContain('Sentence number 299 of the page.')
  })

  it('a wall’s line is the Answer, marked a failure, in place of the verb’s sentence', async () => {
    const { browser, events, runner } = harness()
    browser.click = async () => blockedActionHead('click', 2, { fact: 'notShown' })
    await runner.run('click 2')
    expect(displays(events)).toEqual([expect.objectContaining({ text: SPOKEN_FAILURES.blocked, failure: true })])
  })
})
