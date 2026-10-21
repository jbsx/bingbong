/**
 * Which Settings section the index marks while the page is scrolled by hand.
 *
 * A section is "at the top" once its heading has come within `reach` pixels
 * of the scroll's top edge; the last such section down the page is marked.
 * The last sections can never reach the top (there is nothing below them to
 * scroll), so once the scroll is at its end the last section is the one
 * marked, whatever sits at the top.
 */
export interface SectionTop {
  readonly id: string
  /** The section's top, in pixels below the scroll's top edge (negative once scrolled past). */
  readonly top: number
}

export interface ScrollPlace {
  readonly scrollTop: number
  readonly clientHeight: number
  readonly scrollHeight: number
}

/** How near the scroll's top edge a section's heading must come to be marked. */
export const SECTION_REACH_PX = 40

/** Sub-pixel slack: a zoomed page stops a fraction short of its exact end. */
const END_SLACK_PX = 2

export function markedSection(sections: readonly SectionTop[], place: ScrollPlace, reach = SECTION_REACH_PX): string | undefined {
  if (sections.length === 0) return undefined
  const atEnd = place.scrollHeight > place.clientHeight && place.scrollTop + place.clientHeight >= place.scrollHeight - END_SLACK_PX
  if (atEnd) return sections[sections.length - 1]!.id
  let at = sections[0]!.id
  for (const { id, top } of sections) {
    if (top <= reach) at = id
  }
  return at
}
