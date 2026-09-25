import { describe, expect, it } from 'vitest'
import { LlmEmptyCompletionError, LlmRequestTimeoutError, LlmTransportError } from '../ports/llm'
import { createLlmRounds, llmRequestShape, llmRoundEvent, llmRoundFailure } from './llmRoundTrace'
import { createReasoningRounds } from './reasoningTrace'

describe('the llm_round collector (#191)', () => {
  it('numbers attempts exactly as the reasoning collector does across a retried round', () => {
    const rounds = createLlmRounds()
    const reasoning = createReasoningRounds()
    const numbering = (closed: { round: number; attempt: number }) => [closed.round, closed.attempt]

    // Round 1: the first attempt is abandoned by a retry, the second returns.
    expect(numbering(rounds.takeAttempt('empty'))).toEqual(numbering(reasoning.takeAttempt()))
    expect(numbering(rounds.takeRound('completed'))).toEqual(numbering(reasoning.takeRound()))
    // Round 2: a single attempt.
    expect(numbering(rounds.takeRound('completed'))).toEqual(numbering(reasoning.takeRound()))

    expect(numbering(rounds.takeAttempt('empty'))).toEqual([3, 1])
    expect(numbering(rounds.takeAttempt('empty'))).toEqual([3, 2])
    expect(numbering(rounds.takeRound('completed'))).toEqual([3, 3])
    expect(numbering(rounds.takeRound('completed'))).toEqual([4, 1])
  })

  it('carries what the client reported for the attempt, and drops it once taken', () => {
    const rounds = createLlmRounds()
    rounds.onAttempt({ model: 'glm-5.3', promptHash: 'abc', reasoningEffort: 'high' })

    // An abandoned attempt is one the client retried, which it does only
    // for an empty completion.
    const first = rounds.takeAttempt('empty')
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
    expect(rounds.takeAttempt('empty')).toMatchObject({ round: 2, attempt: 1, outcome: 'empty', reasoningChars: 5 })
    expect(rounds.takeRound('timeout')).toMatchObject({ round: 2, attempt: 2, outcome: 'timeout', reasoningChars: 0 })
  })
})

describe('the first token (#256, ADR 0057)', () => {
  it('measures it from the reported dispatch, per attempt, given a clock', () => {
    let now = 1_000
    const rounds = createLlmRounds({ now: () => now })
    rounds.onAttempt({ model: 'glm-5.3' })
    now = 4_200
    rounds.onDelta({ kind: 'tool_intent', index: 0, name: 'record_evidence', args: '{' })
    now = 6_000
    rounds.onDelta({ kind: 'reasoning', text: 'later' })
    // Any fragment is the first; a later one does not move it.
    expect(rounds.takeRound('completed')).toMatchObject({ round: 1, attempt: 1, firstTokenMs: 3_200 })

    // An attempt that ended before anything streamed carries none, and the
    // retry waits again from its own dispatch.
    rounds.onAttempt({ model: 'glm-5.3' })
    expect(rounds.takeAttempt('empty')).not.toHaveProperty('firstTokenMs')
    now = 10_000
    rounds.onAttempt({ model: 'glm-5.3' })
    now = 10_500
    rounds.onDelta({ kind: 'text', text: '{' })
    expect(rounds.takeRound('allowance')).toMatchObject({ round: 2, attempt: 2, firstTokenMs: 500 })
  })

  it('measures nothing without a clock, or without a reported dispatch', () => {
    const unclocked = createLlmRounds()
    unclocked.onAttempt({ model: 'glm-5.3' })
    unclocked.onDelta({ kind: 'text', text: 'x' })
    expect(unclocked.takeRound('completed')).not.toHaveProperty('firstTokenMs')

    const unreported = createLlmRounds({ now: () => 5 })
    unreported.onDelta({ kind: 'text', text: 'x' })
    expect(unreported.takeRound('completed')).not.toHaveProperty('firstTokenMs')
  })

  it('reaches the record, and is absent from one that streamed nothing', () => {
    const base = { round: 1, attempt: 1, role: 'orchestrator' as const, reasoningChars: 291, request: { toolResults: 20, chars: 90_000 } }
    expect(llmRoundEvent({ ...base, outcome: 'allowance', firstTokenMs: 8_120 })).toMatchObject({ outcome: 'allowance', firstTokenMs: 8_120 })
    expect(llmRoundEvent({ ...base, outcome: 'allowance' })).not.toHaveProperty('firstTokenMs')
  })
})

describe('what a thrown round is recorded as (#218)', () => {
  it('names the client timeout and the empty completion by their classes, and anything else as failed', () => {
    expect(llmRoundFailure(new LlmRequestTimeoutError(120_000))).toBe('timeout')
    expect(llmRoundFailure(new LlmEmptyCompletionError('orchestrator returned an empty completion'))).toBe('empty')
    expect(llmRoundFailure(new Error('orchestrator request failed (HTTP 502)'))).toBe('failed')
    expect(llmRoundFailure('not even an error')).toBe('failed')
  })

  it('names a Transport Failure by its class (#271)', () => {
    expect(llmRoundFailure(new LlmTransportError(2, { cause: transportRejection('ECONNRESET') }))).toBe('transport')
  })
})

/** A fetch rejection the way undici raises one: the code rides the cause. */
function transportRejection(code: string): Error {
  return new TypeError('fetch failed', { cause: Object.assign(new Error(`read ${code}`), { code }) })
}

describe('a Transport Retry on the record (#271)', () => {
  it('closes the abandoned attempt as transport with its failure, and numbers the surviving attempt next', () => {
    const rounds = createLlmRounds()
    rounds.onAttempt({ model: 'glm-5.3' })
    const abandoned = rounds.takeAttempt('transport', transportRejection('ECONNRESET'))
    rounds.onAttempt({ model: 'glm-5.3' })
    const survivor = rounds.takeRound('completed', { promptTokens: 10, completionTokens: 2 })

    expect(abandoned).toMatchObject({ round: 1, attempt: 1, outcome: 'transport', failure: { message: 'fetch failed', code: 'ECONNRESET' } })
    expect(survivor).toMatchObject({ round: 1, attempt: 2, outcome: 'completed' })
    expect(survivor).not.toHaveProperty('failure')
  })

  it('carries failure on transport, timeout and failed outcomes, and never on completed', () => {
    const rounds = createLlmRounds()
    expect(rounds.takeRound('transport', undefined, new LlmTransportError(2, { cause: transportRejection('UND_ERR_CONNECT_TIMEOUT') })).failure).toEqual({
      message: expect.stringContaining('fetch failed') as string,
      code: 'UND_ERR_CONNECT_TIMEOUT',
    })
    expect(rounds.takeRound('timeout', undefined, new LlmRequestTimeoutError(120_000)).failure).toEqual({
      message: 'orchestrator request timed out after 120000 ms',
    })
    expect(rounds.takeRound('failed', undefined, new Error('orchestrator request failed (HTTP 502)')).failure).toEqual({
      message: 'orchestrator request failed (HTTP 502)',
    })
    expect(rounds.takeRound('completed', undefined, new Error('ignored'))).not.toHaveProperty('failure')
    expect(rounds.takeRound('deadline', undefined, new Error('aborted'))).not.toHaveProperty('failure')
  })

  it('writes the failure onto the llm_round record', () => {
    const event = llmRoundEvent({
      round: 1,
      attempt: 1,
      role: 'orchestrator',
      outcome: 'transport',
      reasoningChars: 0,
      failure: { message: 'fetch failed', code: 'ECONNRESET' },
      request: { toolResults: 0, chars: 10 },
    })
    expect(event).toMatchObject({ outcome: 'transport', failure: { message: 'fetch failed', code: 'ECONNRESET' } })
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

describe('the request shape of an Answer Retry (#245)', () => {
  it('counts the Malformed Answer and the retry message as content', () => {
    const bare = llmRequestShape({ command: 'find the fare', toolResults: [] })
    const retried = llmRequestShape({
      command: 'find the fare',
      toolResults: [],
      answerRetry: { reply: 'x'.repeat(100), message: 'y'.repeat(50) },
    })

    expect(retried.toolResults).toBe(0)
    expect(retried.chars - bare.chars).toBeGreaterThanOrEqual(150)
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
