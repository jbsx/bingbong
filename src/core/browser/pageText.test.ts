import { describe, expect, it } from 'vitest'
import {
  MAX_PAGE_READ_TEXT,
  pageReadPartLine,
  partPastTheEnd,
  previewFactLine,
  renderPageText,
  splitPageRead,
  type CollectedTextBlock,
} from './pageText'

// ADR 0047: what a page's text is made of, how a Page Read cuts it into
// parts, and the fact lines a cut preview and a multi-part read end with.

describe('renderPageText — tables, pre and definition lists are text (#235/AC3)', () => {
  it('renders a table row as one block, cells joined by " | ", header rows included', () => {
    const { blocks } = renderPageText([
      { kind: 'row', cells: ['Ticket', 'Luggage', 'Hand luggage'] },
      { kind: 'row', cells: ['Standard', '2 pieces of luggage', '1 piece of hand luggage'] },
    ])
    expect(blocks).toEqual(['Ticket | Luggage | Hand luggage', 'Standard | 2 pieces of luggage | 1 piece of hand luggage'])
  })

  it('keeps empty cells in place so values stay under their headers, and drops a row with no text', () => {
    const { blocks } = renderPageText([
      { kind: 'row', cells: ['', 'Price'] },
      { kind: 'row', cells: ['', ''] },
    ])
    expect(blocks).toEqual([' | Price'])
  })

  it('keeps a pre block’s line breaks and indentation, trimming trailing space and blank edges', () => {
    const { blocks } = renderPageText([{ kind: 'pre', text: '\n== Camera Module 3  \r\n\n  sensor: IMX708\n\n' }])
    expect(blocks).toEqual(['== Camera Module 3\n\n  sensor: IMX708'])
  })

  it('renders definition lists as term: definition, one block per definition', () => {
    const { blocks } = renderPageText([
      {
        kind: 'definitions',
        items: [
          { term: true, text: 'Launch' },
          { term: false, text: '5 September 1977' },
          { term: true, text: 'Mass' },
          { term: true, text: 'Weight' },
          { term: false, text: '825.5 kg' },
          { term: false, text: 'at launch' },
          { term: false, text: 'An orphan definition' },
        ],
      },
    ])
    expect(blocks).toEqual(['Launch: 5 September 1977', 'Mass, Weight: 825.5 kg', 'Mass, Weight: at launch', 'Mass, Weight: An orphan definition'])
  })

  it('a term with no definition still reads as text', () => {
    const { blocks } = renderPageText([{ kind: 'definitions', items: [{ term: true, text: 'Dangling' }] }])
    expect(blocks).toEqual(['Dangling'])
  })

  it('keeps blocks in the order collected and repeats identical rows, but not identical prose', () => {
    const { blocks } = renderPageText([
      { kind: 'text', text: 'Voyager 1', heading: true },
      { kind: 'text', text: 'Voyager 1' },
      { kind: 'text', text: 'Read more' },
      { kind: 'row', cells: ['Yes', 'Yes'] },
      { kind: 'row', cells: ['Yes', 'Yes'] },
      { kind: 'text', text: 'Read more' },
      { kind: 'text', text: '' },
    ])
    expect(blocks).toEqual(['Voyager 1', 'Read more', 'Yes | Yes', 'Yes | Yes'])
  })

  it('collects the blocks in view as the viewport text, capped per block and in count', () => {
    const long = 'x'.repeat(400)
    const collected: CollectedTextBlock[] = [
      { kind: 'text', text: 'Above the fold', inView: false },
      { kind: 'row', cells: ['a', 'b'], inView: true },
      { kind: 'text', text: long, inView: true },
      { kind: 'row', cells: ['a', 'b'], inView: true },
      ...Array.from({ length: 80 }, (_, index): CollectedTextBlock => ({ kind: 'text', text: `p${index}`, inView: true })),
    ]
    const { viewportText } = renderPageText(collected)
    expect(viewportText.slice(0, 3)).toEqual(['a | b', 'x'.repeat(300), 'p0'])
    expect(viewportText).toHaveLength(60)
  })
})

describe('splitPageRead — a Page Read in parts (#235/AC1)', () => {
  it('returns one part holding the whole text when it fits', () => {
    expect(splitPageRead(['One.', 'Two.'])).toEqual(['One.\nTwo.'])
  })

  it('returns a single empty part for a page with no text', () => {
    expect(splitPageRead([])).toEqual([''])
  })

  it('cuts at the last block boundary under the cap, part 1 from the top', () => {
    const block = (letter: string) => `${letter.repeat(99)} `.repeat(30).trim()
    const blocks = ['A', 'B', 'C', 'D', 'E'].map(block)
    const parts = splitPageRead(blocks)
    expect(blocks[0]!.length).toBe(2999)
    expect(parts).toEqual([blocks.slice(0, 4).join('\n'), blocks[4]])
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(MAX_PAGE_READ_TEXT)
  })

  it('splits a block larger than the cap at whitespace, never mid-word', () => {
    const words = Array.from({ length: 3000 }, (_, index) => `word${index}`)
    const parts = splitPageRead(['Intro.', words.join(' ')], 1000)
    expect(parts[0]).toBe('Intro.')
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(1000)
      expect(part).toMatch(/^(Intro\.|word\d+( word\d+)*)$/)
    }
    expect(parts.slice(1).join(' ')).toBe(words.join(' '))
  })

  it('cuts a line-broken block at a line break when one is under the cap', () => {
    const lines = Array.from({ length: 50 }, (_, index) => `line ${index} ${'.'.repeat(40)}`)
    const parts = splitPageRead([lines.join('\n')], 500)
    expect(parts.join('\n')).toBe(lines.join('\n'))
    for (const part of parts) expect(part.split('\n').every((line) => lines.includes(line))).toBe(true)
  })

  it('hard-cuts a run with no whitespace at the cap', () => {
    const parts = splitPageRead(['z'.repeat(2500)], 1000)
    expect(parts.map((part) => part.length)).toEqual([1000, 1000, 500])
  })
})

describe('fact lines (#235/AC1, AC2)', () => {
  it('names shown and total characters on a cut preview', () => {
    expect(previewFactLine(1800, 7412)).toBe('page text: first 1,800 of 7,412 characters — read_page returns the whole text')
  })

  it('points a multi-part read at its next part, and says which part is the last', () => {
    expect(pageReadPartLine(1, 3)).toBe('page text: part 1 of 3 — read_page part=2 continues')
    expect(pageReadPartLine(3, 3)).toBe('page text: part 3 of 3 — the last part')
    expect(pageReadPartLine(1, 1)).toBeNull()
  })

  it('does not call the last part collected the last when the collector stopped at its bound', () => {
    expect(pageReadPartLine(19, 20, true)).toBe('page text: part 19 of 20 — read_page part=20 continues')
    expect(pageReadPartLine(20, 20, true)).toBe(
      "page text: part 20 of 20 — the most one page read collects; the page's text continues past it",
    )
  })

  it('names the range when a part is past the end', () => {
    expect(partPastTheEnd(4, 3)).toBe("read_page: part 4 is past the end — this page's text has 3 parts, part=1 to part=3")
    expect(partPastTheEnd(2, 1)).toBe("read_page: part 2 is past the end — this page's text has 1 part, part=1")
  })
})
