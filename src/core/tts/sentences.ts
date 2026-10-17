// Sentence streaming (#327, ADR 0076): a spoken text is cut into sentences,
// so the first is synthesized and playing while the rest are still being
// rendered. The cut runs after the markdown is stripped (speakingGate.ts):
// every line of the text is a block, a block without a sentence end is a
// sentence, and inside a block a sentence ends at `.`, `!`, `?` or `…`
// before whitespace — not after an initial or a common abbreviation.

/** A word ending a sentence: its terminal punctuation, then any closing quotes or brackets. */
const SENTENCE_END = /[.!?…]+["'”’)\]]*$/
const CLOSERS = /["'”’)\]]+$/

/** Abbreviations a period follows without ending the sentence, lower-cased, without the period. */
const ABBREVIATIONS: ReadonlySet<string> = new Set([
  'mr', 'mrs', 'ms', 'dr', 'st', 'jr', 'sr', 'prof', 'vs', 'etc', 'inc', 'ltd', 'co', 'fig', 'no', 'approx', 'mt',
])

/** Whether a word ends its sentence: terminal punctuation, and not an initial (`J.`), a dotted abbreviation (`e.g.`) or a known one (`Dr.`). */
function endsSentence(word: string): boolean {
  if (!SENTENCE_END.test(word)) return false
  const bare = word.replace(CLOSERS, '')
  if (!bare.endsWith('.') || bare.endsWith('..')) return true
  const stem = bare.slice(0, -1).replace(/^["'“‘(\[]+/, '')
  if (/^\p{L}$/u.test(stem)) return false
  if (/^(?:\p{L}\.)+\p{L}$/u.test(stem)) return false
  return !ABBREVIATIONS.has(stem.toLowerCase())
}

/** The sentences of a text, in order, each with its whitespace collapsed; none for a blank text. */
export function splitSentences(text: string): string[] {
  const sentences: string[] = []
  for (const block of text.split(/\r\n?|\n/)) {
    const words = block.split(/\s+/).filter((word) => word !== '')
    let current: string[] = []
    for (const word of words) {
      current.push(word)
      if (endsSentence(word)) {
        sentences.push(current.join(' '))
        current = []
      }
    }
    if (current.length > 0) sentences.push(current.join(' '))
  }
  return sentences
}
