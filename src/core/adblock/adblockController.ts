// Orchestrator for the embedder-level adblocker (issue #21). Owns the
// disk-cache-vs-network decision, the scheduled list refresh, engine swaps
// and the settings kill switch. All IO (fetch, parse, disk, session apply)
// arrives as deps so the policy is unit-testable; the Electron glue lives in
// src/main/browser/attachAdblock.ts.

import { cacheIsUsable, type AdblockCacheMeta } from './adblockConfig'

/** After a failed fetch, retry in an hour instead of waiting a full day. */
export const ADBLOCK_RETRY_MS = 60 * 60 * 1000

/** Opaque handle for a parsed blocking engine (an ElectronBlocker in the glue). */
export type AdblockEngine = object

export interface AdblockControllerDeps {
  lists: string[]
  resourcesUrl: string | null
  fetchText(url: string): Promise<string>
  parseEngine(listsText: string[], resources: string | null): AdblockEngine
  serializeEngine(engine: AdblockEngine): Uint8Array
  deserializeEngine(raw: Uint8Array): AdblockEngine
  readCache(): { engine: Uint8Array; meta: AdblockCacheMeta } | null
  writeCache(raw: Uint8Array, meta: AdblockCacheMeta): void
  /** Enforce (or stop enforcing) an engine; null means "nothing available". */
  applyEngine(engine: AdblockEngine | null, enabled: boolean): void
  enabledAtStart: boolean
  now(): number
  updateEveryMs: number
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

  /** Always goes to the network — the refresh path. */
  async function fetchEngine(): Promise<AdblockEngine> {
    const listsText = await Promise.all(deps.lists.map((url) => deps.fetchText(url)))
    // Scriptlet resources are optional: cosmetic hiding and network blocking
    // work without them, so a failed fetch must not take the engine down.
    const resources =
      deps.resourcesUrl === null ? null : await deps.fetchText(deps.resourcesUrl).catch(() => null)
    const engine = deps.parseEngine(listsText, resources)
    deps.writeCache(deps.serializeEngine(engine), { urls: deps.lists, updatedAt: deps.now() })
    return engine
  }

  /** Cache-first — what launches use so lists aren't re-downloaded. */
  async function loadEngine(): Promise<AdblockEngine> {
    const cached = deps.readCache()
    if (cached !== null && cacheIsUsable(cached.meta, deps.lists, deps.now(), deps.updateEveryMs)) {
      try {
        return deps.deserializeEngine(cached.engine)
      } catch {
        // Corrupt cache (or a serialized engine from another library
        // version): fall through and rebuild from the network.
      }
    }
    return fetchEngine()
  }

  function applyCurrent(): void {
    deps.applyEngine(current, enabled)
  }

  function scheduleNext(ms: number): void {
    cancelSchedule?.()
    cancelSchedule = deps.schedule(() => refresh(), ms)
  }

  async function refresh(): Promise<void> {
    if (disposed) return
    try {
      current = await fetchEngine()
      if (disposed) return
      applyCurrent()
      scheduleNext(deps.updateEveryMs)
    } catch (error) {
      warn(`adblock list refresh failed: ${error instanceof Error ? error.message : String(error)}`)
      // Keep the previous engine enforced; try again sooner.
      if (!disposed) scheduleNext(ADBLOCK_RETRY_MS)
    }
  }

  const ready = (async () => {
    try {
      current = await loadEngine()
      if (disposed) return
      applyCurrent()
      scheduleNext(deps.updateEveryMs)
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
