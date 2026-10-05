import { afterEach, describe, expect, it, vi } from 'vitest'

import { parseAssistantAnswer } from '../agent/answerContract'
import { ASKED_ITEM_UNESTABLISHED } from '../agent/askedItems'
import { LlmNotConfiguredError, type AssistantTurn, type LlmClient, type LlmRequest } from '../ports/llm'
import type { TtsSpeaker } from '../ports/tts'
import type { RunStopRecord } from '../session/runJournal'
import { FakeClock, RecordingTts, until, withoutTurnId } from '../testing/doubles'
import { RESOURCE_ACCOUNTING } from '../testing/stoppingPolicy'
import { setFaultSink, type FaultReport } from '../trace/fault'
import type { RunTraceEvent } from '../trace/runTrace'
import { createCommandPipeline } from './createCommandPipeline'
import type { PipelineEvent } from './events'
import { createReportRunPlanTool } from './runPlanTools'
import type { Tool } from './tool'

// Issue #322: a Run that fails outright — a working round that threw
// anything but a deadline cut, a client timeout or a Transport Failure —
// spoke "I could not finish that request.", showed the raw exception as a
// Feed line and discarded what it had found. It ends on the Deterministic
// Answer instead (ADR 0027, ADR 0038), with no model round tried.

const composing = vi.hoisted(() => ({ fails: false }))
vi.mock('./fallbackAnswer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./fallbackAnswer')>()
  return {
    ...actual,
    deriveFallbackSources: (...args: Parameters<typeof actual.deriveFallbackSources>) => {
      if (composing.fails) throw new Error('the sources could not be derived')
      return actual.deriveFallbackSources(...args)
    },
  }
})

const COMMAND = 'what does the longitude watch cost'
const PAGE = 'https://example.com/watch'
const PROVIDER_ERROR = 'orchestrator request failed (HTTP 500): {"error":{"code":"1234"}}'
const UNCONFIRMED_SPOKEN = 'Here is what I found so far, though I have not confirmed an answer yet.'
const NOTHING_TO_SHOW_SPOKEN = 'I do not have anything to show for that request yet.'
const NOTHING_TO_SHOW_CARD = `I have not made progress I can show on “${COMMAND}” yet.`

const readPage: Tool = {
  name: 'read_page',
  acquisition: true,
  async execute() {
    return `# The longitude watch — ${PAGE}\n\npage text:\nThe watch is listed at £4.20.`
  },
}

/** One round of the model: what it streams, and the turn it ends with or the error it throws. */
type Round = (request: LlmRequest) => Promise<AssistantTurn>

const text = (request: LlmRequest, chunk: string): void => request.onDelta?.({ kind: 'text', text: chunk })
const answer = (content: string): AssistantTurn => ({ kind: 'answer', ...parseAssistantAnswer(content) })
const fails: Round = () => Promise.reject(new Error(PROVIDER_ERROR))
const readsThePage: Round = async () => ({
  kind: 'tool_calls',
  calls: [
    {
      id: 'p1',
      name: 'report_run_plan',
      args: { objective: 'Find the watch price', headline: 'Find the watch price', effort_tier: 'lookup', asked_items: ['the price', 'the maker'] },
    },
    { id: 'r1', name: 'read_page', args: {} },
  ],
})

function start(rounds: Round[], tts: TtsSpeaker & { readonly spoken: string[] } = new RecordingTts()) {
  const requests: LlmRequest[] = []
  const llm: LlmClient = {
    async complete(request) {
      requests.push(request)
      request.onAttempt?.({ model: 'scripted' })
      const round = rounds.shift()
      if (round === undefined) throw new Error('the model ran out of rounds')
      return round(request)
    },
  }
  const faults: FaultReport[] = []
  setFaultSink((report) => faults.push(report))
  const traced: RunTraceEvent[] = []
  const stops: (RunStopRecord | null | undefined)[] = []
  const pipeline = createCommandPipeline({
    llm,
    tts,
    clock: new FakeClock(),
    tools: [createReportRunPlanTool(), readPage],
    currentPageUrl: () => PAGE,
  })
  const events: PipelineEvent[] = []
  const finished = (async () => {
    for await (const raw of pipeline.execute(COMMAND, 'turn-322', false, {
      snapshot: [],
      memory: [],
      commit: (_outcome, _note, _patch, stop) => {
        stops.push(stop)
        return 'committed'
      },
      traceRun: (build) => traced.push(build()),
    })) {
      events.push(withoutTurnId(raw))
    }
  })()
  const spoken = (): string[] => events.flatMap((event) => (event.type === 'speak' ? [event.text] : []))
  const cards = () => events.filter((event): event is Extract<PipelineEvent, { type: 'display' }> => event.type === 'display')
  const records = (kind: RunTraceEvent['kind']) => traced.filter((record) => record.kind === kind)
  return { tts, requests, events, finished, spoken, cards, records, faults, stops, stop: () => pipeline.abort() }
}

/** Nothing the user is shown or hears carries the failure. */
function expectNoErrorSurfaced(run: ReturnType<typeof start>): void {
  expect(run.events.filter((event) => event.type === 'error')).toEqual([])
  for (const shown of [...run.cards().map((card) => card.text), ...run.spoken()]) {
    expect(shown).not.toContain('HTTP 500')
    expect(shown).not.toContain('could not finish')
    expect(shown).not.toMatch(RESOURCE_ACCOUNTING)
  }
}

afterEach(() => {
  setFaultSink(null)
  composing.fails = false
})

describe('a Run that fails outright ends on the Deterministic Answer (#322)', () => {
  it('shows and speaks the nothing-to-show Answer when the first round fails', async () => {
    const run = start([fails])
    await run.finished

    expect(run.events.map((event) => (event.type === 'status' ? `status:${event.status}` : event.type))).toEqual([
      'command',
      'status:thinking',
      'display',
      'status:speaking',
      'speak',
      'done',
    ])
    expect(run.cards()).toEqual([expect.objectContaining({ text: NOTHING_TO_SHOW_CARD, deterministicAnswer: true, finalAnswer: true })])
    expect(run.spoken()).toEqual([NOTHING_TO_SHOW_SPOKEN])
    expect(run.tts.spoken).toEqual([NOTHING_TO_SHOW_SPOKEN])
    expectNoErrorSurfaced(run)
    // No model round is tried.
    expect(run.requests).toHaveLength(1)
  })

  it('shows what the Run found and speaks the unconfirmed line when a round fails after tool rounds', async () => {
    const run = start([readsThePage, fails])
    await run.finished

    const [card, ...others] = run.cards()
    expect(others).toEqual([])
    expect(card).toMatchObject({ deterministicAnswer: true, finalAnswer: true })
    expect(card!.text).toContain(`I have not confirmed an answer for “${COMMAND}” yet.`)
    expect(card!.text).toContain(`What I have so far:\n- ${PAGE}`)
    expect(card!.text).toContain('The watch is listed at £4.20.')
    // Declared Asked Items are unverified, as on any deterministic path.
    expect(card!.askedItems).toEqual([
      { item: 'the price', standing: 'unverified', statement: ASKED_ITEM_UNESTABLISHED },
      { item: 'the maker', standing: 'unverified', statement: ASKED_ITEM_UNESTABLISHED },
    ])
    expect(run.spoken()).toEqual([UNCONFIRMED_SPOKEN])
    expectNoErrorSurfaced(run)
    expect(run.requests).toHaveLength(2)
  })

  it('invents no Finalization Cause: the outcome is failed and the Stop Record and the fault report keep the error', async () => {
    const run = start([readsThePage, fails])
    await run.finished

    const done = run.events.at(-1)
    expect(done).toMatchObject({ type: 'done', outcome: 'failed' })
    expect(done).not.toHaveProperty('finalizationCause')
    expect(run.stops).toEqual([{ failure: `the run failed outside Finalization: ${PROVIDER_ERROR}` }])
    expect(run.faults).toContainEqual(
      expect.objectContaining({ site: 'pipeline.createCommandPipeline.runFailedOutsideFinalization', turnId: 'turn-322' }),
    )
  })

  it('speaks nothing after a sentence spoken early, and still shows the Card', async () => {
    const run = start([
      readsThePage,
      async (request) => {
        text(request, '{"speak":"It costs £4.20.",')
        text(request, '"display":"# The longitude watch')
        await until(() => run.spoken().length > 0, 'the early sentence')
        throw new Error(PROVIDER_ERROR)
      },
    ])
    await run.finished

    expect(run.spoken()).toEqual(['It costs £4.20.'])
    expect(run.tts.spoken).toEqual(['It costs £4.20.'])
    // The round had not closed its Card, so the Card is the deterministic one.
    expect(run.cards()).toEqual([expect.objectContaining({ deterministicAnswer: true, finalAnswer: true })])
    expect(run.cards()[0]!.text).toContain(`What I have so far:\n- ${PAGE}`)
    expect(run.records('stood_sentence')).toEqual([expect.objectContaining({ kind: 'stood_sentence', card: 'deterministic' })])
    expect(run.records('second_utterance')).toEqual([])
    expectNoErrorSurfaced(run)
    expect(run.events.at(-1)).toMatchObject({ type: 'done', outcome: 'failed' })
  })

  it('keeps a Card already shown when the Run fails after it, and shows no second one', async () => {
    // The Answer's Card is published, and the voice then throws rather
    // than reporting a failed playback.
    const tts: TtsSpeaker & { readonly spoken: string[] } = {
      spoken: [],
      speak: () => Promise.reject(new Error('the speech engine crashed')),
      stop() {},
    }
    const run = start([async () => answer('{"speak":"It costs £4.20.","display":"# The longitude watch costs £4.20."}')], tts)
    await run.finished

    expect(run.cards()).toEqual([expect.objectContaining({ text: '# The longitude watch costs £4.20.', finalAnswer: true })])
    expect(run.cards()[0]).not.toHaveProperty('deterministicAnswer')
    expect(run.spoken()).toEqual(['It costs £4.20.'])
    expect(run.events.filter((event) => event.type === 'error')).toEqual([])
    expect(run.events.at(-1)).toMatchObject({ type: 'done', outcome: 'failed' })
    expect(run.stops).toEqual([{ failure: 'the run failed outside Finalization: the speech engine crashed' }])
  })

  it('shows and speaks the nothing-to-show Answer, and reports the fault, when composing the Deterministic Answer throws', async () => {
    const run = start([
      readsThePage,
      () => {
        composing.fails = true
        return Promise.reject(new Error(PROVIDER_ERROR))
      },
    ])
    await run.finished

    expect(run.cards()).toEqual([expect.objectContaining({ text: NOTHING_TO_SHOW_CARD, deterministicAnswer: true, finalAnswer: true })])
    expect(run.spoken()).toEqual([NOTHING_TO_SHOW_SPOKEN])
    expectNoErrorSurfaced(run)
    expect(run.faults.map((fault) => fault.site)).toEqual(
      expect.arrayContaining([
        'pipeline.createCommandPipeline.runFailedOutsideFinalization',
        'pipeline.createCommandPipeline.failedRunAnswer',
      ]),
    )
    expect(run.events.at(-1)).toMatchObject({ type: 'done', outcome: 'failed' })
  })

  it('still shows which settings to give when no model is configured, beside the Deterministic Answer', async () => {
    const reason = "model routing for 'orchestrator' is not configured. Set BINGBONG_ORCHESTRATOR_API_KEY."
    const run = start([() => Promise.reject(new LlmNotConfiguredError(reason))])
    await run.finished

    expect(run.events.filter((event) => event.type === 'error')).toEqual([expect.objectContaining({ message: reason })])
    expect(run.cards()).toEqual([expect.objectContaining({ text: NOTHING_TO_SHOW_CARD, deterministicAnswer: true })])
    expect(run.spoken()).toEqual([NOTHING_TO_SHOW_SPOKEN])
  })

  it('leaves Stop untouched: a cancelled Run says "Stopped." and shows no Card', async () => {
    const run = start([
      (request) =>
        new Promise((_resolve, reject) => {
          request.signal?.addEventListener('abort', () => reject(new Error('The operation was aborted')))
        }),
    ])
    await until(() => run.requests.length === 1, 'the round in flight')
    run.stop()
    await run.finished

    expect(run.spoken()).toEqual(['Stopped.'])
    expect(run.cards()).toEqual([])
    expect(run.events.at(-1)).toMatchObject({ type: 'done', outcome: 'cancelled' })
  })
})
