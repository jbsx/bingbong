// The audio road's remembered addresses (#516): a stream that played stays
// good for about 6 hours (`expire` minus `available_at`, about 21,600 s on
// the kiosk, 2026-10-30), and 8 of 17 plays there repeated a video within 5
// hours, so a repeat play skips the lookup. In memory only: an address is
// tied to its IP and its hours, and a restart costs one lookup.

/** A guess: `expire` is in whole seconds, and the track's last read should land short of it. The `refused` count of remembered plays in `pnpm perf:report` settles it. */
const EXPIRE_MARGIN_MS = 60_000

/** The address and when it is served: nothing of how an earlier lookup went. */
export interface RememberedStream {
  readonly stream: string
  readonly availableAt: number | null
}

/**
 * Until when an address may be played again (epoch ms): before it expires
 * by the length of the track it must carry (`dur`), since each later range
 * is asked of it, so a long video's address is kept for less. Null when it
 * names no expiry.
 */
export function keptUntil(address: string): number | null {
  if (!URL.canParse(address)) return null
  const query = new URL(address).searchParams
  const expire = Number(query.get('expire') ?? NaN)
  if (!Number.isFinite(expire)) return null
  const trackS = Number(query.get('dur') ?? 0)
  return expire * 1000 - (Number.isFinite(trackS) ? trackS * 1000 : 0) - EXPIRE_MARGIN_MS
}

export interface StreamMemory {
  /** A stream that played, by its video; one naming no expiry is not kept. */
  keep(id: string, stream: RememberedStream): void
  /** The video's address while its time lasts, else null. */
  recall(id: string, now: number): RememberedStream | null
  forget(id: string): void
}

export function createStreamMemory(): StreamMemory {
  const kept = new Map<string, { stream: RememberedStream; until: number }>()
  return {
    keep(id, { stream, availableAt }) {
      const until = keptUntil(stream)
      if (until !== null) kept.set(id, { stream: { stream, availableAt }, until })
    },
    recall(id, now) {
      const held = kept.get(id)
      if (held === undefined) return null
      if (now < held.until) return held.stream
      kept.delete(id)
      return null
    },
    forget(id) {
      kept.delete(id)
    },
  }
}
