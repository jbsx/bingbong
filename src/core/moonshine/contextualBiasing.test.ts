import { describe, expect, it } from 'vitest'
import type { MoonshineVocab } from './bpeTokenizer'
import { parseMoonshineTokenizer } from './bpeTokenizer'
import { createBiasApplier } from './contextualBiasing'

// The pure half of STT contextual biasing (#62): a phrase trie over the
// bias lexicon plus the decoded suffix of the current pass decides, at each
// greedy step, whether a lexicon phrase could start or continue here and
// which token pieces would carry it forward — those pieces get a logit
// boost before the argmax. No audio, no model: decoded text + a logits row
// in, next token id out.

function vocabOf(pieces: Record<string, number>): MoonshineVocab {
  return parseMoonshineTokenizer(
    JSON.stringify({
      added_tokens: [
        { id: 1, content: '<s>', special: true },
        { id: 2, content: '</s>', special: true },
      ],
      model: { type: 'BPE', vocab: { '<unk>': 0, '<s>': 1, '</s>': 2, ...pieces } },
    }),
  )
}

/** A one-row logits tensor ([1, 1, vocabSize]) with the given picks. */
function row(vocabSize: number, picks: Record<number, number>): { data: Float32Array; dims: number[] } {
  const data = new Float32Array(vocabSize)
  for (const [id, score] of Object.entries(picks)) data[Number(id)] = score
  return { data, dims: [1, 1, vocabSize] }
}

describe('createBiasApplier', () => {
  it('boosts the space-led piece of a phrase starting at the next word over the acoustic argmax', () => {
    const vocab = vocabOf({ '▁pedal': 3, '▁panel': 4 })
    const applier = createBiasApplier(vocab, ['panel'])

    // The mishear case: acoustics favor 'pedal', with 'panel' close behind.
    // Decoded so far ends at a word boundary, so the phrase "panel" can
    // start at the next token — its word-start piece gets the boost.
    const logits = row(5, { 3: 2, 4: 1 })
    expect(applier.nextToken('open the', logits)).toBe(4)
  })

  it('is a no-op when no phrase continuation is in contention — plain argmax stands', () => {
    const vocab = vocabOf({ '▁panel': 3, '▁wider': 4, 'l': 5 })
    const applier = createBiasApplier(vocab, ['panel'])

    // Mid-word "peda" prefixes no phrase; finishing "pedal" ('l') wins by
    // more than the boost margin, so the bias cannot flip anything.
    const logits = row(6, { 3: 0.5, 5: 5 })
    expect(applier.nextToken('close the peda', logits)).toBe(5)
    // And a confident word-start argmax stands too: "wider" is not in the
    // lexicon and leads ' panel' by more than the boost.
    const wordStart = row(6, { 3: 1, 4: 4 })
    expect(applier.nextToken('make it', wordStart)).toBe(4)
  })

  it('boosts pieces continuing a partially decoded phrase — mid-word and across words', () => {
    // Mid-word: "pan" is a live prefix of "panel", so the bare 'el' piece
    // that completes the phrase beats an acoustically favored new word —
    // case-insensitively.
    const midWord = vocabOf({ 'el': 3, '▁america': 4 })
    const midWordApplier = createBiasApplier(midWord, ['panel'])
    expect(midWordApplier.nextToken('open the pan', row(5, { 3: 0.5, 4: 2 }))).toBe(3)

    // Across words: "feed" completes the first word of "feed panel", so
    // ' panel' continues the phrase while ' pedal' does not.
    const multiWord = vocabOf({ '▁pedal': 3, '▁panel': 4 })
    const multiWordApplier = createBiasApplier(multiWord, ['feed panel'])
    expect(multiWordApplier.nextToken('open the feed', row(5, { 3: 2, 4: 1 }))).toBe(4)
    // But an incomplete first word ("fee") leaves no usable continuation:
    // the rest is "d panel", which no whole piece here can start.
    expect(multiWordApplier.nextToken('open the fee', row(5, { 3: 2, 4: 1 }))).toBe(3)
  })

  it('anchors matches at word starts — a mid-word stem never activates a phrase', () => {
    // Unanchored suffix matching would read the "he" at the end of "the"
    // as a prefix of "help" and boost 'lp'. Word starts are the anchor,
    // so 'lp' gets nothing and the plain argmax stands.
    const vocab = vocabOf({ '▁hello': 3, 'lp': 4 })
    const applier = createBiasApplier(vocab, ['help'])
    expect(applier.nextToken('open the', row(5, { 3: 3, 4: 2 }))).toBe(3)
  })

  it('scores the last logits row — earlier rows are decoder history', () => {
    const vocab = vocabOf({ '▁panel': 3, '▁pedal': 4 })
    const applier = createBiasApplier(vocab, ['panel'])
    const data = new Float32Array(3 * 5)
    // An early row screams 'panel'; the last row favors 'pedal' by more
    // than the boost — only the last row scores the next token.
    data[0 * 5 + 3] = 9
    data[2 * 5 + 3] = 0
    data[2 * 5 + 4] = 5
    expect(applier.nextToken('open the', { data, dims: [1, 3, 5] })).toBe(4)
  })
})
