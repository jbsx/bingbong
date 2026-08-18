import type { RecordedEntry, TranscriptEvent } from './historyStore'

function fingerprint(entry: TranscriptEvent): string {
  return `${entry.at}\0${entry.kind}\0${entry.text}`
}

/**
 * Remove live events already contained in an IPC history snapshot. The count
 * map preserves legitimate repeated lines while closing the startup race
 * between event subscription and asynchronous hydration.
 */
export function filterHydratedDuplicates<T extends TranscriptEvent>(
  recorded: readonly RecordedEntry[],
  live: readonly T[],
): T[] {
  const remaining = new Map<string, number>()
  for (const entry of recorded) {
    const key = fingerprint(entry)
    remaining.set(key, (remaining.get(key) ?? 0) + 1)
  }

  return live.filter((entry) => {
    const key = fingerprint(entry)
    const count = remaining.get(key) ?? 0
    if (count === 0) return true
    remaining.set(key, count - 1)
    return false
  })
}
