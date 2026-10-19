import { decodeEntities, textOf } from './markup'
import type { NewsSource, NewsStory } from './news'

// Feeds as NewsSources (CONTEXT.md): the labs' and the press's RSS or Atom.
// A post carries no magnitude — no site counts its readers for us — so it
// is a candidate at the feed floor (score.ts), lifted only by the topics it
// matches and by the same story on a source that does count.

/** One feed in settings' News section: the name the card shows and its address. */
export interface NewsFeed {
  name: string
  url: string
}

/**
 * The labs and the press the Interest Profile names, as of 2026-10-19.
 * Anthropic publishes no feed of its own; the one here is a community
 * mirror of its news page. Meta AI and xAI publish none, so they are not
 * listed — a feed found later is added in settings.
 */
export function defaultNewsFeeds(): NewsFeed[] {
  return [
    { name: 'OpenAI', url: 'https://openai.com/news/rss.xml' },
    { name: 'Anthropic', url: 'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_news.xml' },
    { name: 'Google DeepMind', url: 'https://deepmind.google/blog/rss.xml' },
    { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
    { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
    { name: 'Electrek', url: 'https://electrek.co/feed/' },
  ]
}

/** Anything (disk, IPC) as the feed list: entries with a name and an http(s) address; not a list at all means the default. */
export function sanitizeNewsFeeds(value: unknown): NewsFeed[] {
  if (!Array.isArray(value)) return defaultNewsFeeds()
  const feeds: NewsFeed[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const { name, url } = item as { name?: unknown; url?: unknown }
    if (typeof name !== 'string' || typeof url !== 'string') continue
    feeds.push({ name: name.trim(), url: url.trim() })
  }
  return feeds
}

/** The first `<name …>…</name>` in `block`, its inner markup; null when there is none. */
function element(block: string, name: string): string | null {
  return new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(block)?.[1] ?? null
}

/** An Atom entry's page: the `<link>` whose rel is alternate, or that has none. */
function atomLink(entry: string): string | null {
  for (const [tag] of entry.matchAll(/<link\b[^>]*>/g)) {
    const rel = /\srel="([^"]*)"/.exec(tag)?.[1]
    const href = /\shref="([^"]*)"/.exec(tag)?.[1]
    if (href !== undefined && (rel === undefined || rel === 'alternate')) return decodeEntities(href)
  }
  return null
}

function storyOf(block: string, atom: boolean, name: string): NewsStory | null {
  const title = textOf(element(block, 'title') ?? '')
  const link = atom ? atomLink(block) : textOf(element(block, 'link') ?? '') || null
  const published = Date.parse(textOf(element(block, atom ? 'published' : 'pubDate') ?? element(block, atom ? 'updated' : 'dc:date') ?? ''))
  if (title === '' || link === null || !/^https?:\/\//.test(link) || Number.isNaN(published)) return null
  const id = textOf(element(block, atom ? 'id' : 'guid') ?? '') || link
  return { key: `${name}:${id}`, title, link, source: name, publishedAt: published, magnitude: null, unit: '', comments: null, image: mediaImage(block) }
}

/** The tags named `name` in `block`, each as its attributes. */
function tags(block: string, name: string): Record<string, string>[] {
  return [...block.matchAll(new RegExp(`<${name}\\b([^>]*)>`, 'g'))].map(([, attributes]) =>
    Object.fromEntries([...attributes.matchAll(/([\w:-]+)=(?:"([^"]*)"|'([^']*)')/g)].map(([, key, double, single]) => [key, decodeEntities(double ?? single)])),
  )
}

const IMAGE_FILE = /\.(jpe?g|png|gif|webp)(\?|$)/i

/** A post's own picture: its image media content, else an image enclosure, else its media thumbnail; none when it carries no image. */
function mediaImage(block: string): string | null {
  const isImage = (tag: Record<string, string>): boolean =>
    tag.medium === 'image' || (tag.type ?? '').startsWith('image/') || (tag.medium === undefined && tag.type === undefined && IMAGE_FILE.test(tag.url ?? ''))
  const found =
    tags(block, 'media:content').find(isImage) ?? tags(block, 'enclosure').find((tag) => (tag.type ?? '').startsWith('image/')) ?? tags(block, 'media:thumbnail')[0]
  const url = found?.url
  return url !== undefined && /^https?:\/\//.test(url) ? url : null
}

/** One RSS 2.0 or Atom feed as a NewsSource. `fetchText` is main's. */
export function createFeedSource(fetchText: (url: string) => Promise<string>, feed: NewsFeed): NewsSource {
  return {
    name: feed.name,
    async stories(since) {
      const document = await fetchText(feed.url)
      const items = [...document.matchAll(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/g)].map(([block]) => storyOf(block, false, feed.name))
      const entries = [...document.matchAll(/<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/g)].map(([block]) => storyOf(block, true, feed.name))
      if (items.length === 0 && entries.length === 0 && !/<(rss|feed|rdf:RDF)[\s>]/.test(document)) throw new Error(`${feed.name} answered no feed`)
      return [...items, ...entries].filter((story): story is NewsStory => story !== null && story.publishedAt >= since)
    },
  }
}
