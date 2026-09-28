import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { DecisionModel } from '../../../src/core/ports/decisionModel.ts'
import { EFFORT_TIERS } from '../../../src/core/pipeline/runPlan.ts'
import { passageBlockIds, passageQuestions, passageState } from './passageQuestions.ts'
import {
  askSamples,
  choosePassageBar,
  chooseThreshold,
  landingUrl,
  listingResults,
  pagePassages,
  passageSamples,
  readShadowRuns,
  recordedTierRows,
  resultSamples,
  retruthRows,
  runMadeItem,
  SHADOW_TIERS,
  shadowRows,
  summarizeRecordedTier,
  summarizeSeam,
  TIER_QUESTIONS,
  tierSamples,
  type PassageSkips,
  type ShadowRow,
  type ShadowSample,
  type ShadowTraceLine,
} from './shadow.ts'

const TURN = 'turn-1'

function event(type: string, fields: Record<string, unknown>, extra: Partial<ShadowTraceLine> = {}): ShadowTraceLine {
  return { kind: 'pipeline_event', turnId: TURN, event: { type, ...fields }, ...extra }
}

const COMMAND = event('command', { text: 'what is the dial diameter of H4?' })
const PLAN = event('run_plan', { source: 'model', effortTier: 'lookup', objective: 'Find H4 dial diameter', askedItems: ['H4 dial diameter'] })

const PAGE_READ = [
  '# H4 | Royal Museums Greenwich — https://www.rmg.co.uk/collections/objects/rmgc-object-79142',
  'viewport 985x575 scroll 0/6033',
  '[1] link "Royal Museums Greenwich" href="https://www.rmg.co.uk/"',
  'page text:',
  'H4',
  'Marine timekeeper, H4. This is Harrison\'s prize-winning longitude watch.',
  'ID: | ZAA0037',
  'Measurements: | Dial diameter: 102 mm',
].join('\n')

/** A Page Read published at `at`, its observation stamped a millisecond before, as the ledger does. */
function readCall(callId: string, at: number): ShadowTraceLine[] {
  return [
    event('tool_call', { name: 'read_page', callId, args: {} }),
    event('tool_result', { name: 'read_page', callId, ok: true, result: PAGE_READ, at }),
  ]
}

/** An accepted checkpoint the grader grounded on the Page Read observed at `readObservedAt`, or on a landing when absent. */
function checkpoint(excerpt: string, readObservedAt?: number, extra: Partial<ShadowTraceLine> = {}): ShadowTraceLine {
  const graded =
    readObservedAt === undefined
      ? [{ matched: true, producer: 'action_outcome', observedAt: 1 }]
      : [{ matched: false, producer: 'action_outcome', observedAt: 1 }, { matched: true, producer: 'page_read', observedAt: readObservedAt }]
  return { kind: 'evidence_checkpoint', turnId: TURN, tool: 'record_evidence', outcome: 'accepted', excerpt, graded, ...extra }
}

const LISTING = [
  'navigated: url=https://duckduckgo.com/?q=h4+dial title="h4 dial at DuckDuckGo"',
  '# h4 dial at DuckDuckGo — https://duckduckgo.com/?q=h4+dial',
  '[1] link "DuckDuckGo home" href="https://duckduckgo.com/"',
  '[5] link "Images" href="https://duckduckgo.com/?q=h4+dial&ia=images"',
  '[20] link "https://www.rmg.co.uk › collections › H4" href="https://www.rmg.co.uk/collections/objects/rmgc-object-79142"',
  '[21] link "Marine timekeeper, H4 - RMG" href="https://www.rmg.co.uk/collections/objects/rmgc-object-79142#details"',
  '[22] link "H4 (watch) - Wikipedia" href="https://en.wikipedia.org/wiki/H4_(watch)"',
].join('\n')

function landing(callId: string, url = 'h4 dial'): ShadowTraceLine[] {
  return [event('tool_call', { name: 'navigate', callId, args: { url } }), event('tool_result', { name: 'navigate', callId, ok: true, result: LISTING })]
}

describe('the tier labels (#275)', () => {
  it('are the pipeline\'s Effort Tiers, in its order, and the tier question\'s options', () => {
    expect(SHADOW_TIERS).toEqual(EFFORT_TIERS)
    expect(Object.keys((TIER_QUESTIONS.pick as { options: object }).options)).toEqual([...EFFORT_TIERS])
  })
})

describe('reading Runs from a trace (#275)', () => {
  it('groups by turn, keeps the Run\'s own steps and its model Run Plan, and drops a Subagent\'s', () => {
    const [run] = readShadowRuns('cap', [
      COMMAND,
      PLAN,
      ...readCall('c1', 5_000),
      event('tool_call', { name: 'read_page', callId: 's1', args: {} }, { agentId: 'agent-1' }),
      checkpoint('ignored', 4_999, { agentId: 'agent-1' }),
      checkpoint('Dial diameter: 102 mm', 4_999),
      { kind: 'evidence_checkpoint', turnId: TURN, tool: 'record_evidence', outcome: 'excerpt_unsupported', excerpt: 'rejected' },
    ])
    expect(run).toMatchObject({ capture: 'cap', turnId: TURN, command: 'what is the dial diameter of H4?', tier: 'lookup', askedItems: ['H4 dial diameter'] })
    expect(run.steps.map((step) => step.kind)).toEqual(['call', 'result', 'checkpoint'])
  })

  it('drops a turn with no command, and a tier the plan did not come from the model', () => {
    expect(readShadowRuns('cap', [PLAN])).toEqual([])
    const [run] = readShadowRuns('cap', [COMMAND, event('run_plan', { source: 'fallback', effortTier: 'lookup' })])
    expect(run.tier).toBeUndefined()
    expect(tierSamples(run)).toEqual([])
  })
})

describe('passage samples (#281)', () => {
  const H4 = 'https://www.rmg.co.uk/collections/objects/rmgc-object-79142'
  const BLOCKS = ['H4', "Marine timekeeper, H4. This is Harrison's prize-winning longitude watch.", 'ID: | ZAA0037', 'Measurements: | Dial diameter: 102 mm']
  const ITEMS = ['H4 dial diameter', 'H4 object ID']
  const PLAN2 = event('run_plan', { source: 'model', effortTier: 'lookup', objective: 'Find H4 dial diameter', askedItems: ITEMS })
  const snapshot = (url: string, blocks: readonly string[]) => [`# H4 | Royal Museums Greenwich — ${url}`, 'viewport 985x575 scroll 0/6033', 'page text:', ...blocks].join('\n')
  /** A navigate that landed on `url`, its result published at `at`; a cut preview ends with the cut line. */
  function navigateTo(callId: string, at: number, opts: { url?: string; blocks?: readonly string[]; cut?: boolean; notice?: string } = {}): ShadowTraceLine[] {
    const url = opts.url ?? H4
    const text = [`navigated: url=${url} title="H4"`, snapshot(url, opts.blocks ?? BLOCKS), ...(opts.cut ? ['page text: first 1,800 of 9,000 characters — read_page returns the whole text'] : [])].join('\n')
    return [
      event('tool_call', { name: 'navigate', callId, args: { url } }),
      event('tool_result', { name: 'navigate', callId, ok: true, result: opts.notice ? `${text}\n\n${opts.notice}` : text, at }),
    ]
  }
  function pageRead(callId: string, at: number, opts: { url?: string; blocks?: readonly string[]; part?: string } = {}): ShadowTraceLine[] {
    const text = [snapshot(opts.url ?? H4, opts.blocks ?? BLOCKS), ...(opts.part ? [opts.part] : [])].join('\n')
    return [event('tool_call', { name: 'read_page', callId, args: {} }), event('tool_result', { name: 'read_page', callId, ok: true, result: text, at })]
  }
  /** The Run's own passage record, as the seam writes it before the call's result. */
  function ask(blocks: readonly string[] = BLOCKS, acted = 'under_threshold', extra: Partial<ShadowTraceLine> = {}): ShadowTraceLine {
    return { kind: 'decision', turnId: TURN, seam: 'passage', acted, stateChars: passageState(passageBlockIds(blocks.length), blocks).length, ...extra }
  }
  /** A model checkpoint grounded on the observation of whatever was published at `at`. */
  function grounded(excerpt: string, producer: 'action_outcome' | 'page_read', at: number): ShadowTraceLine {
    return { kind: 'evidence_checkpoint', turnId: TURN, tool: 'record_evidence', outcome: 'accepted', excerpt, graded: [{ matched: true, producer, observedAt: at - 1 }] }
  }
  const sampled = (lines: ShadowTraceLine[], skips?: PassageSkips) => passageSamples(readShadowRuns('cap', [COMMAND, PLAN2, ...lines])[0]!, skips)

  it('reads a Page Read\'s passages from its page text, one per line, untrimmed, up to the Notices', () => {
    expect(pagePassages(`${PAGE_READ}\n    indented code\n\nWork budget: 2 of 12 tool rounds remain.`)).toEqual([
      'H4',
      "Marine timekeeper, H4. This is Harrison's prize-winning longitude watch.",
      'ID: | ZAA0037',
      'Measurements: | Dial diameter: 102 mm',
      '    indented code',
    ])
  })

  it('asks the seam\'s own questions — a Choice and a Noul per open item, naming the Objective — over the seam\'s own state', () => {
    const [sample] = sampled([ask(), ...navigateTo('n1', 5_000)])
    expect(sample!.passage).toMatchObject({ kind: 'landing', url: H4, items: ITEMS, objective: 'Find H4 dial diameter', recordedActed: false })
    expect(sample!.state).toBe(passageState(passageBlockIds(4), BLOCKS))
    expect(sample!.questions).toEqual(passageQuestions('Find H4 dial diameter', ITEMS, { P001: null, P002: null, P003: null, P004: null }, 'passage', true))
  })

  it('samples a click landing too, and a landing whose uncut preview carried Notices', () => {
    const click = [
      event('tool_call', { name: 'click', callId: 'k1', args: { ref: 3 } }),
      event('tool_result', { name: 'click', callId: 'k1', ok: true, result: `clicked [3]: urlChanged=true\n${snapshot(H4, BLOCKS)}`, at: 5_000 }),
    ]
    expect(sampled([ask(), ...click]).map((sample) => sample.passage?.kind)).toEqual(['landing'])
    expect(sampled([ask(), ...navigateTo('n1', 5_000, { notice: 'Work budget: 2 of 12 tool rounds remain.' })])).toHaveLength(1)
  })

  it('rebuilds a cut landing from a later whole Page Read of the page, and from every part of one', () => {
    expect(sampled([ask(), ...navigateTo('n1', 5_000, { blocks: BLOCKS.slice(0, 2), cut: true }), ...pageRead('r1', 6_000)])[0]!.state).toBe(
      passageState(passageBlockIds(4), BLOCKS),
    )
    const parts = [
      ...pageRead('r1', 6_000, { blocks: BLOCKS.slice(0, 2), part: 'page text: part 1 of 2 — read_page part=2 continues' }),
      ...pageRead('r2', 7_000, { blocks: BLOCKS.slice(2), part: 'page text: part 2 of 2 — the last part' }),
    ]
    expect(sampled([ask(), ...navigateTo('n1', 5_000, { blocks: BLOCKS.slice(0, 2), cut: true }), ...parts])).toHaveLength(1)
  })

  it('rebuilds a landing from the text its record kept, when it kept one', () => {
    const askedText = passageState(passageBlockIds(4), BLOCKS)
    const [sample] = sampled([ask(BLOCKS, 'under_threshold', { askedText }), ...navigateTo('n1', 5_000, { blocks: BLOCKS.slice(0, 1), cut: true })])
    expect(sample!.state).toBe(askedText)
  })

  it('never replays a landing it cannot rebuild exactly, and counts it', () => {
    const skips: PassageSkips = { unrebuilt: 0, windowed: 0 }
    // Cut, and never read again.
    expect(sampled([ask(), ...navigateTo('n1', 5_000, { cut: true })], skips)).toEqual([])
    // Read again, but the page changed: the rebuild is not what the seam asked over.
    expect(sampled([ask(), ...navigateTo('n1', 5_000, { cut: true }), ...pageRead('r1', 6_000, { blocks: [...BLOCKS, 'A late-loading footer line.'] })], skips)).toHaveLength(1)
    expect(skips.unrebuilt).toBe(2)
  })

  it('never samples a landing the Run did not ask about: its trace holds only the Page Preview', () => {
    expect(sampled(navigateTo('n1', 5_000))).toEqual([])
  })

  it('samples a whole Page Read, never a part of one', () => {
    expect(sampled(pageRead('r1', 6_000)).map((sample) => sample.passage?.kind)).toEqual(['page_read'])
    expect(sampled(pageRead('r1', 6_000, { part: 'page text: part 1 of 2 — read_page part=2 continues' }))).toEqual([])
  })

  it('reads a one-part read that states its part count as a whole Page Read, its line no passage (#290)', () => {
    const whole = sampled(pageRead('r1', 6_000))
    const stated = sampled(pageRead('r1', 6_000, { part: 'page text: part 1 of 1 — the text is complete; there is no part 2' }))
    expect(stated.map((sample) => sample.passage?.kind)).toEqual(['page_read'])
    expect(stated[0]!.state).toBe(whole[0]!.state)
    const landing = [ask(), ...navigateTo('n1', 5_000, { blocks: BLOCKS.slice(0, 2), cut: true })]
    expect(sampled([...landing, ...pageRead('r1', 6_000, { part: 'page text: part 1 of 1 — the text is complete; there is no part 2' })])[0]!.state).toBe(
      passageState(passageBlockIds(4), BLOCKS),
    )
  })

  it('skips a search results page, a Not-found Page and a walled landing', () => {
    const search = 'https://duckduckgo.com/?q=h4+dial'
    expect(sampled([ask(), ...navigateTo('n1', 5_000, { url: search })])).toEqual([])
    for (const marker of ['NOT-FOUND:404 www.rmg.co.uk', 'BLOCKER:challenge www.rmg.co.uk', 'UNAVAILABLE:503 www.rmg.co.uk']) {
      const lines = navigateTo('n1', 5_000)
      const result = lines[1]!.event!
      expect(sampled([ask(), lines[0]!, { ...lines[1]!, event: { ...result, result: `${result.result}\n${marker}` } }])).toEqual([])
    }
  })

  it('does not ask a Page Read that holds the text its landing was asked over, as the seam does not', () => {
    expect(sampled([ask(), ...navigateTo('n1', 5_000), ...pageRead('r1', 6_000)]).map((sample) => sample.callId)).toEqual(['n1'])
  })

  it('asks only the items no Run-made checkpoint has closed, and none for a Direct Action', () => {
    const runMade: ShadowTraceLine = {
      kind: 'evidence_checkpoint',
      turnId: TURN,
      tool: 'record_evidence',
      outcome: 'accepted',
      origin: 'run',
      args: { observation: 'H4 dial diameter' },
      excerpt: 'measurements: | dial diameter: 102 mm',
      graded: [{ matched: true, producer: 'action_outcome', observedAt: 4_999 }],
    }
    const samples = sampled([ask(BLOCKS, 'acted'), runMade, ...navigateTo('n1', 5_000), ...pageRead('r1', 9_000, { url: `${H4}/other` })])
    expect(samples.map((sample) => [sample.callId, sample.passage?.items, sample.passage?.recordedActed])).toEqual([
      ['n1', ITEMS, true],
      ['r1', ['H4 object ID'], false],
    ])
    // The Run's own checkpoint is no pick of the model's.
    expect(samples[0]!.truth.picks).toEqual([])
    const direct = event('run_plan', { source: 'model', effortTier: 'direct_action', objective: 'o', askedItems: ITEMS })
    expect(passageSamples(readShadowRuns('cap', [COMMAND, direct, ...pageRead('r1', 6_000)])[0]!)).toEqual([])

    // A fix-283 trace states the item followed by the passage (#283): the item is still read.
    const stated: ShadowTraceLine = { ...runMade, args: { observation: 'H4 dial diameter: Measurements: | Dial diameter: 102 mm', excerpt: 'Measurements: | Dial diameter: 102 mm' } }
    const after = sampled([ask(BLOCKS, 'acted'), stated, ...navigateTo('n1', 5_000), ...pageRead('r1', 9_000, { url: `${H4}/other` })])
    expect(after.map((sample) => [sample.callId, sample.passage?.items])).toEqual([
      ['n1', ITEMS],
      ['r1', ['H4 object ID']],
    ])
  })

  it('reads a Run-made checkpoint\'s item with or without the passage after it', () => {
    expect(runMadeItem('dial diameter', 'Dial diameter: 102 mm')).toBe('dial diameter')
    expect(runMadeItem('dial diameter: Dial diameter: 102 mm', 'Dial diameter: 102 mm')).toBe('dial diameter')
    expect(runMadeItem('dial diameter', undefined)).toBe('dial diameter')
    // An observation that is only the passage's tail names no shorter item.
    expect(runMadeItem(': 102 mm', '102 mm')).toBe(': 102 mm')
  })

  it('credits a quoted table row however short, whitespace and case aside', () => {
    const [sample] = sampled([...pageRead('r1', 6_000), grounded('id: | ZAA0037', 'page_read', 6_000)])
    expect(sample!.truth.picks).toEqual(['P003'])
    // Before the repair the row's pieces were too short to pin it.
    expect(sample!.truth.unrepairedPicks).toEqual([])
    // A long piece still pins its passage; a short piece that is no row pins nothing.
    const [other] = sampled([...pageRead('r1', 6_000), grounded('H4 | measurements: | DIAL   diameter: 102 mm', 'page_read', 6_000)])
    expect(other!.truth.picks).toEqual(['P004'])
  })

  it('credits a landing with what the model recorded from it, and from a Page Read of the same page', () => {
    expect(sampled([ask(), ...navigateTo('n1', 5_000), grounded('Dial diameter: 102 mm', 'action_outcome', 5_000)])[0]!.truth.picks).toEqual(['P004'])
    // The read repeats the landing's text, so it is not asked; its checkpoint is the landing's.
    const [landing] = sampled([ask(), ...navigateTo('n1', 5_000), ...pageRead('r1', 6_000), grounded('Dial diameter: 102 mm', 'page_read', 6_000)])
    expect(landing!.truth).toEqual({ picks: ['P004'], unrepairedPicks: [] })
    // A read of another page after it is not.
    const [left] = sampled([ask(), ...navigateTo('n1', 5_000), ...navigateTo('n2', 7_000, { url: `${H4}/k1`, blocks: ['K1'] }), ...pageRead('r1', 8_000, { url: `${H4}/k1`, blocks: ['K1', 'ID: | ZAA0037'] }), grounded('ID: | ZAA0037', 'page_read', 8_000)])
    expect(left!.truth.picks).toEqual([])
  })

  it('never credits a read with a checkpoint grounded on another read of the same page', () => {
    const blocks2 = [...BLOCKS, 'Credit: | National Maritime Museum']
    const samples = sampled([...pageRead('r1', 5_000), ...pageRead('r2', 9_000, { blocks: blocks2 }), grounded('Dial diameter: 102 mm', 'page_read', 9_000)])
    expect(samples.map((sample) => [sample.callId, sample.truth.picks])).toEqual([
      ['r1', []],
      ['r2', ['P004']],
    ])
  })
})

describe('bringing rows up to the truth in force (#281)', () => {
  it('replaces each passage row\'s picks with its sample\'s, both truths, and leaves the rest alone', () => {
    const base = { capture: 'cap', turnId: TURN, options: 2, optionsBeforeCut: 2, stateChars: 10, latencyMs: 1 }
    const rows: ShadowRow[] = [
      { ...base, seam: 'passage', callId: 'n1', pair: 1, modelPicks: [] },
      { ...base, seam: 'passage', callId: 'n1', pair: 2, modelPicks: [] },
      { ...base, seam: 'passage', callId: 'gone', pair: 1, modelPicks: ['P001'] },
      { ...base, seam: 'result', callId: 'n1', modelPicks: ['r3'] },
    ]
    const sample = { seam: 'passage', capture: 'cap', turnId: TURN, callId: 'n1', state: '', questions: {}, truth: { picks: ['P002'], unrepairedPicks: [] }, optionsBeforeCut: 2 } as ShadowSample
    const { rows: next, refreshed } = retruthRows(rows, [sample])
    expect(refreshed).toBe(2)
    expect(next.map((row) => [row.seam, row.callId, row.modelPicks, row.modelPicksUnrepaired])).toEqual([
      ['passage', 'n1', ['P002'], []],
      ['passage', 'n1', ['P002'], []],
      ['passage', 'gone', ['P001'], undefined],
      ['result', 'n1', ['r3'], undefined],
    ])
  })
})

describe('passage rows (#281)', () => {
  const sample: ShadowSample = {
    seam: 'passage',
    capture: 'cap',
    turnId: TURN,
    callId: 'n1',
    state: 'P001| H4\nP002| Dial diameter: 102 mm',
    questions: passageQuestions('Find H4', ['dial', 'id'], { P001: null, P002: null }, 'passage', true),
    truth: { picks: ['P002'] },
    optionsBeforeCut: 2,
    passage: { kind: 'landing', url: 'u', objective: 'Find H4', items: ['dial', 'id'], blocks: ['H4', 'Dial diameter: 102 mm'], recordedActed: true },
  }

  it('makes one row per Asked Item\'s pair, with the passage its Choice chose, not comparable when the Run acted', () => {
    const choice = (label: string, confidence: number) => ({ type: 'choice', choice: label, confidence, probabilities: { P001: 1 - confidence, P002: confidence } })
    const rows = shadowRows(sample, {
      status: 'answered',
      latencyMs: 200,
      model: 'jev-1.13.0',
      answers: { pick_1: choice('P002', 0.9), any_1: { type: 'noul', noul: 0.85 }, pick_2: choice('P001', 0.6), any_2: { type: 'noul', noul: 0.1 } } as never,
    })
    expect(rows).toEqual([
      expect.objectContaining({ item: 'dial', pair: 1, choice: 'P002', confidence: 0.9, noul: 0.85, passage: 'Dial diameter: 102 mm', notComparable: true, sampleKind: 'landing', modelPicks: ['P002'], options: 2 }),
      expect.objectContaining({ item: 'id', pair: 2, choice: 'P001', confidence: 0.6, noul: 0.1, passage: 'H4', notComparable: true }),
    ])
  })

  it('keeps an unavailable ask as one unavailable row per pair', () => {
    const rows = shadowRows({ ...sample, passage: { ...sample.passage!, recordedActed: false } }, { status: 'unavailable', reason: 'timeout', message: 'slow', latencyMs: 800, model: 'jev-1.13.0' })
    expect(rows.map((row) => [row.item, row.unavailable, row.notComparable])).toEqual([
      ['dial', 'timeout', undefined],
      ['id', 'timeout', undefined],
    ])
  })
})

describe('result samples (#275)', () => {
  it('reads the landing a rewritten navigate settled on, not the one it asked for', () => {
    expect(landingUrl(`navigated: url=https://a.example/x title="x"\nRewritten…\n${LISTING}`)).toBe('https://duckduckgo.com/?q=h4+dial')
  })

  it('offers the listing\'s results, never the engine\'s furniture, and collapses one address to one option', () => {
    const results = listingResults(LISTING, 'https://duckduckgo.com/?q=h4+dial')
    expect(results.map((result) => [result.label, result.refs])).toEqual([
      ['r20', [20, 21]],
      ['r22', [22]],
    ])
  })

  it('takes the model\'s pick from its next click, or its next navigate by address', () => {
    const click = readShadowRuns('cap', [COMMAND, PLAN, ...landing('n1'), event('tool_call', { name: 'click', callId: 'k1', args: { ref: 21 } })])
    expect(resultSamples(click[0])[0].truth.picks).toEqual(['r20'])

    const navigate = readShadowRuns('cap', [
      COMMAND,
      PLAN,
      ...landing('n1'),
      ...readCall('c1', 5_000),
      event('tool_call', { name: 'navigate', callId: 'n2', args: { url: 'https://en.wikipedia.org/wiki/H4_(watch)/' } }),
    ])
    expect(resultSamples(navigate[0])[0].truth.picks).toEqual(['r22'])
  })

  it('leaves out a click made after a scroll or Page Read, whose ref names a newer snapshot', () => {
    const scrolled = readShadowRuns('cap', [
      COMMAND,
      PLAN,
      ...landing('n1'),
      event('tool_call', { name: 'scroll', callId: 's1', args: {} }),
      event('tool_call', { name: 'click', callId: 'k1', args: { ref: 21 } }),
    ])
    expect(resultSamples(scrolled[0])).toEqual([])
    // A checkpoint between them shows no page, so the click still reads against the listing.
    const recorded = readShadowRuns('cap', [
      COMMAND,
      PLAN,
      ...landing('n1'),
      event('tool_call', { name: 'record_candidate', callId: 'rc', args: {} }),
      event('tool_call', { name: 'click', callId: 'k1', args: { ref: 22 } }),
    ])
    expect(resultSamples(recorded[0])[0].truth.picks).toEqual(['r22'])
  })

  it('records "picked none" when the model searched again instead', () => {
    const [run] = readShadowRuns('cap', [COMMAND, PLAN, ...landing('n1'), ...landing('n2', 'harrison h4 dial mm')])
    expect(resultSamples(run).map((sample) => sample.truth.picks)).toEqual([[], []])
  })

  it('takes no sample from a navigate that landed on a plain page', () => {
    const [run] = readShadowRuns('cap', [
      COMMAND,
      event('tool_result', { name: 'navigate', callId: 'n1', ok: true, result: 'navigated: url=https://www.rmg.co.uk/x title="x"\n[3] link "y" href="https://www.rmg.co.uk/y"' }),
    ])
    expect(resultSamples(run)).toEqual([])
  })
})

describe('asking and summarizing (#275)', () => {
  it('asks every sample and keeps its answer without its state', async () => {
    const [run] = readShadowRuns('cap', [COMMAND, PLAN])
    const model: DecisionModel = {
      model: 'fake',
      ask: async () =>
        ({
          status: 'answered',
          answers: { pick: { type: 'choice', choice: 'lookup', confidence: 0.8, probabilities: { direct_action: 0.1, lookup: 0.8, investigation: 0.1 } } },
          latencyMs: 90,
          model: 'jev-1.13.0',
        }) as never,
    }
    const rows = await askSamples(model, tierSamples(run), 4)
    expect(rows).toEqual([
      {
        seam: 'tier',
        capture: 'cap',
        turnId: TURN,
        options: 3,
        optionsBeforeCut: 3,
        stateChars: 'Command: what is the dial diameter of H4?'.length,
        modelPicks: ['lookup'],
        latencyMs: 90,
        choice: 'lookup',
        confidence: 0.8,
      },
    ])
  })

  it('scores Choice only where the model picked, Noul against whether it picked, and what the thresholds would have done', () => {
    const row = (fields: Partial<ShadowRow>): ShadowRow => ({
      seam: 'passage',
      capture: 'cap',
      turnId: TURN,
      options: 4,
      optionsBeforeCut: 4,
      stateChars: 100,
      modelPicks: [],
      latencyMs: 100,
      ...fields,
    })
    const summary = summarizeSeam(
      [
        row({ modelPicks: ['p1'], choice: 'p1', confidence: 0.95, noul: 0.9, latencyMs: 80 }),
        row({ modelPicks: ['p2'], choice: 'p1', confidence: 0.75, noul: 0.8, latencyMs: 120 }),
        row({ modelPicks: [], choice: 'p3', confidence: 0.9, noul: 0.2, latencyMs: 100 }),
        row({ modelPicks: [], choice: 'p3', confidence: 0.9, noul: 0.95, latencyMs: 110 }),
        row({ modelPicks: ['p1'], unavailable: 'timeout', latencyMs: 800 }),
      ],
      { choice: 0.7, noul: 0.7 },
    )
    expect(summary.samples).toBe(5)
    expect(summary.unavailable).toEqual({ timeout: 1 })
    // The timeout is the seam's worst cost, so latency counts it.
    expect(summary.latencyMs).toEqual({ median: 110, p95: 800 })
    expect(summary.choice.scored).toBe(2)
    expect(summary.choice.agreement).toBe(0.5)
    expect(summary.choice.byConfidence[9]).toEqual({ from: 0.9, to: 1, n: 1, rate: 1 })
    expect(summary.choice.byConfidence[7]).toEqual({ from: 0.7, to: 0.8, n: 1, rate: 0 })
    expect(summary.noul?.agreementAtHalf).toBe(0.75)
    // "Recorded nothing" is its own column, never a disagreement.
    expect(summary.atThreshold).toMatchObject({ thresholds: { choice: 0.7, noul: 0.7 }, acted: 3, agreed: 1, disagreed: 1, recordedNothing: 1 })
    // Acted share is over the answered rows: 3 of the 4.
    expect(summary.choice.thresholds[9]).toEqual({ at: 0.9, acted: 3, agreed: 1, disagreed: 0, recordedNothing: 2, agreement: 1, actedShare: 0.75 })
    expect(summary.multiPick).toBe(0)
  })
})

describe('choosing a bar from the table (#275, the owner\'s rule)', () => {
  const bar = (at: number, agreed: number, disagreed: number) => ({
    at,
    acted: agreed + disagreed + 3,
    agreed,
    disagreed,
    recordedNothing: 3,
    agreement: agreed + disagreed === 0 ? null : agreed / (agreed + disagreed),
    actedShare: null,
  })

  it('takes the lowest bar agreeing at least 0.8 over at least ten scored acts', () => {
    expect(chooseThreshold([bar(0.5, 14, 6), bar(0.6, 13, 3), bar(0.7, 10, 2), bar(0.8, 8, 1)])).toBe(0.6)
  })

  it('never counts the acts where the model recorded nothing', () => {
    // 8 agreed of 10 scored reaches the bar however many recorded-nothing acts ride along.
    expect(chooseThreshold([{ at: 0.7, acted: 40, agreed: 8, disagreed: 2, recordedNothing: 30, agreement: 0.8, actedShare: null }])).toBe(0.7)
  })

  it('falls back to the highest bar still resting on ten scored acts, and to none without one', () => {
    expect(chooseThreshold([bar(0.6, 10, 5), bar(0.7, 8, 3), bar(0.8, 6, 2), bar(0.9, 3, 1)])).toBe(0.7)
    expect(chooseThreshold([bar(0.9, 3, 1)])).toBeNull()
  })

  it('reads a passage bar at 0.9 agreement over ten scored acts, and at 0.8 where 0.9 is unreachable (#281, Decision 2)', () => {
    expect(choosePassageBar([bar(0.6, 16, 3), bar(0.7, 12, 1), bar(0.8, 10, 0)])).toEqual({ at: 0.7, floor: 0.9 })
    expect(choosePassageBar([bar(0.6, 16, 6), bar(0.7, 14, 2), bar(0.8, 8, 0)])).toEqual({ at: 0.7, floor: 0.8 })
    // Under ten scored acts at every bar that agrees, the bars in force stand (Decision 7).
    expect(choosePassageBar([bar(0.6, 10, 5), bar(0.8, 8, 0)])).toBeNull()
  })

  it('refuses a lower bar that meets the floor only under the repaired truth (Decision 3)', () => {
    const repaired = [bar(0.5, 59, 14), bar(0.6, 41, 9), bar(0.7, 21, 3), bar(0.8, 5, 1)]
    const unrepaired = [bar(0.5, 27, 15), bar(0.6, 22, 9), bar(0.7, 15, 1), bar(0.8, 4, 1)]
    expect(choosePassageBar(repaired)).toEqual({ at: 0.5, floor: 0.8 })
    expect(choosePassageBar(repaired, unrepaired)).toEqual({ at: 0.7, floor: 0.8 })
    // The floor is the repaired table's: 0.9 under the unrepaired truth alone does not raise it.
    expect(choosePassageBar(repaired, [bar(0.7, 15, 1)])).toEqual({ at: 0.7, floor: 0.8 })
    expect(choosePassageBar(repaired, [bar(0.5, 1, 9)])).toBeNull()
    // 0.9 met only under the repair is unreachable, so the 0.8 floor is tried.
    expect(choosePassageBar([bar(0.6, 14, 2), bar(0.7, 12, 1)], [bar(0.6, 9, 2), bar(0.7, 9, 2)])).toEqual({ at: 0.6, floor: 0.8 })
  })
})

describe('summarizing passage rows (#281)', () => {
  const row = (fields: Partial<ShadowRow>): ShadowRow => ({
    seam: 'passage',
    capture: 'cap',
    turnId: TURN,
    callId: 'n1',
    options: 4,
    optionsBeforeCut: 4,
    stateChars: 100,
    modelPicks: [],
    latencyMs: 100,
    pair: 1,
    ...fields,
  })

  it('leaves a row whose Run acted out of every table, and reads the paired table at the Choice bar in force', () => {
    const summary = summarizeSeam(
      [
        row({ modelPicks: ['P1'], choice: 'P1', confidence: 0.9, noul: 0.85 }),
        row({ pair: 2, modelPicks: ['P1'], choice: 'P2', confidence: 0.6, noul: 0.95 }),
        row({ callId: 'n2', modelPicks: ['P1'], choice: 'P1', confidence: 0.95, noul: 0.95, notComparable: true }),
      ],
      { choice: 0.7, noul: 0.8 },
    )
    expect(summary.notComparable).toBe(1)
    expect(summary.choice.scored).toBe(2)
    // The second pair's Noul clears 0.8 but its Choice does not clear 0.7: it never acts.
    expect(summary.noul?.paired.thresholds[8]).toMatchObject({ at: 0.8, acted: 1, agreed: 1, actedShare: 0.5 })
    // Two asks, not three pairs, carry latency.
    expect(summary.latencyMs.median).toBe(100)
  })

  it('lists every act on a page the model recorded nothing from, with the verdict it was judged', () => {
    const acts = [
      row({ choice: 'P3', confidence: 0.9, noul: 0.9, item: 'object ID', objective: 'Find H4', passage: 'ID: | ZAA0037' }),
      row({ pair: 2, choice: 'P1', confidence: 0.9, noul: 0.9, item: 'maker', objective: 'Find H4', passage: 'K1' }),
    ]
    const summary = summarizeSeam(acts, { choice: 0.7, noul: 0.8 }, { 'cap/turn-1/n1/2': { verdict: 'wrong', note: 'K1 is another watch' } })
    expect(summary.atThreshold.recordedNothingActs).toEqual([
      { key: 'cap/turn-1/n1/1', objective: 'Find H4', item: 'object ID', passage: 'ID: | ZAA0037', confidence: 0.9, noul: 0.9 },
      { key: 'cap/turn-1/n1/2', objective: 'Find H4', item: 'maker', passage: 'K1', confidence: 0.9, noul: 0.9, judged: { verdict: 'wrong', note: 'K1 is another watch' } },
    ])
    expect(summary.atThreshold.judged).toEqual({ right: 0, weak: 0, wrong: 1 })
  })
})

describe('recorded tier agreement (#280)', () => {
  function tierRecord(turnId: string, fields: Record<string, unknown>): ShadowTraceLine {
    return { kind: 'decision', turnId, seam: 'tier', acted: 'shadow', ...fields } as ShadowTraceLine
  }
  function plan(turnId: string, effortTier: string): ShadowTraceLine {
    return { kind: 'pipeline_event', turnId, event: { type: 'run_plan', source: 'model', effortTier } }
  }
  const pick = (choice: string, confidence: number) => ({ answers: { pick: { type: 'choice', choice, confidence } } })

  it('joins each Run\'s own tier shadow record with the first tier its model declared, and asks nothing', () => {
    const lines: ShadowTraceLine[] = [
      tierRecord('t1', pick('lookup', 0.9)),
      plan('t1', 'lookup'),
      // A re-declaration after Steering is not what a pre-round-1 pick stands in for.
      plan('t1', 'investigation'),
      tierRecord('t2', pick('investigation', 0.4)),
      plan('t2', 'lookup'),
      tierRecord('t3', { acted: 'unavailable', unavailable: { reason: 'timeout', message: 'slow' } }),
      plan('t3', 'lookup'),
      // A Browse Subagent's record is not the Run's.
      { ...tierRecord('t4', pick('lookup', 0.9)), agentId: 'a1' },
      plan('t4', 'lookup'),
    ]
    const rows = recordedTierRows('pass-1--afbd1fe3', lines)
    expect(rows).toEqual([
      { capture: 'pass-1--afbd1fe3', turnId: 't1', acted: 'shadow', pick: 'lookup', confidence: 0.9, declared: 'lookup', unavailable: null },
      { capture: 'pass-1--afbd1fe3', turnId: 't2', acted: 'shadow', pick: 'investigation', confidence: 0.4, declared: 'lookup', unavailable: null },
      { capture: 'pass-1--afbd1fe3', turnId: 't3', acted: 'unavailable', pick: null, confidence: null, declared: 'lookup', unavailable: 'timeout' },
    ])
    expect(summarizeRecordedTier(rows)).toEqual({ records: 3, unavailable: 1, notComparable: 0, compared: 2, agreed: 1, agreement: 0.5 })
  })

  const [major, minor] = process.versions.node.split('.').map(Number)
  const stripsTypes = major! > 22 || (major === 22 && minor! >= 18)

  // The CLI runs under Node's type stripping; #278 left its graph importing
  // extensionless modules, which broke it until #280. This loads the graph.
  it.skipIf(!stripsTypes)('counts a retained capture\'s Runs, samples and recorded tier shadows on --dry-run, asking nothing', () => {
    const root = mkdtempSync(join(tmpdir(), 'bingbong-shadow-cli-'))
    try {
      mkdirSync(join(root, 'pass-1--afbd1fe3', 'logs'), { recursive: true })
      const lines = [COMMAND, PLAN, tierRecord(TURN, pick('lookup', 0.9)), ...readCall('read-1', 1_000)]
      writeFileSync(join(root, 'pass-1--afbd1fe3', 'logs', 'run-trace-2026-09-27.jsonl'), lines.map((line) => JSON.stringify(line)).join('\n') + '\n')
      const script = fileURLToPath(new URL('../../../scripts/decision-shadow.ts', import.meta.url))
      const result = spawnSync(process.execPath, [script, '--dry-run', `--roots=${root}`, '--sets=pass'], { encoding: 'utf8' })
      expect(result.status, result.stderr).toBe(0)
      expect(result.stderr).toContain('1 captures, 1 runs, samples {"passage":1,"result":0,"tier":1}, recorded tier shadows 1')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('reports a record that acted as not comparable, never as agreement', () => {
    const rows = recordedTierRows('c', [tierRecord('t1', { ...pick('lookup', 0.95), acted: 'acted' }), plan('t1', 'lookup')])
    expect(summarizeRecordedTier(rows)).toEqual({ records: 1, unavailable: 0, notComparable: 1, compared: 0, agreed: 0, agreement: null })
  })
})
