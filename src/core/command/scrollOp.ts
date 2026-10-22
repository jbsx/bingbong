import type { DecisionChoiceQuestion } from '../ports/decisionModel'
import type { RegionFacts } from '../browser/snapshot'
import { SCROLL_OPS, type ExtentRung, type ScrollExtent, type ScrollOp } from '../browser/scrollOp'
import { firstNumber } from '../timer/duration'

export { EXTENT_RUNGS, SCROLL_END_OF_REGION, SCROLL_OPS, isScrollOp, notchesFor, regionChangeOf, regionPositionOf, regionStateOf, type ExtentRung, type ScrollExtent, type ScrollOp } from '../browser/scrollOp'

// A Scroll Op (#383, ADR 0085, CONTEXT.md): an action a Scroll Region
// carries on the action card because of its kind, as a media ref carries
// its Media Ops. Both are offered whatever the region's position — a
// scroll at the end changes nothing, and the next hop's Verdict ends it —
// each one evaluate on that element, on any site, never moving the page.
// How far is the Extent's, a Choice of its own beside the media Amount,
// which the page's own scroll reads too.

/** The ops a region can take: both, always — never gated by its position. */
export function scrollOpsOf(_facts: RegionFacts): ScrollOp[] {
  return [...SCROLL_OPS]
}

/**
 * Each op's line on the action card: a whole action naming the region by
 * number and label (ADR 0085), or by its mark on the Mark Ask's image (ADR
 * 0084), and saying what kind of thing it is — a region's label is a
 * heading or its first words, which never say "sidebar". Measured
 * 2026-10-22 on a live Reddit card, three replays each: "scroll the
 * sidebar to the bottom" read the region's op 0.23–0.29 under the page's
 * `scroll_down` as `scroll [40] "COMMUNITY BOOKMARKS" down`, 0.87–0.89 as
 * this; "scroll down" and "scroll to the bottom of the page" stayed the
 * page's at 1.00 either way.
 */
export function scrollOpDescription(op: ScrollOp, ref: number, label: string, marked = false): string {
  const named = marked ? `[${ref}], the control marked ${ref},` : `[${ref}] ${JSON.stringify(label)},`
  return `scroll ${op} inside ${named} a part of the page that scrolls on its own — a sidebar, panel, feed or chat — not the page itself; the extent Choice saying how far`
}

/** The screens each fixed rung moves. */
const RUNG_SCREENS: Readonly<Record<Exclude<ExtentRung, 'words' | 'end'>, number>> = { little: 1 / 3, screen: 1, lot: 3 }

/**
 * How far a scroll goes (ADR 0085): the rung's screens, or the number the
 * words carry, in screens; `end` as far as there is. A `words` rung whose
 * words carry no number is told as the `screen` it fell back to — the rung
 * when the words say nothing of how far.
 */
export function scrollExtent(rung: ExtentRung, words: string): ScrollExtent {
  if (rung === 'end') return { rung }
  if (rung === 'words') {
    const screens = firstNumber(words)
    return screens !== null && screens > 0 ? { rung, screens } : scrollExtent('screen', words)
  }
  return { rung, screens: RUNG_SCREENS[rung] }
}

/** An Extent as "Done so far" and the Feed name it: `a screen`, `a third of a screen`, `3 screens`, `to the end`, `to the top`. */
export function describeExtent(extent: ScrollExtent, op: ScrollOp): string {
  if (extent.rung === 'end' || extent.screens === undefined) return op === 'down' ? 'to the end' : 'to the top'
  if (extent.rung === 'little') return 'a third of a screen'
  return extent.screens === 1 ? 'a screen' : `${extent.screens} screens`
}

/** The Extent Choice (ADR 0085): read only when the action is a Scroll Op or the page's own scroll. */
export function extentQuestion(): DecisionChoiceQuestion {
  return {
    type: 'choice',
    instructions: 'Only when the action scrolls the page or a scrolling part of it: how far? Choose words when the words give a number of screens or pages; screen when they say nothing of how far. Ignored for every other action.',
    options: {
      words: 'as many screens as the number the words carry',
      little: 'a little: a third of a screen',
      screen: 'one screen, as Page Down does',
      lot: 'a lot: three screens',
      end: 'all the way: to the bottom, or to the top going up',
    },
  }
}
