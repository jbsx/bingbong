// The Selected Passage (#276, ADR 0069): the first acting seam of the
// Decision Model (ADR 0068). On a navigate or click landing and on a Page
// Read, once the Run Plan declares an Asked Item this Run has not recorded a
// passage for, the Decision Model is asked which of the page's text blocks
// states it. A pick that clears both its Choice and its Noul is carried
// verbatim in the tool result the model reads — so the ledger holds it and
// ADR 0054's excerpt test grounds it unchanged — and the Run records it as an
// Evidence Checkpoint itself. Anything else leaves the result untouched.

import { parseSearchUrl } from '../browser/urlInput'
import type { ToolCall, ToolResultOutcome } from '../ports/llm'
import {
  clearsDecisionThresholds,
  type DecisionAnswers,
  type DecisionModel,
  type DecisionQuestion,
  type DecisionQuestions,
  type DecisionThresholds,
} from '../ports/decisionModel'
import { MAX_MEMORY_DETAIL_CHARS } from '../session/workingMemory'
import { decisionEvent } from '../trace/decisionTrace'
import type { DecisionEvent } from '../trace/runTrace'
import { reportFault } from '../trace/fault'
import type { RunPlan } from './runPlan'

/** The calls whose result is a landing or a Page Read: never a scroll, a Look or a typed field. */
const PASSAGE_TOOLS: ReadonlySet<string> = new Set(['navigate', 'click', 'read_page'])

/** A Choice takes at most 255 options; a longer page is picked in two passes. */
const MAX_OPTIONS = 255
/** The whole state, well inside the Decision Model's 32k-token window. */
const STATE_MAX_CHARS = 60_000
/** One block in a block pass's state: a Choice points, it never needs the whole paragraph. */
const BLOCK_STATE_MAX_CHARS = 1_200

export interface SelectedPassage {
  readonly item: string
  /** The block verbatim, as the page rendered it — what the excerpt is. */
  readonly passage: string
}

export interface SelectedPassageDeps {
  readonly model: DecisionModel
  readonly thresholds: DecisionThresholds
  /** The Run's open Asked Items now (`openAskedItems`): what a landing is asked about. */
  openItems(): readonly string[]
  /** The text blocks of the page the call settled on, in document order; null when it cannot be read. */
  pageTextBlocks(): Promise<readonly string[] | null>
  /** The LLM round the call came from, as `llm_round` numbers it. */
  round(): number
  writeDecision(event: DecisionEvent): void
  /** Records one pick as an Evidence Checkpoint made by the Run, closing its item when accepted; whether it was. */
  checkpoint(item: string, passage: string, sourceUrl: string): boolean
}

export interface SelectedPassageSeam {
  /** The picks for the page `call` settled on at `sourceUrl`; empty when nothing was asked or nothing cleared. Never throws. */
  select(call: ToolCall, sourceUrl: string | null): Promise<readonly SelectedPassage[]>
  /** Records each pick as a Run-made checkpoint; the items that were accepted. */
  record(picks: readonly SelectedPassage[], sourceUrl: string): readonly string[]
}

/**
 * The Run's open Asked Items (#276, ADR 0069), the one set both Decision
 * Model seams read — the Selected Passage and the Result Pick (ADR 0070):
 * none before the Run Plan is declared, none for a Direct Action (it declares
 * none), and none a Run-made checkpoint has already closed in this Run. A
 * checkpoint the model called names no Asked Item, so it closes none.
 */
export function openAskedItems(plan: RunPlan | null, closed: ReadonlySet<string>): readonly string[] {
  if (plan === null || plan.effortTier === 'direct_action') return []
  return plan.askedItems.filter((item) => !closed.has(item))
}

/** `P001`…: wide enough for the page, never narrower than three digits. */
function blockIds(count: number): string[] {
  const width = Math.max(3, String(count).length)
  return Array.from({ length: count }, (_, index) => `P${String(index + 1).padStart(width, '0')}`)
}

function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

/** Id-prefixed blocks, each cut so the whole state fits. */
function stateOf(ids: readonly string[], blocks: readonly string[]): string {
  const perBlock = Math.min(BLOCK_STATE_MAX_CHARS, Math.floor(STATE_MAX_CHARS / Math.max(1, blocks.length)))
  return blocks.map((block, index) => `${ids[index]}| ${cut(block, perBlock)}`).join('\n')
}

/** The excerpt a pick carries: the block, or its head at a word boundary when it passes a Memory Entry's bound. */
function excerptOf(block: string): string {
  if (block.length <= MAX_MEMORY_DETAIL_CHARS) return block
  const head = block.slice(0, MAX_MEMORY_DETAIL_CHARS)
  const space = head.lastIndexOf(' ')
  return space > MAX_MEMORY_DETAIL_CHARS / 2 ? head.slice(0, space) : head
}

/** One Choice per item, and — unless a window pass already asked it — one Noul that some passage states it. */
function questionsFor(
  items: readonly string[],
  options: Record<string, string | null>,
  what: 'passage' | 'window',
  withNoul: boolean,
): DecisionQuestions {
  const questions: Record<string, DecisionQuestion> = {}
  items.forEach((item, index) => {
    questions[`pick_${index + 1}`] = {
      type: 'choice',
      instructions:
        what === 'passage'
          ? `Which passage of the page states this asked item: ${item}`
          : `Which window of the page's passages holds the passage that states this asked item: ${item}`,
      options,
    }
    if (withNoul) {
      questions[`any_${index + 1}`] = { type: 'noul', instructions: `A passage of the page states this asked item: ${item}` }
    }
  })
  return questions
}

export function createSelectedPassageSeam(deps: SelectedPassageDeps): SelectedPassageSeam {
  // The URL, blocks and items of the last ask: asking again over the same
  // blocks for the same items would get the same answer (a read_page after a landing
  // that scored nothing, a click that changed nothing).
  let lastAsked: string | null = null

  /** One ask, its Decision Record written; the items whose pair cleared, with the label each chose. */
  async function ask(
    items: readonly string[],
    state: string,
    questions: DecisionQuestions,
    windowed: boolean,
  ): Promise<Map<string, string>> {
    const result = await deps.model.ask({ state, questions })
    const cleared = new Map<string, string>()
    if (result.status === 'answered') {
      const answers = result.answers as DecisionAnswers<DecisionQuestions>
      items.forEach((item, index) => {
        const pick = answers[`pick_${index + 1}`]
        const any = answers[`any_${index + 1}`]
        if (pick?.type !== 'choice') return
        if (clearsDecisionThresholds(any === undefined ? { pick } : { pick, any }, deps.thresholds)) cleared.set(item, pick.choice)
      })
    }
    const record = decisionEvent({ seam: 'passage', round: deps.round(), questions, stateChars: state.length, threshold: deps.thresholds, result, mode: 'act' })
    // Each Asked Item's pair is judged on its own, so the ask acted when any
    // item's pair cleared — not only when every answer did.
    deps.writeDecision({
      ...record,
      ...(result.status === 'answered' ? { acted: cleared.size > 0 ? 'acted' : 'under_threshold' } : {}),
      ...(windowed ? { windowed: true } : {}),
    })
    return cleared
  }

  async function pick(items: readonly string[], blocks: readonly string[]): Promise<SelectedPassage[]> {
    const ids = blockIds(blocks.length)
    /** The item's pick from an ask's cleared labels, as the excerpt it is carried and recorded as. */
    const pickOf = (item: string, cleared: ReadonlyMap<string, string>): SelectedPassage[] => {
      const label = cleared.get(item)
      const block = label === undefined ? undefined : blocks[ids.indexOf(label)]
      return block === undefined ? [] : [{ item, passage: excerptOf(block) }]
    }
    if (blocks.length <= MAX_OPTIONS) {
      const options = Object.fromEntries(ids.map((id) => [id, null]))
      const cleared = await ask(items, stateOf(ids, blocks), questionsFor(items, options, 'passage', true), false)
      return items.flatMap((item) => pickOf(item, cleared))
    }
    // Two passes: a window of at most 255 blocks, then a block inside it. The
    // Noul rides the window pass; the block pass is one Choice per item.
    const windows = Array.from({ length: Math.ceil(blocks.length / MAX_OPTIONS) }, (_, index) => {
      const from = index * MAX_OPTIONS
      const to = Math.min(blocks.length, from + MAX_OPTIONS)
      return { label: `W${index + 1}`, from, to, range: `${ids[from]}–${ids[to - 1]}` }
    })
    const windowOptions = Object.fromEntries(windows.map((window) => [window.label, window.range]))
    const chosen = await ask(items, stateOf(ids, blocks), questionsFor(items, windowOptions, 'window', true), true)
    const picks: SelectedPassage[] = []
    for (const window of windows) {
      const inWindow = items.filter((item) => chosen.get(item) === window.label)
      if (inWindow.length === 0) continue
      const windowIds = ids.slice(window.from, window.to)
      const options = Object.fromEntries(windowIds.map((id) => [id, null]))
      const cleared = await ask(inWindow, stateOf(windowIds, blocks.slice(window.from, window.to)), questionsFor(inWindow, options, 'passage', false), true)
      picks.push(...inWindow.flatMap((item) => pickOf(item, cleared)))
    }
    // In the Asked Items' own order, whichever window each came from.
    return items.flatMap((item) => picks.filter((found) => found.item === item))
  }

  return {
    async select(call, sourceUrl) {
      if (!PASSAGE_TOOLS.has(call.name) || sourceUrl === null) return []
      // A search results page is never a source (ADR 0069 note): its snippet
      // is the engine's excerpt of another page.
      if (parseSearchUrl(sourceUrl) !== null) return []
      const items = deps.openItems()
      if (items.length === 0) return []
      try {
        const blocks = (await deps.pageTextBlocks())?.filter((block) => block.trim() !== '') ?? []
        if (blocks.length === 0) return []
        const key = JSON.stringify([sourceUrl, items, blocks])
        if (key === lastAsked) return []
        lastAsked = key
        return await pick(items, blocks)
      } catch (error) {
        reportFault('pipeline.selectedPassage.select', error)
        return []
      }
    },

    record(picks, sourceUrl) {
      const accepted: string[] = []
      for (const { item, passage } of picks) {
        if (deps.checkpoint(item, passage, sourceUrl)) accepted.push(item)
      }
      return accepted
    },
  }
}

/**
 * The `record_evidence` call a Run-made checkpoint goes through: the landed
 * page as source, the block as excerpt, the Asked Item's wording as the
 * observation — graded by the same rule as the model's own call.
 */
export function selectedPassageCall(item: string, passage: string, sourceUrl: string, id: string): ToolCall {
  return { id, name: 'record_evidence', args: { kind: 'web', source_url: sourceUrl, excerpt: passage, observation: item } }
}

/** Lines after a successful string result; with none, the outcome itself, byte for byte. */
function withLines(outcome: ToolResultOutcome, lines: readonly string[]): ToolResultOutcome {
  if (lines.length === 0 || !outcome.ok || typeof outcome.result !== 'string') return outcome
  return { ...outcome, result: [outcome.result, ...lines].join('\n') }
}

/** The picks carried after the result, one line per Asked Item — before the ledger records it. */
export function carrySelectedPassages(outcome: ToolResultOutcome, picks: readonly SelectedPassage[]): ToolResultOutcome {
  return withLines(outcome, picks.map(({ item, passage }) => `Selected passage for "${item}": ${passage}`))
}

/** What the Run recorded, so the model does not record it again. */
export function withRecordedPassages(outcome: ToolResultOutcome, items: readonly string[]): ToolResultOutcome {
  return withLines(outcome, items.map((item) => `Recorded as evidence for "${item}".`))
}
