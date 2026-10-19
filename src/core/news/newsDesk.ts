import { gatherStories, type NewsSource, type NewsStory } from './news'
import { storyTopics, storyWords, type InterestProfile } from './interestProfile'
import { bigNews, recordStories, type NewsListItem, type StoryHistory } from './horizons'
import { BASELINE_DAYS, DAY_MS, HIGHLIGHT_WINDOW_MS, rankStories, recordMagnitudes, todaysHighlight, type MagnitudeHistory } from './score'
import { gatherStoryBriefs, sanitizeStoryBriefs, type BriefStory, type StoryBrief, type StoryBriefs, type StoryBriefWriter } from './storyBrief'
import { emptyStoryImages, gatherStoryImages, pruneStoryImages, sanitizeStoryImages, storyImageUrl, type StoryImagePorts, type StoryImages } from './storyImage'

// The News Desk: main's side of the News card (the card is in CONTEXT.md). The Idle Screen
// asks for the card's stories whenever it shows and every few minutes after;
// the desk fetches at most once an hour — the first ask after a start polls
// at once — and answers from what it holds in between. Each poll records
// the sources' magnitudes (the baseline scores read against) and every
// story's score in the story history (Big News is read from it) and, when
// an unseen story of the last 24 hours tops the ranking, makes it the
// highlight and marks it shown. Then every story the card
// will show — the highlight and Big News — gets its Story Image, fetched
// once into the cache and dropped with the story history, and its Story
// Brief, written once by the brief writer and dropped the same way. A poll
// no source answered keeps the last highlight and is tried again in a few
// minutes.

/** How often the sources are fetched while the Idle Screen asks. */
export const NEWS_POLL_MS = 60 * 60 * 1000

/** How soon a poll no source answered is tried again: a site briefly down should not hold the card's note up for an hour. */
export const NEWS_RETRY_MS = 5 * 60 * 1000

/** How long a shown story is remembered: past the 24-hour window it can never be picked again anyway. */
const SHOWN_KEEP_MS = 7 * 24 * 60 * 60 * 1000

export interface TodaysHighlight {
  story: NewsStory
  /** The Interest Profile topics it matched. */
  topics: string[]
  /** When it became the highlight, epoch ms. */
  shownAt: number
}

/** A story's Story Image as the card loads it: the cached picture's address on main's scheme, or null for the source's tile. Not a story's `image`, the source's own address for it. */
export type ShownImage = { picture: string | null }

/** A story's Story Brief as the card sets it: null while none is written, and the card shows the headline alone. */
export type ShownBrief = { brief: StoryBrief | null }

/** What the News card shows: Today's Highlight and Big News (CONTEXT.md), each with its Story Image and Story Brief. */
export interface NewsHorizons {
  highlight: TodaysHighlight & ShownImage & ShownBrief
  bigNews: (NewsListItem & ShownImage & ShownBrief)[]
}

/** How far back a poll asks the sources: a story still on a front page days after it was published is still polled, so its standing in Big News is renewed. */
const POLL_SINCE_MS = BASELINE_DAYS * DAY_MS

/** What the desk keeps in userData, so "unseen", the last highlight and the story history survive a restart. */
export interface NewsState {
  shown: { key: string; at: number }[]
  history: MagnitudeHistory
  highlight: TodaysHighlight | null
  stories: StoryHistory
  /** The Story Images' cache index. */
  images: StoryImages
  /** The Story Briefs written, by story key. */
  briefs: StoryBriefs
}

export interface NewsStore {
  load(): NewsState
  save(state: NewsState): void
}

export function emptyNewsState(): NewsState {
  return { shown: [], history: {}, highlight: null, stories: {}, images: emptyStoryImages(), briefs: {} }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStory(value: unknown): value is NewsStory {
  if (!isRecord(value)) return false
  const { key, title, link, source, publishedAt, magnitude, unit, comments, image, about } = value
  return (
    (about === undefined || about === null || typeof about === 'string') &&
    // A highlight saved before Story Images has no image: it reads as none.
    (image === undefined || image === null || typeof image === 'string') &&
    typeof key === 'string' &&
    typeof title === 'string' &&
    typeof link === 'string' &&
    typeof source === 'string' &&
    typeof publishedAt === 'number' &&
    (magnitude === null || typeof magnitude === 'number') &&
    typeof unit === 'string' &&
    (comments === null || typeof comments === 'number')
  )
}

/** Anything (the file in userData) as the desk's state: well-formed entries kept, the rest dropped; not a state at all means nothing shown yet. */
export function sanitizeNewsState(raw: unknown): NewsState {
  if (!isRecord(raw)) return emptyNewsState()
  const shown = Array.isArray(raw.shown)
    ? raw.shown.filter((entry): entry is NewsState['shown'][number] => isRecord(entry) && typeof entry.key === 'string' && typeof entry.at === 'number')
    : []
  const history: MagnitudeHistory = {}
  for (const [source, days] of Object.entries(isRecord(raw.history) ? raw.history : {})) {
    if (!isRecord(days)) continue
    for (const [day, magnitudes] of Object.entries(days)) {
      if (!isRecord(magnitudes)) continue
      const kept = Object.entries(magnitudes).filter((entry): entry is [string, number] => typeof entry[1] === 'number')
      if (kept.length > 0) history[source] = { ...history[source], [day]: Object.fromEntries(kept) }
    }
  }
  const held = raw.highlight
  const highlight =
    isRecord(held) && isStory(held.story) && typeof held.shownAt === 'number' && Array.isArray(held.topics)
      ? { story: { ...held.story, image: held.story.image ?? null }, topics: held.topics.filter((topic): topic is string => typeof topic === 'string'), shownAt: held.shownAt }
      : null
  return { shown, history, highlight, stories: sanitizeStories(raw.stories), images: sanitizeStoryImages(raw.images), briefs: sanitizeStoryBriefs(raw.briefs) }
}

function sanitizeStories(raw: unknown): StoryHistory {
  const stories: StoryHistory = {}
  for (const [key, record] of Object.entries(isRecord(raw) ? raw : {})) {
    if (!isRecord(record)) continue
    const { title, link, source, unit, topical, cluster } = record
    const image = typeof record.image === 'string' ? record.image : null
    // A story recorded before Story Briefs has no `about`: it reads as none.
    const about = typeof record.about === 'string' ? record.about : null
    if (typeof title !== 'string' || typeof link !== 'string' || typeof source !== 'string' || typeof unit !== 'string') continue
    if (typeof topical !== 'boolean' || typeof cluster !== 'string') continue
    // A story recorded before its sources were kept names its own.
    const sources = Array.isArray(record.sources) ? record.sources.filter((name): name is string => typeof name === 'string') : [source]
    const days = Object.entries(isRecord(record.days) ? record.days : {}).filter(
      (entry): entry is [string, { score: number; magnitude: number | null }] =>
        isRecord(entry[1]) && typeof entry[1].score === 'number' && (entry[1].magnitude === null || typeof entry[1].magnitude === 'number'),
    )
    if (days.length === 0) continue
    stories[key] = { title, link, source, unit, topical, cluster, image, about, sources, days: Object.fromEntries(days.map(([day, { score, magnitude }]) => [day, { score, magnitude }])) }
  }
  return stories
}

export interface NewsDesk {
  /** The card's stories, polling first when the last poll is an hour old; null when there has never been a highlight or the profile is empty. */
  horizons(): Promise<NewsHorizons | null>
}

/** The start of the local day after `at`: when a source that refused the appliance is asked again. */
function nextDay(at: number): number {
  const date = new Date(at)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime()
}

/** The cache with a Story Image for every story the card shows at `at` — the highlight and Big News — and only the stories the history keeps. */
async function pictured(state: NewsState, ports: StoryImagePorts, at: number): Promise<StoryImages> {
  const { stories, highlight } = state
  const shown = [
    ...(highlight === null ? [] : [{ key: highlight.story.key, cluster: stories[highlight.story.key]?.cluster ?? highlight.story.key, link: highlight.story.link, image: highlight.story.image }]),
    ...bigNews(stories, at, highlight?.story.key ?? null).map((item) => ({ key: item.key, cluster: stories[item.key].cluster, link: item.link, image: stories[item.key].image })),
  ]
  const gathered = await gatherStoryImages(state.images, shown, ports, at)
  const keep = new Map(Object.entries(stories).map(([key, record]) => [key, record.cluster]))
  if (highlight !== null && !keep.has(highlight.story.key)) keep.set(highlight.story.key, highlight.story.key)
  return pruneStoryImages(gathered, keep, ports)
}

/** Every story the card shows at `at` — the highlight and Big News — as the brief writer is told it: its facts, the topics and words it matched, and every source carrying it. */
function briefStories(state: NewsState, profile: InterestProfile, at: number): BriefStory[] {
  const { stories, highlight } = state
  // A story's own record names the sources that carried it in one poll; its cluster's other records, those that carried it in another.
  const sourcesOf = (key: string, own: string): string[] => {
    const cluster = stories[key]?.cluster
    const mates = cluster === undefined ? [] : Object.values(stories).filter((record) => record.cluster === cluster).flatMap((record) => record.sources ?? [record.source])
    return [...new Set([own, ...(stories[key]?.sources ?? []), ...mates])]
  }
  const told = (story: Omit<BriefStory, 'topics' | 'words' | 'sources'>, topics: string[]): BriefStory => ({
    ...story,
    topics,
    words: storyWords(story, profile),
    sources: sourcesOf(story.key, story.source),
  })
  return [
    ...(highlight === null
      ? []
      : [told({ ...highlight.story, about: highlight.story.about ?? stories[highlight.story.key]?.about ?? null }, highlight.topics)]),
    ...bigNews(stories, at, highlight?.story.key ?? null).map((item) => told({ ...item, about: stories[item.key].about ?? null }, storyTopics(item, profile))),
  ]
}

export function createNewsDesk(deps: {
  /** The sources, read at every poll: the subreddits and feeds follow settings. */
  sources: () => readonly NewsSource[]
  store: NewsStore
  profile: () => InterestProfile
  /** The network and cache Story Images are fetched into; none, and every story shows its tile. */
  images?: StoryImagePorts
  /** Who writes the Story Briefs, read at every poll: none, and the card shows headlines alone. */
  writer?: () => StoryBriefWriter | null
  now?: () => number
}): NewsDesk {
  const now = deps.now ?? Date.now
  let state = deps.store.load()
  let polledAt: number | null = null
  let polling: Promise<void> | null = null
  /** The sources resting after a refusal, by name, until when. Not kept across a restart: a restart asks once more. */
  const resting = new Map<string, number>()

  async function poll(at: number, profile: InterestProfile): Promise<void> {
    const awake = deps.sources().filter((source) => (resting.get(source.name) ?? 0) <= at)
    const { stories, answered, refused } = await gatherStories(awake, at - POLL_SINCE_MS)
    for (const name of refused) resting.set(name, nextDay(at))
    if (!answered) {
      polledAt = at - NEWS_POLL_MS + NEWS_RETRY_MS
      return
    }
    // The baseline records the last 24 hours' stories only, as it did before the poll looked back further: a story days old still gathering points would raise its day's bar.
    const history = recordMagnitudes(state.history, stories.filter((story) => at - story.publishedAt <= HIGHLIGHT_WINDOW_MS), at)
    const shown = state.shown.filter((entry) => at - entry.at <= SHOWN_KEEP_MS)
    const recorded = recordStories(state.stories, rankStories(stories, history, profile), at)
    const pick = todaysHighlight(stories, history, profile, new Set(shown.map((entry) => entry.key)), at)
    state =
      pick === null
        ? { ...state, history, shown, stories: recorded }
        : {
            ...state,
            history,
            shown: [...shown, ...pick.keys.map((key) => ({ key, at }))],
            highlight: { story: pick.story, topics: pick.topics, shownAt: at },
            stories: recorded,
          }
    if (deps.images !== undefined) state = { ...state, images: await pictured(state, deps.images, at) }
    const writer = deps.writer?.() ?? null
    if (writer !== null) {
      const keep = new Set(Object.keys(state.stories))
      if (state.highlight !== null) keep.add(state.highlight.story.key)
      state = { ...state, briefs: await gatherStoryBriefs(state.briefs, briefStories(state, profile, at), writer, keep) }
    }
    deps.store.save(state)
  }

  return {
    async horizons() {
      const profile = deps.profile()
      if (profile.length === 0) return null
      const at = now()
      if (polling === null && (polledAt === null || at - polledAt >= NEWS_POLL_MS)) {
        polledAt = at
        polling = poll(at, profile).finally(() => {
          polling = null
        })
      }
      if (polling !== null) await polling
      if (state.highlight === null) return null
      const { stories, images, briefs } = state
      const shownOf = (key: string): ShownImage & ShownBrief => {
        const file = images.stories[key]?.file
        return { picture: file === undefined || file === null ? null : storyImageUrl(file), brief: briefs[key] ?? null }
      }
      return {
        highlight: { ...state.highlight, ...shownOf(state.highlight.story.key) },
        bigNews: bigNews(stories, at, state.highlight.story.key).map((item) => ({ ...item, ...shownOf(item.key) })),
      }
    },
  }
}
