import { gatherStories, type NewsSource, type NewsStory } from './news'
import type { InterestProfile } from './interestProfile'
import { HIGHLIGHT_WINDOW_MS, recordMagnitudes, todaysHighlight, type MagnitudeHistory } from './score'

// The News Desk: main's side of the News card (the card is in CONTEXT.md). The Idle Screen
// asks for Today's Highlight whenever it shows and every few minutes after;
// the desk fetches at most once an hour — the first ask after a start polls
// at once — and answers the highlight it holds in between. Each poll records
// the sources' magnitudes (the baseline scores read against) and, when an
// unseen story tops the ranking, makes it the highlight and marks it shown.
// A poll no source answered keeps the last highlight and is tried again in
// a few minutes.

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

/** What the desk keeps in userData, so "unseen" and the last highlight survive a restart. */
export interface NewsState {
  shown: { key: string; at: number }[]
  history: MagnitudeHistory
  highlight: TodaysHighlight | null
}

export interface NewsStore {
  load(): NewsState
  save(state: NewsState): void
}

export function emptyNewsState(): NewsState {
  return { shown: [], history: {}, highlight: null }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStory(value: unknown): value is NewsStory {
  if (!isRecord(value)) return false
  const { key, title, link, source, publishedAt, magnitude, unit, comments } = value
  return (
    typeof key === 'string' &&
    typeof title === 'string' &&
    typeof link === 'string' &&
    typeof source === 'string' &&
    typeof publishedAt === 'number' &&
    typeof magnitude === 'number' &&
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
      ? { story: held.story, topics: held.topics.filter((topic): topic is string => typeof topic === 'string'), shownAt: held.shownAt }
      : null
  return { shown, history, highlight }
}

export interface NewsDesk {
  /** Today's Highlight, polling first when the last poll is an hour old; null when there has never been one or the profile is empty. */
  highlight(): Promise<TodaysHighlight | null>
}

export function createNewsDesk(deps: {
  sources: readonly NewsSource[]
  store: NewsStore
  profile: () => InterestProfile
  now?: () => number
}): NewsDesk {
  const now = deps.now ?? Date.now
  let state = deps.store.load()
  let polledAt: number | null = null
  let polling: Promise<void> | null = null

  async function poll(at: number, profile: InterestProfile): Promise<void> {
    const { stories, answered } = await gatherStories(deps.sources, at - HIGHLIGHT_WINDOW_MS)
    if (!answered) {
      polledAt = at - NEWS_POLL_MS + NEWS_RETRY_MS
      return
    }
    const history = recordMagnitudes(state.history, stories, at)
    const shown = state.shown.filter((entry) => at - entry.at <= SHOWN_KEEP_MS)
    const pick = todaysHighlight(stories, history, profile, new Set(shown.map((entry) => entry.key)), at)
    state =
      pick === null
        ? { ...state, history, shown }
        : { history, shown: [...shown, { key: pick.story.key, at }], highlight: { story: pick.story, topics: pick.topics, shownAt: at } }
    deps.store.save(state)
  }

  return {
    async highlight() {
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
      return state.highlight
    },
  }
}
