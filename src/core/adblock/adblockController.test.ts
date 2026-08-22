import { describe, expect, it } from 'vitest'
import {
  ADBLOCK_QUICK_FIXES_URL,
  ADBLOCK_DAILY_REFRESH_MS,
  ADBLOCK_HOURLY_REFRESH_MS,
  type AdblockCacheEntry,
  type AdblockCacheMeta,
} from './adblockConfig'
import { ADBLOCK_RETRY_MS, createAdblockController, type AdblockControllerDeps } from './adblockController'

// The controller owns cache-vs-fetch per artifact (each list refreshes on its
// own cadence; quick-fixes hourly, the rest daily), the refresh schedule,
// engine swaps and the kill switch. Everything electronic (fetch, parse, disk,
// session) is a dep, so these tests drive the policy, not Electron.

const HOURLY = ADBLOCK_HOURLY_REFRESH_MS
const T0 = 1_000_000

interface FakeEngine {
  id: string
}

interface DepsHarness extends AdblockControllerDeps {
  urls: { dailyA: string; quickFixes: string; dailyB: string; resources: string }
  fetched: string[]
  applied: { engine: FakeEngine | null; enabled: boolean }[]
  written: { raw: Uint8Array; meta: AdblockCacheMeta }[]
  scheduleCalls: { ms: number }[]
  warnings: string[]
  listTexts: Map<string, string>
  setCache(next: { engine: Uint8Array; meta: AdblockCacheMeta } | null): void
  setNow(ms: number): void
  advance(ms: number): void
  fireRefresh(): Promise<void>
  cancelledRefresh(): boolean
}

function entry(url: string, updatedAt: number): AdblockCacheEntry {
  return { url, updatedAt }
}

function baseDeps(overrides?: Partial<AdblockControllerDeps>): DepsHarness {
  const urls = {
    dailyA: 'http://lists.example/a.txt',
    quickFixes: ADBLOCK_QUICK_FIXES_URL,
    dailyB: 'http://lists.example/b.txt',
    resources: 'http://lists.example/resources.json',
  }
  const fetched: string[] = []
  const applied: { engine: FakeEngine | null; enabled: boolean }[] = []
  const written: { raw: Uint8Array; meta: AdblockCacheMeta }[] = []
  const scheduleCalls: { ms: number }[] = []
  const warnings: string[] = []
  const listTexts = new Map<string, string>()

  let cache: { engine: Uint8Array; meta: AdblockCacheMeta } | null = null
  let fire: () => Promise<void> | void = () => {}
  let cancelled = false
  let nextEngineId = 0
  let nowMs = T0

  const deps: AdblockControllerDeps = {
    lists: [urls.dailyA, urls.quickFixes, urls.dailyB],
    resourcesUrl: urls.resources,
    fetchText: async (url) => {
      fetched.push(url)
      return `filters-for ${url}`
    },
    readCachedText: (url) => listTexts.get(url) ?? null,
    writeCachedText: (url, text) => {
      listTexts.set(url, text)
    },
    parseEngine: () => ({ id: `engine-${nextEngineId++}` }) as unknown as FakeEngine,
    serializeEngine: (engine) => new TextEncoder().encode(`serialized:${(engine as FakeEngine).id}`),
    deserializeEngine: (raw) => {
      const text = new TextDecoder().decode(raw)
      if (!text.startsWith('serialized:')) throw new Error('corrupt cache')
      return { id: text.slice('serialized:'.length) } as unknown as FakeEngine
    },
    readCache: () => cache,
    writeCache: (raw, meta) => {
      written.push({ raw, meta })
      cache = { engine: raw, meta }
    },
    applyEngine: (engine, enabled) => applied.push({ engine: engine as FakeEngine | null, enabled }),
    enabledAtStart: true,
    now: () => nowMs,
    schedule: (callback, ms) => {
      scheduleCalls.push({ ms })
      fire = callback
      cancelled = false
      return () => {
        cancelled = true
      }
    },
    onWarning: (message) => warnings.push(message),
    ...overrides,
  }

  // Assigned (not spread) so tests can override deps fields after creation
  // and the controller — which closed over this object — sees the change.
  return Object.assign(deps, {
    urls,
    fetched,
    applied,
    written,
    scheduleCalls,
    warnings,
    listTexts,
    setCache: (next: { engine: Uint8Array; meta: AdblockCacheMeta } | null) => {
      cache = next
    },
    setNow: (ms: number) => {
      nowMs = ms
    },
    advance: (ms: number) => {
      nowMs += ms
    },
    fireRefresh: async () => {
      await fire()
    },
    cancelledRefresh: () => cancelled,
  })
}

function cacheEntry(meta: AdblockCacheMeta): { engine: Uint8Array; meta: AdblockCacheMeta } {
  // Serialized as "engine-cached" so tests can tell a deserialized cache
  // apart from a freshly parsed "engine-N".
  return { engine: new TextEncoder().encode('serialized:engine-cached'), meta }
}

/** A fully-populated cache from a run at T0: texts on disk, meta per artifact. */
function warmCache(deps: DepsHarness): { engine: Uint8Array; meta: AdblockCacheMeta } {
  const { dailyA, quickFixes, dailyB, resources } = deps.urls
  for (const url of [dailyA, quickFixes, dailyB, resources]) {
    deps.listTexts.set(url, `filters-for ${url}`)
  }
  return cacheEntry({
    lists: [entry(dailyA, T0), entry(quickFixes, T0), entry(dailyB, T0)],
    resources: entry(resources, T0),
  })
}

describe('createAdblockController startup', () => {
  it('fetches lists + resources on a cold cache, caches every text and applies the engine', async () => {
    const deps = baseDeps()
    const controller = createAdblockController(deps)
    await controller.ready()

    expect(deps.fetched).toEqual([deps.urls.dailyA, deps.urls.quickFixes, deps.urls.dailyB, deps.urls.resources])
    expect([...deps.listTexts.keys()].sort()).toEqual(
      [deps.urls.dailyA, deps.urls.quickFixes, deps.urls.dailyB, deps.urls.resources].sort(),
    )
    expect(deps.applied).toEqual([{ engine: { id: 'engine-0' }, enabled: true }])
    expect(deps.written).toHaveLength(1)
    expect(deps.written[0]!.meta).toEqual({
      lists: [entry(deps.urls.dailyA, T0), entry(deps.urls.quickFixes, T0), entry(deps.urls.dailyB, T0)],
      resources: entry(deps.urls.resources, T0),
    })
    // The next refresh waits only until quick-fixes goes stale — one hour.
    expect(deps.scheduleCalls.map((call) => call.ms)).toEqual([HOURLY])

    controller.dispose()
  })

  it('reuses a fully fresh cache without touching the network, scheduling at the remaining deadline', async () => {
    const deps = baseDeps()
    deps.setCache(warmCache(deps))
    deps.setNow(T0 + 30 * 60 * 1000) // 30 minutes later: everything still fresh
    const controller = createAdblockController(deps)
    await controller.ready()

    expect(deps.fetched).toEqual([])
    expect(deps.written).toEqual([])
    expect(deps.applied).toEqual([{ engine: { id: 'engine-cached' }, enabled: true }])
    // quick-fixes goes stale in 30 more minutes; the daily artifacts in ~24h.
    expect(deps.scheduleCalls.map((call) => call.ms)).toEqual([30 * 60 * 1000])

    controller.dispose()
  })

  it('refreshes only the stale hourly list, rebuilding from cached texts for the daily ones', async () => {
    const deps = baseDeps()
    deps.setCache(warmCache(deps))
    deps.setNow(T0 + 2 * HOURLY) // quick-fixes stale; daily lists + resources fresh
    const controller = createAdblockController(deps)
    await controller.ready()

    expect(deps.fetched).toEqual([deps.urls.quickFixes])
    // A freshly parsed engine is swapped in, rebuilt from cached daily texts.
    expect(deps.applied).toEqual([{ engine: { id: 'engine-0' }, enabled: true }])
    expect(deps.written).toHaveLength(1)
    expect(deps.written[0]!.meta).toEqual({
      // Daily artifacts keep their last-fetch time; only quick-fixes advanced.
      lists: [entry(deps.urls.dailyA, T0), entry(deps.urls.quickFixes, T0 + 2 * HOURLY), entry(deps.urls.dailyB, T0)],
      resources: entry(deps.urls.resources, T0),
    })
    expect(deps.scheduleCalls.map((call) => call.ms)).toEqual([HOURLY])

    controller.dispose()
  })

  it('refetches a list whose cached text went missing even though its meta entry is fresh', async () => {
    const deps = baseDeps()
    const warm = warmCache(deps)
    deps.listTexts.delete(deps.urls.dailyA)
    // Force the rebuild path (the serialized engine is unusable) while every
    // meta entry stays fresh: only the missing text goes back to the network.
    deps.setCache({ engine: new TextEncoder().encode('garbage'), meta: warm.meta })
    const controller = createAdblockController(deps)
    await controller.ready()

    expect(deps.fetched).toEqual([deps.urls.dailyA])
    expect(deps.applied).toHaveLength(1)

    controller.dispose()
  })

  it('treats a pre-per-list-cadence cache (one updatedAt for all urls) as a cold start', async () => {
    const deps = baseDeps()
    const legacy = { urls: deps.lists, updatedAt: T0 } as unknown as AdblockCacheMeta
    deps.setCache({ engine: new TextEncoder().encode('serialized:engine-cached'), meta: legacy })
    const controller = createAdblockController(deps)
    await controller.ready()

    // No crash, no reuse: everything goes back to the network and the cache is
    // rewritten in the per-artifact shape.
    expect(deps.fetched).toEqual([deps.urls.dailyA, deps.urls.quickFixes, deps.urls.dailyB, deps.urls.resources])
    expect(deps.applied).toEqual([{ engine: { id: 'engine-0' }, enabled: true }])
    expect(deps.written).toHaveLength(1)
    expect(deps.written[0]!.meta.lists.map((entry) => entry.url)).toEqual(deps.lists)

    controller.dispose()
  })

  it('rebuilds offline from cached texts when the serialized engine is corrupt', async () => {
    const deps = baseDeps()
    const warm = warmCache(deps)
    deps.setCache({ engine: new TextEncoder().encode('garbage'), meta: warm.meta })
    const controller = createAdblockController(deps)
    await controller.ready()

    expect(deps.fetched).toEqual([])
    expect(deps.written).toHaveLength(1)
    expect(deps.applied).toHaveLength(1)

    controller.dispose()
  })

  it('degrades to no engine when lists cannot be fetched, and retries sooner', async () => {
    const deps = baseDeps({
      fetchText: async () => {
        throw new Error('offline')
      },
    })
    const controller = createAdblockController(deps)
    await expect(controller.ready()).resolves.toBeUndefined()

    expect(deps.applied).toEqual([{ engine: null, enabled: true }])
    expect(deps.written).toEqual([])
    expect(deps.warnings).toHaveLength(1)
    expect(deps.scheduleCalls.map((call) => call.ms)).toEqual([ADBLOCK_RETRY_MS])

    controller.dispose()
  })

  it('keeps blocking when only scriptlet resources fail to fetch', async () => {
    const deps = baseDeps({
      fetchText: async (url) => {
        if (url.endsWith('resources.json')) throw new Error('offline')
        return 'filters'
      },
    })
    const controller = createAdblockController(deps)
    await controller.ready()

    expect(deps.applied).toEqual([{ engine: { id: 'engine-0' }, enabled: true }])

    controller.dispose()
  })

  it('falls back to the cached resources text when a refresh of them fails', async () => {
    const deps = baseDeps()
    deps.setCache(warmCache(deps))
    deps.setNow(T0 + ADBLOCK_DAILY_REFRESH_MS + 1000) // everything stale
    deps.fetchText = async (url) => {
      if (url === deps.urls.resources) throw new Error('offline')
      deps.fetched.push(url)
      return `fresh-filters-for ${url}`
    }
    const controller = createAdblockController(deps)
    await controller.ready()

    // Lists refetched; resources fell back to the (stale) cached text and did
    // not pretend to be fresh.
    expect(deps.fetched).not.toContain(deps.urls.resources)
    expect(deps.written[0]!.meta.resources).toEqual(entry(deps.urls.resources, T0))

    controller.dispose()
  })

  it('stays inert with no lists configured', async () => {
    const deps = baseDeps({ lists: [], resourcesUrl: null })
    const controller = createAdblockController(deps)
    await controller.ready()

    expect(deps.fetched).toEqual([])
    expect(deps.applied).toEqual([])
    expect(deps.scheduleCalls).toEqual([])

    controller.dispose()
  })

  it('honors a kill switch flipped while the first fetch is in flight', async () => {
    let releaseFetch: (() => void) | undefined
    const gate = new Promise<string>((resolve) => {
      releaseFetch = () => resolve('filters')
    })
    const deps = baseDeps({ fetchText: () => gate })
    const controller = createAdblockController(deps)
    controller.setEnabled(false)
    releaseFetch?.()
    await controller.ready()

    expect(deps.applied).toEqual([{ engine: { id: 'engine-0' }, enabled: false }])

    controller.dispose()
  })
})

describe('createAdblockController refresh', () => {
  it('sweeps the hourly list on the scheduled tick and reschedules an hour out', async () => {
    const deps = baseDeps()
    deps.setCache(warmCache(deps))
    const controller = createAdblockController(deps)
    await controller.ready()

    expect(deps.scheduleCalls.map((call) => call.ms)).toEqual([HOURLY])

    deps.advance(HOURLY) // quick-fixes hits its deadline
    await deps.fireRefresh()

    expect(deps.fetched).toEqual([deps.urls.quickFixes])
    // A fresh engine instance is swapped in over the cached one.
    expect(deps.applied).toHaveLength(2)
    expect(deps.applied[1]!.engine).not.toBe(deps.applied[0]!.engine)
    expect(deps.applied.map((entry) => entry.enabled)).toEqual([true, true])
    expect(deps.written[0]!.meta.lists).toEqual([
      entry(deps.urls.dailyA, T0),
      entry(deps.urls.quickFixes, T0 + HOURLY),
      entry(deps.urls.dailyB, T0),
    ])
    // The next sweep is again one hour out — quick-fixes stays hourly without
    // dragging the daily lists back to the network.
    expect(deps.scheduleCalls.map((call) => call.ms)).toEqual([HOURLY, HOURLY])

    controller.dispose()
  })

  it('sweeps the daily lists too once their own deadline arrives', async () => {
    const deps = baseDeps()
    deps.setCache(warmCache(deps))
    const controller = createAdblockController(deps)
    await controller.ready()

    deps.advance(ADBLOCK_DAILY_REFRESH_MS) // a full day: everything stale
    await deps.fireRefresh()

    expect(deps.fetched).toEqual([deps.urls.dailyA, deps.urls.quickFixes, deps.urls.dailyB, deps.urls.resources])

    controller.dispose()
  })

  it('keeps the previous engine when a refresh fails', async () => {
    const deps = baseDeps()
    deps.setCache(warmCache(deps))
    const controller = createAdblockController(deps)
    await controller.ready()

    deps.advance(HOURLY) // quick-fixes is stale, so the sweep must hit the network
    deps.fetchText = async () => {
      throw new Error('offline')
    }
    await deps.fireRefresh()

    expect(deps.applied).toEqual([{ engine: { id: 'engine-cached' }, enabled: true }])
    expect(deps.warnings).toHaveLength(1)
    expect(deps.scheduleCalls.map((call) => call.ms)).toEqual([HOURLY, ADBLOCK_RETRY_MS])

    controller.dispose()
  })

  it('stops scheduling after dispose', async () => {
    const deps = baseDeps()
    const controller = createAdblockController(deps)
    await controller.ready()
    controller.dispose()

    expect(deps.cancelledRefresh()).toBe(true)
  })
})

describe('createAdblockController kill switch', () => {
  it('disables and re-enables the current engine without a refetch', async () => {
    const deps = baseDeps()
    deps.setCache(warmCache(deps))
    const controller = createAdblockController(deps)
    await controller.ready()

    controller.setEnabled(false)
    controller.setEnabled(false)
    controller.setEnabled(true)

    expect(deps.fetched).toEqual([])
    expect(deps.applied).toEqual([
      { engine: { id: 'engine-cached' }, enabled: true },
      { engine: { id: 'engine-cached' }, enabled: false },
      { engine: { id: 'engine-cached' }, enabled: true },
    ])

    controller.dispose()
  })

  it('applies a late-arriving engine according to the current switch state', async () => {
    const deps = baseDeps()
    const controller = createAdblockController(deps)
    controller.setEnabled(false)
    await controller.ready()

    expect(deps.applied).toEqual([{ engine: { id: 'engine-0' }, enabled: false }])

    controller.dispose()
  })
})
