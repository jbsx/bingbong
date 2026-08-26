// STT contextual biasing, pure half (#62): a trie over the bias lexicon's
// phrases plus the decoded suffix of the pass in flight decides, at each
// greedy step, whether a lexicon phrase could start or continue here and
// which token pieces would carry it forward — those pieces get a logit
// boost before the argmax. No audio, no model, no extra decode passes:
// decoded text + a logits row in, next token id out.
//
// Match semantics (word boundaries are the anchor):
// - A phrase is a word sequence, matched case-insensitively from a word
//   start of the decoded text ("open the feed" matches the phrase prefix
//   "feed" of "feed panel").
// - Word-start match (nothing of the phrase decoded yet, m = 0): the phrase
//   may start at the NEXT token, so its rest carries a leading space and
//   only space-led pieces ('▁panel') can take the boost — a bare fragment
//   can never begin a phrase word. These rests are live at every step
//   (decoded text never ends in a space; the next piece carries its own),
//   which is standard static-lexicon shallow fusion: word starts get a
//   constant bonus, and only near-ties flip. This is the boost that kills
//   one-token mishears ("pedal" for "panel").
// - Partial match (m ≥ 1): pieces prefixing the phrase's remaining text
//   are boosted; a remaining " panel" again means space-led pieces, a
//   remaining "el" means bare continuations.
// - A fully decoded phrase boosts nothing — the bias got what it wanted.

import type { MoonshineVocab } from './bpeTokenizer'

/** Logit lift for a piece that continues a lexicon phrase: near-ties flip
 * (a ~2.0 margin beats acoustically similar garbage); confident argmaxes
 * stand. */
export const DEFAULT_BIAS_BOOST = 2

/** A decoder logits tensor ([1, seq, vocab]); the LAST row scores the next token. */
export interface LogitsTensor {
  data: ArrayLike<number>
  dims: readonly number[]
}

const BYTE_PIECE = /^<0x[0-9A-Fa-f]{2}>$/

/** Decides the greedy next token for one decode step under bias. */
export interface BiasApplier {
  /**
   * @param decoded text decoded from the tokens so far this pass
   * @param logits decoder logits; the LAST row scores the next token
   * @returns the (possibly biased) argmax token id
   */
  nextToken(decoded: string, logits: LogitsTensor): number
}

/** A trie node over phrase characters. */
interface PhraseNode {
  children: Map<string, PhraseNode>
  /** Rests of every phrase passing through this node ("" = ends here). */
  rests: string[]
}

/** A trie node over token-piece texts (the '▁'-as-space decoded form). */
interface PieceNode {
  children: Map<string, PieceNode>
  /** Token ids whose full piece text is exactly the path here. */
  ids: number[]
}

function normalizePhrases(phrases: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const phrase of phrases) {
    const words = phrase.toLowerCase().trim().split(/\s+/).filter(Boolean)
    if (words.length === 0) continue
    const normalized = words.join(' ')
    if (seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

function buildPhraseTrie(phrases: readonly string[]): PhraseNode {
  const root: PhraseNode = { children: new Map(), rests: [] }
  for (const phrase of phrases) {
    let node = root
    for (let i = 0; i < phrase.length; i++) {
      const char = phrase[i]
      let next = node.children.get(char)
      if (!next) {
        next = { children: new Map(), rests: [] }
        node.children.set(char, next)
      }
      node = next
      node.rests.push(phrase.slice(i + 1))
    }
  }
  return root
}

function buildPieceTrie(vocab: MoonshineVocab): PieceNode {
  const root: PieceNode = { children: new Map(), ids: [] }
  for (let id = 0; id < vocab.pieces.length; id++) {
    if (vocab.specialIds.has(id)) continue
    const piece = vocab.pieces[id]
    if (piece === '' || BYTE_PIECE.test(piece)) continue
    const text = piece.replaceAll('▁', ' ').toLowerCase()
    let node = root
    for (const char of text) {
      let next = node.children.get(char)
      if (!next) {
        next = { children: new Map(), ids: [] }
        node.children.set(char, next)
      }
      node = next
    }
    node.ids.push(id)
  }
  return root
}

/**
 * Continuations the decoded suffix leaves open: for every phrase whose
 * prefix (≥ 1 char) is matched from a word start, the remaining text; plus
 * every whole phrase with a leading space, so only word-starting pieces
 * can take the word-start boost.
 */
function activeRests(decoded: string, trie: PhraseNode, wordStartRests: readonly string[]): string[] {
  const lower = decoded.toLowerCase()
  const rests: string[] = []

  for (let i = 0; i < lower.length; i++) {
    if (i !== 0 && lower[i - 1] !== ' ') continue // phrase matches start at word starts
    let node: PhraseNode | undefined = trie
    for (let k = i; k < lower.length; k++) {
      node = node.children.get(lower[k])
      if (!node) break
      for (const rest of node.rests) if (rest !== '') rests.push(rest)
    }
  }

  // The word-start rests are a pure function of the phrase set, not the
  // decoded text — precomputed at construction (ADR 0022: a 500-term
  // lexicon must not rebuild 500 strings at every greedy step).
  rests.push(...wordStartRests)
  return rests
}

export function createBiasApplier(vocab: MoonshineVocab, phrases: readonly string[]): BiasApplier {
  const boost = DEFAULT_BIAS_BOOST
  const normalized = normalizePhrases(phrases)
  const phraseTrie = buildPhraseTrie(normalized)
  const pieceTrie = buildPieceTrie(vocab)
  const wordStartRests = normalized.map((phrase) => ` ${phrase}`)

  return {
    nextToken(decoded, logits) {
      const seq = logits.dims[1]
      const vocabSize = logits.dims[2]
      const row = logits.data
      const base = (seq - 1) * vocabSize
      let best = 0
      let bestScore = -Infinity
      for (let v = 0; v < vocabSize; v++) {
        const score = row[base + v]
        if (score > bestScore) {
          bestScore = score
          best = v
        }
      }

      const boosted = new Set<number>()
      for (const rest of activeRests(decoded, phraseTrie, wordStartRests)) {
        let node: PieceNode | undefined = pieceTrie
        for (let k = 0; k < rest.length; k++) {
          node = node.children.get(rest[k])
          if (!node) break
          for (const id of node.ids) {
            if (boosted.has(id)) continue
            boosted.add(id)
            if (row[base + id] + boost > bestScore) {
              bestScore = row[base + id] + boost
              best = id
            }
          }
        }
      }
      return best
    },
  }
}
