import { describe, expect, it } from 'vitest'

import type { DecisionSeam } from '../agent/modelRouting'
import type { ConfiguredDecisionModel, DecisionModel, DecisionQuestions, DecisionResult } from '../ports/decisionModel'
import type { AssistantTurn, LlmClient, LlmRequest } from '../ports/llm'
import { FakeClock, RecordingTts } from '../testing/doubles'
import { setFaultSink, type FaultReport } from '../trace/fault'
import type { RunTraceEvent } from '../trace/runTrace'
import { createCommandPipeline } from './createCommandPipeline'
import { TIER_SHADOW_QUESTIONS, tierShadowState } from './tierShadow'

const ANSWER: AssistantTurn = { kind: 'answer', speak: 'Done.', display: 'Done.', resolution: 'completed' }

const ANSWERED = {
  pick: { type: 'choice', choice: 'lookup', confidence: 0.9, probabilities: { direct_action: 0.05, lookup: 0.9, investigation: 0.05 } },
  garbled: { type: 'noul', noul: 0.1 },
} as const

type Arm = 'on' | 'off' | 'unconfigured' | 'untraced'

/**
 * One Run of one on-contract round, with the Decision Model in the arm the
 * test names: `on` has the tier seam listed, `off` lists every other seam,
 * `unconfigured` has no role at all, `untraced` is on but writes no trace.
 */
async function run(arm: Arm, answer: () => DecisionResult<DecisionQuestions> = () => ({ status: 'answered', answers: ANSWERED, latencyMs: 90, model: 'jev-1.13.0' })) {
  const order: string[] = []
  const requests: string[] = []
  const asks: { state: string; questions: DecisionQuestions }[] = []
  const llm: LlmClient = {
    async complete(request: LlmRequest) {
      order.push('llm')
      // Everything the round sends, as sent: the signal is a live object, not part of the request's bytes.
      requests.push(JSON.stringify(request, (key, value: unknown) => (key === 'signal' ? undefined : value)))
      return ANSWER
    },
  }
  const model: DecisionModel = {
    model: 'jev-1.13.0',
    async ask(request) {
      order.push('decision')
      asks.push({ state: request.state, questions: request.questions })
      return answer() as never
    },
  }
  const seams: ReadonlySet<DecisionSeam> = new Set(arm === 'off' ? ['passage', 'result'] : ['passage', 'result', 'tier'])
  const configured: ConfiguredDecisionModel = { model, seams }
  const pipeline = createCommandPipeline({
    llm,
    tts: new RecordingTts(),
    clock: new FakeClock(),
    tools: [],
    ...(arm === 'unconfigured' ? { decision: () => null } : { decision: () => configured }),
  })
  const traced: RunTraceEvent[] = []
  const events: unknown[] = []
  for await (const event of pipeline.execute('what time is it in tokyo', 'turn-1', false, {
    snapshot: [],
    memory: [],
    commit: () => 'committed',
    ...(arm === 'untraced' ? {} : { traceRun: (build: () => RunTraceEvent) => traced.push(build()) }),
  })) {
    events.push(event)
  }
  // The shadow's record lands when its answer does, never holding the Run.
  await Promise.resolve()
  return { events, order, requests, asks, decisions: traced.filter((record) => record.kind === 'decision') }
}

describe('the tier shadow (#278, ADR 0068)', () => {
  it('asks the tier and garble questions over the command before the first orchestrator call when the tier seam is on', async () => {
    const { order, asks } = await run('on')
    expect(order.slice(0, 2)).toEqual(['decision', 'llm'])
    expect(asks).toEqual([{ state: tierShadowState('what time is it in tokyo'), questions: TIER_SHADOW_QUESTIONS }])
    expect(asks[0]!.state).toBe('Command: what time is it in tokyo')
  })

  it('records the answer as a shadow Decision Record for round 1', async () => {
    const { decisions } = await run('on')
    expect(decisions).toEqual([
      {
        turnId: 'turn-1',
        kind: 'decision',
        seam: 'tier',
        round: 1,
        questions: ['pick', 'garbled'],
        answers: ANSWERED,
        latencyMs: 90,
        threshold: { choice: 0.7, noul: 0.7 },
        acted: 'shadow',
        model: 'jev-1.13.0',
        stateChars: 'Command: what time is it in tokyo'.length,
      },
    ])
  })

  it('records an unavailable Decision Model as unavailable, and the Run goes on', async () => {
    const { decisions, order } = await run('on', () => ({ status: 'unavailable', reason: 'timeout', message: 'no answer in 800 ms', latencyMs: 800, model: 'jev-1.13.0' }))
    expect(order).toContain('llm')
    expect(decisions).toMatchObject([{ seam: 'tier', acted: 'unavailable', unavailable: { reason: 'timeout' } }])
    expect(decisions[0]).not.toHaveProperty('answers')
  })

  it('reports a port that rejected as a fault, never an unhandled rejection, and records nothing', async () => {
    const faults: FaultReport[] = []
    setFaultSink((report) => faults.push(report))
    try {
      const { decisions, order } = await run('on', () => {
        throw new Error('the port broke its promise')
      })
      await Promise.resolve()
      expect(order).toContain('llm')
      expect(decisions).toEqual([])
      expect(faults.map((fault) => fault.site)).toEqual(['pipeline.tierShadow.ask'])
    } finally {
      setFaultSink(null)
    }
  })

  it.each(['off', 'unconfigured', 'untraced'] as const)('never asks when %s', async (arm) => {
    const { asks, decisions } = await run(arm)
    expect(asks).toEqual([])
    expect(decisions).toEqual([])
  })

  it('leaves the round’s request to the model byte-identical, on or off', async () => {
    const on = await run('on')
    for (const arm of ['off', 'unconfigured', 'untraced'] as const) {
      expect((await run(arm)).requests).toEqual(on.requests)
    }
    expect(on.requests).toHaveLength(1)
  })
})
