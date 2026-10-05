import { describe, expect, it } from 'vitest'

import { parseAssistantAnswer } from '../agent/answerContract'
import { LlmTransportError, type AssistantTurn, type LlmClient, type LlmRequest } from '../ports/llm'
import { FakeClock, RecordingTts, until, withoutTurnId } from '../testing/doubles'
import type { RunTraceEvent } from '../trace/runTrace'
import { createCommandPipeline, type ContinuityDegradationReason } from './createCommandPipeline'
import type { PipelineEvent } from './events'
import { createReportRunPlanTool } from './runPlanTools'
import type { Tool } from './tool'

// Issue #319 (ADR 0074): the Card was published only when the whole Answer
// object had parsed, a median 2,138 output tokens into the round, when the
// fields it is made from are about 1,100. It is now published when those
// fields have closed in the stream, and the Answer Tail is written behind it.

const COMMAND = 'what is the answer'

/** One round of the model: what it streams, and the turn it ends with. */
type Round = (request: LlmRequest, clock: FakeClock) => Promise<AssistantTurn>

function gate(): { promise: Promise<void>; open: () => void } {
  let open: () => void = () => {}
  const promise = new Promise<void>((resolve) => {
    open = resolve
  })
  return { promise, open }
}

/** A round that never ends on its own: the deadline's abort ends it. */
function abortable(request: LlmRequest): Promise<AssistantTurn> {
  return new Promise((_resolve, reject) => {
    request.signal?.addEventListener('abort', () => reject(new Error('The operation was aborted')))
  })
}

const text = (request: LlmRequest, chunk: string): void => request.onDelta?.({ kind: 'text', text: chunk })
const answer = (content: string): AssistantTurn => ({ kind: 'answer', ...parseAssistantAnswer(content) })

/** The round that declares the Run's Asked Items and reads a page. */
const plan: Round = async () => ({
  kind: 'tool_calls',
  calls: [
    { id: 'p1', name: 'report_run_plan', args: { objective: 'Find it', headline: 'Finding', effort_tier: 'lookup', asked_items: ['price', 'size'] } },
    { id: 'r1', name: 'read_page', args: {} },
  ],
})

const BOTH = '[{"n":1,"standing":"stated","statement":"$39"},{"n":2,"standing":"stated","statement":"M"}]'

function start(rounds: Round[], options: { activeWorkDeadlineMs?: number } = {}) {
  const clock = new FakeClock()
  const tts = new RecordingTts()
  const requests: LlmRequest[] = []
  const pagesRead: string[] = []
  const readPage: Tool = {
    name: 'read_page',
    acquisition: true,
    async execute() {
      pagesRead.push('read')
      return 'The answer is 42.'
    },
  }
  const llm: LlmClient = {
    async complete(request) {
      requests.push(request)
      request.onAttempt?.({ model: 'scripted' })
      const round = rounds.shift()
      if (round === undefined) throw new Error('the model ran out of rounds')
      return round(request, clock)
    },
  }
  const traced: RunTraceEvent[] = []
  const degraded: ContinuityDegradationReason[] = []
  const notes: string[] = []
  const pipeline = createCommandPipeline({
    llm,
    tts,
    clock,
    tools: [createReportRunPlanTool(), readPage],
    emitDetail: () => {},
    onContinuityDegraded: (reason) => degraded.push(reason),
    ...(options.activeWorkDeadlineMs !== undefined ? { activeWorkDeadlineMs: options.activeWorkDeadlineMs } : {}),
  })
  const events: PipelineEvent[] = []
  const finished = (async () => {
    for await (const raw of pipeline.execute(COMMAND, 'turn-card', false, {
      snapshot: [],
      memory: [],
      commit: (_outcome, note) => {
        notes.push(note)
        return 'committed'
      },
      traceRun: (build) => traced.push(build()),
    })) {
      events.push(withoutTurnId(raw))
    }
  })()
  const cards = () => events.flatMap((event) => (event.type === 'display' ? [event] : []))
  const records = (kind: RunTraceEvent['kind']) => traced.filter((record) => record.kind === kind)
  return { clock, tts, requests, events, finished, cards, records, degraded, notes, pagesRead, pipeline }
}

describe('the Card is published when its fields close (#319)', () => {
  it('publishes the Card of a Run with no Asked Items once a key of the Answer Tail opens, and the Tail is taken when it lands', async () => {
    const rest = gate()
    const reply = '{"speak":"Done.","display":"# Paused the video.","resolution":"completed","run_note":"Paused the video."}'
    const run = start([
      async (request, clock) => {
        clock.advance(2_000)
        text(request, '{"speak":"Done.","display":"# Paused the video.","resolution":')
        await rest.promise
        clock.advance(3_000)
        text(request, '"completed","run_note":"Paused the video."}')
        return answer(reply)
      },
    ])

    await until(() => run.cards().length > 0, 'the early Card')
    // The round is still in flight.
    expect(run.events.some((event) => event.type === 'done')).toBe(false)
    expect(run.cards()).toEqual([{ type: 'display', text: '# Paused the video.', at: 2_000, finalAnswer: true }])

    rest.open()
    await run.finished

    // Published once; the Tail settles behind it.
    expect(run.cards()).toHaveLength(1)
    expect(run.notes).toEqual(['Paused the video.'])
    expect(run.events.at(-1)).toMatchObject({ type: 'done', outcome: 'done', resolution: 'completed' })
    expect(run.tts.spoken).toEqual(['Done.'])
    expect(run.records('early_card')).toEqual([
      { turnId: 'turn-card', kind: 'early_card', round: 1, publishedAt: 2_000, sinceRoundStartMs: 2_000, untilRoundEndMs: 3_000 },
    ])
    expect(run.records('answer_tail_fallback')).toEqual([])
    expect(run.records('answer_out_of_order')).toEqual([])
    expect(run.degraded).toEqual([])
  })

  it('publishes the Card of a Run that declared Asked Items when asked_items closes, with the standings', async () => {
    const rest = gate()
    const card = `{"speak":"Both hold.","display":"# Both hold.","asked_items":${BOTH}`
    const run = start([
      plan,
      async (request) => {
        text(request, card)
        await rest.promise
        return answer(`${card},"resolution":"completed"}`)
      },
    ])

    await until(() => run.cards().length > 0, 'the early Card')
    expect(run.events.some((event) => event.type === 'done')).toBe(false)
    expect(run.cards()).toEqual([
      expect.objectContaining({
        text: '# Both hold.',
        finalAnswer: true,
        askedItems: [
          { item: 'price', standing: 'stated', statement: '$39' },
          { item: 'size', standing: 'stated', statement: 'M' },
        ],
      }),
    ])

    rest.open()
    await run.finished
    expect(run.cards()).toHaveLength(1)
    expect(run.records('early_card')).toMatchObject([{ round: 2 }])
  })

  it('records the Answer Checkpoints after the Card and before the spoken line (ADR 0072)', async () => {
    const reply =
      '{"speak":"Done.","display":"# Done.","resolution":"completed","checkpoints":[{"observation":"The page showed 42.","source_url":"https://example.com/a","excerpt":"42"}]}'
    const run = start([
      async (request) => {
        text(request, reply)
        return answer(reply)
      },
    ])
    await run.finished

    expect(run.records('early_card')).toHaveLength(1)
    expect(run.records('answer_checkpoints')).toMatchObject([{ offered: 1 }])
    const types = run.events.map((event) => (event.type === 'status' ? `status:${event.status}` : event.type))
    expect(types.indexOf('display')).toBeLessThan(types.indexOf('status:speaking'))
  })
})

describe('a shown Card stands (#319)', () => {
  it('keeps the Card when a deadline cuts the Answer Tail: no later round, no Answer Retry, a deterministic Run Note', async () => {
    const run = start(
      [
        async (request) => {
          text(request, '{"speak":"Early.","display":"# The Card.","resolution":"comp')
          return abortable(request)
        },
      ],
      { activeWorkDeadlineMs: 1_000 },
    )

    await until(() => run.cards().length > 0, 'the early Card')
    run.clock.advance(1_000)
    await run.finished

    expect(run.cards()).toEqual([expect.objectContaining({ text: '# The Card.', finalAnswer: true })])
    expect(run.cards()[0]).not.toHaveProperty('deterministicAnswer')
    expect(run.requests).toHaveLength(1)
    expect(run.tts.spoken).toEqual(['Early.'])
    expect(run.events.at(-1)).toMatchObject({ type: 'done', outcome: 'done', finalizationCause: 'deadline_reached' })
    expect(run.records('answer_tail_fallback')).toEqual([{ turnId: 'turn-card', kind: 'answer_tail_fallback', round: 1, reason: 'cut' }])
    expect(run.records('answer_retry')).toEqual([])
    // The sentence was the Card's own: it stood for no other Answer.
    expect(run.records('stood_sentence')).toEqual([])
    expect(run.degraded).toEqual(['answer_tail_fell_back', 'missing'])
    expect(run.notes).toHaveLength(1)
    expect(run.notes[0]).not.toBe('')
  })

  it('keeps the Card when the transport fails inside the Answer Tail', async () => {
    const run = start([
      async (request) => {
        text(request, '{"speak":"Early.","display":"# The Card.","resolution":"comp')
        throw new LlmTransportError(2, { cause: new Error('socket hang up') })
      },
    ])
    await run.finished

    expect(run.cards()).toEqual([expect.objectContaining({ text: '# The Card.', finalAnswer: true })])
    expect(run.requests).toHaveLength(1)
    expect(run.events.some((event) => event.type === 'error')).toBe(false)
    expect(run.events.at(-1)).toMatchObject({ type: 'done', outcome: 'done' })
    // No Finalization was entered for a request that failed: the Run
    // records the Answer it gave.
    expect(run.events.at(-1)).toMatchObject({ finalizationCause: 'model_answered' })
    expect(run.records('answer_tail_fallback')).toMatchObject([{ round: 1, reason: 'request_failed' }])
    expect(run.records('answer_retry')).toEqual([])
    expect(run.degraded).toContain('answer_tail_fell_back')
  })

  it('keeps the Card when the client retries the attempt that wrote it: the retry’s Answer is not its Answer Tail', async () => {
    const run = start([
      async (request) => {
        text(request, '{"speak":"Early.","display":"# The Card.","resolution":"comp')
        // The Card is published before the client gives the attempt up.
        await until(() => run.cards().length > 0, 'the early Card')
        request.onRetryAttempt?.(2, 3, 'transport')
        const retried = '{"speak":"Retried.","display":"# The retried Card.","resolution":"completed","run_note":"The retry’s note."}'
        text(request, retried)
        return answer(retried)
      },
    ])
    await run.finished

    expect(run.cards()).toEqual([expect.objectContaining({ text: '# The Card.', finalAnswer: true })])
    expect(run.tts.spoken).toEqual(['Early.'])
    expect(run.records('answer_tail_fallback')).toMatchObject([{ round: 1, reason: 'request_failed' }])
    expect(run.notes).not.toContain('The retry’s note.')
  })

  it('publishes no Card early from an attempt the client has already retried', async () => {
    const run = start([
      async (request) => {
        // The Card closes and the attempt is given up in the same turn of
        // the stream, before the pipeline has published anything.
        text(request, '{"speak":"Early.","display":"# The abandoned Card.","resolution":"comp')
        request.onRetryAttempt?.(2, 3, 'transport')
        const retried = '{"speak":"Retried.","display":"# The retried Card.","resolution":"completed"}'
        text(request, retried)
        return answer(retried)
      },
    ])
    await run.finished

    expect(run.cards()).toEqual([expect.objectContaining({ text: '# The retried Card.', finalAnswer: true })])
    expect(run.records('early_card')).toEqual([])
    expect(run.records('answer_tail_fallback')).toEqual([])
  })

  it('lets a shown Card go at a Steering replan: the corrected objective’s Card carries none of its standings', async () => {
    const rest = gate()
    const card = `{"speak":"Both hold.","display":"# Both hold.","asked_items":${BOTH}`
    const run = start([
      plan,
      async (request) => {
        text(request, card)
        await rest.promise
        return answer(`${card},"resolution":"completed"}`)
      },
      async () => answer('{"speak":"Corrected.","display":"# The corrected Card."}'),
    ])

    await until(() => run.cards().length > 0, 'the early Card')
    run.pipeline.pause()
    run.pipeline.resume('actually, find the other one')
    rest.open()
    await run.finished

    expect(run.cards().map((event) => event.text)).toEqual(['# Both hold.', '# The corrected Card.'])
    expect(run.cards()[0]).toHaveProperty('askedItems')
    expect(run.cards()[1]).not.toHaveProperty('askedItems')
    expect(run.events.at(-1)).toMatchObject({ type: 'done', outcome: 'done' })
  })

  it('keeps the Card when the stream breaks for any other reason', async () => {
    const run = start([
      async (request) => {
        text(request, '{"speak":"Early.","display":"# The Card.","resolution":"comp')
        throw new Error('stream ended unexpectedly')
      },
    ])
    await run.finished

    expect(run.cards()).toEqual([expect.objectContaining({ text: '# The Card.', finalAnswer: true })])
    expect(run.events.some((event) => event.type === 'error')).toBe(false)
    expect(run.events.at(-1)).toMatchObject({ type: 'done', outcome: 'done' })
    expect(run.records('answer_tail_fallback')).toMatchObject([{ reason: 'request_failed' }])
  })

  it('keeps the Card when the JSON breaks inside the Answer Tail, and spends no Answer Retry', async () => {
    const broken = '{"speak":"Early.","display":"# The Card.","resolution":"completed","run_note":"never closed}'
    const run = start([
      async (request) => {
        text(request, broken)
        return answer(broken)
      },
    ])
    await run.finished

    expect(run.cards()).toEqual([expect.objectContaining({ text: '# The Card.', finalAnswer: true })])
    expect(run.requests).toHaveLength(1)
    expect(run.records('answer_tail_fallback')).toMatchObject([{ round: 1, reason: 'broken_json' }])
    expect(run.records('answer_retry')).toEqual([])
    expect(run.degraded).toEqual(['answer_tail_fell_back', 'missing'])
    expect(run.events.at(-1)).toMatchObject({ type: 'done', outcome: 'done' })
  })

  it('keeps the Card, and runs no tool, when the round that wrote it ends with tool calls', async () => {
    const run = start([
      async (request) => {
        text(request, '{"speak":"Early.","display":"# The Card.","resolution":"completed"}')
        return { kind: 'tool_calls', calls: [{ id: 'r1', name: 'read_page', args: {} }] }
      },
    ])
    await run.finished

    expect(run.cards()).toEqual([expect.objectContaining({ text: '# The Card.', finalAnswer: true })])
    expect(run.pagesRead).toEqual([])
    expect(run.requests).toHaveLength(1)
    expect(run.tts.spoken).toEqual(['Early.'])
    expect(run.records('answer_tail_fallback')).toMatchObject([{ reason: 'tool_calls' }])
    expect(run.records('second_utterance')).toEqual([])
  })
})

describe('an Answer that may not take the early path (#319)', () => {
  it('publishes nothing early when asked_items does not cover the declaration, and takes the list-only retry', async () => {
    const rest = gate()
    const short = '{"speak":"Both hold.","display":"# Both hold.","asked_items":[{"n":1,"standing":"stated","statement":"$39"}]'
    const run = start([
      plan,
      async (request) => {
        text(request, `${short},"resolution":`)
        await rest.promise
        return answer(`${short},"resolution":"completed"}`)
      },
      async () => answer(`{"asked_items":${BOTH}}`),
    ])

    await until(() => run.requests.length === 2, 'the Answer round')
    await Promise.resolve()
    expect(run.cards()).toEqual([])
    rest.open()
    await run.finished

    expect(run.requests[2]?.answerRetry).toBeDefined()
    expect(run.records('asked_items_shape')).toMatchObject([{ retried: true, listOnly: true }])
    expect(run.cards()).toEqual([expect.objectContaining({ text: '# Both hold.', finalAnswer: true })])
    expect(run.records('early_card')).toEqual([])
  })

  it('publishes nothing early for an Off-language Card, and spends the Answer Retry as before', async () => {
    const rest = gate()
    const offLanguage = '{"speak":"Done.","display":"これは日本語で書かれた回答です。ページの内容を確認しました。","resolution":"completed"}'
    const run = start([
      async (request) => {
        text(request, offLanguage)
        await rest.promise
        return answer(offLanguage)
      },
      async () => answer('{"speak":"Done.","display":"# In English."}'),
    ])

    await until(() => run.requests.length === 1, 'the Answer round')
    await Promise.resolve()
    expect(run.cards()).toEqual([])
    rest.open()
    await run.finished

    expect(run.requests[1]?.answerRetry).toBeDefined()
    expect(run.cards()).toEqual([expect.objectContaining({ text: '# In English.' })])
    expect(run.records('early_card')).toEqual([])
  })

  it('publishes nothing early for a Card that is not the contract’s shape, and spends the Answer Retry as before', async () => {
    const malformed = '{"speak":"First.","display":42,"resolution":"completed"}'
    const run = start([
      async (request) => {
        text(request, malformed)
        return answer(malformed)
      },
      async () => answer('{"speak":"Second.","display":"The Card."}'),
    ])
    await run.finished

    expect(run.requests[1]?.answerRetry).toBeDefined()
    expect(run.cards()).toEqual([expect.objectContaining({ text: 'The Card.', finalAnswer: true })])
    expect(run.records('early_card')).toEqual([])
  })

  it('publishes an Answer out of field order at the object’s end, and counts it', async () => {
    const rest = gate()
    const reply = '{"speak":"Done.","display":"# Done.","run_note":"Did it.","evidence_ids":[],"resolution":"completed"}'
    const run = start([
      async (request) => {
        text(request, reply.slice(0, -1))
        await rest.promise
        text(request, '}')
        return answer(reply)
      },
    ])

    await until(() => run.requests.length === 1, 'the Answer round')
    await Promise.resolve()
    expect(run.cards()).toEqual([])
    rest.open()
    await run.finished

    expect(run.cards()).toEqual([expect.objectContaining({ text: '# Done.', finalAnswer: true })])
    expect(run.notes).toEqual(['Did it.'])
    expect(run.records('answer_out_of_order')).toEqual([{ turnId: 'turn-card', kind: 'answer_out_of_order', round: 1 }])
    expect(run.records('early_card')).toEqual([])
  })

  it('publishes no Card early in an Answer Retry round', async () => {
    const rest = gate()
    const malformed = '{"speak":"First.","display":42}'
    const retried = '{"speak":"Second.","display":"The Card.","resolution":"completed"}'
    const run = start([
      async (request) => {
        text(request, malformed)
        return answer(malformed)
      },
      async (request) => {
        text(request, retried)
        await rest.promise
        return answer(retried)
      },
    ])

    await until(() => run.requests.length === 2, 'the Answer Retry round')
    await Promise.resolve()
    expect(run.cards()).toEqual([])
    rest.open()
    await run.finished

    expect(run.cards()).toEqual([expect.objectContaining({ text: 'The Card.', finalAnswer: true })])
    expect(run.records('early_card')).toEqual([])
  })

  it('publishes no Card early in a list-only retry round: a whole Answer written there is read for its list alone', async () => {
    const short = '{"speak":"Both hold.","display":"# Both hold.","asked_items":[{"n":1,"standing":"stated","statement":"$39"}]}'
    const whole = `{"speak":"Again.","display":"# Written again.","asked_items":${BOTH},"resolution":"completed"}`
    const run = start([
      plan,
      async (request) => {
        text(request, short)
        return answer(short)
      },
      async (request) => {
        text(request, whole)
        return answer(whole)
      },
    ])
    await run.finished

    expect(run.cards()).toEqual([expect.objectContaining({ text: '# Both hold.', finalAnswer: true })])
    expect(run.records('early_card')).toEqual([])
  })
})
