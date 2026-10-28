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
 * the hosts counted on a refused prompt, less a margin (ADR 0088,
 * "Measured at build"). 2.70 at #406; live runs then saw link-heavy GitHub
 * cards refused at 2.48–2.56, uptime-kuma's README the least (#407).
 */
export const CARD_CHARS_PER_TOKEN = 2.38

/**
 * A long opaque run — a stretch of more than 300 characters with no
 * space: an ad's redirect address, a token in a query string — tokenizes
 * far worse than text (#495). Measured on the grown case (a DuckDuckGo
 * results page whose ten text ads carry 1.4–1.8k-character redirect
 * addresses): the same ask with every run of 80+ characters doubled added
 * 22,464 characters and 16,148 tokens on Baseten's own count (its 422
 * states it), 1.39 a token — 97 % of those characters in runs past 1,000.
 * The card counts each run at 1.33 — 1.39 less the 4 % margin the text
 * ratio keeps under its 2.48 — so a run weighs 2.38 / 1.33 of its length.
 * Shorter runs, a commit's address or a login's `return_to=`, are read at
 * the text ratio: the link-heavy GitHub cards that ratio was measured on
 * are full of them (#407), and 27 corpus cards the host took whole would
 * weigh over the budget at 1.33.
 */
export const OPAQUE_CHARS_PER_TOKEN = 1.33

/** The length past which a card shows an address cut (#495, `shownAddress`): past the corpus's 99th percentile, 289 of 12,568 addresses on 2026-10-28. */
export const ADDRESS_BOUND = 300

/** An opaque run: past the address bound, so on a card it is a run no address cut reached. */
const OPAQUE_RUN = new RegExp(`\\S{${ADDRESS_BOUND + 1},}`, 'g')

/** A text's size in the characters the budget is built in: its length, each opaque run weighed at its own ratio. */
export function cardChars(text: string): number {
  let opaque = 0
  for (const run of text.match(OPAQUE_RUN) ?? []) opaque += run.length
  return text.length + Math.ceil(opaque * (CARD_CHARS_PER_TOKEN / OPAQUE_CHARS_PER_TOKEN - 1))
}

/** The Card Budget the env sets, in tokens: the default when unset or not a whole number above 0. */
export function cardBudgetTokens(env: Record<string, string | undefined>): number {
  const raw = Number(env[CARD_BUDGET_ENV_KEY]?.trim())
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_CARD_BUDGET_TOKENS
}

/** A Card Budget in the characters the card is built to. */
export function cardBudgetChars(tokens: number): number {
  return Math.floor(tokens * CARD_CHARS_PER_TOKEN)
}

/** A question's size: its name, instructions and options, label and line — what the host reads, less the JSON around it; `size` reads each piece. */
function questionChars(name: string, question: DecisionQuestions[string], size: (text: string) => number = (text) => text.length): number {
  let chars = name.length + size(question.instructions)
  if (question.type === 'choice') for (const [label, line] of Object.entries(question.options)) chars += label.length + size(line ?? '')
  return chars
}

/** A whole ask's size: the state and every question — what a host's `input_tokens` counts. */
export function askChars(state: string, questions: DecisionQuestions): number {
  return Object.entries(questions).reduce((chars, [name, question]) => chars + questionChars(name, question), state.length)
}

/** An ask's size as the Card Budget reads it: the largest prompt the host builds of it, the state with one question, each opaque run weighed at its own ratio (#495). */
export function promptChars(state: string, questions: DecisionQuestions): number {
  return cardChars(state) + Math.max(0, ...Object.entries(questions).map(([name, question]) => questionChars(name, question, cardChars)))
}

/** What a card gave up to fit the Card Budget (#495): its kind and how many, and for addresses the characters cut. Named in the ask's record. */
export interface CardCut {
  /** `address`: addresses past the bound shown cut; `further`: options further down left off; `ref`: refs left off from the page's end; `popup-text`: the pop-up's own text left off. */
  readonly kind: 'address' | 'further' | 'ref' | 'popup-text'
  readonly count: number
  readonly chars?: number
}

/** A host's refusal of an ask for its size (#495): the tokens it counted and its limit. */
export interface SizeRefusal {
  readonly tokens: number
  readonly maxLen: number
}

/** The size refusal a host's 422 states in its own words — Baseten's reads "prompt has 21990 tokens, exceeding max_len 16384" — or null for any other refusal. */
export function sizeRefusalOf(httpStatus: number | undefined, message: string): SizeRefusal | null {
  if (httpStatus !== 422) return null
  const match = /has (\d+) tokens, exceeding max_len (\d+)/.exec(message)
  return match === null ? null : { tokens: Number(match[1]), maxLen: Number(match[2]) }
}

/**
 * The budget a refused ask is built to once more (#495): the host's own
 * limit, in the characters its own count gave this card — the refused
 * prompt's size over the tokens it counted — less a tenth, a margin
 * guessed (the count is not linear in what is cut), so the one retry
 * lands under the limit.
 */
export function tighterBudget(refusedChars: number, refusal: SizeRefusal): number {
  return Math.floor(((refusal.maxLen * refusedChars) / refusal.tokens) * 0.9)
}
