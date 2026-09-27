import { describe, expect, it } from 'vitest'
import type { DecisionModel, DecisionQuestions, DecisionResult } from '../ports/decisionModel'
import type { ToolCall } from '../ports/llm'
import type { DecisionEvent } from '../trace/runTrace'
import type { RunPlan } from './runPlan'
import {
  carrySelectedPassages,
  createSelectedPassageSeam,
  openAskedItems,
  withRecordedPassages,
  type SelectedPassage,
} from './selectedPassage'

const THRESHOLDS = { choice: 0.7, noul: 0.7 }
const PAGE = 'https://example.org/voyager'
const OBJECTIVE = 'Find when Voyager 1 was launched'
/** A landing as the tool reported it: no wall, no missing page. */
const LANDED = { ok: true as const, result: `navigated: url=${PAGE} title="Voyager 1"` }
const call = (name: string): ToolCall => ({ id: `c-${name}`, name, args: {} })

type Asked = { state: string; questions: DecisionQuestions }

/** A Decision Model that answers each ask from a function of what was asked. */
function modelOf(answer: (asked: Asked, index: number) => DecisionResult<DecisionQuestions>) {
  const asked: Asked[] = []
  const model: DecisionModel = {
    model: 'scripted',
    async ask(request) {
      asked.push({ state: request.state, questions: request.questions })
      return answer(asked.at(-1)!, asked.length - 1) as never
    },
  }
  return { model, asked }
}

/** Every Choice picks `label` at `confidence`; every Noul answers `noul`. */
function answering(label: (key: string, labels: readonly string[]) => string, confidence = 0.9, noul = 0.9) {
  return (asked: Asked): DecisionResult<DecisionQuestions> => ({
    status: 'answered',
    latencyMs: 120,
    model: 'jev-1.13.0',
    answers: Object.fromEntries(
      Object.entries(asked.questions).map(([key, question]) => {
        if (question.type === 'noul') return [key, { type: 'noul', noul }]
        const labels = Object.keys(question.options)
        const choice = label(key, labels)
        return [
          key,
          { type: 'choice', choice, confidence, probabilities: Object.fromEntries(labels.map((l) => [l, l === choice ? confidence : 0])) },
        ]
      }),
    ) as never,
  })
}

function seamOver(opts: {
  blocks: readonly string[]
  items: readonly string[]
  model: DecisionModel
  checkpoint?: (item: string, passage: string, url: string) => boolean
  tracing?: boolean
}) {
  const decisions: DecisionEvent[] = []
  const checkpoints: { item: string; passage: string; url: string }[] = []
  let items = opts.items
  const seam = createSelectedPassageSeam({
    model: opts.model,
    thresholds: THRESHOLDS,
    openItems: () => items,
    objective: () => OBJECTIVE,
    tracing: opts.tracing ?? true,
    pageTextBlocks: async () => opts.blocks,
    round: () => 3,
    writeDecision: (event) => decisions.push(event),
    checkpoint: (item, passage, url) => {
      checkpoints.push({ item, passage, url })
      const accepted = opts.checkpoint?.(item, passage, url) ?? true
      // The Run closes an item its checkpoint was accepted for.
      if (accepted) items = items.filter((open) => open !== item)
      return accepted
    },
  })
  return { seam, decisions, checkpoints }
}

const BLOCKS = ['Voyager 1 — Wikipedia', 'Voyager 1 was launched on 5 September 1977.', 'It is the most distant human-made object.']

describe('openAskedItems (#276, ADR 0069)', () => {
  const plan = (effortTier: RunPlan['effortTier'], askedItems: readonly string[]): RunPlan => ({ objective: 'o', headline: null, effortTier, askedItems })

  it('offers nothing before the Run Plan is declared', () => {
    expect(openAskedItems(null, new Set())).toEqual([])
  })

  it('offers nothing for a Direct Action', () => {
    expect(openAskedItems(plan('direct_action', ['the volume']), new Set())).toEqual([])
  })

  it('offers the declared items no Run-made checkpoint has closed', () => {
    expect(openAskedItems(plan('lookup', ['launch date', 'distance']), new Set(['launch date']))).toEqual(['distance'])
  })
})

describe('the Selected Passage seam (#276, ADR 0069)', () => {
  it('asks a Choice over the id-prefixed blocks and a Noul per open item, and picks the chosen block', async () => {
    const { model, asked } = modelOf(answering(() => 'P002'))
    const { seam, decisions } = seamOver({ blocks: BLOCKS, items: ['launch date'], model })

    const picks = await seam.select(call('navigate'), LANDED, PAGE)

    expect(picks).toEqual([{ item: 'launch date', passage: 'Voyager 1 was launched on 5 September 1977.' }])
    expect(asked).toHaveLength(1)
    expect(asked[0]!.state).toBe(
      'P001| Voyager 1 — Wikipedia\nP002| Voyager 1 was launched on 5 September 1977.\nP003| It is the most distant human-made object.',
    )
    expect(Object.keys(asked[0]!.questions)).toEqual(['pick_1', 'any_1'])
    const pick = asked[0]!.questions.pick_1!
    expect(pick.type).toBe('choice')
    expect(pick.instructions).toContain('launch date')
    expect(pick.type === 'choice' && Object.keys(pick.options)).toEqual(['P001', 'P002', 'P003'])
    expect(asked[0]!.questions.any_1!.instructions).toContain('launch date')
    expect(decisions).toEqual([
      expect.objectContaining({ kind: 'decision', seam: 'passage', round: 3, questions: ['pick_1', 'any_1'], acted: 'acted', latencyMs: 120 }),
    ])
    expect(decisions[0]!.windowed).toBeUndefined()
  })

  it('asks one question pair per open item in one ask', async () => {
    const { model, asked } = modelOf(answering((key) => (key === 'pick_1' ? 'P002' : 'P003')))
    const { seam } = seamOver({ blocks: BLOCKS, items: ['launch date', 'distance'], model })

    const picks = await seam.select(call('read_page'), LANDED, PAGE)

    expect(Object.keys(asked[0]!.questions)).toEqual(['pick_1', 'any_1', 'pick_2', 'any_2'])
    expect(picks.map((pick) => pick.item)).toEqual(['launch date', 'distance'])
    expect(picks[1]!.passage).toBe('It is the most distant human-made object.')
  })

  it('fires on a navigate, a click and a read_page, never on a scroll or a Look', async () => {
    for (const name of ['navigate', 'click', 'read_page']) {
      const { model } = modelOf(answering(() => 'P002'))
      expect(await seamOver({ blocks: BLOCKS, items: ['launch date'], model }).seam.select(call(name), LANDED, PAGE)).toHaveLength(1)
    }
    for (const name of ['scroll', 'look', 'type', 'record_evidence']) {
      const { model, asked } = modelOf(answering(() => 'P002'))
      expect(await seamOver({ blocks: BLOCKS, items: ['launch date'], model }).seam.select(call(name), LANDED, PAGE)).toEqual([])
      expect(asked).toHaveLength(0)
    }
  })

  it('never asks on a search results page: a snippet quotes another page', async () => {
    const { model, asked } = modelOf(answering(() => 'P002'))
    const { seam } = seamOver({ blocks: BLOCKS, items: ['launch date'], model })

    expect(await seam.select(call('navigate'), LANDED, 'https://duckduckgo.com/?q=voyager+1+launch')).toEqual([])
    expect(asked).toHaveLength(0)
  })

  it('names the Objective in every question, so a pick is the item of this object (#281)', async () => {
    const { model, asked } = modelOf(answering(() => 'P002'))
    const { seam } = seamOver({ blocks: BLOCKS, items: ['launch date'], model })

    await seam.select(call('navigate'), LANDED, PAGE)

    for (const question of Object.values(asked[0]!.questions)) expect(question.instructions).toContain(OBJECTIVE)
  })

  it('never asks on a Not-found Page or a walled landing (#281)', async () => {
    const landings = [
      `navigated: url=${PAGE}/missing title="Page not found"\nNOT-FOUND:404 example.org`,
      `navigated: url=${PAGE} title="Just a moment..."\nBLOCKER:challenge example.org`,
      `navigated: url=${PAGE} title="Sign in"\nBLOCKER:login-wall example.org`,
    ]
    for (const result of landings) {
      const { model, asked } = modelOf(answering(() => 'P002'))
      const { seam, decisions } = seamOver({ blocks: BLOCKS, items: ['launch date'], model })
      expect(await seam.select(call('navigate'), { ok: true, result }, PAGE)).toEqual([])
      expect(asked).toHaveLength(0)
      expect(decisions).toHaveLength(0)
    }
  })

  it('keeps the passage each Choice chose on the record, whether it acted or not (#281)', async () => {
    const { model } = modelOf(answering((key) => (key === 'pick_1' ? 'P002' : 'P003'), 0.4))
    const { seam, decisions } = seamOver({ blocks: BLOCKS, items: ['launch date', 'distance'], model, tracing: false })

    await seam.select(call('navigate'), LANDED, PAGE)

    expect(decisions[0]!.acted).toBe('under_threshold')
    expect(decisions[0]!.passages).toEqual({
      pick_1: 'Voyager 1 was launched on 5 September 1977.',
      pick_2: 'It is the most distant human-made object.',
    })
    expect(decisions[0]!.askedText).toBeUndefined()
  })

  it('keeps the text it was asked over on the record when the Run is tracing (#281)', async () => {
    const { model, asked } = modelOf(answering(() => 'P002'))
    const { seam, decisions } = seamOver({ blocks: BLOCKS, items: ['launch date'], model, tracing: true })

    await seam.select(call('navigate'), LANDED, PAGE)

    expect(decisions[0]!.askedText).toBe(asked[0]!.state)
    expect(decisions[0]!.passages).toEqual({ pick_1: 'Voyager 1 was launched on 5 September 1977.' })
  })

  it('keeps no passage on a window pass: a window is not a passage (#281)', async () => {
    const blocks = Array.from({ length: 300 }, (_, index) => `Paragraph ${index + 1} of the mission history.`)
    const { model } = modelOf(answering((_, labels) => (labels[0] === 'W1' ? 'W2' : 'P280')))
    const { seam, decisions } = seamOver({ blocks, items: ['launch date'], model })

    await seam.select(call('read_page'), LANDED, PAGE)

    expect(decisions[0]!.passages).toBeUndefined()
    expect(decisions[1]!.passages).toEqual({ pick_1: 'Paragraph 280 of the mission history.' })
  })

  it('asks nothing with no open item', async () => {
    const { model, asked } = modelOf(answering(() => 'P002'))
    const { seam, decisions } = seamOver({ blocks: BLOCKS, items: [], model })

    expect(await seam.select(call('navigate'), LANDED, PAGE)).toEqual([])
    expect(asked).toHaveLength(0)
    expect(decisions).toHaveLength(0)
  })

  it('picks nothing when the Choice is under threshold, and records why', async () => {
    const { model } = modelOf(answering(() => 'P002', 0.4))
    const { seam, decisions } = seamOver({ blocks: BLOCKS, items: ['launch date'], model })

    expect(await seam.select(call('navigate'), LANDED, PAGE)).toEqual([])
    expect(decisions[0]!.acted).toBe('under_threshold')
  })

  it('picks nothing when the Noul says no passage states the item', async () => {
    const { model } = modelOf(answering(() => 'P002', 0.95, 0.2))
    const { seam, decisions } = seamOver({ blocks: BLOCKS, items: ['launch date'], model })

    expect(await seam.select(call('navigate'), LANDED, PAGE)).toEqual([])
    expect(decisions[0]!.acted).toBe('under_threshold')
  })

  it('judges each item on its own pair: one clears, the other does not', async () => {
    const { model } = modelOf((asked) => {
      const answered = answering(() => 'P002')(asked)
      if (answered.status !== 'answered') return answered
      return { ...answered, answers: { ...answered.answers, any_2: { type: 'noul', noul: 0.1 } } }
    })
    const { seam, decisions } = seamOver({ blocks: BLOCKS, items: ['launch date', 'distance'], model })

    expect((await seam.select(call('navigate'), LANDED, PAGE)).map((pick) => pick.item)).toEqual(['launch date'])
    expect(decisions[0]!.acted).toBe('acted')
  })

  it('picks nothing when the Decision Model is unavailable, and records it', async () => {
    const { model } = modelOf(() => ({ status: 'unavailable', reason: 'timeout', message: 'no answer in 800 ms', latencyMs: 800, model: 'jev-1.13.0' }))
    const { seam, decisions } = seamOver({ blocks: BLOCKS, items: ['launch date'], model })

    expect(await seam.select(call('navigate'), LANDED, PAGE)).toEqual([])
    expect(decisions[0]).toEqual(expect.objectContaining({ acted: 'unavailable', unavailable: expect.objectContaining({ reason: 'timeout' }) }))
  })

  it('picks nothing, and never throws, when the page text cannot be read', async () => {
    const { model, asked } = modelOf(answering(() => 'P002'))
    const seam = createSelectedPassageSeam({
      model,
      thresholds: THRESHOLDS,
      openItems: () => ['launch date'],
      objective: () => OBJECTIVE,
      tracing: true,
      pageTextBlocks: async () => {
        throw new Error('target closed')
      },
      round: () => 1,
      writeDecision: () => {},
      checkpoint: () => true,
    })

    expect(await seam.select(call('navigate'), LANDED, PAGE)).toEqual([])
    expect(asked).toHaveLength(0)
  })

  it('does not ask again over the same text for the same items', async () => {
    const { model, asked } = modelOf(answering(() => 'P002', 0.3))
    const { seam } = seamOver({ blocks: BLOCKS, items: ['launch date'], model })

    await seam.select(call('navigate'), LANDED, PAGE)
    await seam.select(call('read_page'), LANDED, PAGE)

    expect(asked).toHaveLength(1)
  })

  it('picks a page past 255 blocks in two passes, a window then a block, and the records say windowed', async () => {
    const blocks = Array.from({ length: 300 }, (_, index) => `Paragraph ${index + 1} of the mission history.`)
    const { model, asked } = modelOf(answering((_, labels) => (labels[0] === 'W1' ? 'W2' : 'P280')))
    const { seam, decisions } = seamOver({ blocks, items: ['launch date'], model })

    const picks = await seam.select(call('read_page'), LANDED, PAGE)

    expect(asked).toHaveLength(2)
    const windows = asked[0]!.questions.pick_1!
    expect(windows.type === 'choice' && windows.options).toEqual({ W1: 'P001–P255', W2: 'P256–P300' })
    const second = asked[1]!.questions.pick_1!
    expect(second.type === 'choice' && Object.keys(second.options)).toEqual(blocks.slice(255).map((_, index) => `P${index + 256}`))
    expect(asked[1]!.state.startsWith('P256| Paragraph 256')).toBe(true)
    expect(picks).toEqual([{ item: 'launch date', passage: 'Paragraph 280 of the mission history.' }])
    expect(decisions.map((decision) => [decision.windowed, decision.acted])).toEqual([
      [true, 'acted'],
      [true, 'acted'],
    ])
  })

  it('stops after the window pass when it falls under threshold', async () => {
    const blocks = Array.from({ length: 300 }, (_, index) => `Paragraph ${index + 1}.`)
    const { model, asked } = modelOf(answering(() => 'W1', 0.5))
    const { seam } = seamOver({ blocks, items: ['launch date'], model })

    expect(await seam.select(call('read_page'), LANDED, PAGE)).toEqual([])
    expect(asked).toHaveLength(1)
  })

  it('records each pick as a checkpoint on the landed page and closes the item', async () => {
    const { model, asked } = modelOf(answering(() => 'P002'))
    const { seam, checkpoints } = seamOver({ blocks: BLOCKS, items: ['launch date'], model })

    const picks = await seam.select(call('navigate'), LANDED, PAGE)
    expect(seam.record(picks, PAGE)).toEqual(['launch date'])
    expect(checkpoints).toEqual([{ item: 'launch date', passage: 'Voyager 1 was launched on 5 September 1977.', url: PAGE }])

    // A second landing on the same page with the item recorded asks nothing.
    expect(await seam.select(call('navigate'), LANDED, PAGE)).toEqual([])
    expect(asked).toHaveLength(1)
  })

  it('keeps an item open when its checkpoint was refused', async () => {
    const { model } = modelOf(answering(() => 'P002'))
    const { seam } = seamOver({ blocks: BLOCKS, items: ['launch date'], model, checkpoint: () => false })

    const picks = await seam.select(call('navigate'), LANDED, PAGE)
    expect(seam.record(picks, PAGE)).toEqual([])
    expect(await seam.select(call('navigate'), LANDED, 'https://example.org/other')).toHaveLength(1)
  })
})

describe('the Selected Passage lines (#276)', () => {
  const picks: SelectedPassage[] = [{ item: 'launch date', passage: 'Voyager 1 was launched on 5 September 1977.' }]

  it('carries each pick verbatim after the result', () => {
    expect(carrySelectedPassages({ ok: true, result: 'navigated: url=x' }, picks)).toEqual({
      ok: true,
      result: 'navigated: url=x\nSelected passage for "launch date": Voyager 1 was launched on 5 September 1977.',
    })
  })

  it('says which items were recorded', () => {
    expect(withRecordedPassages({ ok: true, result: 'r' }, ['launch date'])).toEqual({ ok: true, result: 'r\nRecorded as evidence for "launch date".' })
  })

  it('leaves the result byte-identical with nothing to carry', () => {
    const outcome = { ok: true as const, result: 'navigated: url=x' }
    expect(carrySelectedPassages(outcome, [])).toBe(outcome)
    expect(withRecordedPassages(outcome, [])).toBe(outcome)
  })
})
