import type { NewsStory } from './news'
import { storyTopics, type InterestProfile } from './interestProfile'
import { groupSameStories } from './sameStory'

// Scoring the News (CONTEXT.md): a story is big for its own source, not in
// absolute numbers — its magnitude's percentile against that source's recent
// days — so a quiet site's best day and a loud site's best day read on one
// scale. A feed counts nothing, so its posts sit at the feed floor. The same
// story on several sources counts once, at its peak percentile, boosted for
// each source past the first; the Interest Profile then boosts it by the
// topics it matches, and a story matching none ranks under every story that
// matches one.

/** Each source's magnitudes by local day ('YYYY-MM-DD'), by story key: what "a normal day" is measured against. */
export type MagnitudeHistory = Record<string, Record<string, Record<string, number>>>

/** How many days, the story's own included, make the baseline it is scored against. */
export const BASELINE_DAYS = 7

export const DAY_MS = 24 * 60 * 60 * 1000

/** How long Today's Highlight looks back. */
export const HIGHLIGHT_WINDOW_MS = DAY_MS

/**
 * Where a feed's post sits, having no magnitude: an ordinary day's story —
 * over the bottom half of a counting source's day, under its top half.
 */
export const FEED_FLOOR = 0.5

export interface ScoredStory {
  /** The story at its peak: of the sources that carried it, the one where it ranked highest. */
  story: NewsStory
  /** The Interest Profile topics any of its sources' stories matched, in the profile's order. */
  topics: string[]
  /** Its peak: the highest of its stories' percentiles in their own sources' baselines (the feed floor for a feed's), 0–1. */
  percentile: number
  score: number
  /** Every source's key it was carried under: shown once is shown under all of them. */
  keys: string[]
  /** The sources that carried it, the peak's first. */
  sources: string[]
}

/** The boost for matching `count` topics, or appearing on `count` sources: half again for each past the first. */
function boost(count: number): number {
  return 1 + (Math.max(1, count) - 1) / 2
}

export function dayKey(at: number): string {
  const date = new Date(at)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** The local days ending with `at`'s, `count` of them, latest first. */
export function daysBack(at: number, count: number): string[] {
  const date = new Date(at)
  return Array.from({ length: count }, (_, back) => dayKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() - back, 12).getTime()))
}

/** The local days a story published at `at` is scored against: its own and the six before. */
function baselineDays(at: number): string[] {
  return daysBack(at, BASELINE_DAYS)
}

type RankKeys = { topical: boolean; score: number; magnitude: number | null }

/** The order the News ranks in, best first: a story matching a topic over one matching none, then by score, then by magnitude (none, a feed's post, as nothing). */
export function rankOrder(a: RankKeys, b: RankKeys): number {
  return Number(b.topical) - Number(a.topical) || b.score - a.score || (b.magnitude ?? 0) - (a.magnitude ?? 0)
}

/**
 * The magnitudes a story is measured against: its source's recorded days in
 * its window, and the stories in hand from the same source and window, each
 * story once.
 */
function baseline(story: NewsStory, history: MagnitudeHistory, stories: readonly NewsStory[]): number[] {
  const days = baselineDays(story.publishedAt)
  const byKey = new Map<string, number>()
  const recorded = history[story.source] ?? {}
  for (const day of days) for (const [key, magnitude] of Object.entries(recorded[day] ?? {})) byKey.set(key, magnitude)
  const window = new Set(days)
  for (const other of stories) {
    if (other.source === story.source && other.magnitude !== null && window.has(dayKey(other.publishedAt))) byKey.set(other.key, other.magnitude)
  }
  return [...byKey.values()]
}

/** The share of `sample` below `value`, ties counting half. */
function percentile(value: number, sample: readonly number[]): number {
  if (sample.length === 0) return 1
  let below = 0
  let equal = 0
  for (const each of sample) {
    if (each < value) below += 1
    else if (each === value) equal += 1
  }
  return (below + equal / 2) / sample.length
}

/**
 * Every story scored, best first, the same story on several sources once:
 * those matching a topic over those matching none, then by peak percentile
 * boosted per topic matched and per source past the first, then the bigger
 * number, then the newer.
 */
export function rankStories(stories: readonly NewsStory[], history: MagnitudeHistory, profile: InterestProfile): ScoredStory[] {
  const each = stories.map((story) => ({
    story,
    percentile: story.magnitude === null ? FEED_FLOOR : percentile(story.magnitude, baseline(story, history, stories)),
  }))
  const scored = groupSameStories(each.map((entry) => ({ ...entry, title: entry.story.title, link: entry.story.link, source: entry.story.source }))).map((group): ScoredStory => {
    const [peak] = [...group].sort((a, b) => b.percentile - a.percentile || (b.story.magnitude ?? -1) - (a.story.magnitude ?? -1))
    const matched = new Set(group.flatMap((entry) => storyTopics(entry.story, profile)))
    const topics = profile.map((topic) => topic.name).filter((name) => matched.has(name))
    const sources = [...new Set([peak.story.source, ...group.map((entry) => entry.story.source)])]
    return {
      story: peak.story,
      topics,
      percentile: peak.percentile,
      score: peak.percentile * boost(topics.length) * boost(sources.length),
      keys: group.map((entry) => entry.story.key),
      sources,
    }
  })
  const order = (each: ScoredStory) => ({ topical: each.topics.length > 0, score: each.score, magnitude: each.story.magnitude })
  // Feed posts tie at the floor: the newer first.
  return scored.sort((a, b) => rankOrder(order(a), order(b)) || b.story.publishedAt - a.story.publishedAt)
}

/** Today's Highlight (CONTEXT.md): the top-scoring story of the last 24 hours not shown under any of its keys; none when every one has. */
export function todaysHighlight(
  stories: readonly NewsStory[],
  history: MagnitudeHistory,
  profile: InterestProfile,
  shown: ReadonlySet<string>,
  now: number,
): ScoredStory | null {
  const recent = stories.filter((story) => now - story.publishedAt <= HIGHLIGHT_WINDOW_MS)
  return rankStories(recent, history, profile).find((scored) => scored.keys.every((key) => !shown.has(key))) ?? null
}

/** The history with today's magnitudes recorded (the largest seen for each story) and days past the baseline dropped. */
export function recordMagnitudes(history: MagnitudeHistory, stories: readonly NewsStory[], now: number): MagnitudeHistory {
  const keep = new Set(baselineDays(now))
  const next: MagnitudeHistory = {}
  for (const [source, days] of Object.entries(history)) {
    for (const [day, magnitudes] of Object.entries(days)) {
      if (!keep.has(day)) continue
      next[source] = { ...next[source], [day]: { ...magnitudes } }
    }
  }
  for (const story of stories) {
    const day = dayKey(story.publishedAt)
    if (!keep.has(day) || story.magnitude === null) continue
    const days = (next[story.source] ??= {})
    const magnitudes = (days[day] ??= {})
    magnitudes[story.key] = Math.max(magnitudes[story.key] ?? 0, story.magnitude)
  }
  return next
}
