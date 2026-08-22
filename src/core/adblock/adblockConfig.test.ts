import { describe, expect, it } from 'vitest'
import {
  ADBLOCK_DAILY_REFRESH_MS,
  ADBLOCK_HOURLY_REFRESH_MS,
  ADBLOCK_QUICK_FIXES_URL,
  DEFAULT_ADBLOCK_LISTS,
  adblockCachePaths,
  adblockEntryIsStale,
  adblockNextRefreshAtMs,
  adblockRefreshEveryMs,
  cacheIsUsable,
  resolveAdblockConfig,
  type AdblockCacheEntry,
  type AdblockCacheMeta,
} from './adblockConfig'

const HOURLY = 60 * 60 * 1000
const DAILY = 24 * HOURLY

function entry(url: string, updatedAt: number): AdblockCacheEntry {
  return { url, updatedAt }
}

function meta(lists: AdblockCacheEntry[], resources: AdblockCacheEntry | null = null): AdblockCacheMeta {
  return { lists, resources }
}

describe('DEFAULT_ADBLOCK_LISTS', () => {
  it('bundles EasyList, uBlock filters, quick-fixes and a malware-domain list', () => {
    const joined = DEFAULT_ADBLOCK_LISTS.join(' ')
    expect(joined).toContain('easylist.to/easylist/easylist.txt')
    expect(joined).toContain('ublockorigin.github.io/uAssets/filters/filters.txt')
    expect(joined).toContain(ADBLOCK_QUICK_FIXES_URL)
    expect(joined).toContain('urlhaus')
  })

  it('excludes EasyPrivacy (v1: breakage debugging on a voice browser)', () => {
    expect(DEFAULT_ADBLOCK_LISTS.join(' ')).not.toContain('easyprivacy')
  })
})

describe('adblockRefreshEveryMs', () => {
  it('refreshes quick-fixes hourly', () => {
    expect(adblockRefreshEveryMs(ADBLOCK_QUICK_FIXES_URL)).toBe(ADBLOCK_HOURLY_REFRESH_MS)
    expect(ADBLOCK_HOURLY_REFRESH_MS).toBe(HOURLY)
  })

  it('keeps every other list (and scriptlet resources) on the daily cadence', () => {
    for (const url of DEFAULT_ADBLOCK_LISTS.filter((url) => url !== ADBLOCK_QUICK_FIXES_URL)) {
      expect(adblockRefreshEveryMs(url)).toBe(ADBLOCK_DAILY_REFRESH_MS)
    }
    expect(ADBLOCK_DAILY_REFRESH_MS).toBe(DAILY)
    expect(adblockRefreshEveryMs('http://lists.example/custom.txt')).toBe(DAILY)
    expect(adblockRefreshEveryMs('https://ghostery.example/resources.json')).toBe(DAILY)
  })
})

describe('resolveAdblockConfig', () => {
  it('returns the default lists (quick-fixes included) when nothing is set', () => {
    const config = resolveAdblockConfig({})
    expect(config.lists).toEqual(DEFAULT_ADBLOCK_LISTS)
    expect(config.lists).toContain(ADBLOCK_QUICK_FIXES_URL)
    expect(config.resourcesUrl).not.toBeNull()
  })

  it('replaces the lists from BINGBONG_ADBLOCK_LISTS', () => {
    const config = resolveAdblockConfig({
      BINGBONG_ADBLOCK_LISTS: 'http://lists.example/a.txt , http://lists.example/b.txt',
    })
    expect(config.lists).toEqual(['http://lists.example/a.txt', 'http://lists.example/b.txt'])
  })

  it('drops empty entries from the override', () => {
    const config = resolveAdblockConfig({ BINGBONG_ADBLOCK_LISTS: ' http://lists.example/a.txt ,,' })
    expect(config.lists).toEqual(['http://lists.example/a.txt'])
  })

  it('is fully off with BINGBONG_ADBLOCK=off', () => {
    const config = resolveAdblockConfig({ BINGBONG_ADBLOCK: 'off' })
    expect(config.lists).toEqual([])
    expect(config.resourcesUrl).toBeNull()
  })

  it('skips scriptlet resources when BINGBONG_ADBLOCK_RESOURCES is set but empty', () => {
    expect(resolveAdblockConfig({ BINGBONG_ADBLOCK_RESOURCES: '' }).resourcesUrl).toBeNull()
    expect(resolveAdblockConfig({ BINGBONG_ADBLOCK_RESOURCES: 'http://r.example/x.json' }).resourcesUrl).toBe(
      'http://r.example/x.json',
    )
  })
})

describe('adblockCachePaths', () => {
  it('places the engine cache, metadata and list texts beside the profile', () => {
    expect(adblockCachePaths('/userData')).toEqual({
      engine: '/userData/adblock-engine.bin',
      meta: '/userData/adblock-meta.json',
      listsDir: '/userData/adblock-lists',
    })
  })
})

describe('adblockEntryIsStale', () => {
  const url = ADBLOCK_QUICK_FIXES_URL
  const updatedAt = 1_000_000_000_000

  it('is fresh until its own cadence elapses', () => {
    expect(adblockEntryIsStale(entry(url, updatedAt), updatedAt + HOURLY - 1)).toBe(false)
  })

  it('is stale the moment the cadence elapses', () => {
    expect(adblockEntryIsStale(entry(url, updatedAt), updatedAt + HOURLY)).toBe(true)
  })
})

describe('cacheIsUsable', () => {
  const quickFixes = ADBLOCK_QUICK_FIXES_URL
  const daily = 'http://lists.example/easylist.txt'
  const resources = 'http://r.example/resources.json'
  const lists = [daily, quickFixes]
  const now = 1_000_000_000_000

  function freshMeta(quickFixesAge: number, dailyAge: number, resourcesAge: number | null): AdblockCacheMeta {
    return meta(
      [entry(daily, now - dailyAge), entry(quickFixes, now - quickFixesAge)],
      resourcesAge === null ? null : entry(resources, now - resourcesAge),
    )
  }

  it('rejects a missing cache', () => {
    expect(cacheIsUsable(null, lists, resources, now)).toBe(false)
  })

  it('rejects a pre-per-list-cadence cache (one updatedAt for all urls)', () => {
    const legacy = { urls: lists, updatedAt: now - 1 } as unknown as AdblockCacheMeta
    expect(cacheIsUsable(legacy, lists, resources, now)).toBe(false)
  })

  it('rejects a cache built from different lists', () => {
    const other = meta([entry('http://lists.example/other.txt', now), entry(quickFixes, now)])
    expect(cacheIsUsable(other, lists, resources, now)).toBe(false)
  })

  it('accepts a cache where every list is fresh under its own cadence', () => {
    // quick-fixes 30 minutes old, daily list 2 hours old, resources 2 hours old.
    expect(cacheIsUsable(freshMeta(HOURLY / 2, 2 * HOURLY, 2 * HOURLY), lists, resources, now)).toBe(true)
  })

  it('rejects a cache whose hourly list has gone stale while the daily ones are fresh', () => {
    expect(cacheIsUsable(freshMeta(2 * HOURLY, 2 * HOURLY, 2 * HOURLY), lists, resources, now)).toBe(false)
  })

  it('rejects a cache whose daily list has gone stale while the hourly one is fresh', () => {
    expect(cacheIsUsable(freshMeta(HOURLY / 2, DAILY, DAILY / 2), lists, resources, now)).toBe(false)
  })

  it('requires the resources entry to match and be fresh when resources are configured', () => {
    expect(cacheIsUsable(freshMeta(0, 0, null), lists, resources, now)).toBe(false)

    const mismatchedUrl = meta(
      [entry(daily, now), entry(quickFixes, now)],
      entry('http://r.example/other.json', now),
    )
    expect(cacheIsUsable(mismatchedUrl, lists, resources, now)).toBe(false)

    expect(cacheIsUsable(freshMeta(0, 0, DAILY), lists, resources, now)).toBe(false)
  })

  it('requires no resources entry when resources are disabled', () => {
    expect(cacheIsUsable(freshMeta(0, 0, null), lists, null, now)).toBe(true)
    expect(cacheIsUsable(freshMeta(0, 0, 0), lists, null, now)).toBe(false)
  })
})

describe('adblockNextRefreshAtMs', () => {
  const quickFixes = ADBLOCK_QUICK_FIXES_URL
  const daily = 'http://lists.example/easylist.txt'
  const resources = 'http://r.example/resources.json'
  const t = 1_000_000_000_000

  it('fires at the hourly deadline while the daily artifacts wait a day', () => {
    const m = meta([entry(daily, t), entry(quickFixes, t)], entry(resources, t))
    expect(adblockNextRefreshAtMs(m)).toBe(t + HOURLY)
  })

  it('advances to the daily deadline once quick-fixes is refreshed past it', () => {
    const m = meta([entry(daily, t), entry(quickFixes, t + DAILY)], entry(resources, t))
    expect(adblockNextRefreshAtMs(m)).toBe(t + DAILY)
  })
})
