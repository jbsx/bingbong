import { looksLikeDomain, normalizeUrlInput, searchUrl } from '../browser/urlInput'

// Where a `navigate` goes and what a `search` runs (#324, ADR 0076, #353):
// a bare word with no dot or space is `https://<word>.com`, a URL is
// navigated — the browser's own reading of typed words (`normalizeUrlInput`),
// with the bare-word rule and spoken punctuation in front of it — and a
// search is a DuckDuckGo search of the words, `site:<host>` ahead of them
// when it has a Site Scope.

/** "youtube dot com" is `youtube.com`; "slash" is `/`. Only between words, so "dot" the word survives alone. */
function spokenPunctuation(slot: string): string {
  return slot
    .trim()
    .replace(/\s+dot\s+/gi, '.')
    .replace(/\s+slash\s+/gi, '/')
}

/**
 * Whether a Slot is shaped like an address — a bare word ("youtube"), a
 * host ("news.ycombinator.com", "youtube dot com"), a URL, localhost —
 * rather than words about something ("the first result"). The Local Match
 * navigates only the former without asking Jev; Jev's `navigate` of words
 * that are no address is read as the words point (`readCommandAnswers`).
 */
export function isAddressShaped(slot: string): boolean {
  const spoken = spokenPunctuation(slot)
  if (spoken === '') return false
  return /^[a-z0-9-]+$/i.test(spoken) || looksLikeDomain(spoken) || /^(?:https?|file|about):/i.test(spoken) || /^localhost(?::\d+)?$/i.test(spoken)
}

/** The address a `navigate` Slot names: a bare word's `.com`, else the browser's reading of it; words that are no address search for themselves. */
export function navigateAddress(slot: string): string {
  const spoken = spokenPunctuation(slot)
  if (/^[a-z0-9-]+$/i.test(spoken)) return `https://${spoken.toLowerCase()}.com`
  return normalizeUrlInput(spoken) ?? searchUrl(spoken)
}

/** The search a `search` Slot runs: the words, with `site:<host>` ahead of them under a Site Scope (#340). */
export function searchAddress(slot: string, site?: string): string {
  const spoken = spokenPunctuation(slot)
  return searchUrl(site === undefined ? spoken : `site:${site} ${spoken}`)
}
