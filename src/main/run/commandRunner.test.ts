import { describe, expect, it } from 'vitest'
import type { PipelineEvent } from '../../core/pipeline/events'
import type { SnapshotRef } from '../../core/browser/snapshot'
import type { PageLanding } from '../../core/ports/browser'
import type { CommandLogRecord } from '../../core/command/decisionRecord'
import type { AskRecord } from '../../core/decision/askRecord'
import type { DecisionAnswer, DecisionChoiceQuestion, DecisionModel, DecisionQuestions, DecisionRequest, DecisionResult, DecisionUnavailableReason } from '../../core/ports/decisionModel'
import { FakeBrowser, fakePerfHarness, flushMicrotasks } from '../../core/testing/doubles'
import type { ActionEffect } from '../browser/createCdpBrowserController'
import { JEV_VERBS, verbKeepsIdle } from '../../core/command/command'
import { wakesIdleScreen } from '../../core/idle/idleWake'
import type { AudioStream, SpeakOptions, SpeakOutcome, TtsSpeaker } from '../../core/ports/tts'
import { pageReadPartLine } from '../../core/browser/pageText'
import { NO_OBSERVABLE_CHANGE, PAGE_SIGNATURE_CHANGED, blockedActionHead } from '../../core/browser/actionOutcome'
import { SPOKEN_FAILURES } from '../../core/command/spokenFailure'
import { createSpeechCoordinator } from '../../core/tts/speechCoordinator'
import { MOUNTING_WAIT_MS, RESULTS_POLL_MS, RESULTS_WAIT_MS, createCommandRunner, type CommandRunner, type CommandRunnerDeps } from './commandRunner'
import { createPlayer, type SongMemory } from '../music/player'
import { ScriptedYouTube, videoItem } from '../music/scriptedYouTube'

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
    return { status: 'answered', answers: withVerdict(request.questions, next.answers) as never, latencyMs: this.latencyMs, model: this.model }
  }
}

/** A script that answers no Verdict where one is asked gets a sure one, as a plain hop would: yes after `done`, else not yet. */
function withVerdict(questions: DecisionQuestions, answers: Record<string, DecisionAnswer>): Record<string, DecisionAnswer> {
  if (!('outcome' in questions) || 'outcome' in answers) return answers
  const verb = answers.verb
  return { ...answers, outcome: choice(verb?.type === 'choice' && verb.choice === 'done' ? 'yes' : 'not_yet') }
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

function harness(options?: { decision?: null; learned?: string[]; speech?: Pick<TtsSpeaker, 'speak' | 'stop'>; timer?: CommandRunnerDeps['timer']; player?: (browser: FakeBrowser) => CommandRunnerDeps['player'] }) {
  const browser = new FakeBrowser()
  const player = options?.player?.(browser)
  browser.snapshot = { ...browser.snapshot, url: 'https://example.com/', title: 'Example', refs: PAGE_REFS }
  const events: PipelineEvent[] = []
  const records: CommandLogRecord[] = []
  const asks: AskRecord[] = []
  const screenshots: string[] = []
  /** Each wait on the clock the runner asked for, in ms: none passes. */
  const sleeps: number[] = []
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
    askLog: { write: (record) => asks.push(record) },
    onLanding: (listener) => {
      landingListeners.add(listener)
      return () => landingListeners.delete(listener)
    },
    onEffect: (listener) => {
      effectListeners.add(listener)
      return () => effectListeners.delete(listener)
    },
    ...(options?.speech ? { speech: options.speech } : {}),
    ...(options?.timer ? { timer: options.timer } : {}),
    ...(player ? { player } : {}),
    screenshotDir: () => '/shots',
    saveScreenshot: async (path) => {
      screenshots.push(path)
    },
    sleep: async (ms) => {
      sleeps.push(ms)
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
  return { browser, events, records, asks, screenshots, sleeps, perf, decision, runner, observe, land, admitted, proposed, observed, setWall: (at: number) => (wall = at) }
}

const types = (events: PipelineEvent[]): string[] => events.map((event) => event.type)

describe('the Timer (CONTEXT.md)', () => {
  function fakeTimer(status: 'off' | 'running' | 'ringing' = 'off') {
    const calls: string[] = []
    let state = status
    return {
      calls,
      timer: {
        set: (durationMs: number) => {
          calls.push(`set ${durationMs}`)
          state = 'running'
        },
        cancel: () => {
          calls.push('cancel')
          const had = state !== 'off'
          state = 'off'
          return had
        },
        silence: () => {
          calls.push('silence')
          const had = state === 'ringing'
          if (had) state = 'off'
          return had
        },
      },
    }
  }
  const displays = (events: PipelineEvent[]): string[] => events.flatMap((event) => (event.type === 'display' ? [event.text] : []))

  it('a spoken "set a timer for five minutes" sets it with no Jev call and no browser action, and says so', async () => {
    const { timer, calls } = fakeTimer()
    const { browser, events, decision, runner } = harness({ timer })
    await runner.run('set a timer for five minutes', { source: 'spoken' })
    expect(calls).toEqual(['set 300000'])
    expect(decision.requests).toEqual([])
    expect(browser.navigations).toEqual([])
    expect(events[0]).toMatchObject({ type: 'command', action: 'timer 5 minutes', keepsIdle: true })
    expect(events.find((event) => event.type === 'tool_call')).toMatchObject({ name: 'timer', args: {} })
    expect(displays(events)).toEqual(['Timer set for 5 minutes.'])
  })

  it('the grammar\'s `timer off` and a spoken "cancel the timer" turn it off — never the stop verb', async () => {
    const { timer, calls } = fakeTimer('running')
    const { events, runner } = harness({ timer })
    await runner.run('timer off')
    await runner.run('cancel the timer', { source: 'spoken' })
    expect(calls).toEqual(['cancel', 'cancel'])
    expect(events.filter((event) => event.type === 'command').map((event) => (event as { action: string }).action)).toEqual(['timer off', 'timer off'])
    expect(displays(events)).toEqual(['Timer off.', 'Timer off.'])
  })

  it('"stop" silences a ringing Timer as it stops everything else', async () => {
    const { timer, calls } = fakeTimer('ringing')
    const { events, runner } = harness({ timer })
    await runner.run('stop', { source: 'spoken' })
    expect(calls).toEqual(['silence'])
    expect(events[0]).toMatchObject({ type: 'command', keepsIdle: true })
    expect(displays(events)).toEqual(['Stopped.'])
  })

  it('a surface with no Timer fails the Command in words', async () => {
    const { events, runner } = harness()
    await runner.run('timer 5m')
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'failed' })
  })
})

describe('the Player (#343)', () => {
  const displays = (events: PipelineEvent[]): string[] => events.flatMap((event) => (event.type === 'display' ? [event.text] : []))
  const QUEEN = 'Queen – Bohemian Rhapsody (Official Video Remastered)'

  /** A runner wired to a real Player over a scripted YouTube. */
  function music(options?: { speech?: Pick<TtsSpeaker, 'speak' | 'stop'>; learned?: string[]; songs?: SongMemory }) {
    let youtube!: ScriptedYouTube
    const { songs, ...rest } = options ?? {}
    const wired = harness({
      ...rest,
      player: (browser) => {
        youtube = new ScriptedYouTube(browser)
        return createPlayer({ browser, fetchResults: youtube.fetchResults, sleep: async () => {}, ...(songs !== undefined ? { songs } : {}) })
      },
    })
    youtube.search(
      'bohemian rhapsody',
      { reelShelfRenderer: { items: [] } },
      { channelRenderer: { channelId: 'UCqueen' } },
      { playlistRenderer: { playlistId: 'PLqueen' } },
      videoItem('fJ9rUzIMcZQ', QUEEN),
    )
    youtube.watches.set('fJ9rUzIMcZQ', { title: QUEEN })
    return { ...wired, youtube }
  }

  it('`play <words>` opens the results, picks the first plain video past a Short, a channel and a playlist, and plays its watch page', async () => {
    const { browser, events, records, decision, runner } = music()
    await runner.run('play bohemian rhapsody')
    expect(browser.navigations).toEqual(['https://www.youtube.com/results?search_query=bohemian+rhapsody', 'https://www.youtube.com/watch?v=fJ9rUzIMcZQ'])
    expect(decision.requests).toEqual([])
    expect(events.filter((event) => event.type === 'command')).toEqual([expect.objectContaining({ action: 'play bohemian rhapsody' })])
    expect(displays(events)).toEqual([`Playing “${QUEEN}”.`])
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'done' })
    expect(records.filter((record) => record.type === 'decision')).toEqual([expect.objectContaining({ verb: 'play', slot: 'bohemian rhapsody', video: 'fJ9rUzIMcZQ', pick: 'searched', reading: 'local_match', ended: 'local_match' })])
  })

  it('a remembered song (#345) opens with no results page, answers as before, and is recorded `remembered`', async () => {
    const remembered = { id: 'rememberedQ', title: 'Bohemian Rhapsody' }
    const songs: SongMemory = { recall: (words) => (words === 'bohemian rhapsody' ? remembered : null), remember: () => {}, forgetWords: () => {}, forgetVideo: () => false }
    const { browser, events, records, youtube, runner } = music({ songs })
    youtube.watches.set(remembered.id, { title: remembered.title })
    await runner.run('play bohemian rhapsody')
    expect(browser.navigations).toEqual(['https://www.youtube.com/watch?v=rememberedQ'])
    expect(displays(events)).toEqual(['Playing “Bohemian Rhapsody”.'])
    expect(records.filter((record) => record.type === 'decision')).toEqual([expect.objectContaining({ verb: 'play', video: 'rememberedQ', pick: 'remembered' })])
  })

  it('`not that one` (#345) is a Command of its own that answers what plays instead', async () => {
    const { events, youtube, runner } = music()
    youtube.search('bohemian rhapsody', videoItem('fJ9rUzIMcZQ', QUEEN), videoItem('secondvideo', 'Panic! – Bohemian Rhapsody'))
    youtube.watches.set('secondvideo', { title: 'Panic! – Bohemian Rhapsody' })
    await runner.run('play bohemian rhapsody')
    await runner.run('not that one')
    expect(events.filter((event) => event.type === 'command').map((event) => (event.type === 'command' ? event.action : ''))).toEqual(['play bohemian rhapsody', 'not that one'])
    expect(displays(events).at(-1)).toBe('Playing “Panic! – Bohemian Rhapsody” instead.')
  })

  it('a spoken search passes the Name Match\'s Learned Terms, and Jev is never asked', async () => {
    const { browser, decision, runner } = music({ learned: ['Bohemian Rhapsody'] })
    await runner.run('Play bohemian rapsody.', { source: 'spoken' })
    expect(decision.requests).toEqual([])
    expect(browser.navigations[0]).toBe('https://www.youtube.com/results?search_query=Bohemian+Rhapsody')
  })

  it('a song that cannot be played fails the Command in words', async () => {
    const { events, youtube, runner } = music()
    youtube.watches.set('fJ9rUzIMcZQ', { title: QUEEN, fails: 'error' })
    await runner.run('play bohemian rhapsody')
    expect(events.find((event) => event.type === 'display')).toMatchObject({ text: `“${QUEEN}” can't be played.`, failure: true })
  })

  it('the element verbs answer from the element', async () => {
    const { events, runner } = music()
    await runner.run('play bohemian rhapsody')
    await runner.run('pause')
    await runner.run('loop')
    await runner.run('play')
    expect(displays(events)).toEqual([`Playing “${QUEEN}”.`, 'Paused.', `Looping “${QUEEN}”.`, `Playing “${QUEEN}”.`])
  })

  it('`stop` with nothing in flight pauses the music (owner\'s ruling 2)', async () => {
    const { events, youtube, runner } = music()
    await runner.run('play bohemian rhapsody')
    await runner.run('stop', { source: 'spoken' })
    expect(youtube.element.paused).toBe(true)
    expect(displays(events).at(-1)).toBe('Paused.')
  })

  it('`stop` with a Command in flight aborts it and leaves the music playing', async () => {
    const speech = new FakeSpeech()
    const { events, youtube, runner } = music({ speech })
    await runner.run('play bohemian rhapsody')
    const reading = runner.run('read')
    await flushMicrotasks()
    expect(runner.getState()).toBe('running')
    await runner.run('stop', { source: 'spoken' })
    await reading
    expect(youtube.element.paused).toBe(false)
    expect(youtube.controls.map((control) => control.op)).not.toContain('pauseIfPlaying')
    expect(displays(events).at(-1)).toBe('Stopped.')
  })

  it('a partial "stop" still fires at once while there is something to stop — it is only an abort then', async () => {
    const speech = new FakeSpeech()
    const { youtube, runner } = music({ speech })
    await runner.run('play bohemian rhapsody')
    const reading = runner.run('read')
    await flushMicrotasks()
    await runner.consider('stop')
    await reading
    expect(runner.getState()).toBe('idle')
    expect(youtube.element.paused).toBe(false)
  })

  it('every Player verb keeps the Idle Screen up, `play <words>` included; "show the video" wakes it (#344)', async () => {
    const { events, runner } = music()
    expect(verbKeepsIdle('play')).toBe(true)
    for (const line of ['play bohemian rhapsody', 'queue bohemian rhapsody', 'pause', 'play', 'skip', 'previous', 'loop', 'restart', 'volume 40', 'louder']) await runner.run(line)
    const commands = events.filter((event) => event.type === 'command')
    expect(commands).toHaveLength(10)
    expect(commands.filter(wakesIdleScreen)).toEqual([])
    for (const line of ['show the video', 'show it']) {
      await runner.run(line)
      const shown = events.filter((event) => event.type === 'command').at(-1)!
      expect(shown).toMatchObject({ action: 'show the video' })
      expect(wakesIdleScreen(shown)).toBe(true)
    }
    expect(displays(events).slice(-2)).toEqual([`Showing “${QUEEN}”.`, `Showing “${QUEEN}”.`])
  })

  it('no partial fires a Player verb early, and Jev is not asked about one (#326)', async () => {
    const { browser, decision, runner } = music()
    for (const partial of ['play', 'play bohemian', 'skip', 'pause', 'stop', 'go back']) await runner.consider(partial)
    expect(browser.navigations).toEqual([])
    expect(browser.evaluations).toEqual([])
    expect(decision.requests).toEqual([])
  })
})

describe('a Command the Local Match settles', () => {
  it('fires at once with no Jev call: the CLI grammar', async () => {
    const { browser, events, decision, runner } = harness()
    expect(await runner.run('navigate youtube.com')).toBe(true)
    expect(browser.navigations).toEqual(['https://youtube.com'])
    expect(decision.requests).toEqual([])
    expect(types(events)).toEqual(['command', 'status', 'tool_call', 'tool_result', 'display', 'done'])
    expect(events[0]).toMatchObject({ type: 'command', text: 'navigate youtube.com', action: 'navigate youtube.com' })
    expect(events[0]).not.toHaveProperty('keepsIdle')
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

  it('asks Jev for an open whose words are about the page rather than an address; a search Jev gives a ref is a click', async () => {
    const { browser, decision, runner } = harness()
    decision.script.push({ answers: { verb: choice('search'), target: choice('ref-1', 0.64), slot: choice('none') } }, { answers: { verb: choice('done'), target: choice('none'), slot: choice('none') } })
    await runner.run("open elon musk's profile", { source: 'spoken' })
    // The Command's call, and its Task's next hop saying done (#328).
    expect(decision.requests).toHaveLength(2)
    expect(browser.clicks).toEqual([1])
    expect(browser.navigations).toEqual([])
  })

  it('opens a bare word at its .com and an address as itself with no Jev call; search phrasing is Jev\'s, whose search is run (#353)', async () => {
    const { browser, decision, runner } = harness()
    await runner.run('open youtube')
    await runner.run('go to news.ycombinator.com')
    expect(decision.requests).toEqual([])
    decision.script.push({ answers: { verb: choice('search'), target: choice('none'), slot: choice('s2-4') } }, { answers: { verb: choice('done'), target: choice('none'), slot: choice('none') } })
    await runner.run('search for rust async book')
    expect(decision.requests).toHaveLength(2)
    expect(browser.navigations).toEqual(['https://youtube.com', 'https://news.ycombinator.com', 'https://duckduckgo.com/?q=rust%20async%20book'])
  })

  it('reads the seven spoken commands of AC1 into their browser actions', async () => {
    const { browser, decision, runner } = harness()
    await runner.run('open youtube', { source: 'spoken' })
    await runner.run('click sign in', { source: 'spoken' })
    await runner.run('scroll down', { source: 'spoken' })
    decision.script.push({ answers: { verb: choice('search'), target: choice('none'), slot: choice('s2-4') } }, { answers: { verb: choice('done'), target: choice('none'), slot: choice('none') } })
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
  it('makes one Jev call with the questions over the transcript, the page and its refs — where among them on a site (#340) — and its Task one more per hop', async () => {
    const { browser, decision, runner, events } = harness()
    decision.script.push({ answers: { verb: choice('click'), target: choice('ref-1'), slot: choice('none') } }, { answers: { verb: choice('done'), target: choice('none'), slot: choice('none') } })

    await runner.run('take me home', { source: 'spoken' })

    expect(decision.requests).toHaveLength(2)
    const request = decision.requests[0]!
    expect(Object.keys(request.questions)).toEqual(['verb', 'target', 'slot', 'where'])
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

  it('fires nothing and publishes no error when Jev is unavailable: no ref by shared words, one greyed Feed Entry (#353)', async () => {
    const { browser, decision, runner, events, records } = harness()
    decision.script.push({ unavailable: 'timeout' })

    await runner.run('tap on the sign thing', { source: 'spoken' })

    expect(decision.requests).toHaveLength(1)
    expect(browser.clicks).toEqual([])
    expect(events.some((event) => event.type === 'error' || event.type === 'tool_call')).toBe(false)
    expect(events.filter((event) => event.type === 'command')).toEqual([expect.objectContaining({ text: 'tap on the sign thing', dropped: true })])
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'done' })
    expect(records[0]).toMatchObject({ type: 'decision', verb: 'none', reading: 'best_guess', jevAsked: true, ended: 'unavailable', jev: { reason: 'timeout', latencyMs: 212 } })
  })

  it('never searches the words of an unread line when Jev is unavailable (#353): nothing fires, nothing is spoken', async () => {
    const speech = new FakeSpeech()
    const { browser, decision, events, runner } = harness({ speech })
    decision.script.push({ unavailable: 'failed' })
    await runner.run('lovely weather in lisbon', { source: 'spoken' })
    expect(browser.navigations).toEqual([])
    expect(events.filter((event) => event.type === 'display')).toEqual([expect.objectContaining({ text: "No response.\n\nJev's call failed.", muted: true })])
    expect(events.some((event) => event.type === 'speak' || event.type === 'error')).toBe(false)
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'done' })
    expect(speech.spoken).toEqual([])
  })

  it('fires nothing with no Jev configured, and still fires the Local Match', async () => {
    const { browser, runner, records } = harness({ decision: null })
    await runner.run('tap on the sign thing')
    expect(browser.clicks).toEqual([])
    expect(records[0]).toMatchObject({ verb: 'none', reading: 'best_guess', jevAsked: false })
    expect(records[0]).not.toHaveProperty('jev')
    await runner.run('click sign in')
    expect(browser.clicks).toEqual([2])
  })

  it('a none verb publishes one greyed Feed Entry and no speak, error or tool_call', async () => {
    const { browser, decision, runner, events, records } = harness()
    decision.script.push({ answers: { verb: choice('none', 0.7), target: choice('none'), slot: choice('none') } })

    expect(await runner.run('what a lovely day', { source: 'spoken' })).toBe(true)

    expect(types(events)).toEqual(['command', 'display', 'done'])
    expect(events[0]).toMatchObject({ type: 'command', text: 'what a lovely day', dropped: true })
    expect(events[1]).toMatchObject({ type: 'display', text: 'No response.\n\nJev read no command in the words.', muted: true })
    expect(events[0]).not.toHaveProperty('action')
    expect(browser.clicks).toEqual([])
    expect(browser.navigations).toEqual([])
    expect(records[0]).toMatchObject({ type: 'decision', verb: 'none', reading: 'jev', jev: { confidence: { verb: 0.7 } } })
    expect(runner.getState()).toBe('idle')
  })
})

describe('an Utterance read as no Command answers "No response." and why (owner ruling 2026-10-19)', () => {
  const answers = (events: PipelineEvent[]): string[] => events.flatMap((event) => (event.type === 'display' ? [event.text] : []))

  it("a verb the grammar knows, gone wrong past it, says what went wrong in plain words", async () => {
    const { decision, events, runner } = harness()
    decision.script.push({ answers: { verb: choice('none'), target: choice('none'), slot: choice('none') } })
    await runner.run('press F5 3')
    expect(answers(events)).toEqual(["No response.\n\nI can't press F5. Keys I know: up, down, left, right, space, enter, tab, escape."])
  })

  it('says Jev is off when no Jev is configured', async () => {
    const { events, runner } = harness({ decision: null })
    await runner.run('zorblax the quux thing')
    expect(answers(events)).toEqual(["No response.\n\nJev is off, and the words aren't a command the grammar knows — try “help”."])
  })

  it('says why Jev gave no reading', async () => {
    const { decision, events, runner } = harness()
    decision.script.push({ unavailable: 'timeout' })
    await runner.run('zorblax the quux thing')
    expect(answers(events)).toEqual(["No response.\n\nJev didn't answer in time."])
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

  it('reports a browser failure as a failed tool result and a failed turn, with no error event, and its record says what threw', async () => {
    const { browser, events, records, runner } = harness()
    browser.click = async () => {
      throw new Error('ref 9 refused')
    }
    await runner.run('click 9')
    expect(types(events)).toEqual(['command', 'status', 'tool_call', 'tool_result', 'display', 'done'])
    expect(events[3]).toMatchObject({ type: 'tool_result', ok: false, error: 'ref 9 refused' })
    expect(events[5]).toMatchObject({ type: 'done', outcome: 'failed' })
    // The Feed is not kept: the decision record carries the message (post mortem 2026-10-19).
    expect(records).toEqual([expect.objectContaining({ type: 'decision', verb: 'click', target: 9, error: 'ref 9 refused', ended: 'local_match' })])
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
      // The ask's own stamp takes a tick of the counting clock first (#338).
      at: 1_700_000_000_002,
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
      ask: 'voice-1',
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

  it('saves a screenshot under the screenshot dir and names the folder, not the path, in the Card', async () => {
    const { events, screenshots, runner } = harness()
    await runner.run('screenshot')
    expect(screenshots).toEqual(['/shots/screenshot-1.jpg'])
    expect(events.find((event) => event.type === 'tool_result')).toMatchObject({ result: 'screenshot saved: /shots/screenshot-1.jpg' })
    expect(events.find((event) => event.type === 'display')).toMatchObject({ text: 'Saved a screenshot to shots.' })
  })
})

describe('what Jev was asked (#338)', () => {
  it('writes every Jev call\'s whole ask — the state and the questions — and each decision record names its ask', async () => {
    const { decision, runner, records, asks } = harness()
    decision.script.push({ answers: { verb: choice('click'), target: choice('ref-1'), slot: choice('none') } }, { answers: { verb: choice('done'), target: choice('none'), slot: choice('none') } })

    await runner.run('take me home', { source: 'spoken', turnId: 'voice-1' })

    expect(asks.map((ask) => ask.kind)).toEqual(['command', 'hop'])
    for (const [i, ask] of asks.entries()) {
      expect(ask).toMatchObject({ type: 'ask', model: 'jev-1.14.0' })
      expect(ask.state).toBe(decision.requests[i]!.state)
      expect(ask.questions).toEqual(decision.requests[i]!.questions)
    }
    expect(asks[0]).toMatchObject({ id: 'voice-1', turnId: 'voice-1' })
    const decisions = records.flatMap((record) => (record.type === 'decision' ? [record] : []))
    expect(decisions.map((record) => record.ask)).toEqual(asks.map((ask) => ask.id))
    expect(decisions[1]!.turnId).toBe(asks[1]!.turnId)
  })

  it('records the ask of a call Jev did not answer, and the unread line\'s record names it', async () => {
    const { decision, runner, records, asks } = harness()
    decision.script.push({ unavailable: 'timeout' })
    await runner.run('take me home', { turnId: 't1' })
    expect(asks).toEqual([expect.objectContaining({ id: 't1', kind: 'command' })])
    expect(records[0]).toMatchObject({ reading: 'best_guess', ask: 't1' })
  })

  it('writes no ask and names none for a Command the Local Match settles', async () => {
    const { runner, records, asks } = harness()
    await runner.run('scroll down', { turnId: 't1' })
    expect(asks).toEqual([])
    expect(records[0]).not.toHaveProperty('ask')
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
  /** A search line is Jev's (#353): its reading, and the hop after it saying done. */
  const searched = (slot: string): { answers: Record<string, DecisionAnswer> }[] => [
    { answers: { verb: choice('search'), target: choice('none'), slot: choice(slot) } },
    { answers: { verb: choice('done'), target: choice('none'), slot: choice('none') } },
  ]

  it('carries a spoken search whose words sound like a name on the page as that name, records what was heard, and admits the name', async () => {
    const { browser, events, records, admitted, decision: jev, runner } = harness()
    browser.snapshot = { ...browser.snapshot, title: 'Linus Tech Tips - YouTube', refs: NAMED_REFS }
    jev.script.push(...searched('s1-3'))
    expect(await runner.run('search line stack tips', { source: 'spoken' })).toBe(true)
    expect(browser.navigations[0]).toContain('linus')
    expect(browser.navigations[0]).not.toContain('stack')
    expect(events[0]).toMatchObject({ type: 'command', text: 'search line stack tips', action: 'search linus tech tips' })
    expect(decision(records[0])).toMatchObject({ slot: 'linus tech tips', slotHeard: 'line stack tips', slotFrom: 'page', reading: 'jev' })
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
    const { browser, records, admitted, decision: jev, runner } = harness()
    browser.snapshot = { ...browser.snapshot, refs: NAMED_REFS }
    jev.script.push(...searched('s1-3'))
    await runner.run('search line stack tips')
    expect(browser.navigations[0]).toContain('stack')
    expect(decision(records[0]).slotHeard).toBeUndefined()
    expect(admitted).toEqual([])
  })

  it('leaves a Slot alone that already carries the name, and one that sounds like no name', async () => {
    const { browser, records, admitted, decision: jev, runner } = harness()
    browser.snapshot = { ...browser.snapshot, refs: NAMED_REFS }
    jev.script.push(...searched('s1-3'), ...searched('s1-3'))
    await runner.run('search linus tech tips', { source: 'spoken' })
    await runner.run('search rust async book', { source: 'spoken' })
    expect(records.filter((record) => record.type === 'decision' && record.task?.hop === 0).map((record) => decision(record).slotHeard)).toEqual([undefined, undefined])
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
    const { browser, records, decision: jev, runner } = harness()
    browser.snapshot = { ...browser.snapshot, refs: NAMED_REFS }
    void runner.prepare()
    // The page moves on after speech start; the Command reads against the page spoken over.
    browser.snapshot = { ...browser.snapshot, refs: PAGE_REFS }
    jev.script.push(...searched('s1-3'))
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
  /** A search line is Jev's (#353): its reading, and the hop after it saying done. */
  const searched = (slot: string): { answers: Record<string, DecisionAnswer> }[] => [
    { answers: { verb: choice('search'), target: choice('none'), slot: choice(slot) } },
    { answers: { verb: choice('done'), target: choice('none'), slot: choice('none') } },
  ]

  it('proposes the last Slot of a chain of similar-sounding Slots once the user moves on', async () => {
    const { proposed, decision, runner } = harness()
    decision.script.push(...searched('s1-3'), ...searched('s1-3'))
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
    const { proposed, decision, runner } = harness()
    decision.script.push(...searched('s1-1'), ...searched('s1-3'), ...searched('s1-3'))
    await runner.run('search cats', { source: 'spoken' })
    await runner.run('click sign in', { source: 'spoken' })
    await runner.run('search rust async book', { source: 'spoken' })
    await runner.run('search linus tech tips', { source: 'spoken' })
    await runner.run('click sign in', { source: 'spoken' })
    expect(proposed).toEqual([])
  })

  it('lets a chain lapse after a minute', async () => {
    const { proposed, decision, runner, setWall } = harness()
    decision.script.push(...searched('s1-3'), ...searched('s1-3'))
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
  const openYoutube = (complete: number): Record<string, DecisionAnswer> => ({ verb: choice('navigate'), target: choice('none'), slot: choice('s1-1'), complete: noul(complete) })

  it('never fires a Slot-carrying partial on the Local Match; asks Jev the three Choices and one Noul, and fires only when the Noul clears 0.7', async () => {
    const { browser, events, records, decision, runner } = harness()
    void runner.prepare()
    decision.script.push({ answers: openYoutube(0.3) })
    await runner.consider('open you')
    expect(browser.navigations).toEqual([])
    expect(decision.requests).toHaveLength(1)
    const questions = decision.requests[0]!.questions
    // example.com is a site, so the partial asks where too (#340).
    expect(Object.keys(questions).sort()).toEqual(['complete', 'slot', 'target', 'verb', 'where'])
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
    expect(decisions[0]).toMatchObject({ verb: 'navigate', slot: 'youtube', reading: 'jev', jevAsked: true, partialCalls: 2, earlyFire: { partial: 'open youtube', noul: 0.9 } })
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
    decision.script.push({ answers: { verb: choice('navigate'), target: choice('none'), slot: choice('s1-1') } })
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
    decision.script.push({ answers: { verb: choice('navigate'), target: choice('none'), slot: choice('s1-1') } })
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
    await runner.consider('scroll down')
    void runner.prepare()
    expect(records.filter((record) => record.type === 'decision')).toEqual([expect.objectContaining({ verb: 'scroll_down', earlyFire: { partial: 'scroll down' } })])
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
  /** The failure lines shown (#329): a wall's, or the Verdict's. */
  const failures = (events: PipelineEvent[]) => events.filter((event) => event.type === 'display' && event.failure === true)

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
    decision.script.push(answer('search', 'none', 's3-6'), answer('click', 'link-1'), answer('click', 'ref-2'), answer('done'))
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
    expect(fired.map((event) => event.action)).toEqual([`search latest elon musk tweet`, `navigate ${POST}`, 'click [2] "Show the post"', 'done'])
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
    expect(decisions(records)).toEqual([expect.objectContaining({ verb: 'navigate', landing: 'capped', ended: 'local_match' }), expect.objectContaining({ verb: 'scroll_down' })])
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

  it('AC3: none at hop 1 with no sure yes ends unsure — the page stays, the line says so, the Feed says not sure', async () => {
    const { browser, events, records, decision, runner } = taskHarness()
    decision.script.push(answer('search', 'none', 's3-6'), answer('none'))
    await runner.run('pull up the latest elon musk tweet', { source: 'spoken' })
    expect(browser.navigations).toEqual([SEARCH])
    expect(failures(events)).toEqual([expect.objectContaining({ text: "I'm not sure this is it." })])
    expect(commands(events)[1]).toMatchObject({ action: 'not sure this is it', dropped: true, task: { hop: 1 } })
    expect(decisions(records).map((record) => record.ended)).toEqual([undefined, 'unsure'])
  })

  describe('the Verdict: an end is a sure answer, never a verb\'s plurality', () => {
    const verdict = (outcome: string, confidence = 0.9) => choice(outcome, confidence, { [outcome]: confidence })
    const withOutcome = (scripted: { answers: Record<string, DecisionAnswer> }, outcome: string, confidence?: number) => ({ answers: { ...scripted.answers, outcome: verdict(outcome, confidence) } })
    /** The post page as a sign-in sheet covers it: its controls first, on the dialog layer. */
    const SHEET_REFS: SnapshotRef[] = [
      ref(1, 'button', 'Close', { layer: 'dialog' }),
      ref(2, 'link', 'Log in', { href: 'https://x.com/login', layer: 'dialog' }),
      ref(3, 'link', 'Elon Musk', { href: 'https://x.com/elonmusk', layer: 'page' }),
    ]
    const covered = (h: ReturnType<typeof taskHarness>) => {
      h.browser.snapshot = { ...h.browser.snapshot, refs: SHEET_REFS, dialogOpen: true, dialogText: 'Don’t miss what’s happening' }
    }

    it('none with a sure yes ends done, silent: the Verdict decides, not the verb', async () => {
      const { events, records, decision, runner } = taskHarness()
      decision.script.push(answer('search', 'none', 's3-6'), withOutcome(answer('none'), 'yes'))
      await runner.run('pull up the latest elon musk tweet', { source: 'spoken' })
      expect(failures(events)).toEqual([])
      expect(commands(events)[1]).toMatchObject({ action: 'done', dropped: true })
      expect(decisions(records).map((record) => record.ended)).toEqual([undefined, 'done'])
      expect(decisions(records)[1]!.jev).toMatchObject({ confidence: { outcome: 0.9 }, probabilities: { outcome: { yes: 0.9 } } })
    })

    it('done with a yes below the bar ends unsure and says so', async () => {
      const { events, records, decision, runner } = taskHarness()
      decision.script.push(answer('search', 'none', 's3-6'), withOutcome(answer('done'), 'yes', 0.4))
      await runner.run('pull up the latest elon musk tweet', { source: 'spoken' })
      expect(failures(events)).toEqual([expect.objectContaining({ text: "I'm not sure this is it." })])
      expect(decisions(records).map((record) => record.ended)).toEqual([undefined, 'unsure'])
    })

    describe('Step Aside (#354): a sure in-the-way over a pop-up closes it and goes on, once per Obstacle', () => {
      type H = ReturnType<typeof taskHarness>
      /** The sheet gone: the page's own refs again, as a real close leaves them. */
      const uncovered = (h: H, refs: SnapshotRef[]) => {
        h.browser.snapshot = { ...h.browser.snapshot, refs, dialogOpen: false, dialogText: '' }
      }
      /** The sheet closes on its Close control or Escape (unless told to stay), and the close reports the page moved, as a real one does. */
      const closing = (h: H, refs: SnapshotRef[], stays = false) => {
        const click = h.browser.click.bind(h.browser)
        h.browser.click = async (n) => {
          const line = await click(n)
          if (n !== 1 || stays) return line
          uncovered(h, refs)
          return line.replace(NO_OBSERVABLE_CHANGE, PAGE_SIGNATURE_CHANGED)
        }
        const press = h.browser.pressKey.bind(h.browser)
        h.browser.pressKey = async (key, times) => {
          await press(key, times)
          if (key.key === 'Escape' && !stays) uncovered(h, refs)
        }
      }
      /** The search landing opens under the sheet. */
      const coveredOnLanding = (h: H) => {
        const navigate = h.browser.navigate.bind(h.browser)
        h.browser.navigate = async (url) => {
          const line = await navigate(url)
          covered(h)
          return line
        }
      }

      it('a pop-up the re-read finds gone is told as closed, so the next hop is not read as walled on the page asked for (post mortem 2026-10-19)', async () => {
        const h = taskHarness()
        const { browser, events, records, decision, runner } = h
        coveredOnLanding(h)
        let collects = 0
        const collectPage = browser.collectPage.bind(browser)
        browser.collectPage = async () => {
          collects += 1
          // The consent sheet goes with an animation: hop 1's collect still carries it, the re-read's does not.
          if (collects === 3) uncovered(h, SEARCH_REFS)
          return collectPage()
        }
        decision.script.push(answer('search', 'none', 's3-6'), withOutcome(answer('none'), 'in_the_way', 1), withOutcome(answer('none'), 'yes'))
        await runner.run('pull up the latest elon musk tweet', { source: 'spoken' })
        expect(commands(events).map((event) => event.action)).toEqual(['search latest elon musk tweet', 'the page moved: read again', 'done'])
        // Hop 1 was read over the sheet; hop 2 is told it covered the landing and closed, and reads no dialog.
        expect(decision.requests[1]!.state).toContain('a pop-up covers it: "Close", "Log in" and "Elon Musk"')
        expect(decision.requests[2]!.state).toContain('; a pop-up covered it, and closed)')
        expect(decision.requests[2]!.state).not.toContain('A dialog is open')
        expect(failures(events)).toEqual([])
        expect(decisions(records).map((record) => record.ended)).toEqual([undefined, undefined, 'done'])
      })

      describe('the 23:26 run on 2026-10-19: a script-drawn page read before it drew', () => {
        // Truth Social's load event fired on its empty shell: hop 2 read a
        // dialog with no text and no refs, the re-read read "Home" alone,
        // and the Task ended unsure; the sign-up sheet drew seconds later.
        /** The landing by how many polls the hop has waited: an empty dialog, then "Home" alone, then the sheet over the page. */
        function mountingHarness(drawnAfterPolls: number) {
          const h = taskHarness()
          let drew = false
          const collectPage = h.browser.collectPage.bind(h.browser)
          h.browser.collectPage = async () => {
            if (h.browser.snapshot.url === SEARCH && !drew) {
              const polls = h.sleeps.length
              if (polls >= drawnAfterPolls) {
                drew = true
                covered(h)
              } else if (polls === 0) h.browser.snapshot = { ...h.browser.snapshot, refs: [], dialogOpen: true, dialogText: '' }
              else h.browser.snapshot = { ...h.browser.snapshot, refs: [ref(1, 'link', 'Home', { href: 'https://truthsocial.com/' })], dialogOpen: false, dialogText: '' }
            }
            return collectPage()
          }
          return h
        }

        it('a hop waits for the page to draw, polling, and steps aside from the sheet it drew', async () => {
          const h = mountingHarness(2)
          const { browser, sleeps, records, decision, events, runner } = h
          closing(h, SEARCH_REFS)
          decision.script.push(answer('search', 'none', 's3-6'), withOutcome(answer('click', 'ref-3'), 'in_the_way', 0.85), withOutcome(answer('done'), 'yes'))
          await runner.run('pull up the latest elon musk tweet', { source: 'spoken' })
          expect(sleeps).toEqual([RESULTS_POLL_MS, RESULTS_POLL_MS])
          expect(decision.requests[1]!.state).toContain('A dialog is open: "Don’t miss what’s happening"')
          expect(browser.clicks).toEqual([1])
          expect(failures(events)).toEqual([])
          expect(decisions(records).map((record) => record.ended)).toEqual([undefined, undefined, 'done'])
        })

        it('a page that never draws within the wait is read as it stands', async () => {
          const { sleeps, decision, runner } = mountingHarness(Number.POSITIVE_INFINITY)
          decision.script.push(answer('search', 'none', 's3-6'), answer('none'))
          await runner.run('pull up the latest elon musk tweet', { source: 'spoken' })
          expect(sleeps).toHaveLength(MOUNTING_WAIT_MS / RESULTS_POLL_MS)
          expect(decision.requests[1]!.state).toContain('[1] link "Home" https://truthsocial.com/')
        })
      })

      it('AC1: the hop clicks the sheet\'s Close instead of ending, its record says so, and the next hop is told the pop-up closed', async () => {
        const h = taskHarness()
        const { browser, events, records, decision, runner } = h
        coveredOnLanding(h)
        closing(h, SEARCH_REFS)
        // Jev would click the post under the sheet: the Verdict says the sheet is in the way.
        decision.script.push(answer('search', 'none', 's3-6'), withOutcome(answer('click', 'ref-3'), 'in_the_way', 0.85), withOutcome(answer('done'), 'yes'))
        await runner.run('pull up the latest elon musk tweet', { source: 'spoken' })
        expect(browser.clicks).toEqual([1])
        expect(browser.navigations).toEqual([SEARCH])
        expect(failures(events)).toEqual([])
        expect(commands(events).map((event) => event.action)).toEqual(['search latest elon musk tweet', 'click [1] "Close"', 'done'])
        expect(decisions(records)[1]).toMatchObject({ reading: 'jev', jevAsked: true, verb: 'click', target: 1, targetLabel: 'Close', stepAside: true, task: { hop: 1 } })
        expect(decisions(records)[1]!.jev).toMatchObject({ probabilities: { outcome: { in_the_way: 0.85 } } })
        expect(decisions(records).map((record) => record.ended)).toEqual([undefined, undefined, 'done'])
        expect(decision.requests[2]!.state).toContain('click "Close" (the pop-up closed)')
        expect(decision.requests[2]!.state).not.toContain('A dialog is open')
      })

      it('AC2: with no close control the hop presses Escape', async () => {
        const h = taskHarness()
        const { browser, decision, records, runner } = h
        const noClose = SHEET_REFS.filter((one) => one.ref !== 1)
        const navigate = browser.navigate.bind(browser)
        browser.navigate = async (url) => {
          const line = await navigate(url)
          covered(h)
          browser.snapshot = { ...browser.snapshot, refs: noClose }
          return line
        }
        closing(h, SEARCH_REFS)
        decision.script.push(answer('search', 'none', 's3-6'), withOutcome(answer('click', 'ref-3'), 'in_the_way', 0.85), withOutcome(answer('done'), 'yes'))
        await runner.run('pull up the latest elon musk tweet', { source: 'spoken' })
        expect(browser.clicks).toEqual([])
        expect(browser.pressedKeys).toEqual([{ press: { key: 'Escape' }, times: 1 }])
        expect(decisions(records)[1]).toMatchObject({ verb: 'press', target: null, stepAside: true })
        expect(decisions(records).map((record) => record.ended)).toEqual([undefined, undefined, 'done'])
      })

      it('AC3: the same sheet raised again in one Task is the wall: nothing fires, the line names the pop-up', async () => {
        const h = taskHarness()
        const { browser, events, records, decision, runner } = h
        coveredOnLanding(h)
        closing(h, SEARCH_REFS)
        // The result's click raises the sheet again, over the same page.
        const click = browser.click.bind(browser)
        browser.click = async (n) => {
          const line = await click(n)
          if (n !== 3) return line
          covered(h)
          return line.replace(NO_OBSERVABLE_CHANGE, PAGE_SIGNATURE_CHANGED)
        }
        decision.script.push(
          answer('search', 'none', 's3-6'),
          withOutcome(answer('click', 'ref-3'), 'in_the_way', 0.85),
          answer('click', 'ref-3'),
          withOutcome(answer('click', 'ref-3'), 'in_the_way', 0.9),
        )
        await runner.run('pull up the latest elon musk tweet', { source: 'spoken' })
        expect(browser.clicks).toEqual([1, 3])
        expect(failures(events)).toEqual([expect.objectContaining({ text: 'A pop-up is in the way.' })])
        expect(commands(events).at(-1)).toMatchObject({ action: 'in the way', dropped: true })
        expect(decisions(records).map((record) => record.ended)).toEqual([undefined, undefined, undefined, 'wall'])
      })

      it('AC4: the target that raised the sheet is set aside: the next reading is not offered it, by ref or by result link', async () => {
        const h = taskHarness()
        const { browser, decision, records, runner } = h
        closing(h, SEARCH_REFS)
        const click = browser.click.bind(browser)
        browser.click = async (n) => {
          const line = await click(n)
          if (n !== 3) return line
          covered(h)
          return line.replace(NO_OBSERVABLE_CHANGE, PAGE_SIGNATURE_CHANGED)
        }
        decision.script.push(answer('search', 'none', 's3-6'), answer('click', 'ref-3'), withOutcome(answer('click', 'ref-3'), 'in_the_way', 0.85), withOutcome(answer('done'), 'yes'))
        await runner.run('pull up the latest elon musk tweet', { source: 'spoken' })
        expect(browser.clicks).toEqual([3, 1])
        const hop3 = (decision.requests[3]!.questions as { target: DecisionChoiceQuestion }).target
        expect(Object.keys(hop3.options)).toEqual(['none', 'ref-1', 'ref-2', 'link-1'])
        expect(hop3.options['link-1']).toContain(POST)
        expect(decision.requests[3]!.state).toContain('click "Elon Musk (@elonmusk) / X" (the address did not change; a pop-up appeared over the page: "Close", "Log in" and "Elon Musk"); click "Close" (the pop-up closed)')
        expect(decisions(records).map((record) => record.ended)).toEqual([undefined, undefined, undefined, 'done'])
      })

      it('AC5: a sheet still open after every rung of the Dismissal Ladder ends the Task as a wall, saying the pop-up is still open — said once, at the last rung', async () => {
        const h = taskHarness()
        const { browser, events, records, decision, runner } = h
        coveredOnLanding(h)
        closing(h, SEARCH_REFS, true)
        decision.script.push(answer('search', 'none', 's3-6'), withOutcome(answer('click', 'ref-3'), 'in_the_way', 0.85), withOutcome(answer('done'), 'yes'))
        await runner.run('pull up the latest elon musk tweet', { source: 'spoken' })
        expect(browser.clicks).toEqual([1])
        expect(browser.pressedKeys).toEqual([{ press: { key: 'Escape' }, times: 1 }])
        expect(failures(events)).toEqual([expect.objectContaining({ text: SPOKEN_FAILURES.dialogStayed })])
        expect(decisions(records).map((record) => [record.verb, record.stepAside, record.ended])).toEqual([['search', undefined, undefined], ['click', true, undefined], ['press', true, 'wall']])
        expect(decision.requests).toHaveLength(2)
      })

      it('AC8: the close that leaves the sheet open is not the end — the next rung fires, nothing is said of the first, and the Task goes on once the sheet closes', async () => {
        const h = taskHarness()
        const { browser, events, records, decision, runner } = h
        coveredOnLanding(h)
        // The Close button is inert; Escape closes the sheet.
        const press = browser.pressKey.bind(browser)
        browser.pressKey = async (key, times) => {
          await press(key, times)
          if (key.key === 'Escape') uncovered(h, SEARCH_REFS)
        }
        decision.script.push(answer('search', 'none', 's3-6'), withOutcome(answer('click', 'ref-3'), 'in_the_way', 0.85), withOutcome(answer('done'), 'yes'))
        await runner.run('pull up the latest elon musk tweet', { source: 'spoken' })
        expect(browser.clicks).toEqual([1])
        expect(browser.pressedKeys).toEqual([{ press: { key: 'Escape' }, times: 1 }])
        expect(failures(events)).toEqual([])
        expect(decisions(records).map((record) => [record.verb, record.stepAside, record.ended])).toEqual([['search', undefined, undefined], ['click', true, undefined], ['press', true, undefined], ['done', undefined, 'done']])
        expect(decision.requests).toHaveLength(3)
        expect(decision.requests[2]!.state).toContain('click "Close" (nothing changed); press Escape (the pop-up closed)')
      })

      it('AC9: a cookie wall is stepped past by its reject control first, as the controller\'s policy has it — never Accept All, whatever its close is called', async () => {
        const h = taskHarness()
        const { browser, events, records, decision, runner } = h
        const BANNER_REFS: SnapshotRef[] = [
          ref(1, 'button', 'Close this consent banner Close this consent banner', { layer: 'dialog' }),
          ref(2, 'link', 'Privacy Policy', { href: 'https://help.truthsocial.com/legal/privacy-policy', layer: 'dialog' }),
          ref(10, 'button', 'Accept All', { layer: 'dialog' }),
          ref(11, 'button', 'Reject Non-Essential', { layer: 'dialog' }),
          ref(3, 'link', 'Elon Musk', { href: 'https://x.com/elonmusk', layer: 'page' }),
        ]
        const navigate = browser.navigate.bind(browser)
        browser.navigate = async (url) => {
          const line = await navigate(url)
          browser.snapshot = { ...browser.snapshot, refs: BANNER_REFS, dialogOpen: true, dialogText: 'We and our 1 IAB TCF partners store and access information on your device' }
          return line
        }
        const click = browser.click.bind(browser)
        browser.click = async (n) => {
          const line = await click(n)
          if (n !== 11) return line
          uncovered(h, SEARCH_REFS)
          return line.replace(NO_OBSERVABLE_CHANGE, PAGE_SIGNATURE_CHANGED)
        }
        decision.script.push(answer('search', 'none', 's3-6'), withOutcome(answer('none'), 'in_the_way', 1), withOutcome(answer('done'), 'yes'))
        await runner.run('open donald trumps truth social profile', { source: 'spoken' })
        expect(browser.clicks).toEqual([11])
        expect(browser.pressedKeys).toEqual([])
        expect(failures(events)).toEqual([])
        expect(commands(events).map((event) => event.action)).toEqual(['search truth social profile', 'click [11] "Reject Non-Essential"', 'done'])
        expect(decisions(records).map((record) => record.ended)).toEqual([undefined, undefined, 'done'])
      })

      it('AC10: Jev is asked which control closes the pop-up, and its sure choice is the rung before any label — the hop\'s record keeps the answer', async () => {
        const h = taskHarness()
        const { browser, events, records, decision, runner } = h
        const ODD_REFS: SnapshotRef[] = [
          ref(1, 'button', 'Nah', { layer: 'dialog' }),
          ref(2, 'button', 'Sign in', { layer: 'dialog' }),
          ref(3, 'link', 'Elon Musk', { href: 'https://x.com/elonmusk', layer: 'page' }),
        ]
        const navigate = browser.navigate.bind(browser)
        browser.navigate = async (url) => {
          const line = await navigate(url)
          browser.snapshot = { ...browser.snapshot, refs: ODD_REFS, dialogOpen: true, dialogText: 'Join X today' }
          return line
        }
        closing(h, SEARCH_REFS)
        decision.script.push(
          answer('search', 'none', 's3-6'),
          { answers: { ...withOutcome(answer('click', 'ref-3'), 'in_the_way', 0.85).answers, dismiss: choice('ref-1', 0.88) } },
          withOutcome(answer('done'), 'yes'),
        )
        await runner.run('pull up the latest elon musk tweet', { source: 'spoken' })
        const asked = decision.requests[1]!.questions as { dismiss?: DecisionChoiceQuestion }
        expect(Object.keys(asked.dismiss!.options)).toEqual(['escape', 'ref-1'])
        expect(browser.clicks).toEqual([1])
        expect(failures(events)).toEqual([])
        expect(decisions(records)[1]).toMatchObject({ verb: 'click', target: 1, targetLabel: 'Nah', stepAside: true })
        expect(decisions(records)[1]!.jev).toMatchObject({ confidence: { dismiss: 0.88 }, probabilities: { dismiss: { 'ref-1': 0.88 } } })
        expect(decisions(records).map((record) => record.ended)).toEqual([undefined, undefined, 'done'])
      })

      it('AC7: the close counts toward the cap of five actions', async () => {
        const h = taskHarness()
        const { browser, decision, records, runner } = h
        coveredOnLanding(h)
        closing(h, SEARCH_REFS)
        decision.script.push(
          answer('search', 'none', 's3-6'),
          withOutcome(answer('click', 'ref-3'), 'in_the_way', 0.85),
          answer('scroll_down'),
          answer('scroll_down'),
          answer('scroll_down'),
          withOutcome(answer('done'), 'yes'),
        )
        await runner.run('pull up the latest elon musk tweet', { source: 'spoken' })
        expect(browser.clicks).toEqual([1])
        expect(decision.requests).toHaveLength(5)
        expect(decisions(records).map((record) => record.ended)).toEqual([undefined, undefined, undefined, undefined, 'cap'])
      })
    })

    it('a sure in-the-way with no pop-up read speaks the blocked line', async () => {
      const { browser, events, decision, runner } = taskHarness()
      decision.script.push(answer('search', 'none', 's3-6'), withOutcome(answer('click', 'ref-3'), 'in_the_way', 0.8))
      await runner.run('pull up the latest elon musk tweet', { source: 'spoken' })
      expect(browser.clicks).toEqual([])
      expect(failures(events)).toEqual([expect.objectContaining({ text: 'Something on the page is in the way.' })])
    })

    it('an action on the pop-up itself fires through a sure in-the-way: Jev clearing the obstacle is the next step', async () => {
      const h = taskHarness()
      const { browser, decision, runner, records } = h
      const navigate = browser.navigate.bind(browser)
      browser.navigate = async (url) => {
        const line = await navigate(url)
        covered(h)
        return line
      }
      decision.script.push(answer('search', 'none', 's3-6'), withOutcome(answer('click', 'ref-1'), 'in_the_way', 0.85), withOutcome(answer('done'), 'yes'))
      await runner.run('pull up the latest elon musk tweet', { source: 'spoken' })
      expect(browser.clicks).toEqual([1])
      expect(decisions(records).map((record) => record.ended)).toEqual([undefined, undefined, 'done'])
    })

    it('an in-the-way below the bar is no wall: the action fires', async () => {
      const { browser, decision, runner } = taskHarness()
      decision.script.push(answer('search', 'none', 's3-6'), withOutcome(answer('click', 'ref-3'), 'in_the_way', 0.5), withOutcome(answer('done'), 'yes'))
      await runner.run('pull up the latest elon musk tweet', { source: 'spoken' })
      expect(browser.clicks).toEqual([3])
    })

    it('an end is read against the page as it is now: a page that moved under the reading is read again, once', async () => {
      const h = taskHarness()
      const { browser, events, records, decision, runner } = h
      let collects = 0
      const collectPage = browser.collectPage.bind(browser)
      browser.collectPage = async () => {
        collects += 1
        // The sheet opens after hop 1's snapshot was taken, before its reading ends.
        if (collects === 3) covered(h)
        return collectPage()
      }
      decision.script.push(answer('search', 'none', 's3-6'), withOutcome(answer('done'), 'yes'), withOutcome(answer('click', 'ref-1'), 'in_the_way', 0.9), withOutcome(answer('done'), 'yes'))
      await runner.run('pull up the latest elon musk tweet', { source: 'spoken' })
      expect(commands(events).map((event) => event.action)).toEqual(['search latest elon musk tweet', 'the page moved: read again', 'click [1] "Close"', 'done'])
      expect(decision.requests[2]!.state).toContain('A dialog is open')
      expect(decisions(records).map((record) => record.ended)).toEqual([undefined, undefined, undefined, 'done'])
    })

    it('tells the next hop what the last action did in facts: the address stayed, a pop-up appeared and what it carries', async () => {
      const h = taskHarness()
      const { browser, decision, runner } = h
      const click = browser.click.bind(browser)
      browser.click = async (target) => {
        const line = await click(target)
        covered(h)
        return line.replace(NO_OBSERVABLE_CHANGE, PAGE_SIGNATURE_CHANGED)
      }
      decision.script.push(answer('search', 'none', 's3-6'), answer('click', 'ref-3'), withOutcome(answer('click', 'ref-1'), 'in_the_way', 0.85), withOutcome(answer('done'), 'yes'))
      await runner.run('pull up the latest elon musk tweet', { source: 'spoken' })
      // The sheet's controls first, then the page's; what was there before is not named.
      expect(decision.requests[2]!.state).toContain('click "Elon Musk (@elonmusk) / X" (the address did not change; a pop-up appeared over the page: "Close", "Log in" and "Elon Musk")')
    })
  })

  it('#332: a later hop reading open on the same words opens the most probable result instead of searching again', async () => {
    const { browser, records, decision, runner } = taskHarness()
    // The logged Task's shape: every hop read open with the words, target none on top; on hop 1 a result close behind.
    // The result here is below the fold (a link-N), so the hop opens it; jevReading.test.ts covers a ref clicked.
    const again = (probabilities: Record<string, number>) => ({ answers: { verb: choice('search'), target: choice('none', probabilities.none, probabilities), slot: choice('s3-6') } })
    decision.script.push(again({ none: 1 }), again({ none: 0.63, 'link-1': 0.17, 'ref-1': 0.16 }), again({ none: 0.93 }))
    await runner.run('pull up the latest elon musk tweet', { source: 'spoken' })
    expect(browser.navigations).toEqual([SEARCH, POST])
    expect(decisions(records).map((record) => [record.verb, record.ended])).toEqual([
      ['search', undefined],
      ['navigate', undefined],
      ['none', 'unsure'],
    ])
  })

  describe("the 2026-10-19 run: an engine's landing read before its script drew the results", () => {
    // Three spoken "Open Elon Musk's latest tweet" in a row: hop 0 searched,
    // the landing went quiet some 700 ms later with DuckDuckGo's chrome
    // alone in view, Jev read search with none on top and the Search button
    // at 0.03, and the hop clicked Search — which re-submitted the words
    // and reset the page, so the next hop read chrome again, to the cap.
    const CHROME: SnapshotRef[] = [
      ref(1, 'link', 'DuckDuckGo home DuckDuckGo', { href: 'https://duckduckgo.com/' }),
      ref(2, 'input', 'Search privately', { inputType: 'text' }),
      ref(3, 'button', 'Search'),
    ]
    const jev = (probabilities: Record<string, number>) => ({ answers: { verb: choice('search', 0.46), target: choice('none', probabilities.none, probabilities), slot: choice('s3-6') } })

    /** The landing's refs by how many polls the hop has waited: chrome until the results draw. */
    function landingHarness(drawnAfterPolls: number) {
      const h = taskHarness()
      const collectPage = h.browser.collectPage.bind(h.browser)
      h.browser.collectPage = async () => {
        if (h.browser.snapshot.url === SEARCH) h.browser.snapshot = { ...h.browser.snapshot, refs: h.sleeps.length >= drawnAfterPolls ? SEARCH_REFS : CHROME }
        return collectPage()
      }
      return h
    }

    it("a hop waits for a result to show among the landing's refs, polling, and reads the landing with its results", async () => {
      const { browser, sleeps, decision, runner } = landingHarness(2)
      decision.script.push(answer('search', 'none', 's3-6'), jev({ none: 0.93, 'ref-3': 0.03 }), answer('done'))
      await runner.run('pull up the latest elon musk tweet', { source: 'spoken' })
      // Two polls after the first empty read; the third read had the results, and ref 3 is the result, not the Search button.
      expect(sleeps).toEqual([RESULTS_POLL_MS, RESULTS_POLL_MS])
      expect(decision.requests[1]!.state).toContain('[3] link "Elon Musk (@elonmusk) / X" https://x.com/elonmusk')
      expect(browser.clicks).toEqual([3])
    })

    it('a landing that shows no result within the wait is read as it stands: search over none opens nothing — not the Search button, not a footer link — and the Task ends unsure', async () => {
      const { browser, events, sleeps, records, decision, runner } = landingHarness(Number.POSITIVE_INFINITY)
      decision.script.push(answer('search', 'none', 's3-6'), jev({ none: 0.9, 'link-1': 0.07, 'ref-3': 0.03 }))
      await runner.run('pull up the latest elon musk tweet', { source: 'spoken' })
      expect(sleeps).toHaveLength(RESULTS_WAIT_MS / RESULTS_POLL_MS)
      expect(browser.clicks).toEqual([])
      expect(browser.navigations).toEqual([SEARCH])
      expect(decisions(records).map((record) => [record.verb, record.ended])).toEqual([
        ['search', undefined],
        ['none', 'unsure'],
      ])
      expect(failures(events)).toEqual([expect.objectContaining({ text: "I'm not sure this is it." })])
    })

    it("a landing with its results in view, and a site's own page, are read as they stand: no wait", async () => {
      const { sleeps, decision, runner } = taskHarness()
      decision.script.push(answer('search', 'none', 's3-6'), answer('click', 'link-1'), answer('done'))
      await runner.run('pull up the latest elon musk tweet', { source: 'spoken' })
      expect(sleeps).toEqual([])
    })
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
    decision.script.push(answer('search', 'none', 's3-6'), answer('done'))
    await runner.run('pull up the latest elon musk tweet', { source: 'spoken' })
    const hop1 = (decision.requests[1]!.questions as { target: DecisionChoiceQuestion }).target
    // ref 3 links back to where the Task started.
    expect(Object.keys(hop1.options)).toEqual(['none', 'ref-1', 'ref-2', 'link-1'])
    expect(decision.requests[1]!.state).toContain(`Pages visited: https://x.com/elonmusk ${SEARCH}`)
  })

  it('AC4: a Jev call unavailable at hop 1 ends the Task unavailable, with no best guess fired', async () => {
    const { browser, records, decision, runner } = taskHarness()
    decision.script.push(answer('search', 'none', 's3-6'), { unavailable: 'timeout' })
    await runner.run('pull up the latest elon musk tweet and open the first result', { source: 'spoken' })
    expect(browser.navigations).toEqual([SEARCH])
    expect(browser.clicks).toEqual([])
    expect(decisions(records).map((record) => record.ended)).toEqual([undefined, 'unavailable'])
  })

  it('AC4: Jev unavailable at hop 0 ends the Task unavailable with nothing fired: no reading guesses (#353)', async () => {
    const { browser, records, decision, runner } = taskHarness()
    decision.script.push({ unavailable: 'timeout' })
    await runner.run('pull up the latest elon musk tweet', { source: 'spoken' })
    expect(decision.requests).toHaveLength(1)
    expect(browser.navigations).toEqual([])
    expect(decisions(records).map((record) => [record.verb, record.ended])).toEqual([['none', 'unavailable']])
  })

  it.each([
    ['a new Utterance', (runner: CommandRunner) => runner.run('scroll down', { source: 'spoken' }), 'abandoned: a later Command came first'],
    ['Escape or the Abort Head', (runner: CommandRunner) => runner.abort(), 'abandoned: stopped'],
  ])('AC5: %s during hop 1\'s read abandons it: its record is written, nothing fires', async (_name, supersede, action) => {
    const { browser, events, records, decision, runner } = taskHarness()
    decision.script.push(answer('search', 'none', 's3-6'), answer('click', 'ref-3'))
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
      decision.script.push(answer('search', 'none', 's3-6'), answer('click', 'ref-3'), answer('done'))
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
    decision.script.push(answer('search', 'none', 's3-6'), answer('click', 'ref-3'), answer('done'))
    setWall(10_000)
    await runner.run('pull up the latest elon musk tweet', { source: 'spoken' })
    const hop1 = decisions(records).find((record) => record.task?.hop === 1)!
    setWall(hop1.at + 2_000)
    runner.abort()
    expect(records.filter((record) => record.type === 'misfire')).toEqual([expect.objectContaining({ signal: 'overrun', turnId: hop1.turnId, hop: 1, withinMs: 2_000 })])
  })

  it('#336 pinned-post replay: a click that changed nothing sets its target aside by label and address across renumbered refs; two such hops in a row end the Task unchanged', async () => {
    const { browser, records, decision, runner } = taskHarness('https://x.com/elonmusk')
    const PINNED = 'Pinned Elon Musk: the pinned post'
    const pinned = (n: number) => ref(n, 'link', PINNED, { href: 'https://x.com/elonmusk/status/1' })
    const latest = (n: number) => ref(n, 'link', 'Elon Musk: the latest post', { href: 'https://x.com/elonmusk/status/2' })
    browser.snapshot = { ...browser.snapshot, title: 'Elon Musk (@elonmusk) / X', refs: [ref(1, 'button', 'Posts'), pinned(21), latest(22)] }
    // The Posts tab moves the page; every other click comes back "no observable change". The refs renumber after each.
    const renumbered = [
      [ref(1, 'button', 'Posts'), pinned(20), latest(23)],
      [ref(1, 'button', 'Posts'), pinned(21), latest(22)],
    ]
    const click = browser.click.bind(browser)
    browser.click = async (n) => {
      const line = n === 1 ? (browser.clicks.push(1), 'clicked [1]: urlChanged=false dialogOpen=false; page signature changed') : await click(n)
      browser.snapshot = { ...browser.snapshot, refs: renumbered.shift() ?? browser.snapshot.refs }
      return line
    }
    decision.script.push(answer('click', 'ref-1'), answer('click', 'ref-20'), answer('click', 'ref-22'), answer('click', 'ref-21'))
    await runner.run('open elon musks latest tweet', { source: 'spoken' })

    expect(browser.clicks).toEqual([1, 20, 22])
    // Hop 2: the pinned post, now ref 21, is not offered again.
    const hop2 = (decision.requests[2]!.questions as { target: DecisionChoiceQuestion }).target
    expect(Object.values(hop2.options).some((option) => String(option).includes(PINNED))).toBe(false)
    expect(Object.keys(hop2.options)).toEqual(['none', 'ref-1', 'ref-22'])
    // Jev is told what each action did.
    expect(decision.requests[2]!.state).toContain(`Done so far: click "Posts" (the page changed); click "${PINNED}" (nothing changed)`)
    expect(decisions(records).map((record) => record.ended)).toEqual([undefined, undefined, 'unchanged'])
  })

  it('#336: a hop that opened a page says where on the next hop\'s "Done so far"', async () => {
    const { decision, runner } = taskHarness()
    decision.script.push(answer('search', 'none', 's3-6'), answer('click', 'ref-3'), answer('done'))
    await runner.run('pull up the latest elon musk tweet', { source: 'spoken' })
    expect(decision.requests[1]!.state).toContain('Done so far: search latest elon musk tweet (opened duckduckgo.com/?q=latest%20elon%20musk%20tweet)')
  })

  it('AC7: a type hop\'s Slot is read against the landing\'s Page Terms, and what was heard stays on the record', async () => {
    const { browser, records, decision, runner } = taskHarness()
    const navigate = browser.navigate.bind(browser)
    browser.navigate = async (url) => {
      const line = await navigate(url)
      browser.snapshot = { ...browser.snapshot, title: 'YouTube', refs: [ref(1, 'input', 'Search', { inputType: 'search' }), ref(2, 'link', 'Linus Tech Tips')] }
      return line
    }
    // "open youtube and search for line stack tips": the Local Match opens youtube (#341), Jev reads hop 1 as a type.
    decision.script.push(answer('type', 'ref-1', 's5-7'), answer('done'))
    await runner.run('open youtube and search for line stack tips', { source: 'spoken' })
    expect(browser.navigations).toEqual(['https://youtube.com'])
    expect(browser.typed).toEqual([{ ref: 1, text: 'linus tech tips' }])
    expect(decisions(records)[1]).toMatchObject({ verb: 'type', slot: 'linus tech tips', slotHeard: 'line stack tips', slotFrom: 'page', task: { hop: 1 } })
  })
})

describe('the Site Scope at hop 0 (#340)', () => {
  const HOME = 'https://x.com/home'
  const SCOPED = 'https://duckduckgo.com/?q=site%3Ax.com%20donald%20trumps%20profile'
  const WEB = 'https://duckduckgo.com/?q=donald%20trumps%20profile'
  const PROFILE = 'https://x.com/realDonaldTrump'
  const TEXT = 'go to donald trumps profile'
  const HOME_REFS: SnapshotRef[] = [ref(1, 'link', 'Home', { href: HOME }), ref(2, 'link', 'Elon Musk', { href: 'https://x.com/elonmusk' })]
  const RESULT_REFS: SnapshotRef[] = [ref(1, 'input', 'Search', { inputType: 'search' })]
  const RESULT_LINKS = [{ label: 'Donald J. Trump (@realDonaldTrump) / X', href: PROFILE }]

  const read = (verb: string, target = 'none', slot = 'none', where?: string): { answers: Record<string, DecisionAnswer> } => ({
    answers: { verb: choice(verb), target: choice(target), slot: choice(slot), ...(where !== undefined ? { where: choice(where, 0.6, { page: 0.1, site: 0.6, web: 0.3 }) } : {}) },
  })
  const decisions = (records: CommandLogRecord[]) => records.flatMap((record) => (record.type === 'decision' ? [record] : []))
  const commands = (events: PipelineEvent[]) => events.flatMap((event) => (event.type === 'command' ? [event] : []))
  const asked = (request: DecisionRequest<DecisionQuestions>): string[] => Object.keys(request.questions)

  /** A browser on a page whose landings follow: a results page carries its result below the fold. */
  function siteHarness(start = HOME, options?: { decision?: null }) {
    const h = harness(options)
    h.browser.snapshot = { ...h.browser.snapshot, url: start, title: 'Home / X', refs: HOME_REFS }
    const navigate = h.browser.navigate.bind(h.browser)
    h.browser.navigate = async (url) => {
      const line = await navigate(url)
      h.browser.snapshot = { ...h.browser.snapshot, refs: url.startsWith('https://duckduckgo.com/') ? RESULT_REFS : [] }
      return line
    }
    h.browser.pageLinks = async () => (h.browser.snapshot.url.startsWith('https://duckduckgo.com/?') ? RESULT_LINKS : [])
    return h
  }

  it('AC1: an open read as on this site searches the site, names it in the Feed and the Answer, and the Task goes on to the results', async () => {
    const { browser, events, records, asks, decision, runner } = siteHarness()
    decision.script.push(read('search', 'none', 's2-4', 'site'), read('click', 'link-1'), read('done'))
    await runner.run(TEXT, { source: 'spoken' })

    expect(browser.navigations).toEqual([SCOPED, PROFILE])
    expect(commands(events).map((event) => event.action)).toEqual(['search donald trumps profile on x.com', `navigate ${PROFILE}`, 'done'])
    expect(events).toContainEqual(expect.objectContaining({ type: 'display', text: 'Searched x.com for “donald trumps profile”.' }))
    // Hop 1 is offered the results and asked no where.
    expect(asked(decision.requests[0]!)).toEqual(['verb', 'target', 'slot', 'where'])
    expect(asked(decision.requests[1]!)).toEqual(['verb', 'target', 'slot', 'outcome'])
    expect(Object.values((decision.requests[1]!.questions as { target: DecisionChoiceQuestion }).target.options)).toContainEqual(expect.stringContaining(PROFILE))
    // The record keeps where for the scoped read, and the ask sidecar the fourth question.
    const [hop0, hop1] = decisions(records)
    expect(hop0).toMatchObject({ verb: 'search', slot: 'donald trumps profile', jev: { confidence: { where: 0.6 }, probabilities: { where: { page: 0.1, site: 0.6, web: 0.3 } } } })
    expect(hop1!.jev).not.toHaveProperty('confidence.where')
    expect(Object.keys(asks[0]!.questions)).toEqual(['verb', 'target', 'slot', 'where'])
  })

  it('AC2: where = web searches the whole web as before', async () => {
    const { browser, decision, runner } = siteHarness()
    decision.script.push(read('search', 'none', 's2-4', 'web'), read('none'))
    await runner.run(TEXT, { source: 'spoken' })
    expect(browser.navigations).toEqual([WEB])
  })

  it('#353: where = page never searches — the most probable ref Jev gave any probability is clicked, or nothing is', async () => {
    const pointed = siteHarness()
    pointed.decision.script.push(
      { answers: { verb: choice('search'), target: choice('none', 0.67, { none: 0.67, 'ref-2': 0.17, 'ref-1': 0.09 }), slot: choice('s1-2'), where: choice('page', 0.64) } },
      read('done'),
    )
    await pointed.runner.run('open the tweet', { source: 'spoken' })
    expect(pointed.browser.navigations).toEqual([])
    expect(pointed.browser.clicks).toEqual([2])
    expect(commands(pointed.events)[0]).toMatchObject({ action: 'click [2] "Elon Musk"' })

    const unpointed = siteHarness()
    unpointed.decision.script.push(read('search', 'none', 's1-2', 'page'))
    await unpointed.runner.run('open the tweet', { source: 'spoken' })
    expect(unpointed.browser.navigations).toEqual([])
    expect(unpointed.browser.clicks).toEqual([])
    expect(commands(unpointed.events)).toEqual([expect.objectContaining({ text: 'open the tweet', dropped: true })])
  })

  it('AC2: on a blank page, a DuckDuckGo results page and an engine’s front page the ask carries no where', async () => {
    for (const start of ['about:blank', 'https://duckduckgo.com/?q=trump', 'https://www.google.com/']) {
      const { decision, runner } = siteHarness(start)
      decision.script.push(read('search', 'none', 's2-4'), read('none'))
      await runner.run(TEXT, { source: 'spoken' })
      expect(asked(decision.requests[0]!), start).toEqual(['verb', 'target', 'slot'])
    }
  })

  it('AC3: "open youtube" on x.com is Local-Matched with no Jev call; "search for donald trump" is Jev\'s, and where scopes it (#353)', async () => {
    const { browser, decision, runner } = siteHarness()
    decision.script.push(read('search', 'none', 's2-3', 'site'), read('none'))
    await runner.run('search for donald trump', { source: 'spoken' })
    expect(asked(decision.requests[0]!)).toEqual(['verb', 'target', 'slot', 'where'])
    await runner.run('open youtube', { source: 'spoken' })
    expect(decision.requests).toHaveLength(2)
    expect(browser.navigations).toEqual(['https://duckduckgo.com/?q=site%3Ax.com%20donald%20trump', 'https://youtube.com'])
  })

  it('AC3: nothing fires when Jev is unavailable — no unscoped search of the words (#353)', async () => {
    const { browser, decision, runner } = siteHarness()
    decision.script.push({ unavailable: 'timeout' })
    await runner.run(TEXT, { source: 'spoken' })
    expect(browser.navigations).toEqual([])
  })
})

describe('the Site Scope at a later hop (#341): one Utterance chains a site and a thing on it', () => {
  const TEXT = 'go to twitter and open donald trumps profile'
  const TWITTER = 'https://twitter.com'
  const SCOPED = 'https://duckduckgo.com/?q=site%3Atwitter.com%20donald%20trumps%20profile'
  const PROFILE = 'https://twitter.com/realDonaldTrump'
  const TWITTER_REFS: SnapshotRef[] = [ref(1, 'link', 'Sign in', { href: 'https://twitter.com/login' }), ref(2, 'link', 'Elon Musk', { href: 'https://twitter.com/elonmusk' })]
  const RESULT_REFS: SnapshotRef[] = [ref(1, 'input', 'Search', { inputType: 'search' })]
  const RESULT_LINKS = [{ label: 'Donald J. Trump (@realDonaldTrump) / X', href: PROFILE }]

  const read = (verb: string, target = 'none', slot = 'none', where?: string): { answers: Record<string, DecisionAnswer> } => ({
    answers: { verb: choice(verb), target: choice(target), slot: choice(slot), ...(where !== undefined ? { where: choice(where) } : {}) },
  })
  const decisions = (records: CommandLogRecord[]) => records.flatMap((record) => (record.type === 'decision' ? [record] : []))
  const asked = (request: DecisionRequest<DecisionQuestions>): string[] => Object.keys(request.questions)

  /** A browser on a blank page: twitter.com is a site, a results page carries its result below the fold. */
  function chainHarness(start = 'about:blank') {
    const h = harness()
    h.browser.snapshot = { ...h.browser.snapshot, url: start, title: '', refs: start === TWITTER ? TWITTER_REFS : [] }
    const navigate = h.browser.navigate.bind(h.browser)
    h.browser.navigate = async (url) => {
      const line = await navigate(url)
      h.browser.snapshot = { ...h.browser.snapshot, refs: url.startsWith('https://duckduckgo.com/') ? RESULT_REFS : url === TWITTER ? TWITTER_REFS : [] }
      return line
    }
    h.browser.pageLinks = async () => (h.browser.snapshot.url.startsWith('https://duckduckgo.com/?') ? RESULT_LINKS : [])
    return h
  }

  it('AC1: opens the address, asks where on its landing, searches the site, opens the result and ends done', async () => {
    const { browser, records, decision, perf, runner } = chainHarness()
    decision.script.push(read('search', 'none', 's5-7', 'site'), read('click', 'link-1'), read('done'))
    await runner.run(TEXT, { source: 'spoken' })

    expect(browser.navigations).toEqual([TWITTER, SCOPED, PROFILE])
    // Hop 0 is the Local Match's; hop 1 on the site is asked where; hop 2 on the results is not; hop 3 on the searched site is not.
    expect(decision.requests).toHaveLength(3)
    expect(decision.requests[0]!.state).toContain(`"${TEXT}"`)
    expect(asked(decision.requests[0]!)).toEqual(['verb', 'target', 'slot', 'where', 'outcome'])
    expect(asked(decision.requests[1]!)).toEqual(['verb', 'target', 'slot', 'outcome'])
    expect(asked(decision.requests[2]!)).toEqual(['verb', 'target', 'slot', 'outcome'])
    expect(decisions(records).map((record) => [record.reading, record.verb, record.ended])).toEqual([
      ['local_match', 'navigate', undefined],
      ['jev', 'search', undefined],
      ['jev', 'navigate', undefined],
      ['jev', 'done', 'done'],
    ])
    expect(decisions(records)[1]).toMatchObject({ slot: 'donald trumps profile', task: { hop: 1 } })
    // The search counts as an action.
    expect(perf.records.filter((record) => record.stage === 'task')).toEqual([expect.objectContaining({ detail: expect.objectContaining({ ended: 'done', hops: 4, actions: 3 }) })])
  })

  it('AC2: an address alone ends the Task local_match after hop 0 with no continuation call', async () => {
    const { decision, records, runner } = chainHarness()
    for (const line of ['go to twitter', 'open youtube']) await runner.run(line, { source: 'spoken' })
    expect(decision.requests).toEqual([])
    expect(decisions(records).map((record) => record.ended)).toEqual(['local_match', 'local_match'])
  })

  it('AC3: on a site the Task has already searched, where is not asked and open opens the most probable offered target', async () => {
    const { browser, decision, runner } = chainHarness()
    decision.script.push(
      read('search', 'none', 's5-7', 'site'),
      read('click', 'link-1'),
      // On the profile, a search of the same words: no where, no search — #332's dead end with nothing offered.
      read('search', 'none', 's5-7'),
    )
    await runner.run(TEXT, { source: 'spoken' })
    expect(asked(decision.requests[2]!)).toEqual(['verb', 'target', 'slot', 'outcome'])
    expect(browser.navigations).toEqual([TWITTER, SCOPED, PROFILE])
  })

  it('#342: on the profile, off a search landing, an open with no target named ends the Task none there — the ref Jev barely offered is not clicked', async () => {
    const { browser, events, records, decision, runner } = chainHarness()
    const navigate = browser.navigate.bind(browser)
    browser.navigate = async (url) => {
      const line = await navigate(url)
      if (url === PROFILE) browser.snapshot = { ...browser.snapshot, refs: [ref(1, 'link', 'Search', { href: 'https://twitter.com/explore' })] }
      return line
    }
    // The live #341 AC5 run's hop 3: open 0.60 over done 0.35, target none 0.97, "Search" at 0.02.
    const onProfile = { answers: { verb: choice('search', 0.6, { search: 0.6, done: 0.35 }), target: choice('none', 0.97, { none: 0.97, 'ref-1': 0.02 }), slot: choice('s5-7') } }
    decision.script.push(read('search', 'none', 's5-7', 'site'), read('click', 'link-1'), onProfile)
    await runner.run(TEXT, { source: 'spoken' })
    expect(browser.navigations).toEqual([TWITTER, SCOPED, PROFILE])
    expect(browser.clicks).toEqual([])
    expect(browser.snapshot.url).toBe(PROFILE)
    expect(decision.requests).toHaveLength(3)
    expect(decisions(records).at(-1)).toMatchObject({ verb: 'none', ended: 'unsure', task: { hop: 3 } })
    expect(events.filter((event) => event.type === 'command').at(-1)).toMatchObject({ action: 'not sure this is it', dropped: true })
  })

  it('AC4: hop 0\'s own Site Scope search (#340) is a site the Task has searched: a later hop back on it is asked no where', async () => {
    const { browser, decision, runner } = chainHarness(TWITTER)
    decision.script.push(read('search', 'none', 's2-4', 'site'), read('click', 'link-1'), read('search', 'none', 's2-4'))
    await runner.run('go to donald trumps profile', { source: 'spoken' })
    expect(browser.navigations).toEqual([SCOPED, PROFILE])
    expect(decision.requests.map(asked)).toEqual([
      ['verb', 'target', 'slot', 'where'],
      ['verb', 'target', 'slot', 'outcome'],
      ['verb', 'target', 'slot', 'outcome'],
    ])
  })

  it('AC4: the Task records the sites it searched, and the cap counts the search as an action', async () => {
    const { browser, records, decision, runner } = chainHarness()
    decision.script.push(read('search', 'none', 's5-7', 'site'))
    for (let hop = 2; hop < 6; hop += 1) decision.script.push(read('scroll_down'))
    await runner.run(TEXT, { source: 'spoken' })
    // Hop 0's open, hop 1's search and three scrolls: the fifth action ends it.
    expect(browser.navigations).toEqual([TWITTER, SCOPED])
    expect(browser.scrolls).toHaveLength(3)
    expect(decisions(records).at(-1)).toMatchObject({ ended: 'cap' })
  })
})

describe('a pop-up covering the page (#336)', () => {
  const SHEET_REFS: SnapshotRef[] = [
    ref(1, 'link', 'Elon Musk', { href: 'https://x.com/elonmusk' }),
    ref(7, 'link', 'Cancel', { href: 'https://x.com/home', layer: 'dialog' }),
    ref(8, 'button', 'Sign in', { layer: 'dialog' }),
    ref(9, 'button', 'Close', { layer: 'dialog' }),
  ]
  const displays = (events: PipelineEvent[]) => events.filter((event): event is Extract<PipelineEvent, { type: 'display' }> => event.type === 'display')

  /** A page under X's logged-out sheet; the sheet closes on its close control or Escape unless it is told to stay. */
  function sheetHarness(refs = SHEET_REFS, stays = false, closers: readonly number[] = [9], escapeCloses = true) {
    const h = harness()
    h.browser.snapshot = { ...h.browser.snapshot, url: 'https://x.com/elonmusk', title: 'X', refs, dialogOpen: true, dialogText: 'Sign in to X' }
    const closed = (): void => {
      if (!stays) h.browser.snapshot = { ...h.browser.snapshot, refs: refs.filter((one) => one.layer !== 'dialog'), dialogOpen: false, dialogText: '' }
    }
    const click = h.browser.click.bind(h.browser)
    h.browser.click = async (n) => {
      const line = await click(n)
      if (closers.includes(n)) closed()
      return line
    }
    const press = h.browser.pressKey.bind(h.browser)
    h.browser.pressKey = async (key, times) => {
      await press(key, times)
      if (key.key === 'Escape' && escapeCloses) closed()
    }
    return h
  }

  it('"exit out of this" clicks the dialog\'s close control, says "Closed the pop-up." and never navigates — Jev unavailable, the label rung stands', async () => {
    const { browser, events, records, decision, runner } = sheetHarness()
    await runner.run('exit out of this', { source: 'spoken' })
    // Jev is asked which control closes it (owner's rule 2026-10-19); with no answer the ladder stands without its choice.
    expect(decision.requests.map((request) => Object.keys(request.questions))).toEqual([['verb', 'target', 'slot', 'where', 'dismiss']])
    expect(browser.clicks).toEqual([9])
    expect(browser.navigations).toEqual([])
    expect(displays(events)).toEqual([expect.objectContaining({ text: 'Closed the pop-up.' })])
    expect(records).toEqual([expect.objectContaining({ reading: 'local_match', verb: 'click', target: 9, ended: 'local_match' })])
  })

  it('a dismiss phrase clicks the control Jev is sure closes the pop-up, one no label list reads as a close', async () => {
    const refs = [...SHEET_REFS, ref(10, 'button', 'Browse as a guest', { layer: 'dialog' })]
    const { browser, events, decision, records, runner } = sheetHarness(refs, false, [10])
    decision.script.push({ answers: { verb: choice('click'), target: choice('none'), slot: choice('none'), where: choice('page'), dismiss: choice('ref-10') } })
    await runner.run('close this', { source: 'spoken' })
    const asked = decision.requests[0]!.questions as { dismiss?: DecisionChoiceQuestion }
    // The widest net: every dialog control that is no link and no way through, Escape beside them.
    expect(Object.keys(asked.dismiss!.options)).toEqual(['escape', 'ref-9', 'ref-10'])
    expect(browser.clicks).toEqual([10])
    expect(displays(events)).toEqual([expect.objectContaining({ text: 'Closed the pop-up.' })])
    expect(records).toEqual([expect.objectContaining({ verb: 'click', target: 10, jev: expect.objectContaining({ confidence: expect.objectContaining({ dismiss: 0.9 }) }) })])
  })

  it('a dismiss phrase walks the whole Dismissal Ladder while the pop-up stays: Jev\'s choice, the close label, then Escape — the failure said once, at the end', async () => {
    const refs = [...SHEET_REFS, ref(10, 'button', 'Maybe', { layer: 'dialog' })]
    const { browser, events, decision, records, runner } = sheetHarness(refs, false, [], true)
    decision.script.push({ answers: { verb: choice('click'), target: choice('none'), slot: choice('none'), where: choice('page'), dismiss: choice('ref-10') } })
    await runner.run('close this', { source: 'spoken' })
    expect(browser.clicks).toEqual([10, 9])
    expect(browser.pressedKeys).toEqual([{ press: { key: 'Escape' }, times: 1 }])
    expect(displays(events)).toEqual([expect.objectContaining({ text: 'Closed the pop-up.' })])
    expect(records.filter((record) => record.type === 'decision')).toHaveLength(3)
    // A later rung is the runner's own move: never read as the user's recovery from the one before.
    expect(records.filter((record) => record.type === 'misfire')).toEqual([])
  })

  it('a consent wall\'s reject is the policy\'s: clicked with no Jev call', async () => {
    const refs = [ref(1, 'link', 'Home', { href: 'https://x.com/home' }), ref(5, 'button', 'Accept all', { layer: 'dialog' }), ref(6, 'button', 'Reject all', { layer: 'dialog' })]
    const { browser, decision, runner } = sheetHarness(refs, false, [6])
    await runner.run('close this', { source: 'spoken' })
    expect(decision.requests).toEqual([])
    expect(browser.clicks).toEqual([6])
  })

  it('presses Escape when the dialog has no close control', async () => {
    const { browser, events, runner } = sheetHarness(SHEET_REFS.filter((one) => one.ref !== 9))
    await runner.run('close the pop-up', { source: 'spoken' })
    expect(browser.clicks).toEqual([])
    expect(browser.pressedKeys).toEqual([{ press: { key: 'Escape' }, times: 1 }])
    expect(browser.navigations).toEqual([])
    expect(displays(events)).toEqual([expect.objectContaining({ text: 'Closed the pop-up.' })])
  })

  it('says so, as a failure, when the dialog is still open afterwards', async () => {
    const { events, runner } = sheetHarness(SHEET_REFS, true)
    await runner.run('get rid of this', { source: 'spoken' })
    expect(displays(events)).toEqual([expect.objectContaining({ text: SPOKEN_FAILURES.dialogStayed, failure: true })])
  })

  it('with no dialog open, the same words read as before: "cancel" is stop, "exit out of this" goes to Jev', async () => {
    const { browser, decision, records, runner } = harness()
    await runner.run('cancel', { source: 'spoken' })
    decision.script.push({ answers: { verb: choice('back'), target: choice('none'), slot: choice('none') } })
    await runner.run('exit out of this', { source: 'spoken' })
    expect(records.flatMap((record) => (record.type === 'decision' && record.task?.hop === 0 ? [record.verb] : []))).toEqual(['stop', 'back'])
    expect(decision.requests[0]!.state).not.toContain('A dialog is open')
    expect(browser.clicks).toEqual([])
  })

  it('`back` toward the blank start page is refused with "There\'s no page to go back to." and the tab stays put', async () => {
    const { browser, events, runner } = sheetHarness()
    browser.back = async () => {
      throw new Error('cannot go back: the page before is the blank start page')
    }
    await runner.run('back', { source: 'spoken' })
    expect(browser.snapshot.url).toBe('https://x.com/elonmusk')
    expect(displays(events)).toEqual([expect.objectContaining({ text: "There's no page to go back to.", failure: true })])
  })

  it('"cancel" is a `stop` that never waits on the page: with a page still loading it stops at once', async () => {
    const { browser, events, runner } = harness()
    browser.collectPage = () => new Promise(() => {})
    await runner.run('cancel', { source: 'spoken' })
    expect(events[0]).toMatchObject({ type: 'command', action: 'stop' })
    expect(displays(events)).toEqual([expect.objectContaining({ text: 'Nothing to stop.', muted: true })])
  })

  it('"cancel" closes a dialog the page collected at speech start already shows', async () => {
    const { browser, events, runner } = sheetHarness()
    await runner.prepare()
    await runner.run('cancel', { source: 'spoken' })
    expect(browser.clicks).toEqual([9])
    expect(displays(events)).toEqual([expect.objectContaining({ text: 'Closed the pop-up.' })])
  })

  it('a close Jev read ends where it closed: the next hop is told the pop-up closed, and an unsure Verdict fires no `back` (live run 2026-10-19)', async () => {
    // "close the pop-up" heard as "Close the buffer": no dismiss phrase, so Jev reads it and clicks Close.
    const { browser, decision, records, runner } = sheetHarness()
    // A real close reports the page moved: the sheet left the signature.
    const click = browser.click.bind(browser)
    browser.click = async (n) => (await click(n)).replace(NO_OBSERVABLE_CHANGE, PAGE_SIGNATURE_CHANGED)
    const backs: string[] = []
    browser.back = async () => {
      backs.push(browser.snapshot.url)
      return 'went back'
    }
    decision.script.push(
      { answers: { verb: choice('click'), target: choice('ref-9'), slot: choice('none') } },
      // Hop 1 as the real Jev read it once told: none over back, a yes under the bar.
      {
        answers: {
          verb: choice('none', 0.38, { none: 0.38, back: 0.31, click: 0.14 }),
          target: choice('none'),
          slot: choice('none'),
          outcome: choice('yes', 0.6, { yes: 0.6, not_yet: 0.22, in_the_way: 0.18 }),
        },
      },
    )
    await runner.run('Close the buffer', { source: 'spoken' })
    expect(browser.clicks).toEqual([9])
    const hop1 = decision.requests[1]!
    expect(hop1.state).toContain('Done so far: click "Close" (the pop-up closed)')
    expect((hop1.questions as { outcome: DecisionChoiceQuestion }).outcome.instructions).toMatch(/^Is what the user asked for done\? First: if a pop-up/)
    expect(backs).toEqual([])
    expect(browser.navigations).toEqual([])
    expect(browser.snapshot.url).toBe('https://x.com/elonmusk')
    expect(records.flatMap((record) => (record.type === 'decision' ? [record.ended] : []))).toEqual([undefined, 'unsure'])
  })

  it('Jev reads the dialog when one is open and the words are not a dismiss phrase', async () => {
    const { decision, runner } = sheetHarness()
    decision.script.push({ answers: { verb: choice('none'), target: choice('none'), slot: choice('none') } })
    await runner.run('what is this thing', { source: 'spoken' })
    expect(decision.requests[0]!.state).toContain('A dialog is open: "Sign in to X"')
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
      'Nothing to stop.',
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
    // A cancelled Command is grey (owner ruling 2026-10-19): neither done nor failed.
    expect(displays(events).map((event) => event.muted === true)).toEqual([true, true, false])
  })

  it('a `stop` that stops something says "Stopped." in grey; one that finds nothing says "Nothing to stop."', async () => {
    const { browser, events, runner } = harness()
    browser.navigate = () => new Promise<string>(() => {})
    void runner.run('navigate slow.example')
    await flushMicrotasks()
    await runner.run('stop')
    await runner.run('stop')
    expect(displays(events).map((event) => [event.text, event.muted, event.failure])).toEqual([
      ['Stopped.', true, undefined],
      ['Stopped.', true, undefined],
      ['Nothing to stop.', true, undefined],
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
