import type { ToolResultOutcome } from '../ports/toolOutcome'
import { blockedOrInertAction } from '../browser/actionOutcome'
import { classifyBlockerPage, isChallengeAddress } from '../browser/blockerNudge'
import { consentWallStayed } from '../browser/dialogPolicy'
import { classifyEmptyLanding, isPageArrival } from '../browser/emptyLanding'
import { NOT_FOUND_STATUSES, classifyNotFoundPage } from '../browser/notFoundPage'
import { classifyUnavailablePage, isUnavailableNotice, isUnavailableStatus } from '../browser/unavailablePage'
import { pageReadText } from '../browser/pageText'
import { reportFault } from '../trace/fault'

// A failure speaks one line (#327, ADR 0076): a Command whose action fails,
// or whose action lands on a Blocked Action, a consent wall, a Blocker, or an
// empty, not-found or unavailable page (the Action Outcome classifiers in
// core/browser), speaks one short line naming what happened. The lines are
// a fixed table in the Feed's plain-language style and never carry the raw
// error, an address or a status code. Successful actions stay silent. A
// thrown failure is told by failureLineOf (#329), the same words on the
// Feed, the Peek Card and the spoken line.
//
// A landing ends the Task with its line, no one asked, only on a fact
// (ADR 0089): the status the site served (404, 410, 5xx), a challenge host
// or token. A title or a body that reads as not found, unavailable, a wall
// or empty is only suspected (`suspectedFailureOf`): the Verdict reads the
// landing, and the class line is what is said when Jev does not answer.
// No landing rule names a site.

/** The address a landing's outcome carries on its first line; null without one (a click's arrival). */
export function landedUrl(result: string): string | null {
  return landingFacts(result)?.url ?? null
}

/** What went wrong, as the spoken line names it. */
export type SpokenFailure = 'failed' | 'blocked' | 'consent' | 'blocker' | 'notFound' | 'unavailable' | 'empty' | 'dialogStayed' | 'noBack' | 'noPage' | 'popup' | 'unsure' | 'notHere' | 'notFinished'

/** The landings that leave the pane on no page worth going back to: never the Last Page (2026-10-22 audit). */
export const DEAD_END_LANDINGS: ReadonlySet<SpokenFailure> = new Set(['notFound', 'unavailable', 'empty'])

export const SPOKEN_FAILURES: Readonly<Record<SpokenFailure, string>> = {
  failed: "That didn't work.",
  blocked: 'Something on the page is in the way.',
  consent: 'A cookie notice is in the way.',
  blocker: "This page wants you to sign in or prove you're human.",
  notFound: "That page doesn't exist.",
  unavailable: "That site can't show the page right now.",
  empty: 'This page shows no text.',
  dialogStayed: 'The pop-up is still open.',
  noBack: "There's no page to go back to.",
  noPage: "There's no page open.",
  // The Verdict's lines: a sure "in the way" over a pop-up, and a Task with no next step and no sure yes.
  popup: 'A pop-up is in the way.',
  unsure: "I'm not sure this is it.",
  // A Task that looked again (#363) and found nothing: said with the words, `notHereLine`; this when it has none.
  notHere: "I couldn't find that here.",
  // A Task that stopped short (#399): five actions fired, or Jev did not answer past hop 0.
  notFinished: "I couldn't finish that.",
}

/** The end line of a Task done after more than one action (#399): the one word that says it stopped on purpose. Not a failure. */
export const DONE_LINE = 'Done.'

/** The end line of a Task that looked again and found nothing (#363, ADR 0079): the words it looked for, said back. */
export function notHereLine(words: string): string {
  const said = words.trim()
  return said === '' ? SPOKEN_FAILURES.notHere : `I couldn't find ${said} here.`
}

/** A ref the controller refused (ADR 0033) or could not reach: the number, whatever the protocol wording around it. */
const MISSING_REF_RE = /^ref (\d+) (?:refused|no longer resolves)\b/

/** A Chromium net error on a load, by its name; the plain sentence for the common ones. */
const NET_ERROR_RE = /\bERR_([A-Z_]+)/
const NET_FAILURES: Readonly<Record<string, string>> = {
  NAME_NOT_RESOLVED: "That site can't be found.",
  INTERNET_DISCONNECTED: "There's no internet connection.",
  CONNECTION_REFUSED: "That site isn't answering.",
  CONNECTION_TIMED_OUT: "That site isn't answering.",
  TIMED_OUT: "That site isn't answering.",
}

/**
 * The plain sentence a thrown failure is told in (#329) — on the Feed, the
 * Peek Card and the spoken line alike. The raw error stays on the event and
 * the decision record; the user is never shown the ref-protocol wording
 * written for a model, nor a Chromium code.
 */
export function failureLineOf(tool: string, error: string): string {
  const ref = MISSING_REF_RE.exec(error)
  if (ref !== null) return `There's no item ${ref[1]} on this page.`
  if (tool === 'navigate') {
    const net = NET_ERROR_RE.exec(error)?.[1]
    return (net !== undefined ? NET_FAILURES[net] : undefined) ?? "That address can't be opened."
  }
  if (tool === 'read_page') return "This page can't be read right now."
  // A refused step back (#336): no history, or only the blank start page behind.
  if (tool === 'back' && /^cannot go back\b/.test(error)) return SPOKEN_FAILURES.noBack
  return SPOKEN_FAILURES.failed
}

/** A landing's first line: the verb, the address and the title of the page it carries. */
const LANDING_LINE_RE = /^(?:navigated|went back|went forward|reloaded): url=(\S*) title=("(?:[^"\\]|\\.)*")/

function landingFacts(result: string): { url: string; title: string } | null {
  const match = LANDING_LINE_RE.exec(result.split('\n', 1)[0] ?? '')
  if (match === null) return null
  try {
    return { url: match[1]!, title: JSON.parse(match[2]!) as string }
  } catch (error) {
    reportFault('command.spokenFailure.landingFacts', error)
    return { url: match[1]!, title: '' }
  }
}

export interface SpokenFailureInput {
  /** The tool the Command ran: `navigate`, `click`, `type`, `back`, `forward`, … */
  readonly tool: string
  readonly outcome: ToolResultOutcome
  /** The page the tab settled on, for an outcome with no landing line to name it (a click that arrived). */
  readonly url?: string
  readonly title?: string
  /** HTTP status of the top-level response the tab settled on, when the surface knows it (ADR 0050). */
  readonly status?: number
}

/** The page an arrival settled on: its address, title and outcome text; null for an outcome that is no arrival on a page. */
function arrivalOf(input: SpokenFailureInput): { url: string; title: string; result: string } | null {
  const { outcome } = input
  if (!outcome.ok || typeof outcome.result !== 'string') return null
  const tool = input.tool === 'forward' ? 'go_forward' : input.tool
  if (!isPageArrival(tool, outcome.result)) return null
  const landed = landingFacts(outcome.result)
  // The landing line names the page the outcome carries; a click's arrival has none, and the tab's state stands in.
  const url = landed?.url ?? input.url
  return url === undefined ? null : { url, title: landed?.title ?? input.title ?? '', result: outcome.result }
}

/**
 * The failure a Command's outcome speaks and ends its Task on, or null when
 * it stays silent: an action that failed or was blocked, and a landing on
 * a fact (ADR 0089) — the status the site served, or a challenge host or
 * token in its address.
 */
export function spokenFailureOf(input: SpokenFailureInput): SpokenFailure | null {
  const { outcome } = input
  if (!outcome.ok) return 'failed'
  if (typeof outcome.result !== 'string') return null
  const blocked = blockedOrInertAction(outcome.result)
  if (blocked === 'covered' || blocked === 'notShown') return consentWallStayed(outcome.result) ? 'consent' : 'blocked'
  const arrival = arrivalOf(input)
  if (arrival === null) return null
  if (isChallengeAddress(arrival.url)) return 'blocker'
  if (input.status !== undefined && NOT_FOUND_STATUSES.has(input.status)) return 'notFound'
  if (isUnavailableStatus(input.status)) return 'unavailable'
  return null
}

/**
 * What a landing's title or body reads as (ADR 0089): a wall, a page not
 * found, a site that could not serve it, or a page with no text — only
 * suspected, since a title or a body is no fact. The Verdict reads the
 * landing; this line is said when Jev does not answer. Null for a page
 * that reads as none, or an outcome that is no arrival.
 */
export function suspectedFailureOf(input: SpokenFailureInput): SpokenFailure | null {
  const arrival = arrivalOf(input)
  if (arrival === null) return null
  const { url, title, result } = arrival
  const status = input.status ?? null
  if (classifyBlockerPage({ url, title, textDigest: pageReadText(result) }) !== null) return 'blocker'
  if (classifyNotFoundPage({ url, title, status }) !== null) return 'notFound'
  // An outage served with 200 under a title naming only the site says so in
  // its one sentence: the page's text, read before it can count as empty.
  if (classifyUnavailablePage({ url, title, status }) !== null || isUnavailableNotice(pageReadText(result))) return 'unavailable'
  if (classifyEmptyLanding({ url, outcome: result }) !== null) return 'empty'
  return null
}
