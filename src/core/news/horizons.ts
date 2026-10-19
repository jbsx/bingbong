import { sameStory } from './sameStory'
import { dayKey, daysBack, rankOrder, type ScoredStory } from './score'

// This Week and This Month (CONTEXT.md): the News card's two longer
// horizons, read from the story history — every polled story's best score
// by the day it was polled, and the cluster it belongs to. Stories are
// clustered as they are recorded: the same link, the same site with a
// near-identical title, or the same proper name (a repo, a model) is one
// story, and a cluster ranks at its peak. This Week is the top five of the
// last seven days. This Month is the top five of the last thirty that
// lasted — in two weekly lists, or top five on three separate days — so a
// one-day stunt never makes it.

/** How many days a story is kept after it was last polled: the month's thirty and today. */
export const HISTORY_DAYS = 31

/** How many stories each list holds. */
export const LIST_LENGTH = 5

const WEEK_DAYS = 7
const MONTH_DAYS = 30

/** What lasting takes: in this many weekly lists… */
const LASTING_WEEKS = 2
/** …or top five on this many separate days. */
const LASTING_DAYS = 3

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
  /** By local day polled ('YYYY-MM-DD'): its best score and magnitude that day. */
  days: Record<string, { score: number; magnitude: number | null }>
}

/** Every polled story by key. */
export type StoryHistory = Record<string, StoryRecord>

/** One line of This Week or This Month: the cluster's story at its peak. */
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
  for (const { story, topics, score } of ranked) {
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
      days: { ...known.days, [today]: { score: Math.max(held?.score ?? 0, score), magnitude: story.magnitude === null ? (held?.magnitude ?? null) : Math.max(held?.magnitude ?? 0, story.magnitude) } },
    }
  }
  return next
}

interface Peak {
  key: string
  record: StoryRecord
  score: number
  magnitude: number | null
}

function better(a: Peak, b: Peak): number {
  return rankOrder({ ...a, topical: a.record.topical }, { ...b, topical: b.record.topical })
}

/** Each cluster's peak over the given days, best first, the first `limit`. */
function topClusters(history: StoryHistory, days: readonly string[], limit: number): Peak[] {
  const peaks = new Map<string, Peak>()
  for (const [key, record] of Object.entries(history)) {
    for (const day of days) {
      const held = record.days[day]
      if (held === undefined) continue
      const peak = { key, record, score: held.score, magnitude: held.magnitude }
      const best = peaks.get(record.cluster)
      if (best === undefined || better(peak, best) < 0) peaks.set(record.cluster, peak)
    }
  }
  return [...peaks.values()].sort(better).slice(0, limit)
}

function itemOf({ key, record, magnitude }: Peak): NewsListItem {
  return { key, title: record.title, link: record.link, source: record.source, magnitude, unit: record.unit }
}

/** This Week (CONTEXT.md): the top five stories of the last seven days, today's included, each cluster at its peak. */
export function thisWeek(history: StoryHistory, now: number): NewsListItem[] {
  return topClusters(history, daysBack(now, WEEK_DAYS), LIST_LENGTH).map(itemOf)
}

/** The Monday of a day's week, as its day key. */
function weekOf(day: string): string {
  const [year, month, date] = day.split('-').map(Number)
  const at = new Date(year, month - 1, date, 12)
  return dayKey(new Date(year, month - 1, date - ((at.getDay() + 6) % 7), 12).getTime())
}

/** How many of the given lists — each a span of days — a cluster is in the top five of. */
function listings(history: StoryHistory, lists: Iterable<readonly string[]>): Map<string, number> {
  const counts = new Map<string, number>()
  for (const list of lists) for (const peak of topClusters(history, list, LIST_LENGTH)) counts.set(peak.record.cluster, (counts.get(peak.record.cluster) ?? 0) + 1)
  return counts
}

/** The clusters that lasted over the given days: in the top five of at least two of their calendar weeks, or of at least three separate days. */
function lastingClusters(history: StoryHistory, days: readonly string[]): Set<string> {
  const weeks = new Map<string, string[]>()
  for (const day of days) {
    const week = weekOf(day)
    weeks.set(week, [...(weeks.get(week) ?? []), day])
  }
  const inWeeks = listings(history, weeks.values())
  const onDays = listings(history, days.map((day) => [day]))
  const lasted = new Set<string>()
  for (const [cluster, count] of inWeeks) if (count >= LASTING_WEEKS) lasted.add(cluster)
  for (const [cluster, count] of onDays) if (count >= LASTING_DAYS) lasted.add(cluster)
  return lasted
}

/**
 * This Month (CONTEXT.md): the top five stories of the last thirty days that
 * lasted — in the top five of at least two calendar weeks (Monday to
 * Sunday), or of at least three separate days — each cluster at its peak.
 */
export function thisMonth(history: StoryHistory, now: number): NewsListItem[] {
  const days = daysBack(now, MONTH_DAYS)
  const lasted = lastingClusters(history, days)
  return topClusters(history, days, Number.POSITIVE_INFINITY)
    .filter((peak) => lasted.has(peak.record.cluster))
    .slice(0, LIST_LENGTH)
    .map(itemOf)
}
