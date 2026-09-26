import { describe, expect, it } from 'vitest'
import type { ToolCall } from '../ports/llm'
import type { DecisionModel, DecisionQuestions, DecisionRequest, DecisionResult } from '../ports/decisionModel'
import type { DecisionEvent } from '../trace/runTrace'
import type { SnapshotRef } from '../browser/snapshot'
import type { RunPlan } from './runPlan'
import { createResultPick, listingHead, resultOpenedLine, resultPickCall, withResultPick, type ResultPickDeps } from './resultPick'

// Issue #277, ADR 0070: the Result Pick's own judgement — when a search
// landing is asked about, what the Decision Model is asked, and what an
// answer opens. The executor's half (the navigate it runs, the result the
// model reads, the Search Loop streak) is pinned in toolRound.test.ts.

const SEARCH = 'https://duckduckgo.com/?q=voyager+golden+record+contents'
const LONG_HREF = `https://science.nasa.gov/mission/voyager/golden-record-contents/${'x'.repeat(240)}`

const LISTING = [
  `navigated: url=${SEARCH} title="voyager golden record contents at DuckDuckGo"`,
  `# voyager golden record contents at DuckDuckGo — ${SEARCH}`,
  'viewport 1280x800 scroll 0/2400',
  'signature abc123',
  '[1] link "DuckDuckGo" href="https://duckduckgo.com/"',
  '[2] input[search] "Search" value="voyager golden record contents"',
  '[3] link "Golden Record Contents - NASA Science" href="https://science.nasa.gov/mission/voyager/golden-record-contents/"',
  '[4] link "Voyager Golden Record - Wikipedia" href="https://en.wikipedia.org/wiki/Voyager_Golden_Record"',
  '[5] link "More results" href="https://duckduckgo.com/?q=voyager+golden+record+contents&s=10"',
  '[6] link "Cookie settings" href="https://duckduckgo.com/settings" (dialog)',
  'page text:',
  'Golden Record Contents - NASA Science. The contents of the record were selected for NASA by a committee chaired by Carl Sagan.',
].join('\n')

const LOOKUP: RunPlan = {
  objective: 'Find what is on the Voyager Golden Record',
  headline: null,
  effortTier: 'lookup',
  askedItems: ['the contents of the Golden Record'],
}

function navigate(url: string, id = 'n1'): ToolCall {
  return { id, name: 'navigate', args: { url } }
}

type Answer = (request: DecisionRequest<DecisionQuestions>) => DecisionResult<DecisionQuestions>

function answered(choice: string, confidence: number, noul: number): Answer {
  return (request) => {
    const options = Object.keys((request.questions.result as { options: Record<string, unknown> }).options)
    return {
      status: 'answered',
      model: 'jev-1.13.0',
      latencyMs: 90,
      answers: {
        result: { type: 'choice', choice, confidence, probabilities: Object.fromEntries(options.map((label) => [label, label === choice ? confidence : 0])) },
        answers: { type: 'noul', noul },
      },
    } as DecisionResult<DecisionQuestions>
  }
}

function fixture(options: { answer?: Answer; plan?: RunPlan | null; describeRef?: ResultPickDeps['describeRef'] } = {}) {
  const asked: DecisionRequest<DecisionQuestions>[] = []
  const records: DecisionEvent[] = []
  const model: DecisionModel = {
    model: 'jev-1.13.0',
    async ask(request) {
      asked.push(request as DecisionRequest<DecisionQuestions>)
      return (options.answer ?? answered('3', 0.9, 0.9))(request as DecisionRequest<DecisionQuestions>) as never
    },
  }
  const pick = createResultPick({
    model,
    threshold: { choice: 0.7, noul: 0.7 },
    runPlan: () => (options.plan === undefined ? LOOKUP : options.plan),
    round: () => 4,
    record: (event) => records.push(event),
    ...(options.describeRef ? { describeRef: options.describeRef } : {}),
  })
  return { pick, asked, records }
}

describe('when a search landing is asked about (#277, ADR 0070)', () => {
  it('asks on a Search URL landing for a Lookup with an open Asked Item, and opens the chosen ref', async () => {
    const f = fixture()
    const picked = await f.pick.choose(navigate(SEARCH), { ok: true, result: LISTING })
    expect(picked).toEqual({ ref: 3, label: 'Golden Record Contents - NASA Science', href: 'https://science.nasa.gov/mission/voyager/golden-record-contents/' })
    expect(f.asked).toHaveLength(1)
  })

  it('asks for an Investigation too', async () => {
    const f = fixture({ plan: { ...LOOKUP, effortTier: 'investigation' } })
    expect(await f.pick.choose(navigate(SEARCH), { ok: true, result: LISTING })).not.toBeNull()
  })

  it('never asks for a Direct Action: the command may be asking for the listing itself', async () => {
    const f = fixture({ plan: { ...LOOKUP, effortTier: 'direct_action', askedItems: [] } })
    expect(await f.pick.choose(navigate(SEARCH), { ok: true, result: LISTING })).toBeNull()
    expect(f.asked).toHaveLength(0)
    expect(f.records).toHaveLength(0)
  })

  it('never asks without a plan, or with no Asked Item open', async () => {
    for (const plan of [null, { ...LOOKUP, askedItems: [] }]) {
      const f = fixture({ plan })
      expect(await f.pick.choose(navigate(SEARCH), { ok: true, result: LISTING })).toBeNull()
      expect(f.asked).toHaveLength(0)
    }
  })

  it('never asks on a landing that is not a Search URL, on another tool, or on a failed, walled, not-found or unavailable landing', async () => {
    const cases: [ToolCall, { ok: true; result: string } | { ok: false; error: string }][] = [
      [navigate('https://science.nasa.gov/voyager'), { ok: true, result: LISTING }],
      [{ id: 'c', name: 'click', args: { ref: 3 } }, { ok: true, result: LISTING }],
      [navigate(SEARCH), { ok: false, error: 'navigate failed: timed out' }],
      [navigate(SEARCH), { ok: true, result: `${LISTING}\nBLOCKER:challenge duckduckgo.com` }],
      [navigate(SEARCH), { ok: true, result: `${LISTING}\nNOT-FOUND:404 duckduckgo.com` }],
      [navigate(SEARCH), { ok: true, result: `${LISTING}\nUNAVAILABLE:503 duckduckgo.com` }],
    ]
    for (const [call, outcome] of cases) {
      const f = fixture()
      expect(await f.pick.choose(call, outcome)).toBeNull()
      expect(f.asked).toHaveLength(0)
    }
  })

  it('never asks on a listing with no result to open', async () => {
    const f = fixture()
    const bare = LISTING.split('\n').filter((line) => !/^\[[134]\]/.test(line)).join('\n')
    expect(await f.pick.choose(navigate(SEARCH), { ok: true, result: bare })).toBeNull()
    expect(f.asked).toHaveLength(0)
  })
})

describe('what the Decision Model is asked (#277, ADR 0070)', () => {
  it('a Choice over the result refs and a Noul that any answers, over the objective, the open Asked Items, the refs and the preview', async () => {
    const f = fixture()
    await f.pick.choose(navigate(SEARCH), { ok: true, result: LISTING })
    const [request] = f.asked
    expect(Object.keys(request!.questions)).toEqual(['result', 'answers'])
    expect(request!.questions.result).toMatchObject({ type: 'choice' })
    expect(request!.questions.answers).toMatchObject({ type: 'noul' })
    // The listing's link refs, less another search (only another listing)
    // and a dialog's links: neither is a result the objective is answered by.
    expect(Object.keys((request!.questions.result as { options: object }).options)).toEqual(['1', '3', '4'])
    expect(request!.state).toContain(LOOKUP.objective)
    expect(request!.state).toContain('the contents of the Golden Record')
    expect(request!.state).toContain('[3] "Golden Record Contents - NASA Science" https://science.nasa.gov/mission/voyager/golden-record-contents/')
    expect(request!.state).toContain('committee chaired by Carl Sagan')
  })
})

describe('what an answer does (#277, ADR 0070)', () => {
  it('records an acted Decision Record for the result seam in the caller’s round, without the state', async () => {
    const f = fixture()
    await f.pick.choose(navigate(SEARCH), { ok: true, result: LISTING })
    expect(f.records).toEqual([
      expect.objectContaining({ kind: 'decision', seam: 'result', round: 4, questions: ['result', 'answers'], acted: 'acted', model: 'jev-1.13.0', threshold: { choice: 0.7, noul: 0.7 } }),
    ])
    expect(f.records[0]!.stateChars).toBe(f.asked[0]!.state.length)
  })

  it('opens nothing under threshold — either answer — and says so in the record', async () => {
    for (const answer of [answered('3', 0.5, 0.9), answered('3', 0.9, 0.4)]) {
      const f = fixture({ answer })
      expect(await f.pick.choose(navigate(SEARCH), { ok: true, result: LISTING })).toBeNull()
      expect(f.records.map((record) => record.acted)).toEqual(['under_threshold'])
    }
  })

  it('opens nothing when the Decision Model is unavailable, and says so in the record', async () => {
    const f = fixture({ answer: () => ({ status: 'unavailable', reason: 'timeout', message: 'no answer in 800 ms', latencyMs: 800, model: 'jev-1.13.0' }) })
    expect(await f.pick.choose(navigate(SEARCH), { ok: true, result: LISTING })).toBeNull()
    expect(f.records.map((record) => record.acted)).toEqual(['unavailable'])
  })

  it('opens the whole href the tab holds for the ref, not the printed cut', async () => {
    const printed = LISTING.replace('https://science.nasa.gov/mission/voyager/golden-record-contents/', `${LONG_HREF.slice(0, 199)}…`)
    const described: SnapshotRef = { ref: 3, kind: 'link', label: 'Golden Record Contents - NASA Science', href: LONG_HREF } as SnapshotRef
    const f = fixture({ describeRef: async (ref) => (ref === 3 ? described : undefined) })
    const picked = await f.pick.choose(navigate(SEARCH), { ok: true, result: printed })
    expect(picked?.href).toBe(LONG_HREF)
  })
})

describe('the result the model reads (#277, ADR 0070)', () => {
  const pick = { ref: 3, label: 'Golden Record Contents - NASA Science', href: 'https://science.nasa.gov/mission/voyager/golden-record-contents/' }
  const LANDED = 'navigated: url=https://science.nasa.gov/mission/voyager/golden-record-contents/ title="Golden Record Contents"\n# Golden Record Contents — https://science.nasa.gov/mission/voyager/golden-record-contents/'

  it('is the listing’s head, the Opened line, then the landed page’s Action Outcome', () => {
    const combined = withResultPick({ ok: true, result: LISTING }, pick, { ok: true, result: LANDED })
    expect(combined).toEqual({ ok: true, result: `${listingHead(LISTING)}\n${resultOpenedLine(pick)}\n${LANDED}` })
    expect(resultOpenedLine(pick)).toBe('Opened [3] "Golden Record Contents - NASA Science" — https://science.nasa.gov/mission/voyager/golden-record-contents/')
    // The head keeps every ref, so any other result is one round away, and
    // leaves the preview to the page the Run is now on.
    expect(listingHead(LISTING)).toContain('[4] link "Voyager Golden Record - Wikipedia"')
    expect(listingHead(LISTING)).not.toContain('page text:')
  })

  it('keeps the whole listing when the open failed, and says what failed', () => {
    const combined = withResultPick({ ok: true, result: LISTING }, pick, { ok: false, error: 'navigate failed: timed out' })
    expect(combined).toEqual({ ok: true, result: `${LISTING}\nTried to open [3] "Golden Record Contents - NASA Science" — ${pick.href}: navigate failed: timed out` })
  })

  it('is opened by a navigate to the whole href, under its own call id', () => {
    expect(resultPickCall(navigate(SEARCH, 'n7'), pick)).toEqual({ id: 'n7:result-pick', name: 'navigate', args: { url: pick.href } })
  })
})
