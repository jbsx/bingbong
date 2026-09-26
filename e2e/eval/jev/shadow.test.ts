import { describe, expect, it } from 'vitest'
import type { DecisionModel } from '../../../src/core/ports/decisionModel.ts'
import { EFFORT_TIERS } from '../../../src/core/pipeline/runPlan.ts'
import {
  askSamples,
  chooseThreshold,
  landingUrl,
  listingResults,
  MAX_OPTIONS,
  pagePassages,
  passageSamples,
  readShadowRuns,
  resultSamples,
  SHADOW_TIERS,
  summarizeSeam,
  TIER_QUESTIONS,
  tierSamples,
  type ShadowRow,
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

describe('passage samples (#275)', () => {
  it('reads a Page Read\'s passages from its page text, one per line', () => {
    expect(pagePassages(PAGE_READ)).toEqual([
      'H4',
      "Marine timekeeper, H4. This is Harrison's prize-winning longitude watch.",
      'ID: | ZAA0037',
      'Measurements: | Dial diameter: 102 mm',
    ])
  })

  it('takes the model\'s pick from the passage holding the excerpt grounded on that read, whitespace and case aside', () => {
    const [run] = readShadowRuns('cap', [COMMAND, PLAN, ...readCall('c1', 5_000), checkpoint('ID: | zaa0037 | measurements: | DIAL   diameter: 102 mm', 4_999)])
    const [sample] = passageSamples(run)
    // "ID:" and "zaa0037" are too short to pin a passage; the diameter pins p4.
    expect(sample.truth.picks).toEqual(['p4'])
    expect(sample.callId).toBe('c1')
    expect(Object.keys((sample.questions.pick as { options: object }).options)).toEqual(['p1', 'p2', 'p3', 'p4'])
    expect(sample.state).toContain('[p4] Measurements: | Dial diameter: 102 mm')
    expect(sample.state).toContain('- H4 dial diameter')
  })

  it('records "picked none" for a read the model recorded nothing from', () => {
    const [run] = readShadowRuns('cap', [COMMAND, PLAN, ...readCall('c1', 5_000), checkpoint('a passage from some other page entirely', 4_999)])
    expect(passageSamples(run)[0].truth.picks).toEqual([])
  })

  it('never credits a read with a checkpoint grounded elsewhere, even one quoting its words', () => {
    // Grounded on a navigate landing of the same page: the read showed it too, but the model recorded it from the landing.
    const [landed] = readShadowRuns('cap', [COMMAND, PLAN, ...readCall('c1', 5_000), checkpoint('Dial diameter: 102 mm')])
    expect(passageSamples(landed)[0].truth.picks).toEqual([])

    // Two reads of one page: the checkpoint grounded on the second credits only the second.
    const [twice] = readShadowRuns('cap', [COMMAND, PLAN, ...readCall('c1', 5_000), ...readCall('c2', 9_000), checkpoint('Dial diameter: 102 mm', 8_999)])
    expect(passageSamples(twice).map((sample) => [sample.callId, sample.truth.picks])).toEqual([
      ['c1', []],
      ['c2', ['p4']],
    ])
  })

  it(`cuts a page at ${MAX_OPTIONS} passages and says so`, () => {
    const long = `page text:\n${Array.from({ length: MAX_OPTIONS + 5 }, (_, at) => `passage number ${at}`).join('\n')}`
    const [run] = readShadowRuns('cap', [COMMAND, event('tool_result', { name: 'read_page', callId: 'c1', ok: true, result: long })])
    const [sample] = passageSamples(run)
    expect(sample.optionsBeforeCut).toBe(MAX_OPTIONS + 5)
    expect(Object.keys((sample.questions.pick as { options: object }).options)).toHaveLength(MAX_OPTIONS)
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
    expect(summary.atThreshold).toEqual({ thresholds: { choice: 0.7, noul: 0.7 }, acted: 3, agreed: 1, disagreed: 1, recordedNothing: 1 })
    expect(summary.choice.thresholds[9]).toEqual({ at: 0.9, acted: 3, agreed: 1, disagreed: 0, recordedNothing: 2, agreement: 1 })
    expect(summary.multiPick).toBe(0)
  })
})

describe('choosing a bar from the table (#275, the owner\'s rule)', () => {
  const bar = (at: number, agreed: number, disagreed: number) => ({ at, acted: agreed + disagreed + 3, agreed, disagreed, recordedNothing: 3, agreement: agreed + disagreed === 0 ? null : agreed / (agreed + disagreed) })

  it('takes the lowest bar agreeing at least 0.8 over at least ten scored acts', () => {
    expect(chooseThreshold([bar(0.5, 14, 6), bar(0.6, 13, 3), bar(0.7, 10, 2), bar(0.8, 8, 1)])).toBe(0.6)
  })

  it('never counts the acts where the model recorded nothing', () => {
    // 8 agreed of 10 scored reaches the bar however many recorded-nothing acts ride along.
    expect(chooseThreshold([{ at: 0.7, acted: 40, agreed: 8, disagreed: 2, recordedNothing: 30, agreement: 0.8 }])).toBe(0.7)
  })

  it('falls back to the highest bar still resting on ten scored acts, and to none without one', () => {
    expect(chooseThreshold([bar(0.6, 10, 5), bar(0.7, 8, 3), bar(0.8, 6, 2), bar(0.9, 3, 1)])).toBe(0.7)
    expect(chooseThreshold([bar(0.9, 3, 1)])).toBeNull()
  })
})
