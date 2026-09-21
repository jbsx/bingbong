// ADR 0047: a page's text, as the in-page collector finds it and as the
// model reads it. The collector does the DOM work — which elements and
// which runs of a container's own prose are blocks, in document order, a
// block taken whole, and which blocks intersect the viewport — and hands
// back each block raw. Everything that decides what the model reads happens here, where it
// is unit-tested: how a table row, a pre block and a definition list render,
// which repeats are dropped, how a Page Read is cut into parts, and the fact
// lines that say a text was cut.

/** One text block as the page collector reports it (#235). */
export type CollectedTextBlock = (
  | {
      kind: 'text'
      /** Whitespace already collapsed. */
      text: string
      /** The page's h1, collected first; a later block with its text repeats it. */
      heading?: boolean
    }
  | { kind: 'row'; cells: string[] }
  | {
      kind: 'pre'
      /** The element's rendered text, line breaks intact. */
      text: string
    }
  | {
      kind: 'definitions'
      /** The list's dt (`term`) and dd entries, in document order. */
      items: { term: boolean; text: string }[]
    }
) & {
  /** Whether the block intersects the viewport right now (#194). */
  inView?: boolean
}

/** The most text one Page Read result carries (ADR 0047). */
export const MAX_PAGE_READ_TEXT = 12_000

/**
 * The most page text one collect carries: twenty parts. A bound on the
 * payload every Action Outcome's collect serializes, not on what a read may
 * cut — a page past it reads as the parts collected.
 */
export const MAX_COLLECTED_PAGE_TEXT = 20 * MAX_PAGE_READ_TEXT

/** Viewport text blocks kept for a scroll's New In View (#194), and the length each is held to. */
export const MAX_VIEWPORT_TEXT_BLOCKS = 60
export const MAX_VIEWPORT_TEXT_BLOCK_LENGTH = 300

/** A page's text: every block, and the blocks in view (#194). */
export interface PageText {
  blocks: string[]
  viewportText: string[]
}

function renderPre(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .replace(/^\n+|\n+$/g, '')
}

/**
 * A definition list as `term: definition` lines, one per definition.
 * Consecutive terms share their definitions; a term with none still reads
 * as text, and a definition with no term is the definition alone.
 */
function renderDefinitions(items: readonly { term: boolean; text: string }[]): string[] {
  const lines: string[] = []
  let terms: string[] = []
  let defined = false
  for (const item of items) {
    if (item.term) {
      if (defined) {
        terms = []
        defined = false
      }
      if (item.text !== '') terms.push(item.text)
      continue
    }
    defined = true
    if (item.text === '') continue
    lines.push(terms.length > 0 ? `${terms.join(', ')}: ${item.text}` : item.text)
  }
  if (!defined && terms.length > 0) lines.push(terms.join(', '))
  return lines
}

function renderBlock(block: CollectedTextBlock): string[] {
  switch (block.kind) {
    case 'text':
      return block.text === '' ? [] : [block.text]
    case 'row':
      return block.cells.some((cell) => cell !== '') ? [block.cells.join(' | ')] : []
    case 'pre': {
      const text = renderPre(block.text)
      return text === '' ? [] : [text]
    }
    case 'definitions':
      return renderDefinitions(block.items)
  }
}

/**
 * The page's text blocks in collected order, and the ones in view. Prose
 * that repeats earlier prose word for word (the h1 restated, a second "Read
 * more") is dropped, as the page text always was; table rows and definitions
 * are data, and an identical row is still a row.
 */
export function renderPageText(collected: readonly CollectedTextBlock[]): PageText {
  const blocks: string[] = []
  const viewportText: string[] = []
  const prose = new Set<string>()
  for (const block of collected) {
    const lines = renderBlock(block)
    if (lines.length === 0) continue
    if (block.kind === 'text') {
      if (!prose.has(lines[0]!)) blocks.push(lines[0]!)
      prose.add(lines[0]!)
    } else {
      blocks.push(...lines)
    }
    if (block.inView === true && viewportText.length < MAX_VIEWPORT_TEXT_BLOCKS) {
      const inView = lines.join('\n').slice(0, MAX_VIEWPORT_TEXT_BLOCK_LENGTH)
      if (!viewportText.includes(inView)) viewportText.push(inView)
    }
  }
  return { blocks, viewportText }
}

/**
 * Where to cut a block longer than the cap: the last line break at or under
 * it, else the last whitespace, else the cap itself (a run with no
 * whitespace cannot be cut at a word). Returns the cut and how many
 * characters the cut consumes.
 */
function cutOversized(text: string, cap: number): { at: number; skip: number } {
  const window = text.slice(0, cap + 1)
  const newline = window.lastIndexOf('\n')
  if (newline > 0) return { at: newline, skip: 1 }
  for (let index = Math.min(cap, text.length - 1); index > 0; index--) {
    if (/\s/.test(text[index]!)) return { at: index, skip: 1 }
  }
  return { at: cap, skip: 0 }
}

/**
 * A Page Read's parts (ADR 0047): the blocks joined by line breaks, each
 * part as many whole blocks as fit under the cap. A block longer than the
 * cap is cut inside itself at a line break or a word boundary. Always at
 * least one part — a page with no text reads as one empty part.
 */
export function splitPageRead(blocks: readonly string[], cap: number = MAX_PAGE_READ_TEXT): string[] {
  const parts: string[] = []
  let current = ''
  for (const block of blocks) {
    if (block === '') continue
    const joined = current === '' ? block : `${current}\n${block}`
    if (joined.length <= cap) {
      current = joined
      continue
    }
    if (current !== '') parts.push(current)
    let rest = block
    while (rest.length > cap) {
      const { at, skip } = cutOversized(rest, cap)
      parts.push(rest.slice(0, at))
      rest = rest.slice(at + skip)
    }
    current = rest
  }
  if (current !== '' || parts.length === 0) parts.push(current)
  return parts
}

const count = (value: number): string => value.toLocaleString('en-US')

/** The line a cut Page Preview ends with (ADR 0047). */
export function previewFactLine(shown: number, total: number): string {
  return `page text: first ${count(shown)} of ${count(total)} characters — read_page returns the whole text`
}

/**
 * The line a Page Read of a multi-part page ends with; null when the page is
 * one part. `cut` says the collector stopped at MAX_COLLECTED_PAGE_TEXT, so
 * the last part collected is not the end of the page's text.
 */
export function pageReadPartLine(part: number, of: number, cut = false): string | null {
  if (part < of) return `page text: part ${part} of ${of} — read_page part=${part + 1} continues`
  if (cut) return `page text: part ${part} of ${of} — the most one page read collects; the page's text continues past it`
  return of <= 1 ? null : `page text: part ${part} of ${of} — the last part`
}

/** The refusal for a part the page does not have, naming the range. */
export function partPastTheEnd(part: number, of: number): string {
  const range = of === 1 ? '1 part, part=1' : `${of} parts, part=1 to part=${of}`
  return `read_page: part ${part} is past the end — this page's text has ${range}`
}
