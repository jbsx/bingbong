// Reading text out of the HTML and XML some NewsSources answer: no parser
// for a page we only take a few strings from, just the tags stripped, the
// CDATA unwrapped and the entities decoded.

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' }

/** `&amp;`, `&#8217;` and `&#x2019;` as the characters they name; an entity it does not know is left as written. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (entity, name: string) => {
    if (name.startsWith('#')) {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity
    }
    return NAMED[name.toLowerCase()] ?? entity
  })
}

/** A fragment's text: CDATA unwrapped, tags dropped, entities decoded, whitespace collapsed. */
export function textOf(fragment: string): string {
  // A feed's CDATA holds HTML as often as text, so its tags go too.
  const unwrapped = fragment.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  return decodeEntities(unwrapped.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}
