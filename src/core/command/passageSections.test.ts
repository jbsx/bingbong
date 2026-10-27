import { describe, expect, it } from 'vitest'
import type { TextBlockKind } from '../browser/pageText'
import { sectionsOf } from './passageSections'

const of = (...kinds: (TextBlockKind | '')[]) => kinds.map((kind) => (kind === '' ? {} : { kind }))

describe('the sections of Text in view (#482): by the kinds the collect tagged, the same rule on every site', () => {
  it('a heading opens a section that runs to the next heading, whatever the blocks under it are', () => {
    // Playwright's README: "Playwright Test", its line; "Install", a command, "Or add manually:", a command; "Write a test", its code.
    expect(sectionsOf(of('heading', '', 'heading', 'code', '', 'code', 'heading', 'code'))).toEqual([[0, 1], [2, 3, 4, 5], [6, 7]])
  })

  it('before any heading, consecutive rows, items or code join into one run; a paragraph stands alone', () => {
    expect(sectionsOf(of('', 'list item', 'list item', 'list item', '', 'table row', 'table row', 'code', 'code', ''))).toEqual([[0], [1, 2, 3], [4], [5, 6], [7, 8], [9]])
  })

  it('a run of one kind ends where another kind starts', () => {
    expect(sectionsOf(of('list item', 'list item', 'table row', 'table row'))).toEqual([[0, 1], [2, 3]])
  })

  it('takes every block into exactly one section, in reading order', () => {
    const blocks = of('', 'heading', 'list item', 'list item', '', 'heading', 'heading', 'table row')
    expect(sectionsOf(blocks).flat()).toEqual(blocks.map((_, at) => at))
  })

  it('has no section for no blocks', () => {
    expect(sectionsOf([])).toEqual([])
  })
})
