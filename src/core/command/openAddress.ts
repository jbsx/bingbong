import { normalizeUrlInput, searchUrl } from '../browser/urlInput'

// Where `open` goes (#324, ADR 0076): a bare word with no dot or space is
// `https://<word>.com`, a URL is navigated, and anything else is a
// DuckDuckGo search — the browser's own reading of typed words
// (`normalizeUrlInput`), with the bare-word rule and spoken punctuation in
// front of it.

/** "youtube dot com" is `youtube.com`; "slash" is `/`. Only between words, so "dot" the word survives alone. */
function spokenPunctuation(slot: string): string {
  return slot
    .trim()
    .replace(/\s+dot\s+/gi, '.')
    .replace(/\s+slash\s+/gi, '/')
}

/** The address an `open` Slot names, or the search it runs when it names none. */
export function openAddress(slot: string, search = false): string {
  const spoken = spokenPunctuation(slot)
  if (search) return searchUrl(spoken)
  if (/^[a-z0-9-]+$/i.test(spoken)) return `https://${spoken.toLowerCase()}.com`
  return normalizeUrlInput(spoken) ?? searchUrl(spoken)
}
