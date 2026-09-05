import { describe, expect, it } from 'vitest'
import {
  createReasoningRounds,
  reasoningEvent,
  reasoningTraceEnabled,
  TRACE_REASONING_ENV,
} from './reasoningTrace'
import { TRACE_REASONING_MAX_CHARS } from './runTrace'

// The reasoning records (#182): the opt-in, the per-round assembly, and
// the cut. The Run's end of it — one record per round, with the turn and
// the Run identity — is proved against the real file in
// src/main/trace/runTraceFile.test.ts.

describe('the reasoning trace opt-in', () => {
  it('is off unless the developer set the flag', () => {
    expect(reasoningTraceEnabled({})).toBe(false)
    expect(reasoningTraceEnabled({ [TRACE_REASONING_ENV]: '' })).toBe(false)
    expect(reasoningTraceEnabled({ [TRACE_REASONING_ENV]: '0' })).toBe(false)
    expect(reasoningTraceEnabled({ [TRACE_REASONING_ENV]: 'off' })).toBe(false)
    // A near-miss is not an opt-in: this must never turn on by accident.
    expect(reasoningTraceEnabled({ [TRACE_REASONING_ENV]: 'please' })).toBe(false)
  })

  it('follows the shared BINGBONG_* truthy vocabulary', () => {
    for (const value of ['1', 'true', 'yes', 'on', ' ON ', 'True']) {
      expect(reasoningTraceEnabled({ [TRACE_REASONING_ENV]: value })).toBe(true)
    }
  })
})

describe("assembling a round's reasoning", () => {
  it("joins the round's deltas and starts the next round empty", () => {
    const rounds = createReasoningRounds()
    rounds.onDelta({ kind: 'reasoning', text: 'first I ' })
    rounds.onDelta({ kind: 'reasoning', text: 'check the price' })
    expect(rounds.takeRound()).toEqual({ round: 1, attempt: 1, text: 'first I check the price' })

    rounds.onDelta({ kind: 'reasoning', text: 'now the excerpt' })
    expect(rounds.takeRound()).toEqual({ round: 2, attempt: 1, text: 'now the excerpt' })
  })

  it('ignores every delta that is not reasoning', () => {
    const rounds = createReasoningRounds()
    rounds.onDelta({ kind: 'text', text: '{"speak":' })
    rounds.onDelta({ kind: 'tool_intent', index: 0, name: 'read_page', args: '{}' })
    rounds.onDelta({ kind: 'reasoning', text: 'thinking' })
    expect(rounds.takeRound()).toEqual({ round: 1, attempt: 1, text: 'thinking' })
  })

  it('closes an abandoned attempt without closing its round', () => {
    const rounds = createReasoningRounds()
    rounds.onDelta({ kind: 'reasoning', text: 'the provider hung up' })
    // The client is retrying: the abandoned thinking closes on its own.
    expect(rounds.takeAttempt()).toEqual({ round: 1, attempt: 1, text: 'the provider hung up' })
    rounds.onDelta({ kind: 'reasoning', text: 'second time lucky' })
    expect(rounds.takeRound()).toEqual({ round: 1, attempt: 2, text: 'second time lucky' })
    // The next round starts over at its own first attempt.
    rounds.onDelta({ kind: 'reasoning', text: 'on to the answer' })
    expect(rounds.takeRound()).toEqual({ round: 2, attempt: 1, text: 'on to the answer' })
  })

  it('closes a round that thought nothing, so the round numbering stays true', () => {
    const rounds = createReasoningRounds()
    expect(rounds.takeRound()).toEqual({ round: 1, attempt: 1, text: '' })
    rounds.onDelta({ kind: 'reasoning', text: 'now I think' })
    expect(rounds.takeRound()).toEqual({ round: 2, attempt: 1, text: 'now I think' })
  })
})

describe('the reasoning record', () => {
  it('carries the round and the text', () => {
    expect(reasoningEvent({ round: 3, attempt: 1, text: 'the router page did not load' })).toEqual({
      kind: 'reasoning',
      round: 3,
      attempt: 1,
      text: 'the router page did not load',
      chars: 'the router page did not load'.length,
    })
  })

  it('cuts at the cap and still says how much thinking it stands for', () => {
    const long = 'x'.repeat(TRACE_REASONING_MAX_CHARS + 500)
    const event = reasoningEvent({ round: 1, attempt: 1, text: long })
    expect(event.text.length).toBe(TRACE_REASONING_MAX_CHARS)
    expect(event.text).toBe(long.slice(0, TRACE_REASONING_MAX_CHARS))
    expect(event.chars).toBe(TRACE_REASONING_MAX_CHARS + 500)
  })

  it('leaves anything at or under the cap whole', () => {
    const exact = 'y'.repeat(TRACE_REASONING_MAX_CHARS)
    expect(reasoningEvent({ round: 1, attempt: 1, text: exact }).text).toBe(exact)
  })
})
