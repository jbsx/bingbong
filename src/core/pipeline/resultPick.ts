// The Result Pick (#277, ADR 0070): a search landing's best result, chosen
// by the Decision Model and opened by the Run in the same Tool Round, as the
// model would open it — a navigate to the result's whole href.
//
// This module owns the judgement: whether a landing is asked about at all
// (a navigate to a Search URL that landed, for a Lookup or Investigation
// with an open Asked Item — never a Direct Action, whose command may be
// asking for the listing itself), what the Decision Model is asked (a Choice
// over the listing's candidates and a Noul that any of them answers, over
// the objective, the Asked Items, the candidates and the preview), the
// Decision Record every question leaves, and the words the model reads when
// a result was opened. The executor owns the open itself: the navigate passes
// every gate and rail any navigate passes, so the Search Loop rail reads it
// as a result opened, and the landed page is a fresh landing for every other.
//
// The candidates are the links of the whole page (#303, note on ADR 0070),
// never the refs in view: a listing's results often begin below the fold,
// and the links in view are then the site's own navigation.

import { parseSearchUrl } from '../browser/urlInput'
import { parseBlockerMarker } from '../browser/blockerNudge'
import { landedOnNotFoundPage } from '../browser/notFoundPage'
import { landedOnUnavailablePage } from '../browser/unavailablePage'
import type { PageLink } from '../browser/snapshot'
import type { ToolCall, ToolResultOutcome } from '../ports/llm'
import type { DecisionChoiceQuestion, DecisionModel, DecisionNoulQuestion, DecisionThresholds } from '../ports/decisionModel'
import { decisionActed, decisionEvent } from '../trace/decisionTrace'
import type { DecisionCandidate, DecisionEvent } from '../trace/runTrace'
import { urlFingerprint } from './progressFingerprints'
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
  /**
   * The links of the whole page the search landed on, in document order
   * (#303): what the candidates are made from. Null when the page cannot be
   * read — nothing is asked then, and the refs in view are never the fallback.
   */
  pageLinks(): Promise<readonly PageLink[] | null>
}

/**
 * The result the Decision Model chose, as the Run opens it. `ref` is the
 * number the listing showed the link under, absent for a link it showed as
 * no ref — one below the fold (#303).
 */
export interface PickedResult {
  readonly ref?: number
  readonly label: string
  readonly href: string
}

/**
 * What a `tool_result` carries when its search's result was opened by a
 * Result Pick: the label and whole href the Run opened, the ref where the
 * listing showed one, and whether the open landed — so the Run Trace and the
 * Round Audit read it from the round, never from the Opened line's wording.
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

/** How many candidates a Choice is over (#303): the list is cut here, after addresses are merged. */
export const MAX_RESULT_CANDIDATES = 100

/** How a printed href ends when the snapshot cut it. */
const CUT_MARK = '…'

/** The fingerprint an address is matched by: its canonical endpoint identity. */
function fingerprintOf(address: string): string {
  return urlFingerprint(address).url
}

/**
 * The link refs the listing showed, as printed, less a dialog's: a link
 * inside a dialog belongs to the dialog rather than the results.
 */
function shownLinkRefs(head: string): { readonly ref: number; readonly href: string }[] {
  const refs: { ref: number; href: string }[] = []
  for (const line of head.split('\n')) {
    const match = LINK_REF_RE.exec(line)
    if (match === null || match[4]!.includes('(dialog)')) continue
    try {
      refs.push({ ref: Number(match[1]), href: JSON.parse(match[3]!) as string })
    } catch (error) {
      reportFault('pipeline.resultPick.shownLinkRefs', error)
    }
  }
  return refs
}

/**
 * The candidates of a Result Pick (#303, note on ADR 0070): the links of the
 * whole page in document order, less two that are no result — a link that is
 * not http(s), and a link to another Search URL, which would only be another
 * listing. Links to one address by URL fingerprint are one candidate, where
 * the first of them stood and under the longest label. The list is cut at
 * {@link MAX_RESULT_CANDIDATES}; the site's own navigation stays in it. A
 * candidate carries the ref the listing showed its address under, when it
 * showed one — a printed href the snapshot cut is matched by the part it
 * printed, and only where one candidate alone begins with it.
 */
export function resultCandidates(links: readonly PageLink[], head: string): DecisionCandidate[] {
  const byAddress = new Map<string, { label: string; href: string }>()
  for (const link of links) {
    if (!/^https?:\/\//i.test(link.href) || parseSearchUrl(link.href) !== null) continue
    const address = fingerprintOf(link.href)
    const known = byAddress.get(address)
    if (known === undefined) byAddress.set(address, { label: link.label, href: link.href })
    else if (link.label.length > known.label.length) known.label = link.label
  }
  const whole = new Map<string, number>()
  const cut: { ref: number; printed: string }[] = []
  for (const shown of shownLinkRefs(head)) {
    if (shown.href.endsWith(CUT_MARK)) cut.push({ ref: shown.ref, printed: shown.href.slice(0, -CUT_MARK.length) })
    else if (!whole.has(fingerprintOf(shown.href))) whole.set(fingerprintOf(shown.href), shown.ref)
  }
  const candidates = [...byAddress.entries()].slice(0, MAX_RESULT_CANDIDATES)
  const beginsWith = (printed: string): string[] => candidates.flatMap(([address, candidate]) => (candidate.href.length > printed.length && candidate.href.startsWith(printed) ? [address] : []))
  for (const shown of cut) {
    const [address, ...others] = beginsWith(shown.printed)
    if (address !== undefined && others.length === 0 && !whole.has(address)) whole.set(address, shown.ref)
  }
  return candidates.map(([address, candidate]) => {
    const ref = whole.get(address)
    return { ...candidate, ...(ref !== undefined ? { ref } : {}) }
  })
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

/** Whether the plan is one a result is opened for: a Lookup or Investigation. */
function isPickablePlan(plan: RunPlan | null): plan is RunPlan {
  return plan !== null && plan.effortTier !== 'direct_action'
}

/** A candidate's option: its position in the list, 1 to n, never a snapshot ref (#303). */
function optionOf(position: number): string {
  return String(position + 1)
}

/** The text the questions are about: position-prefixed candidates, so the Choice is over positions. */
function stateOf(plan: RunPlan, openItems: readonly string[], query: string, candidates: readonly DecisionCandidate[], preview: string): string {
  return [
    `Objective: ${plan.objective}`,
    'Asked items:',
    ...openItems.map((item) => `- ${item}`),
    `Search: ${query}`,
    'Results:',
    ...candidates.map((candidate, position) => `[${optionOf(position)}] "${candidate.label}" ${candidate.href}`),
    ...(preview !== '' ? ['Result text:', preview] : []),
  ].join('\n')
}

function questionsOf(candidates: readonly DecisionCandidate[]): { result: DecisionChoiceQuestion; answers: DecisionNoulQuestion } {
  return {
    result: {
      type: 'choice',
      instructions: 'Which result is most likely to lead to a page that answers the objective and its asked items?',
      options: Object.fromEntries(candidates.map((_, position) => [optionOf(position), null])),
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
      const openItems = plan.askedItems
      if (openItems.length === 0) return null
      // Links that cannot be read, or none a result could be among: nothing
      // is asked, and the refs in view are never the fallback (#303).
      let links: readonly PageLink[] | null = null
      try {
        links = await deps.pageLinks()
      } catch (error) {
        reportFault('pipeline.resultPick.pageLinks', error)
      }
      if (links === null) return null
      const { head, preview } = splitListing(landing.listing)
      const candidates = resultCandidates(links, head)
      if (candidates.length === 0) return null
      const state = stateOf(plan, openItems, landing.query, candidates, preview.slice(0, MAX_PREVIEW_CHARS))
      const questions = questionsOf(candidates)
      const result = await deps.model.ask({ state, questions })
      deps.record(
        decisionEvent({ seam: 'result', round: deps.round(), questions, stateChars: state.length, threshold: deps.threshold, result, mode: 'act', candidates }),
      )
      if (result.status !== 'answered' || decisionActed(result, 'act', deps.threshold) !== 'acted') return null
      const chosen = candidates.findIndex((_, position) => optionOf(position) === result.answers.result.choice)
      return candidates[chosen] ?? null
    },
  }
}

/** The navigate that opens a picked result: the model's own move, under an id of its own. */
export function resultPickCall(call: ToolCall, pick: PickedResult): ToolCall {
  return { id: `${call.id}:result-pick`, name: 'navigate', args: { url: pick.href } }
}

/** The picked link as a line names it: under its ref where the listing showed one (#303). */
function pickedLink(pick: PickedResult): string {
  return `${pick.ref !== undefined ? `[${pick.ref}] ` : ''}"${pick.label}" — ${pick.href}`
}

/** The line between the listing's head and the page it opened. */
export function resultOpenedLine(pick: PickedResult): string {
  return `Opened ${pickedLink(pick)}`
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
  if (!landed.ok) return { ok: true, result: `${text}\nTried to open ${pickedLink(pick)}: ${landed.error}` }
  return { ok: true, result: `${listingHead(text)}\n${resultOpenedLine(pick)}\n${String(landed.result)}` }
}
