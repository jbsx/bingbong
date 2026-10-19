import type { NewsStory } from './news'
import { matchTopics, type InterestProfile } from './interestProfile'

// Scoring the News (CONTEXT.md): a story is big for its own source, not in
// absolute numbers — its magnitude's percentile against that source's recent
// days — so a quiet site's best day and a loud site's best day read on one
// scale. The Interest Profile then boosts it by the topics it matches, and a
// story matching none ranks under every story that matches one.

/** Each source's magnitudes by local day ('YYYY-MM-DD'), by story key: what "a normal day" is measured against. */
export type MagnitudeHistory = Record<string, Record<string, Record<string, number>>>

/** How many days, the story's own included, make the baseline it is scored against. */
export const BASELINE_DAYS = 7

export const DAY_MS = 24 * 60 * 60 * 1000

/** How long Today's Highlight looks back. */
export const HIGHLIGHT_WINDOW_MS = DAY_MS

export interface ScoredStory {
  story: NewsStory
  /** The Interest Profile topics it matched, in the profile's order. */
  topics: string[]
  /** Its magnitude's percentile in its source's baseline, 0–1. */
  percentile: number
  score: number
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

/** The order the News ranks in, best first: a story matching a topic over one matching none, then by score, then by magnitude. */
export function rankOrder(a: { topical: boolean; score: number; magnitude: number }, b: { topical: boolean; score: number; magnitude: number }): number {
  return Number(b.topical) - Number(a.topical) || b.score - a.score || b.magnitude - a.magnitude
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
  for (const other of stories) if (other.source === story.source && window.has(dayKey(other.publishedAt))) byKey.set(other.key, other.magnitude)
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

/** Every story scored, best first: those matching a topic over those matching none, then by percentile boosted per topic matched. */
export function rankStories(stories: readonly NewsStory[], history: MagnitudeHistory, profile: InterestProfile): ScoredStory[] {
  const scored = stories.map((story) => {
    const topics = matchTopics(story.title, profile)
    const rank = percentile(story.magnitude, baseline(story, history, stories))
    return { story, topics, percentile: rank, score: rank * (1 + (Math.max(1, topics.length) - 1) / 2) }
  })
  const order = (each: ScoredStory) => ({ topical: each.topics.length > 0, score: each.score, magnitude: each.story.magnitude })
  return scored.sort((a, b) => rankOrder(order(a), order(b)))
}

/** Today's Highlight (CONTEXT.md): the top-scoring story of the last 24 hours whose key has not been shown; none when every one has. */
export function todaysHighlight(
  stories: readonly NewsStory[],
  history: MagnitudeHistory,
  profile: InterestProfile,
  shown: ReadonlySet<string>,
  now: number,
): ScoredStory | null {
  const recent = stories.filter((story) => now - story.publishedAt <= HIGHLIGHT_WINDOW_MS)
  return rankStories(recent, history, profile).find((scored) => !shown.has(scored.story.key)) ?? null
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
    if (!keep.has(day)) continue
    const days = (next[story.source] ??= {})
    const magnitudes = (days[day] ??= {})
    magnitudes[story.key] = Math.max(magnitudes[story.key] ?? 0, story.magnitude)
  }
  return next
}
