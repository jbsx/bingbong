import { describe, expect, it } from 'vitest'

import { parseAssistantAnswer } from '../agent/answerContract'
import type { AssistantTurn, LlmClient, LlmRequest } from '../ports/llm'
import { FailingTts, FakeClock, RecordingTts, until, withoutTurnId } from '../testing/doubles'
import type { RunTraceEvent } from '../trace/runTrace'
import { createCommandPipeline } from './createCommandPipeline'
import type { PipelineEvent } from './events'
import { createReportRunPlanTool } from './runPlanTools'
import type { Tool } from './tool'

// Issue #312: the spoken sentence of an Answer closed in the stream a
// median 16.7 s before it was spoken, because `speak` was published only
// when the whole Answer round ended. It is now spoken when it closes, and
// the round goes on.

const COMMAND = 'what is the answer'
const readPage: Tool = { name: 'read_page', acquisition: true, async execute() { return 'The answer is 42.' } }

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

function start(rounds: Round[], options: { activeWorkDeadlineMs?: number; failingTts?: boolean } = {}) {
  const clock = new FakeClock()
  const tts = new RecordingTts()
  const requests: LlmRequest[] = []
  const llm: LlmClient = {
    async complete(request) {
      requests.push(request)
      request.onAttempt?.({ model: 'scripted' })
      const round = rounds.shift()
      if (round === undefined) throw new Error('the model ran out of rounds')
      return round(request, clock)
    },
  }
  const detail: PipelineEvent[] = []
  const traced: RunTraceEvent[] = []
  const pipeline = createCommandPipeline({
    llm,
    tts: options.failingTts === true ? new FailingTts('no audio device') : tts,
    clock,
    tools: [createReportRunPlanTool(), readPage],
    emitDetail: (event) => detail.push(event),
    ...(options.activeWorkDeadlineMs !== undefined ? { activeWorkDeadlineMs: options.activeWorkDeadlineMs } : {}),
  })
  const events: PipelineEvent[] = []
  const finished = (async () => {
    for await (const raw of pipeline.execute(COMMAND, 'turn-early', false, {
      snapshot: [],
      memory: [],
      commit: () => 'committed',
      traceRun: (build) => traced.push(build()),
    })) {
      events.push(withoutTurnId(raw))
    }
  })()
  const spoken = (): string[] => events.flatMap((event) => (event.type === 'speak' ? [event.text] : []))
  const records = (kind: RunTraceEvent['kind']) => traced.filter((record) => record.kind === kind)
  return { clock, tts, requests, detail, events, finished, spoken, records }
}

describe('the sentence is spoken when it closes (#312)', () => {
  it('publishes the speak event before the round ends, and the Answer does not speak it again', async () => {
    const rest = gate()
    const run = start([
      async (request, clock) => {
        clock.advance(2_000)
        text(request, '{"speak":"It is 42.",')
        text(request, '"display":"# The answer')
        await rest.promise
        clock.advance(3_000)
        text(request, ' is 42."}')
        return answer('{"speak":"It is 42.","display":"# The answer is 42."}')
      },
    ])

    await until(() => run.spoken().length > 0, 'the early sentence')
    // The round is still in flight: no Card, no end.
    expect(run.events.some((event) => event.type === 'display' || event.type === 'done')).toBe(false)
    expect(run.events.find((event) => event.type === 'speak')).toEqual({ type: 'speak', text: 'It is 42.', at: 2_000 })
    expect(run.tts.spoken).toEqual(['It is 42.'])

    rest.open()
    await run.finished

    expect(run.spoken()).toEqual(['It is 42.'])
    expect(run.tts.spoken).toEqual(['It is 42.'])
    expect(run.events.find((event) => event.type === 'display')).toMatchObject({ text: '# The answer is 42.', finalAnswer: true })
    // The spoken line's status still lands when the Answer does.
    const types = run.events.map((event) => (event.type === 'status' ? `status:${event.status}` : event.type))
    expect(types.indexOf('speak')).toBeLessThan(types.indexOf('display'))
    expect(types.indexOf('status:speaking')).toBeGreaterThan(types.indexOf('display'))
    expect(run.events.at(-1)).toMatchObject({ type: 'done', outcome: 'done' })
    expect(run.records('early_sentence')).toEqual([
      { turnId: 'turn-early', kind: 'early_sentence', round: 1, publishedAt: 2_000, sinceRoundStartMs: 2_000, untilRoundEndMs: 3_000, ended: 'answer' },
    ])
    expect(run.records('second_utterance')).toEqual([])
  })

  it('reads the Answer behind a preamble: the preamble is not shown, the envelope never streams, the sentence is spoken', async () => {
    const reply = 'Everything is verified. Here is the answer.\n\n{"speak":"Yes.","display":"# Yes, it is."}'
    const run = start([
      async (request, clock) => {
        text(request, 'Everything is verified. Here is the answer.')
        clock.advance(200)
        text(request, '\n\n{"speak":"Yes.","display":"# Yes')
        clock.advance(200)
        text(request, ', it is."}')
        return answer(reply)
      },
    ])
    await run.finished

    const fragments = run.detail.flatMap((event) => (event.type === 'llm_delta' && event.kind === 'text' ? [event] : []))
    // The preamble streamed as prose until the object opened behind it,
    // and the stream then restarted at the object's value.
    expect(fragments[0]).toMatchObject({ text: 'Everything is verified. Here is the answer.' })
    expect(fragments.find((fragment) => fragment.restart === true)).toMatchObject({ text: 'Yes.' })
    expect(fragments.some((fragment) => /[{}]|"display"/.test(fragment.text))).toBe(false)
    expect(run.spoken()).toEqual(['Yes.'])
    expect(run.events.find((event) => event.type === 'display')).toMatchObject({ text: '# Yes, it is.' })
  })

  it('speaks once after a Malformed Answer: the sentence already spoken is the one recorded, the retry’s own is not spoken', async () => {
    const malformed = '{"speak":"First.","display":42}'
    const run = start([
      async (request) => {
        text(request, malformed)
        return answer(malformed)
      },
      async () => answer('{"speak":"Second.","display":"The Card."}'),
    ])
    await run.finished

    expect(run.requests[1]?.answerRetry).toBeDefined()
    expect(run.spoken()).toEqual(['First.'])
    expect(run.tts.spoken).toEqual(['First.'])
    expect(run.events.filter((event) => event.type === 'display')).toEqual([expect.objectContaining({ text: 'The Card.', finalAnswer: true })])
    expect(run.records('early_sentence')).toMatchObject([{ round: 1, ended: 'answer' }])
    expect(run.records('second_utterance')).toEqual([])
  })

  it('speaks once after an Asked Items retry, the retry’s round not watched for a sentence of its own', async () => {
    const short = '{"speak":"Both hold.","display":"Both hold.","asked_items":[{"item":"price","standing":"stated","statement":"$39"}]}'
    const full =
      '{"speak":"Both hold, again.","display":"Both hold.","asked_items":[{"item":"price","standing":"stated","statement":"$39"},{"item":"size","standing":"stated","statement":"M"}]}'
    const run = start([
      async () => ({
        kind: 'tool_calls',
        calls: [
          { id: 'p1', name: 'report_run_plan', args: { objective: 'Find it', headline: 'Finding', effort_tier: 'lookup', asked_items: ['price', 'size'] } },
          { id: 'r1', name: 'read_page', args: {} },
        ],
      }),
      async (request) => {
        text(request, short)
        return answer(short)
      },
      async (request) => {
        text(request, full)
        return answer(full)
      },
    ])
    await run.finished

    expect(run.requests[2]?.answerRetry).toBeDefined()
    expect(run.spoken()).toEqual(['Both hold.'])
    expect(run.tts.spoken).toEqual(['Both hold.'])
    expect(run.records('early_sentence')).toMatchObject([{ round: 2, ended: 'answer' }])
  })

  // The owner's ruling of 2026-10-05: the user is never told about the
  // application's limits. A sentence spoken before its round was cut
  // stands, and whatever Answer Finalization then lands is not spoken.
  it('lets the sentence stand when a deadline cut the round it was spoken in: the reserved Answer gives the Card and is not spoken', async () => {
    const run = start(
      [
        async (request) => {
          text(request, '{"speak":"Early.","display":"# Ea')
          return abortable(request)
        },
        async () => answer('{"speak":"Final.","display":"The final Card."}'),
        async () => answer('{"speak":"Final.","display":"The final Card."}'),
      ],
      { activeWorkDeadlineMs: 1_000 },
    )

    await until(() => run.spoken().length > 0, 'the early sentence')
    run.clock.advance(1_000)
    await run.finished

    expect(run.spoken()).toEqual(['Early.'])
    expect(run.tts.spoken).toEqual(['Early.'])
    expect(run.events.filter((event) => event.type === 'display')).toEqual([expect.objectContaining({ text: 'The final Card.', finalAnswer: true })])
    // The cut entered Finalization: no Tier Escalation follows a cut round.
    expect(run.events.at(-1)).toMatchObject({ type: 'done', finalizationCause: 'deadline_reached' })
    expect(run.records('early_sentence')).toMatchObject([{ round: 1, ended: 'no_turn', untilRoundEndMs: 1_000 }])
    expect(run.records('stood_sentence')).toEqual([{ turnId: 'turn-early', kind: 'stood_sentence', publishedAt: 0, card: 'answer' }])
    expect(run.records('second_utterance')).toEqual([])
  })

  it('shows the Card the cut round had closed when no model round writes another, and does not speak the deterministic Answer', async () => {
    const failing = async (): Promise<AssistantTurn> => {
      throw new Error('provider down')
    }
    const run = start(
      [
        async (request) => {
          text(request, '{"speak":"Early.","display":"# The early Card.","run_note":"half a no')
          return abortable(request)
        },
        failing,
        failing,
      ],
      { activeWorkDeadlineMs: 1_000 },
    )

    await until(() => run.spoken().length > 0, 'the early sentence')
    run.clock.advance(1_000)
    await run.finished

    expect(run.spoken()).toEqual(['Early.'])
    expect(run.tts.spoken).toEqual(['Early.'])
    const cards = run.events.filter((event) => event.type === 'display')
    expect(cards).toEqual([expect.objectContaining({ text: '# The early Card.', finalAnswer: true })])
    // A Card a model round wrote is not marked as the deterministic Answer.
    expect(cards[0]).not.toHaveProperty('deterministicAnswer')
    expect(run.events.at(-1)).toMatchObject({ type: 'done', finalizationCause: 'deadline_reached' })
    expect(run.records('stood_sentence')).toMatchObject([{ card: 'cut_round' }])
    expect(run.records('second_utterance')).toEqual([])
  })

  it('shows the deterministic Card, unspoken, when the cut round had not closed its own', async () => {
    const failing = async (): Promise<AssistantTurn> => {
      throw new Error('provider down')
    }
    const run = start(
      [
        async (request) => {
          text(request, '{"speak":"Early.","display":"# Ea')
          return abortable(request)
        },
        failing,
        failing,
      ],
      { activeWorkDeadlineMs: 1_000 },
    )

    await until(() => run.spoken().length > 0, 'the early sentence')
    run.clock.advance(1_000)
    await run.finished

    expect(run.spoken()).toEqual(['Early.'])
    expect(run.tts.spoken).toEqual(['Early.'])
    expect(run.events.filter((event) => event.type === 'display')).toEqual([
      expect.objectContaining({ deterministicAnswer: true, finalAnswer: true }),
    ])
    expect(run.records('stood_sentence')).toMatchObject([{ card: 'deterministic' }])
    expect(run.records('second_utterance')).toEqual([])
  })

  it('speaks the final Answer as a second utterance when the round the sentence was spoken in called tools', async () => {
    const run = start([
      async (request) => {
        text(request, '{"speak":"Early.","display":"x"}')
        return { kind: 'tool_calls', calls: [{ id: 'r1', name: 'read_page', args: {} }] }
      },
      async () => answer('{"speak":"Final.","display":"The final Card."}'),
    ])
    await run.finished

    expect(run.spoken()).toEqual(['Early.', 'Final.'])
    expect(run.records('early_sentence')).toMatchObject([{ round: 1, ended: 'tool_calls' }])
    expect(run.records('second_utterance')).toEqual([{ turnId: 'turn-early', kind: 'second_utterance', deterministic: false }])
  })

  it('lets a sentence spoken in an attempt the client then retried stand: the retry’s Answer gives the Card and is not spoken (#271)', async () => {
    const run = start([
      async (request) => {
        text(request, '{"speak":"Early.","display":"# Ea')
        request.onRetryAttempt?.(2, 3, 'transport')
        text(request, '{"speak":"Retried.","display":"The retried Card."}')
        return answer('{"speak":"Retried.","display":"The retried Card."}')
      },
    ])
    await run.finished

    expect(run.spoken()).toEqual(['Early.'])
    expect(run.events.find((event) => event.type === 'display')).toMatchObject({ text: 'The retried Card.' })
    expect(run.records('early_sentence')).toMatchObject([{ round: 1, ended: 'no_turn' }])
    expect(run.records('stood_sentence')).toMatchObject([{ card: 'answer' }])
    expect(run.records('second_utterance')).toEqual([])
  })

  it('never speaks early in a list-only retry round (#311): a whole Answer written there is read for its list alone', async () => {
    const short = '{"speak":"Both hold.","display":"Both hold.","asked_items":[{"item":"price","standing":"stated","statement":"$39"}]}'
    const full =
      '{"speak":"Both hold, again.","display":"Rewritten.","asked_items":[{"item":"price","standing":"stated","statement":"$39"},{"item":"size","standing":"stated","statement":"M"}]}'
    const run = start([
      async () => ({
        kind: 'tool_calls',
        calls: [
          { id: 'p1', name: 'report_run_plan', args: { objective: 'Find it', headline: 'Finding', effort_tier: 'lookup', asked_items: ['price', 'size'] } },
          { id: 'r1', name: 'read_page', args: {} },
        ],
      }),
      // The first Answer streams nothing, so the Run holds no sentence when
      // the retry's reply streams a whole Answer of its own.
      async () => answer(short),
      async (request) => {
        text(request, full)
        return answer(full)
      },
    ])
    await run.finished

    expect(run.requests[2]?.answerRetry).toBeDefined()
    expect(run.spoken()).toEqual(['Both hold.'])
    expect(run.tts.spoken).toEqual(['Both hold.'])
    expect(run.events.find((event) => event.type === 'display')).toMatchObject({ text: 'Both hold.' })
    expect(run.records('early_sentence')).toEqual([])
  })

  it('reports a failed playback of a sentence spoken for no Answer, as a spoken line’s is', async () => {
    const run = start(
      [
        async (request) => {
          text(request, '{"speak":"Early.","display":"x"}')
          return { kind: 'tool_calls', calls: [{ id: 'r1', name: 'read_page', args: {} }] }
        },
        async () => answer('{"speak":"Final.","display":"The final Card."}'),
      ],
      { failingTts: true },
    )
    await run.finished

    expect(run.events.filter((event) => event.type === 'error')).toHaveLength(2)
    expect(run.events.at(-1)).toMatchObject({ type: 'done', outcome: 'done' })
  })

  it('does not speak early a sentence that fails the Off-language check (#286): the round is handled as before', async () => {
    const chinese = '{"speak":"旅行者一号于2012年进入星际空间。","display":"旅行者一号于2012年进入星际空间。"}'
    const run = start([
      async (request) => {
        text(request, chinese)
        return answer(chinese)
      },
      async () => answer('{"speak":"Voyager 1 is in interstellar space.","display":"Voyager 1 crossed in 2012."}'),
    ])
    await run.finished

    expect(run.spoken()).toEqual(['Voyager 1 is in interstellar space.'])
    expect(run.records('early_sentence')).toEqual([])
  })

  it('voices the sentence with its Identity Slips deleted, and records the slip once, at the Answer (#246)', async () => {
    const reply = '{"speak":"It costs $39 (memory-3).","display":"It costs $39."}'
    const run = start([
      async (request) => {
        text(request, reply)
        return answer(reply)
      },
    ])
    await run.finished

    expect(run.spoken()).toEqual(['It costs $39.'])
    expect(run.records('identity_slip')).toHaveLength(1)
  })
})
