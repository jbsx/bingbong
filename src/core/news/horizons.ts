import type { ScoredStory } from './score'
import { dayKey } from './score'

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

/** How alike two titles on one site must be (shared words over all words) to be one story. */
const SAME_TITLE = 0.75

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
  days: Record<string, { score: number; magnitude: number }>
}

/** Every polled story by key. */
export type StoryHistory = Record<string, StoryRecord>

/** One line of This Week or This Month: the cluster's story at its peak. */
export interface NewsListItem {
  key: string
  title: string
  link: string
  source: string
  magnitude: number
  unit: string
}

/** The local days ending with `at`'s, `count` of them. */
function daysBack(at: number, count: number): string[] {
  const date = new Date(at)
  return Array.from({ length: count }, (_, back) => dayKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() - back, 12).getTime()))
}

/** The address with what does not change the page dropped: scheme, www, a trailing slash, the fragment and tracking parameters. */
function linkKey(link: string): string {
  if (!URL.canParse(link)) return link
  const url = new URL(link)
  for (const name of [...url.searchParams.keys()]) if (name.startsWith('utm_') || name === 'ref') url.searchParams.delete(name)
  const query = url.searchParams.toString()
  return `${url.hostname.replace(/^www\./, '')}${url.pathname.replace(/\/+$/, '')}${query === '' ? '' : `?${query}`}`
}

function hostOf(link: string): string {
  return URL.canParse(link) ? new URL(link).hostname.replace(/^www\./, '') : ''
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

function sameStory(a: Pick<StoryRecord, 'title' | 'link'>, b: Pick<StoryRecord, 'title' | 'link'>): boolean {
  if (linkKey(a.link) === linkKey(b.link)) return true
  if (hostOf(a.link) !== '' && hostOf(a.link) === hostOf(b.link) && likeness(titleWords(a.title), titleWords(b.title)) >= SAME_TITLE) return true
  const names = new Set(properNames(a.title))
  return properNames(b.title).some((name) => names.has(name))
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
      days: { ...known.days, [today]: { score: Math.max(held?.score ?? 0, score), magnitude: Math.max(held?.magnitude ?? 0, story.magnitude) } },
    }
  }
  return next
}

interface Peak {
  key: string
  record: StoryRecord
  score: number
  magnitude: number
}

/** Topical over not, then score, then magnitude: the order Today's Highlight ranks in. */
function better(a: Peak, b: Peak): number {
  return Number(b.record.topical) - Number(a.record.topical) || b.score - a.score || b.magnitude - a.magnitude
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

/**
 * This Month (CONTEXT.md): the top five stories of the last thirty days that
 * lasted — in the top five of at least two calendar weeks (Monday to
 * Sunday), or of at least three separate days — each cluster at its peak.
 */
export function thisMonth(history: StoryHistory, now: number): NewsListItem[] {
  const days = daysBack(now, MONTH_DAYS)
  const weeks = new Map<string, string[]>()
  for (const day of days) weeks.set(weekOf(day), [...(weeks.get(weekOf(day)) ?? []), day])
  const count = (lists: Iterable<readonly string[]>): Map<string, number> => {
    const counts = new Map<string, number>()
    for (const list of lists) for (const peak of topClusters(history, list, LIST_LENGTH)) counts.set(peak.record.cluster, (counts.get(peak.record.cluster) ?? 0) + 1)
    return counts
  }
  const inWeeks = count(weeks.values())
  const onDays = count(days.map((day) => [day]))
  const lasted = (cluster: string): boolean => (inWeeks.get(cluster) ?? 0) >= LASTING_WEEKS || (onDays.get(cluster) ?? 0) >= LASTING_DAYS
  return topClusters(history, days, Number.POSITIVE_INFINITY)
    .filter((peak) => lasted(peak.record.cluster))
    .slice(0, LIST_LENGTH)
    .map(itemOf)
}
