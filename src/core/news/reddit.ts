import { decodeEntities } from './markup'
import type { NewsSource, NewsStory } from './news'

/** A subreddit as typed in settings ("r/NeoVim", "/r/chess/", "rust") as its bare lower-case name. */
export function subredditOf(typed: string): string {
  return typed
    .trim()
    .replace(/^\/+/, '')
    .replace(/^r\//i, '')
    .replace(/\/+$/, '')
    .toLowerCase()
}

/** The source's name for a subreddit, as the card reads it: "r/neovim". */
export function redditSourceName(subreddit: string): string {
  return `r/${subredditOf(subreddit)}`
}

interface Post {
  id?: unknown
  title?: unknown
  url?: unknown
  permalink?: unknown
  is_self?: unknown
  score?: unknown
  num_comments?: unknown
  created_utc?: unknown
  stickied?: unknown
  thumbnail?: unknown
  preview?: { images?: { source?: { url?: unknown } }[] } | null
}

function storyOf(post: Post | null | undefined, name: string): NewsStory | null {
  if (typeof post !== 'object' || post === null || post.stickied === true) return null
  const { id, title, score, created_utc: created, permalink } = post
  if (typeof id !== 'string' || typeof title !== 'string' || title.trim() === '' || typeof score !== 'number' || typeof created !== 'number') return null
  // A link post is the page it links; a text post is its thread.
  const link = post.is_self !== true && typeof post.url === 'string' && post.url !== '' ? post.url : typeof permalink === 'string' ? `https://www.reddit.com${permalink}` : null
  if (link === null) return null
  return {
    key: `${name}:${id}`,
    title: decodeEntities(title).trim(),
    link,
    source: name,
    publishedAt: Math.round(created * 1000),
    magnitude: score,
    unit: 'upvotes',
    comments: typeof post.num_comments === 'number' ? post.num_comments : null,
    image: imageOf(post),
  }
}

/** A post's picture: its preview at full size, else its thumbnail; a self post's "self" or "default" placeholder is none. */
function imageOf(post: Post): string | null {
  const preview = post.preview?.images?.[0]?.source?.url
  if (typeof preview === 'string' && /^https?:\/\//.test(preview)) return decodeEntities(preview)
  return typeof post.thumbnail === 'string' && /^https?:\/\//.test(post.thumbnail) ? post.thumbnail : null
}

/**
 * One subreddit as a NewsSource (CONTEXT.md): its top posts of the day,
 * their upvotes the magnitude. A source per subreddit, so a small
 * subreddit's best day reads against its own days, not a large one's.
 */
export function createRedditSource(fetchJson: (url: string) => Promise<unknown>, subreddit: string): NewsSource {
  const name = redditSourceName(subreddit)
  return {
    name,
    async stories(since) {
      const payload = (await fetchJson(`https://www.reddit.com/${name}/top.json?t=day&limit=25`)) as { data?: { children?: unknown } } | null
      const children = payload?.data?.children
      if (!Array.isArray(children)) throw new Error(`${name} answered no listing`)
      return (children as ({ data?: Post } | null)[])
        .map((child) => storyOf(child?.data, name))
        .filter((story): story is NewsStory => story !== null && story.publishedAt >= since)
    },
  }
}
