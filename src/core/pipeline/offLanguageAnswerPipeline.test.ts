import { afterEach, describe, expect, it } from 'vitest'

import voyager from '../agent/fixtures/off-language-voyager.json'
import { answerRetryMessage, parseAssistantAnswer } from '../agent/answerContract'
import { OFF_LANGUAGE_RETRY_MESSAGE } from '../agent/answerLanguage'
import { askedItemsRetryMessage } from '../agent/askedItems'
import type { RunStopRecord } from '../session/runJournal'
import { FakeClock, RecordingTts, ScriptedLlm, withoutTurnId, type ScriptedTurn } from '../testing/doubles'
import { setFaultSink, type FaultReport } from '../trace/fault'
import type { RunTraceEvent } from '../trace/runTrace'
import { createCommandPipeline } from './createCommandPipeline'
import { TIER_TOOL_ROUND_BUDGETS } from './effortEpoch'
import type { PipelineEvent } from './events'
import { createReportRunPlanTool } from './runPlanTools'
import type { Tool } from './tool'

// Issue #286: fix-283-3's Voyager initial answered an English command in
// Chinese, Card and Spoken Rendering both. An Off-language Answer is never
// rendered: a reserved round falls to the deterministic Answer, an ordinary
// round spends the Run's one Answer Retry and falls to it when that is spent.

const COMMAND = 'reconcile the two NASA statements about Voyager 1'
const CHINESE: ScriptedTurn = {
  kind: 'answer',
  speak: voyager.speak,
  display: voyager.display,
  shape: 'on_contract',
  resolution: 'completed',
  finalizationCause: 'objective_met',
}
const ENGLISH: ScriptedTurn = {
  kind: 'answer',
  speak: 'Both statements are right.',
  display: 'Both statements are right: Voyager 1 crossed the heliopause on 25 August 2012.',
  shape: 'on_contract',
  resolution: 'completed',
  finalizationCause: 'objective_met',
}
const FALLBACK_CARD = `I have not made progress I can show on “${COMMAND}” yet.`
const FALLBACK_SPOKEN = 'I do not have anything to show for that request yet.'
const FAILURE = 'the Answer was not written in English and no Answer Retry was left'

const readPage: Tool = { name: 'read_page', acquisition: true, async execute() { return 'Voyager 1 has entered interstellar space.' } }
const work = (id: string): ScriptedTurn => ({ kind: 'tool_calls', calls: [{ id, name: 'read_page', args: {} }] })
const plan = (effortTier: 'direct_action' | 'lookup', askedItems?: readonly string[]): ScriptedTurn => ({
  kind: 'tool_calls',
  calls: [
    {
      id: 'p1',
      name: 'report_run_plan',
      args: { objective: 'Reconcile the statements', headline: 'Reconciling', effort_tier: effortTier, ...(askedItems ? { asked_items: askedItems } : {}) },
    },
    { id: 'r0', name: 'read_page', args: {} },
  ],
})

const HAN = /\p{Script=Han}/u

async function runScript(script: ScriptedTurn[], options: { trace?: boolean } = {}) {
  const llm = new ScriptedLlm(script)
  const traced: RunTraceEvent[] = []
  const faults: FaultReport[] = []
  const detail: PipelineEvent[] = []
  const committed: { outcome: string; note: string; stop: RunStopRecord | null | undefined }[] = []
  setFaultSink((report) => faults.push(report))
  const pipeline = createCommandPipeline({
    llm,
    tts: new RecordingTts(),
    clock: new FakeClock(),
    tools: [createReportRunPlanTool(), readPage],
    emitDetail: (event) => detail.push(event),
  })
  const events: PipelineEvent[] = []
  for await (const raw of pipeline.execute(COMMAND, 'turn-lang', false, {
    snapshot: [],
    memory: [],
    commit: (outcome, note, _patch, stop) => {
      committed.push({ outcome, note, stop })
      return 'committed'
    },
    ...(options.trace === false ? {} : { traceRun: (build: () => RunTraceEvent) => traced.push(build()) }),
  })) {
    events.push(withoutTurnId(raw))
  }
  const rendered = events.flatMap((event) => (event.type === 'display' || event.type === 'speak' ? [event] : []))
  return {
    llm,
    events,
    detail,
    committed,
    rendered,
    displays: events.filter((event) => event.type === 'display'),
    spoken: rendered.flatMap((event) => (event.type === 'speak' ? [event.text] : [])),
    records: traced.filter((record) => record.kind === 'off_language_answer'),
    retries: traced.filter((record) => record.kind === 'answer_retry'),
    faults: faults.filter((fault) => fault.site === 'pipeline.createCommandPipeline.offLanguageAnswer'),
    done: events.at(-1),
  }
}

afterEach(() => setFaultSink(null))

describe('an Off-language Answer in the reserved Answer round (#286)', () => {
  const reserved = (answer: ScriptedTurn): ScriptedTurn[] => [
    plan('direct_action'),
    ...Array.from({ length: TIER_TOOL_ROUND_BUDGETS.direct_action - 1 }, (_, i) => work(`w${i}`)),
    // The bookkeeping round, then the reserved Answer round.
    work('bk1'),
    answer,
  ]

  it('is a failed round: the deterministic Answer is displayed and spoken in its place, under the cause the phase holds', async () => {
    const run = await runScript(reserved({ ...CHINESE, streamChunks: [voyager.display] } as ScriptedTurn))

    expect(run.displays).toEqual([expect.objectContaining({ text: FALLBACK_CARD, deterministicAnswer: true, finalAnswer: true })])
    expect(run.spoken).toEqual([FALLBACK_SPOKEN])
    expect(run.done).toEqual({ type: 'done', outcome: 'failed', finalizationCause: 'budget_exhausted', at: 0 })
    // No retry: the round had none to spend.
    expect(run.llm.requests.some((request) => request.answerRetry !== undefined)).toBe(false)
    expect(run.retries).toEqual([])
  })

  it('never puts the Chinese text in a display or speak event, and streams none of it', async () => {
    const run = await runScript(reserved({ ...CHINESE, streamChunks: [voyager.display] } as ScriptedTurn))

    expect(run.rendered.some((event) => HAN.test(event.text))).toBe(false)
    expect(run.detail.filter((event) => event.type === 'llm_delta')).toEqual([])
  })

  it('records the round, both renderings with their shares, no retry, and the cause the fallback used, beside a fault', async () => {
    const run = await runScript(reserved(CHINESE))

    expect(run.records).toEqual([
      {
        kind: 'off_language_answer',
        turnId: 'turn-lang',
        round: run.llm.requests.length,
        renderings: [
          { rendering: 'card', share: expect.closeTo(0.64, 1) },
          { rendering: 'spoken', share: expect.any(Number) },
        ],
        retried: false,
        cause: 'budget_exhausted',
        text: voyager.display,
        chars: voyager.display.length,
      },
    ])
    expect(run.faults).toMatchObject([{ turnId: 'turn-lang', message: expect.stringContaining('Off-language Answer') }])
    expect(run.faults[0]?.message).toContain('budget_exhausted')
  })

  it('names the round in the fault as the record does, whether or not a Run Trace is written (#302)', async () => {
    const traced = await runScript(reserved(CHINESE))
    const untraced = await runScript(reserved(CHINESE), { trace: false })

    expect(untraced.records).toEqual([])
    expect(untraced.faults).toHaveLength(1)
    expect(untraced.faults[0]?.message).toMatch(new RegExp(`^round ${untraced.llm.requests.length} replied`))
    expect(untraced.faults[0]?.message).toBe(traced.faults[0]?.message)
  })

  it('commits the failed Run with its cause and the failure, and nothing of the Answer', async () => {
    const run = await runScript(reserved(CHINESE))

    expect(run.committed).toMatchObject([
      {
        outcome: 'failed',
        stop: { cause: 'budget_exhausted', failure: 'the reserved Answer round answered in a language other than English' },
      },
    ])
    expect(run.committed).toHaveLength(1)
    expect(HAN.test(JSON.stringify(run.committed))).toBe(false)
  })

  it('leaves an English Answer in the reserved round as it was', async () => {
    const run = await runScript(reserved(ENGLISH))

    expect(run.displays).toEqual([expect.objectContaining({ text: ENGLISH.kind === 'answer' ? ENGLISH.display : '', finalAnswer: true })])
    expect(run.done).toMatchObject({ type: 'done', outcome: 'done', finalizationCause: 'budget_exhausted' })
    expect(run.records).toEqual([])
  })
})

describe('an Off-language Answer in an ordinary round (#286)', () => {
  it('spends the Answer Retry with the message, and an English reply to it stands as the Answer', async () => {
    const run = await runScript([work('r1'), CHINESE, ENGLISH])

    expect(run.llm.requests).toHaveLength(3)
    expect(run.llm.requests[1]).not.toHaveProperty('answerRetry')
    expect(run.llm.requests[2]?.answerRetry).toEqual({ reply: voyager.display, message: OFF_LANGUAGE_RETRY_MESSAGE })
    expect(run.llm.requests[2]).not.toHaveProperty('answerOnly')
    expect(run.displays).toEqual([
      expect.objectContaining({ text: 'Both statements are right: Voyager 1 crossed the heliopause on 25 August 2012.', finalAnswer: true }),
    ])
    expect(run.displays[0]).not.toHaveProperty('deterministicAnswer')
    expect(run.spoken).toEqual(['Both statements are right.'])
    expect(run.rendered.some((event) => HAN.test(event.text))).toBe(false)
    expect(run.done).toMatchObject({ type: 'done', outcome: 'done', resolution: 'completed', finalizationCause: 'objective_met' })
    expect(run.records).toMatchObject([{ kind: 'off_language_answer', round: 2, retried: true }])
    expect(run.records[0]).not.toHaveProperty('cause')
    expect(run.retries).toEqual([{ kind: 'answer_retry', turnId: 'turn-lang', role: 'orchestrator', outcome: 'on_contract' }])
    expect(run.committed).toEqual([{ outcome: 'done', note: expect.any(String), stop: null }])
  })

  it('judges each rendering on its own: an English Card with a Chinese Spoken Rendering is retried', async () => {
    const run = await runScript([{ ...ENGLISH, speak: voyager.speak } as ScriptedTurn, ENGLISH])

    expect(run.llm.requests[1]?.answerRetry?.message).toBe(OFF_LANGUAGE_RETRY_MESSAGE)
    expect(run.records).toMatchObject([{ renderings: [{ rendering: 'spoken', share: expect.any(Number) }], retried: true }])
    expect(run.spoken).toEqual(['Both statements are right.'])
  })

  it('judges a prose Answer too', async () => {
    const run = await runScript([{ kind: 'answer', ...parseAssistantAnswer(voyager.speak) }, ENGLISH])

    expect(run.llm.requests[1]?.answerRetry?.message).toBe(OFF_LANGUAGE_RETRY_MESSAGE)
    expect(run.rendered.some((event) => HAN.test(event.text))).toBe(false)
  })

  it('lets the deterministic Answer stand in when the retried Answer is off-language too', async () => {
    const run = await runScript([work('r1'), CHINESE, CHINESE])

    expect(run.llm.requests).toHaveLength(3)
    expect(run.llm.requests.filter((request) => request.answerRetry !== undefined)).toHaveLength(1)
    expect(run.displays).toEqual([expect.objectContaining({ text: FALLBACK_CARD, deterministicAnswer: true, finalAnswer: true })])
    expect(run.spoken).toEqual([FALLBACK_SPOKEN])
    expect(run.rendered.some((event) => HAN.test(event.text))).toBe(false)
    // The Run entered no Finalization, so it has no cause, and nothing says `hard_limit`.
    expect(run.done).toEqual({ type: 'done', outcome: 'failed', at: 0 })
    expect(run.committed).toEqual([{ outcome: 'failed', note: expect.any(String), stop: { failure: FAILURE } }])
    expect(run.records.map((record) => (record.kind === 'off_language_answer' ? { round: record.round, retried: record.retried } : record))).toEqual([
      { round: 2, retried: true },
      { round: 3, retried: false },
    ])
    for (const record of run.records) expect(record).not.toHaveProperty('cause')
    expect(run.retries).toEqual([{ kind: 'answer_retry', turnId: 'turn-lang', role: 'orchestrator', outcome: 'off_language' }])
    expect(JSON.stringify([run.events, run.records, run.committed, run.faults])).not.toContain('hard_limit')
    expect(run.faults).toHaveLength(2)
    expect(run.faults[1]?.message).toContain('no Answer Retry left')
  })

  it('numbers the Answer and its retried reply by their own rounds with no Run Trace written (#302)', async () => {
    const run = await runScript([plan('lookup'), CHINESE, CHINESE], { trace: false })

    expect(run.faults.map((fault) => /^round \d+/.exec(fault.message)?.[0])).toEqual(['round 2', 'round 3'])
  })

  it('lets the deterministic Answer stand in when a Malformed Answer already spent the retry', async () => {
    const malformed = parseAssistantAnswer('Here it is: {"speak": "Yes.", "display": 42}')
    const run = await runScript([{ kind: 'answer', ...malformed }, CHINESE])

    expect(run.llm.requests).toHaveLength(2)
    expect(run.llm.requests[1]?.answerRetry?.message).toBe(answerRetryMessage(malformed.malformedError ?? ''))
    expect(run.displays).toEqual([expect.objectContaining({ text: FALLBACK_CARD, deterministicAnswer: true })])
    expect(run.done).toEqual({ type: 'done', outcome: 'failed', at: 0 })
    expect(run.committed[0]?.stop).toEqual({ failure: FAILURE })
    expect(run.records).toMatchObject([{ round: 2, retried: false }])
    expect(run.retries).toMatchObject([{ outcome: 'off_language' }])
  })

  it('never stands as written once the retry is spent, where a Malformed Answer would', async () => {
    const malformed = parseAssistantAnswer(`Here it is: {"speak": "${voyager.speak}", "display": 42}`)
    const run = await runScript([CHINESE, { kind: 'answer', ...malformed }])

    // The retried reply is a Malformed Answer in Chinese: the retry is spent, so it would render raw.
    expect(run.displays).toEqual([expect.objectContaining({ text: FALLBACK_CARD, deterministicAnswer: true })])
    expect(run.rendered.some((event) => HAN.test(event.text))).toBe(false)
    expect(run.done).toEqual({ type: 'done', outcome: 'failed', at: 0 })
  })

  it('leaves a reply the runtime could not take to its own rule: a Malformed Answer in Chinese is retried as one', async () => {
    const malformed = parseAssistantAnswer(`Here it is: {"speak": "${voyager.speak}", "display": 42}`)
    const run = await runScript([{ kind: 'answer', ...malformed }, ENGLISH])

    // No Card to judge yet: the retry asks for the Answer, and the reply to it is judged.
    expect(run.llm.requests[1]?.answerRetry?.message).toBe(answerRetryMessage(malformed.malformedError ?? ''))
    expect(run.records).toEqual([])
    expect(run.rendered.some((event) => HAN.test(event.text))).toBe(false)
    expect(run.done).toMatchObject({ outcome: 'done', resolution: 'completed' })
  })

  it('renders every declared Asked Item unverified on the deterministic Answer', async () => {
    const guitar = { item: 'the June statement', standing: 'stated', statement: 'Two of three signs.' } as const
    const run = await runScript([plan('lookup', ['the June statement']), { ...CHINESE, askedItems: [guitar] } as ScriptedTurn, { ...CHINESE, askedItems: [guitar] } as ScriptedTurn])

    const display = run.displays[0]
    expect(display).toMatchObject({ deterministicAnswer: true, askedItems: [{ item: 'the June statement', standing: 'unverified' }] })
  })
})

describe('the Answer Retry stays one per Run across its three users (#286)', () => {
  const DECLARED = ['the June statement', 'the September statement']
  const june = { item: 'the June statement', standing: 'stated', statement: 'Two of three signs.' } as const
  const september = { item: 'the September statement', standing: 'stated', statement: 'The crossing was confirmed.' } as const

  it('gives a short Asked Items list no retry after an Off-language Answer spent it', async () => {
    const run = await runScript([
      plan('lookup', DECLARED),
      { ...CHINESE, askedItems: [june, september] } as ScriptedTurn,
      { ...ENGLISH, askedItems: [june] } as ScriptedTurn,
    ])

    expect(run.llm.requests.filter((request) => request.answerRetry !== undefined)).toHaveLength(1)
    expect(run.llm.requests[2]?.answerRetry?.message).toBe(OFF_LANGUAGE_RETRY_MESSAGE)
    // The short list stands as written and settles unverified, as with any spent retry.
    expect(run.displays[0]).toMatchObject({ askedItems: [june, { item: 'the September statement', standing: 'unverified' }] })
    expect(run.done).toMatchObject({ outcome: 'done', resolution: 'partial' })
  })

  it('gives an Off-language Answer no retry after a short Asked Items list spent it', async () => {
    const run = await runScript([
      plan('lookup', DECLARED),
      { ...ENGLISH, askedItems: [june] } as ScriptedTurn,
      { ...CHINESE, askedItems: [june, september] } as ScriptedTurn,
    ])

    expect(run.llm.requests.filter((request) => request.answerRetry !== undefined)).toHaveLength(1)
    expect(run.llm.requests[2]?.answerRetry?.message).toBe(askedItemsRetryMessage(DECLARED, { missing: ['the September statement'], undeclared: [] }, 'list'))
    // The reply to the list-only retry is read for its list alone (#311):
    // its off-language renderings are not the Answer's, which stands as
    // first written in English with the list merged in.
    expect(run.llm.requests).toHaveLength(3)
    expect(run.displays).toEqual([expect.objectContaining({ text: ENGLISH.kind === 'answer' ? ENGLISH.display : '', askedItems: [june, september] })])
    expect(run.done).toMatchObject({ outcome: 'done', resolution: 'completed' })
  })

  it('meets an Off-language Answer after a prose reply spent the retry with the deterministic Answer', async () => {
    const run = await runScript([
      plan('lookup', DECLARED),
      { kind: 'answer', speak: 'Both are right.', display: 'Both are right.', shape: 'off_contract' },
      { ...CHINESE, askedItems: [june, september] } as ScriptedTurn,
    ])

    expect(run.llm.requests.filter((request) => request.answerRetry !== undefined)).toHaveLength(1)
    expect(run.llm.requests[2]?.answerRetry?.message).toBe(askedItemsRetryMessage(DECLARED, { missing: DECLARED, undeclared: [] }, 'prose'))
    expect(run.displays).toEqual([expect.objectContaining({ text: expect.stringContaining('I have not'), deterministicAnswer: true })])
    expect(run.done).toEqual({ type: 'done', outcome: 'failed', at: 0 })
  })

  it('asks for English first when an Answer is off-language and its list is short, and spends the retry once', async () => {
    const run = await runScript([
      plan('lookup', DECLARED),
      { ...CHINESE, askedItems: [june] } as ScriptedTurn,
      { ...ENGLISH, askedItems: [june, september] } as ScriptedTurn,
    ])

    expect(run.llm.requests.filter((request) => request.answerRetry !== undefined)).toHaveLength(1)
    expect(run.llm.requests[2]?.answerRetry?.message).toBe(OFF_LANGUAGE_RETRY_MESSAGE)
    expect(run.done).toMatchObject({ outcome: 'done', resolution: 'completed' })
  })

  it('sends no retry at all across a Run that met all three', async () => {
    const malformed = parseAssistantAnswer('Here it is: {"speak": "Yes.", "display": 42}')
    const run = await runScript([plan('lookup', DECLARED), { kind: 'answer', ...malformed }, work('r2'), { ...ENGLISH, askedItems: [june] } as ScriptedTurn])

    expect(run.llm.requests.filter((request) => request.answerRetry !== undefined)).toHaveLength(1)
    expect(run.records).toEqual([])
  })
})
