import type { TextBlockKind } from '../browser/pageText'

// The Answer Passage by section (#482, ADR 0087): an answer spread over a
// heading and the blocks under it, or over a run of table rows, list items
// or code, is one passage, never the one block of it that happens to carry
// the most probability. Sections come from the kinds the collect already
// tags (`TextBlockKind`), the same rule on every site.
//
// Two finer rules were measured on the gate's passage cases and moved
// nothing (#482): a run of two or more breaking out of a heading's section
// that already has a body, and a heading with no body joining the next
// heading's section. A measured tie: the plain rule stands.

/** The kinds whose consecutive blocks are one run. */
const RUN_KINDS: ReadonlySet<TextBlockKind> = new Set(['table row', 'list item', 'code'])

/**
 * The sections of the blocks of Text in view, in reading order, each the
 * places (from 0) of its blocks: a heading opens a section that runs to the
 * next heading; before any heading, consecutive blocks of one run kind join
 * and every other block stands alone. Every block is in exactly one section.
 */
export function sectionsOf(blocks: readonly { readonly kind?: TextBlockKind }[]): number[][] {
  const sections: number[][] = []
  let underHeading = false
  blocks.forEach((block, at) => {
    const current = sections.at(-1)
    const kind = block.kind
    const continuesRun = kind !== undefined && RUN_KINDS.has(kind) && blocks[at - 1]?.kind === kind
    if (kind !== 'heading' && current !== undefined && (underHeading || continuesRun)) {
      current.push(at)
      return
    }
    sections.push([at])
    if (kind === 'heading') underHeading = true
  })
  return sections
}
