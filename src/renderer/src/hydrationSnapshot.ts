import type { HydrationSnapshot } from '../../core/history/hydrationScope'

// The boot hydration snapshot, fetched once per page: the feed projection
// and the Active Session gate (#70) both consume it — one IPC round-trip,
// one boot-race story instead of one per consumer.
let cached: Promise<HydrationSnapshot> | null = null

export function hydrationSnapshot(): Promise<HydrationSnapshot> {
  cached ??= window.bingbong.history.recentEntries()
  return cached
}
