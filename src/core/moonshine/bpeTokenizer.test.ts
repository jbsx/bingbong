import { describe, expect, it } from 'vitest'
import { decodeMoonshineTokens, parseMoonshineTokenizer } from './bpeTokenizer'

// Moonshine Base ships a SentencePiece-BPE tokenizer (Llama-style): '<unk>'=0,
// '<s>'=1, '</s>'=2, the 256 '<0xNN>' byte-fallback pieces, then merge pieces
// where '▁' (U+2581) marks a leading space. Decoding follows the tokenizer's
// own decoder spec (replace ▁ with space, fuse byte runs as UTF-8, strip one
// leading space) — the shape the #39 A/B harness turns token ids into text.

/** A minimal tokenizer.json in the exact shape HuggingFace exports. */
function tokenizerJson(vocab: Record<string, number>, special: { id: number; content: string }[] = []) {
  return JSON.stringify({
    added_tokens: special.map((t) => ({ id: t.id, content: t.content, special: true })),
    model: { type: 'BPE', unk_token: '<unk>', vocab },
  })
}

describe('parseMoonshineTokenizer', () => {
  it('reads the vocab as id → piece and collects the special ids', () => {
    const vocab = parseMoonshineTokenizer(
      tokenizerJson({ '<unk>': 0, '<s>': 1, '</s>': 2, '▁And': 3, 'so': 4 }, [{ id: 1, content: '<s>' }, { id: 2, content: '</s>' }]),
    )
    expect(vocab.pieces[3]).toBe('▁And')
    expect(vocab.pieces[4]).toBe('so')
    expect([...vocab.specialIds].sort()).toEqual([1, 2])
  })

  it('rejects non-object vocab garbage instead of exploding later', () => {
    expect(() => parseMoonshineTokenizer('{"model":{"vocab":[]}}')).toThrow(/vocab/)
    expect(() => parseMoonshineTokenizer('not json')).toThrow()
  })
})

describe('decodeMoonshineTokens', () => {
  const vocab = parseMoonshineTokenizer(
    tokenizerJson(
      { '<unk>': 0, '<s>': 1, '</s>': 2, '<0x41>': 61, '<0xE2>': 62, '<0x96>': 63, '<0x88>': 64, '▁And': 3, '▁so': 5, '▁my': 6 },
      [
        { id: 0, content: '<unk>' },
        { id: 1, content: '<s>' },
        { id: 2, content: '</s>' },
      ],
    ),
  )

  it('joins pieces with ▁ as the space marker and strips the leading space', () => {
    expect(decodeMoonshineTokens(vocab, [1, 3, 5, 6, 2])).toBe('And so my')
  })

  it('skips special tokens and unknown ids', () => {
    expect(decodeMoonshineTokens(vocab, [1, 3, 99, 2])).toBe('And')
  })

  it('fuses consecutive byte-fallback tokens as UTF-8', () => {
    // 0xE2 0x96 0x88 is '█' in UTF-8; 0x41 is 'A'.
    expect(decodeMoonshineTokens(vocab, [62, 63, 64, 61])).toBe('█A')
  })

  it('flushes a byte run before a regular piece, keeping the order', () => {
    expect(decodeMoonshineTokens(vocab, [3, 61, 5])).toBe('AndA so')
  })

  it('degrades an invalid UTF-8 byte run to the replacement character', () => {
    expect(decodeMoonshineTokens(vocab, [64])).toBe('\uFFFD')
  })

  it('decodes only specials to empty text', () => {
    expect(decodeMoonshineTokens(vocab, [1, 2])).toBe('')
  })
})
