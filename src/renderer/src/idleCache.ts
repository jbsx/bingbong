import { idleCacheKey, keptAnswerRecord, keptAnswerValue, type IdleCacheCard } from '../../core/idle/idleCache'
import { reportRendererFault } from './diagnostics'

/** The card's last answer for `key` (core/idle/idleCache), no older than `maxAgeMs`; null when it kept none or storage cannot be read. */
export function keptAnswer<T>(card: IdleCacheCard, key: string, maxAgeMs: number): T | null {
  try {
    const raw = window.localStorage.getItem(idleCacheKey(card))
    return raw === null ? null : keptAnswerValue<T>(JSON.parse(raw), key, Date.now(), maxAgeMs)
  } catch (error) {
    reportRendererFault('idleCache.keptAnswer', error)
    return null
  }
}

/** Keeps the card's fresh answer for `key`, for the next time the Idle Screen comes up; storage that refuses it only costs that head start. */
export function keepAnswer(card: IdleCacheCard, key: string, value: unknown): void {
  try {
    window.localStorage.setItem(idleCacheKey(card), JSON.stringify(keptAnswerRecord(key, value, Date.now())))
  } catch (error) {
    reportRendererFault('idleCache.keepAnswer', error)
  }
}
