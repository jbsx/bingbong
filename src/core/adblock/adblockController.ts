// Orchestrator for the embedder-level adblocker (issue #21). Owns the
// disk-cache-vs-network decision per artifact (issue #69: the quick-fixes
// list refreshes hourly while lists and resources stay on their daily
// cadence), the scheduled staleness sweeps, engine swaps and the settings
// kill switch. All IO (fetch, parse, disk, session apply) arrives as deps so
// the policy is unit-testable; the Electron glue lives in
// src/main/browser/attachAdblock.ts.

import {
  adblockEntryIsStale,
  adblockNextRefreshAtMs,
  cacheIsUsable,
  type AdblockCacheEntry,
  type AdblockCacheMeta,
} from './adblockConfig'
import { reportFault } from '../trace/fault'

/** After a failed fetch, retry in an hour instead of waiting a full day. */
export const ADBLOCK_RETRY_MS = 60 * 60 * 1000

/** Floor for scheduled sweeps so clock jitter can never spin the timer. */
const ADBLOCK_MIN_SCHEDULE_MS = 60_000

/** Opaque handle for a parsed blocking engine (an ElectronBlocker in the glue). */
export type AdblockEngine = object

export interface AdblockControllerDeps {
  lists: string[]
  resourcesUrl: string | null
  fetchText(url: string): Promise<string>
  /** Raw-text disk cache for lists and resources, keyed per URL. null means
   *  "not cached". */
  readCachedText(url: string): string | null
  writeCachedText(url: string, text: string): void
  parseEngine(listsText: string[], resources: string | null): AdblockEngine
  serializeEngine(engine: AdblockEngine): Uint8Array
  deserializeEngine(raw: Uint8Array): AdblockEngine
  readCache(): { engine: Uint8Array; meta: AdblockCacheMeta } | null
  writeCache(raw: Uint8Array, meta: AdblockCacheMeta): void
  /** Enforce (or stop enforcing) an engine; null means "nothing available". */
  applyEngine(engine: AdblockEngine | null, enabled: boolean): void
  enabledAtStart: boolean
  now(): number
  schedule(callback: () => Promise<void> | void, ms: number): () => void
  onWarning?(message: string): void
}

export interface AdblockController {
  /** Resolves once the initial load finished — engine applied or degraded. */
  ready(): Promise<void>
  /** Settings kill switch: flips enforcement without a restart or refetch. */
  setEnabled(next: boolean): void
  dispose(): void
}

/** One cached artifact (list or resources): its text and freshness entry. */
interface AdblockArtifact {
  text: string
  entry: AdblockCacheEntry
}

/** On-disk metas written before per-list cadence (issue #69) lack `lists`;
 *  treat those — and anything else malformed — as "no cache". */
function normalizeMeta(meta: AdblockCacheMeta | null): AdblockCacheMeta | null {
  return meta !== null && Array.isArray(meta.lists) ? meta : null
}

export function createAdblockController(deps: AdblockControllerDeps): AdblockController {
  if (deps.lists.length === 0) {
    return { ready: () => Promise.resolve(), setEnabled: () => {}, dispose: () => {} }
  }

  let enabled = deps.enabledAtStart
  let current: AdblockEngine | null = null
  let disposed = false
  let cancelSchedule: (() => void) | undefined

  function warn(message: string): void {
    deps.onWarning?.(message)
  }

  /** Cached text for a still-fresh entry, or null when it must be fetched. */
  function readFreshText(url: string, cachedEntry: AdblockCacheEntry | undefined): AdblockArtifact | null {
    if (cachedEntry === undefined || adblockEntryIsStale(cachedEntry, deps.now())) return null
    const cachedText = deps.readCachedText(url)
    return cachedText === null ? null : { text: cachedText, entry: cachedEntry }
  }

  /** One artifact (list or resources): cached text when fresh, else fetched. */
  async function loadArtifact(url: string, cachedEntry: AdblockCacheEntry | undefined): Promise<AdblockArtifact> {
    const fresh = readFreshText(url, cachedEntry)
    if (fresh !== null) return fresh
    const text = await deps.fetchText(url)
    deps.writeCachedText(url, text)
    return { text, entry: { url, updatedAt: deps.now() } }
  }

  /** Rebuilds the whole engine, going to the network only for stale or
   * missing artifacts. Any *list* fetch failure rejects (the caller keeps the
   * previous engine); resources degrade to their cached text or null. */
  async function rebuildEngine(rawMeta: AdblockCacheMeta | null): Promise<{ engine: AdblockEngine; meta: AdblockCacheMeta }> {
    const meta = normalizeMeta(rawMeta)
    const lists = await Promise.all(
      deps.lists.map((url, index) => {
        const cachedEntry = meta?.lists[index]?.url === url ? meta.lists[index] : undefined
        return loadArtifact(url, cachedEntry)
      }),
    )

    let resources: { text: string | null; entry: AdblockCacheEntry | null } = { text: null, entry: null }
    if (deps.resourcesUrl !== null) {
      const cachedEntry = meta?.resources?.url === deps.resourcesUrl ? meta.resources : undefined
      const fresh = readFreshText(deps.resourcesUrl, cachedEntry)
      if (fresh !== null) {
        resources = fresh
      } else {
        // Scriptlet resources are optional: cosmetic hiding and network
        // blocking work without them, so a failed fetch must not take the
        // engine down. A stale cached copy still beats no scriptlets.
        const fetched = await deps.fetchText(deps.resourcesUrl).catch(() => null)
        if (fetched !== null) {
          deps.writeCachedText(deps.resourcesUrl, fetched)
          resources = { text: fetched, entry: { url: deps.resourcesUrl, updatedAt: deps.now() } }
        } else {
          const staleText = deps.readCachedText(deps.resourcesUrl)
          if (staleText !== null) resources = { text: staleText, entry: cachedEntry ?? null }
        }
      }
    }

    const engine = deps.parseEngine(
      lists.map((artifact) => artifact.text),
      resources.text,
    )
    const nextMeta: AdblockCacheMeta = {
      lists: lists.map((artifact) => artifact.entry),
      resources: resources.entry,
    }
    deps.writeCache(deps.serializeEngine(engine), nextMeta)
    return { engine, meta: nextMeta }
  }

  /** Cache-first — what launches use so lists aren't re-downloaded. */
  async function loadEngine(): Promise<{ engine: AdblockEngine; meta: AdblockCacheMeta }> {
    const cached = deps.readCache()
    if (cached !== null && cacheIsUsable(cached.meta, deps.lists, deps.resourcesUrl, deps.now())) {
      try {
        return { engine: deps.deserializeEngine(cached.engine), meta: cached.meta }
      } catch (error) {
        reportFault('adblock.adblockController.loadEngine', error)
        // Corrupt cache (or a serialized engine from another library
        // version): fall through and rebuild — offline from cached texts if
        // every artifact is still fresh.
      }
    }
    return rebuildEngine(cached?.meta ?? null)
  }

  function applyCurrent(): void {
    deps.applyEngine(current, enabled)
  }

  function scheduleAfter(meta: AdblockCacheMeta): void {
    const delay = Math.max(adblockNextRefreshAtMs(meta) - deps.now(), ADBLOCK_MIN_SCHEDULE_MS)
    scheduleNext(delay)
  }

  function scheduleNext(ms: number): void {
    cancelSchedule?.()
    cancelSchedule = deps.schedule(() => refresh(), ms)
  }

  /** Sweeps whatever went stale since the last tick. */
  async function refresh(): Promise<void> {
    if (disposed) return
    const cached = deps.readCache()
    try {
      const { engine, meta } = await rebuildEngine(cached?.meta ?? null)
      if (disposed) return
      current = engine
      applyCurrent()
      scheduleAfter(meta)
    } catch (error) {
      warn(`adblock list refresh failed: ${error instanceof Error ? error.message : String(error)}`)
      // Keep the previous engine enforced; try again sooner.
      if (!disposed) scheduleNext(ADBLOCK_RETRY_MS)
    }
  }

  const ready = (async () => {
    try {
      const { engine, meta } = await loadEngine()
      if (disposed) return
      current = engine
      applyCurrent()
      scheduleAfter(meta)
    } catch (error) {
      warn(`adblock engine init failed: ${error instanceof Error ? error.message : String(error)}`)
      current = null
      if (!disposed) {
        applyCurrent()
        scheduleNext(ADBLOCK_RETRY_MS)
      }
    }
  })()

  return {
    ready: () => ready,
    setEnabled(next) {
      if (next === enabled) return
      enabled = next
      // Re-apply the current engine only when one exists; a null engine has
      // nothing to disable, and a late-arriving engine applies with this flag.
      if (current !== null) applyCurrent()
    },
    dispose() {
      disposed = true
      cancelSchedule?.()
    },
  }
}
