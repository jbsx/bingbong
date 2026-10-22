/**
 * The Idle Screen's last answers, kept in the renderer's localStorage so the
 * screen draws what it showed last the moment it comes up — after a wake,
 * after a restart — and only swaps in the fresh answer when it lands. Each
 * card keeps one answer, for the inputs it was asked with (a city and its
 * units, a dashboard URL, a calendar range), and a card's answer older than
 * the card allows reads as none.
 */
export type IdleCacheCard = 'weather' | 'usage' | 'news' | 'calendar' | 'lastPage' | 'weighIns'

/** The storage key a card's answer lives under; the version moves when a kept shape stops being read. */
export function idleCacheKey(card: IdleCacheCard): string {
  return `bingbong.idleCache.v1.${card}`
}

/** One card's kept answer as stored: the inputs it was asked with, when, and the answer. */
export interface KeptAnswer {
  key: string
  at: number
  value: unknown
}

export function keptAnswerRecord(key: string, value: unknown, now: number): KeptAnswer {
  return { key, at: now, value }
}

function isKeptAnswer(raw: unknown): raw is KeptAnswer {
  if (typeof raw !== 'object' || raw === null) return false
  const kept = raw as Record<string, unknown>
  return typeof kept.key === 'string' && typeof kept.at === 'number' && 'value' in kept
}

/**
 * The answer in a stored record (parsed) when it was asked with `key` and
 * is no older than `maxAgeMs` at `now`; else null. A record of another
 * shape, or a kept null, reads as none.
 */
export function keptAnswerValue<T>(stored: unknown, key: string, now: number, maxAgeMs: number): T | null {
  if (!isKeptAnswer(stored) || stored.key !== key || now - stored.at > maxAgeMs || stored.value === null) return null
  return stored.value as T
}
