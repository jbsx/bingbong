/** A scale whose adverts stop for this long has gone to sleep; its next advert is a new stepping-on. */
export const ASLEEP_MS = 10_000

export interface WakeGate {
  /** An advert from `address` at `at` (ms): whether a connection may be made for it. */
  heard(address: string, at: number): boolean
  /** A connection to `address` ended: it is let be until it sleeps. */
  hold(address: string): void
}

/**
 * When the Scale Listener may connect (CONTEXT.md). A connected scale stays
 * awake and advertises again the moment it is let go, so connecting to
 * those adverts kept it awake for ever — a connect and a drop every half
 * minute, each one a desktop notification (2026-10-20). After a connection
 * ends, the scale is held until its adverts have stopped for ASLEEP_MS;
 * the first advert after that gap is a wake, and connects.
 */
export function createWakeGate(asleepMs = ASLEEP_MS): WakeGate {
  const lastHeard = new Map<string, number>()
  const held = new Set<string>()
  return {
    heard(address, at) {
      const last = lastHeard.get(address)
      lastHeard.set(address, at)
      if (!held.has(address)) return true
      if (last === undefined || at - last < asleepMs) return false
      held.delete(address)
      return true
    },
    hold(address) {
      held.add(address)
    },
  }
}
