// Minimal HTML→text for research subagents: an excerpt a model can read, not
// a browser-grade extractor. Script/style/head content is dropped, block tags
// become newlines, common entities decode, and the result is capped.

const DROP_BLOCK_RE = /<(script|style|head|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1>/gi
const COMMENT_RE = /<!--[\s\S]*?-->/g
const BLOCK_TAG_RE = /<\/?(p|div|h[1-6]|li|ul|ol|tr|table|section|article|header|footer|nav|aside|main|blockquote|pre|br)\b[^>]*>/gi
const ANY_TAG_RE = /<[^>]+>/g
const WHITESPACE_RE = /[ \t]+/g

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&mdash;': '—',
  '&ndash;': '–',
  '&#8212;': '—',
  '&#8211;': '–',
}

export const HTML_EXCERPT_CHAR_LIMIT = 8_000

function decodeEntities(text: string): string {
  return text.replace(/&(?:[a-z]+|#\d+);/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? entity)
}

export function htmlToText(html: string): string {
  const stripped = html
    .replace(DROP_BLOCK_RE, ' ')
    .replace(COMMENT_RE, ' ')
    .replace(BLOCK_TAG_RE, '\n')
    .replace(ANY_TAG_RE, '')
    .replace(/\r/g, '')
    .replace(WHITESPACE_RE, ' ')

  const lines = stripped
    .split('\n')
    .map((line) => decodeEntities(line).trim())
    .filter((line) => line !== '')

  const joined = lines.join('\n')
  return joined.length > HTML_EXCERPT_CHAR_LIMIT
    ? `${joined.slice(0, HTML_EXCERPT_CHAR_LIMIT - 1)}…`
    : joined
}
