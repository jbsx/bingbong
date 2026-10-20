import { describe, expect, it } from 'vitest'
import { decodeParakeetTokens, parseParakeetVocab } from './parakeetVocab'

// Parakeet's vocab.txt (#358): one "piece id" per line, SentencePiece
// pieces with '▁' as a leading space, the TDT blank last.

const VOCAB_TXT = ['<unk> 0', '▁open 1', '▁the 2', 'ed 3', '. 4', '▁x 5', ', 6', '<blk> 7'].join('\n') + '\n'

describe('parseParakeetVocab', () => {
  it('maps every piece to its id and names the blank', () => {
    const vocab = parseParakeetVocab(VOCAB_TXT)
    expect(vocab.pieces).toEqual(['<unk>', '▁open', '▁the', 'ed', '.', '▁x', ',', '<blk>'])
    expect(vocab.blankId).toBe(7)
  })

  it('never renders the blank or <unk>', () => {
    const vocab = parseParakeetVocab(VOCAB_TXT)
    expect([...vocab.specialIds].sort()).toEqual([0, 7])
  })

  it('rejects a vocab with no blank', () => {
    expect(() => parseParakeetVocab('▁a 0\n')).toThrow(/<blk>/)
  })
})

describe('decodeParakeetTokens', () => {
  const vocab = parseParakeetVocab(VOCAB_TXT)

  it('joins pieces with their spaces and drops the leading one', () => {
    expect(decodeParakeetTokens(vocab, [1, 2, 5])).toBe('open the x')
  })

  it('glues word continuations and punctuation to the word before', () => {
    expect(decodeParakeetTokens(vocab, [1, 3, 6, 2, 4])).toBe('opened, the.')
  })

  it('drops specials', () => {
    expect(decodeParakeetTokens(vocab, [0, 1, 7])).toBe('open')
  })
})
