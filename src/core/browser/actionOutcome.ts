import type { ToolResultOutcome } from '../ports/llm'

// #261 (note on ADR 0058): the browser port's click and type outcomes open
// with fixed heads, and two of them say the call consumed nothing — a Blocked
// Action (a cover over the target refused the click or the typing) and an
// inert click (the controller's own "not meaningful" verdict, ADR 0027: no
// URL, dialog, element state or page signature moved, so no settled state
// follows the line). The controller and its test double build the heads from
// here, and the Search Loop rail and the Round Audit read them back with
// `blockedOrInertAction`, so the three cannot drift.

export const BLOCKED_BY_OVERLAY = 'blocked by overlay'

/** What an inert click reports when it did not touch a state-bearing control. */
export const NO_OBSERVABLE_CHANGE = 'no observable change'

/** The head of a click or a type the page's cover refused: nothing was clicked or typed. */
export function blockedActionHead(action: 'click' | 'type', ref: number): string {
  return action === 'click' ? `clicked [${ref}]: not clicked — ${BLOCKED_BY_OVERLAY}` : `typed [${ref}]: not typed — ${BLOCKED_BY_OVERLAY}`
}

/** The flags that open every click outcome that reached its target; the changes follow. */
export function clickFlagsHead(ref: number, urlChanged: boolean, dialogOpen: boolean): string {
  return `clicked [${ref}]: urlChanged=${urlChanged} dialogOpen=${dialogOpen}; `
}

const BLOCKED_HEAD_RE = new RegExp(`^(?:clicked \\[\\d+\\]: not clicked|typed \\[\\d+\\]: not typed) — ${BLOCKED_BY_OVERLAY}`)
const UNMOVED_CLICK_RE = /^clicked \[\d+\]: urlChanged=false dialogOpen=false; /
/**
 * The settled page state a meaningful click carries: the snapshot head's
 * `signature <hash>` line (`formatPageSnapshot`). An inert click's line
 * stands alone, bar what rides after it (an Auto-vision line, a Notice).
 */
const SETTLED_STATE_RE = /^signature [0-9a-f]+$/m

/** Whether an outcome text says its call consumed nothing, and how; null for every other outcome. */
export function blockedOrInertAction(text: string): 'blocked' | 'inert' | null {
  if (BLOCKED_HEAD_RE.test(text)) return 'blocked'
  if (UNMOVED_CLICK_RE.test(text) && !SETTLED_STATE_RE.test(text)) return 'inert'
  return null
}

/** Whether a successful call was a Blocked Action or an inert click: it reports success and consumed nothing. */
export function wasBlockedOrInert(outcome: ToolResultOutcome): boolean {
  return outcome.ok && typeof outcome.result === 'string' && blockedOrInertAction(outcome.result) !== null
}
