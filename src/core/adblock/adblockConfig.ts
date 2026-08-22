// Embedder-level adblocker configuration (issue #21). The engine itself is
// @ghostery/adblocker-electron attached to the persistent browse partition;
// this module owns which lists feed it and when the disk cache is stale.

// Default lists: EasyList (ads) + uBlock Origin's core filters and quick
// fixes + a malware-domain blocklist. quick-fixes carries uBlock's fast
// reaction rules for YouTube's rotating ad experiments (issue #69) and is the
// one list on an hourly refresh cadence. EasyPrivacy is deliberately absent —
// tracker breakage on a voice-driven browser is painful to debug blind;
// revisit after v1 settles.
export const ADBLOCK_QUICK_FIXES_URL = 'https://ublockorigin.github.io/uAssets/filters/quick-fixes.txt'

export const DEFAULT_ADBLOCK_LISTS: string[] = [
  'https://easylist.to/easylist/easylist.txt',
  'https://ublockorigin.github.io/uAssets/filters/filters.txt',
  ADBLOCK_QUICK_FIXES_URL,
  'https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-online.txt',
]

// Scriptlet/redirect resources (uBlock resources.json mirror maintained by
// Ghostery). Cosmetic *hiding* works without it; scriptlet-based filters need it.
export const DEFAULT_ADBLOCK_RESOURCES_URL =
  'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/resources.json'

/** Everything except quick-fixes refreshes daily; between refreshes the
 * serialized engine comes straight from the disk cache so launches don't
 * re-download. */
export const ADBLOCK_DAILY_REFRESH_MS = 24 * 60 * 60 * 1000

/** quick-fixes refreshes hourly so YouTube's rotating ad experiments die as
 * fast here as in uBlock Origin proper (issue #69). */
export const ADBLOCK_HOURLY_REFRESH_MS = 60 * 60 * 1000

/** Per-list refresh cadence. Unknown URLs (env overrides included) get the
 * daily default; only the quick-fixes list is hourly. */
export function adblockRefreshEveryMs(url: string): number {
  return url === ADBLOCK_QUICK_FIXES_URL ? ADBLOCK_HOURLY_REFRESH_MS : ADBLOCK_DAILY_REFRESH_MS
}

export interface AdblockConfig {
  /** Filter-list URLs; empty means the whole engine stays off. */
  lists: string[]
  /** uBlock resources.json URL, or null to skip scriptlet resources. */
  resourcesUrl: string | null
}

export function resolveAdblockConfig(env: Record<string, string | undefined>): AdblockConfig {
  if (env.BINGBONG_ADBLOCK === 'off') return { lists: [], resourcesUrl: null }

  const override = env.BINGBONG_ADBLOCK_LISTS
  const lists =
    override === undefined
      ? DEFAULT_ADBLOCK_LISTS
      : override
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry) => entry !== '')

  const resourcesOverride = env.BINGBONG_ADBLOCK_RESOURCES
  return { lists, resourcesUrl: resourcesOverride === undefined ? DEFAULT_ADBLOCK_RESOURCES_URL : resourcesOverride || null }
}

export interface AdblockCachePaths {
  engine: string
  meta: string
  /** Directory of cached raw list texts, keyed per URL by the glue. */
  listsDir: string
}

export function adblockCachePaths(userDataDir: string): AdblockCachePaths {
  return {
    engine: `${userDataDir}/adblock-engine.bin`,
    meta: `${userDataDir}/adblock-meta.json`,
    listsDir: `${userDataDir}/adblock-lists`,
  }
}

/** One cached artifact (a filter list or the scriptlet resources) and when
 * its text was last fetched from the network. */
export interface AdblockCacheEntry {
  url: string
  updatedAt: number
}

export interface AdblockCacheMeta {
  /** Engine provenance: one entry per configured list, in engine-parse order. */
  lists: AdblockCacheEntry[]
  /** Scriptlet resources entry, or null when none are configured. */
  resources: AdblockCacheEntry | null
}

/** An artifact is stale the moment its own cadence elapses. */
export function adblockEntryIsStale(entry: AdblockCacheEntry, now: number): boolean {
  return now - entry.updatedAt >= adblockRefreshEveryMs(entry.url)
}

/** A cached engine can skip the network only when every artifact it was built
 * from is still fresh under that artifact's own cadence. */
export function cacheIsUsable(
  meta: AdblockCacheMeta | null,
  lists: string[],
  resourcesUrl: string | null,
  now: number,
): boolean {
  if (meta === null || !Array.isArray(meta.lists)) return false
  if (meta.lists.length !== lists.length) return false
  if (meta.lists.some((entry, index) => entry.url !== lists[index] || adblockEntryIsStale(entry, now))) return false

  if (resourcesUrl === null) return meta.resources === null
  if (meta.resources === null || meta.resources.url !== resourcesUrl) return false
  return !adblockEntryIsStale(meta.resources, now)
}

/** Earliest moment any configured artifact goes stale — the next refresh tick. */
export function adblockNextRefreshAtMs(meta: AdblockCacheMeta): number {
  const deadlines = meta.lists.map((entry) => entry.updatedAt + adblockRefreshEveryMs(entry.url))
  if (meta.resources !== null) {
    deadlines.push(meta.resources.updatedAt + adblockRefreshEveryMs(meta.resources.url))
  }
  return Math.min(...deadlines)
}
