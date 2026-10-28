import { describe, expect, it } from 'vitest'
import type { SnapshotRef } from '../../core/browser/snapshot'
import type { CommandLogRecord, DecisionRecord } from '../../core/command/decisionRecord'
import type { PipelineEvent } from '../../core/pipeline/events'
import type { DecisionAnswer, DecisionModel, DecisionQuestions, DecisionRequest, DecisionResult } from '../../core/ports/decisionModel'
import type { PlannerAnswer, PlannerModel, PlannerRequest } from '../../core/ports/plannerModel'
import { FakeBrowser, fakePerfHarness } from '../../core/testing/doubles'
import { createCommandRunner, type CommandRunnerDeps } from './commandRunner'

// The Errand through the runner (#467, ADR 0095): `errand <words>` while
// it is armed, and a Task that ends not done handing its line over; the
// steps through the runner's own executor, the confirm and the question
// back by the Site Question's road, answered by the next line.

const ref = (n: number, kind: SnapshotRef['kind'], label: string, extra: Partial<SnapshotRef> = {}): SnapshotRef => ({ ref: n, kind, label, href: null, inputType: null, ...extra }) as SnapshotRef
const SEARCH_REFS: SnapshotRef[] = [ref(1, 'link', 'Home'), ref(2, 'button', 'Sign in'), ref(3, 'input', 'Search', { inputType: 'search' })]
const POST_REFS: SnapshotRef[] = [ref(1, 'input', 'Add a comment…', { inputType: 'text' }), ref(2, 'button', 'Comment')]

const choice = (label: string): DecisionAnswer => ({ type: 'choice', choice: label, confidence: 0.9, probabilities: { [label]: 0.9 } })

/** Jev answering its script in order, a sure not-yet Verdict on every hop. */
class ScriptedJev implements DecisionModel {
  readonly model = 'jev-1.14.0'
  readonly requests: DecisionRequest<DecisionQuestions>[] = []
  readonly script: string[] = []
  async ask<const Q extends DecisionQuestions>(request: DecisionRequest<Q>): Promise<DecisionResult<Q>> {
    this.requests.push(request as DecisionRequest<DecisionQuestions>)
    const action = this.script.shift() ?? 'none'
    const answers: Record<string, DecisionAnswer> = { action: choice(action), slot: choice('none') }
    if ('outcome' in request.questions) answers.outcome = choice('not_yet')
    return { status: 'answered', answers: answers as never, latencyMs: 200, model: this.model }
  }
}

/** A Planner that answers its script in order, keeping what it was asked. */
function scriptedPlanner(...answers: PlannerAnswer[]) {
  const asked: PlannerRequest[] = []
  const planner: PlannerModel = {
    model: 'glm-5.3-flash',
    thinking: false,
    plan: async (request) => {
      asked.push(request)
      const answer = answers.shift() ?? { next: 'done', sentence: 'out of script' }
      return { status: 'answered', answer, model: 'glm-5.3-flash', thinking: false, latencyMs: 900, waitedMs: 0 }
    },
  }
  return { planner, asked }
}

function harness(options: { errand?: CommandRunnerDeps['errand']; refs?: SnapshotRef[]; card?: true; player?: CommandRunnerDeps['player'] } = {}) {
  const browser = new FakeBrowser()
  browser.snapshot = { ...browser.snapshot, url: 'https://example.com/', title: 'Example', refs: options.refs ?? SEARCH_REFS }
  const events: PipelineEvent[] = []
  const records: CommandLogRecord[] = []
  const spoken: string[] = []
  const perf = fakePerfHarness()
  const jev = new ScriptedJev()
  let wall = 1_700_000_000_000
  const runner = createCommandRunner({
    browser,
    decisionModel: () => jev,
    publish: (event) => events.push(event),
    now: () => wall++,
    tracer: perf.tracer,
    decisionLog: { write: (record) => records.push(record) },
    speech: { speak: async (text) => (spoken.push(text), { ok: true }), stop: () => {} },
    screenshotDir: () => '/shots',
    saveScreenshot: async () => {},
    sleep: async () => {},
    ...(options.errand !== undefined ? { errand: options.errand } : {}),
    ...(options.card === true ? { applianceCard: { asks: 'sequential' } as const } : {}),
    ...(options.player !== undefined ? { player: options.player } : {}),
  })
  return { browser, events, records, spoken, perf, jev, runner }
}

const until = async (holds: () => boolean): Promise<void> => {
  for (let tries = 0; tries < 200 && !holds(); tries += 1) await new Promise((resolve) => setTimeout(resolve, 0))
  if (!holds()) throw new Error('never held')
}
const errandOf = (records: readonly CommandLogRecord[]) => records.find((record) => record.type === 'errand')
const decisions = (records: readonly CommandLogRecord[]): DecisionRecord[] => records.filter((record): record is DecisionRecord => record.type === 'decision')
const commands = (events: readonly PipelineEvent[]) => events.filter((event): event is Extract<PipelineEvent, { type: 'command' }> => event.type === 'command')

describe('the Errand through the runner (#467, ADR 0095)', () => {
  it('`errand <words>` is no Errand with the Planner switched off (BINGBONG_PLANNER=off): the line is Jev\'s', async () => {
    const { jev, runner, records } = harness()
    await runner.run('errand find me a cheaper one')
    expect(jev.requests.length).toBeGreaterThan(0)
    expect(errandOf(records)).toBeUndefined()
  })

  it('a two-step goal: each step fires through the executor, quiet, its words the Planner\'s why; aloud only the outcome, in the Planner\'s own sentence', async () => {
    const { planner, asked } = scriptedPlanner(
      { next: 'act', action: { kind: 'type', ref: 3, text: 'running shoes' }, class: 'stays', why: 'type the search' },
      { next: 'act', action: { kind: 'press', key: 'Enter' }, class: 'stays', why: 'run the search' },
      { next: 'done', sentence: 'The search for running shoes is on screen.' },
    )
    const { browser, events, records, spoken, jev, runner, perf } = harness({ errand: { planner: () => planner, answerWindowMs: () => 0 } })
    await runner.run('errand search this site for running shoes', { turnId: 'line-1' })
    expect(jev.requests).toHaveLength(0)
    expect(browser.typed).toEqual([{ ref: 3, text: 'running shoes' }])
    expect(browser.pressedKeys).toEqual([{ press: { key: 'Enter' }, times: 1 }])
    expect(commands(events).map((event) => [event.text, event.task])).toEqual([
      ['errand search this site for running shoes', { id: 'line-1', hop: 0 }],
      ['type the search', { id: 'line-1', hop: 1 }],
      ['run the search', { id: 'line-1', hop: 2 }],
      // The done step has its command event too, in the Planner's own sentence (#468).
      ['The search for running shoes is on screen.', { id: 'line-1', hop: 3 }],
    ])
    expect(spoken).toEqual(['The search for running shoes is on screen.'])
    // Stage Errand on every step: thinking on the Goal Line while the Planner is asked, acting on its why.
    const staged = events.flatMap((event) => (event.type === 'status' && event.word === 'Errand' ? [[event.status, event.detail]] : []))
    expect(staged).toEqual([
      ['thinking', 'search this site for running shoes'],
      ['acting', 'type the search'],
      ['thinking', 'search this site for running shoes'],
      ['acting', 'run the search'],
      ['thinking', 'search this site for running shoes'],
    ])
    expect(asked[1]!.memory.steps[0]).toMatchObject({ class: 'stays', action: expect.stringMatching(/type the search$/) })
    expect(asked[0]!.memory.card).toMatch(/^type-3: type the words into \[3\]/m)
    expect(errandOf(records)).toMatchObject({ turnId: 'line-1', outcome: 'done', said: 'The search for running shoes is on screen.', goalLine: 'search this site for running shoes' })
    expect(perf.records.filter((record) => record.stage === 'planner-step')).toHaveLength(3)
    expect(perf.records.filter((record) => record.stage === 'errand')).toEqual([expect.objectContaining({ turnId: 'line-1', detail: expect.objectContaining({ steps: 2, outcome: 'done' }) })])
    expect(runner.getState()).toBe('idle')
  })

  it('a send is said back by the Site Question road, the next line answers it, and a no fires nothing', async () => {
    const { planner, asked } = scriptedPlanner(
      { next: 'act', action: { kind: 'type', ref: 1, text: 'this is great' }, class: 'stays', why: 'write the comment' },
      { next: 'act', action: { kind: 'click', ref: 2 }, class: 'stays', why: 'post it' },
      { next: 'done', sentence: 'I left the comment unposted.' },
    )
    const { browser, events, spoken, runner } = harness({ refs: POST_REFS, errand: { planner: () => planner, answerWindowMs: () => 60_000 } })
    const errand = runner.run('errand comment this is great')
    await until(() => events.some((event) => event.type === 'site_question'))
    expect(events.find((event) => event.type === 'site_question')).toMatchObject({ text: 'This will comment: this is great. Yes or no?', errand: 'confirm' })
    expect(runner.getState()).toBe('running')
    expect(await runner.run('no')).toBe(true)
    await errand
    expect(browser.clicks).toEqual([])
    expect(asked[2]!.memory.steps.at(-1)!.outcome).toBe('the person said no ("no"): it was not done')
    expect(spoken).toEqual(['This will comment: this is great. Yes or no?', 'I left the comment unposted.'])
  })

  it('a yes fires it', async () => {
    const { planner } = scriptedPlanner({ next: 'act', action: { kind: 'click', ref: 2 }, class: 'leaves', why: 'post it' }, { next: 'done', sentence: 'Posted.' })
    const { events, browser, runner } = harness({ refs: POST_REFS, errand: { planner: () => planner, answerWindowMs: () => 60_000 } })
    const errand = runner.run('errand post it')
    await until(() => events.some((event) => event.type === 'site_question'))
    await runner.run('yes')
    await errand
    expect(browser.clicks).toEqual([2])
  })

  it('the question back unanswered in the Hot Listen window ends it unsure, aloud', async () => {
    const { planner } = scriptedPlanner({ next: 'ask', question: 'Which shoes?' })
    const { events, records, spoken, runner } = harness({ errand: { planner: () => planner, answerWindowMs: () => 0 } })
    await runner.run('errand order the same shoes as last time')
    expect(events.find((event) => event.type === 'site_question')).toMatchObject({ text: 'Which shoes?', errand: 'question' })
    expect(spoken).toEqual(['Which shoes?', 'Which shoes? Ending there.'])
    expect(errandOf(records)).toMatchObject({ outcome: 'unsure' })
  })

  it('the question back answered: the answer is the Planner\'s next memory', async () => {
    const { planner, asked } = scriptedPlanner({ next: 'ask', question: 'Which shoes?' }, { next: 'done', sentence: 'Found the white ones.' })
    const { events, runner } = harness({ errand: { planner: () => planner, answerWindowMs: () => 60_000 } })
    const errand = runner.run('errand order the same shoes as last time')
    await until(() => events.some((event) => event.type === 'site_question'))
    await runner.run('the white ones')
    await errand
    expect(asked[1]!.memory.steps.at(-1)!.outcome).toBe('the person answered: "the white ones"')
  })

  it('every turn whose stage went up is ended, so the Status Capsule never holds an Errand that is over', async () => {
    const { planner } = scriptedPlanner(
      { next: 'act', action: { kind: 'click', ref: 99 }, class: 'stays', why: 'a ref that is not there' },
      { next: 'ask', question: 'Which one?' },
      { next: 'done', sentence: 'Opened the right one.' },
    )
    const { events, runner } = harness({ errand: { planner: () => planner, answerWindowMs: () => 60_000 } })
    const errand = runner.run('errand open the right one', { turnId: 'line-1' })
    await until(() => events.some((event) => event.type === 'site_question'))
    await runner.run('the second')
    await errand
    const staged = new Set(events.flatMap((event) => (event.type === 'status' ? [event.turnId] : [])))
    const ended = new Set(events.flatMap((event) => (event.type === 'done' ? [event.turnId] : [])))
    expect([...staged].filter((turnId) => !ended.has(turnId))).toEqual([])
    expect(staged.size).toBeGreaterThanOrEqual(4)
  })

  it('Escape while the question waits ends the Errand, saying only that it stopped (#489)', async () => {
    const { planner } = scriptedPlanner({ next: 'ask', question: 'Which shoes?' })
    const { events, records, spoken, runner } = harness({ errand: { planner: () => planner, answerWindowMs: () => 60_000 } })
    const errand = runner.run('errand order the same shoes as last time')
    await until(() => events.some((event) => event.type === 'site_question'))
    expect(runner.abort()).toBe(true)
    await errand
    expect(spoken).toEqual(['Which shoes?', 'Stopped.'])
    expect(errandOf(records)).toMatchObject({ outcome: 'superseded' })
  })

  it('a line that takes the pane ends an Errand mid-step, which says its own words stopped, never the Planner\'s why (#489)', async () => {
    let calls = 0
    const planner: PlannerModel = {
      model: 'glm-5.3-flash',
      thinking: false,
      plan: async () => {
        calls += 1
        if (calls > 1) return new Promise(() => {})
        return { status: 'answered', answer: { next: 'act', action: { kind: 'type', ref: 3, text: 'running shoes' }, class: 'stays', why: 'type the search.' }, model: 'glm-5.3-flash', thinking: false, latencyMs: 900, waitedMs: 0 }
      },
    }
    const { spoken, runner } = harness({ errand: { planner: () => planner, answerWindowMs: () => 0 }, card: true })
    void runner.run('errand find running shoes')
    await until(() => calls > 1)
    await runner.run('navigate example.org')
    expect(spoken).toEqual(['Stopped “errand find running shoes”.'])
  })

  it('a Task that hits the cap hands its line to an Errand, its steps the first memory, and never says it could not finish', async () => {
    const { planner, asked } = scriptedPlanner({ next: 'done', sentence: 'The page ends with the credits.' })
    const { jev, records, spoken, runner } = harness({ errand: { planner: () => planner, answerWindowMs: () => 0 } })
    for (let hop = 0; hop < 6; hop += 1) jev.script.push('scroll_down')
    await runner.run('keep going down the page', { source: 'spoken' })
    expect(decisions(records).at(-1)!.ended).toBe('cap')
    expect(spoken).toEqual(['The page ends with the credits.'])
    expect(asked[0]!.goalLine).toBe('keep going down the page')
    expect(asked[0]!.memory.steps).toHaveLength(6)
    expect(asked[0]!.memory.steps.at(-1)).toMatchObject({ action: 'the Task stopped — the Task before this Errand', outcome: 'it ran out of actions, its last Answer "Scrolled down.", and handed the line to you' })
    expect(errandOf(records)).toMatchObject({ handedFrom: 'cap' })
  })

  it('a Task whose Decision Model does not answer at hop 0 hands its line over too (#468, arm C: the shipped road)', async () => {
    const { planner, asked } = scriptedPlanner({ next: 'done', sentence: 'Opened the article.' })
    const { jev, records, spoken, runner } = harness({ errand: { planner: () => planner, answerWindowMs: () => 0 } })
    jev.ask = async () => ({ status: 'unavailable', reason: 'http', httpStatus: 429, message: 'Rate limit exceeded', latencyMs: 30, model: jev.model }) as never
    await runner.run('open the wikipedia page for whoever made this', { turnId: 'line-1' })
    expect(decisions(records).at(-1)!.ended).toBe('unavailable')
    expect(asked[0]!.goalLine).toBe('open the wikipedia page for whoever made this')
    expect(errandOf(records)).toMatchObject({ turnId: 'line-1', handedFrom: 'unavailable', outcome: 'done' })
    expect(spoken).toEqual(['Opened the article.'])
  })

  it('a line heard over the app\'s own voice that fires nothing is never handed over, and ends with nothing said (#490, arm A)', async () => {
    const { planner, asked } = scriptedPlanner({ next: 'done', sentence: 'Opened the article.' })
    const { jev, records, spoken, runner } = harness({ errand: { planner: () => planner, answerWindowMs: () => 0 } })
    jev.ask = async () => ({ status: 'unavailable', reason: 'http', httpStatus: 429, message: 'Rate limit exceeded', latencyMs: 30, model: jev.model }) as never
    await runner.run('digital limited', { source: 'spoken', overSpeech: true })
    expect(decisions(records).at(-1)!.ended).toBe('unavailable')
    expect(asked).toHaveLength(0)
    expect(errandOf(records)).toBeUndefined()
    expect(spoken).toEqual([])
  })

  it('with no Planner configured, a Task\'s end is said as ever, and `errand <words>` says the planner is not set up', async () => {
    const { jev, spoken, runner } = harness({ errand: { planner: () => null, answerWindowMs: () => 0 } })
    for (let hop = 0; hop < 6; hop += 1) jev.script.push('scroll_down')
    await runner.run('keep going down the page', { source: 'spoken' })
    await runner.run('errand do something')
    expect(spoken.map((line) => line.split('\n')[0])).toEqual([expect.stringMatching(/^I couldn't finish that\./), expect.stringMatching(/^The planner is not set up/)])
  })
})

describe('a timed-out reading over a running Command (#504): never a silent handoff', () => {
  const TIMED_OUT = { status: 'unavailable', reason: 'timeout', message: 'timed out', latencyMs: 3_000 } as const
  /** A Planner that thinks forever on `play radiohead` (its Errand the line running) and answers every other goal at once. */
  function plannerHolding(sentence: string) {
    const asked: string[] = []
    const planner: PlannerModel = {
      model: 'glm-5.3-flash',
      thinking: false,
      plan: (request) => {
        asked.push(request.goalLine)
        // Its Planner call ends as a real one does when the Errand is ended: on the signal.
        if (request.goalLine === 'play radiohead') return new Promise((resolve) => request.signal?.addEventListener('abort', () => resolve({ status: 'unavailable', reason: 'cancelled', message: 'aborted', model: 'glm-5.3-flash', latencyMs: 0, waitedMs: 0 } as never)))
        return Promise.resolve({ status: 'answered', answer: { next: 'done', sentence }, model: 'glm-5.3-flash', thinking: false, latencyMs: 900, waitedMs: 0 })
      },
    }
    return { planner, asked }
  }
  /** Every host times out; `play radiohead` was handed to its Errand, still thinking: the line running (ruling 4). */
  async function playHanded(sentence: string) {
    const { planner, asked } = plannerHolding(sentence)
    const made = harness({ errand: { planner: () => planner, answerWindowMs: () => 0 }, card: true })
    made.jev.ask = async () => ({ ...TIMED_OUT, model: made.jev.model }) as never
    void made.runner.run('play radiohead', { turnId: 'line-1' })
    await until(() => asked.length === 1)
    return { ...made, asked }
  }
  const errands = (records: readonly CommandLogRecord[]) => records.filter((record) => record.type === 'errand') as { turnId: string; outcome: string }[]

  it('a line with its own verb ends the play, its Errand too, and the stop and the handoff are said as one', async () => {
    const { runner, spoken, records, asked, events } = await playHanded('It is 14 degrees and cloudy.')
    await runner.run('open the weather', { turnId: 'line-2' })
    expect(asked).toEqual(['play radiohead', 'open the weather'])
    expect(spoken).toEqual(['Stopped “play radiohead”. Taking that as a new goal: open the weather.', 'It is 14 degrees and cloudy.'])
    expect(events.some((event) => event.type === 'display' && event.turnId === 'line-2' && event.text === 'Stopped “play radiohead”. Taking that as a new goal: open the weather.')).toBe(true)
    await until(() => errands(records).length === 2)
    expect(errands(records).map((record) => [record.turnId, record.outcome])).toEqual(expect.arrayContaining([['line-1', 'superseded'], ['line-2', 'done']]))
  })

  it('the line asks the Appliance Card once and never the page card: that ask was the reading (rulings 2, 3)', async () => {
    const { runner, jev } = await playHanded('Done.')
    let asks = 0
    const timedOut = jev.ask.bind(jev)
    jev.ask = async (request) => ((asks += 1), timedOut(request))
    await runner.run('open the weather', { turnId: 'line-2' })
    expect(asks).toBe(1)
  })

  it('a later Errand never runs beside the first: handed a line with no verb of its own, it ends the first, said', async () => {
    const { runner, spoken, records } = await playHanded('Here is the other one.')
    await runner.run('no, the other one', { turnId: 'line-2' })
    expect(spoken).toEqual(['Stopped “play radiohead”. Taking that as a new goal: no, the other one.', 'Here is the other one.'])
    await until(() => errands(records).length === 2)
    expect(errands(records).find((record) => record.turnId === 'line-1')?.outcome).toBe('superseded')
  })

  /** `play radiohead` handed to its Errand: its first step is `step`, its next it thinks on until it is ended. */
  async function errandStepped(step: PlannerAnswer) {
    const asked: string[] = []
    const planner: PlannerModel = {
      model: 'glm-5.3-flash',
      thinking: false,
      plan: (request) => {
        asked.push(request.goalLine)
        if (request.goalLine !== 'play radiohead') return Promise.resolve({ status: 'answered', answer: { next: 'done', sentence: 'It is 14 degrees.' }, model: 'glm-5.3-flash', thinking: false, latencyMs: 900, waitedMs: 0 })
        if (asked.filter((goal) => goal === 'play radiohead').length === 1) return Promise.resolve({ status: 'answered', answer: step, model: 'glm-5.3-flash', thinking: false, latencyMs: 900, waitedMs: 0 })
        return new Promise((resolve) => request.signal?.addEventListener('abort', () => resolve({ status: 'unavailable', reason: 'cancelled', message: 'aborted', model: 'glm-5.3-flash', latencyMs: 0, waitedMs: 0 } as never)))
      },
    }
    const counts = { paused: 0 }
    const player = { perform: async () => ({ ok: true }), pauseAll: async () => ((counts.paused += 1), true), queue: () => [], picked: () => null } as never
    const made = harness({ errand: { planner: () => planner, answerWindowMs: () => 0 }, card: true, player })
    made.jev.ask = async () => ({ ...TIMED_OUT, model: made.jev.model }) as never
    void made.runner.run('play radiohead', { turnId: 'line-1' })
    await until(() => asked.length === 2)
    return { ...made, counts }
  }

  it('a step that opens nothing leaves the pane\'s media alone when its line ends: a scroll pauses no earlier song', async () => {
    const { runner, browser, counts } = await errandStepped({ next: 'act', action: { kind: 'scroll', direction: 'down' }, class: 'stays', why: 'look further down' })
    const stopsBefore = browser.stops
    await runner.run('open the weather', { turnId: 'line-2' })
    expect(browser.stops).toBe(stopsBefore)
    expect(counts.paused).toBe(0)
  })

  it('a line that ends the play takes what its Errand opened: the load stops and the media pauses, as a `play` line\'s does (the gap ruling)', async () => {
    // Its first step opens a watch page (any site).
    const { runner, browser, counts } = await errandStepped({ next: 'act', action: { kind: 'navigate', url: 'https://video.example/watch?v=1' }, class: 'stays', why: 'open the song' })
    expect(browser.navigations).toEqual(['https://video.example/watch?v=1'])
    const stopsBefore = browser.stops
    await runner.run('open the weather', { turnId: 'line-2' })
    expect(browser.stops).toBeGreaterThan(stopsBefore)
    expect(counts.paused).toBe(1)
  })

  it('a line that ends the play before its Errand opened anything stops nothing of the pane\'s', async () => {
    let paused = 0
    const player = { perform: async () => ({ ok: true }), pauseAll: async () => ((paused += 1), true), queue: () => [], picked: () => null } as never
    const { planner, asked } = plannerHolding('Done.')
    const { runner, browser, jev } = harness({ errand: { planner: () => planner, answerWindowMs: () => 0 }, card: true, player })
    jev.ask = async () => ({ ...TIMED_OUT, model: jev.model }) as never
    void runner.run('play radiohead', { turnId: 'line-1' })
    await until(() => asked.length === 1)
    const stopsBefore = browser.stops
    await runner.run('open the weather', { turnId: 'line-2' })
    expect(browser.stops).toBe(stopsBefore)
    expect(paused).toBe(0)
  })

  /** `open bbc.com` held mid-navigation, a Task of its own: the line running. */
  function opening(errand?: CommandRunnerDeps['errand']) {
    const made = harness({ ...(errand !== undefined ? { errand } : {}), card: true })
    let land: () => void = () => {}
    const navigate = made.browser.navigate.bind(made.browser)
    made.browser.navigate = (url) => new Promise((resolve) => (land = () => void navigate(url).then(resolve)))
    made.jev.ask = async () => ({ ...TIMED_OUT, model: made.jev.model }) as never
    const first = made.runner.run('open bbc.com', { turnId: 'line-1' })
    return { ...made, first, land: () => land() }
  }
  const outcomeOf = (events: readonly PipelineEvent[], turnId: string) => events.flatMap((event) => (event.type === 'done' && event.turnId === turnId ? [event.outcome] : [])).at(-1)

  it('a line with no verb of its own leaves the running line going on, and says so before the handoff', async () => {
    const { planner } = plannerHolding('Opened the other one.')
    const { runner, spoken, events, first, land, browser } = opening({ planner: () => planner, answerWindowMs: () => 0 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await runner.run('no, the other one', { turnId: 'line-2' })
    expect(spoken).toEqual(['Still on “open bbc.com”: opening bbc.com. Taking that as a new goal: no, the other one.', 'Opened the other one.'])
    land()
    await first
    expect(outcomeOf(events, 'line-1')).toBe('done')
    expect(browser.navigations).toEqual(['https://bbc.com'])
  })

  it('with no Planner: a new goal ends the running line, said; any other line leaves it going on, said', async () => {
    const ends = opening()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await ends.runner.run('open the weather', { turnId: 'line-2' })
    ends.land()
    await ends.first
    expect(outcomeOf(ends.events, 'line-1')).toBe('cancelled')
    expect(ends.spoken).toEqual(['Stopped opening bbc.com.'])
    const goes = opening()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await goes.runner.run('a bit louder please', { turnId: 'line-2' })
    goes.land()
    await goes.first
    expect(outcomeOf(goes.events, 'line-1')).toBe('done')
    expect(goes.spoken).toEqual(['Still on “open bbc.com”: opening bbc.com.'])
  })

  it('a line given with nothing running is the idle road, untouched: handed over as before, nothing more said', async () => {
    const { planner } = plannerHolding('Opened the weather.')
    const { runner, spoken, jev } = harness({ errand: { planner: () => planner, answerWindowMs: () => 0 }, card: true })
    jev.ask = async () => ({ ...TIMED_OUT, model: jev.model }) as never
    await runner.run('open the weather')
    expect(spoken).toEqual(['Opened the weather.'])
  })
})
