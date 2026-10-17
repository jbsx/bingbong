import type { ToolResultOutcome } from '../ports/toolOutcome'
import { blockedOrInertAction } from '../browser/actionOutcome'
import { classifyBlockerPage } from '../browser/blockerNudge'
import { classifyEmptyLanding, isPageArrival } from '../browser/emptyLanding'
import { classifyNotFoundPage } from '../browser/notFoundPage'
import { classifyUnavailablePage } from '../browser/unavailablePage'

// A failure speaks one line (#327, ADR 0076): a Command whose action fails,
// or whose action lands on a Blocked Action, a consent wall, a Blocker, or an
// empty, not-found or unavailable page (the Action Outcome classifiers in
// core/browser), speaks one short line naming what happened. The lines are
// a fixed table in the Feed's plain-language style and never carry the raw
// error, an address or a status code. Successful actions stay silent.

/** What went wrong, as the spoken line names it. */
export type SpokenFailure = 'failed' | 'blocked' | 'consent' | 'blocker' | 'notFound' | 'unavailable' | 'empty'

export const SPOKEN_FAILURES: Readonly<Record<SpokenFailure, string>> = {
  failed: "That didn't work.",
  blocked: 'Something on the page is in the way.',
  consent: 'A cookie notice is in the way.',
  blocker: "This page wants you to sign in or prove you're human.",
  notFound: "That page doesn't exist.",
  unavailable: "That site can't show the page right now.",
  empty: 'This page shows no text.',
}

/** The heads a dismissal under a Blocked Action leaves (dialogPolicy.ts): the wall stayed. */
const CONSENT_WALL_RE = /dismissed consent dialog: .*\((?:it covered \[\d+\]; retried, still blocked|not retried)\)/

/** A landing's first line: the verb, the address and the title of the page it carries. */
const LANDING_LINE_RE = /^(?:navigated|went back|went forward): url=(\S*) title=("(?:[^"\\]|\\.)*")/

function landingFacts(result: string): { url: string; title: string } | null {
  const match = LANDING_LINE_RE.exec(result.split('\n', 1)[0] ?? '')
  if (match === null) return null
  try {
    return { url: match[1]!, title: JSON.parse(match[2]!) as string }
  } catch {
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
  if (blocked === 'covered' || blocked === 'notShown') return CONSENT_WALL_RE.test(result) ? 'consent' : 'blocked'
  if (!isPageArrival(tool, result)) return null
  const landed = landingFacts(result)
  // The landing line names the page the outcome carries; a click's arrival has none, and the tab's state stands in.
  const url = landed?.url ?? input.url
  const title = landed?.title ?? input.title ?? ''
  if (url === undefined) return null
  if (classifyBlockerPage({ url, title }) !== null) return 'blocker'
  if (classifyNotFoundPage({ url, title }) !== null) return 'notFound'
  if (classifyUnavailablePage({ url, title }) !== null) return 'unavailable'
  if (classifyEmptyLanding({ url, outcome: result }) !== null) return 'empty'
  return null
}
