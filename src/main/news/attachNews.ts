import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ipcMain, protocol } from 'electron'
import { createFeedSource } from '../../core/news/feeds'
import { createGitHubTrendingSource } from '../../core/news/githubTrending'
import { createHackerNewsSource, HACKER_NEWS_API } from '../../core/news/hackerNews'
import { createHuggingFaceModelsSource, createHuggingFacePapersSource } from '../../core/news/huggingFace'
import { profileSubreddits } from '../../core/news/interestProfile'
import { NEWS_IMAGE_SCHEME, NEWS_IPC } from '../../core/news/ipcChannels'
import { NewsRefusal, type NewsSource } from '../../core/news/news'
import { createNewsDesk } from '../../core/news/newsDesk'
import { createRedditSource } from '../../core/news/reddit'
import { CACHED_FILE, type StoryImagePorts } from '../../core/news/storyImage'
import type { AppSettings } from '../../core/settings/settings'
import { reportFault } from '../../core/trace/fault'
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

/** A story's page is read for its preview image only: a slow site leaves the tile rather than holding the card. */
const PAGE_TIMEOUT_MS = 5_000

/** How much of a page is read looking for `</head>`: the preview image is named in the head, and the head is never this long. */
const HEAD_CAP_BYTES = 256 * 1024

/** The largest picture downloaded: a story's preview image is a few hundred kilobytes; past this it is not one. */
const IMAGE_CAP_BYTES = 8 * 1024 * 1024

const CONTENT_TYPES: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' }

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

/** A response's body read up to `cap` bytes, or until `enough` holds of what is read so far; the rest is never downloaded. */
async function readUpTo(response: Response, cap: number, enough: (text: string) => boolean = () => false): Promise<Uint8Array> {
  const reader = response.body?.getReader()
  if (reader === undefined) return new Uint8Array()
  const parts: Uint8Array[] = []
  let length = 0
  const decoder = new TextDecoder()
  let text = ''
  try {
    while (length < cap) {
      const { done, value } = await reader.read()
      if (done) break
      parts.push(value)
      length += value.length
      text += decoder.decode(value, { stream: true })
      if (enough(text)) break
    }
  } finally {
    void reader.cancel().catch((error: unknown) => reportFault('news.attachNews.readUpTo', error))
  }
  const bytes = new Uint8Array(length)
  parts.reduce((at, part) => (bytes.set(part, at), at + part.length), 0)
  return bytes
}

/**
 * Story Images' network and cache (CONTEXT.md): a story's page read to its
 * `</head>` and no further, an image downloaded whole within its cap, and
 * each picture saved into `dir` (userData's news-images) under a name from
 * its bytes. Every request goes through `rebase`, so the e2e stand-in
 * serves the pages and pictures too.
 */
function storyImagePorts(dir: string, rebase: (url: string) => string): StoryImagePorts {
  return {
    async fetchPage(url) {
      const response = await fetch(rebase(url), { headers: { 'user-agent': USER_AGENT, accept: 'text/html' }, signal: AbortSignal.timeout(PAGE_TIMEOUT_MS) })
      if (!response.ok || !/html/i.test(response.headers.get('content-type') ?? '')) return ''
      return new TextDecoder().decode(await readUpTo(response, HEAD_CAP_BYTES, (text) => /<\/head>/i.test(text)))
    },
    async fetchImage(url) {
      const response = await fetch(rebase(url), { headers: { 'user-agent': USER_AGENT, accept: 'image/*' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
      if (!response.ok) throw new Error(`image request failed (${response.status})`)
      if (Number(response.headers.get('content-length') ?? 0) > IMAGE_CAP_BYTES) throw new Error('image too large')
      const bytes = await readUpTo(response, IMAGE_CAP_BYTES + 1)
      if (bytes.length > IMAGE_CAP_BYTES) throw new Error('image too large')
      return bytes
    },
    save(bytes, format) {
      const file = `${createHash('sha256').update(bytes).digest('hex').slice(0, 32)}.${format}`
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, file), bytes)
      return file
    },
    remove(file) {
      if (!CACHED_FILE.test(file)) return
      try {
        rmSync(join(dir, file), { force: true })
      } catch (error) {
        reportFault('news.storyImages.remove', error)
      }
    },
  }
}

/** Before the app is ready: the Story Images' scheme, standard and secure, so the dashboard loads a cached picture from it as from any origin. */
export function registerNewsImageScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: NEWS_IMAGE_SCHEME, privileges: { standard: true, secure: true } }])
}

/**
 * The News card's IPC (CONTEXT.md): the Idle Screen asks for Today's
 * Highlight and Big News and main's News Desk answers them,
 * fetching the sources at most hourly. The sources live here, where the
 * network belongs: Hacker News, GitHub trending, Hugging Face's models and
 * papers, a source per subreddit the Interest Profile names, and a source
 * per feed — the last two read from settings at every poll. Each shown
 * story's Story Image is cached in `imageDir` and served to the dashboard
 * on the bingbong-news scheme: the renderer never fetches one itself.
 */
export function registerNewsIpc(deps: { storePath: string; imageDir: string; news: () => AppSettings['news']; env?: NodeJS.ProcessEnv }): void {
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
    images: storyImagePorts(deps.imageDir, rebase),
  })
  ipcMain.handle(NEWS_IPC.horizons, () => desk.horizons())
  protocol.handle(NEWS_IMAGE_SCHEME, (request) => {
    const { host, pathname } = new URL(request.url)
    const file = decodeURIComponent(pathname.slice(1))
    if (host !== 'image' || !CACHED_FILE.test(file)) return new Response(null, { status: 404 })
    try {
      return new Response(readFileSync(join(deps.imageDir, file)), { headers: { 'content-type': CONTENT_TYPES[file.split('.').pop() ?? ''] ?? 'application/octet-stream', 'cache-control': 'max-age=31536000, immutable' } })
    } catch (error) {
      // A picture pruned since the card last asked is gone, not broken: the card shows the tile.
      if ((error as NodeJS.ErrnoException | null)?.code !== 'ENOENT') reportFault('news.attachNews.image', error)
      return new Response(null, { status: 404 })
    }
  })
}
