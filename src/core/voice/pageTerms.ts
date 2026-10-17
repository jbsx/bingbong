// Page Terms (CONTEXT.md, ADR 0077, #325): the names the page shows right
// now — link titles, channel names, search suggestions, the page's title —
// ranked and capped, so the STT decoder can be biased toward them for the
// one Utterance spoken over this page, and the Name Match can read a
// misheard Slot against them. Pure: text in, phrases out. No DOM, no
// model.
//
// A term is a run of name-like words — capitalised, all-caps or carrying a
// digit — of at most four words, the way a Learned Term is a phrase and
// not a sentence. Everyday words the recogniser already hears are not the
// point: every term here is a name a near-tie could flip to.

/** What the extractor reads of a page. */
export interface PageTermsSource {
  readonly title: string
  /** The refs' labels: link titles, button text, the options of an open suggestion list. */
  readonly labels: readonly string[]
  /** The text blocks meeting the viewport. */
  readonly text: readonly string[]
}

/** How many Page Terms one Utterance is biased toward. */
export const PAGE_TERMS_CAP = 64

/** A term is a phrase, not a sentence: at most four words, like a Learned Term. */
const MAX_TERM_WORDS = 4

/** Words that never make a term on their own and never open or close one. */
const FUNCTION_WORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'of', 'on', 'in', 'at', 'to', 'for', 'and', 'or', 'but', 'by', 'with', 'from', 'as', 'is', 'are', 'was', 'be',
  'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you', 'we', 'they', 'he', 'she', 'my', 'your', 'our', 'their', 'his', 'her',
  'new', 'more', 'all', 'how', 'why', 'what', 'when', 'where', 'who', 'vs', 'via', 'not', 'no', 'yes', 'up', 'down', 'out', 'off',
])

function strip(token: string): string {
  return token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
}

/** Whether a word is the kind a name is made of: capitalised, all-caps, or carrying a digit. */
function nameLike(word: string): boolean {
  if (word === '') return false
  if (FUNCTION_WORDS.has(word.toLowerCase())) return false
  if (/\p{N}/u.test(word)) return true
  const first = word[0]!
  return first !== first.toLowerCase() && first === first.toUpperCase()
}

interface Seen {
  term: string
  count: number
  words: number
  order: number
}

/**
 * The Page Terms of a page: every run of name-like words in the title, the
 * labels and the viewport text — a run longer than four words is its
 * first four — counted across the page and ranked by count, then by
 * length, then by first appearance; the top {@link PAGE_TERMS_CAP}. A
 * single word that only ever opens its text is left out: a sentence's
 * first word is capitalised whether it is a name or not.
 */
export function pageTermsOf(source: PageTermsSource, cap = PAGE_TERMS_CAP): string[] {
  const seen = new Map<string, Seen>()
  /** Single words seen anywhere but at the start of a text. */
  const midText = new Set<string>()
  let order = 0
  const note = (words: readonly string[], opensText: boolean): void => {
    const term = words.join(' ').toLowerCase()
    if (words.length === 1 && !opensText) midText.add(term)
    const entry = seen.get(term)
    if (entry !== undefined) entry.count += 1
    else seen.set(term, { term, count: 1, words: words.length, order: order++ })
  }
  for (const text of [source.title, ...source.labels, ...source.text]) {
    // A token that is only punctuation ("-", "|", "·") breaks a run: the names either side of it are two.
    const tokens = text.split(/\s+/).map(strip)
    let run: string[] = []
    let runStart = 0
    const flush = (): void => {
      if (run.length > 0) note(run.slice(0, MAX_TERM_WORDS), runStart === 0)
      run = []
    }
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i]!
      if (nameLike(token)) {
        if (run.length === 0) runStart = i
        run.push(token)
      } else flush()
    }
    flush()
  }
  return [...seen.values()]
    .filter((entry) => entry.words > 1 || midText.has(entry.term) || entry.count > 1)
    .sort((a, b) => b.count - a.count || b.words - a.words || a.order - b.order)
    .slice(0, cap)
    .map((entry) => entry.term)
}
