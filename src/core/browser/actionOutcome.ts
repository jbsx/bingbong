import type { ToolResultOutcome } from '../ports/llm'

// #261 (note on ADR 0058): the browser port's click and type outcomes open
// with fixed heads, and two of them say the call consumed nothing — a Blocked
// Action (a cover over the target refused the click or the typing) and an
// inert click (the controller's own "not meaningful" verdict, ADR 0027: no
// URL, dialog, element state or page signature moved, so no settled state
// follows the line). The controller and its test double build the heads from
// here, and the Search Loop rail and the Round Audit read them back with
// `blockedOrInertAction`, whose patterns are made from the same builders, so
// the three cannot drift.

/** What an inert click reports when it did not touch a state-bearing control. */
export const NO_OBSERVABLE_CHANGE = 'no observable change'

/** What a click reports when only the page's signature moved — meaningful, never inert. */
export const PAGE_SIGNATURE_CHANGED = 'page signature changed'

/** How a call that reported success consumed nothing: a Blocked Action, or an inert click. */
export type ConsumedNothing = 'blocked' | 'inert'

/** The head of a click or a type the page's cover refused: nothing was clicked or typed. */
export function blockedActionHead(action: 'click' | 'type', ref: number): string {
  return action === 'click' ? `clicked [${ref}]: not clicked — blocked by overlay` : `typed [${ref}]: not typed — blocked by overlay`
}

/** The flags that open every click outcome that reached its target; the changes follow. */
export function clickFlagsHead(ref: number, urlChanged: boolean, dialogOpen: boolean): string {
  return `clicked [${ref}]: urlChanged=${urlChanged} dialogOpen=${dialogOpen}; `
}

/** A pattern matching a built head at the start of a text, for any ref number. */
function headPattern(...heads: string[]): RegExp {
  const escaped = heads.map((head) => head.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\\[0\\]', '\\[\\d+\\]'))
  return new RegExp(`^(?:${escaped.join('|')})`)
}

const BLOCKED_HEAD_RE = headPattern(blockedActionHead('click', 0), blockedActionHead('type', 0))
const UNMOVED_CLICK_RE = headPattern(clickFlagsHead(0, false, false))

/**
 * The settled page state a meaningful click carries: the snapshot head's
 * `signature <hash>` line (`formatPageSnapshot`). An inert click's line
 * stands alone, bar what rides after it (an Auto-vision line, a Notice).
 */
const SETTLED_STATE_RE = /^signature [0-9a-f]+$/m

/** What joins an element-state delta's before and after in a click's changes clause: `checked=false -> true`. */
export const STATE_DELTA = ' -> '

/**
 * Whether an outcome text says its call consumed nothing, and how; null for
 * every other outcome. An inert click is read twice over — its changes clause
 * names no page or element change, and no settled state follows — so a
 * meaningful click whose settled state failed to collect is never taken for one.
 */
export function blockedOrInertAction(text: string): ConsumedNothing | null {
  if (BLOCKED_HEAD_RE.test(text)) return 'blocked'
  const unmoved = UNMOVED_CLICK_RE.exec(text)
  if (unmoved === null || SETTLED_STATE_RE.test(text)) return null
  const changes = text.slice(unmoved[0].length).split('\n', 1)[0]!.split('; ', 1)[0]!
  return changes === PAGE_SIGNATURE_CHANGED || changes.includes(STATE_DELTA) ? null : 'inert'
}

/** Whether a successful call was a Blocked Action or an inert click: it reports success and consumed nothing. */
export function wasBlockedOrInert(outcome: ToolResultOutcome): boolean {
  return outcome.ok && typeof outcome.result === 'string' && blockedOrInertAction(outcome.result) !== null
}
