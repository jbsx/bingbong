import { describe, expect, it } from 'vitest'
import { createLlmRounds, llmRequestShape, llmRoundEvent } from './llmRoundTrace'
import { createReasoningRounds } from './reasoningTrace'

describe('the llm_round collector (#191)', () => {
  it('numbers attempts exactly as the reasoning collector does across a retried round', () => {
    const rounds = createLlmRounds()
    const reasoning = createReasoningRounds()
    const numbering = (closed: { round: number; attempt: number }) => [closed.round, closed.attempt]

    // Round 1: the first attempt is abandoned by a retry, the second returns.
    expect(numbering(rounds.takeAttempt())).toEqual(numbering(reasoning.takeAttempt()))
    expect(numbering(rounds.takeRound())).toEqual(numbering(reasoning.takeRound()))
    // Round 2: a single attempt.
    expect(numbering(rounds.takeRound())).toEqual(numbering(reasoning.takeRound()))

    expect(numbering(rounds.takeAttempt())).toEqual([3, 1])
    expect(numbering(rounds.takeAttempt())).toEqual([3, 2])
    expect(numbering(rounds.takeRound())).toEqual([3, 3])
    expect(numbering(rounds.takeRound())).toEqual([4, 1])
  })

  it('carries what the client reported for the attempt, and drops it once taken', () => {
    const rounds = createLlmRounds()
    rounds.onAttempt({ model: 'glm-5.3', promptHash: 'abc', reasoningEffort: 'high' })

    const first = rounds.takeAttempt()
    expect(first).toEqual({ round: 1, attempt: 1, sent: { model: 'glm-5.3', promptHash: 'abc', reasoningEffort: 'high' } })

    // The retry never reported (the client threw before dispatch): no model.
    const second = rounds.takeRound({ promptTokens: 10, completionTokens: 2 })
    expect(second).toEqual({ round: 1, attempt: 2, usage: { promptTokens: 10, completionTokens: 2 } })
  })
})

describe('the request shape (#191)', () => {
  it('counts the tool-result pairs and the content characters, never the callbacks', () => {
    const shape = llmRequestShape({
      command: 'find the fare',
      toolResults: [
        { call: { id: 'c1', name: 'read_page', args: {} }, outcome: { ok: true, result: 'x'.repeat(100) } },
      ],
      standingDirective: 'the cheapest one',
    })
    const bare = llmRequestShape({ command: 'find the fare', toolResults: [] })

    expect(shape.toolResults).toBe(1)
    expect(shape.chars).toBeGreaterThan(bare.chars + 100)
    expect(bare.chars).toBe(JSON.stringify({ command: 'find the fare', toolResults: [] }).length)
  })
})

describe('the llm_round record (#191)', () => {
  it('names the model, prompt hash, rung, usage and shape, stamped with the worker when there is one', () => {
    expect(
      llmRoundEvent({
        round: 2,
        attempt: 1,
        role: 'subagent',
        sent: { model: 'deepseek-chat', promptHash: 'deadbeef' },
        usage: { promptTokens: 1_000, completionTokens: 50 },
        reasoningEffort: 'low',
        request: { toolResults: 3, chars: 4_500 },
        agentId: 'agent-1',
      }),
    ).toEqual({
      kind: 'llm_round',
      round: 2,
      attempt: 1,
      role: 'subagent',
      model: 'deepseek-chat',
      reasoningEffort: 'low',
      usage: { promptTokens: 1_000, completionTokens: 50 },
      promptHash: 'deadbeef',
      request: { toolResults: 3, chars: 4_500 },
      agentId: 'agent-1',
    })
  })

  it("prefers the rung the client actually sent over the request's, and omits what nobody reported", () => {
    expect(
      llmRoundEvent({
        round: 1,
        attempt: 1,
        role: 'orchestrator',
        sent: { model: 'glm-5.3', reasoningEffort: 'max' },
        reasoningEffort: 'high',
        request: { toolResults: 0, chars: 20 },
      }),
    ).toEqual({
      kind: 'llm_round',
      round: 1,
      attempt: 1,
      role: 'orchestrator',
      model: 'glm-5.3',
      reasoningEffort: 'max',
      request: { toolResults: 0, chars: 20 },
    })
    expect(llmRoundEvent({ round: 1, attempt: 1, role: 'orchestrator', request: { toolResults: 0, chars: 20 } })).toEqual({
      kind: 'llm_round',
      round: 1,
      attempt: 1,
      role: 'orchestrator',
      request: { toolResults: 0, chars: 20 },
    })
  })
})
