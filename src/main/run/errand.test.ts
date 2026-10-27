import { describe, expect, it } from 'vitest'
import type { Command, CommandPage } from '../../core/command/command'
import type { ErrandRecord } from '../../core/command/decisionRecord'
import { ERRAND_CAP_MS } from '../../core/errand/errandClock'
import { errandCard } from '../../core/errand/plannerCommand'
import type { PlannerAnswer, PlannerModel, PlannerRequest, PlannerResult } from '../../core/ports/plannerModel'
import { runErrand, type ErrandDeps } from './errand'

const GOAL = 'Comment "this is great" on this video.'
const page: CommandPage = {
  url: 'https://www.youtube.com/watch?v=x',
  title: 'A video',
  refs: [
    { ref: 1, kind: 'input', label: 'Add a comment…', href: null, inputType: 'text' },
    { ref: 2, kind: 'button', label: 'Comment', href: null, inputType: null },
    { ref: 3, kind: 'button', label: 'Share', href: null, inputType: null },
  ],
}

const facts = { model: 'glm-5.3-flash', thinking: false, latencyMs: 1200, waitedMs: 0 }
const act = (action: PlannerAnswer & { next: 'act' } extends infer A ? A : never): PlannerAnswer => action
const typeComment = act({ next: 'act', action: { kind: 'type', ref: 1, text: 'this is great' }, class: 'stays', why: 'write the comment' })
const clickComment = act({ next: 'act', action: { kind: 'click', ref: 2 }, class: 'stays', why: 'post the comment' })

/** A world the loop runs in: a scripted Planner, a fake executor, the person's scripted replies, a clock moved by each call. */
function world(answers: readonly (PlannerAnswer | 'unavailable' | 'hang' | 'malformed')[], options: { replies?: (string | null)[]; callMs?: number } = {}) {
  let now = 0
  const asked: PlannerRequest[] = []
  const fired: { command: Command; why: string }[] = []
  const said: { text: string; failure: boolean }[] = []
  const spoken: { text: string; kind: string }[] = []
  const dropped: string[] = []
  const settled: string[] = []
  const told: { words: string; action: string }[] = []
  const records: ErrandRecord[] = []
  const spans: Record<string, unknown>[] = []
  const replies = [...(options.replies ?? [])]
  const controller = new AbortController()
  let call = 0
  const planner: PlannerModel = {
    model: 'glm-5.3-flash',
    thinking: false,
    async plan(request): Promise<PlannerResult> {
      asked.push(request)
      const next = answers[call++] ?? { next: 'done', sentence: 'out of script' }
      now += options.callMs ?? 1_000
      if (next === 'unavailable') return { ...facts, status: 'unavailable', reason: 'http', httpStatus: 429, message: 'rate limited' }
      if (next === 'malformed') return { ...facts, status: 'unavailable', reason: 'malformed', message: 'click needs a ref number' }
      if (next === 'hang') {
        now += ERRAND_CAP_MS
        return { ...facts, status: 'unavailable', reason: 'cancelled', message: 'cancelled by the caller' }
      }
      return { ...facts, status: 'answered', answer: next }
    },
  }
  const deps: ErrandDeps = {
    planner,
    now: () => now,
    wallNow: () => 1_700_000_000_000 + now,
    mintTurnId: () => `turn-${call}`,
    superseded: () => controller.signal.aborted,
    signal: controller.signal,
    card: async () => errandCard(GOAL, page, { hop: 1, visited: [], actions: [], links: [] }),
    planning: () => {},
    act: async (_turnId, why, command) => {
      fired.push({ command, why })
      now += 500
      return { superseded: false, outcome: `${command.verb} done`, said: command.verb === 'type' ? 'Typed into “Add a comment…”.' : 'Clicked “Comment”.' }
    },
    readPart: async () => 'the page text (part 1 of 1)',
    drop: (_turnId, _why, what) => dropped.push(what),
    settle: (turnId) => settled.push(turnId),
    told: (_turnId, words, action) => told.push({ words, action }),
    ask: async (text, kind) => {
      spoken.push({ text, kind })
      now += 20_000
      return replies.shift() ?? null
    },
    say: (text, failure) => said.push({ text, failure }),
    stepSpan: () => {},
    span: (_ms, detail) => spans.push(detail),
    log: (record) => records.push(record),
  }
  return { deps, asked, fired, said, spoken, dropped, settled, told, records, spans, controller, start: { id: 'cli-1-x', goalLine: GOAL, source: 'typed' as const } }
}

describe('runErrand (#467): the Errand loop', () => {
  it('a two-step goal whose send is said back and refused: nothing leaves, and the Planner ends it in its own sentence', async () => {
    const w = world([typeComment, clickComment, { next: 'done', sentence: 'I did not post the comment: you said no.' }], { replies: ['no'] })
    // Ended on the refusal (#468): the outcome the record names for it.
    expect(await runErrand(w.deps, w.start)).toBe('declined')
    expect(w.records[0]).toMatchObject({ outcome: 'declined' })
    expect(w.fired.map(({ command }) => command.verb)).toEqual(['type'])
    expect(w.spoken).toEqual([{ text: 'This will comment: this is great. Yes or no?', kind: 'confirm' }])
    expect(w.dropped).toEqual(['not done: the answer was not yes'])
    expect(w.said).toEqual([{ text: 'I did not post the comment: you said no.', failure: false }])
    // The refusal is the person's answer in the memory: the Planner read it before it ended.
    expect(w.asked[2]!.memory.steps.map((step) => step.outcome)).toEqual(['type done', 'the person said no ("no"): it was not done'])
  })

  it('a yes fires the send, its class `leaves` in the record', async () => {
    const w = world([typeComment, clickComment, { next: 'done', sentence: 'Posted “this is great” under the video.' }], { replies: ['yes'] })
    expect(await runErrand(w.deps, w.start)).toBe('done')
    expect(w.fired.map(({ command }) => command.verb)).toEqual(['type', 'click'])
    expect(w.records[0]).toMatchObject({ type: 'errand', turnId: 'cli-1-x', goalLine: GOAL, outcome: 'done', said: 'Posted “this is great” under the video.', model: 'glm-5.3-flash', thinking: false })
    expect(w.records[0]!.steps.map((step) => step.class)).toEqual(['stays', 'leaves', 'leaves'])
  })

  it('no answer to the confirm refuses it', async () => {
    const w = world([typeComment, clickComment, { next: 'done', sentence: 'Left the comment unposted.' }], { replies: [] })
    await runErrand(w.deps, w.start)
    expect(w.fired.map(({ command }) => command.verb)).toEqual(['type'])
    expect(w.asked[2]!.memory.steps[1]!.outcome).toBe('no answer: it was not done')
  })

  it('a click the Planner calls `leaves` on a control with no leaving word is said back too', async () => {
    const w = world([act({ next: 'act', action: { kind: 'click', ref: 3 }, class: 'leaves', why: 'share it' }), { next: 'done', sentence: 'Not shared.' }], { replies: ['cancel'] })
    await runErrand(w.deps, w.start)
    expect(w.spoken[0]!.text).toBe('This will click: “Share”. Yes or no?')
    expect(w.fired).toEqual([])
  })

  it('the question back: its answer goes into the memory, and the clock is paused while it waits', async () => {
    const w = world([{ next: 'ask', question: 'Which video?' }, { next: 'done', sentence: 'Commented on the cat video.' }], { replies: ['the cat one'] })
    expect(await runErrand(w.deps, w.start)).toBe('done')
    expect(w.spoken).toEqual([{ text: 'Which video?', kind: 'question' }])
    // A step with no action still has its command event, in the Planner's words (#468).
    expect(w.told).toEqual([
      { words: 'Which video?', action: 'asks back' },
      { words: 'Commented on the cat video.', action: 'done' },
    ])
    expect(w.asked[1]!.memory.steps).toEqual([{ action: 'asked: "Which video?" — a question back', outcome: 'the person answered: "the cat one"', class: 'stays', seconds: 1 }])
    // 20 s waited on the person; 2 s of work.
    expect(w.records[0]!.seconds).toBe(2)
  })

  it('no answer to the question ends the Errand unsure, aloud', async () => {
    const w = world([{ next: 'ask', question: 'Which shoes?' }], { replies: [] })
    expect(await runErrand(w.deps, w.start)).toBe('unsure')
    expect(w.said).toEqual([{ text: 'Which shoes? Ending there.', failure: true }])
    // The asking step's stage was ended, with its command event, before the person was asked.
    expect(w.told).toEqual([{ words: 'Which shoes?', action: 'asks back' }])
    expect(w.settled).toEqual([])
  })

  it('the Planner gone ends it saying so, and what was done so far', async () => {
    const w = world([typeComment, 'unavailable'])
    expect(await runErrand(w.deps, w.start)).toBe('unavailable')
    expect(w.said).toEqual([{ text: 'The planner did not answer. Done so far: typed into “Add a comment…”.', failure: true }])
  })

  it('a reply that is none of the answers goes back to the Planner once; two in a row end it', async () => {
    const w = world(['malformed', { next: 'done', sentence: 'Done it right this time.' }])
    expect(await runErrand(w.deps, w.start)).toBe('done')
    expect(w.asked[1]!.memory.steps[0]!.outcome).toBe('refused: click needs a ref number')
    const twice = world(['malformed', 'malformed'])
    expect(await runErrand(twice.deps, twice.start)).toBe('unavailable')
  })

  it('the seconds cap ends it with what was done so far, then that it ran out of time', async () => {
    const steps = Array.from({ length: 200 }, () => typeComment)
    const w = world(steps, { callMs: 10_000 })
    expect(await runErrand(w.deps, w.start)).toBe('cap')
    expect(w.said.at(-1)!.text).toMatch(/^Done so far: typed into “Add a comment…”(; typed into “Add a comment…”)*\. Ran out of time\.$/)
    expect(w.records[0]!.seconds).toBeGreaterThanOrEqual(90)
  })

  it('a call that runs past what is left of the cap is the cap', async () => {
    const w = world(['hang'])
    expect(await runErrand(w.deps, w.start)).toBe('cap')
    expect(w.said).toEqual([{ text: 'Nothing done yet. Ran out of time.', failure: true }])
  })

  it('a line the card does not offer is refused into the memory, and the Planner goes on', async () => {
    const w = world([act({ next: 'act', action: { kind: 'click', ref: 99 }, class: 'stays', why: 'the missing one' }), { next: 'done', sentence: 'There was no such button.' }])
    expect(await runErrand(w.deps, w.start)).toBe('done')
    expect(w.dropped).toEqual(['refused: click-99 is not on the card'])
    expect(w.asked[1]!.memory.steps[0]!.outcome).toBe('refused: click-99 is not on the card')
  })

  it('a step that throws ends the Errand aloud and on the record, never in silence', async () => {
    const w = world([typeComment, clickComment])
    let cards = 0
    const card = w.deps.card
    w.deps.card = async (...args) => {
      cards += 1
      if (cards === 2) throw new Error('the page went away')
      return card(...args)
    }
    expect(await runErrand(w.deps, w.start)).toBe('unavailable')
    expect(w.said).toEqual([{ text: 'That stopped on an error. Done so far: typed into “Add a comment…”.', failure: true }])
    expect(w.records[0]).toMatchObject({ outcome: 'unavailable', said: 'That stopped on an error. Done so far: typed into “Add a comment…”.' })
  })

  it('a later line ends it at once, saying nothing', async () => {
    const w = world([typeComment, clickComment])
    w.deps.act = async (_turnId, _why, command) => {
      w.controller.abort()
      return { superseded: true, outcome: `${command.verb}` }
    }
    expect(await runErrand(w.deps, w.start)).toBe('superseded')
    expect(w.said).toEqual([])
    expect(w.records[0]!.outcome).toBe('superseded')
  })

  it('a Task\'s hand-off is its first memory', async () => {
    const w = world([{ next: 'done', sentence: 'Found it.' }])
    await runErrand(w.deps, { ...w.start, handOff: { actions: ['clicked [2] → nothing changed'], ended: 'cap' } })
    expect(w.asked[0]!.memory.steps.map((step) => step.action)).toEqual(['clicked [2] → nothing changed — the Task before this Errand', 'the Task stopped — the Task before this Errand'])
    expect(w.records[0]!.handedFrom).toBe('cap')
  })

  it('reads a part of the page\'s text into the memory', async () => {
    const w = world([act({ next: 'act', action: { kind: 'read', part: '1' }, class: 'stays', why: 'read the article' }), { next: 'done', sentence: 'It says hello.' }])
    await runErrand(w.deps, w.start)
    expect(w.asked[1]!.memory.steps[0]).toMatchObject({ action: "read part 1 of the page's text — read the article", outcome: 'the page text (part 1 of 1)' })
    expect(w.fired).toEqual([])
  })
})
