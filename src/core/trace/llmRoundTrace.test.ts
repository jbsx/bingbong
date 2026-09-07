import { describe, expect, it } from 'vitest'
import { LlmEmptyCompletionError, LlmRequestTimeoutError } from '../ports/llm'
import { createLlmRounds, llmRequestShape, llmRoundEvent, llmRoundFailure } from './llmRoundTrace'
import { createReasoningRounds } from './reasoningTrace'

describe('the llm_round collector (#191)', () => {
  it('numbers attempts exactly as the reasoning collector does across a retried round', () => {
    const rounds = createLlmRounds()
    const reasoning = createReasoningRounds()
    const numbering = (closed: { round: number; attempt: number }) => [closed.round, closed.attempt]

    // Round 1: the first attempt is abandoned by a retry, the second returns.
    expect(numbering(rounds.takeAttempt())).toEqual(numbering(reasoning.takeAttempt()))
    expect(numbering(rounds.takeRound('completed'))).toEqual(numbering(reasoning.takeRound()))
    // Round 2: a single attempt.
    expect(numbering(rounds.takeRound('completed'))).toEqual(numbering(reasoning.takeRound()))

    expect(numbering(rounds.takeAttempt())).toEqual([3, 1])
    expect(numbering(rounds.takeAttempt())).toEqual([3, 2])
    expect(numbering(rounds.takeRound('completed'))).toEqual([3, 3])
    expect(numbering(rounds.takeRound('completed'))).toEqual([4, 1])
  })

  it('carries what the client reported for the attempt, and drops it once taken', () => {
    const rounds = createLlmRounds()
    rounds.onAttempt({ model: 'glm-5.3', promptHash: 'abc', reasoningEffort: 'high' })

    // An abandoned attempt is one the client retried, which it does only
    // for an empty completion.
    const first = rounds.takeAttempt()
    expect(first).toEqual({
      round: 1,
      attempt: 1,
      outcome: 'empty',
      reasoningChars: 0,
      sent: { model: 'glm-5.3', promptHash: 'abc', reasoningEffort: 'high' },
    })

    // The retry never reported (the client threw before dispatch): no model.
    const second = rounds.takeRound('completed', { promptTokens: 10, completionTokens: 2 })
    expect(second).toEqual({ round: 1, attempt: 2, outcome: 'completed', reasoningChars: 0, usage: { promptTokens: 10, completionTokens: 2 } })
  })

  it('counts the reasoning each attempt streamed, and only the reasoning (#218)', () => {
    const rounds = createLlmRounds()
    rounds.onDelta({ kind: 'reasoning', text: 'let me think ' })
    rounds.onDelta({ kind: 'text', text: 'Here is the answer.' })
    rounds.onDelta({ kind: 'reasoning', text: 'about it' })

    // A round the deadline cut mid-thought: no usage, and the record says
    // how much thinking streamed before the cut, so it can never be read
    // as an empty completion.
    expect(rounds.takeRound('deadline')).toEqual({ round: 1, attempt: 1, outcome: 'deadline', reasoningChars: 21 })
    // The count starts over with the next attempt.
    rounds.onDelta({ kind: 'reasoning', text: 'again' })
    expect(rounds.takeAttempt()).toMatchObject({ round: 2, attempt: 1, outcome: 'empty', reasoningChars: 5 })
    expect(rounds.takeRound('timeout')).toMatchObject({ round: 2, attempt: 2, outcome: 'timeout', reasoningChars: 0 })
  })
})

describe('what a thrown round is recorded as (#218)', () => {
  it('names the client timeout and the empty completion by their classes, and anything else as failed', () => {
    expect(llmRoundFailure(new LlmRequestTimeoutError(120_000))).toBe('timeout')
    expect(llmRoundFailure(new LlmEmptyCompletionError('orchestrator returned an empty completion'))).toBe('empty')
    expect(llmRoundFailure(new Error('orchestrator request failed (HTTP 502)'))).toBe('failed')
    expect(llmRoundFailure('not even an error')).toBe('failed')
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
        outcome: 'completed',
        reasoningChars: 812,
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
      outcome: 'completed',
      reasoningChars: 812,
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
        outcome: 'deadline',
        reasoningChars: 40_000,
        sent: { model: 'glm-5.3', reasoningEffort: 'max' },
        reasoningEffort: 'high',
        request: { toolResults: 0, chars: 20 },
      }),
    ).toEqual({
      kind: 'llm_round',
      round: 1,
      attempt: 1,
      role: 'orchestrator',
      outcome: 'deadline',
      reasoningChars: 40_000,
      model: 'glm-5.3',
      reasoningEffort: 'max',
      request: { toolResults: 0, chars: 20 },
    })
    expect(
      llmRoundEvent({ round: 1, attempt: 1, role: 'orchestrator', outcome: 'failed', reasoningChars: 0, request: { toolResults: 0, chars: 20 } }),
    ).toEqual({
      kind: 'llm_round',
      round: 1,
      attempt: 1,
      role: 'orchestrator',
      outcome: 'failed',
      reasoningChars: 0,
      request: { toolResults: 0, chars: 20 },
    })
  })
})
