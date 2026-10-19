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
 * names an untitled page by its address; that is no title.
 */
export function lastPageFrom(previous: LastPage | null, state: Pick<BrowserPaneState, 'url' | 'title'>, now: number): LastPage | null {
  if (!isRealPage(state.url)) return previous
  const trimmed = state.title.trim()
  const title = trimmed === state.url ? '' : trimmed
  const samePage = previous !== null && previous.url === state.url
  if (samePage && (title === '' || previous.title === title)) return previous
  return { url: state.url, title: title === '' && samePage ? previous.title : title, at: now }
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

/** What the Idle Screen shows of a Last Page: its title, or its host when it has none. */
export function lastPageLabel(page: Pick<LastPage, 'url' | 'title'>): { title: string; host: string } {
  // A persisted address that no longer parses: the address itself stands in.
  const host = URL.canParse(page.url) ? new URL(page.url).host.replace(/^www\./, '') : page.url
  return { title: page.title !== '' ? page.title : host, host }
}
