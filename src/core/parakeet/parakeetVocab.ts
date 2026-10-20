import type { MoonshineVocab } from '../moonshine/bpeTokenizer.ts'

// Parakeet TDT's tokenizer half (#358): the onnx-asr export ships vocab.txt,
// one "piece id" per line — SentencePiece pieces where '▁' marks a leading
// space, '<unk>' first and the TDT blank '<blk>' last. The parsed vocab has
// Moonshine's shape, so the contextual biasing (ADR 0022) indexes it as is.

export interface ParakeetVocab extends MoonshineVocab {
  /** The blank: the joint's "emit nothing at this frame". */
  readonly blankId: number
}

export function parseParakeetVocab(text: string): ParakeetVocab {
  const pieces: string[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    const split = line.lastIndexOf(' ')
    const id = Number(line.slice(split + 1))
    if (split <= 0 || !Number.isInteger(id) || id < 0) throw new Error(`vocab.txt line is not "piece id": ${line}`)
    pieces[id] = line.slice(0, split)
  }
  for (let id = 0; id < pieces.length; id++) pieces[id] ??= ''
  const blankId = pieces.indexOf('<blk>')
  if (blankId === -1) throw new Error('vocab.txt has no <blk> piece')
  const specialIds = new Set([blankId])
  const unk = pieces.indexOf('<unk>')
  if (unk !== -1) specialIds.add(unk)
  return { pieces, specialIds, blankId }
}

/**
 * Token ids → text, as the reference decoder prints it: pieces join with
 * '▁' read as a space, and a space survives only before a word character —
 * never at the start, never before punctuation.
 */
export function decodeParakeetTokens(vocab: MoonshineVocab, tokens: readonly number[]): string {
  let text = ''
  for (const token of tokens) {
    if (vocab.specialIds.has(token)) continue
    text += (vocab.pieces[token] ?? '').replaceAll('▁', ' ')
  }
  return text.replace(/\s(?![\p{L}\p{N}_])/gu, '').replace(/^\s/, '')
}
