import type { ToolResultOutcome } from '../ports/toolOutcome'
import { blockedOrInertAction } from '../browser/actionOutcome'
import { classifyBlockerPage } from '../browser/blockerNudge'
import { consentWallStayed } from '../browser/dialogPolicy'
import { classifyEmptyLanding, isPageArrival } from '../browser/emptyLanding'
import { classifyNotFoundPage } from '../browser/notFoundPage'
import { classifyUnavailablePage, isUnavailableNotice } from '../browser/unavailablePage'
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

/** The address a landing's outcome carries on its first line; null without one (a click's arrival). */
export function landedUrl(result: string): string | null {
  return landingFacts(result)?.url ?? null
}

/** What went wrong, as the spoken line names it. */
export type SpokenFailure = 'failed' | 'blocked' | 'consent' | 'blocker' | 'notFound' | 'unavailable' | 'empty' | 'dialogStayed' | 'noBack' | 'noPage' | 'popup' | 'unsure' | 'notHere'

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
}

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
}

/** The failure a Command's outcome speaks, or null when it stays silent. */
export function spokenFailureOf(input: SpokenFailureInput): SpokenFailure | null {
  const { outcome } = input
  if (!outcome.ok) return 'failed'
  if (typeof outcome.result !== 'string') return null
  const result = outcome.result
  const tool = input.tool === 'forward' ? 'go_forward' : input.tool
  const blocked = blockedOrInertAction(result)
  if (blocked === 'covered' || blocked === 'notShown') return consentWallStayed(result) ? 'consent' : 'blocked'
  if (!isPageArrival(tool, result)) return null
  const landed = landingFacts(result)
  // The landing line names the page the outcome carries; a click's arrival has none, and the tab's state stands in.
  const url = landed?.url ?? input.url
  const title = landed?.title ?? input.title ?? ''
  if (url === undefined) return null
  if (classifyBlockerPage({ url, title }) !== null) return 'blocker'
  if (classifyNotFoundPage({ url, title }) !== null) return 'notFound'
  // An outage served with 200 under a title naming only the site says so in
  // its one sentence: the page's text, read before it can count as empty.
  if (classifyUnavailablePage({ url, title }) !== null || isUnavailableNotice(pageReadText(result))) return 'unavailable'
  if (classifyEmptyLanding({ url, outcome: result }) !== null) return 'empty'
  return null
}
