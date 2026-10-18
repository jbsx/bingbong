import { looksLikeDomain, normalizeUrlInput, searchUrl } from '../browser/urlInput'

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

/**
 * Whether an `open` Slot is shaped like an address — a bare word
 * ("youtube"), a host ("news.ycombinator.com", "youtube dot com"), a URL,
 * localhost — rather than words about the page ("the first result"). The
 * Local Match settles only the former without asking Jev.
 */
export function isAddressShaped(slot: string): boolean {
  const spoken = spokenPunctuation(slot)
  if (spoken === '') return false
  return /^[a-z0-9-]+$/i.test(spoken) || looksLikeDomain(spoken) || /^(?:https?|file|about):/i.test(spoken) || /^localhost(?::\d+)?$/i.test(spoken)
}

/**
 * The address an `open` Slot names, or the search it runs when it names
 * none; a search with a Site Scope (#340) runs as `site:<host>` ahead of
 * the words.
 */
export function openAddress(slot: string, search = false, site?: string): string {
  const spoken = spokenPunctuation(slot)
  if (search) return searchUrl(site === undefined ? spoken : `site:${site} ${spoken}`)
  if (/^[a-z0-9-]+$/i.test(spoken)) return `https://${spoken.toLowerCase()}.com`
  return normalizeUrlInput(spoken) ?? searchUrl(spoken)
}
