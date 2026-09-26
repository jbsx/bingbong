// The Result Pick (#277, ADR 0070): a search landing's best result, chosen
// by the Decision Model and opened by the Run in the same Tool Round, as the
// model would open it — a navigate to the result's whole href.
//
// This module owns the judgement: whether a landing is asked about at all
// (a navigate to a Search URL that landed, for a Lookup or Investigation
// with an open Asked Item — never a Direct Action, whose command may be
// asking for the listing itself), what the Decision Model is asked (a Choice
// over the listing's result refs and a Noul that any of them answers, over
// the objective, the Asked Items, the refs and the preview), the Decision
// Record every question leaves, and the words the model reads when a result
// was opened. The executor owns the open itself: the navigate passes every
// gate and rail any navigate passes, so the Search Loop rail reads it as a
// result opened, and the landed page is a fresh landing for every other.

import { parseSearchUrl } from '../browser/urlInput'
import { parseBlockerMarker } from '../browser/blockerNudge'
import { landedOnNotFoundPage } from '../browser/notFoundPage'
import { landedOnUnavailablePage } from '../browser/unavailablePage'
import type { SnapshotRef } from '../browser/snapshot'
import type { ToolCall, ToolResultOutcome } from '../ports/llm'
import type { DecisionChoiceQuestion, DecisionModel, DecisionNoulQuestion, DecisionThresholds } from '../ports/decisionModel'
import { decisionActed, decisionEvent } from '../trace/decisionTrace'
import type { DecisionEvent } from '../trace/runTrace'
import type { RunPlan } from './runPlan'
import { reportFault } from '../trace/fault'

export interface ResultPickDeps {
  readonly model: DecisionModel
  /** The bar the result seam's answers clear before a result is opened. */
  readonly threshold: DecisionThresholds
  /** The Run's plan as it stands when the landing is judged: the Run Plan intercept has already run this round. */
  runPlan(): RunPlan | null
  /** The LLM round whose Tool Round this is: the Decision Record's `round`. */
  round(): number
  /** Where every question's Decision Record goes. */
  record(event: DecisionEvent): void
  /** The tab's own ref facts: the chosen ref's whole href, because the printed line cuts a long one. */
  describeRef?(ref: number): Promise<SnapshotRef | undefined>
}

/** The result the Decision Model chose, as the Run opens it. */
export interface PickedResult {
  readonly ref: number
  readonly label: string
  readonly href: string
}

/**
 * What a `tool_result` carries when its search's result was opened by a
 * Result Pick: the ref, label and whole href the Run opened, and whether the
 * open landed — so the Run Trace and the Round Audit read it from the round,
 * never from the Opened line's wording.
 */
export interface ResultPickStamp extends PickedResult {
  readonly opened: boolean
}

export interface ResultPick {
  /**
   * Judges one executed call and its raw outcome: null when the landing is
   * not asked about, or when the answer did not clear (under threshold,
   * unavailable) — the listing then reaches the model as it would have.
   */
  choose(call: ToolCall, outcome: ToolResultOutcome): Promise<PickedResult | null>
}

/** The line that opens a listing's page text: everything above it is the head. */
const PAGE_TEXT_LINE = 'page text:'

/** A printed link ref: `[n] link "label" href="…"`, then any state and a dialog marker. */
const LINK_REF_RE = /^\[(\d+)\] link(?: "(.*)")? href=("(?:[^"\\]|\\.)*")(.*)$/

/** How much of the listing's preview the state carries: the snippets, not a Page Read. */
const MAX_PREVIEW_CHARS = 6000

interface ListedResult {
  readonly ref: number
  readonly label: string
  readonly href: string
}

/**
 * The listing's link refs as printed, less two that are no result: a link
 * to another Search URL, which would only be another listing, and a link
 * inside a dialog, which belongs to the dialog rather than the results.
 */
function listedResults(head: string): ListedResult[] {
  const results: ListedResult[] = []
  for (const line of head.split('\n')) {
    const match = LINK_REF_RE.exec(line)
    if (match === null || match[4]!.includes('(dialog)')) continue
    let href: string
    try {
      href = JSON.parse(match[3]!) as string
    } catch (error) {
      reportFault('pipeline.resultPick.listedResults', error)
      continue
    }
    if (!/^https?:\/\//i.test(href) || parseSearchUrl(href) !== null) continue
    results.push({ ref: Number(match[1]), label: match[2] ?? '', href })
  }
  return results
}

/** A listing cut at its `page text:` line: the head above it — the landing line, the page's head and every ref — and the preview below. */
function splitListing(listing: string): { readonly head: string; readonly preview: string } {
  const lines = listing.split('\n')
  const at = lines.indexOf(PAGE_TEXT_LINE)
  return at === -1 ? { head: listing, preview: '' } : { head: lines.slice(0, at).join('\n'), preview: lines.slice(at + 1).join('\n') }
}

/** Everything a listing says above its page text: the landing line, the page's head and every ref. */
export function listingHead(listing: string): string {
  return splitListing(listing).head
}

/**
 * The search a call landed on: its terms and listing when it was a navigate
 * to a Search URL that landed on no wall and no missing page, else null.
 */
function searchLandingOf(call: ToolCall, outcome: ToolResultOutcome): { readonly query: string; readonly listing: string } | null {
  if (call.name !== 'navigate' || typeof call.args.url !== 'string') return null
  const search = parseSearchUrl(call.args.url)
  if (search === null || !outcome.ok || typeof outcome.result !== 'string') return null
  if (parseBlockerMarker(outcome.result) !== null || landedOnNotFoundPage(outcome) || landedOnUnavailablePage(outcome)) return null
  return { query: search.query, listing: outcome.result }
}

/** Whether the plan is one a result is opened for: a Lookup or Investigation with an Asked Item open. */
function isPickablePlan(plan: RunPlan | null): plan is RunPlan {
  return plan !== null && plan.effortTier !== 'direct_action' && plan.askedItems.length > 0
}

/** The text the questions are about: id-prefixed results, so the Choice is over ids. */
function stateOf(plan: RunPlan, query: string, results: readonly ListedResult[], preview: string): string {
  return [
    `Objective: ${plan.objective}`,
    'Asked items:',
    ...plan.askedItems.map((item) => `- ${item}`),
    `Search: ${query}`,
    'Results:',
    ...results.map((result) => `[${result.ref}] "${result.label}" ${result.href}`),
    ...(preview !== '' ? ['Result text:', preview] : []),
  ].join('\n')
}

function questionsOf(results: readonly ListedResult[]): { result: DecisionChoiceQuestion; answers: DecisionNoulQuestion } {
  return {
    result: {
      type: 'choice',
      instructions: 'Which result is most likely to lead to a page that answers the objective and its asked items?',
      options: Object.fromEntries(results.map((result) => [String(result.ref), null])),
    },
    answers: {
      type: 'noul',
      instructions: 'At least one of these results plausibly leads to a page that answers the objective.',
    },
  }
}

export function createResultPick(deps: ResultPickDeps): ResultPick {
  return {
    async choose(call, outcome) {
      const landing = searchLandingOf(call, outcome)
      if (landing === null) return null
      const plan = deps.runPlan()
      if (!isPickablePlan(plan)) return null
      const { head, preview } = splitListing(landing.listing)
      const results = listedResults(head)
      if (results.length === 0) return null
      const state = stateOf(plan, landing.query, results, preview.slice(0, MAX_PREVIEW_CHARS))
      const questions = questionsOf(results)
      const result = await deps.model.ask({ state, questions })
      deps.record(
        decisionEvent({ seam: 'result', round: deps.round(), questions, stateChars: state.length, threshold: deps.threshold, result, mode: 'act' }),
      )
      if (result.status !== 'answered' || decisionActed(result, 'act', deps.threshold) !== 'acted') return null
      const chosen = results.find((listed) => String(listed.ref) === result.answers.result.choice)
      if (chosen === undefined) return null
      // The printed line cuts a long href; the tab holds it whole.
      let described: SnapshotRef | undefined
      try {
        described = await deps.describeRef?.(chosen.ref)
      } catch (error) {
        reportFault('pipeline.resultPick.describeRef', error)
      }
      const href = described?.kind === 'link' && described.href ? described.href : chosen.href
      return { ref: chosen.ref, label: chosen.label, href }
    },
  }
}

/** The navigate that opens a picked result: the model's own move, under an id of its own. */
export function resultPickCall(call: ToolCall, pick: PickedResult): ToolCall {
  return { id: `${call.id}:result-pick`, name: 'navigate', args: { url: pick.href } }
}

/** The line between the listing's head and the page it opened. */
export function resultOpenedLine(pick: PickedResult): string {
  return `Opened [${pick.ref}] "${pick.label}" — ${pick.href}`
}

/**
 * What the model reads for a search whose result was opened: the listing's
 * head — every ref, so any other result is one round away — then the Opened
 * line, then the landed page's Action Outcome. An open that failed leaves
 * the whole listing in front of the model, followed by what failed.
 */
export function withResultPick(listing: ToolResultOutcome, pick: PickedResult, landed: ToolResultOutcome): ToolResultOutcome {
  if (!listing.ok) return listing
  const text = String(listing.result)
  if (!landed.ok) return { ok: true, result: `${text}\nTried to open [${pick.ref}] "${pick.label}" — ${pick.href}: ${landed.error}` }
  return { ok: true, result: `${listingHead(text)}\n${resultOpenedLine(pick)}\n${String(landed.result)}` }
}
