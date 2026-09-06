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
 * Ref identity across a scroll. Ref numbers are positions in the current
 * viewport, so they renumber every collect; what makes a ref the same ref
 * is what the model reads — its kind, its label, and where it points.
 */
function refIdentity(ref: SnapshotRef): string {
  return [ref.kind, ref.inputType ?? '', ref.label, ref.href ?? ref.src ?? ''].join('\u0001')
}

/** Refs of `after` that were not already in `before`, counting duplicates:
 * a third "Subscribe" button is new when only two were in view before. */
function refsEnteringView(before: PageSnapshot, after: PageSnapshot): SnapshotRef[] {
  const remaining = new Map<string, number>()
  for (const ref of before.refs) {
    const key = refIdentity(ref)
    remaining.set(key, (remaining.get(key) ?? 0) + 1)
  }
  return after.refs.filter((ref) => {
    const key = refIdentity(ref)
    const count = remaining.get(key) ?? 0
    if (count === 0) return true
    remaining.set(key, count - 1)
    return false
  })
}

/**
 * The block a scroll returns in place of the page read it used to force
 * (#194): the refs and text that entered the viewport, numbered and
 * formatted exactly as `read_page` prints them, under the same caps.
 * Null when the scroll brought nothing new in — the caller says
 * `end of page` instead.
 */
export function formatNewInView(before: PageSnapshot, after: PageSnapshot): string | null {
  const refs = refsEnteringView(before, after).slice(0, MAX_SNAPSHOT_REFS)
  const seen = new Set(before.viewportText)
  const text = after.viewportText.filter((block) => !seen.has(block))
  if (refs.length === 0 && text.length === 0) return null
  const lines = [NEW_IN_VIEW, ...refs.map(formatRefLine)]
  if (text.length > 0) lines.push('page text:', truncateText(text.join('\n'), MAX_SNAPSHOT_TEXT))
  return lines.join('\n')
}
