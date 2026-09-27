// The Selected Passage (#276, ADR 0069): the first acting seam of the
// Decision Model (ADR 0068). On a navigate or click landing and on a Page
// Read, once the Run Plan declares an Asked Item this Run has not recorded a
// passage for, the Decision Model is asked which of the page's text blocks
// states it. A pick that clears both its Choice and its Noul is carried
// verbatim in the tool result the model reads — so the ledger holds it and
// ADR 0054's excerpt test grounds it unchanged — and the Run records it as an
// Evidence Checkpoint itself, stating the item and the passage, and names it
// to the model by its id so an Answer can cite it (#283). Anything else leaves
// the result untouched.

import { parseSearchUrl } from '../browser/urlInput'
import type { ToolCall, ToolResultOutcome } from '../ports/llm'
import {
  clearsDecisionThresholds,
  type DecisionAnswers,
  type DecisionModel,
  type DecisionQuestions,
  type DecisionThresholds,
} from '../ports/decisionModel'
import { MAX_MEMORY_DETAIL_CHARS } from '../session/workingMemory'
import { decisionEvent } from '../trace/decisionTrace'
import type { DecisionEvent } from '../trace/runTrace'
import { reportFault } from '../trace/fault'
import { landedOnNothing, MAX_PASSAGE_OPTIONS, PASSAGE_TOOLS, passageBlockIds, passageQuestions, passageState } from './passageQuestions'
import type { RunPlan } from './runPlan'

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
  /** The Run's Objective now, as the Run Plan states it: every question names it (#281). */
  objective(): string
  /** Whether the Run is tracing: a record then keeps the text it was asked over (#281). */
  readonly tracing: boolean
  /** The text blocks of the page the call settled on, in document order; null when it cannot be read. */
  pageTextBlocks(): Promise<readonly string[] | null>
  /** The LLM round the call came from, as `llm_round` numbers it. */
  round(): number
  writeDecision(event: DecisionEvent): void
  /** Records one pick as an Evidence Checkpoint made by the Run, closing its item when accepted; the entry it became, null when refused. */
  checkpoint(item: string, passage: string, sourceUrl: string): string | null
}

/** A pick as the Run recorded it (#283): the Memory Entry it became, null when the checkpoint was refused. */
export interface RecordedPassage extends SelectedPassage {
  readonly entryId: string | null
}

export interface SelectedPassageSeam {
  /** The picks for the page `call` settled on at `sourceUrl`, as `outcome` reported it; empty when nothing was asked or nothing cleared. Never throws. */
  select(call: ToolCall, outcome: ToolResultOutcome, sourceUrl: string | null): Promise<readonly SelectedPassage[]>
  /** Records each pick as a Run-made checkpoint; every pick, with the entry it became. */
  record(picks: readonly SelectedPassage[], sourceUrl: string): readonly RecordedPassage[]
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

/** What parts the Asked Item from the passage in a Run-made Observation (#283). */
const OBSERVATION_JOIN = ': '

/**
 * The excerpt a pick carries: the block, or its head at a word boundary when
 * the Observation it is stated in — the item, then the passage (#283) — would
 * pass a Memory Entry's bound.
 */
function excerptOf(item: string, block: string): string {
  const bound = Math.max(1, MAX_MEMORY_DETAIL_CHARS - item.length - OBSERVATION_JOIN.length)
  if (block.length <= bound) return block
  const head = block.slice(0, bound)
  const space = head.lastIndexOf(' ')
  return space > bound / 2 ? head.slice(0, space) : head
}

export function createSelectedPassageSeam(deps: SelectedPassageDeps): SelectedPassageSeam {
  // The URL, blocks and items of the last ask: asking again over the same
  // blocks for the same items would get the same answer (a read_page after a landing
  // that scored nothing, a click that changed nothing).
  let lastAsked: string | null = null

  /**
   * One ask, its Decision Record written; the items whose pair cleared, with
   * the label each chose. `blockOf` reads a label as its block, null on a
   * window pass, whose labels are windows and no passage.
   */
  async function ask(
    items: readonly string[],
    state: string,
    questions: DecisionQuestions,
    windowed: boolean,
    blockOf: ((label: string) => string | undefined) | null,
  ): Promise<Map<string, string>> {
    const result = await deps.model.ask({ state, questions })
    const cleared = new Map<string, string>()
    // The passage each Choice chose, cleared or not (#281): a record that did
    // not act still says what it would have carried, so it can be judged.
    const passages: Record<string, string> = {}
    if (result.status === 'answered') {
      const answers = result.answers as DecisionAnswers<DecisionQuestions>
      items.forEach((item, index) => {
        const key = `pick_${index + 1}`
        const pick = answers[key]
        const any = answers[`any_${index + 1}`]
        if (pick?.type !== 'choice') return
        const block = blockOf?.(pick.choice)
        if (block !== undefined) passages[key] = excerptOf(item, block)
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
      ...(Object.keys(passages).length > 0 ? { passages } : {}),
      // The text asked over, so a Shadow Replay can put the question again
      // (#281): a landing's trace holds only its Page Preview.
      ...(deps.tracing ? { askedText: state } : {}),
    })
    return cleared
  }

  async function pick(items: readonly string[], blocks: readonly string[]): Promise<SelectedPassage[]> {
    const ids = passageBlockIds(blocks.length)
    const objective = deps.objective()
    const blockOf = (label: string): string | undefined => blocks[ids.indexOf(label)]
    /** The item's pick from an ask's cleared labels, as the excerpt it is carried and recorded as. */
    const pickOf = (item: string, cleared: ReadonlyMap<string, string>): SelectedPassage[] => {
      const label = cleared.get(item)
      const block = label === undefined ? undefined : blockOf(label)
      return block === undefined ? [] : [{ item, passage: excerptOf(item, block) }]
    }
    if (blocks.length <= MAX_PASSAGE_OPTIONS) {
      const options = Object.fromEntries(ids.map((id) => [id, null]))
      const cleared = await ask(items, passageState(ids, blocks), passageQuestions(objective, items, options, 'passage', true), false, blockOf)
      return items.flatMap((item) => pickOf(item, cleared))
    }
    // Two passes: a window of at most 255 blocks, then a block inside it. The
    // Noul rides the window pass; the block pass is one Choice per item.
    const windows = Array.from({ length: Math.ceil(blocks.length / MAX_PASSAGE_OPTIONS) }, (_, index) => {
      const from = index * MAX_PASSAGE_OPTIONS
      const to = Math.min(blocks.length, from + MAX_PASSAGE_OPTIONS)
      return { label: `W${index + 1}`, from, to, range: `${ids[from]}–${ids[to - 1]}` }
    })
    const windowOptions = Object.fromEntries(windows.map((window) => [window.label, window.range]))
    const chosen = await ask(items, passageState(ids, blocks), passageQuestions(objective, items, windowOptions, 'window', true), true, null)
    const picks: SelectedPassage[] = []
    for (const window of windows) {
      const inWindow = items.filter((item) => chosen.get(item) === window.label)
      if (inWindow.length === 0) continue
      const windowIds = ids.slice(window.from, window.to)
      const options = Object.fromEntries(windowIds.map((id) => [id, null]))
      const state = passageState(windowIds, blocks.slice(window.from, window.to))
      const cleared = await ask(inWindow, state, passageQuestions(objective, inWindow, options, 'passage', false), true, blockOf)
      picks.push(...inWindow.flatMap((item) => pickOf(item, cleared)))
    }
    // In the Asked Items' own order, whichever window each came from.
    return items.flatMap((item) => picks.filter((found) => found.item === item))
  }

  return {
    async select(call, outcome, sourceUrl) {
      if (!PASSAGE_TOOLS.has(call.name) || sourceUrl === null) return []
      // A page that is not there, or not shown, states no item (#281).
      if (landedOnNothing(outcome)) return []
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
      return picks.map((pick) => ({ ...pick, entryId: deps.checkpoint(pick.item, pick.passage, sourceUrl) }))
    },
  }
}

/**
 * The `record_evidence` call a Run-made checkpoint goes through: the landed
 * page as source, the block as excerpt and, as the observation, the Asked
 * Item's wording followed by the passage verbatim (#283) — an Observation
 * that states the value, graded by the same rule as the model's own call.
 */
export function selectedPassageCall(item: string, passage: string, sourceUrl: string, id: string): ToolCall {
  return {
    id,
    name: 'record_evidence',
    args: { kind: 'web', source_url: sourceUrl, excerpt: passage, observation: `${item}${OBSERVATION_JOIN}${passage}` },
  }
}

/** Lines after a successful string result; with none, the outcome itself, byte for byte. */
function withLines(outcome: ToolResultOutcome, lines: readonly string[]): ToolResultOutcome {
  if (lines.length === 0 || !outcome.ok || typeof outcome.result !== 'string') return outcome
  return { ...outcome, result: [outcome.result, ...lines].join('\n') }
}

/**
 * The line one pick is carried as (#283), in the wording a `record_evidence`
 * result opens with. The ledger holds it before the checkpoint is graded, so
 * without an id; the model reads it naming the entry the checkpoint became. A
 * refused checkpoint has no entry to name, and its line says so.
 */
export function selectedPassageLine(pick: SelectedPassage, entryId?: string | null): string {
  const head = entryId === undefined ? 'Session Evidence recorded:' : entryId === null ? 'Session Evidence not recorded,' : `Session Evidence recorded: ${entryId},`
  return `${head} for "${pick.item}": ${pick.passage}`
}

/** The picks carried after the result, one line per Asked Item — before the ledger records it. */
export function carrySelectedPassages(outcome: ToolResultOutcome, picks: readonly SelectedPassage[]): ToolResultOutcome {
  return withLines(outcome, picks.map((pick) => selectedPassageLine(pick)))
}

/** What the model reads once the Run recorded: the same lines, each naming its checkpoint's id so an Answer can cite it. */
export function withRecordedPassages(outcome: ToolResultOutcome, recorded: readonly RecordedPassage[]): ToolResultOutcome {
  return withLines(outcome, recorded.map((pick) => selectedPassageLine(pick, pick.entryId)))
}
