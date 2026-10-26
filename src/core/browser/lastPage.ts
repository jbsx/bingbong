import type { BrowserPaneState } from './paneState'

// The Last Page (CONTEXT.md): the page the pane last showed, kept across a
// restart so the Idle Screen can name it and `resume` can reopen it. Nothing
// on this branch resets the pane, so while the app runs the Last Page is the
// live page; after a restart it is what the pane boots without.

export interface LastPage {
  readonly url: string
  readonly title: string
  /** Wall-clock ms when the page was last seen. */
  readonly at: number
}

/** Whether an address is a page worth coming back to: not the pane's blank boot page, not an error page. */
export function isRealPage(url: unknown): url is string {
  return typeof url === 'string' && /^https?:\/\//i.test(url)
}

/**
 * The back guard (#336): a step back from a real page to the blank start
 * page the Idle Screen or `resume` opened it from leads nowhere — there is
 * no page to go back to. `before` is the address one step back, if any.
 */
export function backLeadsToBlank(current: string, before: string | undefined): boolean {
  return before !== undefined && isRealPage(current) && !isRealPage(before)
}

/**
 * The Last Page after one pane state: the state's page when it is a real one
 * (the title following along as it arrives), else what it was. The pane
 * names an untitled page by its address; that is no title. A title set on
 * another document is not this page's either (#450): an in-page navigation
 * leaves the old page's title in the pane until the new one sets its own.
 */
export function lastPageFrom(previous: LastPage | null, state: Pick<BrowserPaneState, 'url' | 'title' | 'titleUrl'>, now: number): LastPage | null {
  if (!isRealPage(state.url)) return previous
  const trimmed = sameDocument(state.titleUrl, state.url) ? state.title.trim() : ''
  const title = trimmed === state.url ? '' : trimmed
  const samePage = previous !== null && previous.url === state.url
  if (samePage && (title === '' || previous.title === title)) return previous
  return { url: state.url, title: title === '' && samePage ? previous.title : title, at: now }
}

/** Two addresses of one document: the same but for the fragment after `#`. */
function sameDocument(a: string, b: string): boolean {
  return a.split('#')[0] === b.split('#')[0]
}

/** A persisted Last Page read back, or null for anything that is not one. */
export function sanitizeLastPage(raw: unknown): LastPage | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Record<string, unknown>
  if (!isRealPage(record.url)) return null
  const title = typeof record.title === 'string' ? record.title : ''
  const at = typeof record.at === 'number' && Number.isFinite(record.at) ? record.at : 0
  return { url: record.url, title, at }
}

/** Second-level labels a country's registrable names sit under: bbc.co.uk is "bbc", not "co". */
const COUNTRY_SECOND_LEVELS = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu'])

/** Letters and digits only, lower case: "Stack Overflow" and "stackoverflow" read alike. */
function bare(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

/** A host's registrable name: youtube.com is "youtube", news.ycombinator.com "ycombinator", bbc.co.uk "bbc". */
function siteName(host: string): string {
  const labels = host.replace(/:\d+$/, '').split('.')
  if (labels.length < 2) return labels[0] ?? ''
  const countrySecond = labels.length >= 3 && labels[labels.length - 1].length === 2 && COUNTRY_SECOND_LEVELS.has(labels[labels.length - 2])
  return labels[labels.length - (countrySecond ? 3 : 2)]
}

/**
 * A title without its trailing site name where that only repeats the host
 * shown beside it: "Fixture Song - YouTube" beside youtube.com is "Fixture
 * Song", "Issues · x | GitHub" beside github.com loses " | GitHub". A tail
 * after " - ", " | ", " – " or " — " is dropped only when it is the host's
 * own name or the host itself, letters and digits alike whatever the case;
 * "BBC News" beside bbc.co.uk is more than the host says and stays.
 */
export function withoutSiteTail(title: string, host: string): string {
  const match = /^(.*\S)\s+[-|–—]\s+([^|–—]+)$/u.exec(title)
  if (match === null) return title
  const tail = bare(match[2])
  return tail !== '' && (tail === bare(siteName(host)) || tail === bare(host)) ? match[1] : title
}

/**
 * The words of an address's path (#450): its last segment that holds a
 * letter, decoded, its extension dropped and `-`, `_` and `+` read as
 * spaces — /blog/some_long-post.html is "some long post". '' for a bare host.
 */
function pathWords(url: URL): string {
  const segments = url.pathname.split('/').map((segment) => {
    try {
      return decodeURIComponent(segment)
    } catch {
      return segment
    }
  })
  const last = segments.filter((segment) => /\p{L}/u.test(segment)).at(-1) ?? ''
  return last
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .replace(/[-_+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * What the Idle Screen shows of a Last Page: its title, less a tail naming
 * the host beside it. A page with no title, or whose title is only its
 * site's name, is named by the words of its path, else by its host (#450).
 */
export function lastPageLabel(page: Pick<LastPage, 'url' | 'title'>): { title: string; host: string } {
  // A persisted address that no longer parses: the address itself stands in.
  const url = URL.canParse(page.url) ? new URL(page.url) : null
  const host = url !== null ? url.host.replace(/^www\./, '') : page.url
  const title = page.title !== '' ? withoutSiteTail(page.title, host) : ''
  if (title !== '' && bare(title) !== bare(siteName(host))) return { title, host }
  const words = url !== null ? pathWords(url) : ''
  return { title: words !== '' ? words : host, host }
}
