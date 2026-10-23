import { describe, expect, it } from 'vitest'
import { DEFAULT_CARD_BUDGET_TOKENS, cardBudgetChars, cardBudgetTokens } from './cardBudget'

describe('the Card Budget (ADR 0088)', () => {
  it('builds the smallest host\'s 16,384 tokens to 38,993 characters: under the 2.48 a token Baseten counted on a refused GitHub card (#407)', () => {
    // uptime-kuma's README at a hop past the first: 42,468 characters the host counted as 17,151 tokens and refused.
    expect(cardBudgetChars(DEFAULT_CARD_BUDGET_TOKENS)).toBe(38_993)
    expect(cardBudgetChars(DEFAULT_CARD_BUDGET_TOKENS)).toBeLessThan(16_384 * (42_468 / 17_151))
  })

  it('reads the budget the env sets, the default when it is unset or no whole number above 0', () => {
    expect(cardBudgetTokens({})).toBe(16_384)
    expect(cardBudgetTokens({ BINGBONG_DECISION_PROMPT_TOKENS: '8000' })).toBe(8000)
    expect(cardBudgetTokens({ BINGBONG_DECISION_PROMPT_TOKENS: '0' })).toBe(16_384)
    expect(cardBudgetTokens({ BINGBONG_DECISION_PROMPT_TOKENS: 'lots' })).toBe(16_384)
  })
})
