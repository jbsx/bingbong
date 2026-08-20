// The voice never speaks markdown again (#52). The model is prompted to keep
// the "speak" field plain prose, but it leaks sometimes — so this pure
// stripper runs at the speaking gate seam, the one boundary every spoken line
// crosses (pipeline answers, download announcements, confirmation prompts).
// Markers go, words stay: emphasis and code punctuation disappear, link URLs
// are replaced by their labels, headings and bullets read as plain sentences.

/** Fenced code blocks: the fence line (``` / ~~~ with optional language) goes, the code text stays. */
const FENCE_LINE = /^\s*(?:`{3,}|~{3,}).*$/
/** A standalone `---` / `***` / `___` line — spoken as nothing. */
const THEMATIC_BREAK_LINE = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/
/** Leading heading markers, with or without the customary space. */
const HEADING_MARKERS = /^ {0,3}#{1,6}[ \t]*/
/** Unordered list bullets (`-`, `*`, `+`) — ordered numbers read naturally and stay. */
const LIST_BULLET = /^ {0,3}[-*+][ \t]+/
/** Blockquote markers. */
const BLOCKQUOTE = /^ {0,3}>[ \t]?/
/** Markdown links and images: `[label](url "title")` — the label is spoken, the URL never is. The url part tolerates one nesting level of parens, as in Wikipedia URLs. */
const LINK = /!?\[([^\]]*)\]\((?:[^()]*|\([^()]*\))+\)/g
/** Inline code: the backtick run goes, the code words stay. */
const INLINE_CODE = /(`+)([\s\S]*?)\1/g
/** Paired emphasis: strong first, then italics. */
const BOLD_ASTERISK = /\*\*([^*]+)\*\*/g
const BOLD_UNDERSCORE = /__([^_]+)__/g
const ITALIC_ASTERISK = /\*([^*]+)\*/g
// Underscore italics only at word boundaries — intraword underscores belong
// to identifiers like snake_case, which are left exactly as written.
const ITALIC_UNDERSCORE = /(^|[^A-Za-z0-9_])_([^_]+)_(?![A-Za-z0-9_])/g

/**
 * Strips markdown from text destined for the speech synthesizer. Structural
 * markers (fences, headings, bullets, breaks) are dropped line-wise; spans
 * (links, code, emphasis) are unwrapped so only the spoken words remain.
 */
export function stripMarkdownForSpeech(text: string): string {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => !FENCE_LINE.test(line) && !THEMATIC_BREAK_LINE.test(line))
    .map((line) => line.replace(HEADING_MARKERS, '').replace(LIST_BULLET, '').replace(BLOCKQUOTE, ''))

  return lines
    .join('\n')
    .replace(LINK, '$1')
    .replace(INLINE_CODE, '$2')
    .replace(BOLD_ASTERISK, '$1')
    .replace(BOLD_UNDERSCORE, '$1')
    .replace(ITALIC_ASTERISK, '$1')
    .replace(ITALIC_UNDERSCORE, '$1$2')
    .replace(/\*/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]{2,}/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
