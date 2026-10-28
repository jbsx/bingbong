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

function harness(options: { errand?: CommandRunnerDeps['errand']; refs?: SnapshotRef[]; card?: true } = {}) {
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

