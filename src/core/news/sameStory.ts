import { hostOf, type NewsStory } from './news'

// The same story (CONTEXT.md): one thing that happened, wherever it was
// carried — Hacker News links the repository GitHub trending lists, a
// subreddit links the article a feed published. Two stories are one when
// they link the same page (tracking dropped), sit on the same site under a
// near-identical title, or name the same thing: a model or product named
// with letters and digits, or a repository or model by its owner/name — in
// the title, or in a GitHub or Hugging Face link. Today's Highlight counts
// such a story once at its peak (score.ts); Big News clusters by it
// (horizons.ts).

/** How alike two titles on one site must be (shared words over all words) to be one story. */
const SAME_TITLE = 0.75

/** Sites whose first two path segments name a thing — a repository, a model — whatever page of it is linked. */
const NAMED_HOSTS = new Set(['github.com', 'huggingface.co'])

/** First path segments on those sites that are the site's own pages, not an owner: one owner's Spaces are not one story. */
const SITE_PAGES = new Set([
  'about', 'apps', 'blog', 'collections', 'datasets', 'docs', 'enterprise', 'explore', 'features', 'learn', 'login', 'marketplace',
  'models', 'organizations', 'orgs', 'papers', 'pricing', 'security', 'settings', 'spaces', 'sponsors', 'tasks', 'topics', 'trending',
])

/** The address with what does not change the page dropped: scheme, www, a trailing slash, the fragment and tracking parameters. */
export function linkKey(link: string): string {
  if (!URL.canParse(link)) return link
  const url = new URL(link)
  for (const name of [...url.searchParams.keys()]) if (name.startsWith('utm_') || name === 'ref') url.searchParams.delete(name)
  const query = url.searchParams.toString()
  return `${url.hostname.replace(/^www\./, '')}${url.pathname.replace(/\/+$/, '')}${query === '' ? '' : `?${query}`}`
}

function titleWords(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word !== ''),
  )
}

function likeness(a: Set<string>, b: Set<string>): number {
  let shared = 0
  for (const word of a) if (b.has(word)) shared += 1
  const all = a.size + b.size - shared
  return all === 0 ? 0 : shared / all
}

/** Letters-and-digits words that name a thing in general, not one product: formats, architectures, ordinals, sizes. */
const COMMON_NAMES = new Set(['ipv4', 'ipv6', 'x86', 'x64', 'arm64', 'aarch64', 'mp3', 'mp4', 'h264', 'h265', 'utf8', 'utf-8', 'base64', 'covid-19', '2fa', 'b2b', 'p2p', 'y2k', 'web3', 'html5', 'css3', 'i18n', 'a11y', 'k8s', 's3', 'ec2', 'wasm32'])

/**
 * The proper names in a title that pick out one thing: a model or product
 * named with letters and digits ("GPT-6", "Qwen3") and a repo ("owner/repo").
 * Capitalised words alone are left out — "Google" or "GitHub" lead too many
 * unrelated titles to make them one story.
 */
function properNames(title: string): string[] {
  const names: string[] = []
  for (const raw of title.split(/\s+/)) {
    const word = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase()
    if (/^[a-z0-9][\w.-]*\/[\w.-]*[a-z][\w.-]*$/.test(word) && /[a-z]/.test(word.split('/')[0])) {
      names.push(word)
      continue
    }
    if (word.length < 3 || !/\p{L}.*\p{L}/u.test(word) || !/\p{N}/u.test(word) || COMMON_NAMES.has(word)) continue
    // A number with its unit or ordinal: "1990s", "10x", "100GB", "12th".
    if (/^\d[\d.,]*(s|x|k|m|b|th|st|nd|rd|d|gb|mb|tb|kb|ms|hz|ghz|mhz|fps|px|bit|nm|mm|cm|km|kg|am|pm)$/.test(word)) continue
    names.push(word)
  }
  return names
}

/** The owner/name a GitHub or Hugging Face link points into ("acme/agent" for github.com/acme/agent/releases), if any. */
function linkedName(link: string): string | null {
  const host = hostOf(link)
  if (!NAMED_HOSTS.has(host)) return null
  const [owner, name] = new URL(link).pathname.split('/').filter(Boolean)
  if (owner === undefined || name === undefined || SITE_PAGES.has(owner.toLowerCase())) return null
  return `${owner}/${name}`.toLowerCase()
}

/** What a story is told apart by, worked out once: comparing many stories pairwise reads each title once. */
export interface StoryMarks {
  link: string
  host: string
  words: Set<string>
  names: Set<string>
}

export function storyMarks(story: Pick<NewsStory, 'title' | 'link'>): StoryMarks {
  const names = new Set(properNames(story.title))
  const linked = linkedName(story.link)
  if (linked !== null) names.add(linked)
  return { link: linkKey(story.link), host: hostOf(story.link), words: titleWords(story.title), names }
}

/** The same page: one link, or one site under a near-identical title. */
function samePage(a: StoryMarks, b: StoryMarks): boolean {
  return a.link === b.link || (a.host !== '' && a.host === b.host && likeness(a.words, b.words) >= SAME_TITLE)
}

/** The same thing named: a model, a product, a repository. */
function sameName(a: StoryMarks, b: StoryMarks): boolean {
  for (const name of a.names) if (b.names.has(name)) return true
  return false
}

/** Whether two stories, by their marks, are the same story. */
export function sameMarks(a: StoryMarks, b: StoryMarks): boolean {
  return samePage(a, b) || sameName(a, b)
}

export function sameStory(a: Pick<NewsStory, 'title' | 'link'>, b: Pick<NewsStory, 'title' | 'link'>): boolean {
  return sameMarks(storyMarks(a), storyMarks(b))
}

/**
 * The stories grouped into one list per same story carried by several
 * sources, two groups joining when a story of one is the same story as a
 * story of the other; each group in the order its stories came. A group
 * holds one story a source: a source lists a story once, so two of its
 * own alike — two posts naming "GPT-6" — are two stories. The same page is
 * matched before the same name, so a link claims its story before a name
 * shared with a merely related one could.
 */
export function groupSameStories<T extends Pick<NewsStory, 'title' | 'link' | 'source'>>(stories: readonly T[]): T[][] {
  const marks = stories.map(storyMarks)
  const parent = stories.map((_, index) => index)
  const sources = stories.map((story) => new Set([story.source]))
  const root = (index: number): number => {
    while (parent[index] !== index) index = parent[index] = parent[parent[index]]
    return index
  }
  for (const same of [samePage, sameName]) {
    for (let a = 0; a < stories.length; a += 1) {
      for (let b = a + 1; b < stories.length; b += 1) {
        const [ra, rb] = [root(a), root(b)]
        if (ra === rb || [...sources[rb]].some((source) => sources[ra].has(source)) || !same(marks[a], marks[b])) continue
        parent[rb] = ra
        for (const source of sources[rb]) sources[ra].add(source)
      }
    }
  }
  const groups = new Map<number, T[]>()
  stories.forEach((story, index) => {
    const at = root(index)
    groups.set(at, [...(groups.get(at) ?? []), story])
  })
  return [...groups.values()]
}
