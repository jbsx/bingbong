import type { RegionFacts } from './snapshot'

// A Scroll Op's shape (#383, ADR 0085): what the browser port fires on a
// Scroll Region's own element, and how far the Extent says a scroll goes,
// page or region. The card that offers the ops and reads the Extent lives
// in core/command/scrollOp.ts; this is the part the browser side depends
// on, so no port points inward.

/** The ops a Scroll Region carries, in the order the card offers them. */
export const SCROLL_OPS = ['down', 'up'] as const
export type ScrollOp = (typeof SCROLL_OPS)[number]

/** The Extent's rungs (ADR 0085): how far a scroll moves, Jev's to choose; `end` is the top when going up. */
export const EXTENT_RUNGS = ['words', 'little', 'screen', 'lot', 'end'] as const
export type ExtentRung = (typeof EXTENT_RUNGS)[number]

/** How far a scroll goes: the rung read and the screens it came to; none for `end`, which goes as far as there is. */
export interface ScrollExtent {
  readonly rung: ExtentRung
  readonly screens?: number
}

/** What a Scroll Op says in place of its changes when the region did not move (CONTEXT.md, End of Region): it was at its end, or its top. */
export const SCROLL_END_OF_REGION = 'end of region'

/** Whether a card label is a Scroll Op's. */
export function isScrollOp(label: string): label is ScrollOp {
  return (SCROLL_OPS as readonly string[]).includes(label)
}

/** One wheel notch, as Chromium scrolls it. */
export const NOTCH_PX = 120

/**
 * How many wheel notches the page scroll fires for this many screens (ADR
 * 0085): a screen is the viewport's height over a notch, rounded up; at
 * least one notch, so a third of a short screen still moves.
 */
export function notchesFor(screens: number, viewportHeight: number): number {
  return Math.max(1, Math.round(screens * Math.ceil(viewportHeight / NOTCH_PX)))
}

/** Within a pixel of the top or the end reads as there: a zoomed page scrolls on fractional pixels. */
const SLACK_PX = 1

/** Where a region stands: `at top`, `at end`, or `scrolled 40%` of the way. */
export function regionPositionOf(facts: RegionFacts): string {
  const room = facts.height - facts.view
  if (facts.top <= SLACK_PX) return 'at top'
  if (facts.top >= room - SLACK_PX) return 'at end'
  return `scrolled ${Math.round((facts.top / room) * 100)}%`
}

/** A region's length in screens: its content over its view, at least one. */
function screensOf(facts: RegionFacts): number {
  return Math.max(1, Math.round(facts.height / facts.view))
}

/** A Scroll Region's state as its line carries it (ADR 0085): its position and its length in screens. */
export function regionStateOf(facts: RegionFacts): string {
  const screens = screensOf(facts)
  return `${regionPositionOf(facts)} ${screens} ${screens === 1 ? 'screen' : 'screens'}`
}

/** What a Scroll Op moved, in the words its outcome and "Done so far" share: `at top → scrolled 35%`; null when it did not move. */
export function regionChangeOf(before: RegionFacts, after: RegionFacts): string | null {
  const [from, to] = [regionPositionOf(before), regionPositionOf(after)]
  return Math.abs(after.top - before.top) <= SLACK_PX || from === to ? null : `${from} → ${to}`
}
