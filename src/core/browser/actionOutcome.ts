import type { ToolResultOutcome } from '../ports/llm'

// #261 (note on ADR 0058): the browser port's click and type outcomes open
// with fixed heads, and some say the call consumed nothing — a Blocked
// Action (ADR 0062: the target was Covered, or Not Shown, so the click or the
// typing reached nothing) and an inert click (the controller's own "not meaningful" verdict, ADR 0027: no
// URL, dialog, element state or page signature moved, so no settled state
// follows the line). The controller and its test double build the heads from
// here, and the Search Loop rail and the Round Audit read them back with
// `blockedOrInertAction`, whose patterns are made from the same builders, so
// the three cannot drift.

/** What an inert click reports when it did not touch a state-bearing control. */
export const NO_OBSERVABLE_CHANGE = 'no observable change'

/** What a click reports when only the page's signature moved — meaningful, never inert. */
export const PAGE_SIGNATURE_CHANGED = 'page signature changed'

/**
 * How a call that reported success consumed nothing: a Blocked Action — its
 * target Covered or Not Shown (ADR 0062) — or an inert click.
 */
export type ConsumedNothing = 'covered' | 'notShown' | 'inert'

/**
 * What sits over a Covered target, named as a page read names refs (ADR
 * 0062): the first ref above it by its listing line; else the first labelled
 * entry by kind and name; else the top entry's tag. The last two carry the
 * listing lines of up to three refs the cover contains.
 */
export type Cover =
  | { readonly kind: 'ref'; readonly line: string }
  | { readonly kind: 'labelled'; readonly role: string; readonly name: string; readonly contains: readonly string[] }
  | { readonly kind: 'unlabelled'; readonly tag: string; readonly contains: readonly string[] }

/**
 * Why a click or a type reached nothing, as the page's hit test decided it
 * (ADR 0062): the target is in the stack at its centre under a Cover, or it
 * is absent from it — Not Shown, inside a hidden or inert container.
 */
export type BlockedAction = { readonly fact: 'covered'; readonly cover: Cover } | { readonly fact: 'notShown' }

/**
 * What the in-page click preparation found over a Covered target, before it
 * is named against the snapshot (`coverOf` in snapshot.ts): a ref number, a
 * labelled entry, or a tag, the last two with the ref numbers they contain.
 */
export type CoverProbe =
  | { readonly ref: number }
  | { readonly role: string; readonly name: string; readonly contains: readonly number[] }
  | { readonly tag: string; readonly contains: readonly number[] }

function coverText(cover: Cover): string {
  if (cover.kind === 'ref') return cover.line
  const named = cover.kind === 'labelled' ? `${cover.role} ${JSON.stringify(cover.name)}` : `an unlabelled <${cover.tag}>`
  return cover.contains.length === 0 ? named : `${named} with ${cover.contains.join(', ')}`
}

/** Where every Blocked Action head starts: nothing was clicked or typed. */
function blockedStart(action: 'click' | 'type', ref: number): string {
  return action === 'click' ? `clicked [${ref}]: not clicked — ` : `typed [${ref}]: not typed — `
}

const COVERED_BY = 'covered by '

/** The head of a click or a type that reached nothing: what covers the target, or that it is not shown (ADR 0062). */
export function blockedActionHead(action: 'click' | 'type', ref: number, blocked: BlockedAction): string {
  return blocked.fact === 'covered'
    ? `${blockedStart(action, ref)}${COVERED_BY}${coverText(blocked.cover)}`
    : `${blockedStart(action, ref)}[${ref}] is not shown: inside a hidden or inert container`
}

/** The flags that open every click outcome that reached its target; the changes follow. */
export function clickFlagsHead(ref: number, urlChanged: boolean, dialogOpen: boolean): string {
  return `clicked [${ref}]: urlChanged=${urlChanged} dialogOpen=${dialogOpen}; `
}

/** A pattern matching a built head at the start of a text, for any ref number. */
function headPattern(...heads: string[]): RegExp {
  const escaped = heads.map((head) => head.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll('\\[0\\]', '\\[\\d+\\]'))
  return new RegExp(`^(?:${escaped.join('|')})`)
}

const COVERED_HEAD_RE = headPattern(`${blockedStart('click', 0)}${COVERED_BY}`, `${blockedStart('type', 0)}${COVERED_BY}`)
const NOT_SHOWN_HEAD_RE = headPattern(blockedActionHead('click', 0, { fact: 'notShown' }), blockedActionHead('type', 0, { fact: 'notShown' }))
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
  if (COVERED_HEAD_RE.test(text)) return 'covered'
  if (NOT_SHOWN_HEAD_RE.test(text)) return 'notShown'
  const unmoved = UNMOVED_CLICK_RE.exec(text)
  if (unmoved === null || SETTLED_STATE_RE.test(text)) return null
  const changes = text.slice(unmoved[0].length).split('\n', 1)[0]!.split('; ', 1)[0]!
  return changes === PAGE_SIGNATURE_CHANGED || changes.includes(STATE_DELTA) ? null : 'inert'
}

/** Whether a successful call was a Blocked Action or an inert click: it reports success and consumed nothing. */
export function wasBlockedOrInert(outcome: ToolResultOutcome): boolean {
  return outcome.ok && typeof outcome.result === 'string' && blockedOrInertAction(outcome.result) !== null
}
