import { describe, expect, it } from 'vitest'
import { DEFAULT_CARD_BUDGET_TOKENS, cardBudgetChars, cardBudgetTokens, cardChars, promptChars, sizeRefusalOf, tighterBudget } from './cardBudget'

describe('the Card Budget (ADR 0088)', () => {
  it('builds the smallest host\'s 16,384 tokens to 38,993 characters: under the 2.48 a token Baseten counted on a refused GitHub card (#407)', () => {
    // uptime-kuma's README at a hop past the first: 42,468 characters the host counted as 17,151 tokens and refused.
    expect(cardBudgetChars(DEFAULT_CARD_BUDGET_TOKENS)).toBe(38_993)
    expect(cardBudgetChars(DEFAULT_CARD_BUDGET_TOKENS)).toBeLessThan(16_384 * (42_468 / 17_151))
  })

  it('weighs a long opaque run at its own measured ratio, text at its length (#495)', () => {
    expect(cardChars('a line of plain words')).toBe(21)
    // 1,500 characters of a redirect's query: what Baseten counted at 1.39 a token, read at 1.33 against the text's 2.38.
    const run = 'x'.repeat(1500)
    expect(cardChars(run)).toBe(Math.ceil(1500 * (2.38 / 1.33)))
    expect(promptChars(`Refs: ${run}`, { action: { type: 'choice', instructions: 'Which?', options: { 'click-1': `link "Hotels" ${run}` } } })).toBeGreaterThan(2 * 2600)
  })

  it("reads a host's size refusal from its own words, and no other refusal (#495)", () => {
    expect(sizeRefusalOf(422, 'OneJev prompt has 21990 tokens, exceeding max_len 16384; prompts are never truncated')).toEqual({ tokens: 21990, maxLen: 16384 })
    expect(sizeRefusalOf(422, 'invalid schema')).toBeNull()
    expect(sizeRefusalOf(429, 'OneJev prompt has 21990 tokens, exceeding max_len 16384')).toBeNull()
  })

  it("builds the one retry to the host's limit in the characters its own count gave, less a tenth (#495)", () => {
    // The grown case's refused prompt: 38,982 characters the host counted as 21,990 tokens.
    expect(tighterBudget(38_982, { tokens: 21_990, maxLen: 16_384 })).toBe(Math.floor(((16_384 * 38_982) / 21_990) * 0.9))
    expect(tighterBudget(38_982, { tokens: 21_990, maxLen: 16_384 })).toBeLessThan(38_982 * (16_384 / 21_990))
  })

  it('reads the budget the env sets, the default when it is unset or no whole number above 0', () => {
    expect(cardBudgetTokens({})).toBe(16_384)
    expect(cardBudgetTokens({ BINGBONG_DECISION_PROMPT_TOKENS: '8000' })).toBe(8000)
    expect(cardBudgetTokens({ BINGBONG_DECISION_PROMPT_TOKENS: '0' })).toBe(16_384)
    expect(cardBudgetTokens({ BINGBONG_DECISION_PROMPT_TOKENS: 'lots' })).toBe(16_384)
  })
})
