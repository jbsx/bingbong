import { afterEach, describe, expect, it } from 'vitest'

import voyager from '../agent/fixtures/off-language-voyager.json'
import { parseAssistantAnswer } from '../agent/answerContract'
import { FakeClock, RecordingTts, ScriptedLlm, withoutTurnId, type ScriptedTurn } from '../testing/doubles'
import { setFaultSink } from '../trace/fault'
import type { RunTraceEvent } from '../trace/runTrace'
import { createCommandPipeline } from './createCommandPipeline'
import { TIER_TOOL_ROUND_BUDGETS } from './effortEpoch'
import type { PipelineEvent } from './events'
import { createReportRunPlanTool } from './runPlanTools'
import type { Tool } from './tool'

// Issue #318: the Run Trace kept no Answer as the model wrote it, so half of
// an Answer round's output tokens could not be attributed to a field. Every
// reply the pipeline reads as an Answer now leaves its text in an
// `answer_reply` record, and nowhere else.

const COMMAND = 'can I take my guitar on the eurostar'
const DECLARED = ['the guitar rule', 'the piece count']

/** A turn as the wire client builds it: the parsed reply, and the reply itself. */
const wire = (replyText: string): ScriptedTurn => ({ kind: 'answer', ...parseAssistantAnswer(replyText), replyText })
const object = (fields: Record<string, unknown>): string => JSON.stringify({ speak: 'Yes, it travels free.', display: 'A guitar travels free as one of two pieces.', ...fields })

const GUITAR = { n: 1, standing: 'stated', statement: 'free' }
const PIECES = { n: 2, standing: 'stated', statement: 'two' }
const WHOLE = object({ asked_items: [GUITAR, PIECES], run_note: 'TAIL-ONLY note', resolution: 'completed', finalization_cause: 'objective_met' })
const SHORT = object({ asked_items: [GUITAR], run_note: 'TAIL-ONLY note', resolution: 'completed', finalization_cause: 'objective_met' })
const BROKEN = '{"speak": "Yes.", "display": "A guitar travels free", "run_note": }'

const readPage: Tool = { name: 'read_page', acquisition: true, async execute() { return 'Each traveller may bring two pieces of luggage.' } }
const work = (id: string): ScriptedTurn => ({ kind: 'tool_calls', calls: [{ id, name: 'read_page', args: {} }] })
const plan = (effortTier: 'direct_action' | 'lookup', askedItems?: readonly string[]): ScriptedTurn => ({
  kind: 'tool_calls',
  calls: [
    {
      id: 'p1',
      name: 'report_run_plan',
      args: { objective: 'Find the guitar rule', headline: 'Checking', effort_tier: effortTier, ...(askedItems ? { asked_items: askedItems } : {}) },
    },
    { id: 'r0', name: 'read_page', args: {} },
  ],
})
/** A Run whose budget runs out, so its last scripted turn lands in the reserved Answer round. */
const reserved = (answer: ScriptedTurn): ScriptedTurn[] => [
  plan('direct_action'),
  ...Array.from({ length: TIER_TOOL_ROUND_BUDGETS.direct_action - 1 }, (_, i) => work(`w${i}`)),
  work('bk1'),
  answer,
]

async function runScript(script: ScriptedTurn[], options: { trace?: boolean } = {}) {
  const llm = new ScriptedLlm(script)
  const traced: RunTraceEvent[] = []
  const detail: PipelineEvent[] = []
  const committed: unknown[] = []
  setFaultSink(() => {})
  const pipeline = createCommandPipeline({
    llm,
    tts: new RecordingTts(),
    clock: new FakeClock(),
    tools: [createReportRunPlanTool(), readPage],
    emitDetail: (event) => detail.push(event),
  })
  const events: PipelineEvent[] = []
  for await (const raw of pipeline.execute(COMMAND, 'turn-reply', false, {
    snapshot: [],
    memory: [],
    commit: (...args) => {
      committed.push(args)
      return 'committed'
    },
    ...(options.trace === false ? {} : { traceRun: (build: () => RunTraceEvent) => traced.push(build()) }),
  })) {
    events.push(withoutTurnId(raw))
  }
  return {
    llm,
    events,
    detail,
    committed,
    traced,
    replies: traced.filter((record) => record.kind === 'answer_reply'),
    finalDisplay: events.find((event) => event.type === 'display' && event.finalAnswer),
    done: events.at(-1),
  }
}

afterEach(() => setFaultSink(null))

describe('the Answer reply text in the Run Trace (#318)', () => {
  it('keeps an accepted Answer as the model wrote it, with its round and shape', async () => {
    const run = await runScript([plan('lookup'), wire(WHOLE)])

    expect(run.replies).toEqual([
      { kind: 'answer_reply', turnId: 'turn-reply', round: 2, read: 'accepted', shape: 'on_contract', text: WHOLE, chars: WHOLE.length },
    ])
    expect(run.done).toMatchObject({ type: 'done', outcome: 'done' })
  })

  it('keeps a Malformed Answer and the reply to its Answer Retry', async () => {
    const run = await runScript([plan('lookup'), wire(BROKEN), wire(WHOLE)])

    expect(run.replies).toMatchObject([
      { round: 2, read: 'malformed', shape: 'malformed', text: BROKEN, chars: BROKEN.length },
      { round: 3, read: 'accepted', shape: 'on_contract', text: WHOLE },
    ])
  })

  it('keeps a Malformed Answer that stood as written, once, as the accepted reply', async () => {
    const run = await runScript([plan('lookup'), wire(BROKEN), wire(BROKEN)])

    expect(run.replies).toMatchObject([
      { round: 2, read: 'malformed' },
      { round: 3, read: 'accepted', shape: 'malformed', text: BROKEN },
    ])
  })

  it('keeps an Off-language Answer', async () => {
    const chinese = JSON.stringify({ speak: voyager.speak, display: voyager.display })
    const run = await runScript([plan('lookup'), wire(chinese), wire(WHOLE)])

    expect(run.replies).toMatchObject([
      { round: 2, read: 'off_language', shape: 'on_contract', text: chinese },
      { round: 3, read: 'accepted', text: WHOLE },
    ])
  })

  it('keeps an off-contract reply of the reserved Answer round, marked reserved', async () => {
    const prose = 'I looked at the luggage page and I think the guitar is fine.'
    const run = await runScript(reserved(wire(prose)))

    expect(run.replies).toEqual([
      { kind: 'answer_reply', turnId: 'turn-reply', round: run.llm.requests.length, read: 'off_contract', shape: 'off_contract', reserved: true, text: prose, chars: prose.length },
    ])
    expect(run.finalDisplay).toMatchObject({ deterministicAnswer: true })
  })

  it('keeps a reserved Finalization Answer, marked reserved', async () => {
    const run = await runScript(reserved(wire(WHOLE)))

    expect(run.replies).toMatchObject([{ round: run.llm.requests.length, read: 'accepted', reserved: true, text: WHOLE }])
    expect(run.finalDisplay).not.toHaveProperty('deterministicAnswer')
  })

  it('keeps the Answer a list-only retry held, and the list-only reply (#311)', async () => {
    const list = JSON.stringify({ asked_items: [PIECES] })
    const run = await runScript([plan('lookup', DECLARED), wire(SHORT), wire(list)])

    expect(run.replies).toMatchObject([
      { round: 2, read: 'held', shape: 'on_contract', text: SHORT },
      { round: 3, read: 'list_only', text: list, chars: list.length },
    ])
    expect(run.done).toMatchObject({ resolution: 'completed' })
  })

  it('keeps a prose reply whose Asked Items were asked for with the whole Answer', async () => {
    const prose = 'A guitar travels free.'
    const run = await runScript([plan('lookup', DECLARED), wire(prose), wire(WHOLE)])

    expect(run.replies).toMatchObject([
      { round: 2, read: 'asked_items', shape: 'off_contract', text: prose },
      { round: 3, read: 'accepted', text: WHOLE },
    ])
  })

  it('writes no record for a turn whose client gave no reply text', async () => {
    const run = await runScript([plan('lookup'), { kind: 'answer', ...parseAssistantAnswer(WHOLE) }])

    expect(run.replies).toEqual([])
    expect(run.done).toMatchObject({ type: 'done', outcome: 'done' })
  })

  it('changes no event and no commit: the reply text reaches the Run Trace alone', async () => {
    const withText = await runScript([plan('lookup', DECLARED), wire(SHORT), wire(JSON.stringify({ asked_items: [PIECES] }))])
    const without = await runScript([
      plan('lookup', DECLARED),
      { kind: 'answer', ...parseAssistantAnswer(SHORT) },
      { kind: 'answer', ...parseAssistantAnswer(JSON.stringify({ asked_items: [PIECES] })) },
    ])

    expect(withText.events).toEqual(without.events)
    expect(withText.detail).toEqual(without.detail)
    expect(withText.committed).toEqual(without.committed)
    // A request carries its abort signal and callbacks; what it sends is what serializes.
    expect(JSON.stringify(withText.llm.requests)).toBe(JSON.stringify(without.llm.requests))
    expect(withText.traced.filter((record) => record.kind !== 'answer_reply')).toEqual(without.traced)
    expect(JSON.stringify([withText.events, withText.detail, withText.committed])).not.toContain('replyText')
  })

  it('leaves a Run that writes no Run Trace as it was', async () => {
    const run = await runScript([plan('lookup'), wire(WHOLE)], { trace: false })

    expect(run.replies).toEqual([])
    expect(run.finalDisplay).toMatchObject({ text: 'A guitar travels free as one of two pieces.' })
  })
})
