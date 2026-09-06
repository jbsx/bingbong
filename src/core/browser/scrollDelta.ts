import {
  MAX_SNAPSHOT_REFS,
  MAX_SNAPSHOT_TEXT,
  formatRefLine,
  truncateText,
  type PageSnapshot,
  type SnapshotRef,
} from './snapshot'

/**
 * What a scroll that brought nothing new into the viewport says (#194).
 * Also the marker the no-progress rail reads: a scroll that ends on this
 * note moved the window without moving the page, so the repeat guard
 * treats it as no change (core/pipeline/noProgressRail.ts).
 */
export const SCROLL_END_OF_PAGE = 'end of page'

/** The heading a scroll's delta block opens with. */
const NEW_IN_VIEW = 'new in view:'

/**
 * Ref identity across a scroll, by DOM node (ADR 0033). The collector
 * reports where each element sat in the collect before this one, so a ref
 * that was already in view is recognised as itself and only a genuinely
 * new element is listed — where a kind/label/href tuple read two unlabeled
 * buttons as one and the same.
 */
function enteredView(ref: SnapshotRef): boolean {
  return (ref.previousIndex ?? -1) < 0
}

/**
 * What a scroll returns in place of the page read it used to force (#194),
 * and which numbers it showed doing so. The block holds the refs and text
 * that entered the viewport, numbered and formatted exactly as `read_page`
 * prints them, under the same caps; `shownRefs` is what the controller
 * overlays onto the shown registry, because those are the only numbers the
 * model was handed (ADR 0033). Null when the scroll brought nothing new in
 * — the caller says `end of page` instead.
 */
export interface NewInView {
  block: string
  shownRefs: number[]
}

export function formatNewInView(before: PageSnapshot, after: PageSnapshot): NewInView | null {
  // The snapshot already holds at most MAX_SNAPSHOT_REFS refs, so the delta
  // is bounded by construction; the slice states that bound rather than
  // relying on it.
  const refs = after.refs.filter(enteredView).slice(0, MAX_SNAPSHOT_REFS)
  const seen = new Set(before.viewportText)
  const text = after.viewportText.filter((block) => !seen.has(block))
  if (refs.length === 0 && text.length === 0) return null
  const lines = [NEW_IN_VIEW, ...refs.map(formatRefLine)]
  // A page read says how many refs the cap withheld; so does the delta, or
  // the model would read the listed refs as everything the viewport holds.
  if (after.truncated) lines.push(`(+${after.totalVisible - after.refs.length} more not listed)`)
  if (text.length > 0) lines.push('page text:', truncateText(text.join('\n'), MAX_SNAPSHOT_TEXT))
  return { block: lines.join('\n'), shownRefs: refs.map((ref) => ref.ref) }
}
