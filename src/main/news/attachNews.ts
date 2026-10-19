import { ipcMain } from 'electron'
import { createHackerNewsSource, HACKER_NEWS_API } from '../../core/news/hackerNews'
import type { InterestProfile } from '../../core/news/interestProfile'
import { NEWS_IPC } from '../../core/news/ipcChannels'
import { createNewsDesk } from '../../core/news/newsDesk'
import { createNewsStore } from './newsStore'

/**
 * The e2e's stand-in for Hacker News: with BINGBONG_NEWS_FIXTURE set to a
 * local server's origin, the source asks that server instead of the API.
 * Test support only: nothing sets it outside the e2e harness.
 */
export const NEWS_FIXTURE_ENV = 'BINGBONG_NEWS_FIXTURE'

/** Long enough for a slow API; short enough that a dead one never stacks polls. */
const REQUEST_TIMEOUT_MS = 10_000

const fetchJson = async (url: string): Promise<unknown> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`news request failed (${response.status})`)
  return response.json() as Promise<unknown>
}

/**
 * The News card's IPC (CONTEXT.md): the Idle Screen asks for Today's
 * Highlight and main's News Desk answers it, fetching the sources at most
 * hourly. The sources live here, where the network belongs; a new one
 * joins the list.
 */
export function registerNewsIpc(deps: { storePath: string; profile: () => InterestProfile; env?: NodeJS.ProcessEnv }): void {
  const base = (deps.env ?? process.env)[NEWS_FIXTURE_ENV]?.trim() || HACKER_NEWS_API
  const desk = createNewsDesk({
    sources: [createHackerNewsSource(fetchJson, base)],
    store: createNewsStore(deps.storePath),
    profile: deps.profile,
  })
  ipcMain.handle(NEWS_IPC.highlight, () => desk.highlight())
}
