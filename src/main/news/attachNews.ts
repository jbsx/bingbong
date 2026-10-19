import { ipcMain } from 'electron'
import { createFeedSource } from '../../core/news/feeds'
import { createGitHubTrendingSource } from '../../core/news/githubTrending'
import { createHackerNewsSource, HACKER_NEWS_API } from '../../core/news/hackerNews'
import { createHuggingFaceModelsSource, createHuggingFacePapersSource } from '../../core/news/huggingFace'
import { profileSubreddits } from '../../core/news/interestProfile'
import { NEWS_IPC } from '../../core/news/ipcChannels'
import { NewsRefusal, type NewsSource } from '../../core/news/news'
import { createNewsDesk } from '../../core/news/newsDesk'
import { createRedditSource } from '../../core/news/reddit'
import type { AppSettings } from '../../core/settings/settings'
import { createNewsStore } from './newsStore'

/**
 * The e2e's stand-in for every NewsSource: with BINGBONG_NEWS_FIXTURE set
 * to a local server's origin, each request asks that server for the same
 * path and query instead of the real site. Test support only: nothing sets
 * it outside the e2e harness.
 */
export const NEWS_FIXTURE_ENV = 'BINGBONG_NEWS_FIXTURE'

/** Long enough for a slow API; short enough that a dead one never stacks polls. Each source's request has its own. */
const REQUEST_TIMEOUT_MS = 10_000

/** Reddit asks a script for a descriptive agent; the others take any. */
const USER_AGENT = 'BingBong/1.0 (Idle Screen news card; one request per source an hour)'

/** The statuses a site refuses the appliance with — forbidden, rate-limited — rather than failing. */
const REFUSED = new Set([403, 429])

type Fetch = (url: string) => Promise<string>

/** One GET, its body as text; a refusal as a NewsRefusal, so the source rests for the day. */
function fetcher(rebase: (url: string) => string, accept: string): Fetch {
  return async (url) => {
    const response = await fetch(rebase(url), { headers: { 'user-agent': USER_AGENT, accept }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    if (REFUSED.has(response.status)) throw new NewsRefusal(`${new URL(url).host} refused the request (${response.status})`)
    if (!response.ok) throw new Error(`news request failed (${response.status})`)
    return response.text()
  }
}

/** A JSON GET: a page where data was asked for is a bot challenge, so a refusal too. */
function jsonFetcher(fetchText: Fetch): (url: string) => Promise<unknown> {
  return async (url) => {
    const body = await fetchText(url)
    if (/^\s*</.test(body)) throw new NewsRefusal(`${new URL(url).host} answered a page, not data`)
    return JSON.parse(body) as unknown
  }
}

/**
 * The News card's IPC (CONTEXT.md): the Idle Screen asks for Today's
 * Highlight, This Week and This Month and main's News Desk answers them,
 * fetching the sources at most hourly. The sources live here, where the
 * network belongs: Hacker News, GitHub trending, Hugging Face's models and
 * papers, a source per subreddit the Interest Profile names, and a source
 * per feed — the last two read from settings at every poll.
 */
export function registerNewsIpc(deps: { storePath: string; news: () => AppSettings['news']; env?: NodeJS.ProcessEnv }): void {
  const fixture = (deps.env ?? process.env)[NEWS_FIXTURE_ENV]?.trim().replace(/\/+$/, '')
  const rebase = (url: string): string => {
    if (!fixture) return url
    const { pathname, search } = new URL(url)
    return `${fixture}${pathname}${search}`
  }
  const fetchText = fetcher(rebase, 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8')
  const fetchFeed = fetcher(rebase, 'application/rss+xml,application/atom+xml,application/xml;q=0.9,*/*;q=0.8')
  const fetchJson = jsonFetcher(fetcher(rebase, 'application/json'))
  const fixed: NewsSource[] = [
    createHackerNewsSource(fetchJson, HACKER_NEWS_API),
    createGitHubTrendingSource(fetchText),
    createHuggingFaceModelsSource(fetchJson),
    createHuggingFacePapersSource(fetchJson),
  ]
  const desk = createNewsDesk({
    sources: () => {
      const { topics, feeds } = deps.news()
      const sources = [...fixed, ...profileSubreddits(topics).map((subreddit) => createRedditSource(fetchJson, subreddit))]
      // A source's name keys its stories, its baseline and its rest: a feed named like another source (or another feed) would share them, so it is left out.
      const taken = new Set(sources.map((source) => source.name))
      for (const feed of feeds) {
        if (feed.name === '' || taken.has(feed.name) || !URL.canParse(feed.url)) continue
        taken.add(feed.name)
        sources.push(createFeedSource(fetchFeed, feed))
      }
      return sources
    },
    store: createNewsStore(deps.storePath),
    profile: () => deps.news().topics,
  })
  ipcMain.handle(NEWS_IPC.horizons, () => desk.horizons())
}
