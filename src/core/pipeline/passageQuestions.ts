// The Selected Passage's questions and state (#276, ADR 0069), apart from
// the seam so the Shadow Replay asks exactly what the seam asks, over
// exactly the state it asks it over (#281: a bar holds for the question it
// was read from). No runtime import: the replay loads this under Node's
// type stripping.

import type { DecisionQuestion, DecisionQuestions } from '../ports/decisionModel.ts'

/** A Choice takes at most 255 options; a longer page is picked in two passes. */
export const MAX_PASSAGE_OPTIONS = 255
/** The whole state, well inside the Decision Model's 32k-token window. */
const STATE_MAX_CHARS = 60_000
/** One block in a block pass's state: a Choice points, it never needs the whole paragraph. */
const BLOCK_STATE_MAX_CHARS = 1_200

/** `P001`…: wide enough for the page, never narrower than three digits. */
export function passageBlockIds(count: number): string[] {
  const width = Math.max(3, String(count).length)
  return Array.from({ length: count }, (_, index) => `P${String(index + 1).padStart(width, '0')}`)
}

function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

/** Id-prefixed blocks, each cut so the whole state fits. */
export function passageState(ids: readonly string[], blocks: readonly string[]): string {
  const perBlock = Math.min(BLOCK_STATE_MAX_CHARS, Math.floor(STATE_MAX_CHARS / Math.max(1, blocks.length)))
  return blocks.map((block, index) => `${ids[index]}| ${cut(block, perBlock)}`).join('\n')
}

/**
 * One Choice per item, and — unless a window pass already asked it — one
 * Noul that some passage states it. Each names the Run's Objective (#281):
 * without it the right field of the wrong object reads as a pick.
 */
export function passageQuestions(
  objective: string,
  items: readonly string[],
  options: Record<string, string | null>,
  what: 'passage' | 'window',
  withNoul: boolean,
): DecisionQuestions {
  const questions: Record<string, DecisionQuestion> = {}
  const forObjective = `, for the objective "${objective}"`
  items.forEach((item, index) => {
    questions[`pick_${index + 1}`] = {
      type: 'choice',
      instructions:
        what === 'passage'
          ? `Which passage of the page states this asked item${forObjective}: ${item}`
          : `Which window of the page's passages holds the passage that states this asked item${forObjective}: ${item}`,
      options,
    }
    if (withNoul) {
      questions[`any_${index + 1}`] = { type: 'noul', instructions: `A passage of the page states this asked item${forObjective}: ${item}` }
    }
  })
  return questions
}
