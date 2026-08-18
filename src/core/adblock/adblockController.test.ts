import { describe, expect, it } from 'vitest'
import { ADBLOCK_RETRY_MS, createAdblockController, type AdblockControllerDeps } from './adblockController'
import type { AdblockCacheMeta } from './adblockConfig'

// The controller owns cache-vs-fetch, the refresh schedule, engine swaps and
// the kill switch. Everything electronic (fetch, parse, disk, session) is a
// dep, so these tests drive the policy, not Electron.

interface FakeEngine {
  id: string
}

interface DepsHarness extends AdblockControllerDeps {
  fetched: string[]
  applied: { engine: FakeEngine | null; enabled: boolean }[]
  written: { raw: Uint8Array; meta: AdblockCacheMeta }[]
  scheduleCalls: { ms: number }[]
  warnings: string[]
  setCache(next: { engine: Uint8Array; meta: AdblockCacheMeta } | null): void
  fireRefresh(): Promise<void>
  cancelledRefresh(): boolean
}

function baseDeps(overrides?: Partial<AdblockControllerDeps>): DepsHarness {
  const fetched: string[] = []
  const applied: { engine: FakeEngine | null; enabled: boolean }[] = []
  const written: { raw: Uint8Array; meta: AdblockCacheMeta }[] = []
  const scheduleCalls: { ms: number }[] = []
  const warnings: string[] = []

  let cache: { engine: Uint8Array; meta: AdblockCacheMeta } | null = null
  let fire: () => Promise<void> | void = () => {}
  let cancelled = false
  let nextEngineId = 0

  const deps: AdblockControllerDeps = {
    lists: ['http://lists.example/a.txt', 'http://lists.example/b.txt'],
    resourcesUrl: 'http://lists.example/resources.json',
    fetchText: async (url) => {
      fetched.push(url)
      return `filters-for ${url}`
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
    now: () => 1_000_000,
    updateEveryMs: 1000,
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
    fetched,
    applied,
    written,
    scheduleCalls,
    warnings,
    setCache: (next: { engine: Uint8Array; meta: AdblockCacheMeta } | null) => {
      cache = next
    },
    fireRefresh: async () => {
      await fire()
    },
    cancelledRefresh: () => cancelled,
  })
}

function cacheEntry(meta: AdblockCacheMeta): { engine: Uint8Array; meta: AdblockCacheMeta } {
  return { engine: new TextEncoder().encode('serialized:engine-0'), meta }
}

describe('createAdblockController startup', () => {
  it('fetches lists + resources on a cold cache, persists the engine and applies it', async () => {
    const deps = baseDeps()
    const controller = createAdblockController(deps)
    await controller.ready()

    expect(deps.fetched).toEqual([
      'http://lists.example/a.txt',
      'http://lists.example/b.txt',
      'http://lists.example/resources.json',
    ])
    expect(deps.applied).toEqual([{ engine: { id: 'engine-0' }, enabled: true }])
    expect(deps.written).toHaveLength(1)
    expect(deps.written[0]!.meta).toEqual({
      urls: ['http://lists.example/a.txt', 'http://lists.example/b.txt'],
      updatedAt: 1_000_000,
    })

    controller.dispose()
  })

  it('reuses a fresh cache without touching the network', async () => {
    const deps = baseDeps()
    deps.setCache(cacheEntry({ urls: deps.lists, updatedAt: 999_999 }))
    const controller = createAdblockController(deps)
    await controller.ready()

    expect(deps.fetched).toEqual([])
    expect(deps.written).toEqual([])
    expect(deps.applied).toEqual([{ engine: { id: 'engine-0' }, enabled: true }])

    controller.dispose()
  })

  it('refetches when the cache is stale, from different lists, or corrupt', async () => {
    const stale = baseDeps()
    stale.setCache(cacheEntry({ urls: stale.lists, updatedAt: 1_000_000 - 1000 }))
    await createAdblockController(stale).ready()
    expect(stale.fetched).not.toEqual([])
    expect(stale.written).toHaveLength(1)

    const mismatched = baseDeps()
    mismatched.setCache(cacheEntry({ urls: ['http://lists.example/other.txt'], updatedAt: 1_000_000 }))
    await createAdblockController(mismatched).ready()
    expect(mismatched.fetched).not.toEqual([])

    const corrupt = baseDeps()
    corrupt.setCache({
      engine: new TextEncoder().encode('garbage'),
      meta: { urls: corrupt.lists, updatedAt: 1_000_000 },
    })
    await createAdblockController(corrupt).ready()
    expect(corrupt.fetched).not.toEqual([])
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
  it('rebuilds from the network on the scheduled tick and swaps the engine in', async () => {
    const deps = baseDeps()
    deps.setCache(cacheEntry({ urls: deps.lists, updatedAt: 999_999 }))
    const controller = createAdblockController(deps)
    await controller.ready()

    expect(deps.scheduleCalls.map((call) => call.ms)).toEqual([1000])

    await deps.fireRefresh()

    expect(deps.fetched).not.toEqual([])
    // A fresh engine instance is swapped in over the cached one.
    expect(deps.applied).toHaveLength(2)
    expect(deps.applied[1]!.engine).not.toBe(deps.applied[0]!.engine)
    expect(deps.applied.map((entry) => entry.enabled)).toEqual([true, true])
    expect(deps.written).toHaveLength(1)
    expect(deps.written[0]!.meta.updatedAt).toBe(1_000_000)
    // A successful refresh keeps the regular cadence.
    expect(deps.scheduleCalls.map((call) => call.ms)).toEqual([1000, 1000])

    controller.dispose()
  })

  it('keeps the previous engine when a refresh fails', async () => {
    const deps = baseDeps()
    deps.setCache(cacheEntry({ urls: deps.lists, updatedAt: 999_999 }))
    const controller = createAdblockController(deps)
    await controller.ready()

    deps.fetchText = async () => {
      throw new Error('offline')
    }
    await deps.fireRefresh()

    expect(deps.applied).toEqual([{ engine: { id: 'engine-0' }, enabled: true }])
    expect(deps.warnings).toHaveLength(1)
    expect(deps.scheduleCalls.map((call) => call.ms)).toEqual([1000, ADBLOCK_RETRY_MS])

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
    deps.setCache(cacheEntry({ urls: deps.lists, updatedAt: 999_999 }))
    const controller = createAdblockController(deps)
    await controller.ready()

    controller.setEnabled(false)
    controller.setEnabled(false)
    controller.setEnabled(true)

    expect(deps.fetched).toEqual([])
    expect(deps.applied).toEqual([
      { engine: { id: 'engine-0' }, enabled: true },
      { engine: { id: 'engine-0' }, enabled: false },
      { engine: { id: 'engine-0' }, enabled: true },
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
