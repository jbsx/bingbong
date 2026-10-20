// The Voice Prompt (ADR 0078, #359): the Prompt Bar's F1 form — orb, hint,
// waveform, the voice state, and while an Utterance is taken the live
// partial words with a Page Term in peach. Pure: words and terms in,
// spans out.

export interface PartialSpan {
  text: string
  /** The span is a Page Term the page shows. */
  term: boolean
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The live words split into spans, each Page Term found in them as whole
 * words (any case) marked — where two terms start at the same word, the
 * longer wins.
 */
export function partialSpans(text: string, terms: readonly string[]): PartialSpan[] {
  const usable = [...new Set(terms.map((term) => term.trim()).filter((term) => term !== ''))].sort((a, b) => b.length - a.length)
  if (usable.length === 0 || text === '') return [{ text, term: false }]
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${usable.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}])`, 'giu')
  const spans: PartialSpan[] = []
  let last = 0
  for (const match of text.matchAll(pattern)) {
    const start = match.index
    if (start > last) spans.push({ text: text.slice(last, start), term: false })
    spans.push({ text: match[0], term: true })
    last = start + match[0].length
  }
  if (last < text.length) spans.push({ text: text.slice(last), term: false })
  return spans
}

/** What ends the Utterance being taken (#357): the turn check when the words are done, else the Pause cap of quiet, in seconds. */
export function quietLine(pauseCapMs: number): string {
  return `ends when you finish — ${Number((pauseCapMs / 1000).toFixed(2))} s at most`
}
