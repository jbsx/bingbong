import { sameStory } from './sameStory'
import { boost, DAY_MS, dayKey, daysBack, type ScoredStory } from './score'

// Big News (CONTEXT.md): the News card's one rolling list beside Today's
// Highlight, read from the story history — every polled story's best score
// by the day it was polled, and the cluster it belongs to. Stories are
// clustered as they are recorded: the same link, the same site with a
// near-identical title, or the same proper name (a repo, a model) is one
// story. A cluster stands at its peak score faded by the time since that
// peak, halving every HALF_LIFE_DAYS, and is listed while it clears the
// bar: a story big for its own source, on the owner's topics and on two
// sources stays about a fortnight; one on a single source about two days.
// A quiet stretch lists fewer, or none — the list is never filled up.

/** How many days a story is kept after it was last polled: past Big News's longest stay. */
export const HISTORY_DAYS = 31

/** How many stories Big News holds at most. */
export const BIG_NEWS_LENGTH = 3

// The half-life and the bar are tuned together: a topical story at the top
// of its source (score 1) clears the bar for about two days, the same on
// two sources (1.5, the source boost) for about fourteen.

/** How many days a story's score takes to fade to half. */
export const HALF_LIFE_DAYS = 20

/** What a story's faded score must still be for it to be listed. */
export const BIG_NEWS_BAR = 0.93

/** One polled story as the history keeps it. */
export interface StoryRecord {
  title: string
  link: string
  source: string
  unit: string
  /** Whether it matched an Interest Profile topic: one that did ranks over every one that did not, as in Today's Highlight. */
  topical: boolean
  /** The key of the cluster's first story: every story the same story shares it. */
  cluster: string
  /** The source's own image for it, the first Story Image candidate: none when the source gives none. */
  image: string | null
  /**
   * By local day polled ('YYYY-MM-DD'): its best score that day as Big News
   * measures it — its percentile boosted per source past the first, not per
   * topic, since the topics rank a story and the sources make it big — and
   * its magnitude.
   */
  days: Record<string, { score: number; magnitude: number | null }>
}

/** Every polled story by key. */
export type StoryHistory = Record<string, StoryRecord>

/** One line of Big News: the cluster's story at its standing day. */
export interface NewsListItem {
  key: string
  title: string
  link: string
  source: string
  /** Null for a feed's post, which counts nothing. */
  magnitude: number | null
  unit: string
}

/**
 * The history with a poll's ranked stories recorded on the poll's day —
 * each story's best score and magnitude that day, a story new to the
 * history joining the cluster of the first kept story it is the same story
 * as — and every story not polled in the last HISTORY_DAYS days dropped.
 */
export function recordStories(history: StoryHistory, ranked: readonly ScoredStory[], now: number): StoryHistory {
  const keep = new Set(daysBack(now, HISTORY_DAYS))
  const next: StoryHistory = {}
  for (const [key, record] of Object.entries(history)) {
    const days = Object.fromEntries(Object.entries(record.days).filter(([day]) => keep.has(day)))
    if (Object.keys(days).length > 0) next[key] = { ...record, days }
  }
  const today = dayKey(now)
  for (const { story, topics, percentile, sources } of ranked) {
    const score = percentile * boost(sources.length)
    const known = next[story.key]
    if (known === undefined) {
      const fresh = { title: story.title, link: story.link }
      const kin = Object.values(next).find((record) => sameStory(record, fresh))
      next[story.key] = {
        title: story.title,
        link: story.link,
        source: story.source,
        unit: story.unit,
        topical: topics.length > 0,
        cluster: kin?.cluster ?? story.key,
        image: story.image,
        days: { [today]: { score, magnitude: story.magnitude } },
      }
      continue
    }
    const held = known.days[today]
    next[story.key] = {
      ...known,
      title: story.title,
      link: story.link,
      topical: topics.length > 0,
      image: story.image ?? known.image,
      days: { ...known.days, [today]: { score: Math.max(held?.score ?? 0, score), magnitude: story.magnitude === null ? (held?.magnitude ?? null) : Math.max(held?.magnitude ?? 0, story.magnitude) } },
    }
  }
  return next
}

/** A day key's noon, epoch ms: where a day's score is aged from. */
function noonOf(day: string): number {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year, month - 1, date, 12).getTime()
}

/** A score `age` ms old, faded by the half-life. */
function faded(score: number, age: number): number {
  return score * 0.5 ** (Math.max(0, age) / (HALF_LIFE_DAYS * DAY_MS))
}

/**
 * Big News (CONTEXT.md): up to three clusters, best first by standing — a
 * cluster's best score on any day it was polled, faded by the time since
 * that day — each clearing the bar. Only stories on the owner's topics are
 * listed, as a topical story ranks over any other in Today's Highlight;
 * the cluster of `highlight` (Today's Highlight's key) is left out, so no
 * story is on the card twice. Each line is the cluster's story at its
 * standing day.
 */
export function bigNews(history: StoryHistory, now: number, highlight: string | null): NewsListItem[] {
  const skip = highlight === null ? undefined : history[highlight]?.cluster
  const best = new Map<string, { standing: number; item: NewsListItem }>()
  for (const [key, record] of Object.entries(history)) {
    if (!record.topical || record.cluster === skip) continue
    for (const [day, { score, magnitude }] of Object.entries(record.days)) {
      const standing = faded(score, now - noonOf(day))
      if (standing < BIG_NEWS_BAR) continue
      const held = best.get(record.cluster)
      if (held !== undefined && held.standing >= standing) continue
      best.set(record.cluster, { standing, item: { key, title: record.title, link: record.link, source: record.source, magnitude, unit: record.unit } })
    }
  }
  return [...best.values()]
    .sort((a, b) => b.standing - a.standing)
    .slice(0, BIG_NEWS_LENGTH)
    .map(({ item }) => item)
}
