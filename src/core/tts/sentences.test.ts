import { describe, expect, it } from 'vitest'
import { splitSentences } from './sentences'

// Sentence streaming (#327): a spoken text is cut into sentences so the
// first can play while the rest are synthesized. A block without a
// sentence end is a sentence of its own.

describe('splitSentences', () => {
  it('cuts a paragraph at its sentence ends', () => {
    expect(splitSentences('The cat sat. The dog ran! Did it rain? Yes.')).toEqual(['The cat sat.', 'The dog ran!', 'Did it rain?', 'Yes.'])
  })

  it('takes each block as its own sentence when it has no sentence end', () => {
    expect(splitSentences('Main menu\nHome page title\n\nThe story begins here. It goes on.')).toEqual([
      'Main menu',
      'Home page title',
      'The story begins here.',
      'It goes on.',
    ])
  })

  it('keeps a closing quote or bracket with its sentence', () => {
    expect(splitSentences('He said "stop." Then (quietly.) he left.')).toEqual(['He said "stop."', 'Then (quietly.)', 'he left.'])
  })

  it('does not cut after a common abbreviation, an initial or inside a number', () => {
    expect(splitSentences('Dr. Smith met J. R. Tolkien at 3.5 p.m. e.g. on a Monday. Then left.')).toEqual([
      'Dr. Smith met J. R. Tolkien at 3.5 p.m. e.g. on a Monday.',
      'Then left.',
    ])
  })

  it('collapses inner whitespace and drops empty blocks', () => {
    expect(splitSentences('  \n  One   two.\t\n\n  ')).toEqual(['One two.'])
    expect(splitSentences('')).toEqual([])
  })
})
