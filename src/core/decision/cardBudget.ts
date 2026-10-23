// The Card Budget (ADR 0088, #406): the size, in the host's own tokens,
// that every ask of the Decision Model is built to. One number for every
// model — the smallest host the gate asks — set in one place, so the card
// Jev gets is the card the gate measured. A host reads an ask one question
// at a time, each over the whole state (Jev's limits are per request and
// per question; Baseten answered asks it counted at 17,615 input tokens
// and refused one whose prompt was 16,645), so the budget bounds the
// largest of those prompts. The card is built in characters, at a ratio
// measured from the hosts' own counts, with margin: each host's tokenizer
// is its own and Jev's is not published.

import type { DecisionQuestions } from '../ports/decisionModel'

/** The env var that sets the Card Budget, in the host's tokens. */
export const CARD_BUDGET_ENV_KEY = 'BINGBONG_DECISION_PROMPT_TOKENS'

/** Baseten's `max_len` for Mammoth and Elephant (#406): the smallest host the gate asks. */
export const DEFAULT_CARD_BUDGET_TOKENS = 16_384

/**
 * The characters a card is built to per token of the budget: the least
 * the hosts counted on a refused prompt (2.70, a link-heavy GitHub card),
 * less a margin (ADR 0088, "Measured at build").
 */
export const CARD_CHARS_PER_TOKEN = 2.6

/** The Card Budget the env sets, in tokens: the default when unset or not a whole number above 0. */
export function cardBudgetTokens(env: Record<string, string | undefined>): number {
  const raw = Number(env[CARD_BUDGET_ENV_KEY]?.trim())
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_CARD_BUDGET_TOKENS
}

/** A Card Budget in the characters the card is built to. */
export function cardBudgetChars(tokens: number): number {
  return Math.floor(tokens * CARD_CHARS_PER_TOKEN)
}

/** A question's size: its name, instructions and options, label and line — what the host reads, less the JSON around it. */
function questionChars(name: string, question: DecisionQuestions[string]): number {
  let chars = name.length + question.instructions.length
  if (question.type === 'choice') for (const [label, line] of Object.entries(question.options)) chars += label.length + (line?.length ?? 0)
  return chars
}

/** A whole ask's size: the state and every question — what a host's `input_tokens` counts. */
export function askChars(state: string, questions: DecisionQuestions): number {
  return Object.entries(questions).reduce((chars, [name, question]) => chars + questionChars(name, question), state.length)
}

/** An ask's size as the Card Budget reads it: the largest prompt the host builds of it, the state with one question. */
export function promptChars(state: string, questions: DecisionQuestions): number {
  return state.length + Math.max(0, ...Object.entries(questions).map(([name, question]) => questionChars(name, question)))
}
