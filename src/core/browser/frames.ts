// The page is the top document and every Reachable Frame (#377, ADR 0081).
// Each frame is collected in its own context; here the answers become one
// page: a frame's elements take its iframe's place in document order, at
// the top viewport's coordinates (every ancestor iframe's content-box
// origin summed), each named by its frame's host. Jev sees one flat
// numbering; underneath, each element keeps its address — the frame it was
// read in and its index in that frame's own registry.

import { renderPageText, type CollectedTextBlock } from './pageText'
import type { CollectedElement, CollectedPage } from './snapshot'

/** Where a collected element lives: its frame (null for the top document) and its index in that frame's registry. */
export interface FrameAddress {
  readonly frame: string | null
  readonly index: number
}

/** One frame's own collect, and where it hangs: its parent's key, null when its parent is the top document. */
export interface CollectedFrame {
  readonly key: string
  readonly parentKey: string | null
  readonly page: CollectedPage
}

/** The page as one, and each of its elements' addresses, index for index. */
export interface MergedPage {
  readonly page: CollectedPage
  readonly addresses: readonly FrameAddress[]
}

/** How many elements the merged page carries at most: the collector's own bound on one document. */
const MAX_MERGED_ELEMENTS = 400

/** How much of an open dialog's text a collect carries: the collector's own bound on the top's. */
const MAX_COLLECTED_DIALOG_TEXT = 400

/** A frame's host as a ref line names it, without `www.`; the address itself when it has none. */
export function frameHostOf(url: string): string {
  const host = URL.canParse(url) ? new URL(url).hostname : ''
  return host === '' ? url : host.replace(/^www\./, '')
}

/** A Reachable Frame's iframe is larger than this in both directions (ADR 0081): a tracking pixel is no frame to read. */
const MIN_FRAME_PX = 2

/** Whether an iframe can hold a Reachable Frame: its box is larger than {@link MIN_FRAME_PX} each way. Rendered and meeting the viewport, the collector already judged. */
function reachable(iframe: CollectedElement): boolean {
  return iframe.rect.width > MIN_FRAME_PX && iframe.rect.height > MIN_FRAME_PX
}

/** Whether a rect meets the top viewport — the rule a top element met in the page, applied to a frame's at the page's coordinates. */
function meetsViewport(rect: CollectedElement['rect'], viewport: CollectedPage['viewport']): boolean {
  return rect.width >= 1 && rect.height >= 1 && rect.y + rect.height > 0 && rect.x + rect.width > 0 && rect.y < viewport.height && rect.x < viewport.width
}

/**
 * The page as one (#377): `frames` are the frames that answered in time,
 * each paired with its iframe by its slot in the parent's `window.frames`.
 * A frame's elements take its iframe's place and its layer — a frame in
 * the top's open dialog is the dialog's — and those of the page layer that
 * fall outside the top viewport are left out, as a top element would be.
 * An iframe whose frame did not answer stays its opaque ref — the
 * challenge detection's signal (ADR 0007) — and any frame 2×2 px or
 * smaller contributes nothing, as does a nested frame whose iframe falls
 * outside the top viewport outside a dialog. A frame whose elements joined the page
 * puts its text at its iframe's place in the text too (#378), and every
 * other frame's place reads as nothing. `previous` is the last
 * collect's addresses: an element's `previousIndex`, its own frame's,
 * becomes its place in that whole page; without it, the top's stand.
 */
export function mergeFrames(top: CollectedPage, frames: readonly CollectedFrame[], previous?: readonly FrameAddress[]): MergedPage {
  const elements: CollectedElement[] = []
  const addresses: FrameAddress[] = []
  // The frames whose elements joined the page: the frames whose text joins it too (#378).
  const joined = new Set<string>()
  // Those whose iframe sits in the top's open dialog, in document order: the dialog's own text goes on in theirs.
  const inDialog: string[] = []
  const childOf = (key: string | null, slot: number | undefined): CollectedFrame | undefined =>
    slot === undefined ? undefined : frames.find((candidate) => candidate.parentKey === key && candidate.page.frameIndex === slot)
  const previousPlace = (key: string | null, index: number | undefined): number => {
    if (index === undefined || index < 0) return -1
    if (previous === undefined) return key === null ? index : -1
    return previous.findIndex((address) => address.frame === key && address.index === index)
  }

  const expand = (page: CollectedPage, key: string | null, offset: { x: number; y: number }, layer: CollectedElement['layer']): void => {
    page.elements.forEach((element, index) => {
      if (element.tag === 'iframe') {
        if (!reachable(element)) return
        const child = childOf(key, element.frameIndex)
        // A nested frame meets the top viewport as any of its frame's elements must; the top's own iframes the collector judged.
        const inView = key === null || layer === 'dialog' || meetsViewport({ ...element.rect, x: element.rect.x + offset.x, y: element.rect.y + offset.y }, top.viewport)
        if (child !== undefined && element.frameBox !== undefined && inView) {
          joined.add(child.key)
          if (key === null && element.layer === 'dialog') inDialog.push(child.key)
          expand(child.page, child.key, { x: offset.x + element.frameBox.x, y: offset.y + element.frameBox.y }, key === null ? element.layer : layer)
          return
        }
      }
      const previousIndex = previousPlace(key, element.previousIndex)
      if (key === null) {
        elements.push({ ...element, previousIndex })
      } else {
        const { x, y, width, height } = element.rect
        const rect = { x: x + offset.x, y: y + offset.y, width, height }
        if (layer !== 'dialog' && !meetsViewport(rect, top.viewport)) return
        elements.push({ ...element, rect, layer: layer ?? 'page', previousIndex, frameHost: frameHostOf(page.origin !== undefined && page.origin !== 'null' ? page.origin : page.url) })
      }
      addresses.push({ frame: key, index })
    })
  }
  expand(top, null, { x: 0, y: 0 }, 'page')

  // A frame's text at its iframe's place (#378): each place marker gives way to its frame's own blocks, or to nothing.
  let textCut = top.textCut === true
  const textOf = (page: CollectedPage, key: string | null): CollectedTextBlock[] =>
    (page.textBlocks ?? []).flatMap((block) => {
      if (block.kind !== 'frame') return [block]
      const child = childOf(key, block.slot)
      if (child === undefined || !joined.has(child.key)) return []
      if (child.page.textCut === true) textCut = true
      return textOf(child.page, child.key)
    })
  const text = top.textBlocks === undefined ? {} : { textBlocks: textOf(top, null), textCut }

  // A wall served in a frame (#378): the top's dialog holds only its iframe,
  // whose own text is no prose of the top's. Its frame's text is the
  // dialog's, wherever the iframe sits — outside the main landmark, as a
  // consent manager's container usually is, it has no place in the page text.
  const framed = inDialog.flatMap((key) => {
    const read = frames.find((candidate) => candidate.key === key)
    return read === undefined ? [] : renderPageText(textOf(read.page, key)).blocks
  })
  const dialog = framed.length === 0 ? {} : { dialogText: [top.dialogText ?? '', ...framed].filter((part) => part !== '').join(' ').slice(0, MAX_COLLECTED_DIALOG_TEXT) }

  // A Player Switch names its element by its own document's index (#389): it becomes the element's place in the whole page, or goes with it.
  const kept = elements.slice(0, MAX_MERGED_ELEMENTS)
  const placed = addresses.slice(0, MAX_MERGED_ELEMENTS)
  const merged = kept.map((element, at) => {
    if (element.switches === undefined) return element
    const switches = element.switches.flatMap((toggle) => {
      const index = placed.findIndex((address) => address.frame === placed[at].frame && address.index === toggle.index)
      return index < 0 ? [] : [{ ...toggle, index }]
    })
    return { ...element, switches }
  })

  return { page: { ...top, ...text, ...dialog, elements: merged }, addresses: placed }
}
