import { describe, expect, it } from 'vitest'
import type { PipelineEvent } from '../../core/pipeline/events'
import type { SnapshotRef } from '../../core/browser/snapshot'
import type { CommandLogRecord } from '../../core/command/decisionRecord'
import type { DecisionAnswer, DecisionChoiceQuestion, DecisionModel, DecisionQuestions, DecisionRequest, DecisionResult, DecisionUnavailableReason } from '../../core/ports/decisionModel'
import { FakeBrowser, fakePerfHarness, flushMicrotasks } from '../../core/testing/doubles'
import type { ActionEffect } from '../browser/createCdpBrowserController'
import { JEV_VERBS } from '../../core/command/command'
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

  async ask<const Q extends DecisionQuestions>(request: DecisionRequest<Q>): Promise<DecisionResult<Q>> {
    this.requests.push(request as DecisionRequest<DecisionQuestions>)
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

function harness(options?: { decision?: null }) {
  const browser = new FakeBrowser()
  browser.snapshot = { ...browser.snapshot, url: 'https://example.com/', title: 'Example', refs: PAGE_REFS }
  const events: PipelineEvent[] = []
  const records: CommandLogRecord[] = []
  const screenshots: string[] = []
  const perf = fakePerfHarness()
  const effectListeners = new Set<(effect: ActionEffect) => void>()
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
    onEffect: (listener) => {
      effectListeners.add(listener)
      return () => effectListeners.delete(listener)
    },
    screenshotDir: () => '/shots',
    saveScreenshot: async (path) => {
      screenshots.push(path)
    },
  })
  const observe = (effect: ActionEffect): void => {
    for (const listener of effectListeners) listener(effect)
  }
  return { browser, events, records, screenshots, perf, decision, runner, observe, setWall: (at: number) => (wall = at) }
}

const types = (events: PipelineEvent[]): string[] => events.map((event) => event.type)

describe('a Command the Local Match settles', () => {
  it('fires at once with no Jev call: the CLI grammar', async () => {
    const { browser, events, decision, runner } = harness()
    expect(await runner.run('navigate youtube.com')).toBe(true)
    expect(browser.navigations).toEqual(['https://youtube.com'])
    expect(decision.requests).toEqual([])
    expect(types(events)).toEqual(['command', 'status', 'tool_call', 'tool_result', 'done'])
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
    decision.script.push({ answers: { verb: choice('open'), target: choice('ref-1', 0.64), slot: choice('none') } })
    await runner.run("open elon musk's profile", { source: 'spoken' })
    expect(decision.requests).toHaveLength(1)
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

  it('shows a read as a Card and nothing else as one — actions stay silent', async () => {
    const { events, runner } = harness()
    await runner.run('read')
    await runner.run('scroll down')
    const displays = events.filter((event) => event.type === 'display')
    expect(displays).toHaveLength(1)
    expect(displays[0]).toMatchObject({ text: '<page>blank</page>' })
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
  it('makes exactly one Jev call with the three questions over the transcript, the page and its refs', async () => {
    const { browser, decision, runner, events } = harness()
    decision.script.push({ answers: { verb: choice('click'), target: choice('ref-1'), slot: choice('none') } })

    await runner.run('take me home', { source: 'spoken' })

    expect(decision.requests).toHaveLength(1)
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
    expect(abandoned[0]).toMatchObject({ dropped: true, action: 'abandoned' })
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
    expect(events[0]).toMatchObject({ dropped: true, action: 'abandoned' })
    expect(events[1]).toMatchObject({ outcome: 'cancelled' })
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
    expect(types(firstTurnEvents)).toEqual(['command', 'status', 'tool_call', 'status', 'done'])
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
    expect(types(events)).toEqual(['command', 'status', 'tool_call', 'status', 'done'])
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
    expect(types(events)).toEqual(['command', 'status', 'tool_call', 'tool_result', 'done'])
    expect(events[3]).toMatchObject({ type: 'tool_result', ok: false, error: 'ref 9 refused' })
    expect(events[4]).toMatchObject({ type: 'done', outcome: 'failed' })
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
    decision.script.push({ answers: { verb: choice('none', 0.9), target: choice('none'), slot: choice('none') } })

    // No plain verb heads the words: the Local Match settles nothing, Jev reads them.
    await runner.run('hello there into search', { source: 'spoken', turnId: 'voice-1' })
    await runner.run('nothing at all', { source: 'spoken', turnId: 'voice-2' })
    await runner.run('scroll down', { turnId: 'typed-1' })

    expect(records.map((record) => record.type)).toEqual(['decision', 'decision', 'decision'])
    expect(records[0]).toEqual({
      type: 'decision',
      turnId: 'voice-1',
      at: 1_700_000_000_000,
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
    })
    expect(records[1]).toMatchObject({ turnId: 'voice-2', verb: 'none', reading: 'jev' })
    expect(records[2]).toMatchObject({ turnId: 'typed-1', source: 'typed', verb: 'scroll_down', reading: 'local_match', jevAsked: false })
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
      { type: 'misfire', turnId: 't1', at: 11_000, signal: 'opposite_scroll', signalTurnId: 't2', withinMs: 1_000 },
      { type: 'misfire', turnId: 't3', at: 21_000, signal: 'back', signalTurnId: 't4', withinMs: 1_000 },
    ])
  })

  it('saves a screenshot under the screenshot dir and names the file in the Card', async () => {
    const { events, screenshots, runner } = harness()
    await runner.run('screenshot')
    expect(screenshots).toEqual(['/shots/screenshot-1.jpg'])
    expect(events.find((event) => event.type === 'display')).toMatchObject({ text: 'screenshot saved: /shots/screenshot-1.jpg' })
  })
})
